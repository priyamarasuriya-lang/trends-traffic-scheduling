"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    setCollapsed(localStorage.getItem("trends.sidebar") === "1");
  }, []);
  const toggle = () => {
    localStorage.setItem("trends.sidebar", collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  };
  const groups = [...new Set(items.map((i) => i.group))];
  const active = (href: string) => {
    // Longest matching prefix wins, so /media/movies does not also highlight /media.
    const matches = items.filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    const best = matches.sort((a, b) => b.href.length - a.href.length)[0];
    return best?.href === href;
  };
  return (
    <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface md:flex", collapsed ? "w-14" : "w-60")}>
      <div className="flex h-14 items-center gap-2 border-b border-border px-3">
        <div className="grid size-8 shrink-0 place-items-center rounded bg-gradient-to-br from-amber-400 via-teal-400 to-rose-400 text-xs font-black text-slate-900">T</div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-[0.18em]">TRENDS</div>
            <div className="text-[10px] uppercase tracking-wider text-muted">Traffic &amp; Scheduling</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Main">
        {groups.map((g) => (
          <div key={g} className="mb-2">
            {!collapsed && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{g}</div>}
            {items
              .filter((i) => i.group === g)
              .map((i) => {
                const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[i.icon] ?? Icons.Circle;
                const on = active(i.href);
                return (
                  <Link key={i.href} href={i.href} title={i.label} aria-current={on ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]", on ? "bg-primary/10 font-medium text-primary" : "text-fg/80 hover:bg-surface-2")}>
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{i.label}</span>}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <button onClick={toggle} className="flex h-10 items-center justify-center border-t border-border text-muted hover:bg-surface-2" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
      </button>
    </aside>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="md:hidden">
      <button onClick={() => setOpen(!open)} className="rounded p-2 hover:bg-surface-2" aria-label="Open menu">
        <Icons.Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <div className="h-full w-64 overflow-y-auto bg-surface p-2" onClick={(e) => e.stopPropagation()}>
            {items.map((i) => (
              <Link key={i.href} href={i.href} className="block rounded px-3 py-2 text-sm hover:bg-surface-2">
                {i.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
