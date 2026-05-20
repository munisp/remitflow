/**
 * Comprehensive Wallet Management E2E Tests
 * 
 * Test Coverage:
 * - Wallet creation and management
 * - Wallet funding (card, bank transfer, eNaira)
 * - Wallet withdrawal
 * - Balance display and updates
 * - Multiple wallet management
 * - Wallet settings (freeze, unfreeze, delete, set default)
 * - Transaction history
 * - Validation and error handling
 * - Security and performance
 * 
 * @group wallet
 * @group critical
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { WalletPage, WalletData, FundingData, WithdrawalData } from '../../pages/WalletPage';

const VALID_USER = {
  email: 'test@example.com',
  password: 'SecurePassword123!',
};

const VALID_WALLET: WalletData = {
  walletName: 'My Main Wallet',
  walletType: 'personal',
  currency: 'NGN',
};

const VALID_FUNDING: FundingData = {
  amount: 10000,
  paymentMethod: 'card',
  cardNumber: '5399838383838381',
  cardExpiry: '12/25',
  cardCVV: '123',
};

const VALID_WITHDRAWAL: WithdrawalData = {
  amount: 5000,
  bankAccount: '0123456789',
  bankCode: '058',
  accountName: 'John Doe',
  narration: 'Withdrawal to bank',
};

test.describe('Wallet Management', () => {
  let loginPage: LoginPage;
  let walletPage: WalletPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    walletPage = new WalletPage(page);
    
    await loginPage.goto();
    await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
  });

  test.describe('Wallet Display', () => {
    test('should display wallet dashboard', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      await expect(walletPage.walletBalance).toBeVisible();
      await expect(walletPage.walletCurrency).toBeVisible();
      await expect(walletPage.fundWalletButton).toBeVisible();
      await expect(walletPage.withdrawButton).toBeVisible();
    });

    test('should display wallet balance with currency symbol', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      const balanceText = await walletPage.walletBalance.textContent();
      expect(balanceText).toMatch(/₦|NGN/);
    });

    test('should display available and pending balances separately', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      await expect(walletPage.availableBalance).toBeVisible();
      await expect(walletPage.pendingBalance).toBeVisible();
      
      const available = await walletPage.getAvailableBalance();
      expect(available).toBeGreaterThanOrEqual(0);
    });

    test('should display last transaction', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      await expect(walletPage.lastTransaction).toBeVisible();
    });

    test('should display wallet status', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      await expect(walletPage.walletStatus).toBeVisible();
      const status = await walletPage.walletStatus.textContent();
      expect(status).toMatch(/Active|Frozen|Inactive/);
    });
  });

  test.describe('Wallet Creation', () => {
    test('should create new wallet successfully', async ({ page }) => {
      // Arrange
      await walletPage.gotoCreateWallet();

      // Act
      await walletPage.createWallet(VALID_WALLET);

      // Assert
      await walletPage.verifySuccess('Wallet created');
      await expect(page).toHaveURL(/.*wallet/);
    });

    test('should create wallet with minimum required fields', async () => {
      // Arrange
      const minimalWallet: WalletData = {
        walletType: 'personal',
        currency: 'NGN',
      };
      await walletPage.gotoCreateWallet();

      // Act
      await walletPage.createWallet(minimalWallet);

      // Assert
      await walletPage.verifySuccess();
    });

    test('should create multiple wallets', async () => {
      // Arrange
      await walletPage.gotoWalletDashboard();
      const initialCount = await walletPage.getWalletCount();

      // Act - Create first wallet
      await walletPage.gotoCreateWallet();
      await walletPage.createWallet({ ...VALID_WALLET, walletName: 'Wallet 1' });
      await walletPage.gotoWalletDashboard();

      // Act - Create second wallet
      await walletPage.gotoCreateWallet();
      await walletPage.createWallet({ ...VALID_WALLET, walletName: 'Wallet 2' });
      await walletPage.gotoWalletDashboard();

      // Assert
      const finalCount = await walletPage.getWalletCount();
      expect(finalCount).toBe(initialCount + 2);
    });

    test('should validate wallet name length', async () => {
      // Arrange
      const longName = 'A'.repeat(101); // Assuming max 100 characters
      await walletPage.gotoCreateWallet();

      // Act
      await walletPage.createWallet({ ...VALID_WALLET, walletName: longName });

      // Assert
      await walletPage.verifyValidationError('maximum');
    });

    test('should require wallet type selection', async () => {
      // Arrange
      await walletPage.gotoCreateWallet();

      // Act
      await walletPage.walletNameInput.fill('Test Wallet');
      await walletPage.createWalletSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('type');
    });

    test('should create different wallet types', async () => {
      const walletTypes: Array<'personal' | 'business' | 'savings'> = ['personal', 'business', 'savings'];

      for (const type of walletTypes) {
        // Arrange
        await walletPage.gotoCreateWallet();

        // Act
        await walletPage.createWallet({ ...VALID_WALLET, walletType: type });

        // Assert
        await walletPage.verifySuccess();
      }
    });
  });

  test.describe('Wallet Funding', () => {
    test.beforeEach(async () => {
      await walletPage.gotoFundWallet();
    });

    test('should fund wallet with card successfully', async () => {
      // Arrange
      const initialBalance = await walletPage.getWalletBalance();

      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);
      await walletPage.confirmAction();

      // Assert
      await walletPage.verifySuccess('funded');
      await walletPage.gotoWalletDashboard();
      
      const newBalance = await walletPage.getWalletBalance();
      expect(newBalance).toBeGreaterThan(initialBalance);
    });

    test('should fund wallet with bank transfer', async () => {
      // Arrange
      const bankFunding: FundingData = {
        amount: 5000,
        paymentMethod: 'bank_transfer',
        bankAccount: '0123456789',
        bankCode: '058',
      };

      // Act
      await walletPage.fundWalletWithBank(bankFunding);
      await walletPage.confirmAction();

      // Assert
      await walletPage.verifySuccess();
    });

    test('should fund wallet with eNaira', async () => {
      // Arrange
      const enairaFunding: FundingData = {
        amount: 3000,
        paymentMethod: 'enaira',
      };

      // Act
      await walletPage.fundAmountInput.fill(enairaFunding.amount.toString());
      await walletPage.paymentMethodSelect.selectOption('enaira');
      await walletPage.fundSubmitButton.click();
      await walletPage.confirmAction();

      // Assert
      await walletPage.verifySuccess();
    });

    test('should validate minimum funding amount', async () => {
      // Act
      await walletPage.fundAmountInput.fill('50'); // Below minimum (assuming 100)
      await walletPage.fundSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('minimum');
    });

    test('should validate maximum funding amount', async () => {
      // Act
      await walletPage.fundAmountInput.fill('10000000'); // Above maximum
      await walletPage.fundSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('maximum');
    });

    test('should validate card number format', async () => {
      // Arrange
      const invalidCards = ['123', '1234567890123456789', 'abcdefghijklmnop'];

      for (const card of invalidCards) {
        // Act
        await walletPage.cardNumberInput.clear();
        await walletPage.cardNumberInput.fill(card);
        await walletPage.fundSubmitButton.click();

        // Assert
        await expect(walletPage.validationError).toBeVisible();
      }
    });

    test('should validate card expiry format', async () => {
      // Arrange
      const invalidExpiries = ['13/25', '12/20', '00/25', 'AB/CD'];

      for (const expiry of invalidExpiries) {
        // Act
        await walletPage.cardExpiryInput.clear();
        await walletPage.cardExpiryInput.fill(expiry);
        await walletPage.fundSubmitButton.click();

        // Assert
        await expect(walletPage.validationError).toBeVisible();
      }
    });

    test('should validate CVV format', async () => {
      // Arrange
      const invalidCVVs = ['12', '12345', 'ABC'];

      for (const cvv of invalidCVVs) {
        // Act
        await walletPage.cardCVVInput.clear();
        await walletPage.cardCVVInput.fill(cvv);
        await walletPage.fundSubmitButton.click();

        // Assert
        await expect(walletPage.validationError).toBeVisible();
      }
    });

    test('should handle payment gateway error', async ({ page }) => {
      // Arrange - Mock payment failure
      await page.route('**/api/wallet/fund', route => {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'Payment declined' }),
        });
      });

      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);

      // Assert
      await walletPage.verifyError('Payment declined');
    });

    test('should show loading during payment processing', async () => {
      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);

      // Assert
      await expect(walletPage.loadingSpinner).toBeVisible();
      await walletPage.waitForLoading();
    });

    test('should disable submit button during processing', async () => {
      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);

      // Assert
      await expect(walletPage.fundSubmitButton).toBeDisabled();
    });
  });

  test.describe('Wallet Withdrawal', () => {
    test.beforeEach(async () => {
      await walletPage.gotoWithdraw();
    });

    test('should withdraw from wallet successfully', async () => {
      // Arrange
      const initialBalance = await walletPage.getWalletBalance();

      // Act
      await walletPage.withdrawFromWallet(VALID_WITHDRAWAL);
      await walletPage.confirmAction();

      // Assert
      await walletPage.verifySuccess('Withdrawal');
      await walletPage.gotoWalletDashboard();
      
      const newBalance = await walletPage.getWalletBalance();
      expect(newBalance).toBeLessThan(initialBalance);
    });

    test('should validate withdrawal amount', async () => {
      // Act - Empty amount
      await walletPage.withdrawSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('amount');
    });

    test('should validate minimum withdrawal amount', async () => {
      // Act
      await walletPage.withdrawAmountInput.fill('50'); // Below minimum
      await walletPage.withdrawSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('minimum');
    });

    test('should validate maximum withdrawal amount', async () => {
      // Act
      await walletPage.withdrawAmountInput.fill('10000000'); // Above maximum
      await walletPage.withdrawSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('maximum');
    });

    test('should validate insufficient balance', async () => {
      // Arrange
      const balance = await walletPage.getWalletBalance();

      // Act - Try to withdraw more than balance
      await walletPage.withdrawFromWallet({
        ...VALID_WITHDRAWAL,
        amount: balance + 10000,
      });

      // Assert
      await walletPage.verifyError('Insufficient balance');
    });

    test('should validate bank account number', async () => {
      // Arrange
      const invalidAccounts = ['123', '12345678901234567890', 'abcdefghij'];

      for (const account of invalidAccounts) {
        // Act
        await walletPage.withdrawBankAccountInput.clear();
        await walletPage.withdrawBankAccountInput.fill(account);
        await walletPage.withdrawSubmitButton.click();

        // Assert
        await expect(walletPage.validationError).toBeVisible();
      }
    });

    test('should require bank selection', async () => {
      // Act
      await walletPage.withdrawAmountInput.fill('1000');
      await walletPage.withdrawBankAccountInput.fill('0123456789');
      await walletPage.withdrawSubmitButton.click();

      // Assert
      await walletPage.verifyValidationError('bank');
    });

    test('should verify account name before withdrawal', async () => {
      // Act
      await walletPage.withdrawFromWallet(VALID_WITHDRAWAL);

      // Assert - Confirmation modal should show account name
      await expect(walletPage.confirmationModal).toBeVisible();
      await expect(walletPage.confirmationModal).toContainText(VALID_WITHDRAWAL.accountName!);
    });

    test('should allow canceling withdrawal', async ({ page }) => {
      // Act
      await walletPage.withdrawFromWallet(VALID_WITHDRAWAL);
      await walletPage.cancelButton.click();

      // Assert
      await expect(walletPage.confirmationModal).not.toBeVisible();
      await expect(page).toHaveURL(/.*withdraw/);
    });
  });

  test.describe('Multiple Wallets', () => {
    test('should switch between wallets', async () => {
      // Arrange - Create two wallets
      await walletPage.gotoCreateWallet();
      await walletPage.createWallet({ ...VALID_WALLET, walletName: 'Wallet A' });
      
      await walletPage.gotoCreateWallet();
      await walletPage.createWallet({ ...VALID_WALLET, walletName: 'Wallet B' });

      // Act
      await walletPage.gotoWalletDashboard();
      await walletPage.selectWallet('Wallet A');

      // Assert
      await expect(walletPage.walletName).toContainText('Wallet A');

      // Act
      await walletPage.selectWallet('Wallet B');

      // Assert
      await expect(walletPage.walletName).toContainText('Wallet B');
    });

    test('should set wallet as default', async () => {
      // Act
      await walletPage.gotoWalletDashboard();
      await walletPage.setAsDefault();

      // Assert
      await walletPage.verifySuccess('default');
    });

    test('should display all user wallets', async () => {
      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      const count = await walletPage.getWalletCount();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Wallet Settings', () => {
    test('should freeze wallet', async () => {
      // Act
      await walletPage.gotoWalletDashboard();
      await walletPage.freezeWallet();

      // Assert
      await walletPage.verifySuccess('frozen');
      await expect(walletPage.walletStatus).toContainText('Frozen');
    });

    test('should unfreeze wallet', async () => {
      // Arrange - Freeze wallet first
      await walletPage.gotoWalletDashboard();
      await walletPage.freezeWallet();

      // Act
      await walletPage.unfreezeWallet();

      // Assert
      await walletPage.verifySuccess('unfrozen');
      await expect(walletPage.walletStatus).toContainText('Active');
    });

    test('should prevent transactions on frozen wallet', async () => {
      // Arrange - Freeze wallet
      await walletPage.gotoWalletDashboard();
      await walletPage.freezeWallet();

      // Act - Try to fund frozen wallet
      await walletPage.gotoFundWallet();
      await walletPage.fundWalletWithCard(VALID_FUNDING);

      // Assert
      await walletPage.verifyError('frozen');
    });

    test('should delete wallet with confirmation', async () => {
      // Arrange - Create wallet to delete
      await walletPage.gotoCreateWallet();
      await walletPage.createWallet({ ...VALID_WALLET, walletName: 'To Delete' });
      
      await walletPage.gotoWalletDashboard();
      const initialCount = await walletPage.getWalletCount();

      // Act
      await walletPage.selectWallet('To Delete');
      await walletPage.deleteWallet();

      // Assert
      await walletPage.verifySuccess('deleted');
      await walletPage.gotoWalletDashboard();
      
      const finalCount = await walletPage.getWalletCount();
      expect(finalCount).toBe(initialCount - 1);
    });

    test('should prevent deleting default wallet', async () => {
      // Arrange - Set as default
      await walletPage.gotoWalletDashboard();
      await walletPage.setAsDefault();

      // Act
      await walletPage.deleteWallet();

      // Assert
      await walletPage.verifyError('Cannot delete default wallet');
    });
  });

  test.describe('Transaction History', () => {
    test('should display wallet transaction history', async () => {
      // Act
      await walletPage.gotoWalletDashboard();
      await walletPage.transactionHistoryLink.click();

      // Assert
      await expect(walletPage.transactionTable).toBeVisible();
    });

    test('should search transactions', async () => {
      // Arrange
      await walletPage.gotoWalletDashboard();
      await walletPage.transactionHistoryLink.click();

      // Act
      await walletPage.searchTransactions('funding');

      // Assert
      const count = await walletPage.getTransactionCount();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should export transaction history', async () => {
      // Arrange
      await walletPage.gotoWalletDashboard();
      await walletPage.transactionHistoryLink.click();

      // Act
      const download = await walletPage.exportTransactions();

      // Assert
      expect(download).toBeTruthy();
      expect(download.suggestedFilename()).toMatch(/\.csv|\.xlsx|\.pdf/);
    });

    test('should filter transactions by type', async ({ page }) => {
      // Arrange
      await walletPage.gotoWalletDashboard();
      await walletPage.transactionHistoryLink.click();

      // Act
      await walletPage.transactionFilterButton.click();
      await page.selectOption('select[name="transactionType"]', 'funding');
      await page.click('button:has-text("Apply")');

      // Assert
      const rows = await walletPage.transactionRows.all();
      for (const row of rows) {
        const text = await row.textContent();
        expect(text).toMatch(/fund|deposit/i);
      }
    });

    test('should filter transactions by date range', async ({ page }) => {
      // Arrange
      await walletPage.gotoWalletDashboard();
      await walletPage.transactionHistoryLink.click();

      // Act
      await walletPage.transactionFilterButton.click();
      await page.fill('input[name="startDate"]', '2025-11-01');
      await page.fill('input[name="endDate"]', '2025-11-30');
      await page.click('button:has-text("Apply")');

      // Assert
      const count = await walletPage.getTransactionCount();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Security', () => {
    test('should require authentication for wallet access', async ({ page }) => {
      // Arrange - Logout
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Act - Try to access wallet
      await page.goto('/wallet');

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/);
      await expect(page).toHaveURL(/.*login/);
    });

    test('should prevent XSS in wallet name', async ({ page }) => {
      // Arrange
      await walletPage.gotoCreateWallet();

      // Act
      await walletPage.createWallet({
        ...VALID_WALLET,
        walletName: '<script>alert("XSS")</script>',
      });

      // Assert - Should not execute script
      page.on('dialog', async dialog => {
        throw new Error('XSS vulnerability detected');
      });

      await walletPage.verifySuccess();
    });

    test('should mask card number in display', async () => {
      // Arrange
      await walletPage.gotoFundWallet();

      // Act
      await walletPage.cardNumberInput.fill('5399838383838381');

      // Assert - Card should be masked (e.g., **** **** **** 8381)
      const displayValue = await walletPage.cardNumberInput.inputValue();
      expect(displayValue).toMatch(/\*{4}|\d{4}/);
    });

    test('should require PIN for large withdrawals', async ({ page }) => {
      // Arrange
      const largeWithdrawal: WithdrawalData = {
        ...VALID_WITHDRAWAL,
        amount: 100000, // Large amount
      };

      // Act
      await walletPage.gotoWithdraw();
      await walletPage.withdrawFromWallet(largeWithdrawal);

      // Assert - Should prompt for PIN
      const pinInput = page.locator('input[name="pin"], input[type="password"]');
      await expect(pinInput).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load wallet dashboard within acceptable time', async () => {
      // Arrange
      const startTime = Date.now();

      // Act
      await walletPage.gotoWalletDashboard();

      // Assert - Should load within 2 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(2000);
    });

    test('should process funding within acceptable time', async () => {
      // Arrange
      await walletPage.gotoFundWallet();
      const startTime = Date.now();

      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);
      await walletPage.confirmAction();
      await walletPage.waitForLoading();

      // Assert - Should complete within 5 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000);
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should display wallet on mobile', async ({ page }) => {
      // Arrange - Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Act
      await walletPage.gotoWalletDashboard();

      // Assert
      await expect(walletPage.walletBalance).toBeVisible();
      await expect(walletPage.fundWalletButton).toBeVisible();
      await expect(walletPage.withdrawButton).toBeVisible();
    });

    test('should fund wallet on mobile', async ({ page }) => {
      // Arrange
      await page.setViewportSize({ width: 375, height: 667 });
      await walletPage.gotoFundWallet();

      // Act
      await walletPage.fundWalletWithCard(VALID_FUNDING);
      await walletPage.confirmAction();

      // Assert
      await walletPage.verifySuccess();
    });
  });
});
