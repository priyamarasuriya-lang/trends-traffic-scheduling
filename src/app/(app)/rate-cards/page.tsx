import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { fmtDate, isoDate } from "@/lib/time";
import { RateCardDialog, TaxRateDialog } from "./client";

export const metadata = { title: "Rate Cards & Tax" };

export default async function RateCards() {
  const user = await requirePage("billing.view");
  const canManage = user.permissions.has("billing.manage");
  const [cards, taxes, channels, clients, currency, taxBase] = await Promise.all([
    prisma.rateCard.findMany({ include: { channel: true, client: true, items: { orderBy: [{ timeBand: "asc" }, { position: "asc" }] } }, orderBy: [{ isActive: "desc" }, { validFrom: "desc" }] }),
    prisma.taxRate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.channel.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    getSetting("billing.currency"),
    getSetting("billing.taxBase"),
  ]);
  const opts = { channels: channels.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), clients: clients.map((c) => ({ value: c.id, label: c.name })), currency: currency.code };
  return (
    <div>
      <PageHeader
        title="Rate cards & tax"
        description={`Rate cards price inventory positions and RO lines per time band, per base duration (pro-rated by spot length). Client-specific cards override the channel's standard card. Tax is calculated ${taxBase.mode === "AFTER_COMMISSION" ? "after" : "before"} agency commission (System Settings).`}
        actions={canManage && <RateCardDialog {...opts} />}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {cards.length === 0 && <EmptyState title="No rate cards" description="Without a rate card, new inventory is created with a zero card rate." />}
          {cards.map((c) => (
            <Card key={c.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {c.name}
                    <Badge tone={c.isActive ? "green" : "gray"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                    {c.client ? <Badge tone="violet">{c.client.name}</Badge> : <Badge>Standard</Badge>}
                  </span>
                }
                description={`${c.channel.code} · ${c.currency} · valid ${fmtDate(c.validFrom)} – ${c.validTo ? fmtDate(c.validTo) : "open-ended"}`}
                actions={
                  canManage && (
                    <RateCardDialog
                      {...opts}
                      card={{ id: c.id, name: c.name, channelId: c.channelId, clientId: c.clientId, currency: c.currency, validFrom: isoDate(c.validFrom), validTo: c.validTo ? isoDate(c.validTo) : "", isActive: c.isActive, items: c.items.map((i) => ({ timeBand: i.timeBand, position: i.position, baseDurationSec: String(i.baseDurationSec), rate: i.rate.toFixed(2) })) }}
                    />
                  )
                }
              />
              <Table>
                <THead>
                  <tr>
                    <TH>Time band</TH>
                    <TH>Position</TH>
                    <TH className="text-right">Base duration</TH>
                    <TH className="text-right">Rate</TH>
                    <TH className="text-right">Per second</TH>
                  </tr>
                </THead>
                <TBody>
                  {c.items.map((i) => (
                    <TR key={i.id}>
                      <TD>{i.timeBand}</TD>
                      <TD>{i.position}</TD>
                      <TD className="text-right">{i.baseDurationSec}s</TD>
                      <TD className="text-right tabular">{formatMoney(i.rate, c.currency)}</TD>
                      <TD className="text-right tabular text-muted">{formatMoney(i.rate.div(i.baseDurationSec), c.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader title="Tax rates" description="The default rate is pre-filled on new deals, ROs and invoices." actions={canManage && <TaxRateDialog />} />
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH className="text-right">Rate</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {taxes.map((t) => (
                <TR key={t.id}>
                  <TD>
                    {t.name}
                    <div className="mt-0.5 flex gap-1">
                      {t.isDefault && <Badge tone="teal">default</Badge>}
                      {!t.isActive && <Badge>inactive</Badge>}
                      {t.jurisdiction && <span className="text-[11px] text-muted">{t.jurisdiction}</span>}
                    </div>
                  </TD>
                  <TD className="text-right tabular">{t.ratePct.toString()}%</TD>
                  <TD className="text-right">{canManage && <TaxRateDialog tax={{ id: t.id, name: t.name, ratePct: t.ratePct.toString(), jurisdiction: t.jurisdiction ?? "", isDefault: t.isDefault, isActive: t.isActive }} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
