-- Sponsor QR Manager database schema
-- SQLite. Foreign keys enforced. All monetary values stored as INTEGER cents
-- to avoid floating point errors; formatted to decimal only for display.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sponsors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  notes       TEXT,
  logo_path   TEXT,
  photo_path  TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(name);
CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors(status);

CREATE TABLE IF NOT EXISTS campaigns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsor_id          INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  campaign_name       TEXT NOT NULL,
  service_name        TEXT NOT NULL,
  duration            TEXT,
  discount_type       TEXT NOT NULL DEFAULT 'PERCENTAGE' CHECK (discount_type IN ('PERCENTAGE','FIXED')),
  original_price_cents INTEGER NOT NULL CHECK (original_price_cents >= 0),
  discount_percentage  REAL NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  discount_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_cents >= 0),
  final_price_cents    INTEGER NOT NULL CHECK (final_price_cents >= 0),
  total_codes          INTEGER NOT NULL DEFAULT 0,
  image_path            TEXT,
  banner_path           TEXT,
  start_date            TEXT,
  end_date              TEXT,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_sponsor ON campaigns(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);

CREATE TABLE IF NOT EXISTS coupons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  sponsor_id   INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  code         TEXT NOT NULL UNIQUE,
  display_seq  INTEGER,
  status       TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','USED','EXPIRED','REVOKED')),
  expires_at   TEXT,
  used_at      TEXT,
  revoked_at   TEXT,
  revoke_reason TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- NOTE: reservation_id (linking a coupon to the reservation holding it while
-- RESERVED), and the 'RESERVED' status value itself, are added by the v6
-- migration block in connection.ts, not here — this file intentionally
-- keeps each table's ORIGINAL shape; every column/constraint added since v1
-- is applied uniformly by the versioned migration path below, whether the
-- database is brand new (starts at version 0) or pre-existing. This matches
-- how batch_id/branch_id were already added for coupons. Do not add new
-- columns directly here; add a new `if (currentVersion < N)` block instead.

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_sponsor ON coupons(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons(expires_at);
CREATE INDEX IF NOT EXISTS idx_coupons_created ON coupons(created_at);

CREATE TABLE IF NOT EXISTS usage_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id          INTEGER NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  code               TEXT NOT NULL,
  campaign_id        INTEGER NOT NULL,
  sponsor_id         INTEGER NOT NULL,
  sponsor_name       TEXT NOT NULL,
  campaign_name      TEXT NOT NULL,
  original_price_cents INTEGER NOT NULL,
  discount_percentage  REAL NOT NULL,
  final_price_cents    INTEGER NOT NULL,
  operator           TEXT,
  used_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_history_coupon ON usage_history(coupon_id);
CREATE INDEX IF NOT EXISTS idx_history_sponsor ON usage_history(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_history_campaign ON usage_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_history_used_at ON usage_history(used_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- QR Batches: a named record of "codes generated together" so batches can be
-- listed, searched and reported on independently of the campaign they were
-- generated for. Coupons reference their originating batch via batch_id
-- (added as a migration for existing databases — see connection.ts).
CREATE TABLE IF NOT EXISTS batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code   TEXT NOT NULL UNIQUE,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  sponsor_id   INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL,
  prefix       TEXT,
  expires_at   TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_campaign ON batches(campaign_id);
CREATE INDEX IF NOT EXISTS idx_batches_sponsor ON batches(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created_at);

-- Notifications: real events emitted by the app itself (never synthetic).
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Session logs: since this app has no user accounts, this tracks real
-- application launch events on this device (not fabricated per-user logins).
CREATE TABLE IF NOT EXISTS session_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_version   TEXT NOT NULL,
  device_name   TEXT NOT NULL,
  platform      TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_session_logs_started ON session_logs(started_at);

-- Local user accounts (offline auth — no cloud). Passwords are hashed with
-- scrypt (Node's built-in crypto, no native dependency), never stored or
-- logged in plaintext.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('CEO','ADMIN','MANAGER','VIEWER')),
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Real per-user login attempts (success and failure). Never log passwords.
CREATE TABLE IF NOT EXISTS login_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT NOT NULL,
  success     INTEGER NOT NULL,
  reason      TEXT,
  device_name TEXT,
  app_version TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);

-- Branches: a lightweight local tag/category (e.g. "Tunis", "Sousse") for a
-- single-device install. This is NOT multi-device/cloud sync — it's just a
-- way to categorize coupons/history within this one local database.
CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================================
-- PRIME PADDLE — Reservation System (added schema v6)
-- These tables are brand new, so — unlike the ALTER TABLE additions above —
-- they can be defined here in their final shape directly: there is no
-- pre-existing table with an old CHECK constraint to migrate around.
-- connection.ts's v6 migration block still seeds business_hours defaults on
-- first creation and performs the coupons rebuild described above.
-- ============================================================================

-- Customers: one row per known customer. Aggregates (spend, visit count,
-- no-shows, last visit) are always computed live from `reservations`, never
-- stored here, so they can never drift out of sync.
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Periods: configurable named time-of-day bands (Morning/Afternoon/Sunset/
-- Evening, etc). Never hardcoded in the UI — CEO/Admin manage these.
CREATE TABLE IF NOT EXISTS periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  start_time  TEXT NOT NULL, -- 'HH:MM' 24h
  end_time    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_periods_active ON periods(active);

-- Business hours: one row per weekday (0=Sunday..6=Saturday), configurable
-- per day. A closed day (is_open=0) blocks reservations server-side, not
-- just in the UI. slot_minutes is the reservation slot granularity for that
-- day; capacity is the default number of players/boards per slot.
CREATE TABLE IF NOT EXISTS business_hours (
  weekday      INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  is_open      INTEGER NOT NULL DEFAULT 1,
  open_time    TEXT,
  close_time   TEXT,
  slot_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes > 0),
  capacity     INTEGER NOT NULL DEFAULT 4 CHECK (capacity >= 0)
);

-- Pricing rules: resolved by (weekday, period, duration); highest `priority`
-- among matching active rules wins. Never a hardcoded business price.
CREATE TABLE IF NOT EXISTS pricing_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  weekday_mask  INTEGER NOT NULL DEFAULT 127, -- bit0=Sun .. bit6=Sat; 127=every day
  period_id     INTEGER REFERENCES periods(id) ON DELETE SET NULL, -- NULL = any period
  duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  priority      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_pricing_period ON pricing_rules(period_id);
CREATE INDEX IF NOT EXISTS idx_pricing_active ON pricing_rules(active);

-- Reservations: the core booking record. Both WALK_IN and ADVANCE bookings
-- share this one table/lifecycle. coupon_id mirrors coupons.reservation_id
-- (added in the v6 migration below) — kept in sync in the same transaction
-- by ReservationService/CouponService so both directions are O(1) lookups.
CREATE TABLE IF NOT EXISTS reservations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reservation_type    TEXT NOT NULL CHECK (reservation_type IN ('WALK_IN','ADVANCE')),
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
                        ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),
  reservation_date    TEXT NOT NULL, -- 'YYYY-MM-DD'
  start_time          TEXT NOT NULL, -- 'HH:MM'
  duration_min        INTEGER NOT NULL CHECK (duration_min > 0),
  period_id           INTEGER REFERENCES periods(id) ON DELETE SET NULL,
  players             INTEGER NOT NULL DEFAULT 1 CHECK (players >= 1),
  base_price_cents    INTEGER NOT NULL CHECK (base_price_cents >= 0),
  discount_cents      INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  final_price_cents   INTEGER NOT NULL CHECK (final_price_cents >= 0),
  coupon_id           INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  payment_status      TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID','REFUNDED')),
  paid_at             TEXT,
  cancel_reason       TEXT,
  notes               TEXT,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date, start_time);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_coupon ON reservations(coupon_id);

-- Reservation history: structured per-reservation transition timeline
-- (separate from the generic audit_logs table, which also gets a mirrored
-- entry for consistency with how coupons/sponsors are already audited).
CREATE TABLE IF NOT EXISTS reservation_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id  INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_res_history_reservation ON reservation_history(reservation_id);
