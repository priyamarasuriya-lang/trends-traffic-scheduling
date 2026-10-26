import { prisma } from "../db";
import { audit } from "../audit";
import { AppError, ConflictError } from "../errors";
import { lockChannel, txOpts } from "../scheduling/service";
import { fmtTz } from "../time";

export type SecondaryInput = { channelId: string; assetId?: string | null; category: string; label: string; startAt: Date; endAt: Date; layer: number; priority: number; isActive: boolean };
type Actor = { id: string; email: string };

/** Create or update a secondary event. Active events on the same channel and layer may not overlap. */
export async function saveSecondary(actor: Actor, id: string | null, i: SecondaryInput) {
  if (i.endAt <= i.startAt) throw new AppError("The end time must be after the start time.");
  if (i.endAt.getTime() - i.startAt.getTime() > 31 * 86400_000) throw new AppError("A secondary event can last at most 31 days. Split longer ones.");
  return prisma.$transaction(async (tx) => {
    await lockChannel(tx, i.channelId);
    const ch = await tx.channel.findUniqueOrThrow({ where: { id: i.channelId } });
    if (i.assetId) {
      const a = await tx.mediaAsset.findUnique({ where: { id: i.assetId } });
      if (!a || a.deletedAt) throw new AppError("That graphic no longer exists.");
      if (a.category !== "SECONDARY") throw new AppError("Only secondary graphics can be used for secondary events.");
      if (a.approvalStatus !== "APPROVED") throw new AppError(`"${a.title}" is not approved for air.`);
      if (a.permittedChannelIds.length && !a.permittedChannelIds.includes(i.channelId)) throw new AppError(`"${a.title}" is not permitted on ${ch.code}.`);
    }
    if (i.isActive) {
      const clash = await tx.secondaryEvent.findFirst({
        where: { channelId: i.channelId, layer: i.layer, isActive: true, deletedAt: null, startAt: { lt: i.endAt }, endAt: { gt: i.startAt }, ...(id ? { id: { not: id } } : {}) },
        orderBy: { startAt: "asc" },
      });
      if (clash)
        throw new ConflictError(`Layer ${i.layer} already has "${clash.label}" from ${fmtTz(clash.startAt, ch.timezone, "dd MMM HH:mm")} to ${fmtTz(clash.endAt, ch.timezone, "dd MMM HH:mm")}. Use another layer or change the times.`);
    }
    const data = { channelId: i.channelId, assetId: i.assetId || null, category: i.category as never, label: i.label, startAt: i.startAt, endAt: i.endAt, layer: i.layer, priority: i.priority, isActive: i.isActive };
    const before = id ? await tx.secondaryEvent.findUniqueOrThrow({ where: { id } }) : null;
    if (before && before.channelId !== i.channelId) throw new AppError("A secondary event cannot be moved to another channel. Create a new one.");
    const ev = id ? await tx.secondaryEvent.update({ where: { id }, data }) : await tx.secondaryEvent.create({ data });
    await audit({ userId: actor.id, userEmail: actor.email, action: id ? "secondary.update" : "secondary.create", entityType: "SecondaryEvent", entityId: ev.id, before, after: data }, tx);
    return ev;
  }, txOpts);
}

export async function deleteSecondary(actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const ev = await tx.secondaryEvent.findUniqueOrThrow({ where: { id } });
    await tx.secondaryEvent.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "secondary.delete", entityType: "SecondaryEvent", entityId: id, before: ev }, tx);
    return ev;
  });
}
