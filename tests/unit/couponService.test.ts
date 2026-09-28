import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService, CouponConflictError } from '../../src/main/services/couponService';
import { fromCents } from '../../src/shared/lib/pricing';

describe('CouponService — full lifecycle (Adam / Summer Promotion scenario)', () => {
  let db: Database.Database;
  let sponsors: SponsorService;
  let campaigns: CampaignService;
  let coupons: CouponService;
  let campaignId: number;

  beforeEach(() => {
    db = createTestDb();
    sponsors = new SponsorService(db);
    campaigns = new CampaignService(db);
    coupons = new CouponService(db);

    const sponsor = sponsors.create({ name: 'Adam' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    });
    campaignId = campaign.id;
  });

  test('generates exactly 10 unique codes for 10 requested', () => {
    const generated = coupons.generateCodes({ campaignId, count: 10, prefix: 'ADAM' });
    assert.equal(generated.length, 10);
    assert.equal(new Set(generated.map((c) => c.code)).size, 10);
    for (const c of generated) {
      assert.match(c.code, /^ADAM-[A-Z0-9]{5}$/);
      assert.equal(c.status, 'AVAILABLE');
    }
  });

  test('campaign total_codes is updated after generation', () => {
    coupons.generateCodes({ campaignId, count: 10, prefix: 'ADAM' });
    const campaign = campaigns.getById(campaignId)!;
    assert.equal(campaign.totalCodes, 10);
  });

  test('validate() shows correct sponsor/price info without marking used', () => {
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    const result = coupons.validate(coupon.code);
    assert.equal(result.outcome, 'VALID');
    if (result.outcome === 'VALID') {
      assert.equal(result.coupon.sponsorName, 'Adam');
      assert.equal(result.coupon.campaignName, 'Summer Promotion');
      assert.equal(fromCents(result.coupon.originalPriceCents), 100);
      assert.equal(result.coupon.discountPercentage, 50);
      assert.equal(fromCents(result.coupon.finalPriceCents), 50);
    }
    // validating must NOT change status
    assert.equal(coupons.getByCode(coupon.code)!.status, 'AVAILABLE');
  });

  test('full flow: generate 10, use 1, verify used=1 available=9, reject reuse', () => {
    const generated = coupons.generateCodes({ campaignId, count: 10, prefix: 'ADAM' });
    const target = generated[3].code;

    const { usedAt } = coupons.confirmUse(target, 'cashier1');
    assert.ok(usedAt);

    const stats = campaigns.getStats(campaignId);
    assert.equal(stats.used, 1);
    assert.equal(stats.available, 9);
    assert.equal(stats.totalCodes, 10);

    // Second attempt on the exact same code MUST be rejected
    assert.throws(() => coupons.confirmUse(target, 'cashier2'), CouponConflictError);

    // validate() must now report USED, not VALID
    const revalidated = coupons.validate(target);
    assert.equal(revalidated.outcome, 'USED');
  });

  test('another available code from the same batch still works after one is used', () => {
    const generated = coupons.generateCodes({ campaignId, count: 10, prefix: 'ADAM' });
    coupons.confirmUse(generated[0].code);
    const result = coupons.validate(generated[1].code);
    assert.equal(result.outcome, 'VALID');
    coupons.confirmUse(generated[1].code); // should succeed without throwing
  });

  test('invalid / non-existent code is rejected', () => {
    const result = coupons.validate('DOES-NOTEXIST');
    assert.equal(result.outcome, 'INVALID');
  });

  test('revoked code cannot be used and reports REVOKED', () => {
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    coupons.revoke(coupon.id, 'Coupon lost');

    const result = coupons.validate(coupon.code);
    assert.equal(result.outcome, 'REVOKED');
    if (result.outcome === 'REVOKED') {
      assert.equal(result.reason, 'Coupon lost');
    }

    assert.throws(() => coupons.confirmUse(coupon.code), CouponConflictError);
  });

  test('expired code cannot be used and reports EXPIRED', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // yesterday
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM', expiresAt: past });

    const result = coupons.validate(coupon.code);
    assert.equal(result.outcome, 'EXPIRED');
    assert.throws(() => coupons.confirmUse(coupon.code), CouponConflictError);
  });

  test('cannot revoke an already-used coupon', () => {
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    coupons.confirmUse(coupon.code);
    assert.throws(() => coupons.revoke(coupon.id));
  });

  test('sweepExpired flips stale AVAILABLE coupons to EXPIRED', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    coupons.generateCodes({ campaignId, count: 3, prefix: 'ADAM', expiresAt: past });
    const changed = coupons.sweepExpired();
    assert.equal(changed, 3);
    const { items } = coupons.list({ campaignId });
    assert.ok(items.every((c) => c.status === 'EXPIRED'));
  });

  test('simulated concurrent confirmUse: only one of two near-simultaneous attempts succeeds', () => {
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });

    let successes = 0;
    let failures = 0;
    for (const attempt of [1, 2]) {
      try {
        coupons.confirmUse(coupon.code, `operator-${attempt}`);
        successes++;
      } catch (err) {
        if (err instanceof CouponConflictError) failures++;
        else throw err;
      }
    }
    assert.equal(successes, 1);
    assert.equal(failures, 1);
  });

  test('generateCodes rolls back entirely on failure (all-or-nothing batch)', () => {
    coupons.generateCodes({ campaignId, count: 5, prefix: 'ADAM' });
    const before = campaigns.getById(campaignId)!.totalCodes;
    assert.throws(() => coupons.generateCodes({ campaignId, count: -1, prefix: 'ADAM' }));
    const after = campaigns.getById(campaignId)!.totalCodes;
    assert.equal(before, after); // nothing changed
  });

  test('revokeMany skips already-used coupons and reports why', () => {
    const generated = coupons.generateCodes({ campaignId, count: 3, prefix: 'ADAM' });
    coupons.confirmUse(generated[0].code);
    const result = coupons.revokeMany(generated.map((c) => c.id), 'bulk cleanup');
    assert.equal(result.revoked.length, 2);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].why, 'already used');
  });
});
