-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) IMPLEMENTATION
-- Enterprise-grade fine-grained access control
-- ============================================================================

-- ============================================================================
-- DATABASE ROLES
-- ============================================================================

-- Drop existing roles if they exist
DROP ROLE IF EXISTS super_admin;
DROP ROLE IF EXISTS admin;
DROP ROLE IF EXISTS agent_manager;
DROP ROLE IF EXISTS agent;
DROP ROLE IF EXISTS customer;
DROP ROLE IF EXISTS auditor;
DROP ROLE IF EXISTS readonly;

-- Create roles
CREATE ROLE super_admin;
CREATE ROLE admin;
CREATE ROLE agent_manager;
CREATE ROLE agent;
CREATE ROLE customer;
CREATE ROLE auditor;
CREATE ROLE readonly;

-- ============================================================================
-- ENABLE ROW-LEVEL SECURITY ON CRITICAL TABLES
-- ============================================================================

-- Transactions
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transaction_details ENABLE ROW LEVEL SECURITY;

-- Agents
ALTER TABLE IF EXISTS agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_performance ENABLE ROW LEVEL SECURITY;

-- Customers
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customer_kyc ENABLE ROW LEVEL SECURITY;

-- Financial
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS balances ENABLE ROW LEVEL SECURITY;

-- Security
ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS security_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- HELPER FUNCTIONS FOR RLS
-- ============================================================================

-- Get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.user_role', true);
END;
$$ LANGUAGE plpgsql STABLE;

-- Get current user's ID
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.user_id', true)::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get current user's agent ID
CREATE OR REPLACE FUNCTION current_agent_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.agent_id', true)::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get current user's customer ID
CREATE OR REPLACE FUNCTION current_customer_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.customer_id', true)::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_user_role() IN ('super_admin', 'admin');
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if user is agent manager
CREATE OR REPLACE FUNCTION is_agent_manager()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_user_role() IN ('super_admin', 'admin', 'agent_manager');
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- RLS POLICIES: TRANSACTIONS
-- ============================================================================

-- Super admin and admin can see all transactions
CREATE POLICY admin_all_transactions ON transactions
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agents can see their own transactions
CREATE POLICY agent_own_transactions ON transactions
    FOR SELECT
    TO agent
    USING (agent_id = current_agent_id());

-- Agents can create transactions
CREATE POLICY agent_create_transactions ON transactions
    FOR INSERT
    TO agent
    WITH CHECK (agent_id = current_agent_id());

-- Customers can see their own transactions
CREATE POLICY customer_own_transactions ON transactions
    FOR SELECT
    TO customer
    USING (customer_id = current_customer_id());

-- Auditors can see all transactions (read-only)
CREATE POLICY auditor_view_transactions ON transactions
    FOR SELECT
    TO auditor
    USING (true);

-- ============================================================================
-- RLS POLICIES: AGENTS
-- ============================================================================

-- Admin can manage all agents
CREATE POLICY admin_all_agents ON agents
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agent managers can see and update agents in their hierarchy
CREATE POLICY manager_hierarchy_agents ON agents
    FOR SELECT
    TO agent_manager
    USING (
        manager_id = current_agent_id()
        OR id IN (
            SELECT child_id 
            FROM agent_hierarchy 
            WHERE parent_id = current_agent_id()
        )
    );

-- Agents can see their own profile
CREATE POLICY agent_own_profile ON agents
    FOR SELECT
    TO agent
    USING (id = current_agent_id());

-- Agents can update their own profile (limited fields)
CREATE POLICY agent_update_own_profile ON agents
    FOR UPDATE
    TO agent
    USING (id = current_agent_id())
    WITH CHECK (id = current_agent_id());

-- ============================================================================
-- RLS POLICIES: CUSTOMERS
-- ============================================================================

-- Admin can manage all customers
CREATE POLICY admin_all_customers ON customers
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agents can see customers they onboarded
CREATE POLICY agent_own_customers ON customers
    FOR SELECT
    TO agent
    USING (onboarded_by_agent_id = current_agent_id());

-- Customers can see their own profile
CREATE POLICY customer_own_profile ON customers
    FOR SELECT
    TO customer
    USING (id = current_customer_id());

-- Customers can update their own profile (limited fields)
CREATE POLICY customer_update_own_profile ON customers
    FOR UPDATE
    TO customer
    USING (id = current_customer_id())
    WITH CHECK (id = current_customer_id());

-- ============================================================================
-- RLS POLICIES: CUSTOMER ACCOUNTS
-- ============================================================================

-- Admin can manage all accounts
CREATE POLICY admin_all_accounts ON customer_accounts
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agents can see accounts of their customers
CREATE POLICY agent_customer_accounts ON customer_accounts
    FOR SELECT
    TO agent
    USING (
        customer_id IN (
            SELECT id FROM customers 
            WHERE onboarded_by_agent_id = current_agent_id()
        )
    );

-- Customers can see their own accounts
CREATE POLICY customer_own_accounts ON customer_accounts
    FOR SELECT
    TO customer
    USING (customer_id = current_customer_id());

-- ============================================================================
-- RLS POLICIES: PAYMENTS
-- ============================================================================

-- Admin can manage all payments
CREATE POLICY admin_all_payments ON payments
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agents can see payments they processed
CREATE POLICY agent_own_payments ON payments
    FOR SELECT
    TO agent
    USING (processed_by_agent_id = current_agent_id());

-- Agents can create payments
CREATE POLICY agent_create_payments ON payments
    FOR INSERT
    TO agent
    WITH CHECK (processed_by_agent_id = current_agent_id());

-- Customers can see their own payments
CREATE POLICY customer_own_payments ON payments
    FOR SELECT
    TO customer
    USING (customer_id = current_customer_id());

-- ============================================================================
-- RLS POLICIES: BALANCES
-- ============================================================================

-- Admin can see all balances
CREATE POLICY admin_all_balances ON balances
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agents can see their own balance
CREATE POLICY agent_own_balance ON balances
    FOR SELECT
    TO agent
    USING (agent_id = current_agent_id());

-- Customers can see their own balance
CREATE POLICY customer_own_balance ON balances
    FOR SELECT
    TO customer
    USING (customer_id = current_customer_id());

-- ============================================================================
-- RLS POLICIES: AGENT COMMISSIONS
-- ============================================================================

-- Admin can manage all commissions
CREATE POLICY admin_all_commissions ON agent_commissions
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Agent managers can see commissions in their hierarchy
CREATE POLICY manager_hierarchy_commissions ON agent_commissions
    FOR SELECT
    TO agent_manager
    USING (
        agent_id = current_agent_id()
        OR agent_id IN (
            SELECT child_id 
            FROM agent_hierarchy 
            WHERE parent_id = current_agent_id()
        )
    );

-- Agents can see their own commissions
CREATE POLICY agent_own_commissions ON agent_commissions
    FOR SELECT
    TO agent
    USING (agent_id = current_agent_id());

-- ============================================================================
-- RLS POLICIES: AUDIT LOGS
-- ============================================================================

-- Admin can see all audit logs
CREATE POLICY admin_all_audit_logs ON audit_logs
    FOR SELECT
    TO super_admin, admin
    USING (true);

-- Auditors can see all audit logs
CREATE POLICY auditor_all_audit_logs ON audit_logs
    FOR SELECT
    TO auditor
    USING (true);

-- Agents can see audit logs related to them
CREATE POLICY agent_own_audit_logs ON audit_logs
    FOR SELECT
    TO agent
    USING (user_id = current_user_id());

-- Customers can see audit logs related to them
CREATE POLICY customer_own_audit_logs ON audit_logs
    FOR SELECT
    TO customer
    USING (user_id = current_user_id());

-- ============================================================================
-- RLS POLICIES: SECURITY EVENTS
-- ============================================================================

-- Admin can see all security events
CREATE POLICY admin_all_security_events ON security_events
    FOR ALL
    TO super_admin, admin
    USING (true)
    WITH CHECK (true);

-- Auditors can see all security events
CREATE POLICY auditor_all_security_events ON security_events
    FOR SELECT
    TO auditor
    USING (true);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Super Admin: Full access to everything
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO super_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO super_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO super_admin;

-- Admin: Full access to most tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO admin;

-- Agent Manager: Read and limited write
GRANT SELECT, INSERT, UPDATE ON transactions, payments, customers TO agent_manager;
GRANT SELECT ON agents, agent_commissions, agent_performance TO agent_manager;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_manager;

-- Agent: Limited access
GRANT SELECT, INSERT ON transactions, payments TO agent;
GRANT SELECT ON customers, customer_accounts, agents TO agent;
GRANT SELECT ON agent_commissions WHERE agent_id = current_agent_id() TO agent;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent;

-- Customer: Read-only on own data
GRANT SELECT ON customers, customer_accounts, transactions, payments TO customer;

-- Auditor: Read-only on everything
GRANT SELECT ON ALL TABLES IN SCHEMA public TO auditor;

-- Readonly: Read-only on non-sensitive tables
GRANT SELECT ON agents, customers, transactions TO readonly;

-- ============================================================================
-- SECURITY FUNCTIONS
-- ============================================================================

-- Function to set user context (called by application)
CREATE OR REPLACE FUNCTION set_user_context(
    p_user_id UUID,
    p_user_role TEXT,
    p_agent_id UUID DEFAULT NULL,
    p_customer_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id::TEXT, false);
    PERFORM set_config('app.user_role', p_user_role, false);
    
    IF p_agent_id IS NOT NULL THEN
        PERFORM set_config('app.agent_id', p_agent_id::TEXT, false);
    END IF;
    
    IF p_customer_id IS NOT NULL THEN
        PERFORM set_config('app.customer_id', p_customer_id::TEXT, false);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to clear user context
CREATE OR REPLACE FUNCTION clear_user_context()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.user_id', '', false);
    PERFORM set_config('app.user_role', '', false);
    PERFORM set_config('app.agent_id', '', false);
    PERFORM set_config('app.customer_id', '', false);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUDIT LOGGING FOR RLS
-- ============================================================================

-- Log RLS policy violations
CREATE TABLE IF NOT EXISTS rls_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_role TEXT,
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    details JSONB
);

-- Function to log RLS violations
CREATE OR REPLACE FUNCTION log_rls_violation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO rls_violations (
        user_id,
        user_role,
        table_name,
        operation,
        ip_address,
        details
    ) VALUES (
        current_user_id(),
        current_user_role(),
        TG_TABLE_NAME,
        TG_OP,
        inet_client_addr(),
        jsonb_build_object(
            'attempted_row', row_to_json(NEW),
            'timestamp', CURRENT_TIMESTAMP
        )
    );
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION current_user_role() IS 'Get current user role from session context';
COMMENT ON FUNCTION current_user_id() IS 'Get current user ID from session context';
COMMENT ON FUNCTION current_agent_id() IS 'Get current agent ID from session context';
COMMENT ON FUNCTION current_customer_id() IS 'Get current customer ID from session context';
COMMENT ON FUNCTION is_admin() IS 'Check if current user is admin';
COMMENT ON FUNCTION is_agent_manager() IS 'Check if current user is agent manager';
COMMENT ON FUNCTION set_user_context(UUID, TEXT, UUID, UUID) IS 'Set user context for RLS policies';
COMMENT ON FUNCTION clear_user_context() IS 'Clear user context';

-- ============================================================================
-- USAGE EXAMPLE
-- ============================================================================

/*
-- In your application code:

-- 1. Set user context at the beginning of each request
SELECT set_user_context(
    '123e4567-e89b-12d3-a456-426614174000'::UUID,  -- user_id
    'agent',                                          -- user_role
    '123e4567-e89b-12d3-a456-426614174001'::UUID,  -- agent_id
    NULL                                              -- customer_id
);

-- 2. Execute queries (RLS policies automatically applied)
SELECT * FROM transactions;  -- Only sees agent's own transactions

-- 3. Clear context at end of request
SELECT clear_user_context();
*/

