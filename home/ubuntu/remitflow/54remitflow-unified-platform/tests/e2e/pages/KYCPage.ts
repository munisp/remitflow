/**
 * KYC (Know Your Customer) Page Object Model
 * 
 * Encapsulates all interactions with KYC verification pages
 */

import { Page, Locator, expect } from '@playwright/test';

export interface PersonalInfoData {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  gender?: 'male' | 'female' | 'other';
  phoneNumber: string;
  email: string;
  nationality?: string;
}

export interface AddressData {
  street: string;
  city: string;
  state: string;
  postalCode?: string;
  country: string;
}

export interface IdentificationData {
  bvn: string;
  nin?: string;
  idType: 'national_id' | 'drivers_license' | 'passport' | 'voters_card';
  idNumber: string;
  issueDate?: string;
  expiryDate?: string;
}

export interface DocumentUploadData {
  idDocument: string; // File path
  proofOfAddress?: string; // File path
  selfie?: string; // File path
}

export class KYCPage {
  readonly page: Page;
  
  // Navigation locators
  readonly kycDashboardLink: Locator;
  readonly startVerificationButton: Locator;
  readonly continueButton: Locator;
  readonly backButton: Locator;
  readonly submitButton: Locator;
  
  // Status display
  readonly kycStatus: Locator;
  readonly verificationLevel: Locator;
  readonly verificationProgress: Locator;
  readonly statusBadge: Locator;
  readonly limitInfo: Locator;
  
  // Personal Information form
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly middleNameInput: Locator;
  readonly dateOfBirthInput: Locator;
  readonly genderSelect: Locator;
  readonly phoneNumberInput: Locator;
  readonly emailInput: Locator;
  readonly nationalitySelect: Locator;
  
  // Address form
  readonly streetInput: Locator;
  readonly cityInput: Locator;
  readonly stateSelect: Locator;
  readonly postalCodeInput: Locator;
  readonly countrySelect: Locator;
  
  // Identification form
  readonly bvnInput: Locator;
  readonly verifyBVNButton: Locator;
  readonly bvnStatus: Locator;
  readonly ninInput: Locator;
  readonly idTypeSelect: Locator;
  readonly idNumberInput: Locator;
  readonly issueDateInput: Locator;
  readonly expiryDateInput: Locator;
  
  // Document upload
  readonly idDocumentUpload: Locator;
  readonly proofOfAddressUpload: Locator;
  readonly selfieUpload: Locator;
  readonly uploadedDocuments: Locator;
  readonly removeDocumentButton: Locator;
  
  // Verification steps
  readonly stepIndicator: Locator;
  readonly step1: Locator;
  readonly step2: Locator;
  readonly step3: Locator;
  readonly step4: Locator;
  
  // Status and feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly validationError: Locator;
  readonly loadingSpinner: Locator;
  readonly warningMessage: Locator;
  
  // Tier information
  readonly tier1Info: Locator;
  readonly tier2Info: Locator;
  readonly tier3Info: Locator;
  readonly currentTier: Locator;
  readonly upgradeButton: Locator;
  
  // Review and confirmation
  readonly reviewSection: Locator;
  readonly confirmCheckbox: Locator;
  readonly termsCheckbox: Locator;
  readonly finalSubmitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.kycDashboardLink = page.locator('a:has-text("KYC"), a:has-text("Verification"), [data-testid="kyc-link"]');
    this.startVerificationButton = page.locator('button:has-text("Start Verification"), button:has-text("Verify Now"), [data-testid="start-kyc"]');
    this.continueButton = page.locator('button:has-text("Continue"), button:has-text("Next")');
    this.backButton = page.locator('button:has-text("Back"), button:has-text("Previous")');
    this.submitButton = page.locator('button[type="submit"], button:has-text("Submit")');
    
    // Status display
    this.kycStatus = page.locator('[data-testid="kyc-status"], .kyc-status');
    this.verificationLevel = page.locator('[data-testid="verification-level"], .verification-level');
    this.verificationProgress = page.locator('[data-testid="verification-progress"], .progress-bar');
    this.statusBadge = page.locator('[data-testid="status-badge"], .status-badge');
    this.limitInfo = page.locator('[data-testid="limit-info"], .limit-info');
    
    // Personal information
    this.firstNameInput = page.locator('input[name="firstName"], #firstName');
    this.lastNameInput = page.locator('input[name="lastName"], #lastName');
    this.middleNameInput = page.locator('input[name="middleName"], #middleName');
    this.dateOfBirthInput = page.locator('input[name="dateOfBirth"], input[type="date"], #dateOfBirth');
    this.genderSelect = page.locator('select[name="gender"], #gender');
    this.phoneNumberInput = page.locator('input[name="phoneNumber"], input[name="phone"], #phoneNumber');
    this.emailInput = page.locator('input[name="email"], input[type="email"], #email');
    this.nationalitySelect = page.locator('select[name="nationality"], #nationality');
    
    // Address
    this.streetInput = page.locator('input[name="street"], input[name="address"], #street');
    this.cityInput = page.locator('input[name="city"], #city');
    this.stateSelect = page.locator('select[name="state"], #state');
    this.postalCodeInput = page.locator('input[name="postalCode"], input[name="zipCode"], #postalCode');
    this.countrySelect = page.locator('select[name="country"], #country');
    
    // Identification
    this.bvnInput = page.locator('input[name="bvn"], #bvn');
    this.verifyBVNButton = page.locator('button:has-text("Verify BVN"), button:has-text("Verify")');
    this.bvnStatus = page.locator('[data-testid="bvn-status"], .bvn-status, .verification-status');
    this.ninInput = page.locator('input[name="nin"], #nin');
    this.idTypeSelect = page.locator('select[name="idType"], #idType');
    this.idNumberInput = page.locator('input[name="idNumber"], #idNumber');
    this.issueDateInput = page.locator('input[name="issueDate"], #issueDate');
    this.expiryDateInput = page.locator('input[name="expiryDate"], #expiryDate');
    
    // Document upload
    this.idDocumentUpload = page.locator('input[name="idDocument"], input[type="file"]#idDocument');
    this.proofOfAddressUpload = page.locator('input[name="proofOfAddress"], input[type="file"]#proofOfAddress');
    this.selfieUpload = page.locator('input[name="selfie"], input[type="file"]#selfie');
    this.uploadedDocuments = page.locator('[data-testid="uploaded-documents"], .uploaded-documents');
    this.removeDocumentButton = page.locator('button:has-text("Remove"), button[aria-label="Remove document"]');
    
    // Verification steps
    this.stepIndicator = page.locator('[data-testid="step-indicator"], .step-indicator');
    this.step1 = page.locator('[data-testid="step-1"], .step-1');
    this.step2 = page.locator('[data-testid="step-2"], .step-2');
    this.step3 = page.locator('[data-testid="step-3"], .step-3');
    this.step4 = page.locator('[data-testid="step-4"], .step-4');
    
    // Status and feedback
    this.successMessage = page.locator('.success-message, .alert-success, [role="alert"].success');
    this.errorMessage = page.locator('.error-message, .alert-error, [role="alert"].error');
    this.validationError = page.locator('.field-error, .validation-error');
    this.loadingSpinner = page.locator('.spinner, .loading, [role="progressbar"]');
    this.warningMessage = page.locator('.warning-message, .alert-warning');
    
    // Tier information
    this.tier1Info = page.locator('[data-testid="tier-1"], .tier-1-info');
    this.tier2Info = page.locator('[data-testid="tier-2"], .tier-2-info');
    this.tier3Info = page.locator('[data-testid="tier-3"], .tier-3-info');
    this.currentTier = page.locator('[data-testid="current-tier"], .current-tier');
    this.upgradeButton = page.locator('button:has-text("Upgrade"), button:has-text("Upgrade Tier")');
    
    // Review and confirmation
    this.reviewSection = page.locator('[data-testid="review-section"], .review-section');
    this.confirmCheckbox = page.locator('input[name="confirm"], input[type="checkbox"]#confirm');
    this.termsCheckbox = page.locator('input[name="terms"], input[type="checkbox"]#terms');
    this.finalSubmitButton = page.locator('button:has-text("Submit for Verification"), button:has-text("Complete Verification")');
  }

  /**
   * Navigate to KYC dashboard
   */
  async gotoKYCDashboard() {
    await this.page.goto('/kyc');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to KYC verification page
   */
  async gotoKYCVerification() {
    await this.page.goto('/kyc/verify');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to KYC status page
   */
  async gotoKYCStatus() {
    await this.page.goto('/kyc/status');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Start KYC verification
   */
  async startVerification() {
    await this.startVerificationButton.click();
  }

  /**
   * Fill personal information
   */
  async fillPersonalInfo(data: PersonalInfoData) {
    await this.firstNameInput.fill(data.firstName);
    await this.lastNameInput.fill(data.lastName);
    
    if (data.middleName) {
      await this.middleNameInput.fill(data.middleName);
    }
    
    await this.dateOfBirthInput.fill(data.dateOfBirth);
    
    if (data.gender) {
      await this.genderSelect.selectOption(data.gender);
    }
    
    await this.phoneNumberInput.fill(data.phoneNumber);
    await this.emailInput.fill(data.email);
    
    if (data.nationality) {
      await this.nationalitySelect.selectOption(data.nationality);
    }
  }

  /**
   * Fill address information
   */
  async fillAddress(data: AddressData) {
    await this.streetInput.fill(data.street);
    await this.cityInput.fill(data.city);
    await this.stateSelect.selectOption(data.state);
    
    if (data.postalCode) {
      await this.postalCodeInput.fill(data.postalCode);
    }
    
    await this.countrySelect.selectOption(data.country);
  }

  /**
   * Fill identification information
   */
  async fillIdentification(data: IdentificationData) {
    await this.bvnInput.fill(data.bvn);
    
    if (data.nin) {
      await this.ninInput.fill(data.nin);
    }
    
    await this.idTypeSelect.selectOption(data.idType);
    await this.idNumberInput.fill(data.idNumber);
    
    if (data.issueDate) {
      await this.issueDateInput.fill(data.issueDate);
    }
    
    if (data.expiryDate) {
      await this.expiryDateInput.fill(data.expiryDate);
    }
  }

  /**
   * Verify BVN
   */
  async verifyBVN(bvn: string) {
    await this.bvnInput.fill(bvn);
    await this.verifyBVNButton.click();
  }

  /**
   * Upload documents
   */
  async uploadDocuments(data: DocumentUploadData) {
    await this.idDocumentUpload.setInputFiles(data.idDocument);
    
    if (data.proofOfAddress) {
      await this.proofOfAddressUpload.setInputFiles(data.proofOfAddress);
    }
    
    if (data.selfie) {
      await this.selfieUpload.setInputFiles(data.selfie);
    }
  }

  /**
   * Continue to next step
   */
  async continueToNextStep() {
    await this.continueButton.click();
  }

  /**
   * Go back to previous step
   */
  async goBack() {
    await this.backButton.click();
  }

  /**
   * Submit KYC verification
   */
  async submitVerification() {
    await this.submitButton.click();
  }

  /**
   * Complete full KYC verification flow
   */
  async completeKYCVerification(
    personalInfo: PersonalInfoData,
    address: AddressData,
    identification: IdentificationData,
    documents: DocumentUploadData
  ) {
    // Step 1: Personal Information
    await this.fillPersonalInfo(personalInfo);
    await this.continueToNextStep();
    
    // Step 2: Address
    await this.fillAddress(address);
    await this.continueToNextStep();
    
    // Step 3: Identification
    await this.fillIdentification(identification);
    await this.continueToNextStep();
    
    // Step 4: Documents
    await this.uploadDocuments(documents);
    
    // Review and submit
    await this.termsCheckbox.check();
    await this.confirmCheckbox.check();
    await this.finalSubmitButton.click();
  }

  /**
   * Get KYC status
   */
  async getKYCStatus(): Promise<string> {
    const text = await this.kycStatus.textContent();
    return text?.trim() || '';
  }

  /**
   * Get verification level
   */
  async getVerificationLevel(): Promise<string> {
    const text = await this.verificationLevel.textContent();
    return text?.trim() || '';
  }

  /**
   * Get BVN verification status
   */
  async getBVNStatus(): Promise<string> {
    const text = await this.bvnStatus.textContent();
    return text?.trim() || '';
  }

  /**
   * Verify KYC status
   */
  async verifyKYCStatus(expectedStatus: string) {
    await expect(this.kycStatus).toContainText(expectedStatus);
  }

  /**
   * Verify BVN verified
   */
  async verifyBVNVerified() {
    await expect(this.bvnStatus).toContainText(/Verified|Success/);
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
   * Verify current step
   */
  async verifyCurrentStep(stepNumber: number) {
    const step = this.page.locator(`[data-testid="step-${stepNumber}"], .step-${stepNumber}`);
    await expect(step).toHaveClass(/active|current/);
  }

  /**
   * Verify document uploaded
   */
  async verifyDocumentUploaded(documentName: string) {
    await expect(this.uploadedDocuments).toContainText(documentName);
  }

  /**
   * Remove uploaded document
   */
  async removeDocument(documentName: string) {
    const document = this.page.locator(`[data-testid="document"]:has-text("${documentName}")`);
    const removeButton = document.locator(this.removeDocumentButton);
    await removeButton.click();
  }

  /**
   * Upgrade to higher tier
   */
  async upgradeTier() {
    await this.upgradeButton.click();
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
