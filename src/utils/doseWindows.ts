import type { TimeWindow, Settings } from '../types';

/** Default re-arm horizon, in days. */
export const ARM_DAYS = 7;

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

// The wall-clock times a window should notify at, from `from` onwards.
// Today is included only for times still in the future: earlier ones are the
// catch-up path's job, not a fresh alarm's.
export function getUpcomingOccurrences(
  window: TimeWindow,
  from: Date,
  days: number = ARM_DAYS
): Date[] {
  const [hh, mm] = window.notification_time.split(':').map(Number);
  const out: Date[] = [];

  for (let offset = 0; offset < days; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hh, mm, 0, 0);
    if (day.getTime() > from.getTime()) out.push(day);
  }
  return out;
}

export function shouldNotifyLowStock(
  settings: Settings,
  autonomy: number,
  lastNotifiedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (autonomy <= 0) return true;
  if (settings.low_stock_notification_frequency === 'DAY_BEFORE_ONLY') {
    return autonomy === 1;
  }
  if (settings.low_stock_notification_frequency === 'EVERY_TWO_DAYS') {
    // Every 2 days counted from the last notification actually sent. Deriving
    // this from `autonomy` instead would flip parity every day, because
    // autonomy decrements once per day.
    if (!lastNotifiedAt) return true;
    const elapsedDays = Math.floor((now.getTime() - lastNotifiedAt.getTime()) / 86_400_000);
    return elapsedDays >= 2;
  }
  return true;
}
