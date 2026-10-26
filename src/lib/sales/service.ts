import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError, PermissionError } from "../errors";
import { nextNumber } from "../numbering";
import { computeLine, computeTotals } from "../billing/calc";
import { formatMoney } from "../money";
import { getSetting, type ApprovalStage } from "../settings";
import { availabilityFor, bookLine, releaseLine } from "../inventory/service";
import { relayoutBreak, txOpts } from "../scheduling/service";
import { notify } from "../notifications/service";

export type SalesActor = { id: string; email: string; name: string; permissions: Set<string> };

// ───────────────────────── Deals ─────────────────────────

export type DealLineIn = { channelId: string; product: string; timeBand?: string | null; spotDurationSec: number; quantity: number; rate: string; discountPct: string };
export type DealIn = {
  agencyId?: string | null;
  clientId: string;
  campaignName: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  discountPct: string;
  commissionPct: string;
  taxRatePct: string;
  notes?: string | null;
  lines: DealLineIn[];
};

function priceDeal(input: DealIn) {
  const lines = input.lines.map((l) => {
    const disc = (Number(l.discountPct) || 0) + (Number(input.discountPct) || 0);
    const amt = computeLine({ quantity: l.quantity, unitPrice: l.rate, discountPct: Math.min(100, disc), commissionPct: input.commissionPct, taxRatePct: input.taxRatePct });
    return { line: l, amt };
  });
  return { lines, totals: computeTotals(lines.map((x) => x.amt)) };
}

function checkPeriod(start: Date, end: Date) {
  if (end < start) throw new AppError("The end date must be on or after the start date.");
}

export async function saveDeal(actor: SalesActor, id: string | null, input: DealIn) {
  checkPeriod(input.startDate, input.endDate);
  if (!input.lines.length) throw new AppError("Add at least one line to the deal.");
  const { lines, totals } = priceDeal(input);
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.deal.findUniqueOrThrow({ where: { id }, include: { lines: true } }) : null;
    if (before && ["CLOSED", "CANCELLED"].includes(before.status)) throw new AppError(`A ${before.status.toLowerCase()} deal cannot be edited.`);
    const data = {
      agencyId: input.agencyId || null,
      clientId: input.clientId,
      campaignName: input.campaignName,
      startDate: input.startDate,
      endDate: input.endDate,
      currency: input.currency,
      discountPct: input.discountPct,
      commissionPct: input.commissionPct,
      taxRatePct: input.taxRatePct,
      notes: input.notes,
      grossAmount: totals.grossAmount.toFixed(2),
      discountAmount: totals.discountAmount.toFixed(2),
      commissionAmount: totals.commissionAmount.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
    };
    const lineData = lines.map(({ line, amt }) => ({
      channelId: line.channelId,
      product: line.product,
      timeBand: line.timeBand || null,
      spotDurationSec: line.spotDurationSec,
      quantity: line.quantity,
      rate: line.rate,
      discountPct: line.discountPct,
      grossAmount: amt.grossAmount.toFixed(2),
      netAmount: amt.netAmount.toFixed(2),
    }));
    let deal;
    if (before) {
      await tx.dealLineItem.deleteMany({ where: { dealId: before.id } });
      deal = await tx.deal.update({ where: { id: before.id }, data: { ...data, lines: { create: lineData } } });
    } else {
      deal = await tx.deal.create({ data: { ...data, number: await nextNumber(tx, "DEAL"), createdById: actor.id, lines: { create: lineData } } });
    }
    await audit({ userId: actor.id, userEmail: actor.email, action: before ? "deal.update" : "deal.create", entityType: "Deal", entityId: deal.id, before, after: { ...data, lines: lineData } }, tx);
    return deal;
  });
}

export async function setDealStatus(actor: SalesActor, id: string, status: "NEGOTIATION" | "CONFIRMED" | "CLOSED" | "CANCELLED", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.deal.findUniqueOrThrow({ where: { id } });
    const allowed: Record<string, string[]> = { DRAFT: ["NEGOTIATION", "CONFIRMED", "CANCELLED"], NEGOTIATION: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["CLOSED", "CANCELLED"], CLOSED: [], CANCELLED: [] };
    if (!allowed[d.status].includes(status)) throw new AppError(`A ${d.status.toLowerCase()} deal cannot move to ${status.toLowerCase()}.`);
    const history = [...((d.approvalHistory as object[]) ?? []), { at: new Date().toISOString(), by: actor.name, from: d.status, to: status, comment }];
    const updated = await tx.deal.update({ where: { id }, data: { status, approvalHistory: history } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "deal.status", entityType: "Deal", entityId: id, before: { status: d.status }, after: { status, comment } }, tx);
    return updated;
  });
}

// ───────────────────────── Release orders ─────────────────────────

export type ROLineIn = {
  id?: string;
  channelId: string;
  assetId?: string | null;
  description: string;
  timeBand?: string | null;
  spotDurationSec: number;
  quantity: number;
  rate: string;
  discountPct: string;
  startDate: Date;
  endDate: Date;
  maxPerDay?: number | null;
};
export type ROIn = {
  dealId?: string | null;
  agencyId?: string | null;
  clientId: string;
  campaignName: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  commissionPct: string;
  taxRatePct: string;
  clientRef?: string | null;
  notes?: string | null;
  lines: ROLineIn[];
};

const EDITABLE: string[] = ["DRAFT", "REJECTED"];

async function validateRoInput(tx: Tx, input: ROIn) {
  checkPeriod(input.startDate, input.endDate);
  if (!input.lines.length) throw new AppError("Add at least one line to the release order.");
  const client = await tx.client.findUnique({ where: { id: input.clientId } });
  if (!client || client.deletedAt) throw new AppError("Choose a valid client.");
  if (client.status === "BLOCKED") throw new AppError(`${client.name} is blocked; new bookings are not allowed.`);
  for (const [i, l] of input.lines.entries()) {
    checkPeriod(l.startDate, l.endDate);
    if (l.startDate < input.startDate || l.endDate > input.endDate) throw new AppError(`Line ${i + 1} dates must fall within the campaign period.`);
    if (l.assetId) {
      const a = await tx.mediaAsset.findUnique({ where: { id: l.assetId } });
      if (!a || a.category !== "COMMERCIAL") throw new AppError(`Line ${i + 1}: the material must be a commercial.`);
      if (a.advertiserId && a.advertiserId !== input.clientId) throw new AppError(`Line ${i + 1}: "${a.title}" belongs to a different advertiser.`);
      if (a.durationSec > l.spotDurationSec) throw new AppError(`Line ${i + 1}: "${a.title}" is ${a.durationSec}s, longer than the booked ${l.spotDurationSec}s.`);
    }
  }
  if (input.dealId) {
    const deal = await tx.deal.findUnique({ where: { id: input.dealId } });
    if (!deal || deal.clientId !== input.clientId) throw new AppError("The selected deal belongs to a different client.");
    if (deal.status === "CANCELLED") throw new AppError("The selected deal is cancelled.");
  }
}

function priceRo(input: ROIn) {
  const priced = input.lines.map((l) => ({ line: l, amt: computeLine({ quantity: l.quantity, unitPrice: l.rate, discountPct: l.discountPct, commissionPct: input.commissionPct, taxRatePct: input.taxRatePct }) }));
  return { priced, totals: computeTotals(priced.map((p) => p.amt)) };
}

export async function saveReleaseOrder(actor: SalesActor, id: string | null, input: ROIn) {
  return prisma.$transaction(async (tx) => {
    await validateRoInput(tx, input);
    const before = id ? await tx.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } }) : null;
    if (before && !EDITABLE.includes(before.status)) throw new AppError(`An ${before.status.toLowerCase()} release order is locked. Use "Amend" to create a controlled revision.`, "RO_LOCKED");
    const { priced, totals } = priceRo(input);
    const header = {
      dealId: input.dealId || null,
      agencyId: input.agencyId || null,
      clientId: input.clientId,
      campaignName: input.campaignName,
      startDate: input.startDate,
      endDate: input.endDate,
      currency: input.currency,
      commissionPct: input.commissionPct,
      taxRatePct: input.taxRatePct,
      clientRef: input.clientRef,
      notes: input.notes,
      grossAmount: totals.grossAmount.toFixed(2),
      discountAmount: totals.discountAmount.toFixed(2),
      commissionAmount: totals.commissionAmount.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
    };
    const lineData = (p: (typeof priced)[number]) => ({
      channelId: p.line.channelId,
      assetId: p.line.assetId || null,
      description: p.line.description,
      timeBand: p.line.timeBand || null,
      spotDurationSec: p.line.spotDurationSec,
      quantity: p.line.quantity,
      rate: p.line.rate,
      discountPct: p.line.discountPct,
      startDate: p.line.startDate,
      endDate: p.line.endDate,
      maxPerDay: p.line.maxPerDay ?? null,
      grossAmount: p.amt.grossAmount.toFixed(2),
      netAmount: p.amt.netAmount.toFixed(2),
    });
    let ro;
    if (!before) {
      ro = await tx.releaseOrder.create({ data: { ...header, number: await nextNumber(tx, "RO"), createdById: actor.id, lines: { create: priced.map(lineData) } } });
    } else {
      ro = await tx.releaseOrder.update({ where: { id: before.id }, data: { ...header, status: "DRAFT" } });
      const keepIds = priced.map((p) => p.line.id).filter(Boolean) as string[];
      for (const old of before.lines.filter((l) => !keepIds.includes(l.id))) {
        const used = await tx.advertisingInventory.count({ where: { roLineItemId: old.id, status: { in: ["SCHEDULED", "AIRED"] } } });
        if (used) throw new AppError(`Line "${old.description}" already has scheduled spots and cannot be removed. Reduce its quantity instead.`);
        await releaseLine(tx, old.id, 0);
        await tx.releaseOrderLineItem.delete({ where: { id: old.id } });
      }
      for (const p of priced) {
        if (p.line.id && before.lines.some((l) => l.id === p.line.id)) await tx.releaseOrderLineItem.update({ where: { id: p.line.id }, data: lineData(p) });
        else await tx.releaseOrderLineItem.create({ data: { ...lineData(p), releaseOrderId: ro.id } });
      }
    }
    await audit({ userId: actor.id, userEmail: actor.email, action: before ? "ro.update" : "ro.create", entityType: "ReleaseOrder", entityId: ro.id, before, after: { ...header, lines: priced.map(lineData) } }, tx);
    return ro;
  }, txOpts).then(async (ro) => {
    if (!id) {
      const client = await prisma.client.findUnique({ where: { id: ro.clientId } });
      await notify("booking.created", { number: ro.number, client: client?.name, campaign: ro.campaignName, actor: actor.name }, { link: `/release-orders/${ro.id}` });
    }
    return ro;
  });
}

/** Create a draft RO pre-filled from a confirmed deal. */
export async function roFromDeal(actor: SalesActor, dealId: string) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId }, include: { lines: true } });
  if (deal.status !== "CONFIRMED") throw new AppError("Only confirmed deals can be converted into release orders.");
  return saveReleaseOrder(actor, null, {
    dealId: deal.id,
    agencyId: deal.agencyId,
    clientId: deal.clientId,
    campaignName: deal.campaignName,
    startDate: deal.startDate,
    endDate: deal.endDate,
    currency: deal.currency,
    commissionPct: deal.commissionPct.toString(),
    taxRatePct: deal.taxRatePct.toString(),
    lines: deal.lines.map((l) => ({
      channelId: l.channelId,
      description: l.product,
      timeBand: l.timeBand,
      spotDurationSec: l.spotDurationSec,
      quantity: l.quantity,
      rate: l.rate.toString(),
      discountPct: (Number(l.discountPct) + Number(deal.discountPct)).toString(),
      startDate: deal.startDate,
      endDate: deal.endDate,
    })),
  });
}

async function stages(): Promise<ApprovalStage[]> {
  const s = (await getSetting("ro.approvalStages")).stages;
  return s.length ? s : [{ name: "Approval", permission: "ro.approve.sales" }];
}

async function allocatedCount(tx: Tx, lineId: string) {
  return tx.advertisingInventory.count({ where: { roLineItemId: lineId, status: { notIn: ["CANCELLED", "AVAILABLE"] } } });
}

export async function submitReleaseOrder(actor: SalesActor, id: string) {
  const st = await stages();
  const ro = await prisma.$transaction(async (tx) => {
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, client: true } });
    if (!EDITABLE.includes(ro.status)) throw new AppError(`Only draft or rejected release orders can be submitted (this one is ${ro.status.toLowerCase()}).`);
    // Validate against inventory: each line must have enough free positions for the units not yet allocated.
    const shortages: string[] = [];
    for (const l of ro.lines) {
      const have = await allocatedCount(tx, l.id);
      const needed = l.quantity - have;
      if (needed < 0) {
        const scheduled = await tx.advertisingInventory.count({ where: { roLineItemId: l.id, status: { in: ["SCHEDULED", "AIRED"] } } });
        if (scheduled > l.quantity) shortages.push(`"${l.description}" has ${scheduled} spots already scheduled, more than the new quantity ${l.quantity}.`);
        continue;
      }
      const free = await availabilityFor(tx, l);
      if (free < needed) shortages.push(`"${l.description}" needs ${needed} spot(s) but only ${free} matching break(s) are free.`);
    }
    if (shortages.length) throw new ConflictError(`Not enough inventory: ${shortages.join(" ")}`, { shortages });
    const updated = await tx.releaseOrder.update({ where: { id }, data: { status: "SUBMITTED", approvalStage: 0 } });
    await tx.rOApproval.create({ data: { releaseOrderId: id, revision: ro.revision, stage: 0, stageName: st[0].name, action: "SUBMITTED", userId: actor.id, userName: actor.name } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "ro.submit", entityType: "ReleaseOrder", entityId: id, before: { status: ro.status }, after: { status: "SUBMITTED" } }, tx);
    return { ...updated, client: ro.client };
  }, txOpts);
  await notify("ro.submitted", { number: ro.number, client: ro.client.name, total: formatMoney(ro.totalAmount, ro.currency), stage: st[0].name }, { link: `/release-orders/${id}` });
  return ro;
}

export async function approveReleaseOrder(actor: SalesActor, id: string, comment?: string) {
  const st = await stages();
  const result = await prisma.$transaction(async (tx) => {
    // Row lock prevents two approvers advancing the same stage twice.
    await tx.$queryRaw`SELECT id FROM "ReleaseOrder" WHERE id = ${id} FOR UPDATE`;
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, client: true } });
    if (ro.status !== "SUBMITTED") throw new AppError(`This release order is ${ro.status.toLowerCase()}, not awaiting approval.`);
    const stage = st[Math.min(ro.approvalStage, st.length - 1)];
    if (!actor.permissions.has(stage.permission)) throw new PermissionError(`${stage.name} requires the "${stage.permission}" permission.`);
    if (ro.createdById === actor.id && !actor.permissions.has("settings.manage")) throw new PermissionError("You cannot approve a release order you created yourself.");
    await tx.rOApproval.create({ data: { releaseOrderId: id, revision: ro.revision, stage: ro.approvalStage, stageName: stage.name, action: "APPROVED", comment, userId: actor.id, userName: actor.name } });
    const last = ro.approvalStage >= st.length - 1;
    if (!last) {
      await tx.releaseOrder.update({ where: { id }, data: { approvalStage: ro.approvalStage + 1 } });
      await audit({ userId: actor.id, userEmail: actor.email, action: "ro.approve.stage", entityType: "ReleaseOrder", entityId: id, after: { stage: stage.name } }, tx);
      return { ro, final: false, nextStage: st[ro.approvalStage + 1].name, booked: 0 };
    }
    // Final approval: book inventory for every unallocated unit, all or nothing.
    let booked = 0;
    for (const l of ro.lines) {
      const have = await allocatedCount(tx, l.id);
      if (have > l.quantity) await releaseLine(tx, l.id, l.quantity);
      else booked += await bookLine(tx, l, l.quantity - have);
    }
    await tx.releaseOrder.update({ where: { id }, data: { status: "APPROVED" } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "ro.approve", entityType: "ReleaseOrder", entityId: id, before: { status: "SUBMITTED" }, after: { status: "APPROVED", booked } }, tx);
    return { ro, final: true, nextStage: null, booked };
  }, { ...txOpts, timeout: 60000 });
  if (result.final) await notify("ro.approved", { number: result.ro.number, client: result.ro.client.name, booked: result.booked }, { link: `/release-orders/${id}` });
  else await notify("ro.submitted", { number: result.ro.number, client: result.ro.client.name, total: formatMoney(result.ro.totalAmount, result.ro.currency), stage: result.nextStage }, { link: `/release-orders/${id}` });
  return result;
}

export async function rejectReleaseOrder(actor: SalesActor, id: string, comment: string) {
  if (!comment?.trim()) throw new AppError("Give a reason for the rejection.");
  const st = await stages();
  const ro = await prisma.$transaction(async (tx) => {
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id } });
    if (ro.status !== "SUBMITTED") throw new AppError("Only submitted release orders can be rejected.");
    const stage = st[Math.min(ro.approvalStage, st.length - 1)];
    if (!actor.permissions.has(stage.permission)) throw new PermissionError(`${stage.name} requires the "${stage.permission}" permission.`);
    await tx.rOApproval.create({ data: { releaseOrderId: id, revision: ro.revision, stage: ro.approvalStage, stageName: stage.name, action: "REJECTED", comment, userId: actor.id, userName: actor.name } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "ro.reject", entityType: "ReleaseOrder", entityId: id, after: { comment } }, tx);
    return { ...(await tx.releaseOrder.update({ where: { id }, data: { status: "REJECTED", approvalStage: 0 } })), stageName: stage.name };
  });
  await notify("ro.rejected", { number: ro.number, stage: ro.stageName, comment }, { link: `/release-orders/${id}`, userIds: ro.createdById ? [ro.createdById] : [] });
  return ro;
}

/** Controlled amendment of an approved/scheduled RO: snapshot, bump revision, back to draft. Bookings are kept. */
export async function amendReleaseOrder(actor: SalesActor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Give a reason for the amendment.");
  return prisma.$transaction(async (tx) => {
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (!["APPROVED", "SCHEDULED"].includes(ro.status)) throw new AppError("Only approved or scheduled release orders can be amended.");
    await tx.releaseOrderRevision.create({ data: { releaseOrderId: id, revision: ro.revision, snapshot: JSON.parse(JSON.stringify(ro)), reason, createdById: actor.id } });
    await tx.rOApproval.create({ data: { releaseOrderId: id, revision: ro.revision + 1, stage: 0, stageName: "Amendment", action: "AMENDED", comment: reason, userId: actor.id, userName: actor.name } });
    const updated = await tx.releaseOrder.update({ where: { id }, data: { status: "DRAFT", revision: ro.revision + 1, approvalStage: 0 } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "ro.amend", entityType: "ReleaseOrder", entityId: id, before: { status: ro.status, revision: ro.revision }, after: { status: "DRAFT", revision: ro.revision + 1, reason } }, tx);
    return updated;
  });
}

/** Cancel: unaired spots are removed from the schedule and inventory is released. */
export async function cancelReleaseOrder(actor: SalesActor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Give a reason for the cancellation.");
  return prisma.$transaction(async (tx) => {
    const ro = await tx.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (["CANCELLED", "COMPLETED"].includes(ro.status)) throw new AppError(`A ${ro.status.toLowerCase()} release order cannot be cancelled.`);
    const lineIds = ro.lines.map((l) => l.id);
    const aired = await tx.scheduleEvent.count({ where: { roLineItemId: { in: lineIds }, status: "AIRED" } });
    if (aired) throw new AppError(`${aired} spot(s) have already aired. Amend the RO to reduce quantities instead of cancelling.`);
    const events = await tx.scheduleEvent.findMany({ where: { roLineItemId: { in: lineIds } } });
    if (events.some((e) => e.invoiceLineItemId)) throw new AppError("Some spots are invoiced. Credit the invoice before cancelling.");
    for (const e of events) {
      await tx.contentPlayLog.deleteMany({ where: { eventId: e.id, status: "PLANNED" } });
      await tx.scheduleEvent.delete({ where: { id: e.id } });
      await tx.schedule.update({ where: { id: e.scheduleId }, data: { hasUnpublishedChanges: true } });
    }
    for (const b of [...new Set(events.map((e) => e.breakId).filter(Boolean))] as string[]) await relayoutBreak(tx, b);
    const released = await tx.advertisingInventory.updateMany({ where: { roLineItemId: { in: lineIds } }, data: { status: "AVAILABLE", roLineItemId: null, version: { increment: 1 } } });
    await tx.rOApproval.create({ data: { releaseOrderId: id, revision: ro.revision, stage: ro.approvalStage, stageName: "Cancellation", action: "CANCELLED", comment: reason, userId: actor.id, userName: actor.name } });
    const updated = await tx.releaseOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "ro.cancel", entityType: "ReleaseOrder", entityId: id, before: { status: ro.status }, after: { status: "CANCELLED", reason, spotsRemoved: events.length, inventoryReleased: released.count } }, tx);
    return updated;
  }, txOpts);
}

/**
 * Place spots for every BOOKED position of an approved RO, using each line's
 * commercial. Lines without material are skipped with an explanation.
 */
export async function autoPlaceSpots(actor: SalesActor & { canEditPublished: boolean }, id: string) {
  const ro = await prisma.releaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { inventory: { where: { status: "BOOKED" }, include: { break: true } } } } } });
  if (!["APPROVED", "SCHEDULED"].includes(ro.status)) throw new AppError("Spots can only be placed for approved release orders.");
  const { placeInBreak } = await import("../scheduling/service");
  let placed = 0;
  const problems: string[] = [];
  for (const line of ro.lines) {
    if (!line.assetId) {
      if (line.inventory.length) problems.push(`"${line.description}": no commercial material attached.`);
      continue;
    }
    for (const inv of line.inventory) {
      try {
        await placeInBreak(actor, { breakId: inv.breakId, assetId: line.assetId, roLineItemId: line.id, confirmPublishedEdit: actor.canEditPublished });
        placed++;
      } catch (e) {
        problems.push(`${inv.break.code} ${inv.break.startAt.toISOString().slice(0, 16).replace("T", " ")}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }
  return { placed, problems };
}
