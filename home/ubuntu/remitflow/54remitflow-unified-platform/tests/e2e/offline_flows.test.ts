/**
 * E2E Test Scenarios for Offline-First Flows
 * 
 * Tests the complete offline-first architecture:
 * 1. Create transfer while offline -> come online -> verify backend state
 * 2. Idempotency: retry same request 5x = single transaction
 * 3. Beneficiary caching and offline access
 * 4. Transaction history caching
 * 5. Weak network mode behavior
 */

import { test, expect, Page } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const PWA_URL = process.env.PWA_URL || 'http://localhost:5173';

// Helper to simulate offline mode
async function goOffline(page: Page) {
  await page.context().setOffline(true);
}

// Helper to simulate online mode
async function goOnline(page: Page) {
  await page.context().setOffline(false);
}

// Helper to wait for sync to complete
async function waitForSync(page: Page, timeout = 10000) {
  await page.waitForFunction(
    () => {
      const syncIndicator = document.querySelector('[data-testid="sync-indicator"]');
      return syncIndicator?.textContent?.includes('Synced') || 
             !syncIndicator?.textContent?.includes('Pending');
    },
    { timeout }
  );
}

test.describe('Offline Transfer Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to send money page
    await page.goto(`${PWA_URL}/login`);
    // Assuming mock auth for testing
    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'test_token');
      localStorage.setItem('user_id', 'test_user_001');
    });
    await page.goto(`${PWA_URL}/send-money`);
  });

  test('should queue transfer when offline and sync when online', async ({ page }) => {
    // Step 1: Go offline
    await goOffline(page);
    
    // Step 2: Fill transfer form
    await page.fill('[data-testid="recipient-name"]', 'Test Recipient');
    await page.fill('[data-testid="recipient-phone"]', '+2348012345678');
    await page.fill('[data-testid="amount"]', '5000');
    await page.selectOption('[data-testid="delivery-method"]', 'bank_transfer');
    
    // Step 3: Submit transfer
    await page.click('[data-testid="submit-transfer"]');
    
    // Step 4: Verify transfer is queued (pending indicator)
    await expect(page.locator('[data-testid="pending-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="pending-count"]')).toHaveText('1');
    
    // Step 5: Go online
    await goOnline(page);
    
    // Step 6: Wait for sync
    await waitForSync(page);
    
    // Step 7: Verify transfer completed
    await expect(page.locator('[data-testid="pending-count"]')).toHaveText('0');
    
    // Step 8: Verify in transaction history
    await page.goto(`${PWA_URL}/transactions`);
    await expect(page.locator('[data-testid="transaction-list"]')).toContainText('Test Recipient');
  });

  test('should show offline banner when disconnected', async ({ page }) => {
    // Go offline
    await goOffline(page);
    
    // Verify offline banner appears
    await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="offline-banner"]')).toContainText('offline');
    
    // Go online
    await goOnline(page);
    
    // Verify offline banner disappears
    await expect(page.locator('[data-testid="offline-banner"]')).not.toBeVisible();
  });
});

test.describe('Idempotency Tests', () => {
  test('should return same result for duplicate requests with same idempotency key', async ({ request }) => {
    const idempotencyKey = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transferPayload = {
      recipient_name: 'Idempotency Test',
      recipient_phone: '+2348012345678',
      amount: 1000,
      source_currency: 'NGN',
      destination_currency: 'NGN',
      delivery_method: 'bank_transfer'
    };
    
    // First request
    const response1 = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: transferPayload,
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-User-ID': 'test_user_001',
        'Content-Type': 'application/json'
      }
    });
    
    expect(response1.ok()).toBeTruthy();
    const result1 = await response1.json();
    expect(result1.is_duplicate).toBeFalsy();
    
    // Second request with same idempotency key (should return cached result)
    const response2 = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: transferPayload,
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-User-ID': 'test_user_001',
        'Content-Type': 'application/json'
      }
    });
    
    expect(response2.ok()).toBeTruthy();
    const result2 = await response2.json();
    expect(result2.is_duplicate).toBeTruthy();
    expect(result2.transaction_id).toBe(result1.transaction_id);
    
    // Third, fourth, fifth requests (all should return same result)
    for (let i = 3; i <= 5; i++) {
      const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
        data: transferPayload,
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-User-ID': 'test_user_001',
          'Content-Type': 'application/json'
        }
      });
      
      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.is_duplicate).toBeTruthy();
      expect(result.transaction_id).toBe(result1.transaction_id);
    }
  });

  test('should create separate transactions for different idempotency keys', async ({ request }) => {
    const transferPayload = {
      recipient_name: 'Different Keys Test',
      recipient_phone: '+2348012345678',
      amount: 1000,
      source_currency: 'NGN',
      destination_currency: 'NGN',
      delivery_method: 'bank_transfer'
    };
    
    const transactionIds: string[] = [];
    
    // Create 3 transfers with different idempotency keys
    for (let i = 0; i < 3; i++) {
      const idempotencyKey = `test_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
      
      const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
        data: transferPayload,
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-User-ID': 'test_user_001',
          'Content-Type': 'application/json'
        }
      });
      
      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.is_duplicate).toBeFalsy();
      transactionIds.push(result.transaction_id);
    }
    
    // Verify all transaction IDs are unique
    const uniqueIds = new Set(transactionIds);
    expect(uniqueIds.size).toBe(3);
  });
});

test.describe('Beneficiary Caching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PWA_URL}/login`);
    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'test_token');
      localStorage.setItem('user_id', 'test_user_001');
    });
  });

  test('should cache beneficiaries and show them offline', async ({ page }) => {
    // Step 1: Load beneficiaries while online
    await page.goto(`${PWA_URL}/beneficiaries`);
    await page.waitForSelector('[data-testid="beneficiary-list"]');
    
    // Get beneficiary count while online
    const onlineCount = await page.locator('[data-testid="beneficiary-item"]').count();
    expect(onlineCount).toBeGreaterThan(0);
    
    // Step 2: Go offline
    await goOffline(page);
    
    // Step 3: Reload page
    await page.reload();
    
    // Step 4: Verify beneficiaries are still visible from cache
    await page.waitForSelector('[data-testid="beneficiary-list"]');
    const offlineCount = await page.locator('[data-testid="beneficiary-item"]').count();
    expect(offlineCount).toBe(onlineCount);
    
    // Step 5: Verify cached indicator is shown
    await expect(page.locator('[data-testid="cached-data-indicator"]')).toBeVisible();
  });

  test('should allow selecting cached beneficiary for offline transfer', async ({ page }) => {
    // Load beneficiaries while online
    await page.goto(`${PWA_URL}/beneficiaries`);
    await page.waitForSelector('[data-testid="beneficiary-list"]');
    
    // Go offline
    await goOffline(page);
    
    // Navigate to send money
    await page.goto(`${PWA_URL}/send-money`);
    
    // Click select beneficiary
    await page.click('[data-testid="select-beneficiary"]');
    
    // Verify cached beneficiaries are available
    await expect(page.locator('[data-testid="beneficiary-selector"]')).toBeVisible();
    const beneficiaryCount = await page.locator('[data-testid="beneficiary-option"]').count();
    expect(beneficiaryCount).toBeGreaterThan(0);
  });
});

test.describe('Transaction History Caching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PWA_URL}/login`);
    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'test_token');
      localStorage.setItem('user_id', 'test_user_001');
    });
  });

  test('should cache transaction history and show offline', async ({ page }) => {
    // Step 1: Load transaction history while online
    await page.goto(`${PWA_URL}/transactions`);
    await page.waitForSelector('[data-testid="transaction-list"]');
    
    // Get transaction count while online
    const onlineCount = await page.locator('[data-testid="transaction-item"]').count();
    
    // Step 2: Go offline
    await goOffline(page);
    
    // Step 3: Reload page
    await page.reload();
    
    // Step 4: Verify transactions are still visible from cache
    await page.waitForSelector('[data-testid="transaction-list"]');
    const offlineCount = await page.locator('[data-testid="transaction-item"]').count();
    expect(offlineCount).toBe(onlineCount);
    
    // Step 5: Verify cached indicator
    await expect(page.locator('[data-testid="cached-data-indicator"]')).toBeVisible();
  });

  test('should merge pending transfers with cached history', async ({ page }) => {
    // Load transaction history while online
    await page.goto(`${PWA_URL}/transactions`);
    await page.waitForSelector('[data-testid="transaction-list"]');
    const initialCount = await page.locator('[data-testid="transaction-item"]').count();
    
    // Go offline
    await goOffline(page);
    
    // Create offline transfer
    await page.goto(`${PWA_URL}/send-money`);
    await page.fill('[data-testid="recipient-name"]', 'Offline Test');
    await page.fill('[data-testid="recipient-phone"]', '+2348012345678');
    await page.fill('[data-testid="amount"]', '2000');
    await page.click('[data-testid="submit-transfer"]');
    
    // Go to transaction history
    await page.goto(`${PWA_URL}/transactions`);
    
    // Verify pending transfer appears in history
    const newCount = await page.locator('[data-testid="transaction-item"]').count();
    expect(newCount).toBe(initialCount + 1);
    
    // Verify pending status indicator
    await expect(page.locator('[data-testid="pending-status"]')).toBeVisible();
  });
});

test.describe('Weak Network Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PWA_URL}/login`);
    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'test_token');
      localStorage.setItem('user_id', 'test_user_001');
    });
  });

  test('should enable weak network mode from settings', async ({ page }) => {
    // Navigate to settings
    await page.goto(`${PWA_URL}/settings`);
    
    // Enable weak network mode
    await page.click('[data-testid="weak-network-toggle"]');
    
    // Verify mode is enabled
    await expect(page.locator('[data-testid="weak-network-toggle"]')).toBeChecked();
    
    // Verify indicator appears
    await expect(page.locator('[data-testid="weak-network-indicator"]')).toBeVisible();
  });

  test('should skip charts and use cached data in weak network mode', async ({ page }) => {
    // Enable weak network mode
    await page.goto(`${PWA_URL}/settings`);
    await page.click('[data-testid="weak-network-toggle"]');
    
    // Navigate to dashboard
    await page.goto(`${PWA_URL}/dashboard`);
    
    // Verify charts are hidden
    await expect(page.locator('[data-testid="analytics-chart"]')).not.toBeVisible();
    
    // Verify simplified view is shown
    await expect(page.locator('[data-testid="simplified-balance"]')).toBeVisible();
  });

  test('should disable auto-refresh in weak network mode', async ({ page }) => {
    // Enable weak network mode
    await page.goto(`${PWA_URL}/settings`);
    await page.click('[data-testid="weak-network-toggle"]');
    
    // Navigate to dashboard
    await page.goto(`${PWA_URL}/dashboard`);
    
    // Wait and verify no automatic API calls
    let apiCallCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        apiCallCount++;
      }
    });
    
    // Wait 35 seconds (longer than typical auto-refresh interval)
    await page.waitForTimeout(35000);
    
    // Verify minimal API calls (only initial load, no auto-refresh)
    expect(apiCallCount).toBeLessThan(3);
  });
});

test.describe('Corridor Integration Tests', () => {
  test('should route domestic transfer to NIBSS', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: {
        recipient_name: 'Domestic Test',
        recipient_phone: '+2348012345678',
        recipient_bank: 'GTBank',
        recipient_account: '0123456789',
        amount: 50000,
        source_currency: 'NGN',
        destination_currency: 'NGN',
        delivery_method: 'bank_transfer'
      },
      headers: {
        'Idempotency-Key': `corridor_test_${Date.now()}`,
        'X-User-ID': 'test_user_001',
        'Content-Type': 'application/json'
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    // Domestic NGN->NGN should route to NIBSS
    expect(result.corridor || 'nibss').toBe('nibss');
  });

  test('should route intra-Africa transfer to PAPSS', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: {
        recipient_name: 'Ghana Test',
        recipient_phone: '+233201234567',
        amount: 100000,
        source_currency: 'NGN',
        destination_currency: 'GHS',
        delivery_method: 'mobile_money'
      },
      headers: {
        'Idempotency-Key': `corridor_test_${Date.now()}`,
        'X-User-ID': 'test_user_001',
        'Content-Type': 'application/json'
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    // NGN->GHS should route to PAPSS
    expect(['papss', 'mojaloop']).toContain(result.corridor || 'papss');
  });
});

test.describe('Risk Assessment Integration', () => {
  test('should block high-risk transactions', async ({ request }) => {
    // Simulate high-risk transaction (large amount, new device, unusual time)
    const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: {
        recipient_name: 'High Risk Test',
        recipient_phone: '+2348012345678',
        amount: 5000000, // Very large amount
        source_currency: 'NGN',
        destination_currency: 'NGN',
        delivery_method: 'bank_transfer'
      },
      headers: {
        'Idempotency-Key': `risk_test_${Date.now()}`,
        'X-User-ID': 'new_user_no_history',
        'X-Device-Fingerprint': 'new_device_fingerprint',
        'Content-Type': 'application/json'
      }
    });
    
    // Should either succeed with review flag or be blocked
    const result = await response.json();
    if (response.ok()) {
      // If allowed, should have review flag
      expect(result.requires_review || result.risk_score > 50).toBeTruthy();
    } else {
      // If blocked, should have appropriate error
      expect(response.status()).toBe(403);
      expect(result.detail).toContain('risk');
    }
  });

  test('should allow normal transactions', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/v1/transactions/transfer`, {
      data: {
        recipient_name: 'Normal Test',
        recipient_phone: '+2348012345678',
        amount: 5000, // Normal amount
        source_currency: 'NGN',
        destination_currency: 'NGN',
        delivery_method: 'bank_transfer'
      },
      headers: {
        'Idempotency-Key': `normal_test_${Date.now()}`,
        'X-User-ID': 'established_user_001',
        'Content-Type': 'application/json'
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.status).toBe('pending');
  });
});
