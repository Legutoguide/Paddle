import type Database from 'better-sqlite3';
import { mapCampaign, type CampaignRow } from '../db/mappers';
import type { Campaign, DiscountType } from '../../shared/types/domain';
import { calculatePrice, toCents } from '../../shared/lib/pricing';
import { AuditService } from './auditService';
import { SponsorService, SponsorNotFoundError } from './sponsorService';
import { NotificationService } from './notificationService';

export class CampaignValidationError extends Error {}
export class CampaignNotFoundError extends Error {}
export class CampaignHasCodesError extends Error {}

export interface CreateCampaignInput {
  sponsorId: number;
  campaignName: string;
  serviceName: string;
  duration?: string | null;
  discountType?: DiscountType;
  originalPrice: number; // decimal, e.g. 100.00
  discountPercentage?: number; // 0-100
  discountAmount?: number; // decimal, used when discountType === 'FIXED'
  imagePath?: string | null;
  bannerPath?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export class CampaignService {
  private audit: AuditService;
  private sponsors: SponsorService;
  private notifications: NotificationService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
    this.sponsors = new SponsorService(db);
    this.notifications = new NotificationService(db);
  }

  private validateInput(input: CreateCampaignInput): void {
    if (!input.campaignName?.trim()) throw new CampaignValidationError('Campaign name is required');
    if (!input.serviceName?.trim()) throw new CampaignValidationError('Service/duration name is required');
    if (input.originalPrice === undefined || input.originalPrice < 0)
      throw new CampaignValidationError('Original price must be zero or greater');
    if (input.startDate && input.endDate && input.startDate > input.endDate) {
      throw new CampaignValidationError('Start date must be before end date');
    }
    const sponsor = this.sponsors.getById(input.sponsorId);
    if (!sponsor) throw new SponsorNotFoundError(`Sponsor ${input.sponsorId} not found`);
  }

  create(input: CreateCampaignInput): Campaign {
    this.validateInput(input);
    const discountType: DiscountType = input.discountType ?? 'PERCENTAGE';
    const originalPriceCents = toCents(input.originalPrice);

    const breakdown = calculatePrice({
      originalPriceCents,
      discountType,
      discountPercentage: input.discountPercentage,
      discountAmountCents: input.discountAmount !== undefined ? toCents(input.discountAmount) : undefined,
    });

    const result = this.db
      .prepare(
        `INSERT INTO campaigns
          (sponsor_id, campaign_name, service_name, duration, discount_type,
           original_price_cents, discount_percentage, discount_amount_cents,
           final_price_cents, image_path, banner_path, start_date, end_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sponsorId,
        input.campaignName.trim(),
        input.serviceName.trim(),
        input.duration ?? null,
        discountType,
        breakdown.originalPriceCents,
        breakdown.discountPercentage,
        breakdown.discountAmountCents,
        breakdown.finalPriceCents,
        input.imagePath ?? null,
        input.bannerPath ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
        input.notes ?? null
      );

    const id = Number(result.lastInsertRowid);
    this.audit.log('CAMPAIGN_CREATED', 'campaign', id, {
      campaignName: input.campaignName,
      sponsorId: input.sponsorId,
    });
    this.notifications.emit({
      type: 'CAMPAIGN_CREATED',
      title: 'New campaign created',
      message: `"${input.campaignName}" was created.`,
      entity: 'campaign',
      entityId: id,
    });
    return this.getById(id)!;
  }

  update(id: number, input: Partial<CreateCampaignInput>): Campaign {
    const existing = this.getById(id);
    if (!existing) throw new CampaignNotFoundError(`Campaign ${id} not found`);

    const discountType = input.discountType ?? existing.discountType;
    const originalPriceCents =
      input.originalPrice !== undefined ? toCents(input.originalPrice) : existing.originalPriceCents;
    const discountPercentage = input.discountPercentage ?? existing.discountPercentage;
    const discountAmountCents =
      input.discountAmount !== undefined ? toCents(input.discountAmount) : existing.discountAmountCents;

    const breakdown = calculatePrice({
      originalPriceCents,
      discountType,
      discountPercentage,
      discountAmountCents,
    });

    this.db
      .prepare(
        `UPDATE campaigns SET
          campaign_name = ?, service_name = ?, duration = ?, discount_type = ?,
          original_price_cents = ?, discount_percentage = ?, discount_amount_cents = ?,
          final_price_cents = ?, image_path = ?, banner_path = ?, start_date = ?, end_date = ?, notes = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      )
      .run(
        input.campaignName?.trim() ?? existing.campaignName,
        input.serviceName?.trim() ?? existing.serviceName,
        input.duration !== undefined ? input.duration : existing.duration,
        discountType,
        breakdown.originalPriceCents,
        breakdown.discountPercentage,
        breakdown.discountAmountCents,
        breakdown.finalPriceCents,
        input.imagePath !== undefined ? input.imagePath : existing.imagePath,
        input.bannerPath !== undefined ? input.bannerPath : existing.bannerPath,
        input.startDate !== undefined ? input.startDate : existing.startDate,
        input.endDate !== undefined ? input.endDate : existing.endDate,
        input.notes !== undefined ? input.notes : existing.notes,
        id
      );

    this.audit.log('CAMPAIGN_UPDATED', 'campaign', id, input);
    return this.getById(id)!;
  }

  getById(id: number): Campaign | null {
    const row = this.db
      .prepare<[number], CampaignRow>(`SELECT * FROM campaigns WHERE id = ?`)
      .get(id);
    return row ? mapCampaign(row) : null;
  }

  list(params: { sponsorId?: number; status?: Campaign['status']; search?: string } = {}): Campaign[] {
    let sql = `SELECT * FROM campaigns WHERE 1=1`;
    const args: unknown[] = [];
    if (params.sponsorId) {
      sql += ` AND sponsor_id = ?`;
      args.push(params.sponsorId);
    }
    if (params.status) {
      sql += ` AND status = ?`;
      args.push(params.status);
    }
    if (params.search) {
      sql += ` AND (campaign_name LIKE ? COLLATE NOCASE OR service_name LIKE ? COLLATE NOCASE)`;
      args.push(`%${params.search}%`, `%${params.search}%`);
    }
    sql += ` ORDER BY created_at DESC`;
    const rows = this.db.prepare<unknown[], CampaignRow>(sql).all(...args);
    return rows.map(mapCampaign);
  }

  archive(id: number): Campaign {
    const existing = this.getById(id);
    if (!existing) throw new CampaignNotFoundError(`Campaign ${id} not found`);
    this.db
      .prepare(
        `UPDATE campaigns SET status = 'ARCHIVED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(id);
    this.audit.log('CAMPAIGN_ARCHIVED', 'campaign', id, null);
    return this.getById(id)!;
  }

  unarchive(id: number): Campaign {
    const existing = this.getById(id);
    if (!existing) throw new CampaignNotFoundError(`Campaign ${id} not found`);
    this.db
      .prepare(
        `UPDATE campaigns SET status = 'ACTIVE', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(id);
    this.audit.log('CAMPAIGN_UNARCHIVED', 'campaign', id, null);
    return this.getById(id)!;
  }

  deletePermanently(id: number): void {
    const existing = this.getById(id);
    if (!existing) throw new CampaignNotFoundError(`Campaign ${id} not found`);

    const codeCount = this.db
      .prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM coupons WHERE campaign_id = ?`)
      .get(id)!.c;

    if (codeCount > 0) {
      throw new CampaignHasCodesError(
        'This campaign has generated codes and cannot be permanently deleted. Archive it instead.'
      );
    }

    this.db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(id);
    this.audit.log('CAMPAIGN_DELETED', 'campaign', id, { campaignName: existing.campaignName });
  }

  getStats(id: number): {
    totalCodes: number;
    available: number;
    used: number;
    expired: number;
    revoked: number;
  } {
    const counts = this.db
      .prepare<[number], { status: string; c: number }>(
        `SELECT status, COUNT(*) as c FROM coupons WHERE campaign_id = ? GROUP BY status`
      )
      .all(id);
    const byStatus: Record<string, number> = { AVAILABLE: 0, USED: 0, EXPIRED: 0, REVOKED: 0 };
    let totalCodes = 0;
    for (const row of counts) {
      byStatus[row.status] = row.c;
      totalCodes += row.c;
    }
    return {
      totalCodes,
      available: byStatus.AVAILABLE,
      used: byStatus.USED,
      expired: byStatus.EXPIRED,
      revoked: byStatus.REVOKED,
    };
  }
}
