import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './testDb';
import { SettingsService } from '../../src/main/services/settingsService';

describe('SettingsService — organization & branding fields', () => {
  test('defaults are sensible and non-crashing on a fresh database', () => {
    const db = createTestDb();
    const settings = new SettingsService(db);
    const all = settings.getAll();
    assert.equal(all.country, '');
    assert.equal(all.primaryColor, '#2196f3');
    assert.equal(all.logoPath, null);
    assert.ok(all.timezone.length > 0);
  });

  test('organization settings fields persist correctly', () => {
    const db = createTestDb();
    const settings = new SettingsService(db);
    settings.update({
      country: 'Tunisia',
      phone: '+216 12 345 678',
      email: 'contact@example.com',
      website: 'https://example.com',
      address: '123 Main St, Tunis',
      businessHours: '9am - 6pm',
      facebookUrl: 'https://facebook.com/example',
    });
    const all = settings.getAll();
    assert.equal(all.country, 'Tunisia');
    assert.equal(all.phone, '+216 12 345 678');
    assert.equal(all.address, '123 Main St, Tunis');
  });

  test('branding fields (colors, banners) persist correctly', () => {
    const db = createTestDb();
    const settings = new SettingsService(db);
    settings.update({
      primaryColor: '#ff0000',
      secondaryColor: '#00ff00',
      coverBannerPath: '/path/to/cover.png',
      dashboardBannerPath: '/path/to/dashboard.png',
      footerContactInfo: 'Call us: 123456',
    });
    const all = settings.getAll();
    assert.equal(all.primaryColor, '#ff0000');
    assert.equal(all.coverBannerPath, '/path/to/cover.png');
    assert.equal(all.footerContactInfo, 'Call us: 123456');
  });

  test('setting a nullable path field to null actually clears it (not the literal string "null")', () => {
    const db = createTestDb();
    const settings = new SettingsService(db);
    settings.update({ logoPath: '/some/logo.png' });
    assert.equal(settings.getAll().logoPath, '/some/logo.png');

    settings.update({ logoPath: null });
    assert.equal(settings.getAll().logoPath, null);
  });

  test('updating settings is audited', () => {
    const db = createTestDb();
    const settings = new SettingsService(db);
    settings.update({ country: 'Tunisia' });
    const auditRows = db.prepare(`SELECT * FROM audit_logs WHERE action = 'SETTINGS_UPDATED'`).all();
    assert.equal(auditRows.length, 1);
  });
});

