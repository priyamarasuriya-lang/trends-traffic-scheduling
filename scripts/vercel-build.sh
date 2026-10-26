#!/usr/bin/env sh
# Build step for Vercel (and similar platforms that build with production env vars).
# Migrations use the direct (non-pooled) connection when the host provides one.
set -e
MIGRATE_URL="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}}"
npx prisma generate
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy
# Roles, permissions, settings, templates and rules (idempotent). Demo data only if SEED_DEMO=true.
DATABASE_URL="$MIGRATE_URL" npx tsx prisma/seed.ts
# First super administrator from ADMIN_EMAIL / ADMIN_PASSWORD, only while none exists.
DATABASE_URL="$MIGRATE_URL" npx tsx scripts/create-admin.ts --if-none
npx next build
