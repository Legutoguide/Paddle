import type Database from 'better-sqlite3';
import { AuditService } from './auditService';

export interface Batch {
  id: number;
  batchCode: string;
  campaignId: number;
  sponsorId: number;
  quantity: number;
  prefix: string | null;
  expiresAt: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  notes: string | null;
  createdAt: string;
}

export interface BatchWithDetails extends Batch {
  sponsorName: string;
  campaignName: string;
  available: number;
  used: number;
  expired: number;
  revoked: number;
}

interface BatchRow {
  id: number;
  batch_code: string;
  campaign_id: number;
  sponsor_id: number;
  quantity: number;
  prefix: string | null;
  expires_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

function mapBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    batchCode: row.batch_code,
    campaignId: row.campaign_id,
    sponsorId: row.sponsor_id,
    quantity: row.quantity,
    prefix: row.prefix,
    expiresAt: row.expires_at,
    status: row.status as Batch['status'],
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/** Build a batch code like B-2026-0001, unique and sortable by year. */
function buildBatchCode(db: Database.Database): string {
  const year = new Date().getFullYear();
  const row = db
    .prepare<[string], { c: number }>(`SELECT COUNT(*) as c FROM batches WHERE batch_code LIKE ?`)
    .get(`B-${year}-%`)!;
  const seq = String(row.c + 1).padStart(4, '0');
  return `B-${year}-${seq}`;
}

export class BatchService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Create a batch record. Called by CouponService.generateCodes() as part
   * of its own transaction — this method does not open its own transaction
   * so it composes safely inside the caller's.
   */
  create(params: {
    campaignId: number;
    sponsorId: number;
    quantity: number;
    prefix?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
  }): Batch {
    const batchCode = buildBatchCode(this.db);
    const result = this.db
      .prepare(
        `INSERT INTO batches (batch_code, campaign_id, sponsor_id, quantity, prefix, expires_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        batchCode,
        params.campaignId,
        params.sponsorId,
        params.quantity,
        params.prefix ?? null,
        params.expiresAt ?? null,
        params.notes ?? null
      );

    this.audit.log('BATCH_CREATED', 'batch', Number(result.lastInsertRowid), {
      batchCode,
      quantity: params.quantity,
    });

    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): Batch | null {
    const row = this.db.prepare<[number], BatchRow>(`SELECT * FROM batches WHERE id = ?`).get(id);
    return row ? mapBatch(row) : null;
  }

  list(params: { campaignId?: number; sponsorId?: number; status?: Batch['status'] } = {}): BatchWithDetails[] {
    let where = ` WHERE 1=1`;
    const args: unknown[] = [];
    if (params.campaignId) {
      where += ` AND b.campaign_id = ?`;
      args.push(params.campaignId);
    }
    if (params.sponsorId) {
      where += ` AND b.sponsor_id = ?`;
      args.push(params.sponsorId);
    }
    if (params.status) {
      where += ` AND b.status = ?`;
      args.push(params.status);
    }

    const rows = this.db
      .prepare<
        unknown[],
        BatchRow & { sponsor_name: string; campaign_name: string; available: number; used: number; expired: number; revoked: number }
      >(
        `SELECT b.*, s.name as sponsor_name, cm.campaign_name as campaign_name,
                SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN c.status = 'USED' THEN 1 ELSE 0 END) as used,
                SUM(CASE WHEN c.status = 'EXPIRED' THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN c.status = 'REVOKED' THEN 1 ELSE 0 END) as revoked
         FROM batches b
         JOIN sponsors s ON s.id = b.sponsor_id
         JOIN campaigns cm ON cm.id = b.campaign_id
         LEFT JOIN coupons c ON c.batch_id = b.id
         ${where}
         GROUP BY b.id
         ORDER BY b.created_at DESC`
      )
      .all(...args);

    return rows.map((row) => ({
      ...mapBatch(row),
      sponsorName: row.sponsor_name,
      campaignName: row.campaign_name,
      available: row.available ?? 0,
      used: row.used ?? 0,
      expired: row.expired ?? 0,
      revoked: row.revoked ?? 0,
    }));
  }

  archive(id: number): Batch {
    this.db
      .prepare(`UPDATE batches SET status = 'ARCHIVED' WHERE id = ?`)
      .run(id);
    this.audit.log('BATCH_ARCHIVED', 'batch', id, null);
    return this.getById(id)!;
  }
}
