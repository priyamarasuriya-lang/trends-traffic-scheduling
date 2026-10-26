// Database side of scheduling. Every mutation runs in one transaction that:
//  1. takes a per-channel advisory lock (serialises concurrent editors),
//  2. applies the change,
//  3. re-validates the whole affected window with the rules engine, and
//  4. rolls back with a ConflictError listing every violation if any blocking
//     rule fails. Nothing is ever silently overwritten.

import { Prisma, type AssetCategory } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError } from "../errors";
import { broadcastDateOf, broadcastDayRange, zonedToUtc, addDaysStr, fmtTz } from "../time";
import {
  blocking,
  DEFAULT_RULES,
  endOf,
  layoutBreak,
  ripple,
  validateSchedule,
  type Block,
  type EngineAsset,
  type EngineEvent,
  type RuleConfig,
  type RuleKey,
  type Violation,
} from "./engine";

export type Actor = { id: string; email: string; canEditPublished: boolean };

const SEPARATION_PAD_MS = 3 * 3600 * 1000;

export async function lockChannel(tx: Tx, channelId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sched:" + channelId}))`;
}

export async function loadRules(tx: Tx, channelId: string): Promise<RuleConfig[]> {
  const rows = await tx.schedulingRule.findMany({ where: { OR: [{ channelId: null }, { channelId }] } });
  return DEFAULT_RULES.map((def) => {
    const row = rows.find((r) => r.key === def.key && r.channelId === channelId) ?? rows.find((r) => r.key === def.key && r.channelId === null);
    return row ? { key: def.key as RuleKey, enabled: row.enabled, severity: row.severity as "ERROR" | "WARNING", params: { ...def.params, ...(row.params as object) } } : def;
  });
}

/** Validate a channel's events in [from, to) (plus padding for separation rules). */
export async function validateWindow(tx: Tx, channelId: string, from: Date, to: Date, changedEventIds?: Set<string>, changedBreakIds?: Set<string>): Promise<Violation[]> {
  const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId } });
  const pFrom = new Date(from.getTime() - SEPARATION_PAD_MS);
  const pTo = new Date(to.getTime() + SEPARATION_PAD_MS);
  const [events, breaks, rules] = await Promise.all([
    tx.scheduleEvent.findMany({
      where: { channelId, startAt: { gte: pFrom, lt: pTo }, status: { not: "CANCELLED" } },
      include: { roLineItem: true },
    }),
    tx.advertisingBreak.findMany({ where: { channelId, startAt: { gte: pFrom, lt: pTo } } }),
    loadRules(tx, channelId),
  ]);
  const assetIds = [...new Set(events.map((e) => e.assetId))];
  const assets = await tx.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    include: { licenses: { where: { deletedAt: null } }, promo: { include: { campaign: true } } },
  });
  const windowIds = events.map((e) => e.id);
  const [totalPlays, manualConfirmed] = await Promise.all([
    tx.scheduleEvent.groupBy({ by: ["assetId"], where: { assetId: { in: assetIds }, status: { not: "CANCELLED" }, id: { notIn: windowIds } }, _count: true }),
    tx.contentPlayLog.groupBy({ by: ["assetId"], where: { assetId: { in: assetIds }, status: "CONFIRMED", eventId: null }, _count: true }),
  ]);
  const playMap = new Map<string, number>();
  for (const r of [...totalPlays, ...manualConfirmed]) playMap.set(r.assetId, (playMap.get(r.assetId) ?? 0) + r._count);

  const engineAssets = new Map<string, EngineAsset>(
    assets.map((a) => [
      a.id,
      {
        id: a.id,
        title: a.title,
        category: a.category,
        durationSec: a.durationSec,
        approvalStatus: a.approvalStatus,
        deleted: !!a.deletedAt,
        permittedChannelIds: a.permittedChannelIds,
        brand: a.brand,
        productCategory: a.productCategory,
        advertiserId: a.advertiserId,
        contentCategory: a.contentCategory,
        licenses: a.licenses.map((l) => ({ validFrom: l.validFrom, validTo: l.validTo, permittedChannelIds: l.permittedChannelIds, maxPlays: l.maxPlays, restricted: l.restricted, warnDaysBefore: l.warnDaysBefore })),
        existingPlays: playMap.get(a.id) ?? 0,
        promoCampaign: a.promo?.campaign
          ? { startDate: a.promo.campaign.startDate, endDate: a.promo.campaign.endDate, channelIds: a.promo.campaign.channelIds, maxPerDay: a.promo.campaign.maxPerDay, minGapSec: a.promo.campaign.minGapSec, isActive: a.promo.campaign.isActive }
          : null,
      },
    ]),
  );
  const engineEvents: EngineEvent[] = events.map((e) => ({
    id: e.id,
    assetId: e.assetId,
    eventType: e.eventType,
    title: e.title,
    startAt: e.startAt,
    durationSec: e.durationSec,
    breakId: e.breakId,
    positionInBreak: e.positionInBreak,
    status: e.status,
    roLine: e.roLineItem ? { id: e.roLineItem.id, startDate: e.roLineItem.startDate, endDate: e.roLineItem.endDate, maxPerDay: e.roLineItem.maxPerDay, channelId: e.roLineItem.channelId } : null,
  }));
  return validateSchedule({
    channel: { id: channel.id, timezone: channel.timezone, broadcastDayStartHour: channel.broadcastDayStartHour },
    events: engineEvents,
    breaks: breaks.map((b) => ({ id: b.id, code: b.code, startAt: b.startAt, maxDurationSec: b.maxDurationSec })),
    assets: engineAssets,
    rules,
    changedEventIds,
    changedBreakIds,
  });
}

export async function getOrCreateSchedule(tx: Tx, channelId: string, broadcastDate: string) {
  return tx.schedule.upsert({
    where: { channelId_broadcastDate: { channelId, broadcastDate } },
    create: { channelId, broadcastDate },
    update: {},
  });
}

/** Guard + mark a schedule as changed. Published schedules need explicit permission and revert to draft. */
export async function touchSchedule(tx: Tx, scheduleId: string, actor: Actor, confirmPublishedEdit: boolean) {
  const s = await tx.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
  if (s.status === "PUBLISHED") {
    if (!actor.canEditPublished) throw new AppError(`The ${s.broadcastDate} schedule is published. Only users with publish permission can change it.`, "PUBLISHED_LOCKED");
    if (!confirmPublishedEdit) throw new AppError(`The ${s.broadcastDate} schedule is published. Confirm that you want to change it; it will return to draft until republished.`, "CONFIRM_PUBLISHED_EDIT");
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.published_edit", entityType: "Schedule", entityId: s.id, before: { status: s.status, version: s.version } }, tx);
  }
  await tx.schedule.update({ where: { id: scheduleId }, data: { status: "DRAFT", hasUnpublishedChanges: true, lockVersion: { increment: 1 } } });
}

export async function assertValid(tx: Tx, channelId: string, from: Date, to: Date, changedEvents: string[], changedBreaks: string[] = []) {
  const violations = await validateWindow(tx, channelId, from, to, new Set(changedEvents), new Set(changedBreaks));
  const errors = blocking(violations);
  if (errors.length) throw new ConflictError(`Change rejected: ${errors[0].message}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`, { violations });
  return violations.filter((v) => v.severity === "WARNING");
}

/** Shift the following blocks on the track so nothing overlaps (ripple edit). */
async function applyRipple(tx: Tx, channelId: string, changedId: string, from: Date): Promise<string[]> {
  const horizon = new Date(from.getTime() + 36 * 3600 * 1000);
  const [evs, brks] = await Promise.all([
    tx.scheduleEvent.findMany({ where: { channelId, breakId: null, status: { not: "CANCELLED" }, startAt: { gte: new Date(from.getTime() - 12 * 3600 * 1000), lt: horizon } } }),
    tx.advertisingBreak.findMany({ where: { channelId, startAt: { gte: new Date(from.getTime() - 12 * 3600 * 1000), lt: horizon } } }),
  ]);
  const blocks: Block[] = [
    ...evs.map((e) => ({ id: e.id, kind: "event" as const, startAt: e.startAt, durationSec: e.durationSec })),
    ...brks.map((b) => ({ id: b.id, kind: "break" as const, startAt: b.startAt, durationSec: b.maxDurationSec })),
  ];
  const shifted = ripple(blocks, changedId);
  const moved: string[] = [];
  for (const [id, start] of shifted) {
    const block = blocks.find((b) => b.id === id)!;
    if (block.kind === "event") {
      await tx.scheduleEvent.update({ where: { id }, data: { startAt: start } });
      await tx.contentPlayLog.updateMany({ where: { eventId: id, status: "PLANNED" }, data: { plannedAt: start } });
    } else {
      await tx.advertisingBreak.update({ where: { id }, data: { startAt: start } });
      await relayoutBreak(tx, id);
    }
    moved.push(id);
  }
  return moved;
}

/** Recompute spot start times inside a break from their positions. */
export async function relayoutBreak(tx: Tx, breakId: string) {
  const brk = await tx.advertisingBreak.findUniqueOrThrow({ where: { id: breakId } });
  const spots = await tx.scheduleEvent.findMany({ where: { breakId, status: { not: "CANCELLED" } }, orderBy: { positionInBreak: "asc" } });
  const laid = layoutBreak(
    { id: brk.id, code: brk.code, startAt: brk.startAt, maxDurationSec: brk.maxDurationSec },
    spots.map((s) => ({ ...s, eventType: s.eventType as string })),
  );
  for (const s of laid) {
    await tx.scheduleEvent.update({ where: { id: s.id }, data: { startAt: s.startAt } });
    await tx.contentPlayLog.updateMany({ where: { eventId: s.id, status: "PLANNED" }, data: { plannedAt: s.startAt } });
  }
  return laid.map((s) => s.id);
}

export const txOpts = { timeout: 20000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

// ───────────────────────── primary events ─────────────────────────

export type AddEventInput = {
  channelId: string;
  assetId: string;
  startAt: Date;
  durationSec?: number;
  notes?: string;
  ripple?: boolean;
  confirmPublishedEdit?: boolean;
};

export async function addEvent(actor: Actor, input: AddEventInput) {
  return prisma.$transaction(async (tx) => {
    await lockChannel(tx, input.channelId);
    const [channel, asset] = await Promise.all([
      tx.channel.findUniqueOrThrow({ where: { id: input.channelId } }),
      tx.mediaAsset.findUnique({ where: { id: input.assetId } }),
    ]);
    if (!asset || asset.deletedAt) throw new AppError("That media asset no longer exists.");
    if (asset.category === "COMMERCIAL") throw new AppError("Commercials are placed into commercial breaks against a release order. Drop it onto a break instead.");
    if (asset.category === "SECONDARY") throw new AppError("Secondary graphics are scheduled in Secondary Events, not on the primary timeline.");
    const durationSec = input.durationSec ?? asset.durationSec;
    if (durationSec <= 0) throw new AppError("Duration must be positive.");
    const date = broadcastDateOf(channel, input.startAt);
    const schedule = await getOrCreateSchedule(tx, channel.id, date);
    await touchSchedule(tx, schedule.id, actor, !!input.confirmPublishedEdit);
    const ev = await tx.scheduleEvent.create({
      data: { scheduleId: schedule.id, channelId: channel.id, assetId: asset.id, eventType: asset.category as AssetCategory, title: asset.title, startAt: input.startAt, durationSec, notes: input.notes },
    });
    await tx.contentPlayLog.create({ data: { assetId: asset.id, channelId: channel.id, eventId: ev.id, plannedAt: ev.startAt } });
    const shifted = input.ripple ? await applyRipple(tx, channel.id, ev.id, ev.startAt) : [];
    const warnings = await assertValid(tx, channel.id, ev.startAt, endOf(ev), [ev.id, ...shifted], shifted);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.event.create", entityType: "ScheduleEvent", entityId: ev.id, after: { ...ev, rippled: shifted.length } }, tx);
    return { event: ev, warnings, shifted: shifted.length };
  }, txOpts);
}

export type MoveEventInput = {
  eventId: string;
  startAt: Date;
  channelId?: string;
  durationSec?: number;
  copy?: boolean;
  ripple?: boolean;
  confirmPublishedEdit?: boolean;
};

export async function moveEvent(actor: Actor, input: MoveEventInput) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.scheduleEvent.findUnique({ where: { id: input.eventId }, include: { asset: true } });
    if (!original) throw new AppError("The event no longer exists. Refresh the timeline.");
    if (original.breakId) throw new AppError("Spots inside a break are moved by reordering the break, not on the primary track.");
    if (original.status === "AIRED") throw new AppError("An event that has aired cannot be moved.");
    const targetChannelId = input.channelId ?? original.channelId;
    for (const id of [...new Set([original.channelId, targetChannelId])].sort()) await lockChannel(tx, id);
    const channel = await tx.channel.findUniqueOrThrow({ where: { id: targetChannelId } });
    const durationSec = input.durationSec ?? original.durationSec;
    if (input.durationSec != null && input.durationSec !== original.durationSec && ["PROGRAM", "MOVIE", "COMMERCIAL"].includes(original.eventType)) {
      throw new AppError("The duration of programs, movies and commercials comes from the media asset and cannot be stretched on the timeline.");
    }
    const date = broadcastDateOf(channel, input.startAt);
    const schedule = await getOrCreateSchedule(tx, channel.id, date);
    await touchSchedule(tx, schedule.id, actor, !!input.confirmPublishedEdit);
    if (!input.copy && original.scheduleId !== schedule.id) await touchSchedule(tx, original.scheduleId, actor, !!input.confirmPublishedEdit);

    let ev;
    if (input.copy) {
      ev = await tx.scheduleEvent.create({
        data: { scheduleId: schedule.id, channelId: channel.id, assetId: original.assetId, eventType: original.eventType, title: original.title, startAt: input.startAt, durationSec, notes: original.notes },
      });
      await tx.contentPlayLog.create({ data: { assetId: ev.assetId, channelId: channel.id, eventId: ev.id, plannedAt: ev.startAt } });
    } else {
      ev = await tx.scheduleEvent.update({ where: { id: original.id }, data: { scheduleId: schedule.id, channelId: channel.id, startAt: input.startAt, durationSec } });
      await tx.contentPlayLog.updateMany({ where: { eventId: ev.id, status: "PLANNED" }, data: { plannedAt: ev.startAt, channelId: channel.id } });
    }
    const shifted = input.ripple ? await applyRipple(tx, channel.id, ev.id, ev.startAt) : [];
    const warnings = await assertValid(tx, channel.id, ev.startAt, endOf(ev), [ev.id, ...shifted], shifted);
    await audit(
      {
        userId: actor.id,
        userEmail: actor.email,
        action: input.copy ? "schedule.event.copy" : "schedule.event.move",
        entityType: "ScheduleEvent",
        entityId: ev.id,
        before: input.copy ? undefined : { channelId: original.channelId, startAt: original.startAt, durationSec: original.durationSec },
        after: { channelId: ev.channelId, startAt: ev.startAt, durationSec: ev.durationSec, rippled: shifted.length },
      },
      tx,
    );
    return { event: ev, warnings, shifted: shifted.length };
  }, txOpts);
}

export async function deleteEvent(actor: Actor, eventId: string, confirmPublishedEdit = false) {
  return prisma.$transaction(async (tx) => {
    const ev = await tx.scheduleEvent.findUnique({ where: { id: eventId } });
    if (!ev) throw new AppError("The event no longer exists.");
    if (ev.status === "AIRED") throw new AppError("An event that has aired cannot be removed; it is part of the as-run record.");
    if (ev.invoiceLineItemId) throw new AppError("This spot has been invoiced. Issue a credit note instead of deleting it.");
    await lockChannel(tx, ev.channelId);
    await touchSchedule(tx, ev.scheduleId, actor, confirmPublishedEdit);
    await tx.contentPlayLog.deleteMany({ where: { eventId: ev.id, status: "PLANNED" } });
    if (ev.inventoryId) {
      const inv = await tx.advertisingInventory.findUniqueOrThrow({ where: { id: ev.inventoryId } });
      // A sold spot returns to BOOKED for its RO line; a promo fill frees the position.
      await tx.advertisingInventory.update({ where: { id: inv.id }, data: { status: inv.roLineItemId ? "BOOKED" : "AVAILABLE", version: { increment: 1 } } });
    }
    await tx.scheduleEvent.delete({ where: { id: ev.id } });
    if (ev.breakId) await relayoutBreak(tx, ev.breakId);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.event.delete", entityType: "ScheduleEvent", entityId: ev.id, before: ev }, tx);
    return { ok: true };
  }, txOpts);
}

// ───────────────────────── breaks & spots ─────────────────────────

export async function moveBreak(actor: Actor, breakId: string, startAt: Date, opts: { ripple?: boolean; confirmPublishedEdit?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const brk = await tx.advertisingBreak.findUniqueOrThrow({ where: { id: breakId } });
    await lockChannel(tx, brk.channelId);
    const channel = await tx.channel.findUniqueOrThrow({ where: { id: brk.channelId } });
    const date = broadcastDateOf(channel, startAt);
    const schedule = await getOrCreateSchedule(tx, channel.id, date);
    await touchSchedule(tx, brk.scheduleId, actor, !!opts.confirmPublishedEdit);
    if (schedule.id !== brk.scheduleId) await touchSchedule(tx, schedule.id, actor, !!opts.confirmPublishedEdit);
    const aired = await tx.scheduleEvent.count({ where: { breakId, status: "AIRED" } });
    if (aired) throw new AppError("This break contains aired spots and cannot be moved.");
    await tx.advertisingBreak.update({ where: { id: breakId }, data: { startAt, scheduleId: schedule.id } });
    await tx.scheduleEvent.updateMany({ where: { breakId }, data: { scheduleId: schedule.id } });
    const spotIds = await relayoutBreak(tx, breakId);
    const shifted = opts.ripple ? await applyRipple(tx, channel.id, breakId, startAt) : [];
    const warnings = await assertValid(tx, channel.id, startAt, new Date(startAt.getTime() + brk.maxDurationSec * 1000), [...spotIds, ...shifted], [breakId, ...shifted]);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.break.move", entityType: "AdvertisingBreak", entityId: breakId, before: { startAt: brk.startAt }, after: { startAt } }, tx);
    return { warnings };
  }, txOpts);
}

/**
 * Place an asset into a break. Commercials must be covered by an approved
 * release order line: an inventory position already BOOKED for that line in
 * this break is used first, otherwise an AVAILABLE position is booked
 * atomically (if the line still has quantity left). Promos, fillers and other
 * house content take an AVAILABLE position without an RO.
 */
export async function placeInBreak(actor: Actor, input: { breakId: string; assetId: string; roLineItemId?: string; confirmPublishedEdit?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const brk = await tx.advertisingBreak.findUniqueOrThrow({ where: { id: input.breakId }, include: { channel: true } });
    await lockChannel(tx, brk.channelId);
    const asset = await tx.mediaAsset.findUnique({ where: { id: input.assetId } });
    if (!asset || asset.deletedAt) throw new AppError("That media asset no longer exists.");
    if (["PROGRAM", "MOVIE", "SECONDARY"].includes(asset.category)) throw new AppError(`A ${asset.category.toLowerCase()} cannot be placed inside a commercial break.`);
    await touchSchedule(tx, brk.scheduleId, actor, !!input.confirmPublishedEdit);

    const date = broadcastDateOf(brk.channel, brk.startAt);
    let roLineId: string | null = null;
    let inventoryId: string | null = null;

    if (asset.category === "COMMERCIAL") {
      const lines = await tx.releaseOrderLineItem.findMany({
        where: {
          ...(input.roLineItemId ? { id: input.roLineItemId } : {}),
          channelId: brk.channelId,
          startDate: { lte: new Date(`${date}T23:59:59Z`) },
          endDate: { gte: new Date(`${date}T00:00:00Z`) },
          releaseOrder: { status: { in: ["APPROVED", "SCHEDULED"] } },
          OR: [{ assetId: asset.id }, { assetId: null, releaseOrder: { clientId: asset.advertiserId ?? "__none__" } }],
        },
        include: { inventory: { where: { breakId: brk.id, status: "BOOKED" }, orderBy: { position: "asc" } }, _count: { select: { inventory: { where: { status: { notIn: ["CANCELLED", "AVAILABLE"] } } } } } },
      });
      if (!lines.length) throw new AppError(`No approved release order covers "${asset.title}" on ${brk.channel.name} for ${date}. Create and approve an RO first.`, "NO_RO");
      const withBooked = lines.find((l) => l.inventory.some((i) => i.durationSec >= asset.durationSec));
      if (withBooked) {
        roLineId = withBooked.id;
        inventoryId = withBooked.inventory.find((i) => i.durationSec >= asset.durationSec)!.id;
      } else {
        const line = lines.find((l) => l._count.inventory < l.quantity);
        if (!line) throw new AppError(`Every spot on the release order line for "${asset.title}" is already booked. Amend the RO to add quantity.`, "RO_EXHAUSTED");
        roLineId = line.id;
      }
    }

    if (!inventoryId) {
      const free = await tx.advertisingInventory.findFirst({ where: { breakId: brk.id, status: "AVAILABLE", durationSec: { gte: asset.durationSec } }, orderBy: [{ priority: "asc" }, { position: "asc" }] });
      if (!free) throw new ConflictError(`Break ${brk.code} has no available position of at least ${asset.durationSec}s.`);
      inventoryId = free.id;
    }

    // Optimistic lock: the position must still be in the state we read.
    const claimed = await tx.advertisingInventory.updateMany({
      where: { id: inventoryId, status: { in: roLineId ? ["AVAILABLE", "BOOKED"] : ["AVAILABLE"] }, ...(roLineId ? { OR: [{ roLineItemId: null }, { roLineItemId: roLineId }] } : {}) },
      data: { status: "SCHEDULED", roLineItemId: roLineId, version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new ConflictError("That inventory position was just taken by another user. Refresh and try again.");
    const inv = await tx.advertisingInventory.findUniqueOrThrow({ where: { id: inventoryId } });

    const ev = await tx.scheduleEvent.create({
      data: {
        scheduleId: brk.scheduleId,
        channelId: brk.channelId,
        assetId: asset.id,
        eventType: asset.category,
        title: asset.title,
        startAt: brk.startAt,
        durationSec: asset.durationSec,
        breakId: brk.id,
        positionInBreak: inv.position,
        inventoryId,
        roLineItemId: roLineId,
      },
    });
    await tx.contentPlayLog.create({ data: { assetId: asset.id, channelId: brk.channelId, eventId: ev.id, plannedAt: brk.startAt } });
    const ids = await relayoutBreak(tx, brk.id);
    const warnings = await assertValid(tx, brk.channelId, brk.startAt, new Date(brk.startAt.getTime() + brk.maxDurationSec * 1000), [ev.id], []);
    if (roLineId) await refreshRoStatus(tx, roLineId);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.spot.place", entityType: "ScheduleEvent", entityId: ev.id, after: { breakId: brk.id, assetId: asset.id, roLineId, inventoryId, spots: ids.length } }, tx);
    return { event: ev, warnings };
  }, txOpts);
}

/** RO becomes SCHEDULED once every booked unit of every line has a placed spot. */
export async function refreshRoStatus(tx: Tx, roLineItemId: string) {
  const line = await tx.releaseOrderLineItem.findUniqueOrThrow({ where: { id: roLineItemId }, include: { releaseOrder: { include: { lines: true } } } });
  const ro = line.releaseOrder;
  if (!["APPROVED", "SCHEDULED"].includes(ro.status)) return;
  const totalQty = ro.lines.reduce((n, l) => n + l.quantity, 0);
  const placed = await tx.scheduleEvent.count({ where: { roLineItemId: { in: ro.lines.map((l) => l.id) }, status: { not: "CANCELLED" } } });
  const next = placed >= totalQty ? "SCHEDULED" : "APPROVED";
  if (next !== ro.status) {
    await tx.releaseOrder.update({ where: { id: ro.id }, data: { status: next } });
    await tx.rOApproval.create({ data: { releaseOrderId: ro.id, revision: ro.revision, stage: ro.approvalStage, stageName: "Traffic", action: next === "SCHEDULED" ? "SCHEDULED" : "UNSCHEDULED", comment: `${placed}/${totalQty} spots placed` } });
  }
}

export async function reorderBreak(actor: Actor, breakId: string, orderedEventIds: string[], confirmPublishedEdit = false) {
  return prisma.$transaction(async (tx) => {
    const brk = await tx.advertisingBreak.findUniqueOrThrow({ where: { id: breakId } });
    await lockChannel(tx, brk.channelId);
    await touchSchedule(tx, brk.scheduleId, actor, confirmPublishedEdit);
    const spots = await tx.scheduleEvent.findMany({ where: { breakId } });
    if (spots.length !== orderedEventIds.length || !spots.every((s) => orderedEventIds.includes(s.id))) throw new AppError("The break changed while you were editing it. Refresh and try again.");
    // Temporarily clear positions to avoid clashes, then assign in the new order.
    for (const [i, id] of orderedEventIds.entries()) await tx.scheduleEvent.update({ where: { id }, data: { positionInBreak: 1000 + i } });
    for (const [i, id] of orderedEventIds.entries()) await tx.scheduleEvent.update({ where: { id }, data: { positionInBreak: i + 1 } });
    const ids = await relayoutBreak(tx, breakId);
    const warnings = await assertValid(tx, brk.channelId, brk.startAt, new Date(brk.startAt.getTime() + brk.maxDurationSec * 1000), ids, [breakId]);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.break.reorder", entityType: "AdvertisingBreak", entityId: breakId, after: { order: orderedEventIds } }, tx);
    return { warnings };
  }, txOpts);
}

// ───────────────────────── publication & versions ─────────────────────────

async function snapshot(tx: Tx, scheduleId: string) {
  const [events, breaks] = await Promise.all([
    tx.scheduleEvent.findMany({ where: { scheduleId }, orderBy: { startAt: "asc" } }),
    tx.advertisingBreak.findMany({ where: { scheduleId }, orderBy: { startAt: "asc" } }),
  ]);
  return JSON.parse(JSON.stringify({ events, breaks }));
}

export async function publishSchedule(actor: Actor, scheduleId: string, comment?: string) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.schedule.findUniqueOrThrow({ where: { id: scheduleId }, include: { channel: true } });
    await lockChannel(tx, s.channelId);
    const { start, end } = broadcastDayRange(s.channel, s.broadcastDate);
    const violations = await validateWindow(tx, s.channelId, start, end);
    const inDay = violations.filter((v) => v.range && new Date(v.range.start) < end && new Date(v.range.end) > start);
    const errors = blocking(inDay);
    if (errors.length) throw new ConflictError(`Cannot publish: ${errors.length} rule violation(s). First: ${errors[0].message}`, { violations: inDay });
    const version = s.version + 1;
    await tx.scheduleVersion.create({ data: { scheduleId, version, snapshot: await snapshot(tx, scheduleId), comment, createdById: actor.id } });
    const updated = await tx.schedule.update({ where: { id: scheduleId }, data: { status: "PUBLISHED", version, hasUnpublishedChanges: false, publishedAt: new Date(), publishedById: actor.id, lockVersion: { increment: 1 } } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.publish", entityType: "Schedule", entityId: scheduleId, after: { version, broadcastDate: s.broadcastDate, channel: s.channel.code } }, tx);
    return { schedule: updated, warnings: inDay.filter((v) => v.severity === "WARNING") };
  }, txOpts);
}

/** Restore a published version into the draft. Spots linked to inventory/ROs are not resurrected. */
export async function restoreVersion(actor: Actor, scheduleId: string, version: number) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
    await lockChannel(tx, s.channelId);
    const v = await tx.scheduleVersion.findUniqueOrThrow({ where: { scheduleId_version: { scheduleId, version } } });
    await touchSchedule(tx, scheduleId, actor, true);
    const snap = v.snapshot as { events: { id: string; assetId: string; eventType: AssetCategory; title: string; startAt: string; durationSec: number; breakId: string | null; notes: string | null }[] };
    const aired = await tx.scheduleEvent.count({ where: { scheduleId, status: "AIRED" } });
    if (aired) throw new AppError("This day has aired events; restoring a previous version is not allowed.");
    const current = await tx.scheduleEvent.findMany({ where: { scheduleId, breakId: null } });
    await tx.contentPlayLog.deleteMany({ where: { eventId: { in: current.map((e) => e.id) }, status: "PLANNED" } });
    await tx.scheduleEvent.deleteMany({ where: { scheduleId, breakId: null } });
    const ids: string[] = [];
    for (const e of snap.events.filter((x) => !x.breakId)) {
      const ev = await tx.scheduleEvent.create({ data: { scheduleId, channelId: s.channelId, assetId: e.assetId, eventType: e.eventType, title: e.title, startAt: new Date(e.startAt), durationSec: e.durationSec, notes: e.notes } });
      await tx.contentPlayLog.create({ data: { assetId: ev.assetId, channelId: s.channelId, eventId: ev.id, plannedAt: ev.startAt } });
      ids.push(ev.id);
    }
    const ch = await tx.channel.findUniqueOrThrow({ where: { id: s.channelId } });
    const { start, end } = broadcastDayRange(ch, s.broadcastDate);
    const warnings = await assertValid(tx, s.channelId, start, end, ids);
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.restore_version", entityType: "Schedule", entityId: scheduleId, after: { version } }, tx);
    return { restored: ids.length, warnings };
  }, txOpts);
}

/**
 * Copy a day's primary events (not commercial spots) to other dates, keeping
 * the local wall-clock time. Because times are rebuilt in the channel time
 * zone, DST changes are handled: 20:00 stays 20:00 local.
 */
export async function duplicateDay(actor: Actor, input: { channelId: string; sourceDate: string; targetDates: string[]; includeBreaks: boolean }) {
  if (!input.targetDates.length) throw new AppError("Choose at least one target date.");
  if (input.targetDates.length > 62) throw new AppError("You can copy to at most 62 days at once.");
  return prisma.$transaction(async (tx) => {
    await lockChannel(tx, input.channelId);
    const ch = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
    const src = await tx.schedule.findUnique({ where: { channelId_broadcastDate: { channelId: ch.id, broadcastDate: input.sourceDate } }, include: { events: { where: { breakId: null, status: { not: "CANCELLED" } } }, breaks: { include: { inventory: true } } } });
    if (!src || (!src.events.length && !src.breaks.length)) throw new AppError(`There is nothing scheduled on ${input.sourceDate} to copy.`);
    const results: { date: string; events: number; breaks: number }[] = [];
    const localOffset = (d: Date) => {
      // Wall-clock offset (in days + local time) relative to the source broadcast-day date.
      const local = fmtTz(d, ch.timezone, "yyyy-MM-dd HH:mm:ss");
      const [ld, lt] = local.split(" ");
      const dayDiff = Math.round((Date.parse(`${ld}T00:00:00Z`) - Date.parse(`${input.sourceDate}T00:00:00Z`)) / 86400000);
      return { dayDiff, lt };
    };
    for (const date of input.targetDates) {
      if (date === input.sourceDate) continue;
      const target = await getOrCreateSchedule(tx, ch.id, date);
      await touchSchedule(tx, target.id, actor, actor.canEditPublished);
      const existing = await tx.scheduleEvent.count({ where: { scheduleId: target.id } });
      if (existing) throw new ConflictError(`${date} already has ${existing} event(s). Clear it before copying, or choose empty dates.`);
      const ids: string[] = [];
      for (const e of src.events) {
        const { dayDiff, lt } = localOffset(e.startAt);
        const startAt = zonedToUtc(addDaysStr(date, dayDiff), lt, ch.timezone);
        const ev = await tx.scheduleEvent.create({ data: { scheduleId: target.id, channelId: ch.id, assetId: e.assetId, eventType: e.eventType, title: e.title, startAt, durationSec: e.durationSec, notes: e.notes } });
        await tx.contentPlayLog.create({ data: { assetId: ev.assetId, channelId: ch.id, eventId: ev.id, plannedAt: startAt } });
        ids.push(ev.id);
      }
      let nb = 0;
      if (input.includeBreaks) {
        for (const b of src.breaks) {
          const { dayDiff, lt } = localOffset(b.startAt);
          const startAt = zonedToUtc(addDaysStr(date, dayDiff), lt, ch.timezone);
          await tx.advertisingBreak.create({
            data: {
              channelId: ch.id,
              scheduleId: target.id,
              code: b.code,
              startAt,
              maxDurationSec: b.maxDurationSec,
              programTitle: b.programTitle,
              timeBand: b.timeBand,
              inventory: { create: b.inventory.map((i) => ({ position: i.position, durationSec: i.durationSec, rate: i.rate, priority: i.priority })) },
            },
          });
          nb++;
        }
      }
      const { start, end } = broadcastDayRange(ch, date);
      await assertValid(tx, ch.id, start, end, ids);
      results.push({ date, events: ids.length, breaks: nb });
    }
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.duplicate", entityType: "Schedule", entityId: src.id, after: { targets: results } }, tx);
    return results;
  }, { ...txOpts, timeout: 60000 });
}

/** Record that events actually aired (as-run). This is the only way plays become CONFIRMED. */
export async function confirmAired(actor: Actor, eventIds: string[], airedAt?: Date) {
  return prisma.$transaction(async (tx) => {
    const events = await tx.scheduleEvent.findMany({ where: { id: { in: eventIds }, status: "PLANNED" } });
    const now = new Date();
    for (const e of events) {
      if (e.startAt > now) throw new AppError(`"${e.title}" is scheduled in the future (${e.startAt.toISOString()}) and cannot be confirmed as aired.`);
    }
    for (const e of events) {
      await tx.scheduleEvent.update({ where: { id: e.id }, data: { status: "AIRED" } });
      await tx.contentPlayLog.upsert({
        where: { eventId: e.id },
        create: { assetId: e.assetId, channelId: e.channelId, eventId: e.id, plannedAt: e.startAt, airedAt: airedAt ?? e.startAt, status: "CONFIRMED", source: "MANUAL", confirmedById: actor.id },
        update: { airedAt: airedAt ?? e.startAt, status: "CONFIRMED", confirmedById: actor.id },
      });
      await tx.mediaAsset.update({ where: { id: e.assetId }, data: { playCount: { increment: 1 } } });
      if (e.inventoryId) await tx.advertisingInventory.update({ where: { id: e.inventoryId }, data: { status: "AIRED", version: { increment: 1 } } });
    }
    await audit({ userId: actor.id, userEmail: actor.email, action: "schedule.asrun.confirm", entityType: "ScheduleEvent", after: { eventIds: events.map((e) => e.id) } }, tx);
    // Release orders whose every spot has aired are completed.
    const lineIds = [...new Set(events.map((e) => e.roLineItemId).filter(Boolean))] as string[];
    const ros = await tx.releaseOrder.findMany({ where: { lines: { some: { id: { in: lineIds } } }, status: "SCHEDULED" }, include: { lines: true } });
    for (const ro of ros) {
      const qty = ro.lines.reduce((n, l) => n + l.quantity, 0);
      const airedCount = await tx.scheduleEvent.count({ where: { roLineItemId: { in: ro.lines.map((l) => l.id) }, status: "AIRED" } });
      if (airedCount >= qty) {
        await tx.releaseOrder.update({ where: { id: ro.id }, data: { status: "COMPLETED" } });
        await tx.rOApproval.create({ data: { releaseOrderId: ro.id, revision: ro.revision, stage: ro.approvalStage, stageName: "Traffic", action: "COMPLETED", comment: `All ${qty} spots aired`, userId: actor.id, userName: actor.email } });
      }
    }
    return { confirmed: events.length };
  }, txOpts);
}
