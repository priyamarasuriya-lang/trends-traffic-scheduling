"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UploadButton({ entityType, entityId, label = "Attach", accept, onUploaded }: { entityType: string; entityId: string; label?: string; accept?: string; onUploaded?: (id: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={accept}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const fd = new FormData();
          fd.set("entityType", entityType);
          fd.set("entityId", entityId);
          fd.set("file", file);
          const r = await fetch("/api/files", { method: "POST", body: fd });
          const j = await r.json();
          setBusy(false);
          e.target.value = "";
          if (!r.ok) toast.error(j.error ?? "Upload failed");
          else {
            toast.success(`Uploaded ${file.name}${j.scanStatus === "NOT_SCANNED" ? " (no virus scanner configured)" : ""}`);
            onUploaded?.(j.id);
            router.refresh();
          }
        }}
      />
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => ref.current?.click()}>
        <Paperclip /> {busy ? "Uploading…" : label}
      </Button>
    </>
  );
}
