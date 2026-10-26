import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect, Pagination } from "@/components/layout/filters";
import { D, formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { sp } from "@/lib/utils";
import { BillingTabs } from "../invoices/tabs";
import { RecordPaymentButton } from "./client";

export const metadata = { title: "Payments" };
const PAGE = 25;

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("billing.view");
  const p = await searchParams;
  const q = sp(p.q);
  const method = sp(p.method);
  const unallocated = sp(p.unallocated) === "1";
  const page = Math.max(1, Number(sp(p.page) ?? 1));
  const where = {
    ...(method ? { method } : {}),
    ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" as const } }, { client: { name: { contains: q, mode: "insensitive" as const } } }, { agency: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [all, clients, agencies, currency] = await Promise.all([
    prisma.payment.findMany({ where, include: { client: true, agency: true, allocations: { select: { amount: true } } }, orderBy: { receivedAt: "desc" } }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.agency.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    getSetting("billing.currency"),
  ]);
  const withLeft = all.map((r) => ({ ...r, left: D(r.amount).sub(r.allocations.reduce((s, a) => s.add(a.amount), D(0))) }));
  const filtered = unallocated ? withLeft.filter((r) => r.left.gt(0) && r.status === "CONFIRMED") : withLeft;
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const payers = [...agencies.map((a) => ({ value: `agency:${a.id}`, label: `${a.name} (agency)` })), ...clients.map((c) => ({ value: `client:${c.id}`, label: c.name }))];
  return (
    <div>
      <PageHeader
        title="Invoices & payments"
        description="Payments received by bank transfer, cheque, cash or online. Each payment can be split across invoices of the same payer; anything left stays unallocated."
        actions={user.permissions.has("payment.record") && <RecordPaymentButton payers={payers} currency={currency.code} />}
      />
      <BillingTabs active="payments" />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox placeholder="Reference, client or agency" />
          <FilterSelect
            param="method"
            label="Method"
            options={["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "ONLINE"].map((m) => ({ value: m, label: m.replace("_", " ").toLowerCase() }))}
          />
          <Link href={unallocated ? "/payments" : "/payments?unallocated=1"} className={`rounded-full border px-2.5 py-1 text-xs ${unallocated ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
            With unallocated balance
          </Link>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No payments found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Received</TH>
                <TH>Reference</TH>
                <TH>Payer</TH>
                <TH>Method</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Unallocated</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">{fmtDate(r.receivedAt)}</TD>
                  <TD>
                    <Link href={`/payments/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                      {r.reference}
                    </Link>
                    {r.isSimulated && (
                      <Badge tone="amber" className="ml-1.5">
                        simulated
                      </Badge>
                    )}
                  </TD>
                  <TD>{r.agency?.name ?? r.client?.name}</TD>
                  <TD className="text-xs">{r.method.replace("_", " ").toLowerCase()}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-right tabular">{formatMoney(r.amount, r.currency)}</TD>
                  <TD className={`text-right tabular ${r.left.gt(0) ? "font-medium text-amber-600" : "text-muted"}`}>{formatMoney(r.left, r.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={filtered.length} />
      </Card>
    </div>
  );
}
