import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, CalendarPlus, Footprints, CalendarDays } from 'lucide-react';
import type { ReservationWithDetails, ReservationStatus } from '@shared/types/domain';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ReservationStatusBadge, PaymentBadge } from '@/components/ui/ReservationBadges';
import { ReservationDetailModal } from '@/components/ReservationDetailModal';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { todayStr, addDays, prettyDate } from '@/lib/dates';

type Range = 'today' | 'upcoming' | 'past' | 'all';
const STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export default function Reservations() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>((params.get('range') as Range) || (params.get('payment') ? 'all' : 'today'));
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  // "Payments" view: /reservations?payment=UNPAID lists what is still owed.
  const [payment, setPayment] = useState<'' | 'UNPAID' | 'PAID'>((params.get('payment') as 'UNPAID' | 'PAID' | null) ?? '');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ReservationWithDetails[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // A non-empty search box searches everything (name, phone, reservation ID, coupon code).
      if (query.trim()) {
        const found = await window.api.reservations.search(query.trim());
        setItems(found.filter((r) => (!status || r.status === status) && (!payment || r.paymentStatus === payment)));
        return;
      }
      const today = todayStr();
      const filter: { dateFrom?: string; dateTo?: string; status?: ReservationStatus } = {};
      if (range === 'today') { filter.dateFrom = today; filter.dateTo = today; }
      if (range === 'upcoming') filter.dateFrom = addDays(today, 1);
      if (range === 'past') filter.dateTo = addDays(today, -1);
      if (status) filter.status = status;
      const raw = await window.api.reservations.list(filter);
      // "Unpaid" only makes sense for bookings that can still be paid.
      const list = payment
        ? raw.filter((r) => r.paymentStatus === payment && (payment === 'PAID' || (r.status !== 'CANCELLED' && r.status !== 'NO_SHOW')))
        : raw;
      // list() is newest-first; show today/upcoming soonest-first for staff.
      setItems(range === 'upcoming' || range === 'today' ? [...list].reverse() : list);
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load reservations');
      setItems([]);
    }
  }, [range, status, payment, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = Number(params.get('open'));
    if (id) {
      setOpenId(id);
      params.delete('open');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div className="space-y-5">
      <Header title="Reservations" subtitle="Walk-ins and advance bookings, live from your database" />

      {can('reservations.create') && (
        <div className="flex justify-end gap-2">
          <Link to="/reservations/new?mode=walkin" className="btn-secondary">
            <Footprints size={16} /> Walk-in
          </Link>
          <Link to="/reservations/new?mode=advance" className="btn-primary">
            <CalendarPlus size={16} /> New Reservation
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-9"
            placeholder="Search name, phone, reservation ID, coupon code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-base-border">
          {(['today', 'upcoming', 'past', 'all'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              disabled={!!query.trim()}
              className={`px-3 py-2 text-sm capitalize transition-colors ${
                range === r && !query.trim() ? 'bg-accent text-white' : 'bg-base-surface2 text-gray-400 hover:text-gray-100'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={payment} onChange={(e) => setPayment(e.target.value as '' | 'UNPAID' | 'PAID')}>
          <option value="">Any payment</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PAID">Paid</option>
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {items === null ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No reservations found"
          description={query ? 'Nothing matches that search.' : 'Nothing booked for this filter yet.'}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Players</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="cursor-pointer border-b border-base-border/60 transition-colors last:border-0 hover:bg-base-surface2/60"
                >
                  <td className="px-4 py-3 text-gray-500">{r.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-100">{prettyDate(r.reservationDate)}</p>
                    <p className="text-xs text-gray-500">{r.startTime} · {r.periodName ?? `${r.durationMin} min`}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-100">{r.customerName}</p>
                    <p className="text-xs text-gray-500">{r.customerPhone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{r.players}</td>
                  <td className="px-4 py-3 text-gray-300">{r.reservationType === 'WALK_IN' ? 'Walk-in' : 'Advance'}</td>
                  <td className="px-4 py-3"><ReservationStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3"><PaymentBadge status={r.paymentStatus} /></td>
                  <td className="px-4 py-3 text-right text-gray-100">
                    {formatMoney(r.finalPriceCents)}
                    {r.couponCode && <p className="font-mono text-[10px] text-cyan">{r.couponCode}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && (
        <ReservationDetailModal reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}
