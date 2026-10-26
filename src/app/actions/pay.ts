"use server";
import { redirect } from "next/navigation";
import { activeGateway, simulatedGateway, simSign, applyGatewayEvent, type GatewayEvent } from "@/lib/payments/gateway";
import { invoiceForToken } from "@/lib/payments/public";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import { randomBytes } from "node:crypto";

/** Public: start a hosted checkout for an invoice's outstanding balance. */
export async function startCheckoutAction(token: string) {
  let url: string;
  try {
    url = await checkoutUrl(token);
  } catch (e) {
    redirect(`/pay/${encodeURIComponent(token)}?error=${encodeURIComponent(e instanceof AppError ? e.message : "Online payment could not be started. Please try again later.")}`);
  }
  redirect(url);
}

async function checkoutUrl(token: string) {
  const { invoice, limited } = await invoiceForToken(token);
  if (limited) throw new AppError("Too many requests. Please wait a few minutes.");
  if (!invoice || !invoice.number || !invoice.paymentToken) throw new AppError("This payment link is not valid.");
  if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status) || D(invoice.balance).lte(0)) throw new AppError("This invoice has nothing left to pay.");
  const g = activeGateway();
  if (!g) throw new AppError("Online payment is not available. Please pay by bank transfer.");
  const { url } = await g.createCheckout({ id: invoice.id, number: invoice.number, balance: D(invoice.balance), currency: invoice.currency, paymentToken: invoice.paymentToken });
  return url;
}

/**
 * TEST MODE ONLY. Plays the role of the payment provider: builds a provider
 * notification, signs it with the simulated gateway secret and feeds it through
 * the same verification and idempotent apply path a real webhook uses.
 */
export async function simulateProviderAction(token: string, outcome: "succeeded" | "failed") {
  if (!simulatedGateway.configured() || activeGateway()?.key !== "simulated") throw new AppError("The simulated gateway is not enabled.");
  const { invoice } = await invoiceForToken(token);
  if (!invoice) throw new AppError("This payment link is not valid.");
  const evt: GatewayEvent = { type: outcome === "succeeded" ? "payment.succeeded" : "payment.failed", gatewayRef: `sim_${randomBytes(9).toString("hex")}`, invoiceToken: token, amount: D(invoice.balance).toFixed(2), currency: invoice.currency };
  const body = JSON.stringify(evt);
  const verified = simulatedGateway.verifyWebhook(body, new Headers({ "x-sim-signature": simSign(body) }));
  if (!verified) throw new AppError("Signature check failed.");
  await applyGatewayEvent("simulated", verified);
  redirect(`/pay/${token}?status=${outcome === "succeeded" ? "returned" : "failed"}`);
}
