/**
 * Login Flow E2E Tests
 * 
 * Test Coverage:
 * - Successful login with valid credentials
 * - Failed login with invalid credentials
 * - Email validation
 * - Password validation
 * - Remember me functionality
 * - Forgot password flow
 * - Social login (Google, Facebook)
 * - 2FA authentication
 * - Session persistence
 * - Logout functionality
 * 
 * @group auth
 * @group critical
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';

// Test data
const VALID_USER = {
  email: 'test@example.com',
  password: 'SecurePassword123!',
};

const INVALID_USER = {
  email: 'invalid@example.com',
  password: 'WrongPassword123!',
};

test.describe('Login Flow', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test.describe('Successful Login', () => {
    test('should login successfully with valid credentials', async ({ page }) => {
      // Arrange
      await loginPage.verifyOnLoginPage();

      // Act
      await loginPage.login(VALID_USER.email, VALID_USER.password);

      // Assert
      await loginPage.verifySuccessfulLogin();
      await expect(page).toHaveURL(/.*dashboard/);
      
      // Verify user is authenticated
      const userMenu = page.locator('[data-testid="user-menu"], .user-menu');
      await expect(userMenu).toBeVisible();
    });

    test('should login and redirect to originally requested page', async ({ page }) => {
      // Arrange - Try to access protected page
      await page.goto('/transactions');
      await page.waitForURL(/.*login/);

      // Act - Login
      await loginPage.login(VALID_USER.email, VALID_USER.password);

      // Assert - Should redirect back to transactions page
      await page.waitForURL(/.*transactions/, { timeout: 10000 });
      await expect(page).toHaveURL(/.*transactions/);
    });

    test('should persist session with "Remember Me" checked', async ({ page, context }) => {
      // Act - Login with Remember Me
      await loginPage.login(VALID_USER.email, VALID_USER.password, true);
      await loginPage.verifySuccessfulLogin();

      // Get cookies
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name.includes('session') || c.name.includes('token'));
      
      // Assert - Session cookie should have long expiry
      expect(sessionCookie).toBeDefined();
      if (sessionCookie) {
        const expiryDate = new Date(sessionCookie.expires * 1000);
        const now = new Date();
        const daysDiff = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysDiff).toBeGreaterThan(7); // Should last at least 7 days
      }
    });

    test('should maintain session after page refresh', async ({ page }) => {
      // Arrange - Login
      await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);

      // Act - Refresh page
      await page.reload();

      // Assert - Should still be logged in
      await expect(page).toHaveURL(/.*dashboard/);
      const userMenu = page.locator('[data-testid="user-menu"]');
      await expect(userMenu).toBeVisible();
    });
  });

  test.describe('Failed Login', () => {
    test('should show error with invalid email', async () => {
      // Act
      await loginPage.login(INVALID_USER.email, INVALID_USER.password);

      // Assert
      await loginPage.verifyErrorMessage('Invalid email or password');
      await expect(loginPage.page).toHaveURL(/.*login/);
    });

    test('should show error with invalid password', async () => {
      // Act
      await loginPage.login(VALID_USER.email, 'WrongPassword');

      // Assert
      await loginPage.verifyErrorMessage('Invalid email or password');
    });

    test('should show error with empty email', async () => {
      // Act
      await loginPage.passwordInput.fill(VALID_USER.password);
      await loginPage.loginButton.click();

      // Assert
      await loginPage.verifyEmptyFieldValidation();
    });

    test('should show error with empty password', async () => {
      // Act
      await loginPage.emailInput.fill(VALID_USER.email);
      await loginPage.loginButton.click();

      // Assert
      await loginPage.verifyEmptyFieldValidation();
    });

    test('should show error with both fields empty', async () => {
      // Act
      await loginPage.loginButton.click();

      // Assert
      await loginPage.verifyEmptyFieldValidation();
    });

    test('should show error with invalid email format', async () => {
      // Act
      await loginPage.verifyEmailFormatValidation('invalid-email');
    });

    test('should disable login button during submission', async ({ page }) => {
      // Act
      await loginPage.login(VALID_USER.email, VALID_USER.password);

      // Assert - Button should be disabled immediately
      await expect(loginPage.loginButton).toBeDisabled();
      
      // Wait for login to complete
      await page.waitForURL(/.*dashboard/, { timeout: 10000 });
    });

    test('should show loading spinner during login', async () => {
      // Act
      await loginPage.login(VALID_USER.email, VALID_USER.password);

      // Assert
      await expect(loginPage.loadingSpinner).toBeVisible();
      await loginPage.waitForLoading();
    });

    test('should prevent SQL injection attempts', async () => {
      // Arrange
      const sqlInjectionAttempts = [
        "' OR '1'='1",
        "admin'--",
        "' OR 1=1--",
        "admin' OR '1'='1'/*",
      ];

      for (const attempt of sqlInjectionAttempts) {
        // Act
        await loginPage.clearInputs();
        await loginPage.login(attempt, attempt);

        // Assert - Should not login
        await expect(loginPage.page).toHaveURL(/.*login/);
        await loginPage.verifyErrorMessage('Invalid email or password');
      }
    });

    test('should prevent XSS attempts in login form', async ({ page }) => {
      // Arrange
      const xssAttempt = '<script>alert("XSS")</script>';

      // Act
      await loginPage.login(xssAttempt, xssAttempt);

      // Assert - Should not execute script
      page.on('dialog', async dialog => {
        throw new Error('XSS vulnerability detected: Alert dialog appeared');
      });

      await expect(loginPage.page).toHaveURL(/.*login/);
    });
  });

  test.describe('Password Visibility Toggle', () => {
    test('should toggle password visibility', async () => {
      // Arrange
      await loginPage.passwordInput.fill('password123');

      // Act - Show password
      await loginPage.togglePasswordVisibility();

      // Assert
      await loginPage.verifyPasswordVisible();

      // Act - Hide password
      await loginPage.togglePasswordVisibility();

      // Assert
      await loginPage.verifyPasswordHidden();
    });
  });

  test.describe('Forgot Password', () => {
    test('should navigate to forgot password page', async ({ page }) => {
      // Act
      await loginPage.clickForgotPassword();

      // Assert
      await expect(page).toHaveURL(/.*forgot-password|reset-password/);
    });
  });

  test.describe('Signup Link', () => {
    test('should navigate to signup page', async ({ page }) => {
      // Act
      await loginPage.clickSignup();

      // Assert
      await expect(page).toHaveURL(/.*signup|register/);
    });
  });

  test.describe('Social Login', () => {
    test.skip('should login with Google', async ({ page, context }) => {
      // This test requires OAuth mock or actual Google credentials
      // Skip in automated tests, enable for manual testing

      // Act
      await loginPage.loginWithGoogle();

      // Assert
      // Verify OAuth flow and successful login
    });

    test.skip('should login with Facebook', async ({ page, context }) => {
      // This test requires OAuth mock or actual Facebook credentials
      // Skip in automated tests

      // Act
      await loginPage.loginWithFacebook();

      // Assert
      // Verify OAuth flow and successful login
    });
  });

  test.describe('Two-Factor Authentication', () => {
    test.skip('should require 2FA code for enabled accounts', async ({ page }) => {
      // Arrange - User with 2FA enabled
      const user2FA = {
        email: '2fa@example.com',
        password: 'SecurePassword123!',
        code: '123456',
      };

      // Act - Login
      await loginPage.login(user2FA.email, user2FA.password);

      // Assert - Should show 2FA input
      await expect(loginPage.twoFactorInput).toBeVisible();

      // Act - Submit 2FA code
      await loginPage.submit2FACode(user2FA.code);

      // Assert - Should login successfully
      await loginPage.verifySuccessfulLogin();
    });

    test.skip('should show error with invalid 2FA code', async () => {
      // Arrange
      const user2FA = {
        email: '2fa@example.com',
        password: 'SecurePassword123!',
        code: '000000', // Invalid code
      };

      // Act
      await loginPage.login(user2FA.email, user2FA.password);
      await loginPage.submit2FACode(user2FA.code);

      // Assert
      await loginPage.verifyErrorMessage('Invalid verification code');
    });
  });

  test.describe('Session Management', () => {
    test('should logout successfully', async ({ page }) => {
      // Arrange - Login first
      await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);

      // Act - Logout
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out"), [data-testid="logout"]');
      await logoutButton.click();

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/, { timeout: 10000 });
      await expect(page).toHaveURL(/.*login/);
    });

    test('should clear session data on logout', async ({ page, context }) => {
      // Arrange - Login
      await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);

      // Get cookies before logout
      const cookiesBefore = await context.cookies();
      expect(cookiesBefore.length).toBeGreaterThan(0);

      // Act - Logout
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Assert - Session cookies should be cleared
      const cookiesAfter = await context.cookies();
      const sessionCookie = cookiesAfter.find(c => c.name.includes('session') || c.name.includes('token'));
      expect(sessionCookie).toBeUndefined();
    });

    test('should redirect to login when accessing protected page after logout', async ({ page }) => {
      // Arrange - Login and logout
      await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Act - Try to access protected page
      await page.goto('/dashboard');

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/);
      await expect(page).toHaveURL(/.*login/);
    });
  });

  test.describe('Accessibility', () => {
    test('should be keyboard navigable', async ({ page }) => {
      // Act - Navigate using Tab key
      await page.keyboard.press('Tab'); // Email field
      await expect(loginPage.emailInput).toBeFocused();

      await page.keyboard.press('Tab'); // Password field
      await expect(loginPage.passwordInput).toBeFocused();

      await page.keyboard.press('Tab'); // Login button
      await expect(loginPage.loginButton).toBeFocused();
    });

    test('should support Enter key to submit form', async ({ page }) => {
      // Arrange
      await loginPage.emailInput.fill(VALID_USER.email);
      await loginPage.passwordInput.fill(VALID_USER.password);

      // Act - Press Enter
      await page.keyboard.press('Enter');

      // Assert - Should submit form
      await page.waitForURL(/.*dashboard/, { timeout: 10000 });
      await expect(page).toHaveURL(/.*dashboard/);
    });

    test('should have proper ARIA labels', async () => {
      // Assert
      await expect(loginPage.emailInput).toHaveAttribute('aria-label', /.+/);
      await expect(loginPage.passwordInput).toHaveAttribute('aria-label', /.+/);
      await expect(loginPage.loginButton).toHaveAttribute('aria-label', /.+/);
    });
  });

  test.describe('Performance', () => {
    test('should login within acceptable time', async ({ page }) => {
      // Arrange
      const startTime = Date.now();

      // Act
      await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);

      // Assert - Should complete within 3 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(3000);
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should display correctly on mobile', async ({ page }) => {
      // Arrange - Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Act
      await loginPage.goto();

      // Assert - All elements should be visible
      await expect(loginPage.emailInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.loginButton).toBeVisible();
    });
  });
});
