import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Footprints, CalendarPlus, CalendarDays, Ticket, CheckCircle2, CreditCard, Waves, Undo2, UserSearch } from 'lucide-react';
import type { AvailabilitySlot, Customer, DayAvailability, Period, Reservation } from '@shared/types/domain';
import { calculatePrice } from '@shared/lib/pricing';
import { Header } from '@/components/Header';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { SlotStatusBadge, SLOT_TILE } from '@/components/ui/ReservationBadges';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { todayStr, addDays, nowHHMM, prettyDate } from '@/lib/dates';

type Mode = 'walkin' | 'advance';

interface CouponPreview {
  code: string;
  sponsorName: string;
  campaignName: string;
  originalPriceCents: number;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountPercentage: number;
  discountAmountCents: number;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const remaining = (s: AvailabilitySlot) => Math.max(0, s.capacity - s.occupied);

/**
 * One wizard for both booking types. Customer, phone, players, notes and
 * coupon live in this component's state, NOT in the mode — so "Book Another
 * Date" on a Walk-in just flips `mode` to advance and staff carry straight
 * on with date/time, without retyping anything.
 */
export default function NewReservation() {
  const toast = useToast();
  // useToast() returns a new object each time a toast appears/expires; keep it
  // in a ref so it never retriggers data loading (which would clear the slot).
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navigate = useNavigate();
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'walkin' ? 'walkin' : 'advance');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [players, setPlayers] = useState(1);
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState<Customer[]>([]);

  const presetDate = params.get('date');
  const presetTime = useRef<string | null>(params.get('time'));
  const validPreset = presetDate && /^\d{4}-\d{2}-\d{2}$/.test(presetDate) && presetDate >= todayStr() ? presetDate : null;
  const [date, setDate] = useState<string>(mode === 'walkin' ? todayStr() : validPreset ?? addDays(todayStr(), 1));
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodFilter, setPeriodFilter] = useState<number | null>(null);
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [nextSlot, setNextSlot] = useState<AvailabilitySlot | null>(null);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [loadingDay, setLoadingDay] = useState(true);

  const [basePrice, setBasePrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Reservation | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    window.api.periods.list().then((p) => setPeriods(p.filter((x) => x.active))).catch(() => undefined);
  }, []);

  // Load the real availability for the chosen date.
  const loadDay = useCallback(async () => {
    setLoadingDay(true);
    try {
      const d = await window.api.availability.getDay(date);
      setDay(d);
      // One-shot: pre-select the slot the calendar link pointed at.
      if (presetTime.current) {
        const match = d.slots.find((x) => x.startTime === presetTime.current);
        presetTime.current = null;
        if (match) setSlot(match);
      }
      if (mode === 'walkin') {
        setNextSlot(await window.api.availability.nextAvailable(date, nowHHMM()));
      } else {
        setNextSlot(null);
      }
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load availability');
    } finally {
      setLoadingDay(false);
    }
  }, [date, mode]);

  useEffect(() => {
    setSlot(null);
    loadDay();
  }, [loadDay]);

  // Customer lookup by phone so returning customers aren't retyped.
  useEffect(() => {
    const q = phone.replace(/\D/g, '');
    if (q.length < 3 || !can('customers.view')) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    window.api.customers.search(phone).then((r) => { if (!cancelled) setSuggestions(r.slice(0, 4)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [phone, can]);

  const durationMin = slot ? toMin(slot.endTime) - toMin(slot.startTime) : 0;

  // Price comes from the configured pricing rules — never hardcoded.
  // pricingRules.preview() returns a PER-PLAYER rate; `perPlayerRate` stays
  // that raw rate for display, while `breakdown` below does the actual
  // player-count scaling (and the coupon-override, when one is attached).
  const [perPlayerRate, setPerPlayerRate] = useState<number | null>(null);
  useEffect(() => {
    setPerPlayerRate(null);
    setBasePrice(null);
    setPriceError(null);
    if (!slot) return;
    window.api.pricingRules
      .preview({ date, periodId: slot.periodId, durationMin })
      .then((rule) => { setPerPlayerRate(rule.priceCents); setBasePrice(rule.priceCents * players); })
      .catch((e) => setPriceError(e instanceof Error ? e.message : 'No price configured'));
  }, [slot, date, durationMin, players]);

  const applyCoupon = async () => {
    setCouponError(null);
    setCoupon(null);
    const code = couponInput.trim();
    if (!code) return;
    try {
      const res = await window.api.coupons.validate(code);
      if (res.outcome === 'VALID') {
        const c = res.coupon;
        setCoupon({
          code: c.code,
          sponsorName: c.sponsorName,
          campaignName: c.campaignName,
          originalPriceCents: c.originalPriceCents,
          discountType: c.discountType,
          discountPercentage: c.discountPercentage,
          discountAmountCents: c.discountAmountCents,
        });
      } else if (res.outcome === 'RESERVED') {
        setCouponError('Coupon Reserved — this coupon is already reserved and cannot be used for another reservation.');
      } else if (res.outcome === 'USED') setCouponError('This coupon has already been used.');
      else if (res.outcome === 'EXPIRED') setCouponError('This coupon has expired.');
      else if (res.outcome === 'REVOKED') setCouponError('This coupon has been revoked.');
      else setCouponError('Coupon not found.');
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : 'Could not check coupon');
    }
  };

  // A coupon's own campaign price REPLACES the per-player total — it does
  // not stack on top of it (a coupon often already represents a specific
  // group package the business configured, e.g. a "2 players" deal).
  const breakdown = useMemo(() => {
    if (coupon) {
      const b = calculatePrice({
        originalPriceCents: coupon.originalPriceCents,
        discountType: coupon.discountType,
        discountPercentage: coupon.discountPercentage,
        discountAmountCents: coupon.discountAmountCents,
      });
      return { base: coupon.originalPriceCents, discount: b.youSaveCents, final: b.finalPriceCents };
    }
    if (basePrice === null) return null;
    return { base: basePrice, discount: 0, final: basePrice };
  }, [basePrice, coupon]);


  // Which slots can this party actually book right now?
  const bookable = (s: AvailabilitySlot): boolean => {
    if (remaining(s) < players) return false;
    if (s.status === 'AVAILABLE' || s.status === 'ALMOST_FULL') return true;
    return mode === 'walkin' && s.status === 'IN_PROGRESS'; // walk-ins may join the session underway
  };
  const visibleSlots = (day?.slots ?? []).filter((s) => periodFilter === null || s.periodId === periodFilter);
  const availableNow = mode === 'walkin' ? (day?.slots ?? []).find((s) => s.status === 'IN_PROGRESS' && bookable(s)) ?? null : null;
  const recommended = availableNow ?? (nextSlot && nextSlot.date === date && remaining(nextSlot) >= players ? nextSlot : null);

  const switchToAdvance = () => {
    // "Book Another Date": nothing entered is lost.
    setMode('advance');
    setDate(addDays(todayStr(), 1));
    setSlot(null);
    toast.show('info', 'Switched to an advance reservation — customer details kept.');
  };

  const resetAll = () => {
    setCreated(null);
    setPaid(false);
    setName('');
    setPhone('');
    setPlayers(1);
    setNotes('');
    setSlot(null);
    setCoupon(null);
    setCouponInput('');
    setCouponError(null);
    loadDay();
  };

  const canConfirm = name.trim() && phone.trim() && players >= 1 && slot && breakdown && !busy;

  const confirm = async () => {
    if (!slot || !canConfirm) return;
    setBusy(true);
    try {
      const input = {
        customer: { name: name.trim(), phone: phone.trim() },
        reservationDate: date,
        startTime: slot.startTime,
        durationMin,
        periodId: slot.periodId,
        players,
        couponCode: coupon?.code ?? null,
        notes: notes.trim() || null,
      };
      let r = mode === 'walkin' ? await window.api.reservations.createWalkIn(input) : await window.api.reservations.createAdvance(input);
      if (mode === 'walkin' && can('reservations.checkin')) {
        r = await window.api.reservations.checkIn(r.id); // walk-in is physically present
      }
      setCreated(r);
      toast.show('success', mode === 'walkin' ? 'Walk-in confirmed' : 'Reservation confirmed');
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not create the reservation');
      loadDay(); // availability may have changed underneath us
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async () => {
    if (!created) return;
    setBusy(true);
    try {
      await window.api.reservations.markAsPaid(created.id);
      setPaid(true);
      toast.show('success', coupon ? 'Paid — coupon marked as used automatically' : 'Payment recorded');
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <Header title="Reservation confirmed" />
        <div className="card flex flex-col items-center gap-2 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 size={26} />
          </div>
          <p className="text-lg font-semibold text-white">#{created.id} · {name}</p>
          <p className="text-sm text-gray-400">{prettyDate(created.reservationDate)} at {created.startTime} · {created.players} player(s)</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatMoney(created.finalPriceCents)}</p>
          {coupon && <p className="text-xs text-cyan">Coupon {coupon.code} reserved for this booking</p>}
          <div className="mt-5 flex w-full flex-col gap-2">
            {can('reservations.payment') && !paid && (
              <button className="btn-primary" disabled={busy} onClick={markPaid}>
                <CreditCard size={16} /> Mark as paid
              </button>
            )}
            {paid && <p className="text-sm font-medium text-success">Paid ✓</p>}
            <button className="btn-secondary" onClick={() => navigate(`/reservations?open=${created.id}`)}>Open reservation</button>
            <button className="btn-ghost" onClick={resetAll}>Book another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header
        title={mode === 'walkin' ? 'Walk-in' : 'New Reservation'}
        subtitle={mode === 'walkin' ? 'Customer is here now' : 'Book a future date and time'}
      />

      <div className="flex gap-2">
        <button className={mode === 'walkin' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setMode('walkin'); setDate(todayStr()); }}>
          <Footprints size={16} /> Walk-in
        </button>
        <button className={mode === 'advance' ? 'btn-primary' : 'btn-secondary'} onClick={() => mode === 'walkin' ? switchToAdvance() : undefined}>
          <CalendarPlus size={16} /> Advance
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* 1 — customer */}
          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold text-white">1 · Customer</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Phone</label>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" autoFocus />
              </div>
              <div>
                <label className="label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
              </div>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((c) => (
                  <button key={c.id} className="btn-secondary !py-1 text-xs" onClick={() => { setName(c.name); setPhone(c.phone); setSuggestions([]); }}>
                    <UserSearch size={13} /> {c.name} · {c.phone}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <div>
                <label className="label">Players</label>
                <input className="input" type="number" min={1} value={players} onChange={(e) => setPlayers(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </section>

          {/* 2 — when */}
          <section className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">2 · {mode === 'walkin' ? 'Available now' : 'Date & time'}</h2>
              {mode === 'walkin' && (
                <button className="btn-secondary !py-1.5 text-xs" onClick={switchToAdvance}>
                  <Undo2 size={14} /> Book Another Date
                </button>
              )}
            </div>

            {mode === 'advance' && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Date</label>
                  <input className="input" type="date" min={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button className={`badge border ${periodFilter === null ? 'border-accent bg-accent/20 text-white' : 'border-base-border text-gray-400'}`} onClick={() => setPeriodFilter(null)}>All</button>
                  {periods.map((p) => (
                    <button key={p.id} className={`badge border ${periodFilter === p.id ? 'border-accent bg-accent/20 text-white' : 'border-base-border text-gray-400'}`} onClick={() => setPeriodFilter(p.id)}>
                      {p.name} <span className="opacity-60">{p.startTime}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'walkin' && recommended && (
              <button
                onClick={() => setSlot(recommended)}
                className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors ${
                  slot?.startTime === recommended.startTime && slot.date === recommended.date ? 'border-accent bg-accent/10' : 'border-cyan/40 bg-cyan/5 hover:bg-cyan/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Waves className="text-cyan" size={22} />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {availableNow ? 'Available now' : 'Next available'} · {recommended.startTime}–{recommended.endTime}
                    </p>
                    <p className="text-xs text-gray-400">{remaining(recommended)} of {recommended.capacity} places free{recommended.periodName ? ` · ${recommended.periodName}` : ''}</p>
                  </div>
                </div>
                <SlotStatusBadge status={recommended.status} />
              </button>
            )}
            {mode === 'walkin' && !recommended && !loadingDay && (
              <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
                Nothing is available today for {players} player(s). Use “Book Another Date” — the customer details are kept.
              </p>
            )}

            {loadingDay ? (
              <PageSpinner />
            ) : day && !day.isOpen ? (
              <p className="rounded-lg bg-base-surface2 p-3 text-sm text-gray-400">CLOSED — no reservations can be made on {prettyDate(date)}.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {visibleSlots.map((s) => {
                  const ok = bookable(s);
                  const selected = slot?.startTime === s.startTime;
                  return (
                    <button
                      key={s.startTime}
                      disabled={!ok}
                      onClick={() => setSlot(s)}
                      className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed ${SLOT_TILE[s.status]} ${selected ? '!border-accent ring-1 ring-accent' : ''}`}
                    >
                      <p className="text-sm font-semibold text-white">{s.startTime}</p>
                      <p className="text-[11px] text-gray-400">{remaining(s)}/{s.capacity} free</p>
                      <div className="mt-1.5"><SlotStatusBadge status={s.status} /></div>
                    </button>
                  );
                })}
                {visibleSlots.length === 0 && <p className="col-span-full text-sm text-gray-500">No slots in this selection.</p>}
              </div>
            )}
          </section>

          {/* 3 — coupon */}
          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold text-white">3 · Coupon <span className="font-normal text-gray-500">(optional)</span></h2>
            <div className="flex gap-2">
              <input className="input font-mono" value={couponInput} onChange={(e) => { setCouponInput(e.target.value); setCoupon(null); setCouponError(null); }} placeholder="Type or paste the coupon code" />
              <button className="btn-secondary" onClick={applyCoupon} disabled={!couponInput.trim()}>
                <Ticket size={15} /> Apply
              </button>
            </div>
            {coupon && (
              <p className="text-sm text-success">
                ✓ {coupon.sponsorName} · {coupon.campaignName} —{' '}
                {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountPercentage}% off` : `${formatMoney(coupon.discountAmountCents)} off`}. It will be locked to this booking and used automatically when it is paid.
                {' '}This coupon's own price ({formatMoney(coupon.originalPriceCents)}) is used instead of the per-player rate.
              </p>
            )}
            {couponError && <p className="text-sm text-danger">{couponError}</p>}
          </section>
        </div>

        {/* summary */}
        <aside className="card h-fit space-y-3 p-5 lg:sticky lg:top-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><CalendarDays size={16} /> Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <Line k="Type" v={mode === 'walkin' ? 'Walk-in' : 'Advance'} />
            <Line k="Customer" v={name.trim() || '—'} />
            <Line k="Players" v={String(players)} />
            <Line k="Date" v={prettyDate(date)} />
            <Line k="Time" v={slot ? `${slot.startTime}–${slot.endTime}${slot.periodName ? ` · ${slot.periodName}` : ''}` : '—'} />
          </dl>
          <div className="space-y-1.5 border-t border-base-border pt-3 text-sm">
            {priceError ? (
              <p className="text-danger">{priceError} Ask an admin to add a pricing rule in Booking Setup.</p>
            ) : breakdown ? (
              <>
                {coupon ? (
                  <Line k="Coupon package price" v={formatMoney(breakdown.base)} />
                ) : (
                  <>
                    <Line k="Price" v={formatMoney(breakdown.base)} />
                    {perPlayerRate !== null && players > 1 && (
                      <p className="text-right text-[11px] text-gray-500">{formatMoney(perPlayerRate)} × {players} players</p>
                    )}
                  </>
                )}
                {breakdown.discount > 0 && <Line k="Coupon discount" v={`− ${formatMoney(breakdown.discount)}`} />}
                <Line k="Total" v={formatMoney(breakdown.final)} strong />
              </>
            ) : (
              <p className="text-gray-500">Pick a time to see the price.</p>
            )}
          </div>
          <button className="btn-primary w-full" disabled={!canConfirm} onClick={confirm}>
            {busy ? 'Saving…' : mode === 'walkin' ? 'Confirm & start' : 'Confirm reservation'}
          </button>
        </aside>
      </div>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-base-border pt-1.5 text-base font-semibold text-white' : 'text-gray-300'}`}>
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
