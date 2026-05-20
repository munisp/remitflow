/**
 * Fix seed for 36 remaining empty tables — uses exact snake_case column names
 * from the actual DB schema.
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
const userId3 = userIds[2] ?? userId1;

const txResult = await client.query('SELECT id FROM transactions LIMIT 5');
const txIds = txResult.rows.map(r => r.id);

// ── ab_assignments ──────────────────────────────────────────────────────────
console.log("ab_assignments (skip - already seeded)...");

// ── ab_events ───────────────────────────────────────────────────────────────
console.log("ab_events (skip - already seeded)...");

// ── api_changelogs ──────────────────────────────────────────────────────────
console.log("api_changelogs...");
// Check actual columns
const acCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='api_changelogs' ORDER BY ordinal_position");
console.log('  api_changelogs cols:', acCols.rows.map(r=>r.column_name));
await q(`INSERT INTO api_changelogs (version, title, summary, breaking_changes, new_features, bug_fixes, deprecations, published_at, created_at)
  VALUES
  ('v2.5.0', 'RemitFlow API v2.5.0', 'Partner webhook retry logic and bulk payment status endpoint', false, '["Partner webhook retry logic","Bulk payment status endpoint"]', '["FX rate caching fix"]', '[]', $1, NOW()),
  ('v2.4.0', 'RemitFlow API v2.4.0', 'CBDC wallet support and BNPL plans', true, '["CBDC wallet support","BNPL plans"]', '["KYC document upload size limit"]', '["Old /api/v1/send"]', $2, NOW()),
  ('v2.3.0', 'RemitFlow API v2.3.0', 'Split bill, rate lock, request money', false, '["Split bill feature","Rate lock","Request money"]', '["Beneficiary search performance"]', '[]', $3, NOW())
  ON CONFLICT DO NOTHING`,
  [pastDate(7), pastDate(30), pastDate(60)]
);

// ── api_key_rotation_log ────────────────────────────────────────────────────
console.log("api_key_rotation_log...");
const rotCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='api_key_rotation_log' ORDER BY ordinal_position");
console.log('  api_key_rotation_log cols:', rotCols.rows.map(r=>r.column_name));
const akResult = await client.query('SELECT id FROM api_keys LIMIT 3');
const akIds = akResult.rows.map(r => r.id);
if (akIds.length > 0) {
  await q(`INSERT INTO api_key_rotation_log (api_key_id, rotated_by, reason, old_key_prefix, new_key_prefix, rotated_at)
    VALUES ($1, $2, 'Scheduled 90-day rotation', 'rf_live_old_', 'rf_live_', NOW()) ON CONFLICT DO NOTHING`,
    [akIds[0], userId1]
  );
}

// ── bulk_user_action_log ────────────────────────────────────────────────────
console.log("bulk_user_action_log...");
await q(`INSERT INTO bulk_user_action_log (performed_by, action, target_user_ids, affected_count, status, notes, created_at)
  VALUES ($1, 'bulk_kyc_approve', ARRAY[$2,$3], 2, 'completed', 'Batch KYC verification complete', NOW()) ON CONFLICT DO NOTHING`,
  [userId1, userId2, userId3]
);

// ── case_comments ───────────────────────────────────────────────────────────
console.log("case_comments...");
const caseCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='case_comments' ORDER BY ordinal_position");
console.log('  case_comments cols:', caseCols.rows.map(r=>r.column_name));
const caseResult = await client.query('SELECT id FROM "complianceCases" LIMIT 3');
const caseIds = caseResult.rows.map(r => r.id);
if (caseIds.length > 0) {
  for (let i = 0; i < 6; i++) {
    await q(`INSERT INTO case_comments (case_id, author_id, content, is_internal, created_at)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [
        caseIds[i % caseIds.length], userId1,
        pick(['Customer notified.','Awaiting additional documentation.','Case escalated.','Documents verified.','No further action needed.']),
        i % 2 === 0, pastDate(rnd(1,10))
      ]
    );
  }
}

// ── chargeback_cases ────────────────────────────────────────────────────────
console.log("chargeback_cases...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO chargeback_cases (user_id, transaction_id, stripe_charge_id, amount, currency, reason, status, evidence_url, notes, due_date, created_at)
    VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, 'Under review', $8, $9) ON CONFLICT DO NOTHING`,
    [
      userIds[i % userIds.length] ?? userId1,
      txIds[i % txIds.length] ?? null,
      `ch_test_${hex(24)}`,
      rnd(5000, 100000),
      pick(['unauthorized_transaction','item_not_received','duplicate_charge']),
      pick(['open','under_review','resolved_in_favor_of_customer']),
      `https://storage.remitflow.com/evidence/chargeback-${i}.pdf`,
      futureDate(rnd(7, 30)),
      pastDate(rnd(5, 30))
    ]
  );
}

// ── chat_sessions ────────────────────────────────────────────────────────────
console.log("chat_sessions...");
const chatSessCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='chat_sessions' ORDER BY ordinal_position");
console.log('  chat_sessions cols:', chatSessCols.rows.map(r=>r.column_name));
// Will insert after seeing cols
const chatSessColNames = chatSessCols.rows.map(r=>r.column_name);
for (let i = 0; i < 5; i++) {
  if (chatSessColNames.includes('user_id')) {
    await q(`INSERT INTO chat_sessions (user_id, status, started_at, ended_at)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [
        userIds[i % userIds.length] ?? userId1,
        pick(['active','closed','waiting']),
        pastDate(rnd(1,7)),
        i < 3 ? pastDate(rnd(0,1)) : null
      ]
    );
  }
}

// ── chat_messages ────────────────────────────────────────────────────────────
console.log("chat_messages...");
const chatMsgCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='chat_messages' ORDER BY ordinal_position");
console.log('  chat_messages cols:', chatMsgCols.rows.map(r=>r.column_name));
const chatSessResult = await client.query('SELECT id FROM chat_sessions LIMIT 5');
const chatSessIds = chatSessResult.rows.map(r => r.id);
if (chatSessIds.length > 0 && chatMsgCols.rows.map(r=>r.column_name).includes('session_id')) {
  for (let i = 0; i < 15; i++) {
    await q(`INSERT INTO chat_messages (session_id, sender_id, sender_type, content, created_at)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [
        chatSessIds[i % chatSessIds.length],
        i % 2 === 0 ? userId1 : userIds[i % userIds.length] ?? userId1,
        i % 2 === 0 ? 'agent' : 'user',
        pick(['Hello, I need help.','My transfer is pending.','KYC issue.','Thank you!','Issue resolved.']),
        pastDate(rnd(0,7))
      ]
    );
  }
}

// ── chat_agent_status ────────────────────────────────────────────────────────
console.log("chat_agent_status...");
await q(`INSERT INTO chat_agent_status (agent_id, is_online, is_available, max_concurrent_chats, active_chat_count, last_seen_at, status_message, updated_at)
  VALUES ($1, true, true, 5, 2, NOW(), 'Available', NOW()) ON CONFLICT DO NOTHING`,
  [userId1]
);

// ── chat_canned_responses ─────────────────────────────────────────────────────
console.log("chat_canned_responses...");
await q(`INSERT INTO chat_canned_responses (title, shortcut, content, category, usage_count, created_by, is_active, created_at, updated_at)
  VALUES
  ('Transfer Pending', '/pending', 'Your transfer is being processed. This typically takes 1-3 business days.', 'transfers', 45, $1, true, NOW(), NOW()),
  ('KYC Required', '/kyc', 'To complete this transaction, please upload a valid government-issued ID.', 'kyc', 32, $2, true, NOW(), NOW()),
  ('Greeting', '/hi', 'Hello! Welcome to RemitFlow support. How can I help you today?', 'general', 156, $3, true, NOW(), NOW()),
  ('Transaction Limit', '/limit', 'Your current KYC tier has a daily limit of $1,000. Please complete enhanced KYC to increase it.', 'limits', 28, $4, true, NOW(), NOW())
  ON CONFLICT DO NOTHING`,
  [userId1, userId1, userId1, userId1]
);

// ── chat_session_meta ─────────────────────────────────────────────────────────
console.log("chat_session_meta...");
if (chatSessIds.length > 0) {
  for (let i = 0; i < Math.min(3, chatSessIds.length); i++) {
    await q(`INSERT INTO chat_session_meta (session_id, status, priority, channel, assigned_agent_id, wait_time_seconds, first_response_at, resolved_at, satisfaction_score, tags, updated_at)
      VALUES ($1, 'resolved', 'normal', 'web', $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT DO NOTHING`,
      [
        chatSessIds[i], userId1,
        rnd(30, 180),
        pastDate(rnd(0,7)),
        pastDate(rnd(0,5)),
        rnd(3,5),
        JSON.stringify(['transfer_issue','resolved'])
      ]
    );
  }
}

// ── cron_jobs ─────────────────────────────────────────────────────────────────
console.log("cron_jobs...");
const cronData = [
  ['fx_rate_refresh', 'Refresh FX rates from providers', '*/15 * * * *', 'fx'],
  ['kyc_expiry_check', 'Check for expiring KYC documents', '0 9 * * *', 'kyc'],
  ['scheduled_transfers', 'Process scheduled transfers', '* * * * *', 'transfers'],
  ['compliance_report_gen', 'Generate monthly compliance reports', '0 0 1 * *', 'compliance'],
  ['wallet_reconciliation', 'Reconcile wallet balances', '0 2 * * *', 'finance'],
  ['push_notification_batch', 'Send batched push notifications', '*/5 * * * *', 'notifications'],
];
for (let i = 0; i < cronData.length; i++) {
  const [name, desc, schedule, cat] = cronData[i];
  await q(`INSERT INTO cron_jobs (name, description, schedule, status, last_run_at, last_run_status, last_run_duration_ms, next_run_at, run_count, error_count, category, metadata, created_at, updated_at)
    VALUES ($1, $2, $3, 'active', $4, 'success', $5, $6, $7, 0, $8, '{}', NOW(), NOW()) ON CONFLICT (name) DO NOTHING`,
    [name, desc, schedule, pastDate(0), rnd(50, 5000), futureDate(0), rnd(100, 10000), cat]
  );
}

// ── doc_reminder_prefs ────────────────────────────────────────────────────────
console.log("doc_reminder_prefs...");
for (const uid of userIds) {
  await q(`INSERT INTO doc_reminder_prefs (user_id, remind_30d, remind_14d, remind_7d, remind_3d, remind_1d, notify_email, notify_in_app, notify_push, created_at, updated_at)
    VALUES ($1, true, true, true, true, false, true, true, false, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING`,
    [uid]
  );
}

// ── doc_reminder_log ──────────────────────────────────────────────────────────
console.log("doc_reminder_log...");
const docResult = await client.query('SELECT id FROM kyc_documents LIMIT 5');
const docIds = docResult.rows.map(r => r.id);
for (const uid of userIds) {
  await q(`INSERT INTO doc_reminder_log (user_id, document_id, reminder_type, channel, status, sent_at)
    VALUES ($1, $2, '30d', 'email', 'sent', $3) ON CONFLICT DO NOTHING`,
    [uid, docIds[0] ?? null, pastDate(7)]
  );
}

// ── document_renewals ─────────────────────────────────────────────────────────
console.log("document_renewals...");
if (docIds.length > 0) {
  for (let i = 0; i < Math.min(5, docIds.length); i++) {
    await q(`INSERT INTO document_renewals (original_doc_id, user_id, status, initiated_at, notes)
      VALUES ($1, $2, 'pending', $3, 'Renewal initiated by user') ON CONFLICT DO NOTHING`,
      [docIds[i], userIds[i % userIds.length] ?? userId1, pastDate(rnd(1,30))]
    );
  }
}

// ── document_vault_table ──────────────────────────────────────────────────────
console.log("document_vault_table...");
const dvCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='document_vault_table' ORDER BY ordinal_position");
console.log('  document_vault_table cols:', dvCols.rows.map(r=>r.column_name));

// ── fx_alert_trigger_history ──────────────────────────────────────────────────
console.log("fx_alert_trigger_history...");
const fxAlertResult = await client.query('SELECT id, user_id FROM exchange_rate_alerts LIMIT 10');
for (const alert of fxAlertResult.rows) {
  await q(`INSERT INTO fx_alert_trigger_history (alert_id, user_id, from_currency, to_currency, target_rate, triggered_rate, direction, notification_sent, triggered_at)
    VALUES ($1, $2, 'USD', 'NGN', 1580, $3, 'above', true, $4) ON CONFLICT DO NOTHING`,
    [alert.id, alert.user_id, rnd(1550, 1620), pastDate(rnd(0,30))]
  );
}

// ── impersonation_tokens ──────────────────────────────────────────────────────
console.log("impersonation_tokens...");
const impCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='impersonation_tokens' ORDER BY ordinal_position");
console.log('  impersonation_tokens cols:', impCols.rows.map(r=>r.column_name));
const impColNames = impCols.rows.map(r=>r.column_name);
if (impColNames.includes('token')) {
  await q(`INSERT INTO impersonation_tokens (token, admin_id, target_user_id, expires_at, used, created_at)
    VALUES ($1, $2, $3, $4, true, $5) ON CONFLICT DO NOTHING`,
    [hex(32), userId1, userId2, pastDate(0), pastDate(1)]
  );
  await q(`INSERT INTO impersonation_tokens (token, admin_id, target_user_id, expires_at, used, created_at)
    VALUES ($1, $2, $3, $4, false, $5) ON CONFLICT DO NOTHING`,
    [hex(32), userId1, userId3, futureDate(1), pastDate(0)]
  );
}

// ── kafka_consumer_metrics ────────────────────────────────────────────────────
console.log("kafka_consumer_metrics...");
const kafkaTopics = ['transactions.created','kyc.events','fraud.alerts','notifications.send','fx.rates.updated'];
for (let i = 0; i < kafkaTopics.length; i++) {
  await q(`INSERT INTO kafka_consumer_metrics (topic, group_id, partition, current_offset, log_end_offset, lag, messages_consumed, messages_per_second, last_consumed_at, status, recorded_at)
    VALUES ($1, $2, 0, $3, $4, $5, $6, $7, NOW(), 'running', NOW()) ON CONFLICT DO NOTHING`,
    [
      kafkaTopics[i],
      `remitflow-${kafkaTopics[i].split('.')[0]}-consumer`,
      rnd(1000, 50000), rnd(1000, 50005), rnd(0, 5),
      rnd(1000, 50000), rnd(10, 500)
    ]
  );
}

// ── kyc_lifecycle ─────────────────────────────────────────────────────────────
console.log("kyc_lifecycle...");
for (const uid of userIds) {
  await q(`INSERT INTO kyc_lifecycle (user_id, stage, tier, submitted_at, reviewed_at, approved_at, expires_at, risk_score, reviewed_by, created_at, updated_at)
    VALUES ($1, 'approved', 'tier2', $2, $3, $4, $5, $6, $7, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING`,
    [uid, pastDate(rnd(30,90)), pastDate(rnd(1,30)), pastDate(rnd(1,30)), futureDate(365), rnd(10,40), userId1]
  );
}

// ── kyc_lifecycle_history ─────────────────────────────────────────────────────
console.log("kyc_lifecycle_history...");
const kycLcResult = await client.query('SELECT id, user_id FROM kyc_lifecycle LIMIT 10');
for (const row of kycLcResult.rows) {
  await q(`INSERT INTO kyc_lifecycle_history (lifecycle_id, user_id, from_stage, to_stage, changed_by, reason, metadata, created_at)
    VALUES ($1, $2, 'pending', 'approved', $3, 'Documents verified', '{}', $4) ON CONFLICT DO NOTHING`,
    [row.id, row.user_id, userId1, pastDate(rnd(1,30))]
  );
}

// ── partner_digital_agreements ────────────────────────────────────────────────
console.log("partner_digital_agreements...");
const paResult = await client.query('SELECT id FROM partner_applications LIMIT 3');
const paIds = paResult.rows.map(r => r.id);
const agreeResult = await client.query('SELECT id FROM partner_agreements LIMIT 3');
const agreeIds = agreeResult.rows.map(r => r.id);
const tmplResult = await client.query('SELECT id FROM agreement_templates LIMIT 1');
const tmplIds = tmplResult.rows.map(r => r.id);
if (agreeIds.length > 0) {
  await q(`INSERT INTO partner_digital_agreements (agreement_id, template_id, tenant_id, status, agreement_text, sent_at, digitally_signed_at, fully_executed_at, partner_name, partner_email, partner_title, partner_company, partner_ip_address, partner_user_agent, platform_signed_by, platform_signed_at, audit_trail, metadata, created_at, updated_at)
    VALUES ($1, $2, $3, 'fully_executed', 'This Partner Agreement governs the relationship between RemitFlow and the Partner.', $4, $5, $6, 'John Smith', 'john@partner.com', 'CEO', 'Partner Corp Ltd', '192.168.1.1', 'Mozilla/5.0', $7, $8, '[]', '{}', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [
      agreeIds[0], tmplIds[0] ?? null, null,
      pastDate(30), pastDate(28), pastDate(25),
      userId1, pastDate(25)
    ]
  );
}

// ── revenue_share_tiers ───────────────────────────────────────────────────────
console.log("revenue_share_tiers...");
const rsaResult = await client.query('SELECT id FROM revenue_share_agreements LIMIT 3');
const rsaIds = rsaResult.rows.map(r => r.id);
if (rsaIds.length > 0) {
  const tierData = [
    ['Bronze', 0, 100000000, 15.0, null, 1],
    ['Silver', 100000001, 500000000, 20.0, null, 2],
    ['Gold', 500000001, 1000000000, 25.0, 2.0, 3],
    ['Platinum', 1000000001, null, 30.0, 5.0, 4],
  ];
  for (const [name, min, max, rate, bonus, order] of tierData) {
    await q(`INSERT INTO revenue_share_tiers (agreement_id, tier_name, min_monthly_volume, max_monthly_volume, rate, bonus_rate, sort_order, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT DO NOTHING`,
      [rsaIds[0], name, min, max, rate, bonus, order]
    );
  }
}

// ── revenue_share_ledger ──────────────────────────────────────────────────────
console.log("revenue_share_ledger...");
if (rsaIds.length > 0) {
  for (let i = 0; i < 10; i++) {
    await q(`INSERT INTO revenue_share_ledger (agreement_id, type, transaction_id, gross_fee_revenue, applied_rate, partner_share, platform_share, currency, period_month, period_year, description, metadata, created_at)
      VALUES ($1, 'fee_share', $2, $3, 0.20, $4, $5, 'USD', 3, 2026, 'Monthly fee share', '{}', $6) ON CONFLICT DO NOTHING`,
      [
        rsaIds[i % rsaIds.length],
        txIds[i % txIds.length] ?? null,
        rnd(1000, 10000) * 100,
        rnd(200, 2000) * 100,
        rnd(800, 8000) * 100,
        pastDate(rnd(0,30))
      ]
    );
  }
}

// ── revenue_share_reports ─────────────────────────────────────────────────────
console.log("revenue_share_reports...");
const rsTierResult = await client.query('SELECT id FROM revenue_share_tiers LIMIT 1');
const rsTierIds = rsTierResult.rows.map(r => r.id);
if (rsaIds.length > 0) {
  await q(`INSERT INTO revenue_share_reports (agreement_id, period_month, period_year, total_transactions, total_volume, total_fee_revenue, partner_earnings, platform_earnings, applied_tier_id, applied_rate, status, generated_at)
    VALUES ($1, 3, 2026, $2, $3, $4, $5, $6, $7, 0.20, 'final', $8) ON CONFLICT DO NOTHING`,
    [rsaIds[0], rnd(500,2000), rnd(50000000,200000000)*100, rnd(750000,3000000)*100, rnd(150000,600000)*100, rnd(600000,2400000)*100, rsTierIds[0] ?? null, pastDate(5)]
  );
}

// ── scheduled_transfer_runs ───────────────────────────────────────────────────
console.log("scheduled_transfer_runs...");
const stResult = await client.query('SELECT id FROM scheduled_transfers LIMIT 5');
const stIds = stResult.rows.map(r => r.id);
const strCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='scheduled_transfer_runs' ORDER BY ordinal_position");
console.log('  scheduled_transfer_runs cols:', strCols.rows.map(r=>r.column_name));
if (stIds.length > 0) {
  const colNames = strCols.rows.map(r=>r.column_name);
  for (let i = 0; i < 10; i++) {
    if (colNames.includes('scheduled_transfer_id')) {
      await q(`INSERT INTO scheduled_transfer_runs (scheduled_transfer_id, status, transaction_id, run_at, error_message, created_at)
        VALUES ($1, $2, $3, $4, $5, $4) ON CONFLICT DO NOTHING`,
        [stIds[i % stIds.length], pick(['completed','completed','failed','skipped']), txIds[i % txIds.length] ?? null, pastDate(rnd(0,30)), i % 4 === 0 ? 'Insufficient balance' : null]
      );
    }
  }
}

// ── security_incidents ────────────────────────────────────────────────────────
console.log("security_incidents...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO security_incidents (type, severity, source_ip, user_id, endpoint, payload, blocked, response_code, details, created_at)
    VALUES ($1, $2, $3, $4, $5, '{}', $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [
      pick(['brute_force','sql_injection','xss_attempt','rate_limit_exceeded','suspicious_login']),
      pick(['low','medium','high','critical']),
      `${rnd(1,255)}.${rnd(1,255)}.${rnd(1,255)}.${rnd(1,255)}`,
      userIds[i % userIds.length] ?? userId1,
      pick(['/api/trpc/auth.login','/api/trpc/transfer.send','/api/trpc/kyc.submit']),
      i % 2 === 0,
      pick([200, 400, 429, 403]),
      'Automated security system detected and logged the incident.',
      pastDate(rnd(0,30))
    ]
  );
}

// ── sla_incidents ─────────────────────────────────────────────────────────────
console.log("sla_incidents...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO sla_incidents (title, severity, status, affected_service, root_cause, resolution, reported_by, started_at, resolved_at, "createdAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8) ON CONFLICT DO NOTHING`,
    [
      pick(['API Gateway Latency Spike','FX Engine Timeout','KYC Service Degraded','Transfer Processing Delay','Notification Queue Backlog']),
      pick(['p1','p2','p3','p4']),
      pick(['resolved','resolved','open','investigating']),
      pick(['api-gateway','fx-engine','transfer-service','kyc-service','notification-service']),
      pick(['Database connection pool exhausted','Memory pressure on worker nodes','Third-party API timeout','Network congestion']),
      pick(['Restarted affected services','Scaled up worker pool','Implemented circuit breaker','Increased connection pool size']),
      userId1,
      pastDate(rnd(1,30)),
      i < 3 ? pastDate(rnd(0,5)) : null
    ]
  );
}

// ── split_bill_groups ─────────────────────────────────────────────────────────
console.log("split_bill_groups...");
await q(`INSERT INTO split_bill_groups (group_id, creator_id, title, total_amount, currency, note, status, expires_at, created_at, updated_at)
  VALUES
  ($1, $2, 'Team Lunch April', 45000, 'NGN', 'Monthly team lunch', 'active', $3, NOW(), NOW()),
  ($4, $5, 'Lagos Trip Expenses', 250000, 'NGN', 'Team offsite expenses', 'settled', $6, $7, $7),
  ($8, $9, 'Office Party', 120000, 'NGN', 'End of quarter party', 'active', $10, NOW(), NOW())
  ON CONFLICT DO NOTHING`,
  [
    hex(12), userId1, futureDate(7),
    hex(12), userId2, pastDate(0), pastDate(7),
    hex(12), userId3, futureDate(14)
  ]
);

// ── split_bill_participants ───────────────────────────────────────────────────
console.log("split_bill_participants...");
const sbgResult = await client.query('SELECT id FROM split_bill_groups LIMIT 3');
const sbgIds = sbgResult.rows.map(r => r.id);
for (let i = 0; i < 9; i++) {
  await q(`INSERT INTO split_bill_participants (group_id, name, email, share_amount, token, status, paid_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT DO NOTHING`,
    [
      sbgIds[Math.floor(i/3)] ?? sbgIds[0],
      `Participant ${i+1}`,
      `participant${i+1}@example.com`,
      rnd(10000, 50000) * 100,
      hex(32),
      pick(['paid','paid','pending']),
      i % 3 !== 2 ? pastDate(rnd(0,5)) : null
    ]
  );
}

// ── system_config_audit_log ───────────────────────────────────────────────────
console.log("system_config_audit_log...");
const scResult = await client.query('SELECT key FROM system_config LIMIT 8');
for (const row of scResult.rows) {
  await q(`INSERT INTO system_config_audit_log (config_key, old_value, new_value, changed_by, change_reason, reload_triggered, created_at)
    VALUES ($1, NULL, 'initial', $2, 'Initial configuration', false, NOW()) ON CONFLICT DO NOTHING`,
    [row.key, userId1]
  );
}

// ── transaction_exports ───────────────────────────────────────────────────────
console.log("transaction_exports...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO transaction_exports (user_id, format, status, filters, record_count, file_url, file_size, expires_at, requested_at, completed_at)
    VALUES ($1, $2, $3, '{"dateFrom":"2026-01-01","dateTo":"2026-03-31"}', $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [
      userIds[i % userIds.length] ?? userId1,
      pick(['csv','xlsx','pdf']),
      pick(['completed','completed','processing','failed']),
      rnd(10, 500),
      i < 3 ? `https://storage.remitflow.com/exports/export-${i}.csv` : null,
      i < 3 ? rnd(10000, 500000) : null,
      futureDate(7),
      pastDate(rnd(0,7)),
      i < 3 ? pastDate(rnd(0,5)) : null
    ]
  );
}

// ── velocity_rules ────────────────────────────────────────────────────────────
console.log("velocity_rules...");
const vruleData = [
  ['Daily Transfer Limit Tier1', 'Tier 1 users daily transfer limit', 86400, 10, 100000, 'USD', 'block', 'tier1'],
  ['Hourly Transaction Count', 'Maximum transactions per hour', 3600, 5, null, null, 'flag', 'all'],
  ['Single Transaction Limit', 'Maximum single transaction amount', null, 1, 50000, 'USD', 'block', 'all'],
  ['Monthly Volume Tier2', 'Tier 2 monthly volume limit', 2592000, 50, 500000, 'USD', 'block', 'tier2'],
];
for (const [name, desc, window, maxCount, maxAmt, currency, action, appliesTo] of vruleData) {
  await q(`INSERT INTO velocity_rules (name, description, window, max_count, max_amount, currency, action, is_active, applies_to, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, NOW(), NOW()) ON CONFLICT (name) DO NOTHING`,
    [name, desc, window, maxCount, maxAmt, currency, action, appliesTo, userId1]
  );
}

// ── velocity_overrides (re-seed with correct schema) ─────────────────────────
console.log("velocity_overrides (re-seed)...");
const vrResult2 = await client.query('SELECT id FROM velocity_rules LIMIT 1');
const vrId = vrResult2.rows[0]?.id;
if (vrId) {
  for (const uid of userIds) {
    await q(`INSERT INTO velocity_overrides (rule_id, user_id, reason, expires_at, granted_by, created_at)
      VALUES ($1, $2, 'VIP customer - increased limit approved', $3, $4, NOW()) ON CONFLICT DO NOTHING`,
      [vrId, uid, futureDate(90), userId1]
    );
  }
}

// ── webhook_retry_queue ───────────────────────────────────────────────────────
console.log("webhook_retry_queue...");
const wdResult = await client.query('SELECT id FROM webhook_deliveries LIMIT 5');
const wdIds = wdResult.rows.map(r => r.id);
const weResult2 = await client.query('SELECT id FROM webhook_endpoints LIMIT 3');
const weIds2 = weResult2.rows.map(r => r.id);
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO webhook_retry_queue (delivery_id, endpoint_id, payload, attempt_number, max_attempts, next_attempt_at, last_attempt_at, last_error, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 5, $5, $6, $7, 'pending', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [
      wdIds[i % wdIds.length] ?? null,
      weIds2[i % weIds2.length] ?? null,
      '{"event":"transfer.completed","data":{"id":1}}',
      rnd(1,3),
      futureDate(0),
      pastDate(rnd(0,2)),
      i % 2 === 0 ? 'Connection timeout' : 'HTTP 500'
    ]
  );
}

// ── document_vault_table ──────────────────────────────────────────────────────
// Re-check actual cols and seed
console.log("document_vault_table (re-seed)...");
const dvCols2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='document_vault_table' ORDER BY ordinal_position");
const dvColNames = dvCols2.rows.map(r=>r.column_name);
console.log('  document_vault_table cols:', dvColNames);
if (dvColNames.length > 0) {
  for (const uid of userIds) {
    // Build dynamic insert based on available columns
    const colsToInsert = dvColNames.filter(c => c !== 'id');
    const vals = colsToInsert.map(c => {
      if (c === 'user_id') return uid;
      if (c === 'document_type' || c === 'doc_type') return 'passport';
      if (c === 'file_name' || c === 'filename') return `passport_${uid}.pdf`;
      if (c === 'file_url' || c === 'url') return `https://storage.remitflow.com/kyc/${uid}/passport.pdf`;
      if (c === 'file_size' || c === 'size') return 1024000;
      if (c === 'mime_type' || c === 'content_type') return 'application/pdf';
      if (c === 'status') return 'verified';
      if (c === 'uploaded_at' || c === 'created_at' || c.includes('_at')) return new Date().toISOString();
      if (c === 'expires_at') return new Date(Date.now() + 365*86400000).toISOString();
      if (c === 'is_verified') return true;
      return null;
    });
    const placeholders = vals.map((_,i) => `$${i+1}`).join(', ');
    await q(`INSERT INTO document_vault_table (${colsToInsert.map(c=>`"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
  }
}

await client.end();
console.log("✅ Remaining 36 tables seeded successfully");
