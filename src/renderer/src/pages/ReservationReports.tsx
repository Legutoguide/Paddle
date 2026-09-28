import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { ReservationReport } from '@shared/types/domain';
import { fromCents } from '@shared/lib/pricing';
import { Header } from '@/components/Header';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { todayStr, monthBounds } from '@/lib/dates';

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function ReservationReports() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const bounds = monthBounds(todayStr());
  const [from, setFrom] = useState(bounds.first);
  const [to, setTo] = useState(bounds.last);
  const [r, setR] = useState<ReservationReport | null>(null);

  const load = useCallback(async () => {
    try {
      setR(await window.api.reservations.report(from, to));
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not build report');
    }
  }, [from, to]);

  useEffect(() => {
    if (from && to && from <= to) load();
  }, [load, from, to]);

  const money = (c: number | null) => (c === null ? '—' : formatMoney(c));

  const exportCsv = () => {
    if (!r) return;
    const lines: string[] = [];
    const add = (...cells: (string | number | null)[]) => lines.push(cells.map(csvCell).join(','));
    add('Prime Paddle reservation report', `${r.dateFrom} to ${r.dateTo}`);
    add();
    add('Metric', 'Value');
    add('Total reservations', r.total); add('Completed', r.completed); add('Cancelled', r.cancelled); add('No-show', r.noShow);
    add('Walk-in', r.walkIn); add('Advance', r.advance); add('Paid', r.paid); add('Unpaid', r.unpaid);
    add('Coupon reservations', r.couponReservations); add('Average players', r.averagePlayers); add('Occupancy %', r.occupancyPercent);
    if (r.revenueCents !== null) {
      add('Revenue', fromCents(r.revenueCents)); add('Outstanding (unpaid)', fromCents(r.unpaidCents ?? 0)); add('Discounts given', fromCents(r.discountCents ?? 0));
    }
    add();
    add('Sponsor', 'Campaign', 'Reservations', 'Coupons reserved', 'Coupons used', 'Discount', 'Revenue');
    for (const s of r.sponsorPerformance) {
      add(s.sponsorName, s.campaignName, s.reservations, s.couponsReserved, s.couponsUsed, s.discountCents === null ? null : fromCents(s.discountCents), s.revenueCents === null ? null : fromCents(s.revenueCents));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prime-paddle-reservations-${r.dateFrom}_${r.dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <Header title="Reservation Reports" subtitle="Everything below is calculated from your real reservations" />

      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {can('export.use') && <button className="btn-secondary" disabled={!r} onClick={exportCsv}><Download size={15} /> Export CSV</button>}
      </div>
      {from > to && <p className="text-sm text-danger">The start date must be on or before the end date.</p>}

      {!r ? <PageSpinner /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Total reservations" value={r.total} sub={`${r.completed} completed`} />
            <Kpi label="Cancelled / no-show" value={`${r.cancelled} / ${r.noShow}`} />
            <Kpi label="Walk-in / advance" value={`${r.walkIn} / ${r.advance}`} />
            <Kpi label="Occupancy" value={`${r.occupancyPercent}%`} sub={`avg ${r.averagePlayers} players`} />
            <Kpi label="Paid / unpaid" value={`${r.paid} / ${r.unpaid}`} />
            <Kpi label="Coupon reservations" value={r.couponReservations} />
            <Kpi label="Revenue" value={money(r.revenueCents)} sub={r.unpaidCents === null ? undefined : `${money(r.unpaidCents)} outstanding`} />
            <Kpi label="Discounts given" value={money(r.discountCents)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Ranking title="Popular times" rows={r.popularTimes} />
            <Ranking title="Popular days" rows={r.popularDays} />
            <Ranking title="Popular periods" rows={r.popularPeriods} />
          </div>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Sponsor coupon performance</h2>
            {r.sponsorPerformance.length === 0 ? <p className="text-sm text-gray-500">No coupon-based reservations in this period.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500"><tr><th className="py-2">Sponsor</th><th>Campaign</th><th>Reservations</th><th>Reserved</th><th>Used</th><th>Discount</th><th>Revenue</th></tr></thead>
                <tbody>
                  {r.sponsorPerformance.map((s, i) => (
                    <tr key={i} className="border-t border-base-border/60 text-gray-300">
                      <td className="py-2 text-gray-100">{s.sponsorName}</td><td>{s.campaignName}</td><td>{s.reservations}</td>
                      <td>{s.couponsReserved}</td><td>{s.couponsUsed}</td><td>{money(s.discountCents)}</td><td>{money(s.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Customers</h2>
            <p className="mb-3 text-xs text-gray-500">{r.customers.distinct} booked in this period · {r.customers.newInRange} new</p>
            <ul className="space-y-1 text-sm">
              {r.customers.topBySpend.map((c, i) => (
                <li key={i} className="flex justify-between text-gray-300"><span>{c.name} <span className="text-gray-500">({c.reservations})</span></span><span>{money(c.spendCents)}</span></li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((x) => x.count));
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-gray-500">No data yet.</p> : (
        <ul className="space-y-2">
          {rows.map((x) => (
            <li key={x.label} className="text-sm">
              <div className="flex justify-between text-gray-300"><span>{x.label}</span><span>{x.count}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-base-surface2"><div className="h-full rounded-full bg-cyan" style={{ width: `${(x.count / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
