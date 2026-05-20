-- ============================================================================
-- SUPPLY CHAIN MANAGEMENT SCHEMA
-- Complete database schema for inventory, warehouses, suppliers, and logistics
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE warehouse_type AS ENUM (
    'distribution_center',
    'fulfillment_center',
    'retail_store',
    'cross_dock',
    'cold_storage',
    'bonded_warehouse'
);

CREATE TYPE inventory_status AS ENUM (
    'available',
    'reserved',
    'in_transit',
    'damaged',
    'expired',
    'quarantine',
    'returned'
);

CREATE TYPE stock_movement_type AS ENUM (
    'inbound',
    'outbound',
    'transfer',
    'adjustment',
    'return',
    'damage',
    'expiry'
);

CREATE TYPE purchase_order_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'sent_to_supplier',
    'acknowledged',
    'partially_received',
    'received',
    'cancelled',
    'closed'
);

CREATE TYPE shipment_status AS ENUM (
    'pending',
    'picked',
    'packed',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'failed_delivery',
    'returned'
);

CREATE TYPE supplier_status AS ENUM (
    'active',
    'inactive',
    'suspended',
    'blacklisted'
);

-- ============================================================================
-- WAREHOUSES
-- ============================================================================

CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    type warehouse_type NOT NULL,
    
    -- Location
    address JSONB NOT NULL,
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Capacity
    total_capacity_sqft NUMERIC(12, 2),
    available_capacity_sqft NUMERIC(12, 2),
    max_weight_capacity_kg NUMERIC(12, 2),
    
    -- Contact
    manager_name VARCHAR(200),
    manager_email VARCHAR(200),
    manager_phone VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT check_capacity CHECK (available_capacity_sqft <= total_capacity_sqft)
);

CREATE INDEX idx_warehouses_code ON warehouses(code);
CREATE INDEX idx_warehouses_type ON warehouses(type);
CREATE INDEX idx_warehouses_is_active ON warehouses(is_active);
CREATE INDEX idx_warehouses_location ON warehouses USING GIST (
    ll_to_earth(latitude, longitude)
) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ============================================================================
-- WAREHOUSE ZONES
-- ============================================================================

CREATE TABLE warehouse_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    
    -- Zone details
    zone_type VARCHAR(50), -- receiving, storage, picking, packing, shipping
    capacity_sqft NUMERIC(12, 2),
    temperature_controlled BOOLEAN DEFAULT FALSE,
    temperature_min NUMERIC(5, 2),
    temperature_max NUMERIC(5, 2),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(warehouse_id, code)
);

CREATE INDEX idx_warehouse_zones_warehouse ON warehouse_zones(warehouse_id);
CREATE INDEX idx_warehouse_zones_type ON warehouse_zones(zone_type);

-- ============================================================================
-- INVENTORY
-- ============================================================================

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    
    -- Quantities
    quantity_available INTEGER NOT NULL DEFAULT 0,
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    quantity_in_transit INTEGER NOT NULL DEFAULT 0,
    quantity_damaged INTEGER NOT NULL DEFAULT 0,
    quantity_total INTEGER GENERATED ALWAYS AS (
        quantity_available + quantity_reserved + quantity_in_transit + quantity_damaged
    ) STORED,
    
    -- Reorder settings
    reorder_point INTEGER DEFAULT 10,
    reorder_quantity INTEGER DEFAULT 50,
    max_stock_level INTEGER,
    min_stock_level INTEGER DEFAULT 5,
    
    -- Status
    status inventory_status DEFAULT 'available',
    last_count_date TIMESTAMP,
    last_movement_date TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(warehouse_id, product_id),
    CONSTRAINT check_quantities CHECK (
        quantity_available >= 0 AND
        quantity_reserved >= 0 AND
        quantity_in_transit >= 0 AND
        quantity_damaged >= 0
    )
);

CREATE INDEX idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inventory_status ON inventory(status);
CREATE INDEX idx_inventory_low_stock ON inventory(warehouse_id, product_id) 
    WHERE quantity_available <= reorder_point;

-- ============================================================================
-- STOCK MOVEMENTS
-- ============================================================================

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    
    -- Movement details
    movement_type stock_movement_type NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12, 2),
    total_cost NUMERIC(12, 2),
    
    -- References
    reference_type VARCHAR(50), -- purchase_order, sales_order, transfer, adjustment
    reference_id UUID,
    
    -- From/To (for transfers)
    from_warehouse_id UUID REFERENCES warehouses(id),
    to_warehouse_id UUID REFERENCES warehouses(id),
    from_zone_id UUID REFERENCES warehouse_zones(id),
    to_zone_id UUID REFERENCES warehouse_zones(id),
    
    -- Details
    reason TEXT,
    notes TEXT,
    performed_by UUID,
    
    -- Timestamps
    movement_date TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT check_movement_quantity CHECK (quantity != 0)
);

CREATE INDEX idx_stock_movements_warehouse ON stock_movements(warehouse_id);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON stock_movements(movement_date);
CREATE INDEX idx_stock_movements_reference ON stock_movements(reference_type, reference_id);

-- ============================================================================
-- SUPPLIERS
-- ============================================================================

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(300),
    
    -- Contact
    email VARCHAR(200),
    phone VARCHAR(50),
    website VARCHAR(300),
    
    -- Address
    billing_address JSONB,
    shipping_address JSONB,
    
    -- Business details
    tax_id VARCHAR(100),
    business_registration VARCHAR(100),
    payment_terms VARCHAR(100), -- Net 30, Net 60, etc.
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Performance metrics
    rating NUMERIC(3, 2) DEFAULT 0.00,
    on_time_delivery_rate NUMERIC(5, 2) DEFAULT 0.00,
    quality_score NUMERIC(5, 2) DEFAULT 0.00,
    total_orders INTEGER DEFAULT 0,
    total_spent NUMERIC(15, 2) DEFAULT 0.00,
    
    -- Status
    status supplier_status DEFAULT 'active',
    is_preferred BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    notes TEXT,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_order_date TIMESTAMP
);

CREATE INDEX idx_suppliers_code ON suppliers(code);
CREATE INDEX idx_suppliers_name ON suppliers(name);
CREATE INDEX idx_suppliers_status ON suppliers(status);
CREATE INDEX idx_suppliers_preferred ON suppliers(is_preferred) WHERE is_preferred = TRUE;

-- ============================================================================
-- SUPPLIER PRODUCTS
-- ============================================================================

CREATE TABLE supplier_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    
    -- Pricing
    supplier_sku VARCHAR(100),
    unit_price NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    minimum_order_quantity INTEGER DEFAULT 1,
    
    -- Lead time
    lead_time_days INTEGER DEFAULT 7,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_preferred BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_price_update TIMESTAMP,
    
    UNIQUE(supplier_id, product_id)
);

CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product ON supplier_products(product_id);
CREATE INDEX idx_supplier_products_preferred ON supplier_products(supplier_id, product_id) 
    WHERE is_preferred = TRUE;

-- ============================================================================
-- PURCHASE ORDERS
-- ============================================================================

CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    
    -- Amounts
    subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(15, 2) DEFAULT 0.00,
    shipping_amount NUMERIC(15, 2) DEFAULT 0.00,
    discount_amount NUMERIC(15, 2) DEFAULT 0.00,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    
    -- Currency
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate NUMERIC(12, 6) DEFAULT 1.000000,
    
    -- Status
    status purchase_order_status DEFAULT 'draft',
    
    -- Dates
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    actual_delivery_date DATE,
    
    -- Contact
    buyer_id UUID,
    buyer_name VARCHAR(200),
    buyer_email VARCHAR(200),
    
    -- Shipping
    shipping_address JSONB,
    shipping_method VARCHAR(100),
    tracking_number VARCHAR(200),
    
    -- Notes
    notes TEXT,
    internal_notes TEXT,
    terms_and_conditions TEXT,
    
    -- Metadata
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    sent_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP
);

CREATE INDEX idx_purchase_orders_po_number ON purchase_orders(po_number);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_warehouse ON purchase_orders(warehouse_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_order_date ON purchase_orders(order_date);

-- ============================================================================
-- PURCHASE ORDER ITEMS
-- ============================================================================

CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    
    -- Product details (snapshot)
    product_name VARCHAR(300) NOT NULL,
    product_sku VARCHAR(100),
    supplier_sku VARCHAR(100),
    
    -- Quantities
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER DEFAULT 0,
    quantity_pending INTEGER GENERATED ALWAYS AS (quantity_ordered - quantity_received) STORED,
    
    -- Pricing
    unit_price NUMERIC(12, 2) NOT NULL,
    tax_rate NUMERIC(5, 2) DEFAULT 0.00,
    discount_percentage NUMERIC(5, 2) DEFAULT 0.00,
    line_total NUMERIC(15, 2) NOT NULL,
    
    -- Dates
    expected_delivery_date DATE,
    
    -- Notes
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT check_quantities CHECK (
        quantity_ordered > 0 AND
        quantity_received >= 0 AND
        quantity_received <= quantity_ordered
    )
);

CREATE INDEX idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_product ON purchase_order_items(product_id);

-- ============================================================================
-- GOODS RECEIPTS
-- ============================================================================

CREATE TABLE goods_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    
    -- Receipt details
    received_by UUID,
    received_by_name VARCHAR(200),
    receipt_date TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Quality check
    quality_checked BOOLEAN DEFAULT FALSE,
    quality_check_passed BOOLEAN,
    quality_notes TEXT,
    
    -- Status
    is_complete BOOLEAN DEFAULT FALSE,
    
    -- Notes
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_goods_receipts_receipt_number ON goods_receipts(receipt_number);
CREATE INDEX idx_goods_receipts_po ON goods_receipts(purchase_order_id);
CREATE INDEX idx_goods_receipts_warehouse ON goods_receipts(warehouse_id);
CREATE INDEX idx_goods_receipts_date ON goods_receipts(receipt_date);

-- ============================================================================
-- GOODS RECEIPT ITEMS
-- ============================================================================

CREATE TABLE goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    purchase_order_item_id UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    
    -- Quantities
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL,
    quantity_accepted INTEGER NOT NULL DEFAULT 0,
    quantity_rejected INTEGER NOT NULL DEFAULT 0,
    
    -- Quality
    rejection_reason TEXT,
    
    -- Location
    zone_id UUID REFERENCES warehouse_zones(id),
    bin_location VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT check_receipt_quantities CHECK (
        quantity_received > 0 AND
        quantity_accepted >= 0 AND
        quantity_rejected >= 0 AND
        quantity_accepted + quantity_rejected = quantity_received
    )
);

CREATE INDEX idx_goods_receipt_items_receipt ON goods_receipt_items(goods_receipt_id);
CREATE INDEX idx_goods_receipt_items_po_item ON goods_receipt_items(purchase_order_item_id);
CREATE INDEX idx_goods_receipt_items_product ON goods_receipt_items(product_id);

-- ============================================================================
-- SHIPMENTS
-- ============================================================================

CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_number VARCHAR(50) UNIQUE NOT NULL,
    order_id UUID NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    
    -- Shipping details
    carrier VARCHAR(100),
    service_level VARCHAR(100),
    tracking_number VARCHAR(200),
    tracking_url VARCHAR(500),
    
    -- Addresses
    shipping_address JSONB NOT NULL,
    return_address JSONB,
    
    -- Dimensions and weight
    total_weight_kg NUMERIC(10, 2),
    total_volume_cbm NUMERIC(10, 4),
    number_of_packages INTEGER DEFAULT 1,
    
    -- Costs
    shipping_cost NUMERIC(12, 2),
    insurance_cost NUMERIC(12, 2),
    
    -- Status
    status shipment_status DEFAULT 'pending',
    
    -- Dates
    ship_date TIMESTAMP,
    estimated_delivery_date TIMESTAMP,
    actual_delivery_date TIMESTAMP,
    
    -- Signature
    signature_required BOOLEAN DEFAULT FALSE,
    signature_received BOOLEAN DEFAULT FALSE,
    signed_by VARCHAR(200),
    
    -- Notes
    notes TEXT,
    special_instructions TEXT,
    
    -- Metadata
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shipments_shipment_number ON shipments(shipment_number);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_warehouse ON shipments(warehouse_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_tracking ON shipments(tracking_number);
CREATE INDEX idx_shipments_ship_date ON shipments(ship_date);

-- ============================================================================
-- SHIPMENT ITEMS
-- ============================================================================

CREATE TABLE shipment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    
    -- Product details
    product_name VARCHAR(300) NOT NULL,
    product_sku VARCHAR(100),
    
    -- Quantity
    quantity INTEGER NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT check_shipment_quantity CHECK (quantity > 0)
);

CREATE INDEX idx_shipment_items_shipment ON shipment_items(shipment_id);
CREATE INDEX idx_shipment_items_order_item ON shipment_items(order_item_id);
CREATE INDEX idx_shipment_items_product ON shipment_items(product_id);

-- ============================================================================
-- STOCK TRANSFERS
-- ============================================================================

CREATE TABLE stock_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    from_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- pending, in_transit, received, cancelled
    
    -- Dates
    transfer_date TIMESTAMP NOT NULL DEFAULT NOW(),
    expected_arrival_date TIMESTAMP,
    actual_arrival_date TIMESTAMP,
    
    -- Shipping
    carrier VARCHAR(100),
    tracking_number VARCHAR(200),
    
    -- Initiated by
    requested_by UUID,
    requested_by_name VARCHAR(200),
    approved_by UUID,
    approved_by_name VARCHAR(200),
    
    -- Notes
    reason TEXT,
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    CONSTRAINT check_different_warehouses CHECK (from_warehouse_id != to_warehouse_id)
);

CREATE INDEX idx_stock_transfers_transfer_number ON stock_transfers(transfer_number);
CREATE INDEX idx_stock_transfers_from_warehouse ON stock_transfers(from_warehouse_id);
CREATE INDEX idx_stock_transfers_to_warehouse ON stock_transfers(to_warehouse_id);
CREATE INDEX idx_stock_transfers_status ON stock_transfers(status);

-- ============================================================================
-- STOCK TRANSFER ITEMS
-- ============================================================================

CREATE TABLE stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    
    -- Product details
    product_name VARCHAR(300) NOT NULL,
    product_sku VARCHAR(100),
    
    -- Quantities
    quantity_requested INTEGER NOT NULL,
    quantity_shipped INTEGER DEFAULT 0,
    quantity_received INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT check_transfer_quantities CHECK (
        quantity_requested > 0 AND
        quantity_shipped >= 0 AND
        quantity_received >= 0 AND
        quantity_shipped <= quantity_requested AND
        quantity_received <= quantity_shipped
    )
);

CREATE INDEX idx_stock_transfer_items_transfer ON stock_transfer_items(stock_transfer_id);
CREATE INDEX idx_stock_transfer_items_product ON stock_transfer_items(product_id);

-- ============================================================================
-- DEMAND FORECASTS
-- ============================================================================

CREATE TABLE demand_forecasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id),
    
    -- Forecast period
    forecast_date DATE NOT NULL,
    forecast_type VARCHAR(50) NOT NULL, -- daily, weekly, monthly
    
    -- Forecast values
    predicted_demand INTEGER NOT NULL,
    confidence_level NUMERIC(5, 2), -- 0-100
    lower_bound INTEGER,
    upper_bound INTEGER,
    
    -- Actual values (filled after the period)
    actual_demand INTEGER,
    forecast_accuracy NUMERIC(5, 2),
    
    -- Model info
    model_version VARCHAR(50),
    model_features JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(product_id, warehouse_id, forecast_date, forecast_type)
);

CREATE INDEX idx_demand_forecasts_product ON demand_forecasts(product_id);
CREATE INDEX idx_demand_forecasts_warehouse ON demand_forecasts(warehouse_id);
CREATE INDEX idx_demand_forecasts_date ON demand_forecasts(forecast_date);
CREATE INDEX idx_demand_forecasts_type ON demand_forecasts(forecast_type);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update inventory quantities
CREATE OR REPLACE FUNCTION update_inventory_quantities()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Update inventory based on movement type
        IF NEW.movement_type = 'inbound' THEN
            UPDATE inventory
            SET quantity_available = quantity_available + NEW.quantity,
                last_movement_date = NEW.movement_date,
                updated_at = NOW()
            WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id;
            
        ELSIF NEW.movement_type = 'outbound' THEN
            UPDATE inventory
            SET quantity_available = quantity_available - NEW.quantity,
                last_movement_date = NEW.movement_date,
                updated_at = NOW()
            WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id;
            
        ELSIF NEW.movement_type = 'transfer' THEN
            -- Decrease from source warehouse
            UPDATE inventory
            SET quantity_available = quantity_available - NEW.quantity,
                quantity_in_transit = quantity_in_transit + NEW.quantity,
                last_movement_date = NEW.movement_date,
                updated_at = NOW()
            WHERE warehouse_id = NEW.from_warehouse_id AND product_id = NEW.product_id;
            
            -- Increase in-transit for destination warehouse
            INSERT INTO inventory (warehouse_id, product_id, quantity_in_transit)
            VALUES (NEW.to_warehouse_id, NEW.product_id, NEW.quantity)
            ON CONFLICT (warehouse_id, product_id) DO UPDATE
            SET quantity_in_transit = inventory.quantity_in_transit + NEW.quantity,
                last_movement_date = NEW.movement_date,
                updated_at = NOW();
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_inventory_quantities
AFTER INSERT ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION update_inventory_quantities();

-- Function to check low stock and create alerts
CREATE OR REPLACE FUNCTION check_low_stock()
RETURNS TABLE(
    warehouse_id UUID,
    warehouse_name VARCHAR,
    product_id UUID,
    quantity_available INTEGER,
    reorder_point INTEGER,
    reorder_quantity INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.warehouse_id,
        w.name,
        i.product_id,
        i.quantity_available,
        i.reorder_point,
        i.reorder_quantity
    FROM inventory i
    JOIN warehouses w ON i.warehouse_id = w.id
    WHERE i.quantity_available <= i.reorder_point
    AND w.is_active = TRUE
    ORDER BY i.warehouse_id, i.product_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for inventory summary
CREATE OR REPLACE VIEW inventory_summary AS
SELECT 
    i.warehouse_id,
    w.name AS warehouse_name,
    w.code AS warehouse_code,
    COUNT(DISTINCT i.product_id) AS total_products,
    SUM(i.quantity_total) AS total_quantity,
    SUM(i.quantity_available) AS total_available,
    SUM(i.quantity_reserved) AS total_reserved,
    SUM(i.quantity_in_transit) AS total_in_transit,
    SUM(i.quantity_damaged) AS total_damaged,
    COUNT(*) FILTER (WHERE i.quantity_available <= i.reorder_point) AS low_stock_count
FROM inventory i
JOIN warehouses w ON i.warehouse_id = w.id
GROUP BY i.warehouse_id, w.name, w.code;

-- View for supplier performance
CREATE OR REPLACE VIEW supplier_performance AS
SELECT 
    s.id AS supplier_id,
    s.code AS supplier_code,
    s.name AS supplier_name,
    s.rating,
    s.on_time_delivery_rate,
    s.quality_score,
    s.total_orders,
    s.total_spent,
    COUNT(po.id) AS active_orders,
    SUM(CASE WHEN po.status = 'received' THEN 1 ELSE 0 END) AS completed_orders,
    AVG(CASE 
        WHEN po.actual_delivery_date IS NOT NULL AND po.expected_delivery_date IS NOT NULL
        THEN EXTRACT(DAY FROM (po.actual_delivery_date - po.expected_delivery_date))
        ELSE NULL
    END) AS avg_delivery_delay_days
FROM suppliers s
LEFT JOIN purchase_orders po ON s.id = po.supplier_id
GROUP BY s.id, s.code, s.name, s.rating, s.on_time_delivery_rate, s.quality_score, s.total_orders, s.total_spent;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE warehouses IS 'Warehouse master data';
COMMENT ON TABLE inventory IS 'Product inventory levels by warehouse';
COMMENT ON TABLE stock_movements IS 'All stock movements (inbound, outbound, transfers, adjustments)';
COMMENT ON TABLE suppliers IS 'Supplier master data';
COMMENT ON TABLE purchase_orders IS 'Purchase orders to suppliers';
COMMENT ON TABLE shipments IS 'Outbound shipments to customers';
COMMENT ON TABLE stock_transfers IS 'Inter-warehouse stock transfers';
COMMENT ON TABLE demand_forecasts IS 'AI-powered demand forecasts';

-- ============================================================================
-- SAMPLE DATA (Optional)
-- ============================================================================

-- Insert default warehouse
INSERT INTO warehouses (code, name, type, address, is_default, is_active) VALUES
('WH-MAIN', 'Main Distribution Center', 'distribution_center', 
 '{"street": "123 Warehouse Blvd", "city": "New York", "state": "NY", "zip": "10001", "country": "US"}',
 TRUE, TRUE);

