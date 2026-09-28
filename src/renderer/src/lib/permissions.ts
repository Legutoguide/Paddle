import type { UserRole } from '@/types/window';

// Mirrors src/main/services/permissions.ts. This copy is for UI
// convenience only (hiding buttons the user can't use) — it is NOT the
// security boundary. Every IPC handler re-checks permissions server-side
// regardless of what the UI shows or hides.
export type Permission =
  | 'users.view' | 'users.create' | 'users.edit' | 'users.disable' | 'users.delete' | 'users.reset_password'
  | 'sponsors.view' | 'sponsors.create' | 'sponsors.edit' | 'sponsors.delete'
  | 'branches.view' | 'branches.create' | 'branches.edit' | 'branches.delete'
  | 'campaigns.view' | 'campaigns.create' | 'campaigns.edit' | 'campaigns.delete' | 'campaigns.archive'
  | 'qr.view' | 'qr.generate' | 'qr.revoke' | 'qr.scan' | 'qr.validate' | 'qr.redeem'
  | 'batches.view' | 'batches.archive'
  | 'reports.view' | 'export.use' | 'print.use'
  | 'notifications.view' | 'notifications.manage'
  | 'organization.view' | 'organization.edit' | 'branding.view' | 'branding.edit'
  | 'audit_logs.view' | 'login_logs.view'
  | 'backup.create' | 'backup.restore'
  | 'settings.view' | 'settings.edit'
  | 'danger_zone.access' | 'danger_zone.execute'
  | 'reservations.view' | 'reservations.create' | 'reservations.edit' | 'reservations.cancel'
  | 'reservations.checkin' | 'reservations.payment'
  | 'calendar.view' | 'availability.view'
  | 'customers.view' | 'customers.create' | 'customers.edit'
  | 'pricing.view' | 'pricing.edit' | 'periods.edit' | 'business_hours.edit'
  | 'qr.reserved_override'
  | 'dashboard.financial_view';

const ALL: Permission[] = [
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

const MANAGER: Permission[] = [
  'sponsors.view', 'sponsors.create', 'sponsors.edit',
  'branches.view',
  'campaigns.view', 'campaigns.create', 'campaigns.edit',
  'qr.view', 'qr.generate', 'qr.revoke', 'qr.scan', 'qr.validate', 'qr.redeem',
  'batches.view', 'reports.view', 'export.use', 'print.use', 'notifications.view',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.checkin', 'reservations.payment',
  'calendar.view', 'availability.view',
  'customers.view', 'customers.create', 'customers.edit',
  'pricing.view', 'dashboard.financial_view',
];

const VIEWER: Permission[] = [
  'sponsors.view', 'campaigns.view', 'qr.view', 'batches.view', 'reports.view',
  'export.use', 'print.use', 'notifications.view', 'branches.view',
  'reservations.view', 'calendar.view', 'availability.view', 'customers.view', 'pricing.view',
];

const MATRIX: Record<UserRole, Permission[]> = {
  CEO: ALL,
  ADMIN: ALL.filter((p) => p !== 'danger_zone.execute' && p !== 'qr.reserved_override'),
  MANAGER,
  VIEWER,
};

export function hasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(permission) ?? false;
}

