// Single source of truth for every IPC channel the renderer is allowed to
// call. Both main (handlers) and preload (bridge) import this file so the
// two sides can never drift out of sync on channel names.

export const IPC = {
  // Sponsors
  SPONSOR_LIST: 'sponsor:list',
  SPONSOR_CREATE: 'sponsor:create',
  SPONSOR_UPDATE: 'sponsor:update',
  SPONSOR_ARCHIVE: 'sponsor:archive',
  SPONSOR_UNARCHIVE: 'sponsor:unarchive',
  SPONSOR_DELETE: 'sponsor:delete',
  SPONSOR_STATS: 'sponsor:stats',

  // Campaigns
  CAMPAIGN_LIST: 'campaign:list',
  CAMPAIGN_CREATE: 'campaign:create',
  CAMPAIGN_UPDATE: 'campaign:update',
  CAMPAIGN_ARCHIVE: 'campaign:archive',
  CAMPAIGN_UNARCHIVE: 'campaign:unarchive',
  CAMPAIGN_DELETE: 'campaign:delete',
  CAMPAIGN_STATS: 'campaign:stats',
  CAMPAIGN_PREVIEW_PRICE: 'campaign:previewPrice',

  // Coupons
  COUPON_LIST: 'coupon:list',
  COUPON_GENERATE: 'coupon:generate',
  COUPON_VALIDATE: 'coupon:validate',
  COUPON_CONFIRM_USE: 'coupon:confirmUse',
  COUPON_REVOKE: 'coupon:revoke',
  COUPON_REVOKE_MANY: 'coupon:revokeMany',
  COUPON_GET_QR: 'coupon:getQr',
  COUPON_COVERAGE_STATE: 'coupon:coverageState',

  // History
  HISTORY_LIST: 'history:list',
  HISTORY_EXPORT_CSV: 'history:exportCsv',

  // Import/export
  IMPORT_PREVIEW_CSV: 'import:previewCsv',
  IMPORT_CONFIRM: 'import:confirm',
  EXPORT_COUPONS_CSV: 'export:couponsCsv',
  EXPORT_COUPONS_PDF: 'export:couponsPdf',

  // Dashboard/stats
  DASHBOARD_STATS: 'dashboard:stats',
  DASHBOARD_DAILY_USAGE: 'dashboard:dailyUsage',
  DASHBOARD_SPONSOR_PERFORMANCE: 'dashboard:sponsorPerformance',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_IS_FIRST_RUN: 'settings:isFirstRun',
  SETTINGS_PICK_FOLDER: 'settings:pickFolder',
  SETTINGS_PICK_LOGO: 'settings:pickLogo',
  SETTINGS_PICK_IMAGE: 'settings:pickImage',

  // Backup/restore
  BACKUP_CREATE: 'backup:create',
  BACKUP_PICK_DESTINATION: 'backup:pickDestination',
  BACKUP_PICK_RESTORE_FILE: 'backup:pickRestoreFile',
  BACKUP_RESTORE: 'backup:restore',

  // Batches
  BATCH_LIST: 'batch:list',
  BATCH_ARCHIVE: 'batch:archive',

  // Notifications
  NOTIFICATION_LIST: 'notification:list',
  NOTIFICATION_UNREAD_COUNT: 'notification:unreadCount',
  NOTIFICATION_MARK_READ: 'notification:markRead',
  NOTIFICATION_MARK_ALL_READ: 'notification:markAllRead',
  NOTIFICATION_CLEAR_ALL: 'notification:clearAll',

  // Session logs
  SESSION_LOG_LIST: 'sessionLog:list',

  // Device info
  DEVICE_INFO_GET: 'deviceInfo:get',

  // Danger zone
  DANGER_ZONE_RESET_ALL: 'dangerZone:resetAll',

  // Audit log
  AUDIT_LIST: 'audit:list',

  // App-level
  APP_GET_VERSION: 'app:getVersion',

  // Auth
  AUTH_HAS_ANY_USER: 'auth:hasAnyUser',
  AUTH_CREATE_FIRST_USER: 'auth:createFirstUser',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_CURRENT_SESSION: 'auth:currentSession',
  USER_LIST: 'user:list',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_RESET_PASSWORD: 'user:resetPassword',
  LOGIN_LOG_LIST: 'loginLog:list',

  // Branches (local tag/category)
  BRANCH_LIST: 'branch:list',
  BRANCH_CREATE: 'branch:create',
  BRANCH_UPDATE: 'branch:update',
  BRANCH_DELETE: 'branch:delete',

  // PRIME PADDLE — Reservations
  RESERVATION_LIST: 'reservation:list',
  RESERVATION_SEARCH: 'reservation:search',
  RESERVATION_GET: 'reservation:get',
  RESERVATION_HISTORY: 'reservation:history',
  RESERVATION_CREATE_WALKIN: 'reservation:createWalkIn',
  RESERVATION_CREATE_ADVANCE: 'reservation:createAdvance',
  RESERVATION_RESCHEDULE_TO_ADVANCE: 'reservation:rescheduleToAdvance',
  RESERVATION_ATTACH_COUPON: 'reservation:attachCoupon',
  RESERVATION_DETACH_COUPON: 'reservation:detachCoupon',
  RESERVATION_PRICE_BREAKDOWN: 'reservation:priceBreakdown',
  RESERVATION_LIST_PARTICIPANTS: 'reservation:listParticipants',
  RESERVATION_SET_PARTICIPANTS: 'reservation:setParticipants',
  RESERVATION_CHECKIN: 'reservation:checkIn',
  RESERVATION_START: 'reservation:start',
  RESERVATION_COMPLETE: 'reservation:complete',
  RESERVATION_CANCEL: 'reservation:cancel',
  RESERVATION_NO_SHOW: 'reservation:noShow',
  RESERVATION_MARK_PAID: 'reservation:markPaid',

  // PRIME PADDLE — Availability / periods / business hours
  AVAILABILITY_GET_DAY: 'availability:getDay',
  AVAILABILITY_GET_RANGE: 'availability:getRange',
  AVAILABILITY_NEXT_AVAILABLE: 'availability:nextAvailable',
  BUSINESS_HOURS_LIST: 'businessHours:list',
  BUSINESS_HOURS_UPDATE: 'businessHours:update',
  PERIOD_LIST: 'period:list',
  PERIOD_UPSERT: 'period:upsert',

  // PRIME PADDLE — Pricing
  PRICING_RULE_LIST: 'pricingRule:list',
  PRICING_RULE_CREATE: 'pricingRule:create',
  PRICING_RULE_UPDATE: 'pricingRule:update',
  PRICING_PREVIEW: 'pricing:preview',

  // PRIME PADDLE — Customers
  CUSTOMER_LIST: 'customer:list',
  CUSTOMER_SEARCH: 'customer:search',
  CUSTOMER_GET: 'customer:get',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',

  // PRIME PADDLE — Dashboard & reports
  RESERVATION_DASHBOARD: 'reservation:dashboard',
  RESERVATION_REPORT: 'reservation:report',

  // PRIME PADDLE — Calendar (thin read wrapper over availability + reservations)
  CALENDAR_GET_RANGE: 'calendar:getRange',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
