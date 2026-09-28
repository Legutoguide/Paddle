import type Database from 'better-sqlite3';
import type { ReservationDashboardStats, ReservationReport } from '../../shared/types/domain';
import { AvailabilityService } from './AvailabilityService';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/**
 * Dashboard + report queries. Every figure comes straight from the
 * database — nothing is estimated or invented. Money is only populated
 * when `includeFinancial` is true; the IPC layer sets that from the
 * server-verified session's `dashboard.financial_view` permission, so a
 * role without it never even receives the numbers (not merely hidden in
 * the UI).
 */
export class ReservationReportService {
  private availability: AvailabilityService;

  constructor(private db: Database.Database) {
    this.availability = new AvailabilityService(db);
  }

  getDashboardStats(today: string, includeFinancial: boolean, now: Date = new Date()): ReservationDashboardStats {
    const monthStart = `${today.slice(0, 7)}-01`;
    const active = `status NOT IN ('CANCELLED','NO_SHOW')`;

    const one = (sql: string, ...args: unknown[]): number =>
      num((this.db.prepare(sql).get(...args) as { c: number | null } | undefined)?.c);

    const day = this.availability.getDayAvailability(today, now);
    let capTotal = 0;
    let occupied = 0;
    let available = 0;
    for (const s of day.slots) {
      capTotal += s.capacity;
      occupied += Math.min(s.occupied, s.capacity);
      if (s.status === 'AVAILABLE' || s.status === 'ALMOST_FULL') available += Math.max(0, s.capacity - s.occupied);
    }

    const revenue = (from: string, to: string): number =>
      one(
        `SELECT COALESCE(SUM(final_price_cents),0) as c FROM reservations
         WHERE payment_status='PAID' AND reservation_date BETWEEN ? AND ?`,
        from,
        to
      );

    return {
      date: today,
      todayReservations: one(`SELECT COUNT(*) as c FROM reservations WHERE reservation_date = ? AND ${active}`, today),
      todayWalkIns: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date = ? AND reservation_type='WALK_IN' AND ${active}`,
        today
      ),
      todayAdvance: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date = ? AND reservation_type='ADVANCE' AND ${active}`,
        today
      ),
      todayCapacityTotal: capTotal,
      todayOccupied: occupied,
      todayAvailable: available,
      todayOccupancyPercent: capTotal > 0 ? Math.round((occupied / capTotal) * 100) : 0,
      upcomingReservations: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date > ? AND reservation_date <= ?
         AND status IN ('PENDING','CONFIRMED')`,
        today,
        addDays(today, 7)
      ),
      totalCustomers: one(`SELECT COUNT(*) as c FROM customers`),
      couponReservationsToday: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date = ? AND coupon_id IS NOT NULL AND ${active}`,
        today
      ),
      monthReservations: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date BETWEEN ? AND ? AND ${active}`,
        monthStart,
        today
      ),
      monthWalkIns: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date BETWEEN ? AND ? AND reservation_type='WALK_IN' AND ${active}`,
        monthStart,
        today
      ),
      monthAdvance: one(
        `SELECT COUNT(*) as c FROM reservations WHERE reservation_date BETWEEN ? AND ? AND reservation_type='ADVANCE' AND ${active}`,
        monthStart,
        today
      ),
      monthCouponUsed: one(
        `SELECT COUNT(*) as c FROM reservations r JOIN coupons c ON c.id = r.coupon_id
         WHERE r.reservation_date BETWEEN ? AND ? AND c.status='USED'`,
        monthStart,
        today
      ),
      revenueTodayCents: includeFinancial ? revenue(today, today) : null,
      revenueMonthCents: includeFinancial ? revenue(monthStart, today) : null,
    };
  }

  getReport(dateFrom: string, dateTo: string, includeFinancial: boolean, now: Date = new Date()): ReservationReport {
    const range = [dateFrom, dateTo];
    const one = (sql: string, ...args: unknown[]): number =>
      num((this.db.prepare(sql).get(...args) as { c: number | null } | undefined)?.c);
    const count = (extra: string): number =>
      one(`SELECT COUNT(*) as c FROM reservations WHERE reservation_date BETWEEN ? AND ? ${extra}`, ...range);
    const money = (v: number): number | null => (includeFinancial ? v : null);

    const grouped = (sql: string, labelOf: (raw: string) => string): { label: string; count: number }[] =>
      (this.db.prepare(sql).all(...range) as { k: string | null; c: number }[])
        .filter((r) => r.k !== null)
        .map((r) => ({ label: labelOf(String(r.k)), count: r.c }));

    // Occupancy: players actually occupying slots vs total slot capacity
    // across the range, using the very same availability logic as the
    // calendar (so the numbers can never disagree with what staff see).
    let cap = 0;
    let occ = 0;
    for (const d of this.availability.getRangeAvailability(dateFrom, dateTo, now)) {
      for (const s of d.slots) {
        cap += s.capacity;
        occ += Math.min(s.occupied, s.capacity);
      }
    }

    const sponsorRows = this.db
      .prepare(
        `SELECT s.name as sponsor_name, cm.campaign_name as campaign_name,
                COUNT(r.id) as reservations,
                SUM(CASE WHEN c.status='RESERVED' THEN 1 ELSE 0 END) as coupons_reserved,
                SUM(CASE WHEN c.status='USED' THEN 1 ELSE 0 END) as coupons_used,
                COALESCE(SUM(CASE WHEN r.status NOT IN ('CANCELLED','NO_SHOW') THEN r.discount_cents ELSE 0 END),0) as discount_cents,
                COALESCE(SUM(CASE WHEN r.payment_status='PAID' THEN r.final_price_cents ELSE 0 END),0) as revenue_cents
         FROM reservations r
         JOIN coupons c ON c.id = r.coupon_id
         JOIN sponsors s ON s.id = c.sponsor_id
         JOIN campaigns cm ON cm.id = c.campaign_id
         WHERE r.reservation_date BETWEEN ? AND ?
         GROUP BY s.id, cm.id ORDER BY reservations DESC`
      )
      .all(...range) as {
        sponsor_name: string; campaign_name: string; reservations: number;
        coupons_reserved: number; coupons_used: number; discount_cents: number; revenue_cents: number;
      }[];

    const topCustomers = this.db
      .prepare(
        `SELECT c.name as name, COUNT(r.id) as reservations,
                COALESCE(SUM(CASE WHEN r.payment_status='PAID' THEN r.final_price_cents ELSE 0 END),0) as spend
         FROM reservations r JOIN customers c ON c.id = r.customer_id
         WHERE r.reservation_date BETWEEN ? AND ?
         GROUP BY c.id ORDER BY spend DESC, reservations DESC LIMIT 5`
      )
      .all(...range) as { name: string; reservations: number; spend: number }[];

    return {
      dateFrom,
      dateTo,
      total: count(''),
      completed: count(`AND status='COMPLETED'`),
      cancelled: count(`AND status='CANCELLED'`),
      noShow: count(`AND status='NO_SHOW'`),
      walkIn: count(`AND reservation_type='WALK_IN' AND status NOT IN ('CANCELLED','NO_SHOW')`),
      advance: count(`AND reservation_type='ADVANCE' AND status NOT IN ('CANCELLED','NO_SHOW')`),
      paid: count(`AND payment_status='PAID'`),
      unpaid: count(`AND payment_status='UNPAID' AND status NOT IN ('CANCELLED','NO_SHOW')`),
      couponReservations: count(`AND coupon_id IS NOT NULL`),
      averagePlayers:
        Math.round(
          (one(
            `SELECT AVG(players) as c FROM reservations WHERE reservation_date BETWEEN ? AND ?
             AND status NOT IN ('CANCELLED','NO_SHOW')`,
            ...range
          )) * 10
        ) / 10,
      occupancyPercent: cap > 0 ? Math.round((occ / cap) * 100) : 0,
      popularTimes: grouped(
        `SELECT start_time as k, COUNT(*) as c FROM reservations WHERE reservation_date BETWEEN ? AND ?
         AND status NOT IN ('CANCELLED','NO_SHOW') GROUP BY start_time ORDER BY c DESC LIMIT 8`,
        (k) => k
      ),
      popularDays: grouped(
        `SELECT strftime('%w', reservation_date) as k, COUNT(*) as c FROM reservations
         WHERE reservation_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED','NO_SHOW')
         GROUP BY k ORDER BY c DESC`,
        (k) => DAY_LABELS[Number(k)] ?? k
      ),
      popularPeriods: grouped(
        `SELECT p.name as k, COUNT(*) as c FROM reservations r JOIN periods p ON p.id = r.period_id
         WHERE r.reservation_date BETWEEN ? AND ? AND r.status NOT IN ('CANCELLED','NO_SHOW')
         GROUP BY p.id ORDER BY c DESC`,
        (k) => k
      ),
      sponsorPerformance: sponsorRows.map((r) => ({
        sponsorName: r.sponsor_name,
        campaignName: r.campaign_name,
        reservations: r.reservations,
        couponsReserved: r.coupons_reserved,
        couponsUsed: r.coupons_used,
        discountCents: money(r.discount_cents),
        revenueCents: money(r.revenue_cents),
      })),
      customers: {
        distinct: one(
          `SELECT COUNT(DISTINCT customer_id) as c FROM reservations WHERE reservation_date BETWEEN ? AND ?`,
          ...range
        ),
        newInRange: one(
          `SELECT COUNT(*) as c FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ?`,
          ...range
        ),
        topBySpend: topCustomers.map((c) => ({
          name: c.name,
          reservations: c.reservations,
          spendCents: money(c.spend),
        })),
      },
      revenueCents: money(
        one(
          `SELECT COALESCE(SUM(final_price_cents),0) as c FROM reservations
           WHERE payment_status='PAID' AND reservation_date BETWEEN ? AND ?`,
          ...range
        )
      ),
      unpaidCents: money(
        one(
          `SELECT COALESCE(SUM(final_price_cents),0) as c FROM reservations
           WHERE payment_status='UNPAID' AND status NOT IN ('CANCELLED','NO_SHOW')
           AND reservation_date BETWEEN ? AND ?`,
          ...range
        )
      ),
      discountCents: money(
        one(
          `SELECT COALESCE(SUM(discount_cents),0) as c FROM reservations
           WHERE status NOT IN ('CANCELLED','NO_SHOW') AND reservation_date BETWEEN ? AND ?`,
          ...range
        )
      ),
    };
  }
}
