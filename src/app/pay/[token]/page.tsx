import { CheckCircle2, Clock, FlaskConical, XCircle } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { invoiceForToken } from "@/lib/payments/public";
import { activeGateway } from "@/lib/payments/gateway";
import { startCheckoutAction } from "@/app/actions/pay";
import { D, formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/time";

export const metadata = { title: "Pay invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string; error?: string }> }) {
  const { token } = await params;
  const { status, error } = await searchParams;
  const { invoice, limited } = await invoiceForToken(token);
  const company = await getSetting("company.profile");
  const gateway = activeGateway();
  const payable = invoice && ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status) && D(invoice.balance).gt(0);

  return (
    <main className="grid min-h-screen place-items-center bg-surface-2 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm">
        <p className="text-sm font-semibold tracking-widest text-primary">{company.name}</p>
        {gateway?.isSimulated && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <FlaskConical className="mt-0.5 size-4 shrink-0" /> TEST MODE: payments here go through a simulated gateway. No real money moves and no card details are requested.
          </div>
        )}
        {limited ? (
          <p className="mt-4 text-sm">Too many requests. Please wait a few minutes and try again.</p>
        ) : !invoice || !invoice.number ? (
          <p className="mt-4 text-sm">This payment link is not valid. Please contact {company.email || "us"} for a new one.</p>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-semibold">Invoice {invoice.number}</h1>
            <p className="text-sm text-muted">{invoice.agency ? `${invoice.agency.name} for ${invoice.client.name}` : invoice.client.name}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-muted">Issued</dt>
              <dd className="text-right">{fmtDate(invoice.issueDate)}</dd>
              <dt className="text-muted">Due</dt>
              <dd className="text-right">{fmtDate(invoice.dueDate)}</dd>
              <dt className="text-muted">Invoice total</dt>
              <dd className="text-right tabular">{formatMoney(invoice.total, invoice.currency)}</dd>
              <dt className="font-medium">Amount due</dt>
              <dd className="text-right text-lg font-semibold tabular">{formatMoney(invoice.balance, invoice.currency)}</dd>
            </dl>

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                <XCircle className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}
            {status === "failed" && (
              <p className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                <XCircle className="mt-0.5 size-4 shrink-0" /> The payment did not go through. You have not been charged.
              </p>
            )}

            {invoice.status === "PAID" ? (
              <p className="mt-5 flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="size-5" /> This invoice is paid. Thank you.
              </p>
            ) : status === "returned" && payable ? (
              <>
                <meta httpEquiv="refresh" content="5" />
                <p className="mt-5 flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                  <Clock className="mt-0.5 size-5 shrink-0" /> Thanks. We are waiting for the payment provider to confirm your payment; this page refreshes automatically. The invoice is marked paid only after that confirmation.
                </p>
              </>
            ) : payable ? (
              gateway ? (
                <form action={startCheckoutAction.bind(null, token)} className="mt-5">
                  <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-fg hover:opacity-90">
                    Pay {formatMoney(invoice.balance, invoice.currency)} {gateway.isSimulated ? "(test)" : "securely"}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-muted">You will be taken to {gateway.isSimulated ? "the simulated test gateway" : `${gateway.label}'s secure page`}. We never see or store your card details.</p>
                </form>
              ) : (
                <p className="mt-5 rounded-md bg-surface-2 p-3 text-sm">Online payment is not set up. Please pay by bank transfer quoting {invoice.number}.</p>
              )
            ) : (
              <p className="mt-5 rounded-md bg-surface-2 p-3 text-sm">This invoice is {invoice.status.toLowerCase().replace("_", " ")} and cannot be paid online.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
