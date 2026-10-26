import type { PermissionKey } from "./auth/permissions";

export type NavItem = { href: string; label: string; icon: string; perm: PermissionKey; group: string };

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard.view", group: "Operations" },
  { href: "/scheduling", label: "Traffic Scheduling", icon: "CalendarClock", perm: "schedule.view", group: "Operations" },
  { href: "/promos", label: "Promos", icon: "Megaphone", perm: "promo.view", group: "Operations" },
  { href: "/media/timers", label: "Timers", icon: "Timer", perm: "media.view", group: "Operations" },
  { href: "/media/new-media", label: "New Media", icon: "Tablet", perm: "media.view", group: "Operations" },
  { href: "/media/slides", label: "Slides", icon: "Images", perm: "media.view", group: "Operations" },
  { href: "/media/movies", label: "Movies", icon: "Clapperboard", perm: "media.view", group: "Operations" },
  { href: "/media/programs", label: "Programs", icon: "Tv", perm: "media.view", group: "Operations" },
  { href: "/media/fillers", label: "Fillers", icon: "Layers", perm: "media.view", group: "Operations" },
  { href: "/media/coming-up", label: "Coming Up", icon: "ListVideo", perm: "media.view", group: "Operations" },
  { href: "/secondary-events", label: "Secondary Events", icon: "PanelsTopLeft", perm: "secondary.view", group: "Operations" },
  { href: "/media", label: "Media Library", icon: "Library", perm: "media.view", group: "Content" },
  { href: "/media/commercials", label: "Commercials", icon: "Film", perm: "media.view", group: "Content" },
  { href: "/rights", label: "Content Rights", icon: "ShieldCheck", perm: "rights.view", group: "Content" },
  { href: "/inventory", label: "Advertising Inventory", icon: "Boxes", perm: "inventory.view", group: "Sales" },
  { href: "/deals", label: "Deals & Bookings", icon: "Handshake", perm: "deal.view", group: "Sales" },
  { href: "/release-orders", label: "Release Orders", icon: "FileCheck2", perm: "ro.view", group: "Sales" },
  { href: "/agencies", label: "Agencies & Clients", icon: "Building2", perm: "agency.view", group: "Sales" },
  { href: "/agreements", label: "Agreements & Contracts", icon: "FileSignature", perm: "agreement.view", group: "Sales" },
  { href: "/invoices", label: "Invoices & Payments", icon: "Receipt", perm: "billing.view", group: "Finance" },
  { href: "/rate-cards", label: "Rate Cards & Tax", icon: "BadgeDollarSign", perm: "billing.view", group: "Finance" },
  { href: "/reports", label: "Reports & Analytics", icon: "BarChart3", perm: "report.view", group: "Finance" },
  { href: "/integrations", label: "Integrations", icon: "Plug", perm: "integration.view", group: "Administration" },
  { href: "/channels", label: "Channels", icon: "RadioTower", perm: "channel.view", group: "Administration" },
  { href: "/users", label: "User Management", icon: "Users", perm: "user.view", group: "Administration" },
  { href: "/settings", label: "System Settings", icon: "Settings", perm: "settings.manage", group: "Administration" },
  { href: "/audit", label: "Audit Logs", icon: "ScrollText", perm: "audit.view", group: "Administration" },
];
