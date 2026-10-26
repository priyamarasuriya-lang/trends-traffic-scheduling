"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, createSession, destroySession, getCurrentUser, requireUser } from "@/lib/auth/session";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { rateLimit } from "@/lib/rate-limit";
import { run, type ActionResult } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications/service";

const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;

// A real hash so unknown-user logins take the same time as wrong passwords.
const DUMMY_HASH = "$2b$12$cqCZlp5pdFN5WEOgWVzP5u4/z3UUrwBij5jbjaFkNYr6K3rmblVbO";

export async function loginAction(_: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: "Enter your email and password." };
  const { email, password } = parsed.data;
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 30, 60_000).ok) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
  const since = new Date(Date.now() - WINDOW_MS);
  const [failsEmail, failsIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  if (failsEmail >= MAX_FAILS_PER_EMAIL || failsIp >= MAX_FAILS_PER_IP) {
    await audit({ userEmail: email, action: "auth.login.throttled", ip });
    return { ok: false, error: "Too many failed sign-in attempts. Try again in 15 minutes or reset your password." };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.deletedAt) {
    await prisma.loginAttempt.create({ data: { email, ip, success: false } });
    await audit({ userId: user?.id, userEmail: email, action: "auth.login.failed", ip });
    return { ok: false, error: "Email or password is incorrect." };
  }
  if (user.status !== "ACTIVE") {
    await audit({ userId: user.id, userEmail: email, action: "auth.login.blocked", ip, after: { status: user.status } });
    return { ok: false, error: `This account is ${user.status.toLowerCase()}. Contact an administrator.` };
  }
  await prisma.loginAttempt.create({ data: { email, ip, success: true } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit({ userId: user.id, userEmail: email, action: "auth.login", ip });
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  const u = await getCurrentUser();
  await destroySession();
  if (u) await audit({ userId: u.id, userEmail: u.email, action: "auth.logout", ip: await clientIp() });
  redirect("/login");
}

export async function requestResetAction(_: unknown, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const ip = await clientIp();
  if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000).ok) return { ok: false, error: "Too many requests. Try again later." };
  const generic: ActionResult = { ok: true, message: "If that email belongs to an account, a reset link has been sent." };
  if (!z.string().email().safeParse(email).success) return generic;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) return generic;
  const token = newToken();
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  await notify("auth.password_reset", { link: `${process.env.APP_URL ?? ""}/reset-password/${token}` }, { emails: [user.email] });
  await audit({ userId: user.id, userEmail: email, action: "auth.reset.requested", ip });
  return generic;
}

export async function resetPasswordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const token = String(fd.get("token") ?? "");
    const pw = String(fd.get("password") ?? "");
    if (pw !== String(fd.get("confirm") ?? "")) throw new AppError("The passwords do not match.");
    const policy = passwordPolicyError(pw);
    if (policy) throw new AppError(policy);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("This reset link is invalid or has expired. Request a new one.");
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(pw), passwordChangedAt: new Date() } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: row.userId } }),
    ]);
    await audit({ userId: row.userId, action: "auth.reset.completed", ip: await clientIp() });
  }, "Password updated. You can now sign in.");
}

export async function changePasswordAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await requireUser();
    const current = String(fd.get("current") ?? "");
    const pw = String(fd.get("password") ?? "");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("Your current password is incorrect.");
    const policy = passwordPolicyError(pw);
    if (policy) throw new AppError(policy);
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(pw), passwordChangedAt: new Date() } });
    await prisma.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } });
    await audit({ userId: u.id, userEmail: u.email, action: "auth.password.changed" });
  }, "Password changed. Other sessions were signed out.");
}
