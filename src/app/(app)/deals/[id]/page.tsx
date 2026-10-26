import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DealForm } from "@/components/sales/forms";
import { salesOptions } from "@/lib/sales/options";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, isoDate } from "@/lib/time";
import { DealActions } from "./actions";

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePage("deal.view");
  const { id } = await params;
  const { edit } = await searchParams;
  const d = await prisma.deal.findUnique({ where: { id }, include: { client: true, agency: true, lines: { include: { channel: true } }, releaseOrders: true, agreements: true } });
  if (!d) notFound();
  const canManage = user.permissions.has("deal.manage");
  const editable = canManage && !["CLOSED", "CANCELLED"].includes(d.status);
  if (edit && editable) {
    return (
      <div>
        <PageHeader title={`Edit ${d.number}`} />
        <Card>
          <CardBody>
            <DealForm
              id={d.id}
              opts={await salesOptions(user)}
              initial={{
                clientId: d.clientId,
                agencyId: d.agencyId ?? "",
                campaignName: d.campaignName,
                startDate: isoDate(d.startDate),
                endDate: isoDate(d.endDate),
                currency: d.currency,
                discountPct: d.discountPct.toString(),
                commissionPct: d.commissionPct.toString(),
                taxRatePct: d.taxRatePct.toString(),
                notes: d.notes ?? "",
                lines: d.lines.map((l) => ({ channelId: l.channelId, product: l.product, timeBand: l.timeBand, spotDurationSec: l.spotDurationSec, quantity: l.quantity, rate: l.rate.toFixed(2), discountPct: l.discountPct.toString() })),
              }}
            />
          </CardBody>
        </Card>
      </div>
    );
  }
  const history = (d.approvalHistory as { at: string; by: string; from: string; to: string; comment?: string }[]) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={`${d.number} · ${d.campaignName}`} description={`${d.client.name} · ${d.agency?.name ?? "Direct client"} · ${fmtDate(d.startDate)} – ${fmtDate(d.endDate)}`} actions={<DealActions id={d.id} status={d.status} canManage={canManage} canCreateRo={user.permissions.has("ro.manage")} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Lines" actions={<StatusBadge status={d.status} />} />
          <Table>
            <THead>
              <tr>
                <TH>Channel</TH>
                <TH>Product</TH>
                <TH>Band</TH>
                <TH className="text-right">Dur</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Disc %</TH>
                <TH className="text-right">Net</TH>
              </tr>
            </THead>
            <TBody>
              {d.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.channel.code}</TD>
                  <TD>{l.product}</TD>
                  <TD>{l.timeBand}</TD>
                  <TD className="text-right">{l.spotDurationSec}s</TD>
                  <TD className="text-right">{l.quantity}</TD>
                  <TD className="text-right tabular">{formatMoney(l.rate, d.currency)}</TD>
                  <TD className="text-right">{l.discountPct.toString()}</TD>
                  <TD className="text-right tabular">{formatMoney(l.netAmount, d.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <CardBody className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
            {[
              ["Gross", d.grossAmount],
              ["Discount", d.discountAmount],
              ["Commission", d.commissionAmount],
              ["Tax", d.taxAmount],
              ["Total", d.totalAmount],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="text-xs text-muted">{String(k)}</div>
                <div className="font-semibold tabular">{formatMoney(v as never, d.currency)}</div>
              </div>
            ))}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Release orders" />
            <CardBody className="space-y-1 text-sm">
              {d.releaseOrders.length === 0 && <p className="text-muted">None yet.</p>}
              {d.releaseOrders.map((r) => (
                <Link key={r.id} href={`/release-orders/${r.id}`} className="flex justify-between hover:text-primary">
                  <span className="font-mono">{r.number}</span>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Agreements" />
            <CardBody className="space-y-1 text-sm">
              {d.agreements.length === 0 && <p className="text-muted">No agreement linked.</p>}
              {d.agreements.map((a) => (
                <Link key={a.id} href={`/agreements/${a.id}`} className="flex justify-between hover:text-primary">
                  <span>{a.number}</span>
                  <StatusBadge status={a.status} />
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Approval history" />
            <CardBody className="space-y-2 text-xs">
              {history.length === 0 && <p className="text-muted">No status changes yet.</p>}
              {history.map((h, i) => (
                <div key={i}>
                  <b>{h.from} → {h.to}</b> by {h.by} · {fmtDateTime(h.at)}
                  {h.comment && <p className="text-muted">{h.comment}</p>}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
