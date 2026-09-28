import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, toCents, fromCents, formatPriceCents } from '../../src/shared/lib/pricing';

describe('pricing', () => {
  test('100 TND with 50% discount => 50 TND final, 50 saved', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(100),
      discountType: 'PERCENTAGE',
      discountPercentage: 50,
    });
    assert.equal(fromCents(result.finalPriceCents), 50);
    assert.equal(fromCents(result.youSaveCents), 50);
  });

  test('100 TND with 30% discount => 70 TND final', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(100),
      discountType: 'PERCENTAGE',
      discountPercentage: 30,
    });
    assert.equal(fromCents(result.finalPriceCents), 70);
  });

  test('80 TND with 25% discount => 60 TND final', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(80),
      discountType: 'PERCENTAGE',
      discountPercentage: 25,
    });
    assert.equal(fromCents(result.finalPriceCents), 60);
  });

  test('0% discount leaves price unchanged', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(199.99),
      discountType: 'PERCENTAGE',
      discountPercentage: 0,
    });
    assert.equal(fromCents(result.finalPriceCents), 199.99);
  });

  test('100% discount => final price is 0', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(45),
      discountType: 'PERCENTAGE',
      discountPercentage: 100,
    });
    assert.equal(fromCents(result.finalPriceCents), 0);
  });

  test('rejects discount percentage above 100', () => {
    assert.throws(() =>
      calculatePrice({ originalPriceCents: 1000, discountType: 'PERCENTAGE', discountPercentage: 150 })
    );
  });

  test('rejects negative original price', () => {
    assert.throws(() => toCents(-5));
  });

  test('FIXED discount never pushes final price below zero', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(20),
      discountType: 'FIXED',
      discountAmountCents: toCents(50),
    });
    assert.equal(fromCents(result.finalPriceCents), 0);
    assert.equal(fromCents(result.youSaveCents), 20);
  });

  test('formatPriceCents formats with configurable currency', () => {
    assert.equal(formatPriceCents(5000, 'TND'), '50.00 TND');
    assert.equal(formatPriceCents(5000, 'USD'), '50.00 USD');
  });

  test('handles floating point safe cents arithmetic (0.1 + 0.2 style cases)', () => {
    const result = calculatePrice({
      originalPriceCents: toCents(10.1),
      discountType: 'PERCENTAGE',
      discountPercentage: 10,
    });
    // 1010 cents * 10% = 101 cents saved -> 909 cents final
    assert.equal(result.finalPriceCents, 909);
  });
});
