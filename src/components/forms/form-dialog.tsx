"use client";
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormActions, SubmitButton, type FormAction } from "./action-form";
import { Button } from "@/components/ui/button";

/** A dialog containing an ActionForm. Closes on success. */
export function FormDialog({ trigger, title, description, action, children, submitLabel = "Save", wide, successMessage, redirectTo }: { trigger: React.ReactNode; title: string; description?: string; action: FormAction; children: React.ReactNode; submitLabel?: string; wide?: boolean; successMessage?: string; redirectTo?: (data: unknown) => string | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={title} description={description} wide={wide}>
      <ActionForm action={action} onSuccess={() => setOpen(false)} successMessage={successMessage} redirectTo={redirectTo}>
        {children}
        <FormActions>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>{submitLabel}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
