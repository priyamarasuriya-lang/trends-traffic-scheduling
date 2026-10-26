# Testing

| Suite | Command | Needs | Covers |
| --- | --- | --- | --- |
| Type check | `npm run typecheck` | nothing | Whole codebase |
| Lint | `npm run lint` | nothing | ESLint with the Next.js core-web-vitals and TypeScript rules |
| Unit | `npm test` | nothing | Scheduling rules engine (all rule families, ripple, break layout), billing maths (rounding, tax base, pro-rating, invoice status, payment allocation), time zones and DST broadcast days, CSV escaping and formula-injection guard, audit secret redaction |
| Integration | `TEST_DATABASE_URL=… SIMULATED_GATEWAY_SECRET=x npm test` | an empty, disposable PostgreSQL database with migrations applied | RO approval permissions and separation of duties; two ROs approved at the same moment never share an inventory position, and the loser rolls back completely; two simultaneous invoice runs bill each spot once; payer, currency and over-allocation checks; credit-note limits; simultaneous duplicate gateway webhooks create one payment; two overlapping timeline edits at the same moment, of which only one lands |
| End-to-end | `E2E_PASSWORD=… npm run test:e2e` | a database seeded with demo data (`DEV_ADMIN_PASSWORD=…`) and the app running, or let Playwright start `npm run dev` | Sign-in failure and sign-out, anonymous access blocked for pages and APIs, viewer blocked from administration, scheduler limited to one channel, every menu page renders cleanly, invoice → issue → partial payment → visiting the success page does not mark it paid → simulated gateway payment marks it paid, forged webhook rejected, anonymous PDF blocked, self-lockout prevented, rule parameter validation, drag-and-drop conflict refused with the exact overlap |

## Preparing the test databases

```bash
createdb trends_test
DATABASE_URL=postgresql://…/trends_test npx prisma migrate deploy
DATABASE_URL=postgresql://…/trends_test SEED_DEMO=false npm run db:seed

createdb trends_e2e
DATABASE_URL=postgresql://…/trends_e2e npx prisma migrate deploy
DATABASE_URL=postgresql://…/trends_e2e DEV_ADMIN_PASSWORD='e2e-Password-2026' npm run db:seed
```

Integration tests create their own uniquely named records and can run repeatedly against the same database. They are skipped automatically when `TEST_DATABASE_URL` is not set, so `npm test` never touches your development data.

To run the end-to-end suite against a production build:

```bash
npm run build
DATABASE_URL=postgresql://…/trends_e2e APP_URL=http://localhost:3100 \
  PAYMENT_GATEWAY=simulated SIMULATED_GATEWAY_SECRET=x ALLOW_SIMULATED_PAYMENTS=true \
  npx next start -p 3100 &
E2E_BASE_URL=http://localhost:3100 E2E_PASSWORD='e2e-Password-2026' npm run test:e2e
```
