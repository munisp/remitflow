-- Remittance Platform - Seed Data
-- Version: 1.0.0
-- Description: Sample data for development and testing

-- ============================================================================
-- USERS (Authentication)
-- ============================================================================

-- Insert test users (passwords are hashed with bcrypt: "Password123!")
INSERT INTO users (email, password_hash, full_name, role, is_active, is_verified) VALUES
('admin@remittance.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEgZK8W', 'System Administrator', 'admin', TRUE, TRUE),
('john.doe@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEgZK8W', 'John Doe', 'customer', TRUE, TRUE),
('jane.smith@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEgZK8W', 'Jane Smith', 'customer', TRUE, TRUE),
('bob.wilson@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEgZK8W', 'Bob Wilson', 'customer', TRUE, TRUE),
('alice.johnson@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEgZK8W', 'Alice Johnson', 'customer', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- PRODUCT CATEGORIES
-- ============================================================================

INSERT INTO product_categories (name, slug, description, is_active, display_order) VALUES
('Electronics', 'electronics', 'Electronic devices, computers, and accessories', TRUE, 1),
('Smartphones', 'smartphones', 'Mobile phones and accessories', TRUE, 2),
('Laptops', 'laptops', 'Laptops and notebook computers', TRUE, 3),
('Tablets', 'tablets', 'Tablets and e-readers', TRUE, 4),
('Clothing', 'clothing', 'Apparel and fashion items', TRUE, 5),
('Men''s Clothing', 'mens-clothing', 'Clothing for men', TRUE, 6),
('Women''s Clothing', 'womens-clothing', 'Clothing for women', TRUE, 7),
('Books', 'books', 'Books and publications', TRUE, 8),
('Fiction', 'fiction', 'Fiction books and novels', TRUE, 9),
('Non-Fiction', 'non-fiction', 'Non-fiction and educational books', TRUE, 10),
('Home & Garden', 'home-garden', 'Home improvement and garden supplies', TRUE, 11),
('Sports', 'sports', 'Sports equipment and accessories', TRUE, 12)
ON CONFLICT (slug) DO NOTHING;

-- Update parent categories
UPDATE product_categories SET parent_id = (SELECT id FROM product_categories WHERE slug = 'electronics') WHERE slug IN ('smartphones', 'laptops', 'tablets');
UPDATE product_categories SET parent_id = (SELECT id FROM product_categories WHERE slug = 'clothing') WHERE slug IN ('mens-clothing', 'womens-clothing');
UPDATE product_categories SET parent_id = (SELECT id FROM product_categories WHERE slug = 'books') WHERE slug IN ('fiction', 'non-fiction');

-- ============================================================================
-- PRODUCTS
-- ============================================================================

INSERT INTO products (name, slug, description, category_id, brand, sku, base_price, compare_at_price, cost_price, status, stock_quantity, low_stock_threshold, weight, rating_average, rating_count, is_featured, tags) VALUES
-- Electronics
('iPhone 15 Pro', 'iphone-15-pro', 'Latest iPhone with A17 Pro chip and titanium design', (SELECT id FROM product_categories WHERE slug = 'smartphones'), 'Apple', 'IPHONE-15-PRO-128', 999.00, 1099.00, 750.00, 'active', 50, 10, 0.187, 4.8, 245, TRUE, ARRAY['smartphone', 'apple', 'featured']),
('Samsung Galaxy S24', 'samsung-galaxy-s24', 'Flagship Android phone with AI features', (SELECT id FROM product_categories WHERE slug = 'smartphones'), 'Samsung', 'GALAXY-S24-256', 899.00, 999.00, 650.00, 'active', 45, 10, 0.168, 4.7, 189, TRUE, ARRAY['smartphone', 'samsung', 'android']),
('MacBook Pro 14"', 'macbook-pro-14', 'Professional laptop with M3 chip', (SELECT id FROM product_categories WHERE slug = 'laptops'), 'Apple', 'MBP-14-M3-512', 1999.00, 2199.00, 1500.00, 'active', 25, 5, 1.55, 4.9, 312, TRUE, ARRAY['laptop', 'apple', 'professional']),
('Dell XPS 15', 'dell-xps-15', 'High-performance Windows laptop', (SELECT id FROM product_categories WHERE slug = 'laptops'), 'Dell', 'XPS-15-I7-512', 1599.00, 1799.00, 1200.00, 'active', 30, 5, 1.86, 4.6, 156, FALSE, ARRAY['laptop', 'dell', 'windows']),
('iPad Pro 12.9"', 'ipad-pro-12', 'Professional tablet with M2 chip', (SELECT id FROM product_categories WHERE slug = 'tablets'), 'Apple', 'IPAD-PRO-12-256', 1099.00, 1199.00, 850.00, 'active', 40, 10, 0.682, 4.8, 198, TRUE, ARRAY['tablet', 'apple', 'professional']),

-- Clothing
('Men''s Cotton T-Shirt', 'mens-cotton-tshirt', 'Comfortable cotton t-shirt for everyday wear', (SELECT id FROM product_categories WHERE slug = 'mens-clothing'), 'BasicWear', 'TSHIRT-M-BLK-L', 19.99, 29.99, 8.00, 'active', 200, 20, 0.2, 4.3, 89, FALSE, ARRAY['clothing', 'men', 'casual']),
('Women''s Denim Jeans', 'womens-denim-jeans', 'Classic denim jeans with modern fit', (SELECT id FROM product_categories WHERE slug = 'womens-clothing'), 'DenimCo', 'JEANS-W-BLU-M', 49.99, 69.99, 25.00, 'active', 150, 20, 0.5, 4.5, 134, FALSE, ARRAY['clothing', 'women', 'jeans']),
('Men''s Leather Jacket', 'mens-leather-jacket', 'Premium leather jacket for style and warmth', (SELECT id FROM product_categories WHERE slug = 'mens-clothing'), 'LeatherLux', 'JACKET-M-BRN-L', 199.99, 249.99, 100.00, 'active', 50, 10, 1.2, 4.7, 67, TRUE, ARRAY['clothing', 'men', 'jacket', 'leather']),

-- Books
('The Great Gatsby', 'the-great-gatsby', 'Classic American novel by F. Scott Fitzgerald', (SELECT id FROM product_categories WHERE slug = 'fiction'), 'Penguin Classics', 'BOOK-GATSBY-PB', 12.99, 15.99, 5.00, 'active', 100, 20, 0.3, 4.6, 2341, FALSE, ARRAY['book', 'fiction', 'classic']),
('Atomic Habits', 'atomic-habits', 'Practical guide to building good habits', (SELECT id FROM product_categories WHERE slug = 'non-fiction'), 'Penguin Random House', 'BOOK-HABITS-HC', 24.99, 29.99, 12.00, 'active', 120, 20, 0.5, 4.8, 5678, TRUE, ARRAY['book', 'self-help', 'bestseller']),

-- Home & Garden
('Robot Vacuum Cleaner', 'robot-vacuum-cleaner', 'Smart vacuum with mapping technology', (SELECT id FROM product_categories WHERE slug = 'home-garden'), 'CleanBot', 'VACUUM-ROBOT-X1', 299.99, 399.99, 180.00, 'active', 60, 10, 3.5, 4.4, 234, TRUE, ARRAY['home', 'cleaning', 'smart']),

-- Sports
('Yoga Mat Premium', 'yoga-mat-premium', 'Non-slip yoga mat with carrying strap', (SELECT id FROM product_categories WHERE slug = 'sports'), 'FitGear', 'YOGA-MAT-BLU', 39.99, 49.99, 15.00, 'active', 80, 15, 1.2, 4.5, 178, FALSE, ARRAY['sports', 'yoga', 'fitness'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- PRODUCT IMAGES
-- ============================================================================

INSERT INTO product_images (product_id, url, alt_text, position, is_primary) VALUES
((SELECT id FROM products WHERE slug = 'iphone-15-pro'), 'https://example.com/images/iphone-15-pro-1.jpg', 'iPhone 15 Pro front view', 1, TRUE),
((SELECT id FROM products WHERE slug = 'iphone-15-pro'), 'https://example.com/images/iphone-15-pro-2.jpg', 'iPhone 15 Pro back view', 2, FALSE),
((SELECT id FROM products WHERE slug = 'samsung-galaxy-s24'), 'https://example.com/images/galaxy-s24-1.jpg', 'Samsung Galaxy S24', 1, TRUE),
((SELECT id FROM products WHERE slug = 'macbook-pro-14'), 'https://example.com/images/macbook-pro-14-1.jpg', 'MacBook Pro 14 inch', 1, TRUE),
((SELECT id FROM products WHERE slug = 'ipad-pro-12'), 'https://example.com/images/ipad-pro-12-1.jpg', 'iPad Pro 12.9 inch', 1, TRUE);

-- ============================================================================
-- PRODUCT REVIEWS
-- ============================================================================

INSERT INTO product_reviews (product_id, customer_id, rating, title, comment, verified_purchase, is_approved) VALUES
((SELECT id FROM products WHERE slug = 'iphone-15-pro'), (SELECT id FROM users WHERE email = 'john.doe@example.com'), 5, 'Amazing phone!', 'Best iPhone yet. The titanium design is beautiful and the camera is incredible.', TRUE, TRUE),
((SELECT id FROM products WHERE slug = 'iphone-15-pro'), (SELECT id FROM users WHERE email = 'jane.smith@example.com'), 4, 'Great but expensive', 'Love the phone but wish it was more affordable.', TRUE, TRUE),
((SELECT id FROM products WHERE slug = 'macbook-pro-14'), (SELECT id FROM users WHERE email = 'bob.wilson@example.com'), 5, 'Perfect for developers', 'M3 chip is blazing fast. Battery life is excellent.', TRUE, TRUE),
((SELECT id FROM products WHERE slug = 'atomic-habits'), (SELECT id FROM users WHERE email = 'alice.johnson@example.com'), 5, 'Life changing book', 'This book helped me build better habits. Highly recommended!', TRUE, TRUE);

-- ============================================================================
-- COUPONS
-- ============================================================================

INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, valid_from, valid_until, is_active) VALUES
('WELCOME10', 'Welcome discount for new customers', 'percentage', 10.00, 50.00, 50.00, 1000, NOW(), NOW() + INTERVAL '30 days', TRUE),
('SAVE20', '20% off on orders over $100', 'percentage', 20.00, 100.00, 100.00, 500, NOW(), NOW() + INTERVAL '60 days', TRUE),
('FREESHIP', 'Free shipping on all orders', 'fixed', 10.00, 0.00, 10.00, NULL, NOW(), NOW() + INTERVAL '90 days', TRUE),
('SUMMER50', '$50 off on orders over $200', 'fixed', 50.00, 200.00, 50.00, 200, NOW(), NOW() + INTERVAL '45 days', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SAMPLE ORDERS
-- ============================================================================

-- Order 1: John Doe's order
INSERT INTO orders (order_number, customer_id, customer_email, status, payment_status, fulfillment_status, items, subtotal, shipping_cost, tax, discount, total, shipping_address, billing_address, payment_method) VALUES
('ORD-2024-00001', 
 (SELECT id FROM users WHERE email = 'john.doe@example.com'),
 'john.doe@example.com',
 'completed',
 'paid',
 'fulfilled',
 '[{"product_id": 1, "name": "iPhone 15 Pro", "sku": "IPHONE-15-PRO-128", "quantity": 1, "unit_price": 999.00, "total": 999.00}]'::jsonb,
 999.00,
 10.00,
 89.91,
 0.00,
 1098.91,
 '{"name": "John Doe", "address": "123 Main St", "city": "New York", "state": "NY", "zip": "10001", "country": "USA", "phone": "+1234567890"}'::jsonb,
 '{"name": "John Doe", "address": "123 Main St", "city": "New York", "state": "NY", "zip": "10001", "country": "USA", "phone": "+1234567890"}'::jsonb,
 'credit_card'
);

-- Order 2: Jane Smith's order
INSERT INTO orders (order_number, customer_id, customer_email, status, payment_status, fulfillment_status, items, subtotal, shipping_cost, tax, discount, total, shipping_address, billing_address, payment_method) VALUES
('ORD-2024-00002',
 (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
 'jane.smith@example.com',
 'processing',
 'paid',
 'unfulfilled',
 '[{"product_id": 3, "name": "MacBook Pro 14\"", "sku": "MBP-14-M3-512", "quantity": 1, "unit_price": 1999.00, "total": 1999.00}]'::jsonb,
 1999.00,
 15.00,
 179.91,
 0.00,
 2193.91,
 '{"name": "Jane Smith", "address": "456 Oak Ave", "city": "Los Angeles", "state": "CA", "zip": "90001", "country": "USA", "phone": "+1234567891"}'::jsonb,
 '{"name": "Jane Smith", "address": "456 Oak Ave", "city": "Los Angeles", "state": "CA", "zip": "90001", "country": "USA", "phone": "+1234567891"}'::jsonb,
 'paypal'
);

-- Order 3: Bob Wilson's order
INSERT INTO orders (order_number, customer_id, customer_email, status, payment_status, fulfillment_status, items, subtotal, shipping_cost, tax, discount, total, shipping_address, billing_address, payment_method) VALUES
('ORD-2024-00003',
 (SELECT id FROM users WHERE email = 'bob.wilson@example.com'),
 'bob.wilson@example.com',
 'pending',
 'pending',
 'unfulfilled',
 '[{"product_id": 10, "name": "Atomic Habits", "sku": "BOOK-HABITS-HC", "quantity": 2, "unit_price": 24.99, "total": 49.98}, {"product_id": 12, "name": "Yoga Mat Premium", "sku": "YOGA-MAT-BLU", "quantity": 1, "unit_price": 39.99, "total": 39.99}]'::jsonb,
 89.97,
 8.00,
 8.10,
 0.00,
 106.07,
 '{"name": "Bob Wilson", "address": "789 Pine Rd", "city": "Chicago", "state": "IL", "zip": "60601", "country": "USA", "phone": "+1234567892"}'::jsonb,
 '{"name": "Bob Wilson", "address": "789 Pine Rd", "city": "Chicago", "state": "IL", "zip": "60601", "country": "USA", "phone": "+1234567892"}'::jsonb,
 'credit_card'
);

-- ============================================================================
-- INVENTORY
-- ============================================================================

-- Warehouse 1 inventory
INSERT INTO inventory (product_id, sku, warehouse_id, quantity_available, quantity_reserved, reorder_point, reorder_quantity) VALUES
((SELECT id FROM products WHERE slug = 'iphone-15-pro'), 'IPHONE-15-PRO-128', 1, 50, 5, 10, 25),
((SELECT id FROM products WHERE slug = 'samsung-galaxy-s24'), 'GALAXY-S24-256', 1, 45, 3, 10, 25),
((SELECT id FROM products WHERE slug = 'macbook-pro-14'), 'MBP-14-M3-512', 1, 25, 2, 5, 15),
((SELECT id FROM products WHERE slug = 'dell-xps-15'), 'XPS-15-I7-512', 1, 30, 0, 5, 15),
((SELECT id FROM products WHERE slug = 'ipad-pro-12'), 'IPAD-PRO-12-256', 1, 40, 4, 10, 20),
((SELECT id FROM products WHERE slug = 'mens-cotton-tshirt'), 'TSHIRT-M-BLK-L', 1, 200, 10, 20, 100),
((SELECT id FROM products WHERE slug = 'womens-denim-jeans'), 'JEANS-W-BLU-M', 1, 150, 8, 20, 75),
((SELECT id FROM products WHERE slug = 'mens-leather-jacket'), 'JACKET-M-BRN-L', 1, 50, 2, 10, 25),
((SELECT id FROM products WHERE slug = 'the-great-gatsby'), 'BOOK-GATSBY-PB', 1, 100, 5, 20, 50),
((SELECT id FROM products WHERE slug = 'atomic-habits'), 'BOOK-HABITS-HC', 1, 120, 8, 20, 60),
((SELECT id FROM products WHERE slug = 'robot-vacuum-cleaner'), 'VACUUM-ROBOT-X1', 1, 60, 3, 10, 30),
((SELECT id FROM products WHERE slug = 'yoga-mat-premium'), 'YOGA-MAT-BLU', 1, 80, 4, 15, 40)
ON CONFLICT (sku, warehouse_id) DO NOTHING;

-- ============================================================================
-- COMPLETION
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Seed data loaded successfully!';
    RAISE NOTICE 'Created:';
    RAISE NOTICE '  - 5 test users';
    RAISE NOTICE '  - 12 product categories';
    RAISE NOTICE '  - 12 products';
    RAISE NOTICE '  - 5 product images';
    RAISE NOTICE '  - 4 product reviews';
    RAISE NOTICE '  - 4 coupons';
    RAISE NOTICE '  - 3 sample orders';
    RAISE NOTICE '  - 12 inventory records';
    RAISE NOTICE '';
    RAISE NOTICE 'Test user credentials:';
    RAISE NOTICE '  Email: admin@remittance.com';
    RAISE NOTICE '  Password: Password123!';
END $$;

