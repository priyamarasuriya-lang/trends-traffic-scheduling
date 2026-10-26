import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Attachments } from "@/components/attachments";
import { agreementBookings } from "@/lib/agreements/service";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, isoDate } from "@/lib/time";
import { AgreementDialog, AgreementStatusButtons } from "../client";
import { agreementOptions } from "../options";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await prisma.agreement.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: a ? `Agreement ${a.number}` : "Agreement" };
}

export default async function AgreementDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("agreement.view");
  const { id } = await params;
  const a = await prisma.agreement.findUnique({ where: { id }, include: { agency: true, client: true, deal: true, licenses: { include: { asset: true } } } });
  if (!a || a.deletedAt) notFound();
  const currency = (await getSetting("billing.currency")).code;
  const b = await agreementBookings(a);
  const canManage = user.permissions.has("agreement.manage");
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`${a.number} · ${a.title}`}
        description={`${a.agency?.name ?? a.client?.name} · ${fmtDate(a.startDate)} – ${fmtDate(a.endDate)} · ${a.type.replace("_", " ").toLowerCase()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {canManage && a.status === "DRAFT" && (
              <>
                <AgreementDialog {...await agreementOptions()} agreement={{ id: a.id, title: a.title, type: a.type, agencyId: a.agencyId ?? "", clientId: a.clientId ?? "", dealId: a.dealId ?? "", startDate: isoDate(a.startDate), endDate: isoDate(a.endDate), value: a.value?.toFixed(2) ?? "", terms: a.terms ?? "" }} />
              </>
            )}
            {canManage && <AgreementStatusButtons id={a.id} status={a.status} />}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Agreed value", a.value ? formatMoney(a.value, currency) : "—"],
              ["Booked (approved ROs)", formatMoney(b.booked, currency)],
              ["Pending ROs", formatMoney(b.pending, currency)],
              ["Utilisation", b.utilisationPct != null ? `${b.utilisationPct.toFixed(1)}%` : "—"],
            ].map(([k, v]) => (
              <Card key={k} className="p-3">
                <p className="text-xs text-muted">{k}</p>
                <p className="mt-1 text-lg font-semibold tabular">{v}</p>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader title="Bookings under this agreement" description={a.deal ? `Release orders from deal ${a.deal.number}.` : "Release orders for this party that overlap the agreement period."} />
            {b.ros.length === 0 ? (
              <CardBody className="text-sm text-muted">No release orders yet.</CardBody>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>RO</TH>
                    <TH>Campaign</TH>
                    <TH>Client</TH>
                    <TH>Period</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Net</TH>
                  </tr>
                </THead>
                <TBody>
                  {b.ros.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/release-orders/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                          {r.number}
                        </Link>
                      </TD>
                      <TD>{r.campaignName}</TD>
                      <TD className="text-xs">{r.client.name}</TD>
                      <TD className="text-xs">
                        {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="text-right tabular">{formatMoney(D(r.grossAmount).sub(r.discountAmount), r.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Terms" />
            <CardBody className="whitespace-pre-line text-sm">{a.terms || <span className="text-muted">No terms recorded.</span>}</CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-1.5 text-sm">
              <p>
                <span className="text-muted">Signed:</span> {a.signedAt ? fmtDateTime(a.signedAt) : "not yet"}
              </p>
              {a.deal && (
                <p>
                  <span className="text-muted">Deal:</span>{" "}
                  <Link href={`/deals/${a.deal.id}`} className="text-primary hover:underline">
                    {a.deal.number}
                  </Link>
                </p>
              )}
              {a.licenses.length > 0 && (
                <div>
                  <p className="text-muted">Content licences:</p>
                  {a.licenses.map((l) => (
                    <Link key={l.id} href={`/media/item/${l.assetId}`} className="block text-primary hover:underline">
                      {l.asset.title}
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Attachments entityType="AGREEMENT" entityId={a.id} canUpload={canManage} />
        </div>
      </div>
    </div>
  );
}
