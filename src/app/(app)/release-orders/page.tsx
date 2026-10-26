import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect, Pagination } from "@/components/layout/filters";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { sp } from "@/lib/utils";

export const metadata = { title: "Release Orders" };
const PAGE = 25;
const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "SCHEDULED", "COMPLETED", "REJECTED", "CANCELLED"];

export default async function ROList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("ro.view");
  const p = await searchParams;
  const q = sp(p.q);
  const status = sp(p.status);
  const clientId = sp(p.client);
  const page = Math.max(1, Number(sp(p.page) ?? 1));
  const where = {
    ...(status ? { status: status as never } : {}),
    ...(clientId ? { clientId } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { campaignName: { contains: q, mode: "insensitive" as const } }, { clientRef: { contains: q, mode: "insensitive" as const } }, { client: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows, total, clients, counts] = await Promise.all([
    prisma.releaseOrder.findMany({ where, include: { client: true, agency: true, lines: { select: { quantity: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.releaseOrder.count({ where }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.releaseOrder.groupBy({ by: ["status"], _count: true }),
  ]);
  return (
    <div>
      <PageHeader
        title="Release orders"
        description="Draft → Submitted → Approved → Scheduled → Completed. Approval books inventory; changes after approval need a controlled amendment."
        actions={
          user.permissions.has("ro.manage") && (
            <Button asChild>
              <Link href="/release-orders/new">
                <Plus /> New RO
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {STATUSES.map((s) => (
          <Link key={s} href={`/release-orders?status=${s}`} className={`rounded-full border px-2.5 py-1 ${status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-2"}`}>
            {s.charAt(0) + s.slice(1).toLowerCase()} · {counts.find((c) => c.status === s)?._count ?? 0}
          </Link>
        ))}
        {status && (
          <Link href="/release-orders" className="px-2 py-1 text-primary hover:underline">
            Clear
          </Link>
        )}
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="RO no., campaign, client or PO ref." />
          <FilterSelect param="client" label="Client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No release orders found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>RO</TH>
                <TH>Rev</TH>
                <TH>Campaign</TH>
                <TH>Client</TH>
                <TH>Agency</TH>
                <TH>Period</TH>
                <TH className="text-right">Spots</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/release-orders/${r.id}`} className="font-mono text-primary hover:underline">
                      {r.number}
                    </Link>
                  </TD>
                  <TD className="text-xs text-muted">r{r.revision}</TD>
                  <TD>{r.campaignName}</TD>
                  <TD>{r.client.name}</TD>
                  <TD>{r.agency?.name ?? "Direct"}</TD>
                  <TD className="text-xs">
                    {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                  </TD>
                  <TD className="text-right">{r.lines.reduce((n, l) => n + l.quantity, 0)}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-right tabular">{formatMoney(r.totalAmount, r.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} />
      </Card>
    </div>
  );
}
