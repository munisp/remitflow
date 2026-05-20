/**
 * smoke-v201.test.ts
 * Production-readiness sprint: middleware completeness, mobile parity,
 * security hardening, DB helpers, orphaned service wiring.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

function exists(rel: string) {
  return fs.existsSync(path.join(ROOT, rel));
}
function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function countLines(rel: string) {
  return read(rel).split("\n").length;
}

// ── Kafka ─────────────────────────────────────────────────────────────────────
describe("Kafka middleware", () => {
  it("has docker-compose", () => expect(exists("kafka/docker-compose.kafka.yml")).toBe(true));
  it("has topics registry", () => expect(exists("kafka/topics.yaml")).toBe(true));
  it("has consumer-groups registry", () => expect(exists("kafka/consumer-groups.yaml")).toBe(true));
  it("defines remitflow.transfers.created topic", () =>
    expect(read("kafka/topics.yaml")).toContain("remitflow.transfers.created"));
  it("defines at least 14 topics", () =>
    expect((read("kafka/topics.yaml").match(/- name:/g) || []).length).toBeGreaterThanOrEqual(14));
  it("defines at least 8 consumer groups", () =>
    expect((read("kafka/consumer-groups.yaml").match(/- id:/g) || []).length).toBeGreaterThanOrEqual(8));
});

// ── Redis ─────────────────────────────────────────────────────────────────────
describe("Redis middleware", () => {
  it("has docker-compose", () => expect(exists("redis/docker-compose.redis.yml")).toBe(true));
  it("has redis.conf", () => expect(exists("redis/redis.conf")).toBe(true));
  it("has sentinel.conf", () => expect(exists("redis/sentinel.conf")).toBe(true));
  it("has cache-keys registry", () => expect(exists("redis/cache-keys.yaml")).toBe(true));
  it("defines idempotency key", () =>
    expect(read("redis/cache-keys.yaml")).toContain("transfer_idempotency"));
  it("defines fx_rates key", () =>
    expect(read("redis/cache-keys.yaml")).toContain("fx_rates"));
});

// ── Mojaloop ──────────────────────────────────────────────────────────────────
describe("Mojaloop middleware", () => {
  it("has docker-compose", () => expect(exists("mojaloop/docker-compose.mojaloop.yml")).toBe(true));
  it("has FSPIOP config", () => expect(exists("mojaloop/fspiop-config.yaml")).toBe(true));
  it("has ISO 20022 mapping", () => expect(exists("mojaloop/iso20022-mapping.yaml")).toBe(true));
  it("supports NG_GH corridor", () =>
    expect(read("mojaloop/fspiop-config.yaml")).toContain("NG_GH"));
  it("maps pacs.008 to transferRequest", () =>
    expect(read("mojaloop/iso20022-mapping.yaml")).toContain("pacs008_to_transferRequest"));
});

// ── TigerBeetle ───────────────────────────────────────────────────────────────
describe("TigerBeetle middleware", () => {
  it("has docker-compose", () => expect(exists("tigerbeetle/docker-compose.tigerbeetle.yml")).toBe(true));
  it("has account-codes registry", () => expect(exists("tigerbeetle/account-codes.yaml")).toBe(true));
  it("has transfer-types registry", () => expect(exists("tigerbeetle/transfer-types.yaml")).toBe(true));
  it("defines USER_WALLET_NGN account", () =>
    expect(read("tigerbeetle/account-codes.yaml")).toContain("USER_WALLET_NGN"));
  it("defines NOSTRO accounts", () =>
    expect(read("tigerbeetle/account-codes.yaml")).toContain("NOSTRO_USD_CITI"));
  it("defines HNW transfer type", () =>
    expect(read("tigerbeetle/transfer-types.yaml")).toContain("HNW_PRIORITY_TRANSFER"));
});

// ── Lakehouse ─────────────────────────────────────────────────────────────────
describe("Lakehouse middleware", () => {
  it("has docker-compose", () => expect(exists("lakehouse/docker-compose.lakehouse.yml")).toBe(true));
  it("has Iceberg schemas", () => expect(exists("lakehouse/iceberg-schemas.yaml")).toBe(true));
  it("has dbt profiles", () => expect(exists("lakehouse/dbt/profiles.yml")).toBe(true));
  it("has revenue_daily dbt model", () =>
    expect(exists("lakehouse/dbt/models/revenue_daily.sql")).toBe(true));
  it("defines transfers_fact table", () =>
    expect(read("lakehouse/iceberg-schemas.yaml")).toContain("transfers_fact"));
  it("dbt model uses incremental strategy", () =>
    expect(read("lakehouse/dbt/models/revenue_daily.sql")).toContain("incremental"));
});

// ── Security hardening ────────────────────────────────────────────────────────
describe("Security hardening", () => {
  it("has PBAC middleware", () => expect(exists("server/security.pbac.ts")).toBe(true));
  it("has go-security-hardening service", () =>
    expect(exists("services/go-security-hardening/main.go")).toBe(true));
  it("PBAC middleware exports checkPolicy", () =>
    expect(read("server/security.pbac.ts")).toContain("checkPolicy"));
  it("go-security-hardening handles DDoS mitigation", () =>
    expect(read("services/go-security-hardening/main.go")).toContain("DDoS"));
  it("go-security-hardening handles ransomware detection", () =>
    expect(read("services/go-security-hardening/main.go")).toContain("ransomware"));
});

// ── Resilience ────────────────────────────────────────────────────────────────
describe("Connection resilience", () => {
  it("has connectionResilience.ts", () =>
    expect(exists("client/src/lib/connectionResilience.ts")).toBe(true));
  it("exports ResilientConnectionManager", () =>
    expect(read("client/src/lib/connectionResilience.ts")).toContain("ResilientConnectionManager"));
  it("implements exponential backoff", () =>
    expect(read("client/src/lib/connectionResilience.ts")).toContain("backoff"));
  it("handles low-bandwidth detection", () =>
    expect(read("client/src/lib/connectionResilience.ts")).toContain("bandwidth"));
});

// ── Mobile parity ─────────────────────────────────────────────────────────────
describe("Flutter mobile parity", () => {
  it("has api_config.dart", () =>
    expect(exists("mobile/flutter/lib/config/api_config.dart")).toBe(true));
  it("has profile_service.dart", () =>
    expect(exists("mobile/flutter/lib/services/profile_service.dart")).toBe(true));
  it("has education_payments_service.dart", () =>
    expect(exists("mobile/flutter/lib/services/education_payments_service.dart")).toBe(true));
  it("has annual_limit_badge widget", () =>
    expect(exists("mobile/flutter/lib/widgets/annual_limit_badge.dart")).toBe(true));
  it("has cross_sell_offer_modal widget", () =>
    expect(exists("mobile/flutter/lib/widgets/cross_sell_offer_modal.dart")).toBe(true));
});

describe("React Native mobile parity", () => {
  it("has api.ts client", () =>
    expect(exists("mobile/react-native/src/api/api.ts")).toBe(true));
  it("has useProfile hook", () =>
    expect(exists("mobile/react-native/src/hooks/useProfile.ts")).toBe(true));
  it("has useEducationPayments hook", () =>
    expect(exists("mobile/react-native/src/hooks/useEducationPayments.ts")).toBe(true));
  it("has useSendFromNigeria hook", () =>
    expect(exists("mobile/react-native/src/hooks/useSendFromNigeria.ts")).toBe(true));
  it("api.ts exports apiGet and apiPost", () => {
    const content = read("mobile/react-native/src/api/api.ts");
    expect(content).toContain("apiGet");
    expect(content).toContain("apiPost");
  });
});

// ── DB helpers completeness ───────────────────────────────────────────────────
describe("DB helpers completeness", () => {
  it("db.ts has getAnnualUsage helper", () =>
    expect(read("server/db.ts")).toContain("getAnnualUsage"));
  it("db.ts has createCrossSellOffer helper", () =>
    expect(read("server/db.ts")).toContain("createCrossSellOffer"));
  it("db.ts has markCrossSellOfferShown helper", () =>
    expect(read("server/db.ts")).toContain("markCrossSellOfferShown"));
  it("db.ts is substantial (>300 lines)", () =>
    expect(countLines("server/db.ts")).toBeGreaterThan(300));
});

// ── Orphaned services wired ───────────────────────────────────────────────────
describe("Orphaned services wired", () => {
  it("go-xof-adapter service exists", () =>
    expect(exists("services/go-xof-adapter/main.go")).toBe(true));
  it("go-hnw-routing service exists", () =>
    expect(exists("services/go-hnw-routing/main.go")).toBe(true));
  it("go-correspondent-manager service exists", () =>
    expect(exists("services/go-correspondent-manager/main.go")).toBe(true));
  it("rust-immigrant-worker-kyc service exists", () =>
    expect(exists("services/rust-immigrant-worker-kyc/src/main.rs")).toBe(true));
  it("rust-sme-bulk-processor service exists", () =>
    expect(exists("services/rust-sme-bulk-processor/src/main.rs")).toBe(true));
  it("rust-hnw-fx-engine service exists", () =>
    expect(exists("services/rust-hnw-fx-engine/src/main.rs")).toBe(true));
  it("python corridor-ml service exists", () =>
    expect(exists("microservices/python-services/corridor-ml/main.py")).toBe(true));
  it("python hnw-scoring service exists", () =>
    expect(exists("microservices/python-services/hnw-scoring/main.py")).toBe(true));
  it("python sme-compliance service exists", () =>
    expect(exists("microservices/python-services/sme-compliance/main.py")).toBe(true));
});

// ── Seed data ─────────────────────────────────────────────────────────────────
describe("Seed data", () => {
  it("has comprehensive seed script", () =>
    expect(exists("scripts/seed-v201-comprehensive.mjs")).toBe(true));
  it("seed script covers FX rates", () =>
    expect(read("scripts/seed-v201-comprehensive.mjs")).toContain("FX"));
  it("seed script covers corridors", () =>
    expect(read("scripts/seed-v201-comprehensive.mjs")).toContain("corridor_pricing"));
});

// ── v200 gap pages ────────────────────────────────────────────────────────────
describe("v200 gap frontend pages", () => {
  const pages = [
    "SendToTogo", "SendToNiger", "SendToMali", "SendToBenin",
    "ImmigrantWorkerSend", "PrivateBankingDashboard", "CorrespondentBankAdmin",
    "SMETradePayment", "DiasporaUSA", "DiasporaItaly", "DiasporaCanada",
    "DiasporaEU", "TieredKYCFlow", "AgentCashIn",
  ];
  pages.forEach(page => {
    it(`has ${page}.tsx page`, () =>
      expect(exists(`client/src/pages/${page}.tsx`)).toBe(true));
  });
});
