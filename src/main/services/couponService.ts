import type Database from 'better-sqlite3';
import { mapCoupon, mapCouponWithDetails, type CouponRow, type CouponWithDetailsRow } from '../db/mappers';
import type { Coupon, CouponWithDetails, ValidationResult, CouponStatus, ReservationStatus } from '../../shared/types/domain';
import { generateUniqueCodes } from '../../shared/lib/codeGenerator';
import { AuditService } from './auditService';
import { CampaignService, CampaignNotFoundError } from './campaignService';
import { BatchService } from './batchService';
import { NotificationService } from './notificationService';

export class CouponValidationError extends Error {}
export class CouponNotFoundError extends Error {}
export class CouponConflictError extends Error {}

export interface GenerateCodesInput {
  campaignId: number;
  count: number;
  prefix?: string;
  expiresAt?: string | null;
  branchId?: number | null;
}

const DETAILS_JOIN = `
  SELECT c.*, s.name as sponsor_name, s.logo_path as sponsor_logo_path,
         cm.campaign_name as campaign_name, cm.image_path as campaign_image_path,
         cm.banner_path as campaign_banner_path,
         cm.service_name as service_name, cm.duration as duration,
         cm.original_price_cents as original_price_cents,
         cm.discount_percentage as discount_percentage,
         cm.discount_amount_cents as discount_amount_cents,
         cm.discount_type as discount_type,
         cm.final_price_cents as final_price_cents,
         cm.status as campaign_status
  FROM coupons c
  JOIN sponsors s ON s.id = c.sponsor_id
  JOIN campaigns cm ON cm.id = c.campaign_id
`;

export class CouponService {
  private audit: AuditService;
  private campaigns: CampaignService;
  private batches: BatchService;
  private notifications: NotificationService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
    this.campaigns = new CampaignService(db);
    this.batches = new BatchService(db);
    this.notifications = new NotificationService(db);
  }

  /**
   * Generate a batch of unique coupon codes for a campaign inside a single
   * transaction. Either all codes are created, or none are (rolled back).
   */
  generateCodes(input: GenerateCodesInput): Coupon[] {
    if (!Number.isInteger(input.count) || input.count <= 0) {
      throw new CouponValidationError('Number of codes must be a positive integer');
    }
    if (input.count > 100000) {
      throw new CouponValidationError('Number of codes exceeds the maximum supported batch size');
    }

    const campaign = this.campaigns.getById(input.campaignId);
    if (!campaign) throw new CampaignNotFoundError(`Campaign ${input.campaignId} not found`);

    const existsStmt = this.db.prepare<[string], { c: number }>(
      `SELECT COUNT(*) as c FROM coupons WHERE code = ?`
    );

    const runBatch = this.db.transaction((count: number) => {
      const codes = generateUniqueCodes({
        count,
        prefix: input.prefix,
        existsFn: (code) => existsStmt.get(code)!.c > 0,
      });

      const batch = this.batches.create({
        campaignId: campaign.id,
        sponsorId: campaign.sponsorId,
        quantity: codes.length,
        prefix: input.prefix ?? null,
        expiresAt: input.expiresAt ?? campaign.endDate ?? null,
      });

      const insert = this.db.prepare(
        `INSERT INTO coupons (campaign_id, sponsor_id, code, display_seq, expires_at, batch_id, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      const created: Coupon[] = [];
      codes.forEach((code, index) => {
        const result = insert.run(
          campaign.id,
          campaign.sponsorId,
          code,
          index + 1,
          input.expiresAt ?? campaign.endDate ?? null,
          batch.id,
          input.branchId ?? null
        );
        created.push(this.getById(Number(result.lastInsertRowid))!);
      });

      this.db
        .prepare(
          `UPDATE campaigns SET total_codes = total_codes + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(codes.length, campaign.id);

      this.audit.log('CODES_GENERATED', 'campaign', campaign.id, {
        count: codes.length,
        prefix: input.prefix ?? null,
        batchId: batch.id,
      });

      this.notifications.emit({
        type: 'BATCH_GENERATED',
        title: 'QR batch generated',
        message: `${codes.length} code(s) generated for "${campaign.campaignName}" (batch ${batch.batchCode}).`,
        entity: 'batch',
        entityId: batch.id,
      });

      return created;
    });

    try {
      return runBatch(input.count);
    } catch (err) {
      // better-sqlite3 automatically rolls back the transaction on throw.
      throw new CouponValidationError(
        err instanceof Error
          ? `Unable to create the coupons. No changes were saved. (${err.message})`
          : 'Unable to create the coupons. No changes were saved.'
      );
    }
  }

  /**
   * Import a batch of already-validated, already-unique codes (e.g. from a
   * CSV import preview the user confirmed) into a campaign. All-or-nothing,
   * same transactional guarantee as generateCodes(). Callers are expected to
   * have already run these codes through parseImportCsv() to exclude
   * duplicates/invalid/already-existing entries.
   */
  importCodes(campaignId: number, codes: string[], expiresAt?: string | null): Coupon[] {
    if (codes.length === 0) throw new CouponValidationError('No codes to import');

    const campaign = this.campaigns.getById(campaignId);
    if (!campaign) throw new CampaignNotFoundError(`Campaign ${campaignId} not found`);

    const runImport = this.db.transaction((list: string[]) => {
      const existsStmt = this.db.prepare<[string], { c: number }>(`SELECT COUNT(*) as c FROM coupons WHERE code = ?`);
      const insert = this.db.prepare(
        `INSERT INTO coupons (campaign_id, sponsor_id, code, display_seq, expires_at) VALUES (?, ?, ?, ?, ?)`
      );
      const created: Coupon[] = [];
      list.forEach((code, index) => {
        const normalized = code.trim().toUpperCase();
        if (existsStmt.get(normalized)!.c > 0) {
          throw new CouponValidationError(`Code ${normalized} already exists. Import aborted, no changes were saved.`);
        }
        const result = insert.run(campaignId, campaign.sponsorId, normalized, index + 1, expiresAt ?? campaign.endDate ?? null);
        created.push(this.getById(Number(result.lastInsertRowid))!);
      });

      this.db
        .prepare(
          `UPDATE campaigns SET total_codes = total_codes + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(list.length, campaignId);

      this.audit.log('CODES_IMPORTED', 'campaign', campaignId, { count: list.length });
      return created;
    });

    try {
      return runImport(codes);
    } catch (err) {
      throw new CouponValidationError(
        err instanceof Error
          ? `Unable to import the codes. No changes were saved. (${err.message})`
          : 'Unable to import the codes. No changes were saved.'
      );
    }
  }

  getById(id: number): Coupon | null {
    const row = this.db.prepare<[number], CouponRow>(`SELECT * FROM coupons WHERE id = ?`).get(id);
    return row ? mapCoupon(row) : null;
  }

  /** Same as getById, but joined with sponsor/campaign details (discount
   * type/percentage, names, etc) — needed anywhere the discount must be
   * recalculated from a known coupon id rather than a scanned code. */
  getDetailsById(id: number): CouponWithDetails | null {
    const row = this.db
      .prepare<[number], CouponWithDetailsRow>(`${DETAILS_JOIN} WHERE c.id = ?`)
      .get(id);
    return row ? mapCouponWithDetails(row) : null;
  }

  getByCode(code: string): CouponWithDetails | null {
    const row = this.db
      .prepare<[string], CouponWithDetailsRow>(`${DETAILS_JOIN} WHERE c.code = ?`)
      .get(code.trim());
    return row ? mapCouponWithDetails(row) : null;
  }

  list(params: {
    campaignId?: number;
    sponsorId?: number;
    status?: CouponStatus;
    branchId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): { items: CouponWithDetails[]; total: number } {
    let where = ` WHERE 1=1`;
    const args: unknown[] = [];
    if (params.campaignId) {
      where += ` AND c.campaign_id = ?`;
      args.push(params.campaignId);
    }
    if (params.sponsorId) {
      where += ` AND c.sponsor_id = ?`;
      args.push(params.sponsorId);
    }
    if (params.status) {
      where += ` AND c.status = ?`;
      args.push(params.status);
    }
    if (params.branchId) {
      where += ` AND c.branch_id = ?`;
      args.push(params.branchId);
    }
    if (params.search) {
      where += ` AND (c.code LIKE ? COLLATE NOCASE OR s.name LIKE ? COLLATE NOCASE OR cm.campaign_name LIKE ? COLLATE NOCASE)`;
      args.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
    }

    const total = this.db
      .prepare<unknown[], { c: number }>(
        `SELECT COUNT(*) as c FROM coupons c JOIN sponsors s ON s.id = c.sponsor_id JOIN campaigns cm ON cm.id = c.campaign_id ${where}`
      )
      .get(...args)!.c;

    let sql = `${DETAILS_JOIN} ${where} ORDER BY c.created_at DESC`;
    if (params.limit !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      args.push(params.limit, params.offset ?? 0);
    }

    const rows = this.db.prepare<unknown[], CouponWithDetailsRow>(sql).all(...args);
    return { items: rows.map(mapCouponWithDetails), total };
  }

  /**
   * Determine the *effective* status of a coupon right now, independent of
   * whatever is currently persisted, by checking expiration dynamically.
   * The stored status is authoritative for USED/REVOKED (those never
   * self-heal), but AVAILABLE coupons past their expiry are EXPIRED even if
   * a background sweep hasn't updated the row yet.
   */
  private effectiveStatus(coupon: CouponWithDetails): CouponStatus {
    if (coupon.status === 'USED' || coupon.status === 'REVOKED') return coupon.status;
    if (coupon.expiresAt && coupon.expiresAt < new Date().toISOString()) return 'EXPIRED';
    return coupon.status;
  }

  /**
   * Read-only validation. Does NOT mark the coupon as used. Safe to call
   * repeatedly (e.g. while the employee reviews the result on screen).
   */
  validate(code: string): ValidationResult {
    const trimmed = code.trim();
    if (!trimmed) return { outcome: 'INVALID' };

    const coupon = this.getByCode(trimmed);
    if (!coupon) return { outcome: 'INVALID' };

    const effective = this.effectiveStatus(coupon);

    switch (effective) {
      case 'REVOKED':
        return { outcome: 'REVOKED', coupon, reason: coupon.revokeReason };
      case 'USED':
        return { outcome: 'USED', coupon, usedAt: coupon.usedAt ?? coupon.updatedAt };
      case 'EXPIRED':
        return { outcome: 'EXPIRED', coupon };
      case 'RESERVED': {
        // Validation-only: scanning a RESERVED coupon must NEVER consume it
        // or change its status. Staff sees which reservation holds it so
        // they understand why it can't be used for a different transaction.
        const reservation = coupon.reservationId
          ? (this.db
              .prepare<[number], { id: number; reservation_date: string; start_time: string; status: string; customer_name: string }>(
                `SELECT r.id, r.reservation_date, r.start_time, r.status, c.name as customer_name
                 FROM reservations r JOIN customers c ON c.id = r.customer_id
                 WHERE r.id = ?`
              )
              .get(coupon.reservationId))
          : null;
        if (!reservation) {
          // Data inconsistency (should never happen given the transactional
          // guarantees in ReservationService) — fail safe as INVALID rather
          // than crash or silently treat it as usable.
          return { outcome: 'INVALID' };
        }
        return {
          outcome: 'RESERVED',
          coupon,
          reservation: {
            id: reservation.id,
            reservationDate: reservation.reservation_date,
            startTime: reservation.start_time,
            customerName: reservation.customer_name,
            status: reservation.status as ReservationStatus,
          },
        };
      }
      case 'AVAILABLE':
        return { outcome: 'VALID', coupon };
      default:
        return { outcome: 'INVALID' };
    }
  }

  /**
   * Atomically consume a coupon: AVAILABLE -> USED, records usage history.
   * Uses a conditional UPDATE (status = 'AVAILABLE' in the WHERE clause)
   * inside a transaction so that if two consumption attempts race, only the
   * first one can succeed; the second sees zero rows affected and fails
   * cleanly with CouponConflictError instead of double-counting a redemption.
   *
   * A RESERVED coupon is refused here by default — normal Scan & Validate
   * confirmation must never redeem a coupon that's locked to a reservation;
   * that coupon can only become USED via ReservationService's atomic
   * payment flow. The one exception is `allowReservedOverride`, which the
   * IPC layer only ever passes when the caller holds the CEO-only
   * `qr.reserved_override` permission — every such use is separately
   * audited as COUPON_RESERVED_OVERRIDE, distinct from a normal COUPON_USED
   * entry, so it's always traceable to who bypassed the reservation lock
   * and which reservation it was taken from.
   */
  confirmUse(
    code: string,
    operator?: string | null,
    options?: { allowReservedOverride?: boolean }
  ): { coupon: CouponWithDetails; usedAt: string } {
    const trimmed = code.trim();

    const runConsume = this.db.transaction(() => {
      const coupon = this.getByCode(trimmed);
      if (!coupon) throw new CouponNotFoundError('Coupon not found');

      const effective = this.effectiveStatus(coupon);
      if (effective === 'REVOKED') throw new CouponConflictError('This coupon has been revoked');
      if (effective === 'EXPIRED') throw new CouponConflictError('This coupon has expired');
      if (effective === 'USED') throw new CouponConflictError('This coupon has already been used');
      if (effective === 'RESERVED' && !options?.allowReservedOverride) {
        throw new CouponConflictError(
          'Coupon Reserved: this coupon is already reserved and cannot be used for another reservation.'
        );
      }

      const usedAt = new Date().toISOString();
      const wasReservedOverride = effective === 'RESERVED' && options?.allowReservedOverride === true;
      const previousReservationId = coupon.reservationId;

      const updateResult = this.db
        .prepare(
          `UPDATE coupons SET status = 'USED', used_at = ?, reservation_id = NULL, updated_at = ?
           WHERE id = ? AND status IN ('AVAILABLE', 'RESERVED')`
        )
        .run(usedAt, usedAt, coupon.id);

      if (updateResult.changes === 0) {
        // Someone else consumed it between our read and this write.
        throw new CouponConflictError('This coupon has already been used');
      }

      // If this coupon was still linked to a reservation, detach that link
      // too — an overridden coupon is no longer "held" by that booking.
      if (wasReservedOverride && previousReservationId) {
        this.db
          .prepare(`UPDATE reservations SET coupon_id = NULL, updated_at = ? WHERE id = ? AND coupon_id = ?`)
          .run(usedAt, previousReservationId, coupon.id);
      }

      this.db
        .prepare(
          `INSERT INTO usage_history
            (coupon_id, code, campaign_id, sponsor_id, sponsor_name, campaign_name,
             original_price_cents, discount_percentage, final_price_cents, operator, used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          coupon.id,
          coupon.code,
          coupon.campaignId,
          coupon.sponsorId,
          coupon.sponsorName,
          coupon.campaignName,
          coupon.originalPriceCents,
          coupon.discountPercentage,
          coupon.finalPriceCents,
          operator ?? null,
          usedAt
        );

      if (wasReservedOverride) {
        this.audit.log('COUPON_RESERVED_OVERRIDE', 'coupon', coupon.id, {
          code: coupon.code,
          operator: operator ?? null,
          releasedFromReservationId: previousReservationId,
        });
      } else {
        this.audit.log('COUPON_USED', 'coupon', coupon.id, { code: coupon.code, operator: operator ?? null });
      }

      this.notifications.emit({
        type: 'QR_REDEEMED',
        title: 'QR code redeemed',
        message: `${coupon.code} used by a customer (${coupon.sponsorName} — ${coupon.campaignName}).`,
        entity: 'coupon',
        entityId: coupon.id,
      });

      return { coupon: { ...coupon, status: 'USED' as const, usedAt, reservationId: null }, usedAt };
    });

    return runConsume();
  }

  // --------------------------------------------------------------------
  // Reservation integration (Prime Paddle, schema v6)
  //
  // These three methods are deliberately NOT self-wrapped in their own
  // db.transaction() — they are building blocks meant to be called from
  // *inside* ReservationService's own transaction, alongside the matching
  // reservations-table update, so that e.g. "payment PAID" and "coupon
  // USED" either both happen or neither does. Each one still uses a
  // conditional UPDATE (status check in the WHERE clause) so a race with
  // another operation on the same coupon fails loudly instead of
  // corrupting state, exactly like confirmUse() above.
  // --------------------------------------------------------------------

  /**
   * AVAILABLE -> RESERVED, locking the coupon to one reservation.
   *
   * `playDate` ('YYYY-MM-DD') is the day the customer will actually use the
   * coupon. A coupon must still be valid on that day, so one that expires
   * before the booking date is refused up front instead of failing later at
   * the till. (The background expiry sweeper only flips AVAILABLE coupons,
   * so an overdue-but-unswept coupon is also caught here.)
   */
  reserveForReservation(couponId: number, reservationId: number, playDate?: string): void {
    const existing = this.getById(couponId);
    if (!existing) throw new CouponNotFoundError('Coupon not found');
    if (existing.status === 'RESERVED') {
      throw new CouponConflictError(
        'Coupon Reserved: this coupon is already reserved and cannot be used for another reservation.'
      );
    }
    if (existing.status === 'USED') throw new CouponConflictError('This coupon has already been used');
    if (existing.status === 'REVOKED') throw new CouponConflictError('This coupon has been revoked');
    if (existing.status === 'EXPIRED') throw new CouponConflictError('This coupon has expired');
    if (existing.expiresAt) {
      const nowIso = new Date().toISOString();
      if (existing.expiresAt < nowIso) throw new CouponConflictError('This coupon has expired');
      if (playDate && existing.expiresAt.slice(0, 10) < playDate) {
        throw new CouponConflictError(
          `This coupon expires on ${existing.expiresAt.slice(0, 10)}, before the reservation date (${playDate}).`
        );
      }
    }

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE coupons SET status = 'RESERVED', reservation_id = ?, updated_at = ?
         WHERE id = ? AND status = 'AVAILABLE'`
      )
      .run(reservationId, now, couponId);
    if (result.changes === 0) {
      // Lost a race between the checks above and this write.
      throw new CouponConflictError(
        'Coupon Reserved: this coupon is already reserved and cannot be used for another reservation.'
      );
    }
    this.audit.log('COUPON_RESERVED', 'coupon', couponId, { reservationId });
  }

  /**
   * RESERVED -> AVAILABLE, releasing a coupon back to the pool. Used on
   * cancellation/no-show. Intentionally a no-op (not a thrown error) if the
   * coupon is no longer RESERVED-by-this-reservation — e.g. it was already
   * consumed via markAsPaid or a CEO override — since "the reservation is
   * being cancelled" doesn't retroactively undo a completed payment.
   */
  releaseReservation(couponId: number, reservationId: number): { released: boolean } {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE coupons SET status = 'AVAILABLE', reservation_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'RESERVED' AND reservation_id = ?`
      )
      .run(now, couponId, reservationId);
    if (result.changes > 0) {
      this.audit.log('COUPON_RELEASED', 'coupon', couponId, { reservationId });
    }
    return { released: result.changes > 0 };
  }

  /**
   * RESERVED -> USED, as part of a reservation's payment completing. Throws
   * if the coupon isn't currently RESERVED-by-this-reservation, so the
   * caller's outer transaction rolls back rather than leaving payment PAID
   * with the coupon untouched.
   */
  consumeForReservation(couponId: number, reservationId: number): { usedAt: string } {
    const usedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE coupons SET status = 'USED', used_at = ?, updated_at = ?
         WHERE id = ? AND status = 'RESERVED' AND reservation_id = ?`
      )
      .run(usedAt, usedAt, couponId, reservationId);
    if (result.changes === 0) {
      throw new CouponConflictError(
        'This coupon is no longer reserved for this reservation and cannot be marked used.'
      );
    }
    const coupon = this.getById(couponId)!;
    this.db
      .prepare(
        `INSERT INTO usage_history
          (coupon_id, code, campaign_id, sponsor_id, sponsor_name, campaign_name,
           original_price_cents, discount_percentage, final_price_cents, operator, used_at)
         SELECT c.id, c.code, c.campaign_id, c.sponsor_id, s.name, cm.campaign_name,
                cm.original_price_cents, cm.discount_percentage, cm.final_price_cents, ?, ?
         FROM coupons c JOIN sponsors s ON s.id = c.sponsor_id JOIN campaigns cm ON cm.id = c.campaign_id
         WHERE c.id = ?`
      )
      .run(`reservation:${reservationId}`, usedAt, couponId);
    this.audit.log('COUPON_USED', 'coupon', couponId, { reservationId, via: 'reservation_payment' });
    this.notifications.emit({
      type: 'QR_REDEEMED',
      title: 'QR code redeemed',
      message: `${coupon.code} used automatically on reservation #${reservationId} payment.`,
      entity: 'coupon',
      entityId: couponId,
    });
    return { usedAt };
  }

  /**
   * Move a RESERVED coupon from one reservation to another without ever
   * passing through AVAILABLE — used only by ReservationService's
   * Walk-in -> Advance reschedule flow, where the customer keeps the same
   * coupon but the booking itself is cancelled-and-recreated for a new
   * date/time. Throws if the coupon isn't currently reserved by
   * `fromReservationId`, so a stale/racing caller can't hijack someone
   * else's coupon mid-transfer.
   */
  transferReservation(couponId: number, fromReservationId: number, toReservationId: number): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE coupons SET reservation_id = ?, updated_at = ?
         WHERE id = ? AND status = 'RESERVED' AND reservation_id = ?`
      )
      .run(toReservationId, now, couponId, fromReservationId);
    if (result.changes === 0) {
      throw new CouponConflictError('Coupon could not be transferred to the rescheduled reservation.');
    }
    this.audit.log('COUPON_TRANSFERRED', 'coupon', couponId, { fromReservationId, toReservationId });
  }

  revoke(id: number, reason?: string | null): Coupon {
    const coupon = this.getById(id);
    if (!coupon) throw new CouponNotFoundError(`Coupon ${id} not found`);
    if (coupon.status === 'USED') {
      throw new CouponConflictError('This coupon has already been used and cannot be revoked');
    }
    if (coupon.status === 'RESERVED') {
      throw new CouponConflictError(
        `This coupon is reserved by reservation #${coupon.reservationId}. Cancel or edit that reservation first.`
      );
    }
    this.db
      .prepare(
        `UPDATE coupons SET status = 'REVOKED', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), revoke_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(reason ?? null, id);
    this.audit.log('COUPON_REVOKED', 'coupon', id, { reason: reason ?? null });
    return this.getById(id)!;
  }

  revokeMany(ids: number[], reason?: string | null): { revoked: number[]; skipped: { id: number; why: string }[] } {
    const revoked: number[] = [];
    const skipped: { id: number; why: string }[] = [];
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const coupon = this.getById(id);
        if (!coupon) {
          skipped.push({ id, why: 'not found' });
          continue;
        }
        if (coupon.status === 'USED') {
          skipped.push({ id, why: 'already used' });
          continue;
        }
        if (coupon.status === 'RESERVED') {
          skipped.push({ id, why: `reserved by reservation #${coupon.reservationId}` });
          continue;
        }
        if (coupon.status === 'REVOKED') {
          skipped.push({ id, why: 'already revoked' });
          continue;
        }
        this.revoke(id, reason);
        revoked.push(id);
      }
    });
    tx();
    return { revoked, skipped };
  }

  /**
   * Sweep AVAILABLE coupons whose expiry date has passed and flip their
   * persisted status to EXPIRED. Purely a housekeeping convenience so lists
   * reflect reality without relying on validate() being called; validate()
   * and confirmUse() are always correct even if this hasn't run recently.
   */
  sweepExpired(): number {
    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE coupons SET status = 'EXPIRED', updated_at = ? WHERE status = 'AVAILABLE' AND expires_at IS NOT NULL AND expires_at < ?`
      )
      .run(nowIso, nowIso);
    return result.changes;
  }
}
