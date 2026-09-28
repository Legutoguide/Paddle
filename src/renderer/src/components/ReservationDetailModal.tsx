import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, Play, BadgeCheck, XCircle, UserX, CreditCard, Ticket, Unlink } from 'lucide-react';
import type { ReservationWithDetails, ReservationHistoryEntry } from '@shared/types/domain';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ReservationStatusBadge, PaymentBadge } from '@/components/ui/ReservationBadges';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';
import { prettyDate } from '@/lib/dates';

type Pending = null | 'pay' | 'cancel' | 'noshow';

/**
 * Full reservation view + every lifecycle action. All buttons only call
 * window.api.reservations.*; the main process re-checks permissions and the
 * status-transition whitelist, so hiding a button here is convenience only.
 */
export function ReservationDetailModal({
  reservationId,
  onClose,
  onChanged,
}: {
  reservationId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { can } = useAuth();
  const { formatMoney } = useSettings();
  const [r, setR] = useState<ReservationWithDetails | null>(null);
  const [history, setHistory] = useState<ReservationHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [couponCode, setCouponCode] = useState('');

  const load = useCallback(async () => {
    const [res, hist] = await Promise.all([
      window.api.reservations.get(reservationId),
      window.api.reservations.history(reservationId),
    ]);
    setR(res);
    setHistory(hist);
  }, [reservationId]);

  useEffect(() => {
    load().catch((e) => toastRef.current.show('error', e instanceof Error ? e.message : 'Could not load reservation'));
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.show('success', label);
      await load();
      onChanged();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
      setPending(null);
      setReason('');
    }
  };

  if (!r) {
    return (
      <Modal title="Reservation" onClose={onClose}>
        <PageSpinner />
      </Modal>
    );
  }

  const active = r.status !== 'CANCELLED' && r.status !== 'NO_SHOW' && r.status !== 'COMPLETED';
  const paid = r.paymentStatus === 'PAID';

  return (
    <Modal title={`Reservation #${r.id}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ReservationStatusBadge status={r.status} />
          <PaymentBadge status={r.paymentStatus} />
          <span className="badge bg-base-surface2 text-gray-300 border border-base-border">
            {r.reservationType === 'WALK_IN' ? 'Walk-in' : 'Advance'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Info label="Customer" value={`${r.customerName}`} />
          <Info label="Phone" value={r.customerPhone} />
          <Info label="Date" value={prettyDate(r.reservationDate)} />
          <Info label="Time" value={`${r.startTime} · ${r.durationMin} min${r.periodName ? ` · ${r.periodName}` : ''}`} />
          <Info label="Players" value={String(r.players)} />
          <Info label="Coupon" value={r.couponCode ?? '—'} mono />
        </div>

        <div className="rounded-lg border border-base-border bg-base-surface2/50 p-3">
          <Row label="Base price" value={formatMoney(r.basePriceCents)} />
          {r.discountCents > 0 && <Row label="Coupon discount" value={`− ${formatMoney(r.discountCents)}`} />}
          <Row label="Total" value={formatMoney(r.finalPriceCents)} strong />
        </div>

        {r.notes && <p className="rounded-lg bg-base-surface2/50 p-3 text-gray-300">{r.notes}</p>}
        {r.cancelReason && <p className="text-xs text-gray-500">Reason: {r.cancelReason}</p>}

        {active && !paid && can('reservations.edit') && (
          <div className="flex items-end gap-2">
            {r.couponId ? (
              <button className="btn-secondary" disabled={busy} onClick={() => run('Coupon released', () => window.api.reservations.detachCoupon(r.id))}>
                <Unlink size={15} /> Remove coupon
              </button>
            ) : (
              <>
                <div className="flex-1">
                  <label className="label">Attach coupon code</label>
                  <input className="input font-mono" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="e.g. SPONSOR-AB123" />
                </div>
                <button
                  className="btn-secondary"
                  disabled={busy || !couponCode.trim()}
                  onClick={() => run('Coupon reserved for this booking', () => window.api.reservations.attachCoupon(r.id, couponCode.trim()))}
                >
                  <Ticket size={15} /> Attach
                </button>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-base-border pt-4">
          {r.status === 'CONFIRMED' && can('reservations.checkin') && (
            <button className="btn-secondary" disabled={busy} onClick={() => run('Checked in', () => window.api.reservations.checkIn(r.id))}>
              <LogIn size={15} /> Check in
            </button>
          )}
          {r.status === 'CHECKED_IN' && can('reservations.edit') && (
            <button className="btn-secondary" disabled={busy} onClick={() => run('Session started', () => window.api.reservations.start(r.id))}>
              <Play size={15} /> Start
            </button>
          )}
          {r.status === 'IN_PROGRESS' && can('reservations.edit') && (
            <button className="btn-secondary" disabled={busy} onClick={() => run('Completed', () => window.api.reservations.complete(r.id))}>
              <BadgeCheck size={15} /> Complete
            </button>
          )}
          {!paid && active && can('reservations.payment') && (
            <button className="btn-primary" disabled={busy} onClick={() => setPending('pay')}>
              <CreditCard size={15} /> Mark as paid · {formatMoney(r.finalPriceCents)}
            </button>
          )}
          {(r.status === 'CONFIRMED' || r.status === 'CHECKED_IN' || r.status === 'PENDING') && can('reservations.cancel') && (
            <>
              <input
                className="input max-w-[200px]"
                placeholder="Cancel reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button className="btn-danger" disabled={busy} onClick={() => setPending('cancel')}>
                <XCircle size={15} /> Cancel
              </button>
            </>
          )}
          {r.status === 'CONFIRMED' && can('reservations.cancel') && (
            <button className="btn-danger" disabled={busy} onClick={() => setPending('noshow')}>
              <UserX size={15} /> No-show
            </button>
          )}
        </div>

        {history.length > 0 && (
          <div>
            <p className="label">History</p>
            <ul className="space-y-1 text-xs text-gray-400">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span>
                    {h.fromStatus ? `${h.fromStatus} → ` : ''}
                    {h.toStatus}
                    {h.note ? ` · ${h.note}` : ''}
                  </span>
                  <span>{new Date(h.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {pending === 'pay' && (
        <ConfirmDialog
          title="Mark as paid?"
          message={
            r.couponCode
              ? `Records payment of ${formatMoney(r.finalPriceCents)}. The reserved coupon ${r.couponCode} will be marked as used automatically — no extra step.`
              : `Records payment of ${formatMoney(r.finalPriceCents)}.`
          }
          confirmLabel="Mark as paid"
          busy={busy}
          onConfirm={() => run('Payment recorded', () => window.api.reservations.markAsPaid(r.id))}
          onCancel={() => setPending(null)}
        />
      )}
      {(pending === 'cancel' || pending === 'noshow') && (
        <ConfirmDialog
          title={pending === 'cancel' ? 'Cancel this reservation?' : 'Mark as no-show?'}
          message="The slot capacity is released and any reserved coupon becomes available again."
          detail={pending === 'cancel' && reason ? `Reason: ${reason}` : undefined}
          confirmLabel={pending === 'cancel' ? 'Cancel reservation' : 'Mark no-show'}
          danger
          busy={busy}
          onConfirm={() =>
            pending === 'cancel'
              ? run('Reservation cancelled', () => window.api.reservations.cancel(r.id, reason || null))
              : run('Marked as no-show', () => window.api.reservations.noShow(r.id))
          }
          onCancel={() => setPending(null)}
        />
      )}
    </Modal>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-gray-100 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${strong ? 'border-t border-base-border pt-1.5 font-semibold text-white' : 'text-gray-300'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
