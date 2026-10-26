import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { runReport } from "@/lib/reports/run";
import { toCsv } from "@/lib/reports/csv";
import { toXlsx } from "@/lib/reports/excel";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`report:${u.id}`, 60, 60_000).ok) return NextResponse.json({ error: "Too many exports. Wait a minute." }, { status: 429 });
  const { key } = await params;
  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  try {
    const { def, result, label } = await runReport(u, key, req.nextUrl.searchParams, format);
    const base = `${def.key}_${label.replace(/[^0-9A-Za-z-]+/g, "_")}`;
    if (format === "xlsx") {
      const buf = await toXlsx(def.title, result.columns, result.totals ? [...result.rows, { ...result.totals, [result.columns[0].key]: "Total" }] : result.rows, [`Period: ${label}`, `Generated ${new Date().toISOString()} by ${u.email}`]);
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "private, no-store" } });
    }
    const csv = toCsv(result.columns.map((c) => c.key), result.rows, result.columns.map((c) => c.label));
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    throw e;
  }
}
