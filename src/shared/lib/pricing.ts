// Centralized discount/price calculation.
// All monetary values are handled as integer cents internally to avoid
// floating point rounding errors. UI/export layers convert to display strings
// using formatPriceCents(). Never duplicate this math elsewhere.

import type { DiscountType } from '../types/domain';

export interface PriceBreakdown {
  originalPriceCents: number;
  discountType: DiscountType;
  discountPercentage: number;
  discountAmountCents: number;
  youSaveCents: number;
  finalPriceCents: number;
}

/**
 * Convert a decimal price (e.g. user types "100.50") into integer cents.
 * Throws on negative or non-finite input.
 */
export function toCents(decimalPrice: number): number {
  if (!Number.isFinite(decimalPrice) || decimalPrice < 0) {
    throw new Error('Price must be a non-negative finite number');
  }
  return Math.round(decimalPrice * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Compute the final price and savings for a campaign.
 * Currently supports PERCENTAGE discounts (primary, per spec) and FIXED
 * discounts (forward-compatible; capped so final price never goes below 0).
 */
export function calculatePrice(params: {
  originalPriceCents: number;
  discountType: DiscountType;
  discountPercentage?: number; // 0-100, used when discountType === 'PERCENTAGE'
  discountAmountCents?: number; // used when discountType === 'FIXED'
}): PriceBreakdown {
  const { originalPriceCents, discountType } = params;

  if (!Number.isInteger(originalPriceCents) || originalPriceCents < 0) {
    throw new Error('originalPriceCents must be a non-negative integer');
  }

  if (discountType === 'PERCENTAGE') {
    const pct = params.discountPercentage ?? 0;
    if (pct < 0 || pct > 100) {
      throw new Error('discountPercentage must be between 0 and 100');
    }
    const youSaveCents = Math.round((originalPriceCents * pct) / 100);
    const finalPriceCents = originalPriceCents - youSaveCents;
    return {
      originalPriceCents,
      discountType,
      discountPercentage: pct,
      discountAmountCents: 0,
      youSaveCents,
      finalPriceCents,
    };
  }

  // FIXED amount discount
  const amount = params.discountAmountCents ?? 0;
  if (amount < 0) {
    throw new Error('discountAmountCents must be non-negative');
  }
  const youSaveCents = Math.min(amount, originalPriceCents);
  const finalPriceCents = originalPriceCents - youSaveCents;
  return {
    originalPriceCents,
    discountType,
    discountPercentage: originalPriceCents > 0 ? (youSaveCents / originalPriceCents) * 100 : 0,
    discountAmountCents: amount,
    youSaveCents,
    finalPriceCents,
  };
}

/** Format integer cents as a display string, e.g. 5000 -> "50.00 TND". */
export function formatPriceCents(cents: number, currency: string): string {
  const value = fromCents(cents);
  return `${value.toFixed(2)} ${currency}`;
}
