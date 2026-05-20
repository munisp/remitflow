import http from 'k6/http';
import {{ check, sleep }} from 'k6';
import {{ Rate }} from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {{
  stages: [
    {{ duration: '2m', target: 100 }},  // Ramp up to 100 users
    {{ duration: '5m', target: 100 }},  // Stay at 100 users
    {{ duration: '2m', target: 200 }},  // Ramp up to 200 users
    {{ duration: '5m', target: 200 }},  // Stay at 200 users
    {{ duration: '2m', target: 0 }},    // Ramp down to 0 users
  ],
  thresholds: {{
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // Error rate under 1%
    errors: ['rate<0.1'],
  }},
}};

const BASE_URL = 'http://localhost:8000';

export function setup() {{
  // Login and get token
  const loginRes = http.post(`${{BASE_URL}}/api/v1/auth/login`, JSON.stringify({{
    email: 'test@example.com',
    password: 'Test123!@#'
  }}), {{
    headers: {{ 'Content-Type': 'application/json' }},
  }});
  
  return {{ token: loginRes.json('access_token') }};
}}

export default function(data) {{
  const headers = {{
    'Authorization': `Bearer ${{data.token}}`,
    'Content-Type': 'application/json',
  }};
  
  // Get quote
  let res = http.post(`${{BASE_URL}}/api/v1/payments/quote`, JSON.stringify({{
    amount: 1000,
    from_currency: 'USD',
    to_currency: 'NGN'
  }}), {{ headers }});
  
  check(res, {{
    'quote status is 200': (r) => r.status === 200,
    'quote has id': (r) => r.json('quote_id') !== undefined,
  }}) || errorRate.add(1);
  
  sleep(1);
  
  // View beneficiaries
  res = http.get(`${{BASE_URL}}/api/v1/beneficiaries`, {{ headers }});
  
  check(res, {{
    'beneficiaries status is 200': (r) => r.status === 200,
  }}) || errorRate.add(1);
  
  sleep(1);
}}
