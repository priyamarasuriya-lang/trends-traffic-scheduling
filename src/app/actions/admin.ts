"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { run, formToObject, zStr, zOptStr, zInt, zBool } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { hashPassword, passwordPolicyError } from "@/lib/auth/password";
import { issuePasswordLink } from "@/lib/auth/reset";
import { newToken } from "@/lib/auth/tokens";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";

const ids = z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string()));
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ───────────── Channels ─────────────

const channelSchema = z.object({
  code: zStr(12).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, dash and underscore only").transform((s) => s.toUpperCase()),
  name: zStr(120),
  timezone: zStr(64).refine(validZone, "Unknown IANA time zone (e.g. Asia/Colombo)"),
  broadcastDayStartHour: zInt(0, 12),
  broadcastDays: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().min(0).max(6)).min(1, "Choose at least one day")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0ea5e9"),
  territory: zOptStr(60),
  isActive: zBool,
  userIds: ids,
});

export async function saveChannelAction(id: string | null, fd: FormData) {
  return run(async () => {
    const u = await requireUser("channel.manage");
    const p = channelSchema.parse(formToObject(fd));
    const { userIds, ...data } = p;
    const ch = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.channel.findUniqueOrThrow({ where: { id } }) : null;
      if (before && (before.timezone !== data.timezone || before.broadcastDayStartHour !== data.broadcastDayStartHour)) {
        const events = await tx.scheduleEvent.count({ where: { channelId: id! } });
        if (events) throw new AppError("The time zone and broadcast-day start cannot change once the channel has schedule events, because existing broadcast days would shift. Create a new channel instead.");
      }
      const ch = id ? await tx.channel.update({ where: { id }, data }) : await tx.channel.create({ data });
      await tx.channelUser.deleteMany({ where: { channelId: ch.id, userId: { notIn: userIds } } });
      for (const uid of userIds) await tx.channelUser.upsert({ where: { channelId_userId: { channelId: ch.id, userId: uid } }, create: { channelId: ch.id, userId: uid }, update: {} });
      await audit({ userId: u.id, userEmail: u.email, action: id ? "channel.update" : "channel.create", entityType: "Channel", entityId: ch.id, before, after: { ...data, userIds } }, tx);
      return ch;
    });
    return { id: ch.id };
  }, "Channel saved");
}

// ───────────── Users ─────────────

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  name: zStr(120),
  status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED", "DISABLED"]),
  allChannels: zBool,
  roleIds: ids,
  channelIds: ids,
  password: zOptStr(200),
  sendInvite: zBool,
});

async function superAdminsLeft(excludingUserId: string) {
  return prisma.user.count({ where: { id: { not: excludingUserId }, status: "ACTIVE", deletedAt: null, roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
}

export async function saveUserAction(id: string | null, fd: FormData) {
  return run(async () => {
    const actor = await requireUser("user.manage");
    const p = userSchema.parse(formToObject(fd));
    if (!p.roleIds.length) throw new AppError("Give the user at least one role.");
    const roles = await prisma.role.findMany({ where: { id: { in: p.roleIds } } });
    const makesSuper = roles.some((r) => r.key === "SUPER_ADMIN");
    if (makesSuper && !actor.roles.includes("SUPER_ADMIN")) throw new AppError("Only a super administrator can grant the super administrator role.");
    if (id === actor.id) {
      if (p.status !== "ACTIVE") throw new AppError("You cannot suspend or disable your own account.");
      const keepsManage = await prisma.rolePermission.count({ where: { roleId: { in: p.roleIds }, permission: { key: "user.manage" } } });
      if (!keepsManage && !makesSuper) throw new AppError("You cannot remove your own user-management access.");
    }
    if (id) {
      const wasSuper = await prisma.userRole.count({ where: { userId: id, role: { key: "SUPER_ADMIN" } } });
      if (wasSuper && (!makesSuper || p.status !== "ACTIVE") && (await superAdminsLeft(id)) === 0) throw new AppError("At least one active super administrator must remain.");
    }
    let passwordHash: string | undefined;
    if (p.password) {
      const err = passwordPolicyError(p.password);
      if (err) throw new z.ZodError([{ code: "custom", path: ["password"], message: err }]);
      passwordHash = await hashPassword(p.password);
    }
    if (!id && !passwordHash && !p.sendInvite) throw new AppError("Set an initial password or send an invitation email.");
    const user = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.user.findUniqueOrThrow({ where: { id }, include: { roles: true, channels: true } }) : null;
      const data = { email: p.email, name: p.name, status: p.status, allChannels: p.allChannels, ...(passwordHash ? { passwordHash, passwordChangedAt: new Date() } : {}) };
      // An invited user gets an unusable random password until they set their own.
      const user = id ? await tx.user.update({ where: { id }, data }) : await tx.user.create({ data: { ...data, passwordHash: passwordHash ?? (await hashPassword(newToken())) } });
      await tx.userRole.deleteMany({ where: { userId: user.id } });
      await tx.userRole.createMany({ data: p.roleIds.map((roleId) => ({ userId: user.id, roleId })) });
      await tx.channelUser.deleteMany({ where: { userId: user.id } });
      if (p.channelIds.length) await tx.channelUser.createMany({ data: p.channelIds.map((channelId) => ({ userId: user.id, channelId })) });
      if (id && (p.status !== "ACTIVE" || passwordHash)) await tx.session.deleteMany({ where: { userId: id } });
      await audit({ userId: actor.id, userEmail: actor.email, action: id ? "user.update" : "user.create", entityType: "User", entityId: user.id, before, after: { ...data, roles: roles.map((r) => r.key), channelIds: p.channelIds } }, tx);
      return user;
    });
    if (p.sendInvite) await issuePasswordLink(user, 72);
    return { id: user.id };
  }, "User saved");
}

export async function sendPasswordLinkAction(userId: string) {
  return run(async () => {
    const actor = await requireUser("user.manage");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== "ACTIVE") throw new AppError("Activate the account before sending a password link.");
    await issuePasswordLink(user, 24);
    await audit({ userId: actor.id, userEmail: actor.email, action: "user.password_link", entityType: "User", entityId: userId });
  }, "Password link sent");
}

export async function revokeSessionsAction(userId: string) {
  return run(async () => {
    const actor = await requireUser("user.manage");
    const n = await prisma.session.deleteMany({ where: { userId } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "user.sessions_revoked", entityType: "User", entityId: userId, after: { sessions: n.count } });
    return { count: n.count };
  }, "Sessions signed out");
}

// ───────────── Roles ─────────────

const roleSchema = z.object({ name: zStr(80), description: zOptStr(300), permissions: ids });

export async function saveRoleAction(id: string | null, fd: FormData) {
  return run(async () => {
    const actor = await requireUser("user.manage");
    const p = roleSchema.parse(formToObject(fd));
    const unknown = p.permissions.filter((k) => !(ALL_PERMISSIONS as string[]).includes(k));
    if (unknown.length) throw new AppError(`Unknown permission: ${unknown[0]}`);
    const role = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { include: { permission: true } } } }) : null;
      if (before?.key === "SUPER_ADMIN") throw new AppError("The super administrator role always has every permission and cannot be changed.");
      const key = before?.key ?? `CUSTOM_${p.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40)}`;
      const role = id ? await tx.role.update({ where: { id }, data: { name: p.name, description: p.description } }) : await tx.role.create({ data: { key, name: p.name, description: p.description } });
      const perms = await tx.permission.findMany({ where: { key: { in: p.permissions } } });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: perms.map((x) => ({ roleId: role.id, permissionId: x.id })) });
      // Never let the change remove the last user-management access.
      const managers = await tx.user.count({ where: { status: "ACTIVE", deletedAt: null, roles: { some: { role: { OR: [{ key: "SUPER_ADMIN" }, { permissions: { some: { permission: { key: "user.manage" } } } }] } } } } });
      if (!managers) throw new AppError("This change would leave no active user able to manage users.");
      await audit({ userId: actor.id, userEmail: actor.email, action: id ? "role.update" : "role.create", entityType: "Role", entityId: role.id, before: before ? { name: before.name, permissions: before.permissions.map((x) => x.permission.key) } : null, after: { name: p.name, permissions: p.permissions } }, tx);
      return role;
    });
    return { id: role.id };
  }, "Role saved");
}

export async function deleteRoleAction(id: string) {
  return run(async () => {
    const actor = await requireUser("user.manage");
    const r = await prisma.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
    if (r.isSystem) throw new AppError("Built-in roles cannot be deleted.");
    if (r._count.users) throw new AppError(`${r._count.users} user(s) still have this role.`);
    await prisma.role.delete({ where: { id } });
    await audit({ userId: actor.id, userEmail: actor.email, action: "role.delete", entityType: "Role", entityId: id, before: r });
  }, "Role deleted");
}
