// Integration tests must never touch the development or production database.
// They run only when TEST_DATABASE_URL is set, and use it as DATABASE_URL.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.EMAIL_PROVIDER = "preview";
process.env.PAYMENT_GATEWAY = process.env.PAYMENT_GATEWAY ?? "simulated";
process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? "test-webhook-secret-0123456789";
