# Sponsor QR Manager

A local, fully offline desktop application for managing sponsors, promotional
campaigns, discount coupons, and QR codes. Built with Electron, React,
TypeScript, and SQLite.

No internet connection is required for any core feature: creating sponsors,
campaigns, generating codes/QR codes, scanning, validating, using coupons,
importing, exporting, printing, or backing up/restoring the database.

---

## 1. Requirements for development

- Node.js 18+ (tested with Node 22)
- npm 9+
- Windows, macOS, or Linux for development (the packaged output currently
  targets **Windows** per the project's `electron-builder.json`)
- On Linux, packaging a Windows `.exe` requires **Wine** (see §6). On Windows,
  no extra tooling is needed.

## 2. Installation

```bash
npm install
```

This installs all dependencies, including the native `better-sqlite3` module
(automatically compiled for your current platform/Node version — this is
fine for `npm run dev`/`npm test`; packaging rebuilds it again for Electron).

## 3. Running in development mode

```bash
npm run dev:renderer   # Terminal 1 — starts the Vite dev server
npm run dev:main       # Terminal 2 — compiles the Electron main process (watch mode)
npm start              # Terminal 3 — launches Electron once both are built once
```

In development, the app loads the renderer from the Vite dev server
(hot-reloading) and opens DevTools automatically.

## 4. Running tests

```bash
npm test
```

Runs the full automated test suite (Node's built-in test runner + `tsx`)
against the business logic layer — pricing, code generation, sponsor and
campaign services, coupon validation/consumption (including double-use
prevention and simulated race conditions), QR generation (with a real
decode round-trip), PDF export (validated as a real file), CSV import/export,
and backup/restore (a full on-disk cycle). All 59 tests should pass.

## 5. Building for production

```bash
npm run build
```

Compiles the renderer (Vite) to `dist/renderer` and the main process
(TypeScript) to `dist/main`, and copies `schema.sql` into the compiled output.

## 6. Creating the Windows installer

```bash
npm run package:win           # NSIS installer + portable .exe
npm run package:win:portable  # portable .exe only
```

This runs the production build, rebuilds `better-sqlite3` for Electron's
Windows x64 runtime (scoped to that one native module only — see the
packaging notes below for why), and packages everything with
`electron-builder` into `release/`:

- `Sponsor QR Manager Setup <version>.exe` — the installer
- `Sponsor QR Manager Portable.exe` — a single portable executable

**On Windows**, this just works — run the command in a terminal (PowerShell
or Command Prompt) from the project folder. No other setup is required.

**On Linux**, `electron-builder` needs Wine to embed the icon/version info
into the Windows executable. Install it once with:

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install --no-install-recommends wine64 wine wine32:i386
export WINEPREFIX=$HOME/.wine
export WINEARCH=win64
wineboot --init
```

Then run `npm run package:win` as above.

**On macOS**, install Wine via Homebrew (`brew install --cask wine-stable`)
before packaging for Windows.

### Packaging architecture notes (read this if you touch packaging config)

Two real, verified issues were found and fixed after a genuine Windows
installation crashed with `Cannot find module 'call-bind-apply-helpers'`
(a transitive dependency of `pdfkit` → `fontkit`). Both fixes are permanent,
reproducible parts of the build configuration, not one-off patches:

1. **The main process is bundled with esbuild** (`scripts/build-main.js` /
   `scripts/watch-main.js`) into a single `dist/main/main.js`, inlining
   every pure-JS dependency (`qrcode`, `papaparse`, `zod`, `date-fns`,
   `nanoid`, and all their transitive deps). Only `electron` (provided by
   the runtime), `better-sqlite3` (native, can't be bundled into JS), and
   `pdfkit` (loads its own font metrics files from disk by relative path,
   which breaks if bundled — see below) stay external. This removes an
   entire class of "electron-builder mishandled node_modules" risk for
   everything except those three packages.

2. **`asar: false`, plus a custom `afterPack` hook**
   (`scripts/afterPack.js`). Independently of the change above, we found
   that electron-builder's own file-copy step (with or without asar
   enabled) has a real bug: for npm packages that are hoisted to the root
   `node_modules` and shared by several sibling dependencies (confirmed
   with `call-bind-apply-helpers`, needed by `call-bind`, `get-intrinsic`,
   `dunder-proto`, and `call-bound` — plus 11 other unrelated packages
   found the same way, including `yargs`, `wrap-ansi`, and `p-limit`),
   electron-builder sometimes keeps the package nested under only ONE
   consumer and drops the root copy the others need. The `afterPack` hook
   walks the packaged `node_modules` tree after electron-builder finishes,
   and for every package that exists anywhere in that tree but isn't also
   reachable at the root, copies it up — restoring npm's normal hoisting
   invariant. It only ever touches packages electron-builder already
   decided to include, so it cannot accidentally pull in unrelated
   devDependencies.

   `better-sqlite3`'s native binary is rebuilt for Electron's Windows ABI
   in a scoped, targeted way (`scripts/rebuild-native-win.js`, using
   `@electron/rebuild`'s programmatic API against a single module) instead
   of relying on electron-builder's built-in `npmRebuild` step — the
   original crash investigation found that broad step was *also* capable of
   restructuring the whole `node_modules` tree as a side effect of
   rebuilding one native module, which is a second way the same class of
   bug could reappear. `npmRebuild: false` in `electron-builder.json`
   disables that broad step permanently.

If you add a new dependency that ends up needing files from disk at
runtime (like `pdfkit`'s font metrics), add it to the `external` array in
both `scripts/build-main.js` and `scripts/watch-main.js`.

## 7. Where the database is stored

The live SQLite database lives in the OS-appropriate application data
directory (never beside the source code), so it survives app updates:

- Windows: `%APPDATA%\Sponsor QR Manager\data\sponsor-qr.db`
- macOS: `~/Library/Application Support/Sponsor QR Manager/data/sponsor-qr.db`
- Linux: `~/.config/Sponsor QR Manager/data/sponsor-qr.db`

Application logs live alongside it, in a sibling `logs/` folder.

## 8. Where backups are stored

By default, backups go to a `backups/` folder next to the database (same
parent directory as above). You can also choose a custom destination each
time you click **Backup Database Now** in Settings. Automatic backups (if
enabled in Settings) run once per day, no more often than your configured
interval.

## 9. How to restore a backup

Settings → Backup & Restore → **Restore from Backup…**, then pick a `.db`
backup file. The app validates that the file is really a SQLite database
before touching anything, makes a safety copy of your *current* database
first, then restores. The app reloads automatically afterward.

## 10. How to create a sponsor

Sponsors page → **New Sponsor** → enter a name (and optional notes) → Create.

## 11. How to create a campaign

Campaigns page → **New Campaign** → pick a sponsor, name the campaign, set
the service/duration, original price and discount percentage (final price
and savings update live), optionally set a validity window and code prefix
→ Continue → review the confirmation summary → **Generate N Codes**.

## 12. How to generate codes

From a campaign's detail page, click **Generate Codes** to add more codes to
an existing campaign at any time (independent of the initial creation flow).

## 13. How to export QR codes

QR Codes page → select one or more codes (checkboxes) → **Export** (CSV) or
**Print** (a professional, ready-to-print A4 PDF sheet, 6 coupons per page,
with QR + code + sponsor + discount + price + expiry, and generous quiet
space around each QR so it stays scannable after printing).

## 14. How an employee scans a coupon

Scan / Validate page → point the camera at the customer's QR code. The app
shows sponsor, campaign, price and discount — scanning **never** marks a
coupon as used by itself. The employee reviews the details and taps
**Confirm Use** to actually redeem it.

## 15. How manual code entry works

On the same Scan / Validate page, type the code into the manual entry field
and press **Validate** — used automatically whenever no camera is available,
or as a fallback if scanning fails.

## 16. How to revoke a code

QR Codes page → find the code → the revoke (⊘) icon (available for
AVAILABLE/EXPIRED codes only) → confirm. Revoked codes can never be used
again, and the record is kept for history/audit purposes.

## 17. How expiration works

Each coupon can have an expiration date (inherited from the campaign's end
date, or overridden per-batch at generation time). Expiration is checked
**dynamically** in the validation/consumption logic itself — not just in the
UI — so an expired coupon is always rejected even if a background sweep
hasn't run recently.

## 18. How to export history

History page → apply any filters you want (search, sponsor, date range) →
**Export CSV**.

## 19. How to backup the application

Settings → **Backup Database Now**. Choose a destination or accept the
default (`backups/sponsor-qr-backup-YYYY-MM-DD.db`).

## 20. Troubleshooting

- **"Unable to create the coupons. No changes were saved."** — the batch
  failed validation or hit an internal error; nothing was written to the
  database (all-or-nothing transactions), so it's safe to just try again.
- **Camera doesn't show anything on the Scan page** — grant camera
  permission when your OS prompts for it, or use manual code entry, which is
  always available.
- **App won't start after a Windows update** — check the log file in the
  `logs/` folder next to the database (see §7) for details.
- **Need a clean slate** — close the app, rename/move the `data/` folder
  (see §7) elsewhere, and relaunch; the first-run setup screen will appear
  again and a brand-new empty database will be created.

---

## Project structure

```
src/
  main/            Electron main process: db, services, IPC handlers
    db/            SQLite schema + connection + row mappers
    services/      Business logic (sponsors, campaigns, coupons, QR, PDF, CSV, backup, stats, audit, settings)
    ipc/           IPC channel handlers (the only bridge to the renderer)
  preload/         contextBridge-based, typed preload script
  renderer/        React + Vite + Tailwind UI
    src/pages/     One file per screen (Dashboard, Sponsors, Campaigns, Coupons, Scan/Validate, History, Settings…)
    src/components/  Reusable UI (Modal, ConfirmDialog, StatusBadge, ScannerCamera…)
    src/lib/       Settings context, shared client-side helpers
  shared/          Code shared between main and renderer (domain types, pricing, code generator, IPC contract)
tests/unit/        Automated tests (Node test runner + tsx)
resources/         App icon assets (png/ico)
scripts/           Build helper scripts (asset copying, icon generation)
electron-builder.json   Packaging configuration
```

## Dependencies (all explicit, no hidden magic)

Runtime: `better-sqlite3`, `qrcode`, `jsqr`, `pdfkit`, `papaparse`, `zod`,
`date-fns`, `nanoid`, `react`, `react-dom`, `react-router-dom`, `lucide-react`.

Dev/build: `electron`, `electron-builder`, `vite`, `@vitejs/plugin-react`,
`typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `tsx`, plus `@types/*`
packages for the above.

## Security notes

- Renderer runs with `contextIsolation: true` and `nodeIntegration: false`;
  the only way it can reach Node/the database is through the explicit,
  typed `preload` bridge — never a generic passthrough.
- All SQL uses parameterized queries (via `better-sqlite3`'s prepared
  statements) — no string-concatenated SQL anywhere.
- QR codes encode the bare coupon code only, never a URL; the scanner never
  opens or navigates to scanned content.
- Coupon consumption uses a conditional `UPDATE ... WHERE status =
  'AVAILABLE'` inside a transaction, so concurrent redemption attempts can
  never double-spend a coupon.
