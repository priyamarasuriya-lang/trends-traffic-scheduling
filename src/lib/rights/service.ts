import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError } from "../errors";

type Actor = { id: string; email: string };
export type LicenseInput = { assetId: string; licensor: string; contractRef?: string | null; agreementId?: string | null; territories: string[]; permittedChannelIds: string[]; validFrom: Date; validTo: Date; maxPlays?: number | null; restricted: boolean; warnDaysBefore: number; notes?: string | null };

/** Future planned airings of an asset that no remaining licence covers. */
async function uncoveredAirings(tx: Tx, assetId: string) {
  const [events, licenses] = await Promise.all([
    tx.scheduleEvent.findMany({ where: { assetId, status: "PLANNED", startAt: { gt: new Date() } }, select: { startAt: true, durationSec: true, channelId: true }, orderBy: { startAt: "asc" } }),
    tx.contentLicense.findMany({ where: { assetId, deletedAt: null, restricted: false } }),
  ]);
  return events.filter((e) => {
    const end = new Date(e.startAt.getTime() + e.durationSec * 1000);
    return !licenses.some((l) => l.validFrom <= e.startAt && l.validTo >= end && (!l.permittedChannelIds.length || l.permittedChannelIds.includes(e.channelId)));
  });
}

async function guard(tx: Tx, assetId: string) {
  const bad = await uncoveredAirings(tx, assetId);
  if (bad.length) throw new ConflictError(`${bad.length} planned airing(s) from ${bad[0].startAt.toISOString().slice(0, 10)} would no longer be covered by a licence. Remove or move them from the schedule first.`);
}

export async function saveLicense(actor: Actor, id: string | null, i: LicenseInput) {
  if (i.validTo <= i.validFrom) throw new AppError("The licence must end after it starts.");
  return prisma.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.findUnique({ where: { id: i.assetId } });
    if (!asset || asset.deletedAt) throw new AppError("That asset no longer exists.");
    const data = { ...i, agreementId: i.agreementId || null };
    const before = id ? await tx.contentLicense.findUniqueOrThrow({ where: { id } }) : null;
    if (before && before.assetId !== i.assetId) throw new AppError("A licence cannot be moved to another asset.");
    const l = id ? await tx.contentLicense.update({ where: { id }, data }) : await tx.contentLicense.create({ data });
    await guard(tx, i.assetId);
    // Keep the asset's summary fields in step with its licences.
    const all = await tx.contentLicense.findMany({ where: { assetId: i.assetId, deletedAt: null } });
    await tx.mediaAsset.update({ where: { id: i.assetId }, data: { licenseStart: new Date(Math.min(...all.map((x) => x.validFrom.getTime()))), licenseEnd: new Date(Math.max(...all.map((x) => x.validTo.getTime()))) } });
    await audit({ userId: actor.id, userEmail: actor.email, action: id ? "license.update" : "license.create", entityType: "ContentLicense", entityId: l.id, before, after: data }, tx);
    return l;
  });
}

export async function deleteLicense(actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const l = await tx.contentLicense.update({ where: { id }, data: { deletedAt: new Date() } });
    await guard(tx, l.assetId);
    await audit({ userId: actor.id, userEmail: actor.email, action: "license.delete", entityType: "ContentLicense", entityId: id, before: l }, tx);
  });
}
