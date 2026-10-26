import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox } from "@/components/layout/filters";
import { fmtDate, isoDate } from "@/lib/time";
import { sp } from "@/lib/utils";
import { LicenseDialog, DeleteLicense } from "./client";

export const metadata = { title: "Content Rights" };

export default async function Rights({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("rights.view");
  const p = await searchParams;
  const q = sp(p.q);
  const view = sp(p.view) ?? "all";
  const assetId = sp(p.asset);
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400000);
  const where = {
    deletedAt: null,
    ...(assetId ? { assetId } : {}),
    ...(view === "expiring" ? { validTo: { gte: now, lte: soon } } : view === "expired" ? { validTo: { lt: now } } : view === "active" ? { validFrom: { lte: now }, validTo: { gte: now } } : view === "restricted" ? { restricted: true } : {}),
    ...(q ? { OR: [{ licensor: { contains: q, mode: "insensitive" as const } }, { contractRef: { contains: q, mode: "insensitive" as const } }, { asset: { title: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows, assets, channels, agreements] = await Promise.all([
    prisma.contentLicense.findMany({ where, include: { asset: true, agreement: { select: { id: true, number: true } } }, orderBy: { validTo: "asc" }, take: 300 }),
    prisma.mediaAsset.findMany({ where: { deletedAt: null, category: { in: ["PROGRAM", "MOVIE", "NEW_MEDIA", "FILLER", "SLIDE"] } }, orderBy: { title: "asc" }, select: { id: true, title: true, assetCode: true } }),
    prisma.channel.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    prisma.agreement.findMany({ where: { deletedAt: null }, orderBy: { number: "desc" }, select: { id: true, number: true, title: true } }),
  ]);
  const planned = await prisma.scheduleEvent.groupBy({ by: ["assetId"], where: { assetId: { in: rows.map((r) => r.assetId) }, status: "PLANNED", startAt: { gt: now } }, _count: true });
  const canManage = user.permissions.has("rights.manage");
  const opts = { assets: assets.map((a) => ({ value: a.id, label: `${a.assetCode} · ${a.title}` })), channels: channels.map((c) => ({ value: c.id, label: c.code })), agreements: agreements.map((a) => ({ value: a.id, label: `${a.number} · ${a.title}` })) };
  const views = [
    ["all", "All"],
    ["active", "In force"],
    ["expiring", "Expiring in 30 days"],
    ["expired", "Expired"],
    ["restricted", "Restricted"],
  ];
  return (
    <div>
      <PageHeader
        title="Content rights"
        description="Licences control when, where and how often programs and movies may air. The scheduler blocks airings outside a licence, beyond its play limit, or on channels it does not permit, and warns before expiry."
        actions={canManage && <LicenseDialog {...opts} initial={{ assetId: assetId ?? "", validFrom: isoDate(now), validTo: isoDate(new Date(now.getTime() + 365 * 86400000)), warnDaysBefore: "30" }} />}
      />
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {views.map(([k, l]) => (
          <Link key={k} href={`/rights?view=${k}`} className={`rounded-full border px-2.5 py-1 ${view === k ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-2"}`}>
            {l}
          </Link>
        ))}
      </div>
      <Card>
        <div className="border-b border-border p-3">
          <SearchBox placeholder="Title, licensor or contract" />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No licences match" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Asset</TH>
                <TH>Licensor</TH>
                <TH>Valid</TH>
                <TH>Channels / territories</TH>
                <TH className="text-right">Plays used</TH>
                <TH className="text-right">Upcoming</TH>
                <TH>Agreement</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {rows.map((l) => {
                const expired = l.validTo < now;
                const expiring = !expired && l.validTo.getTime() - now.getTime() < l.warnDaysBefore * 86400000;
                const up = planned.find((x) => x.assetId === l.assetId)?._count ?? 0;
                return (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/media/item/${l.assetId}`} className="text-primary hover:underline">
                        {l.asset.title}
                      </Link>
                      <p className="text-[11px] text-muted">{l.asset.assetCode}</p>
                    </TD>
                    <TD>
                      {l.licensor}
                      {l.contractRef && <p className="text-[11px] text-muted">{l.contractRef}</p>}
                    </TD>
                    <TD className="text-xs">
                      {fmtDate(l.validFrom)} – {fmtDate(l.validTo)}
                      <div className="mt-0.5 flex gap-1">
                        {expired && <Badge tone="red">expired</Badge>}
                        {expiring && <Badge tone="amber">expiring</Badge>}
                        {l.restricted && <Badge tone="red">restricted</Badge>}
                      </div>
                    </TD>
                    <TD className="text-xs">
                      {l.permittedChannelIds.length ? channels.filter((c) => l.permittedChannelIds.includes(c.id)).map((c) => c.code).join(", ") : "All channels"}
                      {l.territories.length > 0 && <p className="text-muted">{l.territories.join(", ")}</p>}
                    </TD>
                    <TD className="text-right tabular">
                      {l.asset.playCount}
                      {l.maxPlays ? <span className={l.asset.playCount >= l.maxPlays ? "text-danger" : "text-muted"}>/{l.maxPlays}</span> : ""}
                    </TD>
                    <TD className="text-right tabular">{up}</TD>
                    <TD className="text-xs">{l.agreement ? <Link href={`/agreements/${l.agreement.id}`} className="text-primary hover:underline">{l.agreement.number}</Link> : "—"}</TD>
                    <TD className="text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <LicenseDialog
                            id={l.id}
                            {...opts}
                            initial={{ assetId: l.assetId, licensor: l.licensor, contractRef: l.contractRef ?? "", agreementId: l.agreementId ?? "", territories: l.territories.join(", "), permittedChannelIds: l.permittedChannelIds, validFrom: isoDate(l.validFrom), validTo: isoDate(l.validTo), maxPlays: l.maxPlays?.toString() ?? "", restricted: l.restricted, warnDaysBefore: String(l.warnDaysBefore), notes: l.notes ?? "" }}
                          />
                          <DeleteLicense id={l.id} />
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
