import type { Prisma } from "@prisma/client";
import { addDaysStr } from "./time";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared filter for the audit screen and its CSV export. */
export function auditWhere(get: (k: string) => string | undefined): Prisma.AuditLogWhereInput {
  const q = get("q")?.trim();
  const entity = get("entity");
  const userId = get("user");
  const area = get("area");
  const from = get("from");
  const to = get("to");
  return {
    ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" } }, { entityId: q }, { userEmail: { contains: q, mode: "insensitive" } }] } : {}),
    ...(entity ? { entityType: entity } : {}),
    ...(userId ? { userId } : {}),
    ...(area ? { action: { startsWith: area + "." } } : {}),
    ...((from && DATE.test(from)) || (to && DATE.test(to)) ? { createdAt: { ...(from && DATE.test(from) ? { gte: new Date(from) } : {}), ...(to && DATE.test(to) ? { lt: new Date(addDaysStr(to, 1)) } : {}) } } : {}),
  };
}
