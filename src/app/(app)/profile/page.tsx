import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/time";
import { PasswordForm, SignOutOthers } from "./client";

export const metadata = { title: "My profile" };

export default async function Profile() {
  const me = await requirePage();
  const [user, sessions, channels] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id }, include: { roles: { include: { role: true } } } }),
    prisma.session.findMany({ where: { userId: me.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
    prisma.channel.findMany({ where: { deletedAt: null, ...(me.allChannels ? {} : { id: { in: me.channelIds } }) }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
  ]);
  const others = sessions.filter((s) => s.id !== me.sessionId).length;
  return (
    <div className="space-y-4">
      <PageHeader title="My profile" description="Your account, access and sign-in sessions. Ask an administrator to change your name, email, roles or channels." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-3 text-sm">
            <div className="grid grid-cols-[9rem_1fr] gap-y-2">
              <span className="text-muted">Name</span>
              <span>{user.name}</span>
              <span className="text-muted">Email</span>
              <span>{user.email}</span>
              <span className="text-muted">Roles</span>
              <span className="flex flex-wrap gap-1">
                {user.roles.map((r) => (
                  <Badge key={r.roleId} tone="blue">
                    {r.role.name}
                  </Badge>
                ))}
              </span>
              <span className="text-muted">Channels</span>
              <span>{me.allChannels ? "All channels" : channels.map((c) => `${c.code} · ${c.name}`).join(", ") || "None assigned"}</span>
              <span className="text-muted">Permissions</span>
              <span className="text-xs text-muted">{me.permissions.size} granted</span>
              <span className="text-muted">Password changed</span>
              <span>{fmtDateTime(user.passwordChangedAt)}</span>
            </div>
          </CardBody>
        </Card>
        <Card id="password">
          <CardHeader title="Change password" description="Changing your password signs out your other sessions." />
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Active sessions" description="Sessions expire automatically. Sign out any you do not recognise." actions={others > 0 && <SignOutOthers count={others} />} />
        <Table>
          <THead>
            <TR>
              <TH>Device</TH>
              <TH>IP</TH>
              <TH>Signed in</TH>
              <TH>Last active</TH>
              <TH>Expires</TH>
            </TR>
          </THead>
          <TBody>
            {sessions.map((s) => (
              <TR key={s.id}>
                <TD className="max-w-md truncate text-xs">
                  {s.id === me.sessionId && <Badge tone="green">This browser</Badge>} {s.userAgent ?? "Unknown"}
                </TD>
                <TD className="text-xs">{s.ip ?? "—"}</TD>
                <TD className="text-xs">{fmtDateTime(s.createdAt)}</TD>
                <TD className="text-xs">{fmtDateTime(s.lastSeenAt)}</TD>
                <TD className="text-xs">{fmtDateTime(s.expiresAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
