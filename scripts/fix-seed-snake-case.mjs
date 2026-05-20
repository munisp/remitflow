/**
 * Fix seed for tables that use snake_case columns (not camelCase).
 * Covers: velocity_overrides, velocity_whitelist, webhook_endpoints,
 *         webhook_deliveries, airflow_dag_runs
 */
import pg from "pg";
const { Client } = pg;
const client = new Client({ connectionString: process.env.LOCAL_DATABASE_URL });
await client.connect();
console.log("✅ Connected");

async function q(sql, params = []) {
  try { return await client.query(sql, params); }
  catch (err) {
    if (err.code === "23505" || err.code === "23503") return;
    console.warn("⚠️ ", err.message.slice(0, 120));
  }
}

function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function hex(n) { return Array.from({length: n}, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
function pastDate(d) { return new Date(Date.now() - d * 86400000).toISOString(); }
function futureDate(d) { return new Date(Date.now() + d * 86400000).toISOString(); }

const usersResult = await client.query('SELECT id FROM users LIMIT 10');
const userIds = usersResult.rows.map(r => r.id);
const userId1 = userIds[0];
const userId2 = userIds[1] ?? userId1;

// velocity_rules already seeded with correct column names
const vrResult = await client.query('SELECT id FROM velocity_rules LIMIT 4');
const vrIds = vrResult.rows.map(r => r.id);

// ── velocity_overrides ──────────────────────────────────────────────────────
console.log("Seeding velocity_overrides...");
for (const uid of userIds) {
  await q(`INSERT INTO velocity_overrides (rule_id, user_id, reason, expires_at, granted_by, created_at)
    VALUES ($1, $2, 'VIP customer - increased limit approved', $3, $4, NOW())
    ON CONFLICT DO NOTHING`,
    [vrIds[0] ?? 1, uid, futureDate(90), userId1]
  );
}

// ── velocity_whitelist ──────────────────────────────────────────────────────
console.log("Seeding velocity_whitelist...");
for (const uid of userIds) {
  await q(`INSERT INTO velocity_whitelist (user_id, reason, added_by, expires_at, created_at)
    VALUES ($1, 'Verified business account', $2, $3, NOW())
    ON CONFLICT DO NOTHING`,
    [uid, userId1, futureDate(365)]
  );
}

// ── webhook_endpoints ───────────────────────────────────────────────────────
console.log("Seeding webhook_endpoints...");
for (const uid of userIds) {
  await q(`INSERT INTO webhook_endpoints (user_id, url, secret, events, is_active, description, failure_count, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4::json, true, 'Main webhook endpoint', 0, NOW(), NOW())
    ON CONFLICT DO NOTHING`,
    [
      uid,
      `https://app.example.com/webhooks/remitflow/${uid}`,
      hex(32),
      JSON.stringify(['transfer.completed','kyc.approved','payment.failed'])
    ]
  );
}

// ── webhook_deliveries ──────────────────────────────────────────────────────
console.log("Seeding webhook_deliveries...");
const weResult = await client.query('SELECT id FROM webhook_endpoints LIMIT 3');
const weIds = weResult.rows.map(r => r.id);
for (let i = 0; i < 15; i++) {
  await q(`INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, status, response_status, response_body, attempt_count, delivered_at, "createdAt")
    VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
    ON CONFLICT DO NOTHING`,
    [
      weIds[i % weIds.length] ?? null,
      pick(['transfer.completed', 'kyc.approved', 'payment.failed']),
      '{"event":"transfer.completed","data":{"id":1,"amount":50000}}',
      pick(['delivered', 'delivered', 'delivered', 'failed']),
      pick([200, 200, 200, 500]),
      pick(['{"received":true}', '{"ok":true}', 'Internal Server Error']),
      pastDate(rnd(0, 30))
    ]
  );
}

// ── airflow_dag_runs ────────────────────────────────────────────────────────
console.log("Seeding airflow_dag_runs...");
const dags = ['transaction_etl', 'compliance_report_gen', 'fx_rate_sync', 'user_analytics', 'fraud_model_retrain'];
for (let i = 0; i < 15; i++) {
  await q(`INSERT INTO airflow_dag_runs (dag_id, run_id, status, triggered_by, conf, started_at, completed_at, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING`,
    [
      pick(dags),
      `scheduled__${new Date(Date.now() - (i+1) * 3600000).toISOString()}`,
      pick(['success', 'success', 'success', 'failed', 'running']),
      userId1,
      '{}',
      pastDate(Math.floor(i / 3)),
      i % 5 !== 0 ? pastDate(Math.floor(i / 3)) : null,
      rnd(30000, 300000)
    ]
  );
}

await client.end();
console.log("✅ Snake-case fix seed complete");
