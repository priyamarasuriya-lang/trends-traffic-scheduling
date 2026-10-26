import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { storage } from "../storage";
import { notify } from "../notifications/service";
import { broadcastDayRange, fmtTz } from "../time";
import { emailMode } from "../notifications/email";
import { activeGateway } from "../payments/gateway";
import { parseCsv, toCsv } from "../reports/csv";

// Connector architecture. Each adapter declares the environment variables it
// needs. File-based import/export works without credentials (the operator moves
// the file); live API sync is attempted only when credentials are configured.
// Nothing reports CONNECTED unless a real connection test succeeded.

export type JobParams = Record<string, unknown>;
export type JobOutput = { result: Record<string, unknown>; file?: { name: string; mime: string; data: Buffer } };

export interface IntegrationAdapter {
  key: string;
  name: string;
  description: string;
  requiredEnv: string[];
  jobs: { kind: string; direction: "IMPORT" | "EXPORT"; label: string }[];
  test(): Promise<{ status: "CONNECTED" | "TEST_MODE" | "NOT_CONFIGURED" | "ERROR"; message: string }>;
  run(kind: string, params: JobParams): Promise<JobOutput>;
}

const hasEnv = (keys: string[]) => keys.every((k) => !!process.env[k]);
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

async function issuedInvoices(params: JobParams) {
  const from = params.from ? new Date(String(params.from)) : new Date(Date.now() - 31 * 86400000);
  const to = params.to ? new Date(String(params.to)) : new Date();
  return prisma.invoice.findMany({ where: { number: { not: null }, issueDate: { gte: from, lte: to }, status: { not: "CANCELLED" } }, include: { client: true, agency: true }, orderBy: { issueDate: "asc" } });
}

const tally: IntegrationAdapter = {
  key: "TALLY",
  name: "Tally",
  description: "Exports issued invoices as Tally sales vouchers (XML). Posts directly to a Tally HTTP server when TALLY_URL is set.",
  requiredEnv: ["TALLY_URL"],
  jobs: [{ kind: "INVOICES", direction: "EXPORT", label: "Export invoices as Tally vouchers" }],
  async test() {
    if (!hasEnv(this.requiredEnv)) return { status: "TEST_MODE", message: "TALLY_URL not set. File export works; direct posting is disabled." };
    try {
      const r = await fetch(process.env.TALLY_URL!, { method: "POST", body: "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER></ENVELOPE>", signal: AbortSignal.timeout(5000) });
      return r.ok ? { status: "CONNECTED", message: "Tally server responded." } : { status: "ERROR", message: `Tally server returned HTTP ${r.status}.` };
    } catch (e) {
      return { status: "ERROR", message: `Cannot reach Tally: ${e instanceof Error ? e.message : "error"}` };
    }
  },
  async run(_kind, params) {
    const invs = await issuedInvoices(params);
    const ledgerSales = String(params.salesLedger ?? "Advertising Sales");
    const vouchers = invs
      .map(
        (i) => `  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Sales" ACTION="Create">
    <DATE>${i.issueDate!.toISOString().slice(0, 10).replace(/-/g, "")}</DATE>
    <VOUCHERNUMBER>${xmlEsc(i.number!)}</VOUCHERNUMBER>
    <PARTYLEDGERNAME>${xmlEsc(i.agency?.name ?? i.client.name)}</PARTYLEDGERNAME>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(i.agency?.name ?? i.client.name)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${i.total.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(ledgerSales)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${i.total.sub(i.taxTotal).toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output Tax</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${i.taxTotal.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>`,
      )
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>\n${vouchers}\n </REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>\n`;
    let posted = false;
    if (hasEnv(this.requiredEnv)) {
      const r = await fetch(process.env.TALLY_URL!, { method: "POST", body: xml, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`Tally rejected the import (HTTP ${r.status}).`);
      posted = true;
    }
    return { result: { invoices: invs.map((i) => i.number), count: invs.length, posted }, file: { name: `tally-vouchers-${Date.now()}.xml`, mime: "application/xml", data: Buffer.from(xml) } };
  },
};

const sap: IntegrationAdapter = {
  key: "SAP",
  name: "SAP",
  description: "Exports AR invoice journal lines as CSV for SAP import. Live OData posting needs SAP_API_URL, SAP_USERNAME and SAP_PASSWORD plus your SAP service mapping.",
  requiredEnv: ["SAP_API_URL", "SAP_USERNAME", "SAP_PASSWORD"],
  jobs: [{ kind: "INVOICES", direction: "EXPORT", label: "Export AR journal (CSV)" }],
  async test() {
    if (!hasEnv(this.requiredEnv)) return { status: "TEST_MODE", message: "SAP credentials not set. CSV export works; live posting is disabled." };
    try {
      const r = await fetch(process.env.SAP_API_URL!, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.SAP_USERNAME}:${process.env.SAP_PASSWORD}`).toString("base64")}` }, signal: AbortSignal.timeout(5000) });
      return r.ok ? { status: "CONNECTED", message: "SAP endpoint responded." } : { status: "ERROR", message: `SAP endpoint returned HTTP ${r.status}.` };
    } catch (e) {
      return { status: "ERROR", message: `Cannot reach SAP: ${e instanceof Error ? e.message : "error"}` };
    }
  },
  async run(_kind, params) {
    const invs = await issuedInvoices(params);
    const rows = invs.flatMap((i) => [
      { DocDate: i.issueDate!.toISOString().slice(0, 10), DocNumber: i.number, Customer: i.agency?.code ?? i.client.code, Account: "AR", Debit: i.total.toFixed(2), Credit: "0.00", Currency: i.currency },
      { DocDate: i.issueDate!.toISOString().slice(0, 10), DocNumber: i.number, Customer: i.agency?.code ?? i.client.code, Account: "REVENUE", Debit: "0.00", Credit: i.total.sub(i.taxTotal).toFixed(2), Currency: i.currency },
      { DocDate: i.issueDate!.toISOString().slice(0, 10), DocNumber: i.number, Customer: i.agency?.code ?? i.client.code, Account: "OUTPUT_TAX", Debit: "0.00", Credit: i.taxTotal.toFixed(2), Currency: i.currency },
    ]);
    const csv = toCsv(["DocDate", "DocNumber", "Customer", "Account", "Debit", "Credit", "Currency"], rows);
    return { result: { invoices: invs.map((i) => i.number), count: invs.length, posted: false }, file: { name: `sap-ar-journal-${Date.now()}.csv`, mime: "text/csv", data: Buffer.from(csv) } };
  },
};

const ams: IntegrationAdapter = {
  key: "AMS",
  name: "Asset Management System",
  description: "Imports media metadata from a CSV (assetCode,title,category,durationSec,language,fileRef,rightsOwner). Live sync needs AMS_API_URL and AMS_API_TOKEN.",
  requiredEnv: ["AMS_API_URL", "AMS_API_TOKEN"],
  jobs: [{ kind: "MEDIA_METADATA", direction: "IMPORT", label: "Import media metadata (CSV)" }],
  async test() {
    if (!hasEnv(this.requiredEnv)) return { status: "TEST_MODE", message: "AMS API not configured. CSV import works." };
    try {
      const r = await fetch(`${process.env.AMS_API_URL}/health`, { headers: { Authorization: `Bearer ${process.env.AMS_API_TOKEN}` }, signal: AbortSignal.timeout(5000) });
      return r.ok ? { status: "CONNECTED", message: "AMS responded." } : { status: "ERROR", message: `AMS returned HTTP ${r.status}.` };
    } catch (e) {
      return { status: "ERROR", message: `Cannot reach AMS: ${e instanceof Error ? e.message : "error"}` };
    }
  },
  async run(_kind, params) {
    const fileId = String(params.fileId ?? "");
    const f = await prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!f) throw new Error("Import file not found.");
    const rows = parseCsv((await storage().get(f.storageKey)).toString("utf8"));
    const valid = ["PROGRAM", "MOVIE", "COMMERCIAL", "PROMO", "TIMER", "SLIDE", "COMING_UP", "FILLER", "NEW_MEDIA", "SECONDARY"];
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      const duration = Number(r.durationSec);
      if (!r.assetCode || !r.title) { errors.push(`Row ${line}: assetCode and title are required.`); continue; }
      if (!valid.includes((r.category ?? "").toUpperCase())) { errors.push(`Row ${line}: unknown category "${r.category}".`); continue; }
      if (!Number.isInteger(duration) || duration <= 0) { errors.push(`Row ${line}: durationSec must be a positive integer.`); continue; }
      const data = { title: r.title, category: r.category.toUpperCase() as never, durationSec: duration, language: r.language || null, fileRef: r.fileRef || null, rightsOwner: r.rightsOwner || null };
      const ex = await prisma.mediaAsset.findUnique({ where: { assetCode: r.assetCode } });
      if (ex) {
        await prisma.mediaAsset.update({ where: { id: ex.id }, data });
        updated++;
      } else {
        await prisma.mediaAsset.create({ data: { ...data, assetCode: r.assetCode, approvalStatus: "PENDING" } });
        created++;
      }
    }
    return { result: { rows: rows.length, created, updated, errors: errors.slice(0, 100) } };
  },
};

const automation: IntegrationAdapter = {
  key: "AUTOMATION",
  name: "Broadcast automation",
  description: "Exports a published day as a playlist (CSV) for playout automation. Direct push needs AUTOMATION_API_URL and AUTOMATION_API_TOKEN.",
  requiredEnv: ["AUTOMATION_API_URL", "AUTOMATION_API_TOKEN"],
  jobs: [{ kind: "PLAYLIST", direction: "EXPORT", label: "Export playlist for a channel/day" }],
  async test() {
    return hasEnv(this.requiredEnv) ? { status: "TEST_MODE", message: "Credentials present; push is attempted on export. Verify with your vendor." } : { status: "TEST_MODE", message: "No automation API configured. Playlist file export works." };
  },
  async run(_kind, params) {
    const channelId = String(params.channelId ?? "");
    const date = String(params.date ?? "");
    const ch = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw new Error("Channel not found.");
    const s = await prisma.schedule.findUnique({ where: { channelId_broadcastDate: { channelId, broadcastDate: date } } });
    if (!s || s.status !== "PUBLISHED") throw new Error(`The ${date} schedule for ${ch.name} is not published.`);
    const { start, end } = broadcastDayRange(ch, date);
    const events = await prisma.scheduleEvent.findMany({ where: { channelId, startAt: { gte: start, lt: end }, status: { not: "CANCELLED" } }, include: { asset: true }, orderBy: { startAt: "asc" } });
    const rows = events.map((e) => ({ StartTime: fmtTz(e.startAt, ch.timezone, "HH:mm:ss"), HouseNumber: e.asset.assetCode, Title: e.title, Type: e.eventType, DurationSec: e.durationSec, FileRef: e.asset.fileRef ?? "", Break: e.breakId ? "Y" : "" }));
    const csv = toCsv(["StartTime", "HouseNumber", "Title", "Type", "DurationSec", "FileRef", "Break"], rows);
    let pushed = false;
    if (hasEnv(this.requiredEnv)) {
      const r = await fetch(process.env.AUTOMATION_API_URL!, { method: "POST", headers: { Authorization: `Bearer ${process.env.AUTOMATION_API_TOKEN}`, "Content-Type": "text/csv" }, body: csv, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`Automation system rejected the playlist (HTTP ${r.status}).`);
      pushed = true;
    }
    return { result: { channel: ch.code, date, events: events.length, version: s.version, pushed }, file: { name: `playlist-${ch.code}-${date}-v${s.version}.csv`, mime: "text/csv", data: Buffer.from(csv) } };
  },
};

const email: IntegrationAdapter = {
  key: "EMAIL",
  name: "Email provider",
  description: "SMTP delivery for notifications. Set EMAIL_PROVIDER=smtp and SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/EMAIL_FROM.",
  requiredEnv: ["SMTP_HOST"],
  jobs: [],
  async test() {
    if (emailMode() !== "smtp") return { status: "TEST_MODE", message: "Preview mode: emails are logged in Settings → Email log and not sent." };
    try {
      const nodemailer = await import("nodemailer");
      await nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }).verify();
      return { status: "CONNECTED", message: "SMTP server accepted the connection." };
    } catch (e) {
      return { status: "ERROR", message: `SMTP check failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}` };
    }
  },
  async run() {
    throw new Error("The email integration has no jobs.");
  },
};

const payment: IntegrationAdapter = {
  key: "PAYMENT",
  name: "Payment gateway",
  description: "Online invoice payments. PAYMENT_GATEWAY=simulated for testing, or stripe with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
  requiredEnv: ["PAYMENT_GATEWAY"],
  jobs: [],
  async test() {
    const g = activeGateway();
    if (!g) return { status: "NOT_CONFIGURED", message: "No payment gateway configured; online payment links are hidden." };
    if (g.isSimulated) return { status: "TEST_MODE", message: "Simulated gateway active. No real money moves." };
    return { status: "TEST_MODE", message: `${g.label} keys are present. Status becomes CONNECTED after the first verified webhook.` };
  },
  async run() {
    throw new Error("The payment integration has no jobs.");
  },
};

export const ADAPTERS: Record<string, IntegrationAdapter> = { SAP: sap, TALLY: tally, AMS: ams, AUTOMATION: automation, EMAIL: email, PAYMENT: payment };

export async function ensureIntegrations() {
  for (const a of Object.values(ADAPTERS)) {
    await prisma.integration.upsert({ where: { key: a.key }, create: { key: a.key, name: a.name, adapter: a.key.toLowerCase() }, update: {} });
  }
}

export async function testIntegration(userId: string, key: string) {
  const a = ADAPTERS[key];
  if (!a) throw new AppError("Unknown integration.");
  const r = await a.test();
  await prisma.integration.update({ where: { key }, data: { status: r.status, lastCheckedAt: new Date(), lastError: r.status === "ERROR" ? r.message : null } });
  await audit({ userId, action: "integration.test", entityType: "Integration", entityId: key, after: r });
  return r;
}

/** Queue a job. Identical payloads are de-duplicated unless `force` is set. */
export async function queueJob(userId: string, key: string, kind: string, params: JobParams, force = false) {
  const a = ADAPTERS[key];
  const def = a?.jobs.find((j) => j.kind === kind);
  if (!a || !def) throw new AppError("Unknown integration job.");
  const integ = await prisma.integration.findUniqueOrThrow({ where: { key } });
  const dedupeKey = force ? null : createHash("sha256").update(JSON.stringify({ key, kind, params })).digest("hex");
  if (dedupeKey) {
    const dup = await prisma.integrationJob.findUnique({ where: { dedupeKey } });
    if (dup && dup.status !== "DEAD" && dup.status !== "FAILED") throw new AppError(`An identical ${def.label.toLowerCase()} job already exists (${dup.status.toLowerCase()}). Use "Run again" to force a re-run.`, "DUPLICATE_JOB");
    if (dup) await prisma.integrationJob.update({ where: { id: dup.id }, data: { dedupeKey: null } });
  }
  const job = await prisma.integrationJob.create({ data: { integrationId: integ.id, direction: def.direction, kind, params: params as object, dedupeKey, createdById: userId } });
  await audit({ userId, action: "integration.job.queue", entityType: "IntegrationJob", entityId: job.id, after: { key, kind, params } });
  return job;
}

/** Run due jobs with exponential backoff (1, 4, 16 minutes). Returns counts. */
export async function runDueJobs(limit = 10) {
  const jobs = await prisma.integrationJob.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextRunAt: { lte: new Date() } }, include: { integration: true }, take: limit, orderBy: { nextRunAt: "asc" } });
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    const claimed = await prisma.integrationJob.updateMany({ where: { id: job.id, status: job.status }, data: { status: "RUNNING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const adapter = ADAPTERS[job.integration.key];
    try {
      const out = await adapter.run(job.kind, job.params as JobParams);
      let outputFileId: string | null = null;
      if (out.file) {
        const storageKey = `integration_job/${randomUUID()}-${out.file.name}`;
        await storage().put(storageKey, out.file.data, out.file.mime);
        const f = await prisma.fileAttachment.create({ data: { entityType: "INTEGRATION_JOB", entityId: job.id, fileName: out.file.name, storageKey, mimeType: out.file.mime, sizeBytes: out.file.data.length, sha256: createHash("sha256").update(out.file.data).digest("hex"), scanStatus: "CLEAN" } });
        outputFileId = f.id;
      }
      await prisma.integrationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: out.result as object, error: null, outputFileId } });
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 1000) : "failed";
      const attempts = job.attempts + 1;
      const dead = attempts >= job.maxAttempts;
      await prisma.integrationJob.update({ where: { id: job.id }, data: { status: dead ? "DEAD" : "FAILED", error: msg, nextRunAt: new Date(Date.now() + Math.pow(4, attempts - 1) * 60000) } });
      await prisma.integration.update({ where: { id: job.integrationId }, data: { lastError: msg } });
      if (dead) await notify("integration.failed", { integration: job.integration.name, job: job.id, kind: job.kind, attempts, error: msg }, { link: "/integrations" });
      failed++;
    }
  }
  return { ran: jobs.length, ok, failed };
}

/** Invoices issued in a period vs. invoices included in successful exports for an adapter. */
export async function reconciliation(key: "TALLY" | "SAP", from: Date, to: Date) {
  const issued = await prisma.invoice.findMany({ where: { number: { not: null }, issueDate: { gte: from, lte: to }, status: { not: "CANCELLED" } }, select: { number: true, total: true, issueDate: true } });
  const jobs = await prisma.integrationJob.findMany({ where: { integration: { key }, status: "SUCCEEDED" } });
  const exported = new Set(jobs.flatMap((j) => ((j.result as { invoices?: string[] } | null)?.invoices ?? [])));
  return issued.map((i) => ({ number: i.number!, issueDate: i.issueDate, total: i.total.toFixed(2), exported: exported.has(i.number!) }));
}
