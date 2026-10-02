-- rust-credential-guard — durable credential/cert/canary stores + TTL ephemeral stores (W19-D)

-- Durable security records
CREATE TABLE IF NOT EXISTS credential_guard_credentials (
    credential_id  TEXT PRIMARY KEY,
    user_id        BIGINT NOT NULL,
    public_key_pem TEXT NOT NULL,
    sign_count     INTEGER NOT NULL DEFAULT 0,
    name           TEXT NOT NULL,
    aaguid         TEXT NOT NULL,
    created_at_unix BIGINT NOT NULL,
    last_used      BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credential_guard_credentials_user ON credential_guard_credentials(user_id);

CREATE TABLE IF NOT EXISTS credential_guard_certificates (
    cert_id      TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    fingerprint  TEXT NOT NULL UNIQUE,
    issued_at    BIGINT NOT NULL,
    expires_at   BIGINT NOT NULL,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credential_guard_canary_tokens (
    token_id    TEXT PRIMARY KEY,
    table_name  TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    honey_data  TEXT NOT NULL,
    trip_count  INTEGER NOT NULL DEFAULT 0,
    last_trip   BIGINT,
    created_at_unix BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credential_guard_canary_trips (
    trip_id       TEXT PRIMARY KEY,
    token_id      TEXT NOT NULL,
    accessed_by   BIGINT NOT NULL,
    ip_address    TEXT NOT NULL,
    query_pattern TEXT NOT NULL,
    timestamp_unix BIGINT NOT NULL,
    auto_action   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credential_guard_trips_token ON credential_guard_canary_trips(token_id);

-- Ephemeral state with TTL (expires_at epoch seconds; purged periodically)
CREATE TABLE IF NOT EXISTS credential_guard_challenges (
    challenge  TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    created_at_unix BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credential_guard_challenges_ttl ON credential_guard_challenges(expires_at);

CREATE TABLE IF NOT EXISTS credential_guard_tokens (
    token_id       TEXT PRIMARY KEY,
    user_id        BIGINT NOT NULL,
    scope          TEXT NOT NULL,
    issued_at      BIGINT NOT NULL,
    expires_at     BIGINT NOT NULL,
    max_uses       INTEGER NOT NULL,
    uses_remaining INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credential_guard_tokens_ttl ON credential_guard_tokens(expires_at);
