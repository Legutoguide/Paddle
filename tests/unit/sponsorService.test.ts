import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService, SponsorValidationError, SponsorHasHistoryError } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';

describe('SponsorService', () => {
  let db: Database.Database;
  let sponsors: SponsorService;

  beforeEach(() => {
    db = createTestDb();
    sponsors = new SponsorService(db);
  });

  test('creates a sponsor', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    assert.equal(sponsor.name, 'Adam');
    assert.equal(sponsor.status, 'ACTIVE');
  });

  test('rejects empty sponsor name', () => {
    assert.throws(() => sponsors.create({ name: '   ' }), SponsorValidationError);
  });

  test('lists sponsors alphabetically', () => {
    sponsors.create({ name: 'Zeta' });
    sponsors.create({ name: 'Adam' });
    const list = sponsors.list();
    assert.deepEqual(list.map((s) => s.name), ['Adam', 'Zeta']);
  });

  test('archive sets status and archived_at, unarchive reverses it', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    const archived = sponsors.archive(sponsor.id);
    assert.equal(archived.status, 'ARCHIVED');
    assert.ok(archived.archivedAt);

    const restored = sponsors.unarchive(sponsor.id);
    assert.equal(restored.status, 'ACTIVE');
    assert.equal(restored.archivedAt, null);
  });

  test('permanently deleting a sponsor with campaigns is refused', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    const campaigns = new CampaignService(db);
    campaigns.create({
      sponsorId: sponsor.id,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    });

    assert.throws(() => sponsors.deletePermanently(sponsor.id), SponsorHasHistoryError);
  });

  test('permanently deleting a sponsor with no campaigns succeeds', () => {
    const sponsor = sponsors.create({ name: 'Adam' });
    sponsors.deletePermanently(sponsor.id);
    assert.equal(sponsors.getById(sponsor.id), null);
  });

  test('search filters by partial, case-insensitive name', () => {
    sponsors.create({ name: 'Adam Motors' });
    sponsors.create({ name: 'Zenith Cafe' });
    const result = sponsors.list({ search: 'adam' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Adam Motors');
  });
});
