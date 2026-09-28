import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, UserCircle2, CheckCheck, Trash2, LogOut } from 'lucide-react';
import type { AppNotification } from '@/types/window';
import { playSound } from '@/lib/soundService';
import { useAuth } from '@/lib/authContext';

const ROLE_LABEL: Record<string, string> = {
  CEO: 'CEO & Founder',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  VIEWER: 'Viewer',
};

const TYPE_LABEL: Record<string, string> = {
  QR_REDEEMED: 'Coupon redeemed',
  CAMPAIGN_CREATED: 'Campaign created',
  BATCH_GENERATED: 'QR batch generated',
  CAMPAIGN_EXPIRING: 'Campaign expiring',
  BACKUP_COMPLETED: 'Backup completed',
  BACKUP_FAILED: 'Backup failed',
  RESTORE_COMPLETED: 'Database restored',
  DATA_RESET: 'Data reset',
  RESERVATION_CREATED: 'New reservation',
  RESERVATION_PAID: 'Payment received',
  RESERVATION_CANCELLED: 'Reservation cancelled',
};

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [entries, setEntries] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const lastUnreadRef = useRef(0);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Poll unread count so the bell badge reflects real events (coupon
  // redemptions, batches, expiring campaigns, backups) even if they
  // happened outside a direct user action in this window.
  useEffect(() => {
    const poll = async () => {
      const count = await window.api.notifications.unreadCount();
      if (count > lastUnreadRef.current) playSound('notification');
      lastUnreadRef.current = count;
      setUnreadCount(count);
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  const toggle = async () => {
    if (!open) {
      const list = await window.api.notifications.list({ limit: 10 });
      setEntries(list);
    }
    setOpen((v) => !v);
  };

  const markAllRead = async () => {
    await window.api.notifications.markAllRead();
    setEntries((prev) => prev.map((e) => ({ ...e, readAt: e.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    lastUnreadRef.current = 0;
  };

  const clearAll = async () => {
    await window.api.notifications.clearAll();
    setEntries([]);
    setUnreadCount(0);
    lastUnreadRef.current = 0;
  };

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative" ref={ref}>
          <button
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-base-border bg-base-surface text-gray-400 transition-colors hover:text-gray-100"
            title="Notifications"
            onClick={toggle}
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-12 z-30 w-80 rounded-xl border border-base-border bg-base-surface p-2 shadow-card">
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-xs font-semibold text-gray-400">Notifications</p>
                <div className="flex gap-1">
                  <button title="Mark all read" onClick={markAllRead} className="rounded p-1 text-gray-500 hover:bg-base-surface2 hover:text-gray-200">
                    <CheckCheck size={13} />
                  </button>
                  <button title="Clear all" onClick={clearAll} className="rounded p-1 text-gray-500 hover:bg-base-surface2 hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {entries.length === 0 ? (
                <p className="px-2 py-3 text-xs text-gray-500">No notifications yet.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {entries.map((n) => (
                    <button
                      key={n.id}
                      onClick={async () => {
                        if (!n.readAt) {
                          await window.api.notifications.markRead(n.id);
                          setEntries((prev) => prev.map((e) => (e.id === n.id ? { ...e, readAt: new Date().toISOString() } : e)));
                          setUnreadCount((c) => Math.max(0, c - 1));
                        }
                      }}
                      className={`block w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-base-surface2 ${
                        !n.readAt ? 'bg-accent/5' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                        <p className="font-medium text-gray-200">{TYPE_LABEL[n.type] ?? n.title}</p>
                      </div>
                      <p className="mt-0.5 text-gray-500">{n.message}</p>
                      <p className="mt-0.5 text-[10px] text-gray-600">{new Date(n.createdAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="relative" ref={profileRef}>
          <button
            className="flex items-center gap-2.5 rounded-xl border border-base-border bg-base-surface px-3 py-2"
            onClick={() => setProfileOpen((v) => !v)}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-cyan text-white">
              <UserCircle2 size={18} />
            </div>
            <div className="text-left leading-tight">
              <p className="text-xs font-semibold text-gray-100">{user?.displayName ?? 'Guest'}</p>
              <p className="text-[10px] text-gray-500">{user ? ROLE_LABEL[user.role] : ''}</p>
            </div>
            <ChevronDown size={14} className="text-gray-500" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-12 z-30 w-44 rounded-xl border border-base-border bg-base-surface p-1.5 shadow-card">
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-300 hover:bg-base-surface2"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
