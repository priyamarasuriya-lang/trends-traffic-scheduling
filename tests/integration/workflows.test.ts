import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { saveReleaseOrder, submitReleaseOrder, approveReleaseOrder, autoPlaceSpots } from "@/lib/sales/service";
import { invoiceFromReleaseOrder, issueInvoice, recordPayment, issueCreditNote } from "@/lib/billing/service";
import { applyGatewayEvent } from "@/lib/payments/gateway";
import { addEvent } from "@/lib/scheduling/service";
import { setSetting } from "@/lib/settings";
import { hasDb, uid, user, channel, client, commercial, breaks, day } from "./fixtures";

const DATE = "2027-03-01";

describe.skipIf(!hasDb)("booking, approval, invoicing and payments (database)", () => {
  let booker: Awaited<ReturnType<typeof user>>;
  let salesApprover: Awaited<ReturnType<typeof user>>;
  let financeApprover: Awaited<ReturnType<typeof user>>;
  let ch: Awaited<ReturnType<typeof channel>>;

  beforeAll(async () => {
    booker = await user(["ro.manage"], "booker");
    salesApprover = await user(["ro.approve.sales"], "sales");
    financeApprover = await user(["ro.approve.finance", "ro.schedule"], "finance");
    ch = await channel();
    await breaks(ch.id, DATE, ["08:00", "10:00", "12:00", "14:00"]);
    await setSetting("ro.approvalStages", { stages: [{ name: "Sales approval", permission: "ro.approve.sales" }, { name: "Finance approval", permission: "ro.approve.finance" }] });
  });

  async function ro(clientId: string, quantity: number, assetId: string | null = null) {
    const r = await saveReleaseOrder(booker, null, {
      clientId,
      campaignName: `Campaign ${uid()}`,
      startDate: day(DATE),
      endDate: day(DATE),
      currency: "USD",
      commissionPct: "0",
      taxRatePct: "10",
      lines: [{ channelId: ch.id, assetId, description: "30s spot", timeBand: "ANY", spotDurationSec: 30, quantity, rate: "100.00", discountPct: "0", startDate: day(DATE), endDate: day(DATE) }],
    });
    await submitReleaseOrder(booker, r.id);
    return r.id;
  }

  it("enforces approval permissions and separation of duties", async () => {
    const c = await client();
    const id = await ro(c.id, 1);
    await expect(approveReleaseOrder(financeApprover, id)).rejects.toThrow(/requires the "ro.approve.sales"/);
    const selfApprover = { ...booker, permissions: new Set(["ro.manage", "ro.approve.sales"]) };
    await expect(approveReleaseOrder(selfApprover, id)).rejects.toThrow(/created yourself/);
    await approveReleaseOrder(salesApprover, id);
    await expect(approveReleaseOrder(salesApprover, id)).rejects.toThrow(/requires the "ro.approve.finance"/);
    await prisma.releaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  });

  it("never books the same inventory twice when two ROs are approved at the same moment", async () => {
    const [a, b] = await Promise.all([client(), client()]);
    const [ra, rb] = await Promise.all([ro(a.id, 3), ro(b.id, 3)]);
    await approveReleaseOrder(salesApprover, ra);
    await approveReleaseOrder(salesApprover, rb);
    const results = await Promise.allSettled([approveReleaseOrder(financeApprover, ra), approveReleaseOrder(financeApprover, rb)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1); // only 4 positions exist; 3 + 3 cannot both fit
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/could be booked/);
    const taken = await prisma.advertisingInventory.findMany({ where: { break: { channelId: ch.id }, status: "BOOKED" } });
    expect(taken).toHaveLength(3);
    expect(new Set(taken.map((t) => t.id)).size).toBe(3);
    const loser = results[0].status === "rejected" ? ra : rb;
    expect((await prisma.releaseOrder.findUniqueOrThrow({ where: { id: loser } })).status).toBe("SUBMITTED"); // rolled back, nothing half-booked
    expect(await prisma.advertisingInventory.count({ where: { roLineItem: { releaseOrderId: loser } } })).toBe(0);
    // Free the positions for the next test.
    await prisma.advertisingInventory.updateMany({ where: { break: { channelId: ch.id } }, data: { status: "AVAILABLE", roLineItemId: null } });
    await prisma.releaseOrder.updateMany({ where: { id: { in: [ra, rb] } }, data: { status: "CANCELLED" } });
  });

  it("bills each aired spot once, even with two invoice runs at the same time, and keeps payments honest", async () => {
    const c = await client();
    const other = await client();
    const spot = await commercial(c.id);
    const id = await ro(c.id, 2, spot.id);
    await approveReleaseOrder(salesApprover, id);
    await approveReleaseOrder(financeApprover, id);
    const placed = await autoPlaceSpots(financeApprover, id);
    expect(placed).toMatchObject({ placed: 2, problems: [] });

    await setSetting("billing.billOn", { mode: "SCHEDULED" });
    const runs = await Promise.allSettled([invoiceFromReleaseOrder(financeApprover, id), invoiceFromReleaseOrder(financeApprover, id)]);
    expect(runs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(invoiceFromReleaseOrder(financeApprover, id)).rejects.toThrow(/no un-invoiced billable spots/);
    const inv = (runs.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;
    const spots = await prisma.scheduleEvent.findMany({ where: { roLineItem: { releaseOrderId: id } }, include: { invoiceLineItem: true } });
    expect(spots.every((s) => s.invoiceLineItem?.invoiceId === inv.id)).toBe(true);
    expect(await prisma.invoice.count({ where: { releaseOrderId: id } })).toBe(1);

    const issued = await issueInvoice(financeApprover, inv.id);
    expect(issued.total.toFixed(2)).toBe("220.00"); // 2 × 100 + 10% tax

    await expect(recordPayment(financeApprover, { clientId: other.id, amount: "50", currency: "USD", method: "BANK", reference: `R${uid()}`, receivedAt: new Date(), allocations: [{ invoiceId: inv.id, amount: "50" }] })).rejects.toThrow(/different payer/);
    await expect(recordPayment(financeApprover, { clientId: c.id, amount: "500", currency: "USD", method: "BANK", reference: `R${uid()}`, receivedAt: new Date(), allocations: [{ invoiceId: inv.id, amount: "500" }] })).rejects.toThrow(/outstanding/);
    await recordPayment(financeApprover, { clientId: c.id, amount: "100", currency: "USD", method: "BANK", reference: `R${uid()}`, receivedAt: new Date(), allocations: [{ invoiceId: inv.id, amount: "100" }] });
    let fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect([fresh.status, fresh.balance.toFixed(2)]).toEqual(["PARTIALLY_PAID", "120.00"]);

    await expect(issueCreditNote(financeApprover, inv.id, "500", "too much")).rejects.toThrow();

    // The same provider notification delivered twice at once must create one payment.
    const evt = { type: "payment.succeeded" as const, gatewayRef: `sim_${uid()}`, invoiceToken: fresh.paymentToken!, amount: "120.00", currency: "USD" };
    const deliveries = await Promise.allSettled([applyGatewayEvent("simulated", evt), applyGatewayEvent("simulated", evt)]);
    expect(deliveries.some((d) => d.status === "fulfilled" && d.value.applied)).toBe(true);
    expect(await prisma.payment.count({ where: { gatewayRef: evt.gatewayRef } })).toBe(1);
    fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect([fresh.status, fresh.balance.toFixed(2)]).toEqual(["PAID", "0.00"]);
    await expect(applyGatewayEvent("simulated", { ...evt, gatewayRef: `sim_${uid()}`, currency: "EUR" })).rejects.toThrow(/currency/);
  });

  it("lets only one of two overlapping events onto the timeline", async () => {
    const filler = await prisma.mediaAsset.create({ data: { assetCode: `F${uid()}`, title: "Filler", category: "FILLER", durationSec: 600, approvalStatus: "APPROVED" } });
    const actor = { id: booker.id, email: booker.email, canEditPublished: true };
    const start = new Date(`2027-03-02T15:00:00+05:30`);
    const results = await Promise.allSettled([addEvent(actor, { channelId: ch.id, assetId: filler.id, startAt: start }), addEvent(actor, { channelId: ch.id, assetId: filler.id, startAt: new Date(start.getTime() + 300_000) })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/conflict|overlap/i);
    expect(await prisma.scheduleEvent.count({ where: { channelId: ch.id, assetId: filler.id } })).toBe(1);
  });
});
