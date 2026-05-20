/**
 * Seed script: disputes, direct-debit mandates, CBDC wallets
 * Usage: node scripts/seed-disputes-dd-cbdc.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // Get all user IDs
    const { rows: users } = await client.query("SELECT id FROM users LIMIT 10");
    if (users.length === 0) { console.log("No users found — run seed-all.mjs first"); return; }

    const userId = users[0].id;
    console.log(`Seeding for userId=${userId}`);

    // ── Disputes ──────────────────────────────────────────────────────────────
    const disputeTypes = ["unauthorized","wrong_amount","duplicate","not_received","other","other"];
    const disputeStatuses = ["open", "under_review", "resolved", "closed"];
    for (let i = 0; i < 6; i++) {
      await client.query(`
        INSERT INTO disputes ("userId", type, description, status, "createdAt")
        VALUES ($1, $2, $3, $4, NOW() - INTERVAL '${i * 3} days')
        ON CONFLICT DO NOTHING
      `, [
        userId,
        disputeTypes[i],
        `Demo dispute #${i + 1}: ${disputeTypes[i].replace(/_/g, " ")} — amount ₦${(i + 1) * 5000}`,
        disputeStatuses[i % 4],
      ]);
    }
    console.log("✓ Disputes seeded");

    // ── Direct Debit Mandates ─────────────────────────────────────────────────
    const mandates = [
      { creditor: "Netflix Nigeria", creditorAccount: "NG33ZENITH0001234567890", amount: 4500, currency: "NGN", frequency: "monthly" },
      { creditor: "DSTV Subscription", creditorAccount: "NG33GTBANK0009876543210", amount: 8500, currency: "NGN", frequency: "monthly" },
      { creditor: "Electricity Board EKEDC", creditorAccount: "NG33UBA0001122334455", amount: 15000, currency: "NGN", frequency: "monthly" },
      { creditor: "Spotify Premium", creditorAccount: "NG33ACCESS0005544332211", amount: 2900, currency: "NGN", frequency: "monthly" },
    ];
    for (const m of mandates) {
      const nextDebit = new Date(Date.now() + 86400000 * 30);
      const mandateRef = `DDM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(`
        INSERT INTO direct_debit_mandates (user_id, creditor, creditor_account, amount, currency, frequency, status, next_debit_date, mandate_ref, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, NOW())
        ON CONFLICT DO NOTHING
      `, [userId, m.creditor, m.creditorAccount, m.amount, m.currency, m.frequency, nextDebit, mandateRef]);
    }
    console.log("✓ Direct debit mandates seeded");

    // ── CBDC Wallets ──────────────────────────────────────────────────────────
    const cbdcCurrencies = [
      { currency: "eNGN", balance: "50000.00", description: "Digital Naira (eNaira) — Central Bank of Nigeria" },
      { currency: "eGHS", balance: "2500.00", description: "Digital Cedi — Bank of Ghana" },
      { currency: "eKES", balance: "15000.00", description: "Digital Shilling — Central Bank of Kenya" },
    ];
    for (const c of cbdcCurrencies) {
      await client.query(`
        INSERT INTO wallets ("userId", currency, balance, "isDefault", status, "createdAt")
        VALUES ($1, $2, $3, false, 'active', NOW())
        ON CONFLICT DO NOTHING
      `, [userId, c.currency, c.balance]);
    }
    console.log("✓ CBDC wallets seeded");

    // ── Stablecoin Wallets ────────────────────────────────────────────────────
    const stablecoins = [
      { currency: "USDT", balance: "1250.50" },
      { currency: "USDC", balance: "800.00" },
      { currency: "NGNT", balance: "500000.00" },
    ];
    for (const s of stablecoins) {
      await client.query(`
        INSERT INTO wallets ("userId", currency, balance, "isDefault", status, "createdAt")
        VALUES ($1, $2, $3, false, 'active', NOW())
        ON CONFLICT DO NOTHING
      `, [userId, s.currency, s.balance]);
    }
    console.log("✓ Stablecoin wallets seeded");

    console.log("\n✅ All seed data inserted successfully");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
