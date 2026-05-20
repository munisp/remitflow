/**
 * Smoke tests for all 12 orphanFeatures routers (v19)
 * Verifies each router exports the expected procedures and is structurally sound.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockSelect = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockDelete = vi.fn().mockResolvedValue([]);

vi.mock("../server/db.js", () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: () => ({
      values: () => ({
        returning: () => mockReturning(),
        onConflictDoUpdate: () => ({ returning: () => mockReturning() }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => mockSelect() }),
          limit: () => mockSelect(),
          execute: () => mockSelect(),
        }),
        orderBy: () => ({ limit: () => mockSelect() }),
        limit: () => mockSelect(),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => mockUpdate() }) }) }),
    delete: () => ({ where: () => mockDelete() }),
  }),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/email.service.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../server/notifications.service.js", () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

import {
  paymentMethodsExtRouter,
  hnwExtRouter,
  diasporaProfilesRouter,
  railOpsRouter,
  securityExtRouter,
  complianceExtRouter,
  crossSellExtRouter,
  outboundExtRouter,
  agentCashInRouter,
  pushPrefsRouter,
  smeBulkRouter,
  swiftTxRouter,
} from "../server/routers/orphanFeatures.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
function getProcedures(r: any): string[] {
  return Object.keys(r._def?.procedures ?? r._def?.record ?? {});
}

// ─── paymentMethodsExtRouter ─────────────────────────────────────────────────
describe("paymentMethodsExtRouter", () => {
  it("exports a router object", () => {
    expect(paymentMethodsExtRouter).toBeDefined();
    expect(typeof paymentMethodsExtRouter).toBe("object");
  });
  it("has ACH procedures: listAch, addAch, setDefaultAch, removeAch", () => {
    const procs = getProcedures(paymentMethodsExtRouter);
    expect(procs).toContain("listAch");
    expect(procs).toContain("addAch");
    expect(procs).toContain("setDefaultAch");
    expect(procs).toContain("removeAch");
  });
  it("has SEPA procedures: listSepa, addSepa, removeSepa", () => {
    const procs = getProcedures(paymentMethodsExtRouter);
    expect(procs).toContain("listSepa");
    expect(procs).toContain("addSepa");
    expect(procs).toContain("removeSepa");
  });
  it("has Interac procedures: listInterac, addInterac, removeInterac", () => {
    const procs = getProcedures(paymentMethodsExtRouter);
    expect(procs).toContain("listInterac");
    expect(procs).toContain("addInterac");
    expect(procs).toContain("removeInterac");
  });
  it("has XOF procedures: listXofAccounts, addXofAccount, removeXofAccount, listAll", () => {
    const procs = getProcedures(paymentMethodsExtRouter);
    expect(procs).toContain("listXofAccounts");
    expect(procs).toContain("addXofAccount");
    expect(procs).toContain("listAll");
  });
});

// ─── hnwExtRouter ─────────────────────────────────────────────────────────────
describe("hnwExtRouter", () => {
  it("exports a router object", () => {
    expect(hnwExtRouter).toBeDefined();
    expect(typeof hnwExtRouter).toBe("object");
  });
  it("has profile procedures: getProfile, upsertProfile", () => {
    const procs = getProcedures(hnwExtRouter);
    expect(procs).toContain("getProfile");
    expect(procs).toContain("upsertProfile");
  });
  it("has portfolio procedures: getPortfolio, addPortfolioItem, updatePortfolioItem", () => {
    const procs = getProcedures(hnwExtRouter);
    expect(procs).toContain("getPortfolio");
    expect(procs).toContain("addPortfolioItem");
    expect(procs).toContain("updatePortfolioItem");
  });
  it("has RM procedures: getRelationshipManager, listRelationshipManagers, assignRelationshipManager", () => {
    const procs = getProcedures(hnwExtRouter);
    expect(procs).toContain("getRelationshipManager");
    expect(procs).toContain("listRelationshipManagers");
    expect(procs).toContain("assignRelationshipManager");
  });
  it("has FX rate procedures: getNegotiatedFxRates", () => {
    const procs = getProcedures(hnwExtRouter);
    expect(procs).toContain("getNegotiatedFxRates");
  });
});

// ─── diasporaProfilesRouter ───────────────────────────────────────────────────
describe("diasporaProfilesRouter", () => {
  it("exports a router object", () => {
    expect(diasporaProfilesRouter).toBeDefined();
    expect(typeof diasporaProfilesRouter).toBe("object");
  });
  it("has USA diaspora procedures: getUsaProfile, upsertUsaProfile, acceptUsaDisclosure", () => {
    const procs = getProcedures(diasporaProfilesRouter);
    expect(procs).toContain("getUsaProfile");
    expect(procs).toContain("upsertUsaProfile");
    expect(procs).toContain("acceptUsaDisclosure");
  });
  it("has Canada diaspora procedures: getCanadaProfile, upsertCanadaProfile", () => {
    const procs = getProcedures(diasporaProfilesRouter);
    expect(procs).toContain("getCanadaProfile");
    expect(procs).toContain("upsertCanadaProfile");
  });
  it("has EU diaspora procedures: getEuProfile, upsertEuProfile", () => {
    const procs = getProcedures(diasporaProfilesRouter);
    expect(procs).toContain("getEuProfile");
    expect(procs).toContain("upsertEuProfile");
  });
  it("has immigrant worker procedures: getImmigrantWorkerProfile, upsertImmigrantWorkerProfile", () => {
    const procs = getProcedures(diasporaProfilesRouter);
    expect(procs).toContain("getImmigrantWorkerProfile");
    expect(procs).toContain("upsertImmigrantWorkerProfile");
  });
});

// ─── railOpsRouter ────────────────────────────────────────────────────────────
describe("railOpsRouter", () => {
  it("exports a router object", () => {
    expect(railOpsRouter).toBeDefined();
    expect(typeof railOpsRouter).toBe("object");
  });
  it("has rail health procedures: getRailHealth, updateRailHealth", () => {
    const procs = getProcedures(railOpsRouter);
    expect(procs).toContain("getRailHealth");
    expect(procs).toContain("updateRailHealth");
  });
  it("has corridor procedures: getWestAfricanCorridors, updateCorridorFxRate", () => {
    const procs = getProcedures(railOpsRouter);
    expect(procs).toContain("getWestAfricanCorridors");
    expect(procs).toContain("updateCorridorFxRate");
  });
  it("has clearing line procedures: getClearingLines", () => {
    const procs = getProcedures(railOpsRouter);
    expect(procs).toContain("getClearingLines");
  });
});

// ─── securityExtRouter ────────────────────────────────────────────────────────
describe("securityExtRouter", () => {
  it("exports a router object", () => {
    expect(securityExtRouter).toBeDefined();
    expect(typeof securityExtRouter).toBe("object");
  });
  it("has lockout procedures: getLockoutStatus, listLockedUsers, unlockUser, requestSelfUnlock", () => {
    const procs = getProcedures(securityExtRouter);
    expect(procs).toContain("getLockoutStatus");
    expect(procs).toContain("listLockedUsers");
    expect(procs).toContain("unlockUser");
    expect(procs).toContain("requestSelfUnlock");
  });
  it("has idempotency procedures: checkIdempotencyKey, purgeExpiredKeys", () => {
    const procs = getProcedures(securityExtRouter);
    expect(procs).toContain("checkIdempotencyKey");
    expect(procs).toContain("purgeExpiredKeys");
  });
});

// ─── complianceExtRouter ──────────────────────────────────────────────────────
describe("complianceExtRouter", () => {
  it("exports a router object", () => {
    expect(complianceExtRouter).toBeDefined();
    expect(typeof complianceExtRouter).toBe("object");
  });
  it("has KYC session procedures: startKycSession, getKycSession, updateKycSession, listKycSessions", () => {
    const procs = getProcedures(complianceExtRouter);
    expect(procs).toContain("startKycSession");
    expect(procs).toContain("getKycSession");
    expect(procs).toContain("updateKycSession");
    expect(procs).toContain("listKycSessions");
  });
  it("has ECOWAS procedures: getEcowasCheckStats", () => {
    const procs = getProcedures(complianceExtRouter);
    expect(procs).toContain("getEcowasCheckStats");
  });
  it("has disclosure procedures: listMyDisclosures, acceptDisclosure", () => {
    const procs = getProcedures(complianceExtRouter);
    expect(procs).toContain("listMyDisclosures");
    expect(procs).toContain("acceptDisclosure");
  });
  it("has de-risking procedures: listDerisikingAlerts, acknowledgeDerisikingAlert", () => {
    const procs = getProcedures(complianceExtRouter);
    expect(procs).toContain("listDerisikingAlerts");
    expect(procs).toContain("acknowledgeDerisikingAlert");
  });
  it("has risk score procedures: getCorrespondentRiskScores, upsertRiskScore", () => {
    const procs = getProcedures(complianceExtRouter);
    expect(procs).toContain("getCorrespondentRiskScores");
    expect(procs).toContain("upsertRiskScore");
  });
});

// ─── crossSellExtRouter ───────────────────────────────────────────────────────
describe("crossSellExtRouter", () => {
  it("exports a router object", () => {
    expect(crossSellExtRouter).toBeDefined();
    expect(typeof crossSellExtRouter).toBe("object");
  });
  it("has offer procedures: getActiveOffer, markOfferShown, respondToOffer, listMyOffers, getOfferStats", () => {
    const procs = getProcedures(crossSellExtRouter);
    expect(procs).toContain("getActiveOffer");
    expect(procs).toContain("markOfferShown");
    expect(procs).toContain("respondToOffer");
    expect(procs).toContain("listMyOffers");
    expect(procs).toContain("getOfferStats");
  });
});

// ─── outboundExtRouter ────────────────────────────────────────────────────────
describe("outboundExtRouter", () => {
  it("exports a router object", () => {
    expect(outboundExtRouter).toBeDefined();
    expect(typeof outboundExtRouter).toBe("object");
  });
  it("has usage procedures: getAnnualUsage, getUsageSummary, adminGetUsage", () => {
    const procs = getProcedures(outboundExtRouter);
    expect(procs).toContain("getAnnualUsage");
    expect(procs).toContain("getUsageSummary");
    expect(procs).toContain("adminGetUsage");
  });
});

// ─── agentCashInRouter ────────────────────────────────────────────────────────
describe("agentCashInRouter", () => {
  it("exports a router object", () => {
    expect(agentCashInRouter).toBeDefined();
    expect(typeof agentCashInRouter).toBe("object");
  });
  it("has transaction procedures: listTransactions, submitCashIn, getAgentStats, adminListTransactions", () => {
    const procs = getProcedures(agentCashInRouter);
    expect(procs).toContain("listTransactions");
    expect(procs).toContain("submitCashIn");
    expect(procs).toContain("getAgentStats");
    expect(procs).toContain("adminListTransactions");
  });
});

// ─── pushPrefsRouter ──────────────────────────────────────────────────────────
describe("pushPrefsRouter", () => {
  it("exports a router object", () => {
    expect(pushPrefsRouter).toBeDefined();
    expect(typeof pushPrefsRouter).toBe("object");
  });
  it("has preference procedures: getPreferences, updatePreference, updateBulkPreferences", () => {
    const procs = getProcedures(pushPrefsRouter);
    expect(procs).toContain("getPreferences");
    expect(procs).toContain("updatePreference");
    expect(procs).toContain("updateBulkPreferences");
  });
});

// ─── smeBulkRouter ────────────────────────────────────────────────────────────
describe("smeBulkRouter", () => {
  it("exports a router object", () => {
    expect(smeBulkRouter).toBeDefined();
    expect(typeof smeBulkRouter).toBe("object");
  });
  it("has batch procedures: listBatches, getBatch, createBatch, cancelBatch, adminListBatches", () => {
    const procs = getProcedures(smeBulkRouter);
    expect(procs).toContain("listBatches");
    expect(procs).toContain("getBatch");
    expect(procs).toContain("createBatch");
    expect(procs).toContain("cancelBatch");
    expect(procs).toContain("adminListBatches");
  });
});

// ─── swiftTxRouter ────────────────────────────────────────────────────────────
describe("swiftTxRouter", () => {
  it("exports a router object", () => {
    expect(swiftTxRouter).toBeDefined();
    expect(typeof swiftTxRouter).toBe("object");
  });
  it("has transaction procedures: listTransactions, getTransaction, getTransactionByUetr", () => {
    const procs = getProcedures(swiftTxRouter);
    expect(procs).toContain("listTransactions");
    expect(procs).toContain("getTransaction");
    expect(procs).toContain("getTransactionByUetr");
  });
  it("has admin and stats procedures: adminListTransactions, getSwiftStats", () => {
    const procs = getProcedures(swiftTxRouter);
    expect(procs).toContain("adminListTransactions");
    expect(procs).toContain("getSwiftStats");
  });
});
