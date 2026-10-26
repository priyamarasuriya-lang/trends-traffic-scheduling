import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { broadcastDayRange, localSecondOfDay } from "../time";
import { addEvent, loadRules, type Actor } from "../scheduling/service";

export type Placement = { assetId: string; title: string; campaignId: string; campaign: string; startAt: string; durationSec: number; reason: string };
export type AutofillPlan = { placements: Placement[]; gaps: number; gapSeconds: number; filledSeconds: number; notes: string[] };

const PRIORITY_WEIGHT = { CRITICAL: 8, HIGH: 4, NORMAL: 2, LOW: 1 } as const;

/**
 * Plan promo placements into the free gaps of a channel's broadcast day.
 * Promos never take sellable commercial-break positions; they only fill time
 * the primary track leaves empty. The plan is a preview: nothing is written.
 */
export async function planAutofill(channelId: string, date: string, opts: { campaignIds?: string[]; minGapFloorSec?: number } = {}): Promise<AutofillPlan> {
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  const { start, end } = broadcastDayRange(ch, date);
  const now = Date.now();
  const notes: string[] = [];
  const [events, breaks, campaigns, rules] = await Promise.all([
    prisma.scheduleEvent.findMany({ where: { channelId, breakId: null, status: { not: "CANCELLED" }, startAt: { lt: end }, OR: [{ startAt: { gte: new Date(start.getTime() - 6 * 3600_000) } }] }, select: { startAt: true, durationSec: true, assetId: true } }),
    prisma.advertisingBreak.findMany({ where: { channelId, startAt: { gte: new Date(start.getTime() - 3600_000), lt: end } }, select: { startAt: true, maxDurationSec: true } }),
    prisma.promoCampaign.findMany({
      where: { isActive: true, startDate: { lte: end }, endDate: { gte: start }, ...(opts.campaignIds?.length ? { id: { in: opts.campaignIds } } : {}) },
      include: { promos: { include: { asset: true } } },
    }),
    prisma.$transaction((tx) => loadRules(tx, channelId)),
  ]);
  const sepRule = rules.find((r) => r.key === "COMMERCIAL_MIN_SEPARATION" && r.enabled);
  const ruleGap = Number((sepRule?.params as { minSeconds?: number } | undefined)?.minSeconds ?? 0);

  // Occupied intervals on the primary track (events + whole breaks), clipped to the day.
  const blocks = [...events.map((e) => [e.startAt.getTime(), e.startAt.getTime() + e.durationSec * 1000]), ...breaks.map((b) => [b.startAt.getTime(), b.startAt.getTime() + b.maxDurationSec * 1000])].sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = Math.max(start.getTime(), now + 5 * 60_000); // never plan into the past or the next five minutes
  for (const [s, e] of blocks) {
    if (s > cursor && Math.min(s, end.getTime()) > cursor) gaps.push([cursor, Math.min(s, end.getTime())]);
    cursor = Math.max(cursor, e);
    if (cursor >= end.getTime()) break;
  }
  if (cursor < end.getTime()) gaps.push([cursor, end.getTime()]);

  // Eligible promos with their running counts.
  type Cand = { assetId: string; title: string; dur: number; campaignId: string; campaign: string; weight: number; win: [number, number] | null; maxPerDay: number | null; remainingTotal: number | null; minGap: number; today: number; last: number[]; seq: number };
  const cands: Cand[] = [];
  for (const c of campaigns) {
    if (c.channelIds.length && !c.channelIds.includes(channelId)) continue;
    const assets = c.promos.map((p) => p.asset).filter((a) => !a.deletedAt && a.approvalStatus === "APPROVED" && (!a.permittedChannelIds.length || a.permittedChannelIds.includes(channelId)));
    if (!assets.length) {
      notes.push(`${c.name}: no approved promo assets for this channel.`);
      continue;
    }
    const totalPlays = await prisma.scheduleEvent.count({ where: { assetId: { in: assets.map((a) => a.id) }, status: { in: ["PLANNED", "AIRED"] } } });
    const remainingTotal = c.maxPlays != null ? Math.max(0, c.maxPlays - totalPlays) : null;
    if (remainingTotal === 0) {
      notes.push(`${c.name}: maximum of ${c.maxPlays} plays already reached.`);
      continue;
    }
    for (const [i, a] of assets.entries()) {
      const plays = await prisma.scheduleEvent.findMany({ where: { assetId: a.id, channelId, status: { not: "CANCELLED" }, startAt: { gte: new Date(start.getTime() - 86400_000), lt: new Date(end.getTime() + 86400_000) } }, select: { startAt: true } });
      cands.push({
        assetId: a.id,
        title: a.title,
        dur: a.durationSec,
        campaignId: c.id,
        campaign: c.name,
        weight: PRIORITY_WEIGHT[c.priority],
        win: c.dayStartMinute != null && c.dayEndMinute != null ? [c.dayStartMinute, c.dayEndMinute] : null,
        maxPerDay: c.maxPerDay,
        remainingTotal,
        minGap: Math.max(c.minGapSec ?? 0, ruleGap, opts.minGapFloorSec ?? 0),
        today: plays.filter((p) => p.startAt >= start && p.startAt < end).length,
        last: plays.map((p) => p.startAt.getTime()),
        seq: i,
      });
    }
  }
  if (!cands.length) return { placements: [], gaps: gaps.length, gapSeconds: gaps.reduce((n, [s, e]) => n + (e - s) / 1000, 0), filledSeconds: 0, notes: notes.length ? notes : ["No active promo campaign covers this channel and date."] };

  const campaignLeft = new Map(cands.map((c) => [c.campaignId, c.remainingTotal]));
  const rotation = new Map(campaigns.map((c) => [c.id, c.rotation]));
  const placements: Placement[] = [];
  const inWindow = (c: Cand, t: number) => {
    if (!c.win) return true;
    const m = Math.floor(localSecondOfDay(new Date(t), ch.timezone) / 60);
    const [a, b] = c.win;
    return a <= b ? m >= a && m < b : m >= a || m < b;
  };
  for (const [gs, ge] of gaps) {
    let t = gs;
    for (let guard = 0; guard < 3000 && t < ge; guard++) {
      const room = (ge - t) / 1000;
      const ok = cands.filter(
        (c) =>
          c.dur <= room &&
          (c.maxPerDay == null || c.today < c.maxPerDay) &&
          (campaignLeft.get(c.campaignId) ?? 1) !== 0 &&
          inWindow(c, t) &&
          c.last.every((p) => Math.abs(p - t) >= c.minGap * 1000),
      );
      if (!ok.length) {
        // Jump to the next moment a promo frees up from separation, or step a minute (time windows).
        const next = Math.min(...cands.flatMap((c) => c.last.map((p) => p + c.minGap * 1000)).filter((x) => x > t), t + 60_000);
        t = next;
        continue;
      }
      // Higher priority first; within a priority EVEN spreads plays, WEIGHTED favours weight per play, SEQUENTIAL keeps asset order.
      const score = (c: Cand) => {
        const rot = rotation.get(c.campaignId);
        if (rot === "WEIGHTED") return c.weight * 100 / (c.today + 1);
        return c.weight * 100 - c.today - (rot === "SEQUENTIAL" ? c.seq / 1000 : 0);
      };
      ok.sort((a, b) => score(b) - score(a) || b.dur - a.dur);
      const pick = ok[0];
      placements.push({ assetId: pick.assetId, title: pick.title, campaignId: pick.campaignId, campaign: pick.campaign, startAt: new Date(t).toISOString(), durationSec: pick.dur, reason: `${Math.round(room)}s free` });
      pick.today++;
      pick.last.push(t);
      const left = campaignLeft.get(pick.campaignId);
      if (left != null) campaignLeft.set(pick.campaignId, left - 1);
      if (rotation.get(pick.campaignId) === "SEQUENTIAL") pick.seq += 1000;
      t += pick.dur * 1000;
    }
  }
  const gapSeconds = gaps.reduce((n, [s, e]) => n + (e - s) / 1000, 0);
  return { placements, gaps: gaps.length, gapSeconds, filledSeconds: placements.reduce((n, p) => n + p.durationSec, 0), notes };
}

/** Apply approved placements one by one through the normal scheduling path, so every rule is enforced. */
export async function applyAutofill(actor: Actor, channelId: string, placements: { assetId: string; startAt: string }[], confirmPublishedEdit = false) {
  if (!placements.length) throw new AppError("Select at least one placement to apply.");
  if (placements.length > 300) throw new AppError("Apply at most 300 placements at a time.");
  const applied: string[] = [];
  const skipped: { startAt: string; reason: string }[] = [];
  for (const p of placements) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: p.assetId }, select: { category: true } });
    if (asset?.category !== "PROMO") {
      skipped.push({ startAt: p.startAt, reason: "Not a promo asset." });
      continue;
    }
    try {
      const r = await addEvent(actor, { channelId, assetId: p.assetId, startAt: new Date(p.startAt), confirmPublishedEdit, notes: "Promo auto-fill" });
      applied.push(r.event.id);
    } catch (e) {
      if (e instanceof AppError && e.code === "CONFIRM_PUBLISHED_EDIT") throw e;
      skipped.push({ startAt: p.startAt, reason: e instanceof Error ? e.message : "failed" });
    }
  }
  await audit({ userId: actor.id, userEmail: actor.email, action: "promo.autofill.apply", entityType: "Channel", entityId: channelId, after: { applied: applied.length, skipped: skipped.length } });
  return { applied: applied.length, skipped };
}
