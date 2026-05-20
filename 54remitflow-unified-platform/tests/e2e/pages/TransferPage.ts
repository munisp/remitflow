/**
 * Transfer Page Object Model
 * 
 * Encapsulates all interactions with money transfer pages
 */

import { Page, Locator, expect } from '@playwright/test';

export interface TransferData {
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  recipientCountry?: string;
  amount: number;
  currency: string;
  narration: string;
  transferType: 'domestic' | 'international';
  swiftCode?: string;
  scheduledDate?: string;
  recurring?: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
}

export class TransferPage {
  readonly page: Page;
  
  // Navigation locators
  readonly transferLink: Locator;
  readonly transferHistoryLink: Locator;
  readonly walletLink: Locator;
  
  // Transfer type selection
  readonly domesticTransferTab: Locator;
  readonly internationalTransferTab: Locator;
  
  // Form inputs
  readonly recipientNameInput: Locator;
  readonly recipientAccountInput: Locator;
  readonly recipientBankSelect: Locator;
  readonly recipientCountrySelect: Locator;
  readonly amountInput: Locator;
  readonly currencySelect: Locator;
  readonly narrationInput: Locator;
  readonly swiftCodeInput: Locator;
  readonly scheduledDateInput: Locator;
  readonly recurringCheckbox: Locator;
  readonly frequencySelect: Locator;
  
  // Fee and calculation displays
  readonly transferFeeDisplay: Locator;
  readonly totalAmountDisplay: Locator;
  readonly exchangeRateDisplay: Locator;
  readonly recipientAmountDisplay: Locator;
  readonly deliveryTimeDisplay: Locator;
  readonly walletBalanceDisplay: Locator;
  
  // Action buttons
  readonly submitButton: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly editButton: Locator;
  readonly retryButton: Locator;
  
  // Review and confirmation
  readonly reviewSection: Locator;
  readonly pinConfirmationModal: Locator;
  readonly pinInput: Locator;
  
  // Receipt
  readonly receiptModal: Locator;
  readonly downloadReceiptButton: Locator;
  readonly transactionIdDisplay: Locator;
  
  // Transaction history
  readonly transactionList: Locator;
  readonly transactionItem: Locator;
  
  // Status and feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly validationError: Locator;
  readonly loadingSpinner: Locator;
  readonly emailConfirmationMessage: Locator;
  
  // Additional sections
  readonly documentUploadSection: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.transferLink = page.locator('a:has-text("Transfer"), a:has-text("Send Money"), [data-testid="transfer-link"]');
    this.transferHistoryLink = page.locator('a:has-text("History"), a:has-text("Transactions"), [data-testid="history-link"]');
    this.walletLink = page.locator('a:has-text("Wallet"), [data-testid="wallet-link"]');
    
    // Transfer type
    this.domesticTransferTab = page.locator('button:has-text("Domestic"), [data-testid="domestic-tab"]');
    this.internationalTransferTab = page.locator('button:has-text("International"), [data-testid="international-tab"]');
    
    // Form inputs
    this.recipientNameInput = page.locator('input[name="recipientName"], #recipientName');
    this.recipientAccountInput = page.locator('input[name="recipientAccount"], input[name="accountNumber"], #recipientAccount');
    this.recipientBankSelect = page.locator('select[name="recipientBank"], select[name="bank"], #recipientBank');
    this.recipientCountrySelect = page.locator('select[name="recipientCountry"], #recipientCountry');
    this.amountInput = page.locator('input[name="amount"], #amount');
    this.currencySelect = page.locator('select[name="currency"], #currency');
    this.narrationInput = page.locator('input[name="narration"], textarea[name="narration"], #narration');
    this.swiftCodeInput = page.locator('input[name="swiftCode"], #swiftCode');
    this.scheduledDateInput = page.locator('input[name="scheduledDate"], input[type="date"], #scheduledDate');
    this.recurringCheckbox = page.locator('input[name="recurring"], input[type="checkbox"]#recurring');
    this.frequencySelect = page.locator('select[name="frequency"], #frequency');
    
    // Fee and calculations
    this.transferFeeDisplay = page.locator('[data-testid="transfer-fee"], .transfer-fee, .fee-amount');
    this.totalAmountDisplay = page.locator('[data-testid="total-amount"], .total-amount');
    this.exchangeRateDisplay = page.locator('[data-testid="exchange-rate"], .exchange-rate');
    this.recipientAmountDisplay = page.locator('[data-testid="recipient-amount"], .recipient-amount');
    this.deliveryTimeDisplay = page.locator('[data-testid="delivery-time"], .delivery-time');
    this.walletBalanceDisplay = page.locator('[data-testid="wallet-balance"], .wallet-balance, .balance');
    
    // Action buttons
    this.submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Continue")');
    this.confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Confirm Transfer")');
    this.cancelButton = page.locator('button:has-text("Cancel")');
    this.editButton = page.locator('button:has-text("Edit"), button:has-text("Back")');
    this.retryButton = page.locator('button:has-text("Retry"), button:has-text("Try Again")');
    
    // Review and confirmation
    this.reviewSection = page.locator('[data-testid="review-section"], .review-section, .transfer-summary');
    this.pinConfirmationModal = page.locator('[data-testid="pin-modal"], .pin-modal, .confirmation-modal');
    this.pinInput = page.locator('input[name="pin"], input[type="password"]#pin');
    
    // Receipt
    this.receiptModal = page.locator('[data-testid="receipt-modal"], .receipt-modal');
    this.downloadReceiptButton = page.locator('button:has-text("Download"), button:has-text("Download Receipt")');
    this.transactionIdDisplay = page.locator('[data-testid="transaction-id"], .transaction-id');
    
    // Transaction history
    this.transactionList = page.locator('[data-testid="transaction-list"], .transaction-list, .history-list');
    this.transactionItem = page.locator('[data-testid="transaction-item"], .transaction-item');
    
    // Status and feedback
    this.successMessage = page.locator('.success-message, .alert-success, [role="alert"].success');
    this.errorMessage = page.locator('.error-message, .alert-error, [role="alert"].error');
    this.validationError = page.locator('.field-error, .validation-error');
    this.loadingSpinner = page.locator('.spinner, .loading, [role="progressbar"]');
    this.emailConfirmationMessage = page.locator('[data-testid="email-confirmation"], .email-confirmation');
    
    // Additional sections
    this.documentUploadSection = page.locator('[data-testid="document-upload"], .document-upload-section');
  }

  /**
   * Navigate to transfer page
   */
  async gotoTransfer() {
    await this.page.goto('/transfer');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to transaction history
   */
  async gotoTransactionHistory() {
    await this.page.goto('/transactions');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to wallet page
   */
  async gotoWallet() {
    await this.page.goto('/wallet');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Select transfer type (domestic or international)
   */
  async selectTransferType(type: 'domestic' | 'international') {
    if (type === 'domestic') {
      await this.domesticTransferTab.click();
    } else {
      await this.internationalTransferTab.click();
    }
  }

  /**
   * Fill transfer form
   */
  async fillTransferForm(data: TransferData) {
    await this.recipientNameInput.fill(data.recipientName);
    await this.recipientAccountInput.fill(data.recipientAccount);
    await this.recipientBankSelect.selectOption(data.recipientBank);
    
    if (data.recipientCountry) {
      await this.recipientCountrySelect.selectOption(data.recipientCountry);
    }
    
    await this.amountInput.fill(data.amount.toString());
    await this.currencySelect.selectOption(data.currency);
    await this.narrationInput.fill(data.narration);
    
    if (data.swiftCode) {
      await this.swiftCodeInput.fill(data.swiftCode);
    }
    
    if (data.scheduledDate) {
      await this.scheduledDateInput.fill(data.scheduledDate);
    }
    
    if (data.recurring) {
      await this.recurringCheckbox.check();
      if (data.frequency) {
        await this.frequencySelect.selectOption(data.frequency);
      }
    }
  }

  /**
   * Submit transfer
   */
  async submitTransfer() {
    await this.submitButton.click();
  }

  /**
   * Confirm transfer
   */
  async confirmTransfer() {
    await this.confirmButton.click();
  }

  /**
   * Cancel transfer
   */
  async cancelTransfer() {
    await this.cancelButton.click();
  }

  /**
   * Edit transfer
   */
  async editTransfer() {
    await this.editButton.click();
  }

  /**
   * Get transfer fee
   */
  async getTransferFee(): Promise<number> {
    const text = await this.transferFeeDisplay.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Get total amount
   */
  async getTotalAmount(): Promise<number> {
    const text = await this.totalAmountDisplay.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Get exchange rate
   */
  async getExchangeRate(): Promise<number> {
    const text = await this.exchangeRateDisplay.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Get recipient amount
   */
  async getRecipientAmount(): Promise<number> {
    const text = await this.recipientAmountDisplay.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(): Promise<number> {
    const text = await this.walletBalanceDisplay.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Get transaction ID
   */
  async getTransactionId(): Promise<string> {
    const text = await this.transactionIdDisplay.textContent();
    return text?.trim() || '';
  }

  /**
   * Verify success message
   */
  async verifySuccess(expectedMessage?: string) {
    await expect(this.successMessage).toBeVisible();
    if (expectedMessage) {
      await expect(this.successMessage).toContainText(expectedMessage);
    }
  }

  /**
   * Verify error message
   */
  async verifyError(expectedMessage: string) {
    await expect(this.errorMessage).toBeVisible();
    await expect(this.errorMessage).toContainText(expectedMessage);
  }

  /**
   * Verify validation error
   */
  async verifyValidationError(expectedMessage: string) {
    await expect(this.validationError).toBeVisible();
    await expect(this.validationError).toContainText(expectedMessage);
  }

  /**
   * Wait for loading
   */
  async waitForLoading() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Wait for success
   */
  async waitForSuccess() {
    await this.successMessage.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }
}
