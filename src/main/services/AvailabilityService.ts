import type Database from 'better-sqlite3';
import { mapBusinessHours, mapPeriod, type BusinessHoursRow, type PeriodRow } from '../db/mappers';
import type { BusinessHours, Period, DayAvailability, AvailabilitySlot } from '../../shared/types/domain';
import {
  buildDayAvailability,
  findNextAvailable as findNextAvailablePure,
  weekdayOf,
  type OccupyingReservation,
} from '../../shared/lib/availability';

/** Reservation statuses that occupy capacity. COMPLETED still counts so past
 * days show what was actually used (and a slot can't be over-sold if a
 * session finishes early). Cancelled/no-show reservations
 * release capacity automatically simply by not being in this list — there
 * is no separate capacity ledger to keep in sync. */
export class AvailabilityValidationError extends Error {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const OCCUPYING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];

export class AvailabilityService {
  constructor(private db: Database.Database) {}

  getBusinessHours(weekday: number): BusinessHours {
    const row = this.db
      .prepare<[number], BusinessHoursRow>(`SELECT * FROM business_hours WHERE weekday = ?`)
      .get(weekday);
    if (!row) {
      // Defensive default — business_hours is seeded for all 7 weekdays by
      // the v6 migration, so this should never actually be hit, but a
      // closed fallback is the safe default if it somehow is.
      return { weekday, isOpen: false, openTime: null, closeTime: null, slotMinutes: 60, capacity: 0 };
    }
    return mapBusinessHours(row);
  }

  listBusinessHours(): BusinessHours[] {
    return this.db
      .prepare<[], BusinessHoursRow>(`SELECT * FROM business_hours ORDER BY weekday`)
      .all()
      .map(mapBusinessHours);
  }

  updateBusinessHours(weekday: number, input: Partial<Omit<BusinessHours, 'weekday'>>): BusinessHours {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new AvailabilityValidationError('Weekday must be 0 (Sunday) to 6 (Saturday)');
    }
    const existing = this.getBusinessHours(weekday);
    const isOpen = input.isOpen ?? existing.isOpen;
    const openTime = input.openTime !== undefined ? input.openTime : existing.openTime;
    const closeTime = input.closeTime !== undefined ? input.closeTime : existing.closeTime;
    const slotMinutes = input.slotMinutes ?? existing.slotMinutes;
    const capacity = input.capacity ?? existing.capacity;
    if (!Number.isInteger(slotMinutes) || slotMinutes <= 0 || slotMinutes > 480) {
      throw new AvailabilityValidationError('Slot length must be a whole number of minutes between 1 and 480');
    }
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000) {
      throw new AvailabilityValidationError('Capacity must be a whole number between 0 and 1000');
    }
    if (isOpen) {
      if (!openTime || !closeTime || !HHMM.test(openTime) || !HHMM.test(closeTime)) {
        throw new AvailabilityValidationError('An open day needs valid opening and closing times (HH:MM)');
      }
      if (openTime >= closeTime) {
        throw new AvailabilityValidationError('Opening time must be earlier than closing time');
      }
    }
    this.db
      .prepare(
        `UPDATE business_hours SET is_open = ?, open_time = ?, close_time = ?, slot_minutes = ?, capacity = ?
         WHERE weekday = ?`
      )
      .run(
        (input.isOpen ?? existing.isOpen) ? 1 : 0,
        input.openTime !== undefined ? input.openTime : existing.openTime,
        input.closeTime !== undefined ? input.closeTime : existing.closeTime,
        input.slotMinutes ?? existing.slotMinutes,
        input.capacity ?? existing.capacity,
        weekday
      );
    return this.getBusinessHours(weekday);
  }

  listPeriods(): Period[] {
    return this.db
      .prepare<[], PeriodRow>(`SELECT * FROM periods ORDER BY sort_order, id`)
      .all()
      .map(mapPeriod);
  }

  upsertPeriod(input: {
    id?: number;
    name: string;
    startTime: string;
    endTime: string;
    sortOrder?: number;
    active?: boolean;
  }): Period {
    const name = input.name.trim();
    if (!name) throw new AvailabilityValidationError('Period name is required');
    if (!HHMM.test(input.startTime) || !HHMM.test(input.endTime)) {
      throw new AvailabilityValidationError('Period times must be valid (HH:MM)');
    }
    if (input.startTime >= input.endTime) {
      throw new AvailabilityValidationError('Period start must be earlier than its end');
    }
    input = { ...input, name };
    if (input.id) {
      this.db
        .prepare(
          `UPDATE periods SET name = ?, start_time = ?, end_time = ?, sort_order = ?, active = ? WHERE id = ?`
        )
        .run(input.name, input.startTime, input.endTime, input.sortOrder ?? 0, input.active === false ? 0 : 1, input.id);
      return this.listPeriods().find((p) => p.id === input.id)!;
    }
    const result = this.db
      .prepare(
        `INSERT INTO periods (name, start_time, end_time, sort_order, active) VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.name, input.startTime, input.endTime, input.sortOrder ?? 0, input.active === false ? 0 : 1);
    return this.listPeriods().find((p) => p.id === Number(result.lastInsertRowid))!;
  }

  /** Reservations on a given date that currently occupy capacity. */
  private occupyingReservations(date: string): OccupyingReservation[] {
    const placeholders = OCCUPYING_STATUSES.map(() => '?').join(',');
    return this.db
      .prepare<unknown[], { start_time: string; duration_min: number; players: number }>(
        `SELECT start_time, duration_min, players FROM reservations
         WHERE reservation_date = ? AND status IN (${placeholders})`
      )
      .all(date, ...OCCUPYING_STATUSES)
      .map((r: { start_time: string; duration_min: number; players: number }) => ({
        startTime: r.start_time,
        durationMin: r.duration_min,
        players: r.players,
      }));
  }

  getDayAvailability(date: string, now: Date = new Date()): DayAvailability {
    const hours = this.getBusinessHours(weekdayOf(date));
    const periods = this.listPeriods();
    const reservations = this.occupyingReservations(date);
    return buildDayAvailability({ date, hours, periods, reservations, now });
  }

  getRangeAvailability(startDate: string, endDate: string, now: Date = new Date()): DayAvailability[] {
    const days: DayAvailability[] = [];
    let cursor = startDate;
    // Simple date-string iteration; dates are always 'YYYY-MM-DD' so this
    // stays correct across month/year boundaries via the Date object.
    while (cursor <= endDate) {
      days.push(this.getDayAvailability(cursor, now));
      const [y, m, d] = cursor.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      cursor = next.toISOString().slice(0, 10);
    }
    return days;
  }

  /**
   * Scan forward up to `maxDaysAhead` days (default 14) from fromDate/
   * fromTime for the first AVAILABLE or ALMOST_FULL slot. Returns null if
   * nothing is found in range — callers must not fabricate a fallback.
   */
  findNextAvailable(
    fromDate: string,
    fromTime: string,
    maxDaysAhead = 14,
    now: Date = new Date()
  ): AvailabilitySlot | null {
    const [y, m, d] = fromDate.split('-').map(Number);
    const endDate = new Date(Date.UTC(y, m - 1, d + maxDaysAhead)).toISOString().slice(0, 10);
    const days = this.getRangeAvailability(fromDate, endDate, now);
    return findNextAvailablePure(days, fromDate, fromTime);
  }
}
