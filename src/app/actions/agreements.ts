"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zDate, zOptId, zMoney } from "@/lib/action";
import * as svc from "@/lib/agreements/service";

const schema = z.object({
  title: zStr(200),
  type: z.enum(["ADVERTISING", "CONTENT_LICENSE", "SERVICE"]),
  agencyId: zOptId,
  clientId: zOptId,
  dealId: zOptId,
  startDate: zDate,
  endDate: zDate,
  value: z.preprocess((v) => (v === "" ? undefined : v), zMoney.refine((v) => Number(v) >= 0, "Cannot be negative").optional()),
  terms: zOptStr(10000),
});

export async function saveAgreementAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("agreement.manage");
    const p = schema.parse(formToObject(fd));
    const a = await svc.saveAgreement({ id: u.id, email: u.email }, id, { ...p, startDate: new Date(`${p.startDate}T00:00:00Z`), endDate: new Date(`${p.endDate}T23:59:59Z`) });
    return { id: a.id };
  }, "Agreement saved");
}

export async function agreementStatusAction(id: string, status: "ACTIVE" | "TERMINATED", reason: string) {
  return run(async () => {
    const u = await requireUser("agreement.manage");
    await svc.setAgreementStatus({ id: u.id, email: u.email }, id, status, reason);
  }, status === "ACTIVE" ? "Agreement activated" : "Agreement terminated");
}
