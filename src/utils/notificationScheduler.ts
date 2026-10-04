import { registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { Drug, TimeWindow } from '../types';
import { drugRepository, timeWindowRepository, doseEventRepository } from '../db/repositories';
import { getSettings } from './settings';
import { evaluateStockStatus, stockEngine } from './stockEngine';
import { isNotificationFired, markNotificationFired, getLastFiredAt, pruneNotificationLog } from './notificationLog';
import {
  getLocalDateString,
  getWindowActiveRange,
  getUpcomingOccurrences,
  shouldNotifyLowStock
} from './doseWindows';

// Re-exported so components keep importing the date helpers from here.
export {
  ARM_DAYS,
  getLocalDateString,
  getHoursMinutesString,
  getWindowActiveRange,
  getUpcomingOccurrences,
  shouldNotifyLowStock
} from './doseWindows';

const CHANNEL_ID = 'dose-reminders';
const ACTION_TYPE_ID = 'dose-reminder';
const LOW_STOCK_HOUR = 9;
const LOW_STOCK_MINUTE = 0;
// Kept far above scheduleAll()'s counter so catch-up ids never collide with it.
const CATCHUP_ID_BASE = 1_000_000;

// The plugin's LocalNotificationRestoreReceiver already re-arms every saved
// alarm on BOOT_COMPLETED, and re-fires ones whose time passed while the device
// was off. The rolling window below is therefore not a reboot workaround: it is
// what picks up windows created or edited after the last arming.
// ponytail: 7 days x ~15 windows is ~100 alarms, well under Android's 500 cap.

// No npm package wraps this Intent, and Android blocks web navigation to
// intent:// from a WebView, so it is a ~25-line local plugin in android/app.
const BatterySettings = registerPlugin<{ open(): Promise<void> }>('BatterySettings');

function buildDoseNotification(
  drug: Drug,
  win: TimeWindow,
  dateStr: string,
  id: number,
  at?: Date
): LocalNotificationSchema {
  return {
    id,
    title: `Ora del farmaco: ${drug.name}`,
    body: `${win.label} — ${win.dose_per_intake} ${drug.unit_label}`,
    schedule: at ? { at, allowWhileIdle: true } : undefined,
    channelId: CHANNEL_ID,
    smallIcon: 'ic_stat_medtracker',
    iconColor: '#0369a1',
    actionTypeId: ACTION_TYPE_ID,
    // Do not prompt for the exact-alarm settings screen mid-use; fall back to
    // an inexact alarm instead and surface ScheduleResult.warning to the user.
    isExactNotification: true,
    isExactMandatory: false,
    extra: {
      kind: 'dose',
      drugId: drug.id,
      windowId: win.id,
      scheduledDateTime: `${dateStr}T${win.notification_time}:00`,
    },
  };
}

function buildLowStockNotification(
  drug: Drug,
  autonomy: number,
  id: number,
  at: Date
): LocalNotificationSchema {
  const body = autonomy === 0
    ? 'La scorta di questo farmaco è esaurita!'
    : autonomy === 1
      ? 'La scorta terminerà domani! Ricordati di fare rifornimento.'
      : `Scorta in esaurimento. Autonomia stimata: ${autonomy} giorni.`;

  return {
    id,
    title: `⚠️ ${drug.name}: scorta quasi esaurita`,
    body,
    schedule: { at, allowWhileIdle: true },
    channelId: CHANNEL_ID,
    smallIcon: 'ic_stat_medtracker',
    iconColor: '#0369a1',
    actionTypeId: ACTION_TYPE_ID,
    isExactNotification: true,
    isExactMandatory: false,
    extra: { kind: 'low-stock', drugId: drug.id },
  };
}

export const notificationScheduler = {
  // A notification on a channelId that was never created silently never fires,
  // so this must run before the first schedule() of the session.
  async init(): Promise<void> {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Promemoria farmaci',
      description: 'Avvisi di assunzione e scorte in esaurimento',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  },

  // Wipe and re-arm the whole rolling window. Ids are a per-call counter: the
  // rebuild cancels by whatever getPending() reports, so they need not be stable.
  async scheduleAll(): Promise<void> {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;

    const { notifications: pending } = await LocalNotifications.getPending();
    if (pending.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.map(n => ({ id: n.id })) });
    }

    const now = new Date();
    const settings = getSettings();
    const drugs = await drugRepository.getAll();
    const batch: LocalNotificationSchema[] = [];
    // Keys written as the alarm is armed. A native alarm that fires leaves no
    // trace in JS, so without this the catch-up path cannot tell "already
    // delivered by AlarmManager" from "never scheduled" and double-notifies.
    const armedDoseKeys: string[] = [];
    const armedLowKeys: string[] = [];
    let id = 1;

    for (const drug of drugs) {
      const windows = await timeWindowRepository.getByDrugId(drug.id);
      if (windows.length === 0) continue;

      for (const win of windows) {
        if (!win.notification_enabled) continue;
        for (const at of getUpcomingOccurrences(win, now)) {
          const dateStr = getLocalDateString(at);
          batch.push(buildDoseNotification(drug, win, dateStr, id++, at));
          armedDoseKeys.push(`dose:${win.id}:${dateStr}`);
        }
      }

      if (!drug.low_stock_alert_active) continue;
      const status = evaluateStockStatus(drug, windows, settings.low_stock_threshold_days);
      if (!status.isLowStock || status.autonomy === Infinity) continue;

      const last = await getLastFiredAt(`low:${drug.id}:`);
      if (!shouldNotifyLowStock(settings, status.autonomy, last, now)) continue;

      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), LOW_STOCK_HOUR, LOW_STOCK_MINUTE);
      if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      batch.push(buildLowStockNotification(drug, status.autonomy, id++, at));
      armedLowKeys.push(`low:${drug.id}:${getLocalDateString(at)}`);
    }

    if (batch.length === 0) return;

    const result = await LocalNotifications.schedule({ notifications: batch });
    if (result.warning) {
      console.warn('Alcuni promemoria non sono esatti:', result.warning.message);
    }

    // Only after schedule() succeeded: a failed batch must stay catch-up-able.
    for (const key of armedDoseKeys) await markNotificationFired(key);
    for (const key of armedLowKeys) await markNotificationFired(key);
  },

  // Windows whose start has passed but whose end has not: the phone was in
  // airplane mode, or the window was created after the last arming. Notify
  // immediately. The log is written at arm time by scheduleAll(), so an alarm
  // AlarmManager already delivered is skipped here instead of double-notifying.
  async catchUpOpenWindows(): Promise<void> {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;

    const now = new Date();
    const todayStr = getLocalDateString(now);
    const drugs = await drugRepository.getAll();
    const immediate: LocalNotificationSchema[] = [];
    // Disjoint from scheduleAll()'s 1..N range: reusing low ids would replace
    // still-pending dose alarms, silently dropping those reminders.
    let id = CATCHUP_ID_BASE;

    for (const drug of drugs) {
      const windows = await timeWindowRepository.getByDrugId(drug.id);
      if (windows.length === 0) continue;

      for (const win of windows) {
        if (!win.notification_enabled) continue;

        const { start, end } = getWindowActiveRange(win, windows, todayStr);
        if (now < start || now >= end) continue;
        if (await isNotificationFired(`dose:${win.id}:${todayStr}`)) continue;
        if (await doseEventRepository.existsConfirmedForWindow(drug.id, win.id, todayStr)) continue;

        immediate.push(buildDoseNotification(drug, win, todayStr, id++));
        await markNotificationFired(`dose:${win.id}:${todayStr}`);
      }
    }

    if (immediate.length === 0) return;
    await LocalNotifications.schedule({ notifications: immediate });
  },

  // Single entry point for "the data changed, re-arm". scheduleAll() must run
  // before the catch-up so the log already covers the armed alarms.
  async refresh(): Promise<void> {
    await this.scheduleAll();
    await this.catchUpOpenWindows();
  },

  // Scan past windows (for today and previous days) and log implicit skips.
  // Only windows that contribute to the daily dose are considered: a window with
  // notifications off is excluded by calculateDailyDose too, so logging a skip
  // for one would invent a dose event for a dose the stock maths never counted.
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
          if (!win.notification_enabled) continue;

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

  // Runs once per app launch: arm the alarms, catch up anything missed, and log
  // the implicit skips that only a live process can write.
  async start(): Promise<void> {
    await pruneNotificationLog().catch(err => {
      console.warn('Failed to prune notification log:', err);
    });

    await this.checkAndLogImplicitSkips();
    await this.init();

    await LocalNotifications.registerActionTypes({
      types: [{
        id: ACTION_TYPE_ID,
        actions: [{ id: 'confirm', title: 'Ho preso la dose' }],
      }],
    }).catch(err => {
      console.warn('Failed to register notification actions:', err);
    });

    await this.refresh();
  },

  // The "Ho preso la dose" button. Runs in the app process, so it reads the real
  // low-stock threshold from settings — the Service Worker version had to fall
  // back to a hardcoded 4 because it could not read localStorage.
  async confirmDose(extra: unknown): Promise<void> {
    if (!extra || typeof extra !== 'object') return;
    const { kind, drugId, windowId, scheduledDateTime } = extra as {
      kind?: string; drugId?: string; windowId?: string; scheduledDateTime?: string;
    };
    if (kind !== 'dose' || !drugId || !windowId || !scheduledDateTime) return;

    try {
      const win = await timeWindowRepository.getById(windowId);
      if (!win) return;

      await stockEngine.processDoseConfirmation(
        drugId,
        windowId,
        win.dose_per_intake,
        scheduledDateTime
      );
    } catch (err) {
      console.error('Failed to confirm dose from notification:', err);
    }
  },

  async getPermissionStatus(): Promise<string> {
    const status = await LocalNotifications.checkPermissions();
    return status.display;
  },

  async requestPermission(): Promise<string> {
    const status = await LocalNotifications.requestPermissions();
    return status.display;
  },

  async openExactAlarmSettings(): Promise<void> {
    await LocalNotifications.changeExactNotificationSetting();
  },

  // Android deletes every exact alarm if the user revokes the permission, so
  // this is re-read on launch and re-arms when it comes back granted.
  async checkExactAlarmSetting(): Promise<string> {
    const status = await LocalNotifications.checkExactNotificationSetting();
    return status.exact_alarm;
  },

  // Android's per-OEM battery managers ("deep sleep", "Auto-start", "Battery
  // optimisation") can freeze the app even though AlarmManager itself is exempt.
  // ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS lands on the list of apps to
  // exempt and needs no manifest permission, unlike the Play-restricted
  // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
  async openBatteryOptimizationSettings(): Promise<void> {
    await BatterySettings.open();
  },
};
