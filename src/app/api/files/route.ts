import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { saveUpload } from "@/lib/storage";
import { canFile } from "@/lib/files-access";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same-origin check (CSRF defence for this non-server-action endpoint).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  if (!rateLimit(`upload:${u.id}`, 30, 60_000).ok) return NextResponse.json({ error: "Too many uploads; slow down." }, { status: 429 });
  const fd = await req.formData();
  const entityType = String(fd.get("entityType") ?? "");
  const entityId = String(fd.get("entityId") ?? "");
  const file = fd.get("file");
  if (!(file instanceof File) || !entityId) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (!canFile(u, entityType, "manage")) return NextResponse.json({ error: "You cannot attach files here." }, { status: 403 });
  try {
    const f = await saveUpload({ entityType, entityId, fileName: file.name, data: Buffer.from(await file.arrayBuffer()), userId: u.id });
    await audit({ userId: u.id, userEmail: u.email, action: "file.upload", entityType, entityId, after: { file: f.fileName, size: f.sizeBytes, scan: f.scanStatus } });
    return NextResponse.json({ id: f.id, scanStatus: f.scanStatus });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
