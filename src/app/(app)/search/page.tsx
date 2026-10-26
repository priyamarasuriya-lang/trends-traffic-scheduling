import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage, type CurrentUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox } from "@/components/layout/filters";
import { formatMoney } from "@/lib/money";
import { sp } from "@/lib/utils";

export const metadata = { title: "Search" };
const TAKE = 8;
type Hit = { href: string; title: string; sub: string; status?: string };

/** Each section runs only if the user holds its permission; channel-scoped records are filtered to the user's channels. */
async function sections(u: CurrentUser, q: string) {
  const has = (p: Parameters<CurrentUser["permissions"]["has"]>[0]) => u.permissions.has(p);
  const ci = { contains: q, mode: "insensitive" as const };
  const chanScope = u.allChannels ? {} : { lines: { some: { channelId: { in: u.channelIds } } } };
  const out: { title: string; hits: Hit[] }[] = [];
  const tasks: Promise<void>[] = [];
  const add = (title: string, p: Promise<Hit[]>) => tasks.push(p.then((hits) => void (hits.length && out.push({ title, hits }))));

  if (has("ro.view"))
    add(
      "Release orders",
      prisma.releaseOrder
        .findMany({ where: { ...chanScope, OR: [{ number: ci }, { campaignName: ci }, { clientRef: ci }, { client: { name: ci } }, { agency: { name: ci } }] }, include: { client: true }, orderBy: { createdAt: "desc" }, take: TAKE })
        .then((r) => r.map((x) => ({ href: `/release-orders/${x.id}`, title: `${x.number} · ${x.campaignName}`, sub: `${x.client.name} · ${formatMoney(x.totalAmount, x.currency)}`, status: x.status }))),
    );
  if (has("deal.view"))
    add(
      "Deals",
      prisma.deal
        .findMany({ where: { deletedAt: null, ...chanScope, OR: [{ number: ci }, { campaignName: ci }, { client: { name: ci } }] }, include: { client: true }, orderBy: { createdAt: "desc" }, take: TAKE })
        .then((r) => r.map((x) => ({ href: `/deals/${x.id}`, title: `${x.number} · ${x.campaignName}`, sub: x.client.name, status: x.status }))),
    );
  if (has("billing.view")) {
    add(
      "Invoices",
      prisma.invoice
        .findMany({ where: { OR: [{ number: ci }, { client: { name: ci } }, { agency: { name: ci } }, { releaseOrder: { number: ci } }] }, include: { client: true }, orderBy: { createdAt: "desc" }, take: TAKE })
        .then((r) => r.map((x) => ({ href: `/invoices/${x.id}`, title: x.number ?? "Draft invoice", sub: `${x.client.name} · ${formatMoney(x.total, x.currency)}`, status: x.status }))),
    );
    add(
      "Payments",
      prisma.payment
        .findMany({ where: { OR: [{ reference: ci }, { client: { name: ci } }, { agency: { name: ci } }] }, include: { client: true, agency: true }, orderBy: { receivedAt: "desc" }, take: TAKE })
        .then((r) => r.map((x) => ({ href: `/payments/${x.id}`, title: x.reference, sub: `${x.agency?.name ?? x.client?.name ?? ""} · ${formatMoney(x.amount, x.currency)}`, status: x.status }))),
    );
  }
  if (has("media.view"))
    add(
      "Media",
      prisma.mediaAsset
        .findMany({ where: { deletedAt: null, OR: [{ assetCode: ci }, { title: ci }] }, orderBy: { title: "asc" }, take: TAKE })
        .then((r) => r.map((x) => ({ href: `/media/item/${x.id}`, title: `${x.assetCode} · ${x.title}`, sub: `${x.category.toLowerCase()} · ${x.durationSec}s`, status: x.approvalStatus }))),
    );
  if (has("agency.view")) {
    add(
      "Clients",
      prisma.client.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }, { email: ci }] }, orderBy: { name: "asc" }, take: TAKE }).then((r) => r.map((x) => ({ href: `/agencies?tab=clients&q=${encodeURIComponent(x.name)}`, title: x.name, sub: x.code, status: x.status }))),
    );
    add(
      "Agencies",
      prisma.agency.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }, { email: ci }] }, orderBy: { name: "asc" }, take: TAKE }).then((r) => r.map((x) => ({ href: `/agencies?q=${encodeURIComponent(x.name)}`, title: x.name, sub: x.code, status: x.status }))),
    );
  }
  if (has("agreement.view"))
    add(
      "Agreements",
      prisma.agreement.findMany({ where: { deletedAt: null, OR: [{ number: ci }, { title: ci }] }, orderBy: { createdAt: "desc" }, take: TAKE }).then((r) => r.map((x) => ({ href: `/agreements/${x.id}`, title: `${x.number} · ${x.title}`, sub: "", status: x.status }))),
    );
  if (has("user.view"))
    add(
      "Users",
      prisma.user.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { email: ci }] }, orderBy: { name: "asc" }, take: TAKE }).then((r) => r.map((x) => ({ href: `/users?q=${encodeURIComponent(x.email)}`, title: x.name, sub: x.email, status: x.status }))),
    );
  await Promise.all(tasks);
  const order = ["Release orders", "Deals", "Invoices", "Payments", "Media", "Clients", "Agencies", "Agreements", "Users"];
  return out.sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title));
}

export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await requirePage();
  const q = (sp((await searchParams).q) ?? "").trim().slice(0, 100);
  const results = q.length >= 2 ? await sections(u, q) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="Search" description="Searches the records you have permission to see: numbers, campaigns, references, names and asset codes." />
      <SearchBox placeholder="Search…" />
      {q.length < 2 ? (
        <EmptyState title="Type at least two characters" />
      ) : results.length === 0 ? (
        <EmptyState title={`No results for “${q}”`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {results.map((s) => (
            <Card key={s.title}>
              <CardHeader title={`${s.title} (${s.hits.length}${s.hits.length === TAKE ? "+" : ""})`} />
              <ul className="divide-y divide-border">
                {s.hits.map((h) => (
                  <li key={h.href + h.title}>
                    <Link href={h.href} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{h.title}</span>
                        {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
                      </span>
                      {h.status && <StatusBadge status={h.status} />}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
