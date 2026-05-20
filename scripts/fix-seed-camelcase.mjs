/**
 * Final seed fix for camelCase-named tables with exact column names from DB.
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
    console.warn("⚠️ ", err.message.slice(0, 140));
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

const txResult = await client.query('SELECT id FROM transactions LIMIT 5');
const txIds = txResult.rows.map(r => r.id);

// ── ab_assignments ──────────────────────────────────────────────────────────
// Cols: id, experiment_id, user_id, session_id, variant_id, assigned_at
console.log("ab_assignments...");
const abExpResult = await client.query('SELECT id FROM ab_experiments LIMIT 2');
const abExpIds = abExpResult.rows.map(r => r.id);
if (abExpIds.length > 0) {
  for (const uid of userIds) {
    await q(`INSERT INTO ab_assignments (experiment_id, user_id, variant_id, assigned_at)
      VALUES ($1, $2, 1, NOW()) ON CONFLICT DO NOTHING`,
      [abExpIds[0], uid]
    );
  }
}

// ── ab_events ───────────────────────────────────────────────────────────────
// Cols: id, experiment_id, assignment_id, variant_id, event_type, metadata, created_at
console.log("ab_events...");
const abAssignResult = await client.query('SELECT id FROM ab_assignments LIMIT 5');
const abAssignIds = abAssignResult.rows.map(r => r.id);
for (let i = 0; i < abAssignIds.length; i++) {
  await q(`INSERT INTO ab_events (experiment_id, assignment_id, variant_id, event_type, metadata, created_at)
    VALUES ($1, $2, 1, 'conversion', '{"step":"payment_complete"}', NOW()) ON CONFLICT DO NOTHING`,
    [abExpIds[0] ?? 1, abAssignIds[i]]
  );
}

// ── api_changelogs ──────────────────────────────────────────────────────────
// Cols: id, version, release_date, title, type, summary, breaking_changes, new_endpoints, deprecated_endpoints, bug_fixes, is_published, created_at
console.log("api_changelogs...");
await q(`INSERT INTO api_changelogs (version, release_date, title, type, summary, breaking_changes, new_endpoints, deprecated_endpoints, bug_fixes, is_published, created_at)
  VALUES
  ('v2.5.0', $1, 'RemitFlow API v2.5.0', 'minor', 'Partner webhook retry logic and bulk payment status endpoint', false, '["GET /api/trpc/webhooks.listDeliveries","POST /api/trpc/bulk.getStatus"]', '[]', '["FX rate caching fix"]', true, NOW()),
  ('v2.4.0', $2, 'RemitFlow API v2.4.0', 'major', 'CBDC wallet support and BNPL plans', true, '["POST /api/trpc/cbdc.mint","GET /api/trpc/bnpl.plans"]', '["GET /api/v1/send"]', '["KYC document upload size limit"]', true, NOW()),
  ('v2.3.0', $3, 'RemitFlow API v2.3.0', 'minor', 'Split bill, rate lock, request money', false, '["POST /api/trpc/splitBill.create","POST /api/trpc/rateLock.lock"]', '[]', '["Beneficiary search performance"]', true, NOW())
  ON CONFLICT DO NOTHING`,
  [pastDate(7), pastDate(30), pastDate(60)]
);

// ── api_key_rotation_log ────────────────────────────────────────────────────
// Cols: id, old_key_id, new_key_id, user_id, reason, rotated_at
console.log("api_key_rotation_log...");
const akResult = await client.query('SELECT id FROM api_keys LIMIT 5');
const akIds = akResult.rows.map(r => r.id);
if (akIds.length >= 2) {
  await q(`INSERT INTO api_key_rotation_log (old_key_id, new_key_id, user_id, reason, rotated_at)
    VALUES ($1, $2, $3, 'Scheduled 90-day rotation', NOW()) ON CONFLICT DO NOTHING`,
    [akIds[0], akIds[1], userId1]
  );
}

// ── bulk_user_action_log ────────────────────────────────────────────────────
// Cols: id, admin_id, action, target_user_ids, affected_count, status, notes, created_at
console.log("bulk_user_action_log...");
await q(`INSERT INTO bulk_user_action_log (admin_id, action, target_user_ids, affected_count, status, notes, created_at)
  VALUES ($1, 'bulk_kyc_approve', $2::jsonb, 2, 'completed', 'Batch KYC verification complete', NOW()) ON CONFLICT DO NOTHING`,
  [userId1, JSON.stringify([userId1, userId2])]
);
await q(`INSERT INTO bulk_user_action_log (admin_id, action, target_user_ids, affected_count, status, notes, created_at)
  VALUES ($1, 'bulk_suspend', $2::jsonb, 1, 'completed', 'Suspended for suspicious activity', NOW()) ON CONFLICT DO NOTHING`,
  [userId1, JSON.stringify([userId2])]
);

// ── scheduledTransferRuns ────────────────────────────────────────────────────
// Cols: id, scheduleId, userId, status, amount, currency, targetCurrency, fxRate, transactionId, errorMessage, executedAt
console.log("scheduledTransferRuns...");
const stResult = await client.query('SELECT id, user_id FROM scheduled_transfers LIMIT 5');
const stRows = stResult.rows;
for (let i = 0; i < Math.min(10, stRows.length > 0 ? 10 : 0); i++) {
  const st = stRows[i % stRows.length];
  await q(`INSERT INTO "scheduledTransferRuns" ("scheduleId", "userId", status, amount, currency, "targetCurrency", "fxRate", "transactionId", "executedAt")
    VALUES ($1, $2, $3, $4, 'USD', 'NGN', $5, $6, $7) ON CONFLICT DO NOTHING`,
    [
      st.id, st.user_id,
      pick(['success','success','failed','skipped']),
      rnd(5000, 100000) * 100,
      rnd(1550, 1620),
      txIds[i % txIds.length] ?? null,
      pastDate(rnd(0, 30))
    ]
  );
}

// ── chatSessions ─────────────────────────────────────────────────────────────
// Cols: id, userId, title, createdAt, updatedAt
console.log("chatSessions...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO "chatSessions" ("userId", title, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
    [
      userIds[i % userIds.length] ?? userId1,
      pick(['Transfer help','KYC question','Account issue','FX rate inquiry','General support']),
      pastDate(rnd(0, 30))
    ]
  );
}

// ── chatMessages ─────────────────────────────────────────────────────────────
// Cols: id, sessionId, role, content, createdAt
console.log("chatMessages...");
const csResult = await client.query('SELECT id FROM "chatSessions" LIMIT 5');
const csIds = csResult.rows.map(r => r.id);
for (let i = 0; i < 15; i++) {
  await q(`INSERT INTO "chatMessages" ("sessionId", role, content, "createdAt")
    VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [
      csIds[i % csIds.length] ?? null,
      i % 2 === 0 ? 'user' : 'assistant',
      pick([
        'Hello, I need help with my transfer.',
        'I can help you with that. Could you provide the transfer reference?',
        'My KYC is still pending after 3 days.',
        'I apologize for the delay. Let me check your KYC status.',
        'What is the current USD to NGN rate?',
        'The current rate is 1 USD = 1,580 NGN. Rates update every 15 minutes.',
        'Thank you for your help!',
        'You are welcome! Is there anything else I can help you with?'
      ]),
      pastDate(rnd(0, 7))
    ]
  );
}

// ── caseComments ─────────────────────────────────────────────────────────────
// Cols: id, caseId, authorId, authorName, content, isInternal, createdAt, parentId
console.log("caseComments...");
const ccResult = await client.query('SELECT id FROM "complianceCases" LIMIT 5');
const ccIds = ccResult.rows.map(r => r.id);
if (ccIds.length > 0) {
  for (let i = 0; i < 8; i++) {
    await q(`INSERT INTO "caseComments" ("caseId", "authorId", "authorName", content, "isInternal", "createdAt")
      VALUES ($1, $2, 'Compliance Officer', $3, $4, $5) ON CONFLICT DO NOTHING`,
      [
        ccIds[i % ccIds.length], userId1,
        pick(['Customer notified.','Awaiting additional documentation.','Case escalated to senior compliance.','Documents verified successfully.','No further action needed. Case closed.']),
        i % 3 === 0,
        pastDate(rnd(0, 10))
      ]
    );
  }
}

// ── impersonationTokens ───────────────────────────────────────────────────────
// Cols: id, adminId, targetUserId, token, expiresAt, usedAt, createdAt
console.log("impersonationTokens...");
await q(`INSERT INTO "impersonationTokens" ("adminId", "targetUserId", token, "expiresAt", "usedAt", "createdAt")
  VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
  [userId1, userId2, hex(32), pastDate(0), pastDate(1), pastDate(1)]
);
await q(`INSERT INTO "impersonationTokens" ("adminId", "targetUserId", token, "expiresAt", "createdAt")
  VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING`,
  [userId1, userId2, hex(32), futureDate(1)]
);

// ── document_vault ────────────────────────────────────────────────────────────
// Cols: id, user_id, name, description, category, status, file_url, file_key, mime_type, file_size, is_encrypted, expires_at, shared_with, tags, created_at, updated_at
console.log("document_vault...");
const docTypes = [
  ['Passport', 'Government-issued passport', 'identity'],
  ['Proof of Address', 'Utility bill - electricity', 'address'],
  ['Bank Statement', '3-month bank statement', 'financial'],
      ['Business Registration', 'Certificate of incorporation', 'compliance'],
];
for (let i = 0; i < userIds.length; i++) {
  const [name, desc, cat] = docTypes[i % docTypes.length];
  await q(`INSERT INTO document_vault (user_id, name, description, category, status, file_url, file_key, mime_type, file_size, is_encrypted, expires_at, shared_with, tags, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'active', $5, $6, 'application/pdf', $7, true, $8, '[]', '["kyc","verified"]', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [
      userIds[i],
      name, desc, cat,
      `https://storage.remitflow.com/vault/${userIds[i]}/${hex(8)}.pdf`,
      `vault/${userIds[i]}/${hex(8)}.pdf`,
      rnd(100000, 5000000),
      futureDate(365)
    ]
  );
}

await client.end();
console.log("✅ All camelCase tables seeded successfully");
