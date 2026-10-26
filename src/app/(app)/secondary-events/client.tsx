"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveSecondaryAction, deleteSecondaryAction } from "@/app/actions/secondary";

type Init = { category?: string; label?: string; assetId?: string; startDate: string; startTime: string; endDate: string; endTime: string; layer: string; priority: string; isActive: boolean };

export function SecondaryDialog({ id, channelId, assets, initial: i }: { id?: string; channelId: string; assets: { value: string; label: string }[]; initial: Init }) {
  return (
    <FormDialog
      trigger={
        id ? (
          <Button size="icon" variant="ghost" aria-label="Edit">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> New secondary event
          </Button>
        )
      }
      title={id ? "Edit secondary event" : "New secondary event"}
      description="Times are in the channel's time zone."
      action={saveSecondaryAction.bind(null, id ?? null)}
    >
      <input type="hidden" name="channelId" value={channelId} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField name="category" label="Type" options={["LOGO", "BUG", "LOWER_THIRD", "TICKER", "OVERLAY", "COUNTDOWN", "OTHER"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase() }))} defaultValue={i.category} />
        <SelectField name="assetId" label="Graphic (optional)" placeholder="No graphic asset" options={assets} defaultValue={i.assetId} />
      </div>
      <Field name="label" label="Label" defaultValue={i.label} placeholder="e.g. Lower third: Breaking news" />
      <div className="grid grid-cols-2 gap-3">
        <Field name="startDate" label="Start date" type="date" defaultValue={i.startDate} />
        <Field name="startTime" label="Start time" defaultValue={i.startTime} placeholder="HH:MM:SS" />
        <Field name="endDate" label="End date" type="date" defaultValue={i.endDate} />
        <Field name="endTime" label="End time" defaultValue={i.endTime} placeholder="HH:MM:SS" />
        <Field name="layer" label="Layer" type="number" min={1} max={20} defaultValue={i.layer} hint="Same-layer events cannot overlap." />
        <Field name="priority" label="Priority (1 = highest)" type="number" min={1} max={10} defaultValue={i.priority} />
      </div>
      <CheckboxField name="isActive" label="Active" defaultChecked={i.isActive} />
    </FormDialog>
  );
}

export function DeleteSecondary({ id, label }: { id: string; label: string }) {
  return <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title={`Delete "${label}"?`} danger confirmLabel="Delete" action={() => deleteSecondaryAction(id)} />;
}
