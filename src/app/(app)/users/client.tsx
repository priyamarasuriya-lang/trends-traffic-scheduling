"use client";
import { KeyRound, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField, CheckboxField, CheckGroup } from "@/components/forms/action-form";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { saveUserAction, sendPasswordLinkAction, revokeSessionsAction, saveRoleAction, deleteRoleAction } from "@/app/actions/admin";

type Opt = { value: string; label: string; hint?: string };
export type UserRec = { id: string; email: string; name: string; status: string; allChannels: boolean; roleIds: string[]; channelIds: string[] };
const STATUS = ["ACTIVE", "SUSPENDED", "LOCKED", "DISABLED"].map((s) => ({ value: s, label: s.toLowerCase() }));

export function UserDialog({ u, roles, channels }: { u?: UserRec; roles: Opt[]; channels: Opt[] }) {
  return (
    <FormDialog
      wide
      trigger={u ? <Button size="icon" variant="ghost" aria-label={`Edit ${u.name}`}><Pencil /></Button> : <Button><Plus /> New user</Button>}
      title={u ? `Edit ${u.name}` : "New user"}
      description={u ? "Suspending, disabling or changing the password signs the user out everywhere." : "Either set an initial password now or email the user a link to choose their own (valid 72 hours)."}
      action={saveUserAction.bind(null, u?.id ?? null)}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field name="name" label="Full name" defaultValue={u?.name} />
        <Field name="email" label="Email" type="email" defaultValue={u?.email} />
        <SelectField name="status" label="Status" options={STATUS} defaultValue={u?.status ?? "ACTIVE"} />
        <Field name="password" label={u ? "New password (optional)" : "Initial password"} type="password" autoComplete="new-password" hint="At least 12 characters with letters and numbers." className="col-span-2" />
        <div className="pt-6">
          <CheckboxField name="sendInvite" label={u ? "Email a set-password link" : "Email an invitation"} defaultChecked={!u} />
        </div>
      </div>
      <CheckGroup name="roleIds" label="Roles" options={roles} columns={2} defaultValue={u?.roleIds ?? []} />
      <CheckboxField name="allChannels" label="Access to all channels" defaultChecked={u?.allChannels} hint="Otherwise the user only sees the channels ticked below." />
      <CheckGroup name="channelIds" label="Channels" options={channels} columns={3} defaultValue={u?.channelIds ?? []} />
    </FormDialog>
  );
}

export function UserRowActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      {active && <ConfirmAction label={<KeyRound className="size-4" />} variant="ghost" title={`Send ${name} a password link?`} description="They receive an email with a single-use link valid for 24 hours. Their current password keeps working until they use it." confirmLabel="Send link" action={() => sendPasswordLinkAction(id)} />}
      <ConfirmAction label={<LogOut className="size-4" />} variant="ghost" title={`Sign ${name} out everywhere?`} description="All of this user's active sessions end immediately." confirmLabel="Sign out" action={() => revokeSessionsAction(id)} />
    </div>
  );
}

export type RoleRec = { id: string; key: string; name: string; description: string | null; permissions: string[]; isSystem: boolean };

export function RoleDialog({ r, groups }: { r?: RoleRec; groups: { area: string; options: Opt[] }[] }) {
  return (
    <FormDialog
      wide
      trigger={r ? <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`}><Pencil /></Button> : <Button variant="secondary"><Plus /> New role</Button>}
      title={r ? `Edit role: ${r.name}` : "New role"}
      description="Changes apply to every user with this role on their next request."
      action={saveRoleAction.bind(null, r?.id ?? null)}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field name="name" label="Name" defaultValue={r?.name} />
        <Field name="description" label="Description" defaultValue={r?.description ?? ""} className="col-span-2" />
      </div>
      <div className="grid max-h-[50vh] grid-cols-2 gap-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <CheckGroup key={g.area} name="permissions" label={g.area} options={g.options} columns={1} defaultValue={r?.permissions ?? []} />
        ))}
      </div>
    </FormDialog>
  );
}

export function DeleteRole({ id, name }: { id: string; name: string }) {
  return <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" danger title={`Delete role ${name}?`} description="Only custom roles with no users can be deleted." confirmLabel="Delete" action={() => deleteRoleAction(id)} />;
}
