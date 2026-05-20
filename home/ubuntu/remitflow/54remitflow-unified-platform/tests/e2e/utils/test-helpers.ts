/**
 * Test Helper Utilities
 * 
 * Provides common helper functions for E2E tests
 */

import { Page } from '@playwright/test';

/**
 * Generate random email
 */
export function generateRandomEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${random}@example.com`;
}

/**
 * Generate random phone number (Nigerian format)
 */
export function generateRandomPhone(): string {
  const number = Math.floor(Math.random() * 100000000).toString().padStart(9, '0');
  return `+234801${number}`;
}

/**
 * Generate random BVN
 */
export function generateRandomBVN(): string {
  return Math.floor(Math.random() * 100000000000).toString().padStart(11, '0');
}

/**
 * Generate random account number
 */
export function generateRandomAccountNumber(): string {
  return Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
}

/**
 * Wait for API response
 */
export async function waitForAPIResponse(page: Page, url: string, timeout: number = 10000): Promise<any> {
  const response = await page.waitForResponse(
    response => response.url().includes(url) && response.status() === 200,
    { timeout }
  );
  return response.json();
}

/**
 * Mock API response
 */
export async function mockAPIResponse(page: Page, url: string, data: any, status: number = 200) {
  await page.route(`**/${url}`, route => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}

/**
 * Take screenshot with timestamp
 */
export async function takeTimestampedScreenshot(page: Page, name: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: `screenshots/${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Wait for element and click
 */
export async function waitAndClick(page: Page, selector: string, timeout: number = 10000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await page.click(selector);
}

/**
 * Fill form field with validation
 */
export async function fillField(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { state: 'visible' });
  await page.fill(selector, value);
  
  // Verify value was filled
  const actualValue = await page.inputValue(selector);
  if (actualValue !== value) {
    throw new Error(`Failed to fill field ${selector}. Expected: ${value}, Got: ${actualValue}`);
  }
}

/**
 * Get text content safely
 */
export async function getTextContent(page: Page, selector: string): Promise<string> {
  await page.waitForSelector(selector, { state: 'visible' });
  const text = await page.textContent(selector);
  return text?.trim() || '';
}

/**
 * Check if element exists
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retry action with exponential backoff
 */
export async function retryWithBackoff<T>(
  action: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await action();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Format currency (Nigerian Naira)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amount);
}

/**
 * Parse currency string to number
 */
export function parseCurrency(currencyString: string): number {
  return parseFloat(currencyString.replace(/[^0-9.-]+/g, ''));
}

/**
 * Generate random transaction data
 */
export function generateRandomTransaction() {
  return {
    recipientName: `Test User ${Math.random().toString(36).substring(7)}`,
    recipientEmail: generateRandomEmail(),
    recipientPhone: generateRandomPhone(),
    recipientBankAccount: generateRandomAccountNumber(),
    recipientBankCode: '058',
    amount: Math.floor(Math.random() * 100000) + 1000,
    currency: 'NGN',
    purpose: 'family_support',
    notes: 'Test transaction',
  };
}
