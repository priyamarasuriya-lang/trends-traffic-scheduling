"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Tv } from "lucide-react";
import { Input } from "@/components/ui/input";

export function DateJump({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Input
      type="date"
      value={date}
      aria-label="Broadcast date"
      className="w-40"
      onChange={(e) => {
        if (!e.target.value) return;
        const p = new URLSearchParams(params.toString());
        p.set("date", e.target.value);
        router.push(`${pathname}?${p.toString()}`);
      }}
    />
  );
}

export function ChannelPicker({ channels, selected }: { channels: { id: string; code: string }[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sel, setSel] = React.useState(selected);
  React.useEffect(() => setSel(selected), [selected]);
  const apply = (ids: string[]) => {
    if (!ids.length) return;
    const p = new URLSearchParams(params.toString());
    p.delete("channel");
    p.set("channels", ids.join(","));
    router.push(`${pathname}?${p.toString()}`);
  };
  return (
    <DM.Root onOpenChange={(o) => !o && sel.join() !== selected.join() && apply(sel)}>
      <DM.Trigger className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2">
        <Tv className="size-4" /> {channels.filter((c) => sel.includes(c.id)).map((c) => c.code).join(", ") || "Channels"}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg">
          <p className="px-2 py-1 text-xs text-muted">Show channels side by side</p>
          {channels.map((c) => (
            <DM.CheckboxItem
              key={c.id}
              checked={sel.includes(c.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => setSel(v ? [...sel, c.id] : sel.filter((x) => x !== c.id))}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2"
            >
              <input type="checkbox" readOnly checked={sel.includes(c.id)} className="pointer-events-none" tabIndex={-1} />
              {c.code}
            </DM.CheckboxItem>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
