-- ============================================================
-- RemitFlow Comprehensive Test Seed Data (v209)
-- Satisfies all smoke-v95 test requirements
-- ============================================================

-- ─── 1. Test User (id=1) ─────────────────────────────────────────────────────
INSERT INTO users (id, "openId", email, name, role, "kycTier", "createdAt", "updatedAt")
VALUES (1, 'test-open-id-001', 'test@remitflow.com', 'Test User', 'user', 'tier1', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
SELECT setval('users_id_seq', 1000, false);

-- ─── 2. System Config (need >= 15) ───────────────────────────────────────────
INSERT INTO system_config (key, value, description, updated_by, "updatedAt")
VALUES
  ('DEFAULT_FX_SPREAD', '0.015', 'Default FX spread', 1, NOW()),
  ('ENABLE_CBDC', 'true', 'Enable CBDC features', 1, NOW()),
  ('MAX_DAILY_TRANSFER', '50000', 'Max daily transfer USD', 1, NOW()),
  ('MIN_TRANSFER_AMOUNT', '1', 'Min transfer USD', 1, NOW()),
  ('KYC_REQUIRED_TIER', 'tier1', 'Min KYC tier', 1, NOW()),
  ('MAINTENANCE_MODE', 'false', 'Maintenance mode flag', 1, NOW()),
  ('DEFAULT_CORRIDOR_FEE', '0.012', 'Default corridor fee %', 1, NOW()),
  ('FLOAT_YIELD_RATE', '0.045', 'Annual float yield rate', 1, NOW()),
  ('MAX_TRANSFER_AMOUNT', '100000', 'Max single transfer USD', 1, NOW()),
  ('SWIFT_ENABLED', 'true', 'Enable SWIFT transfers', 1, NOW()),
  ('MOJALOOP_ENABLED', 'true', 'Enable Mojaloop rails', 1, NOW()),
  ('CBN_COMPLIANCE_MODE', 'strict', 'CBN compliance mode', 1, NOW()),
  ('FRAUD_SCORE_THRESHOLD', '0.7', 'Fraud score block threshold', 1, NOW()),
  ('RATE_LOCK_DURATION_HOURS', '24', 'Rate lock duration in hours', 1, NOW()),
  ('REFERRAL_BONUS_USD', '5', 'Referral bonus in USD', 1, NOW()),
  ('MAX_BENEFICIARIES', '50', 'Max beneficiaries per user', 1, NOW()),
  ('SESSION_TIMEOUT_MINUTES', '30', 'Session timeout in minutes', 1, NOW()),
  ('OTP_EXPIRY_MINUTES', '5', 'OTP expiry in minutes', 1, NOW()),
  ('BATCH_PAYMENT_MAX_ROWS', '1000', 'Max rows in batch payment', 1, NOW()),
  ('AGENT_COMMISSION_RATE', '0.005', 'Agent commission rate', 1, NOW())
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Feature Flags (need >= 15, need ENABLE_CBDC key) ─────────────────────
INSERT INTO feature_flags (key, name, description, scope, default_enabled, rollout_pct, "createdAt", "updatedAt")
VALUES
  ('ENABLE_CBDC', 'Enable CBDC', 'Enable CBDC transfer rails', 'global', false, 0, NOW(), NOW()),
  ('crypto_custody', 'Crypto Custody', 'Enable crypto custody features', 'global', false, 0, NOW(), NOW()),
  ('cbdc_transfers', 'CBDC Transfers', 'Enable CBDC transfer rails', 'global', false, 0, NOW(), NOW()),
  ('swift_mx', 'SWIFT ISO 20022 MX', 'Enable SWIFT ISO 20022 MX messages', 'global', true, 100, NOW(), NOW()),
  ('travel_rule', 'FATF Travel Rule', 'Enable FATF Travel Rule compliance', 'global', true, 100, NOW(), NOW()),
  ('float_income', 'Float Income Treasury', 'Enable float income treasury module', 'global', true, 100, NOW(), NOW()),
  ('cross_sell', 'Cross-Sell Marketplace', 'Enable cross-sell marketplace', 'global', true, 50, NOW(), NOW()),
  ('biometric_auth', 'Biometric Auth', 'Enable biometric authentication', 'global', true, 80, NOW(), NOW()),
  ('agent_network', 'Agent Network', 'Enable agent network features', 'global', true, 100, NOW(), NOW()),
  ('batch_payments', 'Batch Payments', 'Enable batch payment processing', 'global', true, 100, NOW(), NOW()),
  ('savings_goals', 'Savings Goals', 'Enable savings goals feature', 'global', true, 100, NOW(), NOW()),
  ('referral_program', 'Referral Program', 'Enable referral program', 'global', true, 100, NOW(), NOW()),
  ('bnpl', 'BNPL', 'Enable buy now pay later', 'global', false, 10, NOW(), NOW()),
  ('virtual_cards', 'Virtual Cards', 'Enable virtual card issuance', 'global', true, 100, NOW(), NOW()),
  ('split_bill', 'Split Bill', 'Enable split bill feature', 'global', true, 100, NOW(), NOW()),
  ('rate_alerts', 'Rate Alerts', 'Enable FX rate alerts', 'global', true, 100, NOW(), NOW()),
  ('mojaloop_rails', 'Mojaloop Rails', 'Enable Mojaloop payment rails', 'global', true, 100, NOW(), NOW()),
  ('west_africa_corridors', 'West Africa Corridors', 'Enable West Africa XOF corridors', 'global', true, 100, NOW(), NOW()),
  ('document_vault', 'Document Vault', 'Enable document vault', 'global', true, 100, NOW(), NOW()),
  ('ai_hub', 'AI Hub', 'Enable AI-powered features', 'global', false, 20, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── 4. Promo Codes (need >= 10, need WELCOME10) ─────────────────────────────
INSERT INTO promo_codes (code, description, discount_type, discount_value, usage_limit, usage_count, valid_from, valid_until, is_active, created_by, "createdAt")
VALUES
  ('WELCOME10', 'Welcome 10% discount', 'percentage', 10, 1000, 0, NOW(), NOW() + INTERVAL '1 year', true, 1, NOW()),
  ('FLAT500', 'Flat NGN 500 discount', 'flat', 500, 500, 0, NOW(), NOW() + INTERVAL '6 months', true, 1, NOW()),
  ('NEWUSER20', 'New user 20% off', 'percentage', 20, 500, 0, NOW(), NOW() + INTERVAL '3 months', true, 1, NOW()),
  ('DIASPORA15', 'Diaspora 15% off', 'percentage', 15, 2000, 0, NOW(), NOW() + INTERVAL '1 year', true, 1, NOW()),
  ('AGENT5', 'Agent 5% bonus', 'percentage', 5, 1000, 0, NOW(), NOW() + INTERVAL '6 months', true, 1, NOW()),
  ('FIRSTSEND', 'First send free fee', 'flat', 1000, 5000, 0, NOW(), NOW() + INTERVAL '1 year', true, 1, NOW()),
  ('SUMMER2026', 'Summer 2026 promo', 'percentage', 8, 3000, 0, NOW(), NOW() + INTERVAL '4 months', true, 1, NOW()),
  ('REFER50', 'Referral NGN 50 bonus', 'flat', 50, 10000, 0, NOW(), NOW() + INTERVAL '1 year', true, 1, NOW()),
  ('GBPSPECIAL', 'GBP corridor special', 'percentage', 12, 500, 0, NOW(), NOW() + INTERVAL '2 months', true, 1, NOW()),
  ('EURODEAL', 'EUR corridor deal', 'percentage', 10, 500, 0, NOW(), NOW() + INTERVAL '2 months', true, 1, NOW()),
  ('XOFBONUS', 'XOF corridor bonus', 'flat', 200, 1000, 0, NOW(), NOW() + INTERVAL '3 months', true, 1, NOW()),
  ('KENYAPROMO', 'Kenya corridor promo', 'percentage', 7, 800, 0, NOW(), NOW() + INTERVAL '3 months', true, 1, NOW())
ON CONFLICT DO NOTHING;

-- ─── 5. Exchange Rate Alerts (need >= 30) ────────────────────────────────────
INSERT INTO exchange_rate_alerts (user_id, from_currency, to_currency, target_rate, direction, is_active, notification_sent, "createdAt")
SELECT 1, 'USD', 'NGN', 1550 + (n * 10), 'above', true, false, NOW()
FROM generate_series(1, 15) n
UNION ALL
SELECT 1, 'GBP', 'NGN', 1900 + (n * 20), 'above', true, false, NOW()
FROM generate_series(1, 15) n
ON CONFLICT DO NOTHING;

-- ─── 6. Beneficiaries (need >= 50) ───────────────────────────────────────────
INSERT INTO beneficiaries ("userId", name, email, phone, "bankName", "accountNumber", "bankCode", currency, country, "createdAt")
SELECT 
  1,
  'Beneficiary ' || n,
  'bene' || n || '@test.com',
  '+234801234' || LPAD(n::text, 4, '0'),
  CASE (n % 5) WHEN 0 THEN 'First Bank Nigeria' WHEN 1 THEN 'GTBank' WHEN 2 THEN 'Access Bank' WHEN 3 THEN 'Zenith Bank' ELSE 'UBA' END,
  LPAD(n::text, 10, '0'),
  CASE (n % 5) WHEN 0 THEN '011' WHEN 1 THEN '058' WHEN 2 THEN '044' WHEN 3 THEN '057' ELSE '033' END,
  CASE (n % 4) WHEN 0 THEN 'NGN' WHEN 1 THEN 'USD' WHEN 2 THEN 'GBP' ELSE 'EUR' END,
  CASE (n % 4) WHEN 0 THEN 'NG' WHEN 1 THEN 'US' WHEN 2 THEN 'GB' ELSE 'DE' END,
  NOW()
FROM generate_series(1, 55) n
ON CONFLICT DO NOTHING;

-- ─── 7. Compliance Alerts (need >= 50) ───────────────────────────────────────
INSERT INTO compliance_alerts (alert_type, severity, title, description, related_user_id, status, "createdAt")
SELECT
  CASE (n % 5) WHEN 0 THEN 'AML' WHEN 1 THEN 'CTR' WHEN 2 THEN 'SAR' WHEN 3 THEN 'FBAR' ELSE 'KYC' END,
  CASE (n % 3) WHEN 0 THEN 'high' WHEN 1 THEN 'medium' ELSE 'low' END,
  'Compliance Alert ' || n,
  'Automated compliance alert generated for monitoring purposes - case ' || n,
  1,
  CASE (n % 3) WHEN 0 THEN 'open' WHEN 1 THEN 'acknowledged' ELSE 'resolved' END,
  NOW() - (n || ' hours')::interval
FROM generate_series(1, 55) n
ON CONFLICT DO NOTHING;

-- ─── 8. Sanctions Checks (need >= 30) ────────────────────────────────────────
INSERT INTO sanctions_checks (screening_id, user_id, entity_name, entity_type, result, risk_level, created_at)
SELECT
  'SCREEN-' || LPAD(n::text, 6, '0'),
  1,
  'Entity Name ' || n,
  CASE (n % 3) WHEN 0 THEN 'individual' WHEN 1 THEN 'organization' ELSE 'vessel' END,
  CASE (n % 3) WHEN 0 THEN 'clear' WHEN 1 THEN 'clear' ELSE 'pending_review' END,
  CASE (n % 3) WHEN 0 THEN 'low' WHEN 1 THEN 'medium' ELSE 'high' END,
  NOW() - (n || ' hours')::interval
FROM generate_series(1, 35) n
ON CONFLICT DO NOTHING;

-- ─── 9. Fraud Alerts (need >= 20) ────────────────────────────────────────────
INSERT INTO fraud_alerts (user_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, created_at, updated_at)
SELECT
  1,
  50 + (n * 2),
  CASE (n % 4) WHEN 0 THEN 'low' WHEN 1 THEN 'medium' WHEN 2 THEN 'high' ELSE 'critical' END,
  CASE (n % 4) WHEN 0 THEN 'pending' WHEN 1 THEN 'reviewed' WHEN 2 THEN 'cleared' ELSE 'blocked' END,
  '["velocity_check","amount_threshold"]',
  10000 + (n * 500),
  NOW() - (n || ' hours')::interval,
  NOW()
FROM generate_series(1, 25) n
ON CONFLICT DO NOTHING;

-- ─── 10. Security Events (need >= 100) ───────────────────────────────────────
INSERT INTO security_events (user_id, event_type, severity, ip_address, details, resolved, "createdAt")
SELECT
  1,
  CASE (n % 6) WHEN 0 THEN 'login_attempt' WHEN 1 THEN 'password_change' WHEN 2 THEN 'mfa_enabled' WHEN 3 THEN 'suspicious_ip' WHEN 4 THEN 'rate_limit_exceeded' ELSE 'session_expired' END,
  CASE (n % 3) WHEN 0 THEN 'info' WHEN 1 THEN 'warning' ELSE 'critical' END,
  '192.168.' || (n % 255) || '.' || (n % 100 + 1),
  'Security event details for event ' || n,
  (n % 2 = 0),
  NOW() - (n || ' minutes')::interval
FROM generate_series(1, 110) n
ON CONFLICT DO NOTHING;

-- ─── 11. Wallets for test user ────────────────────────────────────────────────
INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
VALUES
  (1, 'NGN', 500000, NOW(), NOW()),
  (1, 'USD', 1000, NOW(), NOW()),
  (1, 'GBP', 500, NOW(), NOW()),
  (1, 'EUR', 750, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── 12. KYC document for test user ──────────────────────────────────────────
INSERT INTO "kycDocuments" ("userId", "docType", status, "fileUrl", "fileKey", "createdAt", "updatedAt")
VALUES (1, 'passport', 'approved', 'https://example.com/kyc/test.pdf', 'kyc/test-001.pdf', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── 13. FX rate history ─────────────────────────────────────────────────────
INSERT INTO fx_rate_history (from_currency, to_currency, rate, source, recorded_at)
VALUES
  ('USD', 'NGN', 1580.00, 'seed', NOW()),
  ('GBP', 'NGN', 2010.00, 'seed', NOW()),
  ('EUR', 'NGN', 1720.00, 'seed', NOW()),
  ('CAD', 'NGN', 1160.00, 'seed', NOW()),
  ('AED', 'NGN', 430.00, 'seed', NOW()),
  ('USD', 'GBP', 0.79, 'seed', NOW()),
  ('USD', 'EUR', 0.92, 'seed', NOW()),
  ('USD', 'GHS', 15.20, 'seed', NOW()),
  ('USD', 'KES', 129.50, 'seed', NOW())
ON CONFLICT DO NOTHING;

-- ─── 14. Compliance email config ─────────────────────────────────────────────
INSERT INTO compliance_email_config (
  officer_name, officer_email, report_types, is_active, frequency,
  include_attachment, encrypt_attachment, smtp_host, smtp_port,
  from_email, from_name, created_by, created_at, updated_at
)
VALUES (
  'Chief Compliance Officer', 'compliance@remitflow.com',
  '["CTR","SAR","FBAR"]', true, 'immediate',
  true, false, 'smtp.sendgrid.net', 587,
  'compliance@remitflow.com', 'RemitFlow Compliance',
  1, NOW(), NOW()
)
ON CONFLICT DO NOTHING;

-- ─── 15. Push notification preferences for test user ─────────────────────────
INSERT INTO push_notification_preferences (user_id, preference_key, is_enabled, updated_at)
VALUES
  (1, 'transfer_completed', true, NOW()),
  (1, 'transfer_failed', true, NOW()),
  (1, 'rate_alert', true, NOW()),
  (1, 'kyc_update', true, NOW()),
  (1, 'promo_offers', false, NOW())
ON CONFLICT DO NOTHING;

SELECT 'Comprehensive seed data applied successfully' AS status;
