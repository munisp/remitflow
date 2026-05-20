/**
 * seed-remaining.mjs — Seeds all remaining empty tables in RemitFlow
 * Uses exact camelCase column names from the database schema
 */
import pkg from "pg";
const { Client } = pkg;

const DB_URL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow";
const client = new Client({ connectionString: DB_URL });
await client.connect();

async function run(label, sql, params = []) {
  try {
    const res = await client.query(sql, params);
    console.log(`  ✅ ${label}: ${res.rowCount ?? 0} rows`);
    return res;
  } catch (e) {
    console.error(`  ❌ ${label}: ${e.message}`);
  }
}

// Get reference data
const usersRes = await client.query("SELECT id FROM users ORDER BY id LIMIT 9");
const userIds = usersRes.rows.map(r => r.id);
const u = (i) => userIds[i % userIds.length];

const assetsRes = await client.query("SELECT id FROM investment_assets ORDER BY id LIMIT 10");
const assetIds = assetsRes.rows.map(r => r.id);

const casesRes = await client.query('SELECT id FROM "complianceCases" ORDER BY id LIMIT 3');
const caseIds = casesRes.rows.map(r => r.id);

const proposalsRes = await client.query("SELECT id FROM fund_proposals ORDER BY id LIMIT 3");
const proposalIds = proposalsRes.rows.map(r => r.id);

const oppRes = await client.query('SELECT id FROM "talentOpportunities" ORDER BY id LIMIT 5');
const oppIds = oppRes.rows.map(r => r.id);

const recurringRes = await client.query('SELECT id, "userId" FROM "recurringPayments" ORDER BY id LIMIT 5');
const recurring = recurringRes.rows;

console.log("\n📊 Seeding remaining empty tables...\n");

// ── Chat Sessions (camelCase columns) ─────────────────────────────────────────
await run("chatSessions", `
  INSERT INTO "chatSessions" ("userId", title, "createdAt", "updatedAt") VALUES
  ($1, 'How do I send money to Nigeria?', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
  ($2, 'FX rates for GBP to NGN', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
  ($3, 'KYC verification help', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'),
  ($4, 'Investment portfolio advice', NOW() - INTERVAL '1 day', NOW() - INTERVAL '12 hours'),
  ($5, 'Batch payment setup', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 hour')
  ON CONFLICT DO NOTHING
`, [u(0), u(1), u(2), u(3), u(4)]);

const sessionsRes = await client.query('SELECT id FROM "chatSessions" ORDER BY id LIMIT 5');
const sessionIds = sessionsRes.rows.map(r => r.id);
const s = (i) => sessionIds[i % Math.max(sessionIds.length, 1)];

// ── Chat Messages (camelCase columns) ─────────────────────────────────────────
if (sessionIds.length > 0) {
  await run("chatMessages", `
    INSERT INTO "chatMessages" ("sessionId", role, content, "createdAt") VALUES
    ($1, 'user', 'How do I send money to Nigeria?', NOW() - INTERVAL '5 days'),
    ($1, 'assistant', 'To send money to Nigeria, go to the Send Money page, select NGN as the destination currency, enter the recipient''s bank details, and confirm the transfer. We support all major Nigerian banks.', NOW() - INTERVAL '5 days' + INTERVAL '30 seconds'),
    ($2, 'user', 'What is the current GBP to NGN rate?', NOW() - INTERVAL '3 days'),
    ($2, 'assistant', 'The current GBP to NGN rate is approximately 1,940 NGN per GBP. This rate is updated every hour from live market data.', NOW() - INTERVAL '3 days' + INTERVAL '30 seconds'),
    ($3, 'user', 'My KYC is stuck at Tier 1, what do I do?', NOW() - INTERVAL '2 days'),
    ($3, 'assistant', 'To upgrade to Tier 2, please upload a government-issued ID (passport or national ID) and a proof of address document not older than 3 months. Our compliance team reviews submissions within 24-48 hours.', NOW() - INTERVAL '2 days' + INTERVAL '30 seconds'),
    ($4, 'user', 'What investment options do you recommend for a moderate risk profile?', NOW() - INTERVAL '1 day'),
    ($4, 'assistant', 'For a moderate risk profile, I recommend a diversified portfolio: 40% in stable assets (USDT, BTC), 30% in growth assets (ETH, SOL), and 30% in diaspora bonds. This balances stability with growth potential.', NOW() - INTERVAL '1 day' + INTERVAL '30 seconds'),
    ($5, 'user', 'How do I set up a batch payment for payroll?', NOW() - INTERVAL '6 hours'),
    ($5, 'assistant', 'To set up batch payroll: 1) Go to Batch Payments, 2) Click New Batch, 3) Upload a CSV with columns: name, account, amount, 4) Review and confirm. Payments are processed within 2 business hours.', NOW() - INTERVAL '6 hours' + INTERVAL '30 seconds')
    ON CONFLICT DO NOTHING
  `, [s(0), s(1), s(2), s(3), s(4)]);
}

// ── Case Comments (camelCase columns) ─────────────────────────────────────────
if (caseIds.length > 0) {
  await run("caseComments", `
    INSERT INTO "caseComments" ("caseId", "authorId", "authorName", content, "isInternal", "createdAt") VALUES
    ($1, $2, 'Compliance Officer', 'Case opened for review. Customer has been notified.', true, NOW() - INTERVAL '10 days'),
    ($1, $3, 'Amara Diallo', 'I have submitted the requested documentation. Please let me know if anything else is needed.', false, NOW() - INTERVAL '9 days'),
    ($1, $2, 'Compliance Officer', 'Documentation received and under review. ETA 48 hours.', false, NOW() - INTERVAL '8 days'),
    ($4, $2, 'Compliance Officer', 'Transaction pattern flagged by automated AML system. Manual review initiated.', true, NOW() - INTERVAL '7 days'),
    ($4, $5, 'Emeka Nwosu', 'These are legitimate business payments to my suppliers in Lagos. I can provide invoices.', false, NOW() - INTERVAL '6 days'),
    ($6, $2, 'Compliance Officer', 'Travel rule data incomplete for cross-border transfer above $1,000 threshold.', true, NOW() - INTERVAL '5 days')
    ON CONFLICT DO NOTHING
  `, [caseIds[0], u(0), u(1), caseIds[1] ?? caseIds[0], u(2), caseIds[2] ?? caseIds[0]]);
}

// ── Family Members (mixed case columns) ───────────────────────────────────────
await run("family_members", `
  INSERT INTO family_members (user_id, name, relationship, country, phone, email, bank_account, bank_name, currency, notes, "createdAt", "updatedAt") VALUES
  ($1, 'Ngozi Okonkwo', 'parent', 'NG', '+2348012345678', 'ngozi@email.com', '0123456789', 'First Bank Nigeria', 'NGN', 'Mother - monthly allowance', NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days'),
  ($1, 'Chidi Okonkwo', 'sibling', 'NG', '+2348098765432', 'chidi@email.com', '9876543210', 'GTBank', 'NGN', 'Brother - school fees', NOW() - INTERVAL '45 days', NOW() - INTERVAL '10 days'),
  ($2, 'Fatima Diallo', 'spouse', 'SN', '+221771234567', 'fatima@email.com', 'SN0012345678901234567890', 'Ecobank Senegal', 'XOF', 'Wife - living expenses', NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days'),
  ($3, 'Kwame Mensah', 'parent', 'GH', '+233244123456', 'kwame@email.com', '1234567890123', 'GCB Bank', 'GHS', 'Father - medical expenses', NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 day'),
  ($4, 'Aisha Musa', 'child', 'NG', '+2348055678901', 'aisha@email.com', '5678901234', 'Zenith Bank', 'NGN', 'Daughter - university fees', NOW() - INTERVAL '15 days', NOW()),
  ($5, 'Emmanuel Osei', 'sibling', 'GH', '+233244987654', 'emmanuel@email.com', '9012345678901', 'Stanbic Bank Ghana', 'GHS', 'Brother - business support', NOW() - INTERVAL '10 days', NOW())
  ON CONFLICT DO NOTHING
`, [u(0), u(1), u(2), u(3), u(4), u(5)]);

const familyRes = await client.query("SELECT id FROM family_members ORDER BY id LIMIT 6");
const familyIds = familyRes.rows.map(r => r.id);

// ── Family Budgets ────────────────────────────────────────────────────────────
if (familyIds.length >= 2) {
  await run("family_budgets", `
    INSERT INTO family_budgets (user_id, family_member_id, monthly_limit, currency, current_month_spent, alert_threshold, auto_renew, "createdAt", "updatedAt") VALUES
    ($1, $2, 50000, 'NGN', 32000, 80, true, NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days'),
    ($1, $3, 30000, 'NGN', 15000, 75, true, NOW() - INTERVAL '45 days', NOW() - INTERVAL '10 days'),
    ($4, $5, 200000, 'XOF', 85000, 90, false, NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days'),
    ($6, $7, 500, 'GHS', 320, 85, true, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 day')
    ON CONFLICT DO NOTHING
  `, [u(0), familyIds[0], familyIds[1], u(2), familyIds[2] ?? familyIds[0], u(3), familyIds[3] ?? familyIds[0]]);
}

// ── Market Listings (mixed case columns) ──────────────────────────────────────
await run("market_listings", `
  INSERT INTO market_listings (seller_id, title, description, category, price, currency, country, city, status, view_count, "createdAt", "updatedAt") VALUES
  ($1, 'Nigerian Ankara Fabric - Premium Quality', 'Beautiful hand-dyed Ankara fabric, 6 yards. Perfect for traditional attire. Ships worldwide.', 'goods', 45.00, 'USD', 'NG', 'Lagos', 'active', 127, NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days'),
  ($2, 'Freelance Web Development Services', 'Full-stack web development using React, Node.js, and PostgreSQL. 5+ years experience.', 'services', 75.00, 'USD', 'SN', 'Dakar', 'active', 89, NOW() - INTERVAL '25 days', NOW() - INTERVAL '1 day'),
  ($3, 'Ghanaian Kente Cloth - Handwoven', 'Authentic handwoven Kente cloth from Kumasi. 4 yards, royal blue and gold pattern.', 'goods', 120.00, 'USD', 'GH', 'Accra', 'active', 203, NOW() - INTERVAL '20 days', NOW() - INTERVAL '3 days'),
  ($4, 'Accounting & Tax Services - Nigeria', 'Professional accounting, bookkeeping, and tax filing services for Nigerian businesses. ICAN certified.', 'services', 200.00, 'USD', 'NG', 'Abuja', 'active', 56, NOW() - INTERVAL '15 days', NOW() - INTERVAL '1 day'),
  ($5, 'Shea Butter - Organic, Unrefined (5kg)', 'Pure organic unrefined shea butter from Burkina Faso. Excellent for cosmetics and cooking.', 'goods', 35.00, 'USD', 'SN', 'Dakar', 'active', 312, NOW() - INTERVAL '10 days', NOW()),
  ($6, 'Translation Services - French/English/Yoruba', 'Professional translation and interpretation services. Legal, medical, and business documents.', 'services', 50.00, 'USD', 'NG', 'Lagos', 'active', 44, NOW() - INTERVAL '8 days', NOW() - INTERVAL '12 hours'),
  ($7, 'Kenyan Coffee Beans - Single Origin (1kg)', 'Premium AA grade Kenyan coffee beans from Nyeri region. Rich, full-bodied flavor.', 'goods', 28.00, 'USD', 'KE', 'Nairobi', 'active', 178, NOW() - INTERVAL '5 days', NOW() - INTERVAL '6 hours'),
  ($8, 'Digital Marketing Consulting', 'Social media strategy, content creation, and paid advertising for African diaspora businesses.', 'services', 150.00, 'USD', 'GH', 'Accra', 'active', 67, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 hours')
  ON CONFLICT DO NOTHING
`, [u(0), u(1), u(2), u(3), u(4), u(5), u(6), u(7)]);

const listingsRes = await client.query("SELECT id, seller_id FROM market_listings ORDER BY id LIMIT 8");
const listings = listingsRes.rows;

// ── Market Orders ─────────────────────────────────────────────────────────────
if (listings.length >= 3) {
  await run("market_orders", `
    INSERT INTO market_orders (listing_id, buyer_id, seller_id, amount, currency, status, escrow_held, buyer_note, "createdAt", "updatedAt") VALUES
    ($1, $2, $3, 45.00, 'USD', 'completed', false, 'Please ship to UK address', NOW() - INTERVAL '25 days', NOW() - INTERVAL '20 days'),
    ($4, $5, $6, 75.00, 'USD', 'in_progress', true, 'Need e-commerce website with payment integration', NOW() - INTERVAL '15 days', NOW() - INTERVAL '10 days'),
    ($7, $8, $9, 120.00, 'USD', 'completed', false, 'Gift for my mother', NOW() - INTERVAL '18 days', NOW() - INTERVAL '12 days'),
    ($10, $11, $12, 200.00, 'USD', 'pending', true, 'Annual tax filing for my Lagos business', NOW() - INTERVAL '5 days', NOW() - INTERVAL '2 days'),
    ($13, $14, $15, 35.00, 'USD', 'completed', false, 'Bulk order for cosmetics business', NOW() - INTERVAL '8 days', NOW() - INTERVAL '3 days')
    ON CONFLICT DO NOTHING
  `, [
    listings[0].id, u(1), listings[0].seller_id,
    listings[1].id, u(2), listings[1].seller_id,
    listings[2].id, u(3), listings[2].seller_id,
    listings[3]?.id ?? listings[0].id, u(4), listings[3]?.seller_id ?? listings[0].seller_id,
    listings[4]?.id ?? listings[0].id, u(5), listings[4]?.seller_id ?? listings[0].seller_id,
  ]);
}

// ── Talent Profiles (camelCase columns) ───────────────────────────────────────
await run("talentProfiles", `
  INSERT INTO "talentProfiles" ("userId", bio, expertise, countries, availability, "hourlyRate", currency, verified, "linkedinUrl", "createdAt", "updatedAt") VALUES
  ($1, 'Fintech consultant with 10+ years experience in African payment systems, mobile money, and cross-border remittances. Former CBN consultant.', ARRAY['fintech','payments','regulatory','mobile money'], ARRAY['NG','GH','KE'], 'available', 150.00, 'USD', true, 'https://linkedin.com/in/amara-diallo', NOW() - INTERVAL '90 days', NOW() - INTERVAL '10 days'),
  ($2, 'Investment advisor specializing in diaspora investment vehicles, African bonds, and emerging market equities. CFA charterholder.', ARRAY['investment','bonds','equities','diaspora finance'], ARRAY['SN','CI','ML'], 'available', 200.00, 'USD', true, 'https://linkedin.com/in/emeka-nwosu', NOW() - INTERVAL '75 days', NOW() - INTERVAL '5 days'),
  ($3, 'Legal expert in cross-border transactions, AML/KYC compliance, and fintech regulation across West Africa. Called to the bar in 3 jurisdictions.', ARRAY['legal','compliance','AML','KYC','regulation'], ARRAY['GH','NG','SL'], 'limited', 175.00, 'USD', true, 'https://linkedin.com/in/zainab-musa', NOW() - INTERVAL '60 days', NOW() - INTERVAL '15 days'),
  ($4, 'Real estate investment consultant for diaspora buyers. Specializes in Lagos, Accra, and Nairobi property markets. 200+ successful transactions.', ARRAY['real estate','property','investment','diaspora'], ARRAY['NG','GH','KE'], 'available', 120.00, 'USD', false, 'https://linkedin.com/in/kwame-mensah', NOW() - INTERVAL '45 days', NOW() - INTERVAL '7 days'),
  ($5, 'Business development consultant helping diaspora entrepreneurs establish and grow businesses in their home countries. MBA from LSE.', ARRAY['business development','entrepreneurship','market entry','SME'], ARRAY['NG','GH','SN','KE'], 'available', 100.00, 'USD', true, 'https://linkedin.com/in/fatima-osei', NOW() - INTERVAL '30 days', NOW() - INTERVAL '3 days')
  ON CONFLICT DO NOTHING
`, [u(0), u(1), u(2), u(3), u(4)]);

// ── Talent Bookings (camelCase columns) ───────────────────────────────────────
if (oppIds.length > 0) {
  await run("talentBookings", `
    INSERT INTO "talentBookings" ("opportunityId", "expertUserId", status, message, "createdAt") VALUES
    ($1, $2, 'confirmed', 'Looking forward to discussing your fintech compliance needs. I have reviewed your business profile.', NOW() - INTERVAL '20 days'),
    ($3, $4, 'pending', 'I can help you structure your diaspora bond portfolio. Available for a call this week.', NOW() - INTERVAL '10 days'),
    ($5, $6, 'completed', 'Excellent session on Nigerian property investment. Highly recommended consultant.', NOW() - INTERVAL '30 days'),
    ($7, $8, 'confirmed', 'Ready to assist with your AML compliance framework. Will send a detailed proposal.', NOW() - INTERVAL '5 days')
    ON CONFLICT DO NOTHING
  `, [
    oppIds[0], u(1),
    oppIds[1] ?? oppIds[0], u(2),
    oppIds[2] ?? oppIds[0], u(3),
    oppIds[3] ?? oppIds[0], u(4),
  ]);
}

// ── Investment Watchlist ──────────────────────────────────────────────────────
if (assetIds.length > 0) {
  const rows = [];
  const params = [];
  let p = 1;
  const data = [
    [u(0), assetIds[0], 65000], [u(0), assetIds[1], 3500],
    [u(1), assetIds[0], 70000], [u(1), assetIds[3 % assetIds.length], 150],
    [u(2), assetIds[1], 4000], [u(2), assetIds[4 % assetIds.length], null],
    [u(3), assetIds[2 % assetIds.length], 400], [u(3), assetIds[5 % assetIds.length], null],
    [u(4), assetIds[0], 60000], [u(4), assetIds[1], 3000],
  ];
  for (const [uid, aid, price] of data) {
    rows.push(`($${p++}, $${p++}, $${p++}, NOW() - INTERVAL '${Math.floor(Math.random() * 30) + 1} days')`);
    params.push(uid, aid, price);
  }
  await run("investment_watchlist", `
    INSERT INTO investment_watchlist (user_id, asset_id, alert_price, "createdAt") VALUES ${rows.join(',')}
    ON CONFLICT DO NOTHING
  `, params);
}

// ── Fund Votes (camelCase columns) ────────────────────────────────────────────
if (proposalIds.length > 0) {
  await run("fundVotes", `
    INSERT INTO "fundVotes" ("proposalId", "userId", vote, "createdAt") VALUES
    ($1, $2, 'yes', NOW() - INTERVAL '15 days'),
    ($1, $3, 'yes', NOW() - INTERVAL '14 days'),
    ($1, $4, 'no', NOW() - INTERVAL '13 days'),
    ($5, $6, 'yes', NOW() - INTERVAL '10 days'),
    ($5, $7, 'yes', NOW() - INTERVAL '9 days'),
    ($5, $8, 'abstain', NOW() - INTERVAL '8 days'),
    ($9, $10, 'yes', NOW() - INTERVAL '5 days'),
    ($9, $11, 'yes', NOW() - INTERVAL '4 days')
    ON CONFLICT DO NOTHING
  `, [proposalIds[0], u(0), u(1), u(2), proposalIds[1] ?? proposalIds[0], u(3), u(4), u(5), proposalIds[2] ?? proposalIds[0], u(6), u(7)]);
}

// ── Diaspora Collectives (camelCase columns) ──────────────────────────────────
await run("diasporaCollectives", `
  INSERT INTO "diasporaCollectives" (name, description, "createdByUserId", status, currency, "totalContributed", "memberCount", "nextVote", "createdAt") VALUES
  ('Lagos Professionals UK', 'Investment collective for Nigerian professionals in the UK. Focus on Lagos real estate and SME funding.', $1, 'active', 'GBP', 125000, 23, NOW() + INTERVAL '15 days', NOW() - INTERVAL '180 days'),
  ('Ghanaian Diaspora Fund USA', 'Collective supporting Ghanaian entrepreneurs and infrastructure projects from the US diaspora.', $2, 'active', 'USD', 87500, 18, NOW() + INTERVAL '30 days', NOW() - INTERVAL '120 days'),
  ('Senegal Tech Investors', 'Tech-focused investment group for Senegalese diaspora in France and Belgium.', $3, 'active', 'EUR', 42000, 11, NOW() + INTERVAL '45 days', NOW() - INTERVAL '90 days')
  ON CONFLICT DO NOTHING
`, [u(0), u(1), u(2)]);

const dCollRes = await client.query('SELECT id FROM "diasporaCollectives" ORDER BY id LIMIT 3');
const dCollIds = dCollRes.rows.map(r => r.id);

// ── Diaspora Collective Members (camelCase columns) ───────────────────────────
if (dCollIds.length > 0) {
  await run("diasporaCollectiveMembers", `
    INSERT INTO "diasporaCollectiveMembers" ("collectiveId", "userId", "myContribution", role, "joinedAt") VALUES
    ($1, $2, 5000, 'admin', NOW() - INTERVAL '180 days'),
    ($1, $3, 3500, 'member', NOW() - INTERVAL '150 days'),
    ($1, $4, 7500, 'member', NOW() - INTERVAL '120 days'),
    ($5, $6, 4000, 'admin', NOW() - INTERVAL '120 days'),
    ($5, $7, 2500, 'member', NOW() - INTERVAL '90 days'),
    ($8, $9, 3000, 'admin', NOW() - INTERVAL '90 days'),
    ($8, $10, 1500, 'member', NOW() - INTERVAL '60 days')
    ON CONFLICT DO NOTHING
  `, [dCollIds[0], u(0), u(1), u(2), dCollIds[1] ?? dCollIds[0], u(3), u(4), dCollIds[2] ?? dCollIds[0], u(5), u(6)]);
}

// ── Scheduled Transfer Runs (camelCase columns) ───────────────────────────────
if (recurring.length > 0) {
  const runRows = recurring.slice(0, 5).map((r, i) =>
    `(${r.id}, ${r.userId}, 'completed', 50000, 'NGN', 'NGN', 1.0, NULL, NULL, NOW() - INTERVAL '${(i + 1) * 7} days')`
  ).join(',\n    ');
  await run("scheduledTransferRuns", `
    INSERT INTO "scheduledTransferRuns" ("scheduleId", "userId", status, amount, currency, "targetCurrency", "fxRate", "transactionId", "errorMessage", "executedAt") VALUES
    ${runRows}
    ON CONFLICT DO NOTHING
  `);
}

await client.end();

// Final count
const client2 = new Client({ connectionString: DB_URL });
await client2.connect();
const countRes = await client2.query(`
  SELECT relname as table, n_live_tup as rows 
  FROM pg_stat_user_tables 
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
`);
console.log("\n📊 Final table counts (all seeded tables):");
let total = 0;
for (const row of countRes.rows) {
  console.log(`  ${row.table}: ${row.rows}`);
  total += parseInt(row.rows);
}
console.log(`\n  TOTAL ROWS: ${total}`);
await client2.end();
console.log("\n✅ All remaining tables seeded successfully!");
