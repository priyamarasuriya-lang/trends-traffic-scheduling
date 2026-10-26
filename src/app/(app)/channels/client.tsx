"use client";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, CheckboxField, CheckGroup } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { saveChannelAction } from "@/app/actions/admin";

type Opt = { value: string; label: string };
export type ChannelRec = { id: string; code: string; name: string; timezone: string; broadcastDayStartHour: number; broadcastDays: number[]; color: string; territory: string | null; isActive: boolean; userIds: string[]; hasEvents: boolean };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((l, i) => ({ value: String(i), label: l }));
const HOURS = Array.from({ length: 13 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

export function ChannelDialog({ ch, users, zones, defaultTz }: { ch?: ChannelRec; users: Opt[]; zones: string[]; defaultTz: string }) {
  return (
    <FormDialog
      wide
      trigger={ch ? <Button size="icon" variant="ghost" aria-label={`Edit ${ch.code}`}><Pencil /></Button> : <Button><Plus /> New channel</Button>}
      title={ch ? `Edit ${ch.name}` : "New channel"}
      description={ch?.hasEvents ? "This channel has schedule events, so its time zone and broadcast-day start are locked." : "Time zone and broadcast-day start define how schedules map to real time. They lock once the first event is scheduled."}
      action={saveChannelAction.bind(null, ch?.id ?? null)}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field name="code" label="Code" defaultValue={ch?.code} maxLength={12} />
        <Field name="name" label="Name" defaultValue={ch?.name} className="col-span-2" />
        <div>
          <Field name="timezone" label="Time zone (IANA)" defaultValue={ch?.timezone ?? defaultTz} list="tz-list" readOnly={ch?.hasEvents} />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
        <SelectField name="broadcastDayStartHour" label="Broadcast day starts" options={HOURS} defaultValue={String(ch?.broadcastDayStartHour ?? 6)} disabled={ch?.hasEvents} />
        {ch?.hasEvents && <input type="hidden" name="broadcastDayStartHour" value={ch.broadcastDayStartHour} />}
        <Field name="territory" label="Territory" defaultValue={ch?.territory ?? ""} />
        <Field name="color" label="Colour" type="color" defaultValue={ch?.color ?? "#0ea5e9"} className="[&_input]:h-9 [&_input]:p-1" />
      </div>
      <CheckGroup name="broadcastDays" label="On-air days" options={DAYS} columns={7} defaultValue={(ch?.broadcastDays ?? [0, 1, 2, 3, 4, 5, 6]).map(String)} />
      <CheckboxField name="isActive" label="Active" defaultChecked={ch?.isActive ?? true} hint="Inactive channels are hidden from scheduling and booking." />
      <CheckGroup name="userIds" label="Assigned users" options={users} columns={3} defaultValue={ch?.userIds ?? []} hint="Users with “all channels” access see every channel regardless." />
    </FormDialog>
  );
}
