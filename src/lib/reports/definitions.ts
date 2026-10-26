import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { D, sum } from "../money";
import { broadcastDayRange, fmtTz, addDaysStr, broadcastDateOf } from "../time";
import { validateWindow } from "../scheduling/service";
import type { PermissionKey } from "../auth/permissions";

export type ReportColumn = { key: string; label: string; type?: "text" | "number" | "money" | "date" | "datetime" };
export type ReportFilters = { from: Date; to: Date; fromStr: string; toStr: string; channelId?: string; clientId?: string; agencyId?: string; status?: string; campaign?: string; channelIds?: string[] };
export type ReportResult = { columns: ReportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; note?: string };
export type ReportDef = {
  key: string;
  title: string;
  group: "Scheduling" | "Advertising" | "Financial" | "Rights";
  description: string;
  permission: PermissionKey;
  filters: ("date" | "channel" | "client" | "agency" | "status" | "campaign")[];
  statuses?: string[];
  run(f: ReportFilters): Promise<ReportResult>;
};

const chWhere = (f: ReportFilters) => (f.channelId ? { channelId: f.channelId } : f.channelIds ? { channelId: { in: f.channelIds } } : {});
const money = (v: unknown) => D(v as string).toFixed(2);
const totalOf = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, sum(rows.map((r) => (r[k] as string) ?? 0)).toFixed(2)]));

async function scheduleRows(f: ReportFilters, extra: Prisma.ScheduleEventWhereInput = {}) {
  const events = await prisma.scheduleEvent.findMany({
    where: { ...chWhere(f), startAt: { gte: f.from, lt: f.to }, status: { not: "CANCELLED" }, ...extra },
    include: { channel: true, asset: true, break: true },
    orderBy: [{ channelId: "asc" }, { startAt: "asc" }],
    take: 20000,
  });
  return events.map((e) => ({
    channel: e.channel.code,
    date: broadcastDateOf(e.channel, e.startAt),
    start: fmtTz(e.startAt, e.channel.timezone, "HH:mm:ss"),
    end: fmtTz(new Date(e.startAt.getTime() + e.durationSec * 1000), e.channel.timezone, "HH:mm:ss"),
    houseNo: e.asset.assetCode,
    title: e.title,
    type: e.eventType,
    durationSec: e.durationSec,
    break: e.break?.code ?? "",
    status: e.status,
  }));
}
const scheduleCols: ReportColumn[] = [
  { key: "channel", label: "Channel" },
  { key: "date", label: "Broadcast date" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
  { key: "houseNo", label: "House no." },
  { key: "title", label: "Title" },
  { key: "type", label: "Type" },
  { key: "durationSec", label: "Duration (s)", type: "number" },
  { key: "break", label: "Break" },
  { key: "status", label: "Status" },
];

export const REPORTS: ReportDef[] = [
  // ───────── Scheduling ─────────
  { key: "transmission-schedule", title: "Transmission schedule", group: "Scheduling", description: "Every event in the period (daily, weekly or monthly by date range).", permission: "report.view", filters: ["date", "channel"], run: async (f) => ({ columns: scheduleCols, rows: await scheduleRows(f) }) },
  {
    key: "channel-schedule-summary", title: "Channel-wise schedule summary", group: "Scheduling", description: "Scheduled seconds and event counts per channel and content type.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const g = await prisma.scheduleEvent.groupBy({ by: ["channelId", "eventType"], where: { ...chWhere(f), startAt: { gte: f.from, lt: f.to }, status: { not: "CANCELLED" } }, _count: true, _sum: { durationSec: true } });
      const chans = new Map((await prisma.channel.findMany()).map((c) => [c.id, c.code]));
      return { columns: [{ key: "channel", label: "Channel" }, { key: "type", label: "Type" }, { key: "events", label: "Events", type: "number" }, { key: "hours", label: "Hours", type: "number" }], rows: g.map((r) => ({ channel: chans.get(r.channelId), type: r.eventType, events: r._count, hours: ((r._sum.durationSec ?? 0) / 3600).toFixed(2) })) };
    },
  },
  {
    key: "program-schedule", title: "Program-wise schedule", group: "Scheduling", description: "Programs and movies with planned and aired airings.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const g = await prisma.scheduleEvent.groupBy({ by: ["assetId", "title", "status"], where: { ...chWhere(f), eventType: { in: ["PROGRAM", "MOVIE"] }, startAt: { gte: f.from, lt: f.to } }, _count: true });
      const map = new Map<string, { title: string; planned: number; aired: number }>();
      for (const r of g) {
        const m = map.get(r.assetId) ?? { title: r.title, planned: 0, aired: 0 };
        if (r.status === "AIRED") m.aired += r._count;
        else if (r.status === "PLANNED") m.planned += r._count;
        map.set(r.assetId, m);
      }
      return { columns: [{ key: "title", label: "Title" }, { key: "planned", label: "Planned", type: "number" }, { key: "aired", label: "Aired", type: "number" }], rows: [...map.values()].sort((a, b) => a.title.localeCompare(b.title)) };
    },
  },
  {
    key: "commercial-breaks", title: "Commercial break report", group: "Scheduling", description: "Each break with its fill rate and sold value.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const breaks = await prisma.advertisingBreak.findMany({ where: { ...chWhere(f), startAt: { gte: f.from, lt: f.to } }, include: { channel: true, events: true, inventory: true }, orderBy: { startAt: "asc" }, take: 5000 });
      return {
        columns: [{ key: "channel", label: "Channel" }, { key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "code", label: "Break" }, { key: "band", label: "Band" }, { key: "maxSec", label: "Length (s)", type: "number" }, { key: "usedSec", label: "Filled (s)", type: "number" }, { key: "fill", label: "Fill %", type: "number" }, { key: "spots", label: "Spots", type: "number" }, { key: "sold", label: "Sold positions", type: "number" }],
        rows: breaks.map((b) => {
          const used = b.events.reduce((n, e) => n + e.durationSec, 0);
          return { channel: b.channel.code, date: broadcastDateOf(b.channel, b.startAt), time: fmtTz(b.startAt, b.channel.timezone, "HH:mm:ss"), code: b.code, band: b.timeBand, maxSec: b.maxDurationSec, usedSec: used, fill: b.maxDurationSec ? Math.round((used / b.maxDurationSec) * 100) : 0, spots: b.events.length, sold: b.inventory.filter((i) => i.roLineItemId).length };
        }),
      };
    },
  },
  {
    key: "secondary-events", title: "Secondary event report", group: "Scheduling", description: "Logos, tickers, lower thirds and other graphics in the period.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const rows = await prisma.secondaryEvent.findMany({ where: { ...chWhere(f), deletedAt: null, startAt: { lt: f.to }, endAt: { gt: f.from } }, include: { channel: true }, orderBy: { startAt: "asc" } });
      return { columns: [{ key: "channel", label: "Channel" }, { key: "category", label: "Category" }, { key: "label", label: "Label" }, { key: "start", label: "Start", type: "datetime" }, { key: "end", label: "End", type: "datetime" }, { key: "layer", label: "Layer", type: "number" }, { key: "priority", label: "Priority", type: "number" }, { key: "active", label: "Active" }], rows: rows.map((r) => ({ channel: r.channel.code, category: r.category, label: r.label, start: r.startAt, end: r.endAt, layer: r.layer, priority: r.priority, active: r.isActive ? "Yes" : "No" })) };
    },
  },
  {
    key: "schedule-conflicts", title: "Schedule conflict report", group: "Scheduling", description: "Re-runs every scheduling rule on each day (max 31 days).", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const channels = await prisma.channel.findMany({ where: { deletedAt: null, ...(f.channelId ? { id: f.channelId } : f.channelIds ? { id: { in: f.channelIds } } : {}) } });
      const rows: Record<string, unknown>[] = [];
      for (const ch of channels) {
        for (let d = f.fromStr, i = 0; d <= f.toStr && i < 31; d = addDaysStr(d, 1), i++) {
          const { start, end } = broadcastDayRange(ch, d);
          const v = await validateWindow(prisma, ch.id, start, end);
          for (const x of v) if (x.range && new Date(x.range.start) >= start && new Date(x.range.start) < end) rows.push({ channel: ch.code, date: d, time: fmtTz(new Date(x.range.start), ch.timezone, "HH:mm:ss"), rule: x.rule, severity: x.severity, message: x.message });
        }
      }
      return { columns: [{ key: "channel", label: "Channel" }, { key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "rule", label: "Rule" }, { key: "severity", label: "Severity" }, { key: "message", label: "Detail" }], rows };
    },
  },

  // ───────── Advertising ─────────
  {
    key: "campaign-bookings", title: "Campaign booking summary", group: "Advertising", description: "Release orders with ordered, booked, scheduled and aired spots.", permission: "report.view", filters: ["date", "client", "agency", "status", "campaign"], statuses: ["DRAFT", "SUBMITTED", "APPROVED", "SCHEDULED", "COMPLETED", "REJECTED", "CANCELLED"],
    async run(f) {
      const ros = await prisma.releaseOrder.findMany({
        where: { startDate: { lte: f.to }, endDate: { gte: f.from }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}), ...(f.status ? { status: f.status as never } : {}), ...(f.campaign ? { campaignName: { contains: f.campaign, mode: "insensitive" } } : {}) },
        include: { client: true, agency: true, lines: { include: { inventory: true, events: true } } },
        orderBy: { startDate: "asc" },
      });
      const rows = ros.map((r) => {
        const inv = r.lines.flatMap((l) => l.inventory);
        const ev = r.lines.flatMap((l) => l.events);
        return { number: r.number, campaign: r.campaignName, client: r.client.name, agency: r.agency?.name ?? "Direct", status: r.status, start: r.startDate, end: r.endDate, ordered: r.lines.reduce((n, l) => n + l.quantity, 0), booked: inv.filter((i) => i.status !== "AVAILABLE").length, scheduled: ev.length, aired: ev.filter((e) => e.status === "AIRED").length, value: money(r.totalAmount) };
      });
      return { columns: [{ key: "number", label: "RO" }, { key: "campaign", label: "Campaign" }, { key: "client", label: "Client" }, { key: "agency", label: "Agency" }, { key: "status", label: "Status" }, { key: "start", label: "Start", type: "date" }, { key: "end", label: "End", type: "date" }, { key: "ordered", label: "Ordered", type: "number" }, { key: "booked", label: "Booked", type: "number" }, { key: "scheduled", label: "Scheduled", type: "number" }, { key: "aired", label: "Aired", type: "number" }, { key: "value", label: "RO value", type: "money" }], rows, totals: totalOf(rows, ["value"]) };
    },
  },
  {
    key: "ro-status", title: "RO status report", group: "Advertising", description: "Count and value of release orders by status.", permission: "report.view", filters: ["date", "client", "agency"],
    async run(f) {
      const g = await prisma.releaseOrder.groupBy({ by: ["status"], where: { createdAt: { gte: f.from, lt: f.to }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, _count: true, _sum: { totalAmount: true } });
      const rows = g.map((r) => ({ status: r.status, count: r._count, value: money(r._sum.totalAmount) }));
      return { columns: [{ key: "status", label: "Status" }, { key: "count", label: "ROs", type: "number" }, { key: "value", label: "Value", type: "money" }], rows, totals: totalOf(rows, ["value"]) };
    },
  },
  {
    key: "advertiser-bookings", title: "Advertiser-wise bookings", group: "Advertising", description: "Booked value and spots per advertiser (excludes cancelled/rejected ROs).", permission: "report.view", filters: ["date", "agency"],
    async run(f) {
      const g = await prisma.releaseOrder.groupBy({ by: ["clientId"], where: { status: { notIn: ["CANCELLED", "REJECTED"] }, startDate: { lte: f.to }, endDate: { gte: f.from }, ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, _count: true, _sum: { totalAmount: true, grossAmount: true } });
      const clients = new Map((await prisma.client.findMany()).map((c) => [c.id, c.name]));
      const rows = g.map((r) => ({ client: clients.get(r.clientId), ros: r._count, gross: money(r._sum.grossAmount), net: money(r._sum.totalAmount) })).sort((a, b) => Number(b.net) - Number(a.net));
      return { columns: [{ key: "client", label: "Advertiser" }, { key: "ros", label: "ROs", type: "number" }, { key: "gross", label: "Gross", type: "money" }, { key: "net", label: "Net payable", type: "money" }], rows, totals: totalOf(rows, ["gross", "net"]) };
    },
  },
  {
    key: "agency-bookings", title: "Agency-wise bookings", group: "Advertising", description: "Booked value and commission per agency.", permission: "report.view", filters: ["date"],
    async run(f) {
      const g = await prisma.releaseOrder.groupBy({ by: ["agencyId"], where: { status: { notIn: ["CANCELLED", "REJECTED"] }, startDate: { lte: f.to }, endDate: { gte: f.from } }, _count: true, _sum: { grossAmount: true, commissionAmount: true, totalAmount: true } });
      const ag = new Map((await prisma.agency.findMany()).map((c) => [c.id, c.name]));
      const rows = g.map((r) => ({ agency: r.agencyId ? ag.get(r.agencyId) : "Direct clients", ros: r._count, gross: money(r._sum.grossAmount), commission: money(r._sum.commissionAmount), net: money(r._sum.totalAmount) }));
      return { columns: [{ key: "agency", label: "Agency" }, { key: "ros", label: "ROs", type: "number" }, { key: "gross", label: "Gross", type: "money" }, { key: "commission", label: "Commission", type: "money" }, { key: "net", label: "Net payable", type: "money" }], rows, totals: totalOf(rows, ["gross", "commission", "net"]) };
    },
  },
  {
    key: "commercial-run", title: "Commercial run report", group: "Advertising", description: "Every commercial spot with its RO and aired status (proof of performance).", permission: "report.view", filters: ["date", "channel", "client"],
    async run(f) {
      const ev = await prisma.scheduleEvent.findMany({ where: { ...chWhere(f), eventType: "COMMERCIAL", startAt: { gte: f.from, lt: f.to }, ...(f.clientId ? { asset: { advertiserId: f.clientId } } : {}) }, include: { channel: true, asset: { include: { advertiser: true } }, roLineItem: { include: { releaseOrder: true } }, break: true }, orderBy: { startAt: "asc" }, take: 20000 });
      return {
        columns: [{ key: "channel", label: "Channel" }, { key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "break", label: "Break" }, { key: "position", label: "Pos.", type: "number" }, { key: "advertiser", label: "Advertiser" }, { key: "title", label: "Commercial" }, { key: "durationSec", label: "Dur (s)", type: "number" }, { key: "ro", label: "RO" }, { key: "status", label: "Status" }],
        rows: ev.map((e) => ({ channel: e.channel.code, date: broadcastDateOf(e.channel, e.startAt), time: fmtTz(e.startAt, e.channel.timezone, "HH:mm:ss"), break: e.break?.code, position: e.positionInBreak, advertiser: e.asset.advertiser?.name, title: e.title, durationSec: e.durationSec, ro: e.roLineItem?.releaseOrder.number, status: e.status })),
      };
    },
  },
  {
    key: "campaign-delivery", title: "Campaign delivery (under/over-delivery)", group: "Advertising", description: "Ordered vs scheduled vs aired spots per RO line.", permission: "report.view", filters: ["date", "client", "campaign"],
    async run(f) {
      const lines = await prisma.releaseOrderLineItem.findMany({ where: { startDate: { lte: f.to }, endDate: { gte: f.from }, releaseOrder: { status: { in: ["APPROVED", "SCHEDULED", "COMPLETED"] }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.campaign ? { campaignName: { contains: f.campaign, mode: "insensitive" } } : {}) } }, include: { releaseOrder: { include: { client: true } }, events: true, channel: true } });
      const now = new Date();
      return {
        columns: [{ key: "ro", label: "RO" }, { key: "client", label: "Client" }, { key: "line", label: "Line" }, { key: "channel", label: "Channel" }, { key: "ordered", label: "Ordered", type: "number" }, { key: "scheduled", label: "Scheduled", type: "number" }, { key: "aired", label: "Aired", type: "number" }, { key: "missed", label: "Missed", type: "number" }, { key: "variance", label: "Variance", type: "number" }, { key: "state", label: "Delivery" }],
        rows: lines.map((l) => {
          const aired = l.events.filter((e) => e.status === "AIRED").length;
          const missed = l.events.filter((e) => e.status === "MISSED").length;
          const variance = l.events.filter((e) => e.status !== "CANCELLED").length - l.quantity;
          const ended = l.endDate < now;
          return { ro: l.releaseOrder.number, client: l.releaseOrder.client.name, line: l.description, channel: l.channel.code, ordered: l.quantity, scheduled: l.events.length, aired, missed, variance, state: variance > 0 ? "Over-delivery" : ended && aired < l.quantity ? "Under-delivered" : variance < 0 ? "Under-scheduled" : "On target" };
        }),
      };
    },
  },
  {
    key: "promo-performance", title: "Promo performance", group: "Advertising", description: "Plays per promo campaign against its minimum and maximum.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const camps = await prisma.promoCampaign.findMany({ where: { startDate: { lte: f.to }, endDate: { gte: f.from } }, include: { promos: true } });
      const rows: Record<string, unknown>[] = [];
      for (const c of camps) {
        const ids = c.promos.map((p) => p.assetId);
        const [planned, aired] = await Promise.all([
          prisma.scheduleEvent.count({ where: { ...chWhere(f), assetId: { in: ids }, startAt: { gte: f.from, lt: f.to }, status: "PLANNED" } }),
          prisma.scheduleEvent.count({ where: { ...chWhere(f), assetId: { in: ids }, startAt: { gte: f.from, lt: f.to }, status: "AIRED" } }),
        ]);
        const total = planned + aired;
        rows.push({ campaign: c.name, priority: c.priority, promos: ids.length, planned, aired, min: c.minPlays ?? "", max: c.maxPlays ?? "", state: c.minPlays && total < c.minPlays ? "Below minimum" : c.maxPlays && total > c.maxPlays ? "Above maximum" : "OK" });
      }
      return { columns: [{ key: "campaign", label: "Campaign" }, { key: "priority", label: "Priority" }, { key: "promos", label: "Promos", type: "number" }, { key: "planned", label: "Planned", type: "number" }, { key: "aired", label: "Aired", type: "number" }, { key: "min", label: "Min plays" }, { key: "max", label: "Max plays" }, { key: "state", label: "Status" }], rows };
    },
  },
  {
    key: "inventory-utilization", title: "Inventory utilisation", group: "Advertising", description: "Positions by status with estimated value (rate-card value, not invoiced revenue).", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const g = await prisma.advertisingInventory.groupBy({ by: ["status"], where: { break: { ...chWhere(f), startAt: { gte: f.from, lt: f.to } } }, _count: true, _sum: { rate: true, durationSec: true } });
      const total = g.reduce((n, r) => n + r._count, 0) || 1;
      const rows = g.map((r) => ({ status: r.status, positions: r._count, pct: ((r._count / total) * 100).toFixed(1), seconds: r._sum.durationSec ?? 0, estValue: money(r._sum.rate) }));
      return { columns: [{ key: "status", label: "Status" }, { key: "positions", label: "Positions", type: "number" }, { key: "pct", label: "% of total", type: "number" }, { key: "seconds", label: "Seconds", type: "number" }, { key: "estValue", label: "Estimated value", type: "money" }], rows, totals: totalOf(rows, ["estValue"]), note: "Estimated value is the rate-card value of positions. Invoiced and collected revenue are in the financial reports." };
    },
  },
  {
    key: "inventory-revenue", title: "Inventory revenue by channel, program and slot", group: "Advertising", description: "Sold vs unsold positions and estimated sold value per channel / program / band.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const inv = await prisma.advertisingInventory.findMany({ where: { break: { ...chWhere(f), startAt: { gte: f.from, lt: f.to } } }, include: { break: { include: { channel: true } } } });
      const map = new Map<string, { channel: string; program: string; band: string; positions: number; sold: number; unsold: number; soldValue: ReturnType<typeof D>; unsoldValue: ReturnType<typeof D> }>();
      for (const i of inv) {
        const k = `${i.break.channel.code}|${i.break.programTitle ?? "—"}|${i.break.timeBand ?? "—"}`;
        const m = map.get(k) ?? { channel: i.break.channel.code, program: i.break.programTitle ?? "—", band: i.break.timeBand ?? "—", positions: 0, sold: 0, unsold: 0, soldValue: D(0), unsoldValue: D(0) };
        m.positions++;
        if (i.roLineItemId) { m.sold++; m.soldValue = m.soldValue.add(i.rate); } else if (i.status === "AVAILABLE") { m.unsold++; m.unsoldValue = m.unsoldValue.add(i.rate); }
        map.set(k, m);
      }
      const rows = [...map.values()].map((m) => ({ ...m, soldValue: m.soldValue.toFixed(2), unsoldValue: m.unsoldValue.toFixed(2) }));
      return { columns: [{ key: "channel", label: "Channel" }, { key: "program", label: "Program" }, { key: "band", label: "Band" }, { key: "positions", label: "Positions", type: "number" }, { key: "sold", label: "Sold", type: "number" }, { key: "unsold", label: "Unsold", type: "number" }, { key: "soldValue", label: "Est. sold value", type: "money" }, { key: "unsoldValue", label: "Est. unsold value", type: "money" }], rows, totals: totalOf(rows, ["soldValue", "unsoldValue"]), note: "Estimated from inventory rates; see Revenue by channel for invoiced amounts." };
    },
  },

  // ───────── Financial ─────────
  {
    key: "sales-summary", title: "Sales summary", group: "Financial", description: "Booked (RO) vs invoiced vs collected per month.", permission: "report.financial", filters: ["date"],
    async run(f) {
      const [ros, invs, pays] = await Promise.all([
        prisma.releaseOrder.findMany({ where: { status: { in: ["APPROVED", "SCHEDULED", "COMPLETED"] }, startDate: { gte: f.from, lt: f.to } }, select: { startDate: true, totalAmount: true } }),
        prisma.invoice.findMany({ where: { issueDate: { gte: f.from, lt: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { issueDate: true, total: true } }),
        prisma.payment.findMany({ where: { receivedAt: { gte: f.from, lt: f.to }, status: "CONFIRMED", isSimulated: false }, select: { receivedAt: true, amount: true } }),
      ]);
      const m = new Map<string, { month: string; booked: ReturnType<typeof D>; invoiced: ReturnType<typeof D>; collected: ReturnType<typeof D> }>();
      const get = (d: Date) => { const k = d.toISOString().slice(0, 7); const v = m.get(k) ?? { month: k, booked: D(0), invoiced: D(0), collected: D(0) }; m.set(k, v); return v; };
      for (const r of ros) get(r.startDate).booked = get(r.startDate).booked.add(r.totalAmount);
      for (const i of invs) get(i.issueDate!).invoiced = get(i.issueDate!).invoiced.add(i.total);
      for (const p of pays) get(p.receivedAt).collected = get(p.receivedAt).collected.add(p.amount);
      const rows = [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ month: r.month, booked: r.booked.toFixed(2), invoiced: r.invoiced.toFixed(2), collected: r.collected.toFixed(2) }));
      return { columns: [{ key: "month", label: "Month" }, { key: "booked", label: "Booked (RO)", type: "money" }, { key: "invoiced", label: "Invoiced", type: "money" }, { key: "collected", label: "Collected", type: "money" }], rows, totals: totalOf(rows, ["booked", "invoiced", "collected"]), note: "Collected excludes simulated test payments." };
    },
  },
  {
    key: "revenue-by-channel", title: "Revenue by channel", group: "Financial", description: "Invoiced net revenue by channel (from invoice lines linked to RO lines).", permission: "report.financial", filters: ["date"],
    async run(f) {
      const lines = await prisma.invoiceLineItem.findMany({ where: { invoice: { issueDate: { gte: f.from, lt: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] } } }, include: { invoice: true } });
      const roLines = new Map((await prisma.releaseOrderLineItem.findMany({ where: { id: { in: lines.map((l) => l.roLineItemId!).filter(Boolean) } }, include: { channel: true } })).map((l) => [l.id, l.channel.code]));
      const m = new Map<string, { gross: ReturnType<typeof D>; net: ReturnType<typeof D> }>();
      for (const l of lines) {
        const k = l.roLineItemId ? roLines.get(l.roLineItemId) ?? "?" : "Manual invoices";
        const v = m.get(k) ?? { gross: D(0), net: D(0) };
        v.gross = v.gross.add(l.grossAmount);
        v.net = v.net.add(l.grossAmount).sub(l.discountAmount).sub(l.commissionAmount);
        m.set(k, v);
      }
      const rows = [...m.entries()].map(([channel, v]) => ({ channel, gross: v.gross.toFixed(2), net: v.net.toFixed(2) }));
      return { columns: [{ key: "channel", label: "Channel" }, { key: "gross", label: "Gross invoiced", type: "money" }, { key: "net", label: "Net revenue (ex. tax)", type: "money" }], rows, totals: totalOf(rows, ["gross", "net"]) };
    },
  },
  {
    key: "revenue-by-client", title: "Revenue by client", group: "Financial", description: "Invoiced, paid and outstanding per client.", permission: "report.financial", filters: ["date", "agency"],
    async run(f) {
      const g = await prisma.invoice.groupBy({ by: ["clientId"], where: { issueDate: { gte: f.from, lt: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] }, ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, _sum: { total: true, amountPaid: true, balance: true }, _count: true });
      const c = new Map((await prisma.client.findMany()).map((x) => [x.id, x.name]));
      const rows = g.map((r) => ({ client: c.get(r.clientId), invoices: r._count, invoiced: money(r._sum.total), paid: money(r._sum.amountPaid), outstanding: money(r._sum.balance) }));
      return { columns: [{ key: "client", label: "Client" }, { key: "invoices", label: "Invoices", type: "number" }, { key: "invoiced", label: "Invoiced", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "outstanding", label: "Outstanding", type: "money" }], rows, totals: totalOf(rows, ["invoiced", "paid", "outstanding"]) };
    },
  },
  {
    key: "revenue-by-agency", title: "Revenue by agency", group: "Financial", description: "Invoiced, commission and outstanding per agency.", permission: "report.financial", filters: ["date"],
    async run(f) {
      const g = await prisma.invoice.groupBy({ by: ["agencyId"], where: { issueDate: { gte: f.from, lt: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { total: true, commissionTotal: true, balance: true }, _count: true });
      const a = new Map((await prisma.agency.findMany()).map((x) => [x.id, x.name]));
      const rows = g.map((r) => ({ agency: r.agencyId ? a.get(r.agencyId) : "Direct clients", invoices: r._count, invoiced: money(r._sum.total), commission: money(r._sum.commissionTotal), outstanding: money(r._sum.balance) }));
      return { columns: [{ key: "agency", label: "Agency" }, { key: "invoices", label: "Invoices", type: "number" }, { key: "invoiced", label: "Invoiced", type: "money" }, { key: "commission", label: "Commission", type: "money" }, { key: "outstanding", label: "Outstanding", type: "money" }], rows, totals: totalOf(rows, ["invoiced", "commission", "outstanding"]) };
    },
  },
  {
    key: "invoice-register", title: "Invoice register", group: "Financial", description: "All invoices issued in the period.", permission: "report.financial", filters: ["date", "client", "agency", "status"], statuses: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "CREDITED"],
    async run(f) {
      const inv = await prisma.invoice.findMany({ where: { OR: [{ issueDate: { gte: f.from, lt: f.to } }, { issueDate: null, createdAt: { gte: f.from, lt: f.to } }], ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}), ...(f.status ? { status: f.status as never } : {}) }, include: { client: true, agency: true }, orderBy: { issueDate: "asc" } });
      const rows = inv.map((i) => ({ number: i.number ?? "(draft)", issueDate: i.issueDate, dueDate: i.dueDate, client: i.client.name, agency: i.agency?.name ?? "", status: i.status, currency: i.currency, subtotal: money(i.subtotal), tax: money(i.taxTotal), total: money(i.total), paid: money(i.amountPaid), credited: money(i.creditedTotal), balance: money(i.balance) }));
      return { columns: [{ key: "number", label: "Invoice" }, { key: "issueDate", label: "Issued", type: "date" }, { key: "dueDate", label: "Due", type: "date" }, { key: "client", label: "Client" }, { key: "agency", label: "Agency" }, { key: "status", label: "Status" }, { key: "currency", label: "Cur." }, { key: "subtotal", label: "Gross", type: "money" }, { key: "tax", label: "Tax", type: "money" }, { key: "total", label: "Total", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "credited", label: "Credited", type: "money" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: totalOf(rows, ["subtotal", "tax", "total", "paid", "credited", "balance"]) };
    },
  },
  {
    key: "outstanding-invoices", title: "Outstanding invoices (ageing)", group: "Financial", description: "Open balances with ageing buckets as of today.", permission: "report.financial", filters: ["client", "agency"],
    async run(f) {
      const inv = await prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, balance: { gt: 0 }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, include: { client: true, agency: true }, orderBy: { dueDate: "asc" } });
      const now = Date.now();
      const rows = inv.map((i) => {
        const days = i.dueDate ? Math.floor((now - i.dueDate.getTime()) / 86400000) : 0;
        return { number: i.number, client: i.client.name, agency: i.agency?.name ?? "", dueDate: i.dueDate, daysOverdue: Math.max(0, days), bucket: days <= 0 ? "Current" : days <= 30 ? "1–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+", balance: money(i.balance) };
      });
      return { columns: [{ key: "number", label: "Invoice" }, { key: "client", label: "Client" }, { key: "agency", label: "Agency" }, { key: "dueDate", label: "Due", type: "date" }, { key: "daysOverdue", label: "Days overdue", type: "number" }, { key: "bucket", label: "Ageing" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: totalOf(rows, ["balance"]) };
    },
  },
  {
    key: "overdue-payments", title: "Overdue payments", group: "Financial", description: "Invoices past due with an open balance.", permission: "report.financial", filters: ["client", "agency"],
    async run(f) {
      const inv = await prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, balance: { gt: 0 }, dueDate: { lt: new Date() }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, include: { client: true }, orderBy: { dueDate: "asc" } });
      const rows = inv.map((i) => ({ number: i.number, client: i.client.name, dueDate: i.dueDate, total: money(i.total), balance: money(i.balance) }));
      return { columns: [{ key: "number", label: "Invoice" }, { key: "client", label: "Client" }, { key: "dueDate", label: "Due", type: "date" }, { key: "total", label: "Total", type: "money" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: totalOf(rows, ["total", "balance"]) };
    },
  },
  {
    key: "payment-history", title: "Payment history", group: "Financial", description: "Payments received with their allocations.", permission: "report.financial", filters: ["date", "client", "agency"],
    async run(f) {
      const p = await prisma.payment.findMany({ where: { receivedAt: { gte: f.from, lt: f.to }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.agencyId ? { agencyId: f.agencyId } : {}) }, include: { client: true, agency: true, allocations: { include: { invoice: true } } }, orderBy: { receivedAt: "asc" } });
      const rows = p.map((x) => {
        const allocated = sum(x.allocations.map((a) => a.amount));
        return { receivedAt: x.receivedAt, payer: x.agency?.name ?? x.client?.name, method: x.method, reference: x.reference, status: x.status + (x.isSimulated ? " (SIMULATED)" : ""), amount: money(x.amount), allocated: allocated.toFixed(2), unallocated: D(x.amount).sub(allocated).toFixed(2), invoices: x.allocations.map((a) => a.invoice.number).join(" ") };
      });
      return { columns: [{ key: "receivedAt", label: "Received", type: "date" }, { key: "payer", label: "Payer" }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "status", label: "Status" }, { key: "amount", label: "Amount", type: "money" }, { key: "allocated", label: "Allocated", type: "money" }, { key: "unallocated", label: "Unallocated", type: "money" }, { key: "invoices", label: "Invoices" }], rows, totals: totalOf(rows, ["amount", "allocated", "unallocated"]) };
    },
  },
  {
    key: "tax-summary", title: "Tax summary", group: "Financial", description: "Taxable value and tax by rate on issued invoices.", permission: "report.financial", filters: ["date"],
    async run(f) {
      const lines = await prisma.invoiceLineItem.findMany({ where: { invoice: { issueDate: { gte: f.from, lt: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] } } } });
      const m = new Map<string, { taxable: ReturnType<typeof D>; tax: ReturnType<typeof D> }>();
      for (const l of lines) {
        const k = D(l.taxRatePct).toFixed(2);
        const v = m.get(k) ?? { taxable: D(0), tax: D(0) };
        v.taxable = v.taxable.add(l.totalAmount).sub(l.taxAmount);
        v.tax = v.tax.add(l.taxAmount);
        m.set(k, v);
      }
      const rows = [...m.entries()].map(([rate, v]) => ({ rate, taxable: v.taxable.toFixed(2), tax: v.tax.toFixed(2) }));
      return { columns: [{ key: "rate", label: "Tax rate %" }, { key: "taxable", label: "Taxable value", type: "money" }, { key: "tax", label: "Tax", type: "money" }], rows, totals: totalOf(rows, ["taxable", "tax"]), note: "Credit notes are listed separately in the credit note register." };
    },
  },
  {
    key: "credit-notes", title: "Credit note register", group: "Financial", description: "Credit notes issued in the period.", permission: "report.financial", filters: ["date", "client"],
    async run(f) {
      const cn = await prisma.creditNote.findMany({ where: { issuedAt: { gte: f.from, lt: f.to }, ...(f.clientId ? { invoice: { clientId: f.clientId } } : {}) }, include: { invoice: { include: { client: true } } }, orderBy: { issuedAt: "asc" } });
      const rows = cn.map((c) => ({ number: c.number, issuedAt: c.issuedAt, invoice: c.invoice.number, client: c.invoice.client.name, reason: c.reason, amount: money(c.amount) }));
      return { columns: [{ key: "number", label: "Credit note" }, { key: "issuedAt", label: "Issued", type: "date" }, { key: "invoice", label: "Invoice" }, { key: "client", label: "Client" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Amount", type: "money" }], rows, totals: totalOf(rows, ["amount"]) };
    },
  },

  // ───────── Rights ─────────
  {
    key: "expiring-licenses", title: "Expiring licences", group: "Rights", description: "Licences ending within the selected date range.", permission: "report.view", filters: ["date"],
    async run(f) {
      const l = await prisma.contentLicense.findMany({ where: { deletedAt: null, validTo: { gte: f.from, lt: f.to } }, include: { asset: true }, orderBy: { validTo: "asc" } });
      return { columns: [{ key: "asset", label: "Asset" }, { key: "licensor", label: "Licensor" }, { key: "contract", label: "Contract" }, { key: "validTo", label: "Expires", type: "date" }, { key: "maxPlays", label: "Max plays" }], rows: l.map((x) => ({ asset: x.asset.title, licensor: x.licensor, contract: x.contractRef, validTo: x.validTo, maxPlays: x.maxPlays ?? "Unlimited" })) };
    },
  },
  {
    key: "expired-licenses", title: "Expired licences", group: "Rights", description: "Licences already expired, with any future scheduled plays flagged.", permission: "report.view", filters: [],
    async run() {
      const l = await prisma.contentLicense.findMany({ where: { deletedAt: null, validTo: { lt: new Date() } }, include: { asset: true }, orderBy: { validTo: "desc" } });
      const rows = [];
      for (const x of l) {
        const future = await prisma.scheduleEvent.count({ where: { assetId: x.assetId, startAt: { gt: x.validTo }, status: "PLANNED" } });
        rows.push({ asset: x.asset.title, licensor: x.licensor, validTo: x.validTo, futurePlays: future });
      }
      return { columns: [{ key: "asset", label: "Asset" }, { key: "licensor", label: "Licensor" }, { key: "validTo", label: "Expired", type: "date" }, { key: "futurePlays", label: "Planned plays after expiry", type: "number" }], rows };
    },
  },
  {
    key: "remaining-plays", title: "Remaining permitted plays", group: "Rights", description: "Licensed plays vs planned and confirmed plays.", permission: "report.view", filters: [],
    async run() {
      const l = await prisma.contentLicense.findMany({ where: { deletedAt: null, maxPlays: { not: null }, validTo: { gte: new Date() } }, include: { asset: true } });
      const rows = [];
      for (const x of l) {
        const [planned, confirmed] = await Promise.all([
          prisma.contentPlayLog.count({ where: { assetId: x.assetId, status: "PLANNED" } }),
          prisma.contentPlayLog.count({ where: { assetId: x.assetId, status: "CONFIRMED" } }),
        ]);
        rows.push({ asset: x.asset.title, maxPlays: x.maxPlays, confirmed, planned, remaining: (x.maxPlays ?? 0) - confirmed - planned });
      }
      return { columns: [{ key: "asset", label: "Asset" }, { key: "maxPlays", label: "Permitted", type: "number" }, { key: "confirmed", label: "Confirmed plays", type: "number" }, { key: "planned", label: "Planned plays", type: "number" }, { key: "remaining", label: "Remaining", type: "number" }], rows, note: "Planned plays are scheduled but not yet confirmed as aired." };
    },
  },
  {
    key: "content-usage", title: "Content usage history", group: "Rights", description: "Play log entries (planned vs confirmed) in the period.", permission: "report.view", filters: ["date", "channel"],
    async run(f) {
      const p = await prisma.contentPlayLog.findMany({ where: { ...chWhere(f), plannedAt: { gte: f.from, lt: f.to } }, include: { asset: true, channel: true }, orderBy: { plannedAt: "asc" }, take: 20000 });
      return { columns: [{ key: "asset", label: "Asset" }, { key: "channel", label: "Channel" }, { key: "plannedAt", label: "Planned", type: "datetime" }, { key: "airedAt", label: "Aired", type: "datetime" }, { key: "status", label: "Status" }, { key: "source", label: "Source" }], rows: p.map((x) => ({ asset: x.asset.title, channel: x.channel.code, plannedAt: x.plannedAt, airedAt: x.airedAt, status: x.status, source: x.source })) };
    },
  },
];

export const reportByKey = (k: string) => REPORTS.find((r) => r.key === k);
