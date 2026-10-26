/* eslint-disable no-console */
// Development / demonstration seed. Every record created here is flagged
// isDemo (or uses the "Demo" naming) so it can be identified and removed.
// Business flows (ROs, approvals, placement, invoicing, payments) go through
// the real services so the demo data obeys the same rules as user input.
//
// Passwords: DEV_ADMIN_PASSWORD is used for every demo user. If it is not set,
// a random password is generated and printed once. Nothing is hardcoded.

import { randomBytes } from "node:crypto";
import { PrismaClient, type AssetCategory } from "@prisma/client";
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS } from "../src/lib/auth/permissions";
import { hashPassword } from "../src/lib/auth/password";
import { DEFAULT_RULES } from "../src/lib/scheduling/engine";
import { DEFAULT_TEMPLATES } from "../src/lib/notifications/templates";
import { SETTING_DEFAULTS } from "../src/lib/settings";
import { broadcastDayRange, todayIn, addDaysStr, zonedToUtc } from "../src/lib/time";
import { timeBandFor } from "../src/lib/inventory/timeband";
import { ensureIntegrations } from "../src/lib/integrations";

const prisma = new PrismaClient();

async function foundation() {
  for (const [key, [module, description]] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, module, description }, update: { module, description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  for (const [key, r] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({ where: { key }, create: { key, name: r.name, description: r.description, isSystem: true }, update: { name: r.name, description: r.description } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as object }, update: {} });
  }
  for (const [key, t] of Object.entries(DEFAULT_TEMPLATES)) {
    await prisma.notificationTemplate.upsert({ where: { key }, create: { key, ...t }, update: {} });
  }
  for (const r of DEFAULT_RULES) {
    const ex = await prisma.schedulingRule.findFirst({ where: { key: r.key, channelId: null } });
    if (!ex) await prisma.schedulingRule.create({ data: { key: r.key, enabled: r.enabled, severity: r.severity, params: r.params as object } });
  }
  await ensureIntegrations();
  console.log(`✓ ${ALL_PERMISSIONS.length} permissions, ${Object.keys(DEFAULT_ROLES).length} roles, settings, templates, rules, integrations`);
}

async function demo() {
  if (await prisma.channel.findFirst({ where: { isDemo: true } })) {
    console.log("Demo data already present — skipping. Run `npm run db:reset` for a fresh database.");
    return;
  }
  const password = process.env.DEV_ADMIN_PASSWORD || `Dev-${randomBytes(6).toString("base64url")}9`;
  const hash = await hashPassword(password);
  const roleIds = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const userSpecs: [string, string, string][] = [
    ["admin@trends.local", "Demo Administrator", "SUPER_ADMIN"],
    ["sysadmin@trends.local", "Sam Systems", "SYSTEM_ADMIN"],
    ["traffic@trends.local", "Tara Traffic", "TRAFFIC_MANAGER"],
    ["scheduler@trends.local", "Sunil Scheduler", "SCHEDULER"],
    ["media@trends.local", "Maya Media", "MEDIA_MANAGER"],
    ["sales@trends.local", "Sanjay Sales", "SALES_MANAGER"],
    ["booking@trends.local", "Bina Booking", "BOOKING_OFFICER"],
    ["finance@trends.local", "Fiona Finance", "FINANCE_OFFICER"],
    ["accounts@trends.local", "Arun Accounts", "ACCOUNTANT"],
    ["viewer@trends.local", "Vera Viewer", "MANAGEMENT_VIEWER"],
  ];
  const users: Record<string, { id: string; email: string; name: string; permissions: Set<string>; canEditPublished: boolean }> = {};
  for (const [email, name, role] of userSpecs) {
    const u = await prisma.user.create({ data: { email, name, passwordHash: hash, isDemo: true, allChannels: true, roles: { create: { roleId: roleIds.get(role)! } } } });
    const perms = new Set(DEFAULT_ROLES[role].permissions as string[]);
    users[role] = { id: u.id, email, name, permissions: perms, canEditPublished: perms.has("schedule.publish") };
  }
  // The scheduler is limited to one channel to demonstrate channel scoping.
  await prisma.user.update({ where: { id: users.SCHEDULER.id }, data: { allChannels: false } });

  const tz = "Asia/Colombo";
  const ch1 = await prisma.channel.create({ data: { code: "TRN1", name: "Trends One (Demo)", timezone: tz, broadcastDayStartHour: 6, color: "#0ea5e9", territory: "LK", isDemo: true } });
  const ch2 = await prisma.channel.create({ data: { code: "TRNM", name: "Trends Movies (Demo)", timezone: tz, broadcastDayStartHour: 6, color: "#f59e0b", territory: "LK", isDemo: true } });
  const ch3 = await prisma.channel.create({ data: { code: "TRNE", name: "Trends Europe (Demo)", timezone: "Europe/London", broadcastDayStartHour: 6, color: "#8b5cf6", territory: "UK", isDemo: true } });
  await prisma.channelUser.create({ data: { channelId: ch1.id, userId: users.SCHEDULER.id } });

  const vat = await prisma.taxRate.create({ data: { name: "VAT 18% (Demo)", ratePct: "18", jurisdiction: "LK", isDefault: true } });
  await prisma.taxRate.create({ data: { name: "Zero rated", ratePct: "0", jurisdiction: "Export" } });

  for (const ch of [ch1, ch2, ch3]) {
    await prisma.rateCard.create({
      data: {
        name: `${ch.code} standard rate card 2026`,
        channelId: ch.id,
        currency: "USD",
        validFrom: new Date("2026-01-01"),
        items: { create: [{ timeBand: "PRIME", rate: ch.code === "TRNM" ? "1200" : "1500" }, { timeBand: "DAY", rate: "600" }, { timeBand: "LATE", rate: "300" }, { timeBand: "ANY", rate: "500" }] },
      },
    });
  }

  const agencies = await Promise.all(
    [
      ["AG-BMM", "Blue Mango Media (Demo)", "15"],
      ["AG-PIN", "Pinnacle Ads (Demo)", "15"],
      ["AG-NOR", "Northstar Communications (Demo)", "12.5"],
    ].map(([code, name, c]) => prisma.agency.create({ data: { code, name, commissionPct: c, creditTermsDays: 30, email: `${code.toLowerCase()}@example.test`, billingAddress: "1 Demo Street, Colombo", accountManagerId: users.SALES_MANAGER.id, isDemo: true } })),
  );
  const mk = (code: string, name: string, agencyIdx: number | null, category: string) =>
    prisma.client.create({ data: { code, name, agencyId: agencyIdx == null ? null : agencies[agencyIdx].id, productCategory: category, taxRateId: vat.id, creditTermsDays: 30, email: `${code.toLowerCase()}@example.test`, billingAddress: "Demo Client Address", accountManagerId: users.SALES_MANAGER.id, isDemo: true } });
  const fizz = await mk("CL-FIZZ", "Ceylon Fizz Beverages (Demo)", 0, "SOFT_DRINKS");
  const cola = await mk("CL-COLA", "Cola King (Demo)", 1, "SOFT_DRINKS");
  const tel = await mk("CL-TEL", "Lanka Telecom (Demo)", 1, "TELECOM");
  const motors = await mk("CL-MOT", "Island Motors (Demo)", null, "AUTOMOTIVE");
  const tea = await mk("CL-TEA", "Golden Leaf Tea (Demo)", 2, "BEVERAGES");
  const brew = await mk("CL-BREW", "Harbour Brewery (Demo)", 2, "ALCOHOL");

  let seq = 1;
  const asset = (category: AssetCategory, title: string, durationSec: number, extra: Record<string, unknown> = {}) =>
    prisma.mediaAsset.create({ data: { assetCode: `${category.slice(0, 3)}-${String(seq++).padStart(4, "0")}`, title, category, durationSec, approvalStatus: "APPROVED", language: "EN", isDemo: true, fileRef: `ams://demo/${seq}`, ...extra } });

  const programs = [];
  for (const [t, g] of [["Morning Brew", "Talk"], ["Island News", "News"], ["Cook With Nila", "Lifestyle"], ["Tech Tonight", "Tech"], ["Cricket Zone", "Sport"], ["Family Ties S2", "Drama"], ["Kids Club", "Kids"], ["Music Box", "Music"], ["Travel Lanka", "Travel"], ["The Debate", "Current affairs"]]) {
    const a = await asset("PROGRAM", t, 1500, { rightsOwner: "Trends Studios (Demo)", program: { create: { genre: g, contentRating: g === "Kids" ? "G" : "PG" } } });
    programs.push(a);
  }
  const movies = [];
  for (const [t, y] of [["Monsoon Hearts", 2019], ["The Last Ferry", 2021], ["Tea Country", 2018], ["Signal Lost", 2022], ["Harbour Lights", 2017], ["Elephant Pass", 2016]] as const) {
    movies.push(await asset("MOVIE", t, 6600, { rightsOwner: "Silver Screen Distributors (Demo)", contentCategory: "FILM", movie: { create: { releaseYear: y, certificate: "PG13" } } }));
  }
  const now = new Date();
  const day = 86400000;
  for (const a of programs) await prisma.contentLicense.create({ data: { assetId: a.id, licensor: "Trends Studios (Demo)", contractRef: "IN-HOUSE", validFrom: new Date(now.getTime() - 365 * day), validTo: new Date(now.getTime() + 365 * day) } });
  for (const [i, a] of movies.entries()) {
    const expiring = i === 2;
    await prisma.contentLicense.create({ data: { assetId: a.id, licensor: "Silver Screen Distributors (Demo)", contractRef: `SSD-${2026}-${i + 1}`, validFrom: new Date(now.getTime() - 120 * day), validTo: new Date(now.getTime() + (expiring ? 12 : 300) * day), maxPlays: expiring ? 30 : 40, permittedChannelIds: [ch2.id], warnDaysBefore: 30 } });
  }
  const expiredMovie = await asset("MOVIE", "Old Lighthouse (licence expired)", 6600, { rightsOwner: "Retro Films (Demo)" });
  await prisma.contentLicense.create({ data: { assetId: expiredMovie.id, licensor: "Retro Films (Demo)", contractRef: "RF-2024-9", validFrom: new Date(now.getTime() - 400 * day), validTo: new Date(now.getTime() - 5 * day), maxPlays: 10 } });

  const campaigns = await Promise.all([
    prisma.promoCampaign.create({ data: { name: "Cricket Zone launch (Demo)", startDate: new Date(now.getTime() - 10 * day), endDate: new Date(now.getTime() + 20 * day), priority: "HIGH", maxPerDay: 30, isDemo: true } }),
    prisma.promoCampaign.create({ data: { name: "Movie Nights (Demo)", startDate: new Date(now.getTime() - 10 * day), endDate: new Date(now.getTime() + 10 * day), priority: "NORMAL", maxPerDay: 30, channelIds: [ch2.id], isDemo: true } }),
  ]);
  const promos = [
    await asset("PROMO", "Cricket Zone – This Saturday", 30, { promo: { create: { campaignId: campaigns[0].id, promotedTitle: "Cricket Zone" } } }),
    await asset("PROMO", "Tech Tonight – New Season", 30, { promo: { create: { campaignId: campaigns[0].id, promotedTitle: "Tech Tonight" } } }),
    await asset("PROMO", "Movie Nights on Trends Movies", 30, { promo: { create: { campaignId: campaigns[1].id, promotedTitle: "Movie Nights" } } }),
  ];
  const slide = await asset("SLIDE", "Up Next slate", 20);
  const comingUp = await asset("COMING_UP", "Coming Up bumper", 20);
  await asset("TIMER", "Countdown timer 10s", 10);
  await asset("TIMER", "News clock 5s", 5);
  const filler = await asset("FILLER", "Station ident loop", 130);
  const fillerLong = await asset("FILLER", "Scenic Lanka filler", 330);
  await asset("NEW_MEDIA", "Trends App – Download now", 15);
  await asset("NEW_MEDIA", "Social wall highlight", 25);
  const logo = await asset("SECONDARY", "Channel logo bug", 0 + 1);
  const ticker = await asset("SECONDARY", "News ticker", 1);

  const commercials = {
    fizz: await asset("COMMERCIAL", "Fizz Summer 30s", 30, { advertiserId: fizz.id, brand: "Fizz", productCategory: "SOFT_DRINKS", commercial: { create: { clockNumber: "FIZ/30/001" } } }),
    cola: await asset("COMMERCIAL", "Cola King Party 30s", 30, { advertiserId: cola.id, brand: "Cola King", productCategory: "SOFT_DRINKS", commercial: { create: { clockNumber: "CK/30/002" } } }),
    tel: await asset("COMMERCIAL", "Lanka Telecom 5G 20s", 20, { advertiserId: tel.id, brand: "LT 5G", productCategory: "TELECOM", commercial: { create: { clockNumber: "LT/20/010" } } }),
    motors: await asset("COMMERCIAL", "Island Motors SUV 30s", 30, { advertiserId: motors.id, brand: "Island SUV", productCategory: "AUTOMOTIVE", commercial: { create: { clockNumber: "IM/30/004" } } }),
    tea: await asset("COMMERCIAL", "Golden Leaf Morning 20s", 20, { advertiserId: tea.id, brand: "Golden Leaf", productCategory: "BEVERAGES", commercial: { create: { clockNumber: "GL/20/003" } } }),
    brew: await asset("COMMERCIAL", "Harbour Lager 30s", 30, { advertiserId: brew.id, brand: "Harbour Lager", productCategory: "BEER", contentCategory: "ALCOHOL", commercial: { create: { clockNumber: "HB/30/007" } } }),
  };
  await asset("COMMERCIAL", "Fizz Zero 15s (pending approval)", 15, { advertiserId: fizz.id, brand: "Fizz", productCategory: "SOFT_DRINKS", approvalStatus: "PENDING" });
  console.log(`✓ channels, agencies, clients, ${seq - 1} media assets, licences, promo campaigns`);

  // ── Schedules: yesterday … +6 days ──
  const rate = async (chId: string, band: string, dur: number) => {
    const card = await prisma.rateCard.findFirst({ where: { channelId: chId, clientId: null }, include: { items: true } });
    const it = card!.items.find((i) => i.timeBand === band) ?? card!.items.find((i) => i.timeBand === "ANY")!;
    return it.rate.mul(dur).div(it.baseDurationSec).toFixed(2);
  };
  const base = todayIn(tz);
  let eventCount = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  const addEv = async (scheduleId: string, chId: string, a: { id: string; category: AssetCategory; title: string }, startAt: Date, durationSec: number) => {
    const ev = await prisma.scheduleEvent.create({ data: { scheduleId, channelId: chId, assetId: a.id, eventType: a.category, title: a.title, startAt, durationSec } });
    await prisma.contentPlayLog.create({ data: { assetId: a.id, channelId: chId, eventId: ev.id, plannedAt: startAt } });
    eventCount++;
  };
  const addBreak = async (scheduleId: string, chId: string, timezone: string, startAt: Date, positions: number, program: string) => {
    const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(startAt).replace(":", ""));
    const band = timeBandFor(Math.floor(minute / 100) * 60 + (minute % 100));
    const r = await rate(chId, band, 30);
    const code = `B${String(minute).padStart(4, "0")}`;
    await prisma.advertisingBreak.create({ data: { channelId: chId, scheduleId, code, startAt, maxDurationSec: positions * 30, programTitle: program, timeBand: band, inventory: { create: Array.from({ length: positions }, (_, i) => ({ position: i + 1, durationSec: 30, rate: r, priority: i === 0 || i === positions - 1 ? 1 : 5 })) } } });
  };

  for (let d = -1; d <= 6; d++) {
    const date = addDaysStr(base, d);
    // TRN1 — half-hour grid: program 25:00, break 2:00 (4×30s), promo 0:30, slide/coming-up 0:20, filler 2:10
    {
      const s = await prisma.schedule.create({ data: { channelId: ch1.id, broadcastDate: date, isDemo: true } });
      const { start } = broadcastDayRange(ch1, date);
      for (let i = 0; i < 48; i++) {
        const t0 = new Date(start.getTime() + i * 1800 * 1000);
        const prog = programs[(((i + d) % programs.length) + programs.length) % programs.length];
        await addEv(s.id, ch1.id, prog, t0, 1500);
        await addBreak(s.id, ch1.id, tz, new Date(t0.getTime() + 1500 * 1000), 4, prog.title);
        await addEv(s.id, ch1.id, promos[i % 2], new Date(t0.getTime() + 1620 * 1000), 30);
        await addEv(s.id, ch1.id, i % 2 ? slide : comingUp, new Date(t0.getTime() + 1650 * 1000), 20);
        await addEv(s.id, ch1.id, filler, new Date(t0.getTime() + 1670 * 1000), 130);
      }
    }
    // TRNM — two-hour movie blocks: movie 1:50:00, break 4:00 (8×30s), promo 0:30, filler 5:30
    {
      const s = await prisma.schedule.create({ data: { channelId: ch2.id, broadcastDate: date, isDemo: true } });
      const { start } = broadcastDayRange(ch2, date);
      for (let i = 0; i < 12; i++) {
        const t0 = new Date(start.getTime() + i * 7200 * 1000);
        const mv = movies[(i + d + 6) % movies.length];
        await addEv(s.id, ch2.id, mv, t0, 6600);
        await addBreak(s.id, ch2.id, tz, new Date(t0.getTime() + 6600 * 1000), 8, mv.title);
        await addEv(s.id, ch2.id, promos[2], new Date(t0.getTime() + 6840 * 1000), 30);
        await addEv(s.id, ch2.id, fillerLong, new Date(t0.getTime() + 6870 * 1000), 330);
      }
    }
    // TRNE — Europe/London channel, programs only, today and tomorrow (shows a second time zone)
    if (d >= 0 && d <= 1) {
      const s = await prisma.schedule.create({ data: { channelId: ch3.id, broadcastDate: date, isDemo: true } });
      for (let h = 18; h < 23; h++) {
        const t0 = zonedToUtc(date, `${pad(h)}:00`, ch3.timezone);
        await addEv(s.id, ch3.id, programs[h % programs.length], t0, 1500);
        await addEv(s.id, ch3.id, filler, new Date(t0.getTime() + 1500 * 1000), 130);
        await addBreak(s.id, ch3.id, ch3.timezone, new Date(t0.getTime() + 1630 * 1000), 4, programs[h % programs.length].title);
      }
    }
  }
  // Secondary events: logo all week, ticker every evening.
  const { start: w0 } = broadcastDayRange(ch1, addDaysStr(base, -1));
  const { end: w1 } = broadcastDayRange(ch1, addDaysStr(base, 6));
  for (const ch of [ch1, ch2]) await prisma.secondaryEvent.create({ data: { channelId: ch.id, assetId: logo.id, category: "LOGO", label: "Channel logo bug (top right)", startAt: w0, endAt: w1, priority: 1, layer: 1 } });
  for (let d = 0; d <= 6; d++) {
    const date = addDaysStr(base, d);
    await prisma.secondaryEvent.create({ data: { channelId: ch1.id, assetId: ticker.id, category: "TICKER", label: "Evening news ticker", startAt: zonedToUtc(date, "19:00", tz), endAt: zonedToUtc(date, "20:00", tz), priority: 3, layer: 2 } });
  }
  console.log(`✓ ${eventCount} schedule events, breaks and inventory for 8 days`);

  // ── Sales flow through the real services ──
  const sales = await import("../src/lib/sales/service");
  const sched = await import("../src/lib/scheduling/service");
  const billing = await import("../src/lib/billing/service");
  const d0 = new Date(`${addDaysStr(base, -1)}T00:00:00Z`);
  const dEnd = new Date(`${addDaysStr(base, 6)}T00:00:00Z`);
  const today = new Date(`${base}T00:00:00Z`);

  const dealFizz = await sales.saveDeal(users.SALES_MANAGER as never, null, { agencyId: agencies[0].id, clientId: fizz.id, campaignName: "Fizz Summer Blast", startDate: d0, endDate: dEnd, currency: "USD", discountPct: "5", commissionPct: "15", taxRatePct: "18", lines: [{ channelId: ch1.id, product: "Prime 30s spot", timeBand: "PRIME", spotDurationSec: 30, quantity: 12, rate: "1500", discountPct: "0" }] });
  await sales.setDealStatus(users.SALES_MANAGER as never, dealFizz.id, "CONFIRMED", "Signed by agency");
  const dealTel = await sales.saveDeal(users.SALES_MANAGER as never, null, { agencyId: agencies[1].id, clientId: tel.id, campaignName: "5G Launch", startDate: today, endDate: dEnd, currency: "USD", discountPct: "0", commissionPct: "15", taxRatePct: "18", lines: [{ channelId: ch1.id, product: "Day 20s spot", timeBand: "DAY", spotDurationSec: 20, quantity: 8, rate: "400", discountPct: "0" }] });
  await sales.setDealStatus(users.SALES_MANAGER as never, dealTel.id, "NEGOTIATION");
  await sales.saveDeal(users.BOOKING_OFFICER as never, null, { clientId: motors.id, campaignName: "SUV Festive", startDate: today, endDate: dEnd, currency: "USD", discountPct: "0", commissionPct: "0", taxRatePct: "18", lines: [{ channelId: ch2.id, product: "Movie break 30s", timeBand: "ANY", spotDurationSec: 30, quantity: 6, rate: "900", discountPct: "0" }] });

  const roFizz = await sales.roFromDeal(users.BOOKING_OFFICER as never, dealFizz.id);
  await prisma.releaseOrderLineItem.updateMany({ where: { releaseOrderId: roFizz.id }, data: { assetId: commercials.fizz.id, maxPerDay: 2 } });
  const roTel = await sales.saveReleaseOrder(users.BOOKING_OFFICER as never, null, { agencyId: agencies[1].id, clientId: tel.id, campaignName: "5G Launch", startDate: today, endDate: dEnd, currency: "USD", commissionPct: "15", taxRatePct: "18", clientRef: "PIN/PO/7781", lines: [{ channelId: ch1.id, assetId: commercials.tel.id, description: "Day 20s", timeBand: "DAY", spotDurationSec: 30, quantity: 8, rate: "400", discountPct: "0", startDate: today, endDate: dEnd, maxPerDay: 2 }] });
  const roCola = await sales.saveReleaseOrder(users.BOOKING_OFFICER as never, null, { agencyId: agencies[1].id, clientId: cola.id, campaignName: "Party Pack", startDate: today, endDate: dEnd, currency: "USD", commissionPct: "15", taxRatePct: "18", lines: [{ channelId: ch1.id, assetId: commercials.cola.id, description: "Prime 30s", timeBand: "PRIME", spotDurationSec: 30, quantity: 4, rate: "1500", discountPct: "10", startDate: today, endDate: dEnd, maxPerDay: 1 }] });
  const roMotors = await sales.saveReleaseOrder(users.BOOKING_OFFICER as never, null, { clientId: motors.id, campaignName: "SUV Festive", startDate: today, endDate: dEnd, currency: "USD", commissionPct: "0", taxRatePct: "18", lines: [{ channelId: ch2.id, assetId: commercials.motors.id, description: "Movie break 30s", timeBand: "ANY", spotDurationSec: 30, quantity: 6, rate: "900", discountPct: "0", startDate: today, endDate: dEnd }] });
  await sales.saveReleaseOrder(users.BOOKING_OFFICER as never, null, { agencyId: agencies[2].id, clientId: tea.id, campaignName: "Morning Cuppa", startDate: today, endDate: dEnd, currency: "USD", commissionPct: "12.5", taxRatePct: "18", lines: [{ channelId: ch1.id, assetId: commercials.tea.id, description: "Day 20s", timeBand: "DAY", spotDurationSec: 30, quantity: 10, rate: "400", discountPct: "0", startDate: today, endDate: dEnd }] });

  for (const ro of [roFizz, roTel, roCola]) {
    await sales.submitReleaseOrder(users.BOOKING_OFFICER as never, ro.id);
    await sales.approveReleaseOrder(users.SALES_MANAGER as never, ro.id, "Rates OK");
    await sales.approveReleaseOrder(users.FINANCE_OFFICER as never, ro.id, "Credit OK");
    const r = await sales.autoPlaceSpots(users.TRAFFIC_MANAGER as never, ro.id);
    console.log(`  RO ${ro.number}: placed ${r.placed}${r.problems.length ? `, ${r.problems.length} rejected by rules (e.g. ${r.problems[0]})` : ""}`);
  }
  await sales.submitReleaseOrder(users.BOOKING_OFFICER as never, roMotors.id);
  await sales.approveReleaseOrder(users.SALES_MANAGER as never, roMotors.id, "Sales OK — awaiting finance");

  // Publish yesterday and today; confirm yesterday as aired (as-run).
  for (const ch of [ch1, ch2]) {
    for (const date of [addDaysStr(base, -1), base]) {
      const s = await prisma.schedule.findUniqueOrThrow({ where: { channelId_broadcastDate: { channelId: ch.id, broadcastDate: date } } });
      await sched.publishSchedule(users.TRAFFIC_MANAGER, s.id, "Initial publication (demo)");
    }
    const { start, end } = broadcastDayRange(ch, addDaysStr(base, -1));
    const ids = (await prisma.scheduleEvent.findMany({ where: { channelId: ch.id, startAt: { gte: start, lt: end } }, select: { id: true } })).map((e) => e.id);
    if (end <= new Date()) await sched.confirmAired(users.TRAFFIC_MANAGER, ids);
  }

  // Invoice the aired Fizz spots, issue, part-pay.
  try {
    const inv = await billing.invoiceFromReleaseOrder(users.FINANCE_OFFICER, roFizz.id);
    const issued = await billing.issueInvoice(users.FINANCE_OFFICER, inv.id);
    await billing.recordPayment(users.ACCOUNTANT, { agencyId: agencies[0].id, amount: issued.total.div(2).toDecimalPlaces(2).toFixed(2), currency: "USD", method: "BANK_TRANSFER", reference: "DEMO-TT-0001", receivedAt: new Date(), allocations: [{ invoiceId: issued.id, amount: issued.total.div(2).toDecimalPlaces(2).toFixed(2) }] });
    console.log(`  Invoice ${issued.number} issued and half paid`);
  } catch (e) {
    console.log(`  (No aired Fizz spots to invoice yet: ${e instanceof Error ? e.message : e})`);
  }
  // A manual sponsorship invoice that is overdue.
  const man = await billing.saveManualInvoice(users.FINANCE_OFFICER, null, { clientId: motors.id, currency: "USD", notes: "Programme sponsorship – Cricket Zone (Demo)", lines: [{ description: "Sponsorship – Cricket Zone, 4 weeks", quantity: "1", unitPrice: "5000.00", discountPct: "0", commissionPct: "0", taxRatePct: "18" }] });
  const manIssued = await billing.issueInvoice(users.FINANCE_OFFICER, man.id);
  await prisma.invoice.update({ where: { id: manIssued.id }, data: { issueDate: new Date(now.getTime() - 45 * day), dueDate: new Date(now.getTime() - 15 * day) } });
  await billing.refreshOverdue();

  await prisma.agreement.create({ data: { number: "AGR-DEMO-001", title: "Blue Mango Media annual booking agreement", agencyId: agencies[0].id, dealId: dealFizz.id, startDate: new Date(now.getTime() - 200 * day), endDate: new Date(now.getTime() + 165 * day), value: "250000", status: "ACTIVE", signedAt: new Date(now.getTime() - 200 * day), isDemo: true } });
  await prisma.agreement.create({ data: { number: "AGR-DEMO-002", title: "Pinnacle Ads volume agreement", agencyId: agencies[1].id, startDate: new Date(now.getTime() - 340 * day), endDate: new Date(now.getTime() + 20 * day), value: "120000", status: "ACTIVE", isDemo: true } });
  await prisma.agreement.create({ data: { number: "AGR-DEMO-003", title: "Island Motors direct contract", clientId: motors.id, startDate: today, endDate: new Date(now.getTime() + 90 * day), status: "DRAFT", isDemo: true } });

  console.log("\n────────────────────────────────────────────────────────");
  console.log(" Demo users (all share one development password):");
  for (const [email, , role] of userSpecs) console.log(`   ${email.padEnd(26)} ${role}`);
  console.log(`\n Password: ${process.env.DEV_ADMIN_PASSWORD ? "(value of DEV_ADMIN_PASSWORD)" : password}`);
  console.log(" For development only. Never use demo users in production.");
  console.log("────────────────────────────────────────────────────────\n");
}

async function main() {
  await foundation();
  // Demo data never loads in production unless explicitly requested.
  const wantDemo = process.env.SEED_DEMO ? process.env.SEED_DEMO === "true" : process.env.NODE_ENV !== "production";
  if (wantDemo) await demo();
  else console.log("Demo data skipped. Create the first administrator with `npm run create-admin -- --email you@company.com`.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
