# Security

This page describes how TRENDS protects accounts, data and money, and what an operator must do before going live.

## Authentication

- **Passwords** are hashed with bcrypt. The policy requires at least 12 characters with letters and digits. No default production password exists: the production seed creates no users, and the first administrator is created with `npm run create-admin`, which reads the password from a hidden prompt or `ADMIN_PASSWORD` and never prints it.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only the SHA-256 of the token is stored. Sessions end after 12 hours, or after 2 hours idle. Suspending, disabling or changing a user's password signs them out everywhere. Users can see and end their own sessions on the profile page; administrators can end anyone's.
- **Brute-force protection**: there are 5 failed attempts per email and 20 per IP in 15 minutes, plus a per-IP request limit. Failed sign-ins take the same time whether the email exists or not, and the error message never says which part was wrong. Every attempt is recorded and audited.
- **Password reset and invitation** links are single-use, hashed at rest, expire (1 hour for resets, 24 hours for admin-sent links, 72 hours for invitations) and are redacted from the email log. Asking for a reset never reveals whether an account exists.

## Authorisation

- There are 45 permission keys (`src/lib/auth/permissions.ts`). They are grouped into 10 built-in roles and any number of custom roles, editable in **User Management → Roles & permissions**.
- **Every page** calls `requirePage(permission)`. **Every server action and API route** calls `requireUser(permission)` or checks the permission explicitly. Hiding a button in the UI is never the only control.
- **Channel scope**: users see only their assigned channels unless they have all-channel access. Scheduling, inventory, booking, reports and search all filter by channel on the server.
- **Separation of duties**: a release order cannot be approved by the user who created it. Each approval stage needs its own permission.
- **Lockout protection**: you cannot disable yourself or remove your own user-management access. The last active super administrator cannot be removed. Only a super administrator can grant that role. A role change that would leave nobody able to manage users is refused. The super administrator role always has every permission and cannot be edited.

## Data protection

- **Money** is stored as `Decimal(18,2)` and calculated with decimal.js using half-up rounding. Floating point is never used.
- **Card data is never handled.** Online payments use the provider's hosted checkout. Only the provider's transaction ID is stored.
- **An invoice is marked paid only by a verified provider event**, never by visiting a success page. Webhooks are HMAC-verified with constant-time comparison; Stripe events also have a 5-minute timestamp tolerance. The provider transaction ID is unique, so retries and simultaneous redeliveries cannot create duplicate payments. The simulated gateway is labelled TEST MODE everywhere and is refused in production unless `ALLOW_SIMULATED_PAYMENTS=true`.
- **Audit log**: sign-ins, approvals, publishes, bookings, invoices, payments, settings, roles and exports are recorded with before/after snapshots. Keys that look like secrets (password, token, secret, hash, api key, card, CVV) are redacted before storage. The app offers no way to edit or delete audit entries.
- **Secrets** are only read from environment variables. The Integrations page shows whether a variable is set, never its value. Error messages from SMTP and integrations are scrubbed of credentials before they are logged.
- **Uploads**: there is a size limit and an extension allow-list (executables, scripts, HTML and SVG are always refused). The content's magic bytes must match its extension, filenames are sanitised, files get random storage keys, and a SHA-256 is recorded. An optional malware scanner can be configured with `SCANNER_URL`. Files that have not been scanned can only be downloaded when `ALLOW_UNSCANNED_FILES=true`, which is meant for development. Downloads are permission-checked per entity.
- **Exports**: CSV cells that start with `= + - @` are prefixed to block formula injection. Report and audit exports are rate-limited and audited.

## HTTP hardening

`next.config.ts` sends the following headers:

- A Content-Security-Policy with `default-src 'self'`, no third-party scripts and `frame-ancestors 'none'`.
- `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a Permissions-Policy.
- HSTS in production.

Server actions use Next.js's built-in origin checks against CSRF. API routes that change data accept only authenticated session cookies with `SameSite=Lax`, or a signed webhook.

## Operator checklist before go-live

1. Serve over HTTPS only and set `APP_URL` to the HTTPS origin.
2. Use a dedicated PostgreSQL role with a strong password. Enable encrypted backups (see DEPLOYMENT.md).
3. Seed with `NODE_ENV=production` (no demo data), then run `npm run create-admin`.
4. Configure SMTP so password resets and invitations reach users.
5. Configure a malware scanner and set `ALLOW_UNSCANNED_FILES=false`.
6. Leave `PAYMENT_GATEWAY` empty, or set it to `stripe` with live keys and the webhook endpoint `/api/payments/webhook/stripe`.
7. Run more than one instance only after replacing the in-memory rate limiter (`src/lib/rate-limit.ts`) with a shared store such as Redis.
8. Review the role matrix and remove permissions your organisation does not need.
9. Ship the application logs and the audit log to your central logging and retention system.
