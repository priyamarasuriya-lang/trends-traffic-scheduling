import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_PASSWORD ?? process.env.DEV_ADMIN_PASSWORD ?? "";

export async function login(page: Page, email = "admin@trends.local") {
  if (!PASSWORD) throw new Error("Set E2E_PASSWORD to the demo password used when seeding.");
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(/dashboard/), page.click("button[type=submit]")]);
}

/** Collect uncaught page errors so tests can assert a page rendered cleanly. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Wait for a toast with matching text (earlier toasts may still be on screen). */
export async function expectToast(page: Page, text: RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}
