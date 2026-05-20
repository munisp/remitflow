/**
 * E2E Tests for Critical User Flows
 * 
 * Tests:
 * - User registration and onboarding
 * - Login with biometrics
 * - Cash-in transaction
 * - Cash-out transaction
 * - Transfer between accounts
 * - Agent location finder
 * - Transaction history
 * - Profile management
 */

import { device, element, by, expect, waitFor } from 'detox';

describe('Critical User Flows', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: {
        location: 'always',
        camera: 'YES',
        notifications: 'YES',
        contacts: 'YES'
      }
    });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  describe('User Registration', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
    });

    it('should complete full registration flow', async () => {
      // Navigate to registration
      await element(by.id('btn-get-started')).tap();
      await element(by.id('btn-create-account')).tap();

      // Enter phone number
      await element(by.id('input-phone')).typeText('08012345678');
      await element(by.id('btn-continue')).tap();

      // Verify OTP screen appears
      await waitFor(element(by.id('screen-otp-verification')))
        .toBeVisible()
        .withTimeout(5000);

      // Enter OTP (test mode uses 123456)
      await element(by.id('input-otp')).typeText('123456');
      await element(by.id('btn-verify')).tap();

      // Enter personal details
      await waitFor(element(by.id('screen-personal-details')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('input-first-name')).typeText('Test');
      await element(by.id('input-last-name')).typeText('User');
      await element(by.id('input-email')).typeText('test@example.com');
      await element(by.id('btn-continue')).tap();

      // Set PIN
      await waitFor(element(by.id('screen-set-pin')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('input-pin')).typeText('1234');
      await element(by.id('input-confirm-pin')).typeText('1234');
      await element(by.id('btn-set-pin')).tap();

      // Verify success
      await waitFor(element(by.id('screen-registration-success')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Account Created'))).toBeVisible();
    });

    it('should show error for invalid phone number', async () => {
      await element(by.id('btn-get-started')).tap();
      await element(by.id('btn-create-account')).tap();

      await element(by.id('input-phone')).typeText('123');
      await element(by.id('btn-continue')).tap();

      await expect(element(by.text('Invalid phone number'))).toBeVisible();
    });
  });

  describe('Login Flow', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
    });

    it('should login with PIN', async () => {
      await element(by.id('btn-login')).tap();

      // Enter phone number
      await element(by.id('input-phone')).typeText('08012345678');
      await element(by.id('btn-continue')).tap();

      // Enter PIN
      await waitFor(element(by.id('screen-enter-pin')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('input-pin')).typeText('1234');

      // Verify dashboard appears
      await waitFor(element(by.id('screen-dashboard')))
        .toBeVisible()
        .withTimeout(10000);

      await expect(element(by.id('balance-card'))).toBeVisible();
    });

    it('should handle biometric login', async () => {
      // Assuming biometrics are enrolled
      await element(by.id('btn-login')).tap();
      await element(by.id('input-phone')).typeText('08012345678');
      await element(by.id('btn-continue')).tap();

      // Tap biometric button
      await waitFor(element(by.id('btn-biometric-login')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('btn-biometric-login')).tap();

      // Simulate biometric success (in test mode)
      await device.setBiometricEnrollment(true);
      await device.matchFace();

      // Verify dashboard appears
      await waitFor(element(by.id('screen-dashboard')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('should lock account after 5 failed attempts', async () => {
      await element(by.id('btn-login')).tap();
      await element(by.id('input-phone')).typeText('08012345678');
      await element(by.id('btn-continue')).tap();

      // Enter wrong PIN 5 times
      for (let i = 0; i < 5; i++) {
        await element(by.id('input-pin')).typeText('0000');
        await element(by.id('input-pin')).clearText();
      }

      // Verify account locked message
      await expect(element(by.text('Account Locked'))).toBeVisible();
    });
  });

  describe('Cash-In Transaction', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      // Login first
      await loginAsTestUser();
    });

    it('should complete cash-in transaction', async () => {
      // Navigate to cash-in
      await element(by.id('btn-cash-in')).tap();

      // Enter amount
      await waitFor(element(by.id('screen-cash-in')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('input-amount')).typeText('5000');
      await element(by.id('btn-continue')).tap();

      // Select agent (first in list)
      await waitFor(element(by.id('agent-list')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('agent-item-0')).tap();

      // Confirm transaction
      await waitFor(element(by.id('screen-confirm-transaction')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('₦5,000.00'))).toBeVisible();
      await element(by.id('btn-confirm')).tap();

      // Enter PIN
      await element(by.id('input-pin')).typeText('1234');

      // Verify success
      await waitFor(element(by.id('screen-transaction-success')))
        .toBeVisible()
        .withTimeout(10000);

      await expect(element(by.text('Transaction Successful'))).toBeVisible();
      await expect(element(by.id('receipt-number'))).toBeVisible();
    });

    it('should show error for insufficient agent float', async () => {
      await element(by.id('btn-cash-in')).tap();
      await element(by.id('input-amount')).typeText('10000000'); // Very large amount
      await element(by.id('btn-continue')).tap();

      await element(by.id('agent-item-0')).tap();
      await element(by.id('btn-confirm')).tap();
      await element(by.id('input-pin')).typeText('1234');

      await expect(element(by.text('Insufficient agent float'))).toBeVisible();
    });
  });

  describe('Cash-Out Transaction', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should complete cash-out transaction', async () => {
      await element(by.id('btn-cash-out')).tap();

      await element(by.id('input-amount')).typeText('2000');
      await element(by.id('btn-continue')).tap();

      await element(by.id('agent-item-0')).tap();
      await element(by.id('btn-confirm')).tap();
      await element(by.id('input-pin')).typeText('1234');

      await waitFor(element(by.id('screen-transaction-success')))
        .toBeVisible()
        .withTimeout(10000);

      await expect(element(by.text('Transaction Successful'))).toBeVisible();
    });

    it('should show error for insufficient balance', async () => {
      await element(by.id('btn-cash-out')).tap();
      await element(by.id('input-amount')).typeText('10000000');
      await element(by.id('btn-continue')).tap();

      await expect(element(by.text('Insufficient balance'))).toBeVisible();
    });
  });

  describe('Transfer Transaction', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should complete transfer to another user', async () => {
      await element(by.id('btn-transfer')).tap();

      // Enter recipient
      await element(by.id('input-recipient')).typeText('08098765432');
      await element(by.id('btn-continue')).tap();

      // Verify recipient
      await waitFor(element(by.id('recipient-name')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('btn-confirm-recipient')).tap();

      // Enter amount
      await element(by.id('input-amount')).typeText('1000');
      await element(by.id('btn-continue')).tap();

      // Confirm
      await element(by.id('btn-confirm')).tap();
      await element(by.id('input-pin')).typeText('1234');

      await waitFor(element(by.id('screen-transaction-success')))
        .toBeVisible()
        .withTimeout(10000);

      await expect(element(by.text('Transfer Successful'))).toBeVisible();
    });

    it('should show error for invalid recipient', async () => {
      await element(by.id('btn-transfer')).tap();
      await element(by.id('input-recipient')).typeText('00000000000');
      await element(by.id('btn-continue')).tap();

      await expect(element(by.text('Recipient not found'))).toBeVisible();
    });
  });

  describe('Agent Finder', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should display nearby agents on map', async () => {
      await element(by.id('btn-find-agent')).tap();

      await waitFor(element(by.id('agent-map')))
        .toBeVisible()
        .withTimeout(10000);

      // Verify agent markers are visible
      await expect(element(by.id('agent-marker-0'))).toBeVisible();
    });

    it('should show agent details on marker tap', async () => {
      await element(by.id('btn-find-agent')).tap();

      await waitFor(element(by.id('agent-map')))
        .toBeVisible()
        .withTimeout(10000);

      await element(by.id('agent-marker-0')).tap();

      await waitFor(element(by.id('agent-details-card')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.id('agent-name'))).toBeVisible();
      await expect(element(by.id('agent-distance'))).toBeVisible();
      await expect(element(by.id('agent-rating'))).toBeVisible();
    });

    it('should filter agents by service type', async () => {
      await element(by.id('btn-find-agent')).tap();

      await waitFor(element(by.id('agent-map')))
        .toBeVisible()
        .withTimeout(10000);

      // Filter by cash-in only
      await element(by.id('filter-cash-in')).tap();

      // Verify filtered results
      await expect(element(by.id('filter-active-cash-in'))).toBeVisible();
    });
  });

  describe('Transaction History', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should display transaction history', async () => {
      await element(by.id('btn-history')).tap();

      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);

      // Verify transactions are displayed
      await expect(element(by.id('transaction-item-0'))).toBeVisible();
    });

    it('should show transaction details on tap', async () => {
      await element(by.id('btn-history')).tap();

      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('transaction-item-0')).tap();

      await waitFor(element(by.id('screen-transaction-details')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.id('transaction-amount'))).toBeVisible();
      await expect(element(by.id('transaction-date'))).toBeVisible();
      await expect(element(by.id('transaction-status'))).toBeVisible();
    });

    it('should filter transactions by type', async () => {
      await element(by.id('btn-history')).tap();

      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);

      // Filter by cash-in
      await element(by.id('filter-type')).tap();
      await element(by.text('Cash In')).tap();

      // Verify filtered results
      await expect(element(by.id('filter-active-cash-in'))).toBeVisible();
    });

    it('should filter transactions by date range', async () => {
      await element(by.id('btn-history')).tap();

      await waitFor(element(by.id('transaction-list')))
        .toBeVisible()
        .withTimeout(5000);

      // Open date filter
      await element(by.id('filter-date')).tap();
      await element(by.text('Last 7 days')).tap();

      // Verify filtered results
      await expect(element(by.id('filter-active-date'))).toBeVisible();
    });
  });

  describe('Profile Management', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should display user profile', async () => {
      await element(by.id('tab-profile')).tap();

      await waitFor(element(by.id('screen-profile')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.id('profile-name'))).toBeVisible();
      await expect(element(by.id('profile-phone'))).toBeVisible();
      await expect(element(by.id('profile-email'))).toBeVisible();
    });

    it('should update profile information', async () => {
      await element(by.id('tab-profile')).tap();
      await element(by.id('btn-edit-profile')).tap();

      await element(by.id('input-email')).clearText();
      await element(by.id('input-email')).typeText('newemail@example.com');
      await element(by.id('btn-save')).tap();

      await waitFor(element(by.text('Profile Updated')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should change PIN', async () => {
      await element(by.id('tab-profile')).tap();
      await element(by.id('btn-change-pin')).tap();

      await element(by.id('input-current-pin')).typeText('1234');
      await element(by.id('input-new-pin')).typeText('5678');
      await element(by.id('input-confirm-pin')).typeText('5678');
      await element(by.id('btn-change-pin-submit')).tap();

      await waitFor(element(by.text('PIN Changed')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should logout successfully', async () => {
      await element(by.id('tab-profile')).tap();
      await element(by.id('btn-logout')).tap();
      await element(by.id('btn-confirm-logout')).tap();

      await waitFor(element(by.id('screen-login')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Offline Mode', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
      await loginAsTestUser();
    });

    it('should queue transaction when offline', async () => {
      // Disable network
      await device.setURLBlacklist(['.*']);

      await element(by.id('btn-cash-in')).tap();
      await element(by.id('input-amount')).typeText('1000');
      await element(by.id('btn-continue')).tap();
      await element(by.id('agent-item-0')).tap();
      await element(by.id('btn-confirm')).tap();
      await element(by.id('input-pin')).typeText('1234');

      // Verify queued message
      await expect(element(by.text('Transaction Queued'))).toBeVisible();
      await expect(element(by.text('Will sync when online'))).toBeVisible();

      // Re-enable network
      await device.setURLBlacklist([]);
    });

    it('should sync queued transactions when back online', async () => {
      // Disable network
      await device.setURLBlacklist(['.*']);

      // Queue a transaction
      await element(by.id('btn-cash-in')).tap();
      await element(by.id('input-amount')).typeText('500');
      await element(by.id('btn-continue')).tap();
      await element(by.id('agent-item-0')).tap();
      await element(by.id('btn-confirm')).tap();
      await element(by.id('input-pin')).typeText('1234');

      // Re-enable network
      await device.setURLBlacklist([]);

      // Wait for sync
      await waitFor(element(by.text('Transaction Synced')))
        .toBeVisible()
        .withTimeout(30000);
    });
  });
});

// Helper function to login as test user
async function loginAsTestUser() {
  await element(by.id('btn-login')).tap();
  await element(by.id('input-phone')).typeText('08012345678');
  await element(by.id('btn-continue')).tap();
  
  await waitFor(element(by.id('screen-enter-pin')))
    .toBeVisible()
    .withTimeout(5000);
  
  await element(by.id('input-pin')).typeText('1234');
  
  await waitFor(element(by.id('screen-dashboard')))
    .toBeVisible()
    .withTimeout(10000);
}
