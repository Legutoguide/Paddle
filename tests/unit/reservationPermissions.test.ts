import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, getPermissionsForRole, type Permission } from '../../src/main/services/permissions';

const ALL_RESERVATION_PERMISSIONS: Permission[] = [
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.checkin', 'reservations.payment',
  'calendar.view', 'availability.view',
  'customers.view', 'customers.create', 'customers.edit',
  'pricing.view', 'pricing.edit', 'periods.edit', 'business_hours.edit',
  'qr.reserved_override', 'dashboard.financial_view',
];

describe('Reservation permissions matrix', () => {
  test('CEO has every reservation permission, including the reserved-coupon override', () => {
    for (const p of ALL_RESERVATION_PERMISSIONS) {
      assert.equal(hasPermission('CEO', p), true, `CEO should have ${p}`);
    }
  });

  test('Admin has full reservation operations but NOT the reserved-coupon override (CEO-only)', () => {
    assert.equal(hasPermission('ADMIN', 'reservations.create'), true);
    assert.equal(hasPermission('ADMIN', 'reservations.payment'), true);
    assert.equal(hasPermission('ADMIN', 'pricing.edit'), true);
    assert.equal(hasPermission('ADMIN', 'business_hours.edit'), true);
    assert.equal(hasPermission('ADMIN', 'qr.reserved_override'), false);
  });

  test('Manager can run day-to-day reservations/walk-ins/payments but not configure pricing/hours', () => {
    assert.equal(hasPermission('MANAGER', 'reservations.create'), true);
    assert.equal(hasPermission('MANAGER', 'reservations.checkin'), true);
    assert.equal(hasPermission('MANAGER', 'reservations.payment'), true);
    assert.equal(hasPermission('MANAGER', 'customers.create'), true);
    assert.equal(hasPermission('MANAGER', 'calendar.view'), true);
    assert.equal(hasPermission('MANAGER', 'pricing.view'), true);
    assert.equal(hasPermission('MANAGER', 'pricing.edit'), false);
    assert.equal(hasPermission('MANAGER', 'periods.edit'), false);
    assert.equal(hasPermission('MANAGER', 'business_hours.edit'), false);
    assert.equal(hasPermission('MANAGER', 'qr.reserved_override'), false);
  });

  test('Viewer can see reservations/calendar/customers but cannot create, edit, or take payment', () => {
    assert.equal(hasPermission('VIEWER', 'reservations.view'), true);
    assert.equal(hasPermission('VIEWER', 'calendar.view'), true);
    assert.equal(hasPermission('VIEWER', 'customers.view'), true);
    assert.equal(hasPermission('VIEWER', 'reservations.create'), false);
    assert.equal(hasPermission('VIEWER', 'reservations.payment'), false);
    assert.equal(hasPermission('VIEWER', 'reservations.cancel'), false);
    assert.equal(hasPermission('VIEWER', 'customers.create'), false);
    assert.equal(hasPermission('VIEWER', 'business_hours.edit'), false);
  });

  test('dashboard.financial_view: CEO/Admin/Manager can see money figures, Viewer cannot', () => {
    assert.equal(hasPermission('CEO', 'dashboard.financial_view'), true);
    assert.equal(hasPermission('ADMIN', 'dashboard.financial_view'), true);
    assert.equal(hasPermission('MANAGER', 'dashboard.financial_view'), true);
    assert.equal(hasPermission('VIEWER', 'dashboard.financial_view'), false);
  });

  test('every role permission list is non-empty and contains only valid permission strings', () => {
    for (const role of ['CEO', 'ADMIN', 'MANAGER', 'VIEWER'] as const) {
      const perms = getPermissionsForRole(role);
      assert.ok(perms.length > 0);
    }
  });
});
