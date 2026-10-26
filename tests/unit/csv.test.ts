import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "@/lib/reports/csv";
import { scrub } from "@/lib/audit";

describe("CSV", () => {
  it("escapes quotes, commas and newlines and round-trips", () => {
    const rows = [{ a: 'He said "hi"', b: "x,y", c: "line1\nline2" }];
    const csv = toCsv(["a", "b", "c"], rows);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    const csv = toCsv(["v"], [{ v: "=HYPERLINK(\"x\")" }, { v: "-12.50" }, { v: "@cmd" }]);
    const vals = parseCsv(csv).map((r) => r.v);
    expect(vals).toEqual(["'=HYPERLINK(\"x\")", "-12.50", "'@cmd"]);
  });

  it("parses a BOM and CRLF file", () => {
    expect(parseCsv("﻿code,title\r\nA1,Hello\r\n")).toEqual([{ code: "A1", title: "Hello" }]);
  });
});

describe("audit scrubbing", () => {
  it("redacts secrets at any depth", () => {
    const out = scrub({ email: "a@b.c", passwordHash: "x", nested: { apiKey: "k", token: "t", ok: 1 } }) as Record<string, Record<string, unknown>>;
    expect(out.passwordHash).toBe("[redacted]");
    expect(out.nested.apiKey).toBe("[redacted]");
    expect(out.nested.token).toBe("[redacted]");
    expect(out.nested.ok).toBe(1);
  });
});
