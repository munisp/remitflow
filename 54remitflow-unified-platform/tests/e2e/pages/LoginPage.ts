/**
 * Login Page Object Model
 * 
 * Encapsulates all interactions with the login page
 * Follows Page Object Model (POM) pattern for maintainability
 */

import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  
  // Locators
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signupLink: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly showPasswordButton: Locator;
  readonly googleLoginButton: Locator;
  readonly facebookLoginButton: Locator;
  readonly twoFactorInput: Locator;
  readonly twoFactorSubmitButton: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Initialize locators
    this.emailInput = page.locator('input[name="email"], input[type="email"], #email');
    this.passwordInput = page.locator('input[name="password"], input[type="password"], #password');
    this.loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    this.forgotPasswordLink = page.locator('a:has-text("Forgot Password"), a:has-text("Reset Password")');
    this.signupLink = page.locator('a:has-text("Sign Up"), a:has-text("Register"), a:has-text("Create Account")');
    this.errorMessage = page.locator('.error-message, .alert-error, [role="alert"]');
    this.successMessage = page.locator('.success-message, .alert-success');
    this.rememberMeCheckbox = page.locator('input[type="checkbox"][name="remember"]');
    this.showPasswordButton = page.locator('button:has-text("Show"), button[aria-label="Show password"]');
    this.googleLoginButton = page.locator('button:has-text("Google"), button:has-text("Continue with Google")');
    this.facebookLoginButton = page.locator('button:has-text("Facebook"), button:has-text("Continue with Facebook")');
    this.twoFactorInput = page.locator('input[name="otp"], input[name="code"], input[placeholder*="code"]');
    this.twoFactorSubmitButton = page.locator('button:has-text("Verify"), button:has-text("Submit Code")');
    this.loadingSpinner = page.locator('.spinner, .loading, [role="progressbar"]');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await this.page.goto('/login');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Perform login with email and password
   * 
   * @param email - User email
   * @param password - User password
   * @param rememberMe - Whether to check "Remember Me"
   */
  async login(email: string, password: string, rememberMe: boolean = false) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    
    if (rememberMe) {
      await this.rememberMeCheckbox.check();
    }
    
    await this.loginButton.click();
  }

  /**
   * Perform login and wait for navigation
   */
  async loginAndWait(email: string, password: string, expectedUrl: string = '/dashboard') {
    await this.login(email, password);
    await this.page.waitForURL(expectedUrl, { timeout: 10000 });
  }

  /**
   * Verify user is on login page
   */
  async verifyOnLoginPage() {
    await expect(this.page).toHaveURL(/.*login/);
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.loginButton).toBeVisible();
  }

  /**
   * Verify login error message
   */
  async verifyErrorMessage(expectedMessage: string) {
    await expect(this.errorMessage).toBeVisible();
    await expect(this.errorMessage).toContainText(expectedMessage);
  }

  /**
   * Verify successful login (redirected to dashboard)
   */
  async verifySuccessfulLogin() {
    await this.page.waitForURL(/.*dashboard/, { timeout: 10000 });
    await expect(this.page).toHaveURL(/.*dashboard/);
  }

  /**
   * Click forgot password link
   */
  async clickForgotPassword() {
    await this.forgotPasswordLink.click();
    await this.page.waitForURL(/.*forgot-password|reset-password/);
  }

  /**
   * Click signup link
   */
  async clickSignup() {
    await this.signupLink.click();
    await this.page.waitForURL(/.*signup|register/);
  }

  /**
   * Toggle password visibility
   */
  async togglePasswordVisibility() {
    await this.showPasswordButton.click();
  }

  /**
   * Verify password is visible
   */
  async verifyPasswordVisible() {
    await expect(this.passwordInput).toHaveAttribute('type', 'text');
  }

  /**
   * Verify password is hidden
   */
  async verifyPasswordHidden() {
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
  }

  /**
   * Login with Google (OAuth)
   */
  async loginWithGoogle() {
    await this.googleLoginButton.click();
    // Handle OAuth popup/redirect
    // Implementation depends on OAuth flow
  }

  /**
   * Login with Facebook (OAuth)
   */
  async loginWithFacebook() {
    await this.facebookLoginButton.click();
    // Handle OAuth popup/redirect
  }

  /**
   * Submit 2FA code
   */
  async submit2FACode(code: string) {
    await this.twoFactorInput.fill(code);
    await this.twoFactorSubmitButton.click();
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoading() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Verify validation errors for empty fields
   */
  async verifyEmptyFieldValidation() {
    await this.loginButton.click();
    
    // Check for HTML5 validation or custom error messages
    const emailValidation = await this.emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(emailValidation).toBeTruthy();
  }

  /**
   * Verify email format validation
   */
  async verifyEmailFormatValidation(invalidEmail: string) {
    await this.emailInput.fill(invalidEmail);
    await this.passwordInput.fill('password123');
    await this.loginButton.click();
    
    // Should show error or prevent submission
    const emailValidation = await this.emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(emailValidation).toContain('email');
  }

  /**
   * Clear all input fields
   */
  async clearInputs() {
    await this.emailInput.clear();
    await this.passwordInput.clear();
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }
}
