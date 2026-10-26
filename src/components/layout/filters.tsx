"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    if (!("page" in updates)) p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  };
}

export function SearchBox({ placeholder = "Search…", param = "q" }: { placeholder?: string; param?: string }) {
  const params = useSearchParams();
  const set = useSetParam();
  const [v, setV] = React.useState(params.get(param) ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        set({ [param]: v });
      }}
      className="relative w-full max-w-xs"
    >
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
    </form>
  );
}

export function FilterSelect({ param, options, label }: { param: string; options: { value: string; label: string }[]; label: string }) {
  const params = useSearchParams();
  const set = useSetParam();
  return (
    <Select value={params.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value })} aria-label={label} className="w-auto min-w-36">
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function DateFilter({ param, label }: { param: string; label: string }) {
  const params = useSearchParams();
  const set = useSetParam();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <Input type="date" value={params.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value })} className="w-auto" />
    </label>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const set = useSetParam();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-3 py-2 text-xs text-muted">{total} record(s)</p>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
      <span>
        {total} record(s) · page {page} of {pages}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
          Next
        </Button>
      </div>
    </div>
  );
}
