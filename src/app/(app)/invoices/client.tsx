"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Download, Mail, Printer, RefreshCw, Send, Trash2, Wallet, FileMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ActionForm, Field, SelectField, TextareaField, FormActions, SubmitButton } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { LinesEditor, type Line } from "@/components/forms/lines-editor";
import { computeLine, computeTotals, type TaxBase } from "@/lib/billing/calc";
import { formatMoney } from "@/lib/money";
import {
  issueInvoiceAction,
  cancelInvoiceAction,
  deleteDraftInvoiceAction,
  creditNoteAction,
  recordPaymentAction,
  emailInvoiceAction,
  refreshOverdueAction,
  saveManualInvoiceAction,
  removeAllocationAction,
} from "@/app/actions/billing";

export const PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card (terminal)" },
];

export function RefreshOverdueButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await refreshOverdueAction();
        setBusy(false);
        if (r.ok) {
          const d = r.data as { overdue: number; reminders: number };
          toast.success(`${d.overdue} invoice(s) flagged overdue, ${d.reminders} reminder(s) sent`);
          router.refresh();
        } else toast.error(r.error);
      }}
    >
      <RefreshCw /> Check overdue
    </Button>
  );
}

type InvoiceInfo = { id: string; number: string | null; status: string; balance: string; currency: string; payer: string; payerLabel: string; email: string | null; hasPayments: boolean };

export function InvoiceActions({ inv, perms }: { inv: InvoiceInfo; perms: { issue: boolean; pay: boolean; credit: boolean } }) {
  const router = useRouter();
  const open = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" size="sm" asChild>
        <a href={`/api/invoices/${inv.id}/pdf`}>
          <Download /> PDF
        </a>
      </Button>
      <Button variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer /> Print
      </Button>
      {perms.issue && inv.status === "DRAFT" && (
        <>
          <ConfirmAction
            label="Delete draft"
            icon={<Trash2 />}
            title="Delete this draft invoice?"
            description="Any spots on it become billable again."
            confirmLabel="Delete"
            danger
            action={() => deleteDraftInvoiceAction(inv.id)}
            onDone={() => router.push("/invoices")}
          />
          <ConfirmAction
            label="Issue invoice"
            icon={<Send />}
            variant="default"
            title="Issue this invoice?"
            description="It gets the next invoice number and a due date from the payer's credit terms. Issued invoices cannot be edited; corrections are made with credit notes."
            confirmLabel="Issue"
            action={() => issueInvoiceAction(inv.id)}
          />
        </>
      )}
      {perms.issue && !["DRAFT", "CANCELLED"].includes(inv.status) && <EmailButton id={inv.id} defaultTo={inv.email} />}
      {perms.pay && open && (
        <FormDialog
          trigger={
            <Button size="sm">
              <Wallet /> Record payment
            </Button>
          }
          title={`Record payment for ${inv.number}`}
          description={`From ${inv.payerLabel}. Outstanding ${formatMoney(inv.balance, inv.currency)}. Any amount above the balance stays unallocated on the payment.`}
          action={recordPaymentAction}
          submitLabel="Record payment"
        >
          <input type="hidden" name="payer" value={inv.payer} />
          <input type="hidden" name="invoiceId" value={inv.id} />
          <input type="hidden" name="currency" value={inv.currency} />
          <div className="grid grid-cols-2 gap-3">
            <Field name="amount" label={`Amount (${inv.currency})`} defaultValue={inv.balance} inputMode="decimal" />
            <Field name="receivedAt" label="Received on" type="date" defaultValue={today} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField name="method" label="Method" options={PAYMENT_METHODS} defaultValue="BANK_TRANSFER" />
            <Field name="reference" label="Reference" placeholder="Bank ref. or cheque no." />
          </div>
          <TextareaField name="notes" label="Notes (optional)" rows={2} />
        </FormDialog>
      )}
      {perms.credit && open && (
        <FormDialog
          trigger={
            <Button size="sm" variant="secondary">
              <FileMinus /> Credit note
            </Button>
          }
          title={`Credit note against ${inv.number}`}
          description={`Reduces the balance (${formatMoney(inv.balance, inv.currency)} outstanding). The credit is recorded in the ledger with its own number.`}
          action={creditNoteAction}
          submitLabel="Issue credit note"
        >
          <input type="hidden" name="invoiceId" value={inv.id} />
          <Field name="amount" label={`Amount (${inv.currency})`} inputMode="decimal" />
          <TextareaField name="reason" label="Reason" rows={2} placeholder="e.g. Make-good for missed spot on 12 Oct" />
        </FormDialog>
      )}
      {perms.issue && !["DRAFT", "CANCELLED"].includes(inv.status) && !inv.hasPayments && (
        <ConfirmAction
          label="Cancel"
          icon={<Ban />}
          title={`Cancel invoice ${inv.number}?`}
          description="The number stays used and the cancellation is recorded in the ledger. Spots on it become billable again."
          confirmLabel="Cancel invoice"
          reason="required"
          danger
          action={(reason) => cancelInvoiceAction(inv.id, reason)}
        />
      )}
    </div>
  );
}

function EmailButton({ id, defaultTo }: { id: string; defaultTo: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState(defaultTo ?? "");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Email invoice"
      description="Sends the invoice PDF and, if there is a balance, the online payment link."
      trigger={
        <Button size="sm" variant="secondary">
          <Mail /> Email
        </Button>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="email-to">Send to</Label>
          <Input id="email-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await emailInvoiceAction(id, to);
              setBusy(false);
              if (r.ok) {
                toast.success(r.message ?? "Sent");
                setOpen(false);
              } else toast.error(r.error);
            }}
          >
            Send
          </Button>
        </FormActions>
      </div>
    </Dialog>
  );
}

export function ReverseAllocation({ id, label }: { id: string; label: string }) {
  return (
    <ConfirmAction
      label="Reverse"
      variant="ghost"
      title={`Reverse allocation of ${label}?`}
      description="The amount goes back to the payment as unallocated and the invoice balance increases. This is recorded in the ledger."
      confirmLabel="Reverse"
      reason="required"
      danger
      action={(reason) => removeAllocationAction(id, reason)}
    />
  );
}

type Opt = { value: string; label: string };
export function ManualInvoiceForm({ id, clients, agencies, currency, taxPct, taxBase, initial }: { id: string | null; taxBase: TaxBase; clients: (Opt & { agencyId: string | null })[]; agencies: (Opt & { commissionPct: string })[]; currency: string; taxPct: string; initial?: { clientId: string; agencyId: string | null; currency: string; notes: string | null; lines: Line[] } }) {
  const [clientId, setClientId] = React.useState(initial?.clientId ?? "");
  const [agencyId, setAgencyId] = React.useState(initial?.agencyId ?? "");
  const commission = agencies.find((a) => a.value === agencyId)?.commissionPct ?? "0";
  const blank = (): Line => ({ description: "", quantity: "1", unitPrice: "", discountPct: "0", commissionPct: commission, taxRatePct: taxPct });
  return (
    <ActionForm action={saveManualInvoiceAction.bind(null, id)} redirectTo={(d) => `/invoices/${(d as { id: string }).id}`} successMessage="Draft saved">
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField
          name="clientId"
          label="Client"
          placeholder="Choose client"
          options={clients}
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            const c = clients.find((x) => x.value === e.target.value);
            if (c?.agencyId) setAgencyId(c.agencyId);
          }}
        />
        <SelectField name="agencyId" label="Bill via agency (optional)" placeholder="Direct to client" options={agencies} value={agencyId} onChange={(e) => setAgencyId(e.target.value)} />
        <Field name="currency" label="Currency" defaultValue={initial?.currency ?? currency} maxLength={3} />
      </div>
      <div>
        <Label>Lines</Label>
        <LinesEditor
          name="lines"
          initial={initial?.lines ?? []}
          blank={blank}
          columns={[
            { key: "description", label: "Description", width: "34%" },
            { key: "quantity", label: "Qty", type: "money", width: "8%" },
            { key: "unitPrice", label: "Unit price", type: "money", width: "12%" },
            { key: "discountPct", label: "Disc %", type: "money", width: "9%" },
            { key: "commissionPct", label: "Comm %", type: "money", width: "9%" },
            { key: "taxRatePct", label: "Tax %", type: "money", width: "9%" },
          ]}
          summary={(lines) => {
            try {
              const t = computeTotals(lines.map((l) => computeLine({ quantity: String(l.quantity || 0), unitPrice: String(l.unitPrice || 0), discountPct: String(l.discountPct || 0), commissionPct: String(l.commissionPct || 0), taxRatePct: String(l.taxRatePct || 0) }, taxBase)));
              return (
                <div className="tabular">
                  Gross {formatMoney(t.grossAmount, currency)} · Discount {formatMoney(t.discountAmount, currency)} · Commission {formatMoney(t.commissionAmount, currency)} · Tax {formatMoney(t.taxAmount, currency)}
                  <p className="text-sm font-semibold">Total {formatMoney(t.totalAmount, currency)}</p>
                  <p className="text-[11px] text-muted">Preview; the server recalculates on save.</p>
                </div>
              );
            } catch {
              return <span className="text-muted">Enter numbers to see totals</span>;
            }
          }}
        />
      </div>
      <TextareaField name="notes" label="Notes shown on the invoice" rows={2} defaultValue={initial?.notes ?? ""} />
      <FormActions>
        <SubmitButton>Save draft</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

