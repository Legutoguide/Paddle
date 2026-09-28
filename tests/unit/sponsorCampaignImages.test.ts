import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';

describe('Sponsor / Campaign images', () => {
  let db: Database.Database;
  let sponsors: SponsorService;
  let campaigns: CampaignService;

  beforeEach(() => {
    db = createTestDb();
    sponsors = new SponsorService(db);
    campaigns = new CampaignService(db);
  });

  test('sponsor can be created with logo and photo paths', () => {
    const sponsor = sponsors.create({ name: 'Adam', logoPath: '/img/adam-logo.png', photoPath: '/img/adam-photo.jpg' });
    assert.equal(sponsor.logoPath, '/img/adam-logo.png');
    assert.equal(sponsor.photoPath, '/img/adam-photo.jpg');
  });

  test('sponsor without images gracefully defaults to null (no broken placeholder)', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    assert.equal(sponsor.logoPath, null);
    assert.equal(sponsor.photoPath, null);
  });

  test('sponsor images can be updated independently of other fields', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    const updated = sponsors.update(sponsor.id, { logoPath: '/img/new-logo.png' });
    assert.equal(updated.logoPath, '/img/new-logo.png');
    assert.equal(updated.name, 'Adam'); // untouched
  });

  test('campaign can be created with image and banner paths', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
      imagePath: '/img/campaign.png',
      bannerPath: '/img/banner.png',
    });
    assert.equal(campaign.imagePath, '/img/campaign.png');
    assert.equal(campaign.bannerPath, '/img/banner.png');
  });

  test('coupon list-with-details surfaces sponsor logo and campaign image for display', () => {
    const sponsor = sponsors.create({ name: 'Adam', logoPath: '/img/adam-logo.png' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
      imagePath: '/img/campaign.png',
    });
    const coupons = new CouponService(db);
    coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });
    assert.equal(items[0].sponsorLogoPath, '/img/adam-logo.png');
    assert.equal(items[0].campaignImagePath, '/img/campaign.png');
  });

  test('missing images never break coupon listing (graceful fallback to null)', () => {
    const sponsor = sponsors.create({ name: 'Adam' }); // no images
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    });
    const coupons = new CouponService(db);
    coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });
    assert.equal(items[0].sponsorLogoPath, null);
    assert.equal(items[0].campaignImagePath, null);
  });
});

