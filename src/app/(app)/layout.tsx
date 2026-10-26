import { requirePage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { channelContext } from "@/lib/context";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  const nav = NAV.filter((n) => user.permissions.has(n.perm));
  const [{ channels, selected }, notifications, unread] = await Promise.all([
    channelContext(user),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return (
    <div className="flex min-h-screen">
      <Sidebar items={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={{ name: user.name, email: user.email, roles: user.roles }}
          channels={channels.map((c) => ({ id: c.id, name: c.name, code: c.code }))}
          channelId={selected?.id ?? ""}
          notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))}
          unread={unread}
          nav={nav}
        />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
