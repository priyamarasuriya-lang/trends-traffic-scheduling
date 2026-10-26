import "server-only";
import { headers } from "next/headers";
import { prisma } from "../db";
import { rateLimit } from "../rate-limit";

/** Resolve a public payment link. Rate-limited per IP so tokens cannot be enumerated. */
export async function invoiceForToken(token: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  if (!rateLimit(`pay:${ip}`, 60, 15 * 60_000).ok) return { limited: true as const, invoice: null };
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return { limited: false as const, invoice: null };
  const invoice = await prisma.invoice.findUnique({
    where: { paymentToken: token },
    select: { id: true, number: true, status: true, currency: true, total: true, balance: true, dueDate: true, issueDate: true, paymentToken: true, client: { select: { name: true } }, agency: { select: { name: true } } },
  });
  return { limited: false as const, invoice };
}
