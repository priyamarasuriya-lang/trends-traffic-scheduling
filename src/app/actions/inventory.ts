"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertChannel, type CurrentUser } from "@/lib/auth/session";
import { run, formToObject, zDate, zInt, zMoney, zOptStr, zStr } from "@/lib/action";
import { AppError } from "@/lib/errors";
import * as inv from "@/lib/inventory/service";
import type { Actor } from "@/lib/scheduling/service";

const actor = (u: CurrentUser): Actor => ({ id: u.id, email: u.email, canEditPublished: u.permissions.has("schedule.publish") });

async function inventoryChannel(inventoryId: string) {
  const i = await prisma.advertisingInventory.findUnique({ where: { id: inventoryId }, select: { break: { select: { channelId: true } } } });
  if (!i) throw new AppError("This position no longer exists. Refresh the page.");
  return i.break.channelId;
}

const GenerateSchema = z.object({
  channelId: zStr(),
  fromDate: zDate,
  toDate: zDate,
  times: z
    .string()
    .trim()
    .min(1, "Enter at least one time")
    .transform((s) => s.split(/[\s,;]+/).filter(Boolean))
    .refine((a) => a.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)), "Use 24-hour HH:MM times, separated by commas")
    .refine((a) => new Set(a).size === a.length, "Each time may appear once"),
  positions: zInt(1, 30),
  positionDurationSec: zInt(5, 600),
  programTitle: zOptStr(120),
});

export async function generateBreaksAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("inventory.manage");
    const p = GenerateSchema.parse(formToObject(fd));
    assertChannel(u, p.channelId);
    const days = (Date.parse(p.toDate) - Date.parse(p.fromDate)) / 86400000;
    if (days > 92) throw new AppError("Generate at most 93 days at a time.");
    const r = await inv.generateBreaks(actor(u), p);
    return r;
  }, "Breaks generated");
}

export async function deleteBreakAction(breakId: string) {
  return run(async () => {
    const u = await requireUser("inventory.manage");
    const b = await prisma.advertisingBreak.findUnique({ where: { id: breakId }, select: { channelId: true } });
    if (!b) throw new AppError("The break no longer exists.");
    assertChannel(u, b.channelId);
    await inv.deleteBreak(actor(u), breakId);
  }, "Break deleted");
}

export async function setInventoryStatusAction(inventoryId: string, status: "AVAILABLE" | "UNAVAILABLE", version: number) {
  return run(async () => {
    const u = await requireUser("inventory.manage");
    const p = z.object({ id: z.string(), status: z.enum(["AVAILABLE", "UNAVAILABLE"]), version: z.number().int().min(0) }).parse({ id: inventoryId, status, version });
    assertChannel(u, await inventoryChannel(p.id));
    await inv.setInventoryStatus(actor(u), p.id, p.status, p.version);
  }, status === "AVAILABLE" ? "Position released for sale" : "Position withdrawn from sale");
}

export async function updateInventoryRateAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("inventory.manage");
    const p = z.object({ id: zStr(), rate: zMoney.refine((v) => Number(v) >= 0, "Rate cannot be negative"), version: zInt(0) }).parse(formToObject(fd));
    assertChannel(u, await inventoryChannel(p.id));
    await inv.updateInventoryRate(actor(u), p.id, p.rate, p.version);
  }, "Rate updated");
}
