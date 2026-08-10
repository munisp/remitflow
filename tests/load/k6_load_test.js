import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const txLatency = new Trend('transaction_latency');
const complianceLatency = new Trend('compliance_latency');

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 100 },   // Stay at 100 users
    { duration: '2m', target: 500 },   // Ramp up to 500 users
    { duration: '5m', target: 500 },   // Stay at 500 users
    { duration: '2m', target: 1000 },  // Ramp up to 1000 users
    { duration: '5m', target: 1000 },  // Stay at 1000 users
    { duration: '2m', target: 2000 },  // Ramp up to 2000 users
    { duration: '5m', target: 2000 },  // Stay at 2000 users
    { duration: '2m', target: 5000 },  // Ramp up to 5000 users
    { duration: '5m', target: 5000 },  // Stay at 5000 users
    { duration: '2m', target: 10000 }, // Ramp up to 10000 users
    { duration: '5m', target: 10000 }, // Stay at 10000 users
    { duration: '5m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // Error rate under 1%
    errors: ['rate<0.01'],
    transaction_latency: ['p(95)<1000'],
    compliance_latency: ['p(95)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8081';
const COMPLIANCE_URL = __ENV.COMPLIANCE_URL || 'http://localhost:8097';

export default function () {
  group('Health Checks', () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health status is 200': (r) => r.status === 200,
      'health response ok': (r) => r.json('status') === 'ok',
    });
    errorRate.add(res.status !== 200);
  });

  group('Transaction Creation', () => {
    const payload = JSON.stringify({
      sender_account_id: `sender-${__VU}-${__ITER}`,
      receiver_account_id: `receiver-${__VU}-${__ITER}`,
      amount: Math.random() * 1000 + 10,
      currency: 'USD',
      reference: `load-test-${Date.now()}`,
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/transactions`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    txLatency.add(Date.now() - start);

    check(res, {
      'tx status is 200 or 400': (r) => r.status === 200 || r.status === 400,
      'tx response has data': (r) => r.json('success') !== undefined,
    });
    errorRate.add(res.status >= 500);
  });

  group('Compliance Screening', () => {
    const payload = JSON.stringify({
      transaction_id: `tx-${__VU}-${__ITER}`,
      amount_usd: Math.random() * 5000 + 100,
      sender_country: 'GB',
      receiver_country: 'NG',
      sender_name: 'Test Sender',
      receiver_name: 'Test Receiver',
    });

    const start = Date.now();
    const res = http.post(`${COMPLIANCE_URL}/compliance/score`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    complianceLatency.add(Date.now() - start);

    check(res, {
      'compliance returns 200 or 503': (r) => r.status === 200 || r.status === 503,
    });
    errorRate.add(res.status >= 500 && res.status !== 503);
  });

  group('Account Lookup', () => {
    const res = http.get(`${BASE_URL}/accounts/account-${__VU}`);
    check(res, {
      'account lookup returns valid status': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(Math.random() * 2 + 1); // Think time 1-3 seconds
}
