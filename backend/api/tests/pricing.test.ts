import { describe, expect, it } from 'vitest';
import { calculatePriceSummary, round, taxMultiplier, toPricingLine } from '../src/core/pricing.js';

describe('taxMultiplier', () => {
  it('adds one to the percentage', () => {
    expect(taxMultiplier(0)).toBe(1);
    expect(taxMultiplier(20)).toBeCloseTo(1.2, 10);
    expect(taxMultiplier(22)).toBeCloseTo(1.22, 10);
  });
});

describe('round', () => {
  it('rounds to two decimals by default', () => {
    expect(round(1.005)).toBe(1.01);
    expect(round(10 / 3)).toBe(3.33);
  });

  it('normalises negative zero', () => {
    expect(Object.is(round(-0.0001), 0)).toBe(true);
  });

  it('returns 0 for non-finite input', () => {
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('calculatePriceSummary', () => {
  it('computes totals with and without VAT', () => {
    const summary = calculatePriceSummary(20, [{ quantity: 2, price: 100, discount: 0 }]);
    expect(summary.totalWithVat).toBe(200);
    expect(summary.totalWithoutVat).toBe(166.67);
  });

  it('applies the discount adjustment as stored', () => {
    // The domain stores discount as a signed adjustment: `(100 + discount)/100`.
    const summary = calculatePriceSummary(0, [{ quantity: 1, price: 100, discount: -10 }]);
    expect(summary.totalWithVat).toBe(90);
    expect(summary.totalWithoutVat).toBe(90);
  });

  it('ignores lines with no quantity', () => {
    const summary = calculatePriceSummary(20, [
      { quantity: 0, price: 50, discount: 0 },
      { quantity: null, price: 50, discount: 0 },
    ]);
    expect(summary).toEqual({ totalWithVat: 0, totalWithoutVat: 0 });
  });
});

describe('toPricingLine', () => {
  it('splits the unit price into a net figure', () => {
    const line = toPricingLine(20, 1, {
      name: 'Brake pads',
      quantity: 2,
      price: 120,
      discount: 0,
      unit: 'pcs',
    });
    expect(line).toEqual({
      nr: 1,
      description: 'Brake pads',
      quantity: 2,
      unitPrice: 100,
      unit: 'pcs',
      discount: 0,
      total: 200,
      totalWithVat: 240,
    });
  });

  it('falls back to description over name', () => {
    const line = toPricingLine(0, 2, {
      name: 'Name',
      description: 'Description',
      quantity: 1,
      price: 10,
      discount: 0,
    });
    expect(line.description).toBe('Description');
  });
});
