import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { FilterSelect, Pagination } from "@/components/layout/filters";
import { fmtDateTime } from "@/lib/time";
import { sp, cn } from "@/lib/utils";
import { MarkAllRead } from "../profile/client";

export const metadata = { title: "Notifications" };
const PER = 30;

export default async function Notifications({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePage();
  const p = await searchParams;
  const page = Math.max(1, Number(sp(p.page) ?? 1) || 1);
  const show = sp(p.show);
  const where = { userId: me.id, ...(show === "unread" ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }), prisma.notification.count({ where }), prisma.notification.count({ where: { userId: me.id, readAt: null } })]);
  return (
    <div>
      <PageHeader title="Notifications" description={`${unread} unread. Which events notify you depends on your roles; administrators manage this in System Settings.`} actions={unread > 0 && <MarkAllRead />} />
      <Card>
        <div className="border-b border-border p-3">
          <FilterSelect param="show" label="Show" options={[{ value: "unread", label: "unread only" }]} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nothing here" description="You are all caught up." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => {
              const inner = (
                <div className="flex gap-3 px-4 py-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.readAt && "font-medium")}>{n.title}</p>
                    <p className="text-sm text-muted">{n.body}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                </div>
              );
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-surface-2">{inner}</Link> : inner}</li>;
            })}
          </ul>
        )}
        <Pagination page={page} total={total} pageSize={PER} />
      </Card>
    </div>
  );
}
