import type Database from 'better-sqlite3';
import {
  mapReservation,
  mapReservationWithDetails,
  mapReservationHistory,
  mapReservationParticipant,
  type ReservationRow,
  type ReservationWithDetailsRow,
  type ReservationHistoryRow,
  type ReservationParticipantRow,
} from '../db/mappers';
import type {
  Reservation,
  ReservationWithDetails,
  ReservationHistoryEntry,
  ReservationStatus,
  ReservationType,
  ReservationParticipant,
  ReservationCouponLine,
  ReservationPriceBreakdown,
  RedemptionStatus,
} from '../../shared/types/domain';
import { AuditService } from './auditService';
import { NotificationService } from './notificationService';
import { CustomerService, type CreateCustomerInput } from './CustomerService';
import { AvailabilityService } from './AvailabilityService';
import { PricingService } from './PricingService';
import { CouponService, CouponConflictError, CouponNotFoundError } from './couponService';

export class ReservationValidationError extends Error {}

function isRealDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export class ReservationNotFoundError extends Error {}
export class ReservationConflictError extends Error {}
/** Thrown when a requested slot is CLOSED/FULL/in the past — never silently
 * allowed through. */
export class SlotUnavailableError extends Error {}

// Every allowed status transition. Anything not listed here is rejected,
// even if it would otherwise "make sense" — this is the single source of
// truth for the reservation lifecycle described in the Prime Paddle spec.
const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Statuses that still occupy a slot's capacity — must mirror
 * AvailabilityService.OCCUPYING_STATUSES exactly. */
const OCCUPYING_STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];

export interface CreateReservationInput {
  customer: CreateCustomerInput;
  reservationDate: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  durationMin: number;
  periodId?: number | null;
  players: number;
  couponCode?: string | null;
  notes?: string | null;
  createdByUserId?: number | null;
}

// r.coupon_id/coupon_code is kept only as a simple "primary coupon" display
// value (the most recently attached one) — the authoritative, possibly
// MULTI-coupon state for a reservation lives in coupon_redemptions and is
// read via getPriceBreakdown()/getCouponLines() below. coupon_count is the
// number of distinct coupons currently actively attached (RESERVED or
// CONSUMED), so list views can show "2 coupons" instead of just one code.
const DETAILS_JOIN = `
  SELECT r.*, c.name as customer_name, c.phone as customer_phone,
         p.name as period_name, co.code as coupon_code,
         (SELECT COUNT(DISTINCT cr.coupon_id) FROM coupon_redemptions cr
          WHERE cr.reservation_id = r.id AND cr.status IN ('RESERVED','CONSUMED')) as coupon_count
  FROM reservations r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN periods p ON p.id = r.period_id
  LEFT JOIN coupons co ON co.id = r.coupon_id
`;

export class ReservationService {
  private audit: AuditService;
  private notifications: NotificationService;
  private customers: CustomerService;
  private availability: AvailabilityService;
  private pricing: PricingService;
  private coupons: CouponService;

  constructor(private db: Database.Database, coupons?: CouponService) {
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
    this.customers = new CustomerService(db);
    this.availability = new AvailabilityService(db);
    this.pricing = new PricingService(db);
    // Accept an injected CouponService (the app has a single shared
    // instance elsewhere) so both services always see the same coupon
    // state within one process — but fall back to constructing our own so
    // this class remains independently testable.
    this.coupons = coupons ?? new CouponService(db);
  }

  // --------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------

  getById(id: number): Reservation | null {
    const row = this.db.prepare<[number], ReservationRow>(`SELECT * FROM reservations WHERE id = ?`).get(id);
    return row ? mapReservation(row) : null;
  }

  getWithDetails(id: number): ReservationWithDetails | null {
    const row = this.db
      .prepare<[number], ReservationWithDetailsRow>(`${DETAILS_JOIN} WHERE r.id = ?`)
      .get(id);
    return row ? mapReservationWithDetails(row) : null;
  }

  list(filter: { dateFrom?: string; dateTo?: string; status?: ReservationStatus; customerId?: number } = {}): ReservationWithDetails[] {
    let where = ' WHERE 1=1';
    const args: unknown[] = [];
    if (filter.dateFrom) {
      where += ' AND r.reservation_date >= ?';
      args.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      where += ' AND r.reservation_date <= ?';
      args.push(filter.dateTo);
    }
    if (filter.status) {
      where += ' AND r.status = ?';
      args.push(filter.status);
    }
    if (filter.customerId) {
      where += ' AND r.customer_id = ?';
      args.push(filter.customerId);
    }
    const rows = this.db
      .prepare<unknown[], ReservationWithDetailsRow>(
        `${DETAILS_JOIN}${where} ORDER BY r.reservation_date DESC, r.start_time DESC`
      )
      .all(...args);
    return rows.map(mapReservationWithDetails);
  }

  /** Search by customer name/phone, reservation ID, or coupon code. */
  search(query: string): ReservationWithDetails[] {
    const q = query.trim();
    if (!q) return [];
    const rows = this.db
      .prepare<unknown[], ReservationWithDetailsRow>(
        `${DETAILS_JOIN} WHERE r.id = ? OR c.name LIKE ? OR c.phone LIKE ? OR co.code = ?
         ORDER BY r.reservation_date DESC, r.start_time DESC LIMIT 100`
      )
      .all(/^\d+$/.test(q) ? Number(q) : -1, `%${q}%`, `%${q}%`, q);
    return rows.map(mapReservationWithDetails);
  }

  getHistory(reservationId: number): ReservationHistoryEntry[] {
    return this.db
      .prepare<[number], ReservationHistoryRow>(
        `SELECT * FROM reservation_history WHERE reservation_id = ? ORDER BY created_at, id`
      )
      .all(reservationId)
      .map(mapReservationHistory);
  }

  // --------------------------------------------------------------------
  // Creation (Walk-in and Advance share this core; only reservationType and
  // the immediate CHECKED_IN follow-up for walk-ins differ at the call
  // site / IPC layer).
  // --------------------------------------------------------------------

  private createInternal(input: CreateReservationInput, reservationType: ReservationType): Reservation {
    // Everything here arrives over IPC and is untrusted — validate shape first.
    if (!Number.isInteger(input.players) || input.players < 1 || input.players > 1000) {
      throw new ReservationValidationError('Players must be a whole number of at least 1');
    }
    if (!Number.isInteger(input.durationMin) || input.durationMin <= 0 || input.durationMin > 1440) {
      throw new ReservationValidationError('Duration must be a positive whole number of minutes');
    }
    if (!isRealDate(input.reservationDate)) {
      throw new ReservationValidationError('Reservation date must be a valid date (YYYY-MM-DD)');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
      throw new ReservationValidationError('Start time must be a valid time (HH:MM)');
    }

    const create = this.db.transaction((): Reservation => {
      // 1) Re-check availability against the real, current database state,
      // inside the transaction, so a race between two staff members booking
      // the same last slot can't both succeed.
      const day = this.availability.getDayAvailability(input.reservationDate);
      if (!day.isOpen) {
        throw new SlotUnavailableError(`${input.reservationDate} is closed for reservations`);
      }
      const slot = day.slots.find((s) => s.startTime === input.startTime);
      if (!slot) {
        throw new SlotUnavailableError(`${input.startTime} is not a valid slot on ${input.reservationDate}`);
      }
      if (slot.status === 'CLOSED' || slot.status === 'COMPLETED') {
        throw new SlotUnavailableError(`This slot is no longer bookable (${slot.status})`);
      }
      if (slot.status === 'FULL' || slot.occupied + input.players > slot.capacity) {
        throw new SlotUnavailableError('This slot is fully booked');
      }

      // 2) Customer (find-or-create by phone).
      const customer = this.customers.findOrCreateByPhone(input.customer);

      // 3) Price resolution — never a hardcoded price. pricing_rules.priceCents
      // is a PER-PLAYER rate, so the slot's own price scales with how many
      // players are booked (e.g. a 30 TND rule = 60 TND for 2 players) —
      // UNLESS a coupon is attached below, in which case the coupon's own
      // campaign price (set up by the business for that specific group,
      // e.g. a "2 players" or "4 players" package) replaces it entirely,
      // so a group coupon is never also multiplied by player count on top.
      const rule = this.pricing.resolvePrice({
        date: input.reservationDate,
        periodId: input.periodId ?? slot.periodId,
        durationMin: input.durationMin,
      });
      let basePriceCents = rule.priceCents * input.players;

      // 4) Insert the reservation first (as CONFIRMED — both Walk-in and
      // Advance commit in a single step in this UI design; see
      // ReservationService docs / HANDOFF for why PENDING exists but is not
      // used mid-wizard), with a placeholder price, so we have an id to
      // attach a coupon to.
      const insertResult = this.db
        .prepare(
          `INSERT INTO reservations
            (customer_id, reservation_type, status, reservation_date, start_time, duration_min,
             period_id, players, base_price_cents, discount_cents, final_price_cents,
             coupon_id, payment_status, notes, created_by_user_id)
           VALUES (?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?, 0, ?, NULL, 'UNPAID', ?, ?)`
        )
        .run(
          customer.id,
          reservationType,
          input.reservationDate,
          input.startTime,
          input.durationMin,
          input.periodId ?? slot.periodId,
          input.players,
          basePriceCents,
          basePriceCents,
          input.notes ?? null,
          input.createdByUserId ?? null
        );
      const reservationId = Number(insertResult.lastInsertRowid);

      // 5) Optional coupon attach. A coupon's discount applies only to the
      // slice of the reservation it COVERS (price_per_player x
      // coupon.coveragePlayers) — never to the campaign's own listed price,
      // and never to the whole reservation unless its coverage happens to
      // equal the full player count. See attachCouponInternal.
      if (input.couponCode) {
        this.attachCouponInternal({
          reservationId,
          couponCode: input.couponCode.trim(),
          reservationDate: input.reservationDate,
          periodId: input.periodId ?? slot.periodId,
          durationMin: input.durationMin,
          players: input.players,
          actorUserId: input.createdByUserId ?? null,
        });
      }

      this.recordHistory(reservationId, null, 'CONFIRMED', input.createdByUserId ?? null, `${reservationType} created`);
      this.audit.log('RESERVATION_CREATED', 'reservation', reservationId, {
        reservationType,
        date: input.reservationDate,
        startTime: input.startTime,
        players: input.players,
      });
      this.notifications.emit({
        type: 'RESERVATION_CREATED',
        title: reservationType === 'WALK_IN' ? 'Walk-in reservation' : 'New advance reservation',
        message: `${customer.name} — ${input.reservationDate} ${input.startTime}`,
        entity: 'reservation',
        entityId: reservationId,
      });

      return this.getById(reservationId)!;
    });

    return create();
  }

  createWalkIn(input: CreateReservationInput): Reservation {
    return this.createInternal(input, 'WALK_IN');
  }

  createAdvance(input: CreateReservationInput): Reservation {
    return this.createInternal(input, 'ADVANCE');
  }

  // --------------------------------------------------------------------
  // Coupon coverage helpers (schema v7)
  //
  // A reservation can carry MULTIPLE coupons (Part 7 of the spec) — the
  // authoritative record of which coupons cover how many players is always
  // coupon_redemptions, never a single column. reservations.coupon_id /
  // discount_cents / final_price_cents are a maintained CACHE (recomputed
  // by recalculateAggregates after every attach/detach/consume) purely so
  // existing simple reads (lists, reports) keep working without a join.
  // --------------------------------------------------------------------

  /** The reservation's own per-player rate, resolved fresh from pricing_rules
   * (never multiplied by players here — callers multiply as needed). */
  private pricePerPlayerCentsFor(reservationDate: string, periodId: number | null, durationMin: number): number {
    return this.pricing.resolvePrice({ date: reservationDate, periodId, durationMin }).priceCents;
  }

  private resolveNoCouponBasePrice(reservationDate: string, periodId: number | null, durationMin: number, players: number): number {
    return this.pricePerPlayerCentsFor(reservationDate, periodId, durationMin) * players;
  }

  /** How many of this reservation's players are not yet covered by any
   * active (RESERVED or CONSUMED) coupon — a new coupon can cover at most
   * this many, which is exactly what makes "coupon bigger than remaining
   * players" result in a capped/partial grant instead of an error. */
  private uncoveredPlayers(reservationId: number, players: number): number {
    const row = this.db
      .prepare<[number], { total: number | null }>(
        `SELECT SUM(coverage_consumed) as total FROM coupon_redemptions WHERE reservation_id = ? AND status IN ('RESERVED','CONSUMED')`
      )
      .get(reservationId);
    return Math.max(0, players - (row?.total ?? 0));
  }

  /** Distinct coupon ids currently RESERVED (not yet paid/consumed) by this
   * reservation — used to release/consume "every coupon", not just the
   * single legacy coupon_id. */
  private activeCouponIds(reservationId: number): number[] {
    return this.db
      .prepare<[number], { coupon_id: number }>(
        `SELECT DISTINCT coupon_id FROM coupon_redemptions WHERE reservation_id = ? AND status = 'RESERVED'`
      )
      .all(reservationId)
      .map((r: { coupon_id: number }) => r.coupon_id);
  }

  /** Recomputes the cached discount_cents/final_price_cents/coupon_id
   * (="most recently attached" for simple display) from the ledger. Called
   * after every attach/detach/consume/release so reads never need a join. */
  private recalculateAggregates(reservationId: number): void {
    const reservation = this.getById(reservationId);
    if (!reservation) return;
    const rows = this.db
      .prepare<[number], { discount_cents: number; coupon_id: number }>(
        `SELECT discount_cents, coupon_id FROM coupon_redemptions
         WHERE reservation_id = ? AND status IN ('RESERVED','CONSUMED') ORDER BY created_at`
      )
      .all(reservationId);
    const totalDiscount = rows.reduce((sum: number, r: { discount_cents: number }) => sum + r.discount_cents, 0);
    const finalPrice = Math.max(0, reservation.basePriceCents - totalDiscount);
    const primaryCouponId = rows.length > 0 ? rows[rows.length - 1].coupon_id : null;
    this.db
      .prepare(
        `UPDATE reservations SET coupon_id = ?, discount_cents = ?, final_price_cents = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(primaryCouponId, totalDiscount, finalPrice, reservationId);
  }

  /** Shared by creation-time attach and the public attachCoupon(). */
  private attachCouponInternal(params: {
    reservationId: number;
    couponCode: string;
    reservationDate: string;
    periodId: number | null;
    durationMin: number;
    players: number;
    actorUserId: number | null;
    participantId?: number | null;
    requestedCoverage?: number;
  }): { coverageGranted: number } {
    const coupon = this.coupons.getByCode(params.couponCode);
    if (!coupon) throw new CouponNotFoundError('Coupon not found');

    const uncovered = this.uncoveredPlayers(params.reservationId, params.players);
    const desired = params.requestedCoverage ?? Math.min(coupon.coveragePlayers, uncovered);
    if (desired <= 0) {
      throw new ReservationConflictError(
        'All players on this reservation are already covered by a coupon.'
      );
    }
    const pricePerPlayerCents = this.pricePerPlayerCentsFor(params.reservationDate, params.periodId, params.durationMin);

    const result = this.coupons.reserveCoverage({
      couponId: coupon.id,
      reservationId: params.reservationId,
      participantId: params.participantId ?? null,
      requestedCoverage: desired,
      pricePerPlayerCents,
      playDate: params.reservationDate,
      actorUserId: params.actorUserId,
    });

    this.recalculateAggregates(params.reservationId);
    this.audit.log('RESERVATION_COUPON_ATTACHED', 'reservation', params.reservationId, {
      couponId: coupon.id,
      coverageGranted: result.coverageGranted,
      actorUserId: params.actorUserId,
    });
    return { coverageGranted: result.coverageGranted };
  }

  // --------------------------------------------------------------------
  // Coupon attach/detach on an existing reservation (before payment).
  // A reservation may carry MULTIPLE coupons (Part 7) — each attach call
  // adds one more, as long as the reservation still has uncovered players.
  // --------------------------------------------------------------------

  /**
   * Attach one more coupon to a reservation. The coverage actually granted
   * is capped at both the coupon's own remaining coverage AND this
   * reservation's uncovered player count — e.g. attaching a 4-player coupon
   * to a 4-player reservation that already has a 1-player coupon on it only
   * grants 3 (never double-discounts the 1 player already covered), and
   * this capping is exactly what produces PARTIAL coupon usage.
   */
  attachCoupon(
    reservationId: number,
    couponCode: string,
    actorUserId: number | null = null,
    options?: { participantId?: number | null; coverage?: number }
  ): Reservation {
    const attach = this.db.transaction((): Reservation => {
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.paymentStatus === 'PAID') {
        throw new ReservationConflictError('Cannot attach a coupon to an already-paid reservation');
      }
      this.attachCouponInternal({
        reservationId,
        couponCode: couponCode.trim(),
        reservationDate: reservation.reservationDate,
        periodId: reservation.periodId,
        durationMin: reservation.durationMin,
        players: reservation.players,
        actorUserId,
        participantId: options?.participantId ?? null,
        requestedCoverage: options?.coverage,
      });
      return this.getById(reservationId)!;
    });
    return attach();
  }

  /** Detach one specific coupon (by its coupon id — a reservation can have
   * more than one) from a reservation, releasing its RESERVED coverage. */
  detachCoupon(reservationId: number, couponId: number, actorUserId: number | null = null): Reservation {
    const detach = this.db.transaction((): Reservation => {
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.paymentStatus === 'PAID') {
        throw new ReservationConflictError('Cannot detach a coupon from an already-paid reservation');
      }
      const { released } = this.coupons.releaseCoverage(couponId, reservationId);
      if (!released) {
        throw new ReservationConflictError('This coupon is not currently attached to this reservation.');
      }
      this.recalculateAggregates(reservationId);
      this.audit.log('RESERVATION_COUPON_DETACHED', 'reservation', reservationId, { couponId, actorUserId });
      return this.getById(reservationId)!;
    });
    return detach();
  }

  /** Full, itemized price breakdown for a reservation — every attached
   * coupon as its own line, exactly as Part 10 of the spec describes.
   * Always derived live from coupon_redemptions, never from the cached
   * aggregate columns, so it is always authoritative. */
  getPriceBreakdown(reservationId: number): ReservationPriceBreakdown {
    const reservation = this.getById(reservationId);
    if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);

    const pricePerPlayerCents = this.pricePerPlayerCentsFor(
      reservation.reservationDate,
      reservation.periodId,
      reservation.durationMin
    );

    const rows = this.db
      .prepare<[number], {
        coupon_id: number;
        code: string;
        sponsor_name: string;
        campaign_name: string;
        participant_id: number | null;
        participant_name: string | null;
        coverage_consumed: number;
        eligible_amount_cents: number;
        discount_cents: number;
        status: string;
      }>(
        `SELECT cr.coupon_id as coupon_id, c.code as code, s.name as sponsor_name, cm.campaign_name as campaign_name,
                cr.participant_id as participant_id, p.name as participant_name,
                cr.coverage_consumed as coverage_consumed, cr.eligible_amount_cents as eligible_amount_cents,
                cr.discount_cents as discount_cents, cr.status as status
         FROM coupon_redemptions cr
         JOIN coupons c ON c.id = cr.coupon_id
         JOIN sponsors s ON s.id = c.sponsor_id
         JOIN campaigns cm ON cm.id = c.campaign_id
         LEFT JOIN reservation_participants p ON p.id = cr.participant_id
         WHERE cr.reservation_id = ? AND cr.status IN ('RESERVED','CONSUMED')
         ORDER BY cr.created_at`
      )
      .all(reservationId);

    const coupons: ReservationCouponLine[] = rows.map(
      (r: {
        coupon_id: number; code: string; sponsor_name: string; campaign_name: string;
        participant_id: number | null; participant_name: string | null; coverage_consumed: number;
        eligible_amount_cents: number; discount_cents: number; status: string;
      }) => ({
        couponId: r.coupon_id,
        couponCode: r.code,
        sponsorName: r.sponsor_name,
        campaignName: r.campaign_name,
        participantId: r.participant_id,
        participantName: r.participant_name,
        coverageConsumed: r.coverage_consumed,
        eligibleAmountCents: r.eligible_amount_cents,
        discountCents: r.discount_cents,
        status: r.status as RedemptionStatus,
      })
    );

    const totalDiscountCents = coupons.reduce((sum, c) => sum + c.discountCents, 0);
    const subtotalCents = pricePerPlayerCents * reservation.players;

    return {
      players: reservation.players,
      pricePerPlayerCents,
      subtotalCents,
      coupons,
      totalDiscountCents,
      finalPriceCents: Math.max(0, subtotalCents - totalDiscountCents),
      uncoveredPlayers: this.uncoveredPlayers(reservationId, reservation.players),
    };
  }

  // --------------------------------------------------------------------
  // Optional reservation participants (Part 5/6) — purely for naming who
  // used which coupon. Never required: a reservation with N players and no
  // participant rows at all works exactly the same as before.
  // --------------------------------------------------------------------

  listParticipants(reservationId: number): ReservationParticipant[] {
    return this.db
      .prepare<[number], ReservationParticipantRow>(
        `SELECT * FROM reservation_participants WHERE reservation_id = ? ORDER BY sort_order, id`
      )
      .all(reservationId)
      .map(mapReservationParticipant);
  }

  /** Replaces the full participant list for a reservation (names only —
   * optional, never forced; an empty/short list is perfectly valid). */
  setParticipants(reservationId: number, names: Array<string | null>): ReservationParticipant[] {
    const reservation = this.getById(reservationId);
    if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
    if (names.length > reservation.players) {
      throw new ReservationValidationError('Cannot name more participants than the reservation has players');
    }
    const replace = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM reservation_participants WHERE reservation_id = ?`).run(reservationId);
      const insert = this.db.prepare(
        `INSERT INTO reservation_participants (reservation_id, name, sort_order) VALUES (?, ?, ?)`
      );
      names.forEach((name, i) => insert.run(reservationId, name?.trim() || null, i));
    });
    replace();
    return this.listParticipants(reservationId);
  }

  // --------------------------------------------------------------------
  // Status transitions
  // --------------------------------------------------------------------

  private recordHistory(
    reservationId: number,
    fromStatus: ReservationStatus | null,
    toStatus: ReservationStatus,
    actorUserId: number | null,
    note: string | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO reservation_history (reservation_id, from_status, to_status, actor_user_id, note)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(reservationId, fromStatus, toStatus, actorUserId, note);
  }

  /**
   * The one place every status change goes through. Rejects any transition
   * not in ALLOWED_TRANSITIONS — never a raw status write from a claimed
   * renderer value. Releases capacity implicitly (by moving the status out
   * of OCCUPYING_STATUSES) and releases any RESERVED coupon explicitly on
   * CANCELLED/NO_SHOW.
   */
  transition(
    reservationId: number,
    toStatus: ReservationStatus,
    actorUserId: number | null = null,
    note: string | null = null
  ): Reservation {
    const run = this.db.transaction((): Reservation => {
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);

      const allowed = ALLOWED_TRANSITIONS[reservation.status] ?? [];
      if (!allowed.includes(toStatus)) {
        throw new ReservationConflictError(
          `Cannot move reservation from ${reservation.status} to ${toStatus}`
        );
      }

      if (toStatus === 'CANCELLED' || toStatus === 'NO_SHOW') {
        // Release every coupon's coverage this reservation is holding — not
        // just the "primary" one, since a reservation can carry several.
        // Each is a no-op for any coupon already CONSUMED (paid) — cancelling
        // never undoes a completed redemption.
        for (const couponId of this.activeCouponIds(reservationId)) {
          this.coupons.releaseCoverage(couponId, reservationId);
        }
        this.recalculateAggregates(reservationId);
      }

      this.db
        .prepare(
          `UPDATE reservations SET status = ?, cancel_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`
        )
        .run(toStatus, toStatus === 'CANCELLED' || toStatus === 'NO_SHOW' ? note : reservation.cancelReason, reservationId);

      this.recordHistory(reservationId, reservation.status, toStatus, actorUserId, note);
      this.audit.log('RESERVATION_STATUS_CHANGED', 'reservation', reservationId, {
        from: reservation.status,
        to: toStatus,
        actorUserId,
        note,
      });

      if (toStatus === 'CANCELLED' || toStatus === 'NO_SHOW') {
        this.notifications.emit({
          type: 'RESERVATION_CANCELLED',
          title: toStatus === 'NO_SHOW' ? 'Reservation: no-show' : 'Reservation cancelled',
          message: `Reservation #${reservationId} marked ${toStatus}.`,
          entity: 'reservation',
          entityId: reservationId,
        });
      }

      return this.getById(reservationId)!;
    });
    return run();
  }

  checkIn(id: number, actorUserId: number | null = null): Reservation {
    return this.transition(id, 'CHECKED_IN', actorUserId);
  }
  start(id: number, actorUserId: number | null = null): Reservation {
    return this.transition(id, 'IN_PROGRESS', actorUserId);
  }
  complete(id: number, actorUserId: number | null = null): Reservation {
    return this.transition(id, 'COMPLETED', actorUserId);
  }
  cancel(id: number, reason: string | null, actorUserId: number | null = null): Reservation {
    return this.transition(id, 'CANCELLED', actorUserId, reason);
  }
  noShow(id: number, actorUserId: number | null = null): Reservation {
    return this.transition(id, 'NO_SHOW', actorUserId);
  }

  // --------------------------------------------------------------------
  // Payment — the key one-click business rule (Prime Paddle spec §15/§16):
  // Payment PAID and coupon RESERVED->USED happen atomically. There is no
  // separate "use coupon" step for staff.
  // --------------------------------------------------------------------

  markAsPaid(reservationId: number, actorUserId: number | null = null): Reservation {
    const run = this.db.transaction((): Reservation => {
      let reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') {
        throw new ReservationConflictError(`Cannot take payment on a ${reservation.status} reservation`);
      }

      // Self-heal before charging: recompute discount/total from the LIVE
      // ledger rather than trusting the cached columns as-is. This matters
      // because a coupon could in principle have been released (e.g. by an
      // administrative action elsewhere) without this reservation's cache
      // being refreshed yet — the customer must always be charged the
      // correct CURRENT amount, never a stale one that assumes a coupon
      // still applies when it no longer does.
      this.recalculateAggregates(reservationId);
      reservation = this.getById(reservationId)!;

      const paidAt = new Date().toISOString();
      const updateResult = this.db
        .prepare(
          `UPDATE reservations SET payment_status = 'PAID', paid_at = ?, updated_at = ?
           WHERE id = ? AND payment_status = 'UNPAID'`
        )
        .run(paidAt, paidAt, reservationId);

      if (updateResult.changes === 0) {
        // Already paid (or a race with another payment attempt) — fail
        // loudly rather than silently double-processing.
        throw new ReservationConflictError('This reservation has already been paid');
      }

      // Every coupon's RESERVED coverage is consumed inside this SAME
      // transaction as the payment_status update above — if any of them
      // throws, better-sqlite3 rolls back the whole transaction,
      // payment_status reverts to UNPAID too. "PAID but a coupon still
      // RESERVED" is therefore structurally impossible, not just unlikely.
      const couponIds = this.activeCouponIds(reservationId);
      for (const couponId of couponIds) {
        this.coupons.consumeCoverage(couponId, reservationId);
      }
      if (couponIds.length > 0) this.recalculateAggregates(reservationId);

      this.audit.log('RESERVATION_PAYMENT_COMPLETED', 'reservation', reservationId, {
        finalPriceCents: reservation.finalPriceCents,
        couponIds,
        actorUserId,
      });
      this.notifications.emit({
        type: 'RESERVATION_PAID',
        title: 'Payment received',
        message: `Reservation #${reservationId} marked as paid.`,
        entity: 'reservation',
        entityId: reservationId,
      });

      return this.getById(reservationId)!;
    });
    return run();
  }

  // --------------------------------------------------------------------
  // Walk-in -> Advance conversion ("Book Another Date").
  //
  // The common case (customer changes their mind before the walk-in wizard
  // is ever committed) needs no backend call at all — the renderer just
  // keeps its in-progress customer/players/notes state and swaps which
  // wizard steps/IPC call it finishes with. This method covers the other
  // case: a walk-in that was ALREADY created (CONFIRMED/CHECKED_IN) and
  // staff now needs to push it to a future date instead. It is a
  // cancel-and-recreate, but atomic, preserving the customer and (if
  // present) transferring — never releasing-then-re-reserving — any
  // RESERVED coupon so the customer doesn't lose their spot in a race.
  // --------------------------------------------------------------------

  rescheduleToAdvance(params: {
    reservationId: number;
    reservationDate: string;
    startTime: string;
    durationMin: number;
    periodId?: number | null;
    actorUserId?: number | null;
  }): Reservation {
    const run = this.db.transaction((): Reservation => {
      const original = this.getById(params.reservationId);
      if (!original) throw new ReservationNotFoundError(`Reservation ${params.reservationId} not found`);
      if (original.status !== 'CONFIRMED' && original.status !== 'CHECKED_IN') {
        throw new ReservationConflictError(
          `Only a CONFIRMED or CHECKED_IN reservation can be rescheduled (current status: ${original.status})`
        );
      }

      // Availability check for the new slot, same as creation.
      const day = this.availability.getDayAvailability(params.reservationDate);
      if (!day.isOpen) throw new SlotUnavailableError(`${params.reservationDate} is closed for reservations`);
      const slot = day.slots.find((s) => s.startTime === params.startTime);
      if (!slot) throw new SlotUnavailableError(`${params.startTime} is not a valid slot`);
      if (slot.status === 'CLOSED' || slot.status === 'COMPLETED' || slot.status === 'FULL') {
        throw new SlotUnavailableError('The requested new slot is not bookable');
      }

      const newPricePerPlayerCents = this.pricePerPlayerCentsFor(
        params.reservationDate,
        params.periodId ?? slot.periodId,
        params.durationMin
      );
      const basePriceCents = newPricePerPlayerCents * original.players;

      // Insert first with no coupon/discount — every coupon the original
      // reservation held gets transferred (with its eligible amount
      // repriced for the new date) right after, then aggregates recompute.
      const insertResult = this.db
        .prepare(
          `INSERT INTO reservations
            (customer_id, reservation_type, status, reservation_date, start_time, duration_min,
             period_id, players, base_price_cents, discount_cents, final_price_cents,
             coupon_id, payment_status, notes, created_by_user_id)
           VALUES (?, 'ADVANCE', 'CONFIRMED', ?, ?, ?, ?, ?, ?, 0, ?, NULL, 'UNPAID', ?, ?)`
        )
        .run(
          original.customerId,
          params.reservationDate,
          params.startTime,
          params.durationMin,
          params.periodId ?? slot.periodId,
          original.players,
          basePriceCents,
          basePriceCents,
          original.notes,
          params.actorUserId ?? null
        );
      const newId = Number(insertResult.lastInsertRowid);

      const transferredCouponIds = this.activeCouponIds(original.id);
      for (const couponId of transferredCouponIds) {
        this.coupons.transferCoverage(couponId, original.id, newId, newPricePerPlayerCents);
      }
      if (transferredCouponIds.length > 0) this.recalculateAggregates(newId);

      this.db
        .prepare(
          `UPDATE reservations SET status = 'CANCELLED', cancel_reason = ?, coupon_id = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(`Rescheduled to reservation #${newId}`, original.id);
      // Every coupon it held has just moved to the new reservation, so its
      // own cached discount/total should show 0, not stale pre-reschedule numbers.
      this.recalculateAggregates(original.id);

      this.recordHistory(original.id, original.status, 'CANCELLED', params.actorUserId ?? null, `Rescheduled to #${newId}`);
      this.recordHistory(newId, null, 'CONFIRMED', params.actorUserId ?? null, `Rescheduled from #${original.id}`);
      this.audit.log('RESERVATION_RESCHEDULED', 'reservation', original.id, { newReservationId: newId });

      return this.getById(newId)!;
    });
    return run();
  }
}
