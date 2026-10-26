# TRENDS: implementation report

Date: 26 October 2026

## Summary

TRENDS is a working, production-oriented web application covering the five priorities in order: traffic scheduling, deals and release orders, inventory, billing and reports. Every one of the 22 required menu items, plus administration, opens a working page backed by real database data. No metric is hard-coded: every KPI, chart and report is computed from the database at request time.

Business rules, permissions and channel scope are enforced on the server. Money is exact decimal. Concurrency hazards (double booking, double billing, duplicate webhooks, overlapping edits) are closed with database locks and conditional updates, and each of those guarantees is covered by an automated test.

Integrations that need credentials the project does not yet have (live payments, Tally posting, SAP posting, asset management API, playout automation API, SMTP) are built as adapters. Without credentials they run in a clearly labelled file-export or test mode, and none of them claims a connection that does not exist.

## Results at a glance

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint (Next.js core-web-vitals + TypeScript) | 0 errors, 0 warnings |
| Production build (`next build`) | succeeds, 52 pages and API routes |
| Unit tests (Vitest) | 30 / 30 passed |
| Database integration tests (Vitest on PostgreSQL) | 4 / 4 passed |
| End-to-end tests (Playwright, Chromium, against the production build) | 11 / 11 passed |

Each feature was also exercised by hand in a browser during development, and screenshots were reviewed.

## Features by priority

### 1. Traffic scheduling

- **Timeline:** multi-channel timeline per broadcast day, with media search, drag-and-drop from the library, move, resize, copy and delete.
- **Breaks and spots:** commercial breaks with ordered spots, drag reordering and automatic re-layout.
- **Editing tools:** ripple editing, and duplicating a day to other dates.
- **Versions:** draft → published with a version history and restore. Edits to a published day need explicit confirmation and a publish permission. Aired confirmation is supported.
- **Rules engine:** 15 rules, configurable globally or per channel, each as an error or a warning:
  - overlaps
  - break length
  - back-to-back advertiser
  - same-break brand
  - brand separation
  - competitor separation
  - same-spot separation
  - advertiser restrictions
  - campaign dates
  - campaign frequency
  - programme start times
  - content-category windows
  - approved content only
  - asset availability
  - licences and play limits
- **Conflict messages** name the items and give exact channel-local times.
- **Time zones:** DST-correct broadcast days (23, 24 or 25 hours), with a configurable day start.
- **Concurrent edits:** a per-channel advisory lock serialises edits, so two schedulers can never create a conflict at the same moment.

### 2. Deals & release orders

- **Deals** with priced lines, a status flow and conversion into a release order.
- **Release orders:**
  - Lines carry channel, material, band, duration, quantity, rate, discount, dates and max-per-day.
  - Agency commission and tax, with per-client tax treatment.
- **Approval:** multi-stage approval (configurable in Settings) with separation of duties; the creator cannot approve.
- **Booking:** final approval books inventory all-or-nothing.
- **Changes:**
  - Rejection needs a comment.
  - Controlled amendments create a new revision.
  - Cancellation releases unplaced inventory.
- **Placement:** automatic spot placement into booked breaks, validated by the rules engine.

### 3. Inventory

- **Breaks:** break generation for date ranges, with positions priced from rate cards (pro-rated by duration).
- **Views:** a band × date availability grid, a 14-day outlook chart and live KPIs.
- **Alerts:** low availability and unsold capacity, with configurable thresholds.
- **Edits:** withdraw and restore positions, and change their rates.
- **Booking safety:** optimistic version checks mean a position is never sold twice.

### 4. Billing

- **Invoices:**
  - Created from aired spots (or scheduled spots, configurable).
  - Each spot is claimed by exactly one invoice line.
  - Manual invoices are also supported.
- **Lifecycle:** issue (numbering, due date from credit terms), cancel with a reason, credit notes (limited to the balance), and a ledger of every movement.
- **Payments:** recorded against client or agency, with manual or automatic allocation (oldest due first) and checks on payer, currency and over-allocation.
- **Output:** PDF invoices and emailing with the PDF attached.
- **Online payments:**
  - A public pay link uses an unguessable token.
  - Card data never touches the app.
  - The invoice is marked paid only by a signed provider webhook.
- **Gateways:** a Stripe Checkout adapter, plus a TEST MODE simulated gateway.
- **Overdue handling:** overdue detection and payment reminders, each sent once.
- **Rate cards and tax rates.**

### 5. Reports

- 29 reports with date, channel and account filters, totals, and CSV (with formula-injection guard) and Excel export:
  - **Scheduling (6):** transmission schedule, channel summary, programme schedule, commercial breaks, secondary events, conflicts.
  - **Sales (7):** campaign bookings, RO status, advertiser bookings, agency bookings, commercial run, campaign delivery, promo performance.
  - **Inventory (2):** utilisation, revenue by channel, programme and slot.
  - **Finance (10):** sales summary, revenue by channel, client and agency, invoice register, ageing, overdue, payment history, tax summary, credit notes.
  - **Rights (4):** expiring licences, expired licences, remaining plays, content usage.
- An analytics overview with charts.
- Financial reports need their own permission. Exports are audited and rate-limited.

### Other required menu items

- **Dashboard:** live KPIs and conflicts.
- **Media pages:** Promos, Timers, New Media, Slides, Movies, Programs, Fillers and Coming Up are category views of the media library.
- **Secondary Events:** layered tracks with an overlap check.
- **Media Library and Commercials:** versioning, an approval flow, and deletion guarded while an asset has history or future airings.
- **Content Rights:** licences with channels, territories, play limits and expiry warnings. Any change that would uncover a future airing is blocked.
- **Advertising Inventory**, **Deals & Bookings**, **Release Orders**.
- **Agencies & Clients:** credit terms, commission, tax, status and outstanding balance.
- **Agreements & Contracts:** lifecycle and booking utilisation.
- **Invoices & Payments**, **Rate Cards & Tax**, **Reports & Analytics**.

**Administration:**

- **Integrations:** status, tests, exports, imports, the jobs table and reconciliation.
- **Channels:** time zone, day start, on-air days and team. The time zone is locked once the channel has events.
- **User Management:** users, invitations, password links, session revocation, and a roles and permission matrix with lockout protection.
- **System Settings:** company, currency, tax base, bill-on, invoice layout, approval stages, alerts, uploads, the scheduling rules editor, notification templates and the email log.
- **Audit Logs:** filters, field diffs and CSV export.
- **Also included:** global search (permission- and channel-aware), notifications, and a profile page with password change and session management.

## Data model

53 Prisma models and 15 enums are grouped as follows:

| Area | Models |
| --- | --- |
| Identity & access | User, Role, Permission, RolePermission, UserRole, Session, PasswordResetToken, LoginAttempt, Channel, ChannelUser |
| Media & rights | MediaAsset, MediaAssetVersion, Program, Movie, Commercial, Promo, PromoCampaign, ContentLicense, ContentPlayLog |
| Scheduling | Schedule, ScheduleVersion, ScheduleEvent, SecondaryEvent, SchedulingRule |
| Inventory | AdvertisingBreak, AdvertisingInventory |
| Sales | Agency, Client, Deal, DealLineItem, ReleaseOrder, ReleaseOrderLineItem, ROApproval, ReleaseOrderRevision, Agreement |
| Billing | TaxRate, RateCard, RateCardItem, Invoice, InvoiceLineItem, Payment, PaymentAllocation, CreditNote, FinancialTransaction, NumberSequence |
| Platform | Notification, NotificationTemplate, EmailLog, Integration, IntegrationJob, FileAttachment, AuditLog, SystemSetting |

The guarantees are described in [DATABASE.md](DATABASE.md).

## Pages and APIs

**Pages (authenticated)**

| Section | Pages |
| --- | --- |
| Operations | `/dashboard`, `/scheduling`, `/promos`, `/media/[category]`, `/secondary-events` |
| Content | `/media`, `/media/new`, `/media/item/[id]`, `/rights` |
| Sales | `/inventory`, `/deals`, `/deals/new`, `/deals/[id]`, `/release-orders`, `/release-orders/new`, `/release-orders/[id]`, `/agencies`, `/agreements`, `/agreements/[id]` |
| Finance | `/invoices`, `/invoices/new`, `/invoices/[id]`, `/payments`, `/payments/[id]`, `/rate-cards`, `/reports`, `/reports/[key]` |
| Administration | `/integrations`, `/channels`, `/users`, `/settings`, `/audit` |
| Personal | `/search`, `/notifications`, `/profile` |

**Public pages:** `/login`, `/forgot-password`, `/reset-password/[token]`, `/pay/[token]`, `/pay/[token]/simulate` (TEST MODE only).

**API routes**

| Route | Purpose | Access |
| --- | --- | --- |
| `GET /api/health` | Liveness and database check | public, reveals nothing |
| `POST /api/jobs` | Run scheduled work | `CRON_SECRET` bearer, disabled when unset |
| `GET /api/reports/[key]?format=csv\|xlsx` | Report export | session + report permission + channel scope |
| `GET /api/audit` | Audit CSV export | `audit.view` |
| `GET /api/invoices/[id]/pdf` | Invoice PDF | `billing.view` |
| `POST /api/files`, `GET /api/files/[id]` | Attachments | per-entity permission, scan status |
| `GET /api/media/search` | Timeline media search | `media.view` |
| `POST /api/payments/webhook/[provider]` | Payment notifications | provider signature |

Data changes go through 83 server actions in `src/app/actions/`. Each one validates its input with Zod, checks permissions and channel scope on the server, runs in a transaction where it touches more than one row, and writes an audit entry.

## Commands

```bash
npm install
npx prisma migrate deploy
DEV_ADMIN_PASSWORD='…' npm run db:seed        # development with demo data
npm run dev
npm run lint && npm run typecheck
npm test                                       # unit (+ integration with TEST_DATABASE_URL)
npm run test:e2e                               # end-to-end (E2E_PASSWORD)
npm run build && npm start                     # production
NODE_ENV=production npm run db:seed && npm run create-admin -- --email …   # first production setup
npm run jobs:run                               # scheduled work (cron every 5–15 min)
```

## Environment variables

- **Required:** `DATABASE_URL`, `APP_URL`.
- **Recommended:** SMTP settings (`EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM`), storage (`STORAGE_DRIVER`, `LOCAL_STORAGE_DIR` or `S3_*`), and `SCANNER_URL` with `ALLOW_UNSCANNED_FILES=false`.
- **Optional:**
  - Payments: `PAYMENT_GATEWAY`, `STRIPE_*`, `SIMULATED_GATEWAY_SECRET`, `ALLOW_SIMULATED_PAYMENTS`.
  - Integrations: `TALLY_URL`, `SAP_*`, `AMS_*`, `AUTOMATION_*`.
  - Jobs and diagnostics: `CRON_SECRET`, `PRISMA_LOG`.
- **Seeding and tests:** `SEED_DEMO`, `DEV_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, `TEST_DATABASE_URL`, `E2E_BASE_URL`, `E2E_PASSWORD`.

All are documented in `.env.example` and [DEPLOYMENT.md](DEPLOYMENT.md).

## Credentials and decisions still needed from you

| Item | Why | Until then |
| --- | --- | --- |
| SMTP server and sender address | Invitations, password resets, invoices and reminders reach real inboxes | Emails are written to the email log only |
| Stripe live keys and webhook secret (or another provider) | Real online card payments | Pay links are hidden, or run in a labelled TEST MODE |
| Tally server URL | Direct voucher posting | Tally XML file export |
| SAP endpoint, credentials and GL account mapping | Direct posting into SAP | Balanced AR journal CSV with placeholder accounts |
| Asset management API and its contract | Live media metadata sync | CSV import |
| Playout automation endpoint and required playlist format (e.g. BXF) | Pushing published days to playout | Playlist CSV export |
| Malware scanner endpoint | Scanning uploaded files in production | Files are marked "not scanned" and blocked from download unless explicitly allowed |
| Production hosting, PostgreSQL and backup target | Go-live | — |
| Your tax rules, rate cards, approval stages and role matrix | Correct pricing and controls | Demo values |

## Known limitations

- **Rate limiting** is held in memory per server instance. Running more than one instance needs a shared store such as Redis.
- **SAP and asset-management live connections** are only checked by a connection test. Posting into SAP and pulling metadata from the asset-management system need installation-specific contracts, so file export and import are the supported paths today.
- **The playout automation push** sends CSV to a generic endpoint. Real playout systems usually need a vendor format such as BXF, so confirm the format with your vendor before going live.
- **Only Stripe is implemented as a real payment provider.** Others can be added behind the same adapter interface.
- **Reminders go to finance users, not to the client.** Invoice emails to clients are sent when an invoice is issued, or on demand.
- **Live monitoring:** As-run reconciliation is manual (confirm aired). Nothing ingests as-run logs from playout automatically.
- **Language and formats:** the interface is in English only. Date and number formats are fixed (`dd MMM yyyy`, 24-hour clock); the default time zone and the currency are configurable.
- **Scale:** the system has been exercised with the demo dataset, not load-tested. Plan a performance test with realistic volumes (channels × 24 hours × days of history) before go-live.
- **Accessibility:** forms and controls have labels and keyboard support, but there has been no formal WCAG audit.
- **Notices in the audit log:** reminder and expiry notices record a `job.notice` audit entry to guarantee they are sent only once. Filter these out with the area filter if they are noise.

## Notable fixes found by testing

- **Brand separation:** the rule was skipped when both spots were outside commercial breaks, for example promos placed by auto-fill. It is fixed and covered by a unit test.
- **Duplicate webhooks:** two identical gateway webhooks arriving at the same moment raised a database error on the second. That is now reported as a duplicate, and an integration test covers it.
- **Payment reminders** could be re-sent on every job run. They are now sent once per invoice and due date.
- **Licence, agreement, promo-expiry and low-inventory notices** had templates but nothing that sent them. The scheduled job now sends them, once each.
