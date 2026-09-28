import { toLocalDateString } from '../../src/shared/lib/availability';

/**
 * A Sunday at least 14 days from "now", so "future slot" tests never expire
 * as the calendar moves on. Always a Sunday (weekday 0) because several
 * tests toggle business_hours for weekday 0.
 */
export function futureSunday(minDaysAhead = 14): string {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return toLocalDateString(d);
}

/** A date safely in the past (also a Sunday). */
export const PAST_SUNDAY = '2020-01-05';
