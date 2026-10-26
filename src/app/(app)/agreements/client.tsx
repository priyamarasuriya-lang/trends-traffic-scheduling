"use client";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, TextareaField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveAgreementAction, agreementStatusAction } from "@/app/actions/agreements";

type Opt = { value: string; label: string };
type Init = { id: string; title: string; type: string; agencyId: string; clientId: string; dealId: string; startDate: string; endDate: string; value: string; terms: string };

export function AgreementDialog({ agreement: a, agencies, clients, deals }: { agreement?: Init; agencies: Opt[]; clients: Opt[]; deals: Opt[] }) {
  return (
    <FormDialog
      wide
      trigger={a ? <Button size="sm" variant="secondary"><Pencil /> Edit</Button> : <Button><Plus /> New agreement</Button>}
      title={a ? "Edit agreement" : "New agreement"}
      description="Agreements get a number on creation and can be edited while in draft."
      action={saveAgreementAction.bind(null, a?.id ?? null)}
      redirectTo={(d) => `/agreements/${(d as { id: string }).id}`}
    >
      <Field name="title" label="Title" defaultValue={a?.title} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <SelectField name="type" label="Type" options={[{ value: "ADVERTISING", label: "Advertising" }, { value: "CONTENT_LICENSE", label: "Content licence" }, { value: "SERVICE", label: "Service" }]} defaultValue={a?.type ?? "ADVERTISING"} />
        <SelectField name="agencyId" label="Agency" placeholder="—" options={agencies} defaultValue={a?.agencyId} />
        <SelectField name="clientId" label="Client" placeholder="—" options={clients} defaultValue={a?.clientId} />
        <Field name="startDate" label="Start" type="date" defaultValue={a?.startDate} />
        <Field name="endDate" label="End" type="date" defaultValue={a?.endDate} />
        <Field name="value" label="Agreed value (optional)" inputMode="decimal" defaultValue={a?.value} />
      </div>
      <SelectField name="dealId" label="Linked deal (optional)" placeholder="None — match ROs by party and period" options={deals} defaultValue={a?.dealId} />
      <TextareaField name="terms" label="Terms" rows={5} defaultValue={a?.terms} />
    </FormDialog>
  );
}

export function AgreementStatusButtons({ id, status }: { id: string; status: string }) {
  return (
    <>
      {status === "DRAFT" && <ConfirmAction label="Activate" variant="default" title="Mark this agreement as signed and active?" description="It can no longer be edited after this." action={(r) => agreementStatusAction(id, "ACTIVE", r)} />}
      {["DRAFT", "ACTIVE"].includes(status) && <ConfirmAction label="Terminate" title="Terminate this agreement?" reason="required" danger action={(r) => agreementStatusAction(id, "TERMINATED", r)} />}
    </>
  );
}
