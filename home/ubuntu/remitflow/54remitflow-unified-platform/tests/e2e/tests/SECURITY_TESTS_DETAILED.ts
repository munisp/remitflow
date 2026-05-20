/**
 * Complete Security Test Suite - Money Transfer
 * 
 * Detailed implementation of security tests including:
 * - Authentication requirements
 * - PIN/Password confirmation for large transfers
 * - XSS (Cross-Site Scripting) prevention
 * - Data encryption in transit
 * - Audit logging
 * 
 * Focus: XSS Prevention in Narration Field
 */

import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { TransferPage, TransferData } from '../pages/TransferPage';

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

test.describe('Security - Money Transfer', () => {
  let loginPage: LoginPage;
  let transferPage: TransferPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    transferPage = new TransferPage(page);
    
    await loginPage.goto();
    await loginPage.loginAndWait(VALID_USER.email, VALID_USER.password);
  });

  /**
   * Test 1: Require Authentication for Transfer
   * 
   * Security Principle: Access Control
   * Ensures that only authenticated users can access the transfer page.
   * Unauthenticated users should be redirected to login.
   */
  test('should require authentication for transfer', async ({ page }) => {
    // Arrange - Logout to simulate unauthenticated state
    const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout"), [data-testid="logout-button"]');
    await logoutButton.click();
    await page.waitForURL(/.*login/, { timeout: 5000 });

    // Act - Try to access transfer page directly
    await page.goto('/transfer');

    // Assert - Should redirect to login page
    await page.waitForURL(/.*login/, { timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
    
    // Additional assertion - Transfer form should not be visible
    const transferForm = page.locator('form[data-testid="transfer-form"], form:has(input[name="recipientName"])');
    await expect(transferForm).not.toBeVisible();
  });

  /**
   * Test 2: Require PIN/Password Confirmation for Large Transfers
   * 
   * Security Principle: Transaction Authorization
   * Large transfers require additional authentication (PIN or password)
   * to prevent unauthorized transactions.
   * 
   * Threshold: Transfers > ₦500,000 require PIN confirmation
   */
  test('should require PIN/password confirmation for large transfers', async ({ page }) => {
    // Arrange - Create large transfer
    const largeTransfer: TransferData = {
      ...DOMESTIC_TRANSFER,
      amount: 500000, // ₦500,000 - Above threshold
    };

    await transferPage.gotoTransfer();
    await transferPage.fillTransferForm(largeTransfer);

    // Act - Submit transfer
    await transferPage.submitTransfer();

    // Assert - PIN confirmation modal should appear
    await expect(transferPage.pinConfirmationModal).toBeVisible({ timeout: 5000 });
    
    // Verify modal contains PIN input
    await expect(transferPage.pinInput).toBeVisible();
    
    // Verify modal title/message
    const modalText = await transferPage.pinConfirmationModal.textContent();
    expect(modalText).toMatch(/PIN|password|confirm|security/i);
    
    // Additional verification - Cannot proceed without PIN
    const confirmButtonInModal = transferPage.pinConfirmationModal.locator('button:has-text("Confirm")');
    await expect(confirmButtonInModal).toBeDisabled();
  });

  /**
   * Test 3: Prevent XSS (Cross-Site Scripting) in Narration Field
   * 
   * Security Principle: Input Sanitization & Output Encoding
   * 
   * XSS Attack Vectors Tested:
   * 1. <script> tags - Most common XSS vector
   * 2. Event handlers (onerror, onload, onclick)
   * 3. JavaScript protocol (javascript:)
   * 4. Data URIs with JavaScript
   * 5. HTML entities that decode to scripts
   * 
   * Defense Mechanisms:
   * - Input validation (reject dangerous characters)
   * - HTML encoding (convert < > to &lt; &gt;)
   * - Content Security Policy (CSP)
   * - No script execution in user input
   */
  test('should prevent XSS in narration field - Basic Script Tag', async ({ page }) => {
    // Arrange - Set up dialog listener to catch any alert() calls
    let dialogDetected = false;
    page.on('dialog', async dialog => {
      dialogDetected = true;
      console.error('XSS vulnerability detected! Alert dialog appeared:', dialog.message());
      await dialog.dismiss();
    });

    await transferPage.gotoTransfer();

    // Act - Attempt XSS with basic <script> tag
    const xssPayload = '<script>alert("XSS")</script>';
    await transferPage.fillTransferForm({
      ...DOMESTIC_TRANSFER,
      narration: xssPayload,
    });
    await transferPage.submitTransfer();

    // Wait a moment for any potential script execution
    await page.waitForTimeout(1000);

    // Assert - No dialog should have appeared
    expect(dialogDetected).toBe(false);
    
    // Verify the narration is displayed safely (HTML encoded)
    if (await transferPage.reviewSection.isVisible()) {
      const reviewText = await transferPage.reviewSection.textContent();
      // Script should be displayed as text, not executed
      // The < and > should be encoded or the script tag should be stripped
      expect(reviewText).not.toContain('<script>');
    }
  });

  /**
   * Test 4: Prevent XSS - Event Handler Injection
   * 
   * Tests prevention of XSS via HTML event handlers like:
   * - onerror
   * - onload
   * - onclick
   * - onmouseover
   */
  test('should prevent XSS via event handlers', async ({ page }) => {
    // Arrange
    let dialogDetected = false;
    page.on('dialog', async dialog => {
      dialogDetected = true;
      await dialog.dismiss();
    });

    await transferPage.gotoTransfer();

    // Act - Test multiple event handler vectors
    const xssPayloads = [
      '<img src=x onerror=alert("XSS")>',
      '<body onload=alert("XSS")>',
      '<div onclick=alert("XSS")>Click me</div>',
      '<input onfocus=alert("XSS") autofocus>',
      '<svg onload=alert("XSS")>',
    ];

    for (const payload of xssPayloads) {
      await transferPage.narrationInput.clear();
      await transferPage.narrationInput.fill(payload);
      await page.waitForTimeout(500);
    }

    await transferPage.submitTransfer();
    await page.waitForTimeout(1000);

    // Assert
    expect(dialogDetected).toBe(false);
  });

  /**
   * Test 5: Prevent XSS - JavaScript Protocol
   * 
   * Tests prevention of javascript: protocol in links
   */
  test('should prevent XSS via javascript protocol', async ({ page }) => {
    // Arrange
    let dialogDetected = false;
    page.on('dialog', async dialog => {
      dialogDetected = true;
      await dialog.dismiss();
    });

    await transferPage.gotoTransfer();

    // Act
    const xssPayloads = [
      'javascript:alert("XSS")',
      'JAVASCRIPT:alert("XSS")', // Case variation
      '&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert("XSS")', // HTML entities
    ];

    for (const payload of xssPayloads) {
      await transferPage.narrationInput.clear();
      await transferPage.narrationInput.fill(payload);
      await page.waitForTimeout(500);
    }

    await transferPage.submitTransfer();
    await page.waitForTimeout(1000);

    // Assert
    expect(dialogDetected).toBe(false);
  });

  /**
   * Test 6: Prevent XSS - Data URI with JavaScript
   * 
   * Tests prevention of data: URIs containing JavaScript
   */
  test('should prevent XSS via data URIs', async ({ page }) => {
    // Arrange
    let dialogDetected = false;
    page.on('dialog', async dialog => {
      dialogDetected = true;
      await dialog.dismiss();
    });

    await transferPage.gotoTransfer();

    // Act
    const xssPayload = 'data:text/html,<script>alert("XSS")</script>';
    await transferPage.fillTransferForm({
      ...DOMESTIC_TRANSFER,
      narration: xssPayload,
    });
    await transferPage.submitTransfer();
    await page.waitForTimeout(1000);

    // Assert
    expect(dialogDetected).toBe(false);
  });

  /**
   * Test 7: Verify HTML Encoding of User Input
   * 
   * Ensures that special HTML characters are properly encoded
   * when displayed back to the user.
   */
  test('should HTML encode special characters in narration', async ({ page }) => {
    // Arrange
    await transferPage.gotoTransfer();

    // Act - Input with special HTML characters
    const inputWithSpecialChars = '<div>Test & "quotes" \'apostrophe\'</div>';
    await transferPage.fillTransferForm({
      ...DOMESTIC_TRANSFER,
      narration: inputWithSpecialChars,
    });
    await transferPage.submitTransfer();

    // Assert - Characters should be encoded in review section
    if (await transferPage.reviewSection.isVisible()) {
      const reviewHTML = await transferPage.reviewSection.innerHTML();
      
      // Check that dangerous characters are encoded or stripped
      // < should become &lt; or be removed
      // > should become &gt; or be removed
      // & should become &amp;
      // " should become &quot;
      // ' should become &#x27; or &apos;
      
      // The actual <div> tags should not be present as HTML elements
      const reviewText = await transferPage.reviewSection.textContent();
      
      // If the system strips tags, we should see just the text
      // If it encodes, we should see &lt;div&gt;
      const hasRawHTML = reviewHTML.includes('<div>Test');
      expect(hasRawHTML).toBe(false);
    }
  });

  /**
   * Test 8: Verify Content Security Policy (CSP) Headers
   * 
   * Checks that the application has proper CSP headers
   * to prevent inline script execution.
   */
  test('should have Content Security Policy headers', async ({ page }) => {
    // Act - Navigate to transfer page
    const response = await page.goto('/transfer');

    // Assert - Check for CSP headers
    const headers = response?.headers();
    
    if (headers) {
      const csp = headers['content-security-policy'] || headers['x-content-security-policy'];
      
      // CSP should exist
      expect(csp).toBeDefined();
      
      // CSP should restrict script sources
      if (csp) {
        // Should not allow 'unsafe-inline' for scripts
        const hasUnsafeInline = csp.includes("'unsafe-inline'");
        
        // Should have script-src directive
        const hasScriptSrc = csp.includes('script-src');
        
        expect(hasScriptSrc).toBe(true);
        
        // Ideally, unsafe-inline should not be present
        // (though some apps may need it with nonces)
        console.log('CSP Header:', csp);
      }
    }
  });

  /**
   * Test 9: Prevent XSS - SQL Injection Attempt in Narration
   * 
   * While primarily testing XSS, also verify that SQL injection
   * attempts in the narration field don't cause issues.
   */
  test('should safely handle SQL injection attempts in narration', async ({ page }) => {
    // Arrange
    await transferPage.gotoTransfer();

    // Act - Common SQL injection payloads
    const sqlPayloads = [
      "'; DROP TABLE transfers; --",
      "' OR '1'='1",
      "admin'--",
      "' UNION SELECT * FROM users--",
    ];

    for (const payload of sqlPayloads) {
      await transferPage.narrationInput.clear();
      await transferPage.narrationInput.fill(payload);
      
      // Should not cause any JavaScript errors
      const errors: string[] = [];
      page.on('pageerror', error => {
        errors.push(error.message);
      });
      
      await transferPage.submitTransfer();
      await page.waitForTimeout(500);
      
      // No JavaScript errors should occur
      expect(errors.length).toBe(0);
      
      // Navigate back for next iteration
      if (sqlPayloads.indexOf(payload) < sqlPayloads.length - 1) {
        await transferPage.gotoTransfer();
      }
    }
  });

  /**
   * Test 10: Encrypt Sensitive Data in Transit
   * 
   * Security Principle: Data Protection
   * Ensures that sensitive data (account numbers, amounts)
   * are encrypted before being sent to the server.
   */
  test('should encrypt sensitive data in transit', async ({ page }) => {
    // Arrange
    await transferPage.gotoTransfer();
    await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

    // Act - Monitor network request
    let requestBody: any = null;
    let requestHeaders: any = null;
    
    page.on('request', request => {
      if (request.url().includes('/api/transfers') && request.method() === 'POST') {
        requestBody = request.postDataJSON();
        requestHeaders = request.headers();
      }
    });

    await transferPage.submitTransfer();
    await page.waitForTimeout(2000);

    // Assert - Sensitive data should be encrypted or hashed
    if (requestBody) {
      console.log('Request Body:', requestBody);
      
      // Account number should NOT be in plain text
      // It should be encrypted, hashed, or tokenized
      if (requestBody.recipientAccount) {
        const accountInRequest = requestBody.recipientAccount;
        const originalAccount = DOMESTIC_TRANSFER.recipientAccount;
        
        // If encryption is used, the values should differ
        // If tokenization is used, it should be a token format
        const isEncrypted = accountInRequest !== originalAccount;
        const isTokenized = accountInRequest.startsWith('tok_') || 
                           accountInRequest.startsWith('enc_') ||
                           accountInRequest.length > 20; // Encrypted data is longer
        
        // At least one protection method should be used
        expect(isEncrypted || isTokenized).toBe(true);
      }
      
      // Amount should be present but may be encrypted
      expect(requestBody.amount || requestBody.encryptedAmount).toBeDefined();
      
      // Check for HTTPS
      const url = page.url();
      expect(url).toMatch(/^https:/);
    }
    
    // Verify HTTPS is used
    if (requestHeaders) {
      // In production, all requests should use HTTPS
      console.log('Request Headers:', requestHeaders);
    }
  });

  /**
   * Test 11: Log Transfer Activity for Audit
   * 
   * Security Principle: Audit Trail
   * All transfer activities should be logged for security auditing
   * and compliance purposes.
   */
  test('should log transfer activity for audit', async ({ page }) => {
    // Arrange
    await transferPage.gotoTransfer();
    await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

    // Act - Complete transfer
    await transferPage.submitTransfer();
    await transferPage.confirmTransfer();
    await transferPage.waitForSuccess();

    // Navigate to activity/audit log
    await page.goto('/account/activity');
    await page.waitForLoadState('networkidle');

    // Assert - Transfer should be logged
    const activityLog = page.locator('.activity-log, [data-testid="activity-log"], .audit-trail');
    await expect(activityLog).toBeVisible();
    
    // Check for transfer entry
    const logText = await activityLog.textContent();
    expect(logText).toMatch(/transfer|sent|payment/i);
    expect(logText).toContain(DOMESTIC_TRANSFER.recipientName);
    
    // Verify timestamp is present
    expect(logText).toMatch(/\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}/); // Time or date format
    
    // Verify amount is logged
    expect(logText).toContain(DOMESTIC_TRANSFER.amount.toString());
  });

  /**
   * Test 12: Prevent CSRF (Cross-Site Request Forgery)
   * 
   * Security Principle: CSRF Protection
   * Ensures that transfer requests include CSRF tokens
   * to prevent unauthorized requests from malicious sites.
   */
  test('should include CSRF token in transfer request', async ({ page }) => {
    // Arrange
    await transferPage.gotoTransfer();
    await transferPage.fillTransferForm(DOMESTIC_TRANSFER);

    // Act - Monitor request headers
    let csrfToken: string | null = null;
    
    page.on('request', request => {
      if (request.url().includes('/api/transfers') && request.method() === 'POST') {
        const headers = request.headers();
        csrfToken = headers['x-csrf-token'] || 
                   headers['x-xsrf-token'] || 
                   headers['csrf-token'];
      }
    });

    await transferPage.submitTransfer();
    await page.waitForTimeout(2000);

    // Assert - CSRF token should be present
    expect(csrfToken).toBeTruthy();
    expect(csrfToken).not.toBe('');
    
    // Token should be a reasonable length (typically 32+ characters)
    if (csrfToken) {
      expect(csrfToken.length).toBeGreaterThanOrEqual(16);
    }
  });

  /**
   * Test 13: Prevent Clickjacking
   * 
   * Security Principle: Clickjacking Protection
   * Ensures X-Frame-Options or CSP frame-ancestors
   * headers prevent the page from being embedded in iframes.
   */
  test('should prevent clickjacking with X-Frame-Options', async ({ page }) => {
    // Act - Navigate to transfer page
    const response = await page.goto('/transfer');

    // Assert - Check for clickjacking protection headers
    const headers = response?.headers();
    
    if (headers) {
      const xFrameOptions = headers['x-frame-options'];
      const csp = headers['content-security-policy'];
      
      // Should have X-Frame-Options: DENY or SAMEORIGIN
      // OR CSP with frame-ancestors directive
      const hasXFrameOptions = xFrameOptions === 'DENY' || xFrameOptions === 'SAMEORIGIN';
      const hasFrameAncestors = csp?.includes('frame-ancestors');
      
      expect(hasXFrameOptions || hasFrameAncestors).toBe(true);
      
      console.log('X-Frame-Options:', xFrameOptions);
      console.log('CSP frame-ancestors:', hasFrameAncestors);
    }
  });

  /**
   * Test 14: Session Timeout for Security
   * 
   * Security Principle: Session Management
   * Sessions should timeout after period of inactivity
   * to prevent unauthorized access.
   */
  test('should timeout session after inactivity', async ({ page }) => {
    // Note: This test is conceptual - actual timeout may be 15-30 minutes
    // For testing purposes, we verify the mechanism exists
    
    // Arrange - Check if session timeout is configured
    await transferPage.gotoTransfer();
    
    // Check for session timeout warning or configuration
    // In a real app, you might:
    // 1. Wait for actual timeout (too long for tests)
    // 2. Check for timeout configuration in localStorage/sessionStorage
    // 3. Verify timeout warning appears before actual timeout
    
    const sessionData = await page.evaluate(() => {
      return {
        hasSessionTimeout: localStorage.getItem('sessionTimeout') !== null,
        hasLastActivity: localStorage.getItem('lastActivity') !== null,
      };
    });
    
    // At least one session management mechanism should exist
    console.log('Session Management:', sessionData);
    
    // This is a basic check - real implementation varies
    expect(sessionData.hasSessionTimeout || sessionData.hasLastActivity).toBeTruthy();
  });
});

/**
 * Helper function to test XSS with multiple payloads
 */
async function testXSSPayloads(
  page: Page,
  transferPage: TransferPage,
  payloads: string[]
): Promise<boolean> {
  let dialogDetected = false;
  
  page.on('dialog', async dialog => {
    dialogDetected = true;
    await dialog.dismiss();
  });

  for (const payload of payloads) {
    await transferPage.gotoTransfer();
    await transferPage.fillTransferForm({
      ...DOMESTIC_TRANSFER,
      narration: payload,
    });
    await transferPage.submitTransfer();
    await page.waitForTimeout(1000);
    
    if (dialogDetected) break;
  }
  
  return dialogDetected;
}

/**
 * XSS Payload Database for Comprehensive Testing
 * 
 * These payloads cover various XSS attack vectors:
 * - Basic script injection
 * - Event handlers
 * - Protocol handlers
 * - Encoding variations
 * - Obfuscation techniques
 */
export const XSS_PAYLOADS = {
  basic: [
    '<script>alert("XSS")</script>',
    '<SCRIPT>alert("XSS")</SCRIPT>',
    '<script>alert(String.fromCharCode(88,83,83))</script>',
  ],
  eventHandlers: [
    '<img src=x onerror=alert("XSS")>',
    '<body onload=alert("XSS")>',
    '<input onfocus=alert("XSS") autofocus>',
    '<select onfocus=alert("XSS") autofocus>',
    '<textarea onfocus=alert("XSS") autofocus>',
    '<iframe onload=alert("XSS")>',
    '<svg onload=alert("XSS")>',
    '<marquee onstart=alert("XSS")>',
  ],
  protocols: [
    'javascript:alert("XSS")',
    'data:text/html,<script>alert("XSS")</script>',
    'vbscript:msgbox("XSS")',
  ],
  encoded: [
    '&#60;script&#62;alert("XSS")&#60;/script&#62;',
    '&lt;script&gt;alert("XSS")&lt;/script&gt;',
    '%3Cscript%3Ealert("XSS")%3C/script%3E',
  ],
  obfuscated: [
    '<scr<script>ipt>alert("XSS")</scr</script>ipt>',
    '<<SCRIPT>alert("XSS");//<</SCRIPT>',
    '<script>eval(atob("YWxlcnQoIlhTUyIp"))</script>', // Base64: alert("XSS")
  ],
};
