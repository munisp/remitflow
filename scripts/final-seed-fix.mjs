/**
 * Final seed fix — only the tables still empty after all previous passes.
 * All column names verified against actual DB schema.
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

// ── chargeback_cases ─────────────────────────────────────────────────────────
// Cols: id, user_id, transaction_id, stripe_charge_id, amount, currency, reason, status, evidence_url, notes, due_date, resolved_at, createdAt
console.log("chargeback_cases...");
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO chargeback_cases (user_id, transaction_id, stripe_charge_id, amount, currency, reason, status, due_date, "createdAt")
    VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, NOW()) ON CONFLICT DO NOTHING`,
    [
      userIds[i % userIds.length] ?? userId1,
      txIds[i % txIds.length] ?? null,
      `ch_test_${hex(24)}`,
      rnd(5000, 100000),
      pick(['unauthorized_transaction','item_not_received','duplicate_charge']),
      pick(['open','under_review','resolved_in_favor_of_customer']),
      futureDate(rnd(7, 30))
    ]
  );
}

// ── chat_agent_status ─────────────────────────────────────────────────────────
// Cols: id, agent_id, is_online, is_available, max_concurrent_chats, active_chat_count, last_seen_at, status_message, updated_at
console.log("chat_agent_status...");
await q(`INSERT INTO chat_agent_status (agent_id, is_online, is_available, max_concurrent_chats, active_chat_count, last_seen_at, status_message, updated_at)
  VALUES ($1, true, true, 5, 2, NOW(), 'Available', NOW()) ON CONFLICT DO NOTHING`,
  [userId1]
);
await q(`INSERT INTO chat_agent_status (agent_id, is_online, is_available, max_concurrent_chats, active_chat_count, last_seen_at, status_message, updated_at)
  VALUES ($1, true, false, 5, 5, NOW(), 'At capacity', NOW()) ON CONFLICT DO NOTHING`,
  [userId2]
);

// ── chat_canned_responses ─────────────────────────────────────────────────────
// Cols: id, title, shortcut, content, category, usage_count, created_by, is_active, created_at, updated_at
console.log("chat_canned_responses...");
await q(`INSERT INTO chat_canned_responses (title, shortcut, content, category, usage_count, created_by, is_active, created_at, updated_at)
  VALUES
  ('Transfer Pending', '/pending', 'Your transfer is being processed. This typically takes 1-3 business days.', 'transfers', 45, $1, true, NOW(), NOW()),
  ('KYC Required', '/kyc', 'To complete this transaction, please upload a valid government-issued ID.', 'kyc', 32, $2, true, NOW(), NOW()),
  ('Greeting', '/hi', 'Hello! Welcome to RemitFlow support. How can I help you today?', 'general', 156, $3, true, NOW(), NOW()),
  ('Transaction Limit', '/limit', 'Your current KYC tier has a daily limit of $1,000. Please complete enhanced KYC to increase it.', 'limits', 28, $4, true, NOW(), NOW()),
  ('Closing', '/bye', 'Thank you for contacting RemitFlow support. Have a great day!', 'general', 89, $5, true, NOW(), NOW())
  ON CONFLICT DO NOTHING`,
  [userId1, userId1, userId1, userId1, userId1]
);

// ── chat_session_meta ─────────────────────────────────────────────────────────
// Cols: id, session_id, status, priority, channel, assigned_agent_id, queue_position, wait_time_seconds, first_response_at, resolved_at, satisfaction_score, satisfaction_comment, tags, internal_notes, escalated_at, escalated_reason, updated_at
console.log("chat_session_meta...");
const csResult = await client.query('SELECT id FROM "chatSessions" LIMIT 5');
const csIds = csResult.rows.map(r => r.id);
for (let i = 0; i < Math.min(3, csIds.length); i++) {
  await q(`INSERT INTO chat_session_meta (session_id, status, priority, channel, assigned_agent_id, wait_time_seconds, first_response_at, resolved_at, satisfaction_score, tags, updated_at)
    VALUES ($1, 'resolved', 'normal', 'web', $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT DO NOTHING`,
    [
      csIds[i], userId1,
      rnd(30, 180),
      pastDate(rnd(0,7)),
      pastDate(rnd(0,5)),
      rnd(3,5),
      JSON.stringify(['transfer_issue','resolved'])
    ]
  );
}

// ── cron_jobs ─────────────────────────────────────────────────────────────────
// Cols: id, name, description, schedule, status, last_run_at, last_run_status, last_run_duration_ms, last_run_error, next_run_at, run_count, error_count, category, metadata, created_at, updated_at
console.log("cron_jobs...");
const cronData = [
  ['fx_rate_refresh', 'Refresh FX rates from providers', '*/15 * * * *', 'fx'],
  ['kyc_expiry_check', 'Check for expiring KYC documents', '0 9 * * *', 'kyc'],
  ['scheduled_transfers', 'Process scheduled transfers', '* * * * *', 'transfers'],
  ['compliance_report_gen', 'Generate monthly compliance reports', '0 0 1 * *', 'compliance'],
  ['wallet_reconciliation', 'Reconcile wallet balances', '0 2 * * *', 'finance'],
  ['push_notification_batch', 'Send batched push notifications', '*/5 * * * *', 'notifications'],
];
for (const [name, desc, schedule, cat] of cronData) {
  await q(`INSERT INTO cron_jobs (id, name, description, schedule, status, last_run_at, last_run_status, last_run_duration_ms, next_run_at, run_count, error_count, category, metadata, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'active', $5, 'success', $6, $7, 0, 0, $8, '{}', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [hex(8), name, desc, schedule, pastDate(0), rnd(50, 5000), futureDate(0), cat]
  );
}

// ── doc_reminder_prefs ────────────────────────────────────────────────────────
// Cols: id, user_id, remind_30d, remind_14d, remind_7d, remind_3d, remind_1d, notify_email, notify_in_app, notify_push, created_at, updated_at
console.log("doc_reminder_prefs...");
for (const uid of userIds) {
  await q(`INSERT INTO doc_reminder_prefs (user_id, remind_30d, remind_14d, remind_7d, remind_3d, remind_1d, notify_email, notify_in_app, notify_push, created_at, updated_at)
    VALUES ($1, true, true, true, true, false, true, true, false, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING`,
    [uid]
  );
}

// ── doc_reminder_log ──────────────────────────────────────────────────────────
// Cols: id, user_id, document_id, reminder_type, channel, status, sent_at
console.log("doc_reminder_log...");
const dvResult = await client.query('SELECT id FROM document_vault LIMIT 5');
const dvIds = dvResult.rows.map(r => r.id);
for (const uid of userIds) {
  await q(`INSERT INTO doc_reminder_log (user_id, document_id, reminder_type, channel, status, sent_at)
    VALUES ($1, $2, '30d', 'email', 'sent', $3) ON CONFLICT DO NOTHING`,
    [uid, dvIds[0] ?? null, pastDate(7)]
  );
}

// ── document_renewals ─────────────────────────────────────────────────────────
// Cols: id, original_doc_id, new_doc_id, user_id, status, initiated_at, completed_at, notes
console.log("document_renewals...");
for (let i = 0; i < Math.min(5, dvIds.length); i++) {
  await q(`INSERT INTO document_renewals (original_doc_id, user_id, status, initiated_at, notes)
    VALUES ($1, $2, 'pending', $3, 'Renewal initiated by user') ON CONFLICT DO NOTHING`,
    [dvIds[i], userIds[i % userIds.length] ?? userId1, pastDate(rnd(1,30))]
  );
}

// ── fx_alert_trigger_history ──────────────────────────────────────────────────
// Cols: id, alert_id, user_id, from_currency, to_currency, target_rate, triggered_rate, direction, notification_sent, triggered_at
console.log("fx_alert_trigger_history...");
const fxAlertResult = await client.query('SELECT id, user_id FROM exchange_rate_alerts LIMIT 10');
for (const alert of fxAlertResult.rows) {
  await q(`INSERT INTO fx_alert_trigger_history (alert_id, user_id, from_currency, to_currency, target_rate, triggered_rate, direction, notification_sent, triggered_at)
    VALUES ($1, $2, 'USD', 'NGN', 1580, $3, 'above', true, $4) ON CONFLICT DO NOTHING`,
    [alert.id, alert.user_id, rnd(1550, 1620), pastDate(rnd(0,30))]
  );
}

// ── kafka_consumer_metrics ────────────────────────────────────────────────────
// Cols: id, topic, group_id, partition, current_offset, log_end_offset, lag, messages_consumed, messages_per_second, last_consumed_at, status, error_message, recorded_at
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
// Cols: id, user_id, stage, tier, submitted_at, review_started_at, reviewed_at, approved_at, rejected_at, expires_at, rejection_reason, additional_info_required, reviewed_by, risk_score, notes, created_at, updated_at
console.log("kyc_lifecycle...");
for (const uid of userIds) {
  await q(`INSERT INTO kyc_lifecycle (user_id, stage, tier, submitted_at, reviewed_at, approved_at, expires_at, risk_score, reviewed_by, created_at, updated_at)
    VALUES ($1, 'approved', 2, $2, $3, $4, $5, $6, $7, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [uid, pastDate(rnd(30,90)), pastDate(rnd(1,30)), pastDate(rnd(1,30)), futureDate(365), rnd(10,40), userId1]
  );
}

// ── kyc_lifecycle_history ─────────────────────────────────────────────────────
// Cols: id, lifecycle_id, user_id, from_stage, to_stage, changed_by, reason, metadata, created_at
console.log("kyc_lifecycle_history...");
const kycLcResult = await client.query('SELECT id, user_id FROM kyc_lifecycle LIMIT 10');
for (const row of kycLcResult.rows) {
  await q(`INSERT INTO kyc_lifecycle_history (lifecycle_id, user_id, from_stage, to_stage, changed_by, reason, metadata, created_at)
    VALUES ($1, $2, 'not_started', 'approved', $3, 'Documents verified', '{}', $4) ON CONFLICT DO NOTHING`,
    [row.id, row.user_id, userId1, pastDate(rnd(1,30))]
  );
}

// ── partner_digital_agreements ────────────────────────────────────────────────
// Cols: id, agreement_id, template_id, tenant_id, status, agreement_text, sent_at, viewed_at, digitally_signed_at, physically_signed_at, fully_executed_at, expires_at, partner_name, partner_email, partner_title, partner_company, partner_ip_address, partner_user_agent, platform_signed_by, platform_signed_at, signed_document_url, signed_document_key, physical_document_url, physical_document_key, audit_trail, metadata, created_at, updated_at
console.log("partner_digital_agreements...");
const agreeResult = await client.query('SELECT id FROM partner_applications LIMIT 3');
const agreeIds = agreeResult.rows.map(r => r.id);
if (agreeIds.length > 0) {
  await q(`INSERT INTO partner_digital_agreements (agreement_id, tenant_id, status, agreement_text, sent_at, digitally_signed_at, fully_executed_at, partner_name, partner_email, partner_title, partner_company, partner_ip_address, partner_user_agent, platform_signed_by, platform_signed_at, audit_trail, metadata, created_at, updated_at)
    VALUES ($1, 1, 'fully_executed', 'This Partner Agreement governs the relationship between RemitFlow and the Partner.', $2, $3, $4, 'John Smith', 'john@partner.com', 'CEO', 'Partner Corp Ltd', '192.168.1.1', 'Mozilla/5.0', $5, $6, '[]', '{}', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [agreeIds[0], pastDate(30), pastDate(28), pastDate(25), userId1, pastDate(25)]
  );
}

// ── revenue_share_tiers ───────────────────────────────────────────────────────
// Cols: id, agreement_id, tier_name, min_monthly_volume, max_monthly_volume, rate, bonus_rate, sort_order, created_at
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
// Cols: id, agreement_id, tenant_id, type, transaction_id, gross_fee_revenue, applied_rate, partner_share, platform_share, currency, period_month, period_year, payout_id, description, metadata, created_at
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
// Cols: id, tenant_id, agreement_id, period_month, period_year, total_transactions, total_volume, total_fee_revenue, partner_earnings, platform_earnings, applied_tier_id, applied_rate, payout_id, status, generated_at, paid_at
console.log("revenue_share_reports...");
const rsTierResult = await client.query('SELECT id FROM revenue_share_tiers LIMIT 1');
const rsTierIds = rsTierResult.rows.map(r => r.id);
if (rsaIds.length > 0) {
  await q(`INSERT INTO revenue_share_reports (agreement_id, period_month, period_year, total_transactions, total_volume, total_fee_revenue, partner_earnings, platform_earnings, applied_tier_id, applied_rate, status, generated_at)
    VALUES ($1, 3, 2026, $2, $3, $4, $5, $6, $7, 0.20, 'final', $8) ON CONFLICT DO NOTHING`,
    [rsaIds[0], rnd(500,2000), rnd(50000000,200000000)*100, rnd(750000,3000000)*100, rnd(150000,600000)*100, rnd(600000,2400000)*100, rsTierIds[0] ?? null, pastDate(5)]
  );
}

// ── security_incidents ────────────────────────────────────────────────────────
// Cols: id, type, severity, source_ip, user_id, endpoint, payload, blocked, response_code, details, resolved_at, created_at
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
// Cols: id, title, severity, status, affected_service, root_cause, resolution, reported_by, started_at, resolved_at, createdAt
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
// Cols: id, group_id, creator_id, title, total_amount, currency, note, status, expires_at, created_at, updated_at
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
    hex(12), userId1, futureDate(14)
  ]
);

// ── split_bill_participants ───────────────────────────────────────────────────
// Cols: id, group_id, name, email, share_amount, token, status, paid_at, created_at
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
      rnd(10000, 50000),
      hex(32),
      pick(['paid','paid','pending']),
      i % 3 !== 2 ? pastDate(rnd(0,5)) : null
    ]
  );
}

// ── system_config_audit_log ───────────────────────────────────────────────────
// Cols: id, config_key, old_value, new_value, changed_by, change_reason, reload_triggered, created_at
console.log("system_config_audit_log...");
const scResult = await client.query('SELECT key FROM system_config LIMIT 8');
for (const row of scResult.rows) {
  await q(`INSERT INTO system_config_audit_log (config_key, old_value, new_value, changed_by, change_reason, reload_triggered, created_at)
    VALUES ($1, NULL, 'initial', $2, 'Initial configuration', false, NOW()) ON CONFLICT DO NOTHING`,
    [row.key, userId1]
  );
}

// ── transaction_exports ───────────────────────────────────────────────────────
// Cols: id, user_id, format, status, filters, record_count, file_url, file_size, expires_at, error_message, requested_at, completed_at
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
// Cols: id, name, description, window, max_count, max_amount, currency, action, is_active, applies_to, created_by, created_at, updated_at
console.log("velocity_rules...");
const vruleData = [
  ['Daily Transfer Limit Tier1', 'Tier 1 users daily transfer limit', '24h', 10, 100000, 'USD', 'block', 'tier1'],
  ['Hourly Transaction Count', 'Maximum transactions per hour', '1h', 5, null, null, 'flag', 'all'],
  ['Single Transaction Limit', 'Maximum single transaction amount', '24h', 1, 50000, 'USD', 'block', 'all'],
  ['Monthly Volume Tier2', 'Tier 2 monthly volume limit', '30d', 50, 500000, 'USD', 'block', 'tier2'],
];
for (const [name, desc, win, maxCount, maxAmt, currency, action, appliesTo] of vruleData) {
  await q(`INSERT INTO velocity_rules (name, description, "window", max_count, max_amount, currency, action, is_active, applies_to, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [name, desc, win, maxCount, maxAmt, currency, action, appliesTo, userId1]
  );
}

// ── velocity_overrides ────────────────────────────────────────────────────────
// Cols: id, rule_id, user_id, reason, expires_at, granted_by, created_at
console.log("velocity_overrides...");
const vrResult = await client.query('SELECT id FROM velocity_rules LIMIT 1');
const vrId = vrResult.rows[0]?.id;
if (vrId) {
  for (const uid of userIds) {
    await q(`INSERT INTO velocity_overrides (rule_id, user_id, reason, expires_at, granted_by, created_at)
      VALUES ($1, $2, 'VIP customer - increased limit approved', $3, $4, NOW()) ON CONFLICT DO NOTHING`,
      [vrId, uid, futureDate(90), userId1]
    );
  }
}

// ── webhook_retry_queue ───────────────────────────────────────────────────────
// Cols: id, delivery_id, endpoint_id, payload, attempt_number, max_attempts, next_attempt_at, last_attempt_at, last_error, status, created_at, updated_at
console.log("webhook_retry_queue...");
const wdResult = await client.query('SELECT id FROM webhook_deliveries LIMIT 5');
const wdIds = wdResult.rows.map(r => r.id);
const weResult = await client.query('SELECT id FROM webhook_endpoints LIMIT 3');
const weIds = weResult.rows.map(r => r.id);
for (let i = 0; i < 5; i++) {
  await q(`INSERT INTO webhook_retry_queue (delivery_id, endpoint_id, payload, attempt_number, max_attempts, next_attempt_at, last_attempt_at, last_error, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 5, $5, $6, $7, 'pending', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [
      wdIds[i % wdIds.length] ?? null,
      weIds[i % weIds.length] ?? null,
      '{"event":"transfer.completed","data":{"id":1}}',
      rnd(1,3),
      futureDate(0),
      pastDate(rnd(0,2)),
      i % 2 === 0 ? 'Connection timeout' : 'HTTP 500'
    ]
  );
}

await client.end();
console.log("✅ Final seed complete — all remaining tables populated");
