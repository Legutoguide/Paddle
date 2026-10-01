import type Database from 'better-sqlite3';
import {
  mapReservation,
  mapReservationWithDetails,
  mapReservationHistory,
  type ReservationRow,
  type ReservationWithDetailsRow,
  type ReservationHistoryRow,
} from '../db/mappers';
import type {
  Reservation,
  ReservationWithDetails,
  ReservationHistoryEntry,
  ReservationStatus,
  ReservationType,
} from '../../shared/types/domain';
import { calculatePrice } from '../../shared/lib/pricing';
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

const DETAILS_JOIN = `
  SELECT r.*, c.name as customer_name, c.phone as customer_phone,
         p.name as period_name, co.code as coupon_code
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

      // 5) Optional coupon attach (AVAILABLE -> RESERVED). A coupon's own
      // campaign originalPriceCents is the price the business configured
      // for whatever that campaign covers (often a specific group size) —
      // it REPLACES the per-player slot price above, it does not stack
      // with it. The discount then applies on top, via the same
      // calculatePrice() campaigns already use.
      let discountCents = 0;
      let finalPriceCents = basePriceCents;
      if (input.couponCode) {
        const coupon = this.coupons.getByCode(input.couponCode.trim());
        if (!coupon) throw new CouponNotFoundError('Coupon not found');
        this.coupons.reserveForReservation(coupon.id, reservationId, input.reservationDate);
        basePriceCents = coupon.originalPriceCents;
        const breakdown = calculatePrice({
          originalPriceCents: basePriceCents,
          discountType: coupon.discountType,
          discountPercentage: coupon.discountPercentage,
          discountAmountCents: coupon.discountAmountCents,
        });
        discountCents = breakdown.youSaveCents;
        finalPriceCents = breakdown.finalPriceCents;

        this.db
          .prepare(
            `UPDATE reservations SET coupon_id = ?, base_price_cents = ?, discount_cents = ?, final_price_cents = ? WHERE id = ?`
          )
          .run(coupon.id, basePriceCents, discountCents, finalPriceCents, reservationId);
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
  // Coupon attach/detach on an existing reservation (before payment).
  // --------------------------------------------------------------------

  /** The slot's own per-player price × players, with no coupon involved —
   * used both to show what a booking would cost without a coupon and to
   * restore it correctly when a coupon is detached. Never reuses a stored
   * base_price_cents directly, since that column may currently hold a
   * coupon's own (non-per-player) package price instead. */
  private resolveNoCouponBasePrice(reservationDate: string, periodId: number | null, durationMin: number, players: number): number {
    const rule = this.pricing.resolvePrice({ date: reservationDate, periodId, durationMin });
    return rule.priceCents * players;
  }

  attachCoupon(reservationId: number, couponCode: string, actorUserId: number | null = null): Reservation {
    const attach = this.db.transaction((): Reservation => {
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.paymentStatus === 'PAID') {
        throw new ReservationConflictError('Cannot attach a coupon to an already-paid reservation');
      }
      if (reservation.couponId) {
        throw new ReservationConflictError('This reservation already has a coupon attached; detach it first');
      }
      const coupon = this.coupons.getByCode(couponCode.trim());
      if (!coupon) throw new CouponNotFoundError('Coupon not found');

      this.coupons.reserveForReservation(coupon.id, reservationId, reservation.reservationDate);
      // The coupon's own campaign price replaces the per-player slot price
      // — it does not stack with it (see createInternal for the full
      // reasoning: a coupon often already represents a specific group's
      // package price, e.g. "2 players", configured by the business).
      const basePriceCents = coupon.originalPriceCents;
      const breakdown = calculatePrice({
        originalPriceCents: basePriceCents,
        discountType: coupon.discountType,
        discountPercentage: coupon.discountPercentage,
        discountAmountCents: coupon.discountAmountCents,
      });
      this.db
        .prepare(
          `UPDATE reservations SET coupon_id = ?, base_price_cents = ?, discount_cents = ?, final_price_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(coupon.id, basePriceCents, breakdown.youSaveCents, breakdown.finalPriceCents, reservationId);

      this.audit.log('RESERVATION_COUPON_ATTACHED', 'reservation', reservationId, { couponId: coupon.id, actorUserId });
      return this.getById(reservationId)!;
    });
    return attach();
  }

  detachCoupon(reservationId: number, actorUserId: number | null = null): Reservation {
    const detach = this.db.transaction((): Reservation => {
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.paymentStatus === 'PAID') {
        throw new ReservationConflictError('Cannot detach a coupon from an already-paid reservation');
      }
      if (reservation.couponId) {
        this.coupons.releaseReservation(reservation.couponId, reservationId);
      }
      // Restore the per-player slot price — base_price_cents currently
      // holds the coupon's own package price, not the per-player rate, so
      // it must be re-resolved fresh rather than reused as-is.
      const restoredBase = this.resolveNoCouponBasePrice(
        reservation.reservationDate,
        reservation.periodId,
        reservation.durationMin,
        reservation.players
      );
      this.db
        .prepare(
          `UPDATE reservations SET coupon_id = NULL, base_price_cents = ?, discount_cents = 0, final_price_cents = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(restoredBase, restoredBase, reservationId);
      this.audit.log('RESERVATION_COUPON_DETACHED', 'reservation', reservationId, { actorUserId });
      return this.getById(reservationId)!;
    });
    return detach();
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

      if ((toStatus === 'CANCELLED' || toStatus === 'NO_SHOW') && reservation.couponId) {
        // RESERVED -> AVAILABLE. A no-op if the coupon was already USED
        // (e.g. via a CEO override) — cancelling doesn't undo a completed
        // redemption.
        this.coupons.releaseReservation(reservation.couponId, reservationId);
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
      const reservation = this.getById(reservationId);
      if (!reservation) throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
      if (reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') {
        throw new ReservationConflictError(`Cannot take payment on a ${reservation.status} reservation`);
      }

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

      // The coupon consumption below runs inside this SAME transaction as
      // the payment_status update above. If it throws, better-sqlite3 rolls
      // back the entire transaction — payment_status reverts to UNPAID too.
      // "PAID but coupon still RESERVED" is therefore structurally
      // impossible, not just unlikely.
      if (reservation.couponId) {
        this.coupons.consumeForReservation(reservation.couponId, reservationId);
      }

      this.audit.log('RESERVATION_PAYMENT_COMPLETED', 'reservation', reservationId, {
        finalPriceCents: reservation.finalPriceCents,
        couponId: reservation.couponId,
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

      const rule = this.pricing.resolvePrice({
        date: params.reservationDate,
        periodId: params.periodId ?? slot.periodId,
        durationMin: params.durationMin,
      });

      // Same rule as creation/attach: a coupon's own campaign price
      // replaces the per-player slot price rather than stacking with it.
      let basePriceCents = rule.priceCents * original.players;
      let discountCents = 0;
      let finalPriceCents = basePriceCents;
      if (original.couponId) {
        const coupon = this.coupons.getDetailsById(original.couponId);
        if (coupon) {
          basePriceCents = coupon.originalPriceCents;
          const breakdown = calculatePrice({
            originalPriceCents: basePriceCents,
            discountType: coupon.discountType,
            discountPercentage: coupon.discountPercentage,
            discountAmountCents: coupon.discountAmountCents,
          });
          discountCents = breakdown.youSaveCents;
          finalPriceCents = breakdown.finalPriceCents;
        }
      }

      const insertResult = this.db
        .prepare(
          `INSERT INTO reservations
            (customer_id, reservation_type, status, reservation_date, start_time, duration_min,
             period_id, players, base_price_cents, discount_cents, final_price_cents,
             coupon_id, payment_status, notes, created_by_user_id)
           VALUES (?, 'ADVANCE', 'CONFIRMED', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)`
        )
        .run(
          original.customerId,
          params.reservationDate,
          params.startTime,
          params.durationMin,
          params.periodId ?? slot.periodId,
          original.players,
          basePriceCents,
          discountCents,
          finalPriceCents,
          original.couponId,
          original.notes,
          params.actorUserId ?? null
        );
      const newId = Number(insertResult.lastInsertRowid);

      if (original.couponId) {
        this.coupons.transferReservation(original.couponId, original.id, newId);
      }

      this.db
        .prepare(
          `UPDATE reservations SET status = 'CANCELLED', cancel_reason = ?, coupon_id = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        )
        .run(`Rescheduled to reservation #${newId}`, original.id);

      this.recordHistory(original.id, original.status, 'CANCELLED', params.actorUserId ?? null, `Rescheduled to #${newId}`);
      this.recordHistory(newId, null, 'CONFIRMED', params.actorUserId ?? null, `Rescheduled from #${original.id}`);
      this.audit.log('RESERVATION_RESCHEDULED', 'reservation', original.id, { newReservationId: newId });

      return this.getById(newId)!;
    });
    return run();
  }
}
