export interface CalendarCell {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

/** Local-time YYYY-MM-DD. Never use toISOString(): it shifts to UTC. */
export function toDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * Monday-first 6x7 grid covering `month` (0-based). Always 42 cells so the
 * month height never jumps between months.
 */
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarCell[] {
  // getDay() is Sunday=0; shift so Monday=0.
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const todayKey = toDateKey(today);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i++) {
    // Component arithmetic keeps local midnight and steps over DST correctly,
    // unlike adding 86400000 ms.
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toDateKey(date);
    cells.push({ date, key, inMonth: date.getMonth() === month, isToday: key === todayKey });
  }

  return cells;
}

export const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}
