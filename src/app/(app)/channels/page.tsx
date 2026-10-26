import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { ChannelDialog, type ChannelRec } from "./client";

export const metadata = { title: "Channels" };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Channels() {
  const user = await requirePage("channel.view");
  const canManage = user.permissions.has("channel.manage");
  const visible = user.allChannels ? {} : { users: { some: { userId: user.id } } };
  const [channels, users] = await Promise.all([
    prisma.channel.findMany({ where: { deletedAt: null, ...visible }, include: { users: { include: { user: { select: { id: true, name: true } } } }, _count: { select: { events: true, breaks: true } } }, orderBy: { code: "asc" } }),
    canManage ? prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const zones = Intl.supportedValuesOf("timeZone");
  const defaultTz = (await getSetting("locale")).defaultTimezone;
  const userOpts = users.map((u) => ({ value: u.id, label: u.name }));
  return (
    <div>
      <PageHeader title="Channels" description="Each channel has its own time zone, broadcast day and team. Users only see channels they are assigned to unless they have all-channel access." actions={canManage && <ChannelDialog users={userOpts} zones={zones} defaultTz={defaultTz} />} />
      <Card>
        {channels.length === 0 ? (
          <EmptyState title="No channels yet" description="Create a channel to start scheduling." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Channel</TH>
                <TH>Time zone</TH>
                <TH>Broadcast day</TH>
                <TH>On air</TH>
                <TH>Team</TH>
                <TH className="text-right">Events</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {channels.map((c) => {
                const rec: ChannelRec = { id: c.id, code: c.code, name: c.name, timezone: c.timezone, broadcastDayStartHour: c.broadcastDayStartHour, broadcastDays: c.broadcastDays, color: c.color, territory: c.territory, isActive: c.isActive, userIds: c.users.map((u) => u.userId), hasEvents: c._count.events > 0 };
                return (
                  <TR key={c.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="size-3 rounded-full" style={{ background: c.color }} />
                        <span className="font-mono text-xs">{c.code}</span>
                        <span className="font-medium">{c.name}</span>
                      </div>
                      {c.territory && <div className="text-xs text-muted">{c.territory}</div>}
                    </TD>
                    <TD className="text-xs">{c.timezone}</TD>
                    <TD className="text-xs">{String(c.broadcastDayStartHour).padStart(2, "0")}:00 → {String(c.broadcastDayStartHour).padStart(2, "0")}:00 next day</TD>
                    <TD className="text-xs">{c.broadcastDays.length === 7 ? "Every day" : c.broadcastDays.map((d) => DAY[d]).join(", ")}</TD>
                    <TD className="max-w-64 text-xs text-muted">{c.users.map((u) => u.user.name).join(", ") || "—"}</TD>
                    <TD className="text-right tabular-nums">{c._count.events.toLocaleString()}</TD>
                    <TD>{c.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                    <TD className="text-right">{canManage && <ChannelDialog ch={rec} users={userOpts} zones={zones} defaultTz={defaultTz} />}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
