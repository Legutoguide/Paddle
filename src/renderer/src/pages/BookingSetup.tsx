import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import type { BusinessHours, Period, PricingRule } from '@shared/types/domain';
import { toCents, fromCents } from '@shared/lib/pricing';
import { Header } from '@/components/Header';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';

const DAYS = [
  { weekday: 1, label: 'Monday' }, { weekday: 2, label: 'Tuesday' }, { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' }, { weekday: 5, label: 'Friday' }, { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

export default function BookingSetup() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const [hours, setHours] = useState<BusinessHours[] | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [editRule, setEditRule] = useState<PricingRule | 'new' | null>(null);
  const [editPeriod, setEditPeriod] = useState<Period | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, p, r] = await Promise.all([
        window.api.businessHours.list(),
        window.api.periods.list(),
        window.api.pricingRules.list(),
      ]);
      setHours(h);
      setPeriods(p);
      setRules(r);
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load booking setup');
      setHours([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (hours === null) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <Header title="Booking Setup" subtitle="Business hours, capacity, periods and prices — nothing is hardcoded" />

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-white">Business hours & capacity</h2>
        <p className="text-xs text-gray-500">Capacity is the number of players per time slot. A closed day accepts no reservations.</p>
        <div className="space-y-2">
          {DAYS.map(({ weekday, label }) => {
            const h = hours.find((x) => x.weekday === weekday);
            return h ? <HoursRow key={weekday} label={label} h={h} editable={can('business_hours.edit')} onSaved={load} /> : null;
          })}
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Periods</h2>
          {can('periods.edit') && <button className="btn-secondary" onClick={() => setEditPeriod('new')}><Plus size={15} /> Add period</button>}
        </div>
        <ul className="divide-y divide-base-border/60">
          {periods.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-100">{p.name} <span className="text-gray-500">{p.startTime}–{p.endTime}</span></span>
              <span className="flex items-center gap-3">
                {!p.active && <span className="text-xs text-gray-500">inactive</span>}
                {can('periods.edit') && <button className="btn-ghost !py-1" onClick={() => setEditPeriod(p)}>Edit</button>}
              </span>
            </li>
          ))}
          {periods.length === 0 && <li className="py-3 text-sm text-gray-500">No periods configured.</li>}
        </ul>
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Pricing rules</h2>
          {can('pricing.edit') && <button className="btn-secondary" onClick={() => setEditRule('new')}><Plus size={15} /> Add rule</button>}
        </div>
        <p className="text-xs text-gray-500">The highest-priority active rule matching the day, period and duration sets the price. With no matching rule, booking is blocked — a price is never guessed.</p>
        <RulesTable rules={rules} periods={periods} onEdit={can('pricing.edit') ? setEditRule : undefined} />
      </section>

      {editRule && <RuleForm rule={editRule === 'new' ? null : editRule} periods={periods} onClose={() => setEditRule(null)} onSaved={() => { setEditRule(null); load(); }} />}
      {editPeriod && <PeriodForm period={editPeriod === 'new' ? null : editPeriod} onClose={() => setEditPeriod(null)} onSaved={() => { setEditPeriod(null); load(); }} />}
    </div>
  );
}

function HoursRow({ label, h, editable, onSaved }: { label: string; h: BusinessHours; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(h.isOpen);
  const [open, setOpen] = useState(h.openTime ?? '09:00');
  const [close, setClose] = useState(h.closeTime ?? '19:00');
  const [slot, setSlot] = useState(h.slotMinutes);
  const [cap, setCap] = useState(h.capacity);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await window.api.businessHours.update(h.weekday, { isOpen, openTime: isOpen ? open : h.openTime, closeTime: isOpen ? close : h.closeTime, slotMinutes: slot, capacity: cap });
      toast.show('success', `${label} saved`);
      onSaved();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[110px_80px_1fr_auto] items-center gap-3 text-sm">
      <span className="text-gray-200">{label}</span>
      <label className="flex items-center gap-2 text-gray-400">
        <input type="checkbox" disabled={!editable} checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} /> Open
      </label>
      <div className={`flex flex-wrap items-center gap-2 ${isOpen ? '' : 'opacity-40'}`}>
        <input className="input !w-[100px]" type="time" disabled={!editable || !isOpen} value={open} onChange={(e) => setOpen(e.target.value)} />
        <span className="text-gray-500">to</span>
        <input className="input !w-[100px]" type="time" disabled={!editable || !isOpen} value={close} onChange={(e) => setClose(e.target.value)} />
        <span className="ml-2 text-xs text-gray-500">slot</span>
        <input className="input !w-[70px]" type="number" min={15} step={15} disabled={!editable || !isOpen} value={slot} onChange={(e) => setSlot(Number(e.target.value))} />
        <span className="text-xs text-gray-500">min · capacity</span>
        <input className="input !w-[70px]" type="number" min={0} disabled={!editable || !isOpen} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
      </div>
      {editable ? <button className="btn-secondary !py-1.5" disabled={busy} onClick={save}><Save size={14} /> Save</button> : <span />}
    </div>
  );
}

function RulesTable({ rules, periods, onEdit }: { rules: PricingRule[]; periods: Period[]; onEdit?: (r: PricingRule) => void }) {
  const { formatMoney } = useSettings();
  const dayNames = (mask: number) =>
    mask === 127 ? 'Every day' : DAYS.filter((d) => mask & (1 << d.weekday)).map((d) => d.label.slice(0, 3)).join(', ') || '—';
  if (rules.length === 0) return <p className="text-sm text-warning">No pricing rules yet — reservations cannot be created until you add one.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-gray-500">
        <tr><th className="py-2">Rule</th><th>Days</th><th>Period</th><th>Duration</th><th>Price</th><th>Priority</th><th /></tr>
      </thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.id} className={`border-t border-base-border/60 ${r.active ? '' : 'opacity-50'}`}>
            <td className="py-2 text-gray-100">{r.name}</td>
            <td className="text-gray-400">{dayNames(r.weekdayMask)}</td>
            <td className="text-gray-400">{r.periodId ? periods.find((p) => p.id === r.periodId)?.name ?? '—' : 'Any'}</td>
            <td className="text-gray-400">{r.durationMin} min</td>
            <td className="text-gray-100">{formatMoney(r.priceCents)}</td>
            <td className="text-gray-400">{r.priority}</td>
            <td className="text-right">{onEdit && <button className="btn-ghost !py-1" onClick={() => onEdit(r)}>Edit</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RuleForm({ rule, periods, onClose, onSaved }: { rule: PricingRule | null; periods: Period[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { settings } = useSettings();
  const [name, setName] = useState(rule?.name ?? '');
  const [mask, setMask] = useState(rule?.weekdayMask ?? 127);
  const [periodId, setPeriodId] = useState<number | null>(rule?.periodId ?? null);
  const [duration, setDuration] = useState(rule?.durationMin ?? 60);
  const [price, setPrice] = useState(rule ? String(fromCents(rule.priceCents)) : '');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [active, setActive] = useState(rule?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const input = { name, weekdayMask: mask, periodId, durationMin: duration, priceCents: toCents(Number(price)), priority, active };
      if (rule) await window.api.pricingRules.update(rule.id, input);
      else await window.api.pricingRules.create(input);
      toast.show('success', 'Pricing rule saved');
      onSaved();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not save rule');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={rule ? 'Edit pricing rule' : 'New pricing rule'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend sunset" autoFocus /></div>
        <div>
          <label className="label">Days</label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = (mask & (1 << d.weekday)) !== 0;
              return (
                <button key={d.weekday} type="button" onClick={() => setMask(mask ^ (1 << d.weekday))} className={`badge border ${on ? 'border-accent bg-accent/20 text-white' : 'border-base-border text-gray-400'}`}>
                  {d.label.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Period</label>
            <select className="input" value={periodId ?? ''} onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any period</option>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label">Duration (min)</label><input className="input" type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
          <div><label className="label">Price ({settings.currency})</label><input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><label className="label">Priority</label><input className="input" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim() || price === '' || mask === 0} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function PeriodForm({ period, onClose, onSaved }: { period: Period | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(period?.name ?? '');
  const [start, setStart] = useState(period?.startTime ?? '09:00');
  const [end, setEnd] = useState(period?.endTime ?? '12:00');
  const [active, setActive] = useState(period?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await window.api.periods.upsert({ id: period?.id, name, startTime: start, endTime: end, sortOrder: period?.sortOrder, active });
      toast.show('success', 'Period saved');
      onSaved();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not save period');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={period ? 'Edit period' : 'New period'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunset" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Starts</label><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className="label">Ends</label><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
