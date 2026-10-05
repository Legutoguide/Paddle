import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 7;

/**
 * Open (and initialize if needed) the SQLite database at the given path.
 * Pass ':memory:' for an ephemeral in-memory database (used by tests).
 */
export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  const row = db
    .prepare<[], { value: string }>("SELECT value FROM schema_meta WHERE key = 'version'")
    .get();

  const currentVersion = row ? Number(row.value) : 0;

  if (currentVersion < 2) {
    // v2: coupons gained an optional link to the batch they were generated
    // in. Safe no-op on a fresh database (the column simply starts empty),
    // and additive-only for existing databases (existing coupons keep
    // working with batch_id = NULL; they just won't show up under a batch).
    const columns = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    const hasBatchId = columns.some((c) => c.name === 'batch_id');
    if (!hasBatchId) {
      db.exec(`ALTER TABLE coupons ADD COLUMN batch_id INTEGER REFERENCES batches(id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_coupons_batch ON coupons(batch_id)`);
    }
  }

  if (currentVersion < 4) {
    // v4: sponsors gained logo_path/photo_path, campaigns gained
    // image_path/banner_path. Additive-only; existing rows simply start
    // with NULL images and fall back gracefully everywhere they're used.
    const sponsorColumns = db.prepare(`PRAGMA table_info(sponsors)`).all() as { name: string }[];
    if (!sponsorColumns.some((c) => c.name === 'logo_path')) {
      db.exec(`ALTER TABLE sponsors ADD COLUMN logo_path TEXT`);
    }
    if (!sponsorColumns.some((c) => c.name === 'photo_path')) {
      db.exec(`ALTER TABLE sponsors ADD COLUMN photo_path TEXT`);
    }

    const campaignColumns = db.prepare(`PRAGMA table_info(campaigns)`).all() as { name: string }[];
    if (!campaignColumns.some((c) => c.name === 'image_path')) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN image_path TEXT`);
    }
    if (!campaignColumns.some((c) => c.name === 'banner_path')) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN banner_path TEXT`);
    }
  }

  if (currentVersion < 5) {
    // v5: coupons gained an optional branch_id tag (local-only category,
    // not multi-device sync). Additive; existing coupons simply start
    // untagged (branch_id = NULL).
    const couponColumns = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    if (!couponColumns.some((c) => c.name === 'branch_id')) {
      db.exec(`ALTER TABLE coupons ADD COLUMN branch_id INTEGER REFERENCES branches(id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_coupons_branch ON coupons(branch_id)`);
    }
  }

  if (currentVersion < 6) {
    // v6: Prime Paddle reservation system.
    //
    // The new tables (customers, periods, business_hours, pricing_rules,
    // reservations, reservation_history) are brand new, so schema.sql's
    // `CREATE TABLE IF NOT EXISTS` (already executed above, unconditionally,
    // on every open) has already created them for us — nothing to do here
    // for those. What DOES need explicit migration is the existing
    // `coupons` table, because SQLite cannot ALTER a column's CHECK
    // constraint in place; we rebuild the table (copy -> drop -> rename).
    //
    // usage_history.coupon_id references coupons(id), and `foreign_keys` is
    // already ON for this connection (see openDatabase above), so per
    // SQLite's own documented table-rebuild procedure
    // (https://sqlite.org/lang_altertable.html#otheralter) we must turn
    // foreign key enforcement OFF for this step — PRAGMA foreign_keys is a
    // no-op if toggled inside a transaction, so it's set outside the
    // transaction, around it — then verify with foreign_key_check before
    // turning it back on, so a corrupt copy is caught immediately rather
    // than silently accepted.
    const couponColumns = db.prepare(`PRAGMA table_info(coupons)`).all() as { name: string }[];
    const alreadyHasReservationId = couponColumns.some((c) => c.name === 'reservation_id');

    if (!alreadyHasReservationId) {
      db.pragma('foreign_keys = OFF');
      const rebuildCoupons = db.transaction(() => {
        db.exec(`
          CREATE TABLE coupons_v6 (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
            sponsor_id     INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
            code           TEXT NOT NULL UNIQUE,
            display_seq    INTEGER,
            batch_id       INTEGER REFERENCES batches(id),
            branch_id      INTEGER REFERENCES branches(id),
            reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
            status         TEXT NOT NULL DEFAULT 'AVAILABLE'
                             CHECK (status IN ('AVAILABLE','RESERVED','USED','EXPIRED','REVOKED')),
            expires_at     TEXT,
            used_at        TEXT,
            revoked_at     TEXT,
            revoke_reason  TEXT,
            notes          TEXT,
            created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          INSERT INTO coupons_v6
            (id, campaign_id, sponsor_id, code, display_seq, batch_id, branch_id,
             reservation_id, status, expires_at, used_at, revoked_at, revoke_reason,
             notes, created_at, updated_at)
          SELECT
            id, campaign_id, sponsor_id, code, display_seq, batch_id, branch_id,
            NULL, status, expires_at, used_at, revoked_at, revoke_reason,
            notes, created_at, updated_at
          FROM coupons;

          DROP TABLE coupons;
          ALTER TABLE coupons_v6 RENAME TO coupons;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
          CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
          CREATE INDEX IF NOT EXISTS idx_coupons_sponsor ON coupons(sponsor_id);
          CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
          CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons(expires_at);
          CREATE INDEX IF NOT EXISTS idx_coupons_created ON coupons(created_at);
          CREATE INDEX IF NOT EXISTS idx_coupons_batch ON coupons(batch_id);
          CREATE INDEX IF NOT EXISTS idx_coupons_branch ON coupons(branch_id);
          CREATE INDEX IF NOT EXISTS idx_coupons_reservation ON coupons(reservation_id);
        `);
      });
      try {
        rebuildCoupons();
        const fkViolations = db.pragma('foreign_key_check') as unknown[];
        if (fkViolations.length > 0) {
          throw new Error(
            `v6 migration: coupons rebuild left ${fkViolations.length} foreign key violation(s); aborting to avoid a corrupted database.`
          );
        }
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    // Seed business_hours (7 rows, Sun..Sat) only the first time the table
    // is empty — a fresh install and a freshly-migrated old install both
    // land here with zero rows, so this check alone is sufficient and it's
    // safe to re-run (no-ops once seeded).
    const bhCount = (db.prepare(`SELECT COUNT(*) as c FROM business_hours`).get() as { c: number }).c;
    if (bhCount === 0) {
      const insertBh = db.prepare(
        `INSERT INTO business_hours (weekday, is_open, open_time, close_time, slot_minutes, capacity)
         VALUES (?, 1, '09:00', '19:00', 60, 4)`
      );
      const seedBh = db.transaction(() => {
        for (let weekday = 0; weekday <= 6; weekday++) insertBh.run(weekday);
      });
      seedBh();
    }

    // Seed a default set of periods the first time, so the UI isn't empty
    // out of the box; CEO/Admin can rename/edit/add more afterward.
    const periodCount = (db.prepare(`SELECT COUNT(*) as c FROM periods`).get() as { c: number }).c;
    if (periodCount === 0) {
      const insertPeriod = db.prepare(
        `INSERT INTO periods (name, start_time, end_time, sort_order, active) VALUES (?, ?, ?, ?, 1)`
      );
      const seedPeriods = db.transaction(() => {
        insertPeriod.run('Morning', '09:00', '12:00', 0);
        insertPeriod.run('Afternoon', '12:00', '16:00', 1);
        insertPeriod.run('Sunset', '16:00', '18:30', 2);
        insertPeriod.run('Evening', '18:30', '21:00', 3);
      });
      seedPeriods();
    }
  }

  if (currentVersion < 7) {
    // v7: coupon coverage (N players per coupon) + partial/multi-reservation
    // redemption ledger + optional reservation participants.
    //
    // campaigns.coverage_players: brand-new column, simple ADD COLUMN (no
    // CHECK constraint needed here — the app layer validates it, same
    // pattern as other ADD COLUMN migrations in this file).
    const campaignColumns = db.prepare(`PRAGMA table_info(campaigns)`).all() as { name: string }[];
    if (!campaignColumns.some((c) => c.name === 'coverage_players')) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN coverage_players INTEGER NOT NULL DEFAULT 1`);
    }

    // reservation_participants / coupon_redemptions are brand-new tables,
    // already created above by schema.sql's CREATE TABLE IF NOT EXISTS.
    //
    // Backfill: any coupon already AVAILABLE/RESERVED/USED and still
    // carrying a v6-style reservation_id must get a matching ledger row,
    // so nothing already in flight is silently lost when the old single-FK
    // field stops being read by the app. coverage_consumed = 1 (coverage
    // was always implicitly 1 before this migration — campaigns.coverage_players
    // just defaulted to 1 above for every pre-existing campaign).
    const toBackfill = db
      .prepare(
        `SELECT c.id as id, c.reservation_id as reservation_id, c.status as status,
                r.base_price_cents as base_price_cents, r.discount_cents as discount_cents
         FROM coupons c
         JOIN reservations r ON r.id = c.reservation_id
         WHERE c.reservation_id IS NOT NULL
           AND c.status IN ('RESERVED','USED')
           AND NOT EXISTS (SELECT 1 FROM coupon_redemptions cr WHERE cr.coupon_id = c.id AND cr.reservation_id = c.reservation_id)`
      )
      .all() as { id: number; reservation_id: number; status: string; base_price_cents: number; discount_cents: number }[];

    if (toBackfill.length > 0) {
      const insertRedemption = db.prepare(
        `INSERT INTO coupon_redemptions
           (coupon_id, reservation_id, coverage_consumed, eligible_amount_cents, discount_cents, status, consumed_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`
      );
      const backfill = db.transaction(() => {
        for (const row of toBackfill) {
          const status = row.status === 'USED' ? 'CONSUMED' : 'RESERVED';
          insertRedemption.run(
            row.id,
            row.reservation_id,
            row.base_price_cents,
            row.discount_cents,
            status,
            status === 'CONSUMED' ? new Date().toISOString() : null
          );
        }
      });
      backfill();
    }
  }

  if (!row) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(
      String(SCHEMA_VERSION)
    );
  } else if (currentVersion < SCHEMA_VERSION) {
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'version'").run(String(SCHEMA_VERSION));
  }
}

export function closeDatabase(db: Database.Database): void {
  db.close();
}
