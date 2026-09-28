import type { UserRole } from './authService';

// Permission strings mirror the master spec's naming (section 10), trimmed
// to the features this app actually implements. Never invent a permission
// that doesn't gate a real feature.
export type Permission =
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.disable'
  | 'users.delete'
  | 'users.reset_password'
  | 'sponsors.view'
  | 'sponsors.create'
  | 'sponsors.edit'
  | 'sponsors.delete'
  | 'branches.view'
  | 'branches.create'
  | 'branches.edit'
  | 'branches.delete'
  | 'campaigns.view'
  | 'campaigns.create'
  | 'campaigns.edit'
  | 'campaigns.delete'
  | 'campaigns.archive'
  | 'qr.view'
  | 'qr.generate'
  | 'qr.revoke'
  | 'qr.scan'
  | 'qr.validate'
  | 'qr.redeem'
  | 'batches.view'
  | 'batches.archive'
  | 'reports.view'
  | 'export.use'
  | 'print.use'
  | 'notifications.view'
  | 'notifications.manage'
  | 'organization.view'
  | 'organization.edit'
  | 'branding.view'
  | 'branding.edit'
  | 'audit_logs.view'
  | 'login_logs.view'
  | 'backup.create'
  | 'backup.restore'
  | 'settings.view'
  | 'settings.edit'
  | 'danger_zone.access'
  | 'danger_zone.execute'
  // Prime Paddle reservation system
  | 'reservations.view'
  | 'reservations.create'
  | 'reservations.edit'
  | 'reservations.cancel'
  | 'reservations.checkin'
  | 'reservations.payment'
  | 'calendar.view'
  | 'availability.view'
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'pricing.view'
  | 'pricing.edit'
  | 'periods.edit'
  | 'business_hours.edit'
  // CEO-only escape hatch to use a coupon already RESERVED by another
  // reservation. Never exposed as a casual "force use" button — every use
  // must be audited (see CouponService).
  | 'qr.reserved_override'
  // Revenue/money figures on the dashboard and reservation reports.
  | 'dashboard.financial_view';

const ALL_PERMISSIONS: Permission[] = [
  'users.view', 'users.create', 'users.edit', 'users.disable', 'users.delete', 'users.reset_password',
  'sponsors.view', 'sponsors.create', 'sponsors.edit', 'sponsors.delete',
  'branches.view', 'branches.create', 'branches.edit', 'branches.delete',
  'campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.delete', 'campaigns.archive',
  'qr.view', 'qr.generate', 'qr.revoke', 'qr.scan', 'qr.validate', 'qr.redeem',
  'batches.view', 'batches.archive',
  'reports.view', 'export.use', 'print.use',
  'notifications.view', 'notifications.manage',
  'organization.view', 'organization.edit', 'branding.view', 'branding.edit',
  'audit_logs.view', 'login_logs.view',
  'backup.create', 'backup.restore',
  'settings.view', 'settings.edit',
  'danger_zone.access', 'danger_zone.execute',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.checkin', 'reservations.payment',
  'calendar.view', 'availability.view',
  'customers.view', 'customers.create', 'customers.edit',
  'pricing.view', 'pricing.edit', 'periods.edit', 'business_hours.edit',
  'qr.reserved_override',
  'dashboard.financial_view',
];

/** CEO has every permission — the only role that can create another CEO or execute the danger zone. */
const CEO_PERMISSIONS: Permission[] = ALL_PERMISSIONS;

/**
 * Admin: full operational control, but cannot execute destructive resets,
 * and cannot use the reserved-coupon override — that stays CEO-only per the
 * Prime Paddle spec (section 18).
 */
const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (p) => p !== 'danger_zone.execute' && p !== 'qr.reserved_override'
);

/** Manager: day-to-day operations (sponsors/campaigns/QR/scan/export/print/reports), no admin/security screens. */
const MANAGER_PERMISSIONS: Permission[] = [
  'sponsors.view', 'sponsors.create', 'sponsors.edit',
  'branches.view',
  'campaigns.view', 'campaigns.create', 'campaigns.edit',
  'qr.view', 'qr.generate', 'qr.revoke', 'qr.scan', 'qr.validate', 'qr.redeem',
  'batches.view',
  'reports.view', 'export.use', 'print.use',
  'notifications.view',
  // Reservations are day-to-day front-of-house work for Manager, same tier
  // as sponsors/campaigns/QR above. No pricing/periods/business-hours
  // config and no reserved-coupon override — those stay Admin+/CEO-only.
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.checkin', 'reservations.payment',
  'calendar.view', 'availability.view',
  'customers.view', 'customers.create', 'customers.edit',
  'pricing.view', 'dashboard.financial_view',
];

/** Viewer: read-only everywhere, plus the ability to export/print reports. */
const VIEWER_PERMISSIONS: Permission[] = [
  'sponsors.view', 'campaigns.view', 'qr.view', 'batches.view', 'reports.view',
  'export.use', 'print.use', 'notifications.view', 'branches.view',
  'reservations.view', 'calendar.view', 'availability.view', 'customers.view', 'pricing.view',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  CEO: CEO_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

