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

export const metadata = { title: "Deals & Bookings" };
const PAGE = 25;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("deal.view");
  const p = await searchParams;
  const q = sp(p.q);
  const status = sp(p.status);
  const page = Math.max(1, Number(sp(p.page) ?? 1));
  const where = {
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { campaignName: { contains: q, mode: "insensitive" as const } }, { client: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.deal.findMany({ where, include: { client: true, agency: true, _count: { select: { releaseOrders: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.deal.count({ where }),
  ]);
  return (
    <div>
      <PageHeader
        title="Deals & bookings"
        description="Negotiated advertising deals. Confirmed deals convert into release orders."
        actions={
          user.permissions.has("deal.manage") && (
            <Button asChild>
              <Link href="/deals/new">
                <Plus /> New deal
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="Deal no., campaign or client" />
          <FilterSelect param="status" label="Status" options={["DRAFT", "NEGOTIATION", "CONFIRMED", "CLOSED", "CANCELLED"].map((s) => ({ value: s, label: s }))} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No deals found" description={q || status ? "Try clearing the filters." : "Create the first deal to start booking."} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Deal</TH>
                <TH>Campaign</TH>
                <TH>Client</TH>
                <TH>Agency</TH>
                <TH>Period</TH>
                <TH>Status</TH>
                <TH className="text-right">ROs</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Link href={`/deals/${d.id}`} className="font-mono text-primary hover:underline">
                      {d.number}
                    </Link>
                  </TD>
                  <TD>{d.campaignName}</TD>
                  <TD>{d.client.name}</TD>
                  <TD>{d.agency?.name ?? "Direct"}</TD>
                  <TD className="text-xs">
                    {fmtDate(d.startDate)} – {fmtDate(d.endDate)}
                  </TD>
                  <TD>
                    <StatusBadge status={d.status} />
                  </TD>
                  <TD className="text-right">{d._count.releaseOrders}</TD>
                  <TD className="text-right tabular">{formatMoney(d.totalAmount, d.currency)}</TD>
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
