import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";
import { D, sum } from "../money";

type Actor = { id: string; email: string };
export type AgreementInput = { title: string; type: string; agencyId?: string | null; clientId?: string | null; dealId?: string | null; startDate: Date; endDate: Date; value?: string | null; terms?: string | null };

export async function saveAgreement(actor: Actor, id: string | null, i: AgreementInput) {
  if (!i.agencyId && !i.clientId) throw new AppError("Choose the agency or the client this agreement is with.");
  if (i.endDate < i.startDate) throw new AppError("The end date must be on or after the start date.");
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.agreement.findUniqueOrThrow({ where: { id } }) : null;
    if (before && before.status !== "DRAFT") throw new AppError("Only draft agreements can be edited. Terminate it and create a new one, or add a document.");
    const data = { ...i, agencyId: i.agencyId || null, clientId: i.clientId || null, dealId: i.dealId || null, value: i.value || null };
    const a = id ? await tx.agreement.update({ where: { id }, data }) : await tx.agreement.create({ data: { ...data, number: await nextNumber(tx, "AGREEMENT") } });
    await audit({ userId: actor.id, userEmail: actor.email, action: id ? "agreement.update" : "agreement.create", entityType: "Agreement", entityId: a.id, before, after: data }, tx);
    return a;
  });
}

export async function setAgreementStatus(actor: Actor, id: string, status: "ACTIVE" | "TERMINATED", reason?: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.agreement.findUniqueOrThrow({ where: { id } });
    if (status === "ACTIVE" && a.status !== "DRAFT") throw new AppError("Only draft agreements can be activated.");
    if (status === "TERMINATED" && !["ACTIVE", "DRAFT"].includes(a.status)) throw new AppError(`A ${a.status.toLowerCase()} agreement cannot be terminated.`);
    if (status === "TERMINATED" && !reason?.trim()) throw new AppError("Give a reason for terminating the agreement.");
    await tx.agreement.update({ where: { id }, data: { status, ...(status === "ACTIVE" ? { signedAt: new Date() } : { terms: `${a.terms ?? ""}\n\nTerminated ${new Date().toISOString().slice(0, 10)}: ${reason}`.trim() }) } });
    await audit({ userId: actor.id, userEmail: actor.email, action: `agreement.${status.toLowerCase()}`, entityType: "Agreement", entityId: id, before: { status: a.status }, after: { status, reason } }, tx);
  });
}

/** Daily job: active agreements past their end date become EXPIRED. */
export async function expireAgreements(now = new Date()) {
  const r = await prisma.agreement.updateMany({ where: { status: "ACTIVE", endDate: { lt: now } }, data: { status: "EXPIRED" } });
  return r.count;
}

/**
 * Booking status of an agreement: release orders in its period for its party
 * (through the linked deal when there is one), with their value against the
 * agreement value.
 */
export async function agreementBookings(a: { dealId: string | null; agencyId: string | null; clientId: string | null; startDate: Date; endDate: Date; value: { toString(): string } | null }) {
  const ros = await prisma.releaseOrder.findMany({
    where: a.dealId
      ? { dealId: a.dealId }
      : { ...(a.agencyId ? { agencyId: a.agencyId } : { clientId: a.clientId!, agencyId: null }), startDate: { lte: a.endDate }, endDate: { gte: a.startDate } },
    include: { client: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
  const committed = ros.filter((r) => ["APPROVED", "SCHEDULED", "COMPLETED"].includes(r.status));
  const pending = ros.filter((r) => ["DRAFT", "SUBMITTED"].includes(r.status));
  const net = (r: { grossAmount: { toString(): string }; discountAmount: { toString(): string } }) => D(r.grossAmount.toString()).sub(D(r.discountAmount.toString()));
  const booked = sum(committed.map(net));
  const value = a.value ? D(a.value.toString()) : null;
  return { ros, booked, pending: sum(pending.map(net)), value, utilisationPct: value && value.gt(0) ? booked.div(value).mul(100).toNumber() : null };
}
