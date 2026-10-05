import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, QrCode, Download, Plus } from 'lucide-react';
import type { Campaign } from '@shared/types/domain';
import type { Branch } from '@/types/window';
import { PageSpinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/lib/settingsContext';
import { useAuth } from '@/lib/authContext';

interface CampaignStats {
  totalCodes: number;
  available: number;
  used: number;
  expired: number;
  revoked: number;
}

export default function CampaignDetail() {
  const { id } = useParams();
  const campaignId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { formatMoney } = useSettings();
  const { can } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [sponsorName, setSponsorName] = useState('');
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const load = useCallback(async () => {
    const [campaigns, s] = await Promise.all([
      window.api.campaigns.list({}),
      window.api.campaigns.stats(campaignId),
    ]);
    const found = campaigns.find((c) => c.id === campaignId) ?? null;
    setCampaign(found);
    setStats(s);
    if (found) {
      const sponsors = await window.api.sponsors.list({});
      setSponsorName(sponsors.find((sp) => sp.id === found.sponsorId)?.name ?? '');
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const result = await window.api.importExport.exportCouponsCsv({ campaignId });
      toast.show('success', `Exported ${result.count} codes to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  if (!campaign || !stats) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200">
        <ArrowLeft size={15} /> Back to Campaigns
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-100">{campaign.campaignName}</h1>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-sm text-gray-500">
            {sponsorName} · {campaign.serviceName}
            {campaign.duration ? ` (${campaign.duration})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {can('export.use') && (
            <button className="btn-secondary" onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </button>
          )}
          {can('qr.generate') && (
            <button className="btn-primary" onClick={() => setShowGenerate(true)}>
              <Plus size={15} /> Generate Codes
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-8">
        <StatBox label="Original Price" value={formatMoney(campaign.originalPriceCents)} muted />
        <StatBox label="Discount" value={`${campaign.discountPercentage}%`} accent />
        <StatBox label="Final Price" value={formatMoney(campaign.finalPriceCents)} accent />
        <StatBox label="Coverage" value={`${campaign.coveragePlayers} player${campaign.coveragePlayers > 1 ? 's' : ''}`} />
        <StatBox label="Total Codes" value={String(stats.totalCodes)} />
        <StatBox label="Available" value={String(stats.available)} tone="success" />
        <StatBox label="Used" value={String(stats.used)} tone="teal" />
        <StatBox label="Revoked" value={String(stats.revoked)} tone="danger" />
      </div>

      {(campaign.startDate || campaign.endDate) && (
        <p className="text-sm text-gray-500">
          Valid: {campaign.startDate ?? '—'} to {campaign.endDate ?? '—'}
        </p>
      )}

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-400">
          <QrCode size={16} />
          <span>
            View, print and manage every generated code for this campaign in{' '}
            <Link
              to={`/coupons?campaignId=${campaignId}`}
              className="text-accent hover:underline"
              onClick={() => navigate(`/coupons?campaignId=${campaignId}`)}
            >
              QR Codes
            </Link>
            .
          </span>
        </div>
      </div>

      {showGenerate && (
        <GenerateCodesModal
          campaign={campaign}
          onClose={() => setShowGenerate(false)}
          onGenerated={async () => {
            setShowGenerate(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
  accent,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'teal' | 'danger';
  accent?: boolean;
  muted?: boolean;
}) {
  const cls = tone === 'success' ? 'text-success' : tone === 'teal' ? 'text-teal' : tone === 'danger' ? 'text-danger' : accent ? 'text-accent' : muted ? 'text-gray-500' : 'text-gray-100';
  return (
    <div className="card p-3.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-1 text-base font-semibold ${cls} ${muted ? 'line-through font-normal' : ''}`}>{value}</p>
    </div>
  );
}

function GenerateCodesModal({
  campaign,
  onClose,
  onGenerated,
}: {
  campaign: Campaign;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const toast = useToast();
  const [count, setCount] = useState('10');
  const [prefix, setPrefix] = useState(campaign.campaignName.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const [expiresAt, setExpiresAt] = useState(campaign.endDate ?? '');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.branches.list().then(setBranches);
  }, []);

  const submit = async () => {
    setError(null);
    const n = Number(count);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Number of codes must be a positive integer');
      return;
    }
    setSaving(true);
    try {
      const generated = await window.api.coupons.generate({
        campaignId: campaign.id,
        count: n,
        prefix: prefix.trim() || undefined,
        expiresAt: expiresAt || null,
        branchId: branchId || null,
      });
      toast.show('success', `${generated.length} unique codes created successfully.`);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the coupons. No changes were saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create Codes & QR Codes" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Number of Codes</label>
          <input className="input" type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div>
          <label className="label">Code Prefix (optional)</label>
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={12} />
        </div>
        <div>
          <label className="label">Expiration (optional)</label>
          <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        {branches.length > 0 && (
          <div>
            <label className="label">Branch (optional)</label>
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Generating…' : `Generate ${count} Codes`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
