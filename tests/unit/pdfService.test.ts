import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';
import { exportCouponsToPdf } from '../../src/main/services/pdfService';

describe('pdfService', () => {
  test('produces a real, non-empty, valid PDF file for a batch of coupons', async () => {
    const db = createTestDb();
    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    const coupons = new CouponService(db);
    const sponsor = sponsors.create({ name: 'Adam' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
      endDate: '2026-09-30',
    });
    coupons.generateCodes({ campaignId: campaign.id, count: 7, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });

    const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-')), 'coupons.pdf');
    await exportCouponsToPdf(items, outPath, { businessName: 'My Business', currency: 'TND' });

    assert.ok(fs.existsSync(outPath));
    const buffer = fs.readFileSync(outPath);
    assert.ok(buffer.length > 1000, 'PDF should have real content, not be near-empty');
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(buffer.subarray(-6).toString('ascii').trim().endsWith('EOF'), true);
  });
});
