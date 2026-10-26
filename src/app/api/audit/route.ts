import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { auditWhere } from "@/lib/audit-query";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/reports/csv";
import { rateLimit } from "@/lib/rate-limit";

const MAX = 20000;

export async function GET(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!u.permissions.has("audit.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!rateLimit(`audit-export:${u.id}`, 10, 60_000).ok) return NextResponse.json({ error: "Too many exports. Wait a minute." }, { status: 429 });
  const sp = req.nextUrl.searchParams;
  const rows = await prisma.auditLog.findMany({ where: auditWhere((k) => sp.get(k) ?? undefined), orderBy: { createdAt: "desc" }, take: MAX });
  await audit({ userId: u.id, userEmail: u.email, action: "audit.export", after: { rows: rows.length, filter: Object.fromEntries(sp) } });
  const csv = toCsv(
    ["createdAt", "userEmail", "action", "entityType", "entityId", "ip", "before", "after"],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), before: r.before ? JSON.stringify(r.before) : "", after: r.after ? JSON.stringify(r.after) : "" })),
    ["When (UTC)", "User", "Action", "Record type", "Record id", "IP", "Before", "After"],
  );
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit_${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
}
