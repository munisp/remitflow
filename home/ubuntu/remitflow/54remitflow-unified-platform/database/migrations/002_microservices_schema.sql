-- Remittance Platform - Microservices Database Schema
-- Version: 1.0.0
-- Description: Database schema for new microservices (Auth, E-commerce, Communication, Analytics)

-- ============================================================================
-- AUTHENTICATION SERVICE TABLES
-- ============================================================================

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

-- ============================================================================
-- E-COMMERCE ADDITIONAL TABLES
-- ============================================================================

-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value DECIMAL(10, 2) NOT NULL,
    min_purchase_amount DECIMAL(10, 2) DEFAULT 0,
    max_discount_amount DECIMAL(10, 2),
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_coupons_active ON coupons(is_active);

-- Coupon usage table
CREATE TABLE IF NOT EXISTS coupon_usage (
    id SERIAL PRIMARY KEY,
    coupon_id INTEGER REFERENCES coupons(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    discount_amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_coupon_usage_coupon ON coupon_usage(coupon_id);
CREATE INDEX idx_coupon_usage_customer ON coupon_usage(customer_id);

-- Wishlist table
CREATE TABLE IF NOT EXISTS wishlists (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    variant_id INTEGER,
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(customer_id, product_id, variant_id)
);

CREATE INDEX idx_wishlists_customer ON wishlists(customer_id);
CREATE INDEX idx_wishlists_product ON wishlists(product_id);

-- Product recommendations table
CREATE TABLE IF NOT EXISTS product_recommendations (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    recommended_product_id INTEGER NOT NULL,
    recommendation_type VARCHAR(50) NOT NULL,
    score DECIMAL(5, 4) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(product_id, recommended_product_id, recommendation_type)
);

CREATE INDEX idx_recommendations_product ON product_recommendations(product_id);
CREATE INDEX idx_recommendations_score ON product_recommendations(score);

-- ============================================================================
-- ANALYTICS TABLES
-- ============================================================================

-- Pipeline runs table
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id SERIAL PRIMARY KEY,
    pipeline_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    records_processed INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT
);

CREATE INDEX idx_pipeline_runs_type ON pipeline_runs(pipeline_type);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);

-- Sales analytics fact table
CREATE TABLE IF NOT EXISTS fact_sales (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    order_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    tax_amount DECIMAL(10, 2) DEFAULT 0,
    shipping_cost DECIMAL(10, 2) DEFAULT 0,
    payment_method VARCHAR(50),
    order_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fact_sales_date ON fact_sales(date);
CREATE INDEX idx_fact_sales_customer ON fact_sales(customer_id);
CREATE INDEX idx_fact_sales_product ON fact_sales(product_id);

-- User analytics fact table
CREATE TABLE IF NOT EXISTS fact_users (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    user_id INTEGER NOT NULL,
    registration_date DATE,
    last_login_date DATE,
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10, 2) DEFAULT 0,
    average_order_value DECIMAL(10, 2) DEFAULT 0,
    days_since_last_order INTEGER,
    customer_segment VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fact_users_date ON fact_users(date);
CREATE INDEX idx_fact_users_user ON fact_users(user_id);
CREATE INDEX idx_fact_users_segment ON fact_users(customer_segment);

-- Inventory analytics fact table
CREATE TABLE IF NOT EXISTS fact_inventory (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    product_id INTEGER NOT NULL,
    sku VARCHAR(100) NOT NULL,
    warehouse_id INTEGER NOT NULL,
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,
    quantity_sold INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 0,
    days_of_supply INTEGER,
    turnover_rate DECIMAL(10, 4),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fact_inventory_date ON fact_inventory(date);
CREATE INDEX idx_fact_inventory_product ON fact_inventory(product_id);
CREATE INDEX idx_fact_inventory_sku ON fact_inventory(sku);

-- Financial analytics fact table
CREATE TABLE IF NOT EXISTS fact_financial (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    revenue DECIMAL(12, 2) DEFAULT 0,
    cost_of_goods_sold DECIMAL(12, 2) DEFAULT 0,
    gross_profit DECIMAL(12, 2) DEFAULT 0,
    operating_expenses DECIMAL(12, 2) DEFAULT 0,
    net_profit DECIMAL(12, 2) DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    average_order_value DECIMAL(10, 2) DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    returning_customers INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fact_financial_date ON fact_financial(date);

-- Customer behavior analytics
CREATE TABLE IF NOT EXISTS fact_customer_behavior (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    customer_id INTEGER NOT NULL,
    page_views INTEGER DEFAULT 0,
    session_duration INTEGER DEFAULT 0,
    products_viewed INTEGER DEFAULT 0,
    cart_additions INTEGER DEFAULT 0,
    cart_abandonments INTEGER DEFAULT 0,
    purchases INTEGER DEFAULT 0,
    conversion_rate DECIMAL(5, 4),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fact_behavior_date ON fact_customer_behavior(date);
CREATE INDEX idx_fact_behavior_customer ON fact_customer_behavior(customer_id);

-- ============================================================================
-- EMAIL TEMPLATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    variables JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_email_templates_name ON email_templates(name);

-- Insert default email templates
INSERT INTO email_templates (name, subject, body_text, body_html, variables) VALUES
(
    'welcome',
    'Welcome to Remittance Platform!',
    'Hello {{name}},\n\nWelcome to Remittance Platform! Your account has been successfully created.\n\nBest regards,\nRemittance Platform Team',
    '<html><body><h1>Hello {{name}}</h1><p>Welcome to Remittance Platform! Your account has been successfully created.</p><p>Best regards,<br>Remittance Platform Team</p></body></html>',
    '["name"]'::jsonb
),
(
    'password_reset',
    'Password Reset Request',
    'Hello {{name}},\n\nYou requested a password reset. Click the link below to reset your password:\n\n{{reset_link}}\n\nThis link expires in {{expiry_hours}} hours.\n\nBest regards,\nRemittance Platform Team',
    '<html><body><h1>Hello {{name}}</h1><p>You requested a password reset. Click the link below to reset your password:</p><p><a href="{{reset_link}}">Reset Password</a></p><p>This link expires in {{expiry_hours}} hours.</p><p>Best regards,<br>Remittance Platform Team</p></body></html>',
    '["name", "reset_link", "expiry_hours"]'::jsonb
),
(
    'order_confirmation',
    'Order Confirmation - Order #{{order_number}}',
    'Hello {{name}},\n\nThank you for your order! Your order #{{order_number}} has been confirmed.\n\nOrder Total: {{total}}\n\nWe will send you another email when your order ships.\n\nBest regards,\nRemittance Platform Team',
    '<html><body><h1>Hello {{name}}</h1><p>Thank you for your order! Your order #{{order_number}} has been confirmed.</p><p><strong>Order Total: {{total}}</strong></p><p>We will send you another email when your order ships.</p><p>Best regards,<br>Remittance Platform Team</p></body></html>',
    '["name", "order_number", "total"]'::jsonb
),
(
    'order_shipped',
    'Your Order Has Shipped - Order #{{order_number}}',
    'Hello {{name}},\n\nGreat news! Your order #{{order_number}} has shipped.\n\nTracking Number: {{tracking_number}}\nCarrier: {{carrier}}\n\nTrack your order: {{tracking_url}}\n\nBest regards,\nRemittance Platform Team',
    '<html><body><h1>Hello {{name}}</h1><p>Great news! Your order #{{order_number}} has shipped.</p><p><strong>Tracking Number:</strong> {{tracking_number}}<br><strong>Carrier:</strong> {{carrier}}</p><p><a href="{{tracking_url}}">Track Your Order</a></p><p>Best regards,<br>Remittance Platform Team</p></body></html>',
    '["name", "order_number", "tracking_number", "carrier", "tracking_url"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- COMPLETION
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Microservices database schema migration completed successfully!';
    RAISE NOTICE 'Additional tables created for Authentication, E-commerce, Communication, and Analytics services';
END $$;

