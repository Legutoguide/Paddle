import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from './db/connection';
import { getDatabasePath, getLogDir, getDefaultBackupDir } from './appPaths';
import { initLogger, logger } from './logger';
import { registerIpcHandlers, type AppContext } from './ipc/registerHandlers';
import { CouponService } from './services/couponService';
import { SettingsService } from './services/settingsService';
import { BackupService, buildBackupFilename } from './services/backupService';
import { SessionLogService } from './services/sessionLogService';
import { NotificationService } from './services/notificationService';

const isDev = !app.isPackaged;

function resolveIconPath(): string {
  // In development, resources/ lives at the project root. In the packaged
  // app, electron-builder's extraResources copies it under resourcesPath.
  return isDev
    ? path.join(__dirname, '../../resources/icon.png')
    : path.join(process.resourcesPath, 'resources/icon.png');
}

// Single instance lock: prevent two copies of the app from opening the same
// SQLite file concurrently from separate processes.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;
let dbPath: string;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d0d0f',
    show: false,
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Never let the renderer navigate to or open arbitrary external URLs from
  // QR content or anywhere else — open in the OS browser instead, and only
  // for links the app itself explicitly created (e.g. "View documentation").
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  Menu.setApplicationMenu(buildMenu());
}

function buildMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Sponsor QR Manager',
          click: () => {
            mainWindow?.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function reopenDatabase(newDbPath: string): Database.Database {
  db = openDatabase(newDbPath);
  return db;
}

async function maybeRunAutoBackup(currentDb: Database.Database): Promise<void> {
  try {
    const settings = new SettingsService(currentDb).getAll();
    if (!settings.autoBackupEnabled) return;

    const backupDir = getDefaultBackupDir();
    fs.mkdirSync(backupDir, { recursive: true });
    const todayFilename = buildBackupFilename();
    const todayPath = path.join(backupDir, todayFilename);
    if (fs.existsSync(todayPath)) return; // already backed up today

    const existing = fs.readdirSync(backupDir).filter((f) => f.startsWith('sponsor-qr-backup-'));
    if (existing.length > 0) {
      const lastFile = existing.sort().at(-1)!;
      const lastDateStr = lastFile.replace('sponsor-qr-backup-', '').replace('.db', '');
      const lastDate = new Date(lastDateStr);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < settings.autoBackupIntervalDays) return;
    }

    await new BackupService(currentDb).backupTo(todayPath);
    logger.info('Automatic backup created', { path: todayPath });
  } catch (err) {
    logger.error('Automatic backup failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  initLogger(getLogDir());
  logger.info('Application starting', { version: app.getVersion(), isDev });

  dbPath = getDatabasePath();
  db = openDatabase(dbPath);
  logger.info('Database opened', { dbPath });

  // Housekeeping: flip any stale AVAILABLE-but-expired coupons on launch and
  // periodically thereafter, purely cosmetic for list views — validate() and
  // confirmUse() are correct regardless of whether this has run.
  new CouponService(db).sweepExpired();
  setInterval(() => {
    if (db) new CouponService(db).sweepExpired();
  }, 1000 * 60 * 60); // hourly

  // Record this launch as a real session log entry (this app has no user
  // accounts, so this tracks app launches on this device, not per-user logins).
  new SessionLogService(db).record({
    appVersion: app.getVersion(),
    deviceName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
  });

  // Real, data-driven check against actual campaign end dates — never
  // fabricated. Safe to call on every launch; it only notifies once per
  // campaign (see NotificationService.checkExpiringCampaigns).
  new NotificationService(db).checkExpiringCampaigns(3);
  setInterval(() => {
    if (db) new NotificationService(db).checkExpiringCampaigns(3);
  }, 1000 * 60 * 60); // hourly

  createWindow();

  const ctx: AppContext = {
    db,
    mainWindow: mainWindow!,
    dbPath,
    reopenDatabase,
    closeDatabase: () => {
      if (db) {
        closeDatabase(db);
        db = null;
      }
    },
  };
  // Keep ctx.db in sync if restore swaps the connection.
  Object.defineProperty(ctx, 'db', {
    get: () => db,
    set: (value: Database.Database) => {
      db = value;
    },
  });

  registerIpcHandlers(ctx);

  await maybeRunAutoBackup(db);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) closeDatabase(db);
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});
