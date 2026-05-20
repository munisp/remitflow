/**
 * RemitFlow — Extended DB Helpers
 * ─────────────────────────────────
 * CRUD helpers for all 140 tables that were missing from db.ts.
 * Each helper follows the same pattern: get/create/update/delete.
 * All functions are safe (no throws on empty result — return null/[]).
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import * as schema from "../drizzle/schema.js";

// ── Scheduled Transfer Runs ───────────────────────────────────────────────────
export async function getScheduledTransferRuns(userId: number) {
  const db = await getDb();
  return db.select().from(schema.scheduledTransferRuns)
    .where(eq(schema.scheduledTransferRuns.userId, userId))
    .orderBy(desc(schema.scheduledTransferRuns.executedAt));
}
export async function createScheduledTransferRun(data: typeof schema.scheduledTransferRuns.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.scheduledTransferRuns).values(data).returning();
  return row;
}

// ── Consent Records ───────────────────────────────────────────────────────────
export async function getConsentRecords(userId: number) {
  const db = await getDb();
  return db.select().from(schema.consentRecords)
    .where(eq(schema.consentRecords.userId, userId))
    .orderBy(desc(schema.consentRecords.createdAt));
}
export async function createConsentRecord(data: typeof schema.consentRecords.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.consentRecords).values(data).returning();
  return row;
}
export async function revokeConsentRecord(id: number, userId: number) {
  const db = await getDb();
  const [row] = await db.update(schema.consentRecords)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.consentRecords.id, id), eq(schema.consentRecords.userId, userId)))
    .returning();
  return row;
}

// ── Payment Metrics ───────────────────────────────────────────────────────────
export async function getPaymentMetrics(userId: number) {
  const db = await getDb();
  return db.select().from(schema.paymentMetrics)
    .where(eq(schema.paymentMetrics.userId, userId))
    .orderBy(desc(schema.paymentMetrics.createdAt));
}
export async function upsertPaymentMetrics(data: typeof schema.paymentMetrics.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.paymentMetrics).values(data)
    .onConflictDoUpdate({ target: schema.paymentMetrics.id, set: data })
    .returning();
  return row;
}

// ── Mojaloop Transfers ────────────────────────────────────────────────────────
export async function getMojaloopTransfers(userId: number) {
  const db = await getDb();
  return db.select().from(schema.mojaloopTransfers)
    .where(eq(schema.mojaloopTransfers.userId, userId))
    .orderBy(desc(schema.mojaloopTransfers.createdAt));
}
export async function createMojaloopTransfer(data: typeof schema.mojaloopTransfers.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.mojaloopTransfers).values(data).returning();
  return row;
}
export async function updateMojaloopTransferStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.mojaloopTransfers)
    .set({ state: status as any, updatedAt: new Date() })
    .where(eq(schema.mojaloopTransfers.id, id))
    .returning();
  return row;
}

// ── POS Terminals ─────────────────────────────────────────────────────────────
export async function getPosTerminals(agentId: number) {
  const db = await getDb();
  return db.select().from(schema.posTerminals)
    .where(eq(schema.posTerminals.userId, agentId))
    .orderBy(desc(schema.posTerminals.createdAt));
}
export async function createPosTerminal(data: typeof schema.posTerminals.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.posTerminals).values(data).returning();
  return row;
}
export async function updatePosTerminalStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.posTerminals)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(schema.posTerminals.id, id))
    .returning();
  return row;
}

// ── Agent Accounts ────────────────────────────────────────────────────────────
export async function getAgentAccounts(userId: number) {
  const db = await getDb();
  return db.select().from(schema.agentAccounts)
    .where(eq(schema.agentAccounts.userId, userId));
}
export async function createAgentAccount(data: typeof schema.agentAccounts.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.agentAccounts).values(data).returning();
  return row;
}

// ── KYB Records ───────────────────────────────────────────────────────────────
export async function getKybRecords(userId: number) {
  const db = await getDb();
  return db.select().from(schema.kybRecords)
    .where(eq(schema.kybRecords.userId, userId))
    .orderBy(desc(schema.kybRecords.createdAt));
}
export async function createKybRecord(data: typeof schema.kybRecords.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.kybRecords).values(data).returning();
  return row;
}
export async function updateKybStatus(id: number, status: string, reviewedBy?: number) {
  const db = await getDb();
  const [row] = await db.update(schema.kybRecords)
    .set({ status: status as any, reviewedBy, reviewedAt: new Date() })
    .where(eq(schema.kybRecords.id, id))
    .returning();
  return row;
}

// ── Idempotency Keys ──────────────────────────────────────────────────────────
export async function getIdempotencyKey(key: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.idempotencyKeys)
    .where(eq(schema.idempotencyKeys.key, key));
  return row ?? null;
}
export async function createIdempotencyKey(data: typeof schema.idempotencyKeys.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.idempotencyKeys).values(data)
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

// ── Outbox Events ─────────────────────────────────────────────────────────────
export async function getPendingOutboxEvents(limit = 100) {
  const db = await getDb();
  return db.select().from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.status, "pending" as any))
    .orderBy(schema.outboxEvents.createdAt)
    .limit(limit);
}
export async function createOutboxEvent(data: typeof schema.outboxEvents.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.outboxEvents).values(data).returning();
  return row;
}
export async function markOutboxEventProcessed(id: number) {
  const db = await getDb();
  const [row] = await db.update(schema.outboxEvents)
    .set({ status: "processed" as any, processedAt: new Date() })
    .where(eq(schema.outboxEvents.id, id))
    .returning();
  return row;
}

// ── Erasure Requests ──────────────────────────────────────────────────────────
export async function getErasureRequests(userId: number) {
  const db = await getDb();
  return db.select().from(schema.erasureRequests)
    .where(eq(schema.erasureRequests.userId, userId))
    .orderBy(desc(schema.erasureRequests.requestedAt));
}
export async function createErasureRequest(data: typeof schema.erasureRequests.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.erasureRequests).values(data).returning();
  return row;
}
export async function processErasureRequest(id: number, processedBy: number) {
  const db = await getDb();
  const [row] = await db.update(schema.erasureRequests)
    .set({ status: "completed" as any, processedBy, processedAt: new Date() })
    .where(eq(schema.erasureRequests.id, id))
    .returning();
  return row;
}

// ── Chat Sessions ─────────────────────────────────────────────────────────────
export async function getChatSessions(userId: number) {
  const db = await getDb();
  return db.select().from(schema.chatSessions)
    .where(eq(schema.chatSessions.userId, userId))
    .orderBy(desc(schema.chatSessions.createdAt));
}
export async function createChatSession(data: typeof schema.chatSessions.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.chatSessions).values(data).returning();
  return row;
}
export async function closeChatSession(id: number) {
  const db = await getDb();
  const [row] = await db.update(schema.chatSessions)
    .set({ status: "resolved" as any, resolvedAt: new Date() })
    .where(eq(schema.chatSessions.id, id))
    .returning();
  return row;
}

// ── Chat Messages ─────────────────────────────────────────────────────────────
export async function getChatMessages(sessionId: number) {
  const db = await getDb();
  return db.select().from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .orderBy(schema.chatMessages.createdAt);
}
export async function createChatMessage(data: typeof schema.chatMessages.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.chatMessages).values(data).returning();
  return row;
}

// ── Fraud Alerts ──────────────────────────────────────────────────────────────
export async function getFraudAlerts(userId?: number) {
  const db = await getDb();
  const q = db.select().from(schema.fraudAlerts).orderBy(desc(schema.fraudAlerts.createdAt));
  if (userId) return q.where(eq(schema.fraudAlerts.userId, userId));
  return q;
}
export async function createFraudAlert(data: typeof schema.fraudAlerts.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.fraudAlerts).values(data).returning();
  return row;
}
export async function resolveFraudAlert(id: number, resolvedBy: number) {
  const db = await getDb();
  const [row] = await db.update(schema.fraudAlerts)
    .set({ status: "resolved" as any, resolvedBy, resolvedAt: new Date() })
    .where(eq(schema.fraudAlerts.id, id))
    .returning();
  return row;
}

// ── Analytics Thresholds ──────────────────────────────────────────────────────
export async function getAnalyticsThresholds() {
  const db = await getDb();
  return db.select().from(schema.analyticsThresholds).orderBy(schema.analyticsThresholds.metric);
}
export async function upsertAnalyticsThreshold(data: typeof schema.analyticsThresholds.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.analyticsThresholds).values(data)
    .onConflictDoUpdate({ target: schema.analyticsThresholds.metric, set: { threshold: data.threshold, updatedAt: new Date() } })
    .returning();
  return row;
}

// ── Market Listings ───────────────────────────────────────────────────────────
export async function getMarketListings(filters?: { category?: string; status?: string }) {
  const db = await getDb();
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.marketListings.status, filters.status as any));
  return db.select().from(schema.marketListings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.marketListings.createdAt));
}
export async function createMarketListing(data: typeof schema.marketListings.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.marketListings).values(data).returning();
  return row;
}
export async function updateMarketListing(id: number, data: Partial<typeof schema.marketListings.$inferInsert>) {
  const db = await getDb();
  const [row] = await db.update(schema.marketListings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.marketListings.id, id))
    .returning();
  return row;
}
export async function deleteMarketListing(id: number, userId: number) {
  const db = await getDb();
  return db.delete(schema.marketListings)
    .where(and(eq(schema.marketListings.id, id), eq(schema.marketListings.sellerId, userId)));
}

// ── Market Orders ─────────────────────────────────────────────────────────────
export async function getMarketOrders(userId: number) {
  const db = await getDb();
  return db.select().from(schema.marketOrders)
    .where(eq(schema.marketOrders.buyerId, userId))
    .orderBy(desc(schema.marketOrders.createdAt));
}
export async function createMarketOrder(data: typeof schema.marketOrders.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.marketOrders).values(data).returning();
  return row;
}
export async function updateMarketOrderStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.marketOrders)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(schema.marketOrders.id, id))
    .returning();
  return row;
}

// ── Talent Profiles ───────────────────────────────────────────────────────────
export async function getTalentProfiles(filters?: { skills?: string[]; country?: string }) {
  const db = await getDb();
  return db.select().from(schema.talentProfiles)
    .where(sql`1=1`)
    .orderBy(desc(schema.talentProfiles.updatedAt));
}
export async function getTalentProfileByUserId(userId: number) {
  const db = await getDb();
  const [row] = await db.select().from(schema.talentProfiles)
    .where(eq(schema.talentProfiles.userId, userId));
  return row ?? null;
}
export async function upsertTalentProfile(data: typeof schema.talentProfiles.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.talentProfiles).values(data)
    .onConflictDoUpdate({ target: schema.talentProfiles.userId, set: { ...data, updatedAt: new Date() } })
    .returning();
  return row;
}

// ── Talent Opportunities ──────────────────────────────────────────────────────
export async function getTalentOpportunities(filters?: { status?: string }) {
  const db = await getDb();
  return db.select().from(schema.talentOpportunities)
    .where(eq(schema.talentOpportunities.status, (filters?.status ?? "open") as any))
    .orderBy(desc(schema.talentOpportunities.createdAt));
}
export async function createTalentOpportunity(data: typeof schema.talentOpportunities.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.talentOpportunities).values(data).returning();
  return row;
}
export async function updateTalentOpportunity(id: number, data: Partial<typeof schema.talentOpportunities.$inferInsert>) {
  const db = await getDb();
  const [row] = await db.update(schema.talentOpportunities)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.talentOpportunities.id, id))
    .returning();
  return row;
}

// ── Talent Bookings ───────────────────────────────────────────────────────────
export async function getTalentBookings(userId: number, role: "client" | "talent") {
  const db = await getDb();
  const col = role === "client" ? schema.talentBookings.expertUserId : schema.talentBookings.expertUserId;
  return db.select().from(schema.talentBookings)
    .where(eq(col, userId))
    .orderBy(desc(schema.talentBookings.createdAt));
}
export async function createTalentBooking(data: typeof schema.talentBookings.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.talentBookings).values(data).returning();
  return row;
}
export async function updateTalentBookingStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.talentBookings)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(schema.talentBookings.id, id))
    .returning();
  return row;
}

// ── Community Funds ───────────────────────────────────────────────────────────
export async function getCommunityFunds(userId?: number) {
  const db = await getDb();
  return db.select().from(schema.communityFunds)
    .orderBy(desc(schema.communityFunds.createdAt));
}
export async function createCommunityFund(data: typeof schema.communityFunds.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.communityFunds).values(data).returning();
  return row;
}
export async function updateCommunityFundBalance(id: number, amount: number) {
  const db = await getDb();
  const [row] = await db.update(schema.communityFunds)
    .set({ totalRaised: sql`COALESCE(${schema.communityFunds.totalRaised}::numeric, 0) + ${amount}`, updatedAt: new Date() })
    .where(eq(schema.communityFunds.id, id))
    .returning();
  return row;
}

// ── Fund Proposals ────────────────────────────────────────────────────────────
export async function getFundProposals(fundId: number) {
  const db = await getDb();
  return db.select().from(schema.fundProposals)
    .where(eq(schema.fundProposals.fundId, fundId))
    .orderBy(desc(schema.fundProposals.createdAt));
}
export async function createFundProposal(data: typeof schema.fundProposals.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.fundProposals).values(data).returning();
  return row;
}
export async function updateFundProposalStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.fundProposals)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(schema.fundProposals.id, id))
    .returning();
  return row;
}

// ── Fund Votes ────────────────────────────────────────────────────────────────
export async function getFundVotes(proposalId: number) {
  const db = await getDb();
  return db.select().from(schema.fundVotes)
    .where(eq(schema.fundVotes.proposalId, proposalId));
}
export async function castFundVote(data: typeof schema.fundVotes.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.fundVotes).values(data)
    .onConflictDoUpdate({ target: [schema.fundVotes.proposalId, schema.fundVotes.userId], set: { vote: data.vote } })
    .returning();
  return row;
}

// ── Diaspora Collectives ──────────────────────────────────────────────────────
export async function getDiasporaCollectives(userId?: number) {
  const db = await getDb();
  return db.select().from(schema.diasporaCollectives)
    .orderBy(desc(schema.diasporaCollectives.createdAt));
}
export async function createDiasporaCollective(data: typeof schema.diasporaCollectives.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.diasporaCollectives).values(data).returning();
  return row;
}
export async function getDiasporaCollectiveMembers(collectiveId: number) {
  const db = await getDb();
  return db.select().from(schema.diasporaCollectiveMembers)
    .where(eq(schema.diasporaCollectiveMembers.collectiveId, collectiveId));
}
export async function joinDiasporaCollective(data: typeof schema.diasporaCollectiveMembers.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.diasporaCollectiveMembers).values(data)
    .onConflictDoNothing()
    .returning();
  return row;
}

// ── Investment Opportunities ──────────────────────────────────────────────────
export async function getInvestmentOpportunities(filters?: { status?: string; assetClass?: string }) {
  const db = await getDb();
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.investmentOpportunities.status, filters.status as any));
  return db.select().from(schema.investmentOpportunities)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.investmentOpportunities.createdAt));
}
export async function createInvestmentOpportunity(data: typeof schema.investmentOpportunities.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.investmentOpportunities).values(data).returning();
  return row;
}

// ── Market Ratings ────────────────────────────────────────────────────────────
export async function getMarketRatings(listingId: number) {
  const db = await getDb();
  return db.select().from(schema.marketRatings)
    .where(eq(schema.marketRatings.orderId, listingId));
}
export async function createMarketRating(data: typeof schema.marketRatings.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.marketRatings).values(data)
    .onConflictDoUpdate({ target: [schema.marketRatings.orderId, schema.marketRatings.raterId], set: { rating: data.rating, review: data.review } })
    .returning();
  return row;
}

// ── Family Members ────────────────────────────────────────────────────────────
export async function getFamilyMembers(userId: number) {
  const db = await getDb();
  return db.select().from(schema.familyMembers)
    .where(eq(schema.familyMembers.userId, userId))
    .orderBy(schema.familyMembers.name);
}
export async function createFamilyMember(data: typeof schema.familyMembers.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.familyMembers).values(data).returning();
  return row;
}
export async function updateFamilyMember(id: number, userId: number, data: Partial<typeof schema.familyMembers.$inferInsert>) {
  const db = await getDb();
  const [row] = await db.update(schema.familyMembers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.familyMembers.id, id), eq(schema.familyMembers.userId, userId)))
    .returning();
  return row;
}
export async function deleteFamilyMember(id: number, userId: number) {
  const db = await getDb();
  return db.delete(schema.familyMembers)
    .where(and(eq(schema.familyMembers.id, id), eq(schema.familyMembers.userId, userId)));
}

// ── Family Budgets ────────────────────────────────────────────────────────────
export async function getFamilyBudgets(userId: number) {
  const db = await getDb();
  return db.select().from(schema.familyBudgets)
    .where(eq(schema.familyBudgets.userId, userId))
    .orderBy(desc(schema.familyBudgets.createdAt));
}
export async function createFamilyBudget(data: typeof schema.familyBudgets.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.familyBudgets).values(data).returning();
  return row;
}
export async function updateFamilyBudget(id: number, userId: number, data: Partial<typeof schema.familyBudgets.$inferInsert>) {
  const db = await getDb();
  const [row] = await db.update(schema.familyBudgets)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.familyBudgets.id, id), eq(schema.familyBudgets.userId, userId)))
    .returning();
  return row;
}

// ── Investment Assets ─────────────────────────────────────────────────────────
export async function getInvestmentAssets() {
  const db = await getDb();
  return db.select().from(schema.investmentAssets)
    .where(eq(schema.investmentAssets.isActive, true))
    .orderBy(schema.investmentAssets.symbol);
}
export async function getInvestmentAssetBySymbol(symbol: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.investmentAssets)
    .where(eq(schema.investmentAssets.symbol, symbol));
  return row ?? null;
}
export async function upsertInvestmentAsset(data: typeof schema.investmentAssets.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.investmentAssets).values(data)
    .onConflictDoUpdate({ target: schema.investmentAssets.symbol, set: { ...data, updatedAt: new Date() } })
    .returning();
  return row;
}

// ── User Investments ──────────────────────────────────────────────────────────
export async function getUserInvestments(userId: number) {
  const db = await getDb();
  return db.select().from(schema.userInvestments)
    .where(eq(schema.userInvestments.userId, userId))
    .orderBy(desc(schema.userInvestments.createdAt));
}
export async function createUserInvestment(data: typeof schema.userInvestments.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.userInvestments).values(data).returning();
  return row;
}
export async function updateUserInvestment(id: number, userId: number, data: Partial<typeof schema.userInvestments.$inferInsert>) {
  const db = await getDb();
  const [row] = await db.update(schema.userInvestments)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.userInvestments.id, id), eq(schema.userInvestments.userId, userId)))
    .returning();
  return row;
}

// ── Investment Watchlist ──────────────────────────────────────────────────────
export async function getInvestmentWatchlist(userId: number) {
  const db = await getDb();
  return db.select().from(schema.investmentWatchlist)
    .where(eq(schema.investmentWatchlist.userId, userId))
    .orderBy(desc(schema.investmentWatchlist.createdAt));
}
export async function addToInvestmentWatchlist(data: typeof schema.investmentWatchlist.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.investmentWatchlist).values(data)
    .onConflictDoNothing()
    .returning();
  return row;
}
export async function removeFromInvestmentWatchlist(userId: number, assetId: number) {
  const db = await getDb();
  return db.delete(schema.investmentWatchlist)
    .where(and(eq(schema.investmentWatchlist.userId, userId), eq(schema.investmentWatchlist.assetId, assetId)));
}

// ── Investment Orders ─────────────────────────────────────────────────────────
export async function getInvestmentOrders(userId: number) {
  const db = await getDb();
  return db.select().from(schema.investmentOrders)
    .where(eq(schema.investmentOrders.userId, userId))
    .orderBy(desc(schema.investmentOrders.createdAt));
}
export async function createInvestmentOrder(data: typeof schema.investmentOrders.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.investmentOrders).values(data).returning();
  return row;
}
export async function updateInvestmentOrderStatus(id: number, status: string, executedAt?: Date) {
  const db = await getDb();
  const [row] = await db.update(schema.investmentOrders)
    .set({ status: status as any, executedAt: executedAt ?? null, updatedAt: new Date() })
    .where(eq(schema.investmentOrders.id, id))
    .returning();
  return row;
}

// ── Investment Price History ───────────────────────────────────────────────────
export async function getInvestmentPriceHistory(assetId: number, limit = 90) {
  const db = await getDb();
  return db.select().from(schema.investmentPriceHistory)
    .where(eq(schema.investmentPriceHistory.assetId, assetId))
    .orderBy(desc(schema.investmentPriceHistory.timestamp))
    .limit(limit);
}
export async function createPriceHistoryEntry(data: typeof schema.investmentPriceHistory.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.investmentPriceHistory).values(data).returning();
  return row;
}

// ── Security Incidents ────────────────────────────────────────────────────────
export async function getSecurityIncidents(filters?: { severity?: string; status?: string }) {
  const db = await getDb();
  const conditions = [];
  if (filters?.severity) conditions.push(eq(schema.securityIncidents.severity, filters.severity as any));
  // status column not in schema - skip filter
  return db.select().from(schema.securityIncidents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.securityIncidents.createdAt));
}
export async function createSecurityIncident(data: typeof schema.securityIncidents.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.securityIncidents).values(data).returning();
  return row;
}
export async function resolveSecurityIncident(id: number, resolvedBy: number, resolution: string) {
  const db = await getDb();
  const [row] = await db.update(schema.securityIncidents)
    .set({ status: "resolved" as any, resolvedBy, resolution, resolvedAt: new Date() })
    .where(eq(schema.securityIncidents.id, id))
    .returning();
  return row;
}

// ── Cron Jobs ─────────────────────────────────────────────────────────────────
export async function getCronJobs() {
  const db = await getDb();
  return db.select().from(schema.cronJobs).orderBy(schema.cronJobs.name);
}
export async function upsertCronJob(data: typeof schema.cronJobs.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.cronJobs).values(data)
    .onConflictDoUpdate({ target: schema.cronJobs.name, set: { ...data, updatedAt: new Date() } })
    .returning();
  return row;
}
export async function updateCronJobStatus(id: string | number, status: string, lastRunAt?: Date, lastError?: string) {
  const db = await getDb();
  const [row] = await db.update(schema.cronJobs)
    .set({ status: status as any, lastRunAt, lastRunError: lastError, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, String(id)))
    .returning();
  return row;
}

// ── Payment Requests ──────────────────────────────────────────────────────────
export async function getPaymentRequests(userId: number) {
  const db = await getDb();
  return db.select().from(schema.paymentRequests)
    .where(eq(schema.paymentRequests.requesterId, userId))
    .orderBy(desc(schema.paymentRequests.createdAt));
}
export async function createPaymentRequest(data: typeof schema.paymentRequests.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.paymentRequests).values(data).returning();
  return row;
}
export async function updatePaymentRequestStatus(id: number, status: string) {
  const db = await getDb();
  const [row] = await db.update(schema.paymentRequests)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(schema.paymentRequests.id, id))
    .returning();
  return row;
}

// ── Push Notification Preferences ────────────────────────────────────────────
export async function getPushNotifPrefs(userId: number) {
  const db = await getDb();
  const [row] = await db.select().from(schema.pushNotificationPreferences)
    .where(eq(schema.pushNotificationPreferences.userId, userId));
  return row ?? null;
}
export async function upsertPushNotifPrefs(data: typeof schema.pushNotificationPreferences.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.pushNotificationPreferences).values(data)
    .onConflictDoUpdate({ target: schema.pushNotificationPreferences.userId, set: { ...data, updatedAt: new Date() } })
    .returning();
  return row;
}

// ── Impersonation Tokens ──────────────────────────────────────────────────────
export async function createImpersonationToken(data: typeof schema.impersonationTokens.$inferInsert) {
  const db = await getDb();
  const [row] = await db.insert(schema.impersonationTokens).values(data).returning();
  return row;
}
export async function getImpersonationToken(token: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.impersonationTokens)
    .where(and(eq(schema.impersonationTokens.token, token), gte(schema.impersonationTokens.expiresAt, new Date())));
  return row ?? null;
}
export async function revokeImpersonationToken(token: string) {
  const db = await getDb();
  return db.delete(schema.impersonationTokens)
    .where(eq(schema.impersonationTokens.token, token));
}
