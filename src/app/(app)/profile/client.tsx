"use client";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/forms/action-form";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { changePasswordAction } from "@/app/actions/auth";
import { signOutOtherSessionsAction, markNotificationsReadAction } from "@/app/actions/shell";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess>
      <Field name="current" label="Current password" type="password" autoComplete="current-password" />
      <Field name="password" label="New password" type="password" autoComplete="new-password" hint="At least 12 characters with letters and numbers." />
      <FormActions>
        <SubmitButton>Change password</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function SignOutOthers({ count }: { count: number }) {
  return <ConfirmAction label="Sign out other sessions" title="Sign out everywhere else?" description={`${count} other session(s) will end immediately. This browser stays signed in.`} confirmLabel="Sign out" action={() => signOutOtherSessionsAction()} />;
}

export function MarkAllRead() {
  return <ConfirmAction label="Mark all read" title="Mark every notification as read?" confirmLabel="Mark read" action={() => markNotificationsReadAction()} />;
}
