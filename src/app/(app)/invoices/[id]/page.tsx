import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Attachments } from "@/components/attachments";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { InvoiceActions, ReverseAllocation } from "../client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const inv = await prisma.invoice.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: inv?.number ? `Invoice ${inv.number}` : "Draft invoice" };
}

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("billing.view");
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      agency: true,
      releaseOrder: { select: { id: true, number: true, campaignName: true } },
      lines: { include: { events: { select: { id: true, startAt: true, channel: { select: { code: true, timezone: true } } }, orderBy: { startAt: "asc" } } } },
      allocations: { include: { payment: true }, orderBy: { createdAt: "asc" } },
      creditNotes: { orderBy: { issuedAt: "asc" } },
      transactions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!inv) notFound();
  const [company, layout] = await Promise.all([getSetting("company.profile"), getSetting("billing.invoiceLayout")]);
  const payer = inv.agency ? `agency:${inv.agency.id}` : `client:${inv.client.id}`;
  const cur = inv.currency;
  const spots = inv.lines.reduce((n, l) => n + l.events.length, 0);
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={inv.number ? `Invoice ${inv.number}` : "Draft invoice"}
        description={
          <>
            {inv.agency ? `${inv.agency.name} for ${inv.client.name}` : inv.client.name}
            {inv.releaseOrder && (
              <>
                {" · "}
                <Link href={`/release-orders/${inv.releaseOrder.id}`} className="text-primary hover:underline">
                  {inv.releaseOrder.number}
                </Link>{" "}
                {inv.releaseOrder.campaignName}
              </>
            )}
            {inv.isManual && " · manual invoice"}
          </>
        }
        actions={
          <>
            {inv.status === "DRAFT" && inv.isManual && user.permissions.has("invoice.issue") && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/invoices/new?edit=${inv.id}`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            <InvoiceActions
              inv={{ id: inv.id, number: inv.number, status: inv.status, balance: inv.balance.toFixed(2), currency: cur, payer, payerLabel: inv.agency?.name ?? inv.client.name, email: inv.agency?.email ?? inv.client.email, hasPayments: D(inv.amountPaid).gt(0) || D(inv.creditedTotal).gt(0) }}
              perms={{ issue: user.permissions.has("invoice.issue"), pay: user.permissions.has("payment.record"), credit: user.permissions.has("creditnote.issue") }}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="print:border-0 print:shadow-none">
            <CardBody className="space-y-5">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-primary">{company.name}</p>
                  <p className="whitespace-pre-line text-xs text-muted">{[company.address, company.email, company.phone, company.taxId && `Tax ID ${company.taxId}`].filter(Boolean).join("\n")}</p>
                </div>
                <div className="text-right text-sm">
                  <div className="mb-1">
                    <StatusBadge status={inv.status} />
                  </div>
                  <p>
                    <span className="text-muted">Issued</span> {fmtDate(inv.issueDate)}
                  </p>
                  <p>
                    <span className="text-muted">Due</span> {fmtDate(inv.dueDate)}
                  </p>
                  {inv.periodStart && (
                    <p className="text-xs text-muted">
                      Period {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-sm">
                <p className="text-xs font-medium uppercase text-muted">Bill to</p>
                <p className="font-medium">{inv.agency ? `${inv.agency.name} (agency)` : inv.client.name}</p>
                {inv.agency && <p className="text-muted">On behalf of {inv.client.name}</p>}
                <p className="whitespace-pre-line text-muted">{(inv.agency ?? inv.client).billingAddress}</p>
              </div>
              <Table>
                <THead>
                  <tr>
                    <TH>Description</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Unit</TH>
                    <TH className="text-right">Disc.</TH>
                    <TH className="text-right">Comm.</TH>
                    <TH className="text-right">Tax</TH>
                    <TH className="text-right">Line total</TH>
                  </tr>
                </THead>
                <TBody>
                  {inv.lines.map((l) => (
                    <TR key={l.id}>
                      <TD>{l.description}</TD>
                      <TD className="text-right tabular">{D(l.quantity).toDecimalPlaces(2).toString()}</TD>
                      <TD className="text-right tabular">{formatMoney(l.unitPrice, cur)}</TD>
                      <TD className="text-right tabular text-xs">{D(l.discountPct).gt(0) ? `${l.discountPct}% · ${formatMoney(l.discountAmount, cur)}` : "—"}</TD>
                      <TD className="text-right tabular text-xs">{D(l.commissionPct).gt(0) ? `${l.commissionPct}% · ${formatMoney(l.commissionAmount, cur)}` : "—"}</TD>
                      <TD className="text-right tabular text-xs">{D(l.taxRatePct).gt(0) ? `${l.taxRatePct}% · ${formatMoney(l.taxAmount, cur)}` : "—"}</TD>
                      <TD className="text-right tabular font-medium">{formatMoney(l.totalAmount, cur)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="ml-auto w-full max-w-xs space-y-1 text-sm tabular">
                <Row k="Gross" v={formatMoney(inv.subtotal, cur)} />
                <Row k="Discount" v={`−${formatMoney(inv.discountTotal, cur)}`} />
                {(layout.showCommission || D(inv.commissionTotal).gt(0)) && <Row k="Agency commission" v={`−${formatMoney(inv.commissionTotal, cur)}`} />}
                <Row k="Tax" v={formatMoney(inv.taxTotal, cur)} />
                <Row k="Total" v={formatMoney(inv.total, cur)} strong />
                <Row k="Paid" v={`−${formatMoney(inv.amountPaid, cur)}`} />
                {D(inv.creditedTotal).gt(0) && <Row k="Credited" v={`−${formatMoney(inv.creditedTotal, cur)}`} />}
                <Row k="Balance due" v={formatMoney(inv.balance, cur)} strong />
              </div>
              {inv.notes && <p className="whitespace-pre-line border-t border-border pt-3 text-xs text-muted">{inv.notes}</p>}
              {layout.footer && <p className="text-xs text-muted">{layout.footer}</p>}
            </CardBody>
          </Card>

          {spots > 0 && (
            <Card className="print:hidden">
              <CardHeader title={`Spots on this invoice (${spots})`} description="Each spot can be on one invoice only. Cancelling or deleting the invoice releases them." />
              <div className="max-h-72 overflow-auto">
                <Table>
                  <THead>
                    <tr>
                      <TH>Channel</TH>
                      <TH>Aired at (channel time)</TH>
                      <TH>Line</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {inv.lines.flatMap((l) =>
                      l.events.map((e) => (
                        <TR key={e.id}>
                          <TD>{e.channel.code}</TD>
                          <TD className="font-mono text-xs">{new Intl.DateTimeFormat("en-GB", { timeZone: e.channel.timezone, dateStyle: "medium", timeStyle: "medium" }).format(e.startAt)}</TD>
                          <TD className="text-xs text-muted">{l.description}</TD>
                        </TR>
                      )),
                    )}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 print:hidden">
          <Card>
            <CardHeader title="Payments" />
            <CardBody className="space-y-2 text-sm">
              {inv.allocations.length === 0 && <p className="text-muted">No payments allocated.</p>}
              {inv.allocations.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/payments/${a.paymentId}`} className="text-primary hover:underline">
                      {a.payment.reference}
                    </Link>
                    {a.payment.isSimulated && (
                      <Badge tone="amber" className="ml-1">
                        simulated
                      </Badge>
                    )}
                    <p className="text-[11px] text-muted">
                      {a.payment.method.replace("_", " ").toLowerCase()} · {fmtDate(a.payment.receivedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-medium">{formatMoney(a.amount, cur)}</p>
                    {user.permissions.has("payment.record") && <ReverseAllocation id={a.id} label={formatMoney(a.amount, cur)} />}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          {inv.creditNotes.length > 0 && (
            <Card>
              <CardHeader title="Credit notes" />
              <CardBody className="space-y-2 text-sm">
                {inv.creditNotes.map((c) => (
                  <div key={c.id} className="flex justify-between gap-2">
                    <div>
                      <p className="font-mono">{c.number}</p>
                      <p className="text-[11px] text-muted">
                        {fmtDate(c.issuedAt)} · {c.reason}
                      </p>
                    </div>
                    <p className="tabular">{formatMoney(c.amount, cur)}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Ledger" description="Append-only record of every change to the balance." />
            <CardBody className="space-y-1.5 text-xs">
              {inv.transactions.length === 0 && <p className="text-muted">Nothing yet. Issuing the invoice opens the ledger.</p>}
              {inv.transactions.map((t) => (
                <div key={t.id} className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.type.replace(/_/g, " ").toLowerCase()}</p>
                    <p className="text-muted">
                      {fmtDateTime(t.createdAt)}
                      {t.reference && ` · ${t.reference}`}
                    </p>
                  </div>
                  <div className="text-right tabular">
                    <p>{formatMoney(t.amount, cur)}</p>
                    <p className="text-muted">bal. {formatMoney(t.balanceAfter, cur)}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          {inv.paymentToken && D(inv.balance).gt(0) && (
            <Card>
              <CardHeader title="Online payment link" description="Share with the payer. The invoice is marked paid only when the payment provider confirms it." />
              <CardBody>
                <Link href={`/pay/${inv.paymentToken}`} className="break-all text-xs text-primary hover:underline" target="_blank">
                  /pay/{inv.paymentToken.slice(0, 12)}…
                </Link>
              </CardBody>
            </Card>
          )}
          <Attachments entityType="INVOICE" entityId={inv.id} canUpload={user.permissions.has("invoice.issue")} />
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-border pt-1 font-semibold" : "text-muted"}`}>
      <span>{k}</span>
      <span className={strong ? "" : "text-fg"}>{v}</span>
    </div>
  );
}
