import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AuditService } from './auditService';
import { NotificationService } from './notificationService';

export class BackupValidationError extends Error {}

/** Build a safe, collision-free backup filename like sponsor-qr-backup-2026-09-10.db */
export function buildBackupFilename(date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `sponsor-qr-backup-${iso}.db`;
}

export class BackupService {
  private audit: AuditService;
  private notifications: NotificationService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  /**
   * Create a consistent backup of the live database using SQLite's built-in
   * online backup API (safe to run while the app is in use; does not lock
   * out concurrent reads/writes for more than the copy duration).
   */
  async backupTo(destinationPath: string): Promise<void> {
    const dir = path.dirname(destinationPath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(destinationPath)) {
      throw new BackupValidationError(
        `A file already exists at ${destinationPath}. Choose a different name to avoid overwriting existing data.`
      );
    }

    try {
      await this.db.backup(destinationPath);
    } catch (err) {
      this.notifications.emit({
        type: 'BACKUP_FAILED',
        title: 'Backup failed',
        message: err instanceof Error ? err.message : 'The backup could not be created.',
      });
      throw err;
    }

    this.audit.log('BACKUP_CREATED', 'database', null, { path: destinationPath });
    this.notifications.emit({
      type: 'BACKUP_COMPLETED',
      title: 'Backup completed',
      message: `Database backed up to ${path.basename(destinationPath)}.`,
    });
  }

  /**
   * Validate that a file looks like a SQLite database before it is used to
   * restore, to avoid corrupting the app with an unrelated/unsafe file.
   */
  static isLikelySqliteFile(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);
      return header.toString('utf-8', 0, 15) === 'SQLite format 3';
    } catch {
      return false;
    }
  }
}

/**
 * Restore the live database from a backup file. This must be called with
 * the live database connection already closed by the caller (the main
 * process orchestrates: close db -> restoreDatabase() -> reopen db), since
 * SQLite file replacement while a connection is open is unsafe.
 *
 * A safety copy of the current live file is made first, so a bad restore
 * attempt can never destroy the only copy of the user's data.
 */
export function restoreDatabase(liveDbPath: string, backupFilePath: string): { safetyCopyPath: string } {
  if (!fs.existsSync(backupFilePath)) {
    throw new BackupValidationError('Backup file not found.');
  }
  if (!BackupService.isLikelySqliteFile(backupFilePath)) {
    throw new BackupValidationError('The selected file does not look like a valid database backup.');
  }

  const safetyCopyPath = `${liveDbPath}.before-restore-${Date.now()}.bak`;
  if (fs.existsSync(liveDbPath)) {
    fs.copyFileSync(liveDbPath, safetyCopyPath);
  }

  fs.copyFileSync(backupFilePath, liveDbPath);

  // Remove stray WAL/SHM files from the previous session so the restored
  // file is opened cleanly rather than replayed against a stale journal.
  for (const suffix of ['-wal', '-shm']) {
    const stale = `${liveDbPath}${suffix}`;
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }

  return { safetyCopyPath };
}
