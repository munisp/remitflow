-- rust-kyc-compliance-bridge — durable compliance records (W19-D)
CREATE TABLE IF NOT EXISTS kyc_bridge_passports (
    passport_id   TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    source_regulator TEXT NOT NULL,
    target_regulator TEXT NOT NULL,
    kyc_tier      SMALLINT NOT NULL,
    verification_status TEXT NOT NULL,
    risk_score    DOUBLE PRECISION NOT NULL,
    valid_until   TEXT NOT NULL,
    data          JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_bridge_passports_user ON kyc_bridge_passports(user_id);

CREATE TABLE IF NOT EXISTS kyc_bridge_screenings (
    screening_id   TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    sender_name    TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    amount         DOUBLE PRECISION NOT NULL,
    currency       TEXT NOT NULL,
    corridor       TEXT NOT NULL,
    sanctions_result TEXT NOT NULL,
    pep_result     TEXT NOT NULL,
    risk_score     DOUBLE PRECISION NOT NULL,
    decision       TEXT NOT NULL,
    screened_at    TEXT NOT NULL,
    screening_duration_ms BIGINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_bridge_screenings_tx ON kyc_bridge_screenings(transaction_id);

-- SAR/STR filings are regulatory records: append-only
CREATE TABLE IF NOT EXISTS kyc_bridge_sar_filings (
    filing_id      TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    regulator      TEXT NOT NULL,
    filing_type    TEXT NOT NULL,
    reason         TEXT NOT NULL,
    status         TEXT NOT NULL,
    filed_at       TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_bridge_sar_tx ON kyc_bridge_sar_filings(transaction_id);
