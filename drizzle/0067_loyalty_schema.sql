-- Loyalty points program persistence, formerly initialized inside the request router.
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_redeemed integer NOT NULL DEFAULT 0 CHECK (lifetime_redeemed >= 0),
  tier varchar(20) NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_accounts_tier_earned_idx ON loyalty_accounts (tier, lifetime_earned DESC);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  type varchar(20) NOT NULL CHECK (type IN ('earn', 'redeem', 'expire', 'adjustment')),
  amount integer NOT NULL,
  description varchar(500),
  expires_at timestamptz,
  expired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_transactions_user_created_idx ON loyalty_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_transactions_expiry_idx ON loyalty_transactions (expires_at) WHERE expired = false AND type = 'earn';
