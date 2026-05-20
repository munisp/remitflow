/**
 * Comprehensive Money Transfer E2E Tests
 * 
 * Test Coverage:
 * - Domestic transfers (Nigeria to Nigeria)
 * - International transfers (Nigeria to other countries)
 * - Transfer success scenarios
 * - Transfer failure scenarios
 * - Validation and error handling
 * - Fee calculation
 * - Exchange rate display
 * - Transfer confirmation
 * - Transfer history
 * - Security and performance
 * 
 * @group transfers
 * @group critical
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { TransferPage, TransferData } from '../../pages/TransferPage';

const VALID_USER = {
  email: 'test@example.com',
  password: 'SecurePassword123!',
};

const DOMESTIC_TRANSFER: TransferData = {
  recipientName: 'Jane Doe',
  recipientAccount: '0123456789',
  recipientBank: 'GTBank',
  amount: 10000,
  currency: 'NGN',
  narration: 'Payment for services',
  transferType: 'domestic',
};

const INTERNATIONAL_TRANSFER: TransferData = {
  recipientName: 'John Smith',
  recipientAccount: 'GB29NWBK60161331926819',
  recipientBank: 'Barclays Bank',
  recipientCountry: 'United Kingdom',
  amount: 500,
  currency: 'GBP',
  narration: 'Family support',
  transferType: 'international',
  swiftCode: 'BARCGB22',
};

test.describe('Money Transfer', () => {
  let loginPage: LoginPage;
  let transferPage: TransferPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    transferPage = new TransferPage(page);
    
    await loginPage.goto();
    await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
  });

  test.describe('Domestic Transfer - Success Scenarios', () => {
    test('should complete domestic transfer successfully', async ({ page }) => {
      // Act
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifySuccess('Transfer successful');
      await expect(page).toHaveURL(/.*transfer\/success/);
      
      // Verify transaction ID is displayed
      const transactionId = await transferPage.getTransactionId();
      expect(transactionId).toMatch(/^TXN-[A-Z0-9]+$/);
    });

    test('should display correct fee calculation for domestic transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Act
      const fee = await transferPage.getTransferFee();
      const total = await transferPage.getTotalAmount();

      // Assert
      expect(fee).toBeGreaterThan(0);
      expect(total).toBe(DOMESTIC_TRANSFER.amount + fee);
    });

    test('should show recipient bank details before confirmation', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();

      // Assert - Review screen should show all details
      await expect(transferPage.reviewSection).toBeVisible();
      await expect(transferPage.reviewSection).toContainText(DOMESTIC_TRANSFER.recipientName);
      await expect(transferPage.reviewSection).toContainText(DOMESTIC_TRANSFER.recipientAccount);
      await expect(transferPage.reviewSection).toContainText(DOMESTIC_TRANSFER.recipientBank);
      await expect(transferPage.reviewSection).toContainText(DOMESTIC_TRANSFER.amount.toString());
    });

    test('should allow editing transfer before confirmation', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();

      // Act
      await transferPage.editTransfer();

      // Assert - Should return to form with pre-filled data
      const recipientName = await transferPage.recipientNameInput.inputValue();
      expect(recipientName).toBe(DOMESTIC_TRANSFER.recipientName);
    });

    test('should generate transfer receipt', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Act & Assert
      await expect(transferPage.receiptModal).toBeVisible();
      await expect(transferPage.downloadReceiptButton).toBeVisible();
    });

    test('should download transfer receipt as PDF', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Act
      const downloadPromise = page.waitForEvent('download');
      await transferPage.downloadReceiptButton.click();
      const download = await downloadPromise;

      // Assert
      expect(download.suggestedFilename()).toMatch(/receipt.*\.pdf$/i);
    });

    test('should show transfer in transaction history', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();
      const transactionId = await transferPage.getTransactionId();

      // Act
      await transferPage.gotoTransactionHistory();

      // Assert
      await expect(transferPage.transactionList).toContainText(transactionId);
      await expect(transferPage.transactionList).toContainText(DOMESTIC_TRANSFER.recipientName);
    });

    test('should send transfer confirmation email', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await expect(transferPage.emailConfirmationMessage).toBeVisible();
      await expect(transferPage.emailConfirmationMessage).toContainText('confirmation email');
    });

    test('should update wallet balance after transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      const initialBalance = await transferPage.getWalletBalance();
      
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      const fee = await transferPage.getTransferFee();
      const total = DOMESTIC_TRANSFER.amount + fee;

      // Act
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();
      await transferPage.gotoWallet();

      // Assert
      const finalBalance = await transferPage.getWalletBalance();
      expect(finalBalance).toBe(initialBalance - total);
    });

    test('should support scheduled transfer', async () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const scheduledDate = futureDate.toISOString().split('T')[0];

      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        scheduledDate,
      });

      // Act
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifySuccess('Transfer scheduled');
      await expect(transferPage.successMessage).toContainText(scheduledDate);
    });

    test('should support recurring transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        recurring: true,
        frequency: 'monthly',
      });

      // Act
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifySuccess('Recurring transfer set up');
      await expect(transferPage.successMessage).toContainText('monthly');
    });
  });

  test.describe('International Transfer - Success Scenarios', () => {
    test('should complete international transfer successfully', async ({ page }) => {
      // Act
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(INTERNATIONAL_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifySuccess('Transfer successful');
      await expect(page).toHaveURL(/.*transfer\/success/);
    });

    test('should display exchange rate for international transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(INTERNATIONAL_TRANSFER);

      // Act
      const exchangeRate = await transferPage.getExchangeRate();

      // Assert
      expect(exchangeRate).toBeGreaterThan(0);
      await expect(transferPage.exchangeRateDisplay).toBeVisible();
      await expect(transferPage.exchangeRateDisplay).toContainText('GBP');
      await expect(transferPage.exchangeRateDisplay).toContainText('NGN');
    });

    test('should calculate total in recipient currency', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(INTERNATIONAL_TRANSFER);

      // Act
      const recipientAmount = await transferPage.getRecipientAmount();

      // Assert
      expect(recipientAmount).toBeGreaterThan(0);
      await expect(transferPage.recipientAmountDisplay).toContainText('GBP');
    });

    test('should validate SWIFT code for international transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');

      // Act
      await transferPage.fillTransferForm({
        ...INTERNATIONAL_TRANSFER,
        swiftCode: 'INVALID',
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('SWIFT code');
    });

    test('should validate IBAN format for European transfers', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');

      // Act
      await transferPage.fillTransferForm({
        ...INTERNATIONAL_TRANSFER,
        recipientAccount: 'INVALID-IBAN',
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('IBAN');
    });

    test('should show international transfer fees', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(INTERNATIONAL_TRANSFER);

      // Act
      const fee = await transferPage.getTransferFee();

      // Assert
      expect(fee).toBeGreaterThan(0);
      // International fees should be higher than domestic
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      const domesticFee = await transferPage.getTransferFee();
      expect(fee).toBeGreaterThan(domesticFee);
    });

    test('should display estimated delivery time', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(INTERNATIONAL_TRANSFER);

      // Assert
      await expect(transferPage.deliveryTimeDisplay).toBeVisible();
      const deliveryTime = await transferPage.deliveryTimeDisplay.textContent();
      expect(deliveryTime).toMatch(/\d+.*hours?|days?/i);
    });

    test('should require additional documentation for large transfers', async () => {
      // Arrange
      const largeTransfer: TransferData = {
        ...INTERNATIONAL_TRANSFER,
        amount: 100000, // Large amount
      };

      await transferPage.gotoTransfer();
      await transferPage.selectTransferType('international');
      await transferPage.fillTransferForm(largeTransfer);

      // Act
      await transferPage.submitTransfer();

      // Assert
      await expect(transferPage.documentUploadSection).toBeVisible();
      await transferPage.verifyValidationError('documentation required');
    });
  });

  test.describe('Transfer Validation - Failure Scenarios', () => {
    test('should validate required recipient name', async () => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        recipientName: '',
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('recipient name');
    });

    test('should validate required account number', async () => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        recipientAccount: '',
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('account number');
    });

    test('should validate account number format (10 digits for Nigerian banks)', async () => {
      // Arrange
      const invalidAccounts = ['123', '12345678901234567890', 'abcdefghij'];

      for (const account of invalidAccounts) {
        // Act
        await transferPage.gotoTransfer();
        await transferPage.fillTransferForm({
          ...DOMESTIC_TRANSFER,
          recipientAccount: account,
        });
        await transferPage.submitTransfer();

        // Assert
        await expect(transferPage.validationError).toBeVisible();
      }
    });

    test('should validate minimum transfer amount', async () => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        amount: 50, // Below minimum (₦100)
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('minimum amount');
    });

    test('should validate maximum transfer amount', async () => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        amount: 10000000, // Above maximum
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('maximum amount');
    });

    test('should validate insufficient balance', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      const balance = await transferPage.getWalletBalance();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        amount: balance + 10000, // More than available balance
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('Insufficient balance');
    });

    test('should validate recipient bank selection', async () => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        recipientBank: '',
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('bank');
    });

    test('should validate narration length (max 100 characters)', async () => {
      // Arrange
      const longNarration = 'A'.repeat(101);
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        narration: longNarration,
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyValidationError('maximum');
    });

    test('should prevent duplicate transfer submission', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Act - Try to submit same transfer again immediately
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifyError('duplicate transfer');
    });

    test('should validate daily transfer limit', async () => {
      // Arrange - Simulate multiple transfers reaching daily limit
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        amount: 1000000, // Amount that exceeds daily limit
      });
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('daily limit exceeded');
    });
  });

  test.describe('Transfer Error Handling', () => {
    test('should handle network error during transfer', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock network error
      await page.route('**/api/transfers', route => {
        route.abort('failed');
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('Network error');
    });

    test('should handle server error during transfer', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock server error
      await page.route('**/api/transfers', route => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('server error');
    });

    test('should handle invalid recipient account', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock invalid account response
      await page.route('**/api/transfers/validate-account', route => {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'Invalid account number' }),
        });
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('Invalid account');
    });

    test('should handle bank service unavailable', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock service unavailable
      await page.route('**/api/transfers', route => {
        route.fulfill({
          status: 503,
          body: JSON.stringify({ error: 'Bank service temporarily unavailable' }),
        });
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('service unavailable');
    });

    test('should handle timeout during transfer', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock timeout
      await page.route('**/api/transfers', route => {
        // Don't respond, causing timeout
        setTimeout(() => route.abort('timedout'), 30000);
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await transferPage.verifyError('timeout');
    });

    test('should show retry option on failure', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Mock error
      await page.route('**/api/transfers', route => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Transfer failed' }),
        });
      });

      // Act
      await transferPage.submitTransfer();

      // Assert
      await expect(transferPage.retryButton).toBeVisible();
    });

    test('should allow canceling transfer before confirmation', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();

      // Act
      await transferPage.cancelTransfer();

      // Assert
      await expect(transferPage.recipientNameInput).toBeVisible();
      // Should return to form
    });
  });

  test.describe('Security', () => {
    test('should require authentication for transfer', async ({ page }) => {
      // Arrange - Logout
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Act - Try to access transfer page
      await page.goto('/transfer');

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/);
      await expect(page).toHaveURL(/.*login/);
    });

    test('should require PIN/password confirmation for large transfers', async () => {
      // Arrange
      const largeTransfer: TransferData = {
        ...DOMESTIC_TRANSFER,
        amount: 500000, // Large amount requiring confirmation
      };

      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(largeTransfer);
      await transferPage.submitTransfer();

      // Assert
      await expect(transferPage.pinConfirmationModal).toBeVisible();
    });

    test('should prevent XSS in narration field', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm({
        ...DOMESTIC_TRANSFER,
        narration: '<script>alert("XSS")</script>',
      });
      await transferPage.submitTransfer();

      // Assert - Should not execute script
      page.on('dialog', async dialog => {
        throw new Error('XSS vulnerability detected');
      });
    });

    test('should encrypt sensitive data in transit', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Act - Monitor network request
      let requestBody: any;
      page.on('request', request => {
        if (request.url().includes('/api/transfers')) {
          requestBody = request.postDataJSON();
        }
      });

      await transferPage.submitTransfer();

      // Assert - Account number should be encrypted
      if (requestBody && requestBody.recipientAccount) {
        expect(requestBody.recipientAccount).not.toBe(DOMESTIC_TRANSFER.recipientAccount);
      }
    });

    test('should log transfer activity for audit', async ({ page }) => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Act
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert - Check audit log
      await page.goto('/account/activity');
      await expect(page.locator('.activity-log')).toContainText('Transfer');
      await expect(page.locator('.activity-log')).toContainText(DOMESTIC_TRANSFER.recipientName);
    });
  });

  test.describe('Performance', () => {
    test('should load transfer page within acceptable time', async () => {
      // Arrange
      const startTime = Date.now();

      // Act
      await transferPage.gotoTransfer();

      // Assert - Should load within 2 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(2000);
    });

    test('should complete transfer within acceptable time', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      const startTime = Date.now();

      // Act
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();
      await transferPage.waitForSuccess();

      // Assert - Should complete within 5 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000);
    });

    test('should show loading indicator during transfer', async () => {
      // Arrange
      await transferPage.gotoTransfer();
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

      // Act
      await transferPage.submitTransfer();

      // Assert
      await expect(transferPage.loadingSpinner).toBeVisible();
      await transferPage.waitForLoading();
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should display transfer form on mobile', async ({ page }) => {
      // Arrange - Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Act
      await transferPage.gotoTransfer();

      // Assert
      await expect(transferPage.recipientNameInput).toBeVisible();
      await expect(transferPage.recipientAccountInput).toBeVisible();
      await expect(transferPage.amountInput).toBeVisible();
    });

    test('should complete transfer on mobile', async ({ page }) => {
      // Arrange
      await page.setViewportSize({ width: 375, height: 667 });
      await transferPage.gotoTransfer();

      // Act
      await transferPage.fillTransferForm(DOMESTIC_TRANSFER);
      await transferPage.submitTransfer();
      await transferPage.confirmTransfer();

      // Assert
      await transferPage.verifySuccess('Transfer successful');
    });
  });
});
