helpers = """

// ─── v199: Outbound Annual Usage helpers ─────────────────────────────────────
export async function getAnnualUsage(userId: number, purposeCode: string, year: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(outboundAnnualUsage)
    .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.purposeCode, purposeCode.toUpperCase()), eq(outboundAnnualUsage.calendarYear, year)))
    .limit(1);
  return rows[0] ?? null;
}

export async function incrementAnnualUsage(userId: number, purposeCode: string, amountUsd: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const year = new Date().getFullYear();
  const code = purposeCode.toUpperCase();
  const existing = await getAnnualUsage(userId, code, year);
  if (existing) {
    const newUsed = (parseFloat(existing.usedUsd as string) + amountUsd).toFixed(2);
    await db.update(outboundAnnualUsage)
      .set({ usedUsd: newUsed, lastTransactionAt: new Date(), updatedAt: new Date() })
      .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.purposeCode, code), eq(outboundAnnualUsage.calendarYear, year)));
  } else {
    await db.insert(outboundAnnualUsage).values({ userId, purposeCode: code, calendarYear: year, usedUsd: amountUsd.toFixed(2), lastTransactionAt: new Date() });
  }
}

export async function getAllAnnualUsageForUser(userId: number, year: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(outboundAnnualUsage)
    .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.calendarYear, year)));
}

// ─── v199: Cross-Sell Offer helpers ──────────────────────────────────────────
export async function getActiveCrossSellOffer(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const rows = await db.select().from(crossSellOffers)
    .where(and(eq(crossSellOffers.userId, userId), eq(crossSellOffers.status, "pending")))
    .orderBy(desc(crossSellOffers.createdAt))
    .limit(1);
  const offer = rows[0];
  if (!offer) return null;
  // Check expiry
  if (offer.expiresAt && new Date(offer.expiresAt) < now) {
    await db.update(crossSellOffers).set({ status: "expired" }).where(eq(crossSellOffers.id, offer.id));
    return null;
  }
  return offer;
}

export async function createCrossSellOffer(data: {
  userId: number;
  offerType: "savings_account" | "diaspora_bond" | "insurance" | "investment_fund" | "credit_card";
  score: number;
  segment?: string;
  headline?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const rows = await db.insert(crossSellOffers).values({
    userId: data.userId,
    offerType: data.offerType,
    score: data.score.toFixed(4),
    segment: data.segment,
    headline: data.headline,
    body: data.body,
    ctaLabel: data.ctaLabel,
    ctaUrl: data.ctaUrl,
    status: "pending",
    expiresAt,
  }).returning();
  return rows[0];
}

export async function respondToCrossSellOffer(offerId: number, response: "accepted" | "dismissed") {
  const db = await getDb();
  if (!db) return;
  await db.update(crossSellOffers)
    .set({ status: response, respondedAt: new Date() })
    .where(eq(crossSellOffers.id, offerId));
}

export async function markCrossSellOfferShown(offerId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(crossSellOffers)
    .set({ status: "shown", shownAt: new Date() })
    .where(and(eq(crossSellOffers.id, offerId), eq(crossSellOffers.status, "pending")));
}
"""

# Read current db.ts and check if helpers already appended
with open('/home/ubuntu/remitflow/server/db.ts', 'r') as f:
    content = f.read()

if 'getAnnualUsage' not in content:
    with open('/home/ubuntu/remitflow/server/db.ts', 'a') as f:
        f.write(helpers)
    print('Helpers appended')
else:
    print('Helpers already present')
