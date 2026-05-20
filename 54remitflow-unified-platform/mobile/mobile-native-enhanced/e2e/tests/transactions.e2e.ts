// transactions.e2e.ts - Financial Transactions E2E Tests
// Tests for cash-in, cash-out, transfers, and balance inquiries

import { device, element, by, expect, waitFor } from 'detox';

describe('Financial Transactions', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: {
        notifications: 'YES',
        camera: 'YES',
      },
    });
    
    // Login
    await element(by.id('phone-input')).typeText('08012345678');
    await element(by.id('pin-input')).typeText('1234');
    await element(by.id('login-button')).tap();
    
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });

  beforeEach(async () => {
    // Navigate back to home if not already there
    try {
      await element(by.id('home-button')).tap();
    } catch {
      // Already on home screen
    }
  });

  describe('Balance Inquiry', () => {
    it('should display current balance on home screen', async () => {
      await expect(element(by.id('balance-display'))).toBeVisible();
      await expect(element(by.id('balance-amount'))).toBeVisible();
    });

    it('should refresh balance on pull-to-refresh', async () => {
      const initialBalance = await element(by.id('balance-amount')).getAttributes();
      
      await element(by.id('home-scroll-view')).swipe('down', 'slow');
      
      await waitFor(element(by.id('loading-indicator')))
        .not.toBeVisible()
        .withTimeout(10000);
      
      await expect(element(by.id('balance-amount'))).toBeVisible();
    });

    it('should show balance breakdown', async () => {
      await element(by.id('balance-display')).tap();
      
      await waitFor(element(by.id('balance-breakdown-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.id('available-balance'))).toBeVisible();
      await expect(element(by.id('pending-balance'))).toBeVisible();
      await expect(element(by.id('float-balance'))).toBeVisible();
    });
  });

  describe('Cash-In Transaction', () => {
    beforeEach(async () => {
      await element(by.id('cash-in-button')).tap();
      
      await waitFor(element(by.id('cash-in-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should display cash-in form', async () => {
      await expect(element(by.id('customer-phone-input'))).toBeVisible();
      await expect(element(by.id('amount-input'))).toBeVisible();
      await expect(element(by.id('proceed-button'))).toBeVisible();
    });

    it('should validate minimum amount', async () => {
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).typeText('50');
      await element(by.id('proceed-button')).tap();
      
      await expect(element(by.text('Minimum amount is NGN 100'))).toBeVisible();
    });

    it('should validate maximum amount', async () => {
      await element(by.id('customer-phone-input')).clearText();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).clearText();
      await element(by.id('amount-input')).typeText('1000001');
      await element(by.id('proceed-button')).tap();
      
      await expect(element(by.text('Maximum amount is NGN 1,000,000'))).toBeVisible();
    });

    it('should show confirmation screen with correct details', async () => {
      await element(by.id('customer-phone-input')).clearText();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).clearText();
      await element(by.id('amount-input')).typeText('5000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.text('NGN 5,000.00'))).toBeVisible();
      await expect(element(by.text('08098765432'))).toBeVisible();
      await expect(element(by.id('commission-amount'))).toBeVisible();
    });

    it('should require PIN confirmation for transaction', async () => {
      await element(by.id('customer-phone-input')).clearText();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).clearText();
      await element(by.id('amount-input')).typeText('5000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('confirm-button')).tap();
      
      await waitFor(element(by.id('pin-confirmation-modal')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should complete cash-in transaction successfully', async () => {
      await element(by.id('customer-phone-input')).clearText();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).clearText();
      await element(by.id('amount-input')).typeText('5000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('confirm-button')).tap();
      
      await waitFor(element(by.id('pin-confirmation-modal')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('submit-pin-button')).tap();
      
      await waitFor(element(by.id('success-screen')))
        .toBeVisible()
        .withTimeout(30000);
      
      await expect(element(by.text('Transaction Successful'))).toBeVisible();
      await expect(element(by.id('transaction-reference'))).toBeVisible();
    });
  });

  describe('Cash-Out Transaction', () => {
    beforeEach(async () => {
      await element(by.id('cash-out-button')).tap();
      
      await waitFor(element(by.id('cash-out-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should display cash-out form', async () => {
      await expect(element(by.id('customer-phone-input'))).toBeVisible();
      await expect(element(by.id('amount-input'))).toBeVisible();
      await expect(element(by.id('proceed-button'))).toBeVisible();
    });

    it('should check float balance before proceeding', async () => {
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).typeText('10000000'); // Large amount
      await element(by.id('proceed-button')).tap();
      
      await expect(element(by.text('Insufficient float balance'))).toBeVisible();
    });

    it('should complete cash-out transaction successfully', async () => {
      await element(by.id('customer-phone-input')).clearText();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).clearText();
      await element(by.id('amount-input')).typeText('2000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('confirm-button')).tap();
      
      await waitFor(element(by.id('pin-confirmation-modal')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('submit-pin-button')).tap();
      
      await waitFor(element(by.id('success-screen')))
        .toBeVisible()
        .withTimeout(30000);
      
      await expect(element(by.text('Transaction Successful'))).toBeVisible();
    });
  });

  describe('Transfer Transaction', () => {
    beforeEach(async () => {
      await element(by.id('transfer-button')).tap();
      
      await waitFor(element(by.id('transfer-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should display transfer options', async () => {
      await expect(element(by.id('bank-transfer-option'))).toBeVisible();
      await expect(element(by.id('wallet-transfer-option'))).toBeVisible();
    });

    it('should show bank selection for bank transfer', async () => {
      await element(by.id('bank-transfer-option')).tap();
      
      await waitFor(element(by.id('bank-selection-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.id('bank-search-input'))).toBeVisible();
      await expect(element(by.id('bank-list'))).toBeVisible();
    });

    it('should validate account number', async () => {
      await element(by.id('bank-transfer-option')).tap();
      
      await waitFor(element(by.id('bank-selection-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      // Select a bank
      await element(by.id('bank-search-input')).typeText('GTBank');
      await element(by.text('Guaranty Trust Bank')).tap();
      
      // Enter invalid account number
      await element(by.id('account-number-input')).typeText('123');
      await element(by.id('verify-account-button')).tap();
      
      await expect(element(by.text('Invalid account number'))).toBeVisible();
    });

    it('should verify account name before transfer', async () => {
      await element(by.id('bank-transfer-option')).tap();
      
      await waitFor(element(by.id('bank-selection-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('bank-search-input')).typeText('GTBank');
      await element(by.text('Guaranty Trust Bank')).tap();
      
      await element(by.id('account-number-input')).clearText();
      await element(by.id('account-number-input')).typeText('0123456789');
      await element(by.id('verify-account-button')).tap();
      
      await waitFor(element(by.id('account-name-display')))
        .toBeVisible()
        .withTimeout(10000);
      
      await expect(element(by.id('account-name-display'))).toBeVisible();
    });

    it('should complete bank transfer successfully', async () => {
      await element(by.id('bank-transfer-option')).tap();
      
      await waitFor(element(by.id('bank-selection-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('bank-search-input')).typeText('GTBank');
      await element(by.text('Guaranty Trust Bank')).tap();
      
      await element(by.id('account-number-input')).typeText('0123456789');
      await element(by.id('verify-account-button')).tap();
      
      await waitFor(element(by.id('account-name-display')))
        .toBeVisible()
        .withTimeout(10000);
      
      await element(by.id('amount-input')).typeText('1000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('confirm-button')).tap();
      
      await waitFor(element(by.id('pin-confirmation-modal')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('submit-pin-button')).tap();
      
      await waitFor(element(by.id('success-screen')))
        .toBeVisible()
        .withTimeout(30000);
      
      await expect(element(by.text('Transfer Successful'))).toBeVisible();
    });
  });

  describe('Transaction History', () => {
    beforeEach(async () => {
      await element(by.id('history-button')).tap();
      
      await waitFor(element(by.id('history-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should display transaction history', async () => {
      await expect(element(by.id('transaction-list'))).toBeVisible();
    });

    it('should filter transactions by type', async () => {
      await element(by.id('filter-button')).tap();
      await element(by.id('filter-cash-in')).tap();
      await element(by.id('apply-filter-button')).tap();
      
      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);
      
      // All visible transactions should be cash-in type
    });

    it('should filter transactions by date range', async () => {
      await element(by.id('filter-button')).tap();
      await element(by.id('date-range-picker')).tap();
      await element(by.id('last-7-days')).tap();
      await element(by.id('apply-filter-button')).tap();
      
      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should show transaction details on tap', async () => {
      await element(by.id('transaction-item-0')).tap();
      
      await waitFor(element(by.id('transaction-details-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.id('transaction-reference'))).toBeVisible();
      await expect(element(by.id('transaction-amount'))).toBeVisible();
      await expect(element(by.id('transaction-status'))).toBeVisible();
      await expect(element(by.id('transaction-date'))).toBeVisible();
    });

    it('should allow sharing transaction receipt', async () => {
      await element(by.id('transaction-item-0')).tap();
      
      await waitFor(element(by.id('transaction-details-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('share-receipt-button')).tap();
      
      // Share sheet should appear (platform-specific)
    });
  });

  describe('Offline Transactions', () => {
    it('should queue transaction when offline', async () => {
      // Disable network
      await device.setURLBlacklist(['.*']);
      
      await element(by.id('cash-in-button')).tap();
      
      await waitFor(element(by.id('cash-in-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).typeText('1000');
      await element(by.id('proceed-button')).tap();
      
      await waitFor(element(by.id('confirmation-screen')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('confirm-button')).tap();
      
      await waitFor(element(by.id('pin-confirmation-modal')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('submit-pin-button')).tap();
      
      await waitFor(element(by.text('Transaction queued')))
        .toBeVisible()
        .withTimeout(10000);
      
      // Re-enable network
      await device.setURLBlacklist([]);
    });

    it('should sync queued transactions when online', async () => {
      // Re-enable network
      await device.setURLBlacklist([]);
      
      await waitFor(element(by.id('sync-indicator')))
        .toBeVisible()
        .withTimeout(5000);
      
      await waitFor(element(by.text('Transactions synced')))
        .toBeVisible()
        .withTimeout(30000);
    });

    it('should show pending transactions indicator', async () => {
      await device.setURLBlacklist(['.*']);
      
      // Create offline transaction
      await element(by.id('cash-in-button')).tap();
      await element(by.id('customer-phone-input')).typeText('08098765432');
      await element(by.id('amount-input')).typeText('500');
      await element(by.id('proceed-button')).tap();
      await element(by.id('confirm-button')).tap();
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('submit-pin-button')).tap();
      
      await element(by.id('home-button')).tap();
      
      await expect(element(by.id('pending-transactions-badge'))).toBeVisible();
      
      await device.setURLBlacklist([]);
    });
  });
});
