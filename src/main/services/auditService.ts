import type Database from 'better-sqlite3';
import { mapAuditLog, type AuditLogRow } from '../db/mappers';
import type { AuditLogEntry } from '../../shared/types/domain';

export class AuditService {
  constructor(private db: Database.Database) {}

  /** Record an administrative action. Safe to call inside an outer transaction. */
  log(action: string, entity: string, entityId: number | null, details?: unknown): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (action, entity, entity_id, details) VALUES (?, ?, ?, ?)`
      )
      .run(action, entity, entityId, details !== undefined ? JSON.stringify(details) : null);
  }

  list(limit = 200): AuditLogEntry[] {
    const rows = this.db
      .prepare<[number], AuditLogRow>(
        `SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(limit);
    return rows.map(mapAuditLog);
  }
}
