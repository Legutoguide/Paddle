// Availability calculation for the Prime Paddle reservation system.
//
// This module is intentionally pure (no DB, no Date.now() called internally —
// "now" is always passed in) so it can be unit tested exhaustively without a
// database and reused identically by AvailabilityService (real data) and by
// tests (fixture data). Never fabricate or shortcut this logic in the UI —
// the renderer must always ask the main process for availability, which
// calls this same module against real rows.

import type { BusinessHours, Period, SlotStatus, AvailabilitySlot, DayAvailability } from '../types/domain';

export const DEFAULT_ALMOST_FULL_THRESHOLD = 0.75;

/** Minimal shape of an occupying reservation, enough to compute capacity. */
export interface OccupyingReservation {
  startTime: string; // 'HH:MM'
  durationMin: number;
  players: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Weekday as SQLite's strftime('%w', ...) / JS Date#getDay(): 0=Sunday..6=Saturday. */
export function weekdayOf(dateStr: string): number {
  // Parse as a plain calendar date, not a timezone-sensitive instant.
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Resolve which configured period (if any) a given start time falls under.
 * A time exactly on a period boundary belongs to the period that starts
 * there ([start, end) — half-open intervals, so periods never overlap).
 */
export function resolvePeriod(startTime: string, periods: Period[]): Period | null {
  const t = toMinutes(startTime);
  return (
    periods
      .filter((p) => p.active)
      .find((p) => t >= toMinutes(p.startTime) && t < toMinutes(p.endTime)) ?? null
  );
}

/**
 * Compute the live status of a single slot. `nowIso` is a full ISO instant;
 * `date`/`startTime` describe the slot being evaluated in the business's
 * local calendar terms (this module does not do timezone conversion itself
 * — callers pass already-localized date/time strings, consistent with how
 * reservation_date/start_time are stored).
 */
export function computeSlotStatus(params: {
  date: string;
  startTime: string;
  durationMin: number;
  capacity: number;
  occupied: number;
  isOpen: boolean;
  now: Date;
  almostFullThreshold?: number;
}): SlotStatus {
  const { date, startTime, durationMin, capacity, occupied, isOpen, now } = params;
  const threshold = params.almostFullThreshold ?? DEFAULT_ALMOST_FULL_THRESHOLD;

  if (!isOpen) return 'CLOSED';

  const slotStartMinutes = toMinutes(startTime);
  const slotEndMinutes = slotStartMinutes + durationMin;

  // Build comparable Date instants for "now" vs the slot's local start/end,
  // anchored to the slot's own date so multi-day comparisons are correct.
  const [y, m, d] = date.split('-').map(Number);
  const slotStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  slotStart.setMinutes(slotStartMinutes);
  const slotEnd = new Date(y, m - 1, d, 0, 0, 0, 0);
  slotEnd.setMinutes(slotEndMinutes);

  if (now >= slotEnd) return 'COMPLETED';
  if (now >= slotStart && now < slotEnd) return 'IN_PROGRESS';

  // Future slot.
  if (occupied >= capacity) return 'FULL';
  if (capacity > 0 && occupied / capacity >= threshold) return 'ALMOST_FULL';
  return 'AVAILABLE';
}

/**
 * Build the full list of bookable slots for one day from business hours +
 * periods + the reservations already occupying that day. Past slots are
 * never marked available — computeSlotStatus handles that via `now`.
 */
export function buildDayAvailability(params: {
  date: string;
  hours: BusinessHours;
  periods: Period[];
  reservations: OccupyingReservation[];
  now: Date;
  almostFullThreshold?: number;
}): DayAvailability {
  const { date, hours, periods, reservations, now } = params;

  if (!hours.isOpen || !hours.openTime || !hours.closeTime) {
    return { date, isOpen: false, slots: [] };
  }

  const slots: AvailabilitySlot[] = [];
  const openMin = toMinutes(hours.openTime);
  const closeMin = toMinutes(hours.closeTime);

  for (let t = openMin; t + hours.slotMinutes <= closeMin; t += hours.slotMinutes) {
    const startTime = toHHMM(t);
    const endTime = toHHMM(t + hours.slotMinutes);
    const occupied = reservations
      .filter((r) => r.startTime === startTime)
      .reduce((sum, r) => sum + r.players, 0);
    const period = resolvePeriod(startTime, periods);

    slots.push({
      date,
      startTime,
      endTime,
      periodId: period?.id ?? null,
      periodName: period?.name ?? null,
      capacity: hours.capacity,
      occupied,
      status: computeSlotStatus({
        date,
        startTime,
        durationMin: hours.slotMinutes,
        capacity: hours.capacity,
        occupied,
        isOpen: hours.isOpen,
        now,
        almostFullThreshold: params.almostFullThreshold,
      }),
    });
  }

  return { date, isOpen: true, slots };
}

/**
 * Scan forward from `fromDate`/`fromTime` (inclusive) across up to
 * `maxDaysAhead` days of already-built DayAvailability, returning the first
 * slot whose status is AVAILABLE or ALMOST_FULL. Returns null if nothing is
 * found in range — callers must not fabricate a fallback slot.
 */
export function findNextAvailable(
  days: DayAvailability[],
  fromDate: string,
  fromTime: string
): AvailabilitySlot | null {
  for (const day of days) {
    if (!day.isOpen) continue;
    for (const slot of day.slots) {
      if (day.date === fromDate && toMinutes(slot.startTime) < toMinutes(fromTime)) continue;
      if (slot.status === 'AVAILABLE' || slot.status === 'ALMOST_FULL') return slot;
    }
  }
  return null;
}

/** 'YYYY-MM-DD' for a Date in the machine's LOCAL calendar (the business's
 * day), never UTC — reservation_date is stored in local business terms. */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
