import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { RULE_DEFINITIONS, DEFAULT_RULES } from "@/lib/scheduling/engine";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/templates";
import { emailMode } from "@/lib/notifications/email";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { Field, SelectField, TextareaField, CheckboxField } from "@/components/forms/action-form";
import { FilterSelect, Pagination } from "@/components/layout/filters";
import { fmtDateTime } from "@/lib/time";
import { sp, cn } from "@/lib/utils";
import { SectionForm, TimezoneField, StagesEditor, RuleDialog, ResetRule, TemplateDialog, ResetTemplate, TestEmailForm, type RuleRow, type TemplateRow } from "./client";

export const metadata = { title: "System Settings" };

const TABS = [
  ["general", "Company & locale"],
  ["billing", "Billing"],
  ["approvals", "Approvals"],
  ["operations", "Inventory & uploads"],
  ["rules", "Scheduling rules"],
  ["notifications", "Notifications"],
  ["email", "Email log"],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("settings.manage");
  const p = await searchParams;
  const tab = (TABS.find(([k]) => k === sp(p.tab))?.[0] ?? "general") as (typeof TABS)[number][0];

  return (
    <div>
      <PageHeader title="System settings" description="Every change here is validated on the server and recorded in the audit log." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/settings?tab=${k}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-fg")}>
            {l}
          </Link>
        ))}
      </div>
      {tab === "general" && <General />}
      {tab === "billing" && <Billing />}
      {tab === "approvals" && <Approvals />}
      {tab === "operations" && <Operations />}
      {tab === "rules" && <Rules channelId={sp(p.channel) ?? null} canEdit={user.permissions.has("schedule.rules.manage")} />}
      {tab === "notifications" && <Notifications canEdit={user.permissions.has("notification.manage")} />}
      {tab === "email" && <EmailLog page={Number(sp(p.page) ?? 1)} status={sp(p.status)} email={user.email} />}
    </div>
  );
}

async function General() {
  const [company, locale, currency] = await Promise.all([getSetting("company.profile"), getSetting("locale"), getSetting("billing.currency")]);
  return (
    <Card>
      <CardHeader title="Company & locale" description="The company details print on invoices, credit notes and payment pages." />
      <CardBody>
        <SectionForm section="general">
          <div className="grid gap-3 md:grid-cols-3">
            <Field name="name" label="Company name" defaultValue={company.name} className="md:col-span-2" />
            <Field name="taxId" label="Tax / VAT registration" defaultValue={company.taxId} />
            <Field name="email" label="Billing email" type="email" defaultValue={company.email} />
            <Field name="phone" label="Phone" defaultValue={company.phone} />
            <Field name="currency" label="Base currency" defaultValue={currency.code} maxLength={3} hint="Locked while invoices are open." />
          </div>
          <TextareaField name="address" label="Address" rows={3} defaultValue={company.address} />
          <TimezoneField value={locale.defaultTimezone} zones={Intl.supportedValuesOf("timeZone")} />
        </SectionForm>
      </CardBody>
    </Card>
  );
}

async function Billing() {
  const [taxBase, billOn, layout, reminder] = await Promise.all([getSetting("billing.taxBase"), getSetting("billing.billOn"), getSetting("billing.invoiceLayout"), getSetting("notifications.paymentReminderDays")]);
  return (
    <Card>
      <CardHeader title="Billing rules" description="Changes apply to invoices created from now on. Issued invoices never change." />
      <CardBody>
        <SectionForm section="billing">
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField name="taxBase" label="Tax is calculated on" defaultValue={taxBase.mode} options={[{ value: "AFTER_COMMISSION", label: "Net after agency commission" }, { value: "BEFORE_COMMISSION", label: "Amount before commission" }]} />
            <SelectField name="billOn" label="Bill campaign spots when" defaultValue={billOn.mode} options={[{ value: "AIRED", label: "Confirmed as aired" }, { value: "SCHEDULED", label: "Scheduled (pre-billing)" }]} />
            <Field name="reminderDays" label="Payment reminder (days before due)" type="number" min={0} max={60} defaultValue={reminder.days} hint="0 turns reminders off." />
          </div>
          <TextareaField name="paymentInstructions" label="Payment instructions (bank details)" rows={3} defaultValue={layout.paymentInstructions} />
          <Field name="footer" label="Invoice footer" defaultValue={layout.footer} />
          <CheckboxField name="showCommission" label="Show agency commission on invoices" defaultChecked={layout.showCommission} />
        </SectionForm>
      </CardBody>
    </Card>
  );
}

async function Approvals() {
  const [stages, pending] = await Promise.all([getSetting("ro.approvalStages"), prisma.releaseOrder.count({ where: { status: "SUBMITTED" } })]);
  return (
    <Card>
      <CardHeader title="Release order approval" description="Submitted release orders pass through these stages in order. Inventory is booked only after the last stage approves." />
      <CardBody>
        {pending > 0 && <p className="mb-3 rounded-md bg-warning/10 p-2 text-sm text-warning">{pending} release order(s) are awaiting approval. Stages cannot change until they are approved or rejected.</p>}
        <SectionForm section="approvals" submit="Save stages">
          <StagesEditor initial={stages.stages} />
        </SectionForm>
      </CardBody>
    </Card>
  );
}

async function Operations() {
  const [alerts, uploads] = await Promise.all([getSetting("inventory.alerts"), getSetting("uploads")]);
  return (
    <Card>
      <CardHeader title="Inventory alerts & uploads" />
      <CardBody>
        <SectionForm section="operations">
          <div className="grid gap-3 md:grid-cols-2">
            <Field name="lowAvailabilityPct" label="Warn when available inventory falls below (%)" type="number" min={0} max={100} defaultValue={alerts.lowAvailabilityPct} />
            <Field name="unusedCapacityPct" label="Warn when unsold inventory within 2 days exceeds (%)" type="number" min={0} max={100} defaultValue={alerts.unusedCapacityPct} />
            <Field name="maxMb" label="Maximum upload size (MB)" type="number" min={1} max={200} defaultValue={Math.round(uploads.maxBytes / 1024 / 1024)} />
            <Field name="allowedExtensions" label="Allowed attachment types" defaultValue={uploads.allowedExtensions.join(", ")} hint="Executable and script types are always refused." />
          </div>
        </SectionForm>
      </CardBody>
    </Card>
  );
}

async function Rules({ channelId, canEdit }: { channelId: string | null; canEdit: boolean }) {
  const [channels, rows] = await Promise.all([prisma.channel.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }), prisma.schedulingRule.findMany()]);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const label = channel ? `${channel.code} only` : "All channels";
  const list: RuleRow[] = DEFAULT_RULES.map((d) => {
    const global = rows.find((r) => r.key === d.key && r.channelId === null);
    const own = channel ? rows.find((r) => r.key === d.key && r.channelId === channel.id) : undefined;
    const eff = own ?? global;
    const def = RULE_DEFINITIONS[d.key];
    return { key: d.key, name: def.name, description: def.description, enabled: eff?.enabled ?? d.enabled, severity: eff?.severity ?? d.severity, params: JSON.stringify({ ...d.params, ...((eff?.params as object) ?? {}) }, null, 2), isOverride: !!own, isDefault: !eff };
  });
  return (
    <Card>
      <CardHeader
        title="Scheduling rules"
        description="Checked on the server whenever a schedule changes and again before publishing. Errors block the change; warnings let it through and are shown to the scheduler. A channel can override any rule."
        actions={<FilterSelect param="channel" label="Scope" options={channels.map((c) => ({ value: c.id, label: `${c.code} override` }))} />}
      />
      <Table>
        <THead>
          <TR>
            <TH>Rule</TH>
            <TH>Status</TH>
            <TH>Parameters</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {list.map((r) => (
            <TR key={r.key}>
              <TD>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted">{r.description}</div>
              </TD>
              <TD className="whitespace-nowrap">
                {r.enabled ? <Badge tone={r.severity === "ERROR" ? "red" : "amber"}>{r.severity === "ERROR" ? "Blocks" : "Warns"}</Badge> : <Badge>Off</Badge>} {r.isOverride && <Badge tone="violet">Channel override</Badge>} {r.isDefault && <span className="text-[11px] text-muted">default</span>}
              </TD>
              <TD className="max-w-80 break-all font-mono text-[11px] text-muted">{r.params === "{}" ? "—" : JSON.stringify(JSON.parse(r.params))}</TD>
              <TD className="whitespace-nowrap text-right">
                {canEdit && (
                  <>
                    <RuleDialog rule={r} channelId={channel?.id ?? null} channelLabel={label} />
                    {r.isOverride && channel && <ResetRule ruleKey={r.key} channelId={channel.id} />}
                  </>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

async function Notifications({ canEdit }: { canEdit: boolean }) {
  const [rows, roles] = await Promise.all([prisma.notificationTemplate.findMany(), prisma.role.findMany({ orderBy: { name: "asc" } })]);
  const list: TemplateRow[] = Object.entries(DEFAULT_TEMPLATES).map(([key, d]) => {
    const r = rows.find((x) => x.key === key);
    const vars = [...new Set([...(d.subject + d.body).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
    return { key, name: d.name, subject: r?.subject ?? d.subject, body: r?.body ?? d.body, recipientRoles: r?.recipientRoles ?? d.recipientRoles, emailEnabled: r?.emailEnabled ?? true, inAppEnabled: r?.inAppEnabled ?? true, customised: !!r, vars };
  });
  const roleName = new Map(roles.map((r) => [r.key, r.name]));
  return (
    <Card>
      <CardHeader title="Notification templates" description={`Email delivery mode: ${emailMode() === "smtp" ? "SMTP (live)" : "preview — emails are logged here and not sent"}.`} />
      <Table>
        <THead>
          <TR>
            <TH>Event</TH>
            <TH>Subject</TH>
            <TH>Recipients</TH>
            <TH>Channels</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {list.map((t) => (
            <TR key={t.key}>
              <TD>
                <div className="font-medium">{t.name}</div>
                <div className="font-mono text-[11px] text-muted">{t.key}</div>
              </TD>
              <TD className="max-w-80 text-xs">{t.subject}</TD>
              <TD className="text-xs text-muted">{t.key.startsWith("auth.") ? "The account holder" : t.recipientRoles.map((k) => roleName.get(k) ?? k).join(", ") || "—"}</TD>
              <TD className="whitespace-nowrap text-xs">
                {t.emailEnabled && <Badge tone="blue">Email</Badge>} {t.inAppEnabled && <Badge tone="teal">In-app</Badge>} {t.customised && <Badge tone="violet">Edited</Badge>}
              </TD>
              <TD className="whitespace-nowrap text-right">
                {canEdit && (
                  <>
                    <TemplateDialog t={t} roles={roles.map((r) => ({ value: r.key, label: r.name }))} />
                    {t.customised && <ResetTemplate k={t.key} />}
                  </>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

const PER = 50;
async function EmailLog({ page, status, email }: { page: number; status?: string; email: string }) {
  const where = status ? { status } : {};
  const [rows, total] = await Promise.all([prisma.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (Math.max(1, page) - 1) * PER, take: PER }), prisma.emailLog.count({ where })]);
  return (
    <Card>
      <CardHeader title="Email log" description="Every email attempt, including previews. One-time links are redacted." actions={<TestEmailForm email={email} />} />
      <div className="border-b border-border p-3">
        <FilterSelect param="status" label="Status" options={["SENT", "PREVIEW", "FAILED"].map((s) => ({ value: s, label: s.toLowerCase() }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No emails yet" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>To</TH>
              <TH>Subject</TH>
              <TH>Status</TH>
              <TH>Detail</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TD>
                <TD className="text-xs">{r.to}</TD>
                <TD>
                  <details>
                    <summary className="cursor-pointer text-sm">{r.subject}</summary>
                    <pre className="mt-1 max-w-xl whitespace-pre-wrap text-xs text-muted">{r.body}</pre>
                  </details>
                </TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD className="text-xs text-muted">
                  {r.provider} · {r.attempts} attempt(s){r.error && <span className="block text-danger">{r.error}</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={PER} />
    </Card>
  );
}
