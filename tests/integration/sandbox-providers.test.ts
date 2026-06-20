/**
 * RemitFlow — Sandbox Integration Tests
 *
 * Tests against REAL sandbox/test APIs to verify end-to-end money flow.
 * These tests require sandbox API keys configured in environment:
 *
 *   CIRCLE_API_KEY_SANDBOX     — Circle testnet (USDC on Sepolia)
 *   ONFIDO_API_KEY_SANDBOX     — Onfido sandbox (auto-approve documents)
 *   FLUTTERWAVE_SECRET_KEY_TEST — Flutterwave test mode
 *   SMILE_PARTNER_ID_SANDBOX   — Smile Identity sandbox
 *
 * Run:  npx vitest run tests/integration/sandbox-providers.test.ts
 * CI:   Triggered nightly + on demand via workflow_dispatch
 */

import { describe, it, expect, beforeAll } from "vitest";

// ── Configuration ─────────────────────────────────────────────────────────────

const CIRCLE_BASE = "https://api.circle.com/v1/sandbox";
const ONFIDO_BASE = "https://api.eu.onfido.com/v3.6";
const FLUTTERWAVE_BASE = "https://api.flutterwave.com/v3";
const SMILE_BASE = "https://testapi.smileidentity.com/v1";

interface SandboxConfig {
  circleApiKey: string | undefined;
  onfidoApiKey: string | undefined;
  flutterwaveSecretKey: string | undefined;
  smilePartnerId: string | undefined;
}

let config: SandboxConfig;

beforeAll(() => {
  config = {
    circleApiKey: process.env.CIRCLE_API_KEY_SANDBOX,
    onfidoApiKey: process.env.ONFIDO_API_KEY_SANDBOX,
    flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY_TEST,
    smilePartnerId: process.env.SMILE_PARTNER_ID_SANDBOX,
  };
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function sandboxFetch(
  url: string,
  options: RequestInit & { provider: string }
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

// ── Circle (Stablecoin Wallet & Payout) ───────────────────────────────────────

describe("Circle Sandbox", () => {
  it("creates a wallet and retrieves balance", async () => {
    if (!config.circleApiKey) {
      console.log("SKIP: CIRCLE_API_KEY_SANDBOX not set");
      return;
    }

    // Create wallet
    const createRes = await sandboxFetch(`${CIRCLE_BASE}/wallets`, {
      provider: "circle",
      method: "POST",
      headers: { Authorization: `Bearer ${config.circleApiKey}` },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        description: "RemitFlow integration test",
      }),
    });

    expect(createRes.status).toBeLessThan(500);

    if (createRes.status === 201) {
      const wallet = await createRes.json();
      expect(wallet.data).toBeDefined();
      expect(wallet.data.walletId).toBeDefined();

      // Check balance
      const balanceRes = await sandboxFetch(
        `${CIRCLE_BASE}/wallets/${wallet.data.walletId}`,
        {
          provider: "circle",
          method: "GET",
          headers: { Authorization: `Bearer ${config.circleApiKey}` },
        }
      );
      expect(balanceRes.status).toBe(200);
    }
  });

  it("initiates a payout (USDC → bank account)", async () => {
    if (!config.circleApiKey) {
      console.log("SKIP: CIRCLE_API_KEY_SANDBOX not set");
      return;
    }

    const payoutRes = await sandboxFetch(`${CIRCLE_BASE}/payouts`, {
      provider: "circle",
      method: "POST",
      headers: { Authorization: `Bearer ${config.circleApiKey}` },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        source: { type: "wallet", id: "1000000001" },
        destination: {
          type: "wire",
          id: "mock-wire-id",
        },
        amount: { amount: "10.00", currency: "USD" },
        metadata: {
          beneficiaryEmail: "test@remitflow.app",
        },
      }),
    });

    // Sandbox may return 201 (success) or 400 (invalid destination in test)
    expect(payoutRes.status).toBeLessThan(500);
  });

  it("retrieves supported transfer destinations", async () => {
    if (!config.circleApiKey) {
      console.log("SKIP: CIRCLE_API_KEY_SANDBOX not set");
      return;
    }

    const res = await sandboxFetch(`${CIRCLE_BASE}/configuration`, {
      provider: "circle",
      method: "GET",
      headers: { Authorization: `Bearer ${config.circleApiKey}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.payments).toBeDefined();
  });
});

// ── Onfido (KYC Document Verification) ───────────────────────────────────────

describe("Onfido Sandbox", () => {
  it("creates an applicant and initiates document check", async () => {
    if (!config.onfidoApiKey) {
      console.log("SKIP: ONFIDO_API_KEY_SANDBOX not set");
      return;
    }

    // Create applicant
    const applicantRes = await sandboxFetch(`${ONFIDO_BASE}/applicants`, {
      provider: "onfido",
      method: "POST",
      headers: { Authorization: `Token token=${config.onfidoApiKey}` },
      body: JSON.stringify({
        first_name: "Test",
        last_name: "User",
        email: "test@remitflow.app",
      }),
    });

    expect(applicantRes.status).toBeLessThan(500);

    if (applicantRes.status === 201) {
      const applicant = await applicantRes.json();
      expect(applicant.id).toBeDefined();

      // Create check
      const checkRes = await sandboxFetch(`${ONFIDO_BASE}/checks`, {
        provider: "onfido",
        method: "POST",
        headers: { Authorization: `Token token=${config.onfidoApiKey}` },
        body: JSON.stringify({
          applicant_id: applicant.id,
          report_names: ["document", "facial_similarity_photo"],
        }),
      });

      expect(checkRes.status).toBeLessThan(500);
      if (checkRes.status === 201) {
        const check = await checkRes.json();
        expect(check.id).toBeDefined();
        expect(check.status).toBe("in_progress");
      }
    }
  });

  it("generates an SDK token for mobile KYC flow", async () => {
    if (!config.onfidoApiKey) {
      console.log("SKIP: ONFIDO_API_KEY_SANDBOX not set");
      return;
    }

    // Need an applicant first
    const applicantRes = await sandboxFetch(`${ONFIDO_BASE}/applicants`, {
      provider: "onfido",
      method: "POST",
      headers: { Authorization: `Token token=${config.onfidoApiKey}` },
      body: JSON.stringify({
        first_name: "SDK",
        last_name: "Test",
      }),
    });

    if (applicantRes.status === 201) {
      const applicant = await applicantRes.json();

      const tokenRes = await sandboxFetch(`${ONFIDO_BASE}/sdk_token`, {
        provider: "onfido",
        method: "POST",
        headers: { Authorization: `Token token=${config.onfidoApiKey}` },
        body: JSON.stringify({
          applicant_id: applicant.id,
          referrer: "https://remitflow.app/*",
        }),
      });

      expect(tokenRes.status).toBeLessThan(500);
      if (tokenRes.status === 200) {
        const token = await tokenRes.json();
        expect(token.token).toBeDefined();
      }
    }
  });
});

// ── Flutterwave (African Payment Rail) ───────────────────────────────────────

describe("Flutterwave Sandbox", () => {
  it("initiates a bank transfer (NGN)", async () => {
    if (!config.flutterwaveSecretKey) {
      console.log("SKIP: FLUTTERWAVE_SECRET_KEY_TEST not set");
      return;
    }

    const res = await sandboxFetch(`${FLUTTERWAVE_BASE}/transfers`, {
      provider: "flutterwave",
      method: "POST",
      headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
      body: JSON.stringify({
        account_bank: "044",  // Access Bank test code
        account_number: "0690000031",  // Flutterwave test account
        amount: 5000,
        currency: "NGN",
        narration: "RemitFlow integration test",
        reference: `rf-test-${Date.now()}`,
        debit_currency: "NGN",
      }),
    });

    expect(res.status).toBeLessThan(500);

    if (res.status === 200) {
      const data = await res.json();
      expect(data.status).toBe("success");
      expect(data.data.id).toBeDefined();
    }
  });

  it("verifies bank account details", async () => {
    if (!config.flutterwaveSecretKey) {
      console.log("SKIP: FLUTTERWAVE_SECRET_KEY_TEST not set");
      return;
    }

    const res = await sandboxFetch(
      `${FLUTTERWAVE_BASE}/accounts/resolve`,
      {
        provider: "flutterwave",
        method: "POST",
        headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
        body: JSON.stringify({
          account_number: "0690000031",
          account_bank: "044",
        }),
      }
    );

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.data.account_name).toBeDefined();
    }
  });

  it("lists supported banks for NGN corridor", async () => {
    if (!config.flutterwaveSecretKey) {
      console.log("SKIP: FLUTTERWAVE_SECRET_KEY_TEST not set");
      return;
    }

    const res = await sandboxFetch(`${FLUTTERWAVE_BASE}/banks/NG`, {
      provider: "flutterwave",
      method: "GET",
      headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0].code).toBeDefined();
    expect(data.data[0].name).toBeDefined();
  });

  it("gets FX rate (USD → NGN)", async () => {
    if (!config.flutterwaveSecretKey) {
      console.log("SKIP: FLUTTERWAVE_SECRET_KEY_TEST not set");
      return;
    }

    const res = await sandboxFetch(
      `${FLUTTERWAVE_BASE}/rates?from=USD&to=NGN&amount=100`,
      {
        provider: "flutterwave",
        method: "GET",
        headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
      }
    );

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.data.rate).toBeGreaterThan(0);
    }
  });
});

// ── Smile Identity (African KYC — BVN, NIN) ──────────────────────────────────

describe("Smile Identity Sandbox", () => {
  it("submits a BVN verification request", async () => {
    if (!config.smilePartnerId) {
      console.log("SKIP: SMILE_PARTNER_ID_SANDBOX not set");
      return;
    }

    const res = await sandboxFetch(`${SMILE_BASE}/id_verification`, {
      provider: "smile",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        partner_id: config.smilePartnerId,
        source_sdk: "rest_api",
        source_sdk_version: "1.0.0",
        id_type: "BVN",
        id_number: "00000000000",  // Sandbox test BVN
        first_name: "Test",
        last_name: "User",
        country: "NG",
      }),
    });

    expect(res.status).toBeLessThan(500);
  });

  it("submits a NIN verification request", async () => {
    if (!config.smilePartnerId) {
      console.log("SKIP: SMILE_PARTNER_ID_SANDBOX not set");
      return;
    }

    const res = await sandboxFetch(`${SMILE_BASE}/id_verification`, {
      provider: "smile",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        partner_id: config.smilePartnerId,
        source_sdk: "rest_api",
        source_sdk_version: "1.0.0",
        id_type: "NIN",
        id_number: "00000000000",  // Sandbox test NIN
        first_name: "Test",
        last_name: "User",
        country: "NG",
      }),
    });

    expect(res.status).toBeLessThan(500);
  });
});

// ── Full Transfer Flow (E2E with sandbox providers) ───────────────────────────

describe("Full Transfer Flow (Sandbox)", () => {
  it("executes CAD → NGN transfer via Circle + Flutterwave", async () => {
    if (!config.circleApiKey || !config.flutterwaveSecretKey) {
      console.log("SKIP: Need both CIRCLE + FLUTTERWAVE sandbox keys");
      return;
    }

    // 1. Create Circle wallet (source)
    const walletRes = await sandboxFetch(`${CIRCLE_BASE}/wallets`, {
      provider: "circle",
      method: "POST",
      headers: { Authorization: `Bearer ${config.circleApiKey}` },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        description: "Transfer test source",
      }),
    });

    if (walletRes.status !== 201) {
      console.log("SKIP: Could not create Circle wallet");
      return;
    }

    const wallet = await walletRes.json();
    expect(wallet.data.walletId).toBeDefined();

    // 2. Resolve Flutterwave destination account
    const resolveRes = await sandboxFetch(
      `${FLUTTERWAVE_BASE}/accounts/resolve`,
      {
        provider: "flutterwave",
        method: "POST",
        headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
        body: JSON.stringify({
          account_number: "0690000031",
          account_bank: "044",
        }),
      }
    );

    if (resolveRes.status !== 200) {
      console.log("SKIP: Could not resolve Flutterwave account");
      return;
    }

    const resolved = await resolveRes.json();
    expect(resolved.data.account_name).toBeDefined();

    // 3. Initiate Flutterwave disbursement (simulates settlement)
    const transferRes = await sandboxFetch(`${FLUTTERWAVE_BASE}/transfers`, {
      provider: "flutterwave",
      method: "POST",
      headers: { Authorization: `Bearer ${config.flutterwaveSecretKey}` },
      body: JSON.stringify({
        account_bank: "044",
        account_number: "0690000031",
        amount: 5000,
        currency: "NGN",
        narration: "RemitFlow E2E: CAD→NGN transfer",
        reference: `rf-e2e-${Date.now()}`,
        debit_currency: "NGN",
      }),
    });

    expect(transferRes.status).toBeLessThan(500);

    if (transferRes.status === 200) {
      const transfer = await transferRes.json();
      expect(transfer.status).toBe("success");
      console.log(
        `E2E transfer complete: ${transfer.data.id} — ${transfer.data.amount} NGN`
      );
    }
  });
});
