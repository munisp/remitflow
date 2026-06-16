/**
 * Visual Regression Tests
 * ────────────────────────
 * Captures screenshots of key pages and compares against baselines.
 * Run: npx playwright test tests/visual/ --update-snapshots (first run)
 * Run: npx playwright test tests/visual/ (subsequent runs)
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const PAGES = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
  { name: "dashboard", path: "/dashboard" },
  { name: "wallet", path: "/wallet" },
  { name: "send-money", path: "/send-money" },
  { name: "transactions", path: "/transactions" },
  { name: "beneficiaries", path: "/beneficiaries" },
  { name: "settings", path: "/settings" },
  { name: "kyc", path: "/kyc" },
  { name: "notifications", path: "/notifications" },
];

const VIEWPORTS = [
  { name: "mobile", width: 393, height: 852 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const page of PAGES) {
  for (const viewport of VIEWPORTS) {
    test(`${page.name} - ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const p = await context.newPage();
      await p.goto(`${BASE_URL}${page.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await expect(p).toHaveScreenshot(`${page.name}-${viewport.name}.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
      await context.close();
    });
  }
}
