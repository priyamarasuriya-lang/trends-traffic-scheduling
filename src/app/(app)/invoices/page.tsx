import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect, Pagination } from "@/components/layout/filters";
import { formatMoney, sum } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { sp } from "@/lib/utils";
import { BillingTabs } from "./tabs";
import { RefreshOverdueButton } from "./client";

export const metadata = { title: "Invoices" };
const PAGE = 25;
const STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "OVERDUE", "PAID", "CREDITED", "CANCELLED"];
const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export default async function InvoiceList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("billing.view");
  const p = await searchParams;
  const q = sp(p.q);
  const status = sp(p.status);
  const open = sp(p.open) === "1";
  const clientId = sp(p.client);
  const agencyId = sp(p.agency);
  const page = Math.max(1, Number(sp(p.page) ?? 1));
  const currency = (await getSetting("billing.currency")).code;
  const where = {
    ...(status ? { status: status as never } : open ? { status: { in: OPEN as never[] } } : {}),
    ...(clientId ? { clientId } : {}),
    ...(agencyId ? { agencyId } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { client: { name: { contains: q, mode: "insensitive" as const } } }, { agency: { name: { contains: q, mode: "insensitive" as const } } }, { releaseOrder: { number: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [rows, total, clients, agencies, counts, openInv, collected] = await Promise.all([
    prisma.invoice.findMany({ where, include: { client: true, agency: true, releaseOrder: { select: { id: true, number: true } } }, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.invoice.count({ where }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.agency.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.invoice.groupBy({ by: ["status"], _count: true }),
    prisma.invoice.findMany({ where: { status: { in: OPEN as never[] }, currency }, select: { balance: true, status: true, dueDate: true } }),
    prisma.payment.aggregate({ where: { status: "CONFIRMED", currency, receivedAt: { gte: monthStart } }, _sum: { amount: true } }),
  ]);
  const outstanding = sum(openInv.map((i) => i.balance));
  const overdue = sum(openInv.filter((i) => i.status === "OVERDUE").map((i) => i.balance));
  const canIssue = user.permissions.has("invoice.issue");
  return (
    <div>
      <PageHeader
        title="Invoices & payments"
        description="Invoices are created from aired spots of release orders (or manually), issued with a number and due date, and settled by payments and credit notes."
        actions={
          canIssue && (
            <>
              <RefreshOverdueButton />
              <Button asChild>
                <Link href="/invoices/new">
                  <Plus /> Manual invoice
                </Link>
              </Button>
            </>
          )
        }
      />
      <BillingTabs active="invoices" />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/invoices?open=1">
          <Card className="p-3 hover:border-primary/40">
            <p className="text-xs text-muted">Outstanding ({currency})</p>
            <p className="mt-1 text-xl font-semibold tabular">{formatMoney(outstanding, currency)}</p>
            <p className="text-[11px] text-muted">{openInv.length} open invoice(s)</p>
          </Card>
        </Link>
        <Link href="/invoices?status=OVERDUE">
          <Card className="p-3 hover:border-primary/40">
            <p className="text-xs text-muted">Overdue</p>
            <p className={`mt-1 text-xl font-semibold tabular ${overdue.gt(0) ? "text-danger" : ""}`}>{formatMoney(overdue, currency)}</p>
            <p className="text-[11px] text-muted">{openInv.filter((i) => i.status === "OVERDUE").length} invoice(s) past due</p>
          </Card>
        </Link>
        <Link href="/payments">
          <Card className="p-3 hover:border-primary/40">
            <p className="text-xs text-muted">Collected this month</p>
            <p className="mt-1 text-xl font-semibold tabular">{formatMoney(collected._sum.amount ?? 0, currency)}</p>
            <p className="text-[11px] text-muted">confirmed payments since {fmtDate(monthStart)}</p>
          </Card>
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        <Link href="/invoices?open=1" className={`rounded-full border px-2.5 py-1 ${open && !status ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-2"}`}>
          Open
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/invoices?status=${s}`} className={`rounded-full border px-2.5 py-1 ${status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-2"}`}>
            {s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")} · {counts.find((c) => c.status === s)?._count ?? 0}
          </Link>
        ))}
        {(status || open) && (
          <Link href="/invoices" className="px-2 py-1 text-primary hover:underline">
            Clear
          </Link>
        )}
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="Invoice no., RO, client or agency" />
          <FilterSelect param="client" label="Client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect param="agency" label="Agency" options={agencies.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No invoices found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Bill to</TH>
                <TH>Release order</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Balance</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/invoices/${r.id}`} className="font-mono text-primary hover:underline">
                      {r.number ?? "Draft"}
                    </Link>
                    {r.isManual && (
                      <Badge className="ml-1.5" tone="gray">
                        manual
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {r.agency ? (
                      <>
                        {r.agency.name}
                        <p className="text-[11px] text-muted">for {r.client.name}</p>
                      </>
                    ) : (
                      r.client.name
                    )}
                  </TD>
                  <TD>
                    {r.releaseOrder ? (
                      <Link href={`/release-orders/${r.releaseOrder.id}`} className="font-mono text-xs hover:underline">
                        {r.releaseOrder.number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="text-xs">{fmtDate(r.issueDate)}</TD>
                  <TD className="text-xs">{fmtDate(r.dueDate)}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-right tabular">{formatMoney(r.total, r.currency)}</TD>
                  <TD className="text-right tabular font-medium">{formatMoney(r.balance, r.currency)}</TD>
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
