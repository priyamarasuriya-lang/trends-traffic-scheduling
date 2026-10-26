import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { ReverseAllocation } from "../../invoices/client";
import { AllocateForm } from "../client";

export const metadata = { title: "Payment" };

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("billing.view");
  const { id } = await params;
  const pay = await prisma.payment.findUnique({ where: { id }, include: { client: true, agency: true, allocations: { include: { invoice: true }, orderBy: { createdAt: "asc" } } } });
  if (!pay) notFound();
  const allocated = pay.allocations.reduce((s, a) => s.add(a.amount), D(0));
  const left = D(pay.amount).sub(allocated);
  const open =
    left.gt(0) && pay.status === "CONFIRMED"
      ? await prisma.invoice.findMany({
          where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, currency: pay.currency, ...(pay.agencyId ? { agencyId: pay.agencyId } : { clientId: pay.clientId!, agencyId: null }) },
          orderBy: { dueDate: "asc" },
        })
      : [];
  const cur = pay.currency;
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Payment ${pay.reference}`}
        description={`${pay.agency ? `${pay.agency.name} (agency)` : pay.client?.name} · ${pay.method.replace("_", " ").toLowerCase()} · received ${fmtDate(pay.receivedAt)}`}
        actions={user.permissions.has("payment.record") && left.gt(0) && open.length > 0 && <AllocateForm paymentId={pay.id} left={left.toFixed(2)} currency={cur} invoices={open.map((i) => ({ id: i.id, number: i.number!, balance: i.balance.toFixed(2) }))} />}
      />
      {pay.isSimulated && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This payment came from the <strong>simulated payment gateway</strong> (test mode). No real money was moved.
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat k="Amount" v={formatMoney(pay.amount, cur)} />
        <Stat k="Allocated" v={formatMoney(allocated, cur)} />
        <Stat k="Unallocated" v={formatMoney(left, cur)} />
        <Card className="p-3">
          <p className="text-xs text-muted">Status</p>
          <div className="mt-1">
            <StatusBadge status={pay.status} />
          </div>
          {pay.gateway && <p className="mt-1 text-[11px] text-muted">via {pay.gateway}</p>}
        </Card>
      </div>
      <Card>
        <CardHeader title="Allocations" />
        {pay.allocations.length === 0 ? (
          <CardBody className="text-sm text-muted">Not allocated to any invoice yet.</CardBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Allocated on</TH>
                <TH>Invoice status</TH>
                <TH className="text-right">Amount</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {pay.allocations.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/invoices/${a.invoiceId}`} className="font-mono text-primary hover:underline">
                      {a.invoice.number}
                    </Link>
                  </TD>
                  <TD className="text-xs">{fmtDateTime(a.createdAt)}</TD>
                  <TD>
                    <StatusBadge status={a.invoice.status} />
                  </TD>
                  <TD className="text-right tabular">{formatMoney(a.amount, cur)}</TD>
                  <TD className="text-right">{user.permissions.has("payment.record") && <ReverseAllocation id={a.id} label={formatMoney(a.amount, cur)} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {pay.notes && (
        <Card className="mt-4">
          <CardBody className="text-sm">
            <Badge>Notes</Badge> <span className="whitespace-pre-line">{pay.notes}</span>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted">{k}</p>
      <p className="mt-1 text-lg font-semibold tabular">{v}</p>
    </Card>
  );
}
