import "server-only";
import { prisma } from "../db";
import { getSetting } from "../settings";
import { audit } from "../audit";
import { AppError, PermissionError } from "../errors";
import { addDaysStr, broadcastDayRange, todayIn } from "../time";
import type { CurrentUser } from "../auth/session";
import { reportByKey, type ReportDef, type ReportFilters } from "./definitions";

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const get = (p: Params, k: string) => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Validate a report request and build its filters, enforcing permission and channel scope. */
export async function resolveReport(user: CurrentUser, key: string, p: Params): Promise<{ def: ReportDef; filters: ReportFilters; label: string }> {
  const def = reportByKey(key);
  if (!def) throw new AppError("Unknown report.", "NOT_FOUND");
  if (!user.permissions.has(def.permission)) throw new PermissionError();
  const tz = (await getSetting("locale")).defaultTimezone;
  const today = todayIn(tz);
  const fromStr = isDate(get(p, "from")) ? get(p, "from")! : addDaysStr(today, -6);
  const toStr = isDate(get(p, "to")) ? get(p, "to")! : today;
  if (fromStr > toStr) throw new AppError("The start date must be on or before the end date.");
  if ((Date.parse(toStr) - Date.parse(fromStr)) / 86400000 > 400) throw new AppError("Choose a period of 400 days or less.");
  const channelId = get(p, "channel");
  if (channelId && !user.allChannels && !user.channelIds.includes(channelId)) throw new PermissionError("You do not have access to that channel.");
  // Interpret dates as broadcast days in the chosen channel's zone (or the system zone).
  const ch = channelId ? await prisma.channel.findUnique({ where: { id: channelId } }) : null;
  const zone = ch ?? { timezone: tz, broadcastDayStartHour: 0 };
  const filters: ReportFilters = {
    from: broadcastDayRange(zone, fromStr).start,
    to: broadcastDayRange(zone, toStr).end,
    fromStr,
    toStr,
    channelId,
    channelIds: user.allChannels ? undefined : user.channelIds,
    clientId: get(p, "client"),
    agencyId: get(p, "agency"),
    status: def.statuses?.includes(get(p, "status") ?? "") ? get(p, "status") : undefined,
    campaign: get(p, "campaign")?.slice(0, 100),
  };
  const label = `${fromStr} to ${toStr}${ch ? ` · ${ch.code}` : ""}`;
  return { def, filters, label };
}

export async function runReport(user: CurrentUser, key: string, p: Params, format: "view" | "csv" | "xlsx" | "print" = "view") {
  const r = await resolveReport(user, key, p);
  const result = await r.def.run(r.filters);
  if (format !== "view") await audit({ userId: user.id, userEmail: user.email, action: "report.export", entityType: "Report", entityId: key, after: { format, period: r.label, rows: result.rows.length } });
  return { ...r, result };
}
