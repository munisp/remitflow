/**
 * RemitFlow — Drizzle ORM Repository Pattern
 * ────────────────────────────────────────────
 * Type-safe repository classes for the most critical tables.
 * Each repository encapsulates all queries for a domain entity,
 * providing a clean abstraction over raw Drizzle queries.
 *
 * Repositories:
 *   - UserRepository
 *   - WalletRepository
 *   - TransactionRepository
 *   - KycRepository
 *   - ComplianceRepository
 *   - TigerBeetleRepository
 *   - TemporalRepository
 */
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { buildPaginationOffset, newestFirst, type PaginatedResult } from "./helpers";

type DB = PostgresJsDatabase<typeof schema>;

// ─── User Repository ──────────────────────────────────────────────────────────
export class UserRepository {
  constructor(private db: DB) {}

  async findById(id: number) {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return user ?? null;
  }

  async findByEmail(email: string) {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return user ?? null;
  }

  async findByOpenId(openId: string) {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.openId, openId)).limit(1);
    return user ?? null;
  }

  async updateKycTier(userId: number, tier: "tier0" | "tier1" | "tier2" | "tier3") {
    const [updated] = await this.db
      .update(schema.users)
      .set({ kycTier: tier, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated ?? null;
  }

  async updateLastSignedIn(userId: number) {
    await this.db
      .update(schema.users)
      .set({ lastSignedIn: new Date() })
      .where(eq(schema.users.id, userId));
  }
}

// ─── Wallet Repository ────────────────────────────────────────────────────────
export class WalletRepository {
  constructor(private db: DB) {}

  async findByUserId(userId: number) {
    return this.db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId));
  }

  async findByCurrency(userId: number, currency: string) {
    const [wallet] = await this.db
      .select()
      .from(schema.wallets)
      .where(and(eq(schema.wallets.userId, userId), eq(schema.wallets.currency, currency)))
      .limit(1);
    return wallet ?? null;
  }

  async updateBalance(walletId: number, newBalance: string, expectedVersion: number) {
    const [updated] = await this.db
      .update(schema.wallets)
      .set({ balance: newBalance, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.wallets.id, walletId), eq(schema.wallets.version, expectedVersion)))
      .returning();
    if (!updated) throw new Error(`Wallet ${walletId} optimistic lock conflict (expected version ${expectedVersion})`);
    return updated;
  }

  async lockBalance(walletId: number, amount: string) {
    await this.db.execute(sql`
      UPDATE wallets
      SET locked_balance = locked_balance + ${amount}::numeric,
          balance = balance - ${amount}::numeric,
          updated_at = NOW()
      WHERE id = ${walletId}
        AND balance >= ${amount}::numeric
    `);
  }

  async unlockBalance(walletId: number, amount: string) {
    await this.db.execute(sql`
      UPDATE wallets
      SET locked_balance = locked_balance - ${amount}::numeric,
          balance = balance + ${amount}::numeric,
          updated_at = NOW()
      WHERE id = ${walletId}
    `);
  }
}

// ─── Transaction Repository ───────────────────────────────────────────────────
export class TransactionRepository {
  constructor(private db: DB) {}

  async findById(id: number) {
    const [tx] = await this.db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).limit(1);
    return tx ?? null;
  }

  async findByIdempotencyKey(key: string) {
    const [tx] = await this.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.idempotencyKey, key))
      .limit(1);
    return tx ?? null;
  }

  async findByUserId(userId: number, params: { page?: number; limit?: number } = {}) {
    const { offset, limit } = buildPaginationOffset(params);
    const data = await this.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, userId))
      .orderBy(newestFirst(schema.transactions.createdAt))
      .limit(limit)
      .offset(offset);
    return data;
  }

  async updateStatus(txId: number, status: "completed" | "failed" | "cancelled" | "reversed") {
    const [updated] = await this.db
      .update(schema.transactions)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId))
      .returning();
    return updated ?? null;
  }

  async create(data: schema.InsertTransaction) {
    const [tx] = await this.db.insert(schema.transactions).values(data).returning();
    return tx;
  }
}

// ─── KYC Repository ───────────────────────────────────────────────────────────
export class KycRepository {
  constructor(private db: DB) {}

  async findByUserId(userId: number) {
    return this.db
      .select()
      .from(schema.kycDocuments)
      .where(eq(schema.kycDocuments.userId, userId))
      .orderBy(newestFirst(schema.kycDocuments.createdAt));
  }

  async findPendingReview() {
    return this.db
      .select()
      .from(schema.kycDocuments)
      .where(eq(schema.kycDocuments.status, "under_review"))
      .orderBy(newestFirst(schema.kycDocuments.createdAt))
      .limit(50);
  }

  async approve(docId: number) {
    const [updated] = await this.db
      .update(schema.kycDocuments)
      .set({ status: "approved", reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.kycDocuments.id, docId))
      .returning();
    return updated ?? null;
  }

  async reject(docId: number, reason: string) {
    const [updated] = await this.db
      .update(schema.kycDocuments)
      .set({ status: "rejected", rejectionReason: reason, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.kycDocuments.id, docId))
      .returning();
    return updated ?? null;
  }
}

// ─── Compliance Repository ────────────────────────────────────────────────────
export class ComplianceRepository {
  constructor(private db: DB) {}

  async findOpenCases(limit = 50) {
    return this.db
      .select()
      .from(schema.complianceCases)
      .where(inArray(schema.complianceCases.status, ["open", "under_review"]))
      .orderBy(desc(schema.complianceCases.createdAt))
      .limit(limit);
  }

  async createCase(data: schema.InsertComplianceCase) {
    const [c] = await this.db.insert(schema.complianceCases).values(data).returning();
    return c;
  }

  async resolveCase(caseId: number, resolution: string) {
    const [updated] = await this.db
      .update(schema.complianceCases)
      .set({ status: "resolved", resolution, resolvedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(schema.complianceCases.id, caseId))
      .returning();
    return updated ?? null;
  }
}

// ─── TigerBeetle Account Repository ──────────────────────────────────────────
export class TigerBeetleRepository {
  constructor(private db: DB) {}

  async findByUserId(userId: number) {
    return this.db
      .select()
      .from(schema.tigerbeetleAccounts)
      .where(eq(schema.tigerbeetleAccounts.userId, userId));
  }

  async findByTbAccountId(tbAccountId: bigint) {
    const [account] = await this.db
      .select()
      .from(schema.tigerbeetleAccounts)
      .where(eq(schema.tigerbeetleAccounts.tbAccountId, tbAccountId))
      .limit(1);
    return account ?? null;
  }

  async create(data: typeof schema.tigerbeetleAccounts.$inferInsert) {
    const [account] = await this.db.insert(schema.tigerbeetleAccounts).values(data).returning();
    return account;
  }

  async recordTransfer(data: typeof schema.tigerbeetleTransfers.$inferInsert) {
    const [transfer] = await this.db.insert(schema.tigerbeetleTransfers).values(data).returning();
    return transfer;
  }
}

// ─── Temporal Execution Repository ───────────────────────────────────────────
export class TemporalRepository {
  constructor(private db: DB) {}

  async findByWorkflowId(workflowId: string) {
    const [exec] = await this.db
      .select()
      .from(schema.temporalExecutions)
      .where(eq(schema.temporalExecutions.workflowId, workflowId))
      .limit(1);
    return exec ?? null;
  }

  async upsertExecution(data: typeof schema.temporalExecutions.$inferInsert) {
    const [exec] = await this.db
      .insert(schema.temporalExecutions)
      .values(data)
      .onConflictDoUpdate({
        target: schema.temporalExecutions.workflowId,
        set: { status: data.status, updatedAt: new Date() },
      })
      .returning();
    return exec;
  }

  async findRunningWorkflows() {
    return this.db
      .select()
      .from(schema.temporalExecutions)
      .where(eq(schema.temporalExecutions.status, "RUNNING"))
      .orderBy(newestFirst(schema.temporalExecutions.createdAt))
      .limit(100);
  }
}

// ─── Repository Factory ───────────────────────────────────────────────────────
export function createRepositories(db: DB) {
  return {
    users: new UserRepository(db),
    wallets: new WalletRepository(db),
    transactions: new TransactionRepository(db),
    kyc: new KycRepository(db),
    compliance: new ComplianceRepository(db),
    tigerBeetle: new TigerBeetleRepository(db),
    temporal: new TemporalRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
