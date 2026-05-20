/**
 * Transaction Page Object Model
 * 
 * Encapsulates all interactions with transaction submission and management pages
 */

import { Page, Locator, expect } from '@playwright/test';

export interface TransactionData {
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientBankAccount?: string;
  recipientBankCode?: string;
  amount: number;
  currency?: string;
  purpose?: string;
  notes?: string;
  paymentMethod?: 'card' | 'bank_transfer' | 'wallet' | 'enaira';
}

export class TransactionPage {
  readonly page: Page;
  
  // Navigation locators
  readonly newTransactionButton: Locator;
  readonly transactionHistoryLink: Locator;
  
  // Form locators
  readonly recipientNameInput: Locator;
  readonly recipientEmailInput: Locator;
  readonly recipientPhoneInput: Locator;
  readonly recipientBankAccountInput: Locator;
  readonly recipientBankSelect: Locator;
  readonly amountInput: Locator;
  readonly currencySelect: Locator;
  readonly purposeSelect: Locator;
  readonly notesTextarea: Locator;
  readonly paymentMethodSelect: Locator;
  
  // Action buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly confirmButton: Locator;
  readonly backButton: Locator;
  
  // Status and feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly validationError: Locator;
  readonly loadingSpinner: Locator;
  readonly transactionId: Locator;
  readonly transactionStatus: Locator;
  
  // Transaction list
  readonly transactionTable: Locator;
  readonly transactionRows: Locator;
  readonly searchInput: Locator;
  readonly filterButton: Locator;
  readonly exportButton: Locator;
  
  // Confirmation modal
  readonly confirmationModal: Locator;
  readonly modalAmount: Locator;
  readonly modalRecipient: Locator;
  readonly modalFee: Locator;
  readonly modalTotal: Locator;
  
  // Receipt
  readonly receiptModal: Locator;
  readonly downloadReceiptButton: Locator;
  readonly shareReceiptButton: Locator;
  readonly printReceiptButton: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Initialize locators
    this.newTransactionButton = page.locator('button:has-text("New Transaction"), button:has-text("Send Money"), [data-testid="new-transaction"]');
    this.transactionHistoryLink = page.locator('a:has-text("Transaction History"), a:has-text("Transactions")');
    
    // Form fields
    this.recipientNameInput = page.locator('input[name="recipientName"], #recipientName');
    this.recipientEmailInput = page.locator('input[name="recipientEmail"], #recipientEmail');
    this.recipientPhoneInput = page.locator('input[name="recipientPhone"], #recipientPhone');
    this.recipientBankAccountInput = page.locator('input[name="accountNumber"], #accountNumber');
    this.recipientBankSelect = page.locator('select[name="bankCode"], #bankCode');
    this.amountInput = page.locator('input[name="amount"], #amount');
    this.currencySelect = page.locator('select[name="currency"], #currency');
    this.purposeSelect = page.locator('select[name="purpose"], #purpose');
    this.notesTextarea = page.locator('textarea[name="notes"], #notes');
    this.paymentMethodSelect = page.locator('select[name="paymentMethod"], #paymentMethod');
    
    // Buttons
    this.submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Send")');
    this.cancelButton = page.locator('button:has-text("Cancel")');
    this.confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Proceed")');
    this.backButton = page.locator('button:has-text("Back")');
    
    // Status
    this.successMessage = page.locator('.success-message, .alert-success, [role="alert"].success');
    this.errorMessage = page.locator('.error-message, .alert-error, [role="alert"].error');
    this.validationError = page.locator('.field-error, .validation-error');
    this.loadingSpinner = page.locator('.spinner, .loading, [role="progressbar"]');
    this.transactionId = page.locator('[data-testid="transaction-id"], .transaction-id');
    this.transactionStatus = page.locator('[data-testid="transaction-status"], .transaction-status');
    
    // Transaction list
    this.transactionTable = page.locator('table, [data-testid="transaction-table"]');
    this.transactionRows = page.locator('tbody tr, [data-testid="transaction-row"]');
    this.searchInput = page.locator('input[placeholder*="Search"], input[name="search"]');
    this.filterButton = page.locator('button:has-text("Filter")');
    this.exportButton = page.locator('button:has-text("Export"), button:has-text("Download")');
    
    // Confirmation modal
    this.confirmationModal = page.locator('[data-testid="confirmation-modal"], .confirmation-modal, [role="dialog"]');
    this.modalAmount = page.locator('[data-testid="modal-amount"]');
    this.modalRecipient = page.locator('[data-testid="modal-recipient"]');
    this.modalFee = page.locator('[data-testid="modal-fee"]');
    this.modalTotal = page.locator('[data-testid="modal-total"]');
    
    // Receipt
    this.receiptModal = page.locator('[data-testid="receipt-modal"], .receipt-modal');
    this.downloadReceiptButton = page.locator('button:has-text("Download Receipt")');
    this.shareReceiptButton = page.locator('button:has-text("Share")');
    this.printReceiptButton = page.locator('button:has-text("Print")');
  }

  /**
   * Navigate to new transaction page
   */
  async gotoNewTransaction() {
    await this.page.goto('/transactions/new');
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
   * Click new transaction button
   */
  async clickNewTransaction() {
    await this.newTransactionButton.click();
    await this.page.waitForURL(/.*transactions\/new/);
  }

  /**
   * Fill transaction form
   */
  async fillTransactionForm(data: TransactionData) {
    if (data.recipientName) {
      await this.recipientNameInput.fill(data.recipientName);
    }
    
    if (data.recipientEmail) {
      await this.recipientEmailInput.fill(data.recipientEmail);
    }
    
    if (data.recipientPhone) {
      await this.recipientPhoneInput.fill(data.recipientPhone);
    }
    
    if (data.recipientBankAccount) {
      await this.recipientBankAccountInput.fill(data.recipientBankAccount);
    }
    
    if (data.recipientBankCode) {
      await this.recipientBankSelect.selectOption(data.recipientBankCode);
    }
    
    await this.amountInput.fill(data.amount.toString());
    
    if (data.currency) {
      await this.currencySelect.selectOption(data.currency);
    }
    
    if (data.purpose) {
      await this.purposeSelect.selectOption(data.purpose);
    }
    
    if (data.notes) {
      await this.notesTextarea.fill(data.notes);
    }
    
    if (data.paymentMethod) {
      await this.paymentMethodSelect.selectOption(data.paymentMethod);
    }
  }

  /**
   * Submit transaction
   */
  async submitTransaction() {
    await this.submitButton.click();
  }

  /**
   * Confirm transaction in modal
   */
  async confirmTransaction() {
    await expect(this.confirmationModal).toBeVisible();
    await this.confirmButton.click();
  }

  /**
   * Complete full transaction flow
   */
  async createTransaction(data: TransactionData) {
    await this.fillTransactionForm(data);
    await this.submitTransaction();
    await this.confirmTransaction();
  }

  /**
   * Verify transaction success
   */
  async verifyTransactionSuccess() {
    await expect(this.successMessage).toBeVisible();
    await expect(this.transactionId).toBeVisible();
  }

  /**
   * Verify transaction error
   */
  async verifyTransactionError(expectedMessage: string) {
    await expect(this.errorMessage).toBeVisible();
    await expect(this.errorMessage).toContainText(expectedMessage);
  }

  /**
   * Get transaction ID from success page
   */
  async getTransactionId(): Promise<string> {
    const text = await this.transactionId.textContent();
    return text?.trim() || '';
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(): Promise<string> {
    const text = await this.transactionStatus.textContent();
    return text?.trim() || '';
  }

  /**
   * Verify confirmation modal details
   */
  async verifyConfirmationModal(expectedAmount: number, expectedRecipient: string) {
    await expect(this.confirmationModal).toBeVisible();
    await expect(this.modalAmount).toContainText(expectedAmount.toString());
    await expect(this.modalRecipient).toContainText(expectedRecipient);
  }

  /**
   * Cancel transaction
   */
  async cancelTransaction() {
    await this.cancelButton.click();
  }

  /**
   * Search transactions
   */
  async searchTransactions(query: string) {
    await this.searchInput.fill(query);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Get transaction count
   */
  async getTransactionCount(): Promise<number> {
    return await this.transactionRows.count();
  }

  /**
   * Verify transaction in list
   */
  async verifyTransactionInList(transactionId: string) {
    const row = this.page.locator(`tr:has-text("${transactionId}")`);
    await expect(row).toBeVisible();
  }

  /**
   * Download receipt
   */
  async downloadReceipt() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.downloadReceiptButton.click();
    const download = await downloadPromise;
    return download;
  }

  /**
   * Verify amount validation
   */
  async verifyAmountValidation(amount: string, expectedError: string) {
    await this.amountInput.fill(amount);
    await this.submitButton.click();
    await expect(this.validationError).toContainText(expectedError);
  }

  /**
   * Verify minimum amount
   */
  async verifyMinimumAmount(minAmount: number) {
    await this.amountInput.fill((minAmount - 1).toString());
    await this.submitButton.click();
    await expect(this.validationError).toContainText('minimum');
  }

  /**
   * Verify maximum amount
   */
  async verifyMaximumAmount(maxAmount: number) {
    await this.amountInput.fill((maxAmount + 1).toString());
    await this.submitButton.click();
    await expect(this.validationError).toContainText('maximum');
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoading() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }
}
