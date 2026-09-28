import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Archive } from 'lucide-react';
import type { BatchWithDetails } from '@/types/window';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

export default function Batches() {
  const toast = useToast();
  const [batches, setBatches] = useState<BatchWithDetails[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const list = await window.api.batches.list({ status: showArchived ? 'ARCHIVED' : 'ACTIVE' });
    setBatches(list);
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const archiveBatch = async (id: number) => {
    try {
      await window.api.batches.archive(id);
      toast.show('success', 'Batch archived');
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Failed to archive batch');
    }
  };

  return (
    <div className="space-y-5">
      <Header title="QR Batches" subtitle="Every code-generation event, grouped and tracked" />

      <label className="flex items-center gap-2 text-sm text-gray-400">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      {batches === null ? (
        <PageSpinner />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={showArchived ? 'No archived batches' : 'No batches yet'}
          description={!showArchived ? 'Generating QR codes from a campaign automatically creates a batch record here.' : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Batch</th>
                <th className="px-4 py-3 font-medium">Sponsor</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Quantity</th>
                <th className="px-4 py-3 font-medium">Available</th>
                <th className="px-4 py-3 font-medium">Used</th>
                <th className="px-4 py-3 font-medium">Expired</th>
                <th className="px-4 py-3 font-medium">Revoked</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                  <td className="px-4 py-3 font-mono text-gray-100">{b.batchCode}</td>
                  <td className="px-4 py-3 text-gray-400">{b.sponsorName}</td>
                  <td className="px-4 py-3 text-gray-400">{b.campaignName}</td>
                  <td className="px-4 py-3 text-gray-300">{b.quantity}</td>
                  <td className="px-4 py-3 text-success">{b.available}</td>
                  <td className="px-4 py-3 text-accent">{b.used}</td>
                  <td className="px-4 py-3 text-warning">{b.expired}</td>
                  <td className="px-4 py-3 text-danger">{b.revoked}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/coupons?campaignId=${b.campaignId}`}
                        className="btn-ghost !px-2 !py-1.5 text-xs"
                        title="View codes in this campaign"
                      >
                        View Codes
                      </Link>
                      {b.status === 'ACTIVE' && (
                        <button className="btn-ghost !px-2 !py-1.5" title="Archive batch" onClick={() => archiveBatch(b.id)}>
                          <Archive size={15} />
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
    </div>
  );
}
