import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError } from "../errors";
import { D, round2, type Decimal } from "../money";
import { broadcastDayRange, zonedToUtc, localSecondOfDay, broadcastDateOf, addDaysStr } from "../time";
import { getOrCreateSchedule, lockChannel, assertValid, loadRules, txOpts, type Actor } from "../scheduling/service";
import { timeBandFor } from "./timeband";
import { spotRate } from "../billing/calc";

export type GenerateBreaksInput = {
  channelId: string;
  fromDate: string;
  toDate: string;
  times: string[]; // local HH:MM
  positions: number;
  positionDurationSec: number;
  programTitle?: string;
};

/** Look up the channel's standard rate (rate card without client) for a band on a date. */
export async function standardRate(tx: Tx, channelId: string, timeBand: string, at: Date, durationSec: number, clientId?: string | null): Promise<Decimal> {
  const cards = await tx.rateCard.findMany({
    where: { channelId, isActive: true, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }], clientId: clientId ? { in: [clientId] } : null },
    include: { items: true },
    orderBy: { validFrom: "desc" },
  });
  const fallback: Decimal | null = clientId ? await standardRate(tx, channelId, timeBand, at, durationSec, null) : null;
  for (const c of cards) {
    const item = c.items.find((i) => i.timeBand === timeBand && i.position === "ANY") ?? c.items.find((i) => i.timeBand === "ANY");
    if (item) return spotRate(item.rate, item.baseDurationSec, durationSec);
  }
  return fallback ?? D(0);
}

export async function generateBreaks(actor: Actor, input: GenerateBreaksInput) {
  if (input.fromDate > input.toDate) throw new AppError("The start date must be on or before the end date.");
  if (!input.times.length) throw new AppError("Enter at least one break time.");
  if (input.positions < 1 || input.positions > 30) throw new AppError("Positions per break must be between 1 and 30.");
  return prisma.$transaction(async (tx) => {
    await lockChannel(tx, input.channelId);
    const ch = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
    let created = 0;
    let skipped = 0;
    const createdIds: string[] = [];
    for (let date = input.fromDate, guard = 0; date <= input.toDate && guard < 93; date = addDaysStr(date, 1), guard++) {
      const schedule = await getOrCreateSchedule(tx, ch.id, date);
      if (schedule.status === "PUBLISHED" && !actor.canEditPublished) throw new AppError(`The ${date} schedule is published; you cannot add breaks to it.`);
      for (const t of input.times) {
        const [hh] = t.split(":").map(Number);
        // Times before the broadcast-day start belong to the next calendar day.
        const calDate = hh < ch.broadcastDayStartHour ? addDaysStr(date, 1) : date;
        const startAt = zonedToUtc(calDate, t, ch.timezone);
        const code = `B${t.replace(":", "")}`;
        const exists = await tx.advertisingBreak.findUnique({ where: { scheduleId_code: { scheduleId: schedule.id, code } } });
        if (exists) {
          skipped++;
          continue;
        }
        const band = timeBandFor(Math.floor(localSecondOfDay(startAt, ch.timezone) / 60));
        const rate = await standardRate(tx, ch.id, band, startAt, input.positionDurationSec);
        const brk = await tx.advertisingBreak.create({
          data: {
            channelId: ch.id,
            scheduleId: schedule.id,
            code,
            startAt,
            maxDurationSec: input.positions * input.positionDurationSec,
            programTitle: input.programTitle,
            timeBand: band,
            inventory: {
              create: Array.from({ length: input.positions }, (_, i) => ({ position: i + 1, durationSec: input.positionDurationSec, rate: rate.toFixed(2), priority: i === 0 || i === input.positions - 1 ? 1 : 5 })),
            },
          },
        });
        createdIds.push(brk.id);
        created++;
      }
      if (createdIds.length) await tx.schedule.update({ where: { id: schedule.id }, data: { hasUnpublishedChanges: true, status: "DRAFT", lockVersion: { increment: 1 } } });
    }
    const { start } = broadcastDayRange(ch, input.fromDate);
    const { end } = broadcastDayRange(ch, input.toDate);
    await assertValid(tx, ch.id, start, end, [], createdIds);
    await audit({ userId: actor.id, userEmail: actor.email, action: "inventory.breaks.generate", entityType: "Channel", entityId: ch.id, after: { ...input, created, skipped } }, tx);
    return { created, skipped };
  }, { ...txOpts, timeout: 60000 });
}

export async function deleteBreak(actor: Actor, breakId: string) {
  return prisma.$transaction(async (tx) => {
    const brk = await tx.advertisingBreak.findUniqueOrThrow({ where: { id: breakId }, include: { inventory: true, events: true } });
    await lockChannel(tx, brk.channelId);
    if (brk.events.length) throw new AppError(`Break ${brk.code} still has ${brk.events.length} spot(s). Remove them first.`);
    if (brk.inventory.some((i) => i.status !== "AVAILABLE" && i.status !== "UNAVAILABLE")) throw new AppError(`Break ${brk.code} has booked inventory. Release the bookings first.`);
    await tx.advertisingBreak.delete({ where: { id: breakId } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "inventory.break.delete", entityType: "AdvertisingBreak", entityId: breakId, before: brk }, tx);
  }, txOpts);
}

export async function setInventoryStatus(actor: Actor, inventoryId: string, status: "AVAILABLE" | "UNAVAILABLE", expectedVersion: number) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.advertisingInventory.updateMany({ where: { id: inventoryId, version: expectedVersion, status: { in: ["AVAILABLE", "UNAVAILABLE"] } }, data: { status, version: { increment: 1 } } });
    if (res.count !== 1) throw new ConflictError("This position was changed by someone else or is already booked. Refresh to see its current state.");
    await audit({ userId: actor.id, userEmail: actor.email, action: "inventory.status", entityType: "AdvertisingInventory", entityId: inventoryId, after: { status } }, tx);
  });
}

export async function updateInventoryRate(actor: Actor, inventoryId: string, rate: string, expectedVersion: number) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.advertisingInventory.findUniqueOrThrow({ where: { id: inventoryId } });
    const res = await tx.advertisingInventory.updateMany({ where: { id: inventoryId, version: expectedVersion }, data: { rate: round2(rate).toFixed(2), version: { increment: 1 } } });
    if (res.count !== 1) throw new ConflictError("This position was changed by someone else. Refresh and try again.");
    await audit({ userId: actor.id, userEmail: actor.email, action: "inventory.rate", entityType: "AdvertisingInventory", entityId: inventoryId, before: { rate: before.rate }, after: { rate } }, tx);
  });
}

type LineForBooking = { id: string; channelId: string; timeBand: string | null; spotDurationSec: number; quantity: number; startDate: Date; endDate: Date; maxPerDay: number | null };

async function candidates(tx: Tx, line: LineForBooking) {
  const ch = await tx.channel.findUniqueOrThrow({ where: { id: line.channelId } });
  const from = broadcastDayRange(ch, line.startDate.toISOString().slice(0, 10)).start;
  const to = broadcastDayRange(ch, line.endDate.toISOString().slice(0, 10)).end;
  const inv = await tx.advertisingInventory.findMany({
    where: {
      status: "AVAILABLE",
      durationSec: { gte: line.spotDurationSec },
      break: { channelId: line.channelId, startAt: { gte: from, lt: to }, ...(line.timeBand && line.timeBand !== "ANY" ? { timeBand: line.timeBand } : {}) },
    },
    include: { break: true },
    orderBy: [{ break: { startAt: "asc" } }, { priority: "asc" }, { position: "asc" }],
  });
  return { ch, inv };
}

/** How many matching positions are free for a line (no reservation). */
export async function availabilityFor(tx: Tx, line: LineForBooking) {
  const { inv } = await candidates(tx, line);
  const breaks = new Set<string>();
  return inv.filter((i) => (breaks.has(i.breakId) ? false : (breaks.add(i.breakId), true))).length;
}

/**
 * Book `needed` positions for an RO line. Spots are spread round-robin across
 * dates (respecting maxPerDay) and never two in the same break. Each claim is a
 * conditional UPDATE (status = AVAILABLE AND version = n) so two concurrent
 * bookings can never take the same position; a lost race just moves on to the
 * next candidate. Throws (rolling back the caller's transaction) if the line
 * cannot be fully booked.
 */
export async function bookLine(tx: Tx, line: LineForBooking, needed: number) {
  if (needed <= 0) return 0;
  const { ch, inv } = await candidates(tx, line);
  // Respect the separation rules up front so booked positions can actually be scheduled.
  const rules = await loadRules(tx, line.channelId);
  const sameSpot = rules.find((r) => r.key === "COMMERCIAL_MIN_SEPARATION" && r.enabled);
  const minSepMs = sameSpot ? (Number(sameSpot.params.minSeconds ?? 1800) + 300) * 1000 : 0;
  const me = await tx.releaseOrderLineItem.findUnique({ where: { id: line.id }, include: { releaseOrder: { include: { client: true } } } });
  const category = me?.releaseOrder.client.productCategory;
  const competitorBreaks = new Set(
    category
      ? (
          await tx.advertisingInventory.findMany({
            where: { breakId: { in: [...new Set(inv.map((i) => i.breakId))] }, roLineItem: { releaseOrder: { client: { productCategory: category, id: { not: me!.releaseOrder.clientId } } } } },
            select: { breakId: true },
          })
        ).map((r) => r.breakId)
      : [],
  );
  const existing = await tx.advertisingInventory.findMany({ where: { roLineItemId: line.id, status: { not: "CANCELLED" } }, include: { break: true } });
  const usedBreaks = new Set(existing.map((e) => e.breakId));
  const bookedTimes = existing.map((e) => e.break.startAt.getTime());
  const alreadyByDay = new Map<string, number>();
  for (const e of existing) {
    const d = broadcastDateOf(ch, e.break.startAt);
    alreadyByDay.set(d, (alreadyByDay.get(d) ?? 0) + 1);
  }
  const byDay = new Map<string, typeof inv>();
  for (const i of inv) {
    if (usedBreaks.has(i.breakId) || competitorBreaks.has(i.breakId)) continue;
    const d = broadcastDateOf(ch, i.break.startAt);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  const days = [...byDay.keys()].sort();
  const farEnough = (t: number) => bookedTimes.every((b) => Math.abs(b - t) >= minSepMs);
  let booked = 0;
  let progress = true;
  while (booked < needed && progress) {
    progress = false;
    for (const d of days) {
      if (booked >= needed) break;
      if (line.maxPerDay && (alreadyByDay.get(d) ?? 0) >= line.maxPerDay) continue;
      const list = byDay.get(d)!;
      // Spread through the day: take candidates from alternating ends of the list.
      while (list.length) {
        const c = (alreadyByDay.get(d) ?? 0) % 2 ? list.pop()! : list.shift()!;
        if (usedBreaks.has(c.breakId) || !farEnough(c.break.startAt.getTime())) continue;
        const res = await tx.advertisingInventory.updateMany({ where: { id: c.id, status: "AVAILABLE", version: c.version }, data: { status: "BOOKED", roLineItemId: line.id, version: { increment: 1 } } });
        if (res.count === 1) {
          booked++;
          usedBreaks.add(c.breakId);
          bookedTimes.push(c.break.startAt.getTime());
          alreadyByDay.set(d, (alreadyByDay.get(d) ?? 0) + 1);
          progress = true;
          break;
        }
      }
    }
  }
  if (booked < needed) throw new ConflictError(`Only ${booked} of ${needed} spot(s) could be booked for line "${line.timeBand ?? "ANY"} ${line.spotDurationSec}s" between ${line.startDate.toISOString().slice(0, 10)} and ${line.endDate.toISOString().slice(0, 10)} (after brand, competitor and separation rules). Add breaks or change the line.`);
  return booked;
}

/** Release BOOKED (not yet scheduled) positions of a line, newest first, down to `keep`. */
export async function releaseLine(tx: Tx, lineId: string, keep = 0) {
  const booked = await tx.advertisingInventory.findMany({ where: { roLineItemId: lineId, status: { in: ["BOOKED", "RESERVED"] } }, include: { break: true }, orderBy: { break: { startAt: "desc" } } });
  const scheduledCount = await tx.advertisingInventory.count({ where: { roLineItemId: lineId, status: { in: ["SCHEDULED", "AIRED"] } } });
  const removable = Math.max(0, booked.length + scheduledCount - keep);
  let released = 0;
  for (const b of booked.slice(0, removable)) {
    await tx.advertisingInventory.update({ where: { id: b.id }, data: { status: "AVAILABLE", roLineItemId: null, version: { increment: 1 } } });
    released++;
  }
  return released;
}

/** Inventory summary rows for a channel/date range — real data for dashboard and reports. */
export async function inventorySummary(where: { channelId?: string; from: Date; to: Date; channelIds?: string[] }) {
  const rows = await prisma.advertisingInventory.groupBy({
    by: ["status"],
    where: { break: { startAt: { gte: where.from, lt: where.to }, ...(where.channelId ? { channelId: where.channelId } : where.channelIds ? { channelId: { in: where.channelIds } } : {}) } },
    _count: true,
    _sum: { rate: true, durationSec: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count, value: D(r._sum.rate ?? 0), seconds: r._sum.durationSec ?? 0 }));
}
