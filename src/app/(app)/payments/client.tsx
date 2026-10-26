"use client";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, TextareaField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { recordPaymentAction, allocatePaymentAction } from "@/app/actions/billing";
import { PAYMENT_METHODS } from "../invoices/client";
import { formatMoney } from "@/lib/money";

export function RecordPaymentButton({ payers, currency }: { payers: { value: string; label: string }[]; currency: string }) {
  return (
    <FormDialog
      trigger={
        <Button>
          <Plus /> Record payment
        </Button>
      }
      title="Record a payment"
      description="Online payments are recorded automatically from the payment provider; use this for bank transfers, cheques and cash."
      action={recordPaymentAction}
      submitLabel="Record payment"
      redirectTo={(d) => `/payments/${(d as { id: string }).id}`}
    >
      <SelectField name="payer" label="Received from" placeholder="Choose client or agency" options={payers} />
      <div className="grid grid-cols-3 gap-3">
        <Field name="amount" label="Amount" inputMode="decimal" className="col-span-2" />
        <Field name="currency" label="Currency" defaultValue={currency} maxLength={3} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField name="method" label="Method" options={PAYMENT_METHODS} defaultValue="BANK_TRANSFER" />
        <Field name="receivedAt" label="Received on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </div>
      <Field name="reference" label="Reference" placeholder="Bank reference or cheque number" hint="Must be unique per method, so the same transfer cannot be recorded twice." />
      <CheckboxField name="autoAllocate" label="Allocate to the payer's open invoices, oldest due first" defaultChecked />
      <TextareaField name="notes" label="Notes (optional)" rows={2} />
    </FormDialog>
  );
}

export function AllocateForm({ paymentId, left, currency, invoices }: { paymentId: string; left: string; currency: string; invoices: { id: string; number: string; balance: string }[] }) {
  return (
    <FormDialog
      trigger={<Button size="sm">Allocate to invoice</Button>}
      title="Allocate payment"
      description={`${formatMoney(left, currency)} of this payment is unallocated.`}
      action={allocatePaymentAction}
      submitLabel="Allocate"
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <SelectField name="invoiceId" label="Invoice" placeholder="Choose an open invoice" options={invoices.map((i) => ({ value: i.id, label: `${i.number} · balance ${formatMoney(i.balance, currency)}` }))} />
      <Field name="amount" label={`Amount (${currency})`} defaultValue={left} inputMode="decimal" />
    </FormDialog>
  );
}
