import Link from "next/link";
import { cn } from "@/lib/utils";

export function BillingTabs({ active }: { active: "invoices" | "payments" }) {
  const tabs = [
    { key: "invoices", href: "/invoices", label: "Invoices" },
    { key: "payments", href: "/payments", label: "Payments" },
  ];
  return (
    <div className="mb-4 flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
