"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Ctx = { errors: Record<string, string[] | undefined>; pending: boolean };
const FormCtx = React.createContext<Ctx>({ errors: {}, pending: false });

export type FormAction = (fd: FormData) => Promise<ActionResult<unknown>>;

/** Wraps a server action: shows field errors inline, toasts success/failure, refreshes data. */
export function ActionForm({
  action,
  children,
  onSuccess,
  successMessage,
  className,
  redirectTo,
  resetOnSuccess,
}: {
  action: FormAction;
  children: React.ReactNode;
  onSuccess?: (data: unknown) => void;
  successMessage?: string;
  className?: string;
  redirectTo?: (data: unknown) => string | null;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<Ctx & { error?: string; details?: unknown }>({ errors: {}, pending: false });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState({ errors: {}, pending: true });
    const res = await action(new FormData(form));
    if (res.ok) {
      setState({ errors: {}, pending: false });
      toast.success(res.message ?? successMessage ?? "Saved");
      if (resetOnSuccess) form.reset();
      onSuccess?.(res.data);
      const to = redirectTo?.(res.data);
      if (to) router.push(to);
      else router.refresh();
    } else {
      setState({ errors: res.fieldErrors ?? {}, pending: false, error: res.error, details: res.details });
      toast.error(res.error);
    }
  }
  return (
    <FormCtx.Provider value={state}>
      <form onSubmit={submit} className={cn("space-y-3", className)} noValidate>
        {state.error && <FormError message={state.error} details={state.details} />}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function FormError({ message, details }: { message: string; details?: unknown }) {
  const v = (details as { violations?: { message: string; severity: string }[] } | undefined)?.violations;
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      {v && v.length > 1 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-8 text-xs">
          {v.map((x, i) => (
            <li key={i}>
              [{x.severity}] {x.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function useFieldError(name: string) {
  return React.useContext(FormCtx).errors[name]?.[0];
}

type FieldProps = { name: string; label: string; hint?: string; className?: string };

export function Field({ name, label, hint, className, ...p }: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  const err = useFieldError(name);
  return (
    <div className={className}>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Input id={`f-${name}`} name={name} aria-invalid={!!err} className={err ? "border-danger" : ""} {...p} />
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SelectField({ name, label, hint, className, options, placeholder, ...p }: FieldProps & React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const err = useFieldError(name);
  return (
    <div className={className}>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Select id={`f-${name}`} name={name} aria-invalid={!!err} className={err ? "border-danger" : ""} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextareaField({ name, label, hint, className, ...p }: FieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const err = useFieldError(name);
  return (
    <div className={className}>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Textarea id={`f-${name}`} name={name} {...p} />
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children, variant, className }: { children: React.ReactNode; variant?: "default" | "danger" | "secondary"; className?: string }) {
  const { pending } = React.useContext(FormCtx);
  return (
    <Button type="submit" disabled={pending} variant={variant} className={className}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-border pt-3">{children}</div>;
}
