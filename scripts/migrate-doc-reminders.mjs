/**
 * Migration: Document Vault Expiry Reminder Tables
 * Creates doc_reminder_prefs and doc_reminder_log
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL,
  ssl: false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // doc_reminder_prefs — per-user reminder threshold + channel preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_reminder_prefs (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        remind_30d    BOOLEAN NOT NULL DEFAULT true,
        remind_14d    BOOLEAN NOT NULL DEFAULT true,
        remind_7d     BOOLEAN NOT NULL DEFAULT true,
        remind_3d     BOOLEAN NOT NULL DEFAULT true,
        remind_1d     BOOLEAN NOT NULL DEFAULT true,
        notify_email  BOOLEAN NOT NULL DEFAULT true,
        notify_in_app BOOLEAN NOT NULL DEFAULT true,
        notify_push   BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ doc_reminder_prefs table created");

    // doc_reminder_log — deduplication + audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_reminder_log (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id   INTEGER NOT NULL REFERENCES document_vault(id) ON DELETE CASCADE,
        reminder_type VARCHAR(10) NOT NULL,
        channel       VARCHAR(20) NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'sent',
        sent_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ doc_reminder_log table created");

    // Index for fast deduplication lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_reminder_log_dedup
        ON doc_reminder_log (document_id, reminder_type, channel)
    `);
    console.log("✓ deduplication index created");

    // Index for user-scoped queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_reminder_log_user
        ON doc_reminder_log (user_id, sent_at DESC)
    `);
    console.log("✓ user index created");

    await client.query("COMMIT");
    console.log("✅ Migration complete: doc_reminder_prefs + doc_reminder_log");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
