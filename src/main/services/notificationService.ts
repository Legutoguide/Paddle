import type Database from 'better-sqlite3';

export type NotificationType =
  | 'QR_REDEEMED'
  | 'CAMPAIGN_CREATED'
  | 'BATCH_GENERATED'
  | 'CAMPAIGN_EXPIRING'
  | 'BACKUP_COMPLETED'
  | 'BACKUP_FAILED'
  | 'RESTORE_COMPLETED'
  | 'DATA_RESET'
  | 'RESERVATION_CREATED'
  | 'RESERVATION_PAID'
  | 'RESERVATION_CANCELLED';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  entity: string | null;
  entityId: number | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  message: string;
  entity: string | null;
  entity_id: number | null;
  read_at: string | null;
  created_at: string;
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    entity: row.entity,
    entityId: row.entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class NotificationService {
  constructor(private db: Database.Database) {}

  /**
   * Record a real event that already happened elsewhere in the app. Never
   * call this speculatively or to "fill" the notification center — only
   * from the exact code path where the underlying action actually occurred.
   */
  emit(params: {
    type: NotificationType;
    title: string;
    message: string;
    entity?: string | null;
    entityId?: number | null;
  }): AppNotification {
    const result = this.db
      .prepare(
        `INSERT INTO notifications (type, title, message, entity, entity_id) VALUES (?, ?, ?, ?, ?)`
      )
      .run(params.type, params.title, params.message, params.entity ?? null, params.entityId ?? null);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): AppNotification | null {
    const row = this.db.prepare<[number], NotificationRow>(`SELECT * FROM notifications WHERE id = ?`).get(id);
    return row ? mapNotification(row) : null;
  }

  list(params: { unreadOnly?: boolean; limit?: number } = {}): AppNotification[] {
    let sql = `SELECT * FROM notifications WHERE 1=1`;
    const args: unknown[] = [];
    if (params.unreadOnly) {
      sql += ` AND read_at IS NULL`;
    }
    sql += ` ORDER BY created_at DESC`;
    if (params.limit !== undefined) {
      sql += ` LIMIT ?`;
      args.push(params.limit);
    }
    const rows = this.db.prepare<unknown[], NotificationRow>(sql).all(...args);
    return rows.map(mapNotification);
  }

  unreadCount(): number {
    return this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL`)
      .get()!.c;
  }

  markRead(id: number): void {
    this.db
      .prepare(`UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND read_at IS NULL`)
      .run(id);
  }

  markAllRead(): void {
    this.db.prepare(`UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE read_at IS NULL`).run();
  }

  clearAll(): void {
    this.db.prepare(`DELETE FROM notifications`).run();
  }

  /**
   * Real, data-driven check: emit a CAMPAIGN_EXPIRING notification for any
   * active campaign ending within `withinDays` that hasn't already been
   * notified about. Safe to call repeatedly (e.g. on app launch / hourly) —
   * it only emits once per campaign by checking for an existing
   * notification with the same entity/entityId.
   */
  checkExpiringCampaigns(withinDays = 3): void {
    const soon = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const expiring = this.db
      .prepare<[string, string], { id: number; campaign_name: string; end_date: string }>(
        `SELECT id, campaign_name, end_date FROM campaigns
         WHERE status = 'ACTIVE' AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ?`
      )
      .all(today, soon);

    for (const campaign of expiring) {
      const already = this.db
        .prepare<[string], { c: number }>(
          `SELECT COUNT(*) as c FROM notifications WHERE type = 'CAMPAIGN_EXPIRING' AND entity = 'campaign' AND entity_id = ?`
        )
        .get(String(campaign.id));
      if (already && already.c > 0) continue;

      this.emit({
        type: 'CAMPAIGN_EXPIRING',
        title: 'Campaign expiring soon',
        message: `"${campaign.campaign_name}" ends on ${campaign.end_date}.`,
        entity: 'campaign',
        entityId: campaign.id,
      });
    }
  }
}
