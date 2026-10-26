"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertChannel, type CurrentUser } from "@/lib/auth/session";
import { run } from "@/lib/action";
import { AppError } from "@/lib/errors";
import * as svc from "@/lib/scheduling/service";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/service";

const actor = (u: CurrentUser): svc.Actor => ({ id: u.id, email: u.email, canEditPublished: u.permissions.has("schedule.publish") });

async function eventChannel(eventId: string) {
  const e = await prisma.scheduleEvent.findUnique({ where: { id: eventId }, select: { channelId: true } });
  if (!e) throw new AppError("The event no longer exists. Refresh the timeline.");
  return e.channelId;
}

export async function addEventAction(input: { channelId: string; assetId: string; startAt: string; durationSec?: number; ripple?: boolean; confirmPublishedEdit?: boolean }) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    const p = z.object({ channelId: z.string(), assetId: z.string(), startAt: z.string().datetime(), durationSec: z.number().int().positive().max(86400).optional(), ripple: z.boolean().optional(), confirmPublishedEdit: z.boolean().optional() }).parse(input);
    assertChannel(u, p.channelId);
    const r = await svc.addEvent(actor(u), { ...p, startAt: new Date(p.startAt) });
    return { id: r.event.id, warnings: r.warnings, shifted: r.shifted };
  }, "Event added");
}

export async function moveEventAction(input: { eventId: string; startAt: string; channelId?: string; durationSec?: number; copy?: boolean; ripple?: boolean; confirmPublishedEdit?: boolean }) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    const p = z.object({ eventId: z.string(), startAt: z.string().datetime(), channelId: z.string().optional(), durationSec: z.number().int().positive().max(86400).optional(), copy: z.boolean().optional(), ripple: z.boolean().optional(), confirmPublishedEdit: z.boolean().optional() }).parse(input);
    assertChannel(u, await eventChannel(p.eventId));
    if (p.channelId) assertChannel(u, p.channelId);
    const r = await svc.moveEvent(actor(u), { ...p, startAt: new Date(p.startAt) });
    return { id: r.event.id, warnings: r.warnings, shifted: r.shifted, prev: null };
  }, input.copy ? "Event copied" : "Event moved");
}

export async function deleteEventAction(eventId: string, confirmPublishedEdit = false) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    assertChannel(u, await eventChannel(eventId));
    await svc.deleteEvent(actor(u), eventId, confirmPublishedEdit);
  }, "Event removed");
}

export async function moveBreakAction(input: { breakId: string; startAt: string; ripple?: boolean; confirmPublishedEdit?: boolean }) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    const b = await prisma.advertisingBreak.findUniqueOrThrow({ where: { id: input.breakId } });
    assertChannel(u, b.channelId);
    const r = await svc.moveBreak(actor(u), input.breakId, new Date(input.startAt), { ripple: input.ripple, confirmPublishedEdit: input.confirmPublishedEdit });
    return { warnings: r.warnings };
  }, "Break moved");
}

export async function placeInBreakAction(input: { breakId: string; assetId: string; confirmPublishedEdit?: boolean }) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    const b = await prisma.advertisingBreak.findUniqueOrThrow({ where: { id: input.breakId } });
    assertChannel(u, b.channelId);
    const r = await svc.placeInBreak(actor(u), input);
    return { id: r.event.id, warnings: r.warnings };
  }, "Spot placed in break");
}

export async function reorderBreakAction(breakId: string, order: string[], confirmPublishedEdit = false) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    const b = await prisma.advertisingBreak.findUniqueOrThrow({ where: { id: breakId } });
    assertChannel(u, b.channelId);
    return svc.reorderBreak(actor(u), breakId, order, confirmPublishedEdit);
  }, "Break order saved");
}

export async function updateEventNotesAction(eventId: string, notes: string) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    assertChannel(u, await eventChannel(eventId));
    const before = await prisma.scheduleEvent.update({ where: { id: eventId }, data: { notes: notes.slice(0, 1000) } });
    await audit({ userId: u.id, userEmail: u.email, action: "schedule.event.notes", entityType: "ScheduleEvent", entityId: eventId, after: { notes } });
    return before.id;
  }, "Notes saved");
}

export async function publishAction(scheduleId: string, comment: string) {
  return run(async () => {
    const u = await requireUser("schedule.publish");
    const s = await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId }, include: { channel: true } });
    assertChannel(u, s.channelId);
    try {
      const r = await svc.publishSchedule(actor(u), scheduleId, comment || undefined);
      return { version: r.schedule.version, warnings: r.warnings.length };
    } catch (e) {
      const v = (e as { details?: { violations?: { message: string }[] } }).details?.violations;
      if (v?.length) await notify("schedule.conflict", { channel: s.channel.name, date: s.broadcastDate, count: v.length, first: v[0].message }, { link: `/scheduling?channel=${s.channelId}&date=${s.broadcastDate}`, channelId: s.channelId });
      throw e;
    }
  }, "Schedule published");
}

export async function restoreVersionAction(scheduleId: string, version: number) {
  return run(async () => {
    const u = await requireUser("schedule.publish");
    const s = await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
    assertChannel(u, s.channelId);
    return svc.restoreVersion(actor(u), scheduleId, version);
  }, "Version restored into the draft");
}

export async function duplicateDayAction(input: { channelId: string; sourceDate: string; from: string; to: string; weekdays: number[]; includeBreaks: boolean }) {
  return run(async () => {
    const u = await requireUser("schedule.edit");
    assertChannel(u, input.channelId);
    const dates: string[] = [];
    for (let d = new Date(`${input.from}T00:00:00Z`); d <= new Date(`${input.to}T00:00:00Z`) && dates.length < 62; d = new Date(d.getTime() + 86400000)) {
      if (!input.weekdays.length || input.weekdays.includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
    }
    if (input.includeBreaks && !u.permissions.has("inventory.manage")) throw new AppError("Copying breaks needs the inventory.manage permission.");
    return svc.duplicateDay(actor(u), { channelId: input.channelId, sourceDate: input.sourceDate, targetDates: dates, includeBreaks: input.includeBreaks });
  }, "Schedule copied");
}

export async function confirmAiredAction(eventIds: string[]) {
  return run(async () => {
    const u = await requireUser("rights.manage");
    const evs = await prisma.scheduleEvent.findMany({ where: { id: { in: eventIds } }, select: { channelId: true } });
    for (const e of evs) assertChannel(u, e.channelId);
    return svc.confirmAired(actor(u), eventIds);
  }, "Marked as aired");
}

export async function validateDayAction(channelId: string, date: string) {
  return run(async () => {
    const u = await requireUser("schedule.view");
    assertChannel(u, channelId);
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const { broadcastDayRange } = await import("@/lib/time");
    const { start, end } = broadcastDayRange(ch, date);
    const v = await svc.validateWindow(prisma, channelId, start, end);
    return v.filter((x) => !x.range || (new Date(x.range.start) >= start && new Date(x.range.start) < end));
  });
}
