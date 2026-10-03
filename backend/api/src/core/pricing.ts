/**
 * Money arithmetic, ported from `Carmasters.Domain.Pricings`.
 *
 * The database stores money in `double precision` and the original domain
 * model used `decimal`. Values are rounded to cents at the boundary to keep
 * JSON output stable rather than accumulating binary floating-point noise.
 */

export const VAT_MULTIPLIER_EPSILON = 1e-9;

/** `Pricing.TaxMultiplier`: `1 + purchaseTax / 100`. */
export function taxMultiplier(vatRatePercent: number): number {
  return 1 + vatRatePercent / 100;
}

/** Rounds to `digits` decimal places, avoiding `-0` and float noise. */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface PriceSummary {
  totalWithVat: number;
  totalWithoutVat: number;
}

export interface SaleableLine {
  quantity: number | null | undefined;
  price: number | null | undefined;
  discount: number | null | undefined;
}

/**
 * `PriceSummary.CalculatePriceSummary`.
 *
 * Note the original's quirk, preserved here: a line with quantity < 1 zeroes
 * both totals in the private constructor but then falls through and overwrites
 * them, so the effective behaviour is simply quantity x price x discount
 * factor. Lines with a quantity of 0 therefore contribute nothing.
 */
export function calculatePriceSummary(
  vatRatePercent: number,
  lines: readonly SaleableLine[],
): PriceSummary {
  const multiplier = taxMultiplier(vatRatePercent);

  let totalWithVat = 0;
  let totalWithoutVat = 0;

  for (const line of lines) {
    const quantity = Number(line.quantity ?? 0);
    const price = Number(line.price ?? 0);
    const discount = Number(line.discount ?? 0);
    const bargainMultiplier = (100 + discount) / 100;

    totalWithVat += quantity * price * bargainMultiplier;
    totalWithoutVat += quantity * (price / multiplier) * bargainMultiplier;
  }

  return {
    totalWithVat: round(totalWithVat),
    totalWithoutVat: round(totalWithoutVat),
  };
}

export interface PricingLineInput {
  nr: number;
  description: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  discount: number;
  total: number;
  totalWithVat: number;
}

/** `Pricing.ToLine`: splits the unit price into a net figure and derives totals. */
export function toPricingLine(vatRatePercent: number, nr: number, line: SaleableLine & { name?: string | null; description?: string | null; unit?: string | null }): PricingLineInput {
  const multiplier = taxMultiplier(vatRatePercent);
  const price = Number(line.price ?? 0);
  const quantity = Number(line.quantity ?? 0);
  const discount = Number(line.discount ?? 0);
  const bargainMultiplier = (100 + discount) / 100;

  return {
    nr,
    description: line.description ?? line.name ?? '',
    quantity,
    unitPrice: round(price / multiplier),
    unit: line.unit ?? '',
    discount,
    total: round(quantity * (price / multiplier) * bargainMultiplier),
    totalWithVat: round(quantity * price * bargainMultiplier),
  };
}
