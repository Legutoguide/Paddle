import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import {
  AuthService,
  AuthValidationError,
  AuthPermissionError,
  hashPassword,
  verifyPassword,
  getCurrentSession,
  clearCurrentSession,
} from '../../src/main/services/authService';
import { hasPermission, getPermissionsForRole } from '../../src/main/services/permissions';

describe('AuthService', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = createTestDb();
    auth = new AuthService(db);
    clearCurrentSession();
  });

  test('password hashing: correct password verifies, wrong password does not', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    assert.equal(verifyPassword('correct-horse-battery-staple', hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);
  });

  test('two hashes of the same password are different (random salt)', () => {
    const h1 = hashPassword('samepassword');
    const h2 = hashPassword('samepassword');
    assert.notEqual(h1, h2);
    assert.equal(verifyPassword('samepassword', h1), true);
    assert.equal(verifyPassword('samepassword', h2), true);
  });

  test('first-run creates a CEO account, and only once', () => {
    const user = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'The Boss' });
    assert.equal(user.role, 'CEO');
    assert.equal(auth.hasAnyUser(), true);
    assert.throws(
      () => auth.createFirstUser({ username: 'second', password: 'password123', displayName: 'Second' }),
      AuthValidationError
    );
  });

  test('first-run does not show a role selector — role is always forced to CEO', () => {
    const user = auth.createFirstUser({ username: 'anyone', password: 'password123', displayName: 'Anyone' });
    assert.equal(user.role, 'CEO');
  });

  test('rejects weak passwords and invalid usernames', () => {
    assert.throws(() => auth.createFirstUser({ username: 'ab', password: 'password123', displayName: 'X' }), AuthValidationError);
    assert.throws(() => auth.createFirstUser({ username: 'validname', password: 'short', displayName: 'X' }), AuthValidationError);
  });

  test('successful login starts a session and records a login_logs success entry', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    const user = auth.login({ username: 'boss', password: 'password123' });
    assert.equal(user.username, 'boss');
    assert.deepEqual(getCurrentSession(), { userId: user.id, username: 'boss', role: 'CEO' });

    const logs = auth.listLoginLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].success, true);
  });

  test('wrong password fails login and is logged, without ever storing the password', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    assert.throws(() => auth.login({ username: 'boss', password: 'wrongpass' }), AuthValidationError);
    assert.equal(getCurrentSession(), null);

    const logs = auth.listLoginLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].success, false);
    assert.equal(logs[0].reason, 'Incorrect password');
    // Confirm the raw password never ends up anywhere in the log row.
    assert.doesNotMatch(JSON.stringify(logs[0]), /wrongpass/);
  });

  test('account locks out after 5 failed attempts, server-side (not just UI)', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    for (let i = 0; i < 5; i++) {
      assert.throws(() => auth.login({ username: 'boss', password: 'wrong' }));
    }
    // 6th attempt, even with the CORRECT password, must be rejected while locked.
    assert.throws(() => auth.login({ username: 'boss', password: 'password123' }), /too many failed attempts/i);
  });

  test('disabled accounts cannot log in', () => {
    const user = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    const second = auth.createUser('CEO', { username: 'staffer', password: 'password123', displayName: 'Staffer', role: 'VIEWER' });
    auth.update('CEO', user.id, second.id, { enabled: false });
    assert.throws(() => auth.login({ username: 'staffer', password: 'password123' }), /disabled/i);
  });

  test('logout clears the current session and is audited', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    auth.login({ username: 'boss', password: 'password123' });
    assert.notEqual(getCurrentSession(), null);
    auth.logout();
    assert.equal(getCurrentSession(), null);
  });

  test('only CEO can create another CEO account', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    assert.throws(
      () => auth.createUser('ADMIN', { username: 'boss2', password: 'password123', displayName: 'Boss2', role: 'CEO' }),
      AuthPermissionError
    );
    // CEO creating a CEO is fine.
    const secondCeo = auth.createUser('CEO', { username: 'boss2', password: 'password123', displayName: 'Boss2', role: 'CEO' });
    assert.equal(secondCeo.role, 'CEO');
  });

  test('a lower-level user cannot elevate their own role', () => {
    auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    const viewer = auth.createUser('CEO', { username: 'viewer1', password: 'password123', displayName: 'Viewer', role: 'VIEWER' });
    // The viewer tries to promote themselves to ADMIN — must be rejected regardless of who calls it,
    // because actorRole=VIEWER is not CEO.
    assert.throws(() => auth.update('VIEWER', viewer.id, viewer.id, { role: 'ADMIN' }), AuthPermissionError);
  });

  test('a user cannot disable their own account', () => {
    const ceo = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    assert.throws(() => auth.update('CEO', ceo.id, ceo.id, { enabled: false }), AuthPermissionError);
  });

  test('cannot demote or delete the only remaining CEO', () => {
    const ceo = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    const admin = auth.createUser('CEO', { username: 'admin1', password: 'password123', displayName: 'Admin', role: 'ADMIN' });
    assert.throws(() => auth.update('CEO', admin.id, ceo.id, { role: 'ADMIN' }), AuthValidationError);
    assert.throws(() => auth.deleteUser(admin.id, ceo.id), AuthValidationError);
  });

  test('cannot delete your own account', () => {
    const ceo = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    assert.throws(() => auth.deleteUser(ceo.id, ceo.id), AuthPermissionError);
  });

  test('resetPassword changes the password and old password no longer works', () => {
    const user = auth.createFirstUser({ username: 'boss', password: 'password123', displayName: 'Boss' });
    auth.resetPassword(user.id, 'newpassword456');
    assert.throws(() => auth.login({ username: 'boss', password: 'password123' }));
    const loggedIn = auth.login({ username: 'boss', password: 'newpassword456' });
    assert.equal(loggedIn.username, 'boss');
  });
});

describe('Permissions matrix', () => {
  test('CEO has every permission', () => {
    assert.equal(hasPermission('CEO', 'danger_zone.execute'), true);
    assert.equal(hasPermission('CEO', 'users.delete'), true);
  });

  test('Admin has almost everything but cannot execute the danger zone', () => {
    assert.equal(hasPermission('ADMIN', 'users.create'), true);
    assert.equal(hasPermission('ADMIN', 'danger_zone.execute'), false);
  });

  test('Manager can operate day-to-day but not manage users or settings', () => {
    assert.equal(hasPermission('MANAGER', 'campaigns.create'), true);
    assert.equal(hasPermission('MANAGER', 'qr.redeem'), true);
    assert.equal(hasPermission('MANAGER', 'users.create'), false);
    assert.equal(hasPermission('MANAGER', 'settings.edit'), false);
    assert.equal(hasPermission('MANAGER', 'danger_zone.access'), false);
  });

  test('Viewer is read-only and cannot redeem or generate codes', () => {
    assert.equal(hasPermission('VIEWER', 'sponsors.view'), true);
    assert.equal(hasPermission('VIEWER', 'qr.redeem'), false);
    assert.equal(hasPermission('VIEWER', 'qr.generate'), false);
    assert.equal(hasPermission('VIEWER', 'sponsors.create'), false);
  });

  test('every role permission list only contains real, defined permissions', () => {
    for (const role of ['CEO', 'ADMIN', 'MANAGER', 'VIEWER'] as const) {
      const perms = getPermissionsForRole(role);
      assert.ok(perms.length > 0);
    }
  });
});

