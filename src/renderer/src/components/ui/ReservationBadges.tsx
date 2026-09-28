import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2, Clock, XCircle, Ban, CircleDot, Hourglass, LogIn, Play, UserX, Lock, Waves, BadgeCheck, CircleDollarSign,
} from 'lucide-react';
import type { ReservationStatus, ReservationPaymentStatus, SlotStatus } from '@shared/types/domain';

interface Cfg { label: string; className: string; icon: LucideIcon }

const RESERVATION: Record<ReservationStatus, Cfg> = {
  PENDING: { label: 'Pending', className: 'bg-gray-500/10 text-gray-300 border border-gray-500/30', icon: Hourglass },
  CONFIRMED: { label: 'Confirmed', className: 'bg-accent/10 text-cyan border border-cyan/30', icon: CheckCircle2 },
  CHECKED_IN: { label: 'Checked in', className: 'bg-teal/10 text-teal border border-teal/30', icon: LogIn },
  IN_PROGRESS: { label: 'In progress', className: 'bg-warning/10 text-warning border border-warning/30', icon: Play },
  COMPLETED: { label: 'Completed', className: 'bg-success/10 text-success border border-success/30', icon: BadgeCheck },
  CANCELLED: { label: 'Cancelled', className: 'bg-danger/10 text-danger border border-danger/30', icon: XCircle },
  NO_SHOW: { label: 'No-show', className: 'bg-danger/10 text-danger border border-danger/30', icon: UserX },
};

const SLOT: Record<SlotStatus, Cfg> = {
  AVAILABLE: { label: 'Available', className: 'bg-success/10 text-success border border-success/30', icon: CheckCircle2 },
  ALMOST_FULL: { label: 'Almost full', className: 'bg-warning/10 text-warning border border-warning/30', icon: CircleDot },
  FULL: { label: 'Full', className: 'bg-danger/10 text-danger border border-danger/30', icon: Ban },
  CLOSED: { label: 'Closed', className: 'bg-gray-500/10 text-gray-400 border border-gray-500/30', icon: Lock },
  IN_PROGRESS: { label: 'In progress', className: 'bg-cyan/10 text-cyan border border-cyan/30', icon: Waves },
  COMPLETED: { label: 'Completed', className: 'bg-gray-500/10 text-gray-400 border border-gray-500/30', icon: Clock },
};

const PAYMENT: Record<ReservationPaymentStatus, Cfg> = {
  UNPAID: { label: 'Unpaid', className: 'bg-warning/10 text-warning border border-warning/30', icon: CircleDollarSign },
  PAID: { label: 'Paid', className: 'bg-success/10 text-success border border-success/30', icon: BadgeCheck },
  REFUNDED: { label: 'Refunded', className: 'bg-gray-500/10 text-gray-400 border border-gray-500/30', icon: CircleDollarSign },
};

function Badge({ cfg }: { cfg: Cfg }) {
  const Icon = cfg.icon;
  return (
    <span className={`badge ${cfg.className}`}>
      <Icon size={13} />
      {cfg.label}
    </span>
  );
}

export const ReservationStatusBadge = ({ status }: { status: ReservationStatus }) => <Badge cfg={RESERVATION[status]} />;
export const SlotStatusBadge = ({ status }: { status: SlotStatus }) => <Badge cfg={SLOT[status]} />;
export const PaymentBadge = ({ status }: { status: ReservationPaymentStatus }) => <Badge cfg={PAYMENT[status]} />;

/** Tailwind classes used to colour calendar cells / slot tiles by status. */
export const SLOT_TILE: Record<SlotStatus, string> = {
  AVAILABLE: 'border-success/40 bg-success/5 hover:bg-success/10',
  ALMOST_FULL: 'border-warning/40 bg-warning/5 hover:bg-warning/10',
  FULL: 'border-danger/40 bg-danger/5 opacity-70',
  CLOSED: 'border-base-border bg-base-surface2/40 opacity-60',
  IN_PROGRESS: 'border-cyan/40 bg-cyan/5 hover:bg-cyan/10',
  COMPLETED: 'border-base-border bg-base-surface2/40 opacity-60',
};
