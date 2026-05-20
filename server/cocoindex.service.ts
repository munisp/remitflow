/**
 * RemitFlow — CocoIndex Pipeline Service
 *
 * CocoIndex is an incremental data transformation framework for AI pipelines.
 * It tracks what's been processed and only re-processes changed data.
 *
 * RemitFlow uses CocoIndex for:
 *  1. Transaction narrative indexing → Qdrant vectors (incremental)
 *  2. Compliance document processing → FalkorDB knowledge graph nodes
 *  3. User profile embedding → Qdrant user_profiles collection
 *  4. KYC document text extraction → structured compliance records
 *  5. Regulatory report generation → lakehouse Parquet files
 *
 * Since CocoIndex is a Python framework, this service:
 *  a) Calls the Python CocoIndex microservice via HTTP when available
 *  b) Falls back to a TypeScript implementation of the same pipeline logic
 *
 * The Python CocoIndex service runs at services/cocoindex-pipeline/
 */

import { upsertTransactionVector, upsertBeneficiaryVector, upsertKBArticle } from "./qdrant.service.js";
import { upsertTransactionNode, upsertUserNode } from "./falkordb.service.js";
import { getDb } from "./db.js";
import { logger } from './_core/logger';

// ── Config ────────────────────────────────────────────────────────────────────
const COCOINDEX_URL = process.env.COCOINDEX_URL || "http://localhost:8095";

// ── Pipeline State Tracking ───────────────────────────────────────────────────
interface PipelineCheckpoint {
  lastProcessedId: number;
  lastRunAt: number;
  itemsProcessed: number;
  errors: number;
}

const checkpoints: Record<string, PipelineCheckpoint> = {
  transactions: { lastProcessedId: 0, lastRunAt: 0, itemsProcessed: 0, errors: 0 },
  beneficiaries: { lastProcessedId: 0, lastRunAt: 0, itemsProcessed: 0, errors: 0 },
  users: { lastProcessedId: 0, lastRunAt: 0, itemsProcessed: 0, errors: 0 },
  kb_articles: { lastProcessedId: 0, lastRunAt: 0, itemsProcessed: 0, errors: 0 },
};

// ── CocoIndex Python Service Proxy ────────────────────────────────────────────
async function callCocoIndexService(endpoint: string, body: any): Promise<any> {
  try {
    const response = await fetch(`${COCOINDEX_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return null; // Service not available, use TypeScript fallback
  }
}

// ── Pipeline: Transaction Indexing ────────────────────────────────────────────
/**
 * Incremental pipeline: index new/updated transactions into Qdrant + FalkorDB.
 * Only processes transactions with ID > lastProcessedId (CocoIndex pattern).
 */
export async function runTransactionIndexingPipeline(batchSize = 100): Promise<{
  processed: number;
  errors: number;
  lastId: number;
  durationMs: number;
}> {
  const start = Date.now();
  const cp = checkpoints.transactions;
  const db = await getDb();

  // Try Python CocoIndex service first
  const pyResult = await callCocoIndexService("/pipeline/transactions", {
    lastProcessedId: cp.lastProcessedId,
    batchSize,
  });
  if (pyResult?.processed !== undefined) {
    cp.lastProcessedId = pyResult.lastId;
    cp.lastRunAt = Date.now();
    cp.itemsProcessed += pyResult.processed;
    return { ...pyResult, durationMs: Date.now() - start };
  }

  // TypeScript fallback pipeline
  let processed = 0;
  let errors = 0;
  let lastId = cp.lastProcessedId;

  try {
    const rows = await db.execute(
      `SELECT t.id, t.user_id, t.amount, t.currency, t.to_currency,
              t.status, t.risk_score, t.reference, t.destination_country,
              b.name AS beneficiary_name, b.account_number AS beneficiary_account
       FROM transactions t
       LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
       WHERE t.id > ${cp.lastProcessedId}
       ORDER BY t.id ASC
       LIMIT ${batchSize}`
    );

    for (const row of rows.rows as any[]) {
      try {
        // Index into Qdrant
        await upsertTransactionVector({
          id: row.id,
          userId: row.user_id,
          amount: parseFloat(row.amount),
          currency: row.currency,
          toCurrency: row.to_currency || "USD",
          beneficiaryName: row.beneficiary_name || "Unknown",
          destinationCountry: row.destination_country || "US",
          status: row.status,
          riskScore: parseFloat(row.risk_score || "0"),
          reference: row.reference,
        });

        // Index into FalkorDB
        await upsertTransactionNode({
          id: row.id,
          userId: row.user_id,
          amount: parseFloat(row.amount),
          currency: row.currency,
          toCurrency: row.to_currency || "USD",
          beneficiaryName: row.beneficiary_name || "Unknown",
          beneficiaryAccount: row.beneficiary_account || `acc_${row.id}`,
          destinationCountry: row.destination_country || "US",
          status: row.status,
          riskScore: parseFloat(row.risk_score || "0"),
          reference: row.reference,
        });

        lastId = row.id;
        processed++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    logger.error({ err: err }, '[CocoIndex] Transaction pipeline error:');
    errors++;
  }

  cp.lastProcessedId = lastId;
  cp.lastRunAt = Date.now();
  cp.itemsProcessed += processed;
  cp.errors += errors;

  return { processed, errors, lastId, durationMs: Date.now() - start };
}

// ── Pipeline: Beneficiary Deduplication ──────────────────────────────────────
export async function runBeneficiaryIndexingPipeline(batchSize = 200): Promise<{
  processed: number;
  errors: number;
  lastId: number;
  durationMs: number;
}> {
  const start = Date.now();
  const cp = checkpoints.beneficiaries;
  const db = await getDb();

  let processed = 0;
  let errors = 0;
  let lastId = cp.lastProcessedId;

  try {
    const rows = await db.execute(
      `SELECT id, user_id, name, account_number, bank_name, country, currency
       FROM beneficiaries
       WHERE id > ${cp.lastProcessedId}
       ORDER BY id ASC
       LIMIT ${batchSize}`
    );

    for (const row of rows.rows as any[]) {
      try {
        await upsertBeneficiaryVector({
          id: row.id,
          userId: row.user_id,
          name: row.name,
          accountNumber: row.account_number,
          bankName: row.bank_name || "",
          country: row.country || "US",
          currency: row.currency || "USD",
        });
        lastId = row.id;
        processed++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    logger.error({ err: err }, '[CocoIndex] Beneficiary pipeline error:');
    errors++;
  }

  cp.lastProcessedId = lastId;
  cp.lastRunAt = Date.now();
  cp.itemsProcessed += processed;
  return { processed, errors, lastId, durationMs: Date.now() - start };
}

// ── Pipeline: User Profile Indexing ──────────────────────────────────────────
export async function runUserProfileIndexingPipeline(batchSize = 100): Promise<{
  processed: number;
  errors: number;
  lastId: number;
  durationMs: number;
}> {
  const start = Date.now();
  const cp = checkpoints.users;
  const db = await getDb();

  let processed = 0;
  let errors = 0;
  let lastId = cp.lastProcessedId;

  try {
    const rows = await db.execute(
      `SELECT u.id, u.name, u.email, u.created_at,
              COUNT(t.id) AS tx_count,
              COALESCE(AVG(t.risk_score), 0) AS avg_risk
       FROM users u
       LEFT JOIN transactions t ON t.user_id = u.id
       WHERE u.id > ${cp.lastProcessedId}
       GROUP BY u.id, u.name, u.email, u.created_at
       ORDER BY u.id ASC
       LIMIT ${batchSize}`
    );

    for (const row of rows.rows as any[]) {
      try {
        await upsertUserNode({
          id: row.id,
          name: row.name || "Unknown",
          email: row.email || "",
          country: "US",
          kycTier: "basic",
          riskScore: parseFloat(row.avg_risk || "0"),
        });
        lastId = row.id;
        processed++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    logger.error({ err: err }, '[CocoIndex] User pipeline error:');
    errors++;
  }

  cp.lastProcessedId = lastId;
  cp.lastRunAt = Date.now();
  cp.itemsProcessed += processed;
  return { processed, errors, lastId, durationMs: Date.now() - start };
}

// ── Pipeline: KB Article Indexing ─────────────────────────────────────────────
const KB_ARTICLES = [
  { id: 1, title: "How to send money internationally", content: "RemitFlow allows you to send money to over 150 countries. Simply enter the recipient details, amount, and confirm the transfer. Funds typically arrive within 1-3 business days.", category: "transfers", tags: ["send", "international", "how-to"] },
  { id: 2, title: "KYC verification requirements", content: "To comply with anti-money laundering regulations, we require identity verification. Tier 1 requires email. Tier 2 requires government ID. Tier 3 requires proof of address.", category: "compliance", tags: ["kyc", "verification", "identity"] },
  { id: 3, title: "Exchange rate and fee structure", content: "RemitFlow charges a transparent fee of 1.5% + $2.99 per transfer. Exchange rates are updated every 15 minutes from major FX providers.", category: "fees", tags: ["fees", "exchange-rate", "pricing"] },
  { id: 4, title: "Fraud prevention and security", content: "We use AI-powered fraud detection to protect your transfers. Suspicious transactions are flagged for review. Enable 2FA for additional security.", category: "security", tags: ["fraud", "security", "2fa"] },
  { id: 5, title: "Supported countries and corridors", content: "We support transfers to 150+ countries. Popular corridors include USA-Nigeria, UK-Ghana, Canada-Kenya, and more. Some countries have restrictions.", category: "countries", tags: ["countries", "corridors", "supported"] },
  { id: 6, title: "Transaction limits and thresholds", content: "Daily limit: $10,000 for verified users. Monthly limit: $50,000. High-value transfers above $3,000 require additional verification.", category: "limits", tags: ["limits", "thresholds", "daily"] },
  { id: 7, title: "Compliance and AML policy", content: "RemitFlow complies with FATF recommendations, FinCEN regulations, and local AML laws. All transactions are screened against OFAC, UN, and EU sanctions lists.", category: "compliance", tags: ["aml", "compliance", "sanctions"] },
  { id: 8, title: "Refund and dispute resolution", content: "If a transfer fails, funds are returned within 3-5 business days. For disputes, contact support within 30 days. We investigate all fraud claims within 48 hours.", category: "support", tags: ["refund", "dispute", "support"] },
];

export async function runKBIndexingPipeline(): Promise<{
  processed: number;
  errors: number;
  durationMs: number;
}> {
  const start = Date.now();
  let processed = 0;
  let errors = 0;

  for (const article of KB_ARTICLES) {
    try {
      await upsertKBArticle(article);
      processed++;
    } catch {
      errors++;
    }
  }

  return { processed, errors, durationMs: Date.now() - start };
}

// ── Full Pipeline Run ─────────────────────────────────────────────────────────
export async function runFullIndexingPipeline(): Promise<{
  transactions: Awaited<ReturnType<typeof runTransactionIndexingPipeline>>;
  beneficiaries: Awaited<ReturnType<typeof runBeneficiaryIndexingPipeline>>;
  users: Awaited<ReturnType<typeof runUserProfileIndexingPipeline>>;
  kb: Awaited<ReturnType<typeof runKBIndexingPipeline>>;
  totalDurationMs: number;
}> {
  const start = Date.now();
  const [transactions, beneficiaries, users, kb] = await Promise.all([
    runTransactionIndexingPipeline(),
    runBeneficiaryIndexingPipeline(),
    runUserProfileIndexingPipeline(),
    runKBIndexingPipeline(),
  ]);
  return {
    transactions,
    beneficiaries,
    users,
    kb,
    totalDurationMs: Date.now() - start,
  };
}

// ── Status ────────────────────────────────────────────────────────────────────
export function getCocoIndexStatus(): {
  pipelines: Record<string, PipelineCheckpoint & { name: string }>;
  pythonServiceUrl: string;
} {
  return {
    pipelines: Object.fromEntries(
      Object.entries(checkpoints).map(([k, v]) => [k, { name: k, ...v }])
    ),
    pythonServiceUrl: COCOINDEX_URL,
  };
}
