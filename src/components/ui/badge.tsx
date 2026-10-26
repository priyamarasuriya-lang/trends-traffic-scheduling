import { cn, titleCase } from "@/lib/utils";

const TONES: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  DRAFT: "gray", PENDING: "amber", SUBMITTED: "amber", APPROVED: "green", SCHEDULED: "blue", COMPLETED: "teal", REJECTED: "red", CANCELLED: "gray", RETIRED: "gray",
  PUBLISHED: "green", ISSUED: "blue", PARTIALLY_PAID: "amber", PAID: "green", OVERDUE: "red", CREDITED: "violet",
  AVAILABLE: "green", RESERVED: "amber", BOOKED: "blue", AIRED: "teal", UNAVAILABLE: "gray", PLANNED: "blue", MISSED: "red", CONFIRMED: "green",
  ACTIVE: "green", ON_HOLD: "amber", BLOCKED: "red", INACTIVE: "gray", SUSPENDED: "amber", LOCKED: "red", DISABLED: "gray", EXPIRED: "red", TERMINATED: "gray",
  NEGOTIATION: "amber", CLOSED: "teal", CONNECTED: "green", TEST_MODE: "amber", NOT_CONFIGURED: "gray", ERROR: "red", SUCCEEDED: "green", FAILED: "red", DEAD: "red", RUNNING: "blue",
  CLEAN: "green", NOT_SCANNED: "amber", INFECTED: "red", WARNING: "amber",
};

export function Badge({ tone = "gray", className, children }: { tone?: keyof typeof TONES; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "gray"} className={className}>
      {titleCase(status)}
    </Badge>
  );
}
