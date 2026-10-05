import type {
  Sponsor,
  Campaign,
  Coupon,
  UsageHistoryEntry,
  AuditLogEntry,
  CouponWithDetails,
  Customer,
  CustomerStats,
  Period,
  BusinessHours,
  PricingRule,
  Reservation,
  ReservationWithDetails,
  ReservationHistoryEntry,
  ReservationParticipant,
  CouponRedemption,
  RedemptionStatus,
} from '../../shared/types/domain';

// Raw row shapes as returned directly by better-sqlite3 (snake_case).

export interface SponsorRow {
  id: number;
  name: string;
  notes: string | null;
  logo_path: string | null;
  photo_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function mapSponsor(row: SponsorRow): Sponsor {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    logoPath: row.logo_path,
    photoPath: row.photo_path,
    status: row.status as Sponsor['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export interface CampaignRow {
  id: number;
  sponsor_id: number;
  campaign_name: string;
  service_name: string;
  duration: string | null;
  discount_type: string;
  original_price_cents: number;
  discount_percentage: number;
  discount_amount_cents: number;
  final_price_cents: number;
  total_codes: number;
  coverage_players: number;
  image_path: string | null;
  banner_path: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    sponsorId: row.sponsor_id,
    campaignName: row.campaign_name,
    serviceName: row.service_name,
    duration: row.duration,
    discountType: row.discount_type as Campaign['discountType'],
    originalPriceCents: row.original_price_cents,
    discountPercentage: row.discount_percentage,
    discountAmountCents: row.discount_amount_cents,
    finalPriceCents: row.final_price_cents,
    totalCodes: row.total_codes,
    coveragePlayers: row.coverage_players,
    imagePath: row.image_path,
    bannerPath: row.banner_path,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as Campaign['status'],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CouponRow {
  id: number;
  campaign_id: number;
  sponsor_id: number;
  code: string;
  display_seq: number | null;
  batch_id: number | null;
  branch_id: number | null;
  reservation_id: number | null;
  status: string;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function mapCoupon(row: CouponRow): Coupon {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sponsorId: row.sponsor_id,
    code: row.code,
    displaySeq: row.display_seq,
    batchId: row.batch_id,
    branchId: row.branch_id,
    reservationId: row.reservation_id,
    status: row.status as Coupon['status'],
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CouponWithDetailsRow extends CouponRow {
  sponsor_name: string;
  sponsor_logo_path: string | null;
  campaign_name: string;
  campaign_image_path: string | null;
  campaign_banner_path: string | null;
  service_name: string;
  duration: string | null;
  original_price_cents: number;
  discount_percentage: number;
  discount_amount_cents: number;
  discount_type: string;
  final_price_cents: number;
  campaign_status: string;
  coverage_players: number;
}

export function mapCouponWithDetails(row: CouponWithDetailsRow): CouponWithDetails {
  return {
    ...mapCoupon(row),
    sponsorName: row.sponsor_name,
    sponsorLogoPath: row.sponsor_logo_path,
    campaignName: row.campaign_name,
    campaignImagePath: row.campaign_image_path,
    campaignBannerPath: row.campaign_banner_path,
    serviceName: row.service_name,
    duration: row.duration,
    originalPriceCents: row.original_price_cents,
    discountPercentage: row.discount_percentage,
    discountAmountCents: row.discount_amount_cents,
    discountType: row.discount_type as CouponWithDetails['discountType'],
    finalPriceCents: row.final_price_cents,
    campaignStatus: row.campaign_status as CouponWithDetails['campaignStatus'],
    coveragePlayers: row.coverage_players,
  };
}

export interface UsageHistoryRow {
  id: number;
  coupon_id: number;
  code: string;
  campaign_id: number;
  sponsor_id: number;
  sponsor_name: string;
  campaign_name: string;
  original_price_cents: number;
  discount_percentage: number;
  final_price_cents: number;
  operator: string | null;
  used_at: string;
}

export function mapUsageHistory(row: UsageHistoryRow): UsageHistoryEntry {
  return {
    id: row.id,
    couponId: row.coupon_id,
    code: row.code,
    campaignId: row.campaign_id,
    sponsorId: row.sponsor_id,
    sponsorName: row.sponsor_name,
    campaignName: row.campaign_name,
    originalPriceCents: row.original_price_cents,
    discountPercentage: row.discount_percentage,
    finalPriceCents: row.final_price_cents,
    operator: row.operator,
    usedAt: row.used_at,
  };
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  details: string | null;
  created_at: string;
}

export function mapAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

// ============================================================================
// PRIME PADDLE — Reservation system row shapes/mappers (schema v6)
// ============================================================================

export interface CustomerRow {
  id: number;
  name: string;
  phone: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CustomerStatsRow {
  total_reservations: number;
  completed_reservations: number;
  cancelled_reservations: number;
  no_show_reservations: number;
  total_spend_cents: number | null;
  coupon_usage_count: number;
  last_visit_at: string | null;
}

export function mapCustomerStats(row: CustomerStatsRow): CustomerStats {
  return {
    totalReservations: row.total_reservations,
    completedReservations: row.completed_reservations,
    cancelledReservations: row.cancelled_reservations,
    noShowReservations: row.no_show_reservations,
    totalSpendCents: row.total_spend_cents ?? 0,
    couponUsageCount: row.coupon_usage_count,
    lastVisitAt: row.last_visit_at,
  };
}

export interface PeriodRow {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  sort_order: number;
  active: number;
  created_at: string;
}

export function mapPeriod(row: PeriodRow): Period {
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    sortOrder: row.sort_order,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export interface BusinessHoursRow {
  weekday: number;
  is_open: number;
  open_time: string | null;
  close_time: string | null;
  slot_minutes: number;
  capacity: number;
}

export function mapBusinessHours(row: BusinessHoursRow): BusinessHours {
  return {
    weekday: row.weekday,
    isOpen: row.is_open === 1,
    openTime: row.open_time,
    closeTime: row.close_time,
    slotMinutes: row.slot_minutes,
    capacity: row.capacity,
  };
}

export interface PricingRuleRow {
  id: number;
  name: string;
  weekday_mask: number;
  period_id: number | null;
  duration_min: number;
  price_cents: number;
  priority: number;
  active: number;
  created_at: string;
}

export function mapPricingRule(row: PricingRuleRow): PricingRule {
  return {
    id: row.id,
    name: row.name,
    weekdayMask: row.weekday_mask,
    periodId: row.period_id,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    priority: row.priority,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export interface ReservationRow {
  id: number;
  customer_id: number;
  reservation_type: string;
  status: string;
  reservation_date: string;
  start_time: string;
  duration_min: number;
  period_id: number | null;
  players: number;
  base_price_cents: number;
  discount_cents: number;
  final_price_cents: number;
  coupon_id: number | null;
  payment_status: string;
  paid_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export function mapReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    customerId: row.customer_id,
    reservationType: row.reservation_type as Reservation['reservationType'],
    status: row.status as Reservation['status'],
    reservationDate: row.reservation_date,
    startTime: row.start_time,
    durationMin: row.duration_min,
    periodId: row.period_id,
    players: row.players,
    basePriceCents: row.base_price_cents,
    discountCents: row.discount_cents,
    finalPriceCents: row.final_price_cents,
    couponId: row.coupon_id,
    paymentStatus: row.payment_status as Reservation['paymentStatus'],
    paidAt: row.paid_at,
    cancelReason: row.cancel_reason,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ReservationWithDetailsRow extends ReservationRow {
  customer_name: string;
  customer_phone: string;
  period_name: string | null;
  coupon_code: string | null;
  coupon_count: number;
}

export function mapReservationWithDetails(row: ReservationWithDetailsRow): ReservationWithDetails {
  return {
    ...mapReservation(row),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    periodName: row.period_name,
    couponCode: row.coupon_code,
    couponCount: row.coupon_count,
  };
}

export interface ReservationHistoryRow {
  id: number;
  reservation_id: number;
  from_status: string | null;
  to_status: string;
  actor_user_id: number | null;
  note: string | null;
  created_at: string;
}

export function mapReservationHistory(row: ReservationHistoryRow): ReservationHistoryEntry {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    fromStatus: row.from_status as ReservationHistoryEntry['fromStatus'],
    toStatus: row.to_status as ReservationHistoryEntry['toStatus'],
    actorUserId: row.actor_user_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

// ============================================================================
// PRIME PADDLE — coupon coverage: participants & redemption ledger (v7)
// ============================================================================

export interface ReservationParticipantRow {
  id: number;
  reservation_id: number;
  name: string | null;
  sort_order: number;
  created_at: string;
}

export function mapReservationParticipant(row: ReservationParticipantRow): ReservationParticipant {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export interface CouponRedemptionRow {
  id: number;
  coupon_id: number;
  reservation_id: number;
  participant_id: number | null;
  coverage_consumed: number;
  eligible_amount_cents: number;
  discount_cents: number;
  status: string;
  actor_user_id: number | null;
  created_at: string;
  consumed_at: string | null;
  released_at: string | null;
}

export function mapCouponRedemption(row: CouponRedemptionRow): CouponRedemption {
  return {
    id: row.id,
    couponId: row.coupon_id,
    reservationId: row.reservation_id,
    participantId: row.participant_id,
    coverageConsumed: row.coverage_consumed,
    eligibleAmountCents: row.eligible_amount_cents,
    discountCents: row.discount_cents,
    status: row.status as RedemptionStatus,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
    releasedAt: row.released_at,
  };
}
