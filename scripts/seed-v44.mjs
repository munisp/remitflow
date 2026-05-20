#!/usr/bin/env node
/**
 * RemitFlow v44 — Comprehensive Seed Script
 * Seeds: marketplace listings, orders, ratings, talent profiles, bookings,
 *        community funds, proposals, votes, diaspora collectives, family members,
 *        investment opportunities, fraud alerts, recurring payments, FX alerts
 */
import "dotenv/config";
import postgres from 'postgres';
import { randomBytes } from "crypto";

const DB_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };
console.log("✅ Connected to database");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function q(sql, params = []) {
  try {
    const [rows] = await exec(sql, params);
    return rows;
  } catch (e) {
    console.warn(`  ⚠ Query failed: ${e.message.slice(0, 80)}`);
    return [];
  }
}

async function getUsers() {
  return q("SELECT id, name, email FROM users LIMIT 10");
}

// ── 1. Marketplace Listings ───────────────────────────────────────────────────
async function seedMarketplace(users) {
  console.log("\n📦 Seeding marketplace listings...");
  const listings = [
    { title: "Samsung Galaxy A54 — Excellent Condition", desc: "6 months old, no scratches, full accessories included.", price: 85000, currency: "NGN", category: "electronics", location: "Lagos, Nigeria", images: JSON.stringify(["https://placehold.co/400x300?text=Galaxy+A54"]) },
    { title: "Handwoven Kente Cloth — Ghana", desc: "Authentic Kente from Kumasi artisans. 6 yards, vibrant colours.", price: 120, currency: "USD", category: "fashion", location: "Accra, Ghana", images: JSON.stringify(["https://placehold.co/400x300?text=Kente"]) },
    { title: "Organic Shea Butter — 1kg", desc: "Unrefined, cold-pressed shea butter from northern Ghana.", price: 35, currency: "USD", category: "health", location: "Tamale, Ghana", images: JSON.stringify(["https://placehold.co/400x300?text=Shea+Butter"]) },
    { title: "Jollof Rice Catering — Events", desc: "Professional catering for 50–500 guests. Nigerian & Ghanaian cuisines.", price: 5000, currency: "NGN", category: "food", location: "Abuja, Nigeria", images: JSON.stringify(["https://placehold.co/400x300?text=Jollof"]) },
    { title: "Laptop — Dell XPS 15 (2023)", desc: "i7, 16GB RAM, 512GB SSD. Minor wear on keyboard.", price: 950, currency: "USD", category: "electronics", location: "Nairobi, Kenya", images: JSON.stringify(["https://placehold.co/400x300?text=Dell+XPS"]) },
    { title: "Ankara Fabric — 6 Yards", desc: "Premium Dutch wax print. Multiple patterns available.", price: 45, currency: "USD", category: "fashion", location: "Lagos, Nigeria", images: JSON.stringify(["https://placehold.co/400x300?text=Ankara"]) },
    { title: "Web Development Services", desc: "Full-stack React/Node.js development. 5 years experience.", price: 2500, currency: "USD", category: "services", location: "Remote", images: JSON.stringify(["https://placehold.co/400x300?text=Web+Dev"]) },
    { title: "Fresh Plantain — 10kg Bunch", desc: "Farm-fresh plantain from Ogun State. Delivery within Lagos.", price: 3500, currency: "NGN", category: "food", location: "Lagos, Nigeria", images: JSON.stringify(["https://placehold.co/400x300?text=Plantain"]) },
    { title: "Maasai Beaded Jewellery Set", desc: "Handcrafted by Maasai women. Necklace + earrings + bracelet.", price: 75, currency: "USD", category: "crafts", location: "Nairobi, Kenya", images: JSON.stringify(["https://placehold.co/400x300?text=Maasai"]) },
    { title: "2-Bedroom Apartment — Short Let", desc: "Fully furnished, 3 months minimum. Lekki Phase 1.", price: 350000, currency: "NGN", category: "real_estate", location: "Lagos, Nigeria", images: JSON.stringify(["https://placehold.co/400x300?text=Apartment"]) },
  ];

  const listingIds = [];
  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const seller = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO market_listings (seller_id, title, description, price, currency, category, location, images, status, views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW())`,
        [seller.id, l.title, l.desc, l.price, l.currency, l.category, l.location, l.images, Math.floor(Math.random() * 200) + 10]
      );
      const [row] = await q("SELECT id FROM market_listings WHERE title = ? LIMIT 1", [l.title]);
      if (row) listingIds.push(row.id);
    } catch (e) { console.warn(`  ⚠ Listing ${l.title}: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${listingIds.length} listings created`);

  // ── Market Orders ──────────────────────────────────────────────────────────
  console.log("  📋 Seeding market orders...");
  const orderStatuses = ["paid", "shipped", "delivered", "delivered", "delivered"];
  let orderCount = 0;
  for (let i = 0; i < Math.min(5, listingIds.length); i++) {
    const buyer = users[(i + 2) % users.length];
    const listing = await q("SELECT * FROM market_listings WHERE id = ? LIMIT 1", [listingIds[i]]);
    if (!listing[0]) continue;
    const l = listing[0];
    try {
      await q(
        `INSERT IGNORE INTO market_orders (listing_id, buyer_id, seller_id, amount, currency, status, payment_reference, shipping_address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY)`,
        [l.id, buyer.id, l.seller_id, l.price, l.currency, orderStatuses[i], `PAY-${randomBytes(6).toString("hex").toUpperCase()}`, "123 Main St, Lagos", "Please pack carefully", i * 5 + 1]
      );
      orderCount++;
    } catch (e) { console.warn(`  ⚠ Order: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${orderCount} orders created`);

  // ── Market Ratings ─────────────────────────────────────────────────────────
  console.log("  ⭐ Seeding seller ratings...");
  let ratingCount = 0;
  const orders = await q("SELECT mo.*, ml.seller_id FROM market_orders mo JOIN market_listings ml ON mo.listing_id = ml.id WHERE mo.status = 'delivered' LIMIT 5");
  for (const order of orders) {
    try {
      await q(
        `INSERT IGNORE INTO market_ratings (order_id, buyer_id, seller_id, rating, review, created_at) VALUES (?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY)`,
        [order.id, order.buyer_id, order.seller_id, Math.floor(Math.random() * 2) + 4, "Great seller, fast delivery and item as described!", Math.floor(Math.random() * 10) + 1]
      );
      ratingCount++;
    } catch (e) { console.warn(`  ⚠ Rating: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${ratingCount} ratings created`);
}

// ── 2. Talent Profiles & Bookings ─────────────────────────────────────────────
async function seedTalent(users) {
  console.log("\n🎓 Seeding talent profiles...");
  const profiles = [
    { name: "Dr. Amara Okafor", title: "FinTech Strategy Advisor", bio: "15 years in African financial services. Ex-CBN, ex-Flutterwave.", skills: JSON.stringify(["FinTech Strategy", "Regulatory Compliance", "Product Management", "Fundraising"]), rate: 500, currency: "USD", availability: "advisory", expertise: "Finance", country: "Nigeria", linkedin: "https://linkedin.com/in/amara-okafor" },
    { name: "Kwame Asante", title: "Blockchain & DeFi Engineer", bio: "Built DeFi protocols with $50M+ TVL. Solidity, Rust, Go.", skills: JSON.stringify(["Solidity", "Rust", "DeFi", "Smart Contracts", "Web3"]), rate: 350, currency: "USD", availability: "project_based", expertise: "Engineering", country: "Ghana", linkedin: "https://linkedin.com/in/kwame-asante" },
    { name: "Fatima Al-Rashid", title: "Cross-Border Payments Expert", bio: "Designed payment corridors for 12 African countries at Wise.", skills: JSON.stringify(["Payment Systems", "FX Risk", "Compliance", "API Design"]), rate: 400, currency: "USD", availability: "part_time", expertise: "Payments", country: "Kenya", linkedin: "https://linkedin.com/in/fatima-alrashid" },
    { name: "Chidi Nwosu", title: "ML/AI for Financial Crime", bio: "Built fraud detection models processing 10M+ transactions/day.", skills: JSON.stringify(["Machine Learning", "Python", "Fraud Detection", "AML", "Data Science"]), rate: 300, currency: "USD", availability: "advisory", expertise: "Data Science", country: "Nigeria", linkedin: "https://linkedin.com/in/chidi-nwosu" },
    { name: "Naledi Dlamini", title: "Diaspora Investment Specialist", bio: "Structured $200M+ in diaspora bond issuances across Africa.", skills: JSON.stringify(["Investment Banking", "Diaspora Finance", "Capital Markets", "Due Diligence"]), rate: 600, currency: "USD", availability: "advisory", expertise: "Investment", country: "South Africa", linkedin: "https://linkedin.com/in/naledi-dlamini" },
  ];

  const profileIds = [];
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const user = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO talent_profiles (user_id, display_name, title, bio, skills, hourly_rate, currency, availability, expertise_area, country, linkedin_url, is_verified, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW())`,
        [user.id, p.name, p.title, p.bio, p.skills, p.rate, p.currency, p.availability, p.expertise, p.country, p.linkedin]
      );
      const [row] = await q("SELECT id FROM talent_profiles WHERE display_name = ? LIMIT 1", [p.name]);
      if (row) profileIds.push(row.id);
    } catch (e) { console.warn(`  ⚠ Talent ${p.name}: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${profileIds.length} talent profiles created`);

  // ── Talent Opportunities ───────────────────────────────────────────────────
  console.log("  💼 Seeding talent opportunities...");
  const opps = [
    { title: "FinTech Advisory Board Member", desc: "Seeking experienced FinTech advisor for Series A startup.", budget: 2000, type: "advisory", duration: "6 months" },
    { title: "Blockchain Smart Contract Audit", desc: "Audit of 3 Solidity contracts for DeFi lending protocol.", budget: 5000, type: "consulting", duration: "2 weeks" },
    { title: "AML Compliance Review", desc: "Review and update AML policies for UK-regulated entity.", budget: 3500, type: "consulting", duration: "1 month" },
    { title: "Diaspora Bond Structuring", desc: "Structure a $10M diaspora bond for infrastructure project.", budget: 15000, type: "advisory", duration: "3 months" },
    { title: "Fraud Model Training", desc: "Train and deploy ML fraud detection model on transaction data.", budget: 8000, type: "consulting", duration: "6 weeks" },
    { title: "Payment Corridor Analysis", desc: "Analyse USD/NGN, USD/KES, USD/GHS corridors for new entrant.", budget: 4000, type: "consulting", duration: "3 weeks" },
    { title: "Keynote Speaker — AfriFinTech Summit", desc: "Keynote on the future of cross-border payments in Africa.", budget: 1500, type: "speaking", duration: "1 day" },
    { title: "Mentorship Programme Lead", desc: "Lead 12-week mentorship programme for 20 FinTech founders.", budget: 6000, type: "mentorship", duration: "3 months" },
  ];

  for (let i = 0; i < opps.length; i++) {
    const o = opps[i];
    const poster = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO talent_opportunities (posted_by, title, description, budget, currency, engagement_type, duration, skills_required, status, created_at) VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, 'open', NOW())`,
        [poster.id, o.title, o.desc, o.budget, o.type, o.duration, JSON.stringify([])]
      );
    } catch (e) { console.warn(`  ⚠ Opportunity: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${opps.length} opportunities created`);

  // ── Talent Bookings ────────────────────────────────────────────────────────
  console.log("  📅 Seeding talent bookings...");
  let bookingCount = 0;
  for (let i = 0; i < Math.min(8, profileIds.length * 2); i++) {
    const profileId = profileIds[i % profileIds.length];
    const client = users[(i + 3) % users.length];
    const statuses = ["completed", "completed", "accepted", "pending", "completed", "accepted", "completed", "declined"];
    try {
      await q(
        `INSERT IGNORE INTO talent_bookings (profile_id, client_id, engagement_type, description, budget, currency, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, 'USD', ?, NOW() - INTERVAL ? DAY, NOW() + INTERVAL ? DAY, NOW() - INTERVAL ? DAY)`,
        [profileId, client.id, "consulting", "Strategic advisory session on payment infrastructure", 1500, statuses[i % statuses.length], i * 7 + 1, 30, i * 7 + 2]
      );
      bookingCount++;
    } catch (e) { console.warn(`  ⚠ Booking: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${bookingCount} bookings created`);
}

// ── 3. Community Funds, Proposals, Votes ─────────────────────────────────────
async function seedCommunity(users) {
  console.log("\n🏘️ Seeding community funds...");
  const funds = [
    { name: "Lagos Tech Hub Fund", desc: "Funding tech infrastructure and startup support in Lagos.", goal: 50000, raised: 32500, currency: "USD", category: "technology", status: "active" },
    { name: "Nairobi Women Entrepreneurs", desc: "Supporting women-led businesses in Nairobi with micro-grants.", goal: 25000, raised: 18750, currency: "USD", category: "entrepreneurship", status: "active" },
    { name: "Accra Education Initiative", desc: "Scholarships for STEM students in Greater Accra Region.", goal: 100000, raised: 67200, currency: "USD", category: "education", status: "active" },
  ];

  const fundIds = [];
  for (let i = 0; i < funds.length; i++) {
    const f = funds[i];
    const creator = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO community_funds (creator_id, name, description, goal_amount, raised_amount, currency, category, status, member_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [creator.id, f.name, f.desc, f.goal, f.raised, f.currency, f.category, f.status, Math.floor(Math.random() * 50) + 10]
      );
      const [row] = await q("SELECT id FROM community_funds WHERE name = ? LIMIT 1", [f.name]);
      if (row) fundIds.push(row.id);
    } catch (e) { console.warn(`  ⚠ Fund ${f.name}: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${fundIds.length} community funds created`);

  // ── Fund Proposals ─────────────────────────────────────────────────────────
  console.log("  📝 Seeding fund proposals...");
  const proposals = [
    { title: "Purchase 10 Laptops for Coding Bootcamp", desc: "Equip 10 students with laptops for a 3-month coding bootcamp.", amount: 8500, votes_for: 34, votes_against: 5, status: "approved" },
    { title: "Sponsor AfriTech Conference 2026", desc: "Sponsor 5 startup pitches at the annual AfriTech conference.", amount: 5000, votes_for: 28, votes_against: 8, status: "voting" },
    { title: "Build Community Co-working Space", desc: "Rent and fit out a 500sqm co-working space for 6 months.", amount: 15000, votes_for: 45, votes_against: 12, status: "approved" },
    { title: "Micro-grant: 20 Women Entrepreneurs", desc: "Provide $500 micro-grants to 20 women-led businesses.", amount: 10000, votes_for: 52, votes_against: 3, status: "funded" },
    { title: "Annual Scholarship — 3 Students", desc: "Full scholarship covering tuition and accommodation.", amount: 12000, votes_for: 61, votes_against: 7, status: "funded" },
    { title: "Digital Skills Training Programme", desc: "6-week digital skills training for 100 youth.", amount: 7500, votes_for: 38, votes_against: 4, status: "voting" },
  ];

  let proposalCount = 0;
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const fundId = fundIds[i % fundIds.length];
    const proposer = users[(i + 1) % users.length];
    try {
      await q(
        `INSERT IGNORE INTO fund_proposals (fund_id, proposer_id, title, description, requested_amount, currency, votes_for, votes_against, status, voting_deadline, created_at) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, NOW() + INTERVAL 14 DAY, NOW() - INTERVAL ? DAY)`,
        [fundId, proposer.id, p.title, p.desc, p.amount, p.votes_for, p.votes_against, p.status, i * 3 + 1]
      );
      proposalCount++;
    } catch (e) { console.warn(`  ⚠ Proposal: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${proposalCount} proposals created`);

  // ── Fund Votes ─────────────────────────────────────────────────────────────
  console.log("  🗳️ Seeding fund votes...");
  const proposalRows = await q("SELECT id, fund_id FROM fund_proposals LIMIT 6");
  let voteCount = 0;
  for (const proposal of proposalRows) {
    for (let i = 0; i < Math.min(4, users.length); i++) {
      try {
        await q(
          `INSERT IGNORE INTO fund_votes (proposal_id, fund_id, voter_id, vote, created_at) VALUES (?, ?, ?, ?, NOW() - INTERVAL ? DAY)`,
          [proposal.id, proposal.fund_id, users[i].id, Math.random() > 0.2 ? "for" : "against", Math.floor(Math.random() * 10) + 1]
        );
        voteCount++;
      } catch { /* duplicate vote is OK */ }
    }
  }
  console.log(`  ✅ ${voteCount} votes created`);
}

// ── 4. Diaspora Collectives & Investment Opportunities ────────────────────────
async function seedDiaspora(users) {
  console.log("\n🌍 Seeding diaspora collectives...");
  const collectives = [
    { name: "Nigerians in UK — Investment Circle", desc: "UK-based Nigerians pooling capital for Nigerian real estate and tech.", country: "Nigeria", target: 500000, raised: 287500, members: 45 },
    { name: "Ghanaians in North America", desc: "Diaspora investment club focused on Ghanaian agriculture and manufacturing.", country: "Ghana", target: 250000, raised: 134000, members: 28 },
    { name: "East African Diaspora Fund", desc: "Kenya, Tanzania, Uganda diaspora investing in East African infrastructure.", country: "Kenya", target: 1000000, raised: 423000, members: 67 },
  ];

  const collectiveIds = [];
  for (let i = 0; i < collectives.length; i++) {
    const c = collectives[i];
    const creator = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO diaspora_collectives (creator_id, name, description, home_country, target_amount, raised_amount, currency, member_count, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 1, NOW())`,
        [creator.id, c.name, c.desc, c.country, c.target, c.raised, c.members]
      );
      const [row] = await q("SELECT id FROM diaspora_collectives WHERE name = ? LIMIT 1", [c.name]);
      if (row) collectiveIds.push(row.id);
    } catch (e) { console.warn(`  ⚠ Collective: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${collectiveIds.length} collectives created`);

  // ── Collective Members ─────────────────────────────────────────────────────
  let memberCount = 0;
  for (const collectiveId of collectiveIds) {
    for (let i = 0; i < Math.min(5, users.length); i++) {
      try {
        await q(
          `INSERT IGNORE INTO diaspora_collective_members (collective_id, user_id, contribution_amount, currency, role, joined_at) VALUES (?, ?, ?, 'USD', ?, NOW() - INTERVAL ? DAY)`,
          [collectiveId, users[i].id, Math.floor(Math.random() * 5000) + 1000, i === 0 ? "admin" : "member", Math.floor(Math.random() * 90) + 1]
        );
        memberCount++;
      } catch { /* duplicate is OK */ }
    }
  }
  console.log(`  ✅ ${memberCount} collective members created`);

  // ── Investment Opportunities ───────────────────────────────────────────────
  console.log("  💰 Seeding investment opportunities...");
  const investments = [
    { name: "Lagos Tech Hub — Series A", desc: "Leading B2B SaaS for African SMEs. $2M ARR, 40% YoY growth.", sector: "Technology", target: 2000000, raised: 1450000, min_investment: 5000, stage: "series_a", return_rate: "25-35% IRR", status: "open" },
    { name: "Nairobi Solar Farm — Phase 2", desc: "50MW solar installation serving 200,000 homes in Kenya.", sector: "Energy", target: 5000000, raised: 3200000, min_investment: 10000, stage: "growth", return_rate: "12-18% p.a.", status: "open" },
    { name: "Accra Affordable Housing", desc: "500-unit affordable housing development in Greater Accra.", sector: "Real Estate", target: 8000000, raised: 5600000, min_investment: 25000, stage: "growth", return_rate: "15-22% IRR", status: "closing" },
    { name: "Pan-African AgriTech Platform", desc: "Digital marketplace connecting 50,000 smallholder farmers to buyers.", sector: "Agriculture", target: 1500000, raised: 890000, min_investment: 2500, stage: "series_a", return_rate: "20-30% IRR", status: "open" },
    { name: "Diaspora Remittance FinTech", desc: "Mobile-first remittance app targeting $15B Nigeria corridor.", sector: "FinTech", target: 3000000, raised: 2100000, min_investment: 5000, stage: "series_b", return_rate: "30-45% IRR", status: "open" },
  ];

  let investCount = 0;
  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const creator = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO investment_opportunities (creator_id, name, description, sector, target_amount, raised_amount, currency, min_investment, stage, expected_return, status, investor_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, NOW())`,
        [creator.id, inv.name, inv.desc, inv.sector, inv.target, inv.raised, inv.min_investment, inv.stage, inv.return_rate, inv.status, Math.floor(Math.random() * 80) + 20]
      );
      investCount++;
    } catch (e) { console.warn(`  ⚠ Investment: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${investCount} investment opportunities created`);
}

// ── 5. Family Members & Budgets ───────────────────────────────────────────────
async function seedFamily(users) {
  console.log("\n👨‍👩‍👧 Seeding family members...");
  const families = [
    { name: "Ngozi Adeyemi", relationship: "spouse", country: "NG", phone: "+234 801 234 5678", email: "ngozi@example.com", bank: "First Bank", account: "3012345678", currency: "NGN", budget: 150000, threshold: 80 },
    { name: "Emmanuel Adeyemi", relationship: "child", country: "GB", phone: "+44 7700 900123", email: "emma@example.com", bank: "Barclays", account: "20-00-00 12345678", currency: "GBP", budget: 500, threshold: 90 },
    { name: "Grace Adeyemi", relationship: "parent", country: "NG", phone: "+234 802 345 6789", email: "grace@example.com", bank: "GTBank", account: "0123456789", currency: "NGN", budget: 80000, threshold: 70 },
  ];

  const mainUser = users[0];
  let familyCount = 0;
  for (const f of families) {
    try {
      await q(
        `INSERT IGNORE INTO family_members (user_id, name, relationship, country_code, phone, email, bank_name, bank_account, preferred_currency, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [mainUser.id, f.name, f.relationship, f.country, f.phone, f.email, f.bank, f.account, f.currency, "Regular monthly support"]
      );
      const [row] = await q("SELECT id FROM family_members WHERE name = ? AND user_id = ? LIMIT 1", [f.name, mainUser.id]);
      if (row) {
        await q(
          `INSERT IGNORE INTO family_budgets (family_member_id, user_id, monthly_limit, currency, alert_threshold, period_start, period_end, created_at) VALUES (?, ?, ?, ?, ?, DATE_FORMAT(NOW(), '%Y-%m-01'), LAST_DAY(NOW()), NOW())`,
          [row.id, mainUser.id, f.budget, f.currency, f.threshold]
        );
        familyCount++;
      }
    } catch (e) { console.warn(`  ⚠ Family member: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${familyCount} family members with budgets created`);
}

// ── 6. Fraud Alerts ───────────────────────────────────────────────────────────
async function seedFraudAlerts(users) {
  console.log("\n🔍 Seeding fraud alerts...");
  const alerts = [
    { type: "velocity_breach", risk: "high", amount: 15000, currency: "USD", desc: "5 transactions in 10 minutes exceeding velocity limit", status: "pending" },
    { type: "unusual_destination", risk: "medium", amount: 5000, currency: "USD", desc: "First-time transfer to high-risk jurisdiction", status: "reviewed" },
    { type: "amount_anomaly", risk: "critical", amount: 45000, currency: "USD", desc: "Transfer amount 10x user's average transaction", status: "blocked" },
    { type: "device_mismatch", risk: "low", amount: 200, currency: "USD", desc: "Login from new device in different country", status: "approved" },
    { type: "sanctions_match", risk: "critical", amount: 8000, currency: "USD", desc: "Beneficiary name partial match on OFAC SDN list", status: "escalated" },
  ];

  let alertCount = 0;
  for (let i = 0; i < alerts.length; i++) {
    const a = alerts[i];
    const user = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO fraud_alerts (user_id, risk_level, risk_score, transaction_amount, transaction_currency, flags, status, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? HOUR)`,
        [user.id, a.risk, Math.floor(Math.random() * 40) + 60, a.amount, a.currency, JSON.stringify([a.type]), a.status, `192.168.${i}.${i * 10 + 1}`, i * 6 + 1]
      );
      alertCount++;
    } catch (e) { console.warn(`  ⚠ Fraud alert: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${alertCount} fraud alerts created`);
}

// ── 7. FX Rate Alerts ─────────────────────────────────────────────────────────
async function seedFxAlerts(users) {
  console.log("\n📊 Seeding FX rate alerts...");
  const fxAlerts = [
    { from: "USD", to: "NGN", target: 1600, direction: "above" },
    { from: "GBP", to: "NGN", target: 2000, direction: "above" },
    { from: "USD", to: "KES", target: 140, direction: "above" },
    { from: "EUR", to: "NGN", target: 1700, direction: "below" },
  ];

  let alertCount = 0;
  for (let i = 0; i < fxAlerts.length; i++) {
    const a = fxAlerts[i];
    const user = users[i % users.length];
    try {
      await q(
        `INSERT IGNORE INTO fx_rate_alert_targets (user_id, from_currency, to_currency, target_rate, direction, is_active, notify_sms, notify_email, notify_push, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, 1, 0, NOW())`,
        [user.id, a.from, a.to, a.target, a.direction]
      );
      alertCount++;
    } catch (e) { console.warn(`  ⚠ FX alert: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${alertCount} FX rate alerts created`);
}

// ── 8. Recurring Payments ─────────────────────────────────────────────────────
async function seedRecurringPayments(users) {
  console.log("\n🔄 Seeding recurring payments...");
  const payments = [
    { name: "Mum Monthly Allowance", account: "0123456789", bank: "GTBank", amount: 50000, currency: "NGN", freq: "monthly", day: 1 },
    { name: "School Fees — Emmanuel", account: "20-00-00 12345678", bank: "Barclays", amount: 500, currency: "GBP", freq: "monthly", day: 15 },
    { name: "Rent — Lagos Apartment", account: "1234567890", bank: "Zenith Bank", amount: 250000, currency: "NGN", freq: "monthly", day: 28 },
  ];

  const mainUser = users[0];
  let count = 0;
  for (const p of payments) {
    try {
      await q(
        `INSERT IGNORE INTO recurring_payments (userId, recipientName, recipientAccount, recipientBank, amount, currency, frequency, nextRunDate, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_FORMAT(NOW() + INTERVAL 1 MONTH, '%Y-%m-01'), 'active', NOW())`,
        [mainUser.id, p.name, p.account, p.bank, p.amount, p.currency, p.freq]
      );
      count++;
    } catch (e) { console.warn(`  ⚠ Recurring payment: ${e.message.slice(0, 60)}`); }
  }
  console.log(`  ✅ ${count} recurring payments created`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 RemitFlow v44 — Comprehensive Seed Script");
  console.log("=".repeat(50));

  const users = await getUsers();
  if (users.length === 0) {
    console.error("❌ No users found. Run the base seed script first.");
    process.exit(1);
  }
  console.log(`✅ Found ${users.length} users to seed data for`);

  await seedMarketplace(users);
  await seedTalent(users);
  await seedCommunity(users);
  await seedDiaspora(users);
  await seedFamily(users);
  await seedFraudAlerts(users);
  await seedFxAlerts(users);
  await seedRecurringPayments(users);

  console.log("\n" + "=".repeat(50));
  console.log("✅ v44 seed complete!");
  await sql.end();
}

main().catch(e => { console.error("❌ Seed failed:", e.message); process.exit(1); });
