import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { broadcastDayRange, todayIn, addDaysStr, fmtTz, formatDuration, broadcastDateOf } from "@/lib/time";
import { sp, cn } from "@/lib/utils";
import { CATEGORY_META } from "@/lib/categories";
import { Timeline, type TLChannel, type TLEvent, type TLBreak } from "./timeline";
import { ChannelPicker, DateJump } from "./controls";

export const metadata = { title: "Traffic Scheduling" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SchedulingPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("schedule.view");
  const params = await searchParams;
  const { channels: allowed, selected } = await channelContext(user);
  if (!allowed.length) return <EmptyState title="No channels" description="You are not assigned to any channel. Ask an administrator to assign you." />;
  const requested = (sp(params.channels) ?? sp(params.channel) ?? "").split(",").filter(Boolean);
  let chosen = allowed.filter((c) => requested.includes(c.id));
  if (!chosen.length) chosen = selected ? [selected] : allowed.slice(0, 2);
  const view = (sp(params.view) ?? "day") as "day" | "week" | "month" | "list";
  const date = sp(params.date) ?? todayIn(chosen[0].timezone);
  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ view, date, channels: chosen.map((c) => c.id).join(","), ...o });
    return `/scheduling?${p.toString()}`;
  };
  const step = view === "month" ? 30 : view === "week" ? 7 : 1;

  return (
    <div>
      <PageHeader
        title="Traffic scheduling"
        description="Multi-channel broadcast schedule. Every change is validated against the scheduling rules before it is saved."
        actions={
          <>
            <div className="flex rounded-md border border-border bg-surface p-0.5 text-sm">
              {(["day", "week", "month", "list"] as const).map((v) => (
                <Link key={v} href={qs({ view: v })} className={cn("rounded px-2.5 py-1 capitalize", view === v ? "bg-primary text-primary-fg" : "hover:bg-surface-2")}>
                  {v === "day" ? "Timeline" : v}
                </Link>
              ))}
            </div>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={qs({ date: addDaysStr(date, -step) })} className="rounded-md border border-border bg-surface p-1.5 hover:bg-surface-2" aria-label="Previous">
          <ChevronLeft className="size-4" />
        </Link>
        <DateJump date={date} />
        <Link href={qs({ date: addDaysStr(date, step) })} className="rounded-md border border-border bg-surface p-1.5 hover:bg-surface-2" aria-label="Next">
          <ChevronRight className="size-4" />
        </Link>
        <Link href={qs({ date: todayIn(chosen[0].timezone) })} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-2">
          Today
        </Link>
        <ChannelPicker channels={allowed.map((c) => ({ id: c.id, code: c.code }))} selected={chosen.map((c) => c.id)} />
      </div>
      {view === "day" && <DayView user={user} chosen={chosen} allowed={allowed} date={date} />}
      {view === "week" && <RangeView chosen={chosen} date={date} days={7} qs={qs} />}
      {view === "month" && <RangeView chosen={chosen} date={date.slice(0, 8) + "01"} days={31} qs={qs} />}
      {view === "list" && <ListView chosen={chosen} date={date} type={sp(params.type)} />}
    </div>
  );
}

type Ch = Awaited<ReturnType<typeof channelContext>>["channels"][number];

async function DayView({ user, chosen, allowed, date }: { user: Awaited<ReturnType<typeof requirePage>>; chosen: Ch[]; allowed: Ch[]; date: string }) {
  const tlChannels: TLChannel[] = [];
  const events: TLEvent[] = [];
  const breaks: TLBreak[] = [];
  for (const ch of chosen) {
    const { start, end } = broadcastDayRange(ch, date);
    const s = await prisma.schedule.findUnique({ where: { channelId_broadcastDate: { channelId: ch.id, broadcastDate: date } }, include: { versions: { orderBy: { version: "desc" }, take: 20 } } });
    tlChannels.push({
      id: ch.id,
      code: ch.code,
      name: ch.name,
      timezone: ch.timezone,
      color: ch.color,
      dayStart: start.toISOString(),
      dayEnd: end.toISOString(),
      schedule: s ? { id: s.id, status: s.status, version: s.version, hasUnpublishedChanges: s.hasUnpublishedChanges } : null,
      versions: s?.versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), comment: v.comment })) ?? [],
    });
    const [evs, brks] = await Promise.all([
      prisma.scheduleEvent.findMany({ where: { channelId: ch.id, startAt: { gte: start, lt: end }, status: { not: "CANCELLED" } }, include: { asset: { select: { assetCode: true } }, roLineItem: { select: { releaseOrder: { select: { number: true } } } } }, orderBy: { startAt: "asc" } }),
      prisma.advertisingBreak.findMany({ where: { channelId: ch.id, startAt: { gte: start, lt: end } }, include: { inventory: { select: { status: true } } }, orderBy: { startAt: "asc" } }),
    ]);
    const mapped = evs.map<TLEvent>((e) => ({ id: e.id, channelId: e.channelId, assetId: e.assetId, eventType: e.eventType, title: e.title, startAt: e.startAt.toISOString(), durationSec: e.durationSec, status: e.status, breakId: e.breakId, positionInBreak: e.positionInBreak, roNumber: e.roLineItem?.releaseOrder.number ?? null, notes: e.notes, houseNo: e.asset.assetCode }));
    events.push(...mapped);
    breaks.push(
      ...brks.map<TLBreak>((b) => ({
        id: b.id,
        channelId: b.channelId,
        code: b.code,
        startAt: b.startAt.toISOString(),
        maxDurationSec: b.maxDurationSec,
        programTitle: b.programTitle,
        positions: b.inventory.length,
        available: b.inventory.filter((i) => i.status === "AVAILABLE").length,
        spots: mapped.filter((e) => e.breakId === b.id).sort((x, y) => (x.positionInBreak ?? 0) - (y.positionInBreak ?? 0)),
      })),
    );
  }
  return (
    <Timeline
      date={date}
      channels={tlChannels}
      events={events}
      breaks={breaks}
      canEdit={user.permissions.has("schedule.edit")}
      canPublish={user.permissions.has("schedule.publish")}
      canConfirmAired={user.permissions.has("rights.manage")}
      allChannels={allowed.map((c) => ({ id: c.id, code: c.code }))}
    />
  );
}

async function RangeView({ chosen, date, days, qs }: { chosen: Ch[]; date: string; days: number; qs: (o: Record<string, string>) => string }) {
  const dates = Array.from({ length: days }, (_, i) => addDaysStr(date, i)).filter((d) => days !== 31 || d.slice(0, 7) === date.slice(0, 7));
  const rows = [];
  for (const ch of chosen) {
    const from = broadcastDayRange(ch, dates[0]).start;
    const to = broadcastDayRange(ch, dates[dates.length - 1]).end;
    const [schedules, evs, inv] = await Promise.all([
      prisma.schedule.findMany({ where: { channelId: ch.id, broadcastDate: { in: dates } } }),
      prisma.scheduleEvent.findMany({ where: { channelId: ch.id, startAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, select: { startAt: true, durationSec: true, eventType: true, breakId: true } }),
      prisma.advertisingInventory.findMany({ where: { break: { channelId: ch.id, startAt: { gte: from, lt: to } } }, select: { status: true, break: { select: { startAt: true } } } }),
    ]);
    const cells = dates.map((d) => {
      const s = schedules.find((x) => x.broadcastDate === d);
      const e = evs.filter((x) => broadcastDateOf(ch, x.startAt) === d);
      const i = inv.filter((x) => broadcastDateOf(ch, x.break.startAt) === d);
      const sold = i.filter((x) => !["AVAILABLE", "UNAVAILABLE", "CANCELLED"].includes(x.status)).length;
      const secs = e.filter((x) => !x.breakId).reduce((n, x) => n + x.durationSec, 0);
      return { d, s, count: e.length, spots: e.filter((x) => x.eventType === "COMMERCIAL").length, fill: Math.round((secs / 86400) * 100), sold, inv: i.length };
    });
    rows.push({ ch, cells });
  }
  return (
    <Card className="overflow-x-auto">
      <Table>
        <THead>
          <tr>
            <TH>Channel</TH>
            {dates.map((d) => (
              <TH key={d} className="text-center">
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}
              </TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {rows.map(({ ch, cells }) => (
            <TR key={ch.id}>
              <TD className="font-medium">{ch.code}</TD>
              {cells.map((c) => (
                <TD key={c.d} className="p-1 align-top">
                  <Link href={qs({ view: "day", date: c.d, channels: ch.id })} className="block min-w-24 rounded border border-border p-1.5 text-[11px] hover:border-primary">
                    {c.s ? <StatusBadge status={c.s.status} /> : <span className="text-muted">Empty</span>}
                    {c.s && c.s.version > 0 && <span className="ml-1 text-muted">v{c.s.version}</span>}
                    <div className="mt-1 tabular">{c.count} events</div>
                    <div className="tabular text-muted">{c.fill}% programmed</div>
                    <div className="tabular text-muted">
                      {c.spots} spots · {c.sold}/{c.inv} sold
                    </div>
                  </Link>
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

async function ListView({ chosen, date, type }: { chosen: Ch[]; date: string; type?: string }) {
  const rows = [];
  for (const ch of chosen) {
    const { start, end } = broadcastDayRange(ch, date);
    const evs = await prisma.scheduleEvent.findMany({ where: { channelId: ch.id, startAt: { gte: start, lt: end }, status: { not: "CANCELLED" }, ...(type ? { eventType: type as never } : {}) }, include: { asset: true, break: true, roLineItem: { include: { releaseOrder: true } } }, orderBy: { startAt: "asc" } });
    rows.push(...evs.map((e) => ({ e, ch })));
  }
  rows.sort((a, b) => a.e.startAt.getTime() - b.e.startAt.getTime());
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-border p-2 text-xs">
        <Link href={`?view=list&date=${date}&channels=${chosen.map((c) => c.id).join(",")}`} className={cn("rounded px-2 py-1", !type ? "bg-primary text-primary-fg" : "hover:bg-surface-2")}>
          All
        </Link>
        {Object.entries(CATEGORY_META)
          .filter(([k]) => k !== "SECONDARY")
          .map(([k, m]) => (
            <Link key={k} href={`?view=list&date=${date}&channels=${chosen.map((c) => c.id).join(",")}&type=${k}`} className={cn("rounded px-2 py-1", type === k ? "bg-primary text-primary-fg" : "hover:bg-surface-2")}>
              {m.plural}
            </Link>
          ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing scheduled" description="Use the timeline to drag media onto the day, or copy another day's schedule." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Channel</TH>
              <TH>Start</TH>
              <TH>Duration</TH>
              <TH>House no.</TH>
              <TH>Title</TH>
              <TH>Type</TH>
              <TH>Break</TH>
              <TH>RO</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map(({ e, ch }) => (
              <TR key={e.id}>
                <TD>{ch.code}</TD>
                <TD className="font-mono text-xs">{fmtTz(e.startAt, ch.timezone, "HH:mm:ss")}</TD>
                <TD className="font-mono text-xs">{formatDuration(e.durationSec)}</TD>
                <TD className="font-mono text-xs">{e.asset.assetCode}</TD>
                <TD>
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: CATEGORY_META[e.eventType]?.color }} />
                  {e.title}
                </TD>
                <TD className="text-xs">{CATEGORY_META[e.eventType]?.label}</TD>
                <TD className="text-xs">{e.break ? `${e.break.code} #${e.positionInBreak}` : ""}</TD>
                <TD className="text-xs">{e.roLineItem?.releaseOrder.number}</TD>
                <TD>
                  <StatusBadge status={e.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
