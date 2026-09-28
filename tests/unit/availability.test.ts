import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayAvailability,
  computeSlotStatus,
  findNextAvailable,
  weekdayOf,
  resolvePeriod,
} from '../../src/shared/lib/availability';
import type { BusinessHours, Period } from '../../src/shared/types/domain';

const HOURS: BusinessHours = {
  weekday: 0,
  isOpen: true,
  openTime: '09:00',
  closeTime: '12:00',
  slotMinutes: 60,
  capacity: 4,
};

const PERIODS: Period[] = [
  { id: 1, name: 'Morning', startTime: '09:00', endTime: '12:00', sortOrder: 0, active: true, createdAt: '' },
];

describe('availability', () => {
  test('weekdayOf matches JS/SQLite convention (0=Sunday)', () => {
    // 2026-09-27 is a Sunday.
    assert.equal(weekdayOf('2026-09-27'), 0);
  });

  test('resolvePeriod finds the matching half-open interval', () => {
    const period = resolvePeriod('09:00', PERIODS);
    assert.equal(period?.name, 'Morning');
    assert.equal(resolvePeriod('12:00', PERIODS), null); // boundary excluded (end is exclusive)
  });

  test('a closed day has no bookable slots', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: { ...HOURS, isOpen: false, openTime: null, closeTime: null },
      periods: PERIODS,
      reservations: [],
      now: new Date('2026-09-27T08:00:00'),
    });
    assert.equal(day.isOpen, false);
    assert.deepEqual(day.slots, []);
  });

  test('a fully-booked slot is FULL', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [{ startTime: '09:00', durationMin: 60, players: 4 }],
      now: new Date('2026-09-27T08:00:00'),
    });
    const slot = day.slots.find((s) => s.startTime === '09:00');
    assert.equal(slot?.status, 'FULL');
  });

  test('occupancy at/above the almost-full threshold (default 75%) is ALMOST_FULL, not AVAILABLE', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [{ startTime: '10:00', durationMin: 60, players: 3 }], // 3/4 = 75%
      now: new Date('2026-09-27T08:00:00'),
    });
    const slot = day.slots.find((s) => s.startTime === '10:00');
    assert.equal(slot?.status, 'ALMOST_FULL');
  });

  test('an empty future slot is AVAILABLE', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [],
      now: new Date('2026-09-27T08:00:00'),
    });
    for (const slot of day.slots) assert.equal(slot.status, 'AVAILABLE');
  });

  test('a slot currently underway is IN_PROGRESS, never AVAILABLE', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [],
      now: new Date('2026-09-27T09:30:00'), // inside the 09:00-10:00 slot
    });
    const current = day.slots.find((s) => s.startTime === '09:00');
    const future = day.slots.find((s) => s.startTime === '10:00');
    assert.equal(current?.status, 'IN_PROGRESS');
    assert.equal(future?.status, 'AVAILABLE');
  });

  test('past slots are COMPLETED and never resurface as available', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [],
      now: new Date('2026-09-27T13:00:00'), // after closing time
    });
    for (const slot of day.slots) assert.equal(slot.status, 'COMPLETED');
  });

  test('computeSlotStatus: closed day always returns CLOSED regardless of time', () => {
    const status = computeSlotStatus({
      date: '2026-09-27',
      startTime: '10:00',
      durationMin: 60,
      capacity: 4,
      occupied: 0,
      isOpen: false,
      now: new Date('2026-09-27T08:00:00'),
    });
    assert.equal(status, 'CLOSED');
  });

  test('findNextAvailable skips FULL/past slots and returns the first real opening', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [{ startTime: '09:00', durationMin: 60, players: 4 }],
      now: new Date('2026-09-27T08:00:00'),
    });
    const next = findNextAvailable([day], '2026-09-27', '09:00');
    assert.equal(next?.startTime, '10:00');
  });

  test('findNextAvailable returns null when nothing matches (never fabricates a slot)', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [
        { startTime: '09:00', durationMin: 60, players: 4 },
        { startTime: '10:00', durationMin: 60, players: 4 },
        { startTime: '11:00', durationMin: 60, players: 4 },
      ],
      now: new Date('2026-09-27T08:00:00'),
    });
    assert.equal(findNextAvailable([day], '2026-09-27', '09:00'), null);
  });

  test('findNextAvailable respects the fromTime cutoff on the first day scanned', () => {
    const day = buildDayAvailability({
      date: '2026-09-27',
      hours: HOURS,
      periods: PERIODS,
      reservations: [],
      now: new Date('2026-09-27T08:00:00'),
    });
    // Ask starting from 11:00 — 09:00/10:00 must not be returned even though AVAILABLE.
    const next = findNextAvailable([day], '2026-09-27', '11:00');
    assert.equal(next?.startTime, '11:00');
  });
});
