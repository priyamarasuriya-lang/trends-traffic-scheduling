import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { formatDuration, fmtDate, isoDate, todayIn } from "@/lib/time";
import { CampaignDialog, AutofillPanel, AssignPromo } from "./client";

export const metadata = { title: "Promos" };

const mm = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

export default async function Promos() {
  const user = await requirePage("promo.view");
  const ctx = await channelContext(user);
  const [campaigns, promos] = await Promise.all([
    prisma.promoCampaign.findMany({ include: { promos: { include: { asset: true } } }, orderBy: [{ isActive: "desc" }, { endDate: "desc" }] }),
    prisma.promo.findMany({ where: { asset: { deletedAt: null } }, include: { asset: true, campaign: true }, orderBy: { asset: { title: "asc" } } }),
  ]);
  const stats = await Promise.all(
    campaigns.map(async (c) => {
      const ids = c.promos.map((p) => p.assetId);
      const [planned, aired] = await Promise.all([
        prisma.scheduleEvent.count({ where: { assetId: { in: ids }, status: "PLANNED", startAt: { gte: c.startDate, lte: c.endDate } } }),
        prisma.scheduleEvent.count({ where: { assetId: { in: ids }, status: "AIRED", startAt: { gte: c.startDate, lte: c.endDate } } }),
      ]);
      return { id: c.id, planned, aired };
    }),
  );
  const canManage = user.permissions.has("promo.manage");
  const channelOpts = ctx.channels.map((c) => ({ value: c.id, label: c.code }));
  const now = new Date();
  return (
    <div>
      <PageHeader
        title="Promos"
        description="Promo campaigns set dates, priority, rotation, time windows and play limits. Auto-fill proposes promo placements in free gaps of the schedule; nothing is added until you approve it."
        actions={canManage && <CampaignDialog channels={channelOpts} />}
      />
      {user.permissions.has("promo.autofill") && ctx.channels.length > 0 && (
        <AutofillPanel channels={ctx.channels.map((c) => ({ value: c.id, label: c.code, tz: c.timezone }))} defaultChannel={(ctx.selected ?? ctx.channels[0]).id} defaultDate={todayIn((ctx.selected ?? ctx.channels[0]).timezone)} campaigns={campaigns.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))} canEdit={user.permissions.has("schedule.edit")} />
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {campaigns.length === 0 && <EmptyState title="No promo campaigns" />}
          {campaigns.map((c) => {
            const s = stats.find((x) => x.id === c.id)!;
            const total = s.planned + s.aired;
            const live = c.isActive && c.startDate <= now && c.endDate >= now;
            const under = c.minPlays != null && total < c.minPlays;
            return (
              <Card key={c.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {c.name}
                      <Badge tone={live ? "green" : c.isActive ? "blue" : "gray"}>{live ? "Running" : c.isActive ? (c.startDate > now ? "Scheduled" : "Ended") : "Inactive"}</Badge>
                      <Badge tone={c.priority === "CRITICAL" ? "red" : c.priority === "HIGH" ? "amber" : "gray"}>{c.priority.toLowerCase()}</Badge>
                    </span>
                  }
                  description={`${fmtDate(c.startDate)} – ${fmtDate(c.endDate)} · ${c.rotation.toLowerCase()} rotation · ${c.channelIds.length ? ctx.channels.filter((x) => c.channelIds.includes(x.id)).map((x) => x.code).join(", ") : "all channels"}${c.dayStartMinute != null ? ` · ${mm(c.dayStartMinute)}–${mm(c.dayEndMinute)}` : ""}`}
                  actions={
                    canManage && (
                      <CampaignDialog
                        channels={channelOpts}
                        campaign={{ id: c.id, name: c.name, startDate: isoDate(c.startDate), endDate: isoDate(c.endDate), priority: c.priority, rotation: c.rotation, channelIds: c.channelIds, windowStart: mm(c.dayStartMinute), windowEnd: mm(c.dayEndMinute), minPlays: c.minPlays?.toString() ?? "", maxPlays: c.maxPlays?.toString() ?? "", maxPerDay: c.maxPerDay?.toString() ?? "", minGapSec: c.minGapSec?.toString() ?? "", isActive: c.isActive }}
                      />
                    )
                  }
                />
                <CardBody className="grid gap-4 md:grid-cols-[1fr_14rem]">
                  <div className="space-y-1 text-sm">
                    {c.promos.length === 0 && <p className="text-muted">No promos in this campaign yet. Add them from the list on the right.</p>}
                    {c.promos.map((p) => (
                      <div key={p.id} className="flex justify-between gap-2">
                        <Link href={`/media/item/${p.assetId}`} className="text-primary hover:underline">
                          {p.asset.title}
                        </Link>
                        <span className="font-mono text-xs text-muted">{formatDuration(p.asset.durationSec)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-md bg-surface-2 p-3 text-xs">
                    <p>
                      <span className="text-lg font-semibold tabular">{total}</span> plays in period
                    </p>
                    <p className="text-muted">
                      {s.aired} aired · {s.planned} planned
                    </p>
                    <p className="mt-1">
                      Target {c.minPlays ?? 0}–{c.maxPlays ?? "∞"}
                      {c.maxPerDay ? ` · max ${c.maxPerDay}/day` : ""}
                      {c.minGapSec ? ` · ${c.minGapSec}s apart` : ""}
                    </p>
                    {under && <p className="mt-1 font-medium text-amber-600">Under-delivering by {c.minPlays! - total}</p>}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit">
          <CardHeader title="Promo assets" description="Create promos in the media library; assign them to a campaign here." />
          <Table>
            <THead>
              <tr>
                <TH>Promo</TH>
                <TH>Campaign</TH>
              </tr>
            </THead>
            <TBody>
              {promos.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/media/item/${p.assetId}`} className="text-primary hover:underline">
                      {p.asset.title}
                    </Link>
                    <p className="text-[11px] text-muted">
                      {p.asset.assetCode} · {formatDuration(p.asset.durationSec)} · {p.asset.approvalStatus.toLowerCase()}
                    </p>
                  </TD>
                  <TD>{canManage ? <AssignPromo assetId={p.assetId} value={p.campaignId ?? ""} campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))} /> : (p.campaign?.name ?? "—")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
