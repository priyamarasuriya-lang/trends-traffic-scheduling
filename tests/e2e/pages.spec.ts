import { test, expect } from "@playwright/test";
import { login, trackErrors } from "./helpers";

// Every menu item must open a working page for an administrator.
const PAGES = [
  "/dashboard", "/scheduling", "/promos", "/media/timers", "/media/new-media", "/media/slides", "/media/movies", "/media/programs", "/media/fillers", "/media/coming-up",
  "/secondary-events", "/media", "/media/commercials", "/rights", "/inventory", "/deals", "/release-orders", "/agencies", "/agreements", "/invoices", "/payments", "/rate-cards",
  "/reports", "/integrations", "/channels", "/users", "/settings", "/audit", "/search?q=demo", "/notifications", "/profile",
];

test("all menu pages render without errors", async ({ page }) => {
  const errors = trackErrors(page);
  await login(page);
  for (const path of PAGES) {
    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res?.status(), path).toBeLessThan(400);
    await expect(page.locator("h1").first(), path).toBeVisible();
    await expect(page.getByText("Something went wrong"), path).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
