import { test, expect } from "@playwright/test";
import { login, PASSWORD } from "./helpers";

test("rejects a wrong password without saying which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "admin@trends.local");
  await page.fill("#password", "not-the-password-123");
  await page.click("button[type=submit]");
  await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
  await expect(page).toHaveURL(/login/);
});

test("protects pages and APIs from anonymous users", async ({ page, request }) => {
  await page.goto("/invoices");
  await expect(page).toHaveURL(/login/);
  expect((await request.get("/api/audit")).status()).toBe(401);
  expect((await request.get("/api/reports/transmission-schedule")).status()).toBe(401);
});

test("a management viewer cannot reach administration", async ({ page }) => {
  await login(page, "viewer@trends.local");
  const nav = page.locator("aside");
  await expect(nav.getByText("Dashboard")).toBeVisible();
  await expect(nav.getByText("User Management")).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL(/forbidden/);
  expect((await page.request.get("/api/audit")).status()).toBe(403);
});

test("a scheduler only sees their own channel", async ({ page }) => {
  await login(page, "scheduler@trends.local");
  const options = await page.locator("header select option").allInnerTexts();
  expect(options.join(" ")).toContain("TRN1");
  expect(options.join(" ")).not.toContain("TRNM");
});

test("sign out ends the session", async ({ page }) => {
  expect(PASSWORD).not.toBe("");
  await login(page);
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByText("Sign out").click();
  await expect(page).toHaveURL(/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login/);
});
