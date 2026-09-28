import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { BranchService, BranchValidationError, BranchInUseError } from '../../src/main/services/branchService';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';

describe('BranchService', () => {
  let db: Database.Database;
  let branches: BranchService;

  beforeEach(() => {
    db = createTestDb();
    branches = new BranchService(db);
  });

  test('creates and lists branches alphabetically', () => {
    branches.create({ name: 'Sousse' });
    branches.create({ name: 'Tunis' });
    const list = branches.list();
    assert.deepEqual(list.map((b) => b.name), ['Sousse', 'Tunis']);
  });

  test('rejects empty and duplicate branch names', () => {
    branches.create({ name: 'Tunis' });
    assert.throws(() => branches.create({ name: '  ' }), BranchValidationError);
    assert.throws(() => branches.create({ name: 'Tunis' }), BranchValidationError);
  });

  test('coupons can be generated tagged with a branch', () => {
    const branch = branches.create({ name: 'Tunis' });
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
    });
    const generated = coupons.generateCodes({ campaignId: campaign.id, count: 3, prefix: 'ADAM', branchId: branch.id });
    assert.ok(generated.every((c) => c.branchId === branch.id));

    const filtered = coupons.list({ branchId: branch.id });
    assert.equal(filtered.total, 3);
  });

  test('cannot delete a branch that has coupons tagged with it', () => {
    const branch = branches.create({ name: 'Tunis' });
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
    });
    coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM', branchId: branch.id });
    assert.throws(() => branches.delete(branch.id), BranchInUseError);
  });

  test('can delete an unused branch', () => {
    const branch = branches.create({ name: 'Tunis' });
    branches.delete(branch.id);
    assert.equal(branches.list().length, 0);
  });

  test('coupons without a branch remain untagged (null), never forced into a default branch', () => {
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
    });
    const generated = coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'ADAM' });
    assert.equal(generated[0].branchId, null);
  });
});

