import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, UserRound } from 'lucide-react';
import type { Customer, CustomerWithStats, ReservationWithDetails } from '@shared/types/domain';
import { Header } from '@/components/Header';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ReservationStatusBadge } from '@/components/ui/ReservationBadges';
import { ReservationDetailModal } from '@/components/ReservationDetailModal';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { prettyDate } from '@/lib/dates';

export default function Customers() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Customer[] | null>(null);
  const [showForm, setShowForm] = useState<Customer | 'new' | null>(params.get('new') ? 'new' : null);
  const [profileId, setProfileId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(query.trim() ? await window.api.customers.search(query.trim()) : await window.api.customers.list());
    } catch (e) {
      toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load customers');
      setItems([]);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (params.get('new')) {
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div className="space-y-5">
      <Header title="Customers" subtitle="Everyone who has booked — with their history" />
      {can('customers.create') && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowForm('new')}>
            <Plus size={16} /> New Customer
          </button>
        </div>
      )}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className="input pl-9" placeholder="Search name, phone, reservation ID, coupon code…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {items === null ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <EmptyState icon={UserRound} title="No customers found" description={query ? 'Nothing matches that search.' : 'Customers are created automatically with their first booking, or add one here.'} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border text-left text-xs text-gray-500">
              <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Since</th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => setProfileId(c.id)} className="cursor-pointer border-b border-base-border/60 last:border-0 hover:bg-base-surface2/60">
                  <td className="px-4 py-3 font-medium text-gray-100">{c.name}</td>
                  <td className="px-4 py-3 text-gray-300">{c.phone}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-500">{c.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <CustomerForm
          customer={showForm === 'new' ? null : showForm}
          onClose={() => setShowForm(null)}
          onSaved={() => { setShowForm(null); load(); }}
        />
      )}
      {profileId !== null && (
        <CustomerProfile
          id={profileId}
          onClose={() => setProfileId(null)}
          onEdit={(c) => { setProfileId(null); setShowForm(c); }}
        />
      )}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (customer) await window.api.customers.update(customer.id, { name, phone, notes: notes || null });
      else await window.api.customers.create({ name, phone, notes: notes || null });
      toast.show('success', customer ? 'Customer updated' : 'Customer added');
      onSaved();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not save customer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div><label className="label">Phone</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="label">Notes</label><textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim() || !phone.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function CustomerProfile({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (c: Customer) => void }) {
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const [c, setC] = useState<CustomerWithStats | null>(null);
  const [history, setHistory] = useState<ReservationWithDetails[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [cust, list] = await Promise.all([
      window.api.customers.get(id),
      can('reservations.view') ? window.api.reservations.list({ customerId: id }) : Promise.resolve([] as ReservationWithDetails[]),
    ]);
    setC(cust);
    setHistory(list);
  }, [id, can]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (!c) return <Modal title="Customer" onClose={onClose}><PageSpinner /></Modal>;
  const s = c.stats;

  return (
    <Modal title={c.name} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-gray-300">{c.phone}</p>
            {c.notes && <p className="mt-1 text-gray-500">{c.notes}</p>}
          </div>
          {can('customers.edit') && <button className="btn-secondary" onClick={() => onEdit(c)}>Edit</button>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Reservations" value={String(s.totalReservations)} />
          <Stat label="Completed" value={String(s.completedReservations)} />
          <Stat label="Cancelled" value={String(s.cancelledReservations)} />
          <Stat label="No-shows" value={String(s.noShowReservations)} />
          <Stat label="Coupons used" value={String(s.couponUsageCount)} />
          <Stat label="Total spent" value={formatMoney(s.totalSpendCents)} />
        </div>
        <p className="text-xs text-gray-500">Last visit: {s.lastVisitAt ? prettyDate(s.lastVisitAt) : 'no completed visit yet'}</p>
        {history.length > 0 && (
          <div>
            <p className="label">Reservation history</p>
            <ul className="divide-y divide-base-border/60 rounded-lg border border-base-border">
              {history.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setOpenId(r.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-base-surface2/60">
                    <span className="text-gray-200">#{r.id} · {prettyDate(r.reservationDate)} {r.startTime}</span>
                    <ReservationStatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {openId !== null && <ReservationDetailModal reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-base-border bg-base-surface2/50 p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-semibold text-white">{value}</p>
    </div>
  );
}
