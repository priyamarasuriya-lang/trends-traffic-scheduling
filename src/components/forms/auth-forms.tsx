"use client";
import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { loginAction, requestResetAction, resetPasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      {state.message}
    </p>
  ) : (
    <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
      {state.error}
    </p>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <Msg state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, null);
  return (
    <form action={action} className="space-y-4">
      <Msg state={state} />
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <Msg state={state} />
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <p className="mt-1 text-xs text-muted">At least 10 characters with letters and digits.</p>
      </div>
      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
      {state?.ok && (
        <p className="text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Go to sign in
          </Link>
        </p>
      )}
    </form>
  );
}
