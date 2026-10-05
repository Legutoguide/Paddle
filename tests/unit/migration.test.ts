import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/main/db/connection';

describe('schema migration v1 -> v2 (batches / batch_id)', () => {
  test('an existing v1 database (no batch_id column) upgrades cleanly and keeps its data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-migrate-'));
    const dbPath = path.join(dir, 'legacy.db');

    // Build a v1-shaped database by hand (schema exactly as it shipped
    // before batches/notifications/session_logs existed).
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta (key, value) VALUES ('version', '1');

      CREATE TABLE sponsors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        archived_at TEXT
      );

      CREATE TABLE campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sponsor_id INTEGER NOT NULL,
        campaign_name TEXT NOT NULL,
        service_name TEXT NOT NULL,
        duration TEXT,
        discount_type TEXT NOT NULL DEFAULT 'PERCENTAGE',
        original_price_cents INTEGER NOT NULL,
        discount_percentage REAL NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        final_price_cents INTEGER NOT NULL,
        total_codes INTEGER NOT NULL DEFAULT 0,
        start_date TEXT, end_date TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        sponsor_id INTEGER NOT NULL,
        code TEXT NOT NULL UNIQUE,
        display_seq INTEGER,
        status TEXT NOT NULL DEFAULT 'AVAILABLE',
        expires_at TEXT, used_at TEXT, revoked_at TEXT, revoke_reason TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      INSERT INTO sponsors (name) VALUES ('Legacy Sponsor');
      INSERT INTO campaigns (sponsor_id, campaign_name, service_name, original_price_cents, final_price_cents)
        VALUES (1, 'Legacy Campaign', '1 Hour', 10000, 5000);
      INSERT INTO coupons (campaign_id, sponsor_id, code) VALUES (1, 1, 'LEGACY-AAAAA');
    `);
    legacyDb.close();

    // Now open it through the real app code path, which must run the
    // migration (create batches/notifications/session_logs, add batch_id).
    const db = openDatabase(dbPath);

    const columns = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    assert.ok(columns.some((c) => c.name === 'batch_id'), 'batch_id column must exist after migration');

    // Pre-existing data must survive untouched.
    const coupon = db.prepare(`SELECT * FROM coupons WHERE code = 'LEGACY-AAAAA'`).get() as any;
    assert.ok(coupon, 'legacy coupon must still exist');
    assert.equal(coupon.batch_id, null, 'legacy coupon has no batch (correctly NULL, not fabricated)');

    // New tables must now exist and be usable.
    db.prepare(`INSERT INTO batches (batch_code, campaign_id, sponsor_id, quantity) VALUES ('B-TEST', 1, 1, 5)`).run();
    const batch = db.prepare(`SELECT * FROM batches WHERE batch_code = 'B-TEST'`).get();
    assert.ok(batch);

    const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string };
    assert.equal(version.value, '7');

    // v4 migration: sponsors/campaigns must have gained their image columns too.
    const sponsorCols = db.prepare(`PRAGMA table_info(sponsors)`).all() as { name: string }[];
    assert.ok(sponsorCols.some((c) => c.name === 'logo_path'));
    assert.ok(sponsorCols.some((c) => c.name === 'photo_path'));
    const campaignCols = db.prepare(`PRAGMA table_info(campaigns)`).all() as { name: string }[];
    assert.ok(campaignCols.some((c) => c.name === 'image_path'));
    assert.ok(campaignCols.some((c) => c.name === 'banner_path'));

    // v5 migration: coupons must have gained branch_id, and the branches table must exist.
    const couponCols = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    assert.ok(couponCols.some((c) => c.name === 'branch_id'));
    db.prepare(`INSERT INTO branches (name) VALUES ('Tunis')`).run();
    assert.equal((db.prepare(`SELECT COUNT(*) as c FROM branches`).get() as { c: number }).c, 1);

    db.close();
  });
});

describe('schema migration v5 -> v6 (Prime Paddle reservation system)', () => {
  test('an existing v5 database upgrades cleanly: coupons gain RESERVED/reservation_id, new tables are created and seeded, and every pre-existing coupon row survives untouched', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-migrate-v6-'));
    const dbPath = path.join(dir, 'legacy-v5.db');

    // Build a v5-shaped database by hand: coupons table with the OLD check
    // constraint (no RESERVED, no reservation_id) — this is exactly the
    // shape a real installed copy of SponsorQR has today.
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta (key, value) VALUES ('version', '5');

      CREATE TABLE sponsors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, notes TEXT,
        logo_path TEXT, photo_path TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        archived_at TEXT
      );

      CREATE TABLE campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sponsor_id INTEGER NOT NULL,
        campaign_name TEXT NOT NULL, service_name TEXT NOT NULL, duration TEXT,
        discount_type TEXT NOT NULL DEFAULT 'PERCENTAGE',
        original_price_cents INTEGER NOT NULL, discount_percentage REAL NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0, final_price_cents INTEGER NOT NULL,
        total_codes INTEGER NOT NULL DEFAULT 0, image_path TEXT, banner_path TEXT,
        start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, batch_code TEXT NOT NULL UNIQUE,
        campaign_id INTEGER NOT NULL, sponsor_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
        prefix TEXT, expires_at TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- The OLD coupons shape: CHECK has no RESERVED, no reservation_id column.
      CREATE TABLE coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        sponsor_id INTEGER NOT NULL REFERENCES sponsors(id),
        code TEXT NOT NULL UNIQUE, display_seq INTEGER,
        batch_id INTEGER REFERENCES batches(id), branch_id INTEGER REFERENCES branches(id),
        status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','USED','EXPIRED','REVOKED')),
        expires_at TEXT, used_at TEXT, revoked_at TEXT, revoke_reason TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coupon_id INTEGER REFERENCES coupons(id) ON DELETE RESTRICT,
        code TEXT NOT NULL, campaign_id INTEGER, sponsor_id INTEGER,
        sponsor_name TEXT, campaign_name TEXT,
        original_price_cents INTEGER, discount_percentage REAL, final_price_cents INTEGER,
        operator TEXT, used_at TEXT NOT NULL
      );

      INSERT INTO sponsors (name) VALUES ('Beach Co');
      INSERT INTO campaigns (sponsor_id, campaign_name, service_name, original_price_cents, final_price_cents)
        VALUES (1, 'Summer Promo', '1 Hour Board', 10000, 8000);

      -- Real, mixed-status coupon data — exactly what must survive intact.
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, status) VALUES (1, 1, 1, 'BEACH-AAAAA', 'AVAILABLE');
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, status, used_at) VALUES (2, 1, 1, 'BEACH-BBBBB', 'USED', '2026-01-01T10:00:00.000Z');
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, status, revoked_at, revoke_reason) VALUES (3, 1, 1, 'BEACH-CCCCC', 'REVOKED', '2026-01-02T10:00:00.000Z', 'Fraud');
      INSERT INTO usage_history (coupon_id, code, campaign_id, sponsor_id, sponsor_name, campaign_name, original_price_cents, discount_percentage, final_price_cents, operator, used_at)
        VALUES (2, 'BEACH-BBBBB', 1, 1, 'Beach Co', 'Summer Promo', 10000, 20, 8000, 'cashier1', '2026-01-01T10:00:00.000Z');
    `);
    legacyDb.close();

    // Open through the real app code path — must run the v6 migration.
    const db = openDatabase(dbPath);

    const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string };
    assert.equal(version.value, '7');

    // coupons: reservation_id column now exists, RESERVED is now a legal status.
    const couponCols = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    assert.ok(couponCols.some((c) => c.name === 'reservation_id'));
    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO coupons (campaign_id, sponsor_id, code, status) VALUES (1, 1, 'BEACH-NEWRES', 'RESERVED')`
      ).run();
    });
    // The old CHECK must still reject genuinely invalid statuses.
    assert.throws(() => {
      db.prepare(`INSERT INTO coupons (campaign_id, sponsor_id, code, status) VALUES (1, 1, 'BEACH-BOGUS', 'NOT_A_STATUS')`).run();
    });

    // Every pre-existing coupon row must be byte-identical apart from the
    // new (NULL) reservation_id column — same id, same status, same
    // timestamps, nothing silently changed or dropped by the rebuild.
    const available = db.prepare(`SELECT * FROM coupons WHERE id = 1`).get() as any;
    assert.equal(available.code, 'BEACH-AAAAA');
    assert.equal(available.status, 'AVAILABLE');
    assert.equal(available.reservation_id, null);

    const used = db.prepare(`SELECT * FROM coupons WHERE id = 2`).get() as any;
    assert.equal(used.status, 'USED');
    assert.equal(used.used_at, '2026-01-01T10:00:00.000Z');

    const revoked = db.prepare(`SELECT * FROM coupons WHERE id = 3`).get() as any;
    assert.equal(revoked.status, 'REVOKED');
    assert.equal(revoked.revoke_reason, 'Fraud');

    // usage_history (which FK-references coupons) must have survived the
    // foreign-keys-off rebuild completely intact.
    const history = db.prepare(`SELECT * FROM usage_history WHERE coupon_id = 2`).get() as any;
    assert.ok(history, 'usage_history row referencing the rebuilt coupons table must survive');
    assert.equal(history.code, 'BEACH-BBBBB');

    // Foreign keys must be back ON after the migration (not left disabled).
    const fkStatus = db.pragma('foreign_keys', { simple: true });
    assert.equal(fkStatus, 1);

    // New tables exist and are usable.
    for (const table of ['customers', 'periods', 'business_hours', 'pricing_rules', 'reservations', 'reservation_history']) {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      assert.ok(row.c >= 0, `${table} must exist and be queryable`);
    }

    // business_hours seeded for all 7 weekdays, all open by default.
    const bh = db.prepare(`SELECT * FROM business_hours ORDER BY weekday`).all() as { weekday: number; is_open: number }[];
    assert.equal(bh.length, 7);
    assert.ok(bh.every((r) => r.is_open === 1));

    // periods seeded with the 4 defaults.
    const periods = db.prepare(`SELECT COUNT(*) as c FROM periods`).get() as { c: number };
    assert.equal(periods.c, 4);

    // Re-opening an already-migrated (v6) database must be a safe no-op:
    // seeding must not duplicate rows, and the rebuild must not run again.
    db.close();
    const reopened = openDatabase(dbPath);
    const bhAgain = reopened.prepare(`SELECT COUNT(*) as c FROM business_hours`).get() as { c: number };
    assert.equal(bhAgain.c, 7, 're-opening must not duplicate seeded business_hours rows');
    const periodsAgain = reopened.prepare(`SELECT COUNT(*) as c FROM periods`).get() as { c: number };
    assert.equal(periodsAgain.c, 4, 're-opening must not duplicate seeded period rows');
    reopened.close();
  });
});

describe('schema migration v6 -> v7 (coupon coverage + redemption ledger)', () => {
  test('an existing v6 database gains coverage_players (default 1) and its in-flight RESERVED/USED coupons are backfilled into coupon_redemptions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-migrate-v7-'));
    const dbPath = path.join(dir, 'legacy-v6.db');

    // Build a v6-shaped database by hand: coupons already has reservation_id
    // and the RESERVED status, but campaigns has no coverage_players yet,
    // and coupon_redemptions/reservation_participants don't exist.
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta (key, value) VALUES ('version', '6');

      CREATE TABLE sponsors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, notes TEXT,
        logo_path TEXT, photo_path TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), archived_at TEXT);

      CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, sponsor_id INTEGER NOT NULL,
        campaign_name TEXT NOT NULL, service_name TEXT NOT NULL, duration TEXT,
        discount_type TEXT NOT NULL DEFAULT 'PERCENTAGE', original_price_cents INTEGER NOT NULL,
        discount_percentage REAL NOT NULL DEFAULT 0, discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        final_price_cents INTEGER NOT NULL, total_codes INTEGER NOT NULL DEFAULT 0, image_path TEXT,
        banner_path TEXT, start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        -- deliberately NO coverage_players column yet.

      CREATE TABLE coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL,
        sponsor_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, display_seq INTEGER,
        reservation_id INTEGER, status TEXT NOT NULL DEFAULT 'AVAILABLE'
          CHECK (status IN ('AVAILABLE','RESERVED','USED','EXPIRED','REVOKED')),
        expires_at TEXT, used_at TEXT, revoked_at TEXT, revoke_reason TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));

      CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
        notes TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));

      CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL,
        reservation_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
        reservation_date TEXT NOT NULL, start_time TEXT NOT NULL, duration_min INTEGER NOT NULL,
        period_id INTEGER, players INTEGER NOT NULL DEFAULT 1, base_price_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL DEFAULT 0, final_price_cents INTEGER NOT NULL,
        coupon_id INTEGER, payment_status TEXT NOT NULL DEFAULT 'UNPAID', paid_at TEXT,
        cancel_reason TEXT, notes TEXT, created_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));

      CREATE TABLE usage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, coupon_id INTEGER,
        code TEXT NOT NULL, campaign_id INTEGER, sponsor_id INTEGER, sponsor_name TEXT, campaign_name TEXT,
        original_price_cents INTEGER, discount_percentage REAL, final_price_cents INTEGER,
        operator TEXT, used_at TEXT NOT NULL);

      INSERT INTO sponsors (id, name) VALUES (1, 'Beach Co');
      INSERT INTO campaigns (id, sponsor_id, campaign_name, service_name, original_price_cents, final_price_cents)
        VALUES (1, 1, 'Promo', '1 Hour', 10000, 5000);
      INSERT INTO customers (id, name, phone) VALUES (1, 'Amir', '20123456');
      INSERT INTO reservations (id, customer_id, reservation_type, status, reservation_date, start_time,
        duration_min, players, base_price_cents, discount_cents, final_price_cents, coupon_id)
        VALUES (1, 1, 'ADVANCE', 'CONFIRMED', '2030-01-06', '10:00', 60, 1, 10000, 5000, 5000, 1);

      -- A coupon still RESERVED (in-flight, never paid) under the OLD single-FK model.
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, reservation_id, status)
        VALUES (1, 1, 1, 'BEACH-RSV01', 1, 'RESERVED');
      -- A coupon already USED under the old model.
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, reservation_id, status, used_at)
        VALUES (2, 1, 1, 'BEACH-USED01', 1, 'USED', '2030-01-01T10:00:00.000Z');
      -- A perfectly ordinary AVAILABLE coupon, untouched either way.
      INSERT INTO coupons (id, campaign_id, sponsor_id, code, status) VALUES (3, 1, 1, 'BEACH-FREE01', 'AVAILABLE');
    `);
    legacyDb.close();

    const db = openDatabase(dbPath);

    const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string };
    assert.equal(version.value, '7');

    // campaigns.coverage_players added, defaulting to 1 for pre-existing rows.
    const campaignCols = db.prepare(`PRAGMA table_info(campaigns)`).all() as { name: string }[];
    assert.ok(campaignCols.some((c) => c.name === 'coverage_players'));
    const campaign = db.prepare(`SELECT coverage_players FROM campaigns WHERE id = 1`).get() as { coverage_players: number };
    assert.equal(campaign.coverage_players, 1);

    // New tables exist.
    for (const table of ['reservation_participants', 'coupon_redemptions']) {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      assert.ok(row.c >= 0, `${table} must exist and be queryable`);
    }

    // The RESERVED coupon's old reservation_id link is backfilled into a
    // RESERVED ledger row — nothing about its in-flight reservation is lost.
    const reservedLedger = db
      .prepare(`SELECT * FROM coupon_redemptions WHERE coupon_id = 1`)
      .get() as { reservation_id: number; status: string; coverage_consumed: number; eligible_amount_cents: number; discount_cents: number } | undefined;
    assert.ok(reservedLedger, 'the in-flight RESERVED coupon must get a backfilled ledger row');
    assert.equal(reservedLedger!.reservation_id, 1);
    assert.equal(reservedLedger!.status, 'RESERVED');
    assert.equal(reservedLedger!.coverage_consumed, 1);
    assert.equal(reservedLedger!.eligible_amount_cents, 10000); // reservation's own base_price_cents
    assert.equal(reservedLedger!.discount_cents, 5000); // reservation's own discount_cents

    // The already-USED coupon is backfilled as CONSUMED, not RESERVED.
    const usedLedger = db
      .prepare(`SELECT status FROM coupon_redemptions WHERE coupon_id = 2`)
      .get() as { status: string } | undefined;
    assert.ok(usedLedger);
    assert.equal(usedLedger!.status, 'CONSUMED');

    // The plain AVAILABLE coupon gets no ledger row at all.
    const freeLedger = db.prepare(`SELECT COUNT(*) as c FROM coupon_redemptions WHERE coupon_id = 3`).get() as { c: number };
    assert.equal(freeLedger.c, 0);

    // Re-opening an already-migrated (v7) database must not duplicate the backfill.
    db.close();
    const reopened = openDatabase(dbPath);
    const countAgain = (reopened.prepare(`SELECT COUNT(*) as c FROM coupon_redemptions`).get() as { c: number }).c;
    reopened.close();
    assert.equal(countAgain, 2, 're-opening must not duplicate backfilled ledger rows');
  });
});
