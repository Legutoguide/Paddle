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

// A minimal valid 1x1 PNG (real bytes, not a placeholder string) for tests
// that need a genuinely readable image file on disk.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function writeTinyPng(dir: string, name: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return p;
}

describe('pdfService — sponsor logo / campaign banner embedding', () => {
  test('PDF generates successfully with a real sponsor logo and campaign banner embedded', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-pdf-images-'));
    const logoPath = writeTinyPng(tmpDir, 'logo.png');
    const bannerPath = writeTinyPng(tmpDir, 'banner.png');

    const db = createTestDb();
    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    const coupons = new CouponService(db);

    const sponsor = sponsors.create({ name: 'Adam', logoPath });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
      bannerPath,
    });
    coupons.generateCodes({ campaignId: campaign.id, count: 2, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });

    // Confirm the data actually carries the image paths through to the PDF layer.
    assert.equal(items[0].sponsorLogoPath, logoPath);
    assert.equal(items[0].campaignBannerPath, bannerPath);

    const outPath = path.join(tmpDir, 'with-images.pdf');
    await exportCouponsToPdf(items, outPath, { businessName: 'My Business', currency: 'TND', orgLogoPath: logoPath });

    const buffer = fs.readFileSync(outPath);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('PDF generation never breaks when image paths point to missing files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-pdf-missing-'));
    const db = createTestDb();
    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    const coupons = new CouponService(db);

    const sponsor = sponsors.create({ name: 'Adam', logoPath: '/this/path/does/not/exist.png' });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
      bannerPath: '/also/missing/banner.png',
    });
    coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });

    const outPath = path.join(tmpDir, 'graceful-fallback.pdf');
    // Must not throw despite every referenced image being unreadable.
    await exportCouponsToPdf(items, outPath, {
      businessName: 'My Business',
      currency: 'TND',
      orgLogoPath: '/nonexistent/org-logo.png',
    });

    const buffer = fs.readFileSync(outPath);
    assert.ok(buffer.length > 500, 'PDF should still be generated with real content');
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('PDF generation never breaks when an image file exists but is corrupt/not a real image', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-pdf-corrupt-'));
    const corruptPath = path.join(tmpDir, 'corrupt.png');
    fs.writeFileSync(corruptPath, 'this is not a real png file, just text');

    const db = createTestDb();
    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    const coupons = new CouponService(db);

    const sponsor = sponsors.create({ name: 'Adam', logoPath: corruptPath });
    const campaign = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    });
    coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId: campaign.id });

    const outPath = path.join(tmpDir, 'corrupt-fallback.pdf');
    await exportCouponsToPdf(items, outPath, { businessName: 'My Business', currency: 'TND' });

    const buffer = fs.readFileSync(outPath);
    assert.ok(buffer.length > 500);
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });
});

