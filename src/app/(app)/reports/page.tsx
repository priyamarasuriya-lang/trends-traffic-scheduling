import Link from "next/link";
import { CalendarClock, Megaphone, Receipt, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { channelContext } from "@/lib/context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { GroupedBars, StackedBars } from "@/components/charts";
import { REPORTS } from "@/lib/reports/definitions";
import { D, formatMoney } from "@/lib/money";
import { addDaysStr, broadcastDayRange, todayIn } from "@/lib/time";

export const metadata = { title: "Reports & Analytics" };

const ICONS = { Scheduling: CalendarClock, Advertising: Megaphone, Financial: Receipt, Rights: ShieldCheck } as const;

export default async function Reports() {
  const user = await requirePage("report.view");
  const fin = user.permissions.has("report.financial");
  const visible = REPORTS.filter((r) => user.permissions.has(r.permission));
  const groups = (["Scheduling", "Advertising", "Financial", "Rights"] as const).map((g) => ({ g, items: visible.filter((r) => r.group === g) })).filter((x) => x.items.length);
  const ctx = await channelContext(user);
  const currency = (await getSetting("billing.currency")).code;

  // Analytics — every number below is queried from live data.
  const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  const [invoices, payments, roStatus, inv] = await Promise.all([
    fin ? prisma.invoice.findMany({ where: { issueDate: { gte: sixMonthsAgo }, status: { notIn: ["DRAFT", "CANCELLED"] }, currency }, select: { issueDate: true, total: true, clientId: true, client: { select: { name: true } } } }) : [],
    fin ? prisma.payment.findMany({ where: { receivedAt: { gte: sixMonthsAgo }, status: "CONFIRMED", currency }, select: { receivedAt: true, amount: true } }) : [],
    prisma.releaseOrder.groupBy({ by: ["status"], _count: true }),
    Promise.all(
      ctx.channels.map(async (c) => {
        const today = todayIn(c.timezone);
        const from = broadcastDayRange(c, today).start;
        const to = broadcastDayRange(c, addDaysStr(today, 6)).end;
        const g = await prisma.advertisingInventory.groupBy({ by: ["status"], where: { break: { channelId: c.id, startAt: { gte: from, lt: to } } }, _count: true });
        return { channel: c.code, ...Object.fromEntries(g.map((x) => [x.status, x._count])) };
      }),
    ),
  ]);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth() + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en", { month: "short" }) };
  });
  const mk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const revenue = months.map((m) => ({
    month: m.label,
    Invoiced: Number(invoices.filter((i) => i.issueDate && mk(i.issueDate) === m.key).reduce((s, i) => s.add(i.total), D(0)).toFixed(2)),
    Collected: Number(payments.filter((p) => mk(p.receivedAt) === m.key).reduce((s, p) => s.add(p.amount), D(0)).toFixed(2)),
  }));
  const byClient = new Map<string, { name: string; total: ReturnType<typeof D> }>();
  for (const i of invoices) byClient.set(i.clientId, { name: i.client.name, total: (byClient.get(i.clientId)?.total ?? D(0)).add(i.total) });
  const topClients = [...byClient.values()].sort((a, b) => b.total.cmp(a.total)).slice(0, 5);

  return (
    <div>
      <PageHeader title="Reports & analytics" description="Every report runs on live data with date, channel and other filters, and exports to CSV or Excel or prints." />
      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Inventory, next 7 days" description="Positions by status per channel." />
          <CardBody>{inv.length ? <StackedBars data={inv} xKey="channel" keys={["AVAILABLE", "RESERVED", "BOOKED", "SCHEDULED", "AIRED", "UNAVAILABLE"]} height={220} /> : <p className="text-sm text-muted">No channels.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Release orders by status" />
          <CardBody className="space-y-1.5 text-sm">
            {roStatus.length === 0 && <p className="text-muted">No release orders yet.</p>}
            {roStatus.map((s) => (
              <Link key={s.status} href={`/release-orders?status=${s.status}`} className="flex justify-between rounded px-2 py-1 hover:bg-surface-2">
                <span>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span>
                <span className="tabular font-medium">{s._count}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
        {fin && (
          <>
            <Card className="xl:col-span-2">
              <CardHeader title={`Invoiced vs collected (${currency})`} description="Last six months, by issue date and payment date." />
              <CardBody>
                <GroupedBars data={revenue} keys={["Invoiced", "Collected"]} xKey="month" height={220} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top clients by invoiced value" description="Last six months." />
              <CardBody className="space-y-1.5 text-sm">
                {topClients.length === 0 && <p className="text-muted">No invoices in this period.</p>}
                {topClients.map((c) => (
                  <div key={c.name} className="flex justify-between">
                    <span className="truncate">{c.name}</span>
                    <span className="tabular">{formatMoney(c.total, currency)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(({ g, items }) => {
          const Icon = ICONS[g];
          return (
            <Card key={g}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-primary" /> {g} reports
                  </span>
                }
              />
              <div className="divide-y divide-border">
                {items.map((r) => (
                  <Link key={r.key} href={`/reports/${r.key}`} className="block px-4 py-2.5 hover:bg-surface-2">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted">{r.description}</p>
                  </Link>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
