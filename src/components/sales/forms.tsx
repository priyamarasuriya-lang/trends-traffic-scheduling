"use client";
import * as React from "react";
import { ActionForm, Field, SelectField, TextareaField, FormActions, SubmitButton } from "@/components/forms/action-form";
import { LinesEditor, type Line } from "@/components/forms/lines-editor";
import { saveDealAction, saveROAction } from "@/app/actions/sales";
import { computeLine, computeTotals } from "@/lib/billing/calc";
import { formatMoney } from "@/lib/money";

type Opt = { value: string; label: string };
type FormInitial = { clientId?: string; agencyId?: string; dealId?: string; campaignName?: string; startDate?: string; endDate?: string; currency?: string; discountPct?: string; commissionPct?: string; taxRatePct?: string; clientRef?: string; notes?: string; lines?: Line[] };
export type SalesOptions = { clients: (Opt & { agencyId: string | null })[]; agencies: (Opt & { commissionPct: string })[]; channels: Opt[]; commercials: (Opt & { advertiserId: string | null; durationSec: number })[]; deals: (Opt & { clientId: string })[]; currency: string; taxPct: string };

const BANDS = [
  { value: "PRIME", label: "Prime" },
  { value: "DAY", label: "Day" },
  { value: "LATE", label: "Late" },
  { value: "ANY", label: "Any" },
];

function useAgencyCommission(opts: SalesOptions, initialClient: string, initialAgency: string) {
  const [clientId, setClientId] = React.useState(initialClient);
  const [agencyId, setAgencyId] = React.useState(initialAgency);
  return { clientId, setClientId, agencyId, setAgencyId, defaultCommission: opts.agencies.find((a) => a.value === agencyId)?.commissionPct ?? "0" };
}

function safeMoney(fn: () => string) {
  try {
    return fn();
  } catch {
    return "—";
  }
}

export function DealForm({ id, opts, initial }: { id: string | null; opts: SalesOptions; initial?: FormInitial }) {
  const st = useAgencyCommission(opts, initial?.clientId ?? "", initial?.agencyId ?? "");
  const [commission, setCommission] = React.useState(initial?.commissionPct ?? "0");
  const [discount, setDiscount] = React.useState(initial?.discountPct ?? "0");
  const [tax, setTax] = React.useState(initial?.taxRatePct ?? opts.taxPct);
  return (
    <ActionForm action={saveDealAction.bind(null, id)} redirectTo={(d) => `/deals/${(d as { id: string }).id}`}>
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField
          name="clientId"
          label="Advertiser (client)"
          options={opts.clients}
          placeholder="Choose…"
          value={st.clientId}
          onChange={(e) => {
            st.setClientId(e.target.value);
            const ag = opts.clients.find((c) => c.value === e.target.value)?.agencyId ?? "";
            st.setAgencyId(ag);
            setCommission(opts.agencies.find((a) => a.value === ag)?.commissionPct ?? "0");
          }}
        />
        <SelectField
          name="agencyId"
          label="Agency"
          options={opts.agencies}
          placeholder="Direct (no agency)"
          value={st.agencyId}
          onChange={(e) => {
            st.setAgencyId(e.target.value);
            setCommission(opts.agencies.find((a) => a.value === e.target.value)?.commissionPct ?? "0");
          }}
        />
        <Field name="campaignName" label="Campaign" defaultValue={initial?.campaignName} />
        <Field name="startDate" label="Campaign start" type="date" defaultValue={initial?.startDate} />
        <Field name="endDate" label="Campaign end" type="date" defaultValue={initial?.endDate} />
        <Field name="currency" label="Currency" defaultValue={initial?.currency ?? opts.currency} maxLength={3} />
        <Field name="discountPct" label="Deal discount %" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <Field name="commissionPct" label="Agency commission %" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <Field name="taxRatePct" label="Tax %" value={tax} onChange={(e) => setTax(e.target.value)} hint="Configured per client/jurisdiction" />
      </div>
      <LinesEditor
        name="lines"
        initial={initial?.lines ?? []}
        blank={() => ({ channelId: opts.channels[0]?.value ?? "", product: "30s spot", timeBand: "PRIME", spotDurationSec: 30, quantity: 10, rate: "0.00", discountPct: "0" })}
        columns={[
          { key: "channelId", label: "Channel", type: "select", options: opts.channels, width: "120px" },
          { key: "product", label: "Product" },
          { key: "timeBand", label: "Band", type: "select", options: BANDS, width: "90px" },
          { key: "spotDurationSec", label: "Dur (s)", type: "number", width: "70px" },
          { key: "quantity", label: "Qty", type: "number", width: "70px" },
          { key: "rate", label: "Rate / spot", type: "money", width: "100px" },
          { key: "discountPct", label: "Disc %", type: "money", width: "70px" },
        ]}
        summary={(lines) =>
          safeMoney(() => {
            const t = computeTotals(lines.map((l) => computeLine({ quantity: String(l.quantity || 0), unitPrice: String(l.rate || 0), discountPct: String(Number(l.discountPct || 0) + Number(discount || 0)), commissionPct: commission || 0, taxRatePct: tax || 0 })));
            return `Gross ${formatMoney(t.grossAmount)} · Net ${formatMoney(t.netAmount)} · Commission ${formatMoney(t.commissionAmount)} · Tax ${formatMoney(t.taxAmount)} · Total ${formatMoney(t.totalAmount)}`;
          })
        }
      />
      <TextareaField name="notes" label="Notes" defaultValue={initial?.notes} />
      <FormActions>
        <SubmitButton>{id ? "Save deal" : "Create deal"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function ROForm({ id, opts, initial }: { id: string | null; opts: SalesOptions; initial?: FormInitial }) {
  const st = useAgencyCommission(opts, initial?.clientId ?? "", initial?.agencyId ?? "");
  const [commission, setCommission] = React.useState(initial?.commissionPct ?? "0");
  const [tax, setTax] = React.useState(initial?.taxRatePct ?? opts.taxPct);
  const [start, setStart] = React.useState(initial?.startDate ?? "");
  const [end, setEnd] = React.useState(initial?.endDate ?? "");
  const material = opts.commercials.filter((c) => !st.clientId || !c.advertiserId || c.advertiserId === st.clientId);
  return (
    <ActionForm action={saveROAction.bind(null, id)} redirectTo={(d) => `/release-orders/${(d as { id: string }).id}`}>
      <div className="grid gap-3 md:grid-cols-4">
        <SelectField
          name="clientId"
          label="Advertiser (client)"
          options={opts.clients}
          placeholder="Choose…"
          value={st.clientId}
          onChange={(e) => {
            st.setClientId(e.target.value);
            const ag = opts.clients.find((c) => c.value === e.target.value)?.agencyId ?? "";
            st.setAgencyId(ag);
            setCommission(opts.agencies.find((a) => a.value === ag)?.commissionPct ?? "0");
          }}
        />
        <SelectField
          name="agencyId"
          label="Agency"
          options={opts.agencies}
          placeholder="Direct (no agency)"
          value={st.agencyId}
          onChange={(e) => {
            st.setAgencyId(e.target.value);
            setCommission(opts.agencies.find((a) => a.value === e.target.value)?.commissionPct ?? "0");
          }}
        />
        <SelectField name="dealId" label="Deal" options={opts.deals.filter((d) => !st.clientId || d.clientId === st.clientId)} placeholder="No deal" defaultValue={initial?.dealId} />
        <Field name="clientRef" label="Agency RO / PO ref." defaultValue={initial?.clientRef} />
        <Field name="campaignName" label="Campaign" defaultValue={initial?.campaignName} className="md:col-span-2" />
        <Field name="startDate" label="Campaign start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field name="endDate" label="Campaign end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Field name="currency" label="Currency" defaultValue={initial?.currency ?? opts.currency} maxLength={3} />
        <Field name="commissionPct" label="Agency commission %" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <Field name="taxRatePct" label="Tax %" value={tax} onChange={(e) => setTax(e.target.value)} />
      </div>
      <LinesEditor
        name="lines"
        initial={initial?.lines ?? []}
        blank={() => ({ channelId: opts.channels[0]?.value ?? "", assetId: "", description: "30s spot", timeBand: "PRIME", spotDurationSec: 30, quantity: 5, rate: "0.00", discountPct: "0", startDate: start, endDate: end, maxPerDay: "" })}
        columns={[
          { key: "channelId", label: "Channel", type: "select", options: opts.channels, width: "100px" },
          { key: "assetId", label: "Commercial", type: "select", options: material.map((m) => ({ value: m.value, label: `${m.label} (${m.durationSec}s)` })), placeholder: "Material later" },
          { key: "description", label: "Description" },
          { key: "timeBand", label: "Band", type: "select", options: BANDS, width: "80px" },
          { key: "spotDurationSec", label: "Dur", type: "number", width: "60px" },
          { key: "quantity", label: "Qty", type: "number", width: "60px" },
          { key: "rate", label: "Rate", type: "money", width: "90px" },
          { key: "discountPct", label: "Disc %", type: "money", width: "60px" },
          { key: "startDate", label: "From", type: "date", width: "130px" },
          { key: "endDate", label: "To", type: "date", width: "130px" },
          { key: "maxPerDay", label: "Max/day", type: "number", width: "60px" },
        ]}
        summary={(lines) =>
          safeMoney(() => {
            const t = computeTotals(lines.map((l) => computeLine({ quantity: String(l.quantity || 0), unitPrice: String(l.rate || 0), discountPct: String(l.discountPct || 0), commissionPct: commission || 0, taxRatePct: tax || 0 })));
            return `Gross ${formatMoney(t.grossAmount)} · Discount ${formatMoney(t.discountAmount)} · Commission ${formatMoney(t.commissionAmount)} · Tax ${formatMoney(t.taxAmount)} · Total ${formatMoney(t.totalAmount)}`;
          })
        }
      />
      <TextareaField name="notes" label="Notes" defaultValue={initial?.notes} />
      <FormActions>
        <SubmitButton>{id ? "Save release order" : "Create release order"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
