import Link from "next/link";
import { Check } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PERMISSIONS, ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { SearchBox, FilterSelect } from "@/components/layout/filters";
import { fmtDateTime } from "@/lib/time";
import { sp, cn } from "@/lib/utils";
import { UserDialog, UserRowActions, RoleDialog, DeleteRole, type UserRec, type RoleRec } from "./client";

export const metadata = { title: "User Management" };

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePage("user.view");
  const p = await searchParams;
  const tab = sp(p.tab) === "roles" ? "roles" : "users";
  const q = sp(p.q);
  const status = sp(p.status);
  const canManage = me.permissions.has("user.manage");
  const [users, roles, channels, sessions] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
      include: { roles: { include: { role: true } }, channels: { include: { channel: { select: { code: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    prisma.channel.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.session.groupBy({ by: ["userId"], where: { expiresAt: { gt: new Date() } }, _count: true }),
  ]);
  const live = new Map(sessions.map((s) => [s.userId, s._count]));
  const roleOpts = roles.map((r) => ({ value: r.id, label: r.name, hint: r.description ?? undefined }));
  const chOpts = channels.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));
  const areas = [...new Set(ALL_PERMISSIONS.map((k) => PERMISSIONS[k][0]))];
  const groups = areas.map((area) => ({ area, options: ALL_PERMISSIONS.filter((k) => PERMISSIONS[k][0] === area).map((k) => ({ value: k, label: PERMISSIONS[k][1], hint: k })) }));
  const roleRec = (r: (typeof roles)[number]): RoleRec => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions.map((x) => x.permission.key) });

  return (
    <div>
      <PageHeader
        title="User management"
        description="Users, their roles and channel access. Permissions are checked on the server for every page and action; this screen only changes who has them."
        actions={canManage && (tab === "users" ? <UserDialog roles={roleOpts} channels={chOpts} /> : <RoleDialog groups={groups} />)}
      />
      <div className="mb-4 flex gap-1 border-b border-border">
        {[
          ["users", `Users (${users.length})`],
          ["roles", `Roles & permissions (${roles.length})`],
        ].map(([k, l]) => (
          <Link key={k} href={`/users?tab=${k}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-fg")}>
            {l}
          </Link>
        ))}
      </div>
      {tab === "users" ? (
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <SearchBox placeholder="Name or email" />
            <FilterSelect param="status" label="Status" options={["ACTIVE", "SUSPENDED", "LOCKED", "DISABLED"].map((s) => ({ value: s, label: s.toLowerCase() }))} />
          </div>
          {users.length === 0 ? (
            <EmptyState title="No users match" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Roles</TH>
                  <TH>Channels</TH>
                  <TH>Status</TH>
                  <TH>Last sign-in</TH>
                  <TH className="text-right">Sessions</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {users.map((u) => {
                  const rec: UserRec = { id: u.id, email: u.email, name: u.name, status: u.status, allChannels: u.allChannels, roleIds: u.roles.map((r) => r.roleId), channelIds: u.channels.map((c) => c.channelId) };
                  const isSuper = u.roles.some((r) => r.role.key === "SUPER_ADMIN");
                  return (
                    <TR key={u.id}>
                      <TD>
                        <div className="font-medium">
                          {u.name} {u.id === me.id && <span className="text-xs font-normal text-muted">(you)</span>}
                        </div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r.roleId} tone={r.role.key === "SUPER_ADMIN" ? "violet" : "blue"}>
                              {r.role.name}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      <TD className="text-xs">{u.allChannels || isSuper ? "All channels" : u.channels.map((c) => c.channel.code).join(", ") || <span className="text-danger">None</span>}</TD>
                      <TD>
                        <StatusBadge status={u.status} />
                      </TD>
                      <TD className="text-xs text-muted">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</TD>
                      <TD className="text-right tabular-nums">{live.get(u.id) ?? 0}</TD>
                      <TD>
                        {canManage && (
                          <div className="flex justify-end gap-1">
                            <UserRowActions id={u.id} name={u.name} active={u.status === "ACTIVE"} />
                            <UserDialog u={rec} roles={roleOpts} channels={chOpts} />
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH className="sticky left-0 z-10 min-w-72 bg-surface">Permission</TH>
                {roles.map((r) => (
                  <TH key={r.id} className="min-w-24 text-center align-bottom">
                    <div className="text-xs">{r.name}</div>
                    <div className="text-[10px] font-normal text-muted">{r._count.users} user(s)</div>
                    {canManage && r.key !== "SUPER_ADMIN" && (
                      <div className="mt-1 flex justify-center">
                        <RoleDialog r={roleRec(r)} groups={groups} />
                        {!r.isSystem && <DeleteRole id={r.id} name={r.name} />}
                      </div>
                    )}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {groups.map((g) => [
                <TR key={g.area}>
                  <TD colSpan={roles.length + 1} className="bg-surface-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {g.area}
                  </TD>
                </TR>,
                ...g.options.map((o) => (
                  <TR key={o.value}>
                    <TD className="sticky left-0 z-10 min-w-72 bg-surface text-xs">
                      {o.label} <span className="font-mono text-[10px] text-muted">{o.value}</span>
                    </TD>
                    {roles.map((r) => (
                      <TD key={r.id} className="text-center">
                        {r.key === "SUPER_ADMIN" || r.permissions.some((x) => x.permission.key === o.value) ? <Check className="mx-auto size-4 text-success" aria-label="Granted" /> : <span className="text-border">·</span>}
                      </TD>
                    ))}
                  </TR>
                )),
              ])}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
