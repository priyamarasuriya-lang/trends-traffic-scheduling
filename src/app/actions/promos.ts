"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertChannel } from "@/lib/auth/session";
import { run, formToObject, zStr, zDate, zOptInt, zBool } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { planAutofill, applyAutofill } from "@/lib/promos/autofill";

const hhmm = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional());
const toMin = (s?: string) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);

const campaignSchema = z.object({
  name: zStr(120),
  startDate: zDate,
  endDate: zDate,
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]),
  rotation: z.enum(["EVEN", "WEIGHTED", "SEQUENTIAL"]),
  channelIds: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
  windowStart: hhmm,
  windowEnd: hhmm,
  minPlays: zOptInt(0, 100000),
  maxPlays: zOptInt(1, 100000),
  maxPerDay: zOptInt(1, 500),
  minGapSec: zOptInt(0, 86400),
  isActive: zBool,
});

export async function saveCampaignAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("promo.manage");
    const p = campaignSchema.parse(formToObject(fd));
    if (p.endDate < p.startDate) throw new AppError("The end date must be on or after the start date.");
    if (!!p.windowStart !== !!p.windowEnd) throw new AppError("Give both a window start and end, or neither.");
    if (p.minPlays != null && p.maxPlays != null && p.minPlays > p.maxPlays) throw new AppError("Minimum plays cannot exceed maximum plays.");
    const data = { name: p.name, startDate: new Date(`${p.startDate}T00:00:00Z`), endDate: new Date(`${p.endDate}T23:59:59Z`), priority: p.priority, rotation: p.rotation, channelIds: p.channelIds, dayStartMinute: toMin(p.windowStart), dayEndMinute: toMin(p.windowEnd), minPlays: p.minPlays ?? null, maxPlays: p.maxPlays ?? null, maxPerDay: p.maxPerDay ?? null, minGapSec: p.minGapSec ?? null, isActive: p.isActive };
    const c = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.promoCampaign.findUniqueOrThrow({ where: { id } }) : null;
      const c = id ? await tx.promoCampaign.update({ where: { id }, data }) : await tx.promoCampaign.create({ data });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "promo.campaign.update" : "promo.campaign.create", entityType: "PromoCampaign", entityId: c.id, before, after: data }, tx);
      return c;
    });
    return { id: c.id };
  }, "Campaign saved");
}

export async function assignPromoAction(assetId: string, campaignId: string | null) {
  return run(async () => {
    const u = await requireUser("promo.manage");
    const promo = await prisma.promo.findUnique({ where: { assetId } });
    if (!promo) throw new AppError("That asset is not a promo.");
    await prisma.promo.update({ where: { assetId }, data: { campaignId } });
    await audit({ userId: u.id, userEmail: u.email, action: "promo.assign", entityType: "MediaAsset", entityId: assetId, before: { campaignId: promo.campaignId }, after: { campaignId } });
  }, campaignId ? "Promo added to campaign" : "Promo removed from campaign");
}

export async function previewAutofillAction(input: { channelId: string; date: string; campaignIds?: string[] }) {
  return run(async () => {
    const u = await requireUser("promo.autofill");
    const p = z.object({ channelId: z.string(), date: zDate, campaignIds: z.array(z.string()).optional() }).parse(input);
    assertChannel(u, p.channelId);
    return planAutofill(p.channelId, p.date, { campaignIds: p.campaignIds });
  });
}

export async function applyAutofillAction(input: { channelId: string; placements: { assetId: string; startAt: string }[]; confirmPublishedEdit?: boolean }) {
  return run(async () => {
    const u = await requireUser("promo.autofill");
    const p = z.object({ channelId: z.string(), placements: z.array(z.object({ assetId: z.string(), startAt: z.string().datetime() })).max(300), confirmPublishedEdit: z.boolean().optional() }).parse(input);
    assertChannel(u, p.channelId);
    if (!u.permissions.has("schedule.edit")) throw new AppError("Applying auto-fill changes the schedule, which needs schedule edit permission.");
    return applyAutofill({ id: u.id, email: u.email, canEditPublished: u.permissions.has("schedule.publish") }, p.channelId, p.placements, p.confirmPublishedEdit);
  });
}
