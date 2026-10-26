import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { ADAPTERS, ensureIntegrations, reconciliation } from "@/lib/integrations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { addDaysStr, fmtDate, fmtDateTime, todayIn } from "@/lib/time";
import { sp } from "@/lib/utils";
import { IntegrationControls, ExportForm, ImportForm, JobActions } from "./client";

export const metadata = { title: "Integrations" };

export default async function Integrations({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("integration.view");
  const p = await searchParams;
  await ensureIntegrations();
  const ctx = await channelContext(user);
  const today = todayIn("UTC");
  const recKey = (sp(p.rec) === "SAP" ? "SAP" : "TALLY") as "SAP" | "TALLY";
  const recFrom = sp(p.from) ?? addDaysStr(today, -30);
  const recTo = sp(p.to) ?? today;
  const [integrations, jobs, files, rec] = await Promise.all([
    prisma.integration.findMany({ orderBy: { name: "asc" } }),
    prisma.integrationJob.findMany({ include: { integration: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.fileAttachment.findMany({ where: { entityType: "INTEGRATION_JOB", deletedAt: null }, select: { id: true, entityId: true, fileName: true } }),
    user.permissions.has("report.financial") ? reconciliation(recKey, new Date(`${recFrom}T00:00:00Z`), new Date(`${recTo}T23:59:59Z`)) : Promise.resolve(null),
  ]);
  const canManage = user.permissions.has("integration.manage");
  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connections to finance, asset management, playout automation, email and payments. Credentials live in server environment variables and are never shown here. Anything not configured runs in a clearly labelled test or file-export mode."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {integrations.map((i) => {
          const a = ADAPTERS[i.key];
          if (!a) return null;
          const envs = a.requiredEnv.map((k) => ({ k, set: !!process.env[k] }));
          return (
            <Card key={i.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {i.name} <StatusBadge status={i.status} /> {!i.enabled && <Badge>disabled</Badge>}
                  </span>
                }
                description={a.description}
                actions={canManage && <IntegrationControls integrationKey={i.key} enabled={i.enabled} />}
              />
              <CardBody className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {envs.map((e) => (
                    <span key={e.k} className={`rounded border px-1.5 py-0.5 font-mono ${e.set ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : "border-border text-muted"}`}>
                      {e.k} {e.set ? "set" : "not set"}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  Last checked {i.lastCheckedAt ? fmtDateTime(i.lastCheckedAt) : "never"}
                  {i.lastError && <span className="block text-danger">Last error: {i.lastError}</span>}
                </p>
                {canManage && i.enabled && (i.key === "SAP" || i.key === "TALLY") && <ExportForm integrationKey={i.key} from={addDaysStr(today, -30)} to={today} />}
                {canManage && i.enabled && i.key === "AUTOMATION" && <ExportForm integrationKey={i.key} channels={ctx.channels.map((c) => ({ value: c.id, label: c.code }))} date={today} />}
                {canManage && i.enabled && i.key === "AMS" && <ImportForm />}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader title="Jobs" description="Failed jobs retry automatically after 1, 4 and 16 minutes, then stop and notify administrators. Identical jobs are not run twice unless forced." actions={canManage && <JobActions />} />
        <Table>
          <THead>
            <tr>
              <TH>Created</TH>
              <TH>Integration</TH>
              <TH>Job</TH>
              <TH>Status</TH>
              <TH className="text-right">Attempts</TH>
              <TH>Result</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {jobs.length === 0 && (
              <tr>
                <TD colSpan={7} className="text-center text-muted">
                  No jobs yet.
                </TD>
              </tr>
            )}
            {jobs.map((j) => {
              const f = files.find((x) => x.entityId === j.id);
              const r = j.result as Record<string, unknown> | null;
              return (
                <TR key={j.id}>
                  <TD className="text-xs">{fmtDateTime(j.createdAt)}</TD>
                  <TD>{j.integration.name}</TD>
                  <TD className="text-xs">
                    {j.direction.toLowerCase()} · {j.kind.toLowerCase().replace("_", " ")}
                  </TD>
                  <TD>
                    <StatusBadge status={j.status} />
                  </TD>
                  <TD className="text-right">
                    {j.attempts}/{j.maxAttempts}
                  </TD>
                  <TD className="max-w-md text-xs">
                    {j.error ? <span className="text-danger">{j.error}</span> : r ? Object.entries(r).filter(([k]) => k !== "invoices").map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : String(v)}`).join(" · ") : "—"}
                    {f && (
                      <a href={`/api/files/${f.id}`} className="ml-2 text-primary hover:underline">
                        {f.fileName}
                      </a>
                    )}
                  </TD>
                  <TD className="text-right">{canManage && ["FAILED", "DEAD"].includes(j.status) && <JobActions retryId={j.id} />}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      {rec && (
        <Card className="mt-4">
          <CardHeader title="Finance reconciliation" description="Invoices issued in the period and whether a successful export included them." />
          <CardBody>
            <form method="get" className="mb-3 flex flex-wrap items-end gap-2 text-sm">
              <select name="rec" defaultValue={recKey} className="h-9 rounded-md border border-border bg-surface px-2">
                <option value="TALLY">Tally</option>
                <option value="SAP">SAP</option>
              </select>
              <input type="date" name="from" defaultValue={recFrom} className="h-9 rounded-md border border-border bg-surface px-2" />
              <input type="date" name="to" defaultValue={recTo} className="h-9 rounded-md border border-border bg-surface px-2" />
              <button className="h-9 rounded-md border border-border px-3 hover:bg-surface-2">Check</button>
            </form>
            <p className="mb-2 text-sm">
              {rec.filter((r) => r.exported).length} of {rec.length} invoice(s) exported to {recKey === "SAP" ? "SAP" : "Tally"}.
            </p>
            <div className="max-h-64 overflow-auto">
              <Table>
                <TBody>
                  {rec.map((r) => (
                    <TR key={r.number}>
                      <TD className="font-mono text-xs">{r.number}</TD>
                      <TD className="text-xs">{fmtDate(r.issueDate)}</TD>
                      <TD className="text-right tabular">{r.total}</TD>
                      <TD>{r.exported ? <Badge tone="green">exported</Badge> : <Badge tone="amber">not exported</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
