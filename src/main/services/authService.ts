import type Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AuditService } from './auditService';
import { NotificationService } from './notificationService';

export type UserRole = 'CEO' | 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface User {
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

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  enabled: number;
  last_login_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    enabled: row.enabled === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SCRYPT_KEYLEN = 64;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(hash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export class AuthValidationError extends Error {}
export class AuthPermissionError extends Error {}
export class UserNotFoundError extends Error {}

/**
 * In-memory current session for this running app instance. There is no
 * multi-window/multi-user concurrent access in this desktop app, so a
 * single module-level session is sufficient and avoids the complexity of
 * a real token/cookie system for a fully offline, single-machine app.
 */
let currentSession: { userId: number; username: string; role: UserRole } | null = null;

export function getCurrentSession() {
  return currentSession;
}

export function clearCurrentSession() {
  currentSession = null;
}

export class AuthService {
  private audit: AuditService;
  private notifications: NotificationService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  hasAnyUser(): boolean {
    const row = this.db.prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM users`).get();
    return !!row && row.c > 0;
  }

  /** First-run only: creates the first user, always as CEO & Founder. */
  createFirstUser(params: { username: string; password: string; displayName: string }): User {
    if (this.hasAnyUser()) {
      throw new AuthValidationError('An account already exists. First-run setup can only run once.');
    }
    return this.createUserInternal({ ...params, role: 'CEO' });
  }

  private createUserInternal(params: { username: string; password: string; displayName: string; role: UserRole }): User {
    const username = params.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new AuthValidationError('Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
    }
    if (params.password.length < 8) {
      throw new AuthValidationError('Password must be at least 8 characters.');
    }
    if (!params.displayName.trim()) {
      throw new AuthValidationError('Display name is required.');
    }

    const existing = this.db.prepare<[string], { c: number }>(`SELECT COUNT(*) as c FROM users WHERE username = ?`).get(username);
    if (existing && existing.c > 0) {
      throw new AuthValidationError('This username is already taken.');
    }

    const passwordHash = hashPassword(params.password);
    const result = this.db
      .prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`)
      .run(username, params.displayName.trim(), passwordHash, params.role);

    this.audit.log('USER_CREATED', 'user', Number(result.lastInsertRowid), { username, role: params.role });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  /**
   * Create an additional user. Only CEO/ADMIN may call this (enforced by
   * the IPC layer via requirePermission before this is even invoked, but
   * we double-check role assignment rules here too — defense in depth).
   */
  createUser(actorRole: UserRole, params: { username: string; password: string; displayName: string; role: UserRole }): User {
    if (params.role === 'CEO' && actorRole !== 'CEO') {
      throw new AuthPermissionError('Only the CEO can create another CEO account.');
    }
    return this.createUserInternal(params);
  }

  getById(id: number): User | null {
    const row = this.db.prepare<[number], UserRow>(`SELECT * FROM users WHERE id = ?`).get(id);
    return row ? mapUser(row) : null;
  }

  list(): User[] {
    const rows = this.db.prepare<[], UserRow>(`SELECT * FROM users ORDER BY created_at ASC`).all();
    return rows.map(mapUser);
  }

  update(
    actorRole: UserRole,
    actorUserId: number,
    id: number,
    input: Partial<{ displayName: string; role: UserRole; enabled: boolean }>
  ): User {
    const target = this.getById(id);
    if (!target) throw new UserNotFoundError('User not found');

    // Never allow a lower-level user to elevate their own privileges.
    if (input.role && input.role !== target.role) {
      if (actorRole !== 'CEO') {
        throw new AuthPermissionError("Only the CEO can change a user's role.");
      }
      if (id === actorUserId) {
        throw new AuthPermissionError('You cannot change your own role.');
      }
    }
    if (input.enabled === false && id === actorUserId) {
      throw new AuthPermissionError('You cannot disable your own account.');
    }
    if (target.role === 'CEO' && input.role && input.role !== 'CEO') {
      const otherCeos = this.db
        .prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM users WHERE role = 'CEO' AND id != ?`)
        .get(id)!;
      if (otherCeos.c === 0) {
        throw new AuthValidationError('Cannot demote the only remaining CEO account.');
      }
    }

    this.db
      .prepare(
        `UPDATE users SET display_name = ?, role = ?, enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(
        input.displayName?.trim() ?? target.displayName,
        input.role ?? target.role,
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : target.enabled ? 1 : 0,
        id
      );

    this.audit.log('USER_UPDATED', 'user', id, input);
    return this.getById(id)!;
  }

  resetPassword(id: number, newPassword: string): void {
    if (newPassword.length < 8) {
      throw new AuthValidationError('Password must be at least 8 characters.');
    }
    const target = this.getById(id);
    if (!target) throw new UserNotFoundError('User not found');

    this.db
      .prepare(`UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(hashPassword(newPassword), id);
    this.audit.log('USER_PASSWORD_RESET', 'user', id, null);
  }

  deleteUser(actorUserId: number, id: number): void {
    if (id === actorUserId) throw new AuthPermissionError('You cannot delete your own account.');
    const target = this.getById(id);
    if (!target) throw new UserNotFoundError('User not found');
    if (target.role === 'CEO') {
      const otherCeos = this.db
        .prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM users WHERE role = 'CEO' AND id != ?`)
        .get(id)!;
      if (otherCeos.c === 0) throw new AuthValidationError('Cannot delete the only remaining CEO account.');
    }
    this.db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    this.audit.log('USER_DELETED', 'user', id, { username: target.username });
  }

  /**
   * Attempt to log in. Enforces failed-attempt lockout server-side (never
   * trust a UI-only lockout). Always records a login_logs entry, success
   * or failure, without ever storing the attempted password.
   */
  login(params: { username: string; password: string; deviceName?: string | null; appVersion?: string | null }): User {
    const username = params.username.trim().toLowerCase();
    const row = this.db.prepare<[string], UserRow>(`SELECT * FROM users WHERE username = ?`).get(username);

    const recordAttempt = (success: boolean, reason: string | null, userId: number | null) => {
      this.db
        .prepare(
          `INSERT INTO login_logs (user_id, username, success, reason, device_name, app_version) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, username, success ? 1 : 0, reason, params.deviceName ?? null, params.appVersion ?? null);
    };

    if (!row) {
      recordAttempt(false, 'Unknown username', null);
      throw new AuthValidationError('Invalid username or password.');
    }

    if (row.locked_until && row.locked_until > new Date().toISOString()) {
      recordAttempt(false, 'Account temporarily locked', row.id);
      const minutesLeft = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
      throw new AuthValidationError(`Too many failed attempts. Try again in ${minutesLeft} minute(s).`);
    }

    if (!row.enabled) {
      recordAttempt(false, 'Account disabled', row.id);
      throw new AuthValidationError('This account has been disabled.');
    }

    if (!verifyPassword(params.password, row.password_hash)) {
      const failedAttempts = row.failed_attempts + 1;
      let lockedUntil: string | null = null;
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
      }
      this.db
        .prepare(`UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?`)
        .run(failedAttempts, lockedUntil, row.id);
      recordAttempt(false, 'Incorrect password', row.id);
      this.audit.log('LOGIN_FAILED', 'user', row.id, { username });
      throw new AuthValidationError('Invalid username or password.');
    }

    // Success: reset failed attempts, record last login, start session.
    this.db
      .prepare(
        `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(row.id);
    recordAttempt(true, null, row.id);
    this.audit.log('LOGIN_SUCCESS', 'user', row.id, { username });

    currentSession = { userId: row.id, username: row.username, role: row.role as UserRole };
    return this.getById(row.id)!;
  }

  logout(): void {
    if (currentSession) {
      this.audit.log('LOGOUT', 'user', currentSession.userId, { username: currentSession.username });
    }
    clearCurrentSession();
  }

  listLoginLogs(params: { limit?: number; dateFrom?: string } = {}): LoginLogEntry[] {
    let sql = `SELECT * FROM login_logs WHERE 1=1`;
    const args: unknown[] = [];
    if (params.dateFrom) {
      sql += ` AND created_at >= ?`;
      args.push(params.dateFrom);
    }
    sql += ` ORDER BY created_at DESC`;
    if (params.limit !== undefined) {
      sql += ` LIMIT ?`;
      args.push(params.limit);
    }
    const rows = this.db
      .prepare<
        unknown[],
        {
          id: number;
          user_id: number | null;
          username: string;
          success: number;
          reason: string | null;
          device_name: string | null;
          app_version: string | null;
          created_at: string;
        }
      >(sql)
      .all(...args);
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      success: r.success === 1,
      reason: r.reason,
      deviceName: r.device_name,
      appVersion: r.app_version,
      createdAt: r.created_at,
    }));
  }
}

