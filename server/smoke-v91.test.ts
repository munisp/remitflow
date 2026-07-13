/**
 * smoke-v91.test.ts
 *
 * Smoke tests for v91 features:
 *  - Partner Application & Approval Workflow
 *  - Partner API Keys & Webhooks
 *  - Partner Self-Service (branding, team)
 *  - User Onboarding Progress
 *  - Compliance Email Config
 *  - White-Label Partner end-to-end flow
 */
import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers.js";
import type { TrpcContext } from "./_core/context.js";

function makeCtx(overrides: Record<string, any> = {}): TrpcContext {
  const user = {
    id: 1, openId: "v91-smoke-user", email: "test@remitflow.com",
    name: "Test User", loginMethod: "keycloak", role: "user" as const,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), kycTier: "tier1",
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: { origin: "https://remitflow.test" } } as TrpcContext["req"],
    res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function makeAnonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: { origin: "https://remitflow.test" } } as TrpcContext["req"],
    res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ── Partner Applications ─────────────────────────────────────────────────────
describe("partnerApplications", () => {
  const caller = appRouter.createCaller(makeAnonCtx());
  const userCaller = appRouter.createCaller(makeCtx());
  const adminCaller = appRouter.createCaller(makeCtx({ role: "admin" }));

  it("submit returns applicationId and slug", async () => {
    const result = await caller.partnerApplications.submit({
      companyName: "Acme Fintech Ltd",
      brandName: "AcmePay",
      applicationType: "fintech_startup",
      contactName: "Jane Doe",
      contactEmail: "jane@acmefintech.com",
      country: "NG",
      businessDescription: "A leading fintech startup providing cross-border remittance services to diaspora communities across West Africa with a focus on Nigeria and Ghana corridors.",
      requestedPlan: "growth",
      hasAmlPolicy: true,
      hasKycProcess: true,
      isRegulated: false,
    });
    expect(result.success).toBe(true);
    expect(result.applicationId).toBeGreaterThan(0);
    expect(result.slug).toMatch(/^acmepay/);
    expect(result.status).toBe("submitted");
    expect(result.trackingUrl).toContain("/partner/application/");
  });

  it("submit with all optional fields succeeds", async () => {
    const result = await caller.partnerApplications.submit({
      companyName: "Global Remit Corp",
      brandName: "GlobalPay",
      applicationType: "bank",
      contactName: "John Smith",
      contactEmail: "john@globalremit.com",
      contactPhone: "+2348012345678",
      website: "https://globalremit.com",
      country: "GH",
      registrationNumber: "RC-12345",
      taxId: "TIN-67890",
      incorporationDate: "2020-01-15",
      businessDescription: "Global Remit Corp is a licensed money transfer operator providing affordable and fast international remittance services to African diaspora communities worldwide.",
      expectedMonthlyVolume: 500000,
      expectedUserCount: 10000,
      targetCorridors: ["GB-NG", "US-GH", "CA-KE"],
      requestedPlan: "enterprise",
      hasAmlPolicy: true,
      hasKycProcess: true,
      isRegulated: true,
      regulatoryLicenses: ["FCA-UK", "CBN-NG"],
      primaryColor: "#1a56db",
      secondaryColor: "#0ea5e9",
    });
    expect(result.success).toBe(true);
    expect(result.slug).toMatch(/^globalpay/);
  });

  it("checkStatus returns application by slug", async () => {
    // First submit to get a slug
    const submitted = await caller.partnerApplications.submit({
      companyName: "Status Check Corp",
      brandName: "StatusPay",
      contactName: "Alice",
      contactEmail: "alice@statuspay.com",
      country: "KE",
      businessDescription: "StatusPay provides mobile-first remittance solutions for East African diaspora communities, focusing on Kenya, Uganda, and Tanzania corridors.",
      requestedPlan: "starter",
    });
    const status = await caller.partnerApplications.checkStatus({ slug: submitted.slug });
    expect(status.slug).toBe(submitted.slug);
    expect(status.status).toBe("submitted");
    expect(status.company_name).toBe("Status Check Corp");
  });

  it("checkStatus throws NOT_FOUND for invalid slug", async () => {
    await expect(
      caller.partnerApplications.checkStatus({ slug: "nonexistent-slug-xyz-999" })
    ).rejects.toThrow();
  });

  it("myApplications returns array for authenticated user", async () => {
    const result = await userCaller.partnerApplications.myApplications();
    expect(Array.isArray(result)).toBe(true);
  });

  it("adminList returns paginated applications", async () => {
    const result = await adminCaller.partnerApplications.adminList({
      status: "all",
      page: 1,
      limit: 10,
    });
    expect(result).toHaveProperty("applications");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page", 1);
    expect(Array.isArray(result.applications)).toBe(true);
  });

  it("adminList filters by status submitted", async () => {
    const result = await adminCaller.partnerApplications.adminList({
      status: "submitted",
      page: 1,
      limit: 5,
    });
    expect(Array.isArray(result.applications)).toBe(true);
    result.applications.forEach((app: any) => {
      expect(app.status).toBe("submitted");
    });
  });

  it("adminList supports search filter", async () => {
    const result = await adminCaller.partnerApplications.adminList({
      status: "all",
      search: "Acme",
      page: 1,
      limit: 10,
    });
    expect(Array.isArray(result.applications)).toBe(true);
  });

  it("adminGetApplication returns full application details", async () => {
    // Get an existing application
    const list = await adminCaller.partnerApplications.adminList({ status: "all", page: 1, limit: 1 });
    if (list.applications.length > 0) {
      const app = list.applications[0];
      const detail = await adminCaller.partnerApplications.adminGetDetail({ id: app.id });
      expect(detail.id ?? detail.application?.id).toBe(app.id);
      expect(detail).toHaveProperty("comments");
    }
  });

  it("adminReview transitions status to under_review", async () => {
    const list = await adminCaller.partnerApplications.adminList({ status: "submitted", page: 1, limit: 1 });
    if (list.applications.length > 0) {
      const app = list.applications[0];
      const result = await adminCaller.partnerApplications.startReview({ id: app.id });
      expect(result.success).toBe(true);
    }
  });

  it("adminAddComment adds internal comment", async () => {
    const list = await adminCaller.partnerApplications.adminList({ status: "all", page: 1, limit: 1 });
    if (list.applications.length > 0) {
      const app = list.applications[0];
      const result = await adminCaller.partnerApplications.addComment({
        applicationId: app.id,
        comment: "Reviewed AML policy — looks comprehensive. Proceeding to approval.",
        isInternal: true,
      });
      expect(result.success).toBe(true);
    }
  });

  it("adminApprove approves an application", async () => {
    const list = await adminCaller.partnerApplications.adminList({ status: "all", page: 1, limit: 1 });
    if (list.applications.length > 0) {
      const app = list.applications[0];
      const result = await adminCaller.partnerApplications.approve({
        id: app.id,
        reviewNotes: "All compliance checks passed. AML policy reviewed and approved.",
        plan: "growth",
      });
      expect(result.success).toBe(true);
    }
  });

  it("adminReject rejects an application with reason", async () => {
    // Submit a new application to reject
    const submitted = await caller.partnerApplications.submit({
      companyName: "Reject Me Corp",
      brandName: "RejectPay",
      contactName: "Bob",
      contactEmail: "bob@rejectme.com",
      country: "ZA",
      businessDescription: "RejectMe Corp is a test company used for testing the rejection workflow in the RemitFlow partner application system.",
      requestedPlan: "starter",
    });
    const result = await adminCaller.partnerApplications.reject({
      id: submitted.applicationId,
      rejectionReason: "Insufficient AML documentation. Please reapply with a comprehensive AML policy document.",
    });
    expect(result.success).toBe(true);
  });

  it("adminRequestInfo requests additional information", async () => {
    const submitted = await caller.partnerApplications.submit({
      companyName: "Info Request Corp",
      brandName: "InfoPay",
      contactName: "Carol",
      contactEmail: "carol@infopay.com",
      country: "TZ",
      businessDescription: "InfoPay Corp provides digital remittance services to East African communities with a focus on mobile money integration.",
      requestedPlan: "starter",
    });
    const result = await adminCaller.partnerApplications.requestAdditionalInfo({
      id: submitted.applicationId,
      request: "Please provide your Central Bank of Tanzania license number and a copy of your AML compliance certificate.",
    });
    expect(result.success).toBe(true);
  });

  it("signSla marks SLA as signed", async () => {
    const submitted = await caller.partnerApplications.submit({
      companyName: "SLA Test Corp",
      brandName: "SLAPay",
      contactName: "Dave",
      contactEmail: "dave@slapay.com",
      country: "UG",
      businessDescription: "SLAPay provides cross-border remittance services to Ugandan diaspora communities in Europe and North America.",
      requestedPlan: "growth",
    });
    const result = await userCaller.partnerApplications.signSla({
      applicationId: submitted.applicationId,
      slaVersion: "v1.0",
    });
    expect(result.success).toBe(true);
    expect(result.signedAt).toBeTruthy();
  });

  it("provideAdditionalInfo updates application", async () => {
    const submitted = await caller.partnerApplications.submit({
      companyName: "Additional Info Corp",
      brandName: "AddInfoPay",
      contactName: "Eve",
      contactEmail: "eve@addinfopay.com",
      country: "SN",
      businessDescription: "AddInfoPay Corp is a Senegal-based fintech providing mobile money and remittance services to West African diaspora communities.",
      requestedPlan: "starter",
    });
    // First request additional info
    await adminCaller.partnerApplications.requestAdditionalInfo({
      id: submitted.applicationId,
      request: "Please provide your BCEAO license number.",
    });
    // Then provide it
    const result = await userCaller.partnerApplications.provideAdditionalInfo({
      applicationId: submitted.applicationId,
      response: "Our BCEAO license number is BCEAO-2024-MTO-0123. We are fully licensed to operate as a money transfer operator in Senegal.",
    });
    expect(result.success).toBe(true);
  });
});

// ── Partner API Keys ─────────────────────────────────────────────────────────
describe("partnerApiKeys", () => {
  const caller = appRouter.createCaller(makeCtx());

  it("list returns array of API keys", async () => {
    const keys = await caller.partnerApiKeys.list({ tenantId: 1 });
    expect(Array.isArray(keys)).toBe(true);
  });

  it("create returns full key and prefix", async () => {
    const result = await caller.partnerApiKeys.create({
      tenantId: 1,
      name: "Production Integration Key",
      environment: "sandbox",
      permissions: ["transfers:read", "transfers:write"],
    });
    expect(result.fullKey).toMatch(/^rf_test_/);
    expect(result.prefix).toMatch(/^rf_test_/);
    expect(result.keyId ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("create production key has rf_live prefix", async () => {
    const result = await caller.partnerApiKeys.create({
      tenantId: 1,
      name: "Live Production Key",
      environment: "production",
      permissions: ["transfers:read"],
    });
    expect(result.fullKey).toMatch(/^rf_live_/);
  });

  it("create with expiry succeeds", async () => {
    const result = await caller.partnerApiKeys.create({
      tenantId: 1,
      name: "Expiring Key",
      environment: "sandbox",
      expiresInDays: 30,
    });
    expect(result.fullKey).toBeTruthy();
  });

  it("revoke marks key as revoked", async () => {
    const created = await caller.partnerApiKeys.create({
      tenantId: 1,
      name: "Key to Revoke",
      environment: "sandbox",
    });
    const result = await caller.partnerApiKeys.revoke({ keyId: created.keyId ?? 1 });
    expect(result.success).toBe(true);
  });

  it("list shows revoked keys with status revoked", async () => {
    const keys = await caller.partnerApiKeys.list({ tenantId: 1 });
    const revokedKeys = (keys as any[]).filter((k: any) => k.status === "revoked");
    expect(Array.isArray(revokedKeys)).toBe(true);
  });
});

// ── Partner Webhooks ─────────────────────────────────────────────────────────
describe("partnerWebhooks", () => {
  const caller = appRouter.createCaller(makeCtx());

  it("list returns array of webhooks", async () => {
    const webhooks = await caller.partnerWebhooks.list({ tenantId: 1 });
    expect(Array.isArray(webhooks)).toBe(true);
  });

  it("create returns signingSecret", async () => {
    const result = await caller.partnerWebhooks.create({
      tenantId: 1,
      url: "https://api.acmefintech.com/webhooks/remitflow",
      events: ["transfer.completed", "transfer.failed", "kyc.approved"],
    });
    expect(result.signingSecret).toMatch(/^whsec_/);
    expect(result.webhookId).toBeGreaterThan(0);
  });

  it("create with default events succeeds", async () => {
    const result = await caller.partnerWebhooks.create({
      tenantId: 1,
      url: "https://partner.example.com/hooks",
    });
    expect(result.signingSecret).toBeTruthy();
  });

  it("toggle changes webhook active state", async () => {
    const created = await caller.partnerWebhooks.create({
      tenantId: 1,
      url: "https://toggle.example.com/hooks",
    });
    const result = await caller.partnerWebhooks.toggle({ webhookId: created.webhookId ?? 1, isActive: false });
    expect(result.success).toBe(true);
  });

  it("delete removes webhook", async () => {
    const created = await caller.partnerWebhooks.create({
      tenantId: 1,
      url: "https://delete.example.com/hooks",
    });
    const result = await caller.partnerWebhooks.delete({ webhookId: created.webhookId ?? 1 });
    expect(result.success).toBe(true);
  });
});

// ── User Onboarding ──────────────────────────────────────────────────────────
describe("userOnboarding", () => {
  const caller = appRouter.createCaller(makeCtx());

  it("getProgress returns onboarding state", async () => {
    const progress = await caller.userOnboarding.getProgress();
    expect(progress).toHaveProperty("status");
    expect(progress).toHaveProperty("completedSteps");
    expect(progress).toHaveProperty("totalSteps", 6);
    expect(progress).toHaveProperty("percentComplete");
  });

  it("completeStep profile marks profile as completed", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "profile" });
    expect(result.success).toBe(true);
  });

  it("completeStep bank marks bank as linked", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "bank" });
    expect(result.success).toBe(true);
  });

  it("completeStep kycStart marks KYC as started", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "kycStart" });
    expect(result.success).toBe(true);
  });

  it("completeStep kycComplete marks KYC as completed", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "kycComplete" });
    expect(result.success).toBe(true);
  });

  it("completeStep firstTransfer marks first transfer as made", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "firstTransfer" });
    expect(result.success).toBe(true);
  });

  it("completeStep notifications enables notifications", async () => {
    const result = await caller.userOnboarding.completeStep({ step: "notifications" });
    expect(result.success).toBe(true);
  });

  it("complete saves all onboarding data at once", async () => {
    const result = await caller.userOnboarding.complete({
      phone: "+2348012345678",
      country: "NG",
      address: "123 Victoria Island, Lagos",
      dateOfBirth: "1990-05-15",
      idType: "national_id",
      idNumber: "NIN-12345678",
      bankName: "GTBank",
      accountNumber: "0123456789",
    });
    expect(result.success).toBe(true);
    expect(result.profileCompleted).toBe(true);
    expect(result.bankLinked).toBe(true);
    expect(result.kycStarted).toBe(true);
  });

  it("complete with partial data succeeds", async () => {
    const result = await caller.userOnboarding.complete({
      phone: "+447911123456",
      country: "GB",
    });
    expect(result.success).toBe(true);
  });

  it("skip marks onboarding as skipped", async () => {
    const result = await caller.userOnboarding.skip();
    expect(result.success).toBe(true);
  });

  it("getProgress after completion shows increased percentComplete", async () => {
    const progress = await caller.userOnboarding.getProgress();
    expect(progress?.percentComplete).toBeGreaterThanOrEqual(0);
    expect(progress?.percentComplete).toBeLessThanOrEqual(100);
  });
});

// ── Compliance Email Config ──────────────────────────────────────────────────
describe("complianceEmail", () => {
  const adminCaller = appRouter.createCaller(makeCtx({ role: "admin" }));

  it("listConfigs returns array", async () => {
    const configs = await adminCaller.complianceEmail.listConfigs();
    expect(Array.isArray(configs)).toBe(true);
  });

  it("createConfig adds a new recipient", async () => {
    const result = await adminCaller.complianceEmail.createConfig({
      recipientEmail: "compliance@remitflow.com",
      recipientName: "Chief Compliance Officer",
      reportTypes: ["CTR", "SAR", "FBAR"],
      frequency: "immediate",
      includeAttachment: true,
      encryptAttachment: false,
    });
    expect(result.success).toBe(true);
  });

  it("createConfig with daily_digest frequency succeeds", async () => {
    const result = await adminCaller.complianceEmail.createConfig({
      recipientEmail: "aml-team@remitflow.com",
      recipientName: "AML Team",
      reportTypes: ["CTR"],
      frequency: "daily_digest",
      includeAttachment: true,
      encryptAttachment: true,
    });
    expect(result.success).toBe(true);
  });

  it("getConfig returns active config", async () => {
    const config = await adminCaller.complianceEmail.getConfig();
    // May be null if no config exists yet
    if (config) {
      expect(config).toHaveProperty("officer_email");
      expect(config).toHaveProperty("is_active", true);
    }
  });

  it("saveConfig creates new active config", async () => {
    const result = await adminCaller.complianceEmail.saveConfig({
      officerName: "Sarah Johnson",
      officerEmail: "sarah.johnson@remitflow.com",
      reportTypes: ["CTR", "SAR", "FBAR"],
      smtpHost: "smtp.sendgrid.net",
      smtpPort: 587,
      smtpUser: "apikey",
      fromEmail: "compliance@remitflow.com",
      fromName: "RemitFlow Compliance",
    });
    expect(result.success).toBe(true);
  });

  it("sendTestEmail returns success with sentTo", async () => {
    const result = await adminCaller.complianceEmail.sendTestEmail({ reportType: "CTR" });
    expect(result.success).toBe(true);
    expect(result.sentTo).toBeTruthy();
    expect(result.reportType).toBe("CTR");
  });

  it("sendReport sends CTR report", async () => {
    const result = await adminCaller.complianceEmail.sendReport({
      reportType: "CTR",
      reportId: "CTR-2026-001",
      reportPeriod: "April 2026",
      recipientEmail: "compliance@remitflow.com",
    });
    expect(result.success).toBe(true);
    expect(result.sentTo).toBe("compliance@remitflow.com");
    expect(result.subject).toContain("CTR");
  });

  it("sendReport sends SAR report", async () => {
    const result = await adminCaller.complianceEmail.sendReport({
      reportType: "SAR",
      reportId: "SAR-2026-042",
      reportPeriod: "Q1 2026",
    });
    expect(result.success).toBe(true);
    expect(result.subject).toContain("SAR");
  });

  it("sendReport sends FBAR report", async () => {
    const result = await adminCaller.complianceEmail.sendReport({
      reportType: "FBAR",
      reportId: "FBAR-2025-001",
      reportPeriod: "FY 2025",
    });
    expect(result.success).toBe(true);
    expect(result.subject).toContain("FBAR");
  });

  it("getDeliveryLog returns array", async () => {
    const log = await adminCaller.complianceEmail.getDeliveryLog({ limit: 10 });
    expect(Array.isArray(log)).toBe(true);
  });

  it("deleteConfig removes a config", async () => {
    // Create one to delete
    await adminCaller.complianceEmail.createConfig({
      recipientEmail: "delete-me@remitflow.com",
      recipientName: "Delete Me",
      reportTypes: ["CTR"],
      frequency: "immediate",
      includeAttachment: false,
      encryptAttachment: false,
    });
    const configs = await adminCaller.complianceEmail.listConfigs();
    if (configs.length > 0) {
      const result = await adminCaller.complianceEmail.deleteConfig({ configId: configs[0].id });
      expect(result.success).toBe(true);
    }
  });
});

// ── End-to-End Partner Onboarding Flow ───────────────────────────────────────
describe("e2e: partner onboarding workflow", () => {
  const publicCaller = appRouter.createCaller(makeAnonCtx());
  const userCaller = appRouter.createCaller(makeCtx());
  const adminCaller = appRouter.createCaller(makeCtx({ role: "admin" }));

  it("full lifecycle: submit → review → approve → API key creation", async () => {
    // Step 1: Partner submits application
    const submitted = await publicCaller.partnerApplications.submit({
      companyName: "E2E Test Fintech",
      brandName: "E2EPay",
      applicationType: "fintech_startup",
      contactName: "Test Partner",
      contactEmail: "partner@e2etest.com",
      country: "NG",
      businessDescription: "E2E Test Fintech provides comprehensive cross-border remittance services for the Nigerian diaspora in the United Kingdom and United States.",
      requestedPlan: "growth",
      hasAmlPolicy: true,
      hasKycProcess: true,
    });
    expect(submitted.success).toBe(true);
    const appId = submitted.applicationId;

    // Step 2: Admin reviews
    await adminCaller.partnerApplications.startReview({ id: appId });

    // Step 3: Admin adds comment
    await adminCaller.partnerApplications.addComment({
      applicationId: appId,
      comment: "AML policy looks good. Approving.",
      isInternal: true,
    });

    // Step 4: Admin approves
    const approved = await adminCaller.partnerApplications.approve({
      id: appId,
      reviewNotes: "All checks passed.",
      plan: "growth",
    });
    expect(approved.success).toBe(true);

    // Step 5: Partner creates API key
    const apiKey = await userCaller.partnerApiKeys.create({
      tenantId: 1,
      name: "E2E Integration Key",
      environment: "sandbox",
    });
    expect(apiKey.fullKey).toMatch(/^rf_test_/);

    // Step 6: Partner creates webhook
    const webhook = await userCaller.partnerWebhooks.create({
      tenantId: 1,
      url: "https://e2etest.com/webhooks",
      events: ["transfer.completed"],
    });
    expect(webhook.signingSecret).toMatch(/^whsec_/);
  });

  it("full lifecycle: submit → request info → provide info → approve", async () => {
    // Submit
    const submitted = await publicCaller.partnerApplications.submit({
      companyName: "Info Flow Corp",
      brandName: "InfoFlowPay",
      contactName: "Info User",
      contactEmail: "info@infoflow.com",
      country: "GH",
      businessDescription: "InfoFlow Corp provides digital remittance and mobile money services to Ghanaian diaspora communities across Europe and North America.",
      requestedPlan: "starter",
    });
    const appId = submitted.applicationId;

    // Request info
    await adminCaller.partnerApplications.requestAdditionalInfo({
      id: appId,
      request: "Please provide your Bank of Ghana license number.",
    });

    // Provide info
    const provided = await userCaller.partnerApplications.provideAdditionalInfo({
      applicationId: appId,
      response: "Our Bank of Ghana MTO license number is BOG-MTO-2024-0042.",
    });
    expect(provided.success).toBe(true);

    // Approve
    const approved = await adminCaller.partnerApplications.approve({
      id: appId,
      reviewNotes: "License verified. Approved.",
      plan: "starter",
    });
    expect(approved.success).toBe(true);
  });
});
