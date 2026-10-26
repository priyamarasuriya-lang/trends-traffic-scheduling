import Link from "next/link";
import { AlertTriangle, CalendarClock, Boxes, FileCheck2, FileSignature, Receipt, Wallet, ShieldAlert, Megaphone, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { StackedBars, GroupedBars } from "@/components/charts";
import { PageHeader } from "@/components/layout/page-header";
import { broadcastDayRange, todayIn, addDaysStr, fmtTz, fmtDateTime, broadcastDateOf } from "@/lib/time";
import { formatMoney, D } from "@/lib/money";
import { validateWindow } from "@/lib/scheduling/service";
import { CATEGORY_META } from "@/lib/categories";

export const metadata = { title: "Dashboard" };

function Kpi({ href, icon: Icon, label, value, sub, tone = "default" }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "warn" | "danger" }) {
  const toneCls = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : "text-primary";
  return (
    <Link href={href} className="group rounded-lg border border-border bg-surface p-4 transition hover:border-primary/50 hover:shadow-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <Icon className={`size-4 ${toneCls}`} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Link>
  );
}

export default async function Dashboard() {
  const user = await requirePage("dashboard.view");
  const { channels, selected, channelIds } = await channelContext(user);
  const scope = selected ? [selected.id] : channelIds;
  const scopeChannels = channels.filter((c) => scope.includes(c.id));
  const tz = scopeChannels[0]?.timezone ?? "UTC";
  const today = todayIn(tz);
  const ref = scopeChannels[0] ?? { timezone: tz, broadcastDayStartHour: 6 };
  const { start: dayStart, end: dayEnd } = broadcastDayRange(ref, today);
  const weekEnd = broadcastDayRange(ref, addDaysStr(today, 6)).end;
  const now = new Date();
  const chFilter = { channelId: { in: scope } };

  const [eventsWeek, spotsToday, invAvail, invTotalWeek, pendingRos, activeAgreements, openInvoices, draftInvoices, licenses, upcoming, activity, invByDay, recentInvoices] = await Promise.all([
    prisma.scheduleEvent.count({ where: { ...chFilter, startAt: { gte: dayStart, lt: weekEnd }, status: { not: "CANCELLED" } } }),
    prisma.scheduleEvent.count({ where: { ...chFilter, startAt: { gte: dayStart, lt: dayEnd }, roLineItemId: { not: null } } }),
    prisma.advertisingInventory.count({ where: { status: "AVAILABLE", break: { ...chFilter, startAt: { gte: now, lt: weekEnd } } } }),
    prisma.advertisingInventory.count({ where: { break: { ...chFilter, startAt: { gte: now, lt: weekEnd } } } }),
    prisma.releaseOrder.findMany({ where: { status: "SUBMITTED" }, include: { client: true }, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.agreement.count({ where: { status: "ACTIVE", endDate: { gte: now }, deletedAt: null } }),
    prisma.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _count: true, _sum: { balance: true } }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.contentLicense.findMany({ where: { deletedAt: null, validTo: { lt: new Date(now.getTime() + 30 * 86400000) } }, include: { asset: true }, orderBy: { validTo: "asc" }, take: 6 }),
    prisma.scheduleEvent.findMany({ where: { ...chFilter, startAt: { gte: now }, eventType: { in: ["PROGRAM", "MOVIE"] } }, include: { channel: true }, orderBy: { startAt: "asc" }, take: 8 }),
    user.permissions.has("audit.view") ? prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    prisma.advertisingInventory.findMany({ where: { break: { ...chFilter, startAt: { gte: dayStart, lt: weekEnd } } }, select: { status: true, break: { select: { startAt: true, channel: { select: { timezone: true, broadcastDayStartHour: true } } } } } }),
    user.permissions.has("billing.view") ? prisma.invoice.findMany({ where: { issueDate: { gte: new Date(now.getTime() - 180 * 86400000) }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { issueDate: true, total: true, amountPaid: true } }) : Promise.resolve([]),
  ]);
  const overdue = await prisma.invoice.aggregate({ where: { status: "OVERDUE" }, _count: true, _sum: { balance: true } });

  // Rule check for today and tomorrow across the channels in scope.
  const conflicts: { channel: string; message: string; severity: string; date: string }[] = [];
  for (const ch of scopeChannels.slice(0, 4)) {
    for (const d of [today, addDaysStr(today, 1)]) {
      const r = broadcastDayRange(ch, d);
      for (const v of await validateWindow(prisma, ch.id, r.start, r.end)) {
        if (v.range && new Date(v.range.start) >= r.start && new Date(v.range.start) < r.end) conflicts.push({ channel: ch.code, message: v.message, severity: v.severity, date: d });
      }
    }
  }
  const errors = conflicts.filter((c) => c.severity === "ERROR");

  // Inventory chart: positions per broadcast day by status.
  const byDay = new Map<string, Record<string, number | string>>();
  for (let i = 0; i < 7; i++) byDay.set(addDaysStr(today, i), { day: addDaysStr(today, i).slice(5) });
  for (const i of invByDay) {
    const d = broadcastDateOf(i.break.channel, i.break.startAt);
    const row = byDay.get(d);
    if (row) row[i.status] = ((row[i.status] as number) ?? 0) + 1;
  }
  const invStatuses = [...new Set(invByDay.map((i) => i.status))];
  for (const row of byDay.values()) for (const st of invStatuses) row[st] = (row[st] as number) ?? 0;

  const months = new Map<string, { month: string; Invoiced: number; Collected: number }>();
  for (const inv of recentInvoices) {
    const k = inv.issueDate!.toISOString().slice(0, 7);
    const m = months.get(k) ?? { month: k, Invoiced: 0, Collected: 0 };
    m.Invoiced += Number(D(inv.total).toFixed(2));
    m.Collected += Number(D(inv.amountPaid).toFixed(2));
    months.set(k, m);
  }
  const categoryCounts = await prisma.mediaAsset.groupBy({ by: ["category"], where: { deletedAt: null }, _count: true });
  const catCount = new Map(categoryCounts.map((c) => [c.category, c._count]));
  const availPct = invTotalWeek ? Math.round((invAvail / invTotalWeek) * 100) : 0;
  const currency = "USD";

  return (
    <div className="space-y-5">
      <PageHeader title="Operations dashboard" description={`${selected ? selected.name : `${scopeChannels.length} channel(s)`} · broadcast day ${today} · all figures from live data`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <Kpi href="/scheduling" icon={CalendarClock} label="Scheduled events (7 days)" value={eventsWeek.toLocaleString()} />
        <Kpi href="/scheduling" icon={Megaphone} label="Today's advertising bookings" value={spotsToday} sub="Commercial spots on today's schedule" />
        <Kpi href="/inventory" icon={Boxes} label="Available inventory (7 days)" value={invAvail} sub={`${availPct}% of ${invTotalWeek} positions`} tone={availPct < 15 ? "warn" : "default"} />
        <Kpi href="/release-orders?status=SUBMITTED" icon={FileCheck2} label="Pending release orders" value={pendingRos.length} sub="Awaiting approval" tone={pendingRos.length ? "warn" : "default"} />
        <Kpi href="/agreements?status=ACTIVE" icon={FileSignature} label="Active agreements" value={activeAgreements} />
        <Kpi href="/invoices?status=DRAFT" icon={Receipt} label="Pending invoices" value={draftInvoices} sub="Drafts not yet issued" />
        <Kpi href="/invoices?open=1" icon={Wallet} label="Outstanding payments" value={formatMoney(openInvoices._sum.balance ?? 0, currency)} sub={`${openInvoices._count} open invoice(s)`} />
        <Kpi href="/invoices?status=OVERDUE" icon={AlertTriangle} label="Overdue" value={formatMoney(overdue._sum.balance ?? 0, currency)} sub={`${overdue._count} invoice(s)`} tone={overdue._count ? "danger" : "default"} />
        <Kpi href="/rights" icon={ShieldAlert} label="Licence warnings" value={licenses.length} sub="Expiring within 30 days or expired" tone={licenses.length ? "warn" : "default"} />
        <Kpi href="/reports/schedule-conflicts" icon={AlertTriangle} label="Schedule conflicts" value={errors.length} sub={`${conflicts.length - errors.length} warning(s) · today & tomorrow`} tone={errors.length ? "danger" : "default"} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-9">
        {["PROMO", "TIMER", "NEW_MEDIA", "SLIDE", "MOVIE", "PROGRAM", "COMING_UP", "FILLER", "COMMERCIAL"].map((c) => {
          const m = CATEGORY_META[c];
          return (
            <Link key={c} href={c === "PROMO" ? "/promos" : `/media/${m.slug}`} className="flex aspect-[4/3] flex-col justify-between rounded-sm p-2.5 transition hover:brightness-105" style={{ background: m.color, color: m.text }}>
              <span className="text-sm font-semibold lowercase">{m.plural}</span>
              <span className="text-right text-xl font-light tabular">{catCount.get(c as never) ?? 0}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Advertising inventory — next 7 broadcast days" description="Positions by status" actions={<Link href="/inventory" className="text-xs text-primary hover:underline">Open inventory</Link>} />
          <CardBody>{invByDay.length ? <StackedBars data={[...byDay.values()]} keys={invStatuses} xKey="day" /> : <p className="py-10 text-center text-sm text-muted">No breaks have been created for this period.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Schedule conflict alerts" description="Rules re-checked on today and tomorrow" actions={<Link href="/reports/schedule-conflicts" className="text-xs text-primary hover:underline">Report</Link>} />
          <CardBody className="max-h-72 space-y-2 overflow-y-auto">
            {conflicts.length === 0 && <p className="text-sm text-muted">No rule violations. ✓</p>}
            {conflicts.slice(0, 12).map((c, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <StatusBadge status={c.severity} />
                <span>
                  <b>{c.channel}</b> {c.date}: {c.message}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming programs" actions={<Link href="/scheduling" className="text-xs text-primary hover:underline">Timeline</Link>} />
          <CardBody className="space-y-2">
            {upcoming.length === 0 && <p className="text-sm text-muted">Nothing scheduled.</p>}
            {upcoming.map((e) => (
              <Link key={e.id} href={`/scheduling?channel=${e.channelId}&date=${broadcastDateOf(e.channel, e.startAt)}`} className="flex items-center justify-between gap-2 text-sm hover:text-primary">
                <span className="truncate">
                  <span className="mr-2 font-mono text-xs text-muted">{fmtTz(e.startAt, e.channel.timezone, "dd MMM HH:mm")}</span>
                  {e.title}
                </span>
                <span className="text-xs text-muted">{e.channel.code}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Release orders awaiting approval" actions={<Link href="/release-orders?status=SUBMITTED" className="text-xs text-primary hover:underline">All</Link>} />
          <CardBody className="space-y-2">
            {pendingRos.length === 0 && <p className="text-sm text-muted">Nothing awaiting approval.</p>}
            {pendingRos.map((r) => (
              <Link key={r.id} href={`/release-orders/${r.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-primary">
                <span className="truncate">
                  <span className="mr-2 font-mono text-xs">{r.number}</span>
                  {r.client.name}
                </span>
                <span className="text-xs tabular">{formatMoney(r.totalAmount, r.currency)}</span>
              </Link>
            ))}
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-xs font-medium text-muted">Licence warnings</p>
              {licenses.length === 0 && <p className="text-xs text-muted">None.</p>}
              {licenses.map((l) => (
                <Link key={l.id} href={`/media/item/${l.assetId}`} className="flex justify-between text-xs hover:text-primary">
                  <span className="truncate">{l.asset.title}</span>
                  <span className={l.validTo < now ? "text-danger" : "text-warning"}>{l.validTo < now ? "expired" : "expires"} {l.validTo.toISOString().slice(0, 10)}</span>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card>
          {user.permissions.has("billing.view") ? (
            <>
              <CardHeader title="Invoiced vs collected" description="Last 6 months" actions={<Link href="/reports/sales-summary" className="text-xs text-primary hover:underline">Report</Link>} />
              <CardBody>{months.size ? <GroupedBars data={[...months.values()].sort((a, b) => a.month.localeCompare(b.month))} keys={["Invoiced", "Collected"]} xKey="month" height={220} /> : <p className="text-sm text-muted">No invoices yet.</p>}</CardBody>
            </>
          ) : (
            <CardHeader title="Billing" description="Not available for your role." />
          )}
        </Card>
      </div>

      {activity.length > 0 && (
        <Card>
          <CardHeader title="Recent system activity" actions={<Link href="/audit" className="flex items-center gap-1 text-xs text-primary hover:underline">Audit log <ArrowRight className="size-3" /></Link>} />
          <CardBody className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {activity.map((a) => (
              <div key={a.id} className="flex justify-between gap-2 border-b border-border py-1">
                <span>
                  <span className="font-mono">{a.action}</span> <span className="text-muted">{a.userEmail ?? "system"}</span>
                </span>
                <span className="text-muted">{fmtDateTime(a.createdAt)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
