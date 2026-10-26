import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined>; details?: unknown };

function isNextControlFlow(e: unknown) {
  const d = (e as { digest?: string })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND") || d === "DYNAMIC_SERVER_USAGE");
}

/** Normalise any thrown error into an ActionResult the UI can display. */
export function toActionError(e: unknown): ActionResult<never> {
  if (isNextControlFlow(e)) throw e;
  if (e instanceof z.ZodError) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> };
  }
  if (e instanceof AppError) return { ok: false, error: e.message, details: e.details };
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return { ok: false, error: `A record with the same ${(e.meta?.target as string[] | undefined)?.join(", ") ?? "value"} already exists.` };
    if (e.code === "P2025") return { ok: false, error: "The record no longer exists or was changed by someone else. Refresh and try again." };
    if (e.code === "P2003") return { ok: false, error: "This record is referenced by other records and cannot be changed this way." };
  }
  console.error("[action] unexpected error", e);
  return { ok: false, error: "Something went wrong. The error has been logged." };
}

export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    return toActionError(e);
  }
}

/** Convert FormData into a plain object (repeated keys become arrays). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v !== "string") continue;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

// Zod helpers for form input
export const zStr = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const zOptStr = (max = 500) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
export const zInt = (min = 0, max = 1_000_000_000) => z.coerce.number({ invalid_type_error: "Must be a number" }).int().min(min).max(max);
export const zOptInt = (min = 0, max = 1_000_000_000) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(min).max(max).optional());
export const zMoney = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals");
export const zPct = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, "Enter a percentage")
  .refine((v) => Number(v) <= 100, "Must be 0–100");
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zOptId = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
