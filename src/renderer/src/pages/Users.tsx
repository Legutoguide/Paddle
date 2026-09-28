import { useEffect, useState, useCallback } from 'react';
import { Plus, KeyRound, Trash2, ShieldCheck } from 'lucide-react';
import type { AppUser, UserRole, LoginLogEntry } from '@/types/window';
import { Header } from '@/components/Header';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/authContext';

const ROLE_LABEL: Record<UserRole, string> = {
  CEO: 'CEO & Founder',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  VIEWER: 'Viewer',
};

const ROLE_BADGE: Record<UserRole, string> = {
  CEO: 'bg-gold/15 text-gold border border-gold/30',
  ADMIN: 'bg-accent/15 text-accent border border-accent/30',
  MANAGER: 'bg-teal/15 text-teal border border-teal/30',
  VIEWER: 'bg-gray-500/15 text-gray-400 border border-gray-500/30',
};

export default function Users() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loginLogs, setLoginLogs] = useState<LoginLogEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    const [list, logs] = await Promise.all([
      window.api.users.list(),
      can('login_logs.view') ? window.api.loginLogs.list({ limit: 15 }) : Promise.resolve([]),
    ]);
    setUsers(list);
    setLoginLogs(logs);
  }, [can]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (u: AppUser) => {
    try {
      await window.api.users.update(u.id, { enabled: !u.enabled });
      toast.show('success', `${u.displayName} ${u.enabled ? 'disabled' : 'enabled'}`);
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await window.api.users.delete(deleteTarget.id);
      toast.show('success', 'User deleted');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (!users) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <Header title="Users" subtitle="Manage who can access this application and what they can do" />

      {can('users.create') && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New User
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Login</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                <td className="px-4 py-3 text-gray-100">
                  {u.displayName}
                  {u.id === me?.id && <span className="ml-1.5 text-xs text-gray-500">(you)</span>}
                </td>
                <td className="px-4 py-3 font-mono text-gray-400">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${ROLE_BADGE[u.role]}`}>
                    <ShieldCheck size={12} /> {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={u.enabled ? 'text-success' : 'text-danger'}>{u.enabled ? 'Active' : 'Disabled'}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {can('users.reset_password') && (
                      <button className="btn-ghost !px-2 !py-1.5" title="Reset password" onClick={() => setResetTarget(u)}>
                        <KeyRound size={15} />
                      </button>
                    )}
                    {can('users.disable') && u.id !== me?.id && (
                      <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => toggleEnabled(u)}>
                        {u.enabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                    {can('users.delete') && u.id !== me?.id && (
                      <button className="btn-ghost !px-2 !py-1.5 text-danger" title="Delete" onClick={() => setDeleteTarget(u)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can('login_logs.view') && (
        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold text-gray-200">Recent Login Activity</h2>
          {loginLogs.length === 0 ? (
            <p className="text-xs text-gray-500">No login activity yet.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto text-xs">
              {loginLogs.map((l) => (
                <div key={l.id} className="flex justify-between border-b border-base-border/50 py-1.5 last:border-0">
                  <span className={l.success ? 'text-gray-300' : 'text-danger'}>
                    {l.username} — {l.success ? 'signed in' : `failed (${l.reason ?? 'unknown reason'})`}
                  </span>
                  <span className="text-gray-600">{new Date(l.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} onDone={() => setResetTarget(null)} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete user?"
          message={`Permanently delete "${deleteTarget.displayName}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { user: me } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('MANAGER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableRoles: UserRole[] = me?.role === 'CEO' ? ['CEO', 'ADMIN', 'MANAGER', 'VIEWER'] : ['ADMIN', 'MANAGER', 'VIEWER'];

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await window.api.users.create({ username: username.trim(), password, displayName: displayName.trim(), role });
      toast.show('success', 'User created');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New User" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Display Name</label>
          <input className="input" autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {availableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AppUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    try {
      await window.api.users.resetPassword(user.id, password);
      toast.show('success', `Password reset for ${user.displayName}`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Reset password for ${user.displayName}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-4">
        <div>
          <label className="label">New Password</label>
          <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Reset Password'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

