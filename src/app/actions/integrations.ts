"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertChannel } from "@/lib/auth/session";
import { run, formToObject, zDate, zBool } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { testIntegration, queueJob, runDueJobs, ADAPTERS } from "@/lib/integrations";

export async function testIntegrationAction(key: string) {
  return run(async () => {
    const u = await requireUser("integration.manage");
    return testIntegration(u.id, key);
  });
}

export async function toggleIntegrationAction(key: string, enabled: boolean) {
  return run(async () => {
    const u = await requireUser("integration.manage");
    if (!ADAPTERS[key]) throw new AppError("Unknown integration.");
    await prisma.integration.update({ where: { key }, data: { enabled } });
    await audit({ userId: u.id, userEmail: u.email, action: enabled ? "integration.enable" : "integration.disable", entityType: "Integration", entityId: key });
    // Record the real mode straight away so the card never shows a stale status.
    if (enabled) await testIntegration(u.id, key);
  }, enabled ? "Integration enabled" : "Integration disabled");
}

/** Queue an export job (invoices for SAP/Tally, playlist for automation) and run it now. */
export async function queueExportAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("integration.manage");
    const raw = formToObject(fd);
    const p = z.object({ key: z.enum(["SAP", "TALLY", "AUTOMATION"]), from: zDate.optional(), to: zDate.optional(), channelId: z.string().optional(), date: zDate.optional(), force: zBool }).parse(raw);
    const integ = await prisma.integration.findUniqueOrThrow({ where: { key: p.key } });
    if (!integ.enabled) throw new AppError(`Enable the ${integ.name} integration first.`);
    let params: Record<string, unknown>;
    if (p.key === "AUTOMATION") {
      if (!p.channelId || !p.date) throw new AppError("Choose a channel and date.");
      assertChannel(u, p.channelId);
      params = { channelId: p.channelId, date: p.date };
    } else {
      if (!p.from || !p.to || p.from > p.to) throw new AppError("Choose a valid date range.");
      params = { from: `${p.from}T00:00:00.000Z`, to: `${p.to}T23:59:59.999Z` };
    }
    const kind = ADAPTERS[p.key].jobs[0].kind;
    const job = await queueJob(u.id, p.key, kind, params, p.force);
    await runDueJobs(5);
    const done = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (done.status !== "SUCCEEDED") throw new AppError(`The job ${done.status.toLowerCase()}: ${done.error ?? "see the job list"}. It will be retried automatically.`);
    return { id: job.id };
  }, "Export completed");
}

export async function importMediaAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("integration.manage");
    if (!u.permissions.has("media.manage")) throw new AppError("Importing media metadata also needs media management permission.");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a CSV file.");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new AppError("Upload a .csv file.");
    const integ = await prisma.integration.findUniqueOrThrow({ where: { key: "AMS" } });
    if (!integ.enabled) throw new AppError("Enable the Asset Management System integration first.");
    const f = await saveUpload({ entityType: "INTEGRATION_JOB", entityId: "import", fileName: file.name, data: Buffer.from(await file.arrayBuffer()), userId: u.id });
    const job = await queueJob(u.id, "AMS", "MEDIA_METADATA", { fileId: f.id, sha256: f.sha256 });
    await prisma.fileAttachment.update({ where: { id: f.id }, data: { entityId: job.id } });
    await runDueJobs(5);
    const done = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (done.status !== "SUCCEEDED") throw new AppError(`Import ${done.status.toLowerCase()}: ${done.error}`);
    const r = done.result as { created: number; updated: number; errors: string[] };
    return { created: r.created, updated: r.updated, errors: r.errors };
  }, "Import completed");
}

export async function runJobsAction() {
  return run(async () => {
    await requireUser("integration.manage");
    return runDueJobs(20);
  }, "Due jobs processed");
}

export async function retryJobAction(id: string) {
  return run(async () => {
    const u = await requireUser("integration.manage");
    const j = await prisma.integrationJob.findUniqueOrThrow({ where: { id } });
    if (!["FAILED", "DEAD"].includes(j.status)) throw new AppError("Only failed jobs can be retried.");
    await prisma.integrationJob.update({ where: { id }, data: { status: "PENDING", nextRunAt: new Date(), attempts: 0 } });
    await audit({ userId: u.id, userEmail: u.email, action: "integration.job.retry", entityType: "IntegrationJob", entityId: id });
    await runDueJobs(5);
  }, "Job retried");
}
