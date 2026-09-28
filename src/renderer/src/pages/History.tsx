import { useEffect, useState, useCallback } from 'react';
import { Search, Download, History as HistoryIcon } from 'lucide-react';
import type { UsageHistoryEntry, Sponsor } from '@shared/types/domain';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useSettings } from '@/lib/settingsContext';
import { useToast } from '@/components/ui/Toast';
import { Header } from '@/components/Header';

const DATE_PRESETS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
] as const;

function presetToRange(preset: string): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();

  switch (preset) {
    case 'today':
      return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { dateFrom: startOfDay(y), dateTo: endOfDay(y) };
    }
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      return { dateFrom: startOfDay(start), dateTo: endOfDay(now) };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: startOfDay(start), dateTo: endOfDay(now) };
    }
    default:
      return {};
  }
}

export default function History() {
  const { formatMoney } = useSettings();
  const toast = useToast();
  const [entries, setEntries] = useState<UsageHistoryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<string>('all');
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sponsorId, setSponsorId] = useState<number | ''>('');

  const load = useCallback(async () => {
    const range = presetToRange(datePreset);
    const result = await window.api.history.list({
      search: search || undefined,
      sponsorId: sponsorId || undefined,
      ...range,
      limit: 200,
      offset: 0,
    });
    setEntries(result.items);
    setTotal(result.total);
  }, [search, datePreset, sponsorId]);

  useEffect(() => {
    window.api.sponsors.list({}).then(setSponsors);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const range = presetToRange(datePreset);
      const result = await window.api.history.exportCsv({
        search: search || undefined,
        sponsorId: sponsorId || undefined,
        ...range,
      });
      toast.show('success', `Exported ${result.count} records to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <div className="space-y-5">
      <Header title="Usage History" subtitle={`${total} coupon redemptions recorded`} />
      <div className="flex justify-end">
        <button className="btn-secondary" onClick={exportCsv}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input pl-9" placeholder="Search code, sponsor, campaign…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={sponsorId} onChange={(e) => setSponsorId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All sponsors</option>
          {sponsors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDatePreset(p.value)}
              className={`rounded-lg px-2.5 py-1.5 text-xs ${
                datePreset === p.value ? 'bg-accent/10 text-accent font-medium' : 'text-gray-400 hover:bg-base-surface2'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {entries === null ? (
        <PageSpinner />
      ) : entries.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No history yet" description="Redeemed coupons will appear here." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Sponsor</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Original</th>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium">Final</th>
                <th className="px-4 py-3 font-medium">Used At</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((h) => (
                <tr key={h.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                  <td className="px-4 py-3 font-mono text-gray-100">{h.code}</td>
                  <td className="px-4 py-3 text-gray-400">{h.sponsorName}</td>
                  <td className="px-4 py-3 text-gray-400">{h.campaignName}</td>
                  <td className="px-4 py-3 text-gray-500 line-through">{formatMoney(h.originalPriceCents)}</td>
                  <td className="px-4 py-3 text-accent">{h.discountPercentage}%</td>
                  <td className="px-4 py-3 text-gray-100 font-medium">{formatMoney(h.finalPriceCents)}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(h.usedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
