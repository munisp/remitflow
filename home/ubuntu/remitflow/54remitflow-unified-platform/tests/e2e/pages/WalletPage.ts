/**
 * Wallet Page Object Model
 * 
 * Encapsulates all interactions with wallet management pages
 */

import { Page, Locator, expect } from '@playwright/test';

export interface WalletData {
  walletName?: string;
  walletType?: 'personal' | 'business' | 'savings';
  currency?: string;
  initialBalance?: number;
}

export interface FundingData {
  amount: number;
  paymentMethod: 'card' | 'bank_transfer' | 'enaira';
  cardNumber?: string;
  cardExpiry?: string;
  cardCVV?: string;
  bankAccount?: string;
  bankCode?: string;
}

export interface WithdrawalData {
  amount: number;
  bankAccount: string;
  bankCode: string;
  accountName?: string;
  narration?: string;
}

export class WalletPage {
  readonly page: Page;
  
  // Navigation locators
  readonly walletDashboardLink: Locator;
  readonly createWalletButton: Locator;
  readonly fundWalletButton: Locator;
  readonly withdrawButton: Locator;
  readonly transactionHistoryLink: Locator;
  
  // Wallet display locators
  readonly walletBalance: Locator;
  readonly walletCurrency: Locator;
  readonly walletName: Locator;
  readonly walletType: Locator;
  readonly walletStatus: Locator;
  readonly walletList: Locator;
  readonly walletCard: Locator;
  
  // Create wallet form
  readonly walletNameInput: Locator;
  readonly walletTypeSelect: Locator;
  readonly currencySelect: Locator;
  readonly createWalletSubmitButton: Locator;
  
  // Fund wallet form
  readonly fundAmountInput: Locator;
  readonly paymentMethodSelect: Locator;
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCVVInput: Locator;
  readonly cardHolderNameInput: Locator;
  readonly fundSubmitButton: Locator;
  
  // Withdraw form
  readonly withdrawAmountInput: Locator;
  readonly withdrawBankAccountInput: Locator;
  readonly withdrawBankSelect: Locator;
  readonly withdrawAccountNameInput: Locator;
  readonly withdrawNarrationInput: Locator;
  readonly withdrawSubmitButton: Locator;
  
  // Transaction list
  readonly transactionTable: Locator;
  readonly transactionRows: Locator;
  readonly transactionSearchInput: Locator;
  readonly transactionFilterButton: Locator;
  readonly transactionExportButton: Locator;
  
  // Status and feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly validationError: Locator;
  readonly loadingSpinner: Locator;
  readonly confirmationModal: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  
  // Balance details
  readonly availableBalance: Locator;
  readonly pendingBalance: Locator;
  readonly totalBalance: Locator;
  readonly lastTransaction: Locator;
  
  // Wallet settings
  readonly settingsButton: Locator;
  readonly freezeWalletButton: Locator;
  readonly unfreezeWalletButton: Locator;
  readonly deleteWalletButton: Locator;
  readonly setDefaultWalletButton: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.walletDashboardLink = page.locator('a:has-text("Wallet"), a:has-text("My Wallet"), [data-testid="wallet-link"]');
    this.createWalletButton = page.locator('button:has-text("Create Wallet"), button:has-text("New Wallet"), [data-testid="create-wallet"]');
    this.fundWalletButton = page.locator('button:has-text("Fund Wallet"), button:has-text("Add Money"), [data-testid="fund-wallet"]');
    this.withdrawButton = page.locator('button:has-text("Withdraw"), button:has-text("Withdraw Funds"), [data-testid="withdraw"]');
    this.transactionHistoryLink = page.locator('a:has-text("Transaction History"), a:has-text("Transactions")');
    
    // Wallet display
    this.walletBalance = page.locator('[data-testid="wallet-balance"], .wallet-balance, .balance-amount');
    this.walletCurrency = page.locator('[data-testid="wallet-currency"], .wallet-currency');
    this.walletName = page.locator('[data-testid="wallet-name"], .wallet-name');
    this.walletType = page.locator('[data-testid="wallet-type"], .wallet-type');
    this.walletStatus = page.locator('[data-testid="wallet-status"], .wallet-status');
    this.walletList = page.locator('[data-testid="wallet-list"], .wallet-list');
    this.walletCard = page.locator('[data-testid="wallet-card"], .wallet-card');
    
    // Create wallet form
    this.walletNameInput = page.locator('input[name="walletName"], #walletName');
    this.walletTypeSelect = page.locator('select[name="walletType"], #walletType');
    this.currencySelect = page.locator('select[name="currency"], #currency');
    this.createWalletSubmitButton = page.locator('button[type="submit"]:has-text("Create"), button:has-text("Create Wallet")');
    
    // Fund wallet form
    this.fundAmountInput = page.locator('input[name="fundAmount"], input[name="amount"], #fundAmount');
    this.paymentMethodSelect = page.locator('select[name="paymentMethod"], #paymentMethod');
    this.cardNumberInput = page.locator('input[name="cardNumber"], #cardNumber');
    this.cardExpiryInput = page.locator('input[name="cardExpiry"], #cardExpiry');
    this.cardCVVInput = page.locator('input[name="cvv"], #cvv');
    this.cardHolderNameInput = page.locator('input[name="cardHolder"], #cardHolder');
    this.fundSubmitButton = page.locator('button[type="submit"]:has-text("Fund"), button:has-text("Add Money")');
    
    // Withdraw form
    this.withdrawAmountInput = page.locator('input[name="withdrawAmount"], input[name="amount"], #withdrawAmount');
    this.withdrawBankAccountInput = page.locator('input[name="accountNumber"], #accountNumber');
    this.withdrawBankSelect = page.locator('select[name="bankCode"], #bankCode');
    this.withdrawAccountNameInput = page.locator('input[name="accountName"], #accountName');
    this.withdrawNarrationInput = page.locator('input[name="narration"], textarea[name="narration"], #narration');
    this.withdrawSubmitButton = page.locator('button[type="submit"]:has-text("Withdraw"), button:has-text("Withdraw Funds")');
    
    // Transaction list
    this.transactionTable = page.locator('table, [data-testid="transaction-table"]');
    this.transactionRows = page.locator('tbody tr, [data-testid="transaction-row"]');
    this.transactionSearchInput = page.locator('input[placeholder*="Search"], input[name="search"]');
    this.transactionFilterButton = page.locator('button:has-text("Filter")');
    this.transactionExportButton = page.locator('button:has-text("Export"), button:has-text("Download")');
    
    // Status and feedback
    this.successMessage = page.locator('.success-message, .alert-success, [role="alert"].success');
    this.errorMessage = page.locator('.error-message, .alert-error, [role="alert"].error');
    this.validationError = page.locator('.field-error, .validation-error');
    this.loadingSpinner = page.locator('.spinner, .loading, [role="progressbar"]');
    this.confirmationModal = page.locator('[data-testid="confirmation-modal"], .confirmation-modal, [role="dialog"]');
    this.confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Proceed")');
    this.cancelButton = page.locator('button:has-text("Cancel")');
    
    // Balance details
    this.availableBalance = page.locator('[data-testid="available-balance"], .available-balance');
    this.pendingBalance = page.locator('[data-testid="pending-balance"], .pending-balance');
    this.totalBalance = page.locator('[data-testid="total-balance"], .total-balance');
    this.lastTransaction = page.locator('[data-testid="last-transaction"], .last-transaction');
    
    // Wallet settings
    this.settingsButton = page.locator('button:has-text("Settings"), [data-testid="wallet-settings"]');
    this.freezeWalletButton = page.locator('button:has-text("Freeze Wallet")');
    this.unfreezeWalletButton = page.locator('button:has-text("Unfreeze Wallet")');
    this.deleteWalletButton = page.locator('button:has-text("Delete Wallet")');
    this.setDefaultWalletButton = page.locator('button:has-text("Set as Default")');
  }

  /**
   * Navigate to wallet dashboard
   */
  async gotoWalletDashboard() {
    await this.page.goto('/wallet');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to create wallet page
   */
  async gotoCreateWallet() {
    await this.page.goto('/wallet/create');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to fund wallet page
   */
  async gotoFundWallet() {
    await this.page.goto('/wallet/fund');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to withdraw page
   */
  async gotoWithdraw() {
    await this.page.goto('/wallet/withdraw');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Create new wallet
   */
  async createWallet(data: WalletData) {
    if (data.walletName) {
      await this.walletNameInput.fill(data.walletName);
    }
    
    if (data.walletType) {
      await this.walletTypeSelect.selectOption(data.walletType);
    }
    
    if (data.currency) {
      await this.currencySelect.selectOption(data.currency);
    }
    
    await this.createWalletSubmitButton.click();
  }

  /**
   * Fund wallet with card
   */
  async fundWalletWithCard(data: FundingData) {
    await this.fundAmountInput.fill(data.amount.toString());
    await this.paymentMethodSelect.selectOption('card');
    
    if (data.cardNumber) {
      await this.cardNumberInput.fill(data.cardNumber);
    }
    
    if (data.cardExpiry) {
      await this.cardExpiryInput.fill(data.cardExpiry);
    }
    
    if (data.cardCVV) {
      await this.cardCVVInput.fill(data.cardCVV);
    }
    
    await this.fundSubmitButton.click();
  }

  /**
   * Fund wallet with bank transfer
   */
  async fundWalletWithBank(data: FundingData) {
    await this.fundAmountInput.fill(data.amount.toString());
    await this.paymentMethodSelect.selectOption('bank_transfer');
    
    if (data.bankAccount) {
      await this.withdrawBankAccountInput.fill(data.bankAccount);
    }
    
    if (data.bankCode) {
      await this.withdrawBankSelect.selectOption(data.bankCode);
    }
    
    await this.fundSubmitButton.click();
  }

  /**
   * Withdraw from wallet
   */
  async withdrawFromWallet(data: WithdrawalData) {
    await this.withdrawAmountInput.fill(data.amount.toString());
    await this.withdrawBankAccountInput.fill(data.bankAccount);
    await this.withdrawBankSelect.selectOption(data.bankCode);
    
    if (data.accountName) {
      await this.withdrawAccountNameInput.fill(data.accountName);
    }
    
    if (data.narration) {
      await this.withdrawNarrationInput.fill(data.narration);
    }
    
    await this.withdrawSubmitButton.click();
  }

  /**
   * Confirm action in modal
   */
  async confirmAction() {
    await expect(this.confirmationModal).toBeVisible();
    await this.confirmButton.click();
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(): Promise<number> {
    const text = await this.walletBalance.textContent();
    const balance = parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
    return balance;
  }

  /**
   * Get available balance
   */
  async getAvailableBalance(): Promise<number> {
    const text = await this.availableBalance.textContent();
    return parseFloat(text?.replace(/[^0-9.-]+/g, '') || '0');
  }

  /**
   * Verify wallet balance
   */
  async verifyWalletBalance(expectedBalance: number) {
    const balance = await this.getWalletBalance();
    expect(balance).toBe(expectedBalance);
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
   * Get wallet count
   */
  async getWalletCount(): Promise<number> {
    return await this.walletCard.count();
  }

  /**
   * Select wallet by name
   */
  async selectWallet(walletName: string) {
    const wallet = this.page.locator(`[data-testid="wallet-card"]:has-text("${walletName}")`);
    await wallet.click();
  }

  /**
   * Freeze wallet
   */
  async freezeWallet() {
    await this.settingsButton.click();
    await this.freezeWalletButton.click();
    await this.confirmAction();
  }

  /**
   * Unfreeze wallet
   */
  async unfreezeWallet() {
    await this.settingsButton.click();
    await this.unfreezeWalletButton.click();
    await this.confirmAction();
  }

  /**
   * Delete wallet
   */
  async deleteWallet() {
    await this.settingsButton.click();
    await this.deleteWalletButton.click();
    await this.confirmAction();
  }

  /**
   * Set wallet as default
   */
  async setAsDefault() {
    await this.settingsButton.click();
    await this.setDefaultWalletButton.click();
  }

  /**
   * Search transactions
   */
  async searchTransactions(query: string) {
    await this.transactionSearchInput.fill(query);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Get transaction count
   */
  async getTransactionCount(): Promise<number> {
    return await this.transactionRows.count();
  }

  /**
   * Export transactions
   */
  async exportTransactions() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.transactionExportButton.click();
    return await downloadPromise;
  }

  /**
   * Wait for loading
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
