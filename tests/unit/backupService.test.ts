import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/main/db/connection';
import { SponsorService } from '../../src/main/services/sponsorService';
import { BackupService, restoreDatabase, buildBackupFilename, BackupValidationError } from '../../src/main/services/backupService';

describe('BackupService', () => {
  test('creates a real, valid SQLite backup file on disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-backup-'));
    const dbPath = path.join(tmpDir, 'live.db');
    const db = openDatabase(dbPath);
    new SponsorService(db).create({ name: 'Adam' });

    const backup = new BackupService(db);
    const backupPath = path.join(tmpDir, buildBackupFilename(new Date('2026-09-10')));
    await backup.backupTo(backupPath);

    assert.ok(fs.existsSync(backupPath));
    assert.equal(path.basename(backupPath), 'sponsor-qr-backup-2026-09-10.db');
    assert.ok(BackupService.isLikelySqliteFile(backupPath));

    closeDatabase(db);
  });

  test('refuses to overwrite an existing backup file silently', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-backup-'));
    const dbPath = path.join(tmpDir, 'live.db');
    const db = openDatabase(dbPath);
    const backup = new BackupService(db);
    const backupPath = path.join(tmpDir, 'backup.db');
    await backup.backupTo(backupPath);

    await assert.rejects(() => backup.backupTo(backupPath), BackupValidationError);
    closeDatabase(db);
  });

  test('full backup -> data change -> restore -> original data recovered', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-restore-'));
    const dbPath = path.join(tmpDir, 'live.db');

    let db = openDatabase(dbPath);
    new SponsorService(db).create({ name: 'Adam' });
    const backup = new BackupService(db);
    const backupPath = path.join(tmpDir, 'backup.db');
    await backup.backupTo(backupPath);

    // Simulate more changes happening after the backup was taken.
    new SponsorService(db).create({ name: 'Should Disappear After Restore' });
    assert.equal(new SponsorService(db).list().length, 2);

    closeDatabase(db); // must close before file-level restore, as documented

    const { safetyCopyPath } = restoreDatabase(dbPath, backupPath);
    assert.ok(fs.existsSync(safetyCopyPath), 'a safety copy of pre-restore data must be created');

    db = openDatabase(dbPath);
    const sponsorsAfterRestore = new SponsorService(db).list();
    assert.equal(sponsorsAfterRestore.length, 1);
    assert.equal(sponsorsAfterRestore[0].name, 'Adam');
    closeDatabase(db);
  });

  test('rejects restoring from a non-database file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqr-restore-bad-'));
    const dbPath = path.join(tmpDir, 'live.db');
    const fakeBackup = path.join(tmpDir, 'not-a-db.txt');
    fs.writeFileSync(fakeBackup, 'just some text, not a database');

    assert.throws(() => restoreDatabase(dbPath, fakeBackup), BackupValidationError);
  });
});
