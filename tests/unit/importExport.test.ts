import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';
import { parseImportCsv, exportCouponsToCsv } from '../../src/main/services/csvService';

describe('CSV import/export', () => {
  let db: Database.Database;
  let coupons: CouponService;
  let campaignId: number;

  beforeEach(() => {
    db = createTestDb();
    const sponsors = new SponsorService(db);
    const campaigns = new CampaignService(db);
    coupons = new CouponService(db);
    const sponsor = sponsors.create({ name: 'Adam' });
    campaignId = campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    }).id;
  });

  test('parseImportCsv reports totals, valid, duplicate-in-file and invalid rows', () => {
    const csv = `code\nADAM-AAAAA\nADAM-BBBBB\nADAM-AAAAA\nnot valid!!\n`;
    const preview = parseImportCsv(csv, () => false);
    assert.equal(preview.totalRows, 4);
    assert.equal(preview.valid.length, 2);
    assert.equal(preview.duplicatesInFile.length, 1);
    assert.equal(preview.invalid.length, 1);
  });

  test('parseImportCsv flags codes that already exist in the database', () => {
    const csv = `code\nADAM-AAAAA\nADAM-BBBBB\n`;
    const existing = new Set(['ADAM-AAAAA']);
    const preview = parseImportCsv(csv, (code) => existing.has(code));
    assert.equal(preview.valid.length, 1);
    assert.equal(preview.alreadyExists.length, 1);
    assert.equal(preview.alreadyExists[0].code, 'ADAM-AAAAA');
  });

  test('never silently overwrites: importing a code that exists throws and rolls back', () => {
    coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    const existingCode = coupons.list({ campaignId }).items[0].code;
    assert.throws(() => coupons.importCodes(campaignId, [existingCode, 'ADAM-NEWNEW']));
    // second code must NOT have been inserted either (all-or-nothing)
    assert.equal(coupons.getByCode('ADAM-NEWNEW'), null);
  });

  test('successful import creates all provided codes and updates campaign total', () => {
    const created = coupons.importCodes(campaignId, ['ADAM-ZZZZZ', 'ADAM-YYYYY']);
    assert.equal(created.length, 2);
    const campaigns = new CampaignService(db);
    assert.equal(campaigns.getById(campaignId)!.totalCodes, 2);
  });

  test('exportCouponsToCsv includes header and one row per coupon', () => {
    coupons.generateCodes({ campaignId, count: 3, prefix: 'ADAM' });
    const { items } = coupons.list({ campaignId });
    const csv = exportCouponsToCsv(items, 'TND');
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 4); // header + 3 rows
    assert.match(lines[0], /Code/);
  });
});
