import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u || !u.permissions.has("media.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? "";
  const category = req.nextUrl.searchParams.get("category") ?? "";
  const assets = await prisma.mediaAsset.findMany({
    where: {
      deletedAt: null,
      category: category ? (category as never) : { not: "SECONDARY" },
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { assetCode: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, assetCode: true, title: true, category: true, durationSec: true, approvalStatus: true },
    orderBy: [{ category: "asc" }, { title: "asc" }],
    take: 60,
  });
  return NextResponse.json({ assets });
}
