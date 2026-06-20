/**
 * RemitFlow Fraud Detection & AML Screening Service
 * Implements velocity checks, risk scoring, sanctions screening, and AML rules
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { transactions, auditLogs } from "../drizzle/schema";
import { logger } from './_core/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FraudCheckInput {
  userId: number;
  amount: number;
  currency: string;
  toCurrency: string;
  beneficiaryName?: string;
  beneficiaryAccount?: string;
  beneficiaryBank?: string;
  ipAddress?: string;
  deviceId?: string;
}

export interface FraudCheckResult {
  approved: boolean;
  riskScore: number;       // 0-100 (0=safe, 100=blocked)
  riskLevel: "low" | "medium" | "high" | "blocked";
  flags: string[];
  requiresReview: boolean;
  requiresMFA: boolean;
  amlFlag: boolean;
  sanctionsHit: boolean;
}

// ─── Sanctions List (OFAC/UN/EU - simplified) ─────────────────────────────────
const SANCTIONED_COUNTRIES = new Set([
  "IR", "KP", "SY", "CU", "VE", "MM", "BY", "RU", "UA",
]);

const SANCTIONED_KEYWORDS = [
  "al-qaeda", "isis", "isil", "daesh", "taliban", "hamas", "hezbollah",
  "boko haram", "al-shabaab", "wagner group",
];

const HIGH_RISK_COUNTRIES = new Set([
  "AF", "AL", "BB", "BF", "CM", "CD", "GI", "HT", "JM", "JO",
  "ML", "MZ", "NI", "PK", "PA", "PH", "SN", "SS", "TZ", "TT",
  "UG", "VU", "VN", "YE", "ZW",
]);

// ─── Risk Scoring ─────────────────────────────────────────────────────────────

function calculateRiskScore(input: FraudCheckInput, flags: string[]): number {
  let score = 0;
  if (input.amount > 5_000_000) score += 30;
  else if (input.amount > 1_000_000) score += 15;
  else if (input.amount > 500_000) score += 8;
  score += flags.length * 10;
  return Math.min(score, 100);
}

function getRiskLevel(score: number): FraudCheckResult["riskLevel"] {
  if (score >= 80) return "blocked";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

// ─── Sanctions Screening ──────────────────────────────────────────────────────

function screenSanctions(input: FraudCheckInput): { hit: boolean; reason?: string } {
  const nameToCheck = (input.beneficiaryName || "").toLowerCase();
  for (const keyword of SANCTIONED_KEYWORDS) {
    if (nameToCheck.includes(keyword)) {
      return { hit: true, reason: `Name matches sanctioned entity: ${keyword}` };
    }
  }
  return { hit: false };
}

// ─── AML Rules ────────────────────────────────────────────────────────────────

async function checkAMLRules(
  input: FraudCheckInput,
  flags: string[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  try {
    // Rule 1: Structuring detection (multiple transactions just below reporting threshold)
    const structuringRows = await db.select({
      cnt: sql<number>`COUNT(*)::int`,
      total: sql<number>`COALESCE(SUM(${transactions.fromAmount}::numeric), 0)`,
    }).from(transactions).where(and(
      eq(transactions.userId, input.userId),
      eq(transactions.status, "completed"),
      gte(transactions.createdAt, twentyFourHoursAgo),
      sql`${transactions.fromAmount}::numeric BETWEEN 4000000 AND 4999999`,
    ));
    if ((structuringRows[0]?.cnt ?? 0) >= 2) flags.push("STRUCTURING_DETECTED");

    // Rule 2: Rapid succession transfers
    const rapidRows = await db.select({ cnt: sql<number>`COUNT(*)::int` })
      .from(transactions).where(and(
        eq(transactions.userId, input.userId),
        eq(transactions.type, "send"),
        eq(transactions.status, "completed"),
        gte(transactions.createdAt, oneHourAgo),
      ));
    if ((rapidRows[0]?.cnt ?? 0) >= 5) flags.push("RAPID_SUCCESSION_TRANSFERS");

    // Rule 3: Large round-number transactions
    if (input.amount >= 1_000_000 && input.amount % 1_000_000 === 0) {
      flags.push("LARGE_ROUND_NUMBER");
    }

    // Rule 4: Daily limit check
    const dailyRows = await db.select({
      dailyTotal: sql<number>`COALESCE(SUM(${transactions.fromAmount}::numeric), 0)`,
    }).from(transactions).where(and(
      eq(transactions.userId, input.userId),
      eq(transactions.type, "send"),
      eq(transactions.status, "completed"),
      gte(transactions.createdAt, todayStart),
    ));
    const dailyTotal = Number(dailyRows[0]?.dailyTotal ?? 0);
    if (dailyTotal + input.amount > 5_000_000) flags.push("DAILY_LIMIT_EXCEEDED");
  } catch (e) {
    logger.error({ err: e }, '[Fraud] AML rules check failed:');
  }
}

// ─── Main Fraud Check ─────────────────────────────────────────────────────────
export async function checkFraud(input: FraudCheckInput): Promise<FraudCheckResult> {
  const flags: string[] = [];
  const sanctionsResult = screenSanctions(input);
  if (sanctionsResult.hit) flags.push("SANCTIONS_HIT");
  await checkAMLRules(input, flags);
  const riskScore = calculateRiskScore(input, flags);
  const riskLevel = getRiskLevel(riskScore);
  const result: FraudCheckResult = {
    approved: riskLevel !== "blocked",
    riskScore,
    riskLevel,
    flags,
    requiresReview: riskLevel === "high",
    requiresMFA: riskLevel === "medium" || riskLevel === "high",
    amlFlag: flags.some(f => ["STRUCTURING_DETECTED", "RAPID_SUCCESSION_TRANSFERS", "DAILY_LIMIT_EXCEEDED"].includes(f)),
    sanctionsHit: sanctionsResult.hit,
  };
  if (riskLevel === "high" || riskLevel === "blocked") {
    try {
      const db = await getDb();
      if (db) await db.insert(auditLogs).values({
        userId: input.userId,
        action: "FRAUD_FLAG",
        description: `Risk score: ${riskScore}, Level: ${riskLevel}, Flags: ${flags.join(", ")}, Amount: ${input.amount} ${input.currency}`,
        severity: riskLevel === "blocked" ? "critical" : "warning",
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log fraud flag:');
    }
  }
  return result;
}

// ─── Idempotency ──────────────────────────────────────────────────────────────
export async function checkIdempotency(
  userId: number,
  idempotencyKey: string
): Promise<{ isDuplicate: boolean; existingTxId?: number }> {
  if (!idempotencyKey) return { isDuplicate: false };
  const db = await getDb();
  if (!db) return { isDuplicate: false };
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const rows = await db.select({ id: transactions.id })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        gte(transactions.createdAt, twentyFourHoursAgo),
      ))
      .limit(1);
    const existing = rows[0];
    if (existing) return { isDuplicate: true, existingTxId: existing.id };
  } catch { /* non-blocking */ }
  return { isDuplicate: false };
}

// ─── Velocity Check ───────────────────────────────────────────────────────────
export async function checkVelocity(
  userId: number,
  windowHours: number = 1,
  maxAttempts: number = 10
): Promise<{ allowed: boolean; attemptsInWindow: number }> {
  const db = await getDb();
  if (!db) return { allowed: false, attemptsInWindow: maxAttempts };
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  try {
    const rows = await db.select({ cnt: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.type, "send"),
        gte(transactions.createdAt, windowStart),
      ));
    const attemptsInWindow = Number(rows[0]?.cnt ?? 0);
    return { allowed: attemptsInWindow < maxAttempts, attemptsInWindow };
  } catch {
    return { allowed: true, attemptsInWindow: 0 };
  }
}
