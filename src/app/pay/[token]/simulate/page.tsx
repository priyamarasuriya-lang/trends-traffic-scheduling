import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { activeGateway } from "@/lib/payments/gateway";
import { invoiceForToken } from "@/lib/payments/public";
import { simulateProviderAction } from "@/app/actions/pay";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Simulated payment gateway", robots: { index: false } };
export const dynamic = "force-dynamic";

// Stand-in for a provider's hosted checkout page, used only when PAYMENT_GATEWAY=simulated.
export default async function SimulatedCheckout({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (activeGateway()?.key !== "simulated") notFound();
  const { invoice } = await invoiceForToken(token);
  if (!invoice) notFound();
  return (
    <main className="grid min-h-screen place-items-center bg-amber-50 p-4 dark:bg-amber-950/30">
      <div className="w-full max-w-md rounded-lg border-2 border-dashed border-amber-400 bg-surface p-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
          <FlaskConical className="size-5" /> SIMULATED PAYMENT GATEWAY
        </p>
        <p className="mt-2 text-sm text-muted">This page stands in for a real provider during development and testing. It sends a signed notification to TRENDS exactly like a provider webhook would. No money moves.</p>
        <p className="mt-4 text-sm">
          Invoice <strong>{invoice.number}</strong> · amount <strong>{formatMoney(invoice.balance, invoice.currency)}</strong>
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <form action={simulateProviderAction.bind(null, token, "succeeded")}>
            <button className="h-10 w-full rounded-md bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700">Simulate success</button>
          </form>
          <form action={simulateProviderAction.bind(null, token, "failed")}>
            <button className="h-10 w-full rounded-md border border-border text-sm hover:bg-surface-2">Simulate failure</button>
          </form>
        </div>
      </div>
    </main>
  );
}
