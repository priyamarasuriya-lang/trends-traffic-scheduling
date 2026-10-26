"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionForm, Field, SelectField, FormActions, SubmitButton } from "@/components/forms/action-form";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { generateBreaksAction, deleteBreakAction, setInventoryStatusAction, updateInventoryRateAction } from "@/app/actions/inventory";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export type Position = { id: string; position: number; durationSec: number; rate: string; status: string; version: number; ro: { id: string; number: string; client: string } | null; spot: string | null };
export type BreakRow = { id: string; code: string; time: string; programTitle: string | null; timeBand: string | null; maxDurationSec: number; events: number; positions: Position[] };

const CHIP: Record<string, string> = {
  AVAILABLE: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  RESERVED: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  BOOKED: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  SCHEDULED: "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200",
  AIRED: "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-200",
  UNAVAILABLE: "border-slate-300 bg-slate-100 text-slate-500 line-through dark:border-slate-700 dark:bg-slate-800",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-400",
};

export function GenerateBreaksButton({ channels, channelId, date }: { channels: { id: string; label: string }[]; channelId: string; date: string }) {
  return (
    <FormDialog
      trigger={
        <Button>
          <Plus /> Generate breaks
        </Button>
      }
      title="Generate breaks"
      description="Creates commercial breaks and their sellable positions for every broadcast day in the range. Breaks that already exist at a time are skipped. Rates come from the channel's active rate card."
      action={generateBreaksAction}
      submitLabel="Generate"
    >
      <SelectField name="channelId" label="Channel" options={channels.map((c) => ({ value: c.id, label: c.label }))} defaultValue={channelId} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="fromDate" label="From broadcast date" type="date" defaultValue={date} />
        <Field name="toDate" label="To broadcast date" type="date" defaultValue={date} />
      </div>
      <Field name="times" label="Break times (local, 24-hour)" placeholder="07:15, 08:25, 19:25, 20:55" hint="Comma-separated HH:MM. Times before the broadcast-day start belong to the following night." />
      <div className="grid grid-cols-2 gap-3">
        <Field name="positions" label="Positions per break" type="number" min={1} max={30} defaultValue={6} />
        <Field name="positionDurationSec" label="Seconds per position" type="number" min={5} max={600} defaultValue={30} />
      </div>
      <Field name="programTitle" label="Program (optional)" placeholder="e.g. Prime News" />
    </FormDialog>
  );
}

export function BreakList({ rows, currency, canManage }: { rows: BreakRow[]; currency: string; canManage: boolean }) {
  const [open, setOpen] = React.useState<{ brk: BreakRow; pos: Position } | null>(null);
  return (
    <>
      <div className="divide-y divide-border">
        {rows.map((b) => {
          const sold = b.positions.filter((p) => ["RESERVED", "BOOKED", "SCHEDULED", "AIRED"].includes(p.status)).length;
          const sellable = b.positions.filter((p) => p.status !== "UNAVAILABLE").length;
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="w-28 shrink-0">
                <p className="font-mono text-sm font-medium">{b.time}</p>
                <p className="text-[11px] text-muted">
                  {b.code} · {b.timeBand ?? "—"}
                </p>
              </div>
              <div className="w-40 shrink-0 truncate text-sm" title={b.programTitle ?? undefined}>
                {b.programTitle ?? <span className="text-muted">No program</span>}
                <p className="text-[11px] text-muted">
                  {sold}/{sellable} sold · {b.events} on air · max {b.maxDurationSec}s
                </p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {b.positions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpen({ brk: b, pos: p })}
                    className={cn("rounded border px-1.5 py-0.5 text-[11px] tabular hover:ring-2 hover:ring-primary/30", CHIP[p.status])}
                    title={`P${p.position} · ${p.status}${p.ro ? ` · ${p.ro.number} ${p.ro.client}` : ""}`}
                  >
                    P{p.position}
                    {p.ro && <span className="ml-1 opacity-75">{p.ro.client.split(" ")[0]}</span>}
                  </button>
                ))}
              </div>
              {canManage && (
                <ConfirmAction
                  label={<Trash2 className="size-4" />}
                  variant="ghost"
                  title={`Delete break ${b.code} at ${b.time}?`}
                  description="Only breaks with no spots and no booked positions can be deleted. This removes all its positions."
                  confirmLabel="Delete break"
                  danger
                  action={() => deleteBreakAction(b.id)}
                />
              )}
            </div>
          );
        })}
      </div>
      {open && <PositionDialog brk={open.brk} pos={open.pos} currency={currency} canManage={canManage} onClose={() => setOpen(null)} />}
    </>
  );
}

function PositionDialog({ brk, pos, currency, canManage, onClose }: { brk: BreakRow; pos: Position; currency: string; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const editable = pos.status === "AVAILABLE" || pos.status === "UNAVAILABLE";
  async function toggle() {
    setBusy(true);
    const r = await setInventoryStatusAction(pos.id, pos.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE", pos.version);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message ?? "Saved");
      onClose();
      router.refresh();
    } else toast.error(r.error);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${brk.code} · position ${pos.position}`} description={`${brk.time} · ${brk.timeBand ?? "no band"} · ${pos.durationSec}s`}>
      <dl className="mb-4 grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">Status</dt>
        <dd>
          <StatusBadge status={pos.status} />
        </dd>
        <dt className="text-muted">Card rate</dt>
        <dd className="tabular">{formatMoney(pos.rate, currency)}</dd>
        <dt className="text-muted">Release order</dt>
        <dd>
          {pos.ro ? (
            <Link href={`/release-orders/${pos.ro.id}`} className="text-primary hover:underline">
              {pos.ro.number} · {pos.ro.client}
            </Link>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-muted">Spot on air</dt>
        <dd>{pos.spot ?? "—"}</dd>
      </dl>
      {canManage ? (
        <div className="space-y-4">
          <ActionForm action={updateInventoryRateAction} onSuccess={onClose} className="flex items-end gap-2">
            <input type="hidden" name="id" value={pos.id} />
            <input type="hidden" name="version" value={pos.version} />
            <Field name="rate" label={`Card rate (${currency})`} defaultValue={pos.rate} inputMode="decimal" className="flex-1" />
            <SubmitButton>Update rate</SubmitButton>
          </ActionForm>
          <FormActions>
            {editable ? (
              <Button type="button" variant={pos.status === "AVAILABLE" ? "secondary" : "default"} disabled={busy} onClick={toggle}>
                {pos.status === "AVAILABLE" ? "Withdraw from sale" : "Release for sale"}
              </Button>
            ) : (
              <p className="text-xs text-muted">Sold positions are released by amending or cancelling their release order.</p>
            )}
          </FormActions>
        </div>
      ) : (
        <p className="text-xs text-muted">You can view inventory but not change it.</p>
      )}
    </Dialog>
  );
}
