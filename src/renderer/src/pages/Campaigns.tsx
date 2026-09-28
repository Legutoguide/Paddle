import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Megaphone, Archive, ArchiveRestore } from 'lucide-react';
import type { Campaign, Sponsor } from '@shared/types/domain';
import type { PriceBreakdown } from '@shared/lib/pricing';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/lib/settingsContext';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/authContext';

export default function Campaigns() {
  const { formatMoney } = useSettings();
  const { can } = useAuth();
  const toast = useToast();
  const location = useLocation() as { state?: { prefillSponsorId?: number } };
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [showCreate, setShowCreate] = useState(!!location.state?.prefillSponsorId);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      window.api.campaigns.list({ status: showArchived ? 'ARCHIVED' : 'ACTIVE' }),
      window.api.sponsors.list({ status: 'ACTIVE' }),
    ]);
    setCampaigns(c);
    setSponsors(s);
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleArchive = async (c: Campaign) => {
    try {
      if (c.status === 'ACTIVE') {
        await window.api.campaigns.archive(c.id);
        toast.show('success', `${c.campaignName} archived`);
      } else {
        await window.api.campaigns.unarchive(c.id);
        toast.show('success', `${c.campaignName} restored`);
      }
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Action failed');
    }
  };

  return (
    <div className="space-y-5">
      <Header title="Campaigns" subtitle="Set pricing, discounts and generate coupon codes" />
      {can('campaigns.create') && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)} disabled={sponsors.length === 0}>
            <Plus size={16} /> New Campaign
          </button>
        </div>
      )}

      {sponsors.length === 0 && campaigns?.length === 0 && (
        <p className="text-sm text-gray-500">
          Create a sponsor first from the <Link to="/sponsors" className="text-accent hover:underline">Sponsors</Link> page.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-400">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      {campaigns === null ? (
        <PageSpinner />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={showArchived ? 'No archived campaigns' : 'No campaigns yet'}
          description={!showArchived ? 'Create a campaign to define pricing and generate coupon codes.' : undefined}
          action={
            !showArchived &&
            sponsors.length > 0 && (
              <button className="btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Create Campaign
              </button>
            )
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Original</th>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium">Final</th>
                <th className="px-4 py-3 font-medium">Codes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
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
                  <td className="px-4 py-3 text-gray-500 line-through">{formatMoney(c.originalPriceCents)}</td>
                  <td className="px-4 py-3 text-accent">{c.discountPercentage}%</td>
                  <td className="px-4 py-3 text-gray-100 font-medium">{formatMoney(c.finalPriceCents)}</td>
                  <td className="px-4 py-3 text-gray-400">{c.totalCodes}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {can('campaigns.archive') && (
                      <button className="btn-ghost !px-2 !py-1.5" onClick={() => toggleArchive(c)}>
                        {c.status === 'ACTIVE' ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateCampaignWizard
          sponsors={sponsors}
          initialSponsorId={location.state?.prefillSponsorId}
          onClose={() => setShowCreate(false)}
          onDone={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

type WizardStep = 'FORM' | 'CONFIRM' | 'SUCCESS';

function CreateCampaignWizard({
  sponsors,
  initialSponsorId,
  onClose,
  onDone,
}: {
  sponsors: Sponsor[];
  initialSponsorId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { formatMoney } = useSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('FORM');
  const [sponsorId, setSponsorId] = useState<number | ''>(initialSponsorId ?? '');
  const [campaignName, setCampaignName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [duration, setDuration] = useState('');
  const [originalPrice, setOriginalPrice] = useState<string>('');
  const [discountPercentage, setDiscountPercentage] = useState<string>('');
  const [numberOfCodes, setNumberOfCodes] = useState<string>('10');
  const [prefix, setPrefix] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  const priceNum = Number(originalPrice) || 0;
  const discountNum = Number(discountPercentage) || 0;

  useEffect(() => {
    if (priceNum <= 0) {
      setBreakdown(null);
      return;
    }
    window.api.campaigns
      .previewPrice({ originalPrice: priceNum, discountType: 'PERCENTAGE', discountPercentage: discountNum })
      .then(setBreakdown)
      .catch(() => setBreakdown(null));
  }, [priceNum, discountNum]);

  const validateForm = (): string | null => {
    if (!sponsorId) return 'Please select a sponsor';
    if (!campaignName.trim()) return 'Campaign name is required';
    if (!serviceName.trim()) return 'Service/duration is required';
    if (priceNum < 0) return 'Original price must be zero or greater';
    if (discountNum < 0 || discountNum > 100) return 'Discount must be between 0 and 100';
    const count = Number(numberOfCodes);
    if (!Number.isInteger(count) || count <= 0) return 'Number of codes must be a positive integer';
    if (count > 5000) return 'For batches over 5000, generate codes in smaller groups';
    if (startDate && endDate && startDate > endDate) return 'Start date must be before end date';
    return null;
  };

  const goToConfirm = () => {
    const err = validateForm();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep('CONFIRM');
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const campaign = await window.api.campaigns.create({
        sponsorId: sponsorId as number,
        campaignName: campaignName.trim(),
        serviceName: serviceName.trim(),
        duration: duration.trim() || null,
        discountType: 'PERCENTAGE',
        originalPrice: priceNum,
        discountPercentage: discountNum,
        imagePath,
        bannerPath,
        startDate: startDate || null,
        endDate: endDate || null,
      });

      const count = Number(numberOfCodes);
      const generated = await window.api.coupons.generate({
        campaignId: campaign.id,
        count,
        prefix: prefix.trim() || campaign.campaignName.slice(0, 8),
        expiresAt: endDate || null,
      });

      setCreatedCampaignId(campaign.id);
      setCreatedCount(generated.length);
      setStep('SUCCESS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the campaign. No changes were saved.');
      setStep('FORM');
    } finally {
      setSaving(false);
    }
  };

  if (step === 'SUCCESS' && createdCampaignId) {
    return (
      <Modal title="Success" onClose={onDone}>
        <div className="text-center py-4">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <Megaphone size={22} />
          </div>
          <p className="text-base font-medium text-gray-100">{createdCount} unique codes created successfully.</p>
          <p className="mt-1 text-sm text-gray-500">Campaign "{campaignName}" is ready to use.</p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                navigate(`/campaigns/${createdCampaignId}`);
                onDone();
              }}
            >
              View Codes
            </button>
            <button className="btn-primary" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'CONFIRM') {
    return (
      <Modal title="Confirm Campaign" onClose={onClose}>
        <div className="space-y-3 text-sm">
          <Row label="Sponsor" value={sponsors.find((s) => s.id === sponsorId)?.name ?? ''} />
          <Row label="Campaign" value={campaignName} />
          <Row label="Service" value={`${serviceName}${duration ? ` (${duration})` : ''}`} />
          <Row label="Original Price" value={formatMoney((breakdown?.originalPriceCents ?? 0))} />
          <Row label="Discount" value={`${discountNum}%`} />
          <Row label="You Save" value={formatMoney(breakdown?.youSaveCents ?? 0)} highlight />
          <Row label="Final Price" value={formatMoney(breakdown?.finalPriceCents ?? 0)} highlight />
          <Row label="Number of Codes" value={numberOfCodes} />
          {(startDate || endDate) && <Row label="Valid" value={`${startDate || '—'} to ${endDate || '—'}`} />}
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setStep('FORM')} disabled={saving}>
            Back
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Generating…' : `Generate ${numberOfCodes} Codes`}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New Campaign" onClose={onClose} width="max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Sponsor</label>
          <select className="input" value={sponsorId} onChange={(e) => setSponsorId(Number(e.target.value))}>
            <option value="">Select a sponsor…</option>
            {sponsors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Campaign Name</label>
          <input className="input" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Summer Promotion" />
        </div>
        <div>
          <label className="label">Service</label>
          <input className="input" value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="e.g. 1 Hour" />
        </div>
        <div>
          <label className="label">Duration (optional)</label>
          <input className="input" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 1 Hour" />
        </div>
        <div>
          <label className="label">Original Price</label>
          <input className="input" type="number" min="0" step="0.01" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} placeholder="100" />
        </div>
        <div>
          <label className="label">Discount %</label>
          <input className="input" type="number" min="0" max="100" value={discountPercentage} onChange={(e) => setDiscountPercentage(e.target.value)} placeholder="50" />
        </div>

        {breakdown && (
          <div className="col-span-2 rounded-lg border border-base-border bg-base-surface2/60 p-3 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Original Price</span>
              <span>{formatMoney(breakdown.originalPriceCents)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Discount</span>
              <span>{discountNum}%</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>You Save</span>
              <span className="text-accent">{formatMoney(breakdown.youSaveCents)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-base-border pt-1 font-semibold text-gray-100">
              <span>Final Price</span>
              <span>{formatMoney(breakdown.finalPriceCents)}</span>
            </div>
          </div>
        )}

        <div>
          <label className="label">Number of Codes</label>
          <input className="input" type="number" min="1" value={numberOfCodes} onChange={(e) => setNumberOfCodes(e.target.value)} />
        </div>
        <div>
          <label className="label">Code Prefix (optional)</label>
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. ADAM" maxLength={12} />
        </div>
        <div>
          <label className="label">Start Date (optional)</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">End Date / Expiration (optional)</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div>
          <label className="label">Campaign Image (shown on printed QR cards)</label>
          <div className="flex items-center gap-2">
            {imagePath ? (
              <img src={`file://${imagePath}`} alt="" className="h-10 w-10 rounded-md object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-surface2 text-xs text-gray-600">—</div>
            )}
            <button
              type="button"
              className="btn-secondary !py-1.5 text-xs"
              onClick={async () => {
                const file = await window.api.settings.pickImage();
                if (file) setImagePath(file);
              }}
            >
              Choose
            </button>
          </div>
        </div>
        <div>
          <label className="label">Banner Image (optional)</label>
          <div className="flex items-center gap-2">
            {bannerPath ? (
              <img src={`file://${bannerPath}`} alt="" className="h-10 w-10 rounded-md object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-surface2 text-xs text-gray-600">—</div>
            )}
            <button
              type="button"
              className="btn-secondary !py-1.5 text-xs"
              onClick={async () => {
                const file = await window.api.settings.pickImage();
                if (file) setBannerPath(file);
              }}
            >
              Choose
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={goToConfirm}>
          Continue
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between border-b border-base-border/60 pb-2 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? 'font-semibold text-accent' : 'text-gray-200'}>{value}</span>
    </div>
  );
}
