import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding v85 tables...");

    // fee_rules (no 'name' column - use corridor+feeType as description)
    const feeRulesData = [
      ["USD-NGN", 0, 500, "percentage", "0.015", null, "1.00", "15.00"],
      ["USD-NGN", 500, 5000, "percentage", "0.012", null, "1.00", "50.00"],
      ["USD-NGN", 5000, null, "percentage", "0.009", null, "5.00", "200.00"],
      ["GBP-KES", 0, 1000, "percentage", "0.018", null, "1.00", "20.00"],
      ["GBP-KES", 1000, null, "percentage", "0.014", null, "5.00", "100.00"],
      ["EUR-GHS", 0, null, "percentage", "0.016", null, "1.00", "150.00"],
      ["USD-PHP", 0, 200, "fixed", "0", "4.99", "4.99", "4.99"],
      ["USD-PHP", 200, null, "percentage", "0.011", null, "1.00", "50.00"],
      ["GBP-INR", 0, null, "percentage", "0.013", null, "1.00", "100.00"],
      ["USD-MXN", 0, null, "percentage", "0.017", null, "1.00", "80.00"],
    ];
    for (const [corridor, minAmt, maxAmt, feeType, feePct, feeFixed, minFee, maxFee] of feeRulesData) {
      await client.query(`
        INSERT INTO fee_rules (corridor, min_amount, max_amount, fee_type, fee_percentage, fee_fixed, min_fee, max_fee, is_active, "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
        ON CONFLICT DO NOTHING
      `, [corridor, minAmt, maxAmt, feeType, feePct, feeFixed, minFee, maxFee]);
    }
    console.log("  ✅ fee_rules: 10 rows");

    // sandbox_scenarios (payload is text, tags is text)
    const scenarios = [
      [1, "Standard USD→NGN Transfer", "transfer", '{"amount":500,"fromCurrency":"USD","toCurrency":"NGN"}', '["remittance","standard"]', true],
      [1, "High-Value Transfer (AML Trigger)", "transfer", '{"amount":15000,"fromCurrency":"USD","toCurrency":"NGN"}', '["aml","high-value"]', true],
      [1, "FX Rate Lock Test", "fx", '{"fromCurrency":"GBP","toCurrency":"KES","amount":2000}', '["fx","rate-lock"]', true],
      [1, "KYC Tier 2 Verification", "kyc", '{"userId":1,"targetTier":"tier2"}', '["kyc","verification"]', true],
      [1, "Webhook Payment Confirmation", "webhook", '{"event":"payment.completed","payload":{"status":"completed"}}', '["webhook","payment"]', true],
      [1, "Compliance AML Flag", "compliance", '{"userId":1,"reason":"structuring","amount":9500}', '["compliance","aml"]', false],
      [1, "Direct Debit Setup", "payment", '{"accountNumber":"12345678","sortCode":"20-00-00","amount":250}', '["direct-debit","setup"]', true],
      [1, "Bulk Transfer Test", "transfer", '{"transfers":[{"amount":100},{"amount":200}]}', '["bulk","transfer"]', false],
    ];
    for (const [userId, name, type, payload, tags, isPublic] of scenarios) {
      await client.query(`
        INSERT INTO sandbox_scenarios (user_id, name, scenario_type, payload, tags, is_public, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [userId, name, type, payload, tags, isPublic]);
    }
    console.log("  ✅ sandbox_scenarios: 8 rows");

    // compliance_alerts (no 'updated_at' column based on schema)
    const alerts = [
      ["aml_flag", "critical", "open", "Suspicious Structuring Pattern Detected", "User made 5 transactions just below $10,000 threshold in 48 hours", 1, null],
      ["kyc_expiry", "high", "open", "KYC Documents Expiring Soon", "Passport for user ID 3 expires in 14 days", null, null],
      ["sanctions_match", "critical", "acknowledged", "Potential Sanctions List Match", "Name similarity detected against OFAC SDN list", null, null],
      ["large_transaction", "medium", "resolved", "Large Transaction Threshold Exceeded", "Single transfer of $25,000 requires enhanced due diligence", 1, null],
      ["velocity_breach", "high", "open", "Transaction Velocity Limit Breached", "User exceeded 10 transactions per hour limit", null, null],
      ["pep_match", "high", "open", "Politically Exposed Person Match", "User profile matches PEP database entry", null, null],
      ["fraud_pattern", "critical", "open", "Fraud Pattern Detected", "Multiple failed authentication attempts followed by large transfer", 1, null],
      ["dormant_account", "low", "resolved", "Dormant Account Activity", "Account inactive for 12 months suddenly received large deposit", null, null],
    ];
    for (const [alertType, severity, status, title, description, relatedUserId, acknowledgedBy] of alerts) {
      await client.query(`
        INSERT INTO compliance_alerts (alert_type, severity, status, title, description, related_user_id, acknowledged_by, "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - (random() * interval '7 days'))
        ON CONFLICT DO NOTHING
      `, [alertType, severity, status, title, description, relatedUserId, acknowledgedBy]);
    }
    console.log("  ✅ compliance_alerts: 8 rows");

    // security_events (details is text, not jsonb)
    const secEvents = [
      [1, "login_success", "info", '{"ip":"192.168.1.1","location":"London, UK"}'],
      [1, "login_failure", "warning", '{"ip":"192.168.1.1","attempts":3}'],
      [null, "admin_action", "info", '{"action":"user_role_change","targetUserId":5}'],
      [1, "password_change", "info", '{"ip":"10.0.0.1","method":"email_verification"}'],
      [null, "suspicious_login", "critical", '{"ip":"185.220.101.1","country":"Unknown","vpn":true}'],
      [1, "2fa_disabled", "warning", '{"ip":"192.168.1.1","reason":"user_requested"}'],
      [null, "api_key_generated", "info", '{"keyId":"ak_test_xxx","environment":"sandbox"}'],
      [null, "bulk_export", "warning", '{"exportType":"users_csv","recordCount":1250}'],
      [null, "account_locked", "critical", '{"reason":"too_many_failed_attempts","attempts":10}'],
      [1, "session_expired", "info", '{"sessionId":"sess_xxx","duration":3600}'],
    ];
    for (const [userId, eventType, severity, details] of secEvents) {
      await client.query(`
        INSERT INTO security_events (user_id, event_type, severity, details, "createdAt")
        VALUES ($1, $2, $3, $4, NOW() - (random() * interval '30 days'))
        ON CONFLICT DO NOTHING
      `, [userId, eventType, severity, details]);
    }
    console.log("  ✅ security_events: 10 rows");

    // mfa_settings
    await client.query(`
      INSERT INTO mfa_settings (user_id, totp_secret, totp_enabled, enrolled_at, last_used_at, failed_attempts, "createdAt")
      VALUES (1, 'MFRA2YTBMJQWG3DP', false, NULL, NULL, 0, NOW())
      ON CONFLICT (user_id) DO NOTHING
    `);
    console.log("  ✅ mfa_settings: 1 row");

    // transfer_audit_trail
    const auditEntries = [
      [1, 1, null, "pending", "user", "Transfer initiated by user"],
      [1, 1, "pending", "processing", "system", "Payment gateway accepted"],
      [1, 1, "processing", "completed", "system", "Funds delivered to beneficiary"],
      [2, 1, null, "pending", "user", "Transfer initiated"],
      [2, 1, "pending", "processing", "system", "Compliance check passed"],
      [2, 1, "processing", "failed", "system", "Insufficient funds"],
      [3, 1, null, "pending", "user", "Transfer initiated"],
      [3, 1, "pending", "on_hold", "system", "AML review required"],
    ];
    for (const [transferId, userId, fromStatus, toStatus, triggeredBy, reason] of auditEntries) {
      await client.query(`
        INSERT INTO transfer_audit_trail (transfer_id, user_id, from_status, to_status, triggered_by, reason, "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW() - (random() * interval '14 days'))
        ON CONFLICT DO NOTHING
      `, [transferId, userId, fromStatus, toStatus, triggeredBy, reason]);
    }
    console.log("  ✅ transfer_audit_trail: 8 rows");

    console.log("\n✅ v85 seed complete!");
  } catch (err) {
    console.error("❌ Seed error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });
