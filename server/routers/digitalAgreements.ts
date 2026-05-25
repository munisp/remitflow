import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { createAuditLog, getDb } from "../db.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";


import {
  agreementTemplates,
  partnerDigitalAgreements,
  agreementSignatures,
  revenueShareAgreements,
  tenants,
} from "../../drizzle/schema.js";
import { storagePut } from "../storage.js";
import crypto from "crypto";

async function _db() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// ─── Default platform-favorable agreement template ──────────────────────────
const DEFAULT_AGREEMENT_TEMPLATE = `REVENUE SHARE PARTNERSHIP AGREEMENT

This Revenue Share Partnership Agreement ("Agreement") is entered into as of the Effective Date between:

PLATFORM VENDOR: RemitFlow Technologies Ltd ("RemitFlow", "Platform", "Company")
Registered Address: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom
Company Registration: 14872391

PARTNER: [PARTNER_COMPANY] ("Partner", "White-Label Partner")
Contact: [PARTNER_NAME], [PARTNER_TITLE]
Email: [PARTNER_EMAIL]

EFFECTIVE DATE: [EFFECTIVE_DATE]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. DEFINITIONS

1.1 "Gross Fee Revenue" means all fees, commissions, spreads, and charges collected by RemitFlow from end-users transacting through the Partner's white-label deployment, before deduction of any costs.

1.2 "Net Revenue" means Gross Fee Revenue less payment processing costs, regulatory compliance costs, fraud losses, chargebacks, and refunds attributable to Partner transactions.

1.3 "Partner Share" means the percentage of Net Revenue allocated to Partner as specified in Schedule A.

1.4 "Platform Share" means the percentage of Net Revenue retained by RemitFlow, being 100% minus the Partner Share.

1.5 "Transaction Volume" means the aggregate USD-equivalent value of all money transfers processed through Partner's deployment in a given calendar month.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. REVENUE SHARE MODEL

2.1 RemitFlow shall retain a minimum of 70% of Net Revenue ("Platform Floor") in all circumstances, regardless of transaction volume or tier achieved.

2.2 Partner's maximum revenue share shall not exceed 30% of Net Revenue under any circumstances.

2.3 Revenue share tiers are set forth in Schedule A and may be revised by RemitFlow with 30 days' written notice.

2.4 Revenue share is calculated on a calendar-month basis. Partial months are prorated.

2.5 Minimum monthly payout threshold: USD 50.00. Amounts below this threshold are carried forward to the next period.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. INTELLECTUAL PROPERTY

3.1 RemitFlow retains all intellectual property rights in the Platform, including but not limited to: source code, algorithms, compliance frameworks, brand assets, and proprietary data models.

3.2 Partner is granted a non-exclusive, non-transferable, revocable license to use RemitFlow's white-label technology solely for the purpose of operating the Partner's branded remittance service.

3.3 Partner shall not reverse-engineer, decompile, or attempt to derive source code from the Platform.

3.4 Any improvements, modifications, or derivative works created by RemitFlow (including those requested by Partner) remain the exclusive property of RemitFlow.

3.5 Partner's brand assets, trademarks, and customer data remain the property of Partner.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. DATA OWNERSHIP AND PRIVACY

4.1 RemitFlow owns all aggregated, anonymized transaction data and may use it for platform improvement, risk modeling, and regulatory reporting.

4.2 Partner owns its customer PII (personally identifiable information) subject to applicable data protection laws.

4.3 RemitFlow acts as a data processor on behalf of Partner for customer PII, subject to the Data Processing Addendum (Schedule B).

4.4 Partner must maintain GDPR/applicable data protection compliance for its customer base.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5. COMPLIANCE AND REGULATORY

5.1 RemitFlow holds all required financial services licenses and regulatory approvals. Partner operates under RemitFlow's regulatory umbrella.

5.2 Partner must comply with all applicable AML/KYC requirements and shall not onboard customers that RemitFlow's compliance engine has flagged or rejected.

5.3 Partner is responsible for ensuring its marketing materials comply with applicable financial promotions regulations.

5.4 RemitFlow may suspend Partner's access immediately and without notice if regulatory authorities require it or if Partner is found to be in breach of compliance obligations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6. LIABILITY AND INDEMNIFICATION

6.1 RemitFlow's total liability to Partner under this Agreement shall not exceed the total revenue share paid to Partner in the three (3) months preceding the claim.

6.2 RemitFlow shall not be liable for: indirect, consequential, or punitive damages; loss of profits or revenue; loss of data; or business interruption.

6.3 Partner shall indemnify and hold harmless RemitFlow from any claims, damages, or expenses arising from: Partner's breach of this Agreement; Partner's negligence or misconduct; Partner's regulatory non-compliance; or claims by Partner's customers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

7. TERM AND TERMINATION

7.1 This Agreement commences on the Effective Date and continues for an initial term of twelve (12) months, auto-renewing annually unless terminated.

7.2 RemitFlow may terminate this Agreement immediately upon written notice if: Partner breaches any material term; Partner becomes insolvent; regulatory requirements necessitate termination; or Partner's transaction volume falls below USD 10,000 per month for three consecutive months.

7.3 Partner may terminate with 90 days' written notice, subject to settlement of all outstanding revenue share obligations.

7.4 Upon termination, Partner's access to the Platform is revoked immediately. RemitFlow will provide Partner's customer data within 30 days.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8. GOVERNING LAW AND DISPUTE RESOLUTION

8.1 This Agreement is governed by the laws of England and Wales.

8.2 Any disputes shall be resolved by binding arbitration under the ICC Rules, seated in London.

8.3 The language of arbitration shall be English.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCHEDULE A — REVENUE SHARE TIERS

| Monthly Transaction Volume (USD) | Partner Share | Platform Share |
|-----------------------------------|---------------|----------------|
| USD 0 – 99,999                    | 15%           | 85%            |
| USD 100,000 – 499,999             | 20%           | 80%            |
| USD 500,000 – 1,999,999           | 25%           | 75%            |
| USD 2,000,000+                    | 30%           | 70%            |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BY DIGITALLY SIGNING BELOW, BOTH PARTIES AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT.

REMITFLOW TECHNOLOGIES LTD
Authorized Signatory: [PLATFORM_SIGNER]
Title: Chief Executive Officer
Date: [PLATFORM_SIGN_DATE]

PARTNER
Authorized Signatory: [PARTNER_NAME]
Title: [PARTNER_TITLE]
Company: [PARTNER_COMPANY]
Date: [PARTNER_SIGN_DATE]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIGITAL SIGNATURE VERIFICATION

This document was digitally signed via the RemitFlow Partner Portal.
Agreement ID: [AGREEMENT_ID]
Verification Hash: [VERIFICATION_HASH]
Timestamp (UTC): [SIGN_TIMESTAMP]
IP Address: [SIGNER_IP]

This electronic signature is legally binding under the Electronic Communications Act 2000 (UK), eIDAS Regulation (EU), and the Electronic Signatures in Global and National Commerce Act (US).
`;

// ─── Router ─────────────────────────────────────────────────────────────────
export const digitalAgreementsRouter = router({
  // Get default template
  getTemplate: adminProcedure.query(async () => {
    const [template] = (await _db()).select()
      .from(agreementTemplates)
      .where(and(eq(agreementTemplates.type, "revenue_share"), eq(agreementTemplates.isActive, true)))
      .orderBy(desc(agreementTemplates.createdAt))
      .limit(1);
    return template || null;
  }),

  // Create/update default template
  upsertTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      version: z.string().default("1.0"),
      content: z.string().min(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const [template] = (await _db()).insert(agreementTemplates)
        .values({
          name: input.name,
          version: input.version,
          type: "revenue_share",
          content: input.content,
          isActive: true,
          createdBy: ctx.user.id,
        })
        .returning();
      await createAuditLog({ userId: ctx.user.id, action: "agreement_template_created", targetType: "agreement_templates", targetId: template.id, metadata: { name: input.name, version: input.version } });
      return template;
    }),

  // List all digital agreements (admin)
  listAll: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      tenantId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.status) conditions.push(eq(partnerDigitalAgreements.status, input.status as any));
      if (input.tenantId) conditions.push(eq(partnerDigitalAgreements.tenantId, input.tenantId));

      const [items, [{ count }]] = await Promise.all([
        (await _db()).select().from(partnerDigitalAgreements)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(partnerDigitalAgreements.createdAt))
          .limit(input.limit).offset(offset),
        (await _db()).select({ count: sql<number>`count(*)::int` }).from(partnerDigitalAgreements)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);
      return { items, total: count, page: input.page, limit: input.limit };
    }),

  // Get single agreement
  getById: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [agreement] = (await _db()).select()
        .from(partnerDigitalAgreements)
        .where(eq(partnerDigitalAgreements.id, input.id));
      if (!agreement) throw new TRPCError({ code: "NOT_FOUND" });

      const signatures = (await _db()).select()
        .from(agreementSignatures)
        .where(eq(agreementSignatures.agreementDocId, input.id))
        .orderBy(desc(agreementSignatures.signedAt));

      return { ...agreement, signatures };
    }),

  // Create digital agreement for a revenue share agreement
  create: adminProcedure
    .input(z.object({
      revenueShareAgreementId: z.number().int(),
      partnerName: z.string().min(1),
      partnerEmail: z.string().email(),
      partnerTitle: z.string().optional(),
      partnerCompany: z.string().optional(),
      customText: z.string().optional(),
      expiresInDays: z.number().int().min(1).max(365).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const [revShareAgreement] = (await _db()).select({ id: revenueShareAgreements.id, tenantId: revenueShareAgreements.tenantId })
        .from(revenueShareAgreements)
        .where(eq(revenueShareAgreements.id, input.revenueShareAgreementId));
      if (!revShareAgreement) throw new TRPCError({ code: "NOT_FOUND", message: "Revenue share agreement not found" });

      // Get or use default template
      const [template] = (await _db()).select()
        .from(agreementTemplates)
        .where(and(eq(agreementTemplates.type, "revenue_share"), eq(agreementTemplates.isActive, true)))
        .orderBy(desc(agreementTemplates.createdAt))
        .limit(1);

      const templateContent = input.customText || template?.content || DEFAULT_AGREEMENT_TEMPLATE;
      const now = new Date();
      const agreementText = templateContent
        .replace(/\[PARTNER_NAME\]/g, input.partnerName)
        .replace(/\[PARTNER_EMAIL\]/g, input.partnerEmail)
        .replace(/\[PARTNER_TITLE\]/g, input.partnerTitle || "Authorized Signatory")
        .replace(/\[PARTNER_COMPANY\]/g, input.partnerCompany || "Partner Organization")
        .replace(/\[EFFECTIVE_DATE\]/g, now.toISOString().split("T")[0])
        .replace(/\[AGREEMENT_ID\]/g, `RSA-${input.revenueShareAgreementId}-${Date.now()}`);

      const expiresAt = new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);

      const [doc] = (await _db()).insert(partnerDigitalAgreements)
        .values({
          agreementId: input.revenueShareAgreementId,
          templateId: template?.id,
          tenantId: revShareAgreement.tenantId,
          status: "draft",
          agreementText,
          partnerName: input.partnerName,
          partnerEmail: input.partnerEmail,
          partnerTitle: input.partnerTitle,
          partnerCompany: input.partnerCompany,
          expiresAt,
          auditTrail: [{ event: "created", timestamp: now.toISOString(), userId: ctx.user.id, details: "Agreement created by admin" }],
        })
        .returning();

      await createAuditLog({ userId: ctx.user.id, action: "digital_agreement_created", targetType: "partner_digital_agreements", targetId: doc.id, metadata: { partnerEmail: input.partnerEmail } });
      return doc;
    }),

  // Send agreement to partner
  send: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await (await _db()).select().from(partnerDigitalAgreements).where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      if (doc.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft agreements can be sent" });

      const now = new Date();
      const auditTrail = [...(doc.auditTrail || []), { event: "sent", timestamp: now.toISOString(), userId: ctx.user.id, details: `Sent to ${doc.partnerEmail}` }];

      const [updated] = (await _db()).update(partnerDigitalAgreements)
        .set({ status: "sent", sentAt: now, auditTrail, updatedAt: now })
        .where(eq(partnerDigitalAgreements.id, input.id))
        .returning();

      await createAuditLog({ userId: ctx.user.id, action: "digital_agreement_sent", targetType: "partner_digital_agreements", targetId: input.id, metadata: { partnerEmail: doc.partnerEmail } });
      return updated;
    }),

  // Partner views agreement (public — called when partner opens the link)
  markViewed: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await (await _db()).select().from(partnerDigitalAgreements).where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      if (doc.status === "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Agreement has not been sent yet" });

      if (doc.status === "sent") {
        const now = new Date();
        const auditTrail = [...(doc.auditTrail || []), {
          event: "viewed",
          timestamp: now.toISOString(),
          ipAddress: ctx.req.headers["x-forwarded-for"] as string || ctx.req.socket.remoteAddress,
          details: "Partner viewed the agreement",
        }];
        await (await _db()).update(partnerDigitalAgreements)
          .set({ status: "viewed", viewedAt: now, auditTrail, updatedAt: now })
          .where(eq(partnerDigitalAgreements.id, input.id));
      }
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Partner digitally signs (checkbox acceptance)
  digitalSign: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      signerName: z.string().min(1),
      signerEmail: z.string().email(),
      signerTitle: z.string().optional(),
      checkboxConfirmed: z.literal(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await (await _db()).select().from(partnerDigitalAgreements).where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["sent", "viewed"].includes(doc.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Agreement cannot be signed in its current status" });
      }
      if (doc.expiresAt && new Date() > doc.expiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This agreement has expired. Please request a new one." });
      }

      const now = new Date();
      const ipAddress = ctx.req.headers["x-forwarded-for"] as string || ctx.req.socket.remoteAddress || "unknown";
      const userAgent = ctx.req.headers["user-agent"] || "unknown";

      // Generate verification hash
      const verificationHash = crypto
        .createHash("sha256")
        .update(`${input.id}:${input.signerEmail}:${now.toISOString()}:${ipAddress}`)
        .digest("hex");

      // Record signature
      const [signature] = (await _db()).insert(agreementSignatures)
        .values({
          agreementDocId: input.id,
          signerType: "partner",
          signerUserId: ctx.user.id,
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signerTitle: input.signerTitle,
          method: "digital_checkbox",
          ipAddress,
          userAgent,
          checkboxConfirmed: true,
          signedAt: now,
          isValid: true,
          verificationHash,
        })
        .returning();

      const auditTrail = [...(doc.auditTrail || []), {
        event: "digitally_signed",
        timestamp: now.toISOString(),
        ipAddress,
        userId: ctx.user.id,
        details: `Digitally signed by ${input.signerName} (${input.signerEmail}) via checkbox acceptance. Hash: ${verificationHash.slice(0, 16)}...`,
      }];

      const [updated] = (await _db()).update(partnerDigitalAgreements)
        .set({
          status: "digitally_signed",
          digitallySignedAt: now,
          partnerIpAddress: ipAddress,
          partnerUserAgent: userAgent,
          auditTrail,
          updatedAt: now,
        })
        .where(eq(partnerDigitalAgreements.id, input.id))
        .returning();

      await createAuditLog({ userId: ctx.user.id, action: "digital_agreement_signed", targetType: "partner_digital_agreements", targetId: input.id, metadata: { signerEmail: input.signerEmail, verificationHash } });
      return { ...updated, signature };
    }),

  // Upload physical signed document
  uploadPhysicalDocument: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      fileBase64: z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await (await _db()).select().from(partnerDigitalAgreements).where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const buffer = Buffer.from(input.fileBase64, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File size must be under 10MB" });
      }

      const suffix = crypto.randomBytes(8).toString("hex");
      const fileKey = `agreements/${input.id}/physical-${suffix}-${input.fileName}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      const now = new Date();
      const auditTrail = [...(doc.auditTrail || []), {
        event: "physical_document_uploaded",
        timestamp: now.toISOString(),
        userId: ctx.user.id,
        details: `Physical signed document uploaded: ${input.fileName}`,
      }];

      const newStatus = doc.status === "digitally_signed" ? "fully_executed" : "physically_signed";

      const [updated] = (await _db()).update(partnerDigitalAgreements)
        .set({
          status: newStatus as any,
          physicallySignedAt: now,
          physicalDocumentUrl: url,
          physicalDocumentKey: fileKey,
          fullyExecutedAt: newStatus === "fully_executed" ? now : undefined,
          auditTrail,
          updatedAt: now,
        })
        .where(eq(partnerDigitalAgreements.id, input.id))
        .returning();

      await createAuditLog({ userId: ctx.user.id, action: "physical_document_uploaded", targetType: "partner_digital_agreements", targetId: input.id, metadata: { fileKey, status: newStatus } });
      return updated;
    }),

  // Platform countersigns (admin)
  platformSign: adminProcedure
    .input(z.object({
      id: z.number().int(),
      signerName: z.string().min(1).default("RemitFlow CEO"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await (await _db()).select().from(partnerDigitalAgreements).where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const now = new Date();
      const verificationHash = crypto
        .createHash("sha256")
        .update(`platform:${input.id}:${ctx.user.id}:${now.toISOString()}`)
        .digest("hex");

      await (await _db()).insert(agreementSignatures).values({
        agreementDocId: input.id,
        signerType: "platform",
        signerUserId: ctx.user.id,
        signerName: input.signerName,
        signerEmail: "legal@remitflow.io",
        signerTitle: "Chief Executive Officer",
        method: "digital_checkbox",
        checkboxConfirmed: true,
        signedAt: now,
        isValid: true,
        verificationHash,
      });

      const auditTrail = [...(doc.auditTrail || []), {
        event: "platform_countersigned",
        timestamp: now.toISOString(),
        userId: ctx.user.id,
        details: `Platform countersigned by ${input.signerName}`,
      }];

      const [updated] = (await _db()).update(partnerDigitalAgreements)
        .set({
          platformSignedBy: ctx.user.id,
          platformSignedAt: now,
          status: "fully_executed",
          fullyExecutedAt: now,
          auditTrail,
          updatedAt: now,
        })
        .where(eq(partnerDigitalAgreements.id, input.id))
        .returning();

      await createAuditLog({ userId: ctx.user.id, action: "platform_countersigned", targetType: "partner_digital_agreements", targetId: input.id, metadata: {} });
      return updated;
    }),

  // Get audit trail
  getAuditTrail: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [doc] = (await _db()).select({ auditTrail: partnerDigitalAgreements.auditTrail, status: partnerDigitalAgreements.status })
        .from(partnerDigitalAgreements)
        .where(eq(partnerDigitalAgreements.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      return doc;
    }),

  // Get partner's own agreements
  myAgreements: protectedProcedure.query(async ({ ctx }) => {
    return (await _db()).select()
      .from(partnerDigitalAgreements)
      .where(eq(partnerDigitalAgreements.partnerEmail, ctx.user.email || ""))
      .orderBy(desc(partnerDigitalAgreements.createdAt));
  }),

  // Stats for dashboard
  stats: adminProcedure.query(async () => {
    const [stats] = await (await _db()).select({
      total: sql<number>`count(*)::int`,
      draft: sql<number>`count(*) filter (where status = 'draft')::int`,
      sent: sql<number>`count(*) filter (where status = 'sent')::int`,
      signed: sql<number>`count(*) filter (where status = 'digitally_signed')::int`,
      executed: sql<number>`count(*) filter (where status = 'fully_executed')::int`,
      expired: sql<number>`count(*) filter (where status = 'expired')::int`,
    }).from(partnerDigitalAgreements);
    return stats;
  }),
});
