-- rust-social-ledger — durable ROSCA/referral/pool/link records (W19-D)
CREATE TABLE IF NOT EXISTS social_rosca_groups (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    currency                TEXT NOT NULL,
    contribution_amount     BIGINT NOT NULL,
    contribution_frequency  TEXT NOT NULL,
    member_ids              JSONB NOT NULL DEFAULT '[]',
    current_round           INTEGER NOT NULL,
    current_beneficiary_idx INTEGER NOT NULL,
    total_pot               BIGINT NOT NULL,
    status                  TEXT NOT NULL,
    created_at_unix         BIGINT NOT NULL,
    next_contribution_due   BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_contributions (
    id             TEXT PRIMARY KEY,
    group_id       TEXT NOT NULL,
    member_id      TEXT NOT NULL,
    amount         BIGINT NOT NULL,
    round          INTEGER NOT NULL,
    timestamp_unix BIGINT NOT NULL,
    tigerbeetle_transfer_id TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_contributions_group ON social_contributions(group_id);

CREATE TABLE IF NOT EXISTS social_referrals (
    id              BIGSERIAL PRIMARY KEY,
    referrer_id     TEXT NOT NULL,
    referee_id      TEXT NOT NULL,
    tier            SMALLINT NOT NULL,
    status          TEXT NOT NULL,
    reward_amount   BIGINT NOT NULL,
    reward_currency TEXT NOT NULL,
    created_at_unix BIGINT NOT NULL,
    qualified_at    BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_referrals_referrer ON social_referrals(referrer_id);

CREATE TABLE IF NOT EXISTS social_pools (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    goal_amount         BIGINT NOT NULL,
    current_amount      BIGINT NOT NULL,
    currency            TEXT NOT NULL,
    disbursement_rule   TEXT NOT NULL,
    disbursement_target TEXT NOT NULL,
    beneficiary_id      TEXT NOT NULL,
    member_ids          JSONB NOT NULL DEFAULT '[]',
    status              TEXT NOT NULL,
    created_at_unix     BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_payment_links (
    code        TEXT PRIMARY KEY,
    creator_id  TEXT NOT NULL,
    amount      BIGINT,
    currency    TEXT NOT NULL,
    description TEXT NOT NULL,
    expires_at  BIGINT NOT NULL,
    max_uses    INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
