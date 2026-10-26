"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, trigger, title, description, children, wide }: { open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: React.ReactNode; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}>
          <div className="flex items-start justify-between border-b border-border px-5 py-3">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
