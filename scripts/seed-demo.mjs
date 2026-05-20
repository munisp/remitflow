/**
 * RemitFlow Demo Seed Script
 * Seeds the database with realistic demo data for the authenticated user.
 * Called automatically on first login via the auth router.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

const sql = postgres(url, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulates postgres2 execute(sql, params) using postgres driver
async function exec(query, params = []) {
  const parts = query.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}
async function query(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };

// Get the first user (demo user)
const [users] = await exec("SELECT id, openId FROM users LIMIT 5");
console.log("Users found:", users.length);

for (const user of users) {
  await seedUser(conn, user.id);
}

await sql.end();
console.log("Seed complete!");

async function seedUser(conn, userId) {
  console.log(`Seeding user ${userId}...`);

  // Check if already seeded
  const [existing] = await exec("SELECT id FROM wallets WHERE userId = ? LIMIT 1", [userId]);
  if (existing.length > 0) {
    console.log(`  User ${userId} already seeded, skipping`);
    return;
  }

  // Wallets
  await exec(`INSERT INTO wallets (userId, currency, balance, isDefault, status) VALUES
    (?, 'NGN', 2850000.00, true, 'active'),
    (?, 'USD', 1852.50, false, 'active'),
    (?, 'GBP', 1245.00, false, 'active'),
    (?, 'EUR', 980.00, false, 'active'),
    (?, 'KES', 245000.00, false, 'active')`,
    [userId, userId, userId, userId, userId]);

  // Transactions
  const txns = [
    [userId, 'send', 'completed', 'NGN', 50000, 'USD', 32.50, 250, 1538.46, `RF${Date.now()}001`, 'Transfer to Emeka Okafor', 'Emeka Okafor', '0123456789', 'First Bank', 'Nigeria'],
    [userId, 'receive', 'completed', 'USD', 500, 'NGN', 769230, 0, 1538.46, `RF${Date.now()}002`, 'Payment from Kwame Asante', 'Kwame Asante', null, null, 'Ghana'],
    [userId, 'exchange', 'completed', 'USD', 200, 'GBP', 158.50, 2, 0.7925, `RF${Date.now()}003`, 'USD to GBP exchange', null, null, null, null],
    [userId, 'topup', 'completed', 'NGN', 500000, null, null, 0, null, `RF${Date.now()}004`, 'Wallet top-up via bank transfer', null, null, null, null],
    [userId, 'send', 'completed', 'NGN', 25000, 'NGN', 25000, 125, 1, `RF${Date.now()}005`, 'Rent payment', 'Landlord Holdings Ltd', '9876543210', 'GTBank', 'Nigeria'],
    [userId, 'airtime', 'completed', 'NGN', 500, null, null, 0, null, `RF${Date.now()}006`, 'MTN airtime top-up 08012345678', null, null, null, null],
    [userId, 'bill', 'completed', 'NGN', 15000, null, null, 0, null, `RF${Date.now()}007`, 'DSTV Premium subscription', null, null, null, null],
    [userId, 'send', 'pending', 'USD', 150, 'KES', 19500, 3, 130, `RF${Date.now()}008`, 'Transfer to Amina Wanjiru', 'Amina Wanjiru', null, 'M-Pesa', 'Kenya'],
    [userId, 'receive', 'completed', 'GBP', 300, 'NGN', 585000, 0, 1950, `RF${Date.now()}009`, 'Salary payment', 'TechCorp Ltd', null, null, 'UK'],
    [userId, 'send', 'failed', 'USD', 75, 'GHS', 900, 1.5, 12, `RF${Date.now()}010`, 'Transfer failed - insufficient funds', 'Kofi Mensah', null, null, 'Ghana'],
  ];

  for (const txn of txns) {
    await exec(
      `INSERT INTO transactions (userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, reference, description, recipientName, recipientAccount, recipientBank, recipientCountry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      txn
    );
  }

  // Beneficiaries
  await exec(`INSERT INTO beneficiaries (userId, name, accountNumber, bankName, bankCode, currency, country, isFavorite) VALUES
    (?, 'Emeka Okafor', '0123456789', 'First Bank', '011', 'NGN', 'Nigeria', true),
    (?, 'Amina Wanjiru', '+254712345678', 'M-Pesa', 'MPESA', 'KES', 'Kenya', true),
    (?, 'Kwame Asante', 'GH-1234567890', 'GCB Bank', 'GCB', 'GHS', 'Ghana', false),
    (?, 'Fatima Al-Hassan', 'SA-9876543210', 'Al Rajhi Bank', 'RAJHI', 'SAR', 'Saudi Arabia', false),
    (?, 'Chidi Nwachukwu', '9876543210', 'GTBank', '058', 'NGN', 'Nigeria', true)`,
    [userId, userId, userId, userId, userId]);

  // Cards
  await exec(`INSERT INTO cards (userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName) VALUES
    (?, 'virtual', 'visa', '4242', '12', '2027', 'active', 'USD', 5000.00, 'DEMO USER'),
    (?, 'virtual', 'mastercard', '5555', '08', '2026', 'active', 'GBP', 2000.00, 'DEMO USER'),
    (?, 'physical', 'verve', '6011', '03', '2028', 'frozen', 'NGN', 500000.00, 'DEMO USER')`,
    [userId, userId, userId]);

  // Savings Goals
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  await exec(`INSERT INTO savingsGoals (userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, status) VALUES
    (?, 'Emergency Fund', '🛡️', 500000.00, 320000.00, 'NGN', ?, true, 20000.00, 'active'),
    (?, 'MacBook Pro', '💻', 2000.00, 850.00, 'USD', ?, true, 150.00, 'active'),
    (?, 'Vacation to Dubai', '✈️', 1500.00, 1500.00, 'USD', ?, false, null, 'completed')`,
    [userId, nextYear, userId, nextYear, userId, nextYear]);

  // FX Alerts
  await exec(`INSERT INTO fxAlerts (userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered) VALUES
    (?, 'USD', 'NGN', 1600.00, 'above', true, false),
    (?, 'GBP', 'NGN', 1800.00, 'below', true, false),
    (?, 'EUR', 'NGN', 1700.00, 'above', false, true)`,
    [userId, userId, userId]);

  // KYC Documents
  await exec(`INSERT INTO kycDocuments (userId, docType, status, fileUrl) VALUES
    (?, 'national_id', 'approved', 'https://placehold.co/400x250?text=National+ID'),
    (?, 'selfie', 'approved', 'https://placehold.co/400x400?text=Selfie'),
    (?, 'utility_bill', 'pending', null)`,
    [userId, userId, userId]);

  // Notifications
  await exec(`INSERT INTO notifications (userId, title, message, type, isRead) VALUES
    (?, 'Transfer Successful', 'Your transfer of ₦50,000 to Emeka Okafor has been completed.', 'transaction', false),
    (?, 'KYC Approved', 'Your National ID has been verified. You are now Tier 1 verified.', 'kyc', false),
    (?, 'FX Alert Triggered', 'GBP/NGN has reached your target rate of 1,800.', 'fx_alert', true),
    (?, 'Security Alert', 'New login detected from Lagos, Nigeria. If this was not you, secure your account.', 'security', false),
    (?, 'Welcome to RemitFlow!', 'Your account is set up. Start by adding money to your wallet.', 'system', true)`,
    [userId, userId, userId, userId, userId]);

  // Audit Logs
  await exec(`INSERT INTO auditLogs (userId, action, description, ipAddress, userAgent, severity) VALUES
    (?, 'LOGIN', 'User logged in successfully', '197.210.54.12', 'Chrome 122 / Windows', 'info'),
    (?, 'TRANSFER_INITIATED', 'Transfer of NGN 50,000 to Emeka Okafor', '197.210.54.12', 'Chrome 122 / Windows', 'info'),
    (?, 'KYC_SUBMITTED', 'National ID document submitted for review', '197.210.54.12', 'Chrome 122 / Windows', 'info'),
    (?, 'CARD_CREATED', 'Virtual Visa card created', '197.210.54.12', 'Chrome 122 / Windows', 'info'),
    (?, 'SAVINGS_GOAL_CREATED', 'Emergency Fund savings goal created', '197.210.54.12', 'Chrome 122 / Windows', 'info')`,
    [userId, userId, userId, userId, userId]);

  // Virtual Accounts
  await exec(`INSERT INTO virtualAccounts (userId, currency, bank, accountNumber, accountName, sortCode, swiftCode) VALUES
    (?, 'GBP', 'Barclays Bank', '12345678', 'DEMO USER', '20-00-00', 'BARCGB22'),
    (?, 'EUR', 'Deutsche Bank', 'DE89370400440532013000', 'DEMO USER', null, 'DEUTDEDB'),
    (?, 'USD', 'JPMorgan Chase', '000123456789', 'DEMO USER', null, 'CHASUS33')`,
    [userId, userId, userId]);

  // Recurring Payments
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  await exec(`INSERT INTO recurringPayments (userId, name, recipientName, recipientAccount, recipientBank, amount, currency, frequency, nextRunAt, status) VALUES
    (?, 'Netflix Subscription', 'Netflix Inc', 'NETFLIX-001', 'Stripe', 4500.00, 'NGN', 'monthly', ?, 'active'),
    (?, 'Rent Payment', 'Landlord Holdings', '9876543210', 'GTBank', 150000.00, 'NGN', 'monthly', ?, 'active'),
    (?, 'Savings Auto-Transfer', 'Emergency Fund', null, null, 20000.00, 'NGN', 'monthly', ?, 'active')`,
    [userId, nextMonth, userId, nextMonth, userId, nextMonth]);

  // Update user KYC tier
  await exec("UPDATE users SET kycTier = 'tier1', referralCode = ? WHERE id = ?", [
    `RF${userId}${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    userId
  ]);

  console.log(`  ✓ User ${userId} seeded successfully`);
}
