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
import { D, formatMoney } from "@/lib/money";
import { sp, cn } from "@/lib/utils";
import { AgencyDialog, ClientDialog, DeleteAccount } from "./client";

export const metadata = { title: "Agencies & Clients" };

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("agency.view");
  const p = await searchParams;
  const tab = sp(p.tab) === "clients" ? "clients" : "agencies";
  const q = sp(p.q);
  const status = sp(p.status);
  const canManage = user.permissions.has("agency.manage");
  const currency = (await getSetting("billing.currency")).code;
  const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {};
  const base = { deletedAt: null, ...(status ? { status: status as never } : {}), ...search };
  const [agencies, clients, managers, taxes, balances] = await Promise.all([
    prisma.agency.findMany({ where: tab === "agencies" ? base : { deletedAt: null }, include: { _count: { select: { clients: true, releaseOrders: true } }, accountManager: { select: { name: true } } }, orderBy: { name: "asc" } }),
    tab === "clients" ? prisma.client.findMany({ where: base, include: { agency: true, accountManager: { select: { name: true } }, _count: { select: { releaseOrders: true } } }, orderBy: { name: "asc" } }) : [],
    prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, currency }, select: { agencyId: true, clientId: true, balance: true } }),
  ]);
  const owed = (kind: "agency" | "client", id: string) => balances.filter((b) => (kind === "agency" ? b.agencyId === id : b.clientId === id && !b.agencyId)).reduce((s, b) => s.add(b.balance), D(0));
  const mgrs = managers.map((m) => ({ value: m.id, label: m.name }));
  const agencyOpts = agencies.map((a) => ({ value: a.id, label: a.name }));
  return (
    <div>
      <PageHeader
        title="Agencies & clients"
        description="Agencies buy on behalf of clients and earn commission; clients (advertisers) can also buy direct. Credit terms set invoice due dates; blocked accounts cannot be used on new deals or ROs."
        actions={canManage && (tab === "agencies" ? <AgencyDialog managers={mgrs} /> : <ClientDialog managers={mgrs} agencies={agencyOpts} taxes={taxes.map((t) => ({ value: t.id, label: `${t.name} (${t.ratePct}%)` }))} />)}
      />
      <div className="mb-4 flex gap-1 border-b border-border">
        {[
          ["agencies", "Agencies"],
          ["clients", "Clients"],
        ].map(([k, l]) => (
          <Link key={k} href={`/agencies?tab=${k}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-fg")}>
            {l}
          </Link>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <SearchBox placeholder="Name, code or email" />
          <FilterSelect param="status" label="Status" options={["ACTIVE", "ON_HOLD", "BLOCKED", "INACTIVE"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }))} />
        </div>
        {tab === "agencies" ? (
          agencies.length === 0 ? (
            <EmptyState title="No agencies" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Code</TH>
                  <TH>Agency</TH>
                  <TH>Contact</TH>
                  <TH className="text-right">Commission</TH>
                  <TH className="text-right">Terms</TH>
                  <TH className="text-right">Clients / ROs</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {agencies.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.code}</TD>
                    <TD>
                      {a.name}
                      {a.accountManager && <p className="text-[11px] text-muted">AM: {a.accountManager.name}</p>}
                    </TD>
                    <TD className="text-xs">
                      {a.contactName}
                      <p className="text-muted">{a.email}</p>
                    </TD>
                    <TD className="text-right tabular">{a.commissionPct.toString()}%</TD>
                    <TD className="text-right">{a.creditTermsDays}d</TD>
                    <TD className="text-right tabular">
                      <Link className="hover:underline" href={`/agencies?tab=clients&q=`}>
                        {a._count.clients}
                      </Link>{" "}
                      / {a._count.releaseOrders}
                    </TD>
                    <TD className="text-right tabular">
                      <Link className="hover:underline" href={`/invoices?agency=${a.id}&open=1`}>
                        {formatMoney(owed("agency", a.id), currency)}
                      </Link>
                    </TD>
                    <TD>
                      <StatusBadge status={a.status} />
                    </TD>
                    <TD className="text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <AgencyDialog managers={mgrs} agency={{ id: a.id, code: a.code, name: a.name, contactName: a.contactName ?? "", email: a.email ?? "", phone: a.phone ?? "", billingAddress: a.billingAddress ?? "", taxId: a.taxId ?? "", commissionPct: a.commissionPct.toString(), creditTermsDays: String(a.creditTermsDays), creditLimit: a.creditLimit?.toFixed(2) ?? "", status: a.status, accountManagerId: a.accountManagerId ?? "" }} />
                          <DeleteAccount kind="agency" id={a.id} name={a.name} />
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        ) : clients.length === 0 ? (
          <EmptyState title="No clients" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Client</TH>
                <TH>Default agency</TH>
                <TH>Product category</TH>
                <TH className="text-right">Terms</TH>
                <TH className="text-right">ROs</TH>
                <TH className="text-right">Owed direct</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {clients.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs">{c.code}</TD>
                  <TD>
                    {c.name}
                    <p className="text-[11px] text-muted">{[c.contactName, c.email].filter(Boolean).join(" · ")}</p>
                  </TD>
                  <TD className="text-xs">{c.agency?.name ?? "Direct"}</TD>
                  <TD className="text-xs">{c.productCategory ?? "—"}</TD>
                  <TD className="text-right">{c.creditTermsDays}d</TD>
                  <TD className="text-right tabular">
                    <Link className="hover:underline" href={`/release-orders?client=${c.id}`}>
                      {c._count.releaseOrders}
                    </Link>
                  </TD>
                  <TD className="text-right tabular">
                    <Link className="hover:underline" href={`/invoices?client=${c.id}&open=1`}>
                      {formatMoney(owed("client", c.id), currency)}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                  </TD>
                  <TD className="text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <ClientDialog
                          managers={mgrs}
                          agencies={agencyOpts}
                          taxes={taxes.map((t) => ({ value: t.id, label: `${t.name} (${t.ratePct}%)` }))}
                          client={{ id: c.id, code: c.code, name: c.name, agencyId: c.agencyId ?? "", contactName: c.contactName ?? "", email: c.email ?? "", phone: c.phone ?? "", billingAddress: c.billingAddress ?? "", taxId: c.taxId ?? "", taxRateId: c.taxRateId ?? "", taxExempt: c.taxExempt, creditTermsDays: String(c.creditTermsDays), creditLimit: c.creditLimit?.toFixed(2) ?? "", status: c.status, productCategory: c.productCategory ?? "", accountManagerId: c.accountManagerId ?? "" }}
                        />
                        <DeleteAccount kind="client" id={c.id} name={c.name} />
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
