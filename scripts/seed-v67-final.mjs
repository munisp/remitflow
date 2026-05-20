/**
 * RemitFlow v67 Final Seed Script
 * Seeds: agent accounts, referrals, additional production data
 * Uses PostgreSQL (LOCAL_DATABASE_URL)
 */
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // Get first user
    const { rows: users } = await client.query("SELECT id FROM users LIMIT 5");
    if (!users.length) { console.log("No users found"); return; }
    const userId = users[0].id;
    console.log(`Seeding for userId=${userId}`);

    // ─── Agent Accounts ────────────────────────────────────────────────────────
    // agent_accounts: id, user_id, agent_code, business_name, location, phone, status, tier, commission_rate, daily_limit, total_transactions, total_volume, rating
    const { rows: existingAgents } = await client.query("SELECT id FROM agent_accounts WHERE user_id = $1", [userId]);
    if (existingAgents.length === 0) {
      const agentData = [
        { code: "AGT-NG-001", name: "Lagos Central Remittance Hub", location: "Lagos, Nigeria", phone: "+2348012345678", status: "active", tier: "gold", rate: "1.50", limit: "5000000" },
        { code: "AGT-KE-001", name: "Nairobi CBD Money Transfer", location: "Nairobi, Kenya", phone: "+254712345678", status: "active", tier: "silver", rate: "1.75", limit: "500000" },
        { code: "AGT-GH-001", name: "Accra Ring Road Agent", location: "Accra, Ghana", phone: "+233201234567", status: "active", tier: "bronze", rate: "1.60", limit: "50000" },
      ];
      for (const a of agentData) {
        await client.query(
          `INSERT INTO agent_accounts (user_id, agent_code, business_name, location, phone, status, tier, commission_rate, daily_limit, total_transactions, total_volume, rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT DO NOTHING`,
          [userId, a.code, a.name, a.location, a.phone, a.status, a.tier, a.rate, a.limit, Math.floor(Math.random() * 1000), Math.floor(Math.random() * 100000), (4 + Math.random()).toFixed(1)]
        );
      }
      console.log("✓ Agent accounts seeded");
    } else {
      console.log(`✓ Agent accounts already exist (${existingAgents.length} records)`);
    }

    // ─── Referrals ─────────────────────────────────────────────────────────────
    // referrals: id, referrerId, referredId, status, rewardAmount, rewardCurrency, createdAt
    const { rows: existingReferrals } = await client.query('SELECT id FROM referrals WHERE "referrerId" = $1', [userId]);
    if (existingReferrals.length === 0) {
      // Get some other user IDs to use as referred users
      const { rows: otherUsers } = await client.query("SELECT id FROM users WHERE id != $1 LIMIT 4", [userId]);
      if (otherUsers.length > 0) {
        for (let i = 0; i < Math.min(otherUsers.length, 4); i++) {
          const statuses = ["completed", "completed", "pending", "pending"];
          await client.query(
            `INSERT INTO referrals ("referrerId", "referredId", status, "rewardAmount", "rewardCurrency")
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [userId, otherUsers[i].id, statuses[i], "5.00", "USD"]
          );
        }
        console.log(`✓ ${Math.min(otherUsers.length, 4)} referral records seeded`);
      } else {
        console.log("⚠ No other users to create referrals with");
      }
    } else {
      console.log(`✓ Referrals already exist (${existingReferrals.length} records)`);
    }

    // ─── Additional wallet data for CBDC/stablecoin ───────────────────────────
    const { rows: wallets } = await client.query('SELECT currency FROM wallets WHERE "userId" = $1', [userId]);
    const existingCurrencies = wallets.map(w => w.currency);
    const cbdcCurrencies = ["eNGN", "eKES", "eGHS", "NGNT", "USDT", "USDC"];
    let added = 0;
    for (const currency of cbdcCurrencies) {
      if (!existingCurrencies.includes(currency)) {
        try {
          await client.query(
            `INSERT INTO wallets ("userId", currency, balance, "lockedBalance", "isDefault", status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, currency, (Math.random() * 1000).toFixed(2), "0.00", false, "active"]
          );
          added++;
        } catch (e) {
          // ignore duplicate
        }
      }
    }
    if (added > 0) console.log(`✓ ${added} CBDC/stablecoin wallets added`);
    else console.log("✓ CBDC/stablecoin wallets already exist");

    console.log("✅ v67 seed data complete");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("Seed error:", e.message); process.exit(1); });
