import type Database from 'better-sqlite3';
import type { DashboardStats } from '../../shared/types/domain';

export interface ReportData {
  dateFrom: string | null;
  dateTo: string | null;
  totalGenerated: number;
  totalAvailable: number;
  totalUsed: number;
  totalExpired: number;
  totalRevoked: number;
  redemptionRatePercent: number;
  usageInRange: number;
  estimatedRevenueCents: number;
  totalDiscountGivenCents: number;
  avgDiscountPercent: number;
  sponsorPerformance: {
    sponsorId: number;
    sponsorName: string;
    used: number;
    total: number;
    revenueCents: number;
  }[];
  campaignPerformance: {
    campaignId: number;
    campaignName: string;
    sponsorName: string;
    used: number;
    total: number;
    revenueCents: number;
  }[];
  dailyUsage: { date: string; count: number; revenueCents: number }[];
}

export class StatsService {
  constructor(private db: Database.Database) {}

  /**
   * Comprehensive report data for the Reports screen. Coupon totals are
   * always current-state snapshots (a coupon generated last month but
   * redeemed today still counts toward "total used" regardless of date
   * range); revenue/discount/usage figures are filtered to the requested
   * date range, since those describe activity that happened in that window.
   * Every number here comes from real stored data — nothing is estimated
   * beyond straightforward sums of amounts actually charged at redemption.
   */
  getReportData(params: { dateFrom?: string; dateTo?: string } = {}): ReportData {
    const statusCounts = this.db
      .prepare<[], { status: string; c: number }>(`SELECT status, COUNT(*) as c FROM coupons GROUP BY status`)
      .all();
    const byStatus: Record<string, number> = { AVAILABLE: 0, USED: 0, EXPIRED: 0, REVOKED: 0 };
    let totalGenerated = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row.c;
      totalGenerated += row.c;
    }
    const redemptionRatePercent = totalGenerated > 0 ? Math.round((byStatus.USED / totalGenerated) * 100) : 0;

    let where = ` WHERE 1=1`;
    const args: unknown[] = [];
    if (params.dateFrom) {
      where += ` AND used_at >= ?`;
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      where += ` AND used_at <= ?`;
      args.push(params.dateTo);
    }

    const summary = this.db
      .prepare<
        unknown[],
        { usage_count: number; revenue_cents: number | null; discount_cents: number | null; avg_discount: number | null }
      >(
        `SELECT COUNT(*) as usage_count,
                SUM(final_price_cents) as revenue_cents,
                SUM(original_price_cents - final_price_cents) as discount_cents,
                AVG(discount_percentage) as avg_discount
         FROM usage_history ${where}`
      )
      .get(...args)!;

    const sponsorPerformance = this.db
      .prepare<unknown[], { sponsor_id: number; sponsor_name: string; used: number; revenue_cents: number }>(
        `SELECT sponsor_id, sponsor_name, COUNT(*) as used, SUM(final_price_cents) as revenue_cents
         FROM usage_history ${where}
         GROUP BY sponsor_id
         ORDER BY used DESC`
      )
      .all(...args);

    const sponsorTotals = this.db
      .prepare<[], { sponsor_id: number; total: number }>(
        `SELECT sponsor_id, COUNT(*) as total FROM coupons GROUP BY sponsor_id`
      )
      .all();
    const sponsorTotalMap = new Map(sponsorTotals.map((r) => [r.sponsor_id, r.total]));

    const campaignPerformance = this.db
      .prepare<
        unknown[],
        { campaign_id: number; campaign_name: string; sponsor_name: string; used: number; revenue_cents: number }
      >(
        `SELECT campaign_id, campaign_name, sponsor_name, COUNT(*) as used, SUM(final_price_cents) as revenue_cents
         FROM usage_history ${where}
         GROUP BY campaign_id
         ORDER BY used DESC`
      )
      .all(...args);

    const campaignTotals = this.db
      .prepare<[], { campaign_id: number; total: number }>(
        `SELECT campaign_id, COUNT(*) as total FROM coupons GROUP BY campaign_id`
      )
      .all();
    const campaignTotalMap = new Map(campaignTotals.map((r) => [r.campaign_id, r.total]));

    const dailyUsage = this.db
      .prepare<unknown[], { date: string; count: number; revenue_cents: number }>(
        `SELECT date(used_at) as date, COUNT(*) as count, SUM(final_price_cents) as revenue_cents
         FROM usage_history ${where}
         GROUP BY date(used_at)
         ORDER BY date ASC`
      )
      .all(...args);

    return {
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
      totalGenerated,
      totalAvailable: byStatus.AVAILABLE,
      totalUsed: byStatus.USED,
      totalExpired: byStatus.EXPIRED,
      totalRevoked: byStatus.REVOKED,
      redemptionRatePercent,
      usageInRange: summary.usage_count,
      estimatedRevenueCents: summary.revenue_cents ?? 0,
      totalDiscountGivenCents: summary.discount_cents ?? 0,
      avgDiscountPercent: summary.avg_discount ? Math.round(summary.avg_discount) : 0,
      sponsorPerformance: sponsorPerformance.map((r) => ({
        sponsorId: r.sponsor_id,
        sponsorName: r.sponsor_name,
        used: r.used,
        total: sponsorTotalMap.get(r.sponsor_id) ?? r.used,
        revenueCents: r.revenue_cents ?? 0,
      })),
      campaignPerformance: campaignPerformance.map((r) => ({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        sponsorName: r.sponsor_name,
        used: r.used,
        total: campaignTotalMap.get(r.campaign_id) ?? r.used,
        revenueCents: r.revenue_cents ?? 0,
      })),
      dailyUsage: dailyUsage.map((r) => ({ date: r.date, count: r.count, revenueCents: r.revenue_cents ?? 0 })),
    };
  }

  getDashboardStats(): DashboardStats {
    const totalSponsors = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM sponsors WHERE status = 'ACTIVE'`)
      .get()!.c;

    const totalCampaigns = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM campaigns WHERE status = 'ACTIVE'`)
      .get()!.c;

    const statusCounts = this.db
      .prepare<[], { status: string; c: number }>(`SELECT status, COUNT(*) as c FROM coupons GROUP BY status`)
      .all();
    const byStatus: Record<string, number> = { AVAILABLE: 0, USED: 0, EXPIRED: 0, REVOKED: 0 };
    let totalCodes = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row.c;
      totalCodes += row.c;
    }

    const usageRateSincePercent = totalCodes > 0 ? Math.round((byStatus.USED / totalCodes) * 100) : 0;

    const todayUsage = this.db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) as c FROM usage_history WHERE date(used_at) = date('now')`
      )
      .get()!.c;

    const weekUsage = this.db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) as c FROM usage_history WHERE used_at >= datetime('now', '-7 days')`
      )
      .get()!.c;

    const monthUsage = this.db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) as c FROM usage_history WHERE used_at >= datetime('now', 'start of month')`
      )
      .get()!.c;

    return {
      totalSponsors,
      totalCampaigns,
      totalCodes,
      available: byStatus.AVAILABLE,
      used: byStatus.USED,
      expired: byStatus.EXPIRED,
      revoked: byStatus.REVOKED,
      usageRateSincePercent,
      todayUsage,
      weekUsage,
      monthUsage,
    };
  }

  /** Daily usage counts for the last N days, for a simple bar chart. */
  getDailyUsage(days = 14): { date: string; count: number }[] {
    const rows = this.db
      .prepare<[number], { date: string; count: number }>(
        `SELECT date(used_at) as date, COUNT(*) as count
         FROM usage_history
         WHERE used_at >= datetime('now', '-' || ? || ' days')
         GROUP BY date(used_at)
         ORDER BY date ASC`
      )
      .all(days);
    return rows;
  }

  /** Usage per sponsor, for a simple ranking list. */
  getSponsorPerformance(): { sponsorId: number; sponsorName: string; used: number; total: number }[] {
    const rows = this.db
      .prepare<
        [],
        { sponsor_id: number; sponsor_name: string; used: number; total: number }
      >(
        `SELECT s.id as sponsor_id, s.name as sponsor_name,
                SUM(CASE WHEN c.status = 'USED' THEN 1 ELSE 0 END) as used,
                COUNT(c.id) as total
         FROM sponsors s
         LEFT JOIN coupons c ON c.sponsor_id = s.id
         GROUP BY s.id
         ORDER BY used DESC`
      )
      .all();
    return rows.map((r) => ({
      sponsorId: r.sponsor_id,
      sponsorName: r.sponsor_name,
      used: r.used ?? 0,
      total: r.total ?? 0,
    }));
  }
}
