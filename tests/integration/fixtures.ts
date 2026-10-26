import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { generateBreaks } from "@/lib/inventory/service";
import type { SalesActor } from "@/lib/sales/service";

export const hasDb = !!process.env.TEST_DATABASE_URL;
export const uid = () => randomBytes(4).toString("hex").toUpperCase();

export async function user(perms: string[], label = "u") {
  const id = uid();
  const u = await prisma.user.create({ data: { email: `${label}-${id}@test.local`, name: `${label} ${id}`, passwordHash: "x", allChannels: true } });
  return { id: u.id, email: u.email, name: u.name, permissions: new Set(perms), canEditPublished: true } satisfies SalesActor & { canEditPublished: boolean };
}

export async function channel() {
  return prisma.channel.create({ data: { code: `T${uid()}`, name: "Test channel", timezone: "Asia/Colombo", broadcastDayStartHour: 6 } });
}

export async function client(category: string | null = null) {
  return prisma.client.create({ data: { code: `C${uid()}`, name: `Client ${uid()}`, productCategory: category, creditTermsDays: 30 } });
}

export async function commercial(advertiserId: string, durationSec = 30) {
  return prisma.mediaAsset.create({ data: { assetCode: `AD${uid()}`, title: `Spot ${uid()}`, category: "COMMERCIAL", durationSec, approvalStatus: "APPROVED", advertiserId, brand: `Brand ${uid()}` } });
}

/** One break per time on `date`, `positions` positions each. */
export async function breaks(channelId: string, date: string, times: string[], positions = 1) {
  const admin = await user(["inventory.manage"], "inv");
  await generateBreaks({ id: admin.id, email: admin.email, canEditPublished: true }, { channelId, fromDate: date, toDate: date, times, positions, positionDurationSec: 30 });
}

export const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
