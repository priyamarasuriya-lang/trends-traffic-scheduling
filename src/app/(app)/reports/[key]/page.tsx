import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileSpreadsheet, FileText } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { channelContext } from "@/lib/context";
import { reportByKey } from "@/lib/reports/definitions";
import { runReport } from "@/lib/reports/run";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { D } from "@/lib/money";
import { PrintButton } from "./print-button";

const SHOW = 1000;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  return { title: reportByKey((await params).key)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("report.view");
  const { key } = await params;
  const sp = await searchParams;
  const def = reportByKey(key);
  if (!def) notFound();
  if (!user.permissions.has(def.permission)) redirect("/forbidden");

  let data: Awaited<ReturnType<typeof runReport>> | null = null;
  let error: string | null = null;
  try {
    data = await runReport(user, key, sp);
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }
  const ctx = await channelContext(user);
  const [clients, agencies] = await Promise.all([
    def.filters.includes("client") ? prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    def.filters.includes("agency") ? prisma.agency.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const f = data?.filters;
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : []))).toString();
  const fmt = (v: unknown, type?: string) => {
    if (v == null || v === "") return "—";
    if (type === "money") return D(v as string).toNumber().toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v instanceof Date) return v.toISOString().slice(0, type === "datetime" ? 16 : 10).replace("T", " ");
    return String(v);
  };
  return (
    <div>
      <PageHeader
        title={def.title}
        description={
          <>
            <Link href="/reports" className="text-primary hover:underline">
              Reports
            </Link>{" "}
            · {def.group} · {def.description}
          </>
        }
        actions={
          data && (
            <div className="flex gap-2 no-print">
              <Button variant="secondary" size="sm" asChild>
                <a href={`/api/reports/${key}?${qs}&format=csv`}>
                  <FileText /> CSV
                </a>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={`/api/reports/${key}?${qs}&format=xlsx`}>
                  <FileSpreadsheet /> Excel
                </a>
              </Button>
              <PrintButton />
            </div>
          )
        }
      />
      <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        {def.filters.includes("date") && (
          <>
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" name="from" defaultValue={f?.fromStr ?? (sp.from as string)} className="w-40" />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" name="to" defaultValue={f?.toStr ?? (sp.to as string)} className="w-40" />
            </div>
          </>
        )}
        {def.filters.includes("channel") && (
          <div>
            <Label htmlFor="channel">Channel</Label>
            <Select id="channel" name="channel" defaultValue={(sp.channel as string) ?? ""}>
              <option value="">All my channels</option>
              {ctx.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
        )}
        {def.filters.includes("client") && (
          <div>
            <Label htmlFor="client">Client</Label>
            <Select id="client" name="client" defaultValue={(sp.client as string) ?? ""}>
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {def.filters.includes("agency") && (
          <div>
            <Label htmlFor="agency">Agency</Label>
            <Select id="agency" name="agency" defaultValue={(sp.agency as string) ?? ""}>
              <option value="">All agencies</option>
              {agencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {def.filters.includes("status") && def.statuses && (
          <div>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={(sp.status as string) ?? ""}>
              <option value="">Any status</option>
              {def.statuses.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        )}
        {def.filters.includes("campaign") && (
          <div>
            <Label htmlFor="campaign">Campaign contains</Label>
            <Input id="campaign" name="campaign" defaultValue={(sp.campaign as string) ?? ""} className="w-48" />
          </div>
        )}
        <Button type="submit">Run report</Button>
      </form>
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {data && (
        <Card className="overflow-hidden print:border-0">
          <div className="hidden print:block print:pb-3">
            <p className="text-lg font-semibold">{def.title}</p>
            <p className="text-xs">
              {data.label} · generated {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by {user.email}
            </p>
          </div>
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted no-print">
            <span>
              {data.result.rows.length} row(s) · {data.label}
              {data.result.rows.length > SHOW && ` · showing the first ${SHOW}; export for all rows`}
            </span>
            {data.result.note && <span>{data.result.note}</span>}
          </div>
          {data.result.rows.length === 0 ? (
            <EmptyState title="No data for these filters" description="Try a wider date range or fewer filters." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    {data.result.columns.map((c) => (
                      <TH key={c.key} className={c.type === "money" || c.type === "number" ? "text-right" : ""}>
                        {c.label}
                      </TH>
                    ))}
                  </tr>
                </THead>
                <TBody>
                  {data.result.rows.slice(0, SHOW).map((r, i) => (
                    <TR key={i}>
                      {data.result.columns.map((c) => (
                        <TD key={c.key} className={c.type === "money" || c.type === "number" ? "text-right tabular" : "text-sm"}>
                          {fmt(r[c.key], c.type)}
                        </TD>
                      ))}
                    </TR>
                  ))}
                  {data.result.totals && (
                    <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                      {data.result.columns.map((c, i) => (
                        <TD key={c.key} className={c.type === "money" || c.type === "number" ? "text-right tabular" : ""}>
                          {i === 0 ? "Total" : data.result.totals![c.key] != null ? fmt(data.result.totals![c.key], c.type) : ""}
                        </TD>
                      ))}
                    </tr>
                  )}
                </TBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
