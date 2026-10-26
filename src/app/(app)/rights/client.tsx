"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Field, SelectField, TextareaField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveLicenseAction, deleteLicenseAction } from "@/app/actions/rights";

type Opt = { value: string; label: string };
type Init = { assetId?: string; licensor?: string; contractRef?: string; agreementId?: string; territories?: string; permittedChannelIds?: string[]; validFrom?: string; validTo?: string; maxPlays?: string; restricted?: boolean; warnDaysBefore?: string; notes?: string };

export function LicenseDialog({ id, initial: i, assets, channels, agreements }: { id?: string; initial: Init; assets: Opt[]; channels: Opt[]; agreements: Opt[] }) {
  return (
    <FormDialog
      wide
      trigger={
        id ? (
          <Button size="icon" variant="ghost" aria-label="Edit licence">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> New licence
          </Button>
        )
      }
      title={id ? "Edit licence" : "New licence"}
      description="Changes that would leave already-scheduled airings without a licence are refused."
      action={saveLicenseAction.bind(null, id ?? null)}
    >
      <SelectField name="assetId" label="Asset" placeholder="Choose program or movie" options={assets} defaultValue={i.assetId} disabled={!!id} />
      {id && <input type="hidden" name="assetId" value={i.assetId} />}
      <div className="grid grid-cols-2 gap-3">
        <Field name="licensor" label="Licensor" defaultValue={i.licensor} />
        <Field name="contractRef" label="Contract reference" defaultValue={i.contractRef} />
        <Field name="validFrom" label="Valid from" type="date" defaultValue={i.validFrom} />
        <Field name="validTo" label="Valid to" type="date" defaultValue={i.validTo} />
        <Field name="maxPlays" label="Max plays (blank = unlimited)" type="number" defaultValue={i.maxPlays} />
        <Field name="warnDaysBefore" label="Warn days before expiry" type="number" defaultValue={i.warnDaysBefore ?? "30"} />
        <Field name="territories" label="Territories (comma-separated)" defaultValue={i.territories} placeholder="LK, MV" />
        <SelectField name="agreementId" label="Agreement" placeholder="None" options={agreements} defaultValue={i.agreementId} />
      </div>
      <div>
        <Label>Permitted channels</Label>
        <p className="mb-1 text-xs text-muted">None ticked means every channel.</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {channels.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5">
              <input type="checkbox" name="permittedChannelIds" value={c.value} defaultChecked={i.permittedChannelIds?.includes(c.value)} /> {c.label}
            </label>
          ))}
        </div>
      </div>
      <CheckboxField name="restricted" label="Restricted (may not be scheduled)" defaultChecked={i.restricted} />
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={i.notes} />
    </FormDialog>
  );
}

export function DeleteLicense({ id }: { id: string }) {
  return <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title="Delete this licence?" description="Refused if scheduled airings depend on it." danger confirmLabel="Delete" action={() => deleteLicenseAction(id)} />;
}
