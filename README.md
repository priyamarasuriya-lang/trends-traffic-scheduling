# TRENDS — Traffic & Scheduling Management System

TRENDS is a web application for a television broadcaster's traffic department. It plans what airs on each channel, sells and books advertising inventory, invoices advertisers and agencies, collects payments and reports on all of it. Every business rule is enforced on the server, every financial and scheduling change is audited, and money is handled as exact decimals.

Built with Next.js 15 (App Router, server actions), TypeScript, Tailwind CSS 4, Prisma 6 on PostgreSQL 16, dnd-kit, Recharts and Zod. Tested with Vitest and Playwright.

## What it does

| Area | Highlights |
| --- | --- |
| **Traffic scheduling** | Multi-channel drag-and-drop timeline per broadcast day, commercial breaks with ordered spots, ripple editing, duplicate days, draft → published versions with restore, aired confirmation. A pure rules engine checks 15 configurable rules (overlaps, break length, brand/competitor/same-spot separation, advertiser and content-category windows, campaign dates and frequency, approved content, licences and play limits, programme start times) and explains every conflict with exact channel-local times. Per-channel advisory locks stop two schedulers creating a conflict at the same moment. |
| **Deals & release orders** | Deals with priced lines; release orders (ROs) with multi-stage approval (configurable), separation of duties, revisions and controlled amendments, cancellation that releases inventory, automatic spot placement. |
| **Advertising inventory** | Break generation, positions with rates from rate cards, band × date availability grid, 14-day outlook, low-availability and unsold alerts. Bookings claim positions with optimistic version checks so the same slot is never sold twice. |
| **Billing** | Invoices from aired (or scheduled) spots, manual invoices, credit notes, payments with allocation, overdue tracking and reminders, PDF invoices, email delivery, online payment links (Stripe adapter or a clearly labelled simulated gateway). A spot can be invoiced exactly once. |
| **Reports** | 29 operational and financial reports with filters, totals, CSV and Excel export, plus an analytics overview. |
| **Media & rights** | Media library by category (programmes, movies, commercials, promos, timers, slides, coming-up, fillers, new media, secondary graphics) with versioning and approval; content licences with territories, channels, play limits and expiry warnings. |
| **Promos & secondary events** | Promo campaigns with priority, rotation and limits, and an auto-fill planner with preview. Secondary events (logos, tickers, lower thirds) on layered tracks with overlap checks. |
| **Agencies, clients & agreements** | Accounts with credit terms, commission, tax treatment and status; agreements with lifecycle and booking utilisation. |
| **Integrations** | Tally (XML vouchers), SAP (AR journal CSV), asset management (CSV import / API check), playout automation (playlist export), SMTP email, payments. Jobs are idempotent, retried with back-off and reconciled. Anything without credentials runs in a labelled file-export or test mode. |
| **Administration** | Channels, users, roles and a permission matrix (45 permissions, 10 built-in roles, custom roles), lockout protection, system settings, notification templates, email log, audit log with diffs and CSV export, global search, notifications and profile/sessions. |

## Quick start (development)

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
cp .env.example .env               # then set DATABASE_URL
npm install
npx prisma migrate deploy          # create the schema
DEV_ADMIN_PASSWORD='choose-a-long-password1' npm run db:seed   # roles, settings and demo data
npm run dev                        # http://localhost:3000
```

Sign in as `admin@trends.local` with the `DEV_ADMIN_PASSWORD` you chose. The seed also creates one demo user per role (`traffic@`, `scheduler@`, `sales@`, `booking@`, `finance@`, `accounts@`, `media@`, `sysadmin@`, `viewer@` at `trends.local`) with the same password. Demo records are flagged and named "(Demo)". If you omit `DEV_ADMIN_PASSWORD`, a random password is printed once.

For production, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): demo data is never loaded there by default and the first administrator is created with `npm run create-admin`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript checks |
| `npm test` | Unit tests, plus database integration tests when `TEST_DATABASE_URL` is set |
| `npm run test:e2e` | Playwright end-to-end tests (needs a seeded database and `E2E_PASSWORD`) |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Seed roles, permissions, settings, templates, rules and (outside production) demo data |
| `npm run create-admin -- --email you@company.com --name "Your Name"` | Create or promote a super administrator |
| `npm run jobs:run` | Run scheduled work once (schedule it every 5–15 minutes) |

## Documentation

- [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md): what was built, test results, limitations and what still needs credentials
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production setup, environment variables, scheduled jobs, backup and restore
- [docs/SECURITY.md](docs/SECURITY.md): authentication, authorisation, data protection and hardening checklist
- [docs/DATABASE.md](docs/DATABASE.md): data model, concurrency and integrity guarantees
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): each adapter, its modes and how to go live
- [docs/TESTING.md](docs/TESTING.md): how to run each test suite

## Project layout

```
prisma/              schema, migrations, seed
src/app/(app)/       authenticated pages (one folder per menu item)
src/app/(auth)/      login, forgot and reset password
src/app/pay/         public invoice payment pages
src/app/api/         health, jobs, reports, audit export, PDFs, files, payment webhooks
src/app/actions/     server actions (validation + permission checks + audit)
src/lib/             domain services: scheduling engine and service, inventory, sales, billing,
                     payments, integrations, reports, notifications, auth, storage, jobs
src/components/      UI building blocks, forms, layout
tests/unit|integration|e2e
scripts/             create-admin, run-jobs
```
