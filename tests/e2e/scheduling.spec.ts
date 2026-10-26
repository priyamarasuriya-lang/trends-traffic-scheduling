import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("dropping a promo onto a programme is refused with the exact conflict", async ({ page }) => {
  await login(page);
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/scheduling?date=${date}`, { waitUntil: "networkidle" });
  await page.fill('input[aria-label="Search media"]', "Coming Up bumper");
  const source = page.locator('[aria-roledescription="draggable"]').filter({ hasText: "Coming Up bumper" }).first();
  await expect(source).toBeVisible();
  // The first programme of the broadcast day on the first channel.
  const target = page.locator('[aria-label$="at 06:00:00, 25:00"]').first();
  await target.scrollIntoViewIfNeeded();
  const before = await page.locator('[aria-label^="Coming Up bumper at"]').count();

  const s = (await source.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(s.x + 20, s.y + 10);
  await page.mouse.down();
  await page.mouse.move(s.x + 60, s.y + 40, { steps: 5 });
  await page.mouse.move(t.x + 50, t.y + 30, { steps: 15 });
  await page.mouse.up();

  await expect(page.locator("[role=alert]").filter({ hasText: /overlaps/ }).first()).toBeVisible();
  expect(await page.locator('[aria-label^="Coming Up bumper at"]').count()).toBe(before);
});
