// authentication.e2e.ts - Authentication E2E Tests
// Tests for login, biometrics, PIN, and session management

import { device, element, by, expect, waitFor } from 'detox';

describe('Authentication Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: {
        notifications: 'YES',
        camera: 'YES',
        location: 'always',
      },
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  describe('Login Screen', () => {
    it('should display login screen on first launch', async () => {
      await expect(element(by.id('login-screen'))).toBeVisible();
      await expect(element(by.id('phone-input'))).toBeVisible();
      await expect(element(by.id('pin-input'))).toBeVisible();
      await expect(element(by.id('login-button'))).toBeVisible();
    });

    it('should show error for invalid phone number', async () => {
      await element(by.id('phone-input')).typeText('123');
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('login-button')).tap();
      
      await waitFor(element(by.id('error-message')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.text('Invalid phone number'))).toBeVisible();
    });

    it('should show error for incorrect PIN', async () => {
      await element(by.id('phone-input')).clearText();
      await element(by.id('phone-input')).typeText('08012345678');
      await element(by.id('pin-input')).clearText();
      await element(by.id('pin-input')).typeText('0000');
      await element(by.id('login-button')).tap();
      
      await waitFor(element(by.id('error-message')))
        .toBeVisible()
        .withTimeout(10000);
      
      await expect(element(by.text('Invalid credentials'))).toBeVisible();
    });

    it('should login successfully with valid credentials', async () => {
      await element(by.id('phone-input')).clearText();
      await element(by.id('phone-input')).typeText('08012345678');
      await element(by.id('pin-input')).clearText();
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('login-button')).tap();
      
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(15000);
      
      await expect(element(by.id('home-screen'))).toBeVisible();
    });

    it('should lock account after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await element(by.id('phone-input')).clearText();
        await element(by.id('phone-input')).typeText('08012345678');
        await element(by.id('pin-input')).clearText();
        await element(by.id('pin-input')).typeText('0000');
        await element(by.id('login-button')).tap();
        
        await waitFor(element(by.id('error-message')))
          .toBeVisible()
          .withTimeout(5000);
      }
      
      await expect(element(by.text('Account locked'))).toBeVisible();
    });
  });

  describe('Biometric Authentication', () => {
    beforeEach(async () => {
      // Login first
      await element(by.id('phone-input')).typeText('08012345678');
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('login-button')).tap();
      
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(15000);
    });

    it('should prompt for biometric setup after first login', async () => {
      await expect(element(by.id('biometric-setup-prompt'))).toBeVisible();
    });

    it('should enable biometric authentication', async () => {
      await element(by.id('enable-biometric-button')).tap();
      
      // Simulate biometric enrollment
      await device.setBiometricEnrollment(true);
      await device.matchFace();
      
      await expect(element(by.text('Biometric enabled'))).toBeVisible();
    });

    it('should authenticate with biometrics on subsequent launches', async () => {
      await device.terminateApp();
      await device.launchApp();
      
      await waitFor(element(by.id('biometric-prompt')))
        .toBeVisible()
        .withTimeout(5000);
      
      await device.matchFace();
      
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('should fallback to PIN when biometric fails', async () => {
      await device.terminateApp();
      await device.launchApp();
      
      await waitFor(element(by.id('biometric-prompt')))
        .toBeVisible()
        .withTimeout(5000);
      
      await device.unmatchFace();
      
      await waitFor(element(by.id('pin-fallback-button')))
        .toBeVisible()
        .withTimeout(5000);
      
      await element(by.id('pin-fallback-button')).tap();
      
      await expect(element(by.id('pin-input'))).toBeVisible();
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      await element(by.id('phone-input')).typeText('08012345678');
      await element(by.id('pin-input')).typeText('1234');
      await element(by.id('login-button')).tap();
      
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(15000);
    });

    it('should logout successfully', async () => {
      await element(by.id('menu-button')).tap();
      await element(by.id('logout-button')).tap();
      await element(by.id('confirm-logout-button')).tap();
      
      await waitFor(element(by.id('login-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should require re-authentication after session timeout', async () => {
      // Simulate session timeout by sending app to background
      await device.sendToHome();
      
      // Wait for session timeout (simulated)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await device.launchApp({ newInstance: false });
      
      // Should show re-authentication prompt
      await waitFor(element(by.id('session-expired-prompt')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Security Checks', () => {
    it('should show security warning on compromised device', async () => {
      // This test would run on a rooted/jailbroken device
      // For CI, we mock the security check response
      await device.launchApp({
        launchArgs: {
          mockSecurityCheck: 'compromised',
        },
      });
      
      await waitFor(element(by.id('security-warning')))
        .toBeVisible()
        .withTimeout(5000);
      
      await expect(element(by.text('Device security compromised'))).toBeVisible();
    });

    it('should block financial operations on compromised device', async () => {
      await device.launchApp({
        launchArgs: {
          mockSecurityCheck: 'compromised',
        },
      });
      
      // Try to navigate to transfer screen
      await element(by.id('transfer-button')).tap();
      
      await expect(element(by.text('Operation blocked'))).toBeVisible();
    });
  });
});
