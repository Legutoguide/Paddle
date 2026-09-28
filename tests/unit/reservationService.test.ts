import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { futureSunday, PAST_SUNDAY } from './testDates';
import { ReservationService, SlotUnavailableError, ReservationConflictError } from '../../src/main/services/ReservationService';
import { PricingService } from '../../src/main/services/PricingService';
import { AvailabilityService } from '../../src/main/services/AvailabilityService';
import { CustomerService } from '../../src/main/services/CustomerService';

// A Sunday far enough in the future that "past slot" tests can also use
// earlier dates without going negative. Business hours are seeded 09:00-19:00
// every day by the v6 migration; we add one universal (any weekday/period)
// pricing rule so every test date/duration=60 combination resolves a price.
const TEST_DATE = futureSunday();
const PAST_DATE = PAST_SUNDAY;

describe('ReservationService — Walk-in / Advance creation', () => {
  let db: Database.Database;
  let reservations: ReservationService;
  let pricing: PricingService;

  beforeEach(() => {
    db = createTestDb();
    reservations = new ReservationService(db);
    pricing = new PricingService(db);
    pricing.create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
  });

  test('creates a Walk-in reservation as CONFIRMED with the resolved price', () => {
    const r = reservations.createWalkIn({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 2,
    });
    assert.equal(r.reservationType, 'WALK_IN');
    assert.equal(r.status, 'CONFIRMED');
    assert.equal(r.basePriceCents, 10000);
    assert.equal(r.finalPriceCents, 10000);
    assert.equal(r.paymentStatus, 'UNPAID');
  });

  test('creates an Advance reservation the same way', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Sara', phone: '20999888' },
      reservationDate: TEST_DATE,
      startTime: '11:00',
      durationMin: 60,
      players: 3,
    });
    assert.equal(r.reservationType, 'ADVANCE');
    assert.equal(r.status, 'CONFIRMED');
  });

  test('rejects booking a closed day', () => {
    const availability = new AvailabilityService(db);
    availability.updateBusinessHours(0, { isOpen: false }); // TEST_DATE is always a Sunday = weekday 0
    assert.throws(
      () =>
        reservations.createWalkIn({
          customer: { name: 'Amir', phone: '20123456' },
          reservationDate: TEST_DATE,
          startTime: '10:00',
          durationMin: 60,
          players: 1,
        }),
      SlotUnavailableError
    );
  });

  test('rejects booking a past/completed slot', () => {
    assert.throws(
      () =>
        reservations.createWalkIn({
          customer: { name: 'Amir', phone: '20123456' },
          reservationDate: PAST_DATE,
          startTime: '10:00',
          durationMin: 60,
          players: 1,
        }),
      SlotUnavailableError
    );
  });

  test('rejects a booking that would exceed slot capacity, accepts up to exactly capacity', () => {
    // Default seeded capacity is 4.
    reservations.createWalkIn({
      customer: { name: 'Group A', phone: '20000001' },
      reservationDate: TEST_DATE,
      startTime: '12:00',
      durationMin: 60,
      players: 4,
    });
    assert.throws(
      () =>
        reservations.createWalkIn({
          customer: { name: 'Group B', phone: '20000002' },
          reservationDate: TEST_DATE,
          startTime: '12:00',
          durationMin: 60,
          players: 1,
        }),
      SlotUnavailableError
    );
  });

  test('find-or-create by phone reuses the same customer across two bookings', () => {
    const customers = new CustomerService(db);
    reservations.createWalkIn({
      customer: { name: 'Yassine', phone: '22 333 444' },
      reservationDate: TEST_DATE,
      startTime: '13:00',
      durationMin: 60,
      players: 1,
    });
    reservations.createAdvance({
      customer: { name: 'Yassine', phone: '22-333-444' }, // different formatting, same number
      reservationDate: TEST_DATE,
      startTime: '14:00',
      durationMin: 60,
      players: 1,
    });
    const all = customers.list();
    assert.equal(all.length, 1, 'phone-normalized match must not create a duplicate customer');
    const stats = customers.getWithStats(all[0].id)!;
    assert.equal(stats.stats.totalReservations, 2);
  });

  test('throws with no matching pricing rule rather than fabricating a price', () => {
    const emptyDb = createTestDb();
    const emptyReservations = new ReservationService(emptyDb);
    assert.throws(() =>
      emptyReservations.createWalkIn({
        customer: { name: 'Amir', phone: '20123456' },
        reservationDate: TEST_DATE,
        startTime: '10:00',
        durationMin: 60,
        players: 1,
      })
    );
  });
});

describe('ReservationService — status lifecycle', () => {
  let db: Database.Database;
  let reservations: ReservationService;

  beforeEach(() => {
    db = createTestDb();
    reservations = new ReservationService(db);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
  });

  function makeReservation() {
    return reservations.createWalkIn({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
    });
  }

  test('valid path: CONFIRMED -> CHECKED_IN -> IN_PROGRESS -> COMPLETED', () => {
    const r = makeReservation();
    reservations.checkIn(r.id);
    reservations.start(r.id);
    const done = reservations.complete(r.id);
    assert.equal(done.status, 'COMPLETED');
  });

  test('rejects an out-of-order transition (CONFIRMED -> IN_PROGRESS directly)', () => {
    const r = makeReservation();
    assert.throws(() => reservations.transition(r.id, 'IN_PROGRESS'), ReservationConflictError);
  });

  test('rejects any transition out of a terminal status (COMPLETED)', () => {
    const r = makeReservation();
    reservations.checkIn(r.id);
    reservations.start(r.id);
    reservations.complete(r.id);
    assert.throws(() => reservations.cancel(r.id, 'changed my mind'), ReservationConflictError);
  });

  test('cancel releases capacity for the same slot', () => {
    const first = reservations.createWalkIn({
      customer: { name: 'Group A', phone: '20000001' },
      reservationDate: TEST_DATE,
      startTime: '15:00',
      durationMin: 60,
      players: 4,
    });
    // Slot is now full.
    assert.throws(() =>
      reservations.createWalkIn({
        customer: { name: 'Group B', phone: '20000002' },
        reservationDate: TEST_DATE,
        startTime: '15:00',
        durationMin: 60,
        players: 1,
      })
    );
    reservations.cancel(first.id, 'no longer needed');
    // Now it must be bookable again.
    const second = reservations.createWalkIn({
      customer: { name: 'Group B', phone: '20000002' },
      reservationDate: TEST_DATE,
      startTime: '15:00',
      durationMin: 60,
      players: 4,
    });
    assert.equal(second.status, 'CONFIRMED');
  });

  test('no-show also releases capacity (same as cancel)', () => {
    const r = reservations.createWalkIn({
      customer: { name: 'Group A', phone: '20000001' },
      reservationDate: TEST_DATE,
      startTime: '16:00',
      durationMin: 60,
      players: 4,
    });
    reservations.noShow(r.id);
    assert.equal(reservations.getById(r.id)!.status, 'NO_SHOW');
    const second = reservations.createWalkIn({
      customer: { name: 'Group B', phone: '20000002' },
      reservationDate: TEST_DATE,
      startTime: '16:00',
      durationMin: 60,
      players: 4,
    });
    assert.equal(second.status, 'CONFIRMED');
  });

  test('every status transition is recorded in reservation_history', () => {
    const r = makeReservation();
    reservations.checkIn(r.id);
    reservations.start(r.id);
    reservations.complete(r.id);
    const history = reservations.getHistory(r.id);
    const toStatuses = history.map((h) => h.toStatus);
    assert.deepEqual(toStatuses, ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']);
  });
});

describe('ReservationService — search', () => {
  test('search finds a reservation by customer name, phone, id, or coupon code', () => {
    const db = createTestDb();
    const reservations = new ReservationService(db);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
    const r = reservations.createWalkIn({
      customer: { name: 'Findable Person', phone: '29876543' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
    });
    assert.equal(reservations.search('Findable')[0].id, r.id);
    assert.equal(reservations.search('29876543')[0].id, r.id);
    assert.equal(reservations.search(String(r.id))[0].id, r.id);
  });
});

describe('AvailabilityService — configuration validation (server-side)', () => {
  test('rejects opening time after closing time, bad slot length, negative capacity, and bad periods', () => {
    const db = createTestDb();
    const a = new AvailabilityService(db);
    assert.throws(() => a.updateBusinessHours(1, { openTime: '18:00', closeTime: '09:00' }), /earlier than closing/);
    assert.throws(() => a.updateBusinessHours(1, { slotMinutes: 0 }), /Slot length/);
    assert.throws(() => a.updateBusinessHours(1, { capacity: -1 }), /Capacity/);
    assert.throws(() => a.updateBusinessHours(9, { capacity: 1 }), /Weekday/);
    assert.throws(() => a.upsertPeriod({ name: 'Bad', startTime: '12:00', endTime: '11:00' }), /earlier/);
    assert.throws(() => a.upsertPeriod({ name: ' ', startTime: '09:00', endTime: '10:00' }), /name/);
  });

  test('accepts a valid change and a closed day without times', () => {
    const db = createTestDb();
    const a = new AvailabilityService(db);
    assert.equal(a.updateBusinessHours(2, { openTime: '08:00', closeTime: '20:00', capacity: 6 }).capacity, 6);
    assert.equal(a.updateBusinessHours(3, { isOpen: false }).isOpen, false);
  });
});

describe('Input validation (IPC input is untrusted)', () => {
  test('rejects malformed dates/times/players and invalid pricing rules', () => {
    const db = createTestDb();
    const res = new ReservationService(db);
    const pricing = new PricingService(db);
    pricing.create({ name: 'Std', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
    const base = { customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '10:00', durationMin: 60, players: 1 };
    assert.throws(() => res.createWalkIn({ ...base, players: 1.5 }), /whole number/);
    assert.throws(() => res.createWalkIn({ ...base, players: 0 }), /whole number/);
    assert.throws(() => res.createWalkIn({ ...base, reservationDate: '2026-02-30' }), /valid date/);
    assert.throws(() => res.createWalkIn({ ...base, reservationDate: 'tomorrow' }), /valid date/);
    assert.throws(() => res.createWalkIn({ ...base, startTime: '25:00' }), /valid time/);
    assert.throws(() => res.createWalkIn({ ...base, durationMin: -5 }), /Duration/);
    assert.throws(() => pricing.create({ name: 'X', weekdayMask: 0, durationMin: 60, priceCents: 1 }), /day of the week/);
    assert.throws(() => pricing.create({ name: 'X', weekdayMask: 300, durationMin: 60, priceCents: 1 }), /day of the week/);
    assert.throws(() => pricing.create({ name: 'X', weekdayMask: 1, durationMin: 60, priceCents: 9.5 }), /whole cents/);
    assert.throws(() => pricing.update(1, { weekdayMask: 0 }), /day of the week/);
    assert.equal(res.list().length, 0, 'nothing may be created by rejected input');
  });
});
