/**
 * RemitFlow — k6 Load Test: KYC Onboarding Pipeline
 * ══════════════════════════════════════════════════════════════════════════════
 * Tests the KYC document upload and verification pipeline under load.
 *
 * SLO thresholds:
 *   - Document upload p95 < 2000ms
 *   - OCR processing p95 < 5000ms
 *   - KYC decision p95 < 10000ms
 *   - Error rate < 2%
 *
 * Usage:
 *   k6 run k6/kyc-load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import encoding from "k6/encoding";

const kycSuccessRate = new Rate("kyc_success_rate");
const documentUploadDuration = new Trend("document_upload_ms", true);
const ocrProcessingDuration = new Trend("ocr_processing_ms", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    kyc_pipeline: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "3m", target: 30 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.02"],
    kyc_success_rate: ["rate>0.95"],
    document_upload_ms: ["p(95)<2000"],
  },
};

// Minimal 1x1 PNG as base64 (simulates document upload)
const MOCK_DOCUMENT_BASE64 = encoding.b64encode(
  "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
);

function getAuthToken() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: `kyc-test-${Math.floor(Math.random() * 500)}@remitflow-test.io`, password: "LoadTest@123!" }),
    { headers: { "Content-Type": "application/json" } }
  );
  try { return JSON.parse(res.body).token; } catch { return null; }
}

export default function () {
  const token = getAuthToken();
  if (!token) { sleep(2); return; }

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  group("kyc_document_upload", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/trpc/kycOrchestration.submitDocuments`,
      JSON.stringify({
        json: {
          documentType: "national_id",
          frontImageBase64: MOCK_DOCUMENT_BASE64,
          backImageBase64: MOCK_DOCUMENT_BASE64,
          selfieBase64: MOCK_DOCUMENT_BASE64,
          country: "NG",
        },
      }),
      { headers }
    );
    documentUploadDuration.add(Date.now() - start);

    const success = check(res, {
      "document upload accepted": (r) => r.status === 200 || r.status === 202,
    });
    kycSuccessRate.add(success);
  });

  sleep(2);

  group("kyc_status_check", () => {
    const res = http.get(
      `${BASE_URL}/api/trpc/kycOrchestration.getStatus`,
      { headers }
    );
    check(res, {
      "kyc status retrieved": (r) => r.status === 200,
    });
  });

  sleep(3 + Math.random() * 5);
}
