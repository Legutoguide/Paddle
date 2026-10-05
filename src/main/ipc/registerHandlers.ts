import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { IPC } from '../../shared/ipc/contract';
import { logger } from '../logger';
import { getDefaultBackupDir, getDefaultExportDir, getDatabasePath } from '../appPaths';

import { SponsorService } from '../services/sponsorService';
import { CampaignService } from '../services/campaignService';
import { CouponService } from '../services/couponService';
import { HistoryService } from '../services/historyService';
import { SettingsService } from '../services/settingsService';
import { StatsService } from '../services/statsService';
import { AuditService } from '../services/auditService';
import { BackupService, restoreDatabase, buildBackupFilename } from '../services/backupService';
import { generateQrDataUrl } from '../services/qrService';
import { exportCouponsToCsv, exportHistoryToCsv, parseImportCsv, writeCsvFile } from '../services/csvService';
import { exportCouponsToPdf } from '../services/pdfService';
import { calculatePrice, toCents } from '../../shared/lib/pricing';
import { BatchService } from '../services/batchService';
import { NotificationService } from '../services/notificationService';
import { SessionLogService } from '../services/sessionLogService';
import { DangerZoneService } from '../services/dangerZoneService';
import { AuthService, getCurrentSession, AuthPermissionError } from '../services/authService';
import { BranchService } from '../services/branchService';
import { hasPermission, type Permission } from '../services/permissions';
import { ReservationService } from '../services/ReservationService';
import { AvailabilityService } from '../services/AvailabilityService';
import { PricingService } from '../services/PricingService';
import { CustomerService } from '../services/CustomerService';
import { ReservationReportService } from '../services/ReservationReportService';
import { toLocalDateString } from '../../shared/lib/availability';

/**
 * Wraps a handler so that:
 *  - any thrown Error surfaces to the renderer as a clean message only
 *    (never a raw stack trace)
 *  - the full error (with stack) is written to the local log file for
 *    developer diagnostics
 *  - if `requiredPermission` is set, the call is rejected server-side
 *    unless the CURRENT session (never trust the renderer's claim of who
 *    it is) actually has that permission. This is the one and only place
 *    permission enforcement happens — the UI hiding a button is a
 *    convenience, not the security boundary.
 */
function safeHandle<T extends unknown[], R>(
  channel: string,
  requiredPermission: Permission | null,
  fn: (...args: T) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (_event, ...args: T) => {
    try {
      if (requiredPermission) {
        const session = getCurrentSession();
        if (!session) throw new AuthPermissionError('You must be logged in to do this.');
        if (!hasPermission(session.role, requiredPermission)) {
          throw new AuthPermissionError('You do not have permission to do this.');
        }
      }
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      logger.error(`IPC handler failed: ${channel}`, { message, stack: err instanceof Error ? err.stack : undefined });
      throw new Error(message);
    }
  });
}

export interface AppContext {
  db: Database.Database;
  mainWindow: BrowserWindow;
  reopenDatabase: (dbPath: string) => Database.Database;
  closeDatabase: () => void;
  dbPath: string;
}

export function registerIpcHandlers(ctx: AppContext): void {
  // Services are re-created lazily against ctx.db so that a restore (which
  // swaps the underlying connection) is picked up on the next call.
  const svc = () => ({
    sponsors: new SponsorService(ctx.db),
    campaigns: new CampaignService(ctx.db),
    coupons: new CouponService(ctx.db),
    history: new HistoryService(ctx.db),
    settings: new SettingsService(ctx.db),
    stats: new StatsService(ctx.db),
    audit: new AuditService(ctx.db),
    backup: new BackupService(ctx.db),
    batches: new BatchService(ctx.db),
    notifications: new NotificationService(ctx.db),
    sessionLogs: new SessionLogService(ctx.db),
    dangerZone: new DangerZoneService(ctx.db),
    auth: new AuthService(ctx.db),
    branches: new BranchService(ctx.db),
    // Prime Paddle reservation system. ReservationService is handed the
    // SAME CouponService instance (not a second one) so both see identical
    // coupon state within a single call — this matters because
    // ReservationService's payment/attach/cancel paths call straight into
    // CouponService's reservation-integration methods inside one shared
    // db.transaction().
    customers: new CustomerService(ctx.db),
    availability: new AvailabilityService(ctx.db),
    pricing: new PricingService(ctx.db),
    reservations: new ReservationService(ctx.db, new CouponService(ctx.db)),
    reservationReports: new ReservationReportService(ctx.db),
  });

  // ---------- Auth ----------
  safeHandle(IPC.AUTH_HAS_ANY_USER, null, () => svc().auth.hasAnyUser());
  safeHandle(IPC.AUTH_CREATE_FIRST_USER, null, (params: Parameters<AuthService['createFirstUser']>[0]) =>
    svc().auth.createFirstUser(params)
  );
  safeHandle(IPC.AUTH_LOGIN, null, (params: { username: string; password: string }) =>
    svc().auth.login({ ...params, deviceName: os.hostname(), appVersion: app.getVersion() })
  );
  safeHandle(IPC.AUTH_LOGOUT, null, () => svc().auth.logout());
  safeHandle(IPC.AUTH_CURRENT_SESSION, null, () => {
    const session = getCurrentSession();
    if (!session) return null;
    const user = svc().auth.getById(session.userId);
    return user;
  });

  // ---------- Users ----------
  safeHandle(IPC.USER_LIST, 'users.view', () => svc().auth.list());
  safeHandle(IPC.USER_CREATE, 'users.create', (input: Parameters<AuthService['createUser']>[1]) => {
    const session = getCurrentSession()!;
    return svc().auth.createUser(session.role, input);
  });
  safeHandle(IPC.USER_UPDATE, 'users.edit', (id: number, input: Parameters<AuthService['update']>[3]) => {
    const session = getCurrentSession()!;
    return svc().auth.update(session.role, session.userId, id, input);
  });
  safeHandle(IPC.USER_DELETE, 'users.delete', (id: number) => {
    const session = getCurrentSession()!;
    return svc().auth.deleteUser(session.userId, id);
  });
  safeHandle(IPC.USER_RESET_PASSWORD, 'users.reset_password', (id: number, newPassword: string) =>
    svc().auth.resetPassword(id, newPassword)
  );
  safeHandle(IPC.LOGIN_LOG_LIST, 'login_logs.view', (params: Parameters<AuthService['listLoginLogs']>[0]) =>
    svc().auth.listLoginLogs(params)
  );

  // ---------- Branches ----------
  safeHandle(IPC.BRANCH_LIST, 'branches.view', () => svc().branches.list());
  safeHandle(IPC.BRANCH_CREATE, 'branches.create', (input: Parameters<BranchService['create']>[0]) =>
    svc().branches.create(input)
  );
  safeHandle(IPC.BRANCH_UPDATE, 'branches.edit', (id: number, input: Parameters<BranchService['update']>[1]) =>
    svc().branches.update(id, input)
  );
  safeHandle(IPC.BRANCH_DELETE, 'branches.delete', (id: number) => svc().branches.delete(id));

  // ---------- Sponsors ----------
  safeHandle(IPC.SPONSOR_LIST, 'sponsors.view', (params: Parameters<SponsorService['list']>[0]) => svc().sponsors.list(params));
  safeHandle(IPC.SPONSOR_CREATE, 'sponsors.create', (input: Parameters<SponsorService['create']>[0]) => svc().sponsors.create(input));
  safeHandle(IPC.SPONSOR_UPDATE, 'sponsors.edit', (id: number, input: Parameters<SponsorService['update']>[1]) =>
    svc().sponsors.update(id, input)
  );
  safeHandle(IPC.SPONSOR_ARCHIVE, 'sponsors.edit', (id: number) => svc().sponsors.archive(id));
  safeHandle(IPC.SPONSOR_UNARCHIVE, 'sponsors.edit', (id: number) => svc().sponsors.unarchive(id));
  safeHandle(IPC.SPONSOR_DELETE, 'sponsors.delete', (id: number) => svc().sponsors.deletePermanently(id));
  safeHandle(IPC.SPONSOR_STATS, 'sponsors.view', (id: number) => svc().sponsors.getStats(id));

  // ---------- Campaigns ----------
  safeHandle(IPC.CAMPAIGN_LIST, 'campaigns.view', (params: Parameters<CampaignService['list']>[0]) => svc().campaigns.list(params));
  safeHandle(IPC.CAMPAIGN_CREATE, 'campaigns.create', (input: Parameters<CampaignService['create']>[0]) => svc().campaigns.create(input));
  safeHandle(IPC.CAMPAIGN_UPDATE, 'campaigns.edit', (id: number, input: Parameters<CampaignService['update']>[1]) =>
    svc().campaigns.update(id, input)
  );
  safeHandle(IPC.CAMPAIGN_ARCHIVE, 'campaigns.archive', (id: number) => svc().campaigns.archive(id));
  safeHandle(IPC.CAMPAIGN_UNARCHIVE, 'campaigns.archive', (id: number) => svc().campaigns.unarchive(id));
  safeHandle(IPC.CAMPAIGN_DELETE, 'campaigns.delete', (id: number) => svc().campaigns.deletePermanently(id));
  safeHandle(IPC.CAMPAIGN_STATS, 'campaigns.view', (id: number) => svc().campaigns.getStats(id));
  safeHandle(
    IPC.CAMPAIGN_PREVIEW_PRICE,
    'campaigns.view',
    (input: { originalPrice: number; discountType: 'PERCENTAGE' | 'FIXED'; discountPercentage?: number; discountAmount?: number }) =>
      calculatePrice({
        originalPriceCents: toCents(input.originalPrice),
        discountType: input.discountType,
        discountPercentage: input.discountPercentage,
        discountAmountCents: input.discountAmount !== undefined ? toCents(input.discountAmount) : undefined,
      })
  );

  // ---------- Coupons ----------
  safeHandle(IPC.COUPON_LIST, 'qr.view', (params: Parameters<CouponService['list']>[0]) => svc().coupons.list(params));
  safeHandle(IPC.COUPON_GENERATE, 'qr.generate', (input: Parameters<CouponService['generateCodes']>[0]) =>
    svc().coupons.generateCodes(input)
  );
  safeHandle(IPC.COUPON_VALIDATE, 'qr.validate', (code: string) => svc().coupons.validate(code));
  safeHandle(IPC.COUPON_CONFIRM_USE, 'qr.redeem', (code: string, operator?: string | null) =>
    svc().coupons.confirmUse(code, operator)
  );
  safeHandle(IPC.COUPON_REVOKE, 'qr.revoke', (id: number, reason?: string | null) => svc().coupons.revoke(id, reason));
  safeHandle(IPC.COUPON_REVOKE_MANY, 'qr.revoke', (ids: number[], reason?: string | null) =>
    svc().coupons.revokeMany(ids, reason)
  );
  safeHandle(IPC.COUPON_GET_QR, 'qr.view', (code: string) => generateQrDataUrl(code));
  safeHandle(IPC.COUPON_COVERAGE_STATE, 'qr.view', (couponId: number) => svc().coupons.coverageState(couponId));

  // ---------- History ----------
  safeHandle(IPC.HISTORY_LIST, 'reports.view', (params: Parameters<HistoryService['list']>[0]) => svc().history.list(params));
  safeHandle(IPC.HISTORY_EXPORT_CSV, 'export.use', async (params: Parameters<HistoryService['list']>[0]) => {
    const { items } = svc().history.list({ ...params, limit: undefined });
    const settings = svc().settings.getAll();
    const csv = exportHistoryToCsv(items, settings.currency);
    const dir = settings.defaultExportFolder ?? getDefaultExportDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `history-export-${Date.now()}.csv`);
    writeCsvFile(filePath, csv);
    return { filePath, count: items.length };
  });

  // ---------- Import / Export ----------
  safeHandle(IPC.IMPORT_PREVIEW_CSV, 'qr.generate', (csvContent: string) => {
    const coupons = svc().coupons;
    return parseImportCsv(csvContent, (code) => coupons.getByCode(code) !== null);
  });
  safeHandle(
    IPC.IMPORT_CONFIRM,
    'qr.generate',
    (params: { campaignId: number; codes: string[]; expiresAt?: string | null }) =>
      svc().coupons.importCodes(params.campaignId, params.codes, params.expiresAt)
  );
  safeHandle(
    IPC.EXPORT_COUPONS_CSV,
    'export.use',
    async (params: Parameters<CouponService['list']>[0]) => {
      const { items } = svc().coupons.list({ ...params, limit: undefined });
      const settings = svc().settings.getAll();
      const csv = exportCouponsToCsv(items, settings.currency);
      const dir = settings.defaultExportFolder ?? getDefaultExportDir();
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `coupons-export-${Date.now()}.csv`);
      writeCsvFile(filePath, csv);
      return { filePath, count: items.length };
    }
  );
  safeHandle(IPC.EXPORT_COUPONS_PDF, 'print.use', async (couponIds: number[]) => {
    const coupons = svc().coupons;
    const settings = svc().settings.getAll();
    const all = couponIds
      .map((id) => coupons.getById(id))
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => coupons.getByCode(c.code)!);

    if (all.length === 0) throw new Error('No coupons selected to export.');

    const dir = settings.defaultExportFolder ?? getDefaultExportDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `coupons-print-${Date.now()}.pdf`);
    await exportCouponsToPdf(all, filePath, {
      businessName: settings.businessName,
      currency: settings.currency,
      orgLogoPath: settings.logoPath,
    });
    return { filePath, count: all.length };
  });

  // ---------- Dashboard ----------
  safeHandle(IPC.DASHBOARD_STATS, 'reports.view', () => svc().stats.getDashboardStats());
  safeHandle(IPC.DASHBOARD_DAILY_USAGE, 'reports.view', (days?: number) => svc().stats.getDailyUsage(days));
  safeHandle(IPC.DASHBOARD_SPONSOR_PERFORMANCE, 'reports.view', () => svc().stats.getSponsorPerformance());

  // ---------- Settings ----------
  safeHandle(IPC.SETTINGS_GET, null, () => svc().settings.getAll());
  safeHandle(IPC.SETTINGS_UPDATE, 'settings.edit', (partial: Parameters<SettingsService['update']>[0]) =>
    svc().settings.update(partial)
  );
  safeHandle(IPC.SETTINGS_IS_FIRST_RUN, null, () => svc().settings.isFirstRun());
  safeHandle(IPC.SETTINGS_PICK_FOLDER, 'settings.edit', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  safeHandle(IPC.SETTINGS_PICK_LOGO, 'branding.edit', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  safeHandle(IPC.SETTINGS_PICK_IMAGE, 'branding.edit', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ---------- Backup / Restore ----------
  safeHandle(IPC.BACKUP_PICK_DESTINATION, 'backup.create', async () => {
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      defaultPath: path.join(getDefaultBackupDir(), buildBackupFilename()),
      filters: [{ name: 'Database Backup', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePath;
  });
  safeHandle(IPC.BACKUP_CREATE, 'backup.create', async (destinationPath?: string) => {
    const target = destinationPath ?? path.join(getDefaultBackupDir(), buildBackupFilename());
    await svc().backup.backupTo(target);
    return { filePath: target };
  });
  safeHandle(IPC.BACKUP_PICK_RESTORE_FILE, 'backup.restore', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Database Backup', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  safeHandle(IPC.BACKUP_RESTORE, 'backup.restore', async (backupFilePath: string) => {
    ctx.closeDatabase();
    try {
      const { safetyCopyPath } = restoreDatabase(ctx.dbPath, backupFilePath);
      ctx.db = ctx.reopenDatabase(ctx.dbPath);
      new NotificationService(ctx.db).emit({
        type: 'RESTORE_COMPLETED',
        title: 'Database restored',
        message: 'The database was restored from a backup file.',
      });
      return { safetyCopyPath };
    } catch (err) {
      // Ensure we always leave the app with a usable, open database.
      ctx.db = ctx.reopenDatabase(ctx.dbPath);
      throw err;
    }
  });

  // ---------- Batches ----------
  safeHandle(IPC.BATCH_LIST, 'batches.view', (params: Parameters<BatchService['list']>[0]) => svc().batches.list(params));
  safeHandle(IPC.BATCH_ARCHIVE, 'batches.archive', (id: number) => svc().batches.archive(id));

  // ---------- Notifications ----------
  safeHandle(IPC.NOTIFICATION_LIST, 'notifications.view', (params: Parameters<NotificationService['list']>[0]) =>
    svc().notifications.list(params)
  );
  safeHandle(IPC.NOTIFICATION_UNREAD_COUNT, 'notifications.view', () => svc().notifications.unreadCount());
  safeHandle(IPC.NOTIFICATION_MARK_READ, 'notifications.view', (id: number) => svc().notifications.markRead(id));
  safeHandle(IPC.NOTIFICATION_MARK_ALL_READ, 'notifications.view', () => svc().notifications.markAllRead());
  safeHandle(IPC.NOTIFICATION_CLEAR_ALL, 'notifications.manage', () => svc().notifications.clearAll());

  // ---------- Session logs ----------
  safeHandle(IPC.SESSION_LOG_LIST, 'audit_logs.view', (params: Parameters<SessionLogService['list']>[0]) =>
    svc().sessionLogs.list(params)
  );

  // ---------- Device info ----------
  safeHandle(IPC.DEVICE_INFO_GET, 'settings.view', () => ({
    deviceName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    appVersion: app.getVersion(),
    cpus: os.cpus().length,
    totalMemoryGB: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
    databasePath: ctx.dbPath,
  }));

  // ---------- Danger zone ----------
  safeHandle(IPC.DANGER_ZONE_RESET_ALL, 'danger_zone.execute', async () => {
    // Always take a safety backup immediately before an irreversible reset.
    const backupPath = path.join(getDefaultBackupDir(), `pre-reset-${buildBackupFilename()}`);
    await svc().backup.backupTo(backupPath).catch((err) => {
      // If even the safety backup fails, refuse to proceed with the reset.
      throw new Error(`Reset aborted: could not create a safety backup first (${err instanceof Error ? err.message : err}).`);
    });
    const result = svc().dangerZone.resetAllData();
    return { ...result, safetyBackupPath: backupPath };
  });

  // ---------- Audit ----------
  safeHandle(IPC.AUDIT_LIST, 'audit_logs.view', (limit?: number) => svc().audit.list(limit));

  // ==========================================================================
  // PRIME PADDLE — Reservation system
  // Every handler below goes through the SAME safeHandle/permission gate as
  // everything above — there is no separate enforcement path for the new
  // feature set. actorUserId is always taken from the server-verified
  // current session, never from a value the renderer passes in.
  // ==========================================================================

  // ---------- Reservations ----------
  safeHandle(IPC.RESERVATION_LIST, 'reservations.view', (params: Parameters<ReservationService['list']>[0]) =>
    svc().reservations.list(params)
  );
  safeHandle(IPC.RESERVATION_SEARCH, 'reservations.view', (query: string) => svc().reservations.search(query));
  safeHandle(IPC.RESERVATION_GET, 'reservations.view', (id: number) => svc().reservations.getWithDetails(id));
  safeHandle(IPC.RESERVATION_HISTORY, 'reservations.view', (id: number) => svc().reservations.getHistory(id));

  safeHandle(
    IPC.RESERVATION_CREATE_WALKIN,
    'reservations.create',
    (input: Parameters<ReservationService['createWalkIn']>[0]) => {
      const session = getCurrentSession();
      return svc().reservations.createWalkIn({ ...input, createdByUserId: session?.userId ?? null });
    }
  );
  safeHandle(
    IPC.RESERVATION_CREATE_ADVANCE,
    'reservations.create',
    (input: Parameters<ReservationService['createAdvance']>[0]) => {
      const session = getCurrentSession();
      return svc().reservations.createAdvance({ ...input, createdByUserId: session?.userId ?? null });
    }
  );
  safeHandle(
    IPC.RESERVATION_RESCHEDULE_TO_ADVANCE,
    'reservations.edit',
    (params: Omit<Parameters<ReservationService['rescheduleToAdvance']>[0], 'actorUserId'>) => {
      const session = getCurrentSession();
      return svc().reservations.rescheduleToAdvance({ ...params, actorUserId: session?.userId ?? null });
    }
  );
  // A reservation may carry MULTIPLE coupons (coverage can be split across
  // players/participants) — attach/detach operate per-coupon, not per-reservation.
  safeHandle(
    IPC.RESERVATION_ATTACH_COUPON,
    'reservations.edit',
    (id: number, couponCode: string, options?: { participantId?: number | null; coverage?: number }) => {
      const session = getCurrentSession();
      return svc().reservations.attachCoupon(id, couponCode, session?.userId ?? null, options);
    }
  );
  safeHandle(IPC.RESERVATION_DETACH_COUPON, 'reservations.edit', (id: number, couponId: number) => {
    const session = getCurrentSession();
    return svc().reservations.detachCoupon(id, couponId, session?.userId ?? null);
  });
  safeHandle(IPC.RESERVATION_PRICE_BREAKDOWN, 'reservations.view', (id: number) =>
    svc().reservations.getPriceBreakdown(id)
  );
  safeHandle(IPC.RESERVATION_LIST_PARTICIPANTS, 'reservations.view', (id: number) =>
    svc().reservations.listParticipants(id)
  );
  safeHandle(IPC.RESERVATION_SET_PARTICIPANTS, 'reservations.edit', (id: number, names: Array<string | null>) =>
    svc().reservations.setParticipants(id, names)
  );
  safeHandle(IPC.RESERVATION_CHECKIN, 'reservations.checkin', (id: number) => {
    const session = getCurrentSession();
    return svc().reservations.checkIn(id, session?.userId ?? null);
  });
  safeHandle(IPC.RESERVATION_START, 'reservations.edit', (id: number) => {
    const session = getCurrentSession();
    return svc().reservations.start(id, session?.userId ?? null);
  });
  safeHandle(IPC.RESERVATION_COMPLETE, 'reservations.edit', (id: number) => {
    const session = getCurrentSession();
    return svc().reservations.complete(id, session?.userId ?? null);
  });
  safeHandle(IPC.RESERVATION_CANCEL, 'reservations.cancel', (id: number, reason?: string | null) => {
    const session = getCurrentSession();
    return svc().reservations.cancel(id, reason ?? null, session?.userId ?? null);
  });
  safeHandle(IPC.RESERVATION_NO_SHOW, 'reservations.cancel', (id: number) => {
    const session = getCurrentSession();
    return svc().reservations.noShow(id, session?.userId ?? null);
  });
  // The one-click business rule: payment PAID and RESERVED coupon -> USED
  // happen atomically inside ReservationService.markAsPaid's own
  // transaction. No separate "use coupon" IPC call exists for this path.
  safeHandle(IPC.RESERVATION_MARK_PAID, 'reservations.payment', (id: number) => {
    const session = getCurrentSession();
    return svc().reservations.markAsPaid(id, session?.userId ?? null);
  });

  // ---------- Availability / Periods / Business hours ----------
  safeHandle(IPC.AVAILABILITY_GET_DAY, 'availability.view', (date: string) =>
    svc().availability.getDayAvailability(date)
  );
  safeHandle(IPC.AVAILABILITY_GET_RANGE, 'availability.view', (startDate: string, endDate: string) =>
    svc().availability.getRangeAvailability(startDate, endDate)
  );
  safeHandle(
    IPC.AVAILABILITY_NEXT_AVAILABLE,
    'availability.view',
    (fromDate: string, fromTime: string, maxDaysAhead?: number) =>
      svc().availability.findNextAvailable(fromDate, fromTime, maxDaysAhead)
  );
  safeHandle(IPC.BUSINESS_HOURS_LIST, 'availability.view', () => svc().availability.listBusinessHours());
  safeHandle(
    IPC.BUSINESS_HOURS_UPDATE,
    'business_hours.edit',
    (weekday: number, input: Parameters<AvailabilityService['updateBusinessHours']>[1]) =>
      svc().availability.updateBusinessHours(weekday, input)
  );
  safeHandle(IPC.PERIOD_LIST, 'availability.view', () => svc().availability.listPeriods());
  safeHandle(IPC.PERIOD_UPSERT, 'periods.edit', (input: Parameters<AvailabilityService['upsertPeriod']>[0]) =>
    svc().availability.upsertPeriod(input)
  );

  // ---------- Pricing ----------
  safeHandle(IPC.PRICING_RULE_LIST, 'pricing.view', () => svc().pricing.list());
  safeHandle(IPC.PRICING_RULE_CREATE, 'pricing.edit', (input: Parameters<PricingService['create']>[0]) =>
    svc().pricing.create(input)
  );
  safeHandle(
    IPC.PRICING_RULE_UPDATE,
    'pricing.edit',
    (id: number, input: Parameters<PricingService['update']>[1]) => svc().pricing.update(id, input)
  );
  safeHandle(IPC.PRICING_PREVIEW, 'pricing.view', (params: Parameters<PricingService['resolvePrice']>[0]) =>
    svc().pricing.resolvePrice(params)
  );

  // ---------- Customers ----------
  safeHandle(IPC.CUSTOMER_LIST, 'customers.view', () => svc().customers.list());
  safeHandle(IPC.CUSTOMER_SEARCH, 'customers.view', (query: string) => svc().customers.search(query));
  safeHandle(IPC.CUSTOMER_GET, 'customers.view', (id: number) => svc().customers.getWithStats(id));
  safeHandle(IPC.CUSTOMER_CREATE, 'customers.create', (input: Parameters<CustomerService['create']>[0]) =>
    svc().customers.create(input)
  );
  safeHandle(
    IPC.CUSTOMER_UPDATE,
    'customers.edit',
    (id: number, input: Parameters<CustomerService['update']>[1]) => svc().customers.update(id, input)
  );

  // ---------- Dashboard & reports ----------
  // Money figures are filled in ONLY when the server-verified session holds
  // dashboard.financial_view; otherwise they come back null. The renderer
  // never gets a chance to show what it was never sent.
  safeHandle(IPC.RESERVATION_DASHBOARD, 'reservations.view', () => {
    const session = getCurrentSession();
    const financial = !!session && hasPermission(session.role, 'dashboard.financial_view');
    return svc().reservationReports.getDashboardStats(toLocalDateString(new Date()), financial);
  });
  safeHandle(IPC.RESERVATION_REPORT, 'reports.view', (dateFrom: string, dateTo: string) => {
    const session = getCurrentSession();
    const financial = !!session && hasPermission(session.role, 'dashboard.financial_view');
    return svc().reservationReports.getReport(dateFrom, dateTo, financial);
  });

  // ---------- Calendar ----------
  // Thin read-model combining per-day slot availability with the actual
  // reservation records for the same range, so the Calendar UI never has
  // to reconcile two separate sources of truth itself.
  safeHandle(IPC.CALENDAR_GET_RANGE, 'calendar.view', (startDate: string, endDate: string) => {
    const s = svc();
    return {
      days: s.availability.getRangeAvailability(startDate, endDate),
      reservations: s.reservations.list({ dateFrom: startDate, dateTo: endDate }),
    };
  });

  // ---------- App ----------
  safeHandle(IPC.APP_GET_VERSION, null, () => process.env.npm_package_version ?? '1.0.0');
}
