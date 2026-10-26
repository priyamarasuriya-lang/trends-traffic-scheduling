import { test, expect } from "@playwright/test";
import { login, expectToast } from "./helpers";

test("administrators cannot lock themselves out", async ({ page }) => {
  await login(page);
  await page.goto("/users", { waitUntil: "networkidle" });
  await page.locator('tr:has-text("(you)") button[aria-label^="Edit"]').click();
  await page.selectOption("[role=dialog] #f-status", "DISABLED");
  await page.locator("[role=dialog] input[name=sendInvite]").uncheck();
  await page.click("[role=dialog] button[type=submit]");
  await expectToast(page, /cannot suspend or disable your own account/i);
});

test("scheduling rules validate parameters and protect the overlap rule", async ({ page }) => {
  await login(page);
  await page.goto("/settings?tab=rules", { waitUntil: "networkidle" });
  await page.locator('button[aria-label="Edit Brand separation"]').click();
  await page.fill("[role=dialog] #f-params", '{"minSeconds": "soon"}');
  await page.click("[role=dialog] button[type=submit]");
  await expect(page.locator("[role=dialog]").getByText(/must be a number/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('button[aria-label="Edit No overlapping events"]').click();
  await page.locator("[role=dialog] input[name=enabled]").uncheck();
  await page.click("[role=dialog] button[type=submit]");
  await expectToast(page, /must stay enabled/i);
});

test("health endpoint reports database status", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ status: "ok", db: "ok" });
});
