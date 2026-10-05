# HANDOFF — SponsorQR → PRIME PADDLE

Continuation notes for the next developer / Claude session.
**Read "Verification status" first — it says exactly what was and was not proven.**

Prime Paddle is a **paddle-board / beach** business (NOT padel tennis). It is the
existing offline SponsorQR Windows app (Electron + React + TypeScript + Vite +
SQLite via better-sqlite3), extended in place with a reservation system. Nothing
was rebuilt; Sponsors, Campaigns, Coupons/QR, Scan & Validate, Batches, History,
Exports, Users, Settings, Backup/Restore all remain and use the same code.

---

## 1. Verification status (honest)

Development happened in a sandbox with **no network and no Windows**.

| Item | Status |
|---|---|
| Unit tests | **155 / 162 pass.** Run with a temporary adapter (`tools/offline-test-shim`) that maps `better-sqlite3` onto Node's built-in `node:sqlite`. **Not run against the real `better-sqlite3`.** |
| The 7 failing tests | Environmental only, identical set before/after my work: `BackupService` (adapter has no `.backup()`), and `importExport` / `pdfImages` / `pdfService` / `qrService` (need `papaparse`, `pdfkit`, `jsqr`, which were not installed). **They were not verified by me** — run them after `npm install`. |
| `npm install`, `npm run typecheck`, `npm run build` | **NOT RUN.** Files were type-checked with plain `tsc` and stubs; the only residual errors were the adapter's missing `.backup()` and 3 `key`-prop complaints that appear only because `@types/react` was absent. |
| Windows packaging (`package:win`) | **NOT RUN. No `.exe` was produced by this session.** |
| UI in a running app | **NEVER RENDERED.** All React pages/components are type-checked only. Expect to find layout/behaviour issues on first launch. |

**First thing to do on a real machine:**
```bash
npm install
npx tsx --test tests/unit/*.test.ts     # expect all 162 to pass
npm run typecheck
npm run dev:renderer & npm run dev:main # then click through every new screen
```

## 2. Database — schema version 6

`src/main/db/schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`, run on every
open) + versioned migration blocks in `src/main/db/connection.ts`
(`SCHEMA_VERSION = 6`). Convention kept: never edit an existing table's shape in
`schema.sql`; add an `if (currentVersion < N)` block.

New tables (created by `schema.sql`, so both fresh and upgraded DBs get them):
`customers`, `periods`, `business_hours`, `pricing_rules`, `reservations`,
`reservation_history`.

v6 migration block:
* **Rebuilds `coupons`** (copy → drop → rename) to add status `RESERVED` and a
  nullable `reservation_id` FK. SQLite cannot alter a CHECK constraint in place.
  Done with `PRAGMA foreign_keys=OFF` around the transaction (the pragma is a
  no-op inside one), then `foreign_key_check`, then back ON — required because
  `usage_history.coupon_id` references `coupons(id)`.
* Seeds `business_hours` (7 rows, Sun–Sat, 09:00–19:00, slot 60 min, capacity 4)
  and 4 default `periods` (Morning/Afternoon/Sunset/Evening) only when empty.
* Existing data is preserved byte-for-byte (`tests/unit/migration.test.ts`
  builds a real v5-shaped DB with USED/REVOKED coupons + usage_history and
  asserts all rows survive, FKs are back ON, and re-opening is a no-op).

Data conventions: money = integer cents; dates `YYYY-MM-DD`, times `HH:MM`,
both in the **machine's local time** (the business's day); weekday 0=Sunday.

## 3. Services (`src/main/services/`)

* `ReservationService` — create walk-in/advance, coupon attach/detach, the
  status machine, `markAsPaid`, `rescheduleToAdvance`, search/list/history.
* `AvailabilityService` — DB wrapper around the pure `src/shared/lib/availability.ts`;
  business hours, periods (validated server-side).
* `PricingService` — rule CRUD and `resolvePrice`; throws `NoPricingRuleError`
  rather than ever inventing a price.
* `CustomerService` — find-or-create by normalised phone (soft, not a UNIQUE
  constraint), search by name/phone/reservation id/coupon code, computed stats.
* `ReservationReportService` — dashboard + report queries (all live SQL).
* `couponService` (existing, extended) — `reserveForReservation`,
  `releaseReservation`, `consumeForReservation`, `transferReservation`,
  `getDetailsById`, `RESERVED` outcome in `validate()`, guarded `confirmUse`.
* `dangerZoneService` (existing) — reset now also clears reservations,
  reservation_history and customers; keeps hours/periods/pricing config.

### Reservation statuses / transitions
`PENDING→{CONFIRMED,CANCELLED}`, `CONFIRMED→{CHECKED_IN,CANCELLED,NO_SHOW}`,
`CHECKED_IN→{IN_PROGRESS,CANCELLED}`, `IN_PROGRESS→COMPLETED`; COMPLETED /
CANCELLED / NO_SHOW are terminal. Anything else is rejected. Every change writes
`reservation_history` + `audit_logs`. Walk-ins and advance bookings are both
created directly as `CONFIRMED` (`PENDING` exists in the schema/whitelist but is
currently unused — reserved for a future multi-step/online flow).

### Capacity & availability
Slot occupancy = sum of `players` for statuses PENDING/CONFIRMED/CHECKED_IN/
IN_PROGRESS/**COMPLETED** (completed still counts so past days show real usage).
CANCELLED/NO_SHOW free capacity automatically (no ledger to sync). Slot status
is computed live (never stored): CLOSED, COMPLETED, IN_PROGRESS, FULL,
ALMOST_FULL (≥75%, constant `DEFAULT_ALMOST_FULL_THRESHOLD`), AVAILABLE. Booking
re-checks availability **inside the transaction**; past/closed/full slots are
rejected server-side. A booking occupies exactly one slot; its duration is the
slot length, so **a pricing rule's `duration_min` must equal the day's
`slot_minutes`** or no price resolves.

### Coupons ↔ reservations (the core business rule)
* Attach: `AVAILABLE→RESERVED` (locks `coupons.reservation_id`, mirrors
  `reservations.coupon_id`). Refused if RESERVED/USED/REVOKED/EXPIRED, if already
  past expiry, or if it expires **before the booking date**.
* Cancel / no-show: `RESERVED→AVAILABLE`, capacity freed (no-op if already USED).
* **`markAsPaid`** — one transaction: `payment_status→PAID` **and**
  `RESERVED→USED` (+ `usage_history` row). If the coupon step fails, the payment
  write rolls back (tested: never PAID+RESERVED). Staff never runs a separate
  "use coupon" step.
* Scan & Validate is validation only: a RESERVED coupon returns outcome
  `RESERVED` (UI: "COUPON RESERVED …") and is never consumed. `confirmUse`
  refuses RESERVED unless called with `allowReservedOverride`.
* `revoke()` / `revokeMany()` refuse RESERVED coupons.
* Discount math reuses `shared/lib/pricing.calculatePrice` on the resolved
  booking price (percentage **and** fixed — `discountAmountCents` was added to
  `CouponWithDetails`, which previously lacked it).

## 4. Permissions & IPC

New permissions (main `permissions.ts` + renderer mirror `lib/permissions.ts`
— **keep both in sync**): `reservations.{view,create,edit,cancel,checkin,payment}`,
`calendar.view`, `availability.view`, `customers.{view,create,edit}`,
`pricing.{view,edit}`, `periods.edit`, `business_hours.edit`,
`qr.reserved_override`, `dashboard.financial_view`.

| Role | Reservation-related access |
|---|---|
| CEO | everything |
| Admin | everything except `qr.reserved_override` and `danger_zone.execute` |
| Manager | day-to-day reservations/customers/calendar/payments, `pricing.view`, `dashboard.financial_view`; **no** pricing/period/hours editing |
| Viewer | read-only: reservations, calendar, customers, availability, pricing (no money figures) |

Every channel is registered through the existing `safeHandle(channel, permission, fn)`
(server-side check against the current session). `actorUserId` always comes from
the verified session. Dashboard/report money fields are `null` **in the response**
unless the session has `dashboard.financial_view`.

**Not yet wired to any UI:** `qr.reserved_override` exists in the permission
matrix, `confirmUse(…, {allowReservedOverride})` supports it and audits it as
`COUPON_RESERVED_OVERRIDE`, but **no IPC channel or button passes the flag** —
deliberately (no casual "force use"). If a CEO override is wanted, add a
dedicated channel guarded by `qr.reserved_override`.

Channels live in `src/shared/ipc/contract.ts`; bridge in `src/preload/preload.ts`;
typed renderer mirror in `src/renderer/src/types/window.d.ts`.

## 5. UI (renderer)

Routes (`App.tsx`, permission-gated): `/reservations`, `/reservations/new`
(one wizard for Walk-in **and** Advance; `?mode=walkin|advance&date=&time=`),
`/calendar` (Day/Week/Month), `/customers`, `/booking-setup` (hours, capacity,
periods, pricing rules), `/reservation-reports` (+CSV). "Payments" = Reservations
filtered `?payment=UNPAID`. Dashboard shows `ReservationDashboard` (quick actions
+ live tiles). Shared: `ReservationDetailModal` (all lifecycle actions, one-click
"Mark as paid"), `ReservationBadges`, `lib/dates.ts`.

**Book Another Date:** customer/players/notes/coupon live in the wizard's state,
not the mode, so switching Walk-in→Advance loses nothing. (Backend
`rescheduleToAdvance` exists for an already-created walk-in; no button uses it yet.)

Gotcha: `useToast()` returns a new object whenever a toast appears/expires — do
**not** put `toast` in hook dependency arrays (use the `toastRef` pattern the new
pages use), or data reloads/selections reset.

Branding: visible text, logo glyph (Waves), tagline and dashboard hero now say
PRIME PADDLE. The existing navy/cyan/teal theme was kept.
**Deliberately unchanged:** `appId`, `productName` ("Sponsor QR Manager"), the
`%APPDATA%/SponsorQRManager` data folder, installer artwork/`resources/icon.ico`
(changing the data folder would orphan every existing customer database; changing
appId/productName changes installer identity/upgrade behaviour).

## 6. Build & packaging (unchanged from the proven setup)

```bash
npm install
npx tsx --test tests/unit/*.test.ts
npm run typecheck
npm run build                # vite build + tsc + esbuild main; copies schema.sql
npm run package:win          # build → rebuild better-sqlite3 for Electron win32/x64 → electron-builder (NSIS + portable)
npm run package:win:portable # portable only
```
Outputs go to `release/`, named from `productName`
(`Sponsor QR Manager Setup <version>.exe`, `Sponsor QR Manager Portable.exe`);
rename to `SponsorQR Setup.exe` / `SponsorQR Portable.exe` if that is the
delivered name. Do not modify `electron-builder.json`, `scripts/afterPack.js`,
`scripts/rebuild-native-win.js`, `npmRebuild:false` — they encode fixes for
better-sqlite3 / hoisting problems on Windows. No packaging change was needed
for this work: no new dependencies, and `schema.sql` is already copied by
`scripts/build-main.js`.

## 7. Tests added

`availability` (pure), `reservationPermissions`, `reservationService`
(lifecycle, capacity, closed/past, validation, config validation),
`couponReservationIntegration` (attach/release/pay atomicity incl. forced
rollback, override audit, expiry/revoke rules, danger-zone reset),
`reservationReports` (dashboard/report figures + financial gating), and the
v5→v6 case in `migration.test.ts`. Helper `tests/unit/testDates.ts`
(`futureSunday()`) keeps date-dependent tests from expiring.

## 8. Bug found & fixed after initial handoff: packaged build had ZERO CSS

**Symptom** (reported after building the real Windows .exe): every screen rendered
with default browser styling only — serif font, blue underlined links, plain
white inputs, no dark theme, no Tailwind at all. Confirmed **pre-existing in the
original app**, unrelated to the reservation work — nobody had run a packaged
build and clicked through it before.

**Root cause:** `src/renderer/index.html`'s CSP had `style-src 'self' 'unsafe-inline'`.
In dev mode (`loadURL('http://localhost:5173')`) this works because Vite injects
dev CSS via inline `<style>` tags, covered by `'unsafe-inline'`. In the packaged
build, `main.ts` uses `loadFile(...)`, so the page runs under `file://`, and
Vite's production build injects the compiled CSS as an external
`<link rel="stylesheet" href="./assets/xxx.css">` — which is **not** covered by
`'unsafe-inline'` and requires source-list matching. `'self'` does not reliably
match other `file://` sub-resources in Chromium/Electron (a known Electron/CSP
gotcha), so the stylesheet silently failed to load. Same mechanism would have
also affected `img-src`/`script-src` for any local file assets.

**Fix:** added the `file:` scheme explicitly to `default-src`, `script-src`,
`style-src`, `img-src`, `media-src`, `font-src` in the CSP meta tag. Regression
guard: `tests/unit/csp.test.ts` (fails if `file:` is ever removed again).

**Still worth doing later** (not done — bigger, riskier change): the more
"correct" long-term fix is a custom privileged protocol via `protocol.handle`
instead of raw `file://`, which gives the page a real, stable origin. The CSP
fix above is the standard, minimal, well-documented fix and should be enough —
flagging the alternative in case the file:// origin causes other quirks later
(e.g. with locally-stored sponsor/campaign images).

**Verify after rebuilding:** `npm run build && npm run package:win`, install the
new `.exe`, confirm the dark theme/Tailwind styling now renders (not just the
dev build, which never showed the bug).


## 9. Bug found & fixed: price did not scale with players, and group coupons double-charged

**Reported symptom:** setting a pricing rule to 30 TND and booking 2 players still
charged 30 TND total instead of 60 — the player count was never used in the
price calculation. Also: campaigns configured as fixed-price group packages
(e.g. a "2 players" deal, "3 players" deal) got their price **recalculated**
from the per-slot rate instead of using the package's own configured price.

**Root cause:** `ReservationService` resolved `basePriceCents` purely from
`pricing_rules.priceCents` for the (day, period, duration) combination and
never multiplied by `players`.

**Fix (business rule, now consistent everywhere — create, attach, detach,
reschedule, and the booking wizard's live preview):**
* `pricing_rules.priceCents` is a **per-player rate**. With no coupon,
  `base_price_cents = rule.priceCents × players`.
* When a coupon/campaign is attached, its own `originalPriceCents` (the price
  the business configured for that campaign — e.g. a group package) **replaces**
  the per-player total; it is never also multiplied by player count. The
  discount then applies on top of that, as before.
* Detaching a coupon restores the per-player total (re-resolved fresh from the
  pricing rule — the stored value is not reused, since it may currently hold
  the coupon's own package price).
* `BookingSetup.tsx` and the booking wizard summary now explicitly label and
  show "price per player × N players" so this can't be silently miscounted again.

**Tests:** `reservationService.test.ts` (`Per-player pricing` suite, and the
corrected "price scales with players" case — my own earlier test had encoded
the bug's wrong expectation and is fixed), `couponReservationIntegration.test.ts`
("group-package coupon ... NOT multiplied by player count", strengthened
attach/detach test with players=2 and differing campaign vs. per-player prices).

## 10. Schema v7 — coupon COVERAGE, partial redemption, participants, multi-coupon reservations

A full redesign replacing §9's "coupon price replaces reservation price" model (which
the user correctly identified as wrong — see the worked A1 example below).

**The business rule:** a coupon's discount applies only to the slice of the
reservation it *covers* (`price_per_player × campaign.coveragePlayers`), never to
the whole reservation and never to the campaign's own listed price.
```
eligible_amount  = price_per_player x coupon.coveragePlayers (capped by what's left)
discount         = discountOf(eligible_amount, campaign's %/fixed)
reservation total = (price_per_player x players) − sum of every attached coupon's discount
```
Worked example (exactly the user's A1 case): 30 TND/player, 50% off, coupon
covers 1 player, booking has 4 players → subtotal 120, eligible 30, discount
15, **total 105** — never `120 × 50% = 60`.

### Schema (v7)
* `campaigns.coverage_players INTEGER DEFAULT 1` — how many players a coupon
  from this campaign can cover. Read live via the existing coupon↔campaign
  join, never duplicated onto each coupon row (same pattern as discount fields).
* **`coupon_redemptions`** (new) — the ledger that makes partial/multi-reservation
  coverage possible. One row = one slice of a coupon's coverage consumed by one
  reservation (optionally one participant): `coupon_id, reservation_id,
  participant_id, coverage_consumed, eligible_amount_cents, discount_cents,
  status[RESERVED|CONSUMED|RELEASED], actor_user_id, timestamps`. This is also
  the full audit trail (no separate audit table needed).
* **`reservation_participants`** (new) — optional named players, never forced:
  `reservation_id, name NULL, sort_order`.
* `coupons.reservation_id` (v6) is **superseded**, not removed — new code never
  writes to it; the v7 migration backfills any pre-existing RESERVED/USED coupon
  into a matching ledger row so no in-flight data is lost
  (`migration.test.ts`'s v6→v7 case proves this against a hand-built legacy DB).
* `coupons.status`/`used_at` remain a **maintained cache**, recomputed from the
  ledger after every reserve/release/consume (`CouponService.recomputeCachedStatus`)
  — AVAILABLE (remaining>0), RESERVED (remaining=0, something still pending),
  USED (remaining=0, fully paid). For the common coverage=1 case this behaves
  identically to before; for coverage>1 it's a simplified aggregate signal.
* Remaining coverage is **always computed live** from the ledger
  (`CouponService.coverageState`) — never stored, can't drift.

### Services
* **`CouponService`**: `reserveCoverage`/`releaseCoverage`/`consumeCoverage`/
  `transferCoverage` (reschedule, reprices at the new date's rate)/`coverageState`
  replace the old single-FK `reserveForReservation` etc. `confirmUse`'s CEO
  override now releases *every* reservation currently holding a slice of the
  coupon (there can be more than one). `validate()`'s RESERVED outcome now
  returns `reservations: ReservationSummary[]` (plural — coverage can be split
  across more than one booking at once).
* **`ReservationService`**: a reservation can carry **multiple coupons**.
  `attachCoupon`/`detachCoupon` now take/need a coupon id (not reservation-global);
  coverage granted is capped by both the coupon's own remaining coverage *and*
  this reservation's uncovered player count — that capping is exactly what
  produces partial usage. New `getPriceBreakdown(reservationId)` returns one
  line per attached coupon (Part 10's exact format) — the authoritative,
  always-live view; `reservations.discountCents/finalPriceCents/couponId` stay
  as a maintained cache (`recalculateAggregates`) for simple list/report reads.
  `markAsPaid` now **self-heals**: it recomputes the cache from the live ledger
  immediately before charging, so a reservation is always charged the true
  current amount even if a coupon's state changed via another path — more
  robust than the old "throw and block payment" behavior.
  New `listParticipants`/`setParticipants` (optional names only).
* **`CampaignService`**: `create`/`update` accept `coveragePlayers` (validated,
  defaults to 1).
* **`DangerZoneService`**: reset now also clears `coupon_redemptions` and
  `reservation_participants` (FK order fixed).

### IPC / UI
New channels: `RESERVATION_PRICE_BREAKDOWN`, `RESERVATION_LIST_PARTICIPANTS`,
`RESERVATION_SET_PARTICIPANTS`, `COUPON_COVERAGE_STATE`; `attachCoupon`/`detachCoupon`
signatures changed (coupon id required for detach; optional `{participantId, coverage}`
for attach). `ReservationDetailModal` now shows the full itemized breakdown
(one line per coupon, remove-button per line) and a collapsible optional
participant-name editor. `NewReservation` wizard's coupon panel shows
coverage/remaining/eligible-amount live and computes the discount correctly
(capped preview, server always recomputes authoritatively). `Campaigns.tsx`
gained the coverage picker (1/2/3/4/Custom); `CampaignDetail`/list show it.
`ScanValidate`'s RESERVED card lists every reservation holding a slice.

### Tests
`couponReservationIntegration.test.ts` was fully rewritten around this model —
every example in the spec (Part 2's 1/2/3/4-player coupon math, Part 3's
1+1/2+2/1+3/4-at-once partial sequences, Part 7's multiple-coupons-one-reservation,
Part 8's security/anti-fraud list, Part 9's RESERVED behavior, reservation-flow
cases) has a corresponding passing test (38 tests, all green). Plus a new v6→v7
migration test proving the ledger backfill is lossless against a hand-built
legacy database with real in-flight RESERVED/USED coupons.

### Known gap in this pass
No participant-coupon assignment in the **Walk-in/Advance creation wizard**
itself (only in the post-creation detail modal) — the wizard attaches at most
one coupon at reservation-level during creation; assigning a specific coupon
to a specific named participant, or attaching a second coupon, happens after
creation via `ReservationDetailModal`. This was a deliberate scope choice to
keep the creation flow fast or staff (Part 18's "don't overcomplicate the
common case") while still fully supporting the richer flows where they matter.

## 11. Known gaps / not done

* Everything in §1 marked NOT RUN. Highest risk: first real `npm run build`
  and first launch of the new screens.
* No reservation **print** view and no reservation CSV/PNG beyond the report CSV.
* No refund action (`REFUNDED` exists in the schema only). Single-slot bookings
  only (no multi-hour reservations). Reservation
  reschedule UI (`rescheduleToAdvance`) not exposed. No edit-reservation screen
  (players/notes/time change = cancel + rebook, or reschedule via service).
* Coupon totals on the existing Dashboard/Campaign/Sponsor pages count RESERVED
  coupons in the total but not under Available/Used/Expired/Revoked (so those four
  can sum to less than the total while bookings hold coupons) — with coverage>1
  this also means a partially-used coupon still shows as AVAILABLE in those lists,
  which is correct per §10's cache semantics but worth knowing when reading reports.
* Rebrand is text/logo/hero only — no beach imagery, illustrations, new icon or
  installer artwork.
* Timezone = machine local time; changing the PC clock/zone changes what "today" is.
* No participant-coupon assignment in the Walk-in/Advance creation wizard itself
  (only post-creation, via the reservation detail modal) — see §10's "Known gap
  in this pass" note.
* `qr.reserved_override` has no dedicated IPC channel/button yet — `confirmUse`
  supports the flag and permission exists, but nothing in the UI calls it (by
  design, per §4 — no casual "force use" button).
