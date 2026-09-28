import { toLocalDateString } from '@shared/lib/availability';

export { toLocalDateString };

export const todayStr = (): string => toLocalDateString(new Date());

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDateString(d);
}

/** Monday-start week containing `s`. */
export function startOfWeek(s: string): string {
  const d = parseDate(s);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toLocalDateString(d);
}

export function monthBounds(s: string): { first: string; last: string } {
  const d = parseDate(s);
  return {
    first: toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1)),
    last: toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function prettyDate(s: string): string {
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function nowHHMM(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}
