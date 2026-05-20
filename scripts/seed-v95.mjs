/**
 * seed-v95.mjs — v95 Production Seed Data
 * Adds: compliance alerts, sanctions checks, fraud alerts, security events,
 * beneficiary data, watchlist entries, exchange rate alerts, promo codes,
 * feature flags, system config
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.LOCAL_DATABASE_URL,
  ssl: false,
});

const COUNTRIES = ['NG', 'GH', 'KE', 'ZA', 'GB', 'US', 'DE', 'FR', 'CA', 'AU'];
const CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR', 'GBP', 'USD', 'EUR', 'CAD', 'AUD'];
const BANKS = ['Access Bank', 'GTBank', 'Zenith Bank', 'First Bank', 'UBA', 'Stanbic IBTC', 'Ecobank', 'Fidelity Bank'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }

async function main() {
  await client.connect();
  console.log('Connected to database');

  // Get actual user IDs
  const usersResult = await client.query('SELECT id FROM users LIMIT 100');
  const userIds = usersResult.rows.map(r => r.id);
  if (userIds.length === 0) { console.error('No users found — run seed-v94.mjs first'); process.exit(1); }
  const randUserId = () => rand(userIds);

  // 1. Compliance alerts (50 records) — columns: alert_type, severity, title, description, related_user_id, status, metadata, createdAt
  console.log('Seeding compliance_alerts...');
  const alertTypes = ['aml_suspicious', 'structuring', 'pep_match', 'sanctions_hit', 'velocity_breach', 'unusual_pattern'];
  const alertStatuses = ['open', 'under_review', 'escalated', 'resolved', 'false_positive'];
  const severities = ['low', 'medium', 'high', 'critical'];
  for (let i = 0; i < 50; i++) {
    const type = rand(alertTypes);
    const severity = rand(severities);
    const amount = randInt(50000, 5000000);
    await client.query(`
      INSERT INTO compliance_alerts (alert_type, severity, title, description, related_user_id, status, metadata, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      type,
      severity,
      `${type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Alert`,
      `${type.replace(/_/g, ' ')} detected for transaction of ${amount.toLocaleString()} NGN`,
      randUserId(),
      rand(alertStatuses),
      JSON.stringify({ rule: type, threshold: amount * 0.8, score: randInt(60, 99), currency: 'NGN', amount }),
      daysAgo(randInt(0, 90)),
    ]);
  }
  console.log('  ✓ 50 compliance_alerts seeded');

  // 2. Sanctions checks (30 records) — columns: screening_id, user_id, entity_name, entity_type, result, risk_level, lists_checked, match_details, created_at
  console.log('Seeding sanctions_checks...');
  const sanctionLists = ['OFAC_SDN', 'UN_CONSOLIDATED', 'EU_CONSOLIDATED', 'HMT_UK', 'PEP_DATABASE'];
  const firstNames = ['Amara', 'Chidi', 'Ngozi', 'Emeka', 'Adaeze', 'Kemi', 'Tunde', 'Bola', 'Yemi', 'Femi'];
  const lastNames = ['Okafor', 'Adeyemi', 'Nwosu', 'Ibrahim', 'Okonkwo', 'Adesanya', 'Babatunde', 'Olawale', 'Eze', 'Musa'];
  for (let i = 0; i < 30; i++) {
    const hit = Math.random() < 0.1;
    await client.query(`
      INSERT INTO sanctions_checks (screening_id, user_id, entity_name, entity_type, result, risk_level, lists_checked, match_details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      `SCR-${Date.now()}-${i}`,
      randUserId(),
      `${rand(firstNames)} ${rand(lastNames)}`,
      rand(['individual', 'entity']),
      hit ? 'hit' : 'clear',
      hit ? rand(['high', 'critical']) : 'low',
      sanctionLists.slice(0, randInt(1, 5)),
      hit ? JSON.stringify({ list: rand(sanctionLists), score: randInt(85, 100) }) : null,
      daysAgo(randInt(0, 60)),
    ]);
  }
  console.log('  ✓ 30 sanctions_checks seeded');

  // 3. Fraud alerts (20 records) — columns: user_id, transaction_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, created_at
  console.log('Seeding fraud_alerts...');
  const fraudReasons = ['velocity_breach', 'unusual_location', 'device_mismatch', 'pattern_anomaly', 'beneficiary_risk'];
  for (let i = 0; i < 20; i++) {
    await client.query(`
      INSERT INTO fraud_alerts (user_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      randUserId(),
      randInt(60, 99),
      rand(['medium', 'high', 'critical']),
      rand(['pending', 'reviewed', 'blocked', 'cleared']),
      JSON.stringify([rand(fraudReasons), rand(fraudReasons)].filter((v, i, a) => a.indexOf(v) === i)),
      randInt(50000, 5000000).toString(),
      daysAgo(randInt(0, 30)),
    ]);
  }
  console.log('  ✓ 20 fraud_alerts seeded');

  // 4. Security events (100 records) — columns: user_id, event_type, severity, ip_address, user_agent, location, details, resolved, createdAt
  console.log('Seeding security_events...');
  const secEventTypes = ['login_success', 'login_failed', 'password_changed', 'mfa_enabled', 'suspicious_login', 'account_locked', 'kyc_uploaded', 'transfer_blocked'];
  for (let i = 0; i < 100; i++) {
    const eventType = rand(secEventTypes);
    const isSuspicious = eventType.includes('suspicious') || eventType.includes('locked') || eventType.includes('blocked');
    await client.query(`
      INSERT INTO security_events (user_id, event_type, severity, ip_address, user_agent, location, details, resolved, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      randUserId(),
      eventType,
      isSuspicious ? 'high' : 'low',
      `${randInt(1, 254)}.${randInt(1, 254)}.${randInt(1, 254)}.${randInt(1, 254)}`,
      'Mozilla/5.0 (compatible; RemitFlow/1.0)',
      JSON.stringify({ country: rand(COUNTRIES), city: 'Lagos' }),
      JSON.stringify({ success: !eventType.includes('failed') && !eventType.includes('blocked'), timestamp: daysAgo(randInt(0, 30)) }),
      !isSuspicious,
      daysAgo(randInt(0, 30)),
    ]);
  }
  console.log('  ✓ 100 security_events seeded');

  // 5. Beneficiaries (50 records) — columns: userId, name, accountNumber, bankName, bankCode, currency, country, phone, email, isFavorite, createdAt
  console.log('Seeding beneficiaries...');
  for (let i = 0; i < 50; i++) {
    const userId = rand(userIds.slice(0, 10));
    const name = `${rand(firstNames)} ${rand(lastNames)}`;
    const currency = rand(CURRENCIES);
    const country = rand(COUNTRIES);
    await client.query(`
      INSERT INTO beneficiaries ("userId", name, "accountNumber", "bankName", "bankCode", currency, country, phone, email, "isFavorite", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      userId,
      name,
      `${randInt(1000000000, 9999999999)}`,
      rand(BANKS),
      `${randInt(100, 999)}`,
      currency,
      country,
      `+234${randInt(7000000000, 9099999999)}`,
      `${name.toLowerCase().replace(' ', '.')}@example.com`,
      Math.random() < 0.3,
      daysAgo(randInt(0, 180)),
    ]);
  }
  console.log('  ✓ 50 beneficiaries seeded');

  // 6. Exchange rate alerts (30 records) — columns: user_id, from_currency, to_currency, target_rate, direction, is_active, triggered_at, createdAt
  console.log('Seeding exchange_rate_alerts...');
  const currencyPairs = [['USD', 'NGN'], ['GBP', 'NGN'], ['EUR', 'NGN'], ['USD', 'GHS'], ['USD', 'KES']];
  for (let i = 0; i < 30; i++) {
    const [from, to] = rand(currencyPairs);
    const targetRate = from === 'USD' && to === 'NGN' ? randInt(1500, 1700) :
                       from === 'GBP' && to === 'NGN' ? randInt(1900, 2200) : randInt(100, 500);
    await client.query(`
      INSERT INTO exchange_rate_alerts (user_id, from_currency, to_currency, target_rate, direction, is_active, triggered_at, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      randUserId(),
      from,
      to,
      targetRate.toString(),
      rand(['above', 'below']),
      Math.random() < 0.7,
      Math.random() < 0.3 ? daysAgo(randInt(0, 30)) : null,
      daysAgo(randInt(0, 90)),
    ]);
  }
  console.log('  ✓ 30 exchange_rate_alerts seeded');

  // 7. Promo codes (10 records) — columns: code, description, discount_type, discount_value, min_transfer_amount, max_discount_amount, usage_limit, usage_count, valid_from, valid_until, is_active, createdAt
  console.log('Seeding promo_codes...');
  const promoCodes = [
    ['WELCOME10', 'Welcome bonus 10% off', 'percentage', '10', '5000', '5000'],
    ['FIRST50', 'First transfer ₦50 off', 'fixed', '50', '1000', '50'],
    ['REFER20', 'Referral reward 20% off', 'percentage', '20', '10000', '10000'],
    ['SUMMER25', 'Summer promo 25% off', 'percentage', '25', '20000', '15000'],
    ['NEWYEAR30', 'New Year 30% off', 'percentage', '30', '50000', '20000'],
    ['LOYALTY15', 'Loyalty reward 15% off', 'percentage', '15', '5000', '8000'],
    ['VIP40', 'VIP customer 40% off', 'percentage', '40', '100000', '30000'],
    ['AGENT5', 'Agent promo ₦500 off', 'fixed', '500', '10000', '500'],
    ['BULK100', 'Bulk transfer ₦1000 off', 'fixed', '1000', '500000', '1000'],
    ['TEST99', '99% test discount', 'percentage', '99', '100', '999999'],
  ];
  for (const [code, desc, type, value, minAmount, maxDiscount] of promoCodes) {
    await client.query(`
      INSERT INTO promo_codes (code, description, discount_type, discount_value, min_transfer_amount, max_discount_amount, usage_limit, usage_count, valid_from, valid_until, is_active, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (code) DO NOTHING
    `, [
      code, desc, type, value, minAmount, maxDiscount,
      randInt(100, 10000), randInt(0, 50),
      daysAgo(90), new Date(Date.now() + 90 * 86400000),
      true, daysAgo(randInt(0, 90)),
    ]);
  }
  console.log('  ✓ 10 promo_codes seeded');

  // 8. Feature flags (15 records) — columns: key, name, description, scope, default_enabled, rollout_pct, category, createdAt
  console.log('Seeding feature_flags...');
  const flags = [
    ['ENABLE_CBDC', 'CBDC Wallets', 'Enable CBDC wallet features', 'global', true, 100, 'payments'],
    ['ENABLE_BNPL', 'Buy Now Pay Later', 'Enable BNPL product', 'global', true, 80, 'credit'],
    ['ENABLE_CRYPTO', 'Crypto Trading', 'Enable cryptocurrency trading', 'global', false, 0, 'investment'],
    ['ENABLE_INVESTMENT', 'Investment Products', 'Enable investment products', 'global', true, 100, 'investment'],
    ['ENABLE_AGENT_BANKING', 'Agent Banking', 'Enable agent banking network', 'global', true, 100, 'banking'],
    ['ENABLE_MOJALOOP', 'Mojaloop', 'Enable Mojaloop interoperability', 'global', true, 100, 'payments'],
    ['ENABLE_OPEN_BANKING', 'Open Banking', 'Enable Open Banking APIs', 'global', true, 100, 'banking'],
    ['ENABLE_REAL_ESTATE', 'Real Estate', 'Enable real estate investment', 'global', true, 100, 'investment'],
    ['ENABLE_STARTUP_DEALS', 'Startup Deals', 'Enable startup investment deals', 'global', false, 0, 'investment'],
    ['ENABLE_TALENT', 'Talent Marketplace', 'Enable talent marketplace', 'global', true, 100, 'marketplace'],
    ['ENABLE_COMMUNITY', 'Community Funds', 'Enable community fund features', 'global', true, 100, 'community'],
    ['ENABLE_DIASPORA', 'Diaspora Collective', 'Enable diaspora collective features', 'global', true, 100, 'community'],
    ['ENABLE_DIRECT_DEBIT', 'Direct Debit', 'Enable direct debit mandates', 'global', true, 100, 'payments'],
    ['ENABLE_BATCH', 'Batch Payments', 'Enable batch payment processing', 'global', true, 100, 'payments'],
    ['ENABLE_MULTI_TENANT', 'Multi-Tenant', 'Enable multi-tenant white-label', 'global', true, 100, 'platform'],
  ];
  for (const [key, name, description, scope, defaultEnabled, rolloutPct, category] of flags) {
    await client.query(`
      INSERT INTO feature_flags (key, name, description, scope, default_enabled, rollout_pct, category, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (key) DO UPDATE SET name = $2, description = $3, default_enabled = $5, rollout_pct = $6
    `, [key, name, description, scope, defaultEnabled, rolloutPct, category, daysAgo(randInt(0, 180)), new Date()]);
  }
  console.log('  ✓ 15 feature_flags seeded');

  // 9. System config (15 records) — columns: key, value, description, is_secret, updatedAt
  console.log('Seeding system_config...');
  const configs = [
    ['DEFAULT_FX_SPREAD', '0.015', 'Default FX spread (1.5%)', false],
    ['MAX_TRANSFER_AMOUNT_NGN', '10000000', 'Maximum single transfer in NGN', false],
    ['KYC_TIER1_LIMIT', '500000', 'KYC Tier 1 daily limit NGN', false],
    ['KYC_TIER2_LIMIT', '2000000', 'KYC Tier 2 daily limit NGN', false],
    ['KYC_TIER3_LIMIT', '10000000', 'KYC Tier 3 daily limit NGN', false],
    ['VELOCITY_HOURLY_LIMIT', '5', 'Max transfers per hour per user', false],
    ['VELOCITY_DAILY_LIMIT_NGN', '5000000', 'Max daily transfer volume NGN', false],
    ['AML_HIGH_RISK_THRESHOLD', '1000000', 'AML high risk amount threshold NGN', false],
    ['ACCOUNT_LOCKOUT_ATTEMPTS', '5', 'Failed login attempts before lockout', false],
    ['ACCOUNT_LOCKOUT_DURATION_MIN', '15', 'Account lockout duration in minutes', false],
    ['COMPLIANCE_SCORE_THRESHOLD', '80', 'Minimum compliance score for operations', false],
    ['FRAUD_SCORE_BLOCK_THRESHOLD', '80', 'Fraud score above which to block', false],
    ['SANCTIONS_CHECK_ENABLED', 'true', 'Enable real-time sanctions screening', false],
    ['REFERRAL_BONUS_NGN', '1000', 'Referral bonus amount in NGN', false],
    ['SUPPORT_EMAIL', 'support@remitflow.io', 'Customer support email', false],
  ];
  for (const [key, value, description, isSecret] of configs) {
    await client.query(`
      INSERT INTO system_config (key, value, description, is_secret, "updatedAt")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO UPDATE SET value = $2, description = $3, "updatedAt" = $5
    `, [key, value, description, isSecret, new Date()]);
  }
  console.log('  ✓ 15 system_config entries seeded');

  await client.end();
  console.log('\n✅ v95 seed data complete!');
  console.log('  - 50 compliance alerts');
  console.log('  - 30 sanctions checks');
  console.log('  - 20 fraud alerts');
  console.log('  - 100 security events');
  console.log('  - 50 beneficiaries');
  console.log('  - 30 exchange rate alerts');
  console.log('  - 10 promo codes');
  console.log('  - 15 feature flags');
  console.log('  - 15 system config entries');
}

main().catch(e => { console.error('Seed error:', e.message); process.exit(1); });
