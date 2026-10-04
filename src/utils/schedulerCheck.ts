import type { TimeWindow } from '../types';
import { getWindowActiveRange, getUpcomingOccurrences } from './doseWindows.ts';
import { toDateKey, addMonths, buildMonthGrid } from './calendarGrid.ts';

const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const win = (id: string, t: string): TimeWindow => ({
  id, drug_id: 'd1', label: id, notification_time: t,
  dose_per_intake: 1, notification_enabled: true, created_at: ''
});

/* --- dose windows --- */
const w1 = win('w1', '08:00');
const r = getWindowActiveRange(w1, [w1], '2026-10-03');
assert(r.start.getHours() === 8, 'range start hour');
assert(r.end.getHours() === 23 && r.end.getMinutes() === 59, 'last window ends at 23:59:59');

const w1b = win('w1', '08:00');
const w2 = win('w2', '20:00');
const r2 = getWindowActiveRange(w1b, [w1b, w2], '2026-10-03');
assert(r2.end.getHours() === 20, 'window ends at next window start');

// Today's time still ahead -> today plus the next 6 loop days = 7 occurrences.
const up = getUpcomingOccurrences(w1, new Date(2026, 9, 3, 7, 59), 7);
assert(up.length === 7, `expected 7 occurrences, got ${up.length}`);
assert(up[0].getDate() === 3 && up[0].getHours() === 8, 'first occurrence is today 08:00');
assert(up[6].getDate() === 9, 'last occurrence is 6 days out');

// Already past today's time -> today is dropped, 6 of the 7 loop days remain.
const up2 = getUpcomingOccurrences(w1, new Date(2026, 9, 3, 8, 1), 7);
assert(up2.length === 6, `expected 6 occurrences, got ${up2.length}`);
assert(up2[0].getDate() === 4 && up2[0].getHours() === 8, 'first occurrence is tomorrow 08:00');

/* --- calendar grid (month arg is 0-based, so 9 = October) --- */
assert(toDateKey(new Date(2026, 0, 5)) === '2026-01-05', 'date key pads month and day');
assert(toDateKey(new Date(2026, 11, 31)) === '2026-12-31', 'date key december');

// October 2026 starts on a Thursday, so a Monday-first grid opens on Mon 28 Sep.
const oct = buildMonthGrid(2026, 9, new Date(2026, 9, 15));
assert(oct.length === 42, 'grid is always 42 cells');
assert(oct[0].key === '2026-09-28', `october 2026 grid opens Mon 28 Sep, got ${oct[0].key}`);
assert(oct.filter(c => c.inMonth).length === 31, 'october has 31 in-month cells');
assert(oct.find(c => c.isToday)?.key === '2026-10-15', 'today is flagged');
assert(oct.filter(c => !c.inMonth).length === 11, 'padding cells are flagged as outside');

// Monday-first for a month that starts on Sunday: feb 2026 starts on Sunday,
// so the grid must open on Mon Jan 26.
const feb = buildMonthGrid(2026, 1, new Date(2026, 1, 10));
assert(feb[0].key === '2026-01-26', `feb 2026 grid opens Mon 26 Jan, got ${feb[0].key}`);
assert(new Date(2026, 1, 10).getDay() === 2, 'sanity: 10 feb 2026 is a Tuesday');

const dec = buildMonthGrid(2026, 11, new Date(2026, 11, 25));
assert(dec.filter(c => c.inMonth).length === 31, 'december has 31 in-month cells');

const cross = addMonths(2026, 11, 1);
assert(cross.year === 2027 && cross.month === 0, 'addMonths rolls into next year');
const back = addMonths(2026, 0, -1);
assert(back.year === 2025 && back.month === 11, 'addMonths rolls into previous year');
assert(addMonths(2026, 4, 0).month === 4, 'addMonths with 0 is identity');

console.log('schedulerCheck: OK');
