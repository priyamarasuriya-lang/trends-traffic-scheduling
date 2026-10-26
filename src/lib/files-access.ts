import type { CurrentUser } from "./auth/session";
import type { PermissionKey } from "./auth/permissions";

// Which permission is needed to view / attach files on each entity type.
export const FILE_PERMS: Record<string, { view: PermissionKey; manage: PermissionKey }> = {
  RELEASE_ORDER: { view: "ro.view", manage: "ro.manage" },
  AGREEMENT: { view: "agreement.view", manage: "agreement.manage" },
  INVOICE: { view: "billing.view", manage: "invoice.issue" },
  MEDIA_ASSET: { view: "media.view", manage: "media.manage" },
  INTEGRATION_JOB: { view: "integration.view", manage: "integration.manage" },
  COMPANY: { view: "dashboard.view", manage: "settings.manage" },
  DEAL: { view: "deal.view", manage: "deal.manage" },
};

export function canFile(user: CurrentUser, entityType: string, mode: "view" | "manage") {
  const p = FILE_PERMS[entityType];
  return !!p && user.permissions.has(p[mode]);
}
