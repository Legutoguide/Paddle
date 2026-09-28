import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService, CampaignValidationError, CampaignHasCodesError } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';
import { fromCents } from '../../src/shared/lib/pricing';

describe('CampaignService', () => {
  let db: Database.Database;
  let sponsors: SponsorService;
  let campaigns: CampaignService;
  let sponsorId: number;

  beforeEach(() => {
    db = createTestDb();
    sponsors = new SponsorService(db);
    campaigns = new CampaignService(db);
    sponsorId = sponsors.create({ name: 'Adam' }).id;
  });

  test('automatically calculates final price from percentage discount', () => {
    const campaign = campaigns.create({
      sponsorId,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    });
    assert.equal(fromCents(campaign.finalPriceCents), 50);
  });

  test('never hardcodes a specific discount amount; recalculates per input', () => {
    const c1 = campaigns.create({
      sponsorId,
      campaignName: 'A',
      serviceName: 'X',
      originalPrice: 100,
      discountPercentage: 30,
    });
    const c2 = campaigns.create({
      sponsorId,
      campaignName: 'B',
      serviceName: 'X',
      originalPrice: 80,
      discountPercentage: 25,
    });
    assert.equal(fromCents(c1.finalPriceCents), 70);
    assert.equal(fromCents(c2.finalPriceCents), 60);
  });

  test('rejects campaign for unknown sponsor', () => {
    assert.throws(() =>
      campaigns.create({
        sponsorId: 9999,
        campaignName: 'X',
        serviceName: 'Y',
        originalPrice: 10,
        discountPercentage: 10,
      })
    );
  });

  test('rejects start date after end date', () => {
    assert.throws(
      () =>
        campaigns.create({
          sponsorId,
          campaignName: 'X',
          serviceName: 'Y',
          originalPrice: 10,
          discountPercentage: 10,
          startDate: '2026-09-30',
          endDate: '2026-09-01',
        }),
      CampaignValidationError
    );
  });

  test('update recalculates final price', () => {
    const campaign = campaigns.create({
      sponsorId,
      campaignName: 'X',
      serviceName: 'Y',
      originalPrice: 100,
      discountPercentage: 10,
    });
    const updated = campaigns.update(campaign.id, { discountPercentage: 20 });
    assert.equal(fromCents(updated.finalPriceCents), 80);
  });

  test('cannot permanently delete a campaign that has generated codes', () => {
    const campaign = campaigns.create({
      sponsorId,
      campaignName: 'X',
      serviceName: 'Y',
      originalPrice: 100,
      discountPercentage: 10,
    });
    const coupons = new CouponService(db);
    coupons.generateCodes({ campaignId: campaign.id, count: 3, prefix: 'X' });
    assert.throws(() => campaigns.deletePermanently(campaign.id), CampaignHasCodesError);
  });
});
