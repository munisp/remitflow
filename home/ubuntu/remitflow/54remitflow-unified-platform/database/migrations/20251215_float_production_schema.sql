-- Float Production Schema Migration
-- Adds production-ready tables for float management with idempotency, reservations, and enhanced tracking

-- Add version column to existing float tables for optimistic locking
ALTER TABLE agent_floats ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_floats ADD COLUMN IF NOT EXISTS last_settlement_at TIMESTAMPTZ;

-- Float Facilities table (Python service compatible)
CREATE TABLE IF NOT EXISTS float_facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(255) NOT NULL UNIQUE,
    tier VARCHAR(50) NOT NULL DEFAULT 'basic',
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    total_limit DECIMAL(18,2) NOT NULL DEFAULT 0,
    available_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    reserved_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    utilized_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    min_threshold DECIMAL(18,2) NOT NULL DEFAULT 10000,
    max_threshold DECIMAL(18,2) NOT NULL DEFAULT 1000000,
    interest_rate DECIMAL(5,4) NOT NULL DEFAULT 0.03,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    auto_settlement BOOLEAN NOT NULL DEFAULT true,
    settlement_frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
    last_settlement_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Float Transactions table (Python service compatible)
CREATE TABLE IF NOT EXISTS float_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES float_facilities(id),
    agent_id VARCHAR(255) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    balance_before DECIMAL(18,2) NOT NULL,
    balance_after DECIMAL(18,2) NOT NULL,
    reference TEXT,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Float Reservations table (2-phase commit support)
CREATE TABLE IF NOT EXISTS float_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES float_facilities(id),
    agent_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    committed_amount DECIMAL(18,2),
    released_amount DECIMAL(18,2),
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    committed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Float Settlements table (Python service compatible)
CREATE TABLE IF NOT EXISTS float_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES float_facilities(id),
    agent_id VARCHAR(255) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    settled_by VARCHAR(255),
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Float Risk Assessments table
CREATE TABLE IF NOT EXISTS float_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES float_facilities(id),
    agent_id VARCHAR(255) NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    recommended_limit DECIMAL(18,2) NOT NULL,
    is_fallback BOOLEAN NOT NULL DEFAULT false,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_float_facilities_agent ON float_facilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_float_facilities_status ON float_facilities(status);
CREATE INDEX IF NOT EXISTS idx_float_transactions_agent ON float_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_float_transactions_facility ON float_transactions(facility_id);
CREATE INDEX IF NOT EXISTS idx_float_transactions_idempotency ON float_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_float_reservations_agent ON float_reservations(agent_id);
CREATE INDEX IF NOT EXISTS idx_float_reservations_status ON float_reservations(status);
CREATE INDEX IF NOT EXISTS idx_float_reservations_expires ON float_reservations(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_float_settlements_agent ON float_settlements(agent_id);
CREATE INDEX IF NOT EXISTS idx_float_settlements_status ON float_settlements(status);
CREATE INDEX IF NOT EXISTS idx_float_risk_assessments_agent ON float_risk_assessments(agent_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_float_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_float_facilities_updated_at
    BEFORE UPDATE ON float_facilities
    FOR EACH ROW
    EXECUTE FUNCTION update_float_updated_at();

CREATE TRIGGER update_float_reservations_updated_at
    BEFORE UPDATE ON float_reservations
    FOR EACH ROW
    EXECUTE FUNCTION update_float_updated_at();

-- Function to expire old reservations
CREATE OR REPLACE FUNCTION expire_float_reservations()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE float_reservations
        SET status = 'expired', updated_at = NOW()
        WHERE status = 'pending' AND expires_at < NOW()
        RETURNING id, facility_id, agent_id, amount
    ),
    released AS (
        UPDATE float_facilities f
        SET 
            available_balance = f.available_balance + e.amount,
            reserved_balance = f.reserved_balance - e.amount,
            version = f.version + 1,
            updated_at = NOW()
        FROM expired e
        WHERE f.agent_id = e.agent_id
    )
    SELECT COUNT(*) INTO expired_count FROM expired;
    
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE float_facilities IS 'Production float facilities with PostgreSQL persistence';
COMMENT ON TABLE float_transactions IS 'Float transaction history with idempotency support';
COMMENT ON TABLE float_reservations IS 'Float reservations for 2-phase commit pattern';
COMMENT ON TABLE float_settlements IS 'Float settlement records with payment gateway integration';
COMMENT ON TABLE float_risk_assessments IS 'Risk assessment history for float facilities';
COMMENT ON COLUMN float_facilities.version IS 'Optimistic locking version for concurrent updates';
COMMENT ON COLUMN float_transactions.idempotency_key IS 'Idempotency key for duplicate request detection';
COMMENT ON COLUMN float_reservations.expires_at IS 'Reservation expiry time (default 30 minutes)';
