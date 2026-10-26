import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { storage, downloadAllowed } from "@/lib/storage";
import { canFile } from "@/lib/files-access";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const f = await prisma.fileAttachment.findUnique({ where: { id } });
  if (!f || f.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canFile(u, f.entityType, "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!downloadAllowed(f.scanStatus)) return NextResponse.json({ error: `File is ${f.scanStatus.toLowerCase()} and not yet available.` }, { status: 409 });
  const data = await storage().get(f.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `attachment; filename="${f.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
