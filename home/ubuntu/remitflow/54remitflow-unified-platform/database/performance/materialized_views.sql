-- ============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE OPTIMIZATION
-- Pre-computed aggregations for fast analytics
-- ============================================================================

-- ============================================================================
-- TRANSACTION ANALYTICS
-- ============================================================================

-- Daily transaction summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_transaction_summary AS
SELECT 
    DATE(created_at) as transaction_date,
    COUNT(*) as total_transactions,
    COUNT(DISTINCT customer_id) as unique_customers,
    COUNT(DISTINCT agent_id) as unique_agents,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount,
    MIN(amount) as min_amount,
    MAX(amount) as max_amount,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
    ROUND(
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        COUNT(*)::NUMERIC * 100, 
        2
    ) as success_rate
FROM transactions
GROUP BY DATE(created_at);

CREATE UNIQUE INDEX ON mv_daily_transaction_summary(transaction_date);
CREATE INDEX ON mv_daily_transaction_summary(total_amount);

COMMENT ON MATERIALIZED VIEW mv_daily_transaction_summary IS 
'Daily aggregated transaction metrics for fast dashboard queries';

-- Weekly transaction summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_weekly_transaction_summary AS
SELECT 
    DATE_TRUNC('week', created_at) as week_start,
    COUNT(*) as total_transactions,
    COUNT(DISTINCT customer_id) as unique_customers,
    COUNT(DISTINCT agent_id) as unique_agents,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount,
    ROUND(
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        COUNT(*)::NUMERIC * 100, 
        2
    ) as success_rate
FROM transactions
GROUP BY DATE_TRUNC('week', created_at);

CREATE UNIQUE INDEX ON mv_weekly_transaction_summary(week_start);

-- Monthly transaction summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_transaction_summary AS
SELECT 
    DATE_TRUNC('month', created_at) as month_start,
    EXTRACT(YEAR FROM created_at) as year,
    EXTRACT(MONTH FROM created_at) as month,
    COUNT(*) as total_transactions,
    COUNT(DISTINCT customer_id) as unique_customers,
    COUNT(DISTINCT agent_id) as unique_agents,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount,
    ROUND(
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        COUNT(*)::NUMERIC * 100, 
        2
    ) as success_rate
FROM transactions
GROUP BY DATE_TRUNC('month', created_at), EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at);

CREATE UNIQUE INDEX ON mv_monthly_transaction_summary(month_start);

-- ============================================================================
-- AGENT PERFORMANCE
-- ============================================================================

-- Agent performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_agent_performance AS
SELECT 
    a.id as agent_id,
    a.name as agent_name,
    a.status as agent_status,
    COUNT(t.id) as total_transactions,
    SUM(t.amount) as total_volume,
    AVG(t.amount) as avg_transaction_amount,
    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_transactions,
    SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed_transactions,
    ROUND(
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        NULLIF(COUNT(t.id), 0)::NUMERIC * 100, 
        2
    ) as success_rate,
    COUNT(DISTINCT t.customer_id) as unique_customers,
    SUM(ac.commission_amount) as total_commissions,
    MAX(t.created_at) as last_transaction_date,
    CURRENT_TIMESTAMP as last_updated
FROM agents a
LEFT JOIN transactions t ON a.id = t.agent_id
LEFT JOIN agent_commissions ac ON a.id = ac.agent_id
GROUP BY a.id, a.name, a.status;

CREATE UNIQUE INDEX ON mv_agent_performance(agent_id);
CREATE INDEX ON mv_agent_performance(total_volume DESC);
CREATE INDEX ON mv_agent_performance(success_rate DESC);

COMMENT ON MATERIALIZED VIEW mv_agent_performance IS 
'Agent performance metrics for leaderboards and reports';

-- Top performing agents (last 30 days)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_agents_30d AS
SELECT 
    a.id as agent_id,
    a.name as agent_name,
    COUNT(t.id) as transaction_count,
    SUM(t.amount) as total_volume,
    SUM(ac.commission_amount) as total_commissions,
    ROUND(
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        NULLIF(COUNT(t.id), 0)::NUMERIC * 100, 
        2
    ) as success_rate,
    RANK() OVER (ORDER BY SUM(t.amount) DESC) as volume_rank,
    RANK() OVER (ORDER BY COUNT(t.id) DESC) as transaction_rank
FROM agents a
LEFT JOIN transactions t ON a.id = t.agent_id 
    AND t.created_at >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN agent_commissions ac ON a.id = ac.agent_id
    AND ac.period_start >= CURRENT_DATE - INTERVAL '30 days'
WHERE a.status = 'active'
GROUP BY a.id, a.name
ORDER BY total_volume DESC
LIMIT 100;

CREATE UNIQUE INDEX ON mv_top_agents_30d(agent_id);

-- ============================================================================
-- CUSTOMER ANALYTICS
-- ============================================================================

-- Customer transaction summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_summary AS
SELECT 
    c.id as customer_id,
    c.name as customer_name,
    c.status as customer_status,
    COUNT(t.id) as total_transactions,
    SUM(t.amount) as total_spent,
    AVG(t.amount) as avg_transaction_amount,
    MAX(t.created_at) as last_transaction_date,
    MIN(t.created_at) as first_transaction_date,
    EXTRACT(DAY FROM (MAX(t.created_at) - MIN(t.created_at))) as customer_lifetime_days,
    COUNT(DISTINCT DATE(t.created_at)) as active_days,
    CURRENT_TIMESTAMP as last_updated
FROM customers c
LEFT JOIN transactions t ON c.id = t.customer_id
GROUP BY c.id, c.name, c.status;

CREATE UNIQUE INDEX ON mv_customer_summary(customer_id);
CREATE INDEX ON mv_customer_summary(total_spent DESC);

-- ============================================================================
-- FINANCIAL ANALYTICS
-- ============================================================================

-- Daily financial summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_financial_summary AS
SELECT 
    DATE(created_at) as date,
    SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) as total_deposits,
    SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END) as total_withdrawals,
    SUM(CASE WHEN transaction_type = 'transfer' THEN amount ELSE 0 END) as total_transfers,
    SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END) as total_payments,
    SUM(amount) as total_volume,
    COUNT(*) as transaction_count,
    SUM(fee_amount) as total_fees_collected,
    AVG(fee_amount) as avg_fee,
    CURRENT_TIMESTAMP as last_updated
FROM transactions
WHERE status = 'completed'
GROUP BY DATE(created_at);

CREATE UNIQUE INDEX ON mv_daily_financial_summary(date);

-- ============================================================================
-- COMMISSION ANALYTICS
-- ============================================================================

-- Agent commission summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_agent_commission_summary AS
SELECT 
    agent_id,
    DATE_TRUNC('month', period_start) as month,
    SUM(commission_amount) as total_commission,
    SUM(transaction_volume) as total_volume,
    COUNT(*) as commission_count,
    AVG(commission_rate) as avg_commission_rate,
    MAX(period_end) as last_period_end,
    CURRENT_TIMESTAMP as last_updated
FROM agent_commissions
WHERE status = 'paid'
GROUP BY agent_id, DATE_TRUNC('month', period_start);

CREATE INDEX ON mv_agent_commission_summary(agent_id, month);

-- ============================================================================
-- PAYMENT METHOD ANALYTICS
-- ============================================================================

-- Payment method usage
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_payment_method_stats AS
SELECT 
    payment_method,
    COUNT(*) as transaction_count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_count,
    ROUND(
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC / 
        COUNT(*)::NUMERIC * 100, 
        2
    ) as success_rate,
    CURRENT_TIMESTAMP as last_updated
FROM transactions
GROUP BY payment_method;

CREATE UNIQUE INDEX ON mv_payment_method_stats(payment_method);

-- ============================================================================
-- GEOGRAPHIC ANALYTICS
-- ============================================================================

-- Transaction volume by region
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_regional_stats AS
SELECT 
    a.region,
    a.district,
    COUNT(t.id) as transaction_count,
    SUM(t.amount) as total_volume,
    COUNT(DISTINCT t.customer_id) as unique_customers,
    COUNT(DISTINCT t.agent_id) as active_agents,
    AVG(t.amount) as avg_transaction_amount,
    CURRENT_TIMESTAMP as last_updated
FROM transactions t
JOIN agents a ON t.agent_id = a.id
GROUP BY a.region, a.district;

CREATE INDEX ON mv_regional_stats(region, district);

-- ============================================================================
-- FRAUD DETECTION ANALYTICS
-- ============================================================================

-- High-risk transaction patterns
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_fraud_risk_summary AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_flagged,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_risk_count,
    SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END) as medium_risk_count,
    SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END) as low_risk_count,
    SUM(amount) as total_flagged_amount,
    COUNT(DISTINCT customer_id) as unique_customers_flagged,
    COUNT(DISTINCT agent_id) as unique_agents_flagged,
    CURRENT_TIMESTAMP as last_updated
FROM fraud_alerts
GROUP BY DATE(created_at);

CREATE UNIQUE INDEX ON mv_fraud_risk_summary(date);

-- ============================================================================
-- REFRESH FUNCTIONS
-- ============================================================================

-- Refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TABLE(view_name TEXT, refresh_time INTERVAL) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    view_record RECORD;
BEGIN
    FOR view_record IN 
        SELECT matviewname 
        FROM pg_matviews 
        WHERE schemaname = 'public'
        ORDER BY matviewname
    LOOP
        start_time := clock_timestamp();
        
        EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || view_record.matviewname;
        
        end_time := clock_timestamp();
        
        view_name := view_record.matviewname;
        refresh_time := end_time - start_time;
        
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Refresh specific materialized view
CREATE OR REPLACE FUNCTION refresh_materialized_view(p_view_name TEXT)
RETURNS VOID AS $$
BEGIN
    EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || p_view_name;
END;
$$ LANGUAGE plpgsql;

-- Refresh transaction-related views
CREATE OR REPLACE FUNCTION refresh_transaction_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_transaction_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_weekly_transaction_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_transaction_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_financial_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_payment_method_stats;
END;
$$ LANGUAGE plpgsql;

-- Refresh agent-related views
CREATE OR REPLACE FUNCTION refresh_agent_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_performance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_agents_30d;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_commission_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTOMATIC REFRESH SCHEDULING
-- ============================================================================

-- Create refresh log table
CREATE TABLE IF NOT EXISTS mv_refresh_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_name TEXT NOT NULL,
    refresh_started_at TIMESTAMPTZ NOT NULL,
    refresh_completed_at TIMESTAMPTZ,
    refresh_duration INTERVAL,
    status TEXT CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    rows_affected BIGINT
);

-- Function to log refresh
CREATE OR REPLACE FUNCTION log_mv_refresh(
    p_view_name TEXT,
    p_status TEXT,
    p_duration INTERVAL DEFAULT NULL,
    p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO mv_refresh_log (
        view_name,
        refresh_started_at,
        refresh_completed_at,
        refresh_duration,
        status,
        error_message
    ) VALUES (
        p_view_name,
        CURRENT_TIMESTAMP,
        CASE WHEN p_status = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
        p_duration,
        p_status,
        p_error
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION refresh_all_materialized_views() IS 
'Refresh all materialized views and return timing information';

COMMENT ON FUNCTION refresh_materialized_view(TEXT) IS 
'Refresh a specific materialized view by name';

COMMENT ON FUNCTION refresh_transaction_views() IS 
'Refresh all transaction-related materialized views';

COMMENT ON FUNCTION refresh_agent_views() IS 
'Refresh all agent-related materialized views';

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

/*
-- Refresh all views
SELECT * FROM refresh_all_materialized_views();

-- Refresh specific view
SELECT refresh_materialized_view('mv_daily_transaction_summary');

-- Refresh transaction views only
SELECT refresh_transaction_views();

-- Query materialized views (fast!)
SELECT * FROM mv_daily_transaction_summary 
WHERE transaction_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY transaction_date DESC;

SELECT * FROM mv_top_agents_30d LIMIT 10;

-- Schedule refresh (use pg_cron or external scheduler)
-- Every hour: refresh transaction views
-- Every 6 hours: refresh agent views
-- Every 24 hours: refresh all views
*/

