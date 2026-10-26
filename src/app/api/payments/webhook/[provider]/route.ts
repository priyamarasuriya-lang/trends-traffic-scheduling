import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { gatewayByKey, applyGatewayEvent } from "@/lib/payments/gateway";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

// Payment provider notifications. The body is verified with the provider's
// signature before anything is read from it; replays are idempotent because
// the provider's transaction id is unique on Payment.gatewayRef.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const g = gatewayByKey(provider);
  if (!g || !g.configured()) return NextResponse.json({ error: "Unknown or disabled provider" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const evt = g.verifyWebhook(raw, req.headers);
  if (!evt) {
    await audit({ action: "payment.webhook.rejected", entityType: "Payment", after: { provider, reason: "signature" } });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  // A correctly signed notification proves the live connection works end to end.
  if (!g.isSimulated) await prisma.integration.update({ where: { key: "PAYMENT" }, data: { status: "CONNECTED", lastCheckedAt: new Date(), lastError: null } }).catch(() => {});
  try {
    const r = await applyGatewayEvent(provider, evt);
    return NextResponse.json({ received: true, ...r });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return NextResponse.json({ received: true, applied: false, reason: "duplicate" });
    const message = e instanceof Error ? e.message : "error";
    await audit({ action: "payment.webhook.failed", entityType: "Payment", after: { provider, gatewayRef: evt.gatewayRef, message } });
    // 4xx for business rejections so the provider does not retry forever; 5xx otherwise.
    return NextResponse.json({ error: message }, { status: e instanceof AppError ? 422 : 500 });
  }
}
