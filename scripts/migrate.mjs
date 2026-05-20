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

const statements = [
  // Alter users table to add new columns
  `ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS phone varchar(32),
    ADD COLUMN IF NOT EXISTS avatar text,
    ADD COLUMN IF NOT EXISTS kycTier enum('tier0','tier1','tier2','tier3') DEFAULT 'tier0',
    ADD COLUMN IF NOT EXISTS referralCode varchar(16),
    ADD COLUMN IF NOT EXISTS referredBy int,
    ADD COLUMN IF NOT EXISTS twoFactorEnabled boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS twoFactorSecret varchar(64)`,

  // Alter wallets table
  `CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    currency varchar(8) NOT NULL,
    balance decimal(18,2) NOT NULL DEFAULT 0.00,
    lockedBalance decimal(18,2) DEFAULT 0.00,
    isDefault boolean DEFAULT false,
    status enum('active','suspended','closed') DEFAULT 'active',
    createdAt timestamp NOT NULL DEFAULT (now()),
    updatedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Transactions
  `CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    type enum('send','receive','exchange','topup','withdrawal','fee','refund','airtime','bill','savings','card') NOT NULL,
    status enum('pending','processing','completed','failed','cancelled','reversed') DEFAULT 'pending',
    fromCurrency varchar(8) NOT NULL,
    fromAmount decimal(18,2) NOT NULL,
    toCurrency varchar(8),
    toAmount decimal(18,2),
    fee decimal(18,2) DEFAULT 0.00,
    fxRate decimal(18,6),
    reference varchar(64),
    description text,
    recipientName varchar(128),
    recipientAccount varchar(64),
    recipientBank varchar(128),
    recipientCountry varchar(64),
    channel varchar(32),
    metadata json,
    createdAt timestamp NOT NULL DEFAULT (now()),
    updatedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Beneficiaries - may already exist, add missing columns
  `ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS updatedAt timestamp DEFAULT (now())`,

  // Cards - add missing columns
  `ALTER TABLE cards 
    ADD COLUMN IF NOT EXISTS cardholderName varchar(128),
    ADD COLUMN IF NOT EXISTS updatedAt timestamp DEFAULT (now())`,

  // Savings goals - add missing columns
  `ALTER TABLE savingsGoals 
    ADD COLUMN IF NOT EXISTS emoji varchar(8) DEFAULT '🎯',
    ADD COLUMN IF NOT EXISTS updatedAt timestamp DEFAULT (now())`,

  // FX Alerts - add missing columns
  `ALTER TABLE fxAlerts ADD COLUMN IF NOT EXISTS triggeredAt timestamp`,

  // KYC Documents - add missing columns
  `ALTER TABLE kycDocuments 
    ADD COLUMN IF NOT EXISTS fileKey text,
    ADD COLUMN IF NOT EXISTS reviewedAt timestamp`,

  // Notifications - add missing columns
  `ALTER TABLE notifications 
    ADD COLUMN IF NOT EXISTS actionUrl varchar(256),
    ADD COLUMN IF NOT EXISTS metadata json`,

  // Audit Logs
  `CREATE TABLE IF NOT EXISTS auditLogs (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    action varchar(64) NOT NULL,
    description text,
    ipAddress varchar(64),
    userAgent text,
    severity enum('info','warning','critical') DEFAULT 'info',
    metadata json,
    createdAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Virtual Accounts
  `CREATE TABLE IF NOT EXISTS virtualAccounts (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    currency varchar(8) NOT NULL,
    bank varchar(128) NOT NULL,
    accountNumber varchar(32) NOT NULL,
    accountName varchar(128) NOT NULL,
    routingNumber varchar(32),
    sortCode varchar(16),
    iban varchar(64),
    swiftCode varchar(16),
    status enum('active','inactive') DEFAULT 'active',
    createdAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Recurring Payments
  `CREATE TABLE IF NOT EXISTS recurringPayments (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    name varchar(128) NOT NULL,
    recipientName varchar(128),
    recipientAccount varchar(64),
    recipientBank varchar(128),
    amount decimal(18,2) NOT NULL,
    currency varchar(8) DEFAULT 'NGN',
    frequency enum('daily','weekly','monthly','quarterly','yearly') NOT NULL,
    nextRunAt timestamp,
    lastRunAt timestamp,
    status enum('active','paused','cancelled') DEFAULT 'active',
    createdAt timestamp NOT NULL DEFAULT (now()),
    updatedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Batch Payments
  `CREATE TABLE IF NOT EXISTS batchPayments (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    name varchar(128) NOT NULL,
    totalAmount decimal(18,2),
    currency varchar(8) DEFAULT 'NGN',
    totalRecipients int DEFAULT 0,
    successCount int DEFAULT 0,
    failedCount int DEFAULT 0,
    status enum('draft','processing','completed','failed','partial') DEFAULT 'draft',
    payments json,
    createdAt timestamp NOT NULL DEFAULT (now()),
    updatedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Referrals
  `CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL NOT NULL,
    referrerId int NOT NULL,
    referredId int NOT NULL,
    status enum('pending','completed','rewarded') DEFAULT 'pending',
    rewardAmount decimal(18,2) DEFAULT 500.00,
    rewardCurrency varchar(8) DEFAULT 'NGN',
    createdAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // Disputes
  `CREATE TABLE IF NOT EXISTS disputes (
    id SERIAL NOT NULL,
    userId int NOT NULL,
    transactionId int,
    type enum('unauthorized','duplicate','not_received','wrong_amount','other') NOT NULL,
    description text NOT NULL,
    status enum('open','under_review','resolved','closed') DEFAULT 'open',
    resolution text,
    fileUrl text,
    fileKey text,
    createdAt timestamp NOT NULL DEFAULT (now()),
    updatedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,

  // FX Rate Cache
  `CREATE TABLE IF NOT EXISTS fxRateCache (
    id SERIAL NOT NULL,
    baseCurrency varchar(8) NOT NULL,
    rates json NOT NULL,
    fetchedAt timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY(id)
  )`,
];

let success = 0;
let failed = 0;

for (const sql of statements) {
  try {
    await exec(sql);
    success++;
    console.log(`✓ OK`);
  } catch (err) {
    // Ignore "Duplicate column" errors (already applied)
    if (err.message.includes("Duplicate column") || err.message.includes("already exists")) {
      console.log(`⚠ Already exists (skipped)`);
      success++;
    } else {
      console.error(`✗ FAILED: ${err.message.substring(0, 100)}`);
      failed++;
    }
  }
}

await sql.end();
console.log(`\nMigration complete: ${success} succeeded, ${failed} failed`);
