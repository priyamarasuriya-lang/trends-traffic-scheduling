"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertChannel } from "@/lib/auth/session";
import { run, formToObject, zStr, zDate, zInt, zBool, zOptId } from "@/lib/action";
import { zonedToUtc } from "@/lib/time";
import { AppError } from "@/lib/errors";
import * as svc from "@/lib/secondary/service";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM or HH:MM:SS");
const schema = z.object({
  channelId: zStr(),
  assetId: zOptId,
  category: z.enum(["LOGO", "BUG", "LOWER_THIRD", "TICKER", "OVERLAY", "COUNTDOWN", "OTHER"]),
  label: zStr(200),
  startDate: zDate,
  startTime: time,
  endDate: zDate,
  endTime: time,
  layer: zInt(1, 20),
  priority: zInt(1, 10),
  isActive: zBool,
});

export async function saveSecondaryAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("secondary.edit");
    const p = schema.parse(formToObject(fd));
    assertChannel(u, p.channelId);
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: p.channelId } });
    const ev = await svc.saveSecondary({ id: u.id, email: u.email }, id, {
      ...p,
      startAt: zonedToUtc(p.startDate, p.startTime.length === 5 ? `${p.startTime}:00` : p.startTime, ch.timezone),
      endAt: zonedToUtc(p.endDate, p.endTime.length === 5 ? `${p.endTime}:00` : p.endTime, ch.timezone),
    });
    return { id: ev.id };
  }, "Secondary event saved");
}

export async function deleteSecondaryAction(id: string) {
  return run(async () => {
    const u = await requireUser("secondary.edit");
    const ev = await prisma.secondaryEvent.findUnique({ where: { id } });
    if (!ev) throw new AppError("The event no longer exists.");
    assertChannel(u, ev.channelId);
    await svc.deleteSecondary({ id: u.id, email: u.email }, id);
  }, "Secondary event deleted");
}
