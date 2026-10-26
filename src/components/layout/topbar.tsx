"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Bell, ChevronRight, LogOut, Moon, Search, Sun, User, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { setChannelAction, markNotificationsReadAction } from "@/app/actions/shell";
import { logoutAction } from "@/app/actions/auth";
import { MobileNav } from "./sidebar";
import type { NavItem } from "@/lib/nav";
import { titleCase } from "@/lib/utils";

type Notif = { id: string; title: string; body: string; link: string | null; createdAt: string; readAt: string | null };

export function Topbar({ user, channels, channelId, notifications, unread, nav }: { user: { name: string; email: string; roles: string[] }; channels: { id: string; name: string; code: string }[]; channelId: string; notifications: Notif[]; unread: number; nav: NavItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState("");
  const crumbs = pathname.split("/").filter(Boolean);
  const label = (seg: string, i: number) => {
    const href = "/" + crumbs.slice(0, i + 1).join("/");
    return nav.find((n) => n.href === href)?.label ?? (seg.length > 20 ? "Detail" : titleCase(seg.replace(/-/g, " ")));
  };
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
      <MobileNav items={nav} />
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm text-muted lg:flex">
        <Link href="/dashboard" className="hover:text-fg">
          Home
        </Link>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            <ChevronRight className="size-3.5" />
            {i === crumbs.length - 1 ? (
              <span className="truncate text-fg">{label(c, i)}</span>
            ) : (
              <Link className="truncate hover:text-fg" href={"/" + crumbs.slice(0, i + 1).join("/")}>
                {label(c, i)}
              </Link>
            )}
          </React.Fragment>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="relative hidden sm:block"
          role="search"
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ROs, invoices, media…" aria-label="Global search" className="h-9 w-64 rounded-md border border-border bg-surface-2 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </form>
        <select
          aria-label="Channel"
          value={channelId}
          onChange={async (e) => {
            const r = await setChannelAction(e.target.value);
            if (!r.ok) toast.error(r.error);
            router.refresh();
          }}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">All my channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
        <DM.Root>
          <DM.Trigger className="relative rounded-md p-2 hover:bg-surface-2" aria-label={`Notifications (${unread} unread)`}>
            <Bell className="size-5" />
            {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={6} className="z-50 w-96 rounded-lg border border-border bg-surface shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold">Notifications</span>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={async () => {
                    await markNotificationsReadAction();
                    router.refresh();
                  }}
                >
                  Mark all read
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 && <p className="p-4 text-center text-sm text-muted">No notifications.</p>}
                {notifications.map((n) => (
                  <DM.Item
                    key={n.id}
                    onSelect={async () => {
                      await markNotificationsReadAction([n.id]);
                      if (n.link) router.push(n.link);
                      else router.refresh();
                    }}
                    className="block cursor-pointer border-b border-border px-3 py-2 outline-none last:border-0 hover:bg-surface-2 data-[highlighted]:bg-surface-2"
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-2 text-xs text-muted">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  </DM.Item>
                ))}
              </div>
              <Link href="/notifications" className="block border-t border-border px-3 py-2 text-center text-xs text-primary hover:underline">
                View all
              </Link>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <DM.Root>
          <DM.Trigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2" aria-label="User menu">
            <span className="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {user.name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block text-sm font-medium">{user.name}</span>
              <span className="block text-[11px] text-muted">{titleCase(user.roles[0] ?? "user")}</span>
            </span>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={6} className="z-50 w-56 rounded-lg border border-border bg-surface p-1 shadow-xl">
              <div className="px-2 py-1.5 text-xs text-muted">{user.email}</div>
              <DM.Item asChild>
                <Link href="/profile" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                  <User className="size-4" /> Profile
                </Link>
              </DM.Item>
              <DM.Item asChild>
                <Link href="/profile#password" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                  <KeyRound className="size-4" /> Change password
                </Link>
              </DM.Item>
              <DM.Item onSelect={() => toggleTheme()} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" /> Toggle theme
              </DM.Item>
              <DM.Separator className="my-1 h-px bg-border" />
              <form action={logoutAction}>
                <button type="submit" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-danger hover:bg-surface-2">
                  <LogOut className="size-4" /> Sign out
                </button>
              </form>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
    </header>
  );
}

export function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("trends.theme", dark ? "dark" : "light");
  } catch {}
}
