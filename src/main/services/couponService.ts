import type Database from 'better-sqlite3';
import { mapCoupon, mapCouponWithDetails, type CouponRow, type CouponWithDetailsRow } from '../db/mappers';
import type {
  Coupon,
  CouponWithDetails,
  ValidationResult,
  CouponStatus,
  ReservationStatus,
  CouponCoverageState,
  RedemptionStatus,
} from '../../shared/types/domain';
import { calculatePrice } from '../../shared/lib/pricing';
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
         cm.status as campaign_status,
         cm.coverage_players as coverage_players
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
        // or change its status. Staff sees which reservation(s) currently
        // hold its coverage — coverage can be split across more than one
        // booking (e.g. a 2-player coupon, 1 unit held by each of two
        // different reservations) so this is always a list, not a single one.
        const state = this.coverageState(coupon.id);
        const reserved = state.activeRedemptions.filter((r) => r.status === 'RESERVED');
        if (reserved.length === 0) {
          // Data inconsistency (should never happen given the transactional
          // guarantees in ReservationService) — fail safe as INVALID rather
          // than crash or silently treat it as usable.
          return { outcome: 'INVALID' };
        }
        return {
          outcome: 'RESERVED',
          coupon,
          reservations: reserved.map((r) => ({
            id: r.reservationId,
            reservationDate: r.reservationDate,
            startTime: r.startTime,
            customerName: r.customerName,
            status: r.reservationStatus,
          })),
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
      // Every reservation currently holding a slice of this coupon's
      // coverage, captured BEFORE we release them, purely for the audit log.
      const releasedFromReservationIds = wasReservedOverride
        ? this.coverageState(coupon.id).activeRedemptions.filter((r) => r.status === 'RESERVED').map((r) => r.reservationId)
        : [];

      const updateResult = this.db
        .prepare(
          `UPDATE coupons SET status = 'USED', used_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('AVAILABLE', 'RESERVED')`
        )
        .run(usedAt, usedAt, coupon.id);

      if (updateResult.changes === 0) {
        // Someone else consumed it between our read and this write.
        throw new CouponConflictError('This coupon has already been used');
      }

      // An overridden coupon is force-taken for this direct register use —
      // any reservation(s) still holding a RESERVED slice of it lose that
      // claim (same RELEASED transition as a cancellation). Their cached
      // discount/total will look stale until that reservation's coupon is
      // detached/re-attached or the booking is otherwise revisited — this
      // is an intentional, rare, CEO-only exception path, not the normal
      // flow, so it is not silently auto-repaired here.
      if (wasReservedOverride) {
        for (const reservationId of releasedFromReservationIds) {
          this.db
            .prepare(
              `UPDATE coupon_redemptions SET status = 'RELEASED', released_at = ?
               WHERE coupon_id = ? AND reservation_id = ? AND status = 'RESERVED'`
            )
            .run(usedAt, coupon.id, reservationId);
        }
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
          releasedFromReservationIds,
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

      return { coupon: { ...coupon, status: 'USED' as const, usedAt }, usedAt };
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

  // --------------------------------------------------------------------
  // Reservation integration (Prime Paddle, schema v7 — coverage ledger)
  //
  // A coupon's coverage (campaign.coverage_players) is how many players its
  // discount can apply to — NOT a flat replacement price. These methods are
  // deliberately NOT self-wrapped in their own db.transaction() — they are
  // building blocks meant to be called from *inside* ReservationService's
  // own transaction, alongside the matching reservations-table update, so
  // that e.g. "payment PAID" and "coverage CONSUMED" either both happen or
  // neither does.
  //
  // coupons.status/used_at are kept as a maintained CACHE recomputed after
  // every ledger change (recomputeCachedStatus below) — the actual source
  // of truth is always coupon_redemptions + campaign.coverage_players,
  // queried live via coverageState(). This keeps existing status-based
  // reads (lists, Scan & Validate) working unchanged for the common
  // coverage=1 case, while supporting partial/multi-reservation coverage
  // underneath for coverage>1.
  // --------------------------------------------------------------------

  /** Live-computed remaining coverage for a coupon — never stored. */
  coverageState(couponId: number): CouponCoverageState {
    const coupon = this.getDetailsById(couponId);
    if (!coupon) throw new CouponNotFoundError('Coupon not found');

    const rows = this.db
      .prepare<[number], { coverage_consumed: number; status: string }>(
        `SELECT coverage_consumed, status FROM coupon_redemptions WHERE coupon_id = ? AND status IN ('RESERVED','CONSUMED')`
      )
      .all(couponId);
    const consumedCoverage = rows.reduce(
      (sum: number, r: { coverage_consumed: number; status: string }) => sum + r.coverage_consumed,
      0
    );
    const remainingCoverage = Math.max(0, coupon.coveragePlayers - consumedCoverage);

    const active = this.db
      .prepare<[number], {
        reservation_id: number;
        coverage_consumed: number;
        status: string;
        reservation_date: string;
        start_time: string;
        customer_name: string;
        reservation_status: string;
      }>(
        `SELECT cr.reservation_id as reservation_id, cr.coverage_consumed as coverage_consumed, cr.status as status,
                r.reservation_date as reservation_date, r.start_time as start_time, c.name as customer_name,
                r.status as reservation_status
         FROM coupon_redemptions cr
         JOIN reservations r ON r.id = cr.reservation_id
         JOIN customers c ON c.id = r.customer_id
         WHERE cr.coupon_id = ? AND cr.status IN ('RESERVED','CONSUMED')
         ORDER BY cr.created_at`
      )
      .all(couponId);

    return {
      couponId,
      coveragePlayers: coupon.coveragePlayers,
      consumedCoverage,
      remainingCoverage,
      activeRedemptions: active.map(
        (r: {
          reservation_id: number;
          coverage_consumed: number;
          status: string;
          reservation_date: string;
          start_time: string;
          customer_name: string;
          reservation_status: string;
        }) => ({
          reservationId: r.reservation_id,
          coverageConsumed: r.coverage_consumed,
          status: r.status as RedemptionStatus,
          reservationDate: r.reservation_date,
          startTime: r.start_time,
          customerName: r.customer_name,
          reservationStatus: r.reservation_status as ReservationStatus,
        })
      ),
    };
  }

  /** Recomputes and persists the coupons.status CACHE from the ledger —
   * called after every reserve/release/consume so list/filter queries and
   * the legacy single-coupon-status reads (Scan & Validate, Coupons page)
   * stay correct without needing a live aggregate on every read. */
  private recomputeCachedStatus(couponId: number): void {
    const coupon = this.getById(couponId);
    if (!coupon || coupon.status === 'REVOKED' || coupon.status === 'EXPIRED') return; // explicit states win
    const state = this.coverageState(couponId);
    const now = new Date().toISOString();
    if (state.remainingCoverage > 0) {
      this.db.prepare(`UPDATE coupons SET status = 'AVAILABLE', updated_at = ? WHERE id = ?`).run(now, couponId);
      return;
    }
    const hasReserved = state.activeRedemptions.some((r) => r.status === 'RESERVED');
    if (hasReserved) {
      this.db.prepare(`UPDATE coupons SET status = 'RESERVED', updated_at = ? WHERE id = ?`).run(now, couponId);
    } else {
      this.db
        .prepare(`UPDATE coupons SET status = 'USED', used_at = COALESCE(used_at, ?), updated_at = ? WHERE id = ?`)
        .run(now, now, couponId);
    }
  }

  /**
   * Reserve up to `requestedCoverage` units of a coupon's coverage for one
   * reservation (optionally for one named participant). Grants
   * `min(requestedCoverage, remainingCoverage)` — never more than what's
   * actually left, and THIS capping is what makes partial usage happen
   * naturally (e.g. a 2-player coupon with 1 unit already used elsewhere
   * grants only 1 here, not 2). Throws if nothing at all is left, if the
   * coupon is REVOKED/EXPIRED, or if it expires before `playDate`.
   *
   * `pricePerPlayerCents` is the reservation's own per-player rate — the
   * eligible amount discounted is `pricePerPlayerCents x coverageGranted`,
   * never the campaign's own listed price and never the reservation's full
   * total unless the coverage happens to equal the full player count.
   */
  reserveCoverage(params: {
    couponId: number;
    reservationId: number;
    participantId?: number | null;
    requestedCoverage: number;
    pricePerPlayerCents: number;
    playDate?: string;
    actorUserId?: number | null;
  }): { redemptionId: number; coverageGranted: number; eligibleAmountCents: number; discountCents: number } {
    const coupon = this.getDetailsById(params.couponId);
    if (!coupon) throw new CouponNotFoundError('Coupon not found');
    if (coupon.status === 'REVOKED') throw new CouponConflictError('This coupon has been revoked');
    if (coupon.status === 'EXPIRED') throw new CouponConflictError('This coupon has expired');
    if (coupon.expiresAt) {
      const nowIso = new Date().toISOString();
      if (coupon.expiresAt < nowIso) throw new CouponConflictError('This coupon has expired');
      if (params.playDate && coupon.expiresAt.slice(0, 10) < params.playDate) {
        throw new CouponConflictError(
          `This coupon expires on ${coupon.expiresAt.slice(0, 10)}, before the reservation date (${params.playDate}).`
        );
      }
    }

    const existing = this.db
      .prepare<[number, number], { id: number }>(
        `SELECT id FROM coupon_redemptions WHERE coupon_id = ? AND reservation_id = ? AND status IN ('RESERVED','CONSUMED')`
      )
      .get(params.couponId, params.reservationId);
    if (existing) {
      throw new CouponConflictError('This coupon is already attached to this reservation.');
    }

    const state = this.coverageState(params.couponId);
    const coverageGranted = Math.min(params.requestedCoverage, state.remainingCoverage);
    if (coverageGranted <= 0) {
      throw new CouponConflictError(
        'Coupon Reserved: this coupon has no remaining coverage left and cannot be used for another reservation.'
      );
    }

    const eligibleAmountCents = params.pricePerPlayerCents * coverageGranted;
    const breakdown = calculatePrice({
      originalPriceCents: eligibleAmountCents,
      discountType: coupon.discountType,
      discountPercentage: coupon.discountPercentage,
      discountAmountCents: coupon.discountAmountCents,
    });
    const discountCents = breakdown.youSaveCents;

    const result = this.db
      .prepare(
        `INSERT INTO coupon_redemptions
          (coupon_id, reservation_id, participant_id, coverage_consumed, eligible_amount_cents, discount_cents, status, actor_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?)`
      )
      .run(
        params.couponId,
        params.reservationId,
        params.participantId ?? null,
        coverageGranted,
        eligibleAmountCents,
        discountCents,
        params.actorUserId ?? null
      );

    this.recomputeCachedStatus(params.couponId);
    this.audit.log('COUPON_COVERAGE_RESERVED', 'coupon', params.couponId, {
      reservationId: params.reservationId,
      participantId: params.participantId ?? null,
      coverageGranted,
      eligibleAmountCents,
      discountCents,
    });

    return { redemptionId: Number(result.lastInsertRowid), coverageGranted, eligibleAmountCents, discountCents };
  }

  /**
   * Release a RESERVED (not yet paid) redemption back to the pool — used on
   * cancellation/no-show. A no-op (not a thrown error) if there is no
   * active RESERVED row for this (coupon, reservation) pair — e.g. it was
   * already CONSUMED via payment, which cancelling must never undo.
   */
  releaseCoverage(couponId: number, reservationId: number): { released: boolean; coverageReleased: number } {
    const now = new Date().toISOString();
    const row = this.db
      .prepare<[number, number], { id: number; coverage_consumed: number }>(
        `SELECT id, coverage_consumed FROM coupon_redemptions WHERE coupon_id = ? AND reservation_id = ? AND status = 'RESERVED'`
      )
      .get(couponId, reservationId);
    if (!row) return { released: false, coverageReleased: 0 };

    this.db.prepare(`UPDATE coupon_redemptions SET status = 'RELEASED', released_at = ? WHERE id = ?`).run(now, row.id);
    this.recomputeCachedStatus(couponId);
    this.audit.log('COUPON_COVERAGE_RELEASED', 'coupon', couponId, { reservationId, coverageReleased: row.coverage_consumed });
    return { released: true, coverageReleased: row.coverage_consumed };
  }

  /**
   * RESERVED -> CONSUMED for one (coupon, reservation) redemption, as part
   * of that reservation's payment completing. Throws if there is no active
   * RESERVED row, so the caller's outer transaction (markAsPaid) rolls back
   * rather than leaving payment PAID with coverage untouched.
   */
  consumeCoverage(
    couponId: number,
    reservationId: number
  ): { consumedAt: string; coverageConsumed: number; discountCents: number } {
    const consumedAt = new Date().toISOString();
    const row = this.db
      .prepare<[number, number], { id: number; coverage_consumed: number; eligible_amount_cents: number; discount_cents: number }>(
        `SELECT id, coverage_consumed, eligible_amount_cents, discount_cents FROM coupon_redemptions
         WHERE coupon_id = ? AND reservation_id = ? AND status = 'RESERVED'`
      )
      .get(couponId, reservationId);
    if (!row) {
      throw new CouponConflictError(
        'This coupon is no longer reserved for this reservation and cannot be marked used.'
      );
    }

    this.db.prepare(`UPDATE coupon_redemptions SET status = 'CONSUMED', consumed_at = ? WHERE id = ?`).run(consumedAt, row.id);
    this.recomputeCachedStatus(couponId);

    const coupon = this.getById(couponId)!;
    this.db
      .prepare(
        `INSERT INTO usage_history
          (coupon_id, code, campaign_id, sponsor_id, sponsor_name, campaign_name,
           original_price_cents, discount_percentage, final_price_cents, operator, used_at)
         SELECT c.id, c.code, c.campaign_id, c.sponsor_id, s.name, cm.campaign_name,
                ?, cm.discount_percentage, ? - ?, ?, ?
         FROM coupons c JOIN sponsors s ON s.id = c.sponsor_id JOIN campaigns cm ON cm.id = c.campaign_id
         WHERE c.id = ?`
      )
      .run(
        row.eligible_amount_cents,
        row.eligible_amount_cents,
        row.discount_cents,
        `reservation:${reservationId}`,
        consumedAt,
        couponId
      );
    this.audit.log('COUPON_COVERAGE_CONSUMED', 'coupon', couponId, {
      reservationId,
      coverageConsumed: row.coverage_consumed,
      discountCents: row.discount_cents,
    });
    this.notifications.emit({
      type: 'QR_REDEEMED',
      title: 'QR code redeemed',
      message: `${coupon.code} used automatically on reservation #${reservationId} payment (${row.coverage_consumed} player(s)).`,
      entity: 'coupon',
      entityId: couponId,
    });
    return { consumedAt, coverageConsumed: row.coverage_consumed, discountCents: row.discount_cents };
  }

  /**
   * Move a RESERVED redemption from one reservation to another without
   * ever passing through AVAILABLE — used only by ReservationService's
   * Walk-in -> Advance reschedule flow. The coverage amount itself never
   * changes, but `newPricePerPlayerCents` lets the eligible/discount amount
   * be recomputed for the new date's rate (a reschedule can move a booking
   * to a day/period with a different per-player price). Throws if there is
   * no active RESERVED row for `fromReservationId`.
   */
  transferCoverage(
    couponId: number,
    fromReservationId: number,
    toReservationId: number,
    newPricePerPlayerCents: number
  ): { eligibleAmountCents: number; discountCents: number } {
    const row = this.db
      .prepare<[number, number], { id: number; coverage_consumed: number }>(
        `SELECT id, coverage_consumed FROM coupon_redemptions WHERE coupon_id = ? AND reservation_id = ? AND status = 'RESERVED'`
      )
      .get(couponId, fromReservationId);
    if (!row) throw new CouponConflictError('Coupon could not be transferred to the rescheduled reservation.');

    const coupon = this.getDetailsById(couponId)!;
    const eligibleAmountCents = newPricePerPlayerCents * row.coverage_consumed;
    const breakdown = calculatePrice({
      originalPriceCents: eligibleAmountCents,
      discountType: coupon.discountType,
      discountPercentage: coupon.discountPercentage,
      discountAmountCents: coupon.discountAmountCents,
    });

    this.db
      .prepare(
        `UPDATE coupon_redemptions SET reservation_id = ?, eligible_amount_cents = ?, discount_cents = ? WHERE id = ?`
      )
      .run(toReservationId, eligibleAmountCents, breakdown.youSaveCents, row.id);
    this.audit.log('COUPON_COVERAGE_TRANSFERRED', 'coupon', couponId, { fromReservationId, toReservationId });
    return { eligibleAmountCents, discountCents: breakdown.youSaveCents };
  }

  revoke(id: number, reason?: string | null): Coupon {
    const coupon = this.getById(id);
    if (!coupon) throw new CouponNotFoundError(`Coupon ${id} not found`);
    if (coupon.status === 'USED') {
      throw new CouponConflictError('This coupon has already been used and cannot be revoked');
    }
    if (coupon.status === 'RESERVED') {
      const reservationIds = this.coverageState(coupon.id)
        .activeRedemptions.filter((r) => r.status === 'RESERVED')
        .map((r) => r.reservationId);
      throw new CouponConflictError(
        `This coupon is reserved by reservation #${reservationIds.join(', #')}. Cancel or edit that reservation first.`
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
          const reservationIds = this.coverageState(coupon.id)
            .activeRedemptions.filter((r) => r.status === 'RESERVED')
            .map((r) => r.reservationId);
          skipped.push({ id, why: `reserved by reservation #${reservationIds.join(', #')}` });
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
