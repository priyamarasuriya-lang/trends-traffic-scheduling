// Default notification templates. Administrators can edit subject/body and
// recipients in System Settings → Notifications; these are the seeds/fallbacks.
export const DEFAULT_TEMPLATES: Record<string, { name: string; subject: string; body: string; recipientRoles: string[] }> = {
  "booking.created": { name: "New booking", subject: "New booking {{number}} for {{client}}", body: "Release order {{number}} ({{campaign}}) was created by {{actor}}.", recipientRoles: ["SALES_MANAGER", "TRAFFIC_MANAGER"] },
  "ro.submitted": { name: "RO submitted", subject: "RO {{number}} awaits {{stage}}", body: "Release order {{number}} for {{client}} ({{total}}) was submitted and awaits {{stage}}.", recipientRoles: ["SALES_MANAGER", "FINANCE_OFFICER"] },
  "ro.approved": { name: "RO approved", subject: "RO {{number}} approved", body: "Release order {{number}} for {{client}} is approved. {{booked}} spot(s) were booked in inventory.", recipientRoles: ["TRAFFIC_MANAGER", "BOOKING_OFFICER"] },
  "ro.rejected": { name: "RO rejected", subject: "RO {{number}} rejected", body: "Release order {{number}} was rejected at {{stage}}: {{comment}}", recipientRoles: ["BOOKING_OFFICER", "SALES_MANAGER"] },
  "agreement.expiring": { name: "Agreement expiry", subject: "Agreement {{number}} expires {{date}}", body: "Agreement {{number}} ({{title}}) expires on {{date}}.", recipientRoles: ["SALES_MANAGER"] },
  "license.expiring": { name: "Licence expiry", subject: "Licence for {{title}} expires {{date}}", body: "The licence for {{title}} expires on {{date}}. {{remaining}}", recipientRoles: ["MEDIA_MANAGER", "TRAFFIC_MANAGER"] },
  "schedule.conflict": { name: "Schedule conflict", subject: "Schedule conflicts on {{channel}} {{date}}", body: "{{count}} rule violation(s) were found on {{channel}} for {{date}}. First: {{first}}", recipientRoles: ["TRAFFIC_MANAGER"] },
  "promo.expiring": { name: "Promo expiry", subject: "Promo campaign {{name}} ends {{date}}", body: "Promo campaign {{name}} ends on {{date}}.", recipientRoles: ["TRAFFIC_MANAGER", "MEDIA_MANAGER"] },
  "inventory.low": { name: "Low inventory", subject: "Low inventory on {{channel}}", body: "Only {{pct}}% of inventory is available on {{channel}} for {{date}}.", recipientRoles: ["SALES_MANAGER", "TRAFFIC_MANAGER"] },
  "invoice.issued": { name: "Invoice issued", subject: "Invoice {{number}} from {{company}}", body: "Invoice {{number}} for {{total}} is due on {{dueDate}}.{{payLink}}", recipientRoles: ["FINANCE_OFFICER"] },
  "invoice.reminder": { name: "Payment reminder", subject: "Invoice {{number}} is due {{dueDate}}", body: "Invoice {{number}} has {{balance}} outstanding, due on {{dueDate}}.", recipientRoles: ["FINANCE_OFFICER"] },
  "invoice.overdue": { name: "Invoice overdue", subject: "Invoice {{number}} is overdue", body: "Invoice {{number}} for {{client}} is overdue with {{balance}} outstanding (due {{dueDate}}).", recipientRoles: ["FINANCE_OFFICER", "ACCOUNTANT"] },
  "payment.confirmed": { name: "Payment confirmation", subject: "Payment {{reference}} received", body: "A payment of {{amount}} ({{reference}}) was recorded.", recipientRoles: ["FINANCE_OFFICER", "ACCOUNTANT"] },
  "integration.failed": { name: "Integration failure", subject: "Integration {{integration}} failed", body: "Job {{job}} ({{kind}}) failed after {{attempts}} attempt(s): {{error}}", recipientRoles: ["SYSTEM_ADMIN"] },
  "auth.password_reset": { name: "Password reset", subject: "Reset your TRENDS password", body: "Use this link within 60 minutes to reset your password: {{link}}\nIf you did not ask for this, ignore this email.", recipientRoles: [] },
};

export function render(tpl: string, vars: Record<string, unknown>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}
