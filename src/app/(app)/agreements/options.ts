import "server-only";
import { prisma } from "@/lib/db";

export async function agreementOptions() {
  const [agencies, clients, deals] = await Promise.all([
    prisma.agency.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.deal.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  return {
    agencies: agencies.map((a) => ({ value: a.id, label: a.name })),
    clients: clients.map((c) => ({ value: c.id, label: c.name })),
    deals: deals.map((d) => ({ value: d.id, label: `${d.number} ${d.campaignName}` })),
  };
}
