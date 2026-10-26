/**
 * Run scheduled work once: integration retries, overdue invoices and
 * reminders, agreement expiry, expiry and low-inventory notices, and
 * session housekeeping. Every step is idempotent, so schedule it every
 * 5–15 minutes (cron, systemd timer or your platform's scheduler):
 *
 *   *\/10 * * * *  cd /srv/trends && npm run jobs:run >> /var/log/trends-jobs.log 2>&1
 */
import { runScheduledWork } from "../src/lib/jobs/daily";
import { prisma } from "../src/lib/db";

runScheduledWork()
  .then((r) => console.log(new Date().toISOString(), JSON.stringify(r)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
