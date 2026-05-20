-- ============================================================================
-- STORED PROCEDURES FOR COMPLEX BUSINESS OPERATIONS
-- Enterprise-grade transaction handling and business logic
-- ============================================================================

-- ============================================================================
-- TRANSACTION PROCESSING
-- ============================================================================

-- Process payment transaction with full validation
CREATE OR REPLACE PROCEDURE process_payment_transaction(
    p_customer_id UUID,
    p_agent_id UUID,
    p_amount NUMERIC(15,2),
    p_currency VARCHAR(3),
    p_payment_method VARCHAR(50),
    p_description TEXT,
    OUT p_transaction_id UUID,
    OUT p_status TEXT,
    OUT p_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_customer_balance NUMERIC(15,2);
    v_agent_status TEXT;
    v_customer_status TEXT;
    v_fee_amount NUMERIC(15,2);
    v_commission_amount NUMERIC(15,2);
BEGIN
    -- Start transaction
    -- Validate agent
    SELECT status INTO v_agent_status
    FROM agents
    WHERE id = p_agent_id;
    
    IF v_agent_status IS NULL THEN
        p_status := 'failed';
        p_message := 'Agent not found';
        RETURN;
    END IF;
    
    IF v_agent_status != 'active' THEN
        p_status := 'failed';
        p_message := 'Agent is not active';
        RETURN;
    END IF;
    
    -- Validate customer
    SELECT status INTO v_customer_status
    FROM customers
    WHERE id = p_customer_id;
    
    IF v_customer_status IS NULL THEN
        p_status := 'failed';
        p_message := 'Customer not found';
        RETURN;
    END IF;
    
    IF v_customer_status != 'active' THEN
        p_status := 'failed';
        p_message := 'Customer is not active';
        RETURN;
    END IF;
    
    -- Check customer balance (for withdrawals/payments)
    SELECT balance INTO v_customer_balance
    FROM balances
    WHERE customer_id = p_customer_id
    AND currency = p_currency;
    
    IF v_customer_balance < p_amount THEN
        p_status := 'failed';
        p_message := 'Insufficient balance';
        RETURN;
    END IF;
    
    -- Calculate fees and commission
    v_fee_amount := p_amount * 0.01; -- 1% fee
    v_commission_amount := p_amount * 0.005; -- 0.5% commission
    
    -- Create transaction
    INSERT INTO transactions (
        id,
        customer_id,
        agent_id,
        amount,
        currency,
        payment_method,
        description,
        fee_amount,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_customer_id,
        p_agent_id,
        p_amount,
        p_currency,
        p_payment_method,
        p_description,
        v_fee_amount,
        'processing',
        CURRENT_TIMESTAMP
    ) RETURNING id INTO p_transaction_id;
    
    -- Update customer balance
    UPDATE balances
    SET balance = balance - p_amount - v_fee_amount,
        updated_at = CURRENT_TIMESTAMP
    WHERE customer_id = p_customer_id
    AND currency = p_currency;
    
    -- Update agent balance (add commission)
    UPDATE balances
    SET balance = balance + v_commission_amount,
        updated_at = CURRENT_TIMESTAMP
    WHERE agent_id = p_agent_id
    AND currency = p_currency;
    
    -- Record commission
    INSERT INTO agent_commissions (
        id,
        agent_id,
        transaction_id,
        commission_amount,
        commission_rate,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_agent_id,
        p_transaction_id,
        v_commission_amount,
        0.005,
        'pending',
        CURRENT_TIMESTAMP
    );
    
    -- Update transaction status
    UPDATE transactions
    SET status = 'completed',
        completed_at = CURRENT_TIMESTAMP
    WHERE id = p_transaction_id;
    
    p_status := 'success';
    p_message := 'Transaction processed successfully';
    
    -- Log audit trail
    INSERT INTO audit_logs (
        id,
        user_id,
        action,
        table_name,
        record_id,
        details,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_agent_id,
        'process_payment',
        'transactions',
        p_transaction_id,
        jsonb_build_object(
            'amount', p_amount,
            'currency', p_currency,
            'customer_id', p_customer_id
        ),
        CURRENT_TIMESTAMP
    );
    
EXCEPTION
    WHEN OTHERS THEN
        p_status := 'failed';
        p_message := SQLERRM;
        RAISE WARNING 'Transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- AGENT COMMISSION CALCULATION
-- ============================================================================

-- Calculate and pay agent commissions for a period
CREATE OR REPLACE PROCEDURE calculate_agent_commissions(
    p_agent_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    OUT p_total_commission NUMERIC(15,2),
    OUT p_transaction_count INTEGER,
    OUT p_status TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_commission_record RECORD;
    v_total_volume NUMERIC(15,2);
    v_commission_rate NUMERIC(5,4);
BEGIN
    -- Calculate total transaction volume
    SELECT 
        COUNT(*) as txn_count,
        SUM(amount) as total_volume
    INTO 
        p_transaction_count,
        v_total_volume
    FROM transactions
    WHERE agent_id = p_agent_id
    AND created_at >= p_period_start
    AND created_at <= p_period_end
    AND status = 'completed';
    
    -- Determine commission rate based on volume
    IF v_total_volume >= 1000000 THEN
        v_commission_rate := 0.01; -- 1% for high volume
    ELSIF v_total_volume >= 500000 THEN
        v_commission_rate := 0.0075; -- 0.75% for medium volume
    ELSE
        v_commission_rate := 0.005; -- 0.5% for low volume
    END IF;
    
    -- Calculate commission
    p_total_commission := v_total_volume * v_commission_rate;
    
    -- Create commission record
    INSERT INTO agent_commissions (
        id,
        agent_id,
        period_start,
        period_end,
        transaction_volume,
        transaction_count,
        commission_amount,
        commission_rate,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_agent_id,
        p_period_start,
        p_period_end,
        v_total_volume,
        p_transaction_count,
        p_total_commission,
        v_commission_rate,
        'calculated',
        CURRENT_TIMESTAMP
    );
    
    p_status := 'success';
    
EXCEPTION
    WHEN OTHERS THEN
        p_status := 'failed';
        p_total_commission := 0;
        p_transaction_count := 0;
        RAISE WARNING 'Commission calculation failed: %', SQLERRM;
END;
$$;

-- Pay agent commissions
CREATE OR REPLACE PROCEDURE pay_agent_commission(
    p_commission_id UUID,
    p_payment_method VARCHAR(50),
    OUT p_status TEXT,
    OUT p_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_agent_id UUID;
    v_commission_amount NUMERIC(15,2);
    v_commission_status TEXT;
BEGIN
    -- Get commission details
    SELECT 
        agent_id,
        commission_amount,
        status
    INTO 
        v_agent_id,
        v_commission_amount,
        v_commission_status
    FROM agent_commissions
    WHERE id = p_commission_id;
    
    -- Validate commission
    IF v_commission_status IS NULL THEN
        p_status := 'failed';
        p_message := 'Commission not found';
        RETURN;
    END IF;
    
    IF v_commission_status = 'paid' THEN
        p_status := 'failed';
        p_message := 'Commission already paid';
        RETURN;
    END IF;
    
    -- Update agent balance
    UPDATE balances
    SET balance = balance + v_commission_amount,
        updated_at = CURRENT_TIMESTAMP
    WHERE agent_id = v_agent_id;
    
    -- Update commission status
    UPDATE agent_commissions
    SET status = 'paid',
        paid_at = CURRENT_TIMESTAMP,
        payment_method = p_payment_method
    WHERE id = p_commission_id;
    
    p_status := 'success';
    p_message := 'Commission paid successfully';
    
    -- Log payment
    INSERT INTO audit_logs (
        id,
        user_id,
        action,
        table_name,
        record_id,
        details,
        created_at
    ) VALUES (
        gen_random_uuid(),
        v_agent_id,
        'pay_commission',
        'agent_commissions',
        p_commission_id,
        jsonb_build_object(
            'amount', v_commission_amount,
            'payment_method', p_payment_method
        ),
        CURRENT_TIMESTAMP
    );
    
EXCEPTION
    WHEN OTHERS THEN
        p_status := 'failed';
        p_message := SQLERRM;
END;
$$;

-- ============================================================================
-- CUSTOMER ONBOARDING
-- ============================================================================

-- Complete customer onboarding process
CREATE OR REPLACE PROCEDURE onboard_customer(
    p_agent_id UUID,
    p_customer_name VARCHAR(255),
    p_phone_number VARCHAR(20),
    p_email VARCHAR(255),
    p_id_number VARCHAR(50),
    p_id_type VARCHAR(50),
    p_address TEXT,
    OUT p_customer_id UUID,
    OUT p_status TEXT,
    OUT p_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_agent_status TEXT;
    v_existing_customer UUID;
BEGIN
    -- Validate agent
    SELECT status INTO v_agent_status
    FROM agents
    WHERE id = p_agent_id;
    
    IF v_agent_status != 'active' THEN
        p_status := 'failed';
        p_message := 'Agent is not active';
        RETURN;
    END IF;
    
    -- Check for duplicate customer
    SELECT id INTO v_existing_customer
    FROM customers
    WHERE phone_number = p_phone_number
    OR email = p_email
    OR id_number = p_id_number
    LIMIT 1;
    
    IF v_existing_customer IS NOT NULL THEN
        p_status := 'failed';
        p_message := 'Customer already exists';
        p_customer_id := v_existing_customer;
        RETURN;
    END IF;
    
    -- Create customer
    INSERT INTO customers (
        id,
        name,
        phone_number,
        email,
        id_number,
        id_type,
        address,
        onboarded_by_agent_id,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_customer_name,
        p_phone_number,
        p_email,
        p_id_number,
        p_id_type,
        p_address,
        p_agent_id,
        'pending_verification',
        CURRENT_TIMESTAMP
    ) RETURNING id INTO p_customer_id;
    
    -- Create KYC record
    INSERT INTO customer_kyc (
        id,
        customer_id,
        verification_status,
        submitted_at,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_customer_id,
        'pending',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );
    
    -- Create default account
    INSERT INTO customer_accounts (
        id,
        customer_id,
        account_number,
        account_type,
        currency,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_customer_id,
        'ACC' || LPAD(nextval('account_number_seq')::TEXT, 10, '0'),
        'savings',
        'USD',
        'active',
        CURRENT_TIMESTAMP
    );
    
    -- Initialize balance
    INSERT INTO balances (
        id,
        customer_id,
        currency,
        balance,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_customer_id,
        'USD',
        0.00,
        CURRENT_TIMESTAMP
    );
    
    p_status := 'success';
    p_message := 'Customer onboarded successfully';
    
    -- Log onboarding
    INSERT INTO audit_logs (
        id,
        user_id,
        action,
        table_name,
        record_id,
        details,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_agent_id,
        'onboard_customer',
        'customers',
        p_customer_id,
        jsonb_build_object(
            'customer_name', p_customer_name,
            'phone_number', p_phone_number
        ),
        CURRENT_TIMESTAMP
    );
    
EXCEPTION
    WHEN OTHERS THEN
        p_status := 'failed';
        p_message := SQLERRM;
        p_customer_id := NULL;
END;
$$;

-- ============================================================================
-- SETTLEMENT PROCESSING
-- ============================================================================

-- Process daily settlement
CREATE OR REPLACE PROCEDURE process_daily_settlement(
    p_settlement_date DATE,
    OUT p_total_amount NUMERIC(15,2),
    OUT p_transaction_count INTEGER,
    OUT p_status TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_settlement_id UUID;
BEGIN
    -- Calculate settlement totals
    SELECT 
        COUNT(*),
        SUM(amount)
    INTO 
        p_transaction_count,
        p_total_amount
    FROM transactions
    WHERE DATE(created_at) = p_settlement_date
    AND status = 'completed'
    AND settled = false;
    
    IF p_transaction_count = 0 THEN
        p_status := 'no_transactions';
        RETURN;
    END IF;
    
    -- Create settlement record
    INSERT INTO settlements (
        id,
        settlement_date,
        total_amount,
        transaction_count,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_settlement_date,
        p_total_amount,
        p_transaction_count,
        'processing',
        CURRENT_TIMESTAMP
    ) RETURNING id INTO v_settlement_id;
    
    -- Mark transactions as settled
    UPDATE transactions
    SET settled = true,
        settlement_id = v_settlement_id,
        settled_at = CURRENT_TIMESTAMP
    WHERE DATE(created_at) = p_settlement_date
    AND status = 'completed'
    AND settled = false;
    
    -- Update settlement status
    UPDATE settlements
    SET status = 'completed',
        completed_at = CURRENT_TIMESTAMP
    WHERE id = v_settlement_id;
    
    p_status := 'success';
    
EXCEPTION
    WHEN OTHERS THEN
        p_status := 'failed';
        p_total_amount := 0;
        p_transaction_count := 0;
        RAISE WARNING 'Settlement failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- FRAUD DETECTION
-- ============================================================================

-- Check transaction for fraud indicators
CREATE OR REPLACE PROCEDURE check_fraud_indicators(
    p_transaction_id UUID,
    OUT p_risk_score NUMERIC(5,2),
    OUT p_risk_level TEXT,
    OUT p_indicators TEXT[],
    OUT p_action TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_transaction RECORD;
    v_customer_avg_amount NUMERIC(15,2);
    v_customer_txn_count INTEGER;
    v_agent_txn_count INTEGER;
BEGIN
    -- Get transaction details
    SELECT * INTO v_transaction
    FROM transactions
    WHERE id = p_transaction_id;
    
    -- Initialize
    p_risk_score := 0;
    p_indicators := ARRAY[]::TEXT[];
    
    -- Check 1: High amount (> 3x customer average)
    SELECT AVG(amount), COUNT(*)
    INTO v_customer_avg_amount, v_customer_txn_count
    FROM transactions
    WHERE customer_id = v_transaction.customer_id
    AND status = 'completed';
    
    IF v_transaction.amount > (v_customer_avg_amount * 3) THEN
        p_risk_score := p_risk_score + 25;
        p_indicators := array_append(p_indicators, 'high_amount');
    END IF;
    
    -- Check 2: Rapid transactions (> 5 in last hour)
    SELECT COUNT(*)
    INTO v_customer_txn_count
    FROM transactions
    WHERE customer_id = v_transaction.customer_id
    AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour';
    
    IF v_customer_txn_count > 5 THEN
        p_risk_score := p_risk_score + 30;
        p_indicators := array_append(p_indicators, 'rapid_transactions');
    END IF;
    
    -- Check 3: New customer (< 7 days old)
    IF v_transaction.created_at - (SELECT created_at FROM customers WHERE id = v_transaction.customer_id) < INTERVAL '7 days' THEN
        p_risk_score := p_risk_score + 15;
        p_indicators := array_append(p_indicators, 'new_customer');
    END IF;
    
    -- Check 4: Unusual time (midnight to 5am)
    IF EXTRACT(HOUR FROM v_transaction.created_at) BETWEEN 0 AND 5 THEN
        p_risk_score := p_risk_score + 10;
        p_indicators := array_append(p_indicators, 'unusual_time');
    END IF;
    
    -- Determine risk level and action
    IF p_risk_score >= 70 THEN
        p_risk_level := 'high';
        p_action := 'block';
    ELSIF p_risk_score >= 40 THEN
        p_risk_level := 'medium';
        p_action := 'review';
    ELSE
        p_risk_level := 'low';
        p_action := 'approve';
    END IF;
    
    -- Create fraud alert if risky
    IF p_risk_score >= 40 THEN
        INSERT INTO fraud_alerts (
            id,
            transaction_id,
            risk_score,
            risk_level,
            indicators,
            action,
            created_at
        ) VALUES (
            gen_random_uuid(),
            p_transaction_id,
            p_risk_score,
            p_risk_level,
            p_indicators,
            p_action,
            CURRENT_TIMESTAMP
        );
    END IF;
    
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON PROCEDURE process_payment_transaction IS 
'Process a payment transaction with full validation and balance updates';

COMMENT ON PROCEDURE calculate_agent_commissions IS 
'Calculate agent commissions for a given period';

COMMENT ON PROCEDURE pay_agent_commission IS 
'Pay out agent commission';

COMMENT ON PROCEDURE onboard_customer IS 
'Complete customer onboarding process with KYC and account creation';

COMMENT ON PROCEDURE process_daily_settlement IS 
'Process daily settlement for all completed transactions';

COMMENT ON PROCEDURE check_fraud_indicators IS 
'Check transaction for fraud indicators and calculate risk score';

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

/*
-- Process payment
CALL process_payment_transaction(
    '123e4567-e89b-12d3-a456-426614174000'::UUID,  -- customer_id
    '123e4567-e89b-12d3-a456-426614174001'::UUID,  -- agent_id
    100.50,                                          -- amount
    'USD',                                           -- currency
    'mobile_money',                                  -- payment_method
    'Payment for goods',                             -- description
    NULL, NULL, NULL                                 -- OUT parameters
);

-- Calculate commissions
CALL calculate_agent_commissions(
    '123e4567-e89b-12d3-a456-426614174001'::UUID,  -- agent_id
    '2025-01-01'::DATE,                             -- period_start
    '2025-01-31'::DATE,                             -- period_end
    NULL, NULL, NULL                                 -- OUT parameters
);

-- Onboard customer
CALL onboard_customer(
    '123e4567-e89b-12d3-a456-426614174001'::UUID,  -- agent_id
    'John Doe',                                      -- customer_name
    '+1234567890',                                   -- phone_number
    'john@example.com',                              -- email
    'ID123456',                                      -- id_number
    'national_id',                                   -- id_type
    '123 Main St',                                   -- address
    NULL, NULL, NULL                                 -- OUT parameters
);
*/

