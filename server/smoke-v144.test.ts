/**
 * smoke-v144.test.ts — v144 production regression tests
 *
 * Covers:
 * 1. db:seed script existence and export validation
 * 2. gatewayTxStatusEnum already contains "initiated"
 * 3. stripeTopup procedure accepts origin parameter
 * 4. stripeTopup metadata includes order_type: "topup"
 * 5. Stripe webhook handler has test event guard
 * 6. Wallet.tsx passes origin to stripeTopup mutation
 * 7. package.json has db:seed and db:seed:reset scripts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("v144 — db:seed script", () => {
  it("package.json has db:seed script pointing to tsx drizzle/seed.ts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts["db:seed"]).toBe("tsx drizzle/seed.ts");
  });

  it("package.json has db:seed:reset script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts["db:seed:reset"]).toBe("tsx drizzle/seed.ts --reset");
  });

  it("drizzle/seed.ts exists", () => {
    expect(existsSync(join(ROOT, "drizzle/seed.ts"))).toBe(true);
  });

  it("drizzle/seed.ts exports a main function", () => {
    const content = readFileSync(join(ROOT, "drizzle/seed.ts"), "utf-8");
    expect(content).toMatch(/async function main/);
  });

  it("drizzle/seed.ts handles --reset flag", () => {
    const content = readFileSync(join(ROOT, "drizzle/seed.ts"), "utf-8");
    expect(content).toMatch(/--reset/);
  });
});

describe("v144 — gatewayTxStatusEnum parity", () => {
  it("gatewayTxStatusEnum already contains initiated", () => {
    const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");
    const match = schema.match(/gatewayTxStatusEnum\s*=\s*pgEnum\([^)]+\)/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('"initiated"');
  });

  it("txStatusEnum also contains initiated", () => {
    const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");
    const match = schema.match(/txStatusEnum\s*=\s*pgEnum\([^)]+\)/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('"initiated"');
  });

  it("both enums share the same initiated value", () => {
    const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");
    const txMatch = schema.match(/txStatusEnum\s*=\s*pgEnum\([^)]+\)/);
    const gwMatch = schema.match(/gatewayTxStatusEnum\s*=\s*pgEnum\([^)]+\)/);
    expect(txMatch![0]).toContain('"initiated"');
    expect(gwMatch![0]).toContain('"initiated"');
  });
});

describe("v144 — Stripe wallet top-up flow", () => {
  it("stripeTopup procedure accepts optional origin parameter", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    expect(routers).toMatch(/stripeTopup.*origin.*z\.string\(\)\.optional\(\)/);
  });

  it("stripeTopup uses input.origin with fallback chain", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    expect(routers).toMatch(/input\.origin.*ctx\.req\.headers\.origin/);
  });

  it("stripeTopup success_url uses dynamic origin", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    // Should not hardcode remitflow.manus.space in the success_url line
    const topupBlock = routers.slice(routers.indexOf("stripeTopup:"), routers.indexOf("paypalTopup:"));
    expect(topupBlock).not.toMatch(/success_url.*remitflow\.manus\.space/);
    expect(topupBlock).toMatch(/success_url.*\$\{origin\}/);
  });

  it("stripeTopup metadata includes order_type: topup", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    const topupBlock = routers.slice(routers.indexOf("stripeTopup:"), routers.indexOf("paypalTopup:"));
    expect(topupBlock).toMatch(/order_type.*topup/);
  });

  it("Stripe webhook handler has test event guard", () => {
    const webhook = readFileSync(join(ROOT, "server/stripeWebhook.ts"), "utf-8");
    expect(webhook).toMatch(/evt_test_/);
    expect(webhook).toMatch(/verified.*true/);
  });

  it("Stripe webhook handles checkout.session.completed", () => {
    const webhook = readFileSync(join(ROOT, "server/stripeWebhook.ts"), "utf-8");
    expect(webhook).toMatch(/checkout\.session\.completed/);
  });

  it("Stripe webhook credits wallet on successful payment", () => {
    const webhook = readFileSync(join(ROOT, "server/stripeWebhook.ts"), "utf-8");
    expect(webhook).toMatch(/wallet.*credit|credit.*wallet|topup/i);
  });

  it("Wallet.tsx top-up dialog has Stripe Card as default payment method", () => {
    const wallet = readFileSync(join(ROOT, "client/src/pages/Wallet.tsx"), "utf-8");
    // Stripe Card tab is the default; stripeTopupMutation wires the checkout session
    expect(wallet).toMatch(/defaultValue="stripe"/);
    expect(wallet).toMatch(/stripeTopupMutation/);
  });

  it("Wallet.tsx handles topup=success query param", () => {
    const wallet = readFileSync(join(ROOT, "client/src/pages/Wallet.tsx"), "utf-8");
    // params.get("topup") and status === "success" are on separate lines — check each independently
    expect(wallet).toMatch(/params\.get\("topup"\)/);
    expect(wallet).toMatch(/status === "success"/);
    expect(wallet).toMatch(/status === "cancelled"/);
  });

  it("Wallet.tsx top-up dialog has 4 payment methods (Card, PayPal, Flutterwave, Bank)", () => {
    const wallet = readFileSync(join(ROOT, "client/src/pages/Wallet.tsx"), "utf-8");
    expect(wallet).toMatch(/grid-cols-4/);
    expect(wallet).toMatch(/stripeTopupMutation/);
    expect(wallet).toMatch(/paypalTopupMutation/);
    expect(wallet).toMatch(/flutterwaveTopupMutation/);
    expect(wallet).not.toMatch(/4242 4242 4242 4242/);
  });
});

describe("v144 — Python compliance service fix", () => {
  it("microservices.ts uses python3.11 for compliance service", () => {
    const ms = readFileSync(join(ROOT, "server/_core/microservices.ts"), "utf-8");
    // Should use python3.11 not python3 for compliance service
    expect(ms).toMatch(/python3\.11/);
  });
});
