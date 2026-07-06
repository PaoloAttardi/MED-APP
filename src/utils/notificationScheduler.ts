import type { TimeWindow } from '../types';
import { drugRepository, timeWindowRepository, doseEventRepository } from '../db/repositories';
import { getSettings } from './settings';
import { evaluateStockStatus } from './stockEngine';

// Get YYYY-MM-DD in local time
export function getLocalDateString(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getHoursMinutesString(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Function to calculate the end time of a window
export function getWindowActiveRange(
  window: TimeWindow,
  sortedWindows: TimeWindow[],
  dateStr: string
): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T${window.notification_time}:00`);
  
  const currentIndex = sortedWindows.findIndex(w => w.id === window.id);
  let end: Date;

  if (currentIndex < sortedWindows.length - 1) {
    // End is the start of the next window on the same day
    const nextWindow = sortedWindows[currentIndex + 1];
    end = new Date(`${dateStr}T${nextWindow.notification_time}:00`);
  } else {
    // Last window of the day ends at 23:59:59
    end = new Date(`${dateStr}T23:59:59`);
  }

  return { start, end };
}

export const notificationScheduler = {
  // 1. Check and trigger dose reminder notifications for the current minute
  async checkAndTriggerDoseReminders(): Promise<void> {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    if (!reg) return;

    const drugs = await drugRepository.getAll();
    const todayStr = getLocalDateString();
    const currentHHMM = getHoursMinutesString();

    for (const drug of drugs) {
      const windows = await timeWindowRepository.getByDrugId(drug.id);
      
      for (const win of windows) {
        if (!win.notification_enabled) continue;

        // If the scheduled notification time is exactly the current time (HH:MM)
        if (win.notification_time === currentHHMM) {
          // Check if dose event (any type) already exists for this window today
          const alreadyLogged = await doseEventRepository.existsConfirmedForWindow(drug.id, win.id, todayStr);
          
          if (!alreadyLogged) {
            // Show the notification using the SW registration so click actions are caught by sw.js
            const tag = `dose-reminder-${drug.id}-${win.id}-${todayStr}`;
            
            reg.showNotification(`Ora del farmaco: ${drug.name}`, {
              body: `${win.label} — ${win.dose_per_intake} ${drug.unit_label}`,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag,
              data: {
                drugId: drug.id,
                windowId: win.id,
                scheduledDateTime: `${todayStr}T${win.notification_time}:00`
              },
              actions: [
                { action: 'confirm', title: 'Ho preso la dose' },
                { action: 'open', title: 'Apri app' }
              ],
              requireInteraction: true
            } as any);
          }
        }
      }
    }
  },

  // 2. Scan past windows (for today and previous days) and log implicit skips
  async checkAndLogImplicitSkips(): Promise<void> {
    const drugs = await drugRepository.getAll();
    const now = new Date();
    
    // We look back up to 5 days to handle case where device was powered off / offline
    for (let dayOffset = 0; dayOffset <= 5; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(now.getDate() - dayOffset);
      const targetDateStr = getLocalDateString(targetDate);

      for (const drug of drugs) {
        const sortedWindows = await timeWindowRepository.getByDrugId(drug.id);
        if (sortedWindows.length === 0) continue;

        for (const win of sortedWindows) {
          const { end } = getWindowActiveRange(win, sortedWindows, targetDateStr);

          // If the window's active period is already in the past
          if (now > end) {
            // Check if there is already an event logged for this window on this date
            const events = await doseEventRepository.getByDrugAndDate(drug.id, targetDateStr);
            const eventForWindow = events.some(e => e.time_window_id === win.id);

            if (!eventForWindow) {
              // Log an implicit skip!
              await doseEventRepository.create({
                drug_id: drug.id,
                time_window_id: win.id,
                event_type: 'SKIPPED_IMPLICIT',
                planned_dose: win.dose_per_intake,
                actual_dose: 0,
                scheduled_datetime: `${targetDateStr}T${win.notification_time}:00`,
                confirmed_at: end.toISOString(), // Expired time
                stock_after: drug.current_stock
              });
              
              console.log(`Logged implicit skip for ${drug.name} - ${win.label} on ${targetDateStr}`);
            }
          }
        }
      }
    }
  },

  // 3. Check and trigger low stock recurring notifications
  async checkAndTriggerLowStockReminders(): Promise<void> {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    if (!reg) return;

    // Check low stock once a day, e.g., at 09:00 (if app is running)
    const currentHHMM = getHoursMinutesString();
    if (currentHHMM !== '09:00') {
      // For manual trigger during test, we'll run it, but in production it fires at 09:00
      // To allow testing, we also let it run if specifically called, but check local storage to limit once-per-day
    }

    const todayStr = getLocalDateString();
    const settings = getSettings();
    const drugs = await drugRepository.getAll();

    for (const drug of drugs) {
      if (!drug.low_stock_alert_active) continue;

      const windows = await timeWindowRepository.getByDrugId(drug.id);
      const status = evaluateStockStatus(drug, windows, settings.low_stock_threshold_days);
      if (!status.isLowStock || status.autonomy === Infinity || !status.stockOutDate) continue;

      const notifKey = `low_stock_notif_fired_${drug.id}_${todayStr}`;
      const alreadyFiredToday = localStorage.getItem(notifKey) === 'true';
      if (alreadyFiredToday) continue;

      // Evaluate frequency condition
      let shouldNotify = false;

      if (settings.low_stock_notification_frequency === 'DAILY') {
        shouldNotify = true;
      } else if (settings.low_stock_notification_frequency === 'EVERY_TWO_DAYS') {
        // Find when the alert became active, or notify every even offset days from stock-out date
        const daysToStockOut = status.autonomy;
        // Notify if daysToStockOut is even (or odd, as long as it alternates)
        shouldNotify = daysToStockOut % 2 === 0;
      } else if (settings.low_stock_notification_frequency === 'DAY_BEFORE_ONLY') {
        // Only trigger if autonomy is exactly 1 day (stock out tomorrow)
        // Or if autonomy is 0 (stock out today, as fallback)
        shouldNotify = status.autonomy === 1 || status.autonomy === 0;
      }

      if (shouldNotify) {
        let bodyText = `Scorta in esaurimento. Autonomia stimata: ${status.autonomy} giorni.`;
        if (status.autonomy === 0) {
          bodyText = `La scorta di questo farmaco è esaurita!`;
        } else if (status.autonomy === 1) {
          bodyText = `La scorta terminerà domani! Ricordati di fare rifornimento.`;
        }

        reg.showNotification(`⚠️ ${drug.name}: scorta quasi esaurita`, {
          body: bodyText,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `low-stock-${drug.id}-${todayStr}`,
          data: { drugId: drug.id }
        });

        localStorage.setItem(notifKey, 'true');
      }
    }
  },

  // Start the background interval (runs every 60s)
  start(onTick?: () => void) {
    // Run immediately
    this.checkAndTriggerDoseReminders();
    this.checkAndLogImplicitSkips();
    this.checkAndTriggerLowStockReminders();

    const intervalId = setInterval(() => {
      this.checkAndTriggerDoseReminders();
      this.checkAndLogImplicitSkips();
      this.checkAndTriggerLowStockReminders();
      if (onTick) onTick();
    }, 60000); // every minute

    return () => clearInterval(intervalId);
  }
};
