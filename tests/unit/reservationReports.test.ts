import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createTestDb } from './testDb';
import { futureSunday } from './testDates';
import { ReservationService } from '../../src/main/services/ReservationService';
import { ReservationReportService } from '../../src/main/services/ReservationReportService';
import { PricingService } from '../../src/main/services/PricingService';
import { CouponService } from '../../src/main/services/couponService';
import { SponsorService } from '../../src/main/services/sponsorService';
import { CampaignService } from '../../src/main/services/campaignService';

const DAY = futureSunday();
// "now" for the report/dashboard = early that morning, so every slot that
// day is still in the future and the numbers are deterministic.
const NOW = new Date(`${DAY}T07:00:00`);

describe('ReservationReportService — dashboard & reports from real data', () => {
  let db: Database.Database;
  let reservations: ReservationService;
  let reports: ReservationReportService;
  let coupons: CouponService;
  let couponCode: string;

  beforeEach(() => {
    db = createTestDb();
    coupons = new CouponService(db);
    reservations = new ReservationService(db, coupons);
    reports = new ReservationReportService(db);
    new PricingService(db).create({ name: 'Standard hour', weekdayMask: 127, durationMin: 60, priceCents: 10000 });
    const sponsor = new SponsorService(db).create({ name: 'Beach Co' });
    const campaign = new CampaignService(db).create({
      sponsorId: sponsor.id, campaignName: 'Promo', serviceName: '1 Hour', originalPrice: 100, discountPercentage: 20,
    });
    couponCode = coupons.generateCodes({ campaignId: campaign.id, count: 1, prefix: 'PR' })[0].code;
  });

  test('empty database yields zeros, never invented numbers', () => {
    const s = reports.getDashboardStats(DAY, true, NOW);
    assert.equal(s.todayReservations, 0);
    assert.equal(s.todayOccupied, 0);
    assert.equal(s.revenueTodayCents, 0);
    assert.equal(s.totalCustomers, 0);
    assert.ok(s.todayCapacityTotal > 0, 'capacity comes from configured business hours');
  });

  test('dashboard counts reservations, occupancy and revenue from real rows', () => {
    const a = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 2 });
    reservations.createAdvance({ customer: { name: 'B', phone: '2' }, reservationDate: DAY, startTime: '11:00', durationMin: 60, players: 1, couponCode });
    reservations.markAsPaid(a.id);

    const s = reports.getDashboardStats(DAY, true, NOW);
    assert.equal(s.todayReservations, 2);
    assert.equal(s.todayWalkIns, 1);
    assert.equal(s.todayAdvance, 1);
    assert.equal(s.todayOccupied, 3);
    assert.equal(s.couponReservationsToday, 1);
    assert.equal(s.revenueTodayCents, 20000, 'only PAID reservations count as revenue (2 players x 10000/player)');
    assert.equal(s.totalCustomers, 2);
  });

  test('FINANCIAL GATING: without dashboard.financial_view all money figures are null', () => {
    const a = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 1 });
    reservations.markAsPaid(a.id);
    const s = reports.getDashboardStats(DAY, false, NOW);
    assert.equal(s.revenueTodayCents, null);
    assert.equal(s.revenueMonthCents, null);
    assert.equal(s.todayReservations, 1, 'non-financial figures are still provided');

    const r = reports.getReport(DAY, DAY, false, NOW);
    assert.equal(r.revenueCents, null);
    assert.equal(r.unpaidCents, null);
    assert.equal(r.discountCents, null);
    assert.equal(r.customers.topBySpend[0].spendCents, null);
  });

  test('cancelled and no-show reservations are excluded from active counts but reported separately', () => {
    const a = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 1 });
    const b = reservations.createWalkIn({ customer: { name: 'B', phone: '2' }, reservationDate: DAY, startTime: '11:00', durationMin: 60, players: 1 });
    reservations.cancel(a.id, 'x');
    reservations.noShow(b.id);
    const s = reports.getDashboardStats(DAY, true, NOW);
    assert.equal(s.todayReservations, 0);
    const r = reports.getReport(DAY, DAY, true, NOW);
    assert.equal(r.total, 2);
    assert.equal(r.cancelled, 1);
    assert.equal(r.noShow, 1);
  });

  test('report: paid/unpaid, discounts, popular times, sponsor coupon performance', () => {
    const a = reservations.createAdvance({ customer: { name: 'A', phone: '1' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 2, couponCode });
    reservations.createWalkIn({ customer: { name: 'B', phone: '2' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 1 });
    reservations.markAsPaid(a.id);

    const r = reports.getReport(DAY, DAY, true, NOW);
    assert.equal(r.total, 2);
    assert.equal(r.paid, 1);
    assert.equal(r.unpaid, 1);
    assert.equal(r.revenueCents, 8000);
    assert.equal(r.unpaidCents, 10000);
    assert.equal(r.discountCents, 2000);
    assert.equal(r.couponReservations, 1);
    assert.equal(r.averagePlayers, 1.5);
    assert.equal(r.popularTimes[0].label, '10:00');
    assert.equal(r.popularTimes[0].count, 2);

    assert.equal(r.sponsorPerformance.length, 1);
    const sp = r.sponsorPerformance[0];
    assert.equal(sp.sponsorName, 'Beach Co');
    assert.equal(sp.couponsUsed, 1);
    assert.equal(sp.discountCents, 2000);
    assert.equal(sp.revenueCents, 8000);
  });

  test('completed reservations still count toward slot occupancy', () => {
    const a = reservations.createWalkIn({ customer: { name: 'A', phone: '1' }, reservationDate: DAY, startTime: '10:00', durationMin: 60, players: 3 });
    reservations.checkIn(a.id);
    reservations.start(a.id);
    reservations.complete(a.id);
    const r = reports.getReport(DAY, DAY, true, NOW);
    assert.ok(r.occupancyPercent > 0);
    assert.equal(r.completed, 1);
  });
});
