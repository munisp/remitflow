/**
 * Authentication Fixtures
 * 
 * Provides reusable authentication state for tests
 */

import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

type AuthFixtures = {
  authenticatedPage: any;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Login before test
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait('test@example.com', 'SecurePassword123!');
    
    // Use authenticated page in test
    await use(page);
    
    // Logout after test
    const logoutButton = page.locator('button:has-text("Logout")');
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    }
  },
});

export { expect } from '@playwright/test';
