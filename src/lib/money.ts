import Decimal from "decimal.js";

// Authoritative money maths uses decimal.js (the same library Prisma uses for
// Decimal columns). Amounts are rounded half-up to 2 places at line level.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value | { toString(): string };

export const D = (v: Num | null | undefined): Decimal => new Decimal(v == null ? 0 : (v as Decimal.Value).toString());

export const round2 = (v: Num): Decimal => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const pct = (amount: Num, percent: Num): Decimal => round2(D(amount).mul(D(percent)).div(100));

export const sum = (values: Num[]): Decimal => values.reduce<Decimal>((acc, v) => acc.add(D(v)), new Decimal(0));

export function formatMoney(v: Num | null | undefined, currency = "USD"): string {
  const d = D(v ?? 0);
  const [int, frac] = d.toFixed(2).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${currency} ${grouped}.${frac}`;
}

/** Plain string for serialising Decimal values across the server/client boundary. */
export const moneyStr = (v: Num | null | undefined) => D(v ?? 0).toFixed(2);
