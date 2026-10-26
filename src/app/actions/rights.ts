"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zDate, zOptInt, zInt, zBool, zOptId } from "@/lib/action";
import * as svc from "@/lib/rights/service";

const list = z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string()));
const schema = z.object({
  assetId: z.string().min(1, "Choose the asset"),
  licensor: zStr(200),
  contractRef: zOptStr(80),
  agreementId: zOptId,
  territories: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : []), z.array(z.string().max(40)).max(50)),
  permittedChannelIds: list,
  validFrom: zDate,
  validTo: zDate,
  maxPlays: zOptInt(1, 1_000_000),
  restricted: zBool,
  warnDaysBefore: zInt(0, 365),
  notes: zOptStr(2000),
});

export async function saveLicenseAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("rights.manage");
    const p = schema.parse(formToObject(fd));
    const l = await svc.saveLicense({ id: u.id, email: u.email }, id, { ...p, validFrom: new Date(`${p.validFrom}T00:00:00Z`), validTo: new Date(`${p.validTo}T23:59:59Z`) });
    return { id: l.id };
  }, "Licence saved");
}

export async function deleteLicenseAction(id: string) {
  return run(async () => {
    const u = await requireUser("rights.manage");
    await svc.deleteLicense({ id: u.id, email: u.email }, id);
  }, "Licence deleted");
}
