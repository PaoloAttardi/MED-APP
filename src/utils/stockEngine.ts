import type { Drug, TimeWindow, DoseEvent, DoseEventType } from '../types';
import { drugRepository, timeWindowRepository, doseEventRepository } from '../db/repositories';
import { getSettings } from './settings';

export function calculateDailyDose(timeWindows: TimeWindow[]): number {
  return timeWindows
    .filter(tw => tw.notification_enabled)
    .reduce((sum, tw) => sum + tw.dose_per_intake, 0);
}

export function calculateAutonomy(currentStock: number, dailyDose: number): number {
  if (dailyDose <= 0) return Infinity;
  return Math.floor(currentStock / dailyDose);
}

export function calculateStockOutDate(autonomy: number, baseDate: Date = new Date()): Date | null {
  if (autonomy === Infinity) return null;
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + autonomy);
  return d;
}

export interface StockStatus {
  autonomy: number;
  dailyDose: number;
  isLowStock: boolean;
  stockOutDate: Date | null;
}

export function evaluateStockStatus(drug: Drug, timeWindows: TimeWindow[], thresholdDays: number): StockStatus {
  const dailyDose = calculateDailyDose(timeWindows);
  const autonomy = calculateAutonomy(drug.current_stock, dailyDose);
  const isLowStock = autonomy <= thresholdDays;
  const stockOutDate = calculateStockOutDate(autonomy);
  
  return {
    autonomy,
    dailyDose,
    isLowStock,
    stockOutDate
  };
}

export const stockEngine = {
  async processDoseConfirmation(
    drugId: string,
    windowId: string,
    actualDose: number,
    scheduledDateTime: string // YYYY-MM-DDTHH:MM...
  ): Promise<{ drug: Drug; event: DoseEvent; lowStockEntered: boolean }> {
    const drug = await drugRepository.getById(drugId);
    if (!drug) throw new Error(`Drug ${drugId} not found`);

    const window = await timeWindowRepository.getById(windowId);
    if (!window) throw new Error(`TimeWindow ${windowId} not found`);

    // Ensure we check if this dose was already confirmed (idempotency check)
    const datePart = scheduledDateTime.split('T')[0];
    const alreadyConfirmed = await doseEventRepository.existsConfirmedForWindow(drugId, windowId, datePart);
    if (alreadyConfirmed) {
      // Return existing data or throw a specific error that the caller can ignore
      const existingEvents = await doseEventRepository.getByDrugAndDate(drugId, datePart);
      const matchedEvent = existingEvents.find(e => e.time_window_id === windowId && (e.event_type === 'CONFIRMED' || e.event_type === 'SKIPPED_VOLUNTARY'));
      if (matchedEvent) {
        return { drug, event: matchedEvent, lowStockEntered: false };
      }
    }

    // Decrement stock: cap at 0
    const previousStock = drug.current_stock;
    const newStock = Math.max(0, previousStock - actualDose);
    
    // Create the event
    const now = new Date().toISOString();
    const eventType: DoseEventType = actualDose === 0 ? 'SKIPPED_VOLUNTARY' : 'CONFIRMED';
    const event = await doseEventRepository.create({
      drug_id: drugId,
      time_window_id: windowId,
      event_type: eventType,
      planned_dose: window.dose_per_intake,
      actual_dose: actualDose,
      scheduled_datetime: scheduledDateTime,
      confirmed_at: now,
      stock_after: newStock
    });

    // Update drug stock
    const updatedDrug = await drugRepository.update(drugId, { current_stock: newStock });

    // Evaluate low stock entry
    const windows = await timeWindowRepository.getByDrugId(drugId);
    const settings = getSettings();
    const status = evaluateStockStatus(updatedDrug, windows, settings.low_stock_threshold_days);

    let lowStockEntered = false;
    if (status.isLowStock && !drug.low_stock_alert_active && status.dailyDose > 0) {
      // Stock has just crossed the threshold into low stock state
      await drugRepository.update(drugId, { low_stock_alert_active: true });
      updatedDrug.low_stock_alert_active = true;
      lowStockEntered = true;
    }

    return { drug: updatedDrug, event, lowStockEntered };
  },

  async processRefill(drugId: string, delta: number): Promise<Drug> {
    if (delta <= 0) throw new Error('Refill quantity must be greater than 0');

    const drug = await drugRepository.getById(drugId);
    if (!drug) throw new Error(`Drug ${drugId} not found`);

    const newStock = drug.current_stock + delta;
    
    // Re-evaluate stock status
    const windows = await timeWindowRepository.getByDrugId(drugId);
    const settings = getSettings();
    
    // Temporarily create updated drug object to evaluate status
    const tempDrug = { ...drug, current_stock: newStock };
    const status = evaluateStockStatus(tempDrug, windows, settings.low_stock_threshold_days);

    // If autonomy is now above threshold, clear the low stock alert flag
    const patch: Partial<Drug> = { current_stock: newStock };
    if (!status.isLowStock) {
      patch.low_stock_alert_active = false;
    }

    return await drugRepository.update(drugId, patch);
  },

  async processManualStockCorrection(drugId: string, absoluteValue: number): Promise<Drug> {
    if (absoluteValue < 0) throw new Error('Stock value cannot be negative');

    const drug = await drugRepository.getById(drugId);
    if (!drug) throw new Error(`Drug ${drugId} not found`);

    const windows = await timeWindowRepository.getByDrugId(drugId);
    const settings = getSettings();

    const tempDrug = { ...drug, current_stock: absoluteValue };
    const status = evaluateStockStatus(tempDrug, windows, settings.low_stock_threshold_days);

    const patch: Partial<Drug> = { current_stock: absoluteValue };
    if (!status.isLowStock) {
      patch.low_stock_alert_active = false;
    } else if (status.dailyDose > 0 && !drug.low_stock_alert_active) {
      patch.low_stock_alert_active = true;
    }

    return await drugRepository.update(drugId, patch);
  },

  async reevaluateAllDrugsStockStatus(): Promise<void> {
    const drugs = await drugRepository.getAll();
    const settings = getSettings();

    for (const drug of drugs) {
      const windows = await timeWindowRepository.getByDrugId(drug.id);
      const status = evaluateStockStatus(drug, windows, settings.low_stock_threshold_days);

      if (status.isLowStock && !drug.low_stock_alert_active && status.dailyDose > 0) {
        await drugRepository.update(drug.id, { low_stock_alert_active: true });
      } else if (!status.isLowStock && drug.low_stock_alert_active) {
        await drugRepository.update(drug.id, { low_stock_alert_active: false });
      }
    }
  }
};
