// Domain types shared between the Electron main process and the React renderer.
// Keep this file framework-agnostic (no Node or DOM types).

export type SponsorStatus = 'ACTIVE' | 'ARCHIVED';
export type CampaignStatus = 'ACTIVE' | 'ARCHIVED';
export type CouponStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';
export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Sponsor {
  id: number;
  name: string;
  notes: string | null;
  logoPath: string | null;
  photoPath: string | null;
  status: SponsorStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Campaign {
  id: number;
  sponsorId: number;
  campaignName: string;
  serviceName: string;
  duration: string | null;
  discountType: DiscountType;
  originalPriceCents: number;
  discountPercentage: number;
  discountAmountCents: number;
  finalPriceCents: number;
  totalCodes: number;
  imagePath: string | null;
  bannerPath: string | null;
  startDate: string | null;
  endDate: string | null;
  status: CampaignStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Coupon {
  id: number;
  campaignId: number;
  sponsorId: number;
  code: string;
  displaySeq: number | null;
  batchId: number | null;
  branchId: number | null;
  reservationId: number | null;
  status: CouponStatus;
  expiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageHistoryEntry {
  id: number;
  couponId: number;
  code: string;
  campaignId: number;
  sponsorId: number;
  sponsorName: string;
  campaignName: string;
  originalPriceCents: number;
  discountPercentage: number;
  finalPriceCents: number;
  operator: string | null;
  usedAt: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

export interface AppSettings {
  businessName: string;
  currency: string;
  logoPath: string | null;
  defaultExportFolder: string | null;
  theme: 'dark' | 'light';
  autoBackupEnabled: boolean;
  autoBackupIntervalDays: number;
  operatorMode: 'ADMIN' | 'EMPLOYEE';
  soundsEnabled: boolean;
  soundVolume: number;
  // Organization settings (section 11)
  country: string;
  timezone: string;
  dateFormat: string;
  language: string;
  businessHours: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  facebookUrl: string;
  instagramUrl: string;
  // Business branding (section 12)
  mainPhotoPath: string | null;
  coverBannerPath: string | null;
  dashboardBannerPath: string | null;
  primaryColor: string;
  secondaryColor: string;
  footerContactInfo: string;
}

/** Discriminated result returned when validating a scanned/typed code. */
export type ValidationResult =
  | { outcome: 'VALID'; coupon: CouponWithDetails }
  | { outcome: 'INVALID' }
  | { outcome: 'USED'; coupon: CouponWithDetails; usedAt: string }
  | { outcome: 'EXPIRED'; coupon: CouponWithDetails }
  | { outcome: 'REVOKED'; coupon: CouponWithDetails; reason: string | null }
  // A coupon locked to a future/pending reservation. Scanning it does NOT
  // consume it — it is validation-only. Normal flows must not be able to
  // redeem it for anything other than that specific reservation's payment.
  | { outcome: 'RESERVED'; coupon: CouponWithDetails; reservation: ReservationSummary };

export interface CouponWithDetails extends Coupon {
  sponsorName: string;
  sponsorLogoPath: string | null;
  campaignName: string;
  campaignImagePath: string | null;
  campaignBannerPath: string | null;
  serviceName: string;
  duration: string | null;
  originalPriceCents: number;
  discountPercentage: number;
  discountAmountCents: number;
  discountType: DiscountType;
  finalPriceCents: number;
  campaignStatus: CampaignStatus;
}

export interface DashboardStats {
  totalSponsors: number;
  totalCampaigns: number;
  totalCodes: number;
  available: number;
  used: number;
  expired: number;
  revoked: number;
  usageRateSincePercent: number;
  todayUsage: number;
  weekUsage: number;
  monthUsage: number;
}

export interface CodeGenerationOptions {
  campaignId: number;
  count: number;
  prefix?: string;
  expiresAt?: string | null;
}

export interface ImportRowResult {
  row: number;
  code: string;
  status: 'VALID' | 'DUPLICATE_IN_FILE' | 'ALREADY_EXISTS' | 'INVALID';
  reason?: string;
}

export interface ImportPreview {
  totalRows: number;
  valid: ImportRowResult[];
  duplicatesInFile: ImportRowResult[];
  alreadyExists: ImportRowResult[];
  invalid: ImportRowResult[];
}

// ============================================================================
// PRIME PADDLE — Reservation System domain types (schema v6)
// ============================================================================

export type ReservationType = 'WALK_IN' | 'ADVANCE';

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type ReservationPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

/** Per-slot availability, always computed live — never stored/fabricated. */
export type SlotStatus = 'AVAILABLE' | 'ALMOST_FULL' | 'FULL' | 'CLOSED' | 'IN_PROGRESS' | 'COMPLETED';

export interface Customer {
  id: number;
  name: string;
  phone: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Computed (not stored) aggregate stats for a customer, joined from reservations. */
export interface CustomerStats {
  totalReservations: number;
  completedReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  totalSpendCents: number;
  couponUsageCount: number;
  lastVisitAt: string | null;
}

export interface CustomerWithStats extends Customer {
  stats: CustomerStats;
}

export interface Period {
  id: number;
  name: string;
  startTime: string; // 'HH:MM'
  endTime: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export interface BusinessHours {
  weekday: number; // 0=Sunday .. 6=Saturday
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  slotMinutes: number;
  capacity: number;
}

export interface PricingRule {
  id: number;
  name: string;
  weekdayMask: number; // bit0=Sun .. bit6=Sat
  periodId: number | null;
  durationMin: number;
  priceCents: number;
  priority: number;
  active: boolean;
  createdAt: string;
}

export interface Reservation {
  id: number;
  customerId: number;
  reservationType: ReservationType;
  status: ReservationStatus;
  reservationDate: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  durationMin: number;
  periodId: number | null;
  players: number;
  basePriceCents: number;
  discountCents: number;
  finalPriceCents: number;
  couponId: number | null;
  paymentStatus: ReservationPaymentStatus;
  paidAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight reservation view used where a full record isn't needed
 * (e.g. shown to staff when a scanned coupon turns out to be RESERVED). */
export interface ReservationSummary {
  id: number;
  reservationDate: string;
  startTime: string;
  customerName: string;
  status: ReservationStatus;
}

export interface ReservationWithDetails extends Reservation {
  customerName: string;
  customerPhone: string;
  periodName: string | null;
  couponCode: string | null;
}

export interface ReservationHistoryEntry {
  id: number;
  reservationId: number;
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus;
  actorUserId: number | null;
  note: string | null;
  createdAt: string;
}

/** One bookable slot on a given day, with live-computed status. */
export interface AvailabilitySlot {
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  endTime: string;
  periodId: number | null;
  periodName: string | null;
  capacity: number;
  occupied: number;
  status: SlotStatus;
}

export interface DayAvailability {
  date: string;
  isOpen: boolean;
  slots: AvailabilitySlot[];
}

// ---- Prime Paddle dashboard & reservation reports (all computed live from the DB) ----

export interface ReservationDashboardStats {
  date: string;
  todayReservations: number;
  todayWalkIns: number;
  todayAdvance: number;
  todayCapacityTotal: number;
  todayOccupied: number;
  todayAvailable: number;
  todayOccupancyPercent: number;
  upcomingReservations: number; // next 7 days after today, still active
  totalCustomers: number;
  couponReservationsToday: number;
  monthReservations: number;
  monthWalkIns: number;
  monthAdvance: number;
  monthCouponUsed: number;
  /** Money figures — null unless the caller holds dashboard.financial_view. */
  revenueTodayCents: number | null;
  revenueMonthCents: number | null;
}

export interface ReservationReport {
  dateFrom: string;
  dateTo: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  walkIn: number;
  advance: number;
  paid: number;
  unpaid: number;
  couponReservations: number;
  averagePlayers: number;
  occupancyPercent: number;
  popularTimes: { label: string; count: number }[];
  popularDays: { label: string; count: number }[];
  popularPeriods: { label: string; count: number }[];
  sponsorPerformance: {
    sponsorName: string;
    campaignName: string;
    reservations: number;
    couponsReserved: number;
    couponsUsed: number;
    discountCents: number | null;
    revenueCents: number | null;
  }[];
  customers: { distinct: number; newInRange: number; topBySpend: { name: string; spendCents: number | null; reservations: number }[] };
  /** Money figures — null unless the caller holds dashboard.financial_view. */
  revenueCents: number | null;
  unpaidCents: number | null;
  discountCents: number | null;
}
