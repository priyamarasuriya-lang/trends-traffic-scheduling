# Database

PostgreSQL 14+ through Prisma 6. Schema: `prisma/schema.prisma` (53 models, 15 enums). Migrations live in `prisma/migrations` and are applied with `npm run db:deploy`.

## Model map

| Area | Models |
| --- | --- |
| Identity & access | User, Role, Permission, RolePermission, UserRole, Session, PasswordResetToken, LoginAttempt, Channel, ChannelUser |
| Media & rights | MediaAsset, MediaAssetVersion, Program, Movie, Commercial, Promo, PromoCampaign, ContentLicense, ContentPlayLog |
| Scheduling | Schedule (one per channel and broadcast date), ScheduleVersion (published snapshots), ScheduleEvent, SecondaryEvent, SchedulingRule |
| Inventory | AdvertisingBreak, AdvertisingInventory (one row per sellable position) |
| Sales | Agency, Client, Deal, DealLineItem, ReleaseOrder, ReleaseOrderLineItem, ROApproval, ReleaseOrderRevision, Agreement |
| Billing | TaxRate, RateCard, RateCardItem, Invoice, InvoiceLineItem, Payment, PaymentAllocation, CreditNote, FinancialTransaction (ledger), NumberSequence |
| Platform | Notification, NotificationTemplate, EmailLog, Integration, IntegrationJob, FileAttachment, AuditLog, SystemSetting |

## Time

All instants are stored in UTC. Each channel has an IANA time zone and a broadcast-day start hour (for example 06:00). A broadcast day runs from that hour to the same hour the next day, which is 23, 24 or 25 hours long across daylight-saving changes (see `src/lib/time.ts`). A channel's time zone and day start are locked once it has schedule events, because changing them would move existing days.

## Integrity and concurrency guarantees

| Risk | Guarantee | Where |
| --- | --- | --- |
| Two schedulers create overlapping events | Every schedule change takes a per-channel `pg_advisory_xact_lock` and re-validates the affected window inside the transaction | `scheduling/service.ts` |
| The same ad position is sold twice | Claims are `UPDATE … WHERE status='AVAILABLE' AND version=n`. A lost race moves to the next candidate. A release order that cannot be fully booked rolls back completely | `inventory/service.ts` |
| An RO stage is approved twice | `SELECT … FOR UPDATE` on the release order | `sales/service.ts` |
| A spot is invoiced twice | Spots are linked to an invoice line with `WHERE invoiceLineItemId IS NULL`. A mismatch aborts the transaction | `billing/service.ts` |
| A payment is over-allocated or applied to the wrong payer | Row locks on invoice and payment, plus checks on payer, currency, unallocated amount and invoice balance | `billing/service.ts` |
| A gateway webhook is delivered twice | Unique `Payment.gatewayRef`. A concurrent duplicate is detected and ignored | `payments/gateway.ts` |
| Document numbers collide | `NumberSequence` rows are incremented inside the creating transaction | `numbering.ts` |
| An integration export runs twice | Unique `dedupeKey` (hash of the job input), unless the user forces a re-run | `integrations/index.ts` |
| A notice is sent repeatedly | Reminder and expiry notices are recorded once per subject and date | `jobs/daily.ts`, `billing/service.ts` |

Money columns are `Decimal(18,2)`. Percentages are `Decimal(9,4)`. Every invoice movement (issue, payment, credit note, cancellation) writes a `FinancialTransaction` row with the running balance.

## Deletion policy

Business records that have history (media assets, clients, agencies, agreements, licences, channels) are soft-deleted (`deletedAt`) or deactivated. Deleting a record is refused while it is still in use, for example an asset with future airings or an account with open release orders. Issued invoices are cancelled with a reason or credited, never deleted.

## Seeding

`prisma/seed.ts` runs in two stages:

- **Foundation**, always: permissions, roles, settings, notification templates, scheduling rules and integrations. It is idempotent.
- **Demo data**: three channels, eight days of schedules around the seed date, media, rights, accounts, deals, release orders, invoices and payments. It loads only outside production, unless `SEED_DEMO=true` is set. Every demo record is flagged `isDemo` or named "(Demo)".
