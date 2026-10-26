"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Field, SelectField, CheckboxField } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { FormError } from "@/components/forms/action-form";
import { saveCampaignAction, assignPromoAction, previewAutofillAction, applyAutofillAction } from "@/app/actions/promos";
import type { AutofillPlan } from "@/lib/promos/autofill";

type Opt = { value: string; label: string };
type Campaign = { id: string; name: string; startDate: string; endDate: string; priority: string; rotation: string; channelIds: string[]; windowStart: string; windowEnd: string; minPlays: string; maxPlays: string; maxPerDay: string; minGapSec: string; isActive: boolean };

export function CampaignDialog({ campaign: c, channels }: { campaign?: Campaign; channels: Opt[] }) {
  return (
    <FormDialog
      trigger={
        c ? (
          <Button size="sm" variant="secondary">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New campaign
          </Button>
        )
      }
      title={c ? `Edit ${c.name}` : "New promo campaign"}
      action={saveCampaignAction.bind(null, c?.id ?? null)}
      wide
    >
      <Field name="name" label="Name" defaultValue={c?.name} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field name="startDate" label="Start" type="date" defaultValue={c?.startDate} />
        <Field name="endDate" label="End" type="date" defaultValue={c?.endDate} />
        <SelectField name="priority" label="Priority" options={["LOW", "NORMAL", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.toLowerCase() }))} defaultValue={c?.priority ?? "NORMAL"} />
        <SelectField name="rotation" label="Rotation" options={[{ value: "EVEN", label: "Even" }, { value: "WEIGHTED", label: "Weighted" }, { value: "SEQUENTIAL", label: "Sequential" }]} defaultValue={c?.rotation ?? "EVEN"} />
        <Field name="windowStart" label="Window from (local)" placeholder="HH:MM" defaultValue={c?.windowStart} />
        <Field name="windowEnd" label="Window to" placeholder="HH:MM" defaultValue={c?.windowEnd} />
        <Field name="maxPerDay" label="Max per day" type="number" defaultValue={c?.maxPerDay} />
        <Field name="minGapSec" label="Min seconds apart" type="number" defaultValue={c?.minGapSec} />
        <Field name="minPlays" label="Min plays (period)" type="number" defaultValue={c?.minPlays} />
        <Field name="maxPlays" label="Max plays (period)" type="number" defaultValue={c?.maxPlays} />
      </div>
      <div>
        <Label>Channels</Label>
        <p className="mb-1 text-xs text-muted">None ticked means every channel.</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {channels.map((ch) => (
            <label key={ch.value} className="flex items-center gap-1.5">
              <input type="checkbox" name="channelIds" value={ch.value} defaultChecked={c?.channelIds.includes(ch.value)} /> {ch.label}
            </label>
          ))}
        </div>
      </div>
      <CheckboxField name="isActive" label="Active" defaultChecked={c?.isActive ?? true} />
    </FormDialog>
  );
}

export function AssignPromo({ assetId, value, campaigns }: { assetId: string; value: string; campaigns: Opt[] }) {
  const router = useRouter();
  return (
    <Select
      defaultValue={value}
      className="h-8 text-xs"
      aria-label="Campaign"
      onChange={async (e) => {
        const r = await assignPromoAction(assetId, e.target.value || null);
        if (r.ok) {
          toast.success(r.message ?? "Saved");
          router.refresh();
        } else toast.error(r.error);
      }}
    >
      <option value="">No campaign</option>
      {campaigns.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

export function AutofillPanel({ channels, defaultChannel, defaultDate, campaigns, canEdit }: { channels: (Opt & { tz: string })[]; defaultChannel: string; defaultDate: string; campaigns: Opt[]; canEdit: boolean }) {
  const router = useRouter();
  const [channelId, setChannel] = React.useState(defaultChannel);
  const [date, setDate] = React.useState(defaultDate);
  const [campaignId, setCampaign] = React.useState("");
  const [plan, setPlan] = React.useState<AutofillPlan | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [skipped, setSkipped] = React.useState<{ startAt: string; reason: string }[]>([]);

  async function preview() {
    setBusy(true);
    setErr(null);
    setSkipped([]);
    const r = await previewAutofillAction({ channelId, date, campaignIds: campaignId ? [campaignId] : undefined });
    setBusy(false);
    if (r.ok && r.data) {
      setPlan(r.data);
      setSelected(new Set(r.data.placements.map((_, i) => i)));
    } else if (!r.ok) setErr(r.error);
  }
  async function apply(confirmPublishedEdit = false) {
    if (!plan) return;
    setBusy(true);
    const r = await applyAutofillAction({ channelId, placements: plan.placements.filter((_, i) => selected.has(i)).map((p) => ({ assetId: p.assetId, startAt: p.startAt })), confirmPublishedEdit });
    setBusy(false);
    if (r.ok && r.data) {
      toast.success(`${r.data.applied} promo(s) added to the schedule${r.data.skipped.length ? `, ${r.data.skipped.length} skipped` : ""}`);
      setSkipped(r.data.skipped);
      setPlan(null);
      router.refresh();
    } else if (!r.ok) {
      if (r.code === "CONFIRM_PUBLISHED_EDIT" && window.confirm(`${r.error}\n\nApply anyway?`)) return apply(true);
      setErr(r.error);
    }
  }
  const tz = channels.find((c) => c.value === channelId)?.tz ?? "UTC";
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
  return (
    <Card>
      <CardHeader title="Promo auto-fill" description="Fills free gaps on the primary schedule with promos from active campaigns, respecting priority, rotation, windows, daily limits and separation. Review the proposal, untick anything you don't want, then apply." />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="af-ch">Channel</Label>
            <Select id="af-ch" value={channelId} onChange={(e) => setChannel(e.target.value)}>
              {channels.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="af-date">Broadcast date</Label>
            <Input id="af-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label htmlFor="af-camp">Campaign</Label>
            <Select id="af-camp" value={campaignId} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All active campaigns</option>
              {campaigns.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={preview} disabled={busy}>
            <Wand2 /> Preview
          </Button>
        </div>
        {err && <FormError message={err} />}
        {plan && (
          <div className="space-y-2">
            <p className="text-sm">
              {plan.gaps} free gap(s) totalling {Math.round(plan.gapSeconds)}s; the proposal fills {plan.filledSeconds}s with {plan.placements.length} promo(s).
            </p>
            {plan.notes.map((n, i) => (
              <p key={i} className="text-xs text-muted">
                {n}
              </p>
            ))}
            {plan.placements.length > 0 && (
              <>
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                      <tr>
                        <th className="w-8 px-2 py-1.5">
                          <input type="checkbox" aria-label="Select all" checked={selected.size === plan.placements.length} onChange={(e) => setSelected(e.target.checked ? new Set(plan.placements.map((_, i) => i)) : new Set())} />
                        </th>
                        <th className="px-2 py-1.5">Time (channel)</th>
                        <th className="px-2 py-1.5">Promo</th>
                        <th className="px-2 py-1.5">Campaign</th>
                        <th className="px-2 py-1.5 text-right">Length</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.placements.map((p, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1">
                            <input type="checkbox" aria-label={`Include ${p.title} at ${fmt(p.startAt)}`} checked={selected.has(i)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                          </td>
                          <td className="px-2 py-1 font-mono">{fmt(p.startAt)}</td>
                          <td className="px-2 py-1">{p.title}</td>
                          <td className="px-2 py-1 text-muted">{p.campaign}</td>
                          <td className="px-2 py-1 text-right">{p.durationSec}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => apply()} disabled={busy || !selected.size || !canEdit}>
                    Apply {selected.size} placement(s)
                  </Button>
                  <Button variant="secondary" onClick={() => setPlan(null)}>
                    Discard
                  </Button>
                  {!canEdit && <span className="self-center text-xs text-muted">Applying needs schedule edit permission.</span>}
                </div>
              </>
            )}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="text-xs">
            <p className="font-medium">Skipped by the scheduling rules:</p>
            {skipped.slice(0, 10).map((s, i) => (
              <p key={i} className="text-muted">
                {fmt(s.startAt)}: {s.reason}
              </p>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
