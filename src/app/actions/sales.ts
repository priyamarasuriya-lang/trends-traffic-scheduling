"use server";
import { z } from "zod";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zDate, zPct, zMoney, zOptId } from "@/lib/action";
import * as sales from "@/lib/sales/service";
import { invoiceFromReleaseOrder } from "@/lib/billing/service";
import { AppError } from "@/lib/errors";

const actor = (u: CurrentUser) => ({ id: u.id, email: u.email, name: u.name, permissions: u.permissions, canEditPublished: u.permissions.has("schedule.publish") });

const dealLine = z.object({
  channelId: z.string().min(1, "Choose a channel"),
  product: zStr(200),
  timeBand: z.string().optional().nullable(),
  spotDurationSec: z.coerce.number().int().min(1).max(3600),
  quantity: z.coerce.number().int().min(1).max(100000),
  rate: zMoney,
  discountPct: zPct.default("0"),
});
const dealSchema = z.object({
  agencyId: zOptId,
  clientId: z.string().min(1, "Choose a client"),
  campaignName: zStr(200),
  startDate: zDate,
  endDate: zDate,
  currency: z.string().length(3),
  discountPct: zPct,
  commissionPct: zPct,
  taxRatePct: zPct,
  notes: zOptStr(2000),
  lines: z.string().transform((s, ctx) => {
    try {
      return z.array(dealLine).min(1, "Add at least one line").parse(JSON.parse(s));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof z.ZodError ? e.issues.map((i) => `Line ${Number(i.path[0]) + 1}: ${i.message}`).join("; ") : "Invalid lines" });
      return z.NEVER;
    }
  }),
});

export async function saveDealAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("deal.manage");
    const p = dealSchema.parse(formToObject(fd));
    const d = await sales.saveDeal(actor(u), id, { ...p, startDate: new Date(p.startDate), endDate: new Date(p.endDate) });
    return { id: d.id };
  }, "Deal saved");
}

export async function dealStatusAction(id: string, status: "NEGOTIATION" | "CONFIRMED" | "CLOSED" | "CANCELLED", comment: string) {
  return run(async () => {
    const u = await requireUser("deal.manage");
    await sales.setDealStatus(actor(u), id, status, comment);
  }, `Deal ${status.toLowerCase()}`);
}

export async function roFromDealAction(dealId: string) {
  return run(async () => {
    const u = await requireUser("ro.manage");
    const ro = await sales.roFromDeal(actor(u), dealId);
    return { id: ro.id };
  }, "Release order created from deal");
}

const roLine = z.object({
  id: z.string().optional(),
  channelId: z.string().min(1, "Choose a channel"),
  assetId: z.string().optional().nullable(),
  description: zStr(200),
  timeBand: z.string().optional().nullable(),
  spotDurationSec: z.coerce.number().int().min(1).max(3600),
  quantity: z.coerce.number().int().min(1).max(100000),
  rate: zMoney,
  discountPct: zPct.default("0"),
  startDate: zDate,
  endDate: zDate,
  maxPerDay: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1).max(500).nullable()),
});
const roSchema = z.object({
  dealId: zOptId,
  agencyId: zOptId,
  clientId: z.string().min(1, "Choose a client"),
  campaignName: zStr(200),
  startDate: zDate,
  endDate: zDate,
  currency: z.string().length(3),
  commissionPct: zPct,
  taxRatePct: zPct,
  clientRef: zOptStr(100),
  notes: zOptStr(2000),
  lines: z.string().transform((s, ctx) => {
    try {
      return z.array(roLine).min(1, "Add at least one line").parse(JSON.parse(s));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof z.ZodError ? e.issues.map((i) => `Line ${Number(i.path[0]) + 1} ${String(i.path[1] ?? "")}: ${i.message}`).join("; ") : "Invalid lines" });
      return z.NEVER;
    }
  }),
});

export async function saveROAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("ro.manage");
    const p = roSchema.parse(formToObject(fd));
    const ro = await sales.saveReleaseOrder(actor(u), id, {
      ...p,
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
      lines: p.lines.map((l) => ({ ...l, startDate: new Date(l.startDate), endDate: new Date(l.endDate) })),
    });
    return { id: ro.id };
  }, "Release order saved");
}

export async function submitROAction(id: string) {
  return run(async () => {
    const u = await requireUser("ro.manage");
    await sales.submitReleaseOrder(actor(u), id);
  }, "Submitted for approval");
}

export async function approveROAction(id: string, comment: string) {
  return run(async () => {
    const u = await requireUser();
    if (![...u.permissions].some((p) => p.startsWith("ro.approve"))) throw new AppError("You cannot approve release orders.");
    const r = await sales.approveReleaseOrder(actor(u), id, comment || undefined);
    return r.final ? { message: `Approved — ${r.booked} spot(s) booked in inventory` } : { message: `Approved; now awaiting ${r.nextStage}` };
  }, "Approved");
}

export async function rejectROAction(id: string, comment: string) {
  return run(async () => {
    const u = await requireUser();
    await sales.rejectReleaseOrder(actor(u), id, comment);
  }, "Rejected");
}

export async function amendROAction(id: string, reason: string) {
  return run(async () => {
    const u = await requireUser("ro.manage");
    await sales.amendReleaseOrder(actor(u), id, reason);
  }, "Amendment started — RO is back in draft as a new revision");
}

export async function cancelROAction(id: string, reason: string) {
  return run(async () => {
    const u = await requireUser("ro.cancel");
    await sales.cancelReleaseOrder(actor(u), id, reason);
  }, "Release order cancelled");
}

export async function placeSpotsAction(id: string) {
  return run(async () => {
    const u = await requireUser(["ro.schedule", "schedule.edit"]);
    const r = await sales.autoPlaceSpots(actor(u), id);
    if (!r.placed && r.problems.length) throw new AppError(`No spots placed. ${r.problems.slice(0, 3).join(" ")}`);
    return r;
  }, "Spots placed on the schedule");
}

export async function invoiceROAction(id: string) {
  return run(async () => {
    const u = await requireUser("invoice.issue");
    const inv = await invoiceFromReleaseOrder({ id: u.id, email: u.email }, id);
    return { id: inv.id };
  }, "Draft invoice created");
}
