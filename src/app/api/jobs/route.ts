import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledWork } from "@/lib/jobs/daily";

export const dynamic = "force-dynamic";

/**
 * For platforms that schedule HTTP calls instead of commands (e.g. Vercel Cron).
 * Disabled unless CRON_SECRET is set; callers send `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runScheduledWork());
}
export const GET = POST;
