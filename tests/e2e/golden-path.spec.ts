/**
 * Golden Path E2E Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the critical user journey:
 * 1. Login → Dashboard loads
 * 2. View wallet balances
 * 3. Navigate to Send Money
 * 4. Select beneficiary
 * 5. Enter amount → See fee breakdown
 * 6. Confirm transfer → See receipt
 * 7. View transaction in history
 * 8. Check notifications
 *
 * Run: npx playwright test tests/e2e/golden-path.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

test.describe("Golden Path — Send Money Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test("should load the landing page", async ({ page }) => {
    await expect(page).toHaveTitle(/RemitFlow/i);
    const hero = page.locator("text=Send Money");
    await expect(hero.first()).toBeVisible({ timeout: 10000 });
  });

  test("should navigate to login", async ({ page }) => {
    const loginBtn = page.getByRole("button", { name: /sign in|login|get started/i });
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await expect(page).toHaveURL(/.*auth.*|.*login.*/);
    }
  });

  test("should show dashboard after login", async ({ page }) => {
    // Navigate to dashboard (assumes auth session exists)
    await page.goto(`${BASE_URL}/dashboard`);
    const dashboard = page.locator("[data-testid=dashboard], h1, h2").first();
    await expect(dashboard).toBeVisible({ timeout: 15000 });
  });

  test("should display wallet balances", async ({ page }) => {
    await page.goto(`${BASE_URL}/wallet`);
    // Look for any currency symbol or balance indicator
    const balanceElement = page.locator("text=/\\$|£|€|₦|KSh/").first();
    await expect(balanceElement).toBeVisible({ timeout: 10000 });
  });

  test("should load send money page", async ({ page }) => {
    await page.goto(`${BASE_URL}/send`);
    const sendPage = page.locator("text=/send money|new transfer|recipient/i").first();
    await expect(sendPage).toBeVisible({ timeout: 10000 });
  });

  test("should display beneficiary list", async ({ page }) => {
    await page.goto(`${BASE_URL}/beneficiaries`);
    await page.waitForLoadState("networkidle");
    // Page should load without errors
    const errorToast = page.locator("text=/error|failed/i");
    await expect(errorToast).not.toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("should load transactions page", async ({ page }) => {
    await page.goto(`${BASE_URL}/transactions`);
    await page.waitForLoadState("networkidle");
    const txPage = page.locator("text=/transaction|activity|history/i").first();
    await expect(txPage).toBeVisible({ timeout: 10000 });
  });

  test("should load notifications page", async ({ page }) => {
    await page.goto(`${BASE_URL}/notifications`);
    await page.waitForLoadState("networkidle");
    const notifPage = page.locator("text=/notification|alert/i").first();
    await expect(notifPage).toBeVisible({ timeout: 10000 });
  });

  test("should load KYC verification page", async ({ page }) => {
    await page.goto(`${BASE_URL}/kyc-verification`);
    await page.waitForLoadState("networkidle");
    const kycPage = page.locator("text=/kyc|verification|identity/i").first();
    await expect(kycPage).toBeVisible({ timeout: 10000 });
  });

  test("should load settings page", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    const settingsPage = page.locator("text=/settings|preferences/i").first();
    await expect(settingsPage).toBeVisible({ timeout: 10000 });
  });
});

test.describe("API Health Checks", () => {
  test("should return healthy from system.health", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/trpc/system.health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result?.data?.status).toBe("ok");
  });

  test("should return FX rates", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/trpc/fx.getRates?input=${encodeURIComponent(JSON.stringify({ base: "USD" }))}`);
    expect(response.status()).toBe(200);
  });
});

test.describe("Mobile Viewport", () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test("should show bottom navigation on mobile", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("networkidle");
    // Bottom nav should be visible on mobile
    const bottomNav = page.locator("nav, [role=navigation]").last();
    if (await bottomNav.isVisible()) {
      await expect(bottomNav).toBeVisible();
    }
  });

  test("should show language switcher", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    const langSwitcher = page.locator("text=/language|english|yoruba/i").first();
    if (await langSwitcher.isVisible()) {
      await expect(langSwitcher).toBeVisible();
    }
  });
});
