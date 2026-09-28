import type Database from 'better-sqlite3';

// Session logs record real app-launch events on THIS device. There is no
// user-account system in this offline app, so these are intentionally NOT
// labeled "login logs" for specific users — that would misrepresent what
// the app actually tracks.

export interface SessionLogEntry {
  id: number;
  appVersion: string;
  deviceName: string;
  platform: string;
  startedAt: string;
}

interface SessionLogRow {
  id: number;
  app_version: string;
  device_name: string;
  platform: string;
  started_at: string;
}

function mapRow(row: SessionLogRow): SessionLogEntry {
  return {
    id: row.id,
    appVersion: row.app_version,
    deviceName: row.device_name,
    platform: row.platform,
    startedAt: row.started_at,
  };
}

export class SessionLogService {
  constructor(private db: Database.Database) {}

  record(params: { appVersion: string; deviceName: string; platform: string }): SessionLogEntry {
    const result = this.db
      .prepare(`INSERT INTO session_logs (app_version, device_name, platform) VALUES (?, ?, ?)`)
      .run(params.appVersion, params.deviceName, params.platform);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): SessionLogEntry | null {
    const row = this.db.prepare<[number], SessionLogRow>(`SELECT * FROM session_logs WHERE id = ?`).get(id);
    return row ? mapRow(row) : null;
  }

  list(params: { dateFrom?: string; limit?: number } = {}): SessionLogEntry[] {
    let sql = `SELECT * FROM session_logs WHERE 1=1`;
    const args: unknown[] = [];
    if (params.dateFrom) {
      sql += ` AND started_at >= ?`;
      args.push(params.dateFrom);
    }
    sql += ` ORDER BY started_at DESC`;
    if (params.limit !== undefined) {
      sql += ` LIMIT ?`;
      args.push(params.limit);
    }
    const rows = this.db.prepare<unknown[], SessionLogRow>(sql).all(...args);
    return rows.map(mapRow);
  }
}
