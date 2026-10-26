"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useFieldError } from "./action-form";

export type LineColumn = { key: string; label: string; type?: "text" | "number" | "money" | "date" | "select"; options?: { value: string; label: string }[]; width?: string; placeholder?: string };
export type Line = Record<string, string | number | null | undefined>;

/**
 * Editable table of line items. The rows are serialised as JSON into a hidden
 * input called `name` so the server action validates them with Zod.
 */
export function LinesEditor({ name, columns, initial, blank, summary }: { name: string; columns: LineColumn[]; initial: Line[]; blank: () => Line; summary?: (lines: Line[]) => React.ReactNode }) {
  const [lines, setLines] = React.useState<Line[]>(initial.length ? initial : [blank()]);
  const err = useFieldError(name);
  const set = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(lines)} />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-1.5 font-medium" style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c.key} className="p-1">
                    {c.type === "select" ? (
                      <Select value={String(l[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)} className="h-8 text-xs" aria-label={`${c.label} line ${i + 1}`}>
                        <option value="">{c.placeholder ?? "—"}</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
                        inputMode={c.type === "money" ? "decimal" : undefined}
                        value={String(l[c.key] ?? "")}
                        onChange={(e) => set(i, c.key, e.target.value)}
                        className="h-8 text-xs"
                        placeholder={c.placeholder}
                        aria-label={`${c.label} line ${i + 1}`}
                      />
                    )}
                  </td>
                ))}
                <td className="p-1">
                  <Button type="button" size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`}>
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      <div className="mt-2 flex items-start justify-between gap-4">
        <Button type="button" size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}>
          <Plus /> Add line
        </Button>
        {summary && <div className="text-right text-xs">{summary(lines)}</div>}
      </div>
    </div>
  );
}
