# Data Exchange Specification: Agent Onboarding → E-commerce → Supply Chain

## Complete Data Flow with Exact Schemas

---

## 1. Agent Onboarding → Orchestrator

### Request Data
```json
{
  "first_name": "string",
  "last_name": "string",
  "email": "email@example.com",
  "phone": "+1234567890",
  "date_of_birth": "1990-01-15",
  "nationality": "Kenya",
  "gender": "male|female|other",
  "tier": "super_agent|regional_agent|field_agent|sub_agent",
  "business_name": "string (optional)",
  "business_type": "sole_proprietorship|partnership|corporation|llc",
  "business_address": {
    "street": "123 Main St",
    "city": "Nairobi",
    "state": "Nairobi County",
    "postal_code": "00100",
    "country": "Kenya",
    "latitude": -1.286389,
    "longitude": 36.817223
  },
  "sponsor_agent_id": "agent-uuid (optional)",
  "referral_code": "string (optional)",
  "documents": [
    {
      "type": "national_id|passport|business_license|tax_certificate",
      "document_number": "string",
      "issue_date": "2020-01-01",
      "expiry_date": "2030-01-01",
      "issuing_authority": "string",
      "file_url": "s3://bucket/path/to/document.pdf"
    }
  ]
}
```

### Response Data
```json
{
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "application_number": "AGT-2025-001234",
  "status": "pending_kyc|approved|rejected",
  "tier": "field_agent",
  "created_at": "2025-01-15T10:30:00Z",
  "kyc_application_id": "kyc-uuid",
  "next_steps": [
    "Upload identity documents",
    "Complete business verification",
    "Await approval"
  ]
}
```

---

## 2. Orchestrator → E-commerce (Store Creation)

### Request Data
```json
{
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "store_name": "John's Electronics",
  "store_slug": "johns-electronics",
  "store_description": "Quality electronics and accessories",
  "business_category": "electronics|fashion|food|general",
  "logo_url": "https://cdn.example.com/logos/store-logo.png",
  "banner_url": "https://cdn.example.com/banners/store-banner.jpg",
  "contact_email": "store@example.com",
  "contact_phone": "+1234567890",
  "business_hours": {
    "monday": {"open": "09:00", "close": "18:00"},
    "tuesday": {"open": "09:00", "close": "18:00"},
    "wednesday": {"open": "09:00", "close": "18:00"},
    "thursday": {"open": "09:00", "close": "18:00"},
    "friday": {"open": "09:00", "close": "18:00"},
    "saturday": {"open": "10:00", "close": "16:00"},
    "sunday": {"closed": true}
  },
  "settings": {
    "currency": "USD",
    "language": "en",
    "timezone": "Africa/Nairobi",
    "tax_enabled": true,
    "tax_rate": 16.0,
    "shipping_enabled": true,
    "minimum_order": 10.00,
    "free_shipping_threshold": 100.00
  },
  "social_links": {
    "facebook": "https://facebook.com/store",
    "instagram": "https://instagram.com/store",
    "twitter": "https://twitter.com/store"
  }
}
```

### Response Data
```json
{
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "store_name": "John's Electronics",
  "store_slug": "johns-electronics",
  "store_url": "https://marketplace.example.com/stores/johns-electronics",
  "admin_url": "https://admin.example.com/stores/store-660e8400",
  "status": "pending|active|suspended|closed",
  "created_at": "2025-01-15T10:31:00Z",
  "api_credentials": {
    "api_key": "sk_live_abc123xyz789",
    "webhook_secret": "whsec_def456uvw012"
  }
}
```

---

## 3. Orchestrator → Supply Chain (Warehouse Creation)

### Request Data
```json
{
  "code": "WH-AGENT550E",
  "name": "John's Electronics Warehouse",
  "warehouse_type": "agent_warehouse|distribution_center|fulfillment_center",
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "address": {
    "street": "456 Industrial Rd",
    "city": "Nairobi",
    "state": "Nairobi County",
    "postal_code": "00200",
    "country": "Kenya",
    "latitude": -1.292066,
    "longitude": 36.821945
  },
  "contact": {
    "manager_name": "John Doe",
    "phone": "+1234567890",
    "email": "warehouse@example.com"
  },
  "capacity": {
    "total_sqm": 100.0,
    "usable_sqm": 85.0,
    "storage_zones": 4,
    "loading_docks": 2
  },
  "operating_hours": {
    "monday_friday": {"open": "08:00", "close": "17:00"},
    "saturday": {"open": "09:00", "close": "13:00"},
    "sunday": {"closed": true}
  },
  "settings": {
    "enable_barcode_scanning": true,
    "enable_rfid": false,
    "enable_cycle_counting": true,
    "enable_quality_control": true,
    "temperature_controlled": false,
    "hazmat_certified": false
  },
  "is_active": true
}
```

### Response Data
```json
{
  "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
  "code": "WH-AGENT550E",
  "name": "John's Electronics Warehouse",
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "status": "active|inactive|maintenance",
  "created_at": "2025-01-15T10:32:00Z",
  "zones": [
    {
      "zone_id": "zone-1",
      "zone_name": "Receiving",
      "zone_type": "receiving",
      "capacity_sqm": 20.0
    },
    {
      "zone_id": "zone-2",
      "zone_name": "Storage",
      "zone_type": "storage",
      "capacity_sqm": 50.0
    },
    {
      "zone_id": "zone-3",
      "zone_name": "Picking",
      "zone_type": "picking",
      "capacity_sqm": 10.0
    },
    {
      "zone_id": "zone-4",
      "zone_name": "Shipping",
      "zone_type": "shipping",
      "capacity_sqm": 5.0
    }
  ]
}
```

---

## 4. E-commerce → Supply Chain (Store-Warehouse Link)

### Request Data
```json
{
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
  "is_primary": true,
  "fulfillment_priority": 1,
  "allocation_rules": {
    "strategy": "nearest|cheapest|fastest|balanced",
    "max_distance_km": 50,
    "max_fulfillment_time_hours": 48
  }
}
```

### Response Data
```json
{
  "link_id": "link-880e8400-e29b-41d4-a716-446655440000",
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
  "is_primary": true,
  "fulfillment_priority": 1,
  "status": "active",
  "created_at": "2025-01-15T10:33:00Z"
}
```

---

## 5. E-commerce → Supply Chain (Product Creation & Inventory)

### Request Data (Product)
```json
{
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "name": "Samsung Galaxy S24",
  "description": "Latest flagship smartphone with AI features",
  "sku": "SAMS24-BLK-256",
  "barcode": "8801234567890",
  "category": "Electronics > Mobile Phones",
  "brand": "Samsung",
  "price": 999.99,
  "cost": 750.00,
  "compare_at_price": 1099.99,
  "currency": "USD",
  "tax_code": "ELECTRONICS",
  "weight": 0.168,
  "weight_unit": "kg",
  "dimensions": {
    "length": 14.6,
    "width": 7.0,
    "height": 0.77,
    "unit": "cm"
  },
  "images": [
    {
      "url": "https://cdn.example.com/products/samsung-s24-1.jpg",
      "alt": "Samsung Galaxy S24 Front View",
      "position": 1,
      "is_primary": true
    },
    {
      "url": "https://cdn.example.com/products/samsung-s24-2.jpg",
      "alt": "Samsung Galaxy S24 Back View",
      "position": 2,
      "is_primary": false
    }
  ],
  "variants": [
    {
      "sku": "SAMS24-BLK-256",
      "attributes": {"color": "Black", "storage": "256GB"},
      "price": 999.99,
      "cost": 750.00
    },
    {
      "sku": "SAMS24-WHT-256",
      "attributes": {"color": "White", "storage": "256GB"},
      "price": 999.99,
      "cost": 750.00
    }
  ],
  "metadata": {
    "manufacturer": "Samsung Electronics",
    "warranty_months": 24,
    "country_of_origin": "South Korea"
  },
  "is_active": true,
  "track_inventory": true
}
```

### Response Data (Product)
```json
{
  "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
  "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
  "name": "Samsung Galaxy S24",
  "sku": "SAMS24-BLK-256",
  "barcode": "8801234567890",
  "price": 999.99,
  "status": "active",
  "created_at": "2025-01-15T10:34:00Z",
  "product_url": "https://marketplace.example.com/products/samsung-galaxy-s24",
  "variant_ids": [
    "var-aa0e8400-e29b-41d4-a716-446655440000",
    "var-bb0e8400-e29b-41d4-a716-446655440000"
  ]
}
```

### Request Data (Inventory Initialization)
```json
{
  "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
  "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
  "variant_id": "var-aa0e8400-e29b-41d4-a716-446655440000",
  "movement_type": "inbound",
  "quantity": 100,
  "unit_cost": 750.00,
  "reference_type": "initial_stock",
  "reference_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "location": {
    "zone": "zone-2",
    "aisle": "A",
    "rack": "01",
    "shelf": "03",
    "bin": "05"
  },
  "batch_number": "BATCH-2025-001",
  "expiry_date": null,
  "notes": "Initial inventory setup for new agent"
}
```

### Response Data (Inventory)
```json
{
  "movement_id": "mov-cc0e8400-e29b-41d4-a716-446655440000",
  "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
  "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
  "variant_id": "var-aa0e8400-e29b-41d4-a716-446655440000",
  "movement_type": "inbound",
  "quantity": 100,
  "unit_cost": 750.00,
  "total_cost": 75000.00,
  "created_at": "2025-01-15T10:35:00Z",
  "inventory_snapshot": {
    "quantity_available": 100,
    "quantity_reserved": 0,
    "quantity_on_order": 0,
    "reorder_point": 20,
    "reorder_quantity": 50,
    "last_updated": "2025-01-15T10:35:00Z"
  }
}
```

---

## 6. Supply Chain → Procurement (Supplier Setup)

### Request Data
```json
{
  "code": "SUP-SAMSUNG",
  "name": "Samsung Electronics Distribution",
  "legal_name": "Samsung Electronics Co., Ltd.",
  "tax_id": "123-45-67890",
  "email": "orders@samsung-dist.com",
  "phone": "+82-2-2255-0114",
  "website": "https://www.samsung.com",
  "address": {
    "street": "129 Samsung-ro",
    "city": "Seoul",
    "state": "Yeongtong-gu",
    "postal_code": "16677",
    "country": "South Korea"
  },
  "contact_person": {
    "name": "Kim Min-jun",
    "title": "Sales Manager",
    "email": "minjun.kim@samsung.com",
    "phone": "+82-10-1234-5678"
  },
  "payment_terms": "Net 30",
  "payment_methods": ["wire_transfer", "letter_of_credit"],
  "currency": "USD",
  "minimum_order_value": 10000.00,
  "lead_time_days": 14,
  "shipping_terms": "FOB",
  "is_preferred": true,
  "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
  "rating": 4.8,
  "certifications": ["ISO 9001", "ISO 14001"]
}
```

### Response Data
```json
{
  "supplier_id": "sup-dd0e8400-e29b-41d4-a716-446655440000",
  "code": "SUP-SAMSUNG",
  "name": "Samsung Electronics Distribution",
  "status": "active",
  "created_at": "2025-01-15T10:36:00Z",
  "performance_metrics": {
    "on_time_delivery_rate": 0.0,
    "quality_acceptance_rate": 0.0,
    "total_orders": 0,
    "total_value": 0.0
  }
}
```

---

## 7. Fluvio Event: Agent Onboarding Completed

### Event Schema
```json
{
  "topic": "agent.onboarding.completed",
  "key": "agent-550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-15T10:37:00Z",
  "headers": {
    "event_id": "evt-ee0e8400-e29b-41d4-a716-446655440000",
    "event_type": "agent_onboarded",
    "event_version": "1.0",
    "source": "agent-commerce-orchestrator",
    "correlation_id": "wf-ff0e8400-e29b-41d4-a716-446655440000"
  },
  "value": {
    "workflow_id": "wf-ff0e8400-e29b-41d4-a716-446655440000",
    "agent": {
      "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
      "application_number": "AGT-2025-001234",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john.doe@example.com",
      "phone": "+1234567890",
      "tier": "field_agent",
      "business_name": "John's Electronics",
      "status": "pending_kyc"
    },
    "store": {
      "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
      "store_name": "John's Electronics",
      "store_url": "https://marketplace.example.com/stores/johns-electronics",
      "status": "pending"
    },
    "warehouse": {
      "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
      "code": "WH-AGENT550E",
      "name": "John's Electronics Warehouse",
      "capacity_sqm": 100.0
    },
    "completed_stages": [
      "agent_registration",
      "kyc_application",
      "store_creation",
      "warehouse_creation",
      "store_warehouse_link",
      "payment_configuration",
      "dashboard_access"
    ],
    "next_steps": [
      "complete_kyc_verification",
      "upload_product_catalog",
      "configure_shipping",
      "setup_suppliers",
      "complete_training",
      "go_live"
    ]
  }
}
```

---

## 8. Fluvio Event: E-commerce Order Created

### Event Schema
```json
{
  "topic": "ecommerce.order.created",
  "key": "order-110e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-15T11:00:00Z",
  "headers": {
    "event_id": "evt-220e8400-e29b-41d4-a716-446655440000",
    "event_type": "order_created",
    "event_version": "1.0",
    "source": "ecommerce-service",
    "correlation_id": "order-110e8400-e29b-41d4-a716-446655440000"
  },
  "value": {
    "order_id": "order-110e8400-e29b-41d4-a716-446655440000",
    "order_number": "ORD-2025-001234",
    "store_id": "store-660e8400-e29b-41d4-a716-446655440000",
    "agent_id": "agent-550e8400-e29b-41d4-a716-446655440000",
    "customer": {
      "customer_id": "cust-330e8400-e29b-41d4-a716-446655440000",
      "email": "customer@example.com",
      "phone": "+1234567890",
      "name": "Jane Smith"
    },
    "items": [
      {
        "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
        "variant_id": "var-aa0e8400-e29b-41d4-a716-446655440000",
        "sku": "SAMS24-BLK-256",
        "name": "Samsung Galaxy S24",
        "quantity": 2,
        "unit_price": 999.99,
        "subtotal": 1999.98,
        "tax": 319.99,
        "total": 2319.97
      }
    ],
    "totals": {
      "subtotal": 1999.98,
      "tax": 319.99,
      "shipping": 15.00,
      "discount": 0.00,
      "total": 2334.97,
      "currency": "USD"
    },
    "shipping_address": {
      "name": "Jane Smith",
      "street": "789 Customer St",
      "city": "Nairobi",
      "state": "Nairobi County",
      "postal_code": "00300",
      "country": "Kenya",
      "phone": "+1234567890"
    },
    "fulfillment": {
      "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
      "shipping_method": "standard",
      "requested_delivery_date": "2025-01-20"
    },
    "payment": {
      "payment_method": "mobile_money",
      "payment_status": "paid",
      "transaction_id": "txn-440e8400-e29b-41d4-a716-446655440000"
    },
    "status": "pending_fulfillment",
    "created_at": "2025-01-15T11:00:00Z"
  }
}
```

---

## 9. Supply Chain → E-commerce (Inventory Update)

### Event Schema
```json
{
  "topic": "supply-chain.inventory.updated",
  "key": "prod-990e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-15T11:05:00Z",
  "headers": {
    "event_id": "evt-550e8400-e29b-41d4-a716-446655440000",
    "event_type": "inventory_updated",
    "event_version": "1.0",
    "source": "inventory-service",
    "correlation_id": "order-110e8400-e29b-41d4-a716-446655440000"
  },
  "value": {
    "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
    "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
    "variant_id": "var-aa0e8400-e29b-41d4-a716-446655440000",
    "sku": "SAMS24-BLK-256",
    "movement_type": "reserved",
    "quantity_change": -2,
    "inventory_snapshot": {
      "quantity_available": 98,
      "quantity_reserved": 2,
      "quantity_on_order": 0,
      "reorder_point": 20,
      "last_updated": "2025-01-15T11:05:00Z"
    },
    "reference": {
      "type": "order",
      "id": "order-110e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

---

## 10. Supply Chain → E-commerce (Shipment Created)

### Event Schema
```json
{
  "topic": "supply-chain.shipment.shipped",
  "key": "ship-660e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-15T14:00:00Z",
  "headers": {
    "event_id": "evt-770e8400-e29b-41d4-a716-446655440000",
    "event_type": "shipment_shipped",
    "event_version": "1.0",
    "source": "logistics-service",
    "correlation_id": "order-110e8400-e29b-41d4-a716-446655440000"
  },
  "value": {
    "shipment_id": "ship-660e8400-e29b-41d4-a716-446655440000",
    "order_id": "order-110e8400-e29b-41d4-a716-446655440000",
    "warehouse_id": "wh-770e8400-e29b-41d4-a716-446655440000",
    "tracking_number": "1Z999AA10123456784",
    "carrier": "FedEx",
    "service_level": "FedEx Ground",
    "items": [
      {
        "product_id": "prod-990e8400-e29b-41d4-a716-446655440000",
        "variant_id": "var-aa0e8400-e29b-41d4-a716-446655440000",
        "sku": "SAMS24-BLK-256",
        "quantity": 2
      }
    ],
    "shipping_address": {
      "name": "Jane Smith",
      "street": "789 Customer St",
      "city": "Nairobi",
      "postal_code": "00300",
      "country": "Kenya"
    },
    "weight": {
      "value": 0.336,
      "unit": "kg"
    },
    "dimensions": {
      "length": 20,
      "width": 15,
      "height": 10,
      "unit": "cm"
    },
    "estimated_delivery": "2025-01-18T17:00:00Z",
    "tracking_url": "https://www.fedex.com/track?tracknumber=1Z999AA10123456784",
    "shipped_at": "2025-01-15T14:00:00Z"
  }
}
```

---

## Summary: Data Exchange Matrix

| From | To | Data Type | Key Fields | Event Topic |
|------|-----|-----------|------------|-------------|
| **Agent Onboarding** | **Orchestrator** | Agent Profile | agent_id, tier, business_name | - |
| **Orchestrator** | **E-commerce** | Store Config | store_id, agent_id, settings | ecommerce.store.created |
| **Orchestrator** | **Supply Chain** | Warehouse Config | warehouse_id, agent_id, capacity | supply-chain.warehouse.created |
| **E-commerce** | **Supply Chain** | Store-Warehouse Link | store_id, warehouse_id, priority | - |
| **E-commerce** | **Supply Chain** | Product Data | product_id, sku, price, dimensions | ecommerce.product.created |
| **E-commerce** | **Supply Chain** | Order Data | order_id, items, quantities, address | ecommerce.order.created |
| **Supply Chain** | **E-commerce** | Inventory Levels | product_id, available, reserved | supply-chain.inventory.updated |
| **Supply Chain** | **E-commerce** | Shipment Info | shipment_id, tracking, carrier, eta | supply-chain.shipment.shipped |
| **Supply Chain** | **Procurement** | Supplier Data | supplier_id, products, terms | supply-chain.supplier.linked |
| **Lakehouse** | **Supply Chain** | Demand Forecast | product_id, predicted_demand | lakehouse.demand.prediction |
| **Supply Chain** | **Lakehouse** | All Events | All operational data | supply-chain.* |

**Total Data Points Exchanged:** 150+ fields across 10 integration points

