"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zPct, zInt, zBool, zOptId, zMoney } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";

const optMoney = z.preprocess((v) => (v === "" ? undefined : v), zMoney.refine((v) => Number(v) >= 0, "Cannot be negative").optional());
const common = {
  code: zStr(20).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, dash and underscore only").transform((s) => s.toUpperCase()),
  name: zStr(200),
  contactName: zOptStr(120),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().email("Enter a valid email").optional()),
  phone: zOptStr(40),
  billingAddress: zOptStr(500),
  taxId: zOptStr(60),
  creditTermsDays: zInt(0, 365),
  creditLimit: optMoney,
  status: z.enum(["ACTIVE", "ON_HOLD", "BLOCKED", "INACTIVE"]),
  accountManagerId: zOptId,
};
const agencySchema = z.object({ ...common, commissionPct: zPct });
const clientSchema = z.object({ ...common, agencyId: zOptId, taxRateId: zOptId, taxExempt: zBool, productCategory: zOptStr(40) });

export async function saveAgencyAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("agency.manage");
    const p = agencySchema.parse(formToObject(fd));
    const data = { ...p, creditLimit: p.creditLimit ?? null, accountManagerId: p.accountManagerId ?? null };
    const a = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.agency.findUniqueOrThrow({ where: { id } }) : null;
      const a = id ? await tx.agency.update({ where: { id }, data }) : await tx.agency.create({ data });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "agency.update" : "agency.create", entityType: "Agency", entityId: a.id, before, after: data }, tx);
      return a;
    });
    return { id: a.id };
  }, "Agency saved");
}

export async function saveClientAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("agency.manage");
    const p = clientSchema.parse(formToObject(fd));
    const data = { ...p, agencyId: p.agencyId ?? null, taxRateId: p.taxRateId ?? null, creditLimit: p.creditLimit ?? null, accountManagerId: p.accountManagerId ?? null, productCategory: p.productCategory?.toUpperCase() ?? null };
    const c = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.client.findUniqueOrThrow({ where: { id } }) : null;
      const c = id ? await tx.client.update({ where: { id }, data }) : await tx.client.create({ data });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "client.update" : "client.create", entityType: "Client", entityId: c.id, before, after: data }, tx);
      return c;
    });
    return { id: c.id };
  }, "Client saved");
}

/** Soft-delete an agency or client that has no open business. History stays intact. */
export async function deleteAccountAction(kind: "agency" | "client", id: string) {
  return run(async () => {
    const u = await requireUser("agency.manage");
    const key = kind === "agency" ? "agencyId" : "clientId";
    const [openRo, openInv] = await Promise.all([
      prisma.releaseOrder.count({ where: { [key]: id, status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "SCHEDULED"] } } }),
      prisma.invoice.count({ where: { [key]: id, status: { in: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } }),
    ]);
    if (openRo || openInv) throw new AppError(`This ${kind} has ${openRo} open release order(s) and ${openInv} open invoice(s). Close them first, or set the status to Inactive.`);
    if (kind === "agency") await prisma.agency.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    else await prisma.client.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    await audit({ userId: u.id, userEmail: u.email, action: `${kind}.delete`, entityType: kind === "agency" ? "Agency" : "Client", entityId: id });
  }, "Deleted");
}
