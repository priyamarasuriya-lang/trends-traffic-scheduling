import { prisma } from "../db";
import { DEFAULT_TEMPLATES, render } from "./templates";
import { sendEmail } from "./email";

export type NotifyOptions = { link?: string; userIds?: string[]; emails?: string[]; channelId?: string };

/**
 * Raise a notification event. Recipients are users holding the template's
 * roles (restricted to the channel when given) plus explicit users/emails.
 * Call after the business transaction commits so a rollback never notifies.
 * Failures are logged and never break the calling workflow.
 */
export async function notify(key: string, vars: Record<string, unknown>, opts: NotifyOptions = {}) {
  try {
    const row = await prisma.notificationTemplate.findUnique({ where: { key } });
    const def = DEFAULT_TEMPLATES[key];
    if (!row && !def) return;
    const tpl = row ?? { ...def, key, emailEnabled: true, inAppEnabled: true };
    const subject = render(tpl.subject, vars);
    const body = render(tpl.body, vars);
    const users = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        OR: [
          ...(tpl.recipientRoles.length ? [{ roles: { some: { role: { key: { in: tpl.recipientRoles } } } }, ...(opts.channelId ? { OR: [{ allChannels: true }, { channels: { some: { channelId: opts.channelId } } }] } : {}) }] : []),
          ...(opts.userIds?.length ? [{ id: { in: opts.userIds } }] : []),
        ],
      },
      select: { id: true, email: true },
    });
    if (tpl.inAppEnabled && users.length) {
      await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: key, title: subject, body, link: opts.link })) });
    }
    if (tpl.emailEnabled) {
      const to = [...new Set([...users.map((u) => u.email), ...(opts.emails ?? [])])];
      for (const addr of to) await sendEmail({ to: addr, subject, text: body + (opts.link ? `\n\n${process.env.APP_URL ?? ""}${opts.link}` : ""), template: key });
    }
  } catch (e) {
    console.error(`[notify] ${key} failed`, e instanceof Error ? e.message : e);
  }
}
