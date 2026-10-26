// Pure scheduling rules engine. No database access: callers load the affected
// window (events, breaks, assets, licences, rules) and ask the engine whether
// it is valid. Every rejection carries a human-readable explanation and the
// exact time range involved.

export type Severity = "ERROR" | "WARNING";

export type EngineLicense = {
  validFrom: Date;
  validTo: Date;
  permittedChannelIds: string[];
  maxPlays: number | null;
  restricted: boolean;
  warnDaysBefore: number;
};

export type EngineAsset = {
  id: string;
  title: string;
  category: string;
  durationSec: number;
  approvalStatus: string;
  deleted: boolean;
  permittedChannelIds: string[];
  brand?: string | null;
  productCategory?: string | null;
  advertiserId?: string | null;
  contentCategory?: string | null;
  licenses: EngineLicense[];
  /** Planned + confirmed plays already recorded outside the events being validated. */
  existingPlays: number;
  promoCampaign?: { startDate: Date; endDate: Date; channelIds: string[]; maxPerDay: number | null; minGapSec: number | null; isActive: boolean } | null;
};

export type EngineRoLine = { id: string; startDate: Date; endDate: Date; maxPerDay: number | null; channelId: string };

export type EngineEvent = {
  id: string;
  assetId: string;
  eventType: string;
  title: string;
  startAt: Date;
  durationSec: number;
  breakId?: string | null;
  positionInBreak?: number | null;
  roLine?: EngineRoLine | null;
  status?: string;
};

export type EngineBreak = { id: string; code: string; startAt: Date; maxDurationSec: number };

export type RuleConfig = { key: RuleKey; enabled: boolean; severity: Severity; params: Record<string, unknown> };

export type Violation = {
  rule: RuleKey;
  severity: Severity;
  message: string;
  eventIds: string[];
  range?: { start: string; end: string };
};

export type EngineContext = {
  channel: { id: string; timezone: string; broadcastDayStartHour?: number };
  events: EngineEvent[];
  breaks: EngineBreak[];
  assets: Map<string, EngineAsset>;
  rules: RuleConfig[];
  /** Only violations touching these events block the change. Empty = validate everything. */
  changedEventIds?: Set<string>;
  changedBreakIds?: Set<string>;
  now?: Date;
};

export const RULE_DEFINITIONS = {
  NO_OVERLAP: { name: "No overlapping events", description: "Primary events and commercial breaks may not overlap on a channel.", defaults: {} },
  BREAK_MAX_DURATION: { name: "Maximum break duration", description: "Spots in a break may not exceed the break length.", defaults: {} },
  BACK_TO_BACK_ADVERTISER: { name: "No back-to-back advertiser", description: "Two adjacent spots in a break may not belong to the same advertiser.", defaults: {} },
  SAME_BREAK_BRAND: { name: "Same-break brand limit", description: "A brand may appear only a limited number of times in one break.", defaults: { maxPerBreak: 1 } },
  BRAND_SEPARATION: { name: "Brand separation", description: "Minimum seconds between two spots of the same brand.", defaults: { minSeconds: 900 } },
  COMPETITOR_SEPARATION: { name: "Competitor separation", description: "Minimum seconds between competing advertisers in the same product category.", defaults: { minSeconds: 600 } },
  ADVERTISER_RESTRICTION: { name: "Advertiser restrictions", description: "Advertisers blocked from this channel, optionally in a time window.", defaults: { blocked: [] as { advertiserId: string; startMinute?: number; endMinute?: number; reason?: string }[] } },
  CAMPAIGN_FREQUENCY: { name: "Campaign frequency limit", description: "Maximum spots per day for an RO line (line limit overrides default).", defaults: { defaultMaxPerDay: 0 } },
  PROGRAM_START_TIME: { name: "Program start times", description: "Programs and movies must start on the configured minute marks.", defaults: { allowedMinutes: [0, 30], toleranceSec: 0 } },
  COMMERCIAL_MIN_SEPARATION: { name: "Same-spot separation", description: "Minimum seconds between two airings of the same commercial or promo.", defaults: { minSeconds: 1800 } },
  CATEGORY_RESTRICTION: { name: "Content category windows", description: "Restricted content categories may only air inside their allowed local-time window.", defaults: { restrictions: [{ category: "ALCOHOL", startMinute: 1320, endMinute: 300 }] as { category: string; startMinute: number; endMinute: number }[] } },
  CAMPAIGN_DATES: { name: "Campaign dates", description: "Spots must air within their RO line / promo campaign dates.", defaults: {} },
  APPROVED_CONTENT: { name: "Approved content only", description: "Only assets with APPROVED status may be scheduled.", defaults: {} },
  ASSET_AVAILABILITY: { name: "Asset availability", description: "Asset must be active and permitted on the channel.", defaults: {} },
  LICENSE: { name: "Content licence", description: "Licensed content needs a valid, unrestricted licence for the channel with plays remaining.", defaults: { requireLicenseFor: ["PROGRAM", "MOVIE"] } },
} as const;

export type RuleKey = keyof typeof RULE_DEFINITIONS;

export const DEFAULT_RULES: RuleConfig[] = (Object.keys(RULE_DEFINITIONS) as RuleKey[]).map((key) => ({
  key,
  enabled: true,
  severity: key === "PROGRAM_START_TIME" ? "WARNING" : "ERROR",
  params: { ...RULE_DEFINITIONS[key].defaults },
}));

// ───────────────────────── helpers ─────────────────────────

export const endOf = (e: { startAt: Date; durationSec: number }) => new Date(e.startAt.getTime() + e.durationSec * 1000);
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

function localHM(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}
function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** Broadcast date: local times before the broadcast-day start belong to the previous day. */
function broadcastDate(d: Date, tz: string, startHour: number) {
  const { h } = localHM(d, tz);
  return h < startHour ? localDate(new Date(d.getTime() - (h + 1) * 3600 * 1000), tz) : localDate(d, tz);
}
const fmt = (d: Date, tz: string) => {
  const { h, m, s } = localHM(d, tz);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
};
const inWindow = (minute: number, start: number, end: number) => (start <= end ? minute >= start && minute < end : minute >= start || minute < end);
const minutesLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Recompute spot start times inside a break from their positions. */
export function layoutBreak<T extends EngineEvent>(brk: EngineBreak, spots: T[]): T[] {
  const sorted = [...spots].sort((a, b) => (a.positionInBreak ?? 0) - (b.positionInBreak ?? 0));
  let offset = 0;
  return sorted.map((s, i) => {
    const out = { ...s, positionInBreak: i + 1, startAt: new Date(brk.startAt.getTime() + offset * 1000) };
    offset += s.durationSec;
    return out;
  });
}

export type Block = { id: string; kind: "event" | "break"; startAt: Date; durationSec: number };

/**
 * Ripple: after a block moves/grows, push every following block that would now
 * overlap so it starts when the previous one ends. Blocks before the changed
 * one are never moved. Returns the new start times of shifted blocks.
 */
export function ripple(blocks: Block[], changedId: string): Map<string, Date> {
  const sorted = [...blocks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || (a.id === changedId ? -1 : 1));
  const idx = sorted.findIndex((b) => b.id === changedId);
  const shifted = new Map<string, Date>();
  if (idx < 0) return shifted;
  let cursor = endOf(sorted[idx]).getTime();
  for (let i = idx + 1; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.startAt.getTime() >= cursor) break;
    const start = new Date(cursor);
    shifted.set(b.id, start);
    cursor = start.getTime() + b.durationSec * 1000;
  }
  return shifted;
}

// ───────────────────────── validation ─────────────────────────

export function validateSchedule(ctx: EngineContext): Violation[] {
  const tz = ctx.channel.timezone;
  const dayStart = ctx.channel.broadcastDayStartHour ?? 0;
  const now = ctx.now ?? new Date();
  const rules = new Map(ctx.rules.filter((r) => r.enabled).map((r) => [r.key, r]));
  const out: Violation[] = [];
  const add = (key: RuleKey, message: string, eventIds: string[], range?: { start: Date; end: Date }) => {
    const r = rules.get(key);
    if (!r) return;
    out.push({ rule: key, severity: r.severity, message, eventIds, range: range && { start: range.start.toISOString(), end: range.end.toISOString() } });
  };
  const P = <T>(key: RuleKey, name: string, fallback: T): T => {
    const v = rules.get(key)?.params?.[name];
    return (v === undefined || v === null ? fallback : v) as T;
  };

  const events = ctx.events.filter((e) => e.status !== "CANCELLED");
  const primary = events.filter((e) => !e.breakId);
  const spots = events.filter((e) => e.breakId);
  const breaksById = new Map(ctx.breaks.map((b) => [b.id, b]));
  const asset = (e: EngineEvent) => ctx.assets.get(e.assetId);

  // NO_OVERLAP — primary events and breaks are blocks on one track.
  if (rules.has("NO_OVERLAP")) {
    const blocks = [
      ...primary.map((e) => ({ id: e.id, label: `"${e.title}"`, s: e.startAt.getTime(), e: endOf(e).getTime(), isBreak: false })),
      ...ctx.breaks.map((b) => ({ id: b.id, label: `break ${b.code}`, s: b.startAt.getTime(), e: b.startAt.getTime() + b.maxDurationSec * 1000, isBreak: true })),
    ].sort((a, b) => a.s - b.s);
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length && blocks[j].s < blocks[i].e; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (!overlaps(a.s, a.e, b.s, b.e)) continue;
        const start = new Date(Math.max(a.s, b.s));
        const end = new Date(Math.min(a.e, b.e));
        add("NO_OVERLAP", `${a.label} overlaps ${b.label} from ${fmt(start, tz)} to ${fmt(end, tz)}.`, [a.id, b.id], { start, end });
      }
    }
  }

  // Break-level rules
  const spotsByBreak = new Map<string, EngineEvent[]>();
  for (const s of spots) spotsByBreak.set(s.breakId!, [...(spotsByBreak.get(s.breakId!) ?? []), s]);
  for (const [breakId, list] of spotsByBreak) {
    const brk = breaksById.get(breakId);
    if (!brk) continue;
    const ordered = [...list].sort((a, b) => (a.positionInBreak ?? 0) - (b.positionInBreak ?? 0));
    const total = ordered.reduce((n, s) => n + s.durationSec, 0);
    if (total > brk.maxDurationSec) {
      add("BREAK_MAX_DURATION", `Break ${brk.code} holds ${total}s of spots but allows ${brk.maxDurationSec}s (over by ${total - brk.maxDurationSec}s).`, [brk.id, ...ordered.map((s) => s.id)], {
        start: brk.startAt,
        end: new Date(brk.startAt.getTime() + total * 1000),
      });
    }
    for (let i = 1; i < ordered.length; i++) {
      const a = asset(ordered[i - 1]);
      const b = asset(ordered[i]);
      if (a?.advertiserId && a.advertiserId === b?.advertiserId) {
        add("BACK_TO_BACK_ADVERTISER", `"${ordered[i - 1].title}" and "${ordered[i].title}" are back-to-back in break ${brk.code} for the same advertiser.`, [ordered[i - 1].id, ordered[i].id], {
          start: ordered[i - 1].startAt,
          end: endOf(ordered[i]),
        });
      }
    }
    const maxPerBreak = Number(P("SAME_BREAK_BRAND", "maxPerBreak", 1));
    const byBrand = new Map<string, EngineEvent[]>();
    for (const s of ordered) {
      const brand = asset(s)?.brand;
      if (brand) byBrand.set(brand.toLowerCase(), [...(byBrand.get(brand.toLowerCase()) ?? []), s]);
    }
    for (const [, l] of byBrand) {
      if (l.length > maxPerBreak) add("SAME_BREAK_BRAND", `Brand "${asset(l[0])?.brand}" appears ${l.length} times in break ${brk.code} (limit ${maxPerBreak}).`, l.map((s) => s.id), { start: brk.startAt, end: endOf(l[l.length - 1]) });
    }
  }

  // Separation rules across the whole window (commercial-type spots)
  const commercialish = events.filter((e) => ["COMMERCIAL", "PROMO"].includes(e.eventType)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const brandSep = Number(P("BRAND_SEPARATION", "minSeconds", 900));
  const compSep = Number(P("COMPETITOR_SEPARATION", "minSeconds", 600));
  const sameSep = Number(P("COMMERCIAL_MIN_SEPARATION", "minSeconds", 1800));
  for (let i = 0; i < commercialish.length; i++) {
    for (let j = i + 1; j < commercialish.length; j++) {
      const a = commercialish[i];
      const b = commercialish[j];
      const gap = (b.startAt.getTime() - endOf(a).getTime()) / 1000;
      if (gap >= Math.max(brandSep, compSep, sameSep)) break;
      const aa = asset(a);
      const ab = asset(b);
      if (!aa || !ab) continue;
      const range = { start: a.startAt, end: endOf(b) };
      if (a.assetId === b.assetId && gap < sameSep && a.eventType === "COMMERCIAL") {
        add("COMMERCIAL_MIN_SEPARATION", `"${a.title}" airs at ${fmt(a.startAt, tz)} and again at ${fmt(b.startAt, tz)}; minimum separation is ${sameSep}s.`, [a.id, b.id], range);
      } else if (aa.brand && ab.brand && aa.brand.toLowerCase() === ab.brand.toLowerCase() && gap < brandSep && (!a.breakId || a.breakId !== b.breakId)) {
        add("BRAND_SEPARATION", `Brand "${aa.brand}" airs at ${fmt(a.startAt, tz)} and ${fmt(b.startAt, tz)}, only ${Math.max(0, Math.round(gap))}s apart (minimum ${brandSep}s).`, [a.id, b.id], range);
      }
      if (aa.productCategory && aa.productCategory === ab.productCategory && aa.advertiserId && ab.advertiserId && aa.advertiserId !== ab.advertiserId && gap < compSep) {
        add("COMPETITOR_SEPARATION", `Competitors in "${aa.productCategory}" — "${a.title}" and "${b.title}" — are ${Math.max(0, Math.round(gap))}s apart (minimum ${compSep}s).`, [a.id, b.id], range);
      }
    }
  }

  // Per-event rules
  const blocked = P<{ advertiserId: string; startMinute?: number; endMinute?: number; reason?: string }[]>("ADVERTISER_RESTRICTION", "blocked", []);
  const allowedMinutes = P<number[]>("PROGRAM_START_TIME", "allowedMinutes", [0, 30]);
  const tolerance = Number(P("PROGRAM_START_TIME", "toleranceSec", 0));
  const restrictions = P<{ category: string; startMinute: number; endMinute: number }[]>("CATEGORY_RESTRICTION", "restrictions", []);
  const requireLicenseFor = P<string[]>("LICENSE", "requireLicenseFor", ["PROGRAM", "MOVIE"]);
  const playsInWindow = new Map<string, number>();
  for (const e of events) playsInWindow.set(e.assetId, (playsInWindow.get(e.assetId) ?? 0) + 1);

  for (const e of events) {
    const a = asset(e);
    const range = { start: e.startAt, end: endOf(e) };
    if (!a) {
      add("ASSET_AVAILABILITY", `Asset for "${e.title}" no longer exists.`, [e.id], range);
      continue;
    }
    const { h, m, s } = localHM(e.startAt, tz);
    const minuteOfDay = h * 60 + m;
    const day = broadcastDate(e.startAt, tz, dayStart);

    if (a.deleted) add("ASSET_AVAILABILITY", `"${a.title}" has been deleted from the media library.`, [e.id], range);
    else if (a.permittedChannelIds.length && !a.permittedChannelIds.includes(ctx.channel.id)) add("ASSET_AVAILABILITY", `"${a.title}" is not permitted on this channel.`, [e.id], range);

    if (a.approvalStatus !== "APPROVED") add("APPROVED_CONTENT", `"${a.title}" is ${a.approvalStatus.toLowerCase()}, not approved for air.`, [e.id], range);

    if (a.advertiserId) {
      for (const b of blocked) {
        if (b.advertiserId !== a.advertiserId) continue;
        if (b.startMinute == null || b.endMinute == null || inWindow(minuteOfDay, b.startMinute, b.endMinute)) {
          add("ADVERTISER_RESTRICTION", `The advertiser of "${a.title}" is restricted on this channel${b.startMinute != null ? ` between ${minutesLabel(b.startMinute)} and ${minutesLabel(b.endMinute!)}` : ""}${b.reason ? ` (${b.reason})` : ""}.`, [e.id], range);
        }
      }
    }

    if ((e.eventType === "PROGRAM" || e.eventType === "MOVIE") && allowedMinutes.length) {
      const secIntoHour = m * 60 + s;
      const ok = allowedMinutes.some((am) => Math.abs(secIntoHour - am * 60) <= tolerance);
      if (!ok) add("PROGRAM_START_TIME", `"${e.title}" starts at ${fmt(e.startAt, tz)}; programs must start at minute ${allowedMinutes.map((x) => `:${String(x).padStart(2, "0")}`).join(" or ")}.`, [e.id], range);
    }

    if (a.contentCategory) {
      for (const r of restrictions) {
        if (r.category.toUpperCase() !== a.contentCategory.toUpperCase()) continue;
        if (!inWindow(minuteOfDay, r.startMinute, r.endMinute)) add("CATEGORY_RESTRICTION", `"${a.title}" is ${a.contentCategory} content and may only air between ${minutesLabel(r.startMinute)} and ${minutesLabel(r.endMinute)} (scheduled ${fmt(e.startAt, tz)}).`, [e.id], range);
      }
    }

    if (e.roLine) {
      const d0 = e.roLine.startDate.toISOString().slice(0, 10);
      const d1 = e.roLine.endDate.toISOString().slice(0, 10);
      if (day < d0 || day > d1) add("CAMPAIGN_DATES", `"${e.title}" is scheduled on ${day}, outside its release order dates ${d0} to ${d1}.`, [e.id], range);
      if (e.roLine.channelId !== ctx.channel.id) add("CAMPAIGN_DATES", `"${e.title}" belongs to an RO line booked on a different channel.`, [e.id], range);
    }
    if (a.promoCampaign) {
      const c = a.promoCampaign;
      const d0 = c.startDate.toISOString().slice(0, 10);
      const d1 = c.endDate.toISOString().slice(0, 10);
      if (!c.isActive || day < d0 || day > d1) add("CAMPAIGN_DATES", `Promo "${a.title}" is outside its campaign period ${d0} to ${d1}${c.isActive ? "" : " (campaign inactive)"}.`, [e.id], range);
      if (c.channelIds.length && !c.channelIds.includes(ctx.channel.id)) add("CAMPAIGN_DATES", `Promo campaign for "${a.title}" is restricted to other channels.`, [e.id], range);
    }

    const needsLicense = requireLicenseFor.includes(a.category) || a.licenses.length > 0;
    if (needsLicense) {
      const valid = a.licenses.filter((l) => l.validFrom <= e.startAt && l.validTo >= endOf(e) && (!l.permittedChannelIds.length || l.permittedChannelIds.includes(ctx.channel.id)));
      if (!a.licenses.length) add("LICENSE", `"${a.title}" has no content licence on record.`, [e.id], range);
      else if (!valid.length) {
        const expired = a.licenses.every((l) => l.validTo < e.startAt);
        add("LICENSE", expired ? `The licence for "${a.title}" expired before ${day}.` : `No licence for "${a.title}" covers ${day} on this channel.`, [e.id], range);
      } else if (valid.every((l) => l.restricted)) add("LICENSE", `"${a.title}" is restricted by its licence and cannot be scheduled.`, [e.id], range);
      else {
        const caps = valid.filter((l) => !l.restricted).map((l) => l.maxPlays);
        const cap = caps.some((c) => c == null) ? null : Math.max(...(caps as number[]));
        const used = a.existingPlays + (playsInWindow.get(a.id) ?? 0);
        if (cap != null && used > cap) add("LICENSE", `"${a.title}" would have ${used} planned plays but its licence permits ${cap}.`, [e.id], range);
        const soonest = Math.min(...valid.map((l) => l.validTo.getTime()));
        const warnDays = Math.max(...valid.map((l) => l.warnDaysBefore));
        const daysLeft = Math.floor((soonest - now.getTime()) / 86400000);
        if (daysLeft >= 0 && daysLeft <= warnDays) {
          out.push({ rule: "LICENSE", severity: "WARNING", message: `Licence for "${a.title}" expires in ${daysLeft} day(s).`, eventIds: [e.id], range: { start: range.start.toISOString(), end: range.end.toISOString() } });
        }
      }
    }
  }

  // Frequency limits per RO line and per promo campaign, per local day
  const defaultMax = Number(P("CAMPAIGN_FREQUENCY", "defaultMaxPerDay", 0));
  const perLineDay = new Map<string, EngineEvent[]>();
  for (const e of events) {
    if (!e.roLine) continue;
    const k = `${e.roLine.id}|${broadcastDate(e.startAt, tz, dayStart)}`;
    perLineDay.set(k, [...(perLineDay.get(k) ?? []), e]);
  }
  for (const [k, list] of perLineDay) {
    const limit = list[0].roLine!.maxPerDay ?? (defaultMax || null);
    if (limit && list.length > limit) add("CAMPAIGN_FREQUENCY", `RO line has ${list.length} spots on ${k.split("|")[1]}; the limit is ${limit} per day.`, list.map((e) => e.id));
  }
  const perPromoDay = new Map<string, EngineEvent[]>();
  for (const e of events) {
    const c = asset(e)?.promoCampaign;
    if (!c?.maxPerDay) continue;
    const k = `${e.assetId}|${broadcastDate(e.startAt, tz, dayStart)}`;
    perPromoDay.set(k, [...(perPromoDay.get(k) ?? []), e]);
  }
  for (const [, list] of perPromoDay) {
    const c = asset(list[0])!.promoCampaign!;
    if (list.length > c.maxPerDay!) add("CAMPAIGN_FREQUENCY", `Promo "${list[0].title}" plays ${list.length} times in a day; its campaign allows ${c.maxPerDay}.`, list.map((e) => e.id));
  }

  // Only report violations that involve something the user changed.
  const changed = ctx.changedEventIds;
  const changedBreaks = ctx.changedBreakIds;
  if ((changed && changed.size) || (changedBreaks && changedBreaks.size)) {
    return out.filter((v) => v.eventIds.some((id) => changed?.has(id) || changedBreaks?.has(id)));
  }
  return out;
}

export const blocking = (v: Violation[]) => v.filter((x) => x.severity === "ERROR");
