import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";

export type MediaActor = { id: string; email: string };
export type AssetInput = {
  assetCode: string;
  title: string;
  category: string;
  description?: string | null;
  durationSec: number;
  fileRef?: string | null;
  language?: string | null;
  rightsOwner?: string | null;
  permittedChannelIds: string[];
  maxPlays?: number | null;
  contentCategory?: string | null;
  brand?: string | null;
  productCategory?: string | null;
  advertiserId?: string | null;
  versionNotes?: string | null;
  // category details
  genre?: string | null;
  season?: number | null;
  episode?: number | null;
  contentRating?: string | null;
  isLive?: boolean;
  director?: string | null;
  releaseYear?: number | null;
  certificate?: string | null;
  clockNumber?: string | null;
  agencyRef?: string | null;
  campaignId?: string | null;
  promotedTitle?: string | null;
};

type Details = {
  program?: { genre?: string | null; season?: number | null; episode?: number | null; contentRating?: string | null; isLive: boolean };
  movie?: { director?: string | null; releaseYear?: number | null; certificate?: string | null };
  commercial?: { clockNumber?: string | null; agencyRef?: string | null };
  promo?: { campaignId: string | null; promotedTitle?: string | null };
};

function details(i: AssetInput): Details {
  switch (i.category) {
    case "PROGRAM":
      return { program: { genre: i.genre, season: i.season, episode: i.episode, contentRating: i.contentRating, isLive: !!i.isLive } };
    case "MOVIE":
      return { movie: { director: i.director, releaseYear: i.releaseYear, certificate: i.certificate } };
    case "COMMERCIAL":
      return { commercial: { clockNumber: i.clockNumber, agencyRef: i.agencyRef } };
    case "PROMO":
      return { promo: { campaignId: i.campaignId || null, promotedTitle: i.promotedTitle } };
    default:
      return {};
  }
}

/**
 * Create or update an asset. A change of duration or media file creates a new
 * version and sends the asset back for approval, because the approved material
 * is no longer what will air.
 */
export async function saveAsset(actor: MediaActor, id: string | null, i: AssetInput) {
  if (i.category === "COMMERCIAL" && !i.advertiserId) throw new AppError("Choose the advertiser for a commercial.");
  if (i.category === "COMMERCIAL" && !i.brand) throw new AppError("Enter the brand for a commercial; it is used by separation rules.");
  const base = {
    assetCode: i.assetCode,
    title: i.title,
    category: i.category as never,
    description: i.description,
    durationSec: i.durationSec,
    fileRef: i.fileRef,
    language: i.language,
    rightsOwner: i.rightsOwner,
    permittedChannelIds: i.permittedChannelIds,
    maxPlays: i.maxPlays,
    contentCategory: i.contentCategory?.toUpperCase() || null,
    brand: i.brand,
    productCategory: i.productCategory?.toUpperCase() || null,
    advertiserId: i.category === "COMMERCIAL" ? i.advertiserId : null,
  };
  return prisma.$transaction(async (tx) => {
    if (!id) {
      const a = await tx.mediaAsset.create({ data: { ...base, approvalStatus: "PENDING", versions: { create: { version: 1, durationSec: i.durationSec, fileRef: i.fileRef, notes: i.versionNotes ?? "Initial version", createdById: actor.id } } } });
      const d = details(i);
      if (d.program) await tx.program.create({ data: { assetId: a.id, ...d.program } });
      if (d.movie) await tx.movie.create({ data: { assetId: a.id, ...d.movie } });
      if (d.commercial) await tx.commercial.create({ data: { assetId: a.id, ...d.commercial } });
      if (d.promo) await tx.promo.create({ data: { assetId: a.id, ...d.promo } });
      await audit({ userId: actor.id, userEmail: actor.email, action: "media.create", entityType: "MediaAsset", entityId: a.id, after: { ...base, ...d } }, tx);
      return a;
    }
    const before = await tx.mediaAsset.findUniqueOrThrow({ where: { id } });
    if (before.deletedAt) throw new AppError("This asset has been deleted.");
    if (before.category !== i.category) throw new AppError("The category of an existing asset cannot be changed. Create a new asset instead.");
    const newVersion = before.durationSec !== i.durationSec || (before.fileRef ?? "") !== (i.fileRef ?? "");
    if (newVersion && before.durationSec !== i.durationSec) {
      const future = await tx.scheduleEvent.count({ where: { assetId: id, startAt: { gt: new Date() }, status: "PLANNED" } });
      if (future) throw new AppError(`This asset is on ${future} future schedule slot(s). Changing its duration would break those schedules; remove or replace them first, or create a new asset.`);
    }
    const a = await tx.mediaAsset.update({
      where: { id },
      data: { ...base, ...(newVersion ? { version: { increment: 1 }, approvalStatus: "PENDING" } : {}) },
    });
    if (newVersion) await tx.mediaAssetVersion.create({ data: { assetId: id, version: a.version, durationSec: i.durationSec, fileRef: i.fileRef, notes: i.versionNotes, createdById: actor.id } });
    const d = details(i);
    if (d.program) await tx.program.upsert({ where: { assetId: id }, create: { assetId: id, ...d.program }, update: d.program });
    if (d.movie) await tx.movie.upsert({ where: { assetId: id }, create: { assetId: id, ...d.movie }, update: d.movie });
    if (d.commercial) await tx.commercial.upsert({ where: { assetId: id }, create: { assetId: id, ...d.commercial }, update: d.commercial });
    if (d.promo) await tx.promo.upsert({ where: { assetId: id }, create: { assetId: id, ...d.promo }, update: d.promo });
    await audit({ userId: actor.id, userEmail: actor.email, action: newVersion ? "media.new_version" : "media.update", entityType: "MediaAsset", entityId: id, before, after: { ...base, ...d } }, tx);
    return a;
  });
}

export async function setApproval(actor: MediaActor, id: string, status: "APPROVED" | "REJECTED" | "RETIRED" | "PENDING", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.mediaAsset.findUniqueOrThrow({ where: { id } });
    if (status === "RETIRED") {
      const future = await tx.scheduleEvent.count({ where: { assetId: id, startAt: { gt: new Date() }, status: "PLANNED" } });
      if (future) throw new AppError(`This asset is on ${future} future schedule slot(s). Remove them before retiring it.`);
    }
    await tx.mediaAsset.update({ where: { id }, data: { approvalStatus: status } });
    await audit({ userId: actor.id, userEmail: actor.email, action: `media.${status.toLowerCase()}`, entityType: "MediaAsset", entityId: id, before: { approvalStatus: a.approvalStatus }, after: { approvalStatus: status, comment } }, tx);
  });
}

export async function deleteAsset(actor: MediaActor, id: string) {
  return prisma.$transaction(async (tx) => {
    const [events, roLines] = await Promise.all([tx.scheduleEvent.count({ where: { assetId: id } }), tx.releaseOrderLineItem.count({ where: { assetId: id } })]);
    if (events || roLines) throw new AppError("This asset has schedule history or release-order lines, so it is kept for the record. Retire it instead.");
    await tx.mediaAsset.update({ where: { id }, data: { deletedAt: new Date(), approvalStatus: "RETIRED" } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "media.delete", entityType: "MediaAsset", entityId: id }, tx);
  });
}
