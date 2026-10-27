# Deployment

TRENDS is a standard Next.js server application backed by PostgreSQL. It runs on any host that can run Node.js 20+: a VM, a container platform or a PaaS.

## 1. Provision

- PostgreSQL 14+ with a dedicated database and role. Enable point-in-time recovery if your provider offers it.
- One Node.js instance. You can run several only after replacing the in-memory rate limiter with a shared store (see SECURITY.md).
- Persistent storage for uploads and integration output: either a mounted volume (`STORAGE_DRIVER=local`, `LOCAL_STORAGE_DIR`) S3-compatible storage (`STORAGE_DRIVER=s3`), Vercel Blob (`vercel-blob`) or the database itself (`database`).
- HTTPS termination: a load balancer or reverse proxy in front of `npm start`.

## 2. Configure

Set environment variables in your platform's secret store. `.env.example` lists all of them, with comments.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public HTTPS origin, used in links, emails and PDFs |
| `NODE_ENV=production` | yes | Set automatically by `npm start` |
| `EMAIL_PROVIDER=smtp`, `SMTP_*`, `EMAIL_FROM` | strongly recommended | Without SMTP, emails only appear in Settings → Email log |
| `STORAGE_DRIVER`, `LOCAL_STORAGE_DIR` or `S3_ENDPOINT_URL` + `S3_ACCESS_TOKEN` | yes | Where attachments and exports are kept |
| `SCANNER_URL` | recommended | Malware scanning for uploads. Set `ALLOW_UNSCANNED_FILES=false` in production |
| `PAYMENT_GATEWAY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional | Online invoice payment |
| `TALLY_URL`, `SAP_*`, `AMS_*`, `AUTOMATION_*` | optional | See INTEGRATIONS.md |
| `CRON_SECRET` | optional | Enables `POST /api/jobs` for HTTP-based schedulers |

## 3. Build and migrate

```bash
npm ci
npm run build                 # prisma generate + next build
npm run db:deploy             # apply migrations (safe to run on every release)
NODE_ENV=production npm run db:seed    # roles, permissions, settings, templates, rules; no demo data
npm run create-admin -- --email ops@yourcompany.com --name "Operations Admin"
npm start                     # listens on $PORT (default 3000)
```

Then sign in, and in **System Settings**:

- Set the company profile, base currency, tax rules, invoice layout and approval stages.
- Create channels and users in **Channels** and **User Management**.
- Load rate cards and tax rates in **Rate Cards & Tax**.

## Deploying on Vercel

The repository is ready for Vercel. `vercel.json` sets the build command (`npm run vercel-build`), a daily cron for `/api/jobs` and longer time limits for jobs and report exports.

The minimum is three things: import the repository, connect a database, and set two variables.

1. **Import the project.** In Vercel, choose **Add New → Project**, import the GitHub repository and keep the detected Next.js settings. The first build fails until a database is connected; that is expected.
2. **Add a database.** In the project's **Storage** tab, create a **Neon (Postgres)** database and connect it to the project. This sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used for migrations).
3. **Set the first administrator** in **Settings → Environment Variables**: `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters, letters and digits), optionally `ADMIN_NAME`. The account is created on deploy only while no super administrator exists. Remove `ADMIN_PASSWORD` after the first successful sign-in.
4. **Redeploy.** Each build runs the migrations, the idempotent foundation seed, the first-admin bootstrap and `next build`.
5. **Check it.** Open `/api/health`, then sign in with `ADMIN_EMAIL`.

Defaults on Vercel, and how to change them:

| Variable | Default on Vercel | Change it when |
| --- | --- | --- |
| `APP_URL` | `https://` + the project's production domain | you use a custom domain |
| `STORAGE_DRIVER` | `vercel-blob` when a Blob store is connected (`BLOB_READ_WRITE_TOKEN`), otherwise `database` | files grow large: connect a **Blob** store in **Storage**, so new uploads stop counting against the database size |
| `ALLOW_UNSCANNED_FILES` | unset, so attachments upload but cannot be downloaded until scanned | set `true` until a scanner (`SCANNER_URL`) is configured |
| `CRON_SECRET` | unset, so the daily job route is disabled | set a long random string to enable reminders, expiry notices and retries; Vercel Cron sends it automatically |
| `SEED_DEMO`, `DEV_ADMIN_PASSWORD` | unset | `SEED_DEMO=true` loads demo data for a showcase deployment. Never on a real production database |
| `PAYMENT_GATEWAY`, `SIMULATED_GATEWAY_SECRET`, `ALLOW_SIMULATED_PAYMENTS` | unset | `simulated` / any secret / `true` for a TEST MODE payment demo |
| SMTP, Stripe and integration variables | unset | as in the table above, when you have them |

Notes for Vercel:

- The Hobby plan allows one cron run per day. On Pro, change the schedule in `vercel.json` to `*/10 * * * *` so reminders and integration retries run every 10 minutes.
- The sign-in rate limiter is kept per serverless instance. Account lockout after 5 failed attempts is stored in the database and still applies everywhere.

## 4. Schedule background work

Overdue invoices, payment reminders, agreement expiry, licence, promo and low-inventory notices, integration retries and session clean-up all run from one idempotent command. Run it every 5 to 15 minutes:

```cron
*/10 * * * *  cd /srv/trends && npm run jobs:run >> /var/log/trends-jobs.log 2>&1
```

On platforms without cron, set `CRON_SECRET` and call the endpoint instead:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://trends.example.com/api/jobs
```

## 5. Monitor

- `GET /api/health` returns `200 {"status":"ok","db":"ok"}`, or `503` when the database is unreachable. It reveals no configuration.
- Watch the **Integrations** page for failed or dead jobs. Failures also notify system administrators.
- The audit log (Administration → Audit Logs) can be exported as CSV for your SIEM.

## 6. Backup and restore

What to back up:

1. **The PostgreSQL database.** It holds all business data, the audit log and settings.
2. **The storage directory or bucket.** It holds attachments and integration output files.

Recommended approach:

```bash
# nightly logical backup, kept encrypted and off-site
pg_dump --format=custom --no-owner "$DATABASE_URL" > trends-$(date +%F).dump
# storage
tar czf trends-storage-$(date +%F).tgz "$LOCAL_STORAGE_DIR"     # or bucket versioning / replication
```

Keep at least 30 daily and 12 monthly copies, and use your provider's point-in-time recovery where available.

To restore:

```bash
createdb trends_restore
pg_restore --no-owner --dbname=trends_restore trends-YYYY-MM-DD.dump
# point DATABASE_URL at trends_restore, restore the storage archive, then:
npm run db:deploy   # applies any migrations newer than the backup
```

Test a restore into a separate database at least once a quarter. After restoring, check `/api/health`, sign in, open a recent invoice PDF and a recent schedule.

## 7. Upgrades

1. Back up first.
2. Deploy the new build.
3. Run `npm run db:deploy`.
4. Restart.

Migrations are additive where possible. Read the release notes before any migration that rewrites data.

## 8. Rollback

- If a release fails before its migration ran, redeploy the previous build.
- If the migration ran, restore the pre-upgrade backup, or apply a corrective migration. Prisma does not generate down-migrations automatically.
