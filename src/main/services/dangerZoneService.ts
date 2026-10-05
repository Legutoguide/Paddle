import type Database from 'better-sqlite3';
import { AuditService } from './auditService';
import { NotificationService } from './notificationService';

export class DangerZoneService {
  private audit: AuditService;
  private notifications: NotificationService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  /**
   * Permanently wipes all business data (sponsors, campaigns, coupons,
   * usage history, batches, customers, reservations, notifications, audit
   * trail) back to a blank slate. Settings, session logs and the booking
   * CONFIGURATION (business hours, periods, pricing rules) are preserved,
   * since those describe how the business/app is set up rather than the
   * business's data.
   *
   * Callers (IPC layer) are responsible for creating a backup BEFORE
   * calling this and requiring explicit typed confirmation from the user —
   * this method assumes that has already happened and does the deletion
   * unconditionally, atomically.
   */
  resetAllData(): {
    sponsorsRemoved: number;
    campaignsRemoved: number;
    couponsRemoved: number;
    reservationsRemoved: number;
    customersRemoved: number;
  } {
    const counts = {
      sponsorsRemoved: this.db.prepare(`SELECT COUNT(*) as c FROM sponsors`).get() as { c: number },
      campaignsRemoved: this.db.prepare(`SELECT COUNT(*) as c FROM campaigns`).get() as { c: number },
      couponsRemoved: this.db.prepare(`SELECT COUNT(*) as c FROM coupons`).get() as { c: number },
      reservationsRemoved: this.db.prepare(`SELECT COUNT(*) as c FROM reservations`).get() as { c: number },
      customersRemoved: this.db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number },
    };

    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM coupon_redemptions;
        DELETE FROM reservation_participants;
        DELETE FROM reservation_history;
        DELETE FROM reservations;
        DELETE FROM customers;
        DELETE FROM usage_history;
        DELETE FROM coupons;
        DELETE FROM batches;
        DELETE FROM campaigns;
        DELETE FROM sponsors;
        DELETE FROM notifications;
        DELETE FROM audit_logs;
      `);
    });
    tx();

    // Log and notify AFTER the wipe, so this is the first real record in
    // the now-empty audit trail — proof the reset itself is auditable.
    this.audit.log('DANGER_ZONE_RESET_ALL_DATA', 'database', null, counts);
    this.notifications.emit({
      type: 'DATA_RESET',
      title: 'All data was reset',
      message: 'Sponsors, campaigns, coupons, customers, reservations and history were permanently cleared.',
    });

    return {
      sponsorsRemoved: counts.sponsorsRemoved.c,
      campaignsRemoved: counts.campaignsRemoved.c,
      couponsRemoved: counts.couponsRemoved.c,
      reservationsRemoved: counts.reservationsRemoved.c,
      customersRemoved: counts.customersRemoved.c,
    };
  }
}
