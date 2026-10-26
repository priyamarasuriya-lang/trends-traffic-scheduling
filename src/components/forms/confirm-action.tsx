"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { FormError } from "./action-form";

/**
 * A button that asks for confirmation (and optionally a reason) before running
 * a server action. Used for approvals, cancellations, deletes and publishing.
 */
export function ConfirmAction({
  label,
  title,
  description,
  action,
  confirmLabel = "Confirm",
  variant = "secondary",
  size = "sm",
  reason,
  icon,
  danger,
  onDone,
}: {
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action: (reason: string) => Promise<ActionResult<unknown>>;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  reason?: "required" | "optional";
  icon?: React.ReactNode;
  danger?: boolean;
  onDone?: (data: unknown) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ error: string; details?: unknown } | null>(null);
  const router = useRouter();
  async function go() {
    if (reason === "required" && !text.trim()) {
      setErr({ error: "Please give a reason." });
      return;
    }
    setBusy(true);
    const r = await action(text);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message ?? "Done");
      setOpen(false);
      setText("");
      setErr(null);
      onDone?.(r.data);
      router.refresh();
    } else {
      setErr({ error: r.error, details: r.details });
      toast.error(r.error);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setErr(null);
      }}
      title={title}
      trigger={
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      }
    >
      <div className="space-y-3">
        {description && <div className="text-sm text-muted">{description}</div>}
        {err && <FormError message={err.error} details={err.details} />}
        {reason && (
          <div>
            <Label htmlFor="confirm-reason">{reason === "required" ? "Reason (required)" : "Comment (optional)"}</Label>
            <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "default"} disabled={busy} onClick={go}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
