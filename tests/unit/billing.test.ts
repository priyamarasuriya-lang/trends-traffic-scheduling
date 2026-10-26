import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, spotRate, invoiceBalance, deriveInvoiceStatus, autoAllocate } from "@/lib/billing/calc";
import { D, formatMoney } from "@/lib/money";

describe("billing calculations", () => {
  it("computes a line with discount, commission and tax after commission", () => {
    const l = computeLine({ quantity: 10, unitPrice: "150.00", discountPct: 10, commissionPct: 15, taxRatePct: 18 });
    expect(l.grossAmount.toFixed(2)).toBe("1500.00");
    expect(l.discountAmount.toFixed(2)).toBe("150.00");
    expect(l.netAmount.toFixed(2)).toBe("1350.00");
    expect(l.commissionAmount.toFixed(2)).toBe("202.50");
    expect(l.taxAmount.toFixed(2)).toBe("206.55"); // 18% of 1147.50
    expect(l.totalAmount.toFixed(2)).toBe("1354.05");
  });

  it("can tax the amount before commission", () => {
    const l = computeLine({ quantity: 1, unitPrice: 1000, commissionPct: 15, taxRatePct: 10 }, "BEFORE_COMMISSION");
    expect(l.taxAmount.toFixed(2)).toBe("100.00");
    expect(l.totalAmount.toFixed(2)).toBe("950.00");
  });

  it("rounds half-up per line with no binary floating-point drift", () => {
    const l = computeLine({ quantity: 3, unitPrice: "0.10", taxRatePct: "12.5" });
    expect(l.grossAmount.toFixed(2)).toBe("0.30");
    expect(l.taxAmount.toFixed(2)).toBe("0.04"); // 0.0375 → 0.04
    const t = computeTotals([l, l, l]);
    expect(t.totalAmount.toFixed(2)).toBe("1.02");
  });

  it("pro-rates rate card prices by spot duration", () => {
    expect(spotRate("300.00", 30, 45).toFixed(2)).toBe("450.00");
    expect(spotRate("100.00", 30, 10).toFixed(2)).toBe("33.33");
  });

  it("derives invoice status from amounts and due date", () => {
    const base = { status: "ISSUED", total: "100.00", amountPaid: "0", creditedTotal: "0", dueDate: new Date("2026-12-01") };
    const today = new Date("2026-11-01");
    expect(deriveInvoiceStatus(base, today)).toBe("ISSUED");
    expect(deriveInvoiceStatus({ ...base, amountPaid: "40" }, today)).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus({ ...base, amountPaid: "100" }, today)).toBe("PAID");
    expect(deriveInvoiceStatus({ ...base, creditedTotal: "100" }, today)).toBe("CREDITED");
    expect(deriveInvoiceStatus({ ...base, amountPaid: "60", creditedTotal: "40" }, today)).toBe("PAID");
    expect(deriveInvoiceStatus(base, new Date("2026-12-02"))).toBe("OVERDUE");
    expect(deriveInvoiceStatus({ ...base, status: "CANCELLED" }, today)).toBe("CANCELLED");
    expect(invoiceBalance({ total: "100", amountPaid: "33.33", creditedTotal: "10" }).toFixed(2)).toBe("56.67");
  });

  it("allocates payments oldest due first and never over any balance", () => {
    const out = autoAllocate("150", [
      { id: "new", balance: "100", dueDate: new Date("2026-12-01") },
      { id: "old", balance: "80", dueDate: new Date("2026-10-01") },
      { id: "paid", balance: "0", dueDate: new Date("2026-09-01") },
    ]);
    expect(out.map((a) => [a.invoiceId, a.amount.toFixed(2)])).toEqual([
      ["old", "80.00"],
      ["new", "70.00"],
    ]);
  });

  it("formats money in the given currency", () => {
    expect(formatMoney(D("1234.5"), "USD")).toContain("1,234.50");
  });
});
