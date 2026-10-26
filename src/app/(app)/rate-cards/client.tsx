"use client";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Field, SelectField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { LinesEditor } from "@/components/forms/lines-editor";
import { saveRateCardAction, saveTaxRateAction } from "@/app/actions/billing";

type Opt = { value: string; label: string };
type Card = { id: string; name: string; channelId: string; clientId: string | null; currency: string; validFrom: string; validTo: string; isActive: boolean; items: { timeBand: string; position: string; baseDurationSec: string; rate: string }[] };

export function RateCardDialog({ card, channels, clients, currency }: { card?: Card; channels: Opt[]; clients: Opt[]; currency: string }) {
  return (
    <FormDialog
      wide
      trigger={
        card ? (
          <Button size="sm" variant="secondary">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New rate card
          </Button>
        )
      }
      title={card ? `Edit ${card.name}` : "New rate card"}
      description="Changes apply to inventory generated and lines priced from now on. Existing booked rates are not changed."
      action={saveRateCardAction.bind(null, card?.id ?? null)}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field name="name" label="Name" defaultValue={card?.name} />
        <SelectField name="channelId" label="Channel" placeholder="Choose channel" options={channels} defaultValue={card?.channelId} />
        <SelectField name="clientId" label="Client (optional)" placeholder="Standard card for all clients" options={clients} defaultValue={card?.clientId ?? ""} />
        <Field name="currency" label="Currency" defaultValue={card?.currency ?? currency} maxLength={3} />
        <Field name="validFrom" label="Valid from" type="date" defaultValue={card?.validFrom ?? new Date().toISOString().slice(0, 10)} />
        <Field name="validTo" label="Valid to (optional)" type="date" defaultValue={card?.validTo} />
      </div>
      <CheckboxField name="isActive" label="Active" defaultChecked={card?.isActive ?? true} />
      <div>
        <Label>Rates</Label>
        <LinesEditor
          name="items"
          initial={card?.items ?? [
            { timeBand: "PRIME", position: "ANY", baseDurationSec: "30", rate: "" },
            { timeBand: "DAY", position: "ANY", baseDurationSec: "30", rate: "" },
            { timeBand: "LATE", position: "ANY", baseDurationSec: "30", rate: "" },
          ]}
          blank={() => ({ timeBand: "ANY", position: "ANY", baseDurationSec: "30", rate: "" })}
          columns={[
            { key: "timeBand", label: "Time band", type: "select", options: ["PRIME", "DAY", "LATE", "ANY"].map((v) => ({ value: v, label: v })) },
            { key: "position", label: "Position", type: "select", options: ["ANY", "FIRST", "LAST"].map((v) => ({ value: v, label: v })) },
            { key: "baseDurationSec", label: "Base sec", type: "number" },
            { key: "rate", label: "Rate", type: "money" },
          ]}
        />
      </div>
    </FormDialog>
  );
}

export function TaxRateDialog({ tax }: { tax?: { id: string; name: string; ratePct: string; jurisdiction: string; isDefault: boolean; isActive: boolean } }) {
  return (
    <FormDialog
      trigger={
        tax ? (
          <Button size="icon" variant="ghost" aria-label={`Edit ${tax.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant="secondary">
            <Plus /> Add
          </Button>
        )
      }
      title={tax ? `Edit ${tax.name}` : "New tax rate"}
      description="Rates already on issued invoices never change."
      action={saveTaxRateAction.bind(null, tax?.id ?? null)}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field name="name" label="Name" defaultValue={tax?.name} placeholder="VAT" />
        <Field name="ratePct" label="Rate %" defaultValue={tax?.ratePct} inputMode="decimal" />
      </div>
      <Field name="jurisdiction" label="Jurisdiction (optional)" defaultValue={tax?.jurisdiction} />
      <CheckboxField name="isDefault" label="Default rate" defaultChecked={tax?.isDefault} />
      <CheckboxField name="isActive" label="Active" defaultChecked={tax?.isActive ?? true} />
    </FormDialog>
  );
}
