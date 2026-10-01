import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { futureSunday, PAST_SUNDAY } from './testDates';
import { ReservationService, ReservationConflictError } from '../../src/main/services/ReservationService';
import { PricingService } from '../../src/main/services/PricingService';
import { CouponService, CouponConflictError } from '../../src/main/services/couponService';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';

const TEST_DATE = futureSunday();

describe('Coupon <-> Reservation integration (atomic payment rule)', () => {
  let db: Database.Database;
  let coupons: CouponService;
  let reservations: ReservationService;
  let couponCode: string;

  beforeEach(() => {
    db = createTestDb();
    coupons = new CouponService(db);
    // ReservationService MUST share the same CouponService instance the
    // rest of the app uses — this mirrors registerHandlers.ts's svc()
    // wiring exactly, and matters because both need to see the same
    // in-flight coupon state within one transaction.
    reservations = new ReservationService(db, coupons);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });

    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    const sponsor = sponsors.create({ name: 'Beach Co' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Autumn Promo',
      serviceName: '1 Hour Board',
      originalPrice: 100,
      discountPercentage: 20,
    });
    const [coupon] = coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'AUTUMN' });
    couponCode = coupon.code;
  });

  test('attaching a coupon at reservation creation moves it AVAILABLE -> RESERVED and applies the discount', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    assert.equal(r.basePriceCents, 10000);
    assert.equal(r.discountCents, 2000);
    assert.equal(r.finalPriceCents, 8000);

    const coupon = coupons.getByCode(couponCode)!;
    assert.equal(coupon.status, 'RESERVED');
    assert.equal(coupon.reservationId, r.id);
  });

  test('a RESERVED coupon cannot be attached to a second reservation', () => {
    reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    assert.throws(
      () =>
        reservations.createAdvance({
          customer: { name: 'Sara', phone: '20999888' },
          reservationDate: TEST_DATE,
          startTime: '11:00',
          durationMin: 60,
          players: 1,
          couponCode,
        }),
      CouponConflictError
    );
  });

  test('Scan & Validate sees a RESERVED coupon as RESERVED, not AVAILABLE — and does not consume it', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    const result = coupons.validate(couponCode);
    assert.equal(result.outcome, 'RESERVED');
    if (result.outcome === 'RESERVED') {
      assert.equal(result.reservation.id, r.id);
    }
    // Still RESERVED after validation — scanning must never change status.
    assert.equal(coupons.getByCode(couponCode)!.status, 'RESERVED');
  });

  test('normal confirmUse() refuses a RESERVED coupon with a clear conflict message', () => {
    reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    assert.throws(() => coupons.confirmUse(couponCode, 'cashier1'), CouponConflictError);
    assert.equal(coupons.getByCode(couponCode)!.status, 'RESERVED', 'a failed confirmUse must not change status');
  });

  test('CEO-only override CAN consume a RESERVED coupon, releases it from the reservation, and is audited distinctly', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    const { coupon } = coupons.confirmUse(couponCode, 'ceo-override', { allowReservedOverride: true });
    assert.equal(coupon.status, 'USED');

    // The reservation itself is untouched in status, but its coupon link is
    // cleared since the coupon was taken from it, not consumed via payment.
    const reloaded = reservations.getById(r.id)!;
    assert.equal(reloaded.couponId, null);

    const auditLog = db
      .prepare(`SELECT * FROM audit_logs WHERE action = 'COUPON_RESERVED_OVERRIDE' AND entity_id = ?`)
      .get(coupon.id);
    assert.ok(auditLog, 'override use must be audited distinctly from a normal COUPON_USED entry');
  });

  test('cancelling a reservation releases its RESERVED coupon back to AVAILABLE', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    reservations.cancel(r.id, 'customer cancelled');
    assert.equal(coupons.getByCode(couponCode)!.status, 'AVAILABLE');
    assert.equal(coupons.getByCode(couponCode)!.reservationId, null);
  });

  test('a no-show also releases its RESERVED coupon back to AVAILABLE', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    reservations.noShow(r.id);
    assert.equal(coupons.getByCode(couponCode)!.status, 'AVAILABLE');
  });

  test('THE KEY RULE: markAsPaid atomically moves payment -> PAID and coupon RESERVED -> USED in one click', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    const paid = reservations.markAsPaid(r.id);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.ok(paid.paidAt);

    const coupon = coupons.getByCode(couponCode)!;
    assert.equal(coupon.status, 'USED', 'coupon must be consumed automatically — no separate "use coupon" step');

    // Exactly one usage_history row must exist for this coupon.
    const historyCount = (
      db.prepare(`SELECT COUNT(*) as c FROM usage_history WHERE coupon_id = ?`).get(coupon.id) as { c: number }
    ).c;
    assert.equal(historyCount, 1);
  });

  test('markAsPaid is idempotent-safe: a second attempt is rejected, not double-processed', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });
    reservations.markAsPaid(r.id);
    assert.throws(() => reservations.markAsPaid(r.id), ReservationConflictError);
  });

  test('ATOMICITY: if coupon consumption fails mid-payment, the payment status rolls back too (never PAID+RESERVED)', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });

    // Simulate a mid-transaction race: something external changes the
    // coupon's status directly (bypassing normal APIs) between reservation
    // creation and payment, so it's no longer RESERVED when
    // consumeForReservation() runs inside markAsPaid's transaction — while
    // the reservation record still points at it. This must cause the WHOLE
    // transaction (including the payment_status write) to roll back.
    db.prepare(`UPDATE coupons SET status = 'EXPIRED' WHERE code = ?`).run(couponCode);

    assert.throws(() => reservations.markAsPaid(r.id), CouponConflictError);

    const reloaded = reservations.getById(r.id)!;
    assert.equal(
      reloaded.paymentStatus,
      'UNPAID',
      'payment_status must have rolled back to UNPAID, not been left PAID with an inconsistent coupon state'
    );
    assert.equal(reloaded.paidAt, null);
  });

  test('a reservation with no coupon pays normally with no coupon side effects', () => {
    const r = reservations.createAdvance({
      customer: { name: 'NoCoupon Nadia', phone: '20111222' },
      reservationDate: TEST_DATE,
      startTime: '12:00',
      durationMin: 60,
      players: 1,
    });
    const paid = reservations.markAsPaid(r.id);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(paid.couponId, null);
  });

  test('attachCoupon / detachCoupon on an existing reservation before payment (players=2)', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 2,
    });
    assert.equal(r.couponId, null);
    assert.equal(r.basePriceCents, 20000, 'no coupon yet: per-player rate (10000) x 2 players');

    // The coupon's own campaign price (10000, from beforeEach) REPLACES the
    // per-player total (20000) — it does not stack on top of it.
    const withCoupon = reservations.attachCoupon(r.id, couponCode);
    assert.equal(withCoupon.couponId, coupons.getByCode(couponCode)!.id);
    assert.equal(withCoupon.basePriceCents, 10000, "base becomes the coupon's own package price, not 20000+discount");
    assert.equal(withCoupon.finalPriceCents, 8000);
    assert.equal(coupons.getByCode(couponCode)!.status, 'RESERVED');

    // Detaching restores the per-player total, not the coupon's package price.
    const detached = reservations.detachCoupon(r.id);
    assert.equal(detached.couponId, null);
    assert.equal(detached.basePriceCents, 20000, 'detach must restore the per-player rate x players, not leave the coupon price behind');
    assert.equal(detached.finalPriceCents, 20000);
    assert.equal(coupons.getByCode(couponCode)!.status, 'AVAILABLE');
  });

  test("a group-package coupon set at reservation creation is NOT multiplied by player count", () => {
    // A campaign the business configured specifically as a "2 players" deal
    // at 45 TND total — its own originalPriceCents must be used as-is.
    const sponsor2 = new SponsorService(db).create({ name: 'Group Deals Co' });
    const groupCampaign = new CampaignService(db).create({
      sponsorId: sponsor2.id, campaignName: '2-Player Package', serviceName: '1 Hour for 2',
      originalPrice: 45, discountPercentage: 10,
    });
    const groupCode = coupons.generateCodes({ campaignId: groupCampaign.id, count: 1, prefix: 'GRP2' })[0].code;

    const r = reservations.createAdvance({
      customer: { name: 'Sara', phone: '20999888' },
      reservationDate: TEST_DATE,
      startTime: '11:00',
      durationMin: 60,
      players: 2,
      couponCode: groupCode,
    });
    // NOT 10000 (per-player rate) x 2 = 20000 — the coupon's own 4500 wins.
    assert.equal(r.basePriceCents, 4500);
    assert.equal(r.finalPriceCents, 4050); // 4500 - 10%
  });

  test('cannot attach or detach a coupon on an already-paid reservation', () => {
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
    });
    reservations.markAsPaid(r.id);
    assert.throws(() => reservations.attachCoupon(r.id, couponCode), ReservationConflictError);
  });
});

describe('Coupon validity rules for reservations', () => {
  let db: Database.Database;
  let coupons: CouponService;
  let reservations: ReservationService;
  let couponId: number;
  let code: string;

  beforeEach(() => {
    db = createTestDb();
    coupons = new CouponService(db);
    reservations = new ReservationService(db, coupons);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
    const sponsor = new SponsorService(db).create({ name: 'Beach Co' });
    const campaign = new CampaignService(db).create({
      sponsorId: sponsor.id, campaignName: 'Promo', serviceName: '1 Hour', originalPrice: 100, discountPercentage: 20,
    });
    const c = coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'V' })[0];
    couponId = c.id;
    code = c.code;
  });

  const book = (couponCode?: string) =>
    reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' },
      reservationDate: TEST_DATE,
      startTime: '10:00',
      durationMin: 60,
      players: 1,
      couponCode,
    });

  test('an already-expired coupon (even if not yet swept) cannot be reserved', () => {
    db.prepare(`UPDATE coupons SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(couponId);
    assert.throws(() => book(code), /expired/i);
    assert.equal(coupons.getById(couponId)!.status, 'AVAILABLE', 'failed attempt must not change the coupon');
    assert.equal(reservations.list().length, 0, 'the failed booking must roll back entirely');
  });

  test('a coupon that expires before the booking date is refused, one valid on that day is accepted', () => {
    const before = new Date(); before.setDate(before.getDate() + 3);
    db.prepare(`UPDATE coupons SET expires_at = ? WHERE id = ?`).run(before.toISOString(), couponId);
    assert.throws(() => book(code), /before the reservation date/);

    const after = new Date(`${TEST_DATE}T12:00:00`); after.setDate(after.getDate() + 5);
    db.prepare(`UPDATE coupons SET expires_at = ? WHERE id = ?`).run(after.toISOString(), couponId);
    assert.equal(book(code).couponId, couponId);
  });

  test('a RESERVED coupon cannot be revoked (single or bulk) — it would orphan the reservation', () => {
    const r = book(code);
    assert.throws(() => coupons.revoke(couponId, 'oops'), new RegExp(`reservation #${r.id}`));
    const bulk = coupons.revokeMany([couponId], 'oops');
    assert.equal(bulk.revoked.length, 0);
    assert.match(bulk.skipped[0].why, /reserved/);
    assert.equal(coupons.getById(couponId)!.status, 'RESERVED');
    // ...and the booking can still be paid normally.
    assert.equal(reservations.markAsPaid(r.id).paymentStatus, 'PAID');
  });
});

describe('Danger Zone reset with reservation data', () => {
  test('clears reservations, customers and history but keeps hours, periods and pricing rules', async () => {
    const { DangerZoneService } = await import('../../src/main/services/dangerZoneService');
    const db = createTestDb();
    const coupons = new CouponService(db);
    const reservations = new ReservationService(db, coupons);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
    const sponsor = new SponsorService(db).create({ name: 'Beach Co' });
    const campaign = new CampaignService(db).create({
      sponsorId: sponsor.id, campaignName: 'Promo', serviceName: '1 Hour', originalPrice: 100, discountPercentage: 20,
    });
    const code = coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'Z' })[0].code;
    const r = reservations.createAdvance({
      customer: { name: 'Amir', phone: '20123456' }, reservationDate: TEST_DATE, startTime: '10:00',
      durationMin: 60, players: 1, couponCode: code,
    });
    reservations.markAsPaid(r.id);

    const result = new DangerZoneService(db).resetAllData();
    assert.equal(result.reservationsRemoved, 1);
    assert.equal(result.customersRemoved, 1);

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
    for (const t of ['reservations', 'reservation_history', 'customers', 'coupons', 'campaigns', 'sponsors']) {
      assert.equal(count(t), 0, `${t} must be empty after reset`);
    }
    assert.equal(count('business_hours'), 7, 'business hours are configuration and must survive');
    assert.equal(count('periods'), 4, 'periods must survive');
    assert.equal(count('pricing_rules'), 1, 'pricing rules must survive');
  });
});
