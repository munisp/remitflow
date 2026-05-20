/**
 * Transaction Submission E2E Tests
 * 
 * Test Coverage:
 * - Successful transaction submission
 * - Transaction validation (amount, recipient, etc.)
 * - Payment method selection
 * - Transaction confirmation flow
 * - Transaction receipt generation
 * - Transaction history
 * - Error handling
 * - Edge cases (minimum/maximum amounts, special characters, etc.)
 * 
 * @group transactions
 * @group critical
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { TransactionPage, TransactionData } from '../../pages/TransactionPage';

// Test data
const VALID_USER = {
  email: 'test@example.com',
  password: 'SecurePassword123!',
};

const VALID_TRANSACTION: TransactionData = {
  recipientName: 'John Doe',
  recipientEmail: 'john.doe@example.com',
  recipientPhone: '+2348012345678',
  recipientBankAccount: '0123456789',
  recipientBankCode: '058', // GTBank
  amount: 10000,
  currency: 'NGN',
  purpose: 'family_support',
  notes: 'Monthly support',
  paymentMethod: 'wallet',
};

test.describe('Transaction Submission', () => {
  let loginPage: LoginPage;
  let transactionPage: TransactionPage;

  test.beforeEach(async ({ page }) => {
    // Login before each test
    loginPage = new LoginPage(page);
    transactionPage = new TransactionPage(page);
    
    await loginPage.goto();
    await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
  });

  test.describe('Successful Transaction', () => {
    test('should submit transaction successfully with all fields', async ({ page }) => {
      // Arrange
      await transactionPage.gotoNewTransaction();

      // Act
      await transactionPage.fillTransactionForm(VALID_TRANSACTION);
      await transactionPage.submitTransaction();

      // Assert - Confirmation modal should appear
      await transactionPage.verifyConfirmationModal(
        VALID_TRANSACTION.amount,
        VALID_TRANSACTION.recipientName!
      );

      // Act - Confirm transaction
      await transactionPage.confirmTransaction();

      // Assert - Transaction should succeed
      await transactionPage.verifyTransactionSuccess();
      
      const transactionId = await transactionPage.getTransactionId();
      expect(transactionId).toBeTruthy();
      expect(transactionId).toMatch(/^TXN-/);
    });

    test('should submit transaction with minimum required fields', async () => {
      // Arrange
      const minimalTransaction: TransactionData = {
        recipientBankAccount: '0123456789',
        recipientBankCode: '058',
        amount: 1000,
      };

      await transactionPage.gotoNewTransaction();

      // Act
      await transactionPage.createTransaction(minimalTransaction);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });

    test('should display correct fee calculation', async () => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      await transactionPage.fillTransactionForm(VALID_TRANSACTION);
      await transactionPage.submitTransaction();

      // Assert - Verify fee is displayed in confirmation modal
      await expect(transactionPage.confirmationModal).toBeVisible();
      await expect(transactionPage.modalFee).toBeVisible();
      
      const feeText = await transactionPage.modalFee.textContent();
      expect(feeText).toMatch(/₦|NGN/);
    });

    test('should display correct total amount (amount + fee)', async () => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      await transactionPage.fillTransactionForm(VALID_TRANSACTION);
      await transactionPage.submitTransaction();

      // Assert
      await expect(transactionPage.modalTotal).toBeVisible();
      
      const totalText = await transactionPage.modalTotal.textContent();
      const total = parseFloat(totalText?.replace(/[^0-9.]/g, '') || '0');
      
      expect(total).toBeGreaterThan(VALID_TRANSACTION.amount);
    });

    test('should generate transaction receipt', async () => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      await transactionPage.createTransaction(VALID_TRANSACTION);
      await transactionPage.verifyTransactionSuccess();

      // Assert - Receipt should be visible
      await expect(transactionPage.receiptModal).toBeVisible();
      await expect(transactionPage.downloadReceiptButton).toBeVisible();
    });

    test('should download transaction receipt', async () => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      await transactionPage.createTransaction(VALID_TRANSACTION);
      await transactionPage.verifyTransactionSuccess();

      // Act
      const download = await transactionPage.downloadReceipt();

      // Assert
      expect(download).toBeTruthy();
      expect(download.suggestedFilename()).toMatch(/receipt|transaction/i);
    });

    test('should show transaction in history after submission', async ({ page }) => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      await transactionPage.createTransaction(VALID_TRANSACTION);
      const transactionId = await transactionPage.getTransactionId();

      // Act - Navigate to transaction history
      await transactionPage.gotoTransactionHistory();

      // Assert - Transaction should appear in list
      await transactionPage.verifyTransactionInList(transactionId);
    });
  });

  test.describe('Transaction Validation', () => {
    test.beforeEach(async () => {
      await transactionPage.gotoNewTransaction();
    });

    test('should validate empty amount', async () => {
      // Arrange
      const invalidTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        amount: 0,
      };

      // Act
      await transactionPage.fillTransactionForm(invalidTransaction);
      await transactionPage.submitTransaction();

      // Assert
      await expect(transactionPage.validationError).toBeVisible();
      await expect(transactionPage.validationError).toContainText('amount');
    });

    test('should validate negative amount', async () => {
      // Act
      await transactionPage.verifyAmountValidation('-1000', 'positive');
    });

    test('should validate minimum amount', async () => {
      // Act
      await transactionPage.verifyMinimumAmount(100); // Assuming min is 100 NGN
    });

    test('should validate maximum amount', async () => {
      // Act
      await transactionPage.verifyMaximumAmount(1000000); // Assuming max is 1M NGN
    });

    test('should validate invalid amount format', async () => {
      // Act
      await transactionPage.verifyAmountValidation('abc', 'valid number');
    });

    test('should validate decimal places', async () => {
      // Act - Try to enter more than 2 decimal places
      await transactionPage.amountInput.fill('1000.999');
      await transactionPage.submitTransaction();

      // Assert - Should round or show error
      const value = await transactionPage.amountInput.inputValue();
      const decimalPlaces = value.split('.')[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    test('should validate empty recipient account', async () => {
      // Arrange
      const invalidTransaction: TransactionData = {
        amount: 1000,
        recipientBankAccount: '',
      };

      // Act
      await transactionPage.fillTransactionForm(invalidTransaction);
      await transactionPage.submitTransaction();

      // Assert
      await expect(transactionPage.validationError).toBeVisible();
      await expect(transactionPage.validationError).toContainText('account');
    });

    test('should validate invalid account number format', async () => {
      // Arrange
      const invalidAccounts = ['123', '12345678901234567890', 'abcdefghij'];

      for (const account of invalidAccounts) {
        // Act
        await transactionPage.recipientBankAccountInput.clear();
        await transactionPage.recipientBankAccountInput.fill(account);
        await transactionPage.submitTransaction();

        // Assert
        await expect(transactionPage.validationError).toBeVisible();
      }
    });

    test('should validate bank selection', async () => {
      // Arrange
      const invalidTransaction: TransactionData = {
        amount: 1000,
        recipientBankAccount: '0123456789',
        // Bank code not provided
      };

      // Act
      await transactionPage.fillTransactionForm(invalidTransaction);
      await transactionPage.submitTransaction();

      // Assert
      await expect(transactionPage.validationError).toContainText('bank');
    });

    test('should validate phone number format', async () => {
      // Arrange
      const invalidPhones = ['123', '+234', '08012345678901234567890', 'abcdefghij'];

      for (const phone of invalidPhones) {
        // Act
        await transactionPage.recipientPhoneInput.clear();
        await transactionPage.recipientPhoneInput.fill(phone);
        await transactionPage.submitTransaction();

        // Assert
        await expect(transactionPage.validationError).toBeVisible();
      }
    });

    test('should validate email format', async () => {
      // Arrange
      const invalidEmails = ['invalid', 'invalid@', '@example.com', 'invalid@.com'];

      for (const email of invalidEmails) {
        // Act
        await transactionPage.recipientEmailInput.clear();
        await transactionPage.recipientEmailInput.fill(email);
        await transactionPage.submitTransaction();

        // Assert
        const validation = await transactionPage.recipientEmailInput.evaluate(
          (el: HTMLInputElement) => el.validationMessage
        );
        expect(validation).toContain('email');
      }
    });
  });

  test.describe('Payment Methods', () => {
    test.beforeEach(async () => {
      await transactionPage.gotoNewTransaction();
    });

    test('should submit transaction with wallet payment', async () => {
      // Arrange
      const walletTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        paymentMethod: 'wallet',
      };

      // Act
      await transactionPage.createTransaction(walletTransaction);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });

    test('should submit transaction with bank transfer', async () => {
      // Arrange
      const bankTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        paymentMethod: 'bank_transfer',
      };

      // Act
      await transactionPage.createTransaction(bankTransaction);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });

    test('should submit transaction with card payment', async () => {
      // Arrange
      const cardTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        paymentMethod: 'card',
      };

      // Act
      await transactionPage.createTransaction(cardTransaction);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });

    test('should submit transaction with eNaira', async () => {
      // Arrange
      const enairaTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        paymentMethod: 'enaira',
      };

      // Act
      await transactionPage.createTransaction(enairaTransaction);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });
  });

  test.describe('Transaction Confirmation', () => {
    test.beforeEach(async () => {
      await transactionPage.gotoNewTransaction();
      await transactionPage.fillTransactionForm(VALID_TRANSACTION);
      await transactionPage.submitTransaction();
    });

    test('should display confirmation modal with correct details', async () => {
      // Assert
      await expect(transactionPage.confirmationModal).toBeVisible();
      await expect(transactionPage.modalAmount).toContainText(VALID_TRANSACTION.amount.toString());
      await expect(transactionPage.modalRecipient).toContainText(VALID_TRANSACTION.recipientName!);
    });

    test('should allow canceling transaction from confirmation modal', async ({ page }) => {
      // Act
      await transactionPage.cancelButton.click();

      // Assert - Should return to form
      await expect(transactionPage.confirmationModal).not.toBeVisible();
      await expect(transactionPage.amountInput).toBeVisible();
    });

    test('should require explicit confirmation before processing', async () => {
      // Assert - Transaction should not be processed until confirmation
      await expect(transactionPage.confirmationModal).toBeVisible();
      await expect(transactionPage.successMessage).not.toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test.beforeEach(async () => {
      await transactionPage.gotoNewTransaction();
    });

    test('should handle insufficient balance error', async () => {
      // Arrange - Try to send more than available balance
      const largeTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        amount: 999999999,
      };

      // Act
      await transactionPage.createTransaction(largeTransaction);

      // Assert
      await transactionPage.verifyTransactionError('Insufficient balance');
    });

    test('should handle invalid recipient account error', async () => {
      // Arrange
      const invalidTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        recipientBankAccount: '9999999999', // Non-existent account
      };

      // Act
      await transactionPage.createTransaction(invalidTransaction);

      // Assert
      await transactionPage.verifyTransactionError('Invalid account');
    });

    test('should handle network error gracefully', async ({ page }) => {
      // Arrange - Simulate offline
      await page.context().setOffline(true);

      // Act
      await transactionPage.createTransaction(VALID_TRANSACTION);

      // Assert
      await transactionPage.verifyTransactionError('Network error');

      // Cleanup
      await page.context().setOffline(false);
    });

    test('should handle server error gracefully', async ({ page }) => {
      // Arrange - Intercept API and return 500
      await page.route('**/api/transactions', route => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      });

      // Act
      await transactionPage.createTransaction(VALID_TRANSACTION);

      // Assert
      await transactionPage.verifyTransactionError('server error');
    });

    test('should prevent duplicate submission', async () => {
      // Act - Submit form
      await transactionPage.fillTransactionForm(VALID_TRANSACTION);
      await transactionPage.submitTransaction();

      // Assert - Submit button should be disabled
      await expect(transactionPage.submitButton).toBeDisabled();
    });

    test('should handle timeout gracefully', async ({ page }) => {
      // Arrange - Delay API response
      await page.route('**/api/transactions', async route => {
        await new Promise(resolve => setTimeout(resolve, 60000)); // 60s delay
        route.continue();
      });

      // Act
      await transactionPage.createTransaction(VALID_TRANSACTION);

      // Assert - Should show timeout error
      await transactionPage.verifyTransactionError('timeout');
    });
  });

  test.describe('Transaction History', () => {
    test('should display transaction history', async () => {
      // Act
      await transactionPage.gotoTransactionHistory();

      // Assert
      await expect(transactionPage.transactionTable).toBeVisible();
      const count = await transactionPage.getTransactionCount();
      expect(count).toBeGreaterThan(0);
    });

    test('should search transactions by ID', async () => {
      // Arrange - Create a transaction first
      await transactionPage.gotoNewTransaction();
      await transactionPage.createTransaction(VALID_TRANSACTION);
      const transactionId = await transactionPage.getTransactionId();

      // Act - Search for transaction
      await transactionPage.gotoTransactionHistory();
      await transactionPage.searchTransactions(transactionId);

      // Assert
      await transactionPage.verifyTransactionInList(transactionId);
    });

    test('should search transactions by recipient name', async () => {
      // Act
      await transactionPage.gotoTransactionHistory();
      await transactionPage.searchTransactions(VALID_TRANSACTION.recipientName!);

      // Assert - Should show matching transactions
      const count = await transactionPage.getTransactionCount();
      expect(count).toBeGreaterThan(0);
    });

    test('should export transaction history', async () => {
      // Arrange
      await transactionPage.gotoTransactionHistory();

      // Act
      const downloadPromise = transactionPage.page.waitForEvent('download');
      await transactionPage.exportButton.click();
      const download = await downloadPromise;

      // Assert
      expect(download).toBeTruthy();
      expect(download.suggestedFilename()).toMatch(/\.csv|\.xlsx|\.pdf/);
    });
  });

  test.describe('Security', () => {
    test.beforeEach(async () => {
      await transactionPage.gotoNewTransaction();
    });

    test('should prevent XSS in recipient name', async ({ page }) => {
      // Arrange
      const xssTransaction: TransactionData = {
        ...VALID_TRANSACTION,
        recipientName: '<script>alert("XSS")</script>',
      };

      // Act
      await transactionPage.fillTransactionForm(xssTransaction);
      await transactionPage.submitTransaction();

      // Assert - Should not execute script
      page.on('dialog', async dialog => {
        throw new Error('XSS vulnerability detected');
      });

      await transactionPage.confirmTransaction();
    });

    test('should prevent SQL injection in notes', async () => {
      // Arrange
      const sqlInjection: TransactionData = {
        ...VALID_TRANSACTION,
        notes: "'; DROP TABLE transactions; --",
      };

      // Act
      await transactionPage.createTransaction(sqlInjection);

      // Assert - Should handle safely
      await transactionPage.verifyTransactionSuccess();
    });

    test('should require authentication for transaction submission', async ({ page }) => {
      // Arrange - Logout
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Act - Try to access transaction page
      await page.goto('/transactions/new');

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/);
      await expect(page).toHaveURL(/.*login/);
    });
  });

  test.describe('Performance', () => {
    test('should submit transaction within acceptable time', async () => {
      // Arrange
      await transactionPage.gotoNewTransaction();
      const startTime = Date.now();

      // Act
      await transactionPage.createTransaction(VALID_TRANSACTION);

      // Assert - Should complete within 5 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000);
    });

    test('should load transaction history within acceptable time', async () => {
      // Arrange
      const startTime = Date.now();

      // Act
      await transactionPage.gotoTransactionHistory();

      // Assert - Should load within 3 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(3000);
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should submit transaction on mobile', async ({ page }) => {
      // Arrange - Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await transactionPage.gotoNewTransaction();

      // Act
      await transactionPage.createTransaction(VALID_TRANSACTION);

      // Assert
      await transactionPage.verifyTransactionSuccess();
    });
  });
});
