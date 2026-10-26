import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import type { CurrentUser } from "./auth/session";

/** Channels the user may see, and the one selected in the top bar (if any). */
export async function channelContext(user: CurrentUser) {
  const channels = await prisma.channel.findMany({
    where: { deletedAt: null, ...(user.allChannels ? {} : { id: { in: user.channelIds } }) },
    orderBy: { code: "asc" },
  });
  const sel = (await cookies()).get("trends_channel")?.value ?? "";
  const selected = channels.find((c) => c.id === sel) ?? null;
  return { channels, selected, channelIds: channels.map((c) => c.id) };
}
