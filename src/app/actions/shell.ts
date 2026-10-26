"use server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser, canAccessChannel } from "@/lib/auth/session";
import { run } from "@/lib/action";
import { AppError } from "@/lib/errors";

export async function setChannelAction(channelId: string) {
  return run(async () => {
    const u = await requireUser();
    if (channelId && !canAccessChannel(u, channelId)) throw new AppError("You are not assigned to that channel.");
    (await cookies()).set("trends_channel", channelId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  });
}

export async function markNotificationsReadAction(ids?: string[]) {
  return run(async () => {
    const u = await requireUser();
    await prisma.notification.updateMany({ where: { userId: u.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  });
}
