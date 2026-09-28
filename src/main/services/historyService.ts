import type Database from 'better-sqlite3';
import { mapUsageHistory, type UsageHistoryRow } from '../db/mappers';
import type { UsageHistoryEntry } from '../../shared/types/domain';

export interface HistoryFilter {
  search?: string;
  sponsorId?: number;
  campaignId?: number;
  dateFrom?: string; // ISO date
  dateTo?: string; // ISO date
  limit?: number;
  offset?: number;
}

export class HistoryService {
  constructor(private db: Database.Database) {}

  list(filter: HistoryFilter = {}): { items: UsageHistoryEntry[]; total: number } {
    let where = ` WHERE 1=1`;
    const args: unknown[] = [];

    if (filter.search) {
      where += ` AND (code LIKE ? COLLATE NOCASE OR sponsor_name LIKE ? COLLATE NOCASE OR campaign_name LIKE ? COLLATE NOCASE)`;
      args.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.sponsorId) {
      where += ` AND sponsor_id = ?`;
      args.push(filter.sponsorId);
    }
    if (filter.campaignId) {
      where += ` AND campaign_id = ?`;
      args.push(filter.campaignId);
    }
    if (filter.dateFrom) {
      where += ` AND used_at >= ?`;
      args.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      where += ` AND used_at <= ?`;
      args.push(filter.dateTo);
    }

    const total = this.db
      .prepare<unknown[], { c: number }>(`SELECT COUNT(*) as c FROM usage_history ${where}`)
      .get(...args)!.c;

    let sql = `SELECT * FROM usage_history ${where} ORDER BY used_at DESC`;
    if (filter.limit !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      args.push(filter.limit, filter.offset ?? 0);
    }

    const rows = this.db.prepare<unknown[], UsageHistoryRow>(sql).all(...args);
    return { items: rows.map(mapUsageHistory), total };
  }
}
