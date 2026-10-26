/**
 * Create (or promote) the first super administrator.
 *
 *   npm run create-admin -- --email you@company.com --name "Your Name"
 *
 * The password is read from ADMIN_PASSWORD or prompted for; it is never
 * printed or stored in plain text. Run `npm run db:seed` first so roles exist.
 */
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordPolicyError } from "../src/lib/auth/password";

const prisma = new PrismaClient();
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("Set ADMIN_PASSWORD when not running in a terminal.");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write("Password (12+ characters, letters and numbers): ");
  // Suppress echo so the password never appears on screen or in terminal logs.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  const pw = await rl.question("");
  rl.close();
  process.stdout.write("\n");
  return pw;
}

async function main() {
  const email = (arg("email") ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
  const name = (arg("name") ?? process.env.ADMIN_NAME)?.trim() || "Administrator";
  // --if-none: used by automated deploys; does nothing once any active super administrator exists.
  if (process.argv.includes("--if-none")) {
    if (!email) return console.log("ADMIN_EMAIL not set; skipping first-admin bootstrap.");
    const existing = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
    if (existing) return console.log("A super administrator already exists; skipping first-admin bootstrap.");
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Pass --email you@company.com (or set ADMIN_EMAIL)");
  const role = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!role) throw new Error("Roles are missing. Run `npm run db:seed` first.");
  const password = await readPassword();
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, allChannels: true, passwordChangedAt: new Date() },
    update: { passwordHash, status: "ACTIVE", deletedAt: null, passwordChangedAt: new Date() },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({ data: { action: "user.super_admin_created_cli", entityType: "User", entityId: user.id, userEmail: email } });
  console.log(`✓ ${email} is a super administrator. Sign in at ${process.env.APP_URL ?? "your APP_URL"}/login`);
}

main()
  .catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
