-- =====================================================
-- Remittance Platform - Financial System Schema
-- Migrations for Settlement, Reconciliation, and Enhanced Hierarchy
-- Version: 3.0.0
-- =====================================================

-- =====================================================
-- SETTLEMENT SERVICE TABLES
-- =====================================================

-- Settlement Rules
CREATE TABLE IF NOT EXISTS settlement_rules (
    id UUID PRIMARY KEY,
    rule_name VARCHAR(200) NOT NULL,
    description TEXT,
    frequency VARCHAR(50) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'manual')),
    settlement_day INTEGER CHECK (settlement_day BETWEEN 1 AND 31),
    settlement_weekday INTEGER CHECK (settlement_weekday BETWEEN 0 AND 6),
    min_settlement_amount DECIMAL(15, 2) NOT NULL DEFAULT 10.00,
    auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
    auto_approve_threshold DECIMAL(15, 2),
    payout_method VARCHAR(50) NOT NULL DEFAULT 'bank_transfer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    agent_tier VARCHAR(50),
    territory_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlement_rules_active ON settlement_rules(is_active);
CREATE INDEX idx_settlement_rules_frequency ON settlement_rules(frequency);

-- Settlement Batches
CREATE TABLE IF NOT EXISTS settlement_batches (
    id UUID PRIMARY KEY,
    batch_name VARCHAR(200) NOT NULL,
    batch_number VARCHAR(100) UNIQUE NOT NULL,
    settlement_period_start DATE NOT NULL,
    settlement_period_end DATE NOT NULL,
    settlement_rule_id UUID REFERENCES settlement_rules(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'completed', 'failed', 'cancelled')),
    total_agents INTEGER NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(100),
    approved_by VARCHAR(100),
    approved_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX idx_settlement_batches_period ON settlement_batches(settlement_period_start, settlement_period_end);
CREATE INDEX idx_settlement_batches_created ON settlement_batches(created_at DESC);

-- Settlement Items
CREATE TABLE IF NOT EXISTS settlement_items (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL,
    gross_commission DECIMAL(15, 2) NOT NULL,
    deductions DECIMAL(15, 2) NOT NULL DEFAULT 0,
    net_amount DECIMAL(15, 2) NOT NULL,
    payout_method VARCHAR(50) NOT NULL,
    payout_details JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
    tigerbeetle_transfer_id VARCHAR(100),
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlement_items_batch ON settlement_items(batch_id);
CREATE INDEX idx_settlement_items_agent ON settlement_items(agent_id);
CREATE INDEX idx_settlement_items_status ON settlement_items(status);
CREATE INDEX idx_settlement_items_processed ON settlement_items(processed_at DESC);

-- Agent Payout Details
CREATE TABLE IF NOT EXISTS agent_payout_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL UNIQUE,
    payout_method VARCHAR(50) NOT NULL DEFAULT 'bank_transfer',
    bank_name VARCHAR(100),
    account_number VARCHAR(50),
    account_name VARCHAR(200),
    mobile_money_provider VARCHAR(100),
    mobile_money_number VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_payout_agent ON agent_payout_details(agent_id);

-- =====================================================
-- RECONCILIATION SERVICE TABLES
-- =====================================================

-- Reconciliation Batches
CREATE TABLE IF NOT EXISTS reconciliation_batches (
    id UUID PRIMARY KEY,
    batch_name VARCHAR(200) NOT NULL,
    batch_number VARCHAR(100) UNIQUE NOT NULL,
    reconciliation_type VARCHAR(50) NOT NULL CHECK (reconciliation_type IN ('commission', 'settlement', 'payment', 'end_of_day', 'month_end', 'ledger')),
    reconciliation_date DATE NOT NULL,
    source_system VARCHAR(100) NOT NULL,
    target_system VARCHAR(100) NOT NULL,
    matching_strategy VARCHAR(50) NOT NULL DEFAULT 'exact' CHECK (matching_strategy IN ('exact', 'fuzzy', 'amount_based', 'time_based')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
    total_source_records INTEGER NOT NULL DEFAULT 0,
    total_target_records INTEGER NOT NULL DEFAULT 0,
    matched_records INTEGER NOT NULL DEFAULT 0,
    discrepancies_count INTEGER NOT NULL DEFAULT 0,
    total_source_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_target_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    variance_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    variance_percentage DECIMAL(10, 4) NOT NULL DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recon_batches_type ON reconciliation_batches(reconciliation_type);
CREATE INDEX idx_recon_batches_status ON reconciliation_batches(status);
CREATE INDEX idx_recon_batches_date ON reconciliation_batches(reconciliation_date DESC);
CREATE INDEX idx_recon_batches_created ON reconciliation_batches(created_at DESC);

-- Reconciliation Discrepancies
CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES reconciliation_batches(id) ON DELETE CASCADE,
    discrepancy_type VARCHAR(50) NOT NULL CHECK (discrepancy_type IN ('missing_source', 'missing_target', 'amount_mismatch', 'status_mismatch', 'duplicate', 'other')),
    source_record_id VARCHAR(100),
    target_record_id VARCHAR(100),
    source_amount DECIMAL(15, 2),
    target_amount DECIMAL(15, 2),
    variance_amount DECIMAL(15, 2) NOT NULL,
    source_data JSONB,
    target_data JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'accepted', 'escalated')),
    resolution_notes TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recon_discrepancies_batch ON reconciliation_discrepancies(batch_id);
CREATE INDEX idx_recon_discrepancies_type ON reconciliation_discrepancies(discrepancy_type);
CREATE INDEX idx_recon_discrepancies_status ON reconciliation_discrepancies(status);
CREATE INDEX idx_recon_discrepancies_created ON reconciliation_discrepancies(created_at DESC);

-- =====================================================
-- ENHANCED HIERARCHY SERVICE TABLES
-- =====================================================

-- Drop existing hierarchy_nodes if it exists (from basic implementation)
DROP TABLE IF EXISTS hierarchy_nodes CASCADE;

-- Enhanced Hierarchy Nodes
CREATE TABLE hierarchy_nodes (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL UNIQUE,
    parent_id UUID REFERENCES hierarchy_nodes(id) ON DELETE SET NULL,
    tier VARCHAR(50) NOT NULL CHECK (tier IN ('super_agent', 'senior_agent', 'agent', 'sub_agent', 'trainee')),
    territory_id UUID,
    commission_rate DECIMAL(5, 4) CHECK (commission_rate BETWEEN 0 AND 1),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'terminated')),
    depth INTEGER NOT NULL DEFAULT 0,
    path UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hierarchy_nodes_agent ON hierarchy_nodes(agent_id);
CREATE INDEX idx_hierarchy_nodes_parent ON hierarchy_nodes(parent_id);
CREATE INDEX idx_hierarchy_nodes_tier ON hierarchy_nodes(tier);
CREATE INDEX idx_hierarchy_nodes_status ON hierarchy_nodes(status);
CREATE INDEX idx_hierarchy_nodes_depth ON hierarchy_nodes(depth);
CREATE INDEX idx_hierarchy_nodes_path ON hierarchy_nodes USING GIN(path);
CREATE INDEX idx_hierarchy_nodes_territory ON hierarchy_nodes(territory_id);

-- Hierarchy Change Log (for audit trail)
CREATE TABLE IF NOT EXISTS hierarchy_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL,
    change_type VARCHAR(50) NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted', 'parent_changed', 'status_changed')),
    old_parent_id UUID,
    new_parent_id UUID,
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    old_tier VARCHAR(50),
    new_tier VARCHAR(50),
    changed_by VARCHAR(100),
    change_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hierarchy_change_log_node ON hierarchy_change_log(node_id);
CREATE INDEX idx_hierarchy_change_log_type ON hierarchy_change_log(change_type);
CREATE INDEX idx_hierarchy_change_log_created ON hierarchy_change_log(created_at DESC);

-- =====================================================
-- INTEGRATION TABLES
-- =====================================================

-- Workflow Execution Log
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY,
    workflow_type VARCHAR(100) NOT NULL CHECK (workflow_type IN ('transaction_processing', 'end_of_day', 'month_end', 'settlement', 'reconciliation')),
    workflow_data JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    steps_completed TEXT[] DEFAULT ARRAY[]::TEXT[],
    steps_pending TEXT[] DEFAULT ARRAY[]::TEXT[],
    errors JSONB DEFAULT '[]'::JSONB,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_executions_type ON workflow_executions(workflow_type);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_created ON workflow_executions(created_at DESC);

-- =====================================================
-- UPDATE EXISTING COMMISSION TABLES
-- =====================================================

-- Add settlement tracking to commission_calculations
ALTER TABLE commission_calculations 
ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(50) DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'settled', 'cancelled')),
ADD COLUMN IF NOT EXISTS settlement_batch_id UUID REFERENCES settlement_batches(id),
ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_commission_calculations_settlement ON commission_calculations(settlement_status);
CREATE INDEX IF NOT EXISTS idx_commission_calculations_batch ON commission_calculations(settlement_batch_id);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables
CREATE TRIGGER update_settlement_rules_updated_at BEFORE UPDATE ON settlement_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_batches_updated_at BEFORE UPDATE ON settlement_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_payout_details_updated_at BEFORE UPDATE ON agent_payout_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reconciliation_batches_updated_at BEFORE UPDATE ON reconciliation_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_hierarchy_nodes_updated_at BEFORE UPDATE ON hierarchy_nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_executions_updated_at BEFORE UPDATE ON workflow_executions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to log hierarchy changes
CREATE OR REPLACE FUNCTION log_hierarchy_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO hierarchy_change_log (node_id, change_type, new_parent_id, new_status, new_tier)
        VALUES (NEW.id, 'created', NEW.parent_id, NEW.status, NEW.tier);
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
            INSERT INTO hierarchy_change_log (node_id, change_type, old_parent_id, new_parent_id)
            VALUES (NEW.id, 'parent_changed', OLD.parent_id, NEW.parent_id);
        END IF;
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO hierarchy_change_log (node_id, change_type, old_status, new_status)
            VALUES (NEW.id, 'status_changed', OLD.status, NEW.status);
        END IF;
        IF OLD.tier IS DISTINCT FROM NEW.tier THEN
            INSERT INTO hierarchy_change_log (node_id, change_type, old_tier, new_tier)
            VALUES (NEW.id, 'tier_changed', OLD.tier, NEW.tier);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO hierarchy_change_log (node_id, change_type, old_parent_id, old_status, old_tier)
        VALUES (OLD.id, 'deleted', OLD.parent_id, OLD.status, OLD.tier);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_hierarchy_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON hierarchy_nodes
FOR EACH ROW EXECUTE FUNCTION log_hierarchy_changes();

-- =====================================================
-- VIEWS FOR REPORTING
-- =====================================================

-- Settlement Summary View
CREATE OR REPLACE VIEW settlement_summary AS
SELECT 
    sb.id as batch_id,
    sb.batch_number,
    sb.settlement_period_start,
    sb.settlement_period_end,
    sb.status,
    sb.total_agents,
    sb.total_amount,
    sb.total_items,
    sb.completed_items,
    sb.failed_items,
    ROUND((sb.completed_items::DECIMAL / NULLIF(sb.total_items, 0) * 100), 2) as completion_percentage,
    sb.created_at,
    sb.processed_at
FROM settlement_batches sb
ORDER BY sb.created_at DESC;

-- Reconciliation Summary View
CREATE OR REPLACE VIEW reconciliation_summary AS
SELECT 
    rb.id as batch_id,
    rb.batch_number,
    rb.reconciliation_type,
    rb.reconciliation_date,
    rb.status,
    rb.total_source_records,
    rb.total_target_records,
    rb.matched_records,
    rb.discrepancies_count,
    rb.total_source_amount,
    rb.total_target_amount,
    rb.variance_amount,
    rb.variance_percentage,
    ROUND((rb.matched_records::DECIMAL / NULLIF(rb.total_source_records, 0) * 100), 2) as match_percentage,
    rb.created_at,
    rb.completed_at
FROM reconciliation_batches rb
ORDER BY rb.created_at DESC;

-- Agent Hierarchy Tree View
CREATE OR REPLACE VIEW agent_hierarchy_tree AS
SELECT 
    hn.id,
    hn.agent_id,
    hn.parent_id,
    hn.tier,
    hn.depth,
    hn.status,
    (SELECT COUNT(*) FROM hierarchy_nodes WHERE parent_id = hn.id) as children_count,
    hn.created_at
FROM hierarchy_nodes hn
WHERE hn.status = 'active'
ORDER BY hn.depth, hn.created_at;

-- Commission Settlement Status View
CREATE OR REPLACE VIEW commission_settlement_status AS
SELECT 
    cc.agent_id,
    DATE(cc.calculated_at) as calculation_date,
    COUNT(*) as total_commissions,
    SUM(cc.total_commission) as total_amount,
    COUNT(*) FILTER (WHERE cc.settlement_status = 'pending') as pending_count,
    SUM(cc.total_commission) FILTER (WHERE cc.settlement_status = 'pending') as pending_amount,
    COUNT(*) FILTER (WHERE cc.settlement_status = 'settled') as settled_count,
    SUM(cc.total_commission) FILTER (WHERE cc.settlement_status = 'settled') as settled_amount
FROM commission_calculations cc
GROUP BY cc.agent_id, DATE(cc.calculated_at)
ORDER BY calculation_date DESC, total_amount DESC;

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Insert default settlement rule
INSERT INTO settlement_rules (
    id, rule_name, description, frequency, settlement_day,
    min_settlement_amount, auto_approve, auto_approve_threshold,
    payout_method, is_active
) VALUES (
    gen_random_uuid(),
    'Monthly Settlement - All Agents',
    'Default monthly settlement for all active agents',
    'monthly',
    1,
    100.00,
    false,
    NULL,
    'bank_transfer',
    true
) ON CONFLICT DO NOTHING;

-- =====================================================
-- GRANTS (if needed)
-- =====================================================

-- Grant permissions to banking_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO banking_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO banking_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO banking_user;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Log migration
DO $$
BEGIN
    RAISE NOTICE 'Financial System Schema Migration (003) completed successfully';
    RAISE NOTICE 'Tables created: settlement_rules, settlement_batches, settlement_items, agent_payout_details';
    RAISE NOTICE 'Tables created: reconciliation_batches, reconciliation_discrepancies';
    RAISE NOTICE 'Tables created: hierarchy_nodes (enhanced), hierarchy_change_log, workflow_executions';
    RAISE NOTICE 'Views created: settlement_summary, reconciliation_summary, agent_hierarchy_tree, commission_settlement_status';
END $$;

