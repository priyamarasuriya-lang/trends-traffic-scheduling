import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ROForm } from "@/components/sales/forms";
import { Attachments } from "@/components/attachments";
import { salesOptions } from "@/lib/sales/options";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, isoDate, fmtTz, broadcastDateOf } from "@/lib/time";
import { ROActions } from "./actions";

const FLOW = ["DRAFT", "SUBMITTED", "APPROVED", "SCHEDULED", "COMPLETED"];

export default async function ROPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePage("ro.view");
  const { id } = await params;
  const { edit } = await searchParams;
  const ro = await prisma.releaseOrder.findUnique({
    where: { id },
    include: {
      client: true,
      agency: true,
      deal: true,
      lines: { include: { channel: true, asset: true, inventory: { select: { status: true } }, events: { include: { channel: true }, orderBy: { startAt: "asc" } } } },
      approvals: { orderBy: { createdAt: "asc" } },
      revisions: { orderBy: { revision: "desc" } },
      invoices: true,
    },
  });
  if (!ro) notFound();
  const editable = ["DRAFT", "REJECTED"].includes(ro.status) && user.permissions.has("ro.manage");
  if (edit && editable) {
    return (
      <div>
        <PageHeader title={`Edit ${ro.number} (revision ${ro.revision})`} />
        <Card>
          <CardBody>
            <ROForm
              id={ro.id}
              opts={await salesOptions(user)}
              initial={{
                clientId: ro.clientId,
                agencyId: ro.agencyId ?? "",
                dealId: ro.dealId ?? "",
                campaignName: ro.campaignName,
                startDate: isoDate(ro.startDate),
                endDate: isoDate(ro.endDate),
                currency: ro.currency,
                commissionPct: ro.commissionPct.toString(),
                taxRatePct: ro.taxRatePct.toString(),
                clientRef: ro.clientRef ?? "",
                notes: ro.notes ?? "",
                lines: ro.lines.map((l) => ({ id: l.id, channelId: l.channelId, assetId: l.assetId ?? "", description: l.description, timeBand: l.timeBand, spotDurationSec: l.spotDurationSec, quantity: l.quantity, rate: l.rate.toFixed(2), discountPct: l.discountPct.toString(), startDate: isoDate(l.startDate), endDate: isoDate(l.endDate), maxPerDay: l.maxPerDay ?? "" })),
              }}
            />
          </CardBody>
        </Card>
      </div>
    );
  }
  const stages = (await getSetting("ro.approvalStages")).stages;
  const stage = stages[Math.min(ro.approvalStage, stages.length - 1)];
  const canApprove = ro.status === "SUBMITTED" && !!stage && user.permissions.has(stage.permission as never);
  const bookedUnplaced = ro.lines.reduce((n, l) => n + l.inventory.filter((i) => i.status === "BOOKED").length, 0);
  const billable = ro.lines.flatMap((l) => l.events).filter((e) => !e.invoiceLineItemId && e.status === "AIRED").length;
  const stepIdx = FLOW.indexOf(ro.status);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${ro.number} · ${ro.campaignName}`}
        description={
          <>
            {ro.client.name} · {ro.agency?.name ?? "Direct client"} · {fmtDate(ro.startDate)} – {fmtDate(ro.endDate)} · revision {ro.revision}
            {ro.deal && (
              <>
                {" "}
                · deal{" "}
                <Link className="text-primary hover:underline" href={`/deals/${ro.deal.id}`}>
                  {ro.deal.number}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <ROActions
            id={ro.id}
            status={ro.status}
            perms={{
              manage: user.permissions.has("ro.manage"),
              approve: canApprove,
              cancel: user.permissions.has("ro.cancel"),
              schedule: user.permissions.has("ro.schedule") && user.permissions.has("schedule.edit"),
              invoice: user.permissions.has("invoice.issue"),
            }}
            stageName={stage?.name}
            bookedUnplaced={bookedUnplaced}
            billable={billable}
          />
        }
      />
      <Card>
        <CardBody className="flex flex-wrap items-center gap-2 text-xs">
          {FLOW.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 ${i <= stepIdx && stepIdx >= 0 ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted"}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
              {i < FLOW.length - 1 && <span className="text-muted">→</span>}
            </span>
          ))}
          {["REJECTED", "CANCELLED"].includes(ro.status) && <StatusBadge status={ro.status} className="ml-2" />}
          {ro.status === "SUBMITTED" && stage && <span className="ml-auto text-muted">Awaiting: <b>{stage.name}</b> (stage {ro.approvalStage + 1} of {stages.length})</span>}
          {ro.cancelReason && <span className="ml-auto text-danger">Cancelled: {ro.cancelReason}</span>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lines and delivery" description="Booked = inventory reserved for this RO · Placed = spots on the schedule · Aired = confirmed as-run" />
        <Table>
          <THead>
            <tr>
              <TH>Channel</TH>
              <TH>Description</TH>
              <TH>Material</TH>
              <TH>Band</TH>
              <TH>Dates</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Booked</TH>
              <TH className="text-right">Placed</TH>
              <TH className="text-right">Aired</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Net</TH>
            </tr>
          </THead>
          <TBody>
            {ro.lines.map((l) => (
              <TR key={l.id}>
                <TD>{l.channel.code}</TD>
                <TD>{l.description}</TD>
                <TD className="text-xs">{l.asset ? `${l.asset.title} (${l.asset.durationSec}s)` : <Badge tone="amber">Material missing</Badge>}</TD>
                <TD>{l.timeBand ?? "ANY"}</TD>
                <TD className="text-xs">
                  {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                  {l.maxPerDay ? ` · max ${l.maxPerDay}/day` : ""}
                </TD>
                <TD className="text-right">{l.quantity}</TD>
                <TD className="text-right">{l.inventory.filter((i) => i.status !== "AVAILABLE").length}</TD>
                <TD className="text-right">{l.events.length}</TD>
                <TD className="text-right">{l.events.filter((e) => e.status === "AIRED").length}</TD>
                <TD className="text-right tabular">{formatMoney(l.rate, ro.currency)}</TD>
                <TD className="text-right tabular">{formatMoney(l.netAmount, ro.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <CardBody className="grid grid-cols-2 gap-2 border-t border-border text-sm sm:grid-cols-5">
          {[
            ["Gross", ro.grossAmount],
            ["Discount", ro.discountAmount],
            [`Agency commission (${ro.commissionPct.toString()}%)`, ro.commissionAmount],
            [`Tax (${ro.taxRatePct.toString()}%)`, ro.taxAmount],
            ["Total payable", ro.totalAmount],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <div className="text-xs text-muted">{String(k)}</div>
              <div className="font-semibold tabular">{formatMoney(v as never, ro.currency)}</div>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Scheduled spots" />
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Channel</TH>
                  <TH>Date</TH>
                  <TH>Time</TH>
                  <TH>Commercial</TH>
                  <TH>Status</TH>
                  <TH>Invoiced</TH>
                </tr>
              </THead>
              <TBody>
                {ro.lines
                  .flatMap((l) => l.events)
                  .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
                  .map((e) => (
                    <TR key={e.id}>
                      <TD>{e.channel.code}</TD>
                      <TD>
                        <Link className="text-primary hover:underline" href={`/scheduling?channels=${e.channelId}&date=${broadcastDateOf(e.channel, e.startAt)}`}>
                          {broadcastDateOf(e.channel, e.startAt)}
                        </Link>
                      </TD>
                      <TD className="font-mono text-xs">{fmtTz(e.startAt, e.channel.timezone, "HH:mm:ss")}</TD>
                      <TD>{e.title}</TD>
                      <TD>
                        <StatusBadge status={e.status} />
                      </TD>
                      <TD>{e.invoiceLineItemId ? "Yes" : ""}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Approval history" />
            <CardBody className="space-y-2 text-xs">
              {ro.approvals.length === 0 && <p className="text-muted">Not submitted yet.</p>}
              {ro.approvals.map((a) => (
                <div key={a.id} className="border-l-2 border-border pl-2">
                  <div>
                    <b>{a.action}</b> · {a.stageName} · rev {a.revision}
                  </div>
                  <div className="text-muted">
                    {a.userName ?? "system"} · {fmtDateTime(a.createdAt)}
                  </div>
                  {a.comment && <div>{a.comment}</div>}
                </div>
              ))}
            </CardBody>
          </Card>
          {ro.revisions.length > 0 && (
            <Card>
              <CardHeader title="Revisions" description="Snapshots taken before each amendment" />
              <CardBody className="space-y-1 text-xs">
                {ro.revisions.map((r) => (
                  <details key={r.id}>
                    <summary className="cursor-pointer">
                      Revision {r.revision} · {fmtDateTime(r.createdAt)} — {r.reason}
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-[10px]">{JSON.stringify(r.snapshot, null, 1)}</pre>
                  </details>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Invoices" />
            <CardBody className="space-y-1 text-sm">
              {ro.invoices.length === 0 && <p className="text-muted">Not invoiced yet.</p>}
              {ro.invoices.map((i) => (
                <Link key={i.id} href={`/invoices/${i.id}`} className="flex justify-between hover:text-primary">
                  <span className="font-mono">{i.number ?? "Draft"}</span>
                  <StatusBadge status={i.status} />
                </Link>
              ))}
            </CardBody>
          </Card>
          <Attachments entityType="RELEASE_ORDER" entityId={ro.id} canUpload={user.permissions.has("ro.manage")} />
        </div>
      </div>
    </div>
  );
}
