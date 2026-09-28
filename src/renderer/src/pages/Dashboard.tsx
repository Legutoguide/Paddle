import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Megaphone,
  QrCode,
  Gift,
  ScanLine,
  Download,
  Printer,
  UserPlus,
  Clock,
  CheckCircle2,
  Ban,
  ArrowUpRight,
  TrendingUp,
  Sparkles,
  Wallet,
  Percent,
  Award,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardStats, CouponWithDetails, AuditLogEntry, UsageHistoryEntry } from '@shared/types/domain';
import { PageSpinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Header } from '@/components/Header';
import { useSettings } from '@/lib/settingsContext';
import { ReservationDashboard } from '@/components/ReservationDashboard';

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  delta,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  sublabel: string;
  delta?: string;
  tint: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3.5">
        <div className={`icon-tile ${tint}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{label}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-white">{value}</p>
            {delta && (
              <span className="flex items-center gap-0.5 text-xs font-medium text-success">
                <ArrowUpRight size={12} /> {delta}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500">{sublabel}</p>
        </div>
      </div>
    </div>
  );
}

const QUICK_ACTIONS = [
  { to: '/sponsors', label: 'Create Sponsor', icon: UserPlus, tint: 'from-accent to-accent-dim' },
  { to: '/campaigns', label: 'Create Campaign', icon: Megaphone, tint: 'from-teal to-emerald-600' },
  { to: '/coupons', label: 'Generate QR Codes', icon: QrCode, tint: 'from-purple to-fuchsia-700' },
  { to: '/scan', label: 'Scan QR Code', icon: ScanLine, tint: 'from-orange-500 to-amber-600' },
  { to: '/exports', label: 'Export Codes', icon: Download, tint: 'from-cyan to-sky-600' },
  { to: '/coupons', label: 'Print QR Codes', icon: Printer, tint: 'from-pink to-rose-600' },
];

export default function Dashboard() {
  const { formatMoney, settings } = useSettings();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [sponsorPerf, setSponsorPerf] = useState<{ sponsorId: number; sponsorName: string; used: number; total: number }[]>([]);
  const [recentCoupons, setRecentCoupons] = useState<CouponWithDetails[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [recentHistory, setRecentHistory] = useState<UsageHistoryEntry[]>([]);

  useEffect(() => {
    Promise.all([
      window.api.dashboard.stats(),
      window.api.dashboard.sponsorPerformance(),
      window.api.coupons.list({ limit: 5, offset: 0 }),
      window.api.audit.list(5),
      window.api.history.list({ limit: 200 }),
    ]).then(([s, p, c, a, h]) => {
      setStats(s);
      setSponsorPerf(p);
      setRecentCoupons(c.items);
      setRecentActivity(a);
      setRecentHistory(h.items);
    });
  }, []);

  const quickStats = useMemo(() => {
    if (recentHistory.length === 0) return null;
    const totalRevenueCents = recentHistory.reduce((sum, h) => sum + h.finalPriceCents, 0);
    const avgDiscount = recentHistory.reduce((sum, h) => sum + h.discountPercentage, 0) / recentHistory.length;
    const byCampaign = new Map<string, number>();
    for (const h of recentHistory) byCampaign.set(h.campaignName, (byCampaign.get(h.campaignName) ?? 0) + 1);
    const topCampaign = [...byCampaign.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      totalRevenueCents,
      avgDiscount: Math.round(avgDiscount),
      topCampaign: topCampaign ? topCampaign[0] : '—',
    };
  }, [recentHistory]);

  if (!stats) return <PageSpinner />;

  const total = stats.totalCodes || 1;

  return (
    <div>
      <Header title="Dashboard" subtitle="Welcome back! Here's what's happening today on the water." />

      <ReservationDashboard />

      {/* Hero / promotional banner */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-base-border bg-gradient-to-r from-[#0d3a5c] via-[#0e4a6e] to-[#0a6b6b] p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_30%,rgba(34,211,238,0.25),transparent_55%)]" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold leading-tight text-white">
              Paddle. Explore.
              <br />
              <span className="text-cyan">Repeat.</span>
            </p>
            <p className="mt-2 text-sm text-cyan-100/80">Book the board. Scan your sponsor coupon. Enjoy the water.</p>
          </div>
          <div className="hidden items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-5 py-3 backdrop-blur-sm md:flex">
            <Gift className="text-white" size={22} />
            <div>
              <p className="text-xs text-white/80">{settings.businessName}</p>
              <p className="text-sm font-semibold text-white">Powered by Prime Paddle</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Sponsors" value={stats.totalSponsors} sublabel="Active sponsors" tint="bg-accent/15 text-accent" />
        <StatCard icon={Megaphone} label="Total Campaigns" value={stats.totalCampaigns} sublabel="Running campaigns" tint="bg-teal/15 text-teal" />
        <StatCard icon={QrCode} label="Total QR Codes" value={stats.totalCodes} sublabel="Generated codes" tint="bg-purple/15 text-purple" />
        <StatCard icon={Gift} label="Total Uses" value={stats.used} sublabel="Redeemed coupons" tint="bg-orange-500/15 text-orange-400" />
      </div>

      {/* Status breakdown */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Available" value={stats.available} sublabel={`${Math.round((stats.available / total) * 100)}% of total`} tint="bg-success/15 text-success" />
        <StatCard icon={TrendingUp} label="Used" value={stats.used} sublabel={`${stats.usageRateSincePercent}% usage rate`} tint="bg-accent/15 text-accent" />
        <StatCard icon={Clock} label="Expired" value={stats.expired} sublabel={`${Math.round((stats.expired / total) * 100)}% of total`} tint="bg-warning/15 text-warning" />
        <StatCard icon={Ban} label="Revoked" value={stats.revoked} sublabel={`${Math.round((stats.revoked / total) * 100)}% of total`} tint="bg-danger/15 text-danger" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Activity */}
        <div className="card p-5 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p className="text-xs text-gray-500">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Sparkles size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-200">{a.action.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-gray-500">{new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card p-5 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_ACTIONS.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className={`flex flex-col items-start gap-2 rounded-xl bg-gradient-to-br ${a.tint} p-3 text-white transition-transform hover:scale-[1.02]`}
              >
                <a.icon size={18} />
                <span className="text-xs font-medium leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Top Sponsors */}
        <div className="card p-5 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">Top Sponsors</h2>
            <Link to="/sponsors" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          {sponsorPerf.length === 0 ? (
            <p className="text-xs text-gray-500">No sponsors yet.</p>
          ) : (
            <div className="space-y-4">
              {sponsorPerf.slice(0, 3).map((s, idx) => {
                const pct = s.total > 0 ? Math.round((s.used / s.total) * 100) : 0;
                const colors = ['from-accent to-cyan', 'from-teal to-emerald-500', 'from-purple to-fuchsia-500'];
                return (
                  <Link key={s.sponsorId} to={`/sponsors/${s.sponsorId}`} className="block">
                    <div className="mb-1.5 flex items-center gap-2.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${colors[idx % 3]} text-xs font-bold text-white`}>
                        {s.sponsorName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-200">{s.sponsorName}</p>
                        <p className="text-[10px] text-gray-500">{s.used} uses</p>
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {s.used}/{s.total}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-surface2">
                      <div className={`h-full rounded-full bg-gradient-to-r ${colors[idx % 3]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent QR Codes */}
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">Recent QR Codes</h2>
            <Link to="/coupons" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          {recentCoupons.length === 0 ? (
            <p className="text-xs text-gray-500">No codes generated yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {recentCoupons.map((c) => (
                <div key={c.id} className="rounded-xl border border-base-border bg-base-surface2/50 p-3 text-center">
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-white">
                    <QrCode size={28} className="text-black" />
                  </div>
                  <p className="truncate font-mono text-[11px] text-gray-300">{c.code}</p>
                  <div className="mt-1 flex justify-center">
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scan & Validate quick widget */}
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Scan &amp; Validate</h2>
          <Link
            to="/scan"
            className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-base-border bg-base-surface2/40 py-8 transition-colors hover:border-accent-dim hover:bg-base-surface2/70"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <ScanLine size={26} />
            </div>
            <span className="text-xs text-gray-400">Scan a QR code or enter code manually</span>
            <span className="btn-primary !py-1.5 !px-4 !text-xs">Open Scanner</span>
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      {quickStats && (
        <div className="mt-4 card p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Quick Stats</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-3">
              <div className="icon-tile bg-accent/15 text-accent">
                <Wallet size={18} />
              </div>
              <div>
                <p className="text-[11px] text-gray-500">Total Revenue (redeemed)</p>
                <p className="text-base font-semibold text-white">{formatMoney(quickStats.totalRevenueCents)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="icon-tile bg-warning/15 text-warning">
                <Percent size={18} />
              </div>
              <div>
                <p className="text-[11px] text-gray-500">Avg. Discount (redeemed)</p>
                <p className="text-base font-semibold text-white">{quickStats.avgDiscount}%</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="icon-tile bg-purple/15 text-purple">
                <Award size={18} />
              </div>
              <div>
                <p className="text-[11px] text-gray-500">Most Popular Campaign</p>
                <p className="truncate text-base font-semibold text-white">{quickStats.topCampaign}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
