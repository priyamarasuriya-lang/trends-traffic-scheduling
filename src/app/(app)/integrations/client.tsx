"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, PlugZap, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ActionForm, SubmitButton, CheckboxField } from "@/components/forms/action-form";
import { testIntegrationAction, toggleIntegrationAction, queueExportAction, importMediaAction, runJobsAction, retryJobAction } from "@/app/actions/integrations";
import type { ActionResult } from "@/lib/action";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return {
    busy,
    go: async (fn: () => Promise<ActionResult<unknown>>, ok?: (d: unknown) => string) => {
      setBusy(true);
      const r = await fn();
      setBusy(false);
      if (r.ok) toast.success(ok ? ok(r.data) : (r.message ?? "Done"));
      else toast.error(r.error);
      router.refresh();
    },
  };
}

export function IntegrationControls({ integrationKey, enabled }: { integrationKey: string; enabled: boolean }) {
  const { busy, go } = useRun();
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(() => testIntegrationAction(integrationKey), (d) => (d as { message: string }).message)}>
        <PlugZap /> Test
      </Button>
      <Button size="sm" variant={enabled ? "secondary" : "default"} disabled={busy} onClick={() => go(() => toggleIntegrationAction(integrationKey, !enabled))}>
        {enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}

export function ExportForm({ integrationKey, from, to, channels, date }: { integrationKey: string; from?: string; to?: string; channels?: { value: string; label: string }[]; date?: string }) {
  return (
    <ActionForm action={queueExportAction} className="flex flex-wrap items-end gap-2 space-y-0 rounded-md bg-surface-2 p-2">
      <input type="hidden" name="key" value={integrationKey} />
      {channels ? (
        <>
          <Select name="channelId" aria-label="Channel" className="h-8 text-xs">
            {channels.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Input type="date" name="date" defaultValue={date} aria-label="Broadcast date" className="h-8 w-36 text-xs" />
        </>
      ) : (
        <>
          <Input type="date" name="from" defaultValue={from} aria-label="From" className="h-8 w-36 text-xs" />
          <Input type="date" name="to" defaultValue={to} aria-label="To" className="h-8 w-36 text-xs" />
        </>
      )}
      <CheckboxField name="force" label="Re-run even if identical" />
      <SubmitButton>{channels ? "Export playlist" : "Export invoices"}</SubmitButton>
    </ActionForm>
  );
}

export function ImportForm() {
  return (
    <ActionForm action={importMediaAction} className="flex flex-wrap items-center gap-2 space-y-0 rounded-md bg-surface-2 p-2" resetOnSuccess>
      <input type="file" name="file" accept=".csv,text/csv" aria-label="Media metadata CSV" className="text-xs" />
      <SubmitButton>
        <Upload className="size-4" /> Import CSV
      </SubmitButton>
      <p className="w-full text-[11px] text-muted">Columns: assetCode, title, category, durationSec, language, fileRef, rightsOwner. New assets arrive as pending approval.</p>
    </ActionForm>
  );
}

export function JobActions({ retryId }: { retryId?: string }) {
  const { busy, go } = useRun();
  if (retryId)
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(() => retryJobAction(retryId))}>
        <RotateCcw /> Retry
      </Button>
    );
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(() => runJobsAction(), (d) => { const r = d as { ran: number; ok: number; failed: number }; return `${r.ran} job(s) run: ${r.ok} ok, ${r.failed} failed`; })}>
      <Play /> Run due jobs
    </Button>
  );
}
