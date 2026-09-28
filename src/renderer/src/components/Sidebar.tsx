import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Megaphone,
  QrCode,
  ScanLine,
  History,
  Settings as SettingsIcon,
  Download,
  Layers,
  UserCog,
  Waves,
  CalendarDays,
  CalendarRange,
  CreditCard,
  Contact,
  SlidersHorizontal,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '@/lib/authContext';

// Reservation nav — permission-gated the same way as the rest (UI convenience
// only; every IPC call is re-checked in the main process).
const RESERVATION_NAV = [
  { to: '/reservations', label: 'Reservations', icon: CalendarDays, permission: 'reservations.view' as const },
  { to: '/calendar', label: 'Calendar', icon: CalendarRange, permission: 'calendar.view' as const },
  { to: '/customers', label: 'Customers', icon: Contact, permission: 'customers.view' as const },
  { to: '/reservations?payment=UNPAID', label: 'Payments', icon: CreditCard, permission: 'reservations.view' as const },
];

const MAIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sponsors', label: 'Sponsors', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/coupons', label: 'QR Codes', icon: QrCode },
  { to: '/batches', label: 'Batches', icon: Layers },
];

const STATUS_NAV = [
  { to: '/coupons?status=AVAILABLE', label: 'Available', dot: 'bg-success' },
  { to: '/coupons?status=RESERVED', label: 'Reserved', dot: 'bg-warning' },
  { to: '/coupons?status=USED', label: 'Used', dot: 'bg-accent' },
  { to: '/coupons?status=EXPIRED', label: 'Expired', dot: 'bg-warning' },
  { to: '/coupons?status=REVOKED', label: 'Revoked', dot: 'bg-danger' },
];

const BOTTOM_NAV = [
  { to: '/scan', label: 'Scan / Validate', icon: ScanLine, highlight: true },
  { to: '/reservation-reports', label: 'Reservation Reports', icon: BarChart3, permission: 'reports.view' as const },
  { to: '/booking-setup', label: 'Booking Setup', icon: SlidersHorizontal, permission: 'pricing.view' as const },
  { to: '/history', label: 'History', icon: History },
  { to: '/exports', label: 'Exports', icon: Download },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'users.view' as const },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-cyan text-white shadow-glow"
      style={{ width: size, height: size }}
    >
      <Waves size={size * 0.58} strokeWidth={2.3} />
    </div>
  );
}

export function Sidebar({ businessName }: { businessName: string }) {
  const { can } = useAuth();
  const loc = useLocation();
  // NavLink ignores query strings, so "Reservations" and "Payments" (same path)
  // would both light up. Decide active state ourselves for those two.
  const isActiveFor = (to: string, routerActive: boolean): boolean => {
    if (to.includes('?')) {
      const [path, query] = to.split('?');
      return loc.pathname === path && loc.search.includes(query);
    }
    if (to === '/reservations') return routerActive && !loc.search.includes('payment=');
    return routerActive;
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-base-border bg-base-surface">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo />
        <div className="min-w-0">
          <p className="truncate text-base font-bold tracking-wide text-white">PRIME PADDLE</p>
          <p className="text-[11px] text-gray-500">Paddle · Beach · Summer</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {[MAIN_NAV[0], ...RESERVATION_NAV.filter((i) => can(i.permission)), ...MAIN_NAV.slice(1)].map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={'end' in rest ? rest.end : undefined}
            className={({ isActive: routerActive }) => {
              const isActive = isActiveFor(to, routerActive);
              return [
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
                isActive
                  ? 'bg-gradient-to-r from-accent to-accent-dim text-white font-medium shadow-glow'
                  : 'text-gray-400 hover:bg-base-surface2 hover:text-gray-100',
              ].join(' ');
            }}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}

        <div className="mt-2 space-y-1 border-t border-base-border/70 pt-2">
          {STATUS_NAV.map(({ to, label, dot }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-base-surface2 hover:text-gray-100"
            >
              <span className={`h-2 w-2 rounded-full ${dot}`} />
              {label}
            </NavLink>
          ))}
        </div>

        <div className="mt-2 space-y-1 border-t border-base-border/70 pt-2">
          {BOTTOM_NAV.filter((item) => !item.permission || can(item.permission)).map(({ to, label, icon: Icon, highlight }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-accent to-accent-dim text-white font-medium shadow-glow'
                    : highlight
                    ? 'text-cyan hover:bg-base-surface2'
                    : 'text-gray-400 hover:bg-base-surface2 hover:text-gray-100',
                ].join(' ')
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="border-t border-base-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-base-surface2/60 px-3 py-2.5">
          <Logo size={28} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-200">{businessName}</p>
            <p className="text-[10px] text-gray-500">Works fully offline</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
