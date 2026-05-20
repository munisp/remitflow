// K6 Load Test for TigerBeetle Services
// Run with: k6 run load-test.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const transferDuration = new Trend('transfer_duration');
const accountDuration = new Trend('account_duration');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
    http_req_failed: ['rate<0.01'],                  // Error rate < 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:8091';

// Generate random ID
function randomId() {
  return Math.floor(Math.random() * 1000000000);
}

// Create account
function createAccount() {
  const accountId = randomId();
  const payload = JSON.stringify({
    id: accountId,
    ledger: 1,
    code: Math.floor(Math.random() * 8) + 1,
    user_data: 0,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/accounts`, payload, params);
  const duration = Date.now() - start;

  accountDuration.add(duration);

  const success = check(res, {
    'account created': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(!success);

  return accountId;
}

// Create transfer
function createTransfer(debitId, creditId) {
  const transferId = randomId();
  const payload = JSON.stringify({
    id: transferId,
    debit_account_id: debitId,
    credit_account_id: creditId,
    amount: Math.floor(Math.random() * 100000) + 1000,
    ledger: 1,
    code: 1,
    flags: 0,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/transfers`, payload, params);
  const duration = Date.now() - start;

  transferDuration.add(duration);

  const success = check(res, {
    'transfer created': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(!success);
}

// Create pending transfer
function createPendingTransfer(debitId, creditId) {
  const transferId = randomId();
  const payload = JSON.stringify({
    id: transferId,
    debit_account_id: debitId,
    credit_account_id: creditId,
    amount: Math.floor(Math.random() * 100000) + 1000,
    ledger: 1,
    timeout: 3600,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(`${BASE_URL}/transfers/pending`, payload, params);

  const success = check(res, {
    'pending transfer created': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(!success);

  return transferId;
}

// Post pending transfer
function postPendingTransfer(transferId) {
  const res = http.post(`${BASE_URL}/transfers/pending/${transferId}/post`);

  const success = check(res, {
    'pending transfer posted': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(!success);
}

// Main test scenario
export default function () {
  // Create two accounts
  const account1 = createAccount();
  const account2 = createAccount();

  sleep(0.1);

  // Create simple transfer
  createTransfer(account1, account2);

  sleep(0.1);

  // Create pending transfer and post it
  const pendingTransferId = createPendingTransfer(account1, account2);
  sleep(0.5);
  postPendingTransfer(pendingTransferId);

  sleep(1);
}

// Setup function (runs once at start)
export function setup() {
  console.log('Starting TigerBeetle load test...');
  
  // Health check
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'service is healthy': (r) => r.status === 200,
  });
}

// Teardown function (runs once at end)
export function teardown(data) {
  console.log('Load test completed!');
}

