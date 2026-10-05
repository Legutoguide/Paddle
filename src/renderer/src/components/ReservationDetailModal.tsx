import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, Play, BadgeCheck, XCircle, UserX, CreditCard, Ticket, Unlink, Users } from 'lucide-react';
import type { ReservationWithDetails, ReservationHistoryEntry, ReservationPriceBreakdown, ReservationParticipant } from '@shared/types/domain';
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
  const [breakdown, setBreakdown] = useState<ReservationPriceBreakdown | null>(null);
  const [participants, setParticipants] = useState<ReservationParticipant[]>([]);
  const [history, setHistory] = useState<ReservationHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponParticipantId, setCouponParticipantId] = useState<number | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);

  const load = useCallback(async () => {
    const [res, bd, hist, parts] = await Promise.all([
      window.api.reservations.get(reservationId),
      window.api.reservations.priceBreakdown(reservationId),
      window.api.reservations.history(reservationId),
      window.api.reservations.listParticipants(reservationId),
    ]);
    setR(res);
    setBreakdown(bd);
    setHistory(hist);
    setParticipants(parts);
    if (parts.length > 0) setShowParticipants(true);
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
        </div>

        {/* Price breakdown — Players, subtotal, one line per coupon, total discount, final total */}
        {breakdown && (
          <div className="rounded-lg border border-base-border bg-base-surface2/50 p-3">
            <Row label={`Subtotal (${breakdown.players} × ${formatMoney(breakdown.pricePerPlayerCents)})`} value={formatMoney(breakdown.subtotalCents)} />
            {breakdown.coupons.map((c) => (
              <div key={c.couponId} className="flex items-start justify-between gap-2 border-t border-base-border/60 py-1.5 text-xs">
                <div>
                  <p className="font-mono text-cyan">{c.couponCode}{c.participantName ? ` · ${c.participantName}` : ''}</p>
                  <p className="text-gray-500">{c.sponsorName} — covers {c.coverageConsumed} player{c.coverageConsumed > 1 ? 's' : ''} · eligible {formatMoney(c.eligibleAmountCents)}</p>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-danger">− {formatMoney(c.discountCents)}</span>
                  {active && !paid && can('reservations.edit') && (
                    <button className="text-gray-500 hover:text-danger" title="Remove this coupon" disabled={busy} onClick={() => run('Coupon removed', () => window.api.reservations.detachCoupon(r.id, c.couponId))}>
                      <Unlink size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {breakdown.totalDiscountCents > 0 && (
              <Row label="Total discount" value={`− ${formatMoney(breakdown.totalDiscountCents)}`} />
            )}
            <Row label="Final Total" value={formatMoney(breakdown.finalPriceCents)} strong />
          </div>
        )}

        {r.notes && <p className="rounded-lg bg-base-surface2/50 p-3 text-gray-300">{r.notes}</p>}
        {r.cancelReason && <p className="text-xs text-gray-500">Reason: {r.cancelReason}</p>}

        {active && !paid && can('reservations.edit') && breakdown && breakdown.uncoveredPlayers > 0 && (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label">Attach a coupon ({breakdown.uncoveredPlayers} player{breakdown.uncoveredPlayers > 1 ? 's' : ''} not yet covered)</label>
                <input className="input font-mono" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="e.g. SPONSOR-AB123" />
              </div>
              {participants.length > 0 && (
                <select className="input w-auto" value={couponParticipantId ?? ''} onChange={(e) => setCouponParticipantId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Whole booking</option>
                  {participants.filter((p) => p.name).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <button
                className="btn-secondary"
                disabled={busy || !couponCode.trim()}
                onClick={() =>
                  run('Coupon reserved for this booking', () =>
                    window.api.reservations.attachCoupon(r.id, couponCode.trim(), couponParticipantId ? { participantId: couponParticipantId } : undefined)
                  ).then(() => setCouponCode(''))
                }
              >
                <Ticket size={15} /> Attach
              </button>
            </div>
          </div>
        )}

        {/* Optional participant names — never required (Part 5/11) */}
        <div>
          <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200" onClick={() => setShowParticipants((v) => !v)}>
            <Users size={13} /> Participant details {participants.some((p) => p.name) ? `(${participants.filter((p) => p.name).length}/${r.players} named)` : '(optional)'}
          </button>
          {showParticipants && (
            <ParticipantEditor
              reservationId={r.id}
              players={r.players}
              participants={participants}
              editable={active && can('reservations.edit')}
              onSaved={load}
            />
          )}
        </div>

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
            breakdown && breakdown.coupons.length > 0
              ? `Records payment of ${formatMoney(breakdown.finalPriceCents)}. ${breakdown.coupons.length > 1 ? 'The reserved coupons' : 'The reserved coupon'} ${breakdown.coupons.map((c) => c.couponCode).join(', ')} will be marked as used automatically — no extra step.`
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

/** Optional, collapsible participant names (Part 5/11 of the spec) — a
 * reservation works identically whether zero, some, or all players are
 * named. Never forces staff to fill every slot. */
function ParticipantEditor({
  reservationId,
  players,
  participants,
  editable,
  onSaved,
}: {
  reservationId: number;
  players: number;
  participants: ReservationParticipant[];
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [names, setNames] = useState<string[]>(
    Array.from({ length: players }, (_, i) => participants[i]?.name ?? '')
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await window.api.reservations.setParticipants(reservationId, names.map((n) => n.trim() || null));
      toast.show('success', 'Participant details saved');
      onSaved();
    } catch (e) {
      toast.show('error', e instanceof Error ? e.message : 'Could not save participants');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-base-border bg-base-surface2/40 p-3">
      {names.map((name, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-gray-500">Player {i + 1}</span>
          <input
            className="input !py-1 text-sm"
            placeholder="Name (optional)"
            value={name}
            disabled={!editable}
            onChange={(e) => setNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
          />
        </div>
      ))}
      {editable && (
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy} onClick={save}>
          Save names
        </button>
      )}
    </div>
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
