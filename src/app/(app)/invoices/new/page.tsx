import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ManualInvoiceForm } from "../client";

export const metadata = { title: "Manual invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePage("invoice.issue");
  const { edit } = await searchParams;
  const [clients, agencies, currency, tax, taxBase, existing] = await Promise.all([
    prisma.client.findMany({ where: { deletedAt: null, status: { not: "BLOCKED" } }, orderBy: { name: "asc" } }),
    prisma.agency.findMany({ where: { deletedAt: null, status: { not: "BLOCKED" } }, orderBy: { name: "asc" } }),
    getSetting("billing.currency"),
    prisma.taxRate.findFirst({ where: { isDefault: true, isActive: true } }),
    getSetting("billing.taxBase"),
    edit ? prisma.invoice.findFirst({ where: { id: edit, status: "DRAFT", isManual: true }, include: { lines: true } }) : null,
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title={existing ? "Edit draft invoice" : "Manual invoice"} description="For charges that are not spots on a release order, such as sponsorships, production fees or adjustments. Invoices for aired spots are created from the release order." />
      <Card>
        <CardBody>
          <ManualInvoiceForm
            id={existing?.id ?? null}
            clients={clients.map((c) => ({ value: c.id, label: c.name, agencyId: c.agencyId }))}
            agencies={agencies.map((a) => ({ value: a.id, label: a.name, commissionPct: a.commissionPct.toString() }))}
            currency={currency.code}
            taxPct={tax?.ratePct.toString() ?? "0"}
            taxBase={taxBase.mode}
            initial={
              existing
                ? {
                    clientId: existing.clientId,
                    agencyId: existing.agencyId,
                    currency: existing.currency,
                    notes: existing.notes,
                    lines: existing.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), discountPct: l.discountPct.toString(), commissionPct: l.commissionPct.toString(), taxRatePct: l.taxRatePct.toString() })),
                  }
                : undefined
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}
