import type Database from 'better-sqlite3';
import { mapSponsor, type SponsorRow } from '../db/mappers';
import type { Sponsor } from '../../shared/types/domain';
import { AuditService } from './auditService';

export class SponsorValidationError extends Error {}
export class SponsorNotFoundError extends Error {}
export class SponsorHasHistoryError extends Error {}

export interface CreateSponsorInput {
  name: string;
  notes?: string | null;
  logoPath?: string | null;
  photoPath?: string | null;
}

export class SponsorService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  create(input: CreateSponsorInput): Sponsor {
    const name = input.name.trim();
    if (!name) {
      throw new SponsorValidationError('Sponsor name is required');
    }
    const result = this.db
      .prepare(`INSERT INTO sponsors (name, notes, logo_path, photo_path) VALUES (?, ?, ?, ?)`)
      .run(name, input.notes ?? null, input.logoPath ?? null, input.photoPath ?? null);
    this.audit.log('SPONSOR_CREATED', 'sponsor', Number(result.lastInsertRowid), { name });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, input: Partial<CreateSponsorInput>): Sponsor {
    const existing = this.getById(id);
    if (!existing) throw new SponsorNotFoundError(`Sponsor ${id} not found`);

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) throw new SponsorValidationError('Sponsor name is required');

    this.db
      .prepare(
        `UPDATE sponsors SET name = ?, notes = ?, logo_path = ?, photo_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(
        name,
        input.notes !== undefined ? input.notes : existing.notes,
        input.logoPath !== undefined ? input.logoPath : existing.logoPath,
        input.photoPath !== undefined ? input.photoPath : existing.photoPath,
        id
      );
    this.audit.log('SPONSOR_UPDATED', 'sponsor', id, input);
    return this.getById(id)!;
  }

  getById(id: number): Sponsor | null {
    const row = this.db
      .prepare<[number], SponsorRow>(`SELECT * FROM sponsors WHERE id = ?`)
      .get(id);
    return row ? mapSponsor(row) : null;
  }

  list(params: { status?: Sponsor['status']; search?: string } = {}): Sponsor[] {
    let sql = `SELECT * FROM sponsors WHERE 1=1`;
    const args: unknown[] = [];
    if (params.status) {
      sql += ` AND status = ?`;
      args.push(params.status);
    }
    if (params.search) {
      sql += ` AND name LIKE ? COLLATE NOCASE`;
      args.push(`%${params.search}%`);
    }
    sql += ` ORDER BY name COLLATE NOCASE ASC`;
    const rows = this.db.prepare<unknown[], SponsorRow>(sql).all(...args);
    return rows.map(mapSponsor);
  }

  archive(id: number): Sponsor {
    const existing = this.getById(id);
    if (!existing) throw new SponsorNotFoundError(`Sponsor ${id} not found`);
    this.db
      .prepare(
        `UPDATE sponsors SET status = 'ARCHIVED', archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(id);
    this.audit.log('SPONSOR_ARCHIVED', 'sponsor', id, null);
    return this.getById(id)!;
  }

  unarchive(id: number): Sponsor {
    const existing = this.getById(id);
    if (!existing) throw new SponsorNotFoundError(`Sponsor ${id} not found`);
    this.db
      .prepare(
        `UPDATE sponsors SET status = 'ACTIVE', archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(id);
    this.audit.log('SPONSOR_UNARCHIVED', 'sponsor', id, null);
    return this.getById(id)!;
  }

  /**
   * Permanently delete a sponsor. Only allowed when the sponsor has no
   * campaigns/coupons/history at all, to protect business/historical data
   * integrity. Callers should prefer archive() in all other cases.
   */
  deletePermanently(id: number): void {
    const existing = this.getById(id);
    if (!existing) throw new SponsorNotFoundError(`Sponsor ${id} not found`);

    const campaignCount = this.db
      .prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM campaigns WHERE sponsor_id = ?`)
      .get(id)!.c;

    if (campaignCount > 0) {
      throw new SponsorHasHistoryError(
        'This sponsor has campaigns and historical data and cannot be permanently deleted. Archive it instead.'
      );
    }

    this.db.prepare(`DELETE FROM sponsors WHERE id = ?`).run(id);
    this.audit.log('SPONSOR_DELETED', 'sponsor', id, { name: existing.name });
  }

  getStats(id: number): {
    totalCampaigns: number;
    totalCodes: number;
    available: number;
    used: number;
    expired: number;
    revoked: number;
    usageRatePercent: number;
  } {
    const totalCampaigns = this.db
      .prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM campaigns WHERE sponsor_id = ?`)
      .get(id)!.c;

    const counts = this.db
      .prepare<[number], { status: string; c: number }>(
        `SELECT status, COUNT(*) as c FROM coupons WHERE sponsor_id = ? GROUP BY status`
      )
      .all(id);

    const byStatus: Record<string, number> = { AVAILABLE: 0, USED: 0, EXPIRED: 0, REVOKED: 0 };
    let totalCodes = 0;
    for (const row of counts) {
      byStatus[row.status] = row.c;
      totalCodes += row.c;
    }

    const usageRatePercent = totalCodes > 0 ? Math.round((byStatus.USED / totalCodes) * 100) : 0;

    return {
      totalCampaigns,
      totalCodes,
      available: byStatus.AVAILABLE,
      used: byStatus.USED,
      expired: byStatus.EXPIRED,
      revoked: byStatus.REVOKED,
      usageRatePercent,
    };
  }
}
