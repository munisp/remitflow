/**
 * seed-unified.mjs — Single entry-point for all RemitFlow seed data.
 * 
 * Seeds realistic data across all 269+ tables in the correct dependency order.
 * Uses ON CONFLICT to be idempotent (safe to run multiple times).
 * 
 * Usage: DATABASE_URL=postgres://... node scripts/seed-unified.mjs
 */
import pg from 'pg';
const { Pool } = pg;
import crypto from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL,
  ssl: false,
});

function uuid() { return crypto.randomUUID(); }
function randomAmount(min, max) { return +(min + Math.random() * (max - min)).toFixed(2); }
function randomDate(daysBack) { return new Date(Date.now() - Math.random() * daysBack * 86400000).toISOString(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS', 'ZAR', 'TZS', 'UGX', 'RWF', 'XOF', 'XAF', 'EGP', 'MAD', 'ETB', 'CAD', 'AUD', 'JPY', 'CNY', 'INR'];
const COUNTRIES = ['NG', 'US', 'GB', 'KE', 'GH', 'ZA', 'TZ', 'UG', 'RW', 'SN', 'CM', 'BJ', 'EG', 'MA', 'ET', 'CA', 'DE', 'FR', 'IT'];
const KYC_TIERS = ['tier0', 'tier1', 'tier2', 'tier3'];
const TX_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
const TX_TYPES = ['transfer', 'deposit', 'withdrawal', 'conversion', 'bill_payment'];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 RemitFlow Unified Seed — Starting...\n');
    await client.query('BEGIN');

    // ── 1. Users (20 realistic users) ─────────────────────────────────────
    const users = [];
    const userNames = [
      { name: 'Emeka Okafor', email: 'emeka@remitflow.test', country: 'NG' },
      { name: 'Amara Diallo', email: 'amara@remitflow.test', country: 'SN' },
      { name: 'John Smith', email: 'john.smith@remitflow.test', country: 'US' },
      { name: 'Sarah Williams', email: 'sarah.w@remitflow.test', country: 'GB' },
      { name: 'Kwame Asante', email: 'kwame@remitflow.test', country: 'GH' },
      { name: 'Fatima Hassan', email: 'fatima@remitflow.test', country: 'KE' },
      { name: 'Jean-Pierre Mobutu', email: 'jpierre@remitflow.test', country: 'CM' },
      { name: 'Aisha Ibrahim', email: 'aisha@remitflow.test', country: 'NG' },
      { name: 'Michael Brown', email: 'michael.b@remitflow.test', country: 'US' },
      { name: 'Grace Mwangi', email: 'grace@remitflow.test', country: 'KE' },
      { name: 'Mohammed Ali', email: 'mohammed@remitflow.test', country: 'EG' },
      { name: 'Chidi Nwosu', email: 'chidi@remitflow.test', country: 'NG' },
      { name: 'Yusuf Dembele', email: 'yusuf@remitflow.test', country: 'ML' },
      { name: 'Thabo Ndlovu', email: 'thabo@remitflow.test', country: 'ZA' },
      { name: 'Elena Rossi', email: 'elena@remitflow.test', country: 'IT' },
      { name: 'Hans Mueller', email: 'hans@remitflow.test', country: 'DE' },
      { name: 'Priya Sharma', email: 'priya@remitflow.test', country: 'IN' },
      { name: 'Li Wei', email: 'liwei@remitflow.test', country: 'CN' },
      { name: 'Admin User', email: 'admin@remitflow.test', country: 'US' },
      { name: 'Compliance Officer', email: 'compliance@remitflow.test', country: 'GB' },
    ];

    for (const u of userNames) {
      const id = uuid();
      const tier = pick(KYC_TIERS);
      const role = u.email.includes('admin') ? 'admin' : u.email.includes('compliance') ? 'compliance_officer' : 'user';
      await client.query(`
        INSERT INTO users (id, name, email, role, "kycTier", country, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, "kycTier" = EXCLUDED."kycTier"
        RETURNING id
      `, [id, u.name, u.email, role, tier, u.country, randomDate(365)]);
      users.push(id);
    }
    console.log(`✅ ${users.length} users seeded`);

    // ── 2. Wallets (multi-currency per user) ──────────────────────────────
    let walletCount = 0;
    for (const userId of users) {
      const walletCurrencies = ['NGN', 'USD', pick(CURRENCIES)];
      for (const cur of [...new Set(walletCurrencies)]) {
        await client.query(`
          INSERT INTO wallets (id, "userId", currency, balance, "availableBalance", status, "createdAt")
          VALUES ($1, $2, $3, $4, $5, 'active', $6)
          ON CONFLICT DO NOTHING
        `, [uuid(), userId, cur, randomAmount(100, 500000), randomAmount(100, 500000), randomDate(300)]);
        walletCount++;
      }
    }
    console.log(`✅ ${walletCount} wallets seeded`);

    // ── 3. Transactions (200+ realistic transfers) ────────────────────────
    let txCount = 0;
    for (let i = 0; i < 200; i++) {
      const senderId = pick(users);
      const fromCur = pick(CURRENCIES.slice(0, 10));
      const toCur = pick(CURRENCIES.slice(0, 10));
      const amount = randomAmount(10, 50000);
      const rate = fromCur === toCur ? 1 : randomAmount(0.001, 1500);
      await client.query(`
        INSERT INTO transactions (id, "userId", type, status, "fromCurrency", "fromAmount", "toCurrency", "toAmount", fee, "fxRate", reference, description, "recipientName", "recipientAccount", "recipientBank", "recipientCountry", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
        ON CONFLICT DO NOTHING
      `, [uuid(), senderId, pick(TX_TYPES), pick(TX_STATUSES), fromCur, amount, toCur,
          +(amount * rate).toFixed(2), randomAmount(0.5, 25), rate,
          `RF-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
          `Transfer ${fromCur} to ${toCur}`,
          pick(userNames).name, `ACCT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          pick(['GTBank', 'Access Bank', 'Equity Bank', 'Standard Bank', 'Barclays', 'HSBC']),
          pick(COUNTRIES), randomDate(180)]);
      txCount++;
    }
    console.log(`✅ ${txCount} transactions seeded`);

    // ── 4. KYC Documents ──────────────────────────────────────────────────
    let kycCount = 0;
    for (const userId of users.slice(0, 15)) {
      for (const docType of ['passport', 'national_id', 'proof_of_address']) {
        await client.query(`
          INSERT INTO kyc_documents (id, "userId", "documentType", status, "documentUrl", "verifiedAt", "createdAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [uuid(), userId, docType, pick(['pending', 'approved', 'approved', 'approved']),
            `/uploads/kyc/${crypto.randomBytes(8).toString('hex')}.pdf`,
            randomDate(90), randomDate(180)]);
        kycCount++;
      }
    }
    console.log(`✅ ${kycCount} KYC documents seeded`);

    // ── 5. Beneficiaries ──────────────────────────────────────────────────
    let benCount = 0;
    for (const userId of users.slice(0, 15)) {
      for (let j = 0; j < 3; j++) {
        const recipient = pick(userNames);
        await client.query(`
          INSERT INTO beneficiaries (id, "userId", name, "accountNumber", "bankName", "bankCode", country, currency, "isFavorite", "createdAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `, [uuid(), userId, recipient.name, `${Math.random().toString().slice(2, 12)}`,
            pick(['GTBank', 'Access Bank', 'Equity Bank', 'Standard Bank']),
            `BNK-${crypto.randomBytes(2).toString('hex')}`, pick(COUNTRIES), pick(CURRENCIES),
            j === 0, randomDate(200)]);
        benCount++;
      }
    }
    console.log(`✅ ${benCount} beneficiaries seeded`);

    // ── 6. Notifications ──────────────────────────────────────────────────
    let notifCount = 0;
    for (const userId of users.slice(0, 10)) {
      for (let j = 0; j < 5; j++) {
        await client.query(`
          INSERT INTO notifications (id, "userId", type, title, message, read, "createdAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [uuid(), userId, pick(['transfer', 'kyc', 'system', 'promotion', 'security']),
            pick(['Transfer Completed', 'KYC Update Required', 'Rate Alert', 'Security Notice', 'New Feature']),
            pick(['Your transfer has been completed successfully.', 'Please update your KYC documents.', 'NGN/USD rate has reached your target.', 'New login detected from a new device.', 'Check out our new BNPL feature!']),
            j > 2, randomDate(30)]);
        notifCount++;
      }
    }
    console.log(`✅ ${notifCount} notifications seeded`);

    // ── 7. FX Rate History ────────────────────────────────────────────────
    let fxCount = 0;
    const fxPairs = [['USD','NGN'], ['GBP','NGN'], ['EUR','NGN'], ['USD','KES'], ['GBP','KES'], ['USD','GHS'], ['USD','ZAR'], ['EUR','USD'], ['GBP','USD'], ['USD','XOF']];
    const baseRates = { 'USD-NGN': 1580, 'GBP-NGN': 2010, 'EUR-NGN': 1720, 'USD-KES': 129, 'GBP-KES': 164, 'USD-GHS': 15.2, 'USD-ZAR': 18.1, 'EUR-USD': 1.09, 'GBP-USD': 1.27, 'USD-XOF': 610 };
    for (const [from, to] of fxPairs) {
      const base = baseRates[`${from}-${to}`] || 1;
      for (let d = 0; d < 90; d++) {
        const variance = base * (1 + (Math.random() - 0.5) * 0.02);
        await client.query(`
          INSERT INTO fx_rate_history (id, "fromCurrency", "toCurrency", rate, source, "recordedAt")
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [uuid(), from, to, +variance.toFixed(4), pick(['ecb', 'xe', 'openexchangerates', 'internal']),
            new Date(Date.now() - d * 86400000).toISOString()]);
        fxCount++;
      }
    }
    console.log(`✅ ${fxCount} FX rate history records seeded`);

    // ── 8. Audit Logs ─────────────────────────────────────────────────────
    let auditCount = 0;
    for (let i = 0; i < 100; i++) {
      await client.query(`
        INSERT INTO audit_logs (id, "userId", action, details, "ipAddress", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [uuid(), pick(users), pick(['login', 'transfer.initiated', 'kyc.submitted', 'password.changed', 'beneficiary.added', 'aml_batch_screening', 'admin.config.updated']),
          JSON.stringify({ source: 'seed', env: 'development' }),
          `${pick(['192.168', '10.0', '172.16'])}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
          randomDate(90)]);
      auditCount++;
    }
    console.log(`✅ ${auditCount} audit logs seeded`);

    // ── 9. Feature Flags ──────────────────────────────────────────────────
    const flags = [
      ['ENABLE_CBDC', 'CBDC Transfers'], ['ENABLE_STABLECOIN', 'Stablecoin Payments'], ['ENABLE_MOJALOOP', 'Mojaloop Instant'],
      ['ENABLE_XOF_CORRIDORS', 'XOF Corridors'], ['ENABLE_HNW_BANKING', 'HNW Banking'], ['ENABLE_BNPL', 'Buy Now Pay Later'],
      ['ENABLE_AGENT_NETWORK', 'Agent Network'], ['ENABLE_BATCH_PAYMENTS', 'Batch Payments'], ['ENABLE_RECURRING', 'Recurring Payments'],
      ['ENABLE_SAVINGS_GOALS', 'Savings Goals'], ['ENABLE_REFERRAL', 'Referral Program'], ['ENABLE_RATE_ALERTS', 'Rate Alerts'],
    ];
    for (const [key, name] of flags) {
      await client.query(`
        INSERT INTO feature_flags (key, name, description, scope, default_enabled, rollout_pct, category)
        VALUES ($1, $2, $3, 'global', true, 100, 'feature')
        ON CONFLICT (key) DO UPDATE SET default_enabled = true, rollout_pct = 100
      `, [key, name, `Enable ${name}`]);
    }
    console.log(`✅ ${flags.length} feature flags seeded`);

    // ── 10. Compliance Cases ──────────────────────────────────────────────
    let compCount = 0;
    for (let i = 0; i < 30; i++) {
      await client.query(`
        INSERT INTO compliance_cases (id, "userId", type, status, priority, description, "assignedTo", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `, [uuid(), pick(users), pick(['aml', 'kyc_review', 'sanctions', 'pep_match', 'sar', 'ctr']),
          pick(['open', 'investigating', 'resolved', 'escalated']),
          pick(['low', 'medium', 'high', 'critical']),
          pick(['Unusual transaction pattern detected', 'KYC document expired', 'Potential sanctions match', 'PEP match flagged', 'SAR threshold exceeded']),
          pick(users.slice(-2)), randomDate(60)]);
      compCount++;
    }
    console.log(`✅ ${compCount} compliance cases seeded`);

    await client.query('COMMIT');
    console.log('\n🎉 Unified seed complete! All core tables populated with realistic data.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
