import { test, expect } from "@playwright/test";
import { login, expectToast } from "./helpers";

test("manual invoice → issue → partial payment → online payment marks it paid", async ({ page, browser }) => {
  await login(page);
  await page.goto("/invoices/new", { waitUntil: "networkidle" });
  const clientId = await page.locator("#f-clientId option").nth(1).getAttribute("value");
  await page.selectOption("#f-clientId", clientId!);
  await page.selectOption("#f-agencyId", "");
  await page.fill('[aria-label="Description line 1"]', "E2E sponsorship");
  await page.fill('[aria-label="Qty line 1"]', "1");
  await page.fill('[aria-label="Unit price line 1"]', "500.00");
  await page.fill('[aria-label="Comm % line 1"]', "0");
  await Promise.all([page.waitForURL(/invoices\/c/), page.click("text=Save draft")]);
  await page.click('button:has-text("Issue invoice")');
  await page.click('[role=dialog] button:has-text("Issue")');
  await expectToast(page, /issued/i);

  await page.click('button:has-text("Record payment")');
  await page.fill("#f-amount", "100");
  await page.fill("#f-reference", `E2E-${Date.now()}`);
  await page.click("[role=dialog] button[type=submit]");
  await expectToast(page, /recorded/i);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Partially Paid").first()).toBeVisible();

  // Visiting the payment page alone never marks the invoice paid; only a verified provider event does.
  const payHref = await page.locator('a[href^="/pay/"]').first().getAttribute("href");
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(payHref + "?status=returned", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Partially Paid").first()).toBeVisible();

  await anon.goto(payHref!, { waitUntil: "networkidle" });
  await expect(anon.getByText(/test mode/i).first()).toBeVisible();
  await anon.click('button:has-text("Pay")');
  await anon.waitForURL(/simulate/);
  await anon.click("text=Simulate success");
  await anon.waitForURL(/status=returned/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(/^Paid$/).first()).toBeVisible();

  const forged = await anon.request.post("/api/payments/webhook/simulated", { data: { type: "payment.succeeded", gatewayRef: "forged", invoiceToken: "x", amount: "1", currency: "USD" }, headers: { "x-sim-signature": "bad" } });
  expect(forged.status()).toBe(400);
  expect((await anon.request.get(page.url().replace("/invoices/", "/api/invoices/") + "/pdf")).status()).toBe(401);
});
