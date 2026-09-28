import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Footprints, UserPlus, ScanLine, Users, Gauge, Ticket, Wallet, CalendarClock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReservationDashboardStats } from '@shared/types/domain';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { useToast } from '@/components/ui/Toast';

function Tile({ icon: Icon, label, value, sub, tint }: { icon: LucideIcon; label: string; value: string | number; sub?: string; tint: string }) {
  return (
    <div className="card flex items-start gap-3.5 p-4">
      <div className={`icon-tile ${tint}`}><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
        {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * Reservation half of the dashboard. Every number is fetched from the main
 * process, which computes it from the database. Money tiles only appear when
 * the server sent money figures (i.e. the user holds dashboard.financial_view).
 */
export function ReservationDashboard() {
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [s, setS] = useState<ReservationDashboardStats | null>(null);
  const allowed = can('reservations.view');

  useEffect(() => {
    if (!allowed) return;
    window.api.reservations
      .dashboard()
      .then(setS)
      .catch((e) => toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load reservation stats'));
  }, [allowed]);

  if (!allowed) return null;

  const actions = [
    { to: '/reservations/new?mode=advance', label: 'New Reservation', icon: CalendarPlus, perm: 'reservations.create' as const, tint: 'from-accent to-accent-dim' },
    { to: '/reservations/new?mode=walkin', label: 'Walk-in', icon: Footprints, perm: 'reservations.create' as const, tint: 'from-teal to-emerald-600' },
    { to: '/customers?new=1', label: 'New Customer', icon: UserPlus, perm: 'customers.create' as const, tint: 'from-purple to-fuchsia-700' },
    { to: '/scan', label: 'Scan QR', icon: ScanLine, perm: 'qr.scan' as const, tint: 'from-orange-500 to-amber-600' },
  ].filter((a) => can(a.perm));

  return (
    <section className="mb-6 space-y-4">
      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {actions.map(({ to, label, icon: Icon, tint }) => (
            <Link key={label} to={to} className="card flex items-center gap-3 p-3.5 transition-colors hover:border-accent-dim">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tint} text-white shadow-card`}><Icon size={18} /></div>
              <span className="text-sm font-medium text-gray-100">{label}</span>
            </Link>
          ))}
        </div>
      )}

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={CalendarCheck} label="Today's reservations" value={s.todayReservations} sub={`${s.todayWalkIns} walk-in · ${s.todayAdvance} advance`} tint="bg-accent/20 text-cyan" />
          <Tile icon={Gauge} label="Today's occupancy" value={`${s.todayOccupancyPercent}%`} sub={`${s.todayOccupied}/${s.todayCapacityTotal} places · ${s.todayAvailable} still bookable`} tint="bg-teal/20 text-teal" />
          <Tile icon={CalendarClock} label="Upcoming (next 7 days)" value={s.upcomingReservations} sub={`${s.monthAdvance} advance bookings this month`} tint="bg-purple/20 text-purple" />
          <Tile icon={Users} label="Customers" value={s.totalCustomers} sub={`${s.monthWalkIns} walk-ins this month`} tint="bg-cyan/20 text-cyan" />
          <Tile icon={Ticket} label="Coupon bookings today" value={s.couponReservationsToday} sub={`${s.monthCouponUsed} coupons used this month`} tint="bg-warning/20 text-warning" />
          {s.revenueTodayCents !== null && (
            <Tile icon={Wallet} label="Revenue today" value={formatMoney(s.revenueTodayCents)} sub="paid reservations" tint="bg-success/20 text-success" />
          )}
          {s.revenueMonthCents !== null && (
            <Tile icon={Wallet} label="Revenue this month" value={formatMoney(s.revenueMonthCents)} sub={`${s.monthReservations} reservations`} tint="bg-success/20 text-success" />
          )}
        </div>
      )}
    </section>
  );
}
