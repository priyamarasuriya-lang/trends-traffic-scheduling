import { prisma } from "../db";
import { newToken, hashToken } from "./tokens";
import { notify } from "../notifications/service";

/** Issue a single-use set/reset-password link and email it. Older unused links stop working. */
export async function issuePasswordLink(user: { id: string; email: string }, hours = 1) {
  const token = newToken();
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  await notify("auth.password_reset", { link: `${process.env.APP_URL ?? ""}/reset-password/${token}` }, { emails: [user.email] });
}
