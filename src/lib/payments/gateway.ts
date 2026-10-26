import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { D, Decimal, formatMoney, round2 } from "../money";
import { recalcInvoice } from "../billing/service";
import { notify } from "../notifications/service";

// Payment gateway adapter. Card data never touches this application: the
// customer pays on the provider's hosted page and the provider calls our
// webhook. An invoice is only marked paid after a verified webhook, never
// because someone visited a "success" URL.

export type GatewayEvent = { type: "payment.succeeded" | "payment.failed"; gatewayRef: string; invoiceToken: string; amount: string; currency: string };

export interface PaymentGateway {
  key: string;
  label: string;
  isSimulated: boolean;
  configured(): boolean;
  createCheckout(inv: { id: string; number: string; balance: Decimal; currency: string; paymentToken: string }): Promise<{ url: string }>;
  verifyWebhook(rawBody: string, headers: Headers): GatewayEvent | null;
}

const safeEq = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function simSign(body: string) {
  return createHmac("sha256", process.env.SIMULATED_GATEWAY_SECRET ?? "").update(body).digest("hex");
}

/** Clearly-labelled test gateway. Disabled in production unless explicitly allowed. */
export const simulatedGateway: PaymentGateway = {
  key: "simulated",
  label: "Simulated gateway (TEST MODE — no money moves)",
  isSimulated: true,
  configured: () => !!process.env.SIMULATED_GATEWAY_SECRET && (process.env.NODE_ENV !== "production" || process.env.ALLOW_SIMULATED_PAYMENTS === "true"),
  async createCheckout(inv) {
    return { url: `/pay/${inv.paymentToken}/simulate` };
  },
  verifyWebhook(rawBody, headers) {
    const sig = headers.get("x-sim-signature") ?? "";
    if (!this.configured() || !sig || !safeEq(sig, simSign(rawBody))) return null;
    return JSON.parse(rawBody) as GatewayEvent;
  },
};

/** Stripe Checkout adapter (hosted page). Active only when STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set. */
export const stripeGateway: PaymentGateway = {
  key: "stripe",
  label: "Stripe Checkout",
  isSimulated: false,
  configured: () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET,
  async createCheckout(inv) {
    const amountMinor = D(inv.balance).mul(100).toFixed(0);
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": inv.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": `Invoice ${inv.number}`,
      "line_items[0][price_data][unit_amount]": amountMinor,
      "line_items[0][quantity]": "1",
      "metadata[invoiceToken]": inv.paymentToken,
      "payment_intent_data[metadata][invoiceToken]": inv.paymentToken,
      success_url: `${process.env.APP_URL}/pay/${inv.paymentToken}?status=returned`,
      cancel_url: `${process.env.APP_URL}/pay/${inv.paymentToken}`,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw new AppError("The payment provider could not start checkout. Try again later.");
    const json = (await res.json()) as { url: string };
    return { url: json.url };
  },
  verifyWebhook(rawBody, headers) {
    const header = headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
    if (!parts.t || !parts.v1) return null;
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return null;
    const expected = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "").update(`${parts.t}.${rawBody}`).digest("hex");
    if (!safeEq(expected, parts.v1)) return null;
    const evt = JSON.parse(rawBody) as { type: string; data: { object: { id: string; amount_total: number; currency: string; metadata?: { invoiceToken?: string }; payment_status?: string } } };
    if (evt.type !== "checkout.session.completed" || evt.data.object.payment_status !== "paid") return null;
    const o = evt.data.object;
    return { type: "payment.succeeded", gatewayRef: o.id, invoiceToken: o.metadata?.invoiceToken ?? "", amount: new Decimal(o.amount_total).div(100).toFixed(2), currency: o.currency.toUpperCase() };
  },
};

const GATEWAYS: Record<string, PaymentGateway> = { simulated: simulatedGateway, stripe: stripeGateway };

export function activeGateway(): PaymentGateway | null {
  const g = GATEWAYS[process.env.PAYMENT_GATEWAY ?? ""];
  return g && g.configured() ? g : null;
}
export const gatewayByKey = (key: string) => GATEWAYS[key] ?? null;

/** Apply a verified gateway event. Idempotent: the provider's transaction id is unique. */
export async function applyGatewayEvent(gatewayKey: string, evt: GatewayEvent) {
  if (evt.type !== "payment.succeeded") return { applied: false, reason: "ignored" };
  const g = gatewayByKey(gatewayKey)!;
  const existing = await prisma.payment.findUnique({ where: { gatewayRef: evt.gatewayRef } });
  if (existing) return { applied: false, reason: "duplicate" };
  const inv = await prisma.invoice.findUnique({ where: { paymentToken: evt.invoiceToken } });
  if (!inv) throw new AppError("Unknown invoice token in payment notification.");
  if (inv.currency !== evt.currency) throw new AppError("Payment currency does not match the invoice.");
  const amount = round2(evt.amount);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${inv.id} FOR UPDATE`;
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const p = await tx.payment.create({
      data: { clientId: fresh.agencyId ? null : fresh.clientId, agencyId: fresh.agencyId, amount: amount.toFixed(2), currency: evt.currency, method: "ONLINE", reference: `${gatewayKey}:${evt.gatewayRef}`, gateway: gatewayKey, gatewayRef: evt.gatewayRef, receivedAt: new Date(), isSimulated: g.isSimulated, status: "CONFIRMED", notes: g.isSimulated ? "SIMULATED payment — not real money" : null },
    });
    const alloc = Decimal.min(amount, D(fresh.balance));
    if (alloc.gt(0) && !["DRAFT", "CANCELLED"].includes(fresh.status)) {
      await tx.paymentAllocation.create({ data: { paymentId: p.id, invoiceId: fresh.id, amount: alloc.toFixed(2) } });
      const after = await recalcInvoice(tx, fresh.id);
      await tx.financialTransaction.create({ data: { invoiceId: fresh.id, type: "PAYMENT_ALLOCATION", amount: alloc.neg().toFixed(2), balanceAfter: after.balance, reference: p.reference } });
    }
    await audit({ action: "payment.gateway", entityType: "Payment", entityId: p.id, after: { gateway: gatewayKey, invoice: fresh.number, amount: amount.toFixed(2), simulated: g.isSimulated } }, tx);
    return p;
  });
  await notify("payment.confirmed", { amount: formatMoney(result.amount, result.currency), reference: result.reference }, { link: `/payments/${result.id}` });
  return { applied: true, paymentId: result.id };
}
