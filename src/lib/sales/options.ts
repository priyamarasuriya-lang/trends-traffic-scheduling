import "server-only";
import { prisma } from "../db";
import { getSetting } from "../settings";
import type { CurrentUser } from "../auth/session";
import type { SalesOptions } from "@/components/sales/forms";

export async function salesOptions(user: CurrentUser): Promise<SalesOptions> {
  const [clients, agencies, channels, commercials, deals, currency, tax] = await Promise.all([
    prisma.client.findMany({ where: { deletedAt: null, status: { not: "BLOCKED" } }, orderBy: { name: "asc" } }),
    prisma.agency.findMany({ where: { deletedAt: null, status: { not: "BLOCKED" } }, orderBy: { name: "asc" } }),
    prisma.channel.findMany({ where: { deletedAt: null, ...(user.allChannels ? {} : { id: { in: user.channelIds } }) }, orderBy: { code: "asc" } }),
    prisma.mediaAsset.findMany({ where: { category: "COMMERCIAL", deletedAt: null }, orderBy: { title: "asc" } }),
    prisma.deal.findMany({ where: { deletedAt: null, status: { in: ["CONFIRMED", "NEGOTIATION"] } }, orderBy: { createdAt: "desc" }, take: 200 }),
    getSetting("billing.currency"),
    prisma.taxRate.findFirst({ where: { isDefault: true, isActive: true } }),
  ]);
  return {
    clients: clients.map((c) => ({ value: c.id, label: c.name, agencyId: c.agencyId })),
    agencies: agencies.map((a) => ({ value: a.id, label: a.name, commissionPct: a.commissionPct.toString() })),
    channels: channels.map((c) => ({ value: c.id, label: c.code })),
    commercials: commercials.map((c) => ({ value: c.id, label: c.title, advertiserId: c.advertiserId, durationSec: c.durationSec })),
    deals: deals.map((d) => ({ value: d.id, label: `${d.number} ${d.campaignName}`, clientId: d.clientId })),
    currency: currency.code,
    taxPct: tax?.ratePct.toString() ?? "0",
  };
}
