import { app } from 'electron';
import path from 'node:path';

/**
 * All persistent application data lives under Electron's userData directory
 * (e.g. %APPDATA%/SponsorQRManager on Windows), never beside the source code
 * or inside the installed app's program files, so it survives updates and
 * uninstalls behave correctly.
 */
export function getUserDataDir(): string {
  return app.getPath('userData');
}

export function getDatabasePath(): string {
  return path.join(getUserDataDir(), 'data', 'sponsor-qr.db');
}

export function getDefaultBackupDir(): string {
  return path.join(getUserDataDir(), 'backups');
}

export function getDefaultExportDir(): string {
  return path.join(app.getPath('documents'), 'SponsorQR Exports');
}

export function getLogDir(): string {
  return path.join(getUserDataDir(), 'logs');
}
