import { prisma } from "../db";
import { notify } from "../notifications/service";
import { getSetting } from "../settings";
import { refreshOverdue } from "../billing/service";
import { expireAgreements } from "../agreements/service";
import { runDueJobs } from "../integrations";

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** True the first time a notice key is seen; recorded in the audit log so repeated runs stay quiet. */
async function firstTime(key: string) {
  const seen = await prisma.auditLog.findFirst({ where: { action: "job.notice", entityId: key }, select: { id: true } });
  if (seen) return false;
  await prisma.auditLog.create({ data: { action: "job.notice", entityType: "Job", entityId: key } });
  return true;
}

export async function expiryNotices(now = new Date()) {
  let sent = 0;
  const licences = await prisma.contentLicense.findMany({ where: { deletedAt: null, validTo: { gte: now, lt: new Date(now.getTime() + 90 * DAY) } }, include: { asset: true } });
  for (const l of licences) {
    if (l.validTo.getTime() - now.getTime() > l.warnDaysBefore * DAY) continue;
    if (!(await firstTime(`licence:${l.id}:${ymd(l.validTo)}`))) continue;
    await notify("license.expiring", { title: l.asset.title, date: ymd(l.validTo), remaining: l.maxPlays ? `Play limit: ${l.maxPlays}.` : "" }, { link: `/rights?q=${encodeURIComponent(l.asset.assetCode)}` });
    sent++;
  }
  const agreements = await prisma.agreement.findMany({ where: { status: "ACTIVE", deletedAt: null, endDate: { gte: now, lt: new Date(now.getTime() + 14 * DAY) } } });
  for (const a of agreements) {
    if (!(await firstTime(`agreement:${a.id}:${ymd(a.endDate)}`))) continue;
    await notify("agreement.expiring", { number: a.number, title: a.title, date: ymd(a.endDate) }, { link: `/agreements/${a.id}` });
    sent++;
  }
  const promos = await prisma.promoCampaign.findMany({ where: { isActive: true, endDate: { gte: now, lt: new Date(now.getTime() + 3 * DAY) } } });
  for (const c of promos) {
    if (!(await firstTime(`promo:${c.id}:${ymd(c.endDate)}`))) continue;
    await notify("promo.expiring", { name: c.name, date: ymd(c.endDate) }, { link: "/promos" });
    sent++;
  }
  return sent;
}

/** Warn when sellable inventory for the coming week drops below the configured threshold. */
export async function lowInventoryNotices(now = new Date()) {
  const { lowAvailabilityPct } = await getSetting("inventory.alerts");
  const channels = await prisma.channel.findMany({ where: { isActive: true, deletedAt: null } });
  let sent = 0;
  for (const ch of channels) {
    for (let d = 0; d < 7; d++) {
      const start = new Date(now.getTime() + d * DAY);
      const date = ymd(start);
      const window = { channelId: ch.id, startAt: { gte: new Date(date + "T00:00:00Z"), lt: new Date(new Date(date + "T00:00:00Z").getTime() + DAY) } };
      const [total, free] = await Promise.all([
        prisma.advertisingInventory.count({ where: { status: { notIn: ["CANCELLED", "UNAVAILABLE"] }, break: window } }),
        prisma.advertisingInventory.count({ where: { status: "AVAILABLE", break: window } }),
      ]);
      if (!total) continue;
      const pct = Math.round((free / total) * 100);
      if (pct >= lowAvailabilityPct || !(await firstTime(`inventory-low:${ch.id}:${date}`))) continue;
      await notify("inventory.low", { channel: ch.code, pct, date }, { link: `/inventory?date=${date}`, channelId: ch.id });
      sent++;
    }
  }
  return sent;
}

/** Remove expired sessions and spent reset links. */
export async function housekeeping(now = new Date()) {
  const [s, t] = await Promise.all([prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }), prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } })]);
  return { sessions: s.count, resetTokens: t.count };
}

/** Everything a scheduler (cron, systemd timer, platform cron) should run every few minutes. All steps are idempotent. */
export async function runScheduledWork() {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  };
  await step("integrationJobs", () => runDueJobs(50));
  await step("overdue", () => refreshOverdue());
  await step("agreementsExpired", () => expireAgreements());
  await step("expiryNotices", () => expiryNotices());
  await step("lowInventory", () => lowInventoryNotices());
  await step("housekeeping", () => housekeeping());
  return out;
}
