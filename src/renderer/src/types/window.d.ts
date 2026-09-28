// Mirrors src/preload/preload.ts's exposed shape. Kept as a standalone
// declaration (rather than importing preload.ts directly) so the renderer's
// tsconfig doesn't need to pull in Electron/Node types.
import type {
  Sponsor,
  Campaign,
  Coupon,
  CouponWithDetails,
  UsageHistoryEntry,
  AuditLogEntry,
  AppSettings,
  ValidationResult,
  DashboardStats,
  ImportPreview,
  SponsorStatus,
  CampaignStatus,
  CouponStatus,
  DiscountType,
  Reservation,
  ReservationWithDetails,
  ReservationHistoryEntry,
  ReservationStatus,
  ReservationType,
  Customer,
  CustomerWithStats,
  Period,
  BusinessHours,
  PricingRule,
  DayAvailability,
  AvailabilitySlot,
  ReservationDashboardStats,
  ReservationReport,
} from '@shared/types/domain';
import type { PriceBreakdown } from '@shared/lib/pricing';

export interface CreateSponsorInput {
  name: string;
  notes?: string | null;
  logoPath?: string | null;
  photoPath?: string | null;
}

export interface CreateCampaignInput {
  sponsorId: number;
  campaignName: string;
  serviceName: string;
  duration?: string | null;
  discountType?: DiscountType;
  originalPrice: number;
  discountPercentage?: number;
  discountAmount?: number;
  imagePath?: string | null;
  bannerPath?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface GenerateCodesInput {
  campaignId: number;
  count: number;
  prefix?: string;
  expiresAt?: string | null;
  branchId?: number | null;
}

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

export interface SessionLogEntry {
  id: number;
  appVersion: string;
  deviceName: string;
  platform: string;
  startedAt: string;
}

export interface DeviceInfo {
  deviceName: string;
  platform: string;
  arch: string;
  appVersion: string;
  cpus: number;
  totalMemoryGB: number;
  databasePath: string;
}

export type UserRole = 'CEO' | 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface AppUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginLogEntry {
  id: number;
  userId: number | null;
  username: string;
  success: boolean;
  reason: string | null;
  deviceName: string | null;
  appVersion: string | null;
  createdAt: string;
}

export interface Branch {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
}

export interface SponsorQRApi {
  sponsors: {
    list: (params?: { status?: SponsorStatus; search?: string }) => Promise<Sponsor[]>;
    create: (input: CreateSponsorInput) => Promise<Sponsor>;
    update: (id: number, input: Partial<CreateSponsorInput>) => Promise<Sponsor>;
    archive: (id: number) => Promise<Sponsor>;
    unarchive: (id: number) => Promise<Sponsor>;
    delete: (id: number) => Promise<void>;
    stats: (id: number) => Promise<{
      totalCampaigns: number;
      totalCodes: number;
      available: number;
      used: number;
      expired: number;
      revoked: number;
      usageRatePercent: number;
    }>;
  };
  campaigns: {
    list: (params?: { sponsorId?: number; status?: CampaignStatus; search?: string }) => Promise<Campaign[]>;
    create: (input: CreateCampaignInput) => Promise<Campaign>;
    update: (id: number, input: Partial<CreateCampaignInput>) => Promise<Campaign>;
    archive: (id: number) => Promise<Campaign>;
    unarchive: (id: number) => Promise<Campaign>;
    delete: (id: number) => Promise<void>;
    stats: (id: number) => Promise<{ totalCodes: number; available: number; used: number; expired: number; revoked: number }>;
    previewPrice: (input: {
      originalPrice: number;
      discountType: DiscountType;
      discountPercentage?: number;
      discountAmount?: number;
    }) => Promise<PriceBreakdown>;
  };
  coupons: {
    list: (params?: {
      campaignId?: number;
      sponsorId?: number;
      status?: CouponStatus;
      search?: string;
      limit?: number;
      offset?: number;
    }) => Promise<{ items: CouponWithDetails[]; total: number }>;
    generate: (input: GenerateCodesInput) => Promise<Coupon[]>;
    validate: (code: string) => Promise<ValidationResult>;
    confirmUse: (code: string, operator?: string | null) => Promise<{ coupon: CouponWithDetails; usedAt: string }>;
    revoke: (id: number, reason?: string | null) => Promise<Coupon>;
    revokeMany: (ids: number[], reason?: string | null) => Promise<{ revoked: number[]; skipped: { id: number; why: string }[] }>;
    getQr: (code: string) => Promise<string>;
  };
  history: {
    list: (params?: {
      search?: string;
      sponsorId?: number;
      campaignId?: number;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
      offset?: number;
    }) => Promise<{ items: UsageHistoryEntry[]; total: number }>;
    exportCsv: (params?: unknown) => Promise<{ filePath: string; count: number }>;
  };
  importExport: {
    previewCsv: (csvContent: string) => Promise<ImportPreview>;
    confirmImport: (params: { campaignId: number; codes: string[]; expiresAt?: string | null }) => Promise<Coupon[]>;
    exportCouponsCsv: (params?: unknown) => Promise<{ filePath: string; count: number }>;
    exportCouponsPdf: (couponIds: number[]) => Promise<{ filePath: string; count: number }>;
  };
  dashboard: {
    stats: () => Promise<DashboardStats>;
    dailyUsage: (days?: number) => Promise<{ date: string; count: number }[]>;
    sponsorPerformance: () => Promise<{ sponsorId: number; sponsorName: string; used: number; total: number }[]>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (partial: Partial<AppSettings>) => Promise<AppSettings>;
    isFirstRun: () => Promise<boolean>;
    pickFolder: () => Promise<string | null>;
    pickLogo: () => Promise<string | null>;
    pickImage: () => Promise<string | null>;
  };
  backup: {
    pickDestination: () => Promise<string | null>;
    create: (destinationPath?: string) => Promise<{ filePath: string }>;
    pickRestoreFile: () => Promise<string | null>;
    restore: (backupFilePath: string) => Promise<{ safetyCopyPath: string }>;
  };
  audit: {
    list: (limit?: number) => Promise<AuditLogEntry[]>;
  };
  batches: {
    list: (params?: { campaignId?: number; sponsorId?: number; status?: 'ACTIVE' | 'ARCHIVED' }) => Promise<BatchWithDetails[]>;
    archive: (id: number) => Promise<Batch>;
  };
  notifications: {
    list: (params?: { unreadOnly?: boolean; limit?: number }) => Promise<AppNotification[]>;
    unreadCount: () => Promise<number>;
    markRead: (id: number) => Promise<void>;
    markAllRead: () => Promise<void>;
    clearAll: () => Promise<void>;
  };
  sessionLogs: {
    list: (params?: { dateFrom?: string; limit?: number }) => Promise<SessionLogEntry[]>;
  };
  deviceInfo: {
    get: () => Promise<DeviceInfo>;
  };
  dangerZone: {
    resetAll: () => Promise<{ sponsorsRemoved: number; campaignsRemoved: number; couponsRemoved: number; safetyBackupPath: string }>;
  };
  app: {
    getVersion: () => Promise<string>;
  };
  auth: {
    hasAnyUser: () => Promise<boolean>;
    createFirstUser: (params: { username: string; password: string; displayName: string }) => Promise<AppUser>;
    login: (username: string, password: string) => Promise<AppUser>;
    logout: () => Promise<void>;
    currentSession: () => Promise<AppUser | null>;
  };
  users: {
    list: () => Promise<AppUser[]>;
    create: (input: { username: string; password: string; displayName: string; role: UserRole }) => Promise<AppUser>;
    update: (id: number, input: Partial<{ displayName: string; role: UserRole; enabled: boolean }>) => Promise<AppUser>;
    delete: (id: number) => Promise<void>;
    resetPassword: (id: number, newPassword: string) => Promise<void>;
  };
  loginLogs: {
    list: (params?: { limit?: number; dateFrom?: string }) => Promise<LoginLogEntry[]>;
  };
  branches: {
    list: () => Promise<Branch[]>;
    create: (input: { name: string; notes?: string | null }) => Promise<Branch>;
    update: (id: number, input: { name?: string; notes?: string | null }) => Promise<Branch>;
    delete: (id: number) => Promise<void>;
  };
  // Prime Paddle reservation system
  reservations: {
    list: (params?: {
      dateFrom?: string;
      dateTo?: string;
      status?: ReservationStatus;
      customerId?: number;
    }) => Promise<ReservationWithDetails[]>;
    search: (query: string) => Promise<ReservationWithDetails[]>;
    get: (id: number) => Promise<ReservationWithDetails | null>;
    history: (id: number) => Promise<ReservationHistoryEntry[]>;
    createWalkIn: (input: CreateReservationInput) => Promise<Reservation>;
    createAdvance: (input: CreateReservationInput) => Promise<Reservation>;
    rescheduleToAdvance: (params: {
      reservationId: number;
      reservationDate: string;
      startTime: string;
      durationMin: number;
      periodId?: number | null;
    }) => Promise<Reservation>;
    attachCoupon: (id: number, couponCode: string) => Promise<Reservation>;
    detachCoupon: (id: number) => Promise<Reservation>;
    checkIn: (id: number) => Promise<Reservation>;
    start: (id: number) => Promise<Reservation>;
    complete: (id: number) => Promise<Reservation>;
    cancel: (id: number, reason?: string | null) => Promise<Reservation>;
    noShow: (id: number) => Promise<Reservation>;
    markAsPaid: (id: number) => Promise<Reservation>;
    dashboard: () => Promise<ReservationDashboardStats>;
    report: (dateFrom: string, dateTo: string) => Promise<ReservationReport>;
  };
  availability: {
    getDay: (date: string) => Promise<DayAvailability>;
    getRange: (startDate: string, endDate: string) => Promise<DayAvailability[]>;
    nextAvailable: (fromDate: string, fromTime: string, maxDaysAhead?: number) => Promise<AvailabilitySlot | null>;
  };
  businessHours: {
    list: () => Promise<BusinessHours[]>;
    update: (weekday: number, input: Partial<Omit<BusinessHours, 'weekday'>>) => Promise<BusinessHours>;
  };
  periods: {
    list: () => Promise<Period[]>;
    upsert: (input: {
      id?: number;
      name: string;
      startTime: string;
      endTime: string;
      sortOrder?: number;
      active?: boolean;
    }) => Promise<Period>;
  };
  pricingRules: {
    list: () => Promise<PricingRule[]>;
    create: (input: {
      name: string;
      weekdayMask: number;
      periodId?: number | null;
      durationMin: number;
      priceCents: number;
      priority?: number;
      active?: boolean;
    }) => Promise<PricingRule>;
    update: (id: number, input: Partial<{
      name: string;
      weekdayMask: number;
      periodId: number | null;
      durationMin: number;
      priceCents: number;
      priority: number;
      active: boolean;
    }>) => Promise<PricingRule>;
    preview: (params: { date: string; periodId: number | null; durationMin: number }) => Promise<PricingRule>;
  };
  customers: {
    list: () => Promise<Customer[]>;
    search: (query: string) => Promise<Customer[]>;
    get: (id: number) => Promise<CustomerWithStats | null>;
    create: (input: { name: string; phone: string; notes?: string | null }) => Promise<Customer>;
    update: (id: number, input: Partial<{ name: string; phone: string; notes: string | null }>) => Promise<Customer>;
  };
  calendar: {
    getRange: (
      startDate: string,
      endDate: string
    ) => Promise<{ days: DayAvailability[]; reservations: ReservationWithDetails[] }>;
  };
}

export interface CreateReservationInput {
  customer: { name: string; phone: string; notes?: string | null };
  reservationDate: string;
  startTime: string;
  durationMin: number;
  periodId?: number | null;
  players: number;
  couponCode?: string | null;
  notes?: string | null;
}

declare global {
  interface Window {
    api: SponsorQRApi;
  }
}
