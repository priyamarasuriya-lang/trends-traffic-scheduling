# Integrations

Every external connection goes through an adapter in `src/lib/integrations/index.ts` (payments are in `src/lib/payments/gateway.ts`). Administrators manage them in **Administration → Integrations**. On that page they can:

- Run a connection test.
- Enable or disable an adapter.
- Queue an export or import.
- See the job history with results and output files.
- Check finance reconciliation.

**Honesty rule:** when credentials are missing, an adapter never pretends to be connected. It runs in a labelled **file-export** or **test** mode and says so on its card. Credentials come only from environment variables. The page shows whether each one is set, never its value.

## Job engine

- Exports and imports are queued as `IntegrationJob` rows and run immediately. The scheduled job runner retries failures after 1, 4 and 16 minutes. After the last attempt a job is marked DEAD and system administrators are notified.
- Identical jobs are de-duplicated with a payload hash, so the same invoices are never exported twice by accident. A user can force a re-run explicitly, and that is audited.
- Output files (XML, CSV) are stored as attachments on the job and can be downloaded from the jobs table.
- **Reconciliation** lists the invoices issued in a period and shows whether a successful export to SAP or Tally included each one.

## Adapters

| Adapter | Works without credentials | Live mode needs | What live mode does |
| --- | --- | --- | --- |
| **Tally** | Generates Tally sales-voucher XML for issued invoices in a date range. Import the file into Tally manually | `TALLY_URL` (Tally's HTTP/XML server, usually port 9000) | Posts the vouchers to Tally and records whether Tally accepted them. The connection test sends a harmless export request |
| **SAP** | Generates a balanced AR journal CSV for SAP import: per invoice, an AR debit plus revenue and output-tax credits (`DocDate, DocNumber, Customer, Account, Debit, Credit, Currency`). Map the placeholder accounts `AR`, `REVENUE` and `OUTPUT_TAX` to your GL codes | `SAP_API_URL`, `SAP_USERNAME`, `SAP_PASSWORD` | The connection test calls the URL with Basic auth. **Direct posting is not implemented**, because SAP OData services and account mappings differ per installation. Map the CSV columns to your posting service, or extend `sap.run` with your endpoint |
| **Asset management (AMS)** | Imports media metadata from CSV (`assetCode,title,category,durationSec,language,fileRef,rightsOwner`). New assets arrive as pending approval, and changed ones create a new version | `AMS_API_URL`, `AMS_API_TOKEN` | The connection test calls `{AMS_API_URL}/health`. Pulling metadata live needs your vendor's API contract |
| **Broadcast automation** | Exports a published channel-day as a playlist CSV (start time, house number, title, type, duration, file reference, break flag) | `AUTOMATION_API_URL`, `AUTOMATION_API_TOKEN` | POSTs the playlist to the endpoint with a bearer token. Confirm the format your playout system expects (for example a BXF or vendor-specific schema) before going live |
| **Email** | Preview mode: every email is written to Settings → Email log and nothing is sent | `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Sends through SMTP with 3 attempts. The connection test runs an SMTP `verify` |
| **Payments** | Online payment links are hidden. Alternatively, `PAYMENT_GATEWAY=simulated` with `SIMULATED_GATEWAY_SECRET` gives a TEST MODE checkout where no money moves | `PAYMENT_GATEWAY=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Creates a Stripe Checkout session for the invoice balance. Invoices are marked paid only from the signed `checkout.session.completed` webhook at `/api/payments/webhook/stripe`. The status shows CONNECTED after the first verified live webhook |

## Going live checklist

1. Put the credentials in the server environment and restart.
2. Click **Test** on the integration card. The status should read CONNECTED, or explain what is missing.
3. Export a small date range and check the result in the target system.
4. Run **Reconciliation** for the same range.
5. For Stripe, register the webhook endpoint in the Stripe dashboard, then make one live payment of a small invoice and confirm it allocates automatically.
