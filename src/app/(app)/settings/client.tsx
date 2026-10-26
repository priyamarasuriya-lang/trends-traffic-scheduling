"use client";
import * as React from "react";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ActionForm, Field, SelectField, TextareaField, CheckboxField, CheckGroup, FormActions, SubmitButton } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveSettingsSectionAction, saveRuleAction, resetRuleOverrideAction, saveTemplateAction, resetTemplateAction, sendTestEmailAction } from "@/app/actions/settings";

type Opt = { value: string; label: string };

export function SectionForm({ section, children, submit = "Save changes" }: { section: string; children: React.ReactNode; submit?: string }) {
  return (
    <ActionForm action={saveSettingsSectionAction.bind(null, section)}>
      {children}
      <FormActions>
        <SubmitButton>{submit}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function TimezoneField({ value, zones }: { value: string; zones: string[] }) {
  return (
    <div>
      <Field name="defaultTimezone" label="Default time zone" defaultValue={value} list="tz-list" hint="Used for new channels and report date ranges." />
      <datalist id="tz-list">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </div>
  );
}

const STAGE_PERMS = [
  { value: "ro.approve.sales", label: "Sales approvers (ro.approve.sales)" },
  { value: "ro.approve.finance", label: "Finance approvers (ro.approve.finance)" },
];

export function StagesEditor({ initial }: { initial: { name: string; permission: string }[] }) {
  const [rows, setRows] = React.useState(initial.length ? initial : [{ name: "Approval", permission: "ro.approve.sales" }]);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right text-xs text-muted">{i + 1}.</span>
          <Input name="stageName" aria-label={`Stage ${i + 1} name`} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="max-w-xs" />
          <Select name="stagePermission" aria-label={`Stage ${i + 1} approvers`} value={r.permission} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, permission: e.target.value } : x)))} className="max-w-xs">
            {STAGE_PERMS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button type="button" size="icon" variant="ghost" aria-label="Remove stage" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {rows.length < 4 && (
        <Button type="button" size="sm" variant="secondary" onClick={() => setRows([...rows, { name: "", permission: "ro.approve.finance" }])}>
          <Plus /> Add stage
        </Button>
      )}
    </div>
  );
}

export type RuleRow = { key: string; name: string; description: string; enabled: boolean; severity: string; params: string; isOverride: boolean; isDefault: boolean };

export function RuleDialog({ rule, channelId, channelLabel }: { rule: RuleRow; channelId: string | null; channelLabel: string }) {
  return (
    <FormDialog
      trigger={<Button size="icon" variant="ghost" aria-label={`Edit ${rule.name}`}><Pencil /></Button>}
      title={`${rule.name} · ${channelLabel}`}
      description={rule.description}
      action={saveRuleAction.bind(null, rule.key, channelId)}
    >
      <CheckboxField name="enabled" label="Enabled" defaultChecked={rule.enabled} />
      <SelectField name="severity" label="When broken" options={[{ value: "ERROR", label: "Block the change (error)" }, { value: "WARNING", label: "Allow with a warning" }]} defaultValue={rule.severity} />
      {rule.params !== "{}" && <TextareaField name="params" label="Parameters (JSON)" rows={6} defaultValue={rule.params} className="font-mono text-xs" hint="Seconds for separations; minutes after local midnight for time windows." />}
    </FormDialog>
  );
}

export function ResetRule({ ruleKey, channelId }: { ruleKey: string; channelId: string }) {
  return <ConfirmAction label={<RotateCcw className="size-4" />} variant="ghost" title="Remove this channel override?" description="The channel goes back to the rule as configured for all channels." confirmLabel="Remove override" action={() => resetRuleOverrideAction(ruleKey, channelId)} />;
}

export type TemplateRow = { key: string; name: string; subject: string; body: string; recipientRoles: string[]; emailEnabled: boolean; inAppEnabled: boolean; customised: boolean; vars: string[] };

export function TemplateDialog({ t, roles }: { t: TemplateRow; roles: Opt[] }) {
  return (
    <FormDialog wide trigger={<Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`}><Pencil /></Button>} title={`Notification: ${t.name}`} description={t.vars.length ? `Placeholders: ${t.vars.map((v) => `{{${v}}}`).join(" ")}` : undefined} action={saveTemplateAction.bind(null, t.key)}>
      <Field name="subject" label="Subject" defaultValue={t.subject} />
      <TextareaField name="body" label="Message" rows={4} defaultValue={t.body} />
      <div className="flex gap-6">
        <CheckboxField name="emailEnabled" label="Send email" defaultChecked={t.emailEnabled} />
        <CheckboxField name="inAppEnabled" label="Show in-app" defaultChecked={t.inAppEnabled} />
      </div>
      {!t.key.startsWith("auth.") && <CheckGroup name="recipientRoles" label="Recipients (by role)" options={roles} columns={3} defaultValue={t.recipientRoles} hint="Only users with access to the affected channel are notified." />}
    </FormDialog>
  );
}

export function ResetTemplate({ k }: { k: string }) {
  return <ConfirmAction label={<RotateCcw className="size-4" />} variant="ghost" title="Restore the default template?" confirmLabel="Restore" action={() => resetTemplateAction(k)} />;
}

export function TestEmailForm({ email }: { email: string }) {
  return (
    <ActionForm action={sendTestEmailAction} className="flex items-end gap-2 space-y-0">
      <Field name="to" label="Send a test email to" type="email" defaultValue={email} className="w-72" />
      <SubmitButton variant="secondary">Send test</SubmitButton>
    </ActionForm>
  );
}
