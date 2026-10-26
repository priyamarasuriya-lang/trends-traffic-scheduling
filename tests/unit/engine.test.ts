import { describe, it, expect } from "vitest";
import { validateSchedule, ripple, layoutBreak, blocking, DEFAULT_RULES, type EngineAsset, type EngineEvent, type EngineBreak, type RuleConfig } from "@/lib/scheduling/engine";

const TZ = "Asia/Colombo"; // UTC+05:30, no DST
const at = (hm: string, date = "2026-11-02") => new Date(`${date}T${hm}:00+05:30`);
const asset = (id: string, o: Partial<EngineAsset> = {}): EngineAsset => ({ id, title: id, category: "COMMERCIAL", durationSec: 30, approvalStatus: "APPROVED", deleted: false, permittedChannelIds: [], licenses: [], existingPlays: 0, ...o });
let n = 0;
const ev = (assetId: string, start: Date, o: Partial<EngineEvent> = {}): EngineEvent => ({ id: `e${++n}`, assetId, eventType: "COMMERCIAL", title: assetId, startAt: start, durationSec: 30, ...o });
const rules = (patch: Partial<Record<string, Partial<RuleConfig>>> = {}) => DEFAULT_RULES.map((r) => ({ ...r, ...(patch[r.key] ?? {}), params: { ...r.params, ...(patch[r.key]?.params ?? {}) } }));
const run = (events: EngineEvent[], assets: EngineAsset[], o: { breaks?: EngineBreak[]; rules?: RuleConfig[] } = {}) =>
  validateSchedule({ channel: { id: "ch1", timezone: TZ, broadcastDayStartHour: 6 }, events, breaks: o.breaks ?? [], assets: new Map(assets.map((a) => [a.id, a])), rules: o.rules ?? rules(), now: at("00:00", "2026-11-01") });
const keys = (v: { rule: string }[]) => v.map((x) => x.rule);

describe("scheduling engine", () => {
  it("accepts a clean schedule", () => {
    const prog = asset("news", { category: "NEWS", durationSec: 1800 });
    expect(run([ev("news", at("20:00"), { eventType: "PROGRAM", durationSec: 1800 })], [prog])).toEqual([]);
  });

  it("rejects overlapping primary events and reports the exact overlap in channel time", () => {
    const a = asset("a", { category: "NEWS" });
    const v = run([ev("a", at("20:00"), { eventType: "PROGRAM", durationSec: 1800, title: "News" }), ev("a", at("20:20"), { eventType: "PROGRAM", durationSec: 600, title: "Weather" })], [a]);
    const o = v.find((x) => x.rule === "NO_OVERLAP")!;
    expect(o.severity).toBe("ERROR");
    expect(o.message).toContain("20:20:00");
    expect(o.message).toContain("20:30:00");
  });

  it("treats breaks as blocks on the primary track", () => {
    const brk: EngineBreak = { id: "b1", code: "B1", startAt: at("20:10"), maxDurationSec: 120 };
    const v = run([ev("a", at("20:00"), { eventType: "PROGRAM", durationSec: 900 })], [asset("a", { category: "NEWS" })], { breaks: [brk] });
    expect(keys(v)).toContain("NO_OVERLAP");
  });

  it("enforces break length, back-to-back advertiser and same-break brand", () => {
    const brk: EngineBreak = { id: "b1", code: "B1", startAt: at("20:30"), maxDurationSec: 60 };
    const x = asset("x", { advertiserId: "adv1", brand: "Fizz" });
    const y = asset("y", { advertiserId: "adv1", brand: "Fizz" });
    const v = run([ev("x", at("20:30"), { breakId: "b1", positionInBreak: 1 }), ev("y", at("20:30:30".slice(0, 5)), { breakId: "b1", positionInBreak: 2, durationSec: 45 })], [x, y], { breaks: [brk] });
    expect(keys(v)).toEqual(expect.arrayContaining(["BREAK_MAX_DURATION", "BACK_TO_BACK_ADVERTISER", "SAME_BREAK_BRAND"]));
  });

  it("enforces brand, competitor and same-spot separation", () => {
    const a = asset("a", { brand: "Tea", advertiserId: "1", productCategory: "BEV" });
    const b = asset("b", { brand: "Tea", advertiserId: "1", productCategory: "SNACK" });
    const c = asset("c", { brand: "Cola", advertiserId: "2", productCategory: "BEV" });
    expect(keys(run([ev("a", at("20:00")), ev("b", at("20:05"))], [a, b]))).toContain("BRAND_SEPARATION");
    expect(keys(run([ev("a", at("20:00")), ev("c", at("20:05"))], [a, c]))).toContain("COMPETITOR_SEPARATION");
    expect(keys(run([ev("a", at("20:00")), ev("a", at("20:20"))], [a]))).toContain("COMMERCIAL_MIN_SEPARATION");
    expect(run([ev("a", at("20:00")), ev("a", at("21:00"))], [a])).toEqual([]);
  });

  it("uses configured parameters", () => {
    const a = asset("a", { brand: "Tea" });
    const b = asset("b", { brand: "Tea" });
    const loose = rules({ BRAND_SEPARATION: { params: { minSeconds: 60 } } });
    expect(run([ev("a", at("20:00")), ev("b", at("20:05"))], [a, b], { rules: loose })).toEqual([]);
  });

  it("blocks unapproved, deleted and channel-restricted content", () => {
    expect(keys(run([ev("p", at("20:00"))], [asset("p", { approvalStatus: "PENDING" })]))).toContain("APPROVED_CONTENT");
    expect(keys(run([ev("d", at("20:00"))], [asset("d", { deleted: true })]))).toContain("ASSET_AVAILABILITY");
    expect(keys(run([ev("r", at("20:00"))], [asset("r", { permittedChannelIds: ["other"] })]))).toContain("ASSET_AVAILABILITY");
  });

  it("checks licences: missing, expired, restricted and play limits", () => {
    const lic = (o = {}) => ({ validFrom: at("00:00", "2026-01-01"), validTo: at("00:00", "2026-12-31"), permittedChannelIds: [], maxPlays: null, restricted: false, warnDaysBefore: 0, ...o });
    const m = (o: Partial<EngineAsset>) => asset("m", { category: "MOVIE", durationSec: 5400, ...o });
    const movie = (s = at("21:00")) => ev("m", s, { eventType: "MOVIE", durationSec: 5400 });
    expect(run([movie()], [m({ licenses: [lic()] })])).toEqual([]);
    expect(run([movie()], [m({})])[0].message).toContain("no content licence");
    expect(run([movie()], [m({ licenses: [lic({ validTo: at("00:00", "2026-10-01") })] })])[0].message).toContain("expired");
    expect(keys(run([movie()], [m({ licenses: [lic({ restricted: true })] })]))).toContain("LICENSE");
    expect(run([movie()], [m({ existingPlays: 2, licenses: [lic({ maxPlays: 2 })] })])[0].message).toContain("permits 2");
  });

  it("keeps restricted categories inside their window, across midnight", () => {
    const beer = asset("beer", { contentCategory: "ALCOHOL" });
    expect(keys(run([ev("beer", at("20:00"))], [beer]))).toContain("CATEGORY_RESTRICTION");
    expect(run([ev("beer", at("23:30"))], [beer])).toEqual([]);
    expect(run([ev("beer", at("02:00", "2026-11-03"))], [beer])).toEqual([]);
  });

  it("limits RO line spots per broadcast day and checks campaign dates", () => {
    const line = { id: "l1", startDate: new Date("2026-11-02"), endDate: new Date("2026-11-02"), maxPerDay: 1, channelId: "ch1" };
    const a = asset("a");
    expect(keys(run([ev("a", at("08:00"), { roLine: line }), ev("a", at("20:00"), { roLine: line })], [a]))).toContain("CAMPAIGN_FREQUENCY");
    // 02:00 on the 3rd belongs to broadcast day 2nd (day starts 06:00), so it is inside the line dates.
    expect(keys(run([ev("a", at("02:00", "2026-11-03"), { roLine: line })], [a]))).not.toContain("CAMPAIGN_DATES");
    expect(keys(run([ev("a", at("07:00", "2026-11-03"), { roLine: line })], [a]))).toContain("CAMPAIGN_DATES");
  });

  it("reports off-grid program starts as warnings, which do not block", () => {
    const v = run([ev("s", at("20:07"), { eventType: "PROGRAM", durationSec: 600 })], [asset("s", { category: "PROGRAM", licenses: [{ validFrom: at("00:00", "2026-01-01"), validTo: at("00:00", "2027-01-01"), permittedChannelIds: [], maxPlays: null, restricted: false, warnDaysBefore: 0 }] })]);
    expect(keys(v)).toEqual(["PROGRAM_START_TIME"]);
    expect(blocking(v)).toEqual([]);
  });

  it("ignores disabled rules and only reports violations touching changed events", () => {
    const a = asset("a", { approvalStatus: "PENDING" });
    const off = rules({ APPROVED_CONTENT: { enabled: false } });
    expect(run([ev("a", at("20:00"))], [a], { rules: off })).toEqual([]);
    const e1 = ev("a", at("20:00"));
    const e2 = ev("a", at("21:00"));
    const v = validateSchedule({ channel: { id: "ch1", timezone: TZ }, events: [e1, e2], breaks: [], assets: new Map([["a", a]]), rules: rules(), changedEventIds: new Set([e2.id]) });
    expect(v.every((x) => x.eventIds.includes(e2.id))).toBe(true);
  });
});

describe("ripple and break layout", () => {
  it("pushes only the following overlapping blocks", () => {
    const blocks = [
      { id: "a", kind: "event" as const, startAt: at("20:00"), durationSec: 2400 },
      { id: "b", kind: "event" as const, startAt: at("20:30"), durationSec: 600 },
      { id: "c", kind: "break" as const, startAt: at("20:40"), durationSec: 120 },
      { id: "d", kind: "event" as const, startAt: at("22:00"), durationSec: 600 },
    ];
    const s = ripple(blocks, "a");
    expect(s.get("b")).toEqual(at("20:40"));
    expect(s.get("c")).toEqual(at("20:50"));
    expect(s.has("d")).toBe(false);
  });

  it("lays spots out back to back by position", () => {
    const brk = { id: "b", code: "B", startAt: at("20:30"), maxDurationSec: 120 };
    const out = layoutBreak(brk, [ev("x", at("00:00"), { positionInBreak: 2, durationSec: 20 }), ev("y", at("00:00"), { positionInBreak: 1, durationSec: 30 })]);
    expect(out.map((e) => e.assetId)).toEqual(["y", "x"]);
    expect(out[1].startAt).toEqual(new Date(at("20:30").getTime() + 30_000));
  });
});
