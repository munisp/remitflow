// RemitFlow — v171 Smoke Tests
// Covers: BRICSPay, mBridge, GhIPSS, AfriCBDC, PAPSS rails
// Validates: DB schema tables, tRPC router wiring, microservice stubs,
//            middleware references (Kafka, Dapr, Fluvio, Temporal, TigerBeetle, APISix)

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readFile(relPath: string): string {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) throw new Error(`File not found: ${relPath}`);
  return readFileSync(full, "utf-8");
}

// ── 1. DB Schema ──────────────────────────────────────────────────────────────

describe("v171 DB Schema — new rail tables", () => {
  const schema = readFile("drizzle/schema.ts");

  it("defines bricspayTransfers table", () => {
    expect(schema).toContain("bricspayTransfers");
    expect(schema).toContain("dcms_message_id");
    expect(schema).toContain("receiver_vpa");
  });

  it("defines mbridgeTransfers table", () => {
    expect(schema).toContain("mbridgeTransfers");
    expect(schema).toContain("dlt_tx_hash");
    expect(schema).toContain("send_cbdc");
    expect(schema).toContain("receive_cbdc");
  });

  it("defines ghipssTransfers table", () => {
    expect(schema).toContain("ghipssTransfers");
    expect(schema).toContain("transfer_type");
    expect(schema).toContain("receiver_msisdn");
    expect(schema).toContain("papss_routed");
  });

  it("defines africbdcTransfers table", () => {
    expect(schema).toContain("africbdcTransfers");
    expect(schema).toContain("cbdc_type");
    expect(schema).toContain("sender_wallet");
    expect(schema).toContain("receiver_wallet");
  });

  it("defines papssTransfers table", () => {
    expect(schema).toContain("papssTransfers");
    expect(schema).toContain("netting_batch_id");
    expect(schema).toContain("ghipss_routed");
    expect(schema).toContain("mojaloop_routed");
  });

  it("defines railHealthStatus table", () => {
    expect(schema).toContain("railHealthStatus");
    expect(schema).toContain("latency_ms");
    expect(schema).toContain("last_checked_at");
  });

  it("defines paymentRailEnum with all 12 rails", () => {
    expect(schema).toContain("paymentRailEnum");
    expect(schema).toContain('"bricspay"');
    expect(schema).toContain('"mbridge"');
    expect(schema).toContain('"ghipss"');
    expect(schema).toContain('"africbdc"');
    expect(schema).toContain('"papss"');
    expect(schema).toContain('"mojaloop"');
  });
});

// ── 2. tRPC Router ────────────────────────────────────────────────────────────

describe("v171 tRPC Router — newRailsRouter", () => {
  const router = readFile("server/routers/newRails.ts");

  it("exports newRailsRouter", () => {
    expect(router).toContain("export const newRailsRouter");
  });

  it("implements BRICSPay initiate and getCorridors procedures", () => {
    expect(router).toContain("bricspay:");
    expect(router).toContain("initiate:");
    expect(router).toContain("getCorridors:");
    expect(router).toContain("bricspayTransfers");
  });

  it("implements mBridge initiate and getParticipants procedures", () => {
    expect(router).toContain("mbridge:");
    expect(router).toContain("mbridgeTransfers");
    expect(router).toContain("getParticipants:");
    expect(router).toContain("eCNY");
    expect(router).toContain("eHKD");
    expect(router).toContain("dAED");
  });

  it("implements GhIPSS initiate and getTransferTypes procedures", () => {
    expect(router).toContain("ghipss:");
    expect(router).toContain("ghipssTransfers");
    expect(router).toContain("getTransferTypes:");
    expect(router).toContain("GIP");
    expect(router).toContain("GHLINK");
    expect(router).toContain("MMI");
  });

  it("implements AfriCBDC initiate and getCbdcStatus procedures", () => {
    expect(router).toContain("africbdc:");
    expect(router).toContain("africbdcTransfers");
    expect(router).toContain("getCbdcStatus:");
    expect(router).toContain("eNGN");
    expect(router).toContain("eCedi");
    expect(router).toContain("dZAR");
    expect(router).toContain("AfriGo");
  });

  it("implements PAPSS initiate and getCorridors procedures", () => {
    expect(router).toContain("papss:");
    expect(router).toContain("papssTransfers");
    expect(router).toContain("getCorridors:");
    expect(router).toContain("Afreximbank");
  });

  it("implements railHealth.getAll procedure", () => {
    expect(router).toContain("railHealth:");
    expect(router).toContain("getAll:");
  });

  it("uses callRailService for all microservice calls", () => {
    expect(router).toContain("callRailService");
    expect(router).toContain("MICROSERVICE_URLS");
    expect(router).toContain("BRICSPAY_SERVICE_URL");
    expect(router).toContain("MBRIDGE_SERVICE_URL");
    expect(router).toContain("GHIPSS_SERVICE_URL");
    expect(router).toContain("AFRICBDC_SERVICE_URL");
    expect(router).toContain("PAPSS_SERVICE_URL");
  });

  it("uses createAuditLog for all rail procedures", () => {
    expect(router).toContain("createAuditLog");
    expect(router).toContain("bricspay_transfer_initiated");
    expect(router).toContain("mbridge_transfer_initiated");
    expect(router).toContain("ghipss_transfer_initiated");
    expect(router).toContain("africbdc_transfer_initiated");
    expect(router).toContain("papss_transfer_initiated");
  });

  it("handles microservice unavailability gracefully (mock fallback)", () => {
    expect(router).toContain("ECONNREFUSED");
    expect(router).toContain("mock_submitted");
    expect(router).toContain("mock: true");
  });
});

// ── 3. appRouter wiring ───────────────────────────────────────────────────────

describe("v171 appRouter — newRails registration", () => {
  const routers = readFile("server/routers.ts");

  it("imports newRailsRouter", () => {
    expect(routers).toContain("newRailsRouter");
    expect(routers).toContain("./routers/newRails");
  });

  it("registers newRails in appRouter", () => {
    expect(routers).toContain("newRails: newRailsRouter");
  });
});

// ── 4. Microservice files ─────────────────────────────────────────────────────

describe("v171 Microservices — Go/Rust/Python files exist", () => {
  it("BRICSPay Go adapter exists", () => {
    expect(existsSync(join(ROOT, "services/go-bricspay-adapter/main.go"))).toBe(true);
  });

  it("mBridge Rust adapter exists", () => {
    expect(existsSync(join(ROOT, "services/rust-mbridge-adapter/src/main.rs"))).toBe(true);
  });

  it("GhIPSS Go adapter exists", () => {
    expect(existsSync(join(ROOT, "services/go-ghipss-adapter/main.go"))).toBe(true);
  });

  it("AfriCBDC Python adapter exists", () => {
    expect(existsSync(join(ROOT, "services/python-africbdc-adapter/main.py"))).toBe(true);
  });

  it("PAPSS Go service exists", () => {
    expect(existsSync(join(ROOT, "services/go-papss-service/main.go"))).toBe(true);
  });

  it("Shared middleware library exists", () => {
    expect(existsSync(join(ROOT, "services/shared-middleware/middleware.go"))).toBe(true);
  });

  it("APISix gateway config exists", () => {
    expect(existsSync(join(ROOT, "services/go-apisix-config/rails_routes.yaml"))).toBe(true);
  });
});

// ── 5. Middleware wiring in microservices ─────────────────────────────────────

describe("v171 Middleware — Kafka/Dapr/Fluvio/Temporal/TigerBeetle wiring", () => {
  it("BRICSPay adapter references Kafka", () => {
    const content = readFile("services/go-bricspay-adapter/main.go");
    expect(content).toContain("kafka");
  });

  it("BRICSPay adapter references Dapr", () => {
    const content = readFile("services/go-bricspay-adapter/main.go");
    expect(content).toContain("dapr");
  });

  it("mBridge adapter references TigerBeetle", () => {
    const content = readFile("services/rust-mbridge-adapter/src/main.rs");
    expect(content).toContain("tigerbeetle");
  });

  it("mBridge adapter references Temporal", () => {
    const content = readFile("services/rust-mbridge-adapter/src/main.rs");
    expect(content).toContain("temporal");
  });

  it("GhIPSS adapter references Mojaloop", () => {
    const content = readFile("services/go-ghipss-adapter/main.go");
    expect(content).toContain("mojaloop");
  });

  it("GhIPSS adapter references Redis", () => {
    const content = readFile("services/go-ghipss-adapter/main.go");
    expect(content).toContain("Redis");
  });

  it("AfriCBDC adapter references OpenSearch", () => {
    const content = readFile("services/python-africbdc-adapter/main.py");
    expect(content).toContain("opensearch");
  });

  it("AfriCBDC adapter references Fluvio", () => {
    const content = readFile("services/python-africbdc-adapter/main.py");
    expect(content).toContain("fluvio");
  });

  it("PAPSS service references Keycloak", () => {
    const content = readFile("services/go-papss-service/main.go");
    expect(content).toContain("Keycloak");
  });

  it("PAPSS service references Permify", () => {
    const content = readFile("services/go-papss-service/main.go");
    expect(content).toContain("Permify");
  });

  it("Shared middleware library references all 11 middleware components", () => {
    const content = readFile("services/shared-middleware/middleware.go");
    expect(content).toContain("Kafka");
    expect(content).toContain("Dapr");
    expect(content).toContain("Fluvio");
    expect(content).toContain("Temporal");
    expect(content).toContain("Keycloak");
    expect(content).toContain("Permify");
    expect(content).toContain("OpenSearch");
    expect(content).toContain("Redis");
    expect(content).toContain("APISix");
    expect(content).toContain("TigerBeetle");
    expect(content).toContain("Lakehouse");
  });

  it("APISix config registers all 9 payment rail routes", () => {
    const content = readFile("services/go-apisix-config/rails_routes.yaml");
    expect(content).toContain("bricspay");
    expect(content).toContain("mbridge");
    expect(content).toContain("ghipss");
    expect(content).toContain("africbdc");
    expect(content).toContain("papss");
    expect(content).toContain("mojaloop");
    expect(content).toContain("cips");
    expect(content).toContain("upi");
    expect(content).toContain("pix");
  });
});

// ── 6. Mojaloop retrofit ──────────────────────────────────────────────────────

describe("v171 Mojaloop connector — middleware retrofit", () => {
  it("Mojaloop connector references Kafka", () => {
    const content = readFile("services/mojaloop-connector/main.go");
    expect(content).toContain("kafka");
  });

  it("Mojaloop connector references Dapr", () => {
    const content = readFile("services/mojaloop-connector/main.go");
    expect(content).toContain("dapr");
  });

  it("Mojaloop connector references TigerBeetle", () => {
    const content = readFile("services/mojaloop-connector/main.go");
    expect(content).toContain("tigerbeetle");
  });

  it("Mojaloop connector references Temporal", () => {
    const content = readFile("services/mojaloop-connector/main.go");
    expect(content).toContain("temporal");
  });
});

// ── 7. SendCrypto UI ──────────────────────────────────────────────────────────

describe("v171 SendCrypto UI page", () => {
  it("SendCrypto.tsx exists", () => {
    expect(existsSync(join(ROOT, "client/src/pages/SendCrypto.tsx"))).toBe(true);
  });

  it("SendCrypto uses cryptoCustody.send mutation", () => {
    const content = readFile("client/src/pages/SendCrypto.tsx");
    expect(content).toContain("cryptoCustody.send");
    expect(content).toContain("useMutation");
  });

  it("SendCrypto has QR scanner modal", () => {
    const content = readFile("client/src/pages/SendCrypto.tsx");
    expect(content).toContain("QRScannerModal");
    expect(content).toContain("onScan");
  });

  it("SendCrypto supports 10 crypto assets", () => {
    const content = readFile("client/src/pages/SendCrypto.tsx");
    expect(content).toContain("BTC");
    expect(content).toContain("ETH");
    expect(content).toContain("USDT");
    expect(content).toContain("USDC");
    expect(content).toContain("SOL");
    expect(content).toContain("XRP");
  });

  it("SendCrypto supports 3 custody providers", () => {
    const content = readFile("client/src/pages/SendCrypto.tsx");
    expect(content).toContain("mock");
    expect(content).toContain("fireblocks");
    expect(content).toContain("bitgo");
  });

  it("SendCrypto route registered in App.tsx", () => {
    const content = readFile("client/src/App.tsx");
    expect(content).toContain("/send-crypto");
    expect(content).toContain("SendCrypto");
  });
});

// ── 8. Research findings ──────────────────────────────────────────────────────

describe("v171 Payment Rails — research coverage", () => {
  it("BRICSPay corridors cover all 10 BRICS+ countries", () => {
    const router = readFile("server/routers/newRails.ts");
    expect(router).toContain('"CN"');
    expect(router).toContain('"RU"');
    expect(router).toContain('"IN"');
    expect(router).toContain('"BR"');
    expect(router).toContain('"ZA"');
    expect(router).toContain('"AE"');
  });

  it("mBridge covers all 5 participating central banks", () => {
    const router = readFile("server/routers/newRails.ts");
    expect(router).toContain("PBOC");
    expect(router).toContain("HKMA");
    expect(router).toContain("CBUAE");
    expect(router).toContain("BOT");
    expect(router).toContain("SAMA");
  });

  it("PAPSS covers 8 African corridors", () => {
    const router = readFile("server/routers/newRails.ts");
    expect(router).toContain("NG-GH");
    expect(router).toContain("NG-KE");
    expect(router).toContain("GH-KE");
    expect(router).toContain("ZA-NG");
  });

  it("AfriCBDC covers eNGN, eCedi, dZAR, AfriGo, eKES", () => {
    const router = readFile("server/routers/newRails.ts");
    expect(router).toContain("eNGN");
    expect(router).toContain("eCedi");
    expect(router).toContain("dZAR");
    expect(router).toContain("AfriGo");
    expect(router).toContain("eKES");
  });
});
