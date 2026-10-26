"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, TextareaField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveAgencyAction, saveClientAction, deleteAccountAction } from "@/app/actions/accounts";

type Opt = { value: string; label: string };
type Rec = Record<string, string | boolean>;
const STATUS = ["ACTIVE", "ON_HOLD", "BLOCKED", "INACTIVE"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }));
const s = (r: Rec | undefined, k: string) => (r?.[k] as string | undefined) ?? undefined;

function Common({ r, managers }: { r?: Rec; managers: Opt[] }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field name="code" label="Code" defaultValue={s(r, "code")} />
        <Field name="name" label="Name" defaultValue={s(r, "name")} className="col-span-2" />
        <Field name="contactName" label="Contact" defaultValue={s(r, "contactName")} />
        <Field name="email" label="Billing email" type="email" defaultValue={s(r, "email")} />
        <Field name="phone" label="Phone" defaultValue={s(r, "phone")} />
      </div>
      <TextareaField name="billingAddress" label="Billing address" rows={2} defaultValue={s(r, "billingAddress")} />
      <div className="grid grid-cols-3 gap-3">
        <Field name="taxId" label="Tax ID" defaultValue={s(r, "taxId")} />
        <Field name="creditTermsDays" label="Credit terms (days)" type="number" defaultValue={s(r, "creditTermsDays") ?? "30"} />
        <Field name="creditLimit" label="Credit limit (optional)" inputMode="decimal" defaultValue={s(r, "creditLimit")} />
        <SelectField name="status" label="Status" options={STATUS} defaultValue={s(r, "status") ?? "ACTIVE"} />
        <SelectField name="accountManagerId" label="Account manager" placeholder="None" options={managers} defaultValue={s(r, "accountManagerId")} />
      </div>
    </>
  );
}

export function AgencyDialog({ agency, managers }: { agency?: Rec; managers: Opt[] }) {
  return (
    <FormDialog
      wide
      trigger={agency ? <Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button> : <Button><Plus /> New agency</Button>}
      title={agency ? `Edit ${agency.name}` : "New agency"}
      action={saveAgencyAction.bind(null, (agency?.id as string) ?? null)}
    >
      <Common r={agency} managers={managers} />
      <Field name="commissionPct" label="Agency commission %" defaultValue={s(agency, "commissionPct") ?? "15"} inputMode="decimal" />
    </FormDialog>
  );
}

export function ClientDialog({ client, managers, agencies, taxes }: { client?: Rec; managers: Opt[]; agencies: Opt[]; taxes: Opt[] }) {
  return (
    <FormDialog
      wide
      trigger={client ? <Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button> : <Button><Plus /> New client</Button>}
      title={client ? `Edit ${client.name}` : "New client"}
      action={saveClientAction.bind(null, (client?.id as string) ?? null)}
    >
      <Common r={client} managers={managers} />
      <div className="grid grid-cols-3 gap-3">
        <SelectField name="agencyId" label="Default agency" placeholder="Buys direct" options={agencies} defaultValue={s(client, "agencyId")} />
        <SelectField name="taxRateId" label="Tax rate" placeholder="System default" options={taxes} defaultValue={s(client, "taxRateId")} />
        <Field name="productCategory" label="Product category" defaultValue={s(client, "productCategory")} hint="For competitor separation." />
      </div>
      <CheckboxField name="taxExempt" label="Tax exempt" defaultChecked={!!client?.taxExempt} />
    </FormDialog>
  );
}

export function DeleteAccount({ kind, id, name }: { kind: "agency" | "client"; id: string; name: string }) {
  return <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title={`Delete ${name}?`} description="Only accounts with no open release orders or invoices can be deleted. History is kept." danger confirmLabel="Delete" action={() => deleteAccountAction(kind, id)} />;
}
