import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

// Parse the DATABASE_URL to extract ssl params
const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}


const conn = { sql };
try {
  await exec(`
    CREATE TABLE IF NOT EXISTS notificationPreferences (
      id SERIAL PRIMARY KEY,
      userId INT NOT NULL,
      category VARCHAR(50) NOT NULL,
      emailEnabled BOOLEAN DEFAULT TRUE,
      inAppEnabled BOOLEAN DEFAULT TRUE,
      pushEnabled BOOLEAN DEFAULT FALSE,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_category (userId, category)
    )
  `);
  console.log('✅ notificationPreferences table created (or already exists)');
} finally {
  // conn.release() not needed with postgres driver
  await sql.end();
}
