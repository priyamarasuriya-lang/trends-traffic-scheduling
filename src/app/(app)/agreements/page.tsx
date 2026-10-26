import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect } from "@/components/layout/filters";
import { agreementBookings } from "@/lib/agreements/service";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { sp } from "@/lib/utils";
import { AgreementDialog } from "./client";
import { agreementOptions } from "./options";

export const metadata = { title: "Agreements & Contracts" };

export default async function Agreements({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("agreement.view");
  const p = await searchParams;
  const q = sp(p.q);
  const status = sp(p.status);
  const currency = (await getSetting("billing.currency")).code;
  const rows = await prisma.agreement.findMany({
    where: { deletedAt: null, ...(status ? { status: status as never } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { agency: { name: { contains: q, mode: "insensitive" } } }, { client: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
    include: { agency: true, client: true, deal: { select: { number: true } } },
    orderBy: [{ status: "asc" }, { endDate: "asc" }],
  });
  const bookings = await Promise.all(rows.map((r) => agreementBookings(r)));
  const canManage = user.permissions.has("agreement.manage");
  const now = new Date();
  return (
    <div>
      <PageHeader
        title="Agreements & contracts"
        description="Annual, volume and direct agreements with agencies and clients. Each shows its booking status: approved release-order value against the agreed value."
        actions={canManage && <AgreementDialog {...await agreementOptions()} />}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="Number, title, agency or client" />
          <FilterSelect param="status" label="Status" options={["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"].map((s) => ({ value: s, label: s.toLowerCase() }))} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No agreements" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Number</TH>
                <TH>Agreement</TH>
                <TH>Party</TH>
                <TH>Period</TH>
                <TH>Status</TH>
                <TH className="text-right">Agreed value</TH>
                <TH className="w-56">Booked</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((a, i) => {
                const b = bookings[i];
                const pct = Math.min(100, b.utilisationPct ?? 0);
                const daysLeft = Math.ceil((a.endDate.getTime() - now.getTime()) / 86400000);
                return (
                  <TR key={a.id}>
                    <TD>
                      <Link href={`/agreements/${a.id}`} className="font-mono text-xs text-primary hover:underline">
                        {a.number}
                      </Link>
                    </TD>
                    <TD>
                      {a.title}
                      <p className="text-[11px] text-muted">
                        {a.type.replace("_", " ").toLowerCase()}
                        {a.deal && ` · deal ${a.deal.number}`}
                      </p>
                    </TD>
                    <TD className="text-sm">{a.agency?.name ?? a.client?.name}</TD>
                    <TD className="text-xs">
                      {fmtDate(a.startDate)} – {fmtDate(a.endDate)}
                      {a.status === "ACTIVE" && daysLeft <= 30 && daysLeft >= 0 && <p className="text-amber-600">ends in {daysLeft} day(s)</p>}
                    </TD>
                    <TD>
                      <StatusBadge status={a.status} />
                    </TD>
                    <TD className="text-right tabular">{a.value ? formatMoney(a.value, currency) : "—"}</TD>
                    <TD>
                      <p className="text-xs tabular">
                        {formatMoney(b.booked, currency)} · {b.ros.length} RO(s)
                      </p>
                      {b.utilisationPct != null && (
                        <div className="mt-1 h-1.5 rounded bg-surface-2" title={`${b.utilisationPct.toFixed(1)}% of agreed value`}>
                          <div className={`h-1.5 rounded ${pct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
