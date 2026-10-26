import type { Tx } from "./db";

const DEFAULTS: Record<string, { prefix: string; padding: number }> = {
  DEAL: { prefix: "DL-", padding: 5 },
  RO: { prefix: "RO-", padding: 5 },
  INVOICE: { prefix: "INV-", padding: 6 },
  CREDIT_NOTE: { prefix: "CN-", padding: 5 },
  AGREEMENT: { prefix: "AGR-", padding: 5 },
};

/**
 * Allocate the next document number. The UPDATE ... RETURNING takes a row lock,
 * so concurrent transactions serialise and numbers are never duplicated. Call
 * inside the transaction that creates the document so a rollback releases it.
 */
export async function nextNumber(tx: Tx, key: keyof typeof DEFAULTS | string): Promise<string> {
  const def = DEFAULTS[key] ?? { prefix: `${key}-`, padding: 5 };
  await tx.$executeRaw`INSERT INTO "NumberSequence" ("key", "prefix", "next", "padding") VALUES (${key}, ${def.prefix}, 1, ${def.padding}) ON CONFLICT ("key") DO NOTHING`;
  const rows = await tx.$queryRaw<{ prefix: string; n: number; padding: number }[]>`
    UPDATE "NumberSequence" SET "next" = "next" + 1 WHERE "key" = ${key} RETURNING "prefix", "next" - 1 AS n, "padding"`;
  const r = rows[0];
  return `${r.prefix}${String(r.n).padStart(r.padding, "0")}`;
}
