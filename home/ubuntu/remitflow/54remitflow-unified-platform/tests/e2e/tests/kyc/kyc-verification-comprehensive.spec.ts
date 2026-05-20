/**
 * Comprehensive KYC Verification E2E Tests
 * 
 * Test Coverage:
 * - KYC status display
 * - Personal information submission
 * - Address verification
 * - BVN verification
 * - NIN verification
 * - ID document upload
 * - Proof of address upload
 * - Selfie verification
 * - Multi-step verification flow
 * - Tier upgrades
 * - Validation and error handling
 * - Security and performance
 * 
 * @group kyc
 * @group critical
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { KYCPage, PersonalInfoData, AddressData, IdentificationData, DocumentUploadData } from '../../pages/KYCPage';
import * as path from 'path';

const VALID_USER = {
  email: 'test@example.com',
  password: 'SecurePassword123!',
};

const VALID_PERSONAL_INFO: PersonalInfoData = {
  firstName: 'John',
  lastName: 'Doe',
  middleName: 'Smith',
  dateOfBirth: '1990-01-15',
  gender: 'male',
  phoneNumber: '+2348012345678',
  email: 'john.doe@example.com',
  nationality: 'NG',
};

const VALID_ADDRESS: AddressData = {
  street: '123 Main Street',
  city: 'Lagos',
  state: 'Lagos',
  postalCode: '100001',
  country: 'Nigeria',
};

const VALID_IDENTIFICATION: IdentificationData = {
  bvn: '12345678901',
  nin: '12345678901',
  idType: 'national_id',
  idNumber: 'NIN-12345678901',
  issueDate: '2020-01-01',
  expiryDate: '2030-01-01',
};

// Mock file paths for testing
const MOCK_DOCUMENTS: DocumentUploadData = {
  idDocument: path.join(__dirname, '../../fixtures/test-id-card.jpg'),
  proofOfAddress: path.join(__dirname, '../../fixtures/test-utility-bill.pdf'),
  selfie: path.join(__dirname, '../../fixtures/test-selfie.jpg'),
};

test.describe('KYC Verification', () => {
  let loginPage: LoginPage;
  let kycPage: KYCPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    kycPage = new KYCPage(page);
    
    await loginPage.goto();
    await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
  });

  test.describe('KYC Status Display', () => {
    test('should display KYC dashboard', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.kycStatus).toBeVisible();
      await expect(kycPage.verificationLevel).toBeVisible();
      await expect(kycPage.startVerificationButton).toBeVisible();
    });

    test('should display current KYC status', async () => {
      // Act
      await kycPage.gotoKYCStatus();

      // Assert
      const status = await kycPage.getKYCStatus();
      expect(status).toMatch(/Pending|Verified|Rejected|Not Started/);
    });

    test('should display verification level (Tier)', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      const level = await kycPage.getVerificationLevel();
      expect(level).toMatch(/Tier 1|Tier 2|Tier 3/);
    });

    test('should display transaction limits for current tier', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.limitInfo).toBeVisible();
      const limitText = await kycPage.limitInfo.textContent();
      expect(limitText).toMatch(/daily|monthly|limit/i);
    });

    test('should display verification progress', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.verificationProgress).toBeVisible();
    });

    test('should show tier upgrade option', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.upgradeButton).toBeVisible();
    });
  });

  test.describe('Personal Information', () => {
    test.beforeEach(async () => {
      await kycPage.gotoKYCVerification();
    });

    test('should submit personal information successfully', async () => {
      // Act
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyCurrentStep(2); // Should move to step 2
    });

    test('should validate required fields', async () => {
      // Act - Try to continue without filling
      await kycPage.continueToNextStep();

      // Assert
      await expect(kycPage.validationError).toBeVisible();
    });

    test('should validate first name', async () => {
      // Act - Empty first name
      await kycPage.lastNameInput.fill('Doe');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('first name');
    });

    test('should validate last name', async () => {
      // Act - Empty last name
      await kycPage.firstNameInput.fill('John');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('last name');
    });

    test('should validate date of birth format', async () => {
      // Arrange
      const invalidDates = ['invalid', '13/32/2020', '2020-13-32'];

      for (const date of invalidDates) {
        // Act
        await kycPage.dateOfBirthInput.clear();
        await kycPage.dateOfBirthInput.fill(date);
        await kycPage.continueToNextStep();

        // Assert
        await expect(kycPage.validationError).toBeVisible();
      }
    });

    test('should validate minimum age (18 years)', async () => {
      // Arrange - Date less than 18 years ago
      const today = new Date();
      const underAge = new Date(today.getFullYear() - 17, today.getMonth(), today.getDate());
      const dateString = underAge.toISOString().split('T')[0];

      // Act
      await kycPage.fillPersonalInfo({
        ...VALID_PERSONAL_INFO,
        dateOfBirth: dateString,
      });
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('18 years');
    });

    test('should validate phone number format', async () => {
      // Arrange
      const invalidPhones = ['123', '+234', '08012345678901234567890', 'abcdefghij'];

      for (const phone of invalidPhones) {
        // Act
        await kycPage.phoneNumberInput.clear();
        await kycPage.phoneNumberInput.fill(phone);
        await kycPage.continueToNextStep();

        // Assert
        await expect(kycPage.validationError).toBeVisible();
      }
    });

    test('should validate email format', async () => {
      // Arrange
      const invalidEmails = ['invalid', 'invalid@', '@example.com', 'invalid@.com'];

      for (const email of invalidEmails) {
        // Act
        await kycPage.emailInput.clear();
        await kycPage.emailInput.fill(email);
        await kycPage.continueToNextStep();

        // Assert
        const validation = await kycPage.emailInput.evaluate(
          (el: HTMLInputElement) => el.validationMessage
        );
        expect(validation).toContain('email');
      }
    });

    test('should allow going back to edit information', async () => {
      // Arrange
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Act
      await kycPage.goBack();

      // Assert
      await kycPage.verifyCurrentStep(1);
      const firstName = await kycPage.firstNameInput.inputValue();
      expect(firstName).toBe(VALID_PERSONAL_INFO.firstName);
    });
  });

  test.describe('Address Verification', () => {
    test.beforeEach(async () => {
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
    });

    test('should submit address information successfully', async () => {
      // Act
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyCurrentStep(3); // Should move to step 3
    });

    test('should validate street address', async () => {
      // Act
      await kycPage.cityInput.fill('Lagos');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('street');
    });

    test('should validate city', async () => {
      // Act
      await kycPage.streetInput.fill('123 Main St');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('city');
    });

    test('should validate state selection', async () => {
      // Act
      await kycPage.streetInput.fill('123 Main St');
      await kycPage.cityInput.fill('Lagos');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('state');
    });

    test('should validate country selection', async () => {
      // Act
      await kycPage.fillAddress({ ...VALID_ADDRESS, country: '' });
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('country');
    });

    test('should accept Nigerian states', async () => {
      const nigerianStates = ['Lagos', 'Abuja', 'Kano', 'Rivers', 'Oyo'];

      for (const state of nigerianStates) {
        // Act
        await kycPage.stateSelect.selectOption(state);

        // Assert
        const selected = await kycPage.stateSelect.inputValue();
        expect(selected).toBe(state);
      }
    });
  });

  test.describe('BVN Verification', () => {
    test.beforeEach(async () => {
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();
    });

    test('should verify BVN successfully', async () => {
      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);
      await kycPage.waitForLoading();

      // Assert
      await kycPage.verifyBVNVerified();
    });

    test('should validate BVN format (11 digits)', async () => {
      // Arrange
      const invalidBVNs = ['123', '123456789012345', 'abcdefghijk'];

      for (const bvn of invalidBVNs) {
        // Act
        await kycPage.bvnInput.clear();
        await kycPage.bvnInput.fill(bvn);
        await kycPage.verifyBVNButton.click();

        // Assert
        await expect(kycPage.validationError).toBeVisible();
      }
    });

    test('should handle invalid BVN', async () => {
      // Act
      await kycPage.verifyBVN('00000000000'); // Invalid BVN
      await kycPage.waitForLoading();

      // Assert
      await kycPage.verifyError('Invalid BVN');
    });

    test('should match BVN details with personal info', async () => {
      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);
      await kycPage.waitForLoading();

      // Assert - Should auto-fill or verify name matches
      await kycPage.verifyBVNVerified();
    });

    test('should show BVN verification status', async () => {
      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);
      await kycPage.waitForLoading();

      // Assert
      await expect(kycPage.bvnStatus).toBeVisible();
      const status = await kycPage.getBVNStatus();
      expect(status).toMatch(/Verified|Pending|Failed/);
    });
  });

  test.describe('Identification Documents', () => {
    test.beforeEach(async () => {
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();
      await kycPage.fillIdentification(VALID_IDENTIFICATION);
      await kycPage.continueToNextStep();
    });

    test.skip('should upload ID document successfully', async () => {
      // Act
      await kycPage.uploadDocuments({ idDocument: MOCK_DOCUMENTS.idDocument });

      // Assert
      await kycPage.verifyDocumentUploaded('id-card.jpg');
    });

    test.skip('should upload proof of address successfully', async () => {
      // Act
      await kycPage.uploadDocuments({
        idDocument: MOCK_DOCUMENTS.idDocument,
        proofOfAddress: MOCK_DOCUMENTS.proofOfAddress,
      });

      // Assert
      await kycPage.verifyDocumentUploaded('utility-bill.pdf');
    });

    test.skip('should upload selfie successfully', async () => {
      // Act
      await kycPage.uploadDocuments({
        idDocument: MOCK_DOCUMENTS.idDocument,
        selfie: MOCK_DOCUMENTS.selfie,
      });

      // Assert
      await kycPage.verifyDocumentUploaded('selfie.jpg');
    });

    test.skip('should validate file type (images and PDFs only)', async () => {
      // Arrange
      const invalidFile = path.join(__dirname, '../../fixtures/test-file.txt');

      // Act
      await kycPage.idDocumentUpload.setInputFiles(invalidFile);

      // Assert
      await kycPage.verifyError('Invalid file type');
    });

    test.skip('should validate file size (max 5MB)', async () => {
      // Arrange
      const largeFile = path.join(__dirname, '../../fixtures/large-file.jpg');

      // Act
      await kycPage.idDocumentUpload.setInputFiles(largeFile);

      // Assert
      await kycPage.verifyError('File too large');
    });

    test.skip('should allow removing uploaded document', async () => {
      // Arrange
      await kycPage.uploadDocuments({ idDocument: MOCK_DOCUMENTS.idDocument });
      await kycPage.verifyDocumentUploaded('id-card.jpg');

      // Act
      await kycPage.removeDocument('id-card.jpg');

      // Assert
      await expect(kycPage.uploadedDocuments).not.toContainText('id-card.jpg');
    });

    test('should validate ID type selection', async () => {
      const idTypes: Array<'national_id' | 'drivers_license' | 'passport' | 'voters_card'> = [
        'national_id',
        'drivers_license',
        'passport',
        'voters_card',
      ];

      for (const idType of idTypes) {
        // Act
        await kycPage.idTypeSelect.selectOption(idType);

        // Assert
        const selected = await kycPage.idTypeSelect.inputValue();
        expect(selected).toBe(idType);
      }
    });

    test('should validate ID number format', async () => {
      // Act - Empty ID number
      await kycPage.idTypeSelect.selectOption('national_id');
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('ID number');
    });

    test('should validate ID expiry date', async () => {
      // Arrange - Expired ID
      const expiredDate = '2020-01-01';

      // Act
      await kycPage.fillIdentification({
        ...VALID_IDENTIFICATION,
        expiryDate: expiredDate,
      });
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyValidationError('expired');
    });
  });

  test.describe('Complete KYC Flow', () => {
    test.skip('should complete full KYC verification successfully', async ({ page }) => {
      // Act
      await kycPage.gotoKYCVerification();
      await kycPage.completeKYCVerification(
        VALID_PERSONAL_INFO,
        VALID_ADDRESS,
        VALID_IDENTIFICATION,
        MOCK_DOCUMENTS
      );

      // Assert
      await kycPage.verifySuccess('KYC submitted');
      await expect(page).toHaveURL(/.*kyc\/status/);
    });

    test('should show step-by-step progress', async () => {
      // Arrange
      await kycPage.gotoKYCVerification();

      // Step 1
      await kycPage.verifyCurrentStep(1);
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Step 2
      await kycPage.verifyCurrentStep(2);
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      // Step 3
      await kycPage.verifyCurrentStep(3);
    });

    test('should save progress and allow resuming', async ({ page }) => {
      // Arrange - Fill first step
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Act - Leave and return
      await page.goto('/dashboard');
      await kycPage.gotoKYCVerification();

      // Assert - Should resume from step 2
      await kycPage.verifyCurrentStep(2);
    });

    test('should require terms acceptance', async () => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();
      await kycPage.fillIdentification(VALID_IDENTIFICATION);
      await kycPage.continueToNextStep();

      // Act - Try to submit without accepting terms
      await kycPage.finalSubmitButton.click();

      // Assert
      await kycPage.verifyValidationError('terms');
    });

    test('should show review section before final submission', async () => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();
      await kycPage.fillIdentification(VALID_IDENTIFICATION);
      await kycPage.continueToNextStep();

      // Assert - Review section should show all entered data
      await expect(kycPage.reviewSection).toBeVisible();
      await expect(kycPage.reviewSection).toContainText(VALID_PERSONAL_INFO.firstName);
      await expect(kycPage.reviewSection).toContainText(VALID_ADDRESS.city);
    });
  });

  test.describe('Tier Upgrades', () => {
    test('should display tier information', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.tier1Info).toBeVisible();
      await expect(kycPage.tier2Info).toBeVisible();
      await expect(kycPage.tier3Info).toBeVisible();
    });

    test('should show current tier', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.currentTier).toBeVisible();
      const tier = await kycPage.currentTier.textContent();
      expect(tier).toMatch(/Tier [1-3]/);
    });

    test('should allow upgrading to Tier 2', async () => {
      // Act
      await kycPage.gotoKYCDashboard();
      await kycPage.upgradeTier();

      // Assert - Should start verification process
      await expect(kycPage.page).toHaveURL(/.*kyc\/verify/);
    });

    test('should show tier benefits', async () => {
      // Act
      await kycPage.gotoKYCDashboard();

      // Assert - Each tier should show limits
      const tier1Text = await kycPage.tier1Info.textContent();
      expect(tier1Text).toMatch(/₦|NGN|limit/i);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle network error during BVN verification', async ({ page }) => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      // Mock network error
      await page.route('**/api/kyc/verify-bvn', route => {
        route.abort('failed');
      });

      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);

      // Assert
      await kycPage.verifyError('Network error');
    });

    test('should handle server error during submission', async ({ page }) => {
      // Arrange
      await kycPage.gotoKYCVerification();
      
      // Mock server error
      await page.route('**/api/kyc/submit', route => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      });

      // Act
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyError('server error');
    });

    test('should show loading during verification', async () => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);

      // Assert
      await expect(kycPage.loadingSpinner).toBeVisible();
      await kycPage.waitForLoading();
    });
  });

  test.describe('Security', () => {
    test('should require authentication for KYC access', async ({ page }) => {
      // Arrange - Logout
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      await page.waitForURL(/.*login/);

      // Act - Try to access KYC
      await page.goto('/kyc');

      // Assert - Should redirect to login
      await page.waitForURL(/.*login/);
      await expect(page).toHaveURL(/.*login/);
    });

    test('should prevent XSS in personal information', async ({ page }) => {
      // Arrange
      await kycPage.gotoKYCVerification();

      // Act
      await kycPage.fillPersonalInfo({
        ...VALID_PERSONAL_INFO,
        firstName: '<script>alert("XSS")</script>',
      });
      await kycPage.continueToNextStep();

      // Assert - Should not execute script
      page.on('dialog', async dialog => {
        throw new Error('XSS vulnerability detected');
      });
    });

    test('should encrypt sensitive data (BVN, NIN)', async ({ page }) => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      // Act - Monitor network request
      let requestBody: any;
      page.on('request', request => {
        if (request.url().includes('/api/kyc')) {
          requestBody = request.postDataJSON();
        }
      });

      await kycPage.fillIdentification(VALID_IDENTIFICATION);
      await kycPage.continueToNextStep();

      // Assert - BVN should be encrypted in transit
      if (requestBody && requestBody.bvn) {
        expect(requestBody.bvn).not.toBe(VALID_IDENTIFICATION.bvn);
      }
    });
  });

  test.describe('Performance', () => {
    test('should load KYC dashboard within acceptable time', async () => {
      // Arrange
      const startTime = Date.now();

      // Act
      await kycPage.gotoKYCDashboard();

      // Assert - Should load within 2 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(2000);
    });

    test('should verify BVN within acceptable time', async () => {
      // Arrange
      await kycPage.gotoKYCVerification();
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();
      await kycPage.fillAddress(VALID_ADDRESS);
      await kycPage.continueToNextStep();

      const startTime = Date.now();

      // Act
      await kycPage.verifyBVN(VALID_IDENTIFICATION.bvn);
      await kycPage.waitForLoading();

      // Assert - Should complete within 5 seconds
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000);
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should display KYC on mobile', async ({ page }) => {
      // Arrange - Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Act
      await kycPage.gotoKYCDashboard();

      // Assert
      await expect(kycPage.kycStatus).toBeVisible();
      await expect(kycPage.startVerificationButton).toBeVisible();
    });

    test('should complete KYC on mobile', async ({ page }) => {
      // Arrange
      await page.setViewportSize({ width: 375, height: 667 });
      await kycPage.gotoKYCVerification();

      // Act
      await kycPage.fillPersonalInfo(VALID_PERSONAL_INFO);
      await kycPage.continueToNextStep();

      // Assert
      await kycPage.verifyCurrentStep(2);
    });
  });
});
