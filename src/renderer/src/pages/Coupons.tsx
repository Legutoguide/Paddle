import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, QrCode, Download, Printer, Ban, Upload, X } from 'lucide-react';
import type { CouponWithDetails, CouponStatus } from '@shared/types/domain';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/lib/settingsContext';
import { ImportCodesModal } from '@/components/ImportCodesModal';
import { QrPreviewModal } from '@/components/QrPreviewModal';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/authContext';

const STATUS_TABS: { label: string; value: CouponStatus | 'ALL' }[] = [
  { label: 'All Codes', value: 'ALL' },
  { label: 'Available', value: 'AVAILABLE' },
  { label: 'Reserved', value: 'RESERVED' },
  { label: 'Used', value: 'USED' },
  { label: 'Expired', value: 'EXPIRED' },
  { label: 'Revoked', value: 'REVOKED' },
];

export default function Coupons() {
  const { formatMoney } = useSettings();
  const { can } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const campaignIdFilter = searchParams.get('campaignId') ? Number(searchParams.get('campaignId')) : undefined;
  const statusFromUrl = searchParams.get('status') as CouponStatus | null;

  const [status, setStatus] = useState<CouponStatus | 'ALL'>(statusFromUrl ?? 'ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<CouponWithDetails[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [qrPreview, setQrPreview] = useState<CouponWithDetails | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ ids: number[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (statusFromUrl && statusFromUrl !== status) {
      setStatus(statusFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFromUrl]);

  const load = useCallback(async () => {
    const result = await window.api.coupons.list({
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
      campaignId: campaignIdFilter,
      limit: 200,
      offset: 0,
    });
    setItems(result.items);
    setTotal(result.total);
    setSelected(new Set());
  }, [status, search, campaignIdFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedItems = useMemo(() => (items ?? []).filter((i) => selected.has(i.id)), [items, selected]);
  const revocableSelected = selectedItems.filter((i) => i.status === 'AVAILABLE' || i.status === 'EXPIRED');
  const nonRevocableCount = selectedItems.length - revocableSelected.length;

  const exportSelectedCsv = async () => {
    try {
      const result = await window.api.importExport.exportCouponsCsv({
        status: status === 'ALL' ? undefined : status,
        search: search || undefined,
        campaignId: campaignIdFilter,
      });
      toast.show('success', `Exported ${result.count} codes to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  const printSelectedPdf = async () => {
    if (selected.size === 0) {
      toast.show('error', 'Select at least one code to print');
      return;
    }
    try {
      const result = await window.api.importExport.exportCouponsPdf(Array.from(selected));
      toast.show('success', `Printable PDF created (${result.count} codes): ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'PDF export failed');
    }
  };

  const doRevoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      const result = await window.api.coupons.revokeMany(revokeTarget.ids, null);
      toast.show(
        'success',
        `${result.revoked.length} code(s) revoked${result.skipped.length > 0 ? `, ${result.skipped.length} skipped (already used or revoked)` : ''}`
      );
      setRevokeTarget(null);
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Header title="QR Codes" subtitle={`${total} total codes${campaignIdFilter ? ' in this campaign' : ''}`} />
      {can('qr.generate') && (
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={() => setShowImport(true)}>
            <Upload size={15} /> Import Codes
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-base-border pb-3">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              status === tab.value ? 'bg-accent/10 text-accent font-medium' : 'text-gray-400 hover:bg-base-surface2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input pl-9"
          placeholder="Search by code, sponsor, campaign…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
          <span className="text-sm text-gray-200">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !py-1.5" onClick={exportSelectedCsv}>
              <Download size={14} /> Export
            </button>
            <button className="btn-secondary !py-1.5" onClick={printSelectedPdf}>
              <Printer size={14} /> Print
            </button>
            <button
              className="btn-danger !py-1.5"
              onClick={() => setRevokeTarget({ ids: Array.from(selected), label: `${selected.size} code(s)` })}
              disabled={revocableSelected.length === 0 || !can('qr.revoke')}
            >
              <Ban size={14} /> Revoke
            </button>
            <button className="btn-ghost !px-2 !py-1.5" onClick={() => setSelected(new Set())}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {selected.size > 0 && nonRevocableCount > 0 && (
        <p className="text-xs text-gray-500">
          {nonRevocableCount} selected coupon(s) cannot be revoked because they are already used or revoked.
        </p>
      )}

      {items === null ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <EmptyState icon={QrCode} title="No coupons found" description="Generate codes from a campaign, or adjust your filters." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Sponsor</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-100">{c.code}</td>
                  <td className="px-4 py-3 text-gray-400">{c.sponsorName}</td>
                  <td className="px-4 py-3 text-gray-400">{c.campaignName}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(c.finalPriceCents)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-500">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button className="btn-ghost !px-2 !py-1.5" title="View QR" onClick={() => setQrPreview(c)}>
                        <QrCode size={15} />
                      </button>
                      {(c.status === 'AVAILABLE' || c.status === 'EXPIRED') && can('qr.revoke') && (
                        <button
                          className="btn-ghost !px-2 !py-1.5 text-danger"
                          title="Revoke"
                          onClick={() => setRevokeTarget({ ids: [c.id], label: c.code })}
                        >
                          <Ban size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qrPreview && <QrPreviewModal coupon={qrPreview} onClose={() => setQrPreview(null)} />}
      {showImport && (
        <ImportCodesModal
          onClose={() => setShowImport(false)}
          onImported={async () => {
            setShowImport(false);
            await load();
          }}
        />
      )}
      {revokeTarget && (
        <ConfirmDialog
          title="Revoke coupon(s)?"
          message={`Revoke ${revokeTarget.label}? Once revoked, ${
            revokeTarget.ids.length > 1 ? 'these codes' : 'this code'
          } can never be used.`}
          danger
          confirmLabel="Revoke"
          busy={busy}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={doRevoke}
        />
      )}
    </div>
  );
}
