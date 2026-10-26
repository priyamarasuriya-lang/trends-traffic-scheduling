import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError } from "../errors";
import { nextNumber } from "../numbering";
import { D, formatMoney, round2 } from "../money";
import { getSetting } from "../settings";
import { notify } from "../notifications/service";
import { autoAllocate, computeLine, computeTotals, deriveInvoiceStatus, invoiceBalance } from "./calc";
import { newToken } from "../auth/tokens";
import { txOpts } from "../scheduling/service";

export type BillingActor = { id: string; email: string };

/** Recompute cached paid/credited/balance/status from source rows. Call in every tx that touches them. */
export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const [alloc, credits] = await Promise.all([
    tx.paymentAllocation.aggregate({ where: { invoiceId, payment: { status: "CONFIRMED" } }, _sum: { amount: true } }),
    tx.creditNote.aggregate({ where: { invoiceId, status: "ISSUED" }, _sum: { amount: true } }),
  ]);
  const amountPaid = round2(alloc._sum.amount ?? 0);
  const creditedTotal = round2(credits._sum.amount ?? 0);
  const balance = invoiceBalance({ total: inv.total, amountPaid, creditedTotal });
  if (balance.lt(0)) throw new ConflictError(`This would leave invoice ${inv.number ?? "(draft)"} over-settled by ${formatMoney(balance.abs(), inv.currency)}.`);
  const status = deriveInvoiceStatus({ status: inv.status, total: inv.total, amountPaid, creditedTotal, dueDate: inv.dueDate });
  return tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: amountPaid.toFixed(2), creditedTotal: creditedTotal.toFixed(2), balance: balance.toFixed(2), status: status as never } });
}

async function ledger(tx: Tx, invoiceId: string, type: string, amount: string, userId: string | null, reference?: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await tx.financialTransaction.create({ data: { invoiceId, type, amount, balanceAfter: inv.balance, reference, userId } });
}

/** Spots of an RO that are billable now and not yet invoiced. */
export async function billableSpots(tx: Tx, releaseOrderId: string, until?: Date) {
  const billOn = (await getSetting("billing.billOn")).mode;
  return tx.scheduleEvent.findMany({
    where: {
      roLineItem: { releaseOrderId },
      invoiceLineItemId: null,
      status: billOn === "AIRED" ? "AIRED" : { in: ["PLANNED", "AIRED"] },
      ...(until ? { startAt: { lt: until } } : {}),
    },
    include: { roLineItem: true },
    orderBy: { startAt: "asc" },
  });
}

/**
 * Create a draft invoice from billable spots of a release order. Each spot is
 * linked to its invoice line with a conditional update (invoiceLineItemId IS
 * NULL), so the same spot can never be invoiced twice even under concurrency.
 */
export async function invoiceFromReleaseOrder(actor: BillingActor, releaseOrderId: string, until?: Date) {
  const taxBase = (await getSetting("billing.taxBase")).mode;
  return prisma.$transaction(async (tx) => {
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id: releaseOrderId } });
    if (!["APPROVED", "SCHEDULED", "COMPLETED"].includes(ro.status)) throw new AppError("Only approved, scheduled or completed release orders can be invoiced.");
    const spots = await billableSpots(tx, releaseOrderId, until);
    if (!spots.length) throw new AppError("There are no un-invoiced billable spots on this release order.");
    const byLine = new Map<string, typeof spots>();
    for (const s of spots) byLine.set(s.roLineItemId!, [...(byLine.get(s.roLineItemId!) ?? []), s]);
    const client = await tx.client.findUniqueOrThrow({ where: { id: ro.clientId } });
    const agency = ro.agencyId ? await tx.agency.findUnique({ where: { id: ro.agencyId } }) : null;
    const terms = agency?.creditTermsDays ?? client.creditTermsDays;
    const invoice = await tx.invoice.create({
      data: {
        clientId: ro.clientId,
        agencyId: ro.agencyId,
        releaseOrderId: ro.id,
        currency: ro.currency,
        periodStart: spots[0].startAt,
        periodEnd: spots[spots.length - 1].startAt,
        createdById: actor.id,
        notes: `Release order ${ro.number}${ro.clientRef ? ` / client ref ${ro.clientRef}` : ""}. Payment terms ${terms} days.`,
      },
    });
    const amounts = [];
    for (const [, list] of byLine) {
      const line = list[0].roLineItem!;
      const amt = computeLine({ quantity: list.length, unitPrice: line.rate, discountPct: line.discountPct, commissionPct: ro.commissionPct, taxRatePct: ro.taxRatePct }, taxBase);
      amounts.push(amt);
      const il = await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          roLineItemId: line.id,
          description: `${line.description} (${line.spotDurationSec}s) × ${list.length} spot(s)`,
          quantity: list.length,
          unitPrice: line.rate,
          discountPct: line.discountPct,
          commissionPct: ro.commissionPct,
          taxRatePct: ro.taxRatePct,
          grossAmount: amt.grossAmount.toFixed(2),
          discountAmount: amt.discountAmount.toFixed(2),
          commissionAmount: amt.commissionAmount.toFixed(2),
          taxAmount: amt.taxAmount.toFixed(2),
          totalAmount: amt.totalAmount.toFixed(2),
        },
      });
      const claimed = await tx.scheduleEvent.updateMany({ where: { id: { in: list.map((s) => s.id) }, invoiceLineItemId: null }, data: { invoiceLineItemId: il.id } });
      if (claimed.count !== list.length) throw new ConflictError("Some of these spots were invoiced by someone else a moment ago. Refresh and try again.");
    }
    const t = computeTotals(amounts);
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { subtotal: t.grossAmount.toFixed(2), discountTotal: t.discountAmount.toFixed(2), commissionTotal: t.commissionAmount.toFixed(2), taxTotal: t.taxAmount.toFixed(2), total: t.totalAmount.toFixed(2), balance: t.totalAmount.toFixed(2) },
    });
    await audit({ userId: actor.id, userEmail: actor.email, action: "invoice.create", entityType: "Invoice", entityId: invoice.id, after: { releaseOrder: ro.number, spots: spots.length, total: t.totalAmount.toFixed(2) } }, tx);
    return invoice;
  }, txOpts);
}

export type ManualLine = { description: string; quantity: string; unitPrice: string; discountPct: string; commissionPct: string; taxRatePct: string };

export async function saveManualInvoice(actor: BillingActor, id: string | null, input: { clientId: string; agencyId?: string | null; currency: string; notes?: string | null; lines: ManualLine[] }) {
  if (!input.lines.length) throw new AppError("Add at least one invoice line.");
  const taxBase = (await getSetting("billing.taxBase")).mode;
  return prisma.$transaction(async (tx) => {
    if (id) {
      const ex = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (ex.status !== "DRAFT" || !ex.isManual) throw new AppError("Only draft manual invoices can be edited.");
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    }
    const priced = input.lines.map((l) => ({ l, amt: computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, commissionPct: l.commissionPct, taxRatePct: l.taxRatePct }, taxBase) }));
    const t = computeTotals(priced.map((p) => p.amt));
    const header = {
      clientId: input.clientId,
      agencyId: input.agencyId || null,
      currency: input.currency,
      notes: input.notes,
      isManual: true,
      subtotal: t.grossAmount.toFixed(2),
      discountTotal: t.discountAmount.toFixed(2),
      commissionTotal: t.commissionAmount.toFixed(2),
      taxTotal: t.taxAmount.toFixed(2),
      total: t.totalAmount.toFixed(2),
      balance: t.totalAmount.toFixed(2),
    };
    const lines = priced.map(({ l, amt }) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      commissionPct: l.commissionPct,
      taxRatePct: l.taxRatePct,
      grossAmount: amt.grossAmount.toFixed(2),
      discountAmount: amt.discountAmount.toFixed(2),
      commissionAmount: amt.commissionAmount.toFixed(2),
      taxAmount: amt.taxAmount.toFixed(2),
      totalAmount: amt.totalAmount.toFixed(2),
    }));
    const inv = id
      ? await tx.invoice.update({ where: { id }, data: { ...header, lines: { create: lines } } })
      : await tx.invoice.create({ data: { ...header, createdById: actor.id, lines: { create: lines } } });
    await audit({ userId: actor.id, userEmail: actor.email, action: id ? "invoice.update" : "invoice.create_manual", entityType: "Invoice", entityId: inv.id, after: { ...header, lines } }, tx);
    return inv;
  });
}

export async function issueInvoice(actor: BillingActor, id: string) {
  const inv = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { client: true, agency: true, lines: true } });
    if (inv.status !== "DRAFT") throw new AppError("Only draft invoices can be issued.");
    if (!inv.lines.length || D(inv.total).lte(0)) throw new AppError("An invoice must have lines and a positive total before it is issued.");
    const terms = inv.agency?.creditTermsDays ?? inv.client.creditTermsDays;
    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + terms * 86400000);
    await tx.invoice.update({ where: { id }, data: { number: await nextNumber(tx, "INVOICE"), status: "ISSUED", issueDate, dueDate, paymentToken: newToken() } });
    const after = await recalcInvoice(tx, id);
    await ledger(tx, id, "ISSUE", after.total.toFixed(2), actor.id, after.number ?? undefined);
    await audit({ userId: actor.id, userEmail: actor.email, action: "invoice.issue", entityType: "Invoice", entityId: id, after: { number: after.number, total: after.total, dueDate } }, tx);
    return { ...after, client: inv.client, agency: inv.agency };
  });
  const company = (await getSetting("company.profile")).name;
  const recipient = inv.agency?.email ?? inv.client.email;
  await notify(
    "invoice.issued",
    { number: inv.number, company, total: formatMoney(inv.total, inv.currency), dueDate: inv.dueDate?.toISOString().slice(0, 10), payLink: inv.paymentToken ? `\nPay online: ${process.env.APP_URL ?? ""}/pay/${inv.paymentToken}` : "" },
    { link: `/invoices/${inv.id}`, emails: recipient ? [recipient] : [] },
  );
  return inv;
}

export async function cancelInvoice(actor: BillingActor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Give a reason for cancelling the invoice.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status === "CANCELLED") throw new AppError("The invoice is already cancelled.");
    if (D(inv.amountPaid).gt(0) || D(inv.creditedTotal).gt(0)) throw new AppError("This invoice has payments or credit notes. Issue a credit note for the remaining balance instead of cancelling.");
    // Release the spots so they can be invoiced again correctly.
    await tx.scheduleEvent.updateMany({ where: { invoiceLineItem: { invoiceId: id } }, data: { invoiceLineItemId: null } });
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", balance: 0, notes: `${inv.notes ?? ""}\nCancelled: ${reason}`.trim() } });
    if (inv.number) await ledger(tx, id, "CANCEL", D(inv.total).neg().toFixed(2), actor.id, reason);
    await audit({ userId: actor.id, userEmail: actor.email, action: "invoice.cancel", entityType: "Invoice", entityId: id, before: { status: inv.status }, after: { status: "CANCELLED", reason } }, tx);
  });
}

export async function deleteDraftInvoice(actor: BillingActor, id: string) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== "DRAFT") throw new AppError("Only draft invoices can be deleted. Cancel issued invoices instead.");
    await tx.scheduleEvent.updateMany({ where: { invoiceLineItem: { invoiceId: id } }, data: { invoiceLineItemId: null } });
    await tx.invoice.delete({ where: { id } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "invoice.delete_draft", entityType: "Invoice", entityId: id, before: inv }, tx);
  });
}

// ───────────────────────── Payments ─────────────────────────

export type PaymentIn = { clientId?: string | null; agencyId?: string | null; amount: string; currency: string; method: string; reference: string; receivedAt: Date; notes?: string | null; allocations?: { invoiceId: string; amount: string }[]; autoAllocate?: boolean };

async function unallocated(tx: Tx, paymentId: string) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const a = await tx.paymentAllocation.aggregate({ where: { paymentId }, _sum: { amount: true } });
  return { payment: p, left: round2(D(p.amount).sub(D(a._sum.amount ?? 0))) };
}

async function allocateTx(tx: Tx, actor: BillingActor, paymentId: string, invoiceId: string, amount: string) {
  const amt = round2(amount);
  if (amt.lte(0)) throw new AppError("Allocation amount must be positive.");
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const { payment, left } = await unallocated(tx, paymentId);
  if (payment.status !== "CONFIRMED") throw new AppError("Only confirmed payments can be allocated.");
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (["DRAFT", "CANCELLED"].includes(inv.status)) throw new AppError(`Invoice ${inv.number ?? "(draft)"} is ${inv.status.toLowerCase()} and cannot take payments.`);
  const samePayer = payment.agencyId ? inv.agencyId === payment.agencyId : inv.clientId === payment.clientId && !inv.agencyId;
  if (!samePayer) throw new AppError(`Invoice ${inv.number} is billed to a different payer than this payment.`);
  if (inv.currency !== payment.currency) throw new AppError(`Currency mismatch: payment is ${payment.currency}, invoice is ${inv.currency}.`);
  if (amt.gt(left)) throw new AppError(`Only ${formatMoney(left, payment.currency)} of this payment is unallocated.`);
  if (amt.gt(D(inv.balance))) throw new AppError(`Invoice ${inv.number} has only ${formatMoney(inv.balance, inv.currency)} outstanding.`);
  await tx.paymentAllocation.create({ data: { paymentId, invoiceId, amount: amt.toFixed(2), createdById: actor.id } });
  await recalcInvoice(tx, invoiceId);
  await ledger(tx, invoiceId, "PAYMENT_ALLOCATION", amt.neg().toFixed(2), actor.id, payment.reference);
  await audit({ userId: actor.id, userEmail: actor.email, action: "payment.allocate", entityType: "Invoice", entityId: invoiceId, after: { paymentId, amount: amt.toFixed(2) } }, tx);
}

export async function recordPayment(actor: BillingActor, input: PaymentIn) {
  if (!input.clientId && !input.agencyId) throw new AppError("Choose the paying client or agency.");
  const amount = round2(input.amount);
  if (amount.lte(0)) throw new AppError("Payment amount must be positive.");
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { clientId: input.clientId || null, agencyId: input.agencyId || null, amount: amount.toFixed(2), currency: input.currency, method: input.method, reference: input.reference, receivedAt: input.receivedAt, notes: input.notes, createdById: actor.id, status: "CONFIRMED" },
    });
    await audit({ userId: actor.id, userEmail: actor.email, action: "payment.record", entityType: "Payment", entityId: p.id, after: p }, tx);
    for (const a of input.allocations ?? []) if (D(a.amount).gt(0)) await allocateTx(tx, actor, p.id, a.invoiceId, a.amount);
    if (input.autoAllocate) {
      const { left } = await unallocated(tx, p.id);
      const open = await tx.invoice.findMany({
        where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, currency: input.currency, ...(input.agencyId ? { agencyId: input.agencyId } : { clientId: input.clientId!, agencyId: null }) },
      });
      for (const a of autoAllocate(left, open.map((i) => ({ id: i.id, balance: i.balance, dueDate: i.dueDate })))) await allocateTx(tx, actor, p.id, a.invoiceId, a.amount.toFixed(2));
    }
    return p;
  }, txOpts);
  await notify("payment.confirmed", { amount: formatMoney(payment.amount, payment.currency), reference: payment.reference }, { link: `/payments/${payment.id}` });
  return payment;
}

export async function allocatePayment(actor: BillingActor, paymentId: string, invoiceId: string, amount: string) {
  return prisma.$transaction((tx) => allocateTx(tx, actor, paymentId, invoiceId, amount), txOpts);
}

export async function removeAllocation(actor: BillingActor, allocationId: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Give a reason for reversing the allocation.");
  return prisma.$transaction(async (tx) => {
    const a = await tx.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { payment: true } });
    await tx.paymentAllocation.delete({ where: { id: allocationId } });
    await recalcInvoice(tx, a.invoiceId);
    await ledger(tx, a.invoiceId, "ADJUSTMENT", a.amount.toFixed(2), actor.id, `Allocation reversed: ${reason}`);
    await audit({ userId: actor.id, userEmail: actor.email, action: "payment.unallocate", entityType: "Invoice", entityId: a.invoiceId, before: a, after: { reason } }, tx);
  });
}

// ───────────────────────── Credit notes ─────────────────────────

export async function issueCreditNote(actor: BillingActor, invoiceId: string, amount: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Give a reason for the credit note.");
  const amt = round2(amount);
  if (amt.lte(0)) throw new AppError("Credit amount must be positive.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (["DRAFT", "CANCELLED"].includes(inv.status)) throw new AppError("Credit notes can only be issued against issued invoices.");
    if (amt.gt(D(inv.balance))) throw new AppError(`The credit (${formatMoney(amt, inv.currency)}) exceeds the outstanding balance (${formatMoney(inv.balance, inv.currency)}). Reverse payment allocations first if you need to refund.`);
    const cn = await tx.creditNote.create({ data: { number: await nextNumber(tx, "CREDIT_NOTE"), invoiceId, amount: amt.toFixed(2), reason, createdById: actor.id } });
    await recalcInvoice(tx, invoiceId);
    await ledger(tx, invoiceId, "CREDIT_NOTE", amt.neg().toFixed(2), actor.id, cn.number);
    await audit({ userId: actor.id, userEmail: actor.email, action: "creditnote.issue", entityType: "Invoice", entityId: invoiceId, after: cn }, tx);
    return cn;
  });
}

/** Daily job: flag overdue invoices and send reminders. Safe to run repeatedly. */
export async function refreshOverdue(now = new Date()) {
  const due = await prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: now }, balance: { gt: 0 } }, include: { client: true } });
  for (const inv of due) {
    await prisma.$transaction((tx) => recalcInvoice(tx, inv.id));
    await notify("invoice.overdue", { number: inv.number, client: inv.client.name, balance: formatMoney(inv.balance, inv.currency), dueDate: inv.dueDate?.toISOString().slice(0, 10) }, { link: `/invoices/${inv.id}` });
  }
  const days = (await getSetting("notifications.paymentReminderDays")).days;
  const soon = await prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { gte: now, lt: new Date(now.getTime() + days * 86400000) }, balance: { gt: 0 } } });
  for (const inv of soon) {
    // One reminder per invoice and due date, however often the job runs.
    const key = `reminder:${inv.id}:${inv.dueDate?.toISOString().slice(0, 10)}`;
    if (await prisma.auditLog.findFirst({ where: { action: "job.notice", entityId: key }, select: { id: true } })) continue;
    await prisma.auditLog.create({ data: { action: "job.notice", entityType: "Invoice", entityId: key } });
    await notify("invoice.reminder", { number: inv.number, balance: formatMoney(inv.balance, inv.currency), dueDate: inv.dueDate?.toISOString().slice(0, 10) }, { link: `/invoices/${inv.id}` });
  }
  return { overdue: due.length, reminders: soon.length };
}
