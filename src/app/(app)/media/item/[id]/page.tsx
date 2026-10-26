import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Attachments } from "@/components/attachments";
import { CATEGORY_META } from "@/lib/categories";
import { formatDuration, fmtDate, fmtDateTime, fmtTz } from "@/lib/time";
import { ApprovalButtons } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await prisma.mediaAsset.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: a?.title ?? "Asset" };
}

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("media.view");
  const { id } = await params;
  const a = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      advertiser: true,
      program: true,
      movie: true,
      commercial: true,
      promo: { include: { campaign: true } },
      versions: { orderBy: { version: "desc" } },
      licenses: { where: { deletedAt: null }, orderBy: { validTo: "desc" } },
    },
  });
  if (!a) notFound();
  const [upcoming, history, channels] = await Promise.all([
    prisma.scheduleEvent.findMany({ where: { assetId: id, startAt: { gte: new Date() }, status: "PLANNED" }, include: { channel: true }, orderBy: { startAt: "asc" }, take: 20 }),
    prisma.contentPlayLog.findMany({ where: { assetId: id, status: { in: ["CONFIRMED", "MISSED"] } }, include: { channel: true }, orderBy: { plannedAt: "desc" }, take: 20 }),
    prisma.channel.findMany({ where: { id: { in: a.permittedChannelIds } }, select: { code: true } }),
  ]);
  const m = CATEGORY_META[a.category];
  const facts: [string, React.ReactNode][] = [
    ["House number", <span key="c" className="font-mono">{a.assetCode}</span>],
    ["Category", <span key="cat" className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: m.color, color: m.text }}>{m.label}</span>],
    ["Duration", <span key="d" className="font-mono">{formatDuration(a.durationSec)}</span>],
    ["Version", `v${a.version}`],
    ["File", a.fileRef ?? "—"],
    ["Language", a.language ?? "—"],
    ["Content category", a.contentCategory ?? "—"],
    ["Permitted channels", channels.length ? channels.map((c) => c.code).join(", ") : "All channels"],
    ["Rights owner", a.rightsOwner ?? "—"],
    ["Plays", `${a.playCount} confirmed${a.maxPlays ? ` of ${a.maxPlays} allowed` : ""}`],
  ];
  if (a.program) facts.push(["Program", [a.program.genre, a.program.season != null && `S${a.program.season}`, a.program.episode != null && `E${a.program.episode}`, a.program.contentRating, a.program.isLive && "LIVE"].filter(Boolean).join(" · ") || "—"]);
  if (a.movie) facts.push(["Movie", [a.movie.director, a.movie.releaseYear, a.movie.certificate].filter(Boolean).join(" · ") || "—"]);
  if (a.commercial || a.category === "COMMERCIAL") facts.push(["Advertiser", a.advertiser?.name ?? "—"], ["Brand / product", `${a.brand ?? "—"} / ${a.productCategory ?? "—"}`], ["Clock no.", a.commercial?.clockNumber ?? "—"]);
  if (a.promo) facts.push(["Promo campaign", a.promo.campaign?.name ?? "—"], ["Promotes", a.promo.promotedTitle ?? "—"]);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={a.title}
        description={
          <>
            <Link href={`/media/${m.slug}`} className="text-primary hover:underline">
              {m.plural}
            </Link>{" "}
            · {a.description ?? "No description"}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.approvalStatus} />
            {a.deletedAt && <Badge tone="red">deleted</Badge>}
            {!a.deletedAt && <ApprovalButtons id={a.id} status={a.approvalStatus} canApprove={user.permissions.has("media.approve")} canManage={user.permissions.has("media.manage")} />}
            {!a.deletedAt && user.permissions.has("media.manage") && (
              <Button size="sm" variant="secondary" asChild>
                <Link href={`/media/new?edit=${a.id}`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Upcoming airings" description="Planned schedule slots from now on (first 20)." />
            {upcoming.length === 0 ? (
              <CardBody className="text-sm text-muted">Not scheduled.</CardBody>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Channel</TH>
                    <TH>Local time</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {upcoming.map((e) => (
                    <TR key={e.id}>
                      <TD>{e.channel.code}</TD>
                      <TD className="font-mono text-xs">{fmtTz(e.startAt, e.channel.timezone, "yyyy-MM-dd HH:mm:ss")}</TD>
                      <TD className="text-right">
                        <Link className="text-xs text-primary hover:underline" href={`/scheduling?date=${fmtTz(e.startAt, e.channel.timezone, "yyyy-MM-dd")}&channels=${e.channelId}`}>
                          Open in schedule
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Play history" description="Confirmed and missed plays (as-run)." />
            {history.length === 0 ? (
              <CardBody className="text-sm text-muted">No confirmed plays yet.</CardBody>
            ) : (
              <Table>
                <TBody>
                  {history.map((h) => (
                    <TR key={h.id}>
                      <TD>{h.channel.code}</TD>
                      <TD className="font-mono text-xs">{fmtTz(h.airedAt ?? h.plannedAt, h.channel.timezone, "yyyy-MM-dd HH:mm:ss")}</TD>
                      <TD>
                        <StatusBadge status={h.status} />
                      </TD>
                      <TD className="text-xs text-muted">{h.source.toLowerCase().replace("_", " ")}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Licences" actions={<Link href={`/rights?asset=${a.id}`} className="text-xs text-primary hover:underline">Manage</Link>} />
            <CardBody className="space-y-2 text-sm">
              {a.licenses.length === 0 && <p className="text-muted">No licence recorded.</p>}
              {a.licenses.map((l) => (
                <div key={l.id}>
                  <p className="font-medium">{l.licensor}</p>
                  <p className="text-xs text-muted">
                    {fmtDate(l.validFrom)} – {fmtDate(l.validTo)}
                    {l.maxPlays ? ` · max ${l.maxPlays} plays` : ""}
                    {l.validTo < new Date() && <span className="ml-1 text-danger">expired</span>}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Versions" />
            <CardBody className="space-y-2 text-sm">
              {a.versions.map((v) => (
                <div key={v.id}>
                  <p>
                    <span className="font-medium">v{v.version}</span> · <span className="font-mono text-xs">{formatDuration(v.durationSec)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {fmtDateTime(v.createdAt)}
                    {v.notes ? ` · ${v.notes}` : ""}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Attachments entityType="MEDIA_ASSET" entityId={a.id} canUpload={user.permissions.has("media.manage")} />
        </div>
      </div>
    </div>
  );
}
