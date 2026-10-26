import { prisma } from "./db";

export type ApprovalStage = { name: string; permission: string };

export type Settings = {
  "company.profile": { name: string; address: string; email: string; phone: string; taxId: string; logoFileId?: string | null };
  "locale": { dateFormat: string; timeFormat: string; defaultTimezone: string };
  "billing.currency": { code: string };
  "billing.taxBase": { mode: "AFTER_COMMISSION" | "BEFORE_COMMISSION" };
  "billing.billOn": { mode: "AIRED" | "SCHEDULED" };
  "billing.invoiceLayout": { footer: string; showCommission: boolean; paymentInstructions: string };
  "ro.approvalStages": { stages: ApprovalStage[] };
  "uploads": { maxBytes: number; allowedExtensions: string[] };
  "inventory.alerts": { lowAvailabilityPct: number; unusedCapacityPct: number };
  "notifications.paymentReminderDays": { days: number };
};

export const SETTING_DEFAULTS: Settings = {
  "company.profile": { name: "Trends Broadcasting (Demo)", address: "", email: "", phone: "", taxId: "", logoFileId: null },
  locale: { dateFormat: "dd MMM yyyy", timeFormat: "HH:mm:ss", defaultTimezone: "Asia/Colombo" },
  "billing.currency": { code: "USD" },
  "billing.taxBase": { mode: "AFTER_COMMISSION" },
  "billing.billOn": { mode: "AIRED" },
  "billing.invoiceLayout": { footer: "Thank you for your business.", showCommission: true, paymentInstructions: "" },
  "ro.approvalStages": {
    stages: [
      { name: "Sales approval", permission: "ro.approve.sales" },
      { name: "Finance approval", permission: "ro.approve.finance" },
    ],
  },
  uploads: { maxBytes: 10 * 1024 * 1024, allowedExtensions: ["pdf", "png", "jpg", "jpeg", "csv", "xlsx", "docx", "txt", "xml"] },
  "inventory.alerts": { lowAvailabilityPct: 15, unusedCapacityPct: 50 },
  "notifications.paymentReminderDays": { days: 3 },
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return { ...SETTING_DEFAULTS[key], ...((row?.value as object) ?? {}) } as Settings[K];
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], userId?: string) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedById: userId },
    update: { value: value as object, updatedById: userId },
  });
}
