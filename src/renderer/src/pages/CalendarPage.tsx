import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Footprints, CalendarPlus } from 'lucide-react';
import type { DayAvailability, ReservationWithDetails } from '@shared/types/domain';
import { Header } from '@/components/Header';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { SlotStatusBadge, ReservationStatusBadge } from '@/components/ui/ReservationBadges';
import { ReservationDetailModal } from '@/components/ReservationDetailModal';
import { useAuth } from '@/lib/authContext';
import { todayStr, addDays, startOfWeek, monthBounds, parseDate, prettyDate, WEEKDAYS_SHORT } from '@/lib/dates';

type View = 'day' | 'week' | 'month';
const INACTIVE = new Set(['CANCELLED', 'NO_SHOW']);

interface DaySummary {
  isOpen: boolean;
  capacity: number;
  occupied: number;
  count: number;
}

export default function CalendarPage() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const [view, setView] = useState<View>('day');
  const [cursor, setCursor] = useState(todayStr());
  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [reservations, setReservations] = useState<ReservationWithDetails[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  const range = useMemo(() => {
    if (view === 'day') return { from: cursor, to: cursor };
    if (view === 'week') {
      const from = startOfWeek(cursor);
      return { from, to: addDays(from, 6) };
    }
    const { first, last } = monthBounds(cursor);
    const from = startOfWeek(first);
    return { from, to: addDays(startOfWeek(last), 6) };
  }, [view, cursor]);

  const load = useCallback(async () => {
    try {
      const res = await window.api.calendar.getRange(range.from, range.to);
      setDays(res.days);
      setReservations(res.reservations);
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load calendar');
      setDays([]);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    setDays(null);
    load();
  }, [load]);

  const summary = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const d of days ?? []) {
      let capacity = 0;
      let occupied = 0;
      for (const s of d.slots) {
        capacity += s.capacity;
        occupied += Math.min(s.occupied, s.capacity);
      }
      map.set(d.date, { isOpen: d.isOpen, capacity, occupied, count: 0 });
    }
    for (const r of reservations) {
      if (INACTIVE.has(r.status)) continue;
      const s = map.get(r.reservationDate);
      if (s) s.count += 1;
    }
    return map;
  }, [days, reservations]);

  const step = (dir: -1 | 1) => {
    if (view === 'day') setCursor(addDays(cursor, dir));
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else {
      const d = parseDate(cursor);
      d.setMonth(d.getMonth() + dir, 1);
      setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    }
  };

  const title =
    view === 'day'
      ? prettyDate(cursor)
      : view === 'week'
      ? `${prettyDate(range.from)} – ${prettyDate(range.to)}`
      : parseDate(cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const drill = (date: string) => {
    setCursor(date);
    setView('day');
  };

  return (
    <div className="space-y-5">
      <Header title="Calendar" subtitle="Real availability and bookings — day, week and month" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-secondary !px-2.5" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
          <button className="btn-secondary" onClick={() => setCursor(todayStr())}>Today</button>
          <button className="btn-secondary !px-2.5" onClick={() => step(1)} aria-label="Next"><ChevronRight size={16} /></button>
          <h2 className="ml-2 text-base font-semibold text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-base-border">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-4 py-2 text-sm capitalize transition-colors ${view === v ? 'bg-accent text-white' : 'bg-base-surface2 text-gray-400 hover:text-gray-100'}`}>
                {v}
              </button>
            ))}
          </div>
          {can('reservations.create') && (
            <>
              <Link to="/reservations/new?mode=walkin" className="btn-secondary"><Footprints size={15} /> Walk-in</Link>
              <Link to={`/reservations/new?mode=advance&date=${cursor < todayStr() ? todayStr() : cursor}`} className="btn-primary"><CalendarPlus size={15} /> Reserve</Link>
            </>
          )}
        </div>
      </div>

      {days === null ? (
        <PageSpinner />
      ) : view === 'day' ? (
        <DayView day={days[0]} reservations={reservations} onOpen={setOpenId} canCreate={can('reservations.create')} />
      ) : view === 'week' ? (
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => (
            <DayCell key={d.date} date={d.date} s={summary.get(d.date)} onClick={() => drill(d.date)} tall />
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-1 grid grid-cols-7 gap-2 text-center text-xs text-gray-500">
            {WEEKDAYS_SHORT.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {days.map((d) => (
              <DayCell key={d.date} date={d.date} s={summary.get(d.date)} onClick={() => drill(d.date)} dim={d.date.slice(0, 7) !== cursor.slice(0, 7)} />
            ))}
          </div>
        </div>
      )}

      {openId !== null && <ReservationDetailModal reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function DayCell({ date, s, onClick, tall, dim }: { date: string; s?: DaySummary; onClick: () => void; tall?: boolean; dim?: boolean }) {
  const isToday = date === todayStr();
  const pct = s && s.capacity > 0 ? Math.round((s.occupied / s.capacity) * 100) : 0;
  const bar = pct >= 100 ? 'bg-danger' : pct >= 75 ? 'bg-warning' : 'bg-success';
  const d = parseDate(date);
  return (
    <button
      onClick={onClick}
      className={`card flex flex-col justify-between p-2.5 text-left transition-colors hover:border-accent-dim ${tall ? 'min-h-[140px]' : 'min-h-[92px]'} ${dim ? 'opacity-40' : ''} ${isToday ? '!border-accent' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${isToday ? 'text-cyan' : 'text-gray-200'}`}>
          {tall ? `${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}` : d.getDate()}
        </span>
        {s && !s.isOpen && <span className="text-[10px] font-semibold uppercase text-gray-500">Closed</span>}
      </div>
      {s && s.isOpen && (
        <div className="space-y-1">
          <p className="text-[11px] text-gray-400">{s.count} booking{s.count === 1 ? '' : 's'}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-base-surface2">
            <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="text-[10px] text-gray-500">{s.occupied}/{s.capacity} places · {pct}%</p>
        </div>
      )}
    </button>
  );
}

function DayView({ day, reservations, onOpen, canCreate }: { day?: DayAvailability; reservations: ReservationWithDetails[]; onOpen: (id: number) => void; canCreate: boolean }) {
  if (!day) return null;
  if (!day.isOpen) {
    return <div className="card p-8 text-center text-sm text-gray-400"><span className="mb-1 block text-lg font-semibold text-gray-200">CLOSED</span>No reservations can be made on {prettyDate(day.date)}.</div>;
  }
  const active = reservations.filter((r) => r.reservationDate === day.date && !INACTIVE.has(r.status));
  const closedOnes = reservations.filter((r) => r.reservationDate === day.date && INACTIVE.has(r.status));
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-base-border text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3 text-center">Capacity</th>
              <th className="px-4 py-3 text-center">Reserved</th>
              <th className="px-4 py-3 text-center">Available</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {day.slots.map((s) => {
              const here = active.filter((r) => r.startTime === s.startTime);
              const free = Math.max(0, s.capacity - s.occupied);
              const bookable = s.status === 'AVAILABLE' || s.status === 'ALMOST_FULL';
              return (
                <tr key={s.startTime} className="border-b border-base-border/60 align-top last:border-0">
                  <td className="px-4 py-3 font-semibold text-white">{s.startTime}–{s.endTime}</td>
                  <td className="px-4 py-3 text-gray-400">{s.periodName ?? '—'}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{s.capacity}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{s.occupied}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{free}</td>
                  <td className="px-4 py-3"><SlotStatusBadge status={s.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {here.map((r) => (
                        <button key={r.id} onClick={() => onOpen(r.id)} className="flex items-center gap-1.5 rounded-lg border border-base-border bg-base-surface2 px-2 py-1 text-xs text-gray-200 hover:border-accent-dim">
                          {r.customerName} · {r.players}
                          <ReservationStatusBadge status={r.status} />
                        </button>
                      ))}
                      {bookable && canCreate && (
                        <Link to={`/reservations/new?mode=advance&date=${day.date}&time=${s.startTime}`} className="text-xs text-cyan hover:underline">+ Book</Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {closedOnes.length > 0 && (
        <p className="text-xs text-gray-500">
          {closedOnes.length} cancelled / no-show booking(s) today are not counted against capacity.
        </p>
      )}
    </div>
  );
}
