import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { FilterSelect } from "@/components/layout/filters";
import { DateJump } from "../scheduling/controls";
import { broadcastDayRange, fmtTz, todayIn } from "@/lib/time";
import { sp } from "@/lib/utils";
import { SecondaryDialog, DeleteSecondary } from "./client";

export const metadata = { title: "Secondary Events" };

const CAT_COLORS: Record<string, string> = { LOGO: "#0f766e", BUG: "#0891b2", LOWER_THIRD: "#7c3aed", TICKER: "#dc2626", OVERLAY: "#d97706", COUNTDOWN: "#2563eb", OTHER: "#64748b" };

export default async function SecondaryEvents({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("secondary.view");
  const p = await searchParams;
  const ctx = await channelContext(user);
  if (!ctx.channels.length) return <EmptyState title="No channels assigned" />;
  const channel = ctx.channels.find((c) => c.id === sp(p.channel)) ?? ctx.selected ?? ctx.channels[0];
  const date = sp(p.date) ?? todayIn(channel.timezone);
  const { start, end } = broadcastDayRange(channel, date);
  const [events, graphics, primary] = await Promise.all([
    prisma.secondaryEvent.findMany({ where: { channelId: channel.id, deletedAt: null, startAt: { lt: end }, endAt: { gt: start } }, include: { asset: true }, orderBy: [{ layer: "asc" }, { startAt: "asc" }] }),
    prisma.mediaAsset.findMany({ where: { category: "SECONDARY", deletedAt: null, approvalStatus: "APPROVED" }, orderBy: { title: "asc" } }),
    prisma.scheduleEvent.findMany({ where: { channelId: channel.id, breakId: null, startAt: { gte: start, lt: end }, eventType: { in: ["PROGRAM", "MOVIE"] } }, select: { startAt: true, durationSec: true, title: true }, orderBy: { startAt: "asc" } }),
  ]);
  const canEdit = user.permissions.has("secondary.edit");
  const layers = [...new Set(events.map((e) => e.layer))].sort((a, b) => a - b);
  const span = end.getTime() - start.getTime();
  const pct = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - start.getTime()) / span) * 100));
  const hours = Array.from({ length: 25 }, (_, i) => i);
  const toLocal = (d: Date) => ({ date: fmtTz(d, channel.timezone, "yyyy-MM-dd"), time: fmtTz(d, channel.timezone, "HH:mm:ss") });
  const assetOpts = graphics.map((g) => ({ value: g.id, label: `${g.assetCode} · ${g.title}` }));
  return (
    <div>
      <PageHeader
        title="Secondary events"
        description={`Logos, bugs, lower thirds, tickers and other graphics that run on top of the primary schedule. Active events on the same layer cannot overlap. Times are ${channel.timezone}.`}
        actions={canEdit && <SecondaryDialog channelId={channel.id} assets={assetOpts} initial={{ startDate: date, endDate: date, startTime: "19:00", endTime: "20:00", layer: "1", priority: "5", isActive: true, category: "LOWER_THIRD" }} />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterSelect param="channel" label="Channel" current={channel.id} options={ctx.channels.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        <DateJump date={date} />
      </div>
      <Card className="mb-4 overflow-x-auto">
        <CardHeader title={`Graphics layers on ${date}`} description="The program track is shown for reference; each row below it is one graphics layer." />
        <div className="min-w-[900px] p-4">
          <div className="relative ml-20 h-5 text-[10px] text-muted">
            {hours.map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
                {String((h + channel.broadcastDayStartHour) % 24).padStart(2, "0")}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-18 shrink-0 text-xs text-muted">Programs</span>
            <div className="relative h-6 flex-1 rounded bg-surface-2">
              {primary.map((e, i) => (
                <div key={i} title={e.title} className="absolute top-0 h-6 truncate border-r border-surface bg-amber-200 px-1 text-[10px] leading-6 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" style={{ left: `${pct(e.startAt)}%`, width: `${pct(new Date(e.startAt.getTime() + e.durationSec * 1000)) - pct(e.startAt)}%` }}>
                  {e.title}
                </div>
              ))}
            </div>
          </div>
          {layers.length === 0 && <p className="mt-3 text-sm text-muted">No secondary events on this day.</p>}
          {layers.map((l) => (
            <div key={l} className="mt-2 flex items-center gap-2">
              <span className="w-18 shrink-0 text-xs text-muted">Layer {l}</span>
              <div className="relative h-7 flex-1 rounded bg-surface-2">
                {events
                  .filter((e) => e.layer === l)
                  .map((e) => (
                    <div key={e.id} title={`${e.label} (${fmtTz(e.startAt, channel.timezone, "HH:mm")}–${fmtTz(e.endAt, channel.timezone, "HH:mm")})`} className={`absolute top-0.5 h-6 truncate rounded px-1.5 text-[11px] leading-6 text-white ${e.isActive ? "" : "opacity-40"}`} style={{ left: `${pct(e.startAt)}%`, width: `max(4px, ${pct(e.endAt) - pct(e.startAt)}%)`, background: CAT_COLORS[e.category] }}>
                      {e.label}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        {events.length === 0 ? (
          <EmptyState title="No secondary events on this day" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Layer</TH>
                <TH>Label</TH>
                <TH>Type</TH>
                <TH>Graphic</TH>
                <TH>Start</TH>
                <TH>End</TH>
                <TH>Priority</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {events.map((e) => {
                const s = toLocal(e.startAt);
                const en = toLocal(e.endAt);
                return (
                  <TR key={e.id} className={e.isActive ? "" : "opacity-60"}>
                    <TD>{e.layer}</TD>
                    <TD>
                      {e.label} {!e.isActive && <Badge>inactive</Badge>}
                    </TD>
                    <TD>
                      <span className="rounded px-1.5 py-0.5 text-[11px] text-white" style={{ background: CAT_COLORS[e.category] }}>
                        {e.category.replace("_", " ").toLowerCase()}
                      </span>
                    </TD>
                    <TD className="text-xs">{e.asset?.title ?? "—"}</TD>
                    <TD className="font-mono text-xs">{s.date === date ? s.time : `${s.date} ${s.time}`}</TD>
                    <TD className="font-mono text-xs">{en.date === date ? en.time : `${en.date} ${en.time}`}</TD>
                    <TD>{e.priority}</TD>
                    <TD className="text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <SecondaryDialog id={e.id} channelId={channel.id} assets={assetOpts} initial={{ category: e.category, label: e.label, assetId: e.assetId ?? "", startDate: s.date, startTime: s.time, endDate: en.date, endTime: en.time, layer: String(e.layer), priority: String(e.priority), isActive: e.isActive }} />
                          <DeleteSecondary id={e.id} label={e.label} />
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
