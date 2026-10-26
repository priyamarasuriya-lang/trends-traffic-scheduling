"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zOptInt, zBool, zOptId } from "@/lib/action";
import { parseDuration } from "@/lib/time";
import * as media from "@/lib/media/service";

const CATEGORIES = ["PROGRAM", "MOVIE", "COMMERCIAL", "PROMO", "TIMER", "SLIDE", "COMING_UP", "FILLER", "NEW_MEDIA", "SECONDARY"] as const;

const schema = z.object({
  assetCode: zStr(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, dot, dash and underscore only"),
  title: zStr(200),
  category: z.enum(CATEGORIES),
  description: zOptStr(2000),
  duration: z
    .string()
    .trim()
    .transform((s, ctx) => {
      const n = parseDuration(s);
      if (n == null || n < 0 || n > 86400) {
        ctx.addIssue({ code: "custom", message: "Use HH:MM:SS, MM:SS or seconds" });
        return z.NEVER;
      }
      return n;
    }),
  fileRef: zOptStr(500),
  language: zOptStr(40),
  rightsOwner: zOptStr(200),
  permittedChannelIds: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
  maxPlays: zOptInt(1, 1_000_000),
  contentCategory: zOptStr(40),
  brand: zOptStr(80),
  productCategory: zOptStr(40),
  advertiserId: zOptId,
  versionNotes: zOptStr(500),
  genre: zOptStr(60),
  season: zOptInt(0, 999),
  episode: zOptInt(0, 99999),
  contentRating: zOptStr(20),
  isLive: zBool,
  director: zOptStr(120),
  releaseYear: zOptInt(1880, 2100),
  certificate: zOptStr(20),
  clockNumber: zOptStr(40),
  agencyRef: zOptStr(80),
  campaignId: zOptId,
  promotedTitle: zOptStr(200),
});

export async function saveAssetAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("media.manage");
    const p = schema.parse(formToObject(fd));
    if (p.duration === 0 && p.category !== "SECONDARY") throw new z.ZodError([{ code: "custom", path: ["duration"], message: "Duration must be more than zero" }]);
    const a = await media.saveAsset({ id: u.id, email: u.email }, id, { ...p, durationSec: p.duration, assetCode: p.assetCode.toUpperCase() });
    return { id: a.id };
  }, "Asset saved");
}

export async function setApprovalAction(id: string, status: "APPROVED" | "REJECTED" | "RETIRED" | "PENDING", comment: string) {
  return run(async () => {
    const u = await requireUser(status === "RETIRED" || status === "PENDING" ? "media.manage" : "media.approve");
    await media.setApproval({ id: u.id, email: u.email }, id, status, comment);
  }, `Asset ${status.toLowerCase()}`);
}

export async function deleteAssetAction(id: string) {
  return run(async () => {
    const u = await requireUser("media.manage");
    await media.deleteAsset({ id: u.id, email: u.email }, id);
  }, "Asset deleted");
}
