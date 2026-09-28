import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';
import { CouponService } from '../../src/main/services/couponService';
import { BatchService } from '../../src/main/services/batchService';
import { NotificationService } from '../../src/main/services/notificationService';
import { SessionLogService } from '../../src/main/services/sessionLogService';
import { DangerZoneService } from '../../src/main/services/dangerZoneService';

describe('Batches, notifications, session logs, danger zone', () => {
  let db: Database.Database;
  let sponsors: SponsorService;
  let campaigns: CampaignService;
  let coupons: CouponService;
  let batches: BatchService;
  let notifications: NotificationService;
  let campaignId: number;
  let sponsorId: number;

  beforeEach(() => {
    db = createTestDb();
    sponsors = new SponsorService(db);
    campaigns = new CampaignService(db);
    coupons = new CouponService(db);
    batches = new BatchService(db);
    notifications = new NotificationService(db);

    const sponsor = sponsors.create({ name: 'Adam' });
    sponsorId = sponsor.id;
    campaignId = campaigns.create({
      sponsorId,
      campaignName: 'Summer Promotion',
      serviceName: '1 Hour',
      originalPrice: 100,
      discountPercentage: 50,
    }).id;
  });

  test('generating codes creates a real batch record with a unique batch code', () => {
    const generated = coupons.generateCodes({ campaignId, count: 10, prefix: 'ADAM' });
    assert.equal(generated.length, 10);
    assert.ok(generated[0].batchId, 'coupon must be stamped with a batch id');

    const list = batches.list({ campaignId });
    assert.equal(list.length, 1);
    assert.match(list[0].batchCode, /^B-\d{4}-\d{4}$/);
    assert.equal(list[0].quantity, 10);
    assert.equal(list[0].available, 10);
  });

  test('two separate generation calls create two separate batches, each with correct counts', () => {
    coupons.generateCodes({ campaignId, count: 5, prefix: 'ADAM' });
    coupons.generateCodes({ campaignId, count: 3, prefix: 'ADAM' });
    const list = batches.list({ campaignId });
    assert.equal(list.length, 2);
    assert.equal(list.reduce((sum, b) => sum + b.quantity, 0), 8);
  });

  test('batch counters reflect real coupon status after usage', () => {
    const generated = coupons.generateCodes({ campaignId, count: 4, prefix: 'ADAM' });
    coupons.confirmUse(generated[0].code);
    const list = batches.list({ campaignId });
    assert.equal(list[0].used, 1);
    assert.equal(list[0].available, 3);
  });

  test('generating codes emits a real BATCH_GENERATED notification', () => {
    coupons.generateCodes({ campaignId, count: 6, prefix: 'ADAM' });
    const list = notifications.list();
    const found = list.find((n) => n.type === 'BATCH_GENERATED');
    assert.ok(found, 'a BATCH_GENERATED notification must exist');
    assert.match(found!.message, /6 code/);
  });

  test('redeeming a coupon emits a real QR_REDEEMED notification', () => {
    const [coupon] = coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    coupons.confirmUse(coupon.code);
    const found = notifications.list().find((n) => n.type === 'QR_REDEEMED');
    assert.ok(found);
    assert.match(found!.message, new RegExp(coupon.code));
  });

  test('creating a campaign emits a CAMPAIGN_CREATED notification', () => {
    campaigns.create({
      sponsorId,
      campaignName: 'Another Campaign',
      serviceName: 'X',
      originalPrice: 10,
      discountPercentage: 10,
    });
    const found = notifications.list().find((n) => n.type === 'CAMPAIGN_CREATED' && n.message.includes('Another Campaign'));
    assert.ok(found);
  });

  test('notifications: unread count, markRead and markAllRead behave correctly', () => {
    notifications.clearAll(); // start from a clean slate (beforeEach's campaign creation already emitted one)
    coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    coupons.generateCodes({ campaignId, count: 1, prefix: 'ADAM' });
    assert.equal(notifications.unreadCount(), 2);

    const [first] = notifications.list();
    notifications.markRead(first.id);
    assert.equal(notifications.unreadCount(), 1);

    notifications.markAllRead();
    assert.equal(notifications.unreadCount(), 0);
  });

  test('checkExpiringCampaigns only notifies once per campaign even if called repeatedly', () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    campaigns.create({
      sponsorId,
      campaignName: 'Expiring Soon',
      serviceName: 'X',
      originalPrice: 10,
      discountPercentage: 10,
      endDate: soon,
    });

    notifications.checkExpiringCampaigns(3);
    notifications.checkExpiringCampaigns(3);
    notifications.checkExpiringCampaigns(3);

    const matches = notifications.list().filter((n) => n.type === 'CAMPAIGN_EXPIRING');
    assert.equal(matches.length, 1, 'must not spam duplicate expiring notifications');
  });

  test('session logs record real app launches', () => {
    const sessionLogs = new SessionLogService(db);
    sessionLogs.record({ appVersion: '1.0.0', deviceName: 'test-machine', platform: 'linux' });
    sessionLogs.record({ appVersion: '1.0.0', deviceName: 'test-machine', platform: 'linux' });
    const list = sessionLogs.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].deviceName, 'test-machine');
  });

  test('danger zone reset wipes all business data and is itself audited', () => {
    coupons.generateCodes({ campaignId, count: 5, prefix: 'ADAM' });
    assert.equal(sponsors.list().length, 1);

    const dangerZone = new DangerZoneService(db);
    const result = dangerZone.resetAllData();

    assert.equal(result.sponsorsRemoved, 1);
    assert.equal(result.couponsRemoved, 5);
    assert.equal(sponsors.list().length, 0);
    assert.equal(campaigns.list().length, 0);
    assert.equal(coupons.list().items.length, 0);

    // The reset operation itself must be the sole, fresh audit entry.
    const auditRows = db.prepare(`SELECT * FROM audit_logs`).all() as any[];
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, 'DANGER_ZONE_RESET_ALL_DATA');
  });

  test('danger zone reset does not touch settings', () => {
    const { SettingsService } = require('../../src/main/services/settingsService');
    const settings = new SettingsService(db);
    settings.update({ businessName: 'My Real Business' });

    const dangerZone = new DangerZoneService(db);
    dangerZone.resetAllData();

    assert.equal(settings.getAll().businessName, 'My Real Business');
  });
});
