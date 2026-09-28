import type Database from 'better-sqlite3';
import { mapCustomer, mapCustomerStats, type CustomerRow, type CustomerStatsRow } from '../db/mappers';
import type { Customer, CustomerWithStats } from '../../shared/types/domain';
import { AuditService } from './auditService';

export class CustomerValidationError extends Error {}
export class CustomerNotFoundError extends Error {}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  notes?: string | null;
}

/** Strip spaces/dashes/parens so phone matching isn't defeated by formatting
 * differences like "12 345 678" vs "12-345-678". Never used as a hard
 * uniqueness constraint — see findOrCreateByPhone below. */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, '');
}

export class CustomerService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  create(input: CreateCustomerInput): Customer {
    const name = input.name.trim();
    const phone = input.phone.trim();
    if (!name) throw new CustomerValidationError('Customer name is required');
    if (!phone) throw new CustomerValidationError('Customer phone is required');

    const result = this.db
      .prepare(`INSERT INTO customers (name, phone, notes) VALUES (?, ?, ?)`)
      .run(name, phone, input.notes ?? null);
    this.audit.log('CUSTOMER_CREATED', 'customer', Number(result.lastInsertRowid), { name, phone });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, input: Partial<CreateCustomerInput>): Customer {
    const existing = this.getById(id);
    if (!existing) throw new CustomerNotFoundError(`Customer ${id} not found`);

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const phone = input.phone !== undefined ? input.phone.trim() : existing.phone;
    if (!name) throw new CustomerValidationError('Customer name is required');
    if (!phone) throw new CustomerValidationError('Customer phone is required');

    this.db
      .prepare(
        `UPDATE customers SET name = ?, phone = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(name, phone, input.notes !== undefined ? input.notes : existing.notes, id);
    this.audit.log('CUSTOMER_UPDATED', 'customer', id, input);
    return this.getById(id)!;
  }

  getById(id: number): Customer | null {
    const row = this.db.prepare<[number], CustomerRow>(`SELECT * FROM customers WHERE id = ?`).get(id);
    return row ? mapCustomer(row) : null;
  }

  /**
   * Find an existing customer by normalized phone, or create a new one.
   * This is the entry point for both Walk-in and Advance Reservation
   * customer intake. Not a hard DB-level UNIQUE constraint (two people can
   * legitimately share a landline), so this returns the first match rather
   * than throwing — if the name differs from what's on file, callers should
   * surface that as a soft "is this the same customer?" prompt in the UI,
   * not silently overwrite the stored name.
   */
  findOrCreateByPhone(input: CreateCustomerInput): Customer {
    const phone = input.phone.trim();
    if (!phone) throw new CustomerValidationError('Customer phone is required');
    const normalized = normalizePhone(phone);

    const rows = this.db.prepare<[], CustomerRow>(`SELECT * FROM customers`).all();
    const match = rows.find((r: CustomerRow) => normalizePhone(r.phone) === normalized);
    if (match) return mapCustomer(match);

    return this.create(input);
  }

  /** Search by name, phone (normalized), reservation ID, or coupon code. */
  search(query: string): Customer[] {
    const q = query.trim();
    if (!q) return [];

    const byNameOrPhone = this.db
      .prepare<[string, string], CustomerRow>(
        `SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 50`
      )
      .all(`%${q}%`, `%${normalizePhone(q)}%`);

    const byReservationId = /^\d+$/.test(q)
      ? (this.db
          .prepare<[number], CustomerRow>(
            `SELECT c.* FROM customers c JOIN reservations r ON r.customer_id = c.id WHERE r.id = ?`
          )
          .all(Number(q)) as CustomerRow[])
      : [];

    const byCouponCode = this.db
      .prepare<[string], CustomerRow>(
        `SELECT c.* FROM customers c
         JOIN reservations r ON r.customer_id = c.id
         JOIN coupons co ON co.id = r.coupon_id
         WHERE co.code = ?`
      )
      .all(q);

    const seen = new Map<number, CustomerRow>();
    for (const r of [...byNameOrPhone, ...byReservationId, ...byCouponCode]) seen.set(r.id, r);
    return Array.from(seen.values()).map(mapCustomer);
  }

  list(): Customer[] {
    return this.db
      .prepare<[], CustomerRow>(`SELECT * FROM customers ORDER BY name`)
      .all()
      .map(mapCustomer);
  }

  /**
   * Computed aggregates joined live from reservations — never stored, so
   * they can never drift out of sync with the actual reservation history.
   */
  getWithStats(id: number): CustomerWithStats | null {
    const customer = this.getById(id);
    if (!customer) return null;

    const row = this.db
      .prepare<[number], CustomerStatsRow>(
        `SELECT
           COUNT(*) as total_reservations,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_reservations,
           SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_reservations,
           SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) as no_show_reservations,
           SUM(CASE WHEN payment_status = 'PAID' THEN final_price_cents ELSE 0 END) as total_spend_cents,
           SUM(CASE WHEN coupon_id IS NOT NULL THEN 1 ELSE 0 END) as coupon_usage_count,
           MAX(CASE WHEN status = 'COMPLETED' THEN reservation_date ELSE NULL END) as last_visit_at
         FROM reservations WHERE customer_id = ?`
      )
      .get(id)!;

    return { ...customer, stats: mapCustomerStats(row) };
  }
}
