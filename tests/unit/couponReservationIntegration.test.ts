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

/** Shared fixture: 30 TND/player pricing, a sponsor, and a helper to mint a
 * coupon with a given coverage (defaults to 1) and discount (defaults 50%),
 * matching the user's own A1-style example throughout. */
function setupFixture() {
  const db = createTestDb();
  const coupons = new CouponService(db);
  const reservations = new ReservationService(db, coupons);
  new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 3000 }); // 30 TND/player
  const sponsor = new SponsorService(db).create({ name: 'Beach Co' });
  const campaigns = new CampaignService(db);

  const makeCoupon = (coveragePlayers = 1, discountPercentage = 50, prefix = 'CPN') => {
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: `${coveragePlayers}-Player Coupon`,
      serviceName: '1 Hour Board',
      originalPrice: 30, // display-only now — never used in reservation pricing math
      discountPercentage,
      coveragePlayers,
    });
    return coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix })[0].code;
  };

  return { db, coupons, reservations, sponsor, campaigns, makeCoupon };
}

// ============================================================================
// PRICE TESTS — covered exhaustively in reservationService.test.ts's
// "Per-player pricing" suite (1/2/3/4 players x 30 TND/player). Not repeated
// here; this file focuses on coupon coverage math layered on top.
// ============================================================================

describe('COUPON COVERAGE — discount applies only to the covered slice, never the whole reservation', () => {
  test('4 players + 1-player coupon (50% off): eligible=30, discount=15, total=105', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00',
      durationMin: 60, players: 4, couponCode: code,
    });
    assert.equal(r.basePriceCents, 12000); // 4 x 3000
    assert.equal(r.discountCents, 1500); // 1 x 3000 x 50%
    assert.equal(r.finalPriceCents, 10500); // NEVER 12000 x 50% = 6000
  });

  test('4 players + 2-player coupon (50% off): eligible=60, discount=30, total=90', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00',
      durationMin: 60, players: 4, couponCode: code,
    });
    assert.equal(r.discountCents, 3000);
    assert.equal(r.finalPriceCents, 9000);
  });

  test('4 players + 3-player coupon (50% off): eligible=90, discount=45, total=75', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(3, 50);
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00',
      durationMin: 60, players: 4, couponCode: code,
    });
    assert.equal(r.discountCents, 4500);
    assert.equal(r.finalPriceCents, 7500);
  });

  test('4 players + 4-player coupon (50% off): eligible=120, discount=60, total=60', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00',
      durationMin: 60, players: 4, couponCode: code,
    });
    assert.equal(r.discountCents, 6000);
    assert.equal(r.finalPriceCents, 6000);
  });

  test("the A1 example exactly: 30 TND coupon, 50% off, used on a 4-player booking must NOT discount the full 120 TND", () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50); // "A1": covers 1 player, 50% off
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00',
      durationMin: 60, players: 4, couponCode: code,
    });
    assert.notEqual(r.finalPriceCents, 6000, 'must never be 120 x 50%');
    assert.equal(r.finalPriceCents, 10500);
  });
});

describe('PARTIAL USAGE — a multi-player coupon can be used across separate reservations', () => {
  test('2-player coupon: use 1 -> remaining 1; use 1 again -> remaining 0; a third attempt is rejected', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const couponId = coupons.getByCode(code)!.id;

    const r1 = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 1);
    assert.equal(r1.discountCents, 1500); // 1 unit x 3000 x 50%

    const r2 = reservations.createAdvance({ customer: { name: 'B', phone: '2' }, reservationDate: TEST_DATE, startTime: '10:00', durationMin: 60, players: 1, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0);
    assert.equal(r2.discountCents, 1500);

    assert.throws(
      () => reservations.createAdvance({ customer: { name: 'C', phone: '3' }, reservationDate: TEST_DATE, startTime: '11:00', durationMin: 60, players: 1, couponCode: code }),
      CouponConflictError
    );
  });

  test('2-player coupon used for all 2 players in ONE reservation fully consumes it immediately', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const couponId = coupons.getByCode(code)!.id;
    reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0);
  });

  test('4-player coupon: 1+1+1+1 across four separate reservations', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const couponId = coupons.getByCode(code)!.id;
    const times = ['09:00', '10:00', '11:00', '12:00'];
    for (const t of times) {
      reservations.createAdvance({ customer: { name: `P-${t}`, phone: t }, reservationDate: TEST_DATE, startTime: t, durationMin: 60, players: 1, couponCode: code });
    }
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0);
    assert.throws(() =>
      reservations.createAdvance({ customer: { name: 'Overflow', phone: '99' }, reservationDate: TEST_DATE, startTime: '13:00', durationMin: 60, players: 1, couponCode: code })
    );
  });

  test('4-player coupon: 2+2 across two reservations', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const couponId = coupons.getByCode(code)!.id;
    reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 2);
    reservations.createAdvance({ customer: { name: 'B', phone: '2' }, reservationDate: TEST_DATE, startTime: '10:00', durationMin: 60, players: 2, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0);
  });

  test('4-player coupon: 1+3 across two reservations', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const couponId = coupons.getByCode(code)!.id;
    reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 3);
    reservations.createAdvance({ customer: { name: 'B', phone: '2' }, reservationDate: TEST_DATE, startTime: '10:00', durationMin: 60, players: 3, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0);
  });

  test('a coupon with MORE coverage than a reservation has players is capped, not rejected (partial grant)', () => {
    // A 4-player coupon attached to a 2-player booking should only consume
    // 2 units of coverage, leaving 2 remaining for a future booking — this
    // is the "assign a 4-player coupon to 2 players" case: the system caps
    // it rather than ever discounting more than this reservation's players.
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const couponId = coupons.getByCode(code)!.id;
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2, couponCode: code });
    assert.equal(r.discountCents, 3000); // 2 units x 3000 x 50%, not 4 units
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 2);
  });
});

describe('MULTIPLE COUPONS on one reservation', () => {
  test('4 players + two different 1-player coupons: each discounts independently, no double-counting', () => {
    const { reservations, makeCoupon } = setupFixture();
    const codeA = makeCoupon(1, 50, 'A1');
    const codeB = makeCoupon(1, 50, 'B1');
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4, couponCode: codeA,
    });
    const attached = reservations.attachCoupon(r.id, codeB);
    assert.equal(attached.discountCents, 3000); // 1500 + 1500
    assert.equal(attached.finalPriceCents, 9000); // 12000 - 3000
  });

  test('a second coupon can only cover players not already covered by the first', () => {
    const { reservations, makeCoupon } = setupFixture();
    const codeA = makeCoupon(4, 50, 'A4'); // covers all 4 by itself
    const codeB = makeCoupon(1, 50, 'B1');
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4, couponCode: codeA,
    });
    assert.equal(r.discountCents, 6000); // all 4 players covered
    // No uncovered players remain, so attaching a second coupon must be rejected.
    assert.throws(() => reservations.attachCoupon(r.id, codeB), ReservationConflictError);
  });

  test('getPriceBreakdown lists one line per coupon, matching Part 10 of the spec', () => {
    const { reservations, makeCoupon } = setupFixture();
    const codeA = makeCoupon(1, 50, 'A1');
    const codeB = makeCoupon(2, 50, 'A2');
    const r = reservations.createAdvance({
      customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4, couponCode: codeA,
    });
    reservations.attachCoupon(r.id, codeB);
    const breakdown = reservations.getPriceBreakdown(r.id);
    assert.equal(breakdown.subtotalCents, 12000);
    assert.equal(breakdown.coupons.length, 2);
    assert.equal(breakdown.coupons[0].eligibleAmountCents, 3000);
    assert.equal(breakdown.coupons[0].discountCents, 1500);
    assert.equal(breakdown.coupons[1].eligibleAmountCents, 6000);
    assert.equal(breakdown.coupons[1].discountCents, 3000);
    assert.equal(breakdown.totalDiscountCents, 4500);
    assert.equal(breakdown.finalPriceCents, 7500);
    assert.equal(breakdown.uncoveredPlayers, 1); // 4 - 1 - 2
  });
});

describe('SECURITY / ANTI-FRAUD', () => {
  test('a fully consumed coupon cannot be reused', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    reservations.markAsPaid(r.id); // RESERVED -> CONSUMED, 0 remaining
    assert.throws(() =>
      reservations.createAdvance({ customer: { name: 'B', phone: '2' }, reservationDate: TEST_DATE, startTime: '10:00', durationMin: 60, players: 1, couponCode: code })
    );
  });

  test('remaining coverage can never go negative no matter how many attempts are made', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const couponId = coupons.getByCode(code)!.id;
    reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2, couponCode: code });
    for (let i = 0; i < 5; i++) {
      assert.throws(() =>
        reservations.createAdvance({ customer: { name: `X${i}`, phone: `${i}` }, reservationDate: TEST_DATE, startTime: `1${i}:00`, durationMin: 60, players: 1, couponCode: code })
      );
    }
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 0, 'never negative, never re-grantable');
  });

  test('the same coupon cannot be attached twice to the same reservation (even with uncovered players remaining)', () => {
    // coverage=2 on a 4-player reservation leaves 2 players uncovered, so a
    // RE-attach attempt isn't blocked by "all players covered" — it must be
    // blocked specifically because this exact coupon is already attached.
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4, couponCode: code });
    assert.throws(() => reservations.attachCoupon(r.id, code), CouponConflictError);
  });

  test('a coupon whose coverage exactly matches all remaining uncovered players, attached again, is blocked by the reservation-level guard instead', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(4, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4, couponCode: code });
    assert.throws(() => reservations.attachCoupon(r.id, code), ReservationConflictError);
  });

  test('an expired coupon cannot be used, even if not yet swept', () => {
    const { db, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    db.prepare(`UPDATE coupons SET expires_at = '2020-01-01T00:00:00.000Z' WHERE code = ?`).run(code);
    assert.throws(() =>
      reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code })
    );
  });

  test('a revoked coupon cannot be used', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    coupons.revoke(coupons.getByCode(code)!.id, 'fraud');
    assert.throws(() =>
      reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code })
    );
  });

  test('a RESERVED coupon cannot be revoked — it would orphan the reservation', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.throws(() => coupons.revoke(coupons.getByCode(code)!.id, 'oops'));
  });

  test('Scan & Validate shows a RESERVED coupon as RESERVED (never AVAILABLE) and never consumes it on scan', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'Amir', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    const result = coupons.validate(code);
    assert.equal(result.outcome, 'RESERVED');
    if (result.outcome === 'RESERVED') {
      assert.equal(result.reservations.length, 1);
      assert.equal(result.reservations[0].id, r.id);
    }
    assert.equal(coupons.getByCode(code)!.status, 'RESERVED', 'scanning must never change status');
  });

  test('normal confirmUse() refuses a RESERVED coupon; CEO override consumes it and is audited distinctly', () => {
    const { coupons, db, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    reservations.createAdvance({ customer: { name: 'Amir', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.throws(() => coupons.confirmUse(code, 'cashier1'), CouponConflictError);

    const { coupon } = coupons.confirmUse(code, 'ceo', { allowReservedOverride: true });
    assert.equal(coupon.status, 'USED');
    const auditRow = db.prepare(`SELECT * FROM audit_logs WHERE action = 'COUPON_RESERVED_OVERRIDE'`).get();
    assert.ok(auditRow, 'override must be audited distinctly');
  });

  test('an invalid/unknown coupon code is rejected at reservation creation', () => {
    const { reservations } = setupFixture();
    assert.throws(() =>
      reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: 'NOPE-404' })
    );
  });

  test('SELF-HEALING: if a coupon is released behind the reservation\'s back before payment, markAsPaid charges the correct (non-discounted) amount instead of trusting a stale cached total', () => {
    const { db, coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.equal(r.finalPriceCents, 1500); // 3000 - 50%

    // Simulate an external release the reservation's own cached columns
    // don't yet know about.
    db.prepare(`UPDATE coupon_redemptions SET status = 'RELEASED' WHERE coupon_id = ?`).run(coupons.getByCode(code)!.id);

    const paid = reservations.markAsPaid(r.id);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(paid.discountCents, 0, 'the stale discount must not be charged');
    assert.equal(paid.finalPriceCents, 3000, 'full per-player price once the coupon is no longer actually applied');
  });

  test('ATOMICITY still holds: a genuinely attached coupon is always consumed in the SAME transaction as the payment, never left RESERVED on a PAID reservation', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    reservations.markAsPaid(r.id);
    assert.equal(coupons.getByCode(code)!.status, 'USED');
    assert.notEqual(coupons.getByCode(code)!.status, 'RESERVED');
  });
});

describe('RESERVATION FLOWS', () => {
  test('Walk-in with no coupon', () => {
    const { reservations } = setupFixture();
    const r = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2 });
    assert.equal(r.couponId, null);
    assert.equal(r.finalPriceCents, 6000);
  });

  test('Walk-in with a coupon', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2, couponCode: code });
    assert.equal(r.discountCents, 1500);
  });

  test('Advance reservation with a coupon, then markAsPaid consumes it atomically', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    const paid = reservations.markAsPaid(r.id);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(coupons.getByCode(code)!.status, 'USED');
  });

  test('Cancelling a reservation with a RESERVED coupon releases its coverage back', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(2, 50);
    const couponId = coupons.getByCode(code)!.id;
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 1);
    reservations.cancel(r.id, 'changed plans');
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 2, 'fully released');
  });

  test('A no-show also releases coverage', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const couponId = coupons.getByCode(code)!.id;
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    reservations.noShow(r.id);
    assert.equal(coupons.coverageState(couponId).remainingCoverage, 1);
  });

  test('the correct reservation owner can still pay and consume their reserved coupon after it was validated (not used) at Scan & Validate', () => {
    const { coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'Amir', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    coupons.validate(code); // staff checks it at the counter — must not consume
    const paid = reservations.markAsPaid(r.id);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(coupons.getByCode(code)!.status, 'USED');
  });

  test('optional participant names: a reservation works with none, some, or all named', () => {
    const { reservations } = setupFixture();
    const r = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4 });
    assert.deepEqual(reservations.listParticipants(r.id), []); // none named — perfectly valid

    const named = reservations.setParticipants(r.id, ['Ahmed', null, 'Ali', null]);
    assert.equal(named.length, 4);
    assert.equal(named[0].name, 'Ahmed');
    assert.equal(named[1].name, null);
  });

  test('a coupon can be assigned to a specific named participant', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const r = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2 });
    const participants = reservations.setParticipants(r.id, ['Ahmed', 'Mohamed']);
    reservations.attachCoupon(r.id, code, null, { participantId: participants[0].id });
    const breakdown = reservations.getPriceBreakdown(r.id);
    assert.equal(breakdown.coupons[0].participantName, 'Ahmed');
  });

  test('cannot name more participants than the reservation has players', () => {
    const { reservations } = setupFixture();
    const r = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 2 });
    assert.throws(() => reservations.setParticipants(r.id, ['A', 'B', 'C']));
  });

  test('rejects a booking that would exceed slot capacity even with a coupon attached', () => {
    const { reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 4 });
    assert.throws(() =>
      reservations.createWalkIn({ customer: { name: 'B', phone: '2' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code })
    );
  });

  test('rescheduling a reservation to a new date transfers its coupon and reprices it at the new rate', () => {
    const { db, coupons, reservations, makeCoupon } = setupFixture();
    const code = makeCoupon(1, 50);
    const couponId = coupons.getByCode(code)!.id;
    const r = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    reservations.checkIn(r.id);

    const newDate = futureSunday(21);
    new PricingService(db).create({ name: 'Special day rate', weekdayMask: 127, durationMin: 60, priceCents: 5000, priority: 10 });
    const moved = reservations.rescheduleToAdvance({ reservationId: r.id, reservationDate: newDate, startTime: '09:00', durationMin: 60 });
    assert.equal(coupons.coverageState(couponId).activeRedemptions.length, 1);
    assert.equal(coupons.coverageState(couponId).activeRedemptions[0].reservationId, moved.id);
    assert.equal(moved.discountCents, 2500); // repriced at the new, higher-priority 5000/player rate: 5000 x 50%
    assert.equal(reservations.getById(r.id)!.status, 'CANCELLED');
  });
});

describe('Danger Zone reset with reservation + coverage data', () => {
  test('clears reservations, customers, participants and the redemption ledger, keeps booking configuration', async () => {
    const { db, reservations, makeCoupon } = setupFixture();
    const { DangerZoneService } = await import('../../src/main/services/dangerZoneService');
    const code = makeCoupon(2, 50);
    const r = reservations.createAdvance({ customer: { name: 'Amir', phone: '1' }, reservationDate: TEST_DATE, startTime: '09:00', durationMin: 60, players: 1, couponCode: code });
    reservations.setParticipants(r.id, ['Amir']);
    reservations.markAsPaid(r.id);

    const result = new DangerZoneService(db).resetAllData();
    assert.equal(result.reservationsRemoved, 1);

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
    for (const t of ['reservations', 'reservation_participants', 'coupon_redemptions', 'customers', 'coupons', 'campaigns', 'sponsors']) {
      assert.equal(count(t), 0, `${t} must be empty after reset`);
    }
    assert.equal(count('business_hours'), 7);
    assert.equal(count('pricing_rules'), 1);
  });
});
