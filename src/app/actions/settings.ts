"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zInt, zBool } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { getSetting, setSetting, type Settings } from "@/lib/settings";
import { RULE_DEFINITIONS, type RuleKey } from "@/lib/scheduling/engine";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/templates";
import { sendEmail } from "@/lib/notifications/email";
import { rateLimit } from "@/lib/rate-limit";

const opt = (max = 300) => z.preprocess((v) => (v == null ? "" : v), z.string().trim().max(max));
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

async function save<K extends keyof Settings>(userId: string, email: string, key: K, value: Settings[K]) {
  const before = await getSetting(key);
  await setSetting(key, value, userId);
  await audit({ userId, userEmail: email, action: "settings.update", entityType: "SystemSetting", entityId: key, before, after: value });
}

/** One action per settings section keeps validation tight and the audit trail readable. */
export async function saveSettingsSectionAction(section: string, fd: FormData) {
  return run(async () => {
    const u = await requireUser("settings.manage");
    const raw = formToObject(fd);
    switch (section) {
      case "general": {
        const p = z
          .object({
            name: zStr(160),
            address: opt(500),
            email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
            phone: opt(60),
            taxId: opt(60),
            defaultTimezone: zStr(64).refine(validZone, "Unknown IANA time zone"),
            currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO code such as LKR or USD"),
          })
          .parse(raw);
        const prev = await getSetting("company.profile");
        await save(u.id, u.email, "company.profile", { ...prev, name: p.name, address: p.address, email: p.email, phone: p.phone, taxId: p.taxId });
        await save(u.id, u.email, "locale", { ...(await getSetting("locale")), defaultTimezone: p.defaultTimezone });
        const cur = await getSetting("billing.currency");
        if (cur.code !== p.currency) {
          const open = await prisma.invoice.count({ where: { status: { in: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } });
          if (open) throw new AppError(`Settle or cancel the ${open} open invoice(s) before changing the base currency. Other settings were saved.`);
          await save(u.id, u.email, "billing.currency", { code: p.currency });
        }
        return;
      }
      case "billing": {
        const p = z
          .object({
            taxBase: z.enum(["AFTER_COMMISSION", "BEFORE_COMMISSION"]),
            billOn: z.enum(["AIRED", "SCHEDULED"]),
            footer: opt(500),
            paymentInstructions: opt(1000),
            showCommission: zBool,
            reminderDays: zInt(0, 60),
          })
          .parse(raw);
        await save(u.id, u.email, "billing.taxBase", { mode: p.taxBase });
        await save(u.id, u.email, "billing.billOn", { mode: p.billOn });
        await save(u.id, u.email, "billing.invoiceLayout", { footer: p.footer, paymentInstructions: p.paymentInstructions, showCommission: p.showCommission });
        await save(u.id, u.email, "notifications.paymentReminderDays", { days: p.reminderDays });
        return;
      }
      case "approvals": {
        const names = ([] as unknown[]).concat(raw.stageName ?? []).map(String);
        const perms = ([] as unknown[]).concat(raw.stagePermission ?? []).map(String);
        const stages = names.map((name, i) => ({ name: name.trim(), permission: perms[i] })).filter((s) => s.name);
        if (!stages.length || stages.length > 4) throw new AppError("Configure between one and four approval stages.");
        for (const s of stages) if (!["ro.approve.sales", "ro.approve.finance"].includes(s.permission)) throw new AppError(`Stage "${s.name}" must use an approval permission.`);
        const pending = await prisma.releaseOrder.count({ where: { status: "SUBMITTED" } });
        if (pending) throw new AppError(`${pending} release order(s) are part-way through approval. Approve or reject them before changing the stages.`);
        await save(u.id, u.email, "ro.approvalStages", { stages });
        return;
      }
      case "operations": {
        const p = z
          .object({
            lowAvailabilityPct: zInt(0, 100),
            unusedCapacityPct: zInt(0, 100),
            maxMb: zInt(1, 200),
            allowedExtensions: zStr(400),
          })
          .parse(raw);
        const exts = [...new Set(p.allowedExtensions.split(/[\s,]+/).map((e) => e.replace(/^\./, "").toLowerCase()).filter(Boolean))];
        const bad = exts.find((e) => !/^[a-z0-9]{1,8}$/.test(e) || ["exe", "js", "html", "htm", "svg", "sh", "bat", "php"].includes(e));
        if (bad) throw new AppError(`"${bad}" is not an allowed upload type.`);
        await save(u.id, u.email, "inventory.alerts", { lowAvailabilityPct: p.lowAvailabilityPct, unusedCapacityPct: p.unusedCapacityPct });
        await save(u.id, u.email, "uploads", { maxBytes: p.maxMb * 1024 * 1024, allowedExtensions: exts });
        return;
      }
      default:
        throw new AppError("Unknown settings section.");
    }
  }, "Settings saved");
}

// ───────────── Scheduling rules ─────────────

export async function saveRuleAction(key: string, channelId: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("schedule.rules.manage");
    const def = RULE_DEFINITIONS[key as RuleKey];
    if (!def) throw new AppError("Unknown rule.");
    const raw = formToObject(fd);
    const base = z.object({ enabled: zBool, severity: z.enum(["ERROR", "WARNING"]) }).parse(raw);
    let params: Record<string, unknown>;
    try {
      params = raw.params ? JSON.parse(String(raw.params)) : {};
    } catch {
      throw new z.ZodError([{ code: "custom", path: ["params"], message: "Parameters must be valid JSON" }]);
    }
    // Parameters must keep the shape of the defaults so the engine can rely on them.
    for (const [k, v] of Object.entries(def.defaults)) {
      if (!(k in params)) throw new z.ZodError([{ code: "custom", path: ["params"], message: `Missing parameter "${k}"` }]);
      const want = Array.isArray(v) ? "array" : typeof v;
      const got = Array.isArray(params[k]) ? "array" : typeof params[k];
      if (want !== got) throw new z.ZodError([{ code: "custom", path: ["params"], message: `"${k}" must be ${want === "array" ? "a list" : `a ${want}`}` }]);
      if (typeof params[k] === "number" && (params[k] as number) < 0) throw new z.ZodError([{ code: "custom", path: ["params"], message: `"${k}" cannot be negative` }]);
    }
    for (const k of Object.keys(params)) if (!(k in def.defaults)) throw new z.ZodError([{ code: "custom", path: ["params"], message: `Unknown parameter "${k}"` }]);
    if (key === "NO_OVERLAP" && (!base.enabled || base.severity !== "ERROR")) throw new AppError("The overlap rule protects playout integrity and must stay enabled as an error.");
    const where = { key, channelId };
    const before = await prisma.schedulingRule.findFirst({ where });
    const data = { enabled: base.enabled, severity: base.severity, params: params as object };
    if (before) await prisma.schedulingRule.update({ where: { id: before.id }, data });
    else await prisma.schedulingRule.create({ data: { ...where, ...data } });
    await audit({ userId: u.id, userEmail: u.email, action: "rule.update", entityType: "SchedulingRule", entityId: `${key}:${channelId ?? "all"}`, before, after: data });
  }, "Rule saved");
}

export async function resetRuleOverrideAction(key: string, channelId: string) {
  return run(async () => {
    const u = await requireUser("schedule.rules.manage");
    await prisma.schedulingRule.deleteMany({ where: { key, channelId } });
    await audit({ userId: u.id, userEmail: u.email, action: "rule.override_removed", entityType: "SchedulingRule", entityId: `${key}:${channelId}` });
  }, "Channel override removed");
}

// ───────────── Notification templates ─────────────

export async function saveTemplateAction(key: string, fd: FormData) {
  return run(async () => {
    const u = await requireUser("notification.manage");
    const def = DEFAULT_TEMPLATES[key];
    if (!def) throw new AppError("Unknown notification.");
    const p = z.object({ subject: zStr(200), body: zStr(4000), emailEnabled: zBool, inAppEnabled: zBool, recipientRoles: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())) }).parse(formToObject(fd));
    if (key.startsWith("auth.") && !p.body.includes("{{link}}")) throw new z.ZodError([{ code: "custom", path: ["body"], message: "This email must contain {{link}}" }]);
    if (key.startsWith("auth.") && !p.emailEnabled) throw new AppError("Account emails cannot be switched off; users would be unable to set passwords.");
    const before = await prisma.notificationTemplate.findUnique({ where: { key } });
    await prisma.notificationTemplate.upsert({ where: { key }, create: { key, name: def.name, ...p }, update: p });
    await audit({ userId: u.id, userEmail: u.email, action: "notification_template.update", entityType: "NotificationTemplate", entityId: key, before, after: p });
  }, "Template saved");
}

export async function resetTemplateAction(key: string) {
  return run(async () => {
    const u = await requireUser("notification.manage");
    await prisma.notificationTemplate.deleteMany({ where: { key } });
    await audit({ userId: u.id, userEmail: u.email, action: "notification_template.reset", entityType: "NotificationTemplate", entityId: key });
  }, "Template reset to default");
}

export async function sendTestEmailAction(fd: FormData) {
  return run(async () => {
    const u = await requireUser("settings.manage");
    if (!rateLimit(`testmail:${u.id}`, 5, 10 * 60_000).ok) throw new AppError("Too many test emails. Try again in a few minutes.");
    const to = z.string().trim().email("Enter a valid email").parse(formToObject(fd).to);
    const ok = await sendEmail({ to, subject: "TRENDS test email", text: "This is a test message from TRENDS System Settings.", template: "test" });
    if (!ok) throw new AppError("Sending failed. See the email log for the provider's error.");
  }, "Test email processed. Check the email log.");
}

