import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { hashToken, newToken } from "./tokens";
import { PermissionError } from "../errors";
import type { PermissionKey } from "./permissions";

export const SESSION_COOKIE = "trends_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // absolute lifetime
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // sliding idle timeout

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Set<string>;
  allChannels: boolean;
  channelIds: string[];
  sessionId: string;
};

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string) {
  const token = newToken();
  const h = await headers();
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: await clientIp(),
      userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Load the signed-in user (once per request). Returns null when not authenticated. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          channels: true,
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + IDLE_TIMEOUT_MS < now || session.user.status !== "ACTIVE" || session.user.deletedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = session.user;
  const roles = u.roles.map((r) => r.role.key);
  const permissions = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roles,
    permissions,
    allChannels: u.allChannels || roles.includes("SUPER_ADMIN"),
    channelIds: u.channels.map((c) => c.channelId),
    sessionId: session.id,
  };
});

export function can(user: CurrentUser | null, perm: PermissionKey | string): boolean {
  return !!user && user.permissions.has(perm);
}

export function canAccessChannel(user: CurrentUser, channelId: string): boolean {
  return user.allChannels || user.channelIds.includes(channelId);
}

/** For pages: redirect to login when signed out, show 403 when lacking permission. */
export async function requirePage(perm?: PermissionKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (perm && !user.permissions.has(perm)) redirect(`/forbidden?need=${encodeURIComponent(perm)}`);
  return user;
}

/** For server actions and API routes: throws instead of redirecting. */
export async function requireUser(perm?: PermissionKey | PermissionKey[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError("Your session has expired. Please sign in again.");
  const perms = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
  for (const p of perms) if (!user.permissions.has(p)) throw new PermissionError(`Missing permission: ${p}`);
  return user;
}

export function assertChannel(user: CurrentUser, channelId: string) {
  if (!canAccessChannel(user, channelId)) throw new PermissionError("You are not assigned to this channel.");
}

/** Prisma filter restricting a channelId column to the user's channels. */
export function channelScope(user: CurrentUser): { in: string[] } | undefined {
  return user.allChannels ? undefined : { in: user.channelIds };
}
