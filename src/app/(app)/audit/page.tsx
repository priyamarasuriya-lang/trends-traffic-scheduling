import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/layout/filters";
import { fmtDateTime } from "@/lib/time";
import { auditWhere } from "@/lib/audit-query";
import { sp } from "@/lib/utils";

export const metadata = { title: "Audit Logs" };
const PER = 50;

/** Fields whose value changed between the stored before/after snapshots. */
function changes(before: unknown, after: unknown) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ k, from: b[k], to: a[k] }));
}
const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 120);

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("audit.view");
  const p = await searchParams;
  const page = Math.max(1, Number(sp(p.page) ?? 1) || 1);
  const get = (k: string) => sp(p[k]);
  const [q, entity, userId, from, to, area] = ["q", "entity", "user", "from", "to", "area"].map(get);
  const where = auditWhere(get);
  const qs = new URLSearchParams(Object.entries({ q, entity, user: userId, from, to, area }).filter((e): e is [string, string] => !!e[1])).toString();
  const [rows, total, entities, users, areas] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where: { entityType: { not: null } }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.$queryRaw<{ area: string }[]>`SELECT DISTINCT split_part(action, '.', 1) AS area FROM "AuditLog" ORDER BY 1`,
  ]);
  return (
    <div>
      <PageHeader title="Audit logs" description="Every sign-in, approval, publish, financial change and settings change, with who did it and what changed. Secrets are redacted before storage. Entries cannot be edited or deleted in the app." />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <Input name="q" defaultValue={q} placeholder="Action, record id or email" aria-label="Search" className="w-60" />
          <Select name="area" defaultValue={area ?? ""} aria-label="Area" className="w-40">
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {a.area}
              </option>
            ))}
          </Select>
          <Select name="entity" defaultValue={entity ?? ""} aria-label="Record type" className="w-44">
            <option value="">All record types</option>
            {entities.map((e) => (
              <option key={e.entityType} value={e.entityType!}>
                {e.entityType}
              </option>
            ))}
          </Select>
          <Select name="user" defaultValue={userId ?? ""} aria-label="User" className="w-44">
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-36" />
          <Input type="date" name="to" defaultValue={to} aria-label="To" className="w-36" />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <a href={`/api/audit?${qs}`} className="ml-auto text-xs text-primary hover:underline">
            Export CSV
          </a>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No audit entries match" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>User</TH>
                <TH>Action</TH>
                <TH>Record</TH>
                <TH>Change</TH>
                <TH>IP</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const diff = changes(r.before, r.after);
                return (
                  <TR key={r.id} className="align-top">
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TD>
                    <TD className="text-xs">{r.userEmail ?? "system"}</TD>
                    <TD>
                      <Badge tone={/fail|reject|cancel|delete|revoke/.test(r.action) ? "red" : /approve|publish|issue|paid/.test(r.action) ? "green" : "gray"}>{r.action}</Badge>
                    </TD>
                    <TD className="text-xs">
                      {r.entityType ?? "—"}
                      {r.entityId && <span className="block max-w-40 truncate font-mono text-[10px] text-muted">{r.entityId}</span>}
                    </TD>
                    <TD className="max-w-lg text-xs">
                      {diff && diff.length > 0 ? (
                        <ul className="space-y-0.5">
                          {diff.slice(0, 6).map((d) => (
                            <li key={d.k}>
                              <span className="font-medium">{d.k}</span>: <span className="text-danger line-through">{show(d.from)}</span> → <span className="text-success">{show(d.to)}</span>
                            </li>
                          ))}
                          {diff.length > 6 && <li className="text-muted">+{diff.length - 6} more</li>}
                        </ul>
                      ) : r.before || r.after ? (
                        <details>
                          <summary className="cursor-pointer text-muted">Details</summary>
                          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{JSON.stringify({ before: r.before ?? undefined, after: r.after ?? undefined }, null, 1)}</pre>
                        </details>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                    <TD className="text-xs text-muted">{r.ip ?? ""}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={page} total={total} pageSize={PER} />
      </Card>
    </div>
  );
}
