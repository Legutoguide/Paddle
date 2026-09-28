import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc/contract';

// Context isolation is ON and node integration is OFF in the renderer (see
// main.ts BrowserWindow webPreferences). This is the only surface through
// which the renderer can reach the main process — a thin, explicit
// invoke-per-channel bridge, never a generic "run arbitrary IPC" passthrough.

const api = {
  sponsors: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.SPONSOR_LIST, params),
    create: (input: unknown) => ipcRenderer.invoke(IPC.SPONSOR_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.SPONSOR_UPDATE, id, input),
    archive: (id: number) => ipcRenderer.invoke(IPC.SPONSOR_ARCHIVE, id),
    unarchive: (id: number) => ipcRenderer.invoke(IPC.SPONSOR_UNARCHIVE, id),
    delete: (id: number) => ipcRenderer.invoke(IPC.SPONSOR_DELETE, id),
    stats: (id: number) => ipcRenderer.invoke(IPC.SPONSOR_STATS, id),
  },
  campaigns: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.CAMPAIGN_LIST, params),
    create: (input: unknown) => ipcRenderer.invoke(IPC.CAMPAIGN_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.CAMPAIGN_UPDATE, id, input),
    archive: (id: number) => ipcRenderer.invoke(IPC.CAMPAIGN_ARCHIVE, id),
    unarchive: (id: number) => ipcRenderer.invoke(IPC.CAMPAIGN_UNARCHIVE, id),
    delete: (id: number) => ipcRenderer.invoke(IPC.CAMPAIGN_DELETE, id),
    stats: (id: number) => ipcRenderer.invoke(IPC.CAMPAIGN_STATS, id),
    previewPrice: (input: unknown) => ipcRenderer.invoke(IPC.CAMPAIGN_PREVIEW_PRICE, input),
  },
  coupons: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.COUPON_LIST, params),
    generate: (input: unknown) => ipcRenderer.invoke(IPC.COUPON_GENERATE, input),
    validate: (code: string) => ipcRenderer.invoke(IPC.COUPON_VALIDATE, code),
    confirmUse: (code: string, operator?: string | null) => ipcRenderer.invoke(IPC.COUPON_CONFIRM_USE, code, operator),
    revoke: (id: number, reason?: string | null) => ipcRenderer.invoke(IPC.COUPON_REVOKE, id, reason),
    revokeMany: (ids: number[], reason?: string | null) => ipcRenderer.invoke(IPC.COUPON_REVOKE_MANY, ids, reason),
    getQr: (code: string) => ipcRenderer.invoke(IPC.COUPON_GET_QR, code),
  },
  history: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.HISTORY_LIST, params),
    exportCsv: (params?: unknown) => ipcRenderer.invoke(IPC.HISTORY_EXPORT_CSV, params),
  },
  importExport: {
    previewCsv: (csvContent: string) => ipcRenderer.invoke(IPC.IMPORT_PREVIEW_CSV, csvContent),
    confirmImport: (params: unknown) => ipcRenderer.invoke(IPC.IMPORT_CONFIRM, params),
    exportCouponsCsv: (params?: unknown) => ipcRenderer.invoke(IPC.EXPORT_COUPONS_CSV, params),
    exportCouponsPdf: (couponIds: number[]) => ipcRenderer.invoke(IPC.EXPORT_COUPONS_PDF, couponIds),
  },
  dashboard: {
    stats: () => ipcRenderer.invoke(IPC.DASHBOARD_STATS),
    dailyUsage: (days?: number) => ipcRenderer.invoke(IPC.DASHBOARD_DAILY_USAGE, days),
    sponsorPerformance: () => ipcRenderer.invoke(IPC.DASHBOARD_SPONSOR_PERFORMANCE),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (partial: unknown) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, partial),
    isFirstRun: () => ipcRenderer.invoke(IPC.SETTINGS_IS_FIRST_RUN),
    pickFolder: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_FOLDER),
    pickLogo: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_LOGO),
    pickImage: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_IMAGE),
  },
  backup: {
    pickDestination: () => ipcRenderer.invoke(IPC.BACKUP_PICK_DESTINATION),
    create: (destinationPath?: string) => ipcRenderer.invoke(IPC.BACKUP_CREATE, destinationPath),
    pickRestoreFile: () => ipcRenderer.invoke(IPC.BACKUP_PICK_RESTORE_FILE),
    restore: (backupFilePath: string) => ipcRenderer.invoke(IPC.BACKUP_RESTORE, backupFilePath),
  },
  audit: {
    list: (limit?: number) => ipcRenderer.invoke(IPC.AUDIT_LIST, limit),
  },
  batches: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.BATCH_LIST, params),
    archive: (id: number) => ipcRenderer.invoke(IPC.BATCH_ARCHIVE, id),
  },
  notifications: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.NOTIFICATION_LIST, params),
    unreadCount: () => ipcRenderer.invoke(IPC.NOTIFICATION_UNREAD_COUNT),
    markRead: (id: number) => ipcRenderer.invoke(IPC.NOTIFICATION_MARK_READ, id),
    markAllRead: () => ipcRenderer.invoke(IPC.NOTIFICATION_MARK_ALL_READ),
    clearAll: () => ipcRenderer.invoke(IPC.NOTIFICATION_CLEAR_ALL),
  },
  sessionLogs: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.SESSION_LOG_LIST, params),
  },
  deviceInfo: {
    get: () => ipcRenderer.invoke(IPC.DEVICE_INFO_GET),
  },
  dangerZone: {
    resetAll: () => ipcRenderer.invoke(IPC.DANGER_ZONE_RESET_ALL),
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  },
  auth: {
    hasAnyUser: () => ipcRenderer.invoke(IPC.AUTH_HAS_ANY_USER),
    createFirstUser: (params: unknown) => ipcRenderer.invoke(IPC.AUTH_CREATE_FIRST_USER, params),
    login: (username: string, password: string) => ipcRenderer.invoke(IPC.AUTH_LOGIN, { username, password }),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    currentSession: () => ipcRenderer.invoke(IPC.AUTH_CURRENT_SESSION),
  },
  users: {
    list: () => ipcRenderer.invoke(IPC.USER_LIST),
    create: (input: unknown) => ipcRenderer.invoke(IPC.USER_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.USER_UPDATE, id, input),
    delete: (id: number) => ipcRenderer.invoke(IPC.USER_DELETE, id),
    resetPassword: (id: number, newPassword: string) => ipcRenderer.invoke(IPC.USER_RESET_PASSWORD, id, newPassword),
  },
  loginLogs: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.LOGIN_LOG_LIST, params),
  },
  branches: {
    list: () => ipcRenderer.invoke(IPC.BRANCH_LIST),
    create: (input: unknown) => ipcRenderer.invoke(IPC.BRANCH_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.BRANCH_UPDATE, id, input),
    delete: (id: number) => ipcRenderer.invoke(IPC.BRANCH_DELETE, id),
  },
  // Prime Paddle reservation system
  reservations: {
    list: (params?: unknown) => ipcRenderer.invoke(IPC.RESERVATION_LIST, params),
    search: (query: string) => ipcRenderer.invoke(IPC.RESERVATION_SEARCH, query),
    get: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_GET, id),
    history: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_HISTORY, id),
    createWalkIn: (input: unknown) => ipcRenderer.invoke(IPC.RESERVATION_CREATE_WALKIN, input),
    createAdvance: (input: unknown) => ipcRenderer.invoke(IPC.RESERVATION_CREATE_ADVANCE, input),
    rescheduleToAdvance: (params: unknown) =>
      ipcRenderer.invoke(IPC.RESERVATION_RESCHEDULE_TO_ADVANCE, params),
    attachCoupon: (id: number, couponCode: string) =>
      ipcRenderer.invoke(IPC.RESERVATION_ATTACH_COUPON, id, couponCode),
    detachCoupon: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_DETACH_COUPON, id),
    checkIn: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_CHECKIN, id),
    start: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_START, id),
    complete: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_COMPLETE, id),
    cancel: (id: number, reason?: string | null) => ipcRenderer.invoke(IPC.RESERVATION_CANCEL, id, reason),
    noShow: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_NO_SHOW, id),
    // The single "Mark as Paid" call — automatically consumes a RESERVED
    // coupon atomically server-side. There is deliberately no separate
    // "use coupon" call in this bridge for the reservation-payment path.
    markAsPaid: (id: number) => ipcRenderer.invoke(IPC.RESERVATION_MARK_PAID, id),
    dashboard: () => ipcRenderer.invoke(IPC.RESERVATION_DASHBOARD),
    report: (dateFrom: string, dateTo: string) => ipcRenderer.invoke(IPC.RESERVATION_REPORT, dateFrom, dateTo),
  },
  availability: {
    getDay: (date: string) => ipcRenderer.invoke(IPC.AVAILABILITY_GET_DAY, date),
    getRange: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC.AVAILABILITY_GET_RANGE, startDate, endDate),
    nextAvailable: (fromDate: string, fromTime: string, maxDaysAhead?: number) =>
      ipcRenderer.invoke(IPC.AVAILABILITY_NEXT_AVAILABLE, fromDate, fromTime, maxDaysAhead),
  },
  businessHours: {
    list: () => ipcRenderer.invoke(IPC.BUSINESS_HOURS_LIST),
    update: (weekday: number, input: unknown) => ipcRenderer.invoke(IPC.BUSINESS_HOURS_UPDATE, weekday, input),
  },
  periods: {
    list: () => ipcRenderer.invoke(IPC.PERIOD_LIST),
    upsert: (input: unknown) => ipcRenderer.invoke(IPC.PERIOD_UPSERT, input),
  },
  pricingRules: {
    list: () => ipcRenderer.invoke(IPC.PRICING_RULE_LIST),
    create: (input: unknown) => ipcRenderer.invoke(IPC.PRICING_RULE_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.PRICING_RULE_UPDATE, id, input),
    preview: (params: unknown) => ipcRenderer.invoke(IPC.PRICING_PREVIEW, params),
  },
  customers: {
    list: () => ipcRenderer.invoke(IPC.CUSTOMER_LIST),
    search: (query: string) => ipcRenderer.invoke(IPC.CUSTOMER_SEARCH, query),
    get: (id: number) => ipcRenderer.invoke(IPC.CUSTOMER_GET, id),
    create: (input: unknown) => ipcRenderer.invoke(IPC.CUSTOMER_CREATE, input),
    update: (id: number, input: unknown) => ipcRenderer.invoke(IPC.CUSTOMER_UPDATE, id, input),
  },
  calendar: {
    getRange: (startDate: string, endDate: string) => ipcRenderer.invoke(IPC.CALENDAR_GET_RANGE, startDate, endDate),
  },
};

export type SponsorQRApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
