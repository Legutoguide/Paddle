import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, Clock, XCircle, Ban, Archive, CircleDot, Lock } from 'lucide-react';
import type { CouponStatus, SponsorStatus, CampaignStatus } from '@shared/types/domain';

type AnyStatus = CouponStatus | SponsorStatus | CampaignStatus;

const CONFIG: Record<AnyStatus, { label: string; className: string; icon: LucideIcon }> = {
  AVAILABLE: { label: 'Available', className: 'bg-success/10 text-success border border-success/30', icon: CheckCircle2 },
  RESERVED: { label: 'Reserved', className: 'bg-warning/10 text-warning border border-warning/30', icon: Lock },
  USED: { label: 'Used', className: 'bg-teal/10 text-teal border border-teal/30', icon: CircleDot },
  EXPIRED: { label: 'Expired', className: 'bg-gray-500/10 text-gray-400 border border-gray-500/30', icon: Clock },
  REVOKED: { label: 'Revoked', className: 'bg-danger/10 text-danger border border-danger/30', icon: Ban },
  ACTIVE: { label: 'Active', className: 'bg-success/10 text-success border border-success/30', icon: CheckCircle2 },
  ARCHIVED: { label: 'Archived', className: 'bg-gray-500/10 text-gray-400 border border-gray-500/30', icon: Archive },
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  const cfg = CONFIG[status] ?? { label: status, className: 'bg-gray-500/10 text-gray-400', icon: XCircle };
  const Icon = cfg.icon;
  return (
    <span className={`badge ${cfg.className}`}>
      <Icon size={13} />
      {cfg.label}
    </span>
  );
}
