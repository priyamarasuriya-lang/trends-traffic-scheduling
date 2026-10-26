import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect, Pagination } from "@/components/layout/filters";
import { CATEGORY_META } from "@/lib/categories";
import { formatDuration, fmtDate } from "@/lib/time";
import { sp } from "@/lib/utils";

const PAGE = 30;
const DESCRIPTIONS: Record<string, string> = {
  PROGRAM: "Program episodes and live shows. Program start times are checked by the scheduling rules.",
  MOVIE: "Feature films with their licences and play limits.",
  COMMERCIAL: "Advertiser commercials. Brand and product category drive separation and competitor rules.",
  PROMO: "Channel promos, grouped into promo campaigns for auto-fill.",
  TIMER: "Countdown and clock elements played between segments.",
  SLIDE: "Still slides and static graphics.",
  COMING_UP: "“Coming up” and “next” bumpers.",
  FILLER: "Short fillers used to close gaps in the schedule.",
  NEW_MEDIA: "Digital and new-media content items.",
  SECONDARY: "Graphics used as secondary events (logos, tickers, lower thirds).",
};

export async function MediaLibrary({ user, category, params }: { user: CurrentUser; category?: string; params: Record<string, string | string[] | undefined> }) {
  const q = sp(params.q);
  const status = sp(params.status);
  const cat = category ?? sp(params.category);
  const page = Math.max(1, Number(sp(params.page) ?? 1));
  const where = {
    deletedAt: null,
    ...(cat ? { category: cat as never } : {}),
    ...(status ? { approvalStatus: status as never } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { assetCode: { contains: q, mode: "insensitive" as const } }, { brand: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total, counts, pending] = await Promise.all([
    prisma.mediaAsset.findMany({ where, include: { advertiser: { select: { name: true } }, licenses: { where: { deletedAt: null }, select: { validTo: true } }, _count: { select: { events: { where: { startAt: { gt: new Date() }, status: "PLANNED" } } } } }, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.mediaAsset.count({ where }),
    category ? Promise.resolve([]) : prisma.mediaAsset.groupBy({ by: ["category"], where: { deletedAt: null }, _count: true }),
    prisma.mediaAsset.count({ where: { deletedAt: null, approvalStatus: "PENDING", ...(cat ? { category: cat as never } : {}) } }),
  ]);
  const meta = cat ? CATEGORY_META[cat] : null;
  const now = Date.now();
  return (
    <div>
      <PageHeader
        title={meta && category ? meta.plural : "Media library"}
        description={meta && category ? DESCRIPTIONS[cat!] : "Every asset that can be scheduled: programs, movies, commercials, promos and interstitials. New assets and new versions need approval before they can air."}
        actions={
          user.permissions.has("media.manage") && (
            <Button asChild>
              <Link href={`/media/new${cat ? `?category=${cat}` : ""}`}>
                <Plus /> New {meta ? meta.label.toLowerCase() : "asset"}
              </Link>
            </Button>
          )
        }
      />
      {!category && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(CATEGORY_META).map(([k, m]) => (
            <Link key={k} href={`/media/${m.slug}`} className="rounded-md px-3 py-2.5 text-sm font-semibold transition-transform hover:-translate-y-0.5" style={{ background: m.color, color: m.text }}>
              {m.plural}
              <span className="block text-xs font-normal opacity-80">{counts.find((c) => c.category === k)?._count ?? 0} assets</span>
            </Link>
          ))}
        </div>
      )}
      {pending > 0 && (
        <p className="mb-3 text-sm">
          <Link href={`?status=PENDING`} className="text-amber-700 hover:underline dark:text-amber-300">
            {pending} asset(s) waiting for approval
          </Link>
        </p>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="Title, house number or brand" />
          {!category && <FilterSelect param="category" label="Category" options={Object.entries(CATEGORY_META).map(([k, m]) => ({ value: k, label: m.plural }))} />}
          <FilterSelect param="status" label="Approval" options={["PENDING", "APPROVED", "REJECTED", "RETIRED", "DRAFT"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No assets found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>House no.</TH>
                <TH>Title</TH>
                {!category && <TH>Category</TH>}
                <TH className="text-right">Duration</TH>
                <TH>Version</TH>
                <TH>Approval</TH>
                <TH>Licence</TH>
                <TH className="text-right">Upcoming</TH>
                <TH className="text-right">Plays</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((a) => {
                const m = CATEGORY_META[a.category];
                const end = a.licenses.map((l) => l.validTo.getTime()).sort((x, y) => y - x)[0];
                return (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.assetCode}</TD>
                    <TD>
                      <Link href={`/media/item/${a.id}`} className="text-primary hover:underline">
                        {a.title}
                      </Link>
                      {(a.brand || a.advertiser) && <p className="text-[11px] text-muted">{[a.advertiser?.name, a.brand].filter(Boolean).join(" · ")}</p>}
                    </TD>
                    {!category && (
                      <TD>
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: m.color, color: m.text }}>
                          {m.label}
                        </span>
                      </TD>
                    )}
                    <TD className="text-right font-mono text-xs">{formatDuration(a.durationSec)}</TD>
                    <TD className="text-xs">v{a.version}</TD>
                    <TD>
                      <StatusBadge status={a.approvalStatus} />
                    </TD>
                    <TD className="text-xs">{end ? <span className={end < now ? "text-danger" : end < now + 30 * 86400000 ? "text-amber-600" : ""}>{end < now ? "Expired " : "Until "}{fmtDate(new Date(end))}</span> : <span className="text-muted">—</span>}</TD>
                    <TD className="text-right tabular">{a._count.events}</TD>
                    <TD className="text-right tabular">
                      {a.playCount}
                      {a.maxPlays ? <span className="text-muted">/{a.maxPlays}</span> : ""}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} />
      </Card>
    </div>
  );
}
