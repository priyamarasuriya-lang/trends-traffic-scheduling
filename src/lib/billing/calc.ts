import { D, pct, round2, sum, type Num, Decimal } from "../money";

export type TaxBase = "AFTER_COMMISSION" | "BEFORE_COMMISSION";

export type LineInput = { quantity: Num; unitPrice: Num; discountPct?: Num; commissionPct?: Num; taxRatePct?: Num };

export type LineAmounts = {
  grossAmount: Decimal;
  discountAmount: Decimal;
  netAmount: Decimal;
  commissionAmount: Decimal;
  taxAmount: Decimal;
  totalAmount: Decimal;
};

/**
 * Line maths (all half-up to 2dp, rounded per line):
 *   gross      = qty × unit price
 *   discount   = gross × discount%
 *   net        = gross − discount
 *   commission = net × agency commission%
 *   tax        = (net − commission | net) × tax%   (per billing.taxBase)
 *   total      = net − commission + tax           (what the payer owes)
 */
export function computeLine(l: LineInput, taxBase: TaxBase = "AFTER_COMMISSION"): LineAmounts {
  const grossAmount = round2(D(l.quantity).mul(D(l.unitPrice)));
  const discountAmount = pct(grossAmount, l.discountPct ?? 0);
  const netAmount = grossAmount.sub(discountAmount);
  const commissionAmount = pct(netAmount, l.commissionPct ?? 0);
  const taxable = taxBase === "AFTER_COMMISSION" ? netAmount.sub(commissionAmount) : netAmount;
  const taxAmount = pct(taxable, l.taxRatePct ?? 0);
  const totalAmount = netAmount.sub(commissionAmount).add(taxAmount);
  return { grossAmount, discountAmount, netAmount, commissionAmount, taxAmount, totalAmount };
}

export function computeTotals(lines: LineAmounts[]) {
  return {
    grossAmount: sum(lines.map((l) => l.grossAmount)),
    discountAmount: sum(lines.map((l) => l.discountAmount)),
    netAmount: sum(lines.map((l) => l.netAmount)),
    commissionAmount: sum(lines.map((l) => l.commissionAmount)),
    taxAmount: sum(lines.map((l) => l.taxAmount)),
    totalAmount: sum(lines.map((l) => l.totalAmount)),
  };
}

/** Price of a spot from a rate card item: rate is per base duration and pro-rated by seconds. */
export function spotRate(ratePerBase: Num, baseDurationSec: number, spotDurationSec: number): Decimal {
  return round2(D(ratePerBase).mul(spotDurationSec).div(baseDurationSec));
}

export type InvoiceStatusInput = { status: string; total: Num; amountPaid: Num; creditedTotal: Num; dueDate: Date | null };

export function invoiceBalance(i: { total: Num; amountPaid: Num; creditedTotal: Num }): Decimal {
  return round2(D(i.total).sub(D(i.amountPaid)).sub(D(i.creditedTotal)));
}

/** Derive the lifecycle status from amounts and due date. DRAFT and CANCELLED are terminal/manual. */
export function deriveInvoiceStatus(i: InvoiceStatusInput, today = new Date()): string {
  if (i.status === "DRAFT" || i.status === "CANCELLED") return i.status;
  const bal = invoiceBalance(i);
  if (bal.lte(0)) return D(i.creditedTotal).gte(D(i.total)) ? "CREDITED" : D(i.amountPaid).gt(0) ? "PAID" : "CREDITED";
  if (i.dueDate && i.dueDate.getTime() < today.getTime()) return "OVERDUE";
  if (D(i.amountPaid).gt(0) || D(i.creditedTotal).gt(0)) return "PARTIALLY_PAID";
  return "ISSUED";
}

/** Split a payment across invoices oldest-due first. Returns allocations; never exceeds any balance. */
export function autoAllocate(paymentUnallocated: Num, invoices: { id: string; balance: Num; dueDate: Date | null }[]) {
  let left = D(paymentUnallocated);
  const out: { invoiceId: string; amount: Decimal }[] = [];
  const sorted = [...invoices].sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
  for (const inv of sorted) {
    if (left.lte(0)) break;
    const bal = D(inv.balance);
    if (bal.lte(0)) continue;
    const amt = Decimal.min(left, bal);
    out.push({ invoiceId: inv.id, amount: amt });
    left = left.sub(amt);
  }
  return out;
}
