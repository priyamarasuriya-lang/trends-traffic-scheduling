import { prisma, type Tx } from "./db";

const SENSITIVE = /pass(word)?|token|secret|hash|apikey|api_key|cvv|cvc|card/i;

/** Remove secrets and convert Decimal/Date to plain JSON before storing. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toFixed" in value && typeof (value as { toFixed: unknown }).toFixed === "function" && "d" in value)
    return (value as { toString(): string }).toString();
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[redacted]" : scrub(v, depth + 1);
    return out;
  }
  return value;
}

export type AuditInput = {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export async function audit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (scrub(input.before) as object),
      after: input.after === undefined ? undefined : (scrub(input.after) as object),
      ip: input.ip ?? null,
    },
  });
}
