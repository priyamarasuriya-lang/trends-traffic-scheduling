"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zDate, zPct, zMoney, zOptId, zBool } from "@/lib/action";
import { AppError } from "@/lib/errors";
import * as billing from "@/lib/billing/service";
import { invoicePdf } from "@/lib/billing/pdf";
import { sendEmail } from "@/lib/notifications/email";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { formatMoney } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";

const actor = (u: CurrentUser) => ({ id: u.id, email: u.email });
const positive = zMoney.refine((v) => Number(v) > 0, "Must be more than zero");

const manualLine = z.object({
  description: zStr(300),
  quantity: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Quantity must be a number").refine((v) => Number(v) > 0, "Quantity must be positive"),
  unitPrice: zMoney.refine((v) => Number(v) >= 0, "Price cannot be negative"),
  discountPct: zPct.default("0"),
  commissionPct: zPct.default("0"),
  taxRatePct: zPct.default("0"),
});
const manualSchema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  agencyId: zOptId,
  currency: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase(),
  notes: zOptStr(2000),
  lines: z.string().transform((s, ctx) => {
    try {
      return z.array(manualLine).min(1, "Add at least one line").parse(JSON.parse(s));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof z.ZodError ? e.issues.map((i) => `Line ${Number(i.path[0]) + 1}: ${i.message}`).join("; ") : "Invalid lines" });
      return z.NEVER;
    }
  }),
});

export async function saveManualInvoiceAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    const p = manualSchema.parse(formToObject(fd));
    const inv = await billing.saveManualInvoice(actor(u), id, p);
    return { id: inv.id };
  }, "Invoice saved");
}

export async function issueInvoiceAction(id: string) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    const inv = await billing.issueInvoice(actor(u), id);
    return { number: inv.number };
  }, "Invoice issued");
}

export async function cancelInvoiceAction(id: string, reason: string) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    await billing.cancelInvoice(actor(u), id, z.string().trim().min(3, "Give a reason").max(500).parse(reason));
  }, "Invoice cancelled");
}

export async function deleteDraftInvoiceAction(id: string) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    await billing.deleteDraftInvoice(actor(u), id);
  }, "Draft deleted");
}

export async function creditNoteAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("creditnote.issue");
    const p = z.object({ invoiceId: zStr(), amount: positive, reason: zStr(500) }).parse(formToObject(fd));
    const cn = await billing.issueCreditNote(actor(u), p.invoiceId, p.amount, p.reason);
    return { number: cn.number };
  }, "Credit note issued");
}

const METHODS = ["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "ONLINE"] as const;

export async function recordPaymentAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("payment.record");
    const raw = formToObject(fd);
    const p = z
      .object({
        payer: z.string().regex(/^(client|agency):.+$/, "Choose who paid"),
        amount: positive,
        currency: z.string().trim().length(3).toUpperCase(),
        method: z.enum(METHODS),
        reference: zStr(120),
        receivedAt: zDate,
        notes: zOptStr(1000),
        autoAllocate: zBool,
        invoiceId: zOptId,
      })
      .parse(raw);
    const [kind, payerId] = p.payer.split(":");
    if (new Date(p.receivedAt) > new Date(Date.now() + 86400000)) throw new AppError("The received date cannot be in the future.");
    const dup = await prisma.payment.findUnique({ where: { method_reference: { method: p.method, reference: p.reference } } });
    if (dup) throw new AppError(`A ${p.method.replace("_", " ").toLowerCase()} payment with reference ${p.reference} is already recorded.`, "DUPLICATE");
    let allocations: { invoiceId: string; amount: string }[] | undefined;
    if (p.invoiceId) {
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
      const payerMatches = kind === "agency" ? inv.agencyId === payerId : inv.clientId === payerId && !inv.agencyId;
      if (!payerMatches) throw new AppError(`Invoice ${inv.number ?? ""} is billed to a different ${inv.agencyId ? "agency" : "client"}.`);
      const amt = Number(p.amount) < Number(inv.balance) ? p.amount : inv.balance.toFixed(2);
      allocations = [{ invoiceId: inv.id, amount: amt }];
    }
    const pay = await billing.recordPayment(actor(u), {
      clientId: kind === "client" ? payerId : null,
      agencyId: kind === "agency" ? payerId : null,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      reference: p.reference,
      receivedAt: new Date(p.receivedAt),
      notes: p.notes,
      allocations,
      autoAllocate: p.autoAllocate && !p.invoiceId,
    });
    return { id: pay.id };
  }, "Payment recorded");
}

export async function allocatePaymentAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("payment.record");
    const p = z.object({ paymentId: zStr(), invoiceId: z.string().min(1, "Choose an invoice"), amount: positive }).parse(formToObject(fd));
    await billing.allocatePayment(actor(u), p.paymentId, p.invoiceId, p.amount);
  }, "Payment allocated");
}

export async function removeAllocationAction(id: string, reason: string) {
  return run(async () => {
    const u = await requireUser("payment.record");
    await billing.removeAllocation(actor(u), id, z.string().trim().min(3, "Give a reason").max(500).parse(reason));
  }, "Allocation reversed");
}

export async function emailInvoiceAction(id: string, to: string) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    if (!rateLimit(`email-invoice:${u.id}`, 20, 3600_000).ok) throw new AppError("Too many invoice emails in the last hour. Try again later.");
    const email = z.string().trim().email("Enter a valid email address").parse(to);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status === "DRAFT" || inv.status === "CANCELLED") throw new AppError("Only issued invoices can be emailed.");
    const company = (await getSetting("company.profile")).name;
    const pdf = await invoicePdf(id);
    const link = inv.paymentToken && inv.balance.gt(0) && process.env.APP_URL ? `\n\nPay online: ${process.env.APP_URL}/pay/${inv.paymentToken}` : "";
    const ok = await sendEmail({
      to: email,
      subject: `Invoice ${inv.number} from ${company}`,
      text: `Please find invoice ${inv.number} attached.\n\nTotal ${formatMoney(inv.total, inv.currency)}, balance ${formatMoney(inv.balance, inv.currency)}, due ${inv.dueDate?.toISOString().slice(0, 10)}.${link}`,
      template: "invoice.email",
      attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes), contentType: "application/pdf" }],
    });
    await audit({ userId: u.id, userEmail: u.email, action: "invoice.email", entityType: "Invoice", entityId: id, after: { to: email, ok } });
    if (!ok) throw new AppError("The email could not be sent. See Settings → Email log for details.");
  }, "Invoice emailed");
}

export async function refreshOverdueAction() {
  return run(async () => {
    await requireUser("invoice.issue");
    return billing.refreshOverdue();
  }, "Overdue status refreshed");
}

// ───────────── Rate cards and tax rates ─────────────

const rateItem = z.object({ timeBand: z.enum(["PRIME", "DAY", "LATE", "ANY"]), position: z.enum(["ANY", "FIRST", "LAST"]).default("ANY"), baseDurationSec: z.coerce.number().int().min(1).max(3600), rate: zMoney.refine((v) => Number(v) >= 0, "Rate cannot be negative") });
const rateCardSchema = z.object({
  name: zStr(120),
  channelId: z.string().min(1, "Choose a channel"),
  clientId: zOptId,
  currency: z.string().trim().length(3).toUpperCase(),
  validFrom: zDate,
  validTo: z.preprocess((v) => (v === "" ? undefined : v), zDate.optional()),
  isActive: zBool,
  items: z.string().transform((s, ctx) => {
    try {
      const items = z.array(rateItem).min(1, "Add at least one rate").parse(JSON.parse(s));
      const keys = items.map((i) => `${i.timeBand}/${i.position}`);
      if (new Set(keys).size !== keys.length) throw new AppError("Each time band and position may appear once.");
      return items;
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof z.ZodError ? e.issues.map((i) => `Row ${Number(i.path[0]) + 1}: ${i.message}`).join("; ") : e instanceof Error ? e.message : "Invalid rates" });
      return z.NEVER;
    }
  }),
});

export async function saveRateCardAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("billing.manage");
    const p = rateCardSchema.parse(formToObject(fd));
    if (p.validTo && p.validTo < p.validFrom) throw new AppError("Valid-to must be on or after valid-from.");
    const data = { name: p.name, channelId: p.channelId, clientId: p.clientId ?? null, currency: p.currency, validFrom: new Date(p.validFrom), validTo: p.validTo ? new Date(p.validTo) : null, isActive: p.isActive };
    const card = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.rateCard.findUniqueOrThrow({ where: { id }, include: { items: true } }) : null;
      if (id) await tx.rateCardItem.deleteMany({ where: { rateCardId: id } });
      const card = id ? await tx.rateCard.update({ where: { id }, data: { ...data, items: { create: p.items } } }) : await tx.rateCard.create({ data: { ...data, items: { create: p.items } } });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "ratecard.update" : "ratecard.create", entityType: "RateCard", entityId: card.id, before, after: { ...data, items: p.items } }, tx);
      return card;
    });
    return { id: card.id };
  }, "Rate card saved");
}

export async function saveTaxRateAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("billing.manage");
    const p = z.object({ name: zStr(80), ratePct: zPct, jurisdiction: zOptStr(80), isDefault: zBool, isActive: zBool }).parse(formToObject(fd));
    if (p.isDefault && !p.isActive) throw new AppError("The default tax rate must be active.");
    await prisma.$transaction(async (tx) => {
      if (p.isDefault) await tx.taxRate.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
      const before = id ? await tx.taxRate.findUniqueOrThrow({ where: { id } }) : null;
      const t = id ? await tx.taxRate.update({ where: { id }, data: p }) : await tx.taxRate.create({ data: p });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "taxrate.update" : "taxrate.create", entityType: "TaxRate", entityId: t.id, before, after: p }, tx);
    });
  }, "Tax rate saved");
}

