import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Megaphone, Plus } from 'lucide-react';
import type { Sponsor, Campaign } from '@shared/types/domain';
import { PageSpinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSettings } from '@/lib/settingsContext';

interface SponsorStats {
  totalCampaigns: number;
  totalCodes: number;
  available: number;
  used: number;
  expired: number;
  revoked: number;
  usageRatePercent: number;
}

export default function SponsorDetail() {
  const { id } = useParams();
  const sponsorId = Number(id);
  const { formatMoney } = useSettings();
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [stats, setStats] = useState<SponsorStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const load = useCallback(async () => {
    const [sponsorList, s, c] = await Promise.all([
      window.api.sponsors.list({}),
      window.api.sponsors.stats(sponsorId),
      window.api.campaigns.list({ sponsorId }),
    ]);
    setSponsor(sponsorList.find((sp) => sp.id === sponsorId) ?? null);
    setStats(s);
    setCampaigns(c);
  }, [sponsorId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sponsor || !stats) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <Link to="/sponsors" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200">
        <ArrowLeft size={15} /> Back to Sponsors
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">{sponsor.name}</h1>
          {sponsor.notes && <p className="text-sm text-gray-500">{sponsor.notes}</p>}
        </div>
        <Link to="/campaigns" state={{ prefillSponsorId: sponsorId }} className="btn-primary">
          <Plus size={16} /> New Campaign
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <StatBox label="Campaigns" value={stats.totalCampaigns} />
        <StatBox label="Total Codes" value={stats.totalCodes} />
        <StatBox label="Available" value={stats.available} tone="success" />
        <StatBox label="Used" value={stats.used} tone="teal" />
        <StatBox label="Expired" value={stats.expired} />
        <StatBox label="Revoked" value={stats.revoked} tone="danger" />
      </div>

      <div className="card p-5">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-gray-400">Usage Rate</span>
          <span className="font-medium text-gray-200">{stats.usageRatePercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-base-surface2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${stats.usageRatePercent}%` }} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-200">Campaigns</h2>
        {campaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create a campaign for this sponsor to start generating coupons." />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Codes</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                    <td className="px-4 py-3">
                      <Link to={`/campaigns/${c.id}`} className="font-medium text-gray-100 hover:text-accent">
                        {c.campaignName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{c.serviceName}</td>
                    <td className="px-4 py-3 text-gray-300">
                      <span className="text-gray-500 line-through mr-1.5">{formatMoney(c.originalPriceCents)}</span>
                      {formatMoney(c.finalPriceCents)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{c.totalCodes}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'teal' | 'danger' }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'teal' ? 'text-teal' : tone === 'danger' ? 'text-danger' : 'text-gray-100';
  return (
    <div className="card p-3.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
