import Link from "next/link";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { FilterSelect } from "@/components/layout/filters";
import { StackedBars } from "@/components/charts";
import { DateJump } from "../scheduling/controls";
import { D, formatMoney, sum } from "@/lib/money";
import { addDaysStr, broadcastDateOf, broadcastDayRange, fmtTz, todayIn } from "@/lib/time";
import { TIME_BANDS } from "@/lib/inventory/timeband";
import { sp } from "@/lib/utils";
import { BreakList, GenerateBreaksButton, type BreakRow } from "./client";

export const metadata = { title: "Advertising Inventory" };

const SOLD = ["RESERVED", "BOOKED", "SCHEDULED", "AIRED"];
const STATUSES = ["AVAILABLE", "RESERVED", "BOOKED", "SCHEDULED", "AIRED", "UNAVAILABLE"];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("inventory.view");
  const p = await searchParams;
  const ctx = await channelContext(user);
  if (!ctx.channels.length) return <EmptyState title="No channels assigned" description="Ask an administrator to give you access to a channel." />;
  const channel = ctx.channels.find((c) => c.id === sp(p.channel)) ?? ctx.selected ?? ctx.channels[0];
  const date = sp(p.date) ?? todayIn(channel.timezone);
  const band = sp(p.band);
  const status = sp(p.status);
  const settings = await getSetting("inventory.alerts");
  const currency = (await getSetting("billing.currency")).code;

  const day = broadcastDayRange(channel, date);
  const outlookEnd = broadcastDayRange(channel, addDaysStr(date, 13)).end;

  const [breaks, outlook] = await Promise.all([
    prisma.advertisingBreak.findMany({
      where: { channelId: channel.id, startAt: { gte: day.start, lt: day.end }, ...(band ? { timeBand: band } : {}), ...(status ? { inventory: { some: { status: status as never } } } : {}) },
      include: {
        inventory: { orderBy: { position: "asc" }, include: { roLineItem: { select: { releaseOrder: { select: { id: true, number: true, client: { select: { name: true } } } } } }, event: { select: { asset: { select: { title: true } } } } } },
        _count: { select: { events: true } },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.advertisingInventory.findMany({
      where: { break: { channelId: channel.id, startAt: { gte: day.start, lt: outlookEnd } } },
      select: { status: true, rate: true, break: { select: { startAt: true, timeBand: true } } },
    }),
  ]);

  // 14-day outlook, by broadcast date and time band — computed from live inventory rows.
  type Cell = { total: number; available: number; sold: number; unavailable: number; openValue: ReturnType<typeof D> };
  const grid = new Map<string, Cell>();
  const byDate = new Map<string, Record<string, number>>();
  for (const r of outlook) {
    const d = broadcastDateOf(channel, r.break.startAt);
    const key = `${d}|${r.break.timeBand ?? "—"}`;
    const c = grid.get(key) ?? { total: 0, available: 0, sold: 0, unavailable: 0, openValue: D(0) };
    c.total++;
    if (r.status === "AVAILABLE") {
      c.available++;
      c.openValue = c.openValue.plus(r.rate);
    } else if (SOLD.includes(r.status)) c.sold++;
    else if (r.status === "UNAVAILABLE") c.unavailable++;
    grid.set(key, c);
    const s = byDate.get(d) ?? Object.fromEntries(STATUSES.map((x) => [x, 0]));
    s[r.status] = (s[r.status] ?? 0) + 1;
    byDate.set(d, s);
  }
  const dates = Array.from({ length: 14 }, (_, i) => addDaysStr(date, i));
  const bands = TIME_BANDS.map((b) => b.key as string);
  const chart = dates.map((d) => ({ day: d.slice(5), ...(byDate.get(d) ?? Object.fromEntries(STATUSES.map((x) => [x, 0]))) }));

  const alerts: { tone: "low" | "unsold"; text: string; href: string }[] = [];
  const today = todayIn(channel.timezone);
  for (const d of dates) {
    for (const b of bands) {
      const c = grid.get(`${d}|${b}`);
      if (!c || c.total === 0) continue;
      const sellable = c.total - c.unavailable;
      if (sellable <= 0) continue;
      const availPct = (c.available / sellable) * 100;
      if (availPct < settings.lowAvailabilityPct) alerts.push({ tone: "low", text: `${d} ${b}: only ${c.available} of ${sellable} positions left (${availPct.toFixed(0)}%)`, href: `/inventory?channel=${channel.id}&date=${d}&band=${b}` });
      // Unsold capacity matters only close to air.
      if (d <= addDaysStr(today, 2) && d >= today && availPct > settings.unusedCapacityPct) alerts.push({ tone: "unsold", text: `${d} ${b}: ${c.available} positions still unsold (${availPct.toFixed(0)}%), worth ${formatMoney(c.openValue, currency)} at card rate`, href: `/inventory?channel=${channel.id}&date=${d}&band=${b}&status=AVAILABLE` });
    }
  }

  const dayInv = breaks.flatMap((b) => b.inventory);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, dayInv.filter((i) => i.status === s).length]));
  const sellable = dayInv.length - counts.UNAVAILABLE;
  const soldCount = SOLD.reduce((n, s) => n + counts[s], 0);
  const soldValue = sum(dayInv.filter((i) => SOLD.includes(i.status)).map((i) => i.rate));
  const openValue = sum(dayInv.filter((i) => i.status === "AVAILABLE").map((i) => i.rate));

  const rows: BreakRow[] = breaks.map((b) => ({
    id: b.id,
    code: b.code,
    time: fmtTz(b.startAt, channel.timezone, "HH:mm"),
    programTitle: b.programTitle,
    timeBand: b.timeBand,
    maxDurationSec: b.maxDurationSec,
    events: b._count.events,
    positions: b.inventory.map((i) => ({
      id: i.id,
      position: i.position,
      durationSec: i.durationSec,
      rate: i.rate.toFixed(2),
      status: i.status,
      version: i.version,
      ro: i.roLineItem ? { id: i.roLineItem.releaseOrder.id, number: i.roLineItem.releaseOrder.number, client: i.roLineItem.releaseOrder.client.name } : null,
      spot: i.event?.asset.title ?? null,
    })),
  }));

  const canManage = user.permissions.has("inventory.manage");
  const qs = (extra: Record<string, string>) => new URLSearchParams({ channel: channel.id, date, ...extra }).toString();

  return (
    <div>
      <PageHeader
        title="Advertising inventory"
        description={`Break positions for ${channel.name} on the ${date} broadcast day (starts ${String(channel.broadcastDayStartHour).padStart(2, "0")}:00 ${channel.timezone}). Approving a release order books positions here; withdrawn positions cannot be sold.`}
        actions={canManage && <GenerateBreaksButton channels={ctx.channels.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))} channelId={channel.id} date={date} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect param="channel" label="Channel" current={channel.id} options={ctx.channels.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        <DateJump date={date} />
        <FilterSelect param="band" label="Time band" options={bands.map((b) => ({ value: b, label: b }))} />
        <FilterSelect param="status" label="Status" options={STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        <div className="ml-auto flex gap-1 text-sm">
          <Link className="rounded-md border border-border px-2.5 py-1.5 hover:bg-surface-2" href={`/inventory?${qs({ date: addDaysStr(date, -1) })}`}>
            ← Prev day
          </Link>
          <Link className="rounded-md border border-border px-2.5 py-1.5 hover:bg-surface-2" href={`/inventory?${qs({ date: addDaysStr(date, 1) })}`}>
            Next day →
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Breaks" value={breaks.length} />
        <Kpi label="Positions" value={dayInv.length} sub={`${counts.UNAVAILABLE} withdrawn`} />
        <Kpi label="Available" value={counts.AVAILABLE} sub={`${formatMoney(openValue, currency)} at card rate`} href={`/inventory?${qs({ status: "AVAILABLE" })}`} />
        <Kpi label="Sold" value={soldCount} sub={`${counts.RESERVED} reserved · ${counts.BOOKED} booked`} />
        <Kpi label="Sell-through" value={sellable ? `${((soldCount / sellable) * 100).toFixed(0)}%` : "—"} sub={`${counts.SCHEDULED} scheduled · ${counts.AIRED} aired`} />
        <Kpi label="Sold value" value={formatMoney(soldValue, currency)} sub="card rate of sold positions" />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="14-day outlook" description="Positions by status for each broadcast day, from live inventory." />
          <CardBody>
            {outlook.length ? <StackedBars data={chart} keys={STATUSES} xKey="day" height={220} /> : <p className="text-sm text-muted">No breaks in the next 14 days. Generate breaks to create inventory.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Inventory alerts" description={`Low availability below ${settings.lowAvailabilityPct}%; unsold above ${settings.unusedCapacityPct}% within 2 days of air. Thresholds are in System Settings.`} />
          <CardBody className="max-h-64 space-y-1.5 overflow-auto text-sm">
            {alerts.length === 0 && <p className="text-muted">No alerts for this channel in the next 14 days.</p>}
            {alerts.map((a, i) => (
              <Link key={i} href={a.href} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                {a.tone === "low" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> : <TrendingDown className="mt-0.5 size-4 shrink-0 text-sky-500" />}
                <span>{a.text}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4 overflow-x-auto">
        <CardHeader title="Availability by time band" description="Available / sellable positions. Click a cell to open that day and band." />
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Band</th>
              {dates.map((d) => (
                <th key={d} className={`px-2 py-2 text-center font-medium ${d === date ? "text-primary" : ""}`}>
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b} className="border-t border-border">
                <td className="px-3 py-1.5 font-medium">{b}</td>
                {dates.map((d) => {
                  const c = grid.get(`${d}|${b}`);
                  const sellableN = c ? c.total - c.unavailable : 0;
                  const pct = sellableN ? c!.available / sellableN : null;
                  const tone = pct === null ? "" : pct * 100 < settings.lowAvailabilityPct ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" : pct < 0.5 ? "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200";
                  return (
                    <td key={d} className="p-0.5 text-center">
                      {c ? (
                        <Link href={`/inventory?${qs({ date: d, band: b })}`} className={`block rounded px-1 py-1 tabular ${tone}`}>
                          {c.available}/{sellableN}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader title={`Breaks on ${date}`} description={band || status ? `Filtered${band ? ` to ${band}` : ""}${status ? ` · breaks with ${status.toLowerCase()} positions` : ""}` : "Click a position to see its booking, change its rate or withdraw it from sale."} />
        {rows.length === 0 ? (
          <EmptyState title="No breaks for this day" description={canManage ? "Use “Generate breaks” to create break positions for a date range." : undefined} />
        ) : (
          <BreakList rows={rows} currency={currency} canManage={canManage} />
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: string; href?: string }) {
  const body = (
    <Card className="h-full p-3 transition-colors hover:border-primary/40">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
