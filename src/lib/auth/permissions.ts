// Single source of truth for permission keys and the default role matrix.
// Roles and their permissions are stored in the database (seeded from here)
// and can be edited by administrators in User Management.

export const PERMISSIONS = {
  "dashboard.view": ["Dashboard", "View the operations dashboard"],
  "channel.view": ["Channels", "View channels"],
  "channel.manage": ["Channels", "Create and edit channels and channel assignments"],
  "media.view": ["Media", "View media assets"],
  "media.manage": ["Media", "Create and edit media assets"],
  "media.approve": ["Media", "Approve or reject media assets"],
  "rights.view": ["Rights", "View content licences"],
  "rights.manage": ["Rights", "Manage content licences and confirm plays"],
  "schedule.view": ["Scheduling", "View schedules"],
  "schedule.edit": ["Scheduling", "Edit draft schedules"],
  "schedule.publish": ["Scheduling", "Publish schedules and edit published ones"],
  "schedule.rules.manage": ["Scheduling", "Configure scheduling rules"],
  "secondary.view": ["Secondary events", "View secondary events"],
  "secondary.edit": ["Secondary events", "Create and edit secondary events"],
  "promo.view": ["Promos", "View promo campaigns"],
  "promo.manage": ["Promos", "Manage promo campaigns"],
  "promo.autofill": ["Promos", "Run and apply promo auto-fill"],
  "inventory.view": ["Inventory", "View advertising inventory"],
  "inventory.manage": ["Inventory", "Create breaks and edit inventory"],
  "agency.view": ["Agencies & clients", "View agencies and clients"],
  "agency.manage": ["Agencies & clients", "Create and edit agencies and clients"],
  "deal.view": ["Deals", "View deals"],
  "deal.manage": ["Deals", "Create and edit deals"],
  "ro.view": ["Release orders", "View release orders"],
  "ro.manage": ["Release orders", "Create, edit, submit and amend release orders"],
  "ro.approve.sales": ["Release orders", "Approve release orders at the sales stage"],
  "ro.approve.finance": ["Release orders", "Approve release orders at the finance stage"],
  "ro.cancel": ["Release orders", "Cancel release orders"],
  "ro.schedule": ["Release orders", "Book inventory and place spots for approved release orders"],
  "agreement.view": ["Agreements", "View agreements"],
  "agreement.manage": ["Agreements", "Create and edit agreements"],
  "billing.view": ["Billing", "View invoices, payments and rate cards"],
  "billing.manage": ["Billing", "Manage rate cards and tax rates"],
  "invoice.issue": ["Billing", "Create, issue and cancel invoices"],
  "payment.record": ["Billing", "Record and allocate payments"],
  "creditnote.issue": ["Billing", "Issue credit notes"],
  "report.view": ["Reports", "View operational reports"],
  "report.financial": ["Reports", "View financial reports"],
  "integration.view": ["Integrations", "View integrations and jobs"],
  "integration.manage": ["Integrations", "Configure and run integrations"],
  "notification.manage": ["Notifications", "Edit notification templates"],
  "user.view": ["Users", "View users"],
  "user.manage": ["Users", "Manage users, roles and permissions"],
  "settings.manage": ["Settings", "Change system settings"],
  "audit.view": ["Audit", "View audit logs"],
} as const satisfies Record<string, readonly [string, string]>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

const VIEW_ALL = ALL_PERMISSIONS.filter((p) => p.endsWith(".view"));

export const DEFAULT_ROLES: Record<string, { name: string; description: string; permissions: PermissionKey[] }> = {
  SUPER_ADMIN: { name: "Super Administrator", description: "Unrestricted access", permissions: ALL_PERMISSIONS },
  SYSTEM_ADMIN: {
    name: "System Administrator",
    description: "Users, settings, integrations and audit",
    permissions: [...VIEW_ALL, "channel.manage", "user.manage", "settings.manage", "integration.manage", "notification.manage", "schedule.rules.manage"],
  },
  TRAFFIC_MANAGER: {
    name: "Traffic Manager",
    description: "Owns the schedule, inventory and RO scheduling",
    permissions: [
      "dashboard.view", "channel.view", "media.view", "media.manage", "media.approve", "rights.view", "rights.manage",
      "schedule.view", "schedule.edit", "schedule.publish", "schedule.rules.manage", "secondary.view", "secondary.edit",
      "promo.view", "promo.manage", "promo.autofill", "inventory.view", "inventory.manage", "ro.view", "ro.schedule",
      "agency.view", "deal.view", "agreement.view", "report.view",
    ],
  },
  SCHEDULER: {
    name: "Scheduler",
    description: "Builds draft schedules",
    permissions: [
      "dashboard.view", "channel.view", "media.view", "rights.view", "schedule.view", "schedule.edit", "secondary.view",
      "secondary.edit", "promo.view", "promo.autofill", "inventory.view", "ro.view", "ro.schedule", "report.view",
    ],
  },
  MEDIA_MANAGER: {
    name: "Media Manager",
    description: "Media library and rights",
    permissions: ["dashboard.view", "channel.view", "media.view", "media.manage", "media.approve", "rights.view", "rights.manage", "schedule.view", "promo.view", "promo.manage", "agreement.view", "report.view"],
  },
  SALES_MANAGER: {
    name: "Sales Manager",
    description: "Deals, ROs and sales approval",
    permissions: [
      "dashboard.view", "channel.view", "media.view", "schedule.view", "inventory.view", "agency.view", "agency.manage",
      "deal.view", "deal.manage", "ro.view", "ro.manage", "ro.approve.sales", "ro.cancel", "agreement.view",
      "agreement.manage", "billing.view", "report.view", "report.financial",
    ],
  },
  BOOKING_OFFICER: {
    name: "Booking Officer",
    description: "Captures deals and release orders",
    permissions: ["dashboard.view", "channel.view", "media.view", "inventory.view", "agency.view", "agency.manage", "deal.view", "deal.manage", "ro.view", "ro.manage", "agreement.view", "report.view"],
  },
  FINANCE_OFFICER: {
    name: "Finance Officer",
    description: "Invoicing, payments and finance approval",
    permissions: [
      "dashboard.view", "channel.view", "agency.view", "deal.view", "ro.view", "ro.approve.finance", "agreement.view",
      "billing.view", "billing.manage", "invoice.issue", "payment.record", "creditnote.issue", "report.view", "report.financial", "integration.view",
    ],
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Payments, reconciliation and accounting exports",
    permissions: ["dashboard.view", "agency.view", "ro.view", "billing.view", "payment.record", "report.view", "report.financial", "integration.view", "integration.manage"],
  },
  MANAGEMENT_VIEWER: {
    name: "Management Viewer",
    description: "Read-only access to everything except users and audit",
    permissions: VIEW_ALL.filter((p) => p !== "user.view" && p !== "audit.view").concat(["report.financial"]) as PermissionKey[],
  },
};
