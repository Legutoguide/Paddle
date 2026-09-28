import type Database from 'better-sqlite3';
import { mapPricingRule, type PricingRuleRow } from '../db/mappers';
import type { PricingRule } from '../../shared/types/domain';
import { AuditService } from './auditService';
import { weekdayOf } from '../../shared/lib/availability';

export class PricingValidationError extends Error {}
/** Thrown when no active pricing rule matches — the caller must surface
 * this clearly to staff rather than fall back to a fabricated price. */
export class NoPricingRuleError extends Error {}

export interface UpsertPricingRuleInput {
  name: string;
  weekdayMask: number;
  periodId?: number | null;
  durationMin: number;
  priceCents: number;
  priority?: number;
  active?: boolean;
}

export class PricingService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  list(): PricingRule[] {
    return this.db
      .prepare<[], PricingRuleRow>(`SELECT * FROM pricing_rules ORDER BY priority DESC, id`)
      .all()
      .map(mapPricingRule);
  }

  create(input: UpsertPricingRuleInput): PricingRule {
    const name = input.name.trim();
    if (!name) throw new PricingValidationError('Rule name is required');
    if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) {
      throw new PricingValidationError('Duration must be a positive whole number of minutes');
    }
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
      throw new PricingValidationError('Price must be a non-negative amount in whole cents');
    }
    if (!Number.isInteger(input.weekdayMask) || input.weekdayMask < 1 || input.weekdayMask > 127) {
      throw new PricingValidationError('Select at least one day of the week');
    }

    const result = this.db
      .prepare(
        `INSERT INTO pricing_rules (name, weekday_mask, period_id, duration_min, price_cents, priority, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        input.weekdayMask,
        input.periodId ?? null,
        input.durationMin,
        input.priceCents,
        input.priority ?? 0,
        input.active === false ? 0 : 1
      );
    const id = Number(result.lastInsertRowid);
    this.audit.log('PRICING_RULE_CREATED', 'pricing_rule', id, input);
    return this.getById(id)!;
  }

  update(id: number, input: Partial<UpsertPricingRuleInput>): PricingRule {
    const existing = this.getById(id);
    if (!existing) throw new PricingValidationError(`Pricing rule ${id} not found`);
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) throw new PricingValidationError('Rule name is required');
    if (input.weekdayMask !== undefined && (!Number.isInteger(input.weekdayMask) || input.weekdayMask < 1 || input.weekdayMask > 127)) {
      throw new PricingValidationError('Select at least one day of the week');
    }
    if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
      throw new PricingValidationError('Price must be a non-negative amount in whole cents');
    }
    if (input.durationMin !== undefined && (!Number.isInteger(input.durationMin) || input.durationMin <= 0)) {
      throw new PricingValidationError('Duration must be a positive whole number of minutes');
    }

    this.db
      .prepare(
        `UPDATE pricing_rules SET name = ?, weekday_mask = ?, period_id = ?, duration_min = ?,
         price_cents = ?, priority = ?, active = ? WHERE id = ?`
      )
      .run(
        name,
        input.weekdayMask ?? existing.weekdayMask,
        input.periodId !== undefined ? input.periodId : existing.periodId,
        input.durationMin ?? existing.durationMin,
        input.priceCents ?? existing.priceCents,
        input.priority ?? existing.priority,
        input.active !== undefined ? (input.active ? 1 : 0) : existing.active ? 1 : 0,
        id
      );
    this.audit.log('PRICING_RULE_UPDATED', 'pricing_rule', id, input);
    return this.getById(id)!;
  }

  getById(id: number): PricingRule | null {
    const row = this.db.prepare<[number], PricingRuleRow>(`SELECT * FROM pricing_rules WHERE id = ?`).get(id);
    return row ? mapPricingRule(row) : null;
  }

  /**
   * Resolve the price (in cents) for a booking, given its date/period/
   * duration. Picks the highest-`priority` active rule whose weekday_mask
   * includes that date's weekday, whose duration matches exactly, and whose
   * period_id matches (or is NULL, meaning "any period"). Throws
   * NoPricingRuleError rather than guessing when nothing matches — never a
   * hardcoded fallback price.
   */
  resolvePrice(params: { date: string; periodId: number | null; durationMin: number }): PricingRule {
    const weekday = weekdayOf(params.date);
    const bit = 1 << weekday;

    const candidates = this.list().filter(
      (r) =>
        r.active &&
        (r.weekdayMask & bit) !== 0 &&
        r.durationMin === params.durationMin &&
        (r.periodId === null || r.periodId === params.periodId)
    );

    if (candidates.length === 0) {
      throw new NoPricingRuleError(
        `No active pricing rule configured for this day/period/duration combination.`
      );
    }

    // Highest priority wins; a period-specific rule (periodId set) beats a
    // catch-all (periodId null) at equal priority, since it's more specific.
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.periodId !== null && b.periodId === null) return -1;
      if (a.periodId === null && b.periodId !== null) return 1;
      return 0;
    });

    return candidates[0];
  }
}
