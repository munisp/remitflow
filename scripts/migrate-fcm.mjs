/**
 * Migration: user_fcm_tokens table for Firebase Cloud Messaging
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL,
  ssl: false,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS user_fcm_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT DEFAULT 'web',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, token)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_id ON user_fcm_tokens(user_id)`,
];

const client = await pool.connect();
try {
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      console.log("OK:", stmt.slice(0, 60));
    } catch (e) {
      if (e.code === "42P07" || e.message.includes("already exists")) {
        console.log("Skip (already exists):", stmt.slice(0, 60));
      } else {
        throw e;
      }
    }
  }
  console.log("FCM migration applied OK");
} finally {
  client.release();
  await pool.end();
}
