import "server-only";
import { prisma } from "@/lib/db";

export async function assetOptions() {
  const [channels, advertisers, campaigns] = await Promise.all([
    prisma.channel.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.promoCampaign.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    channels: channels.map((c) => ({ value: c.id, label: c.code })),
    advertisers: advertisers.map((c) => ({ value: c.id, label: c.name })),
    campaigns: campaigns.map((c) => ({ value: c.id, label: c.name })),
  };
}
