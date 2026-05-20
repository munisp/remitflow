# Permify Integration with Nigerian Remittance Platform

## Overview

This document describes how Permify authorization is integrated into the Nigerian Remittance Platform.

## Integration Points

### 1. Payment Service Integration

**Location**: `integrations/payment/payment_service_integration.py`

**Features**:
- Transfer authorization
- Transaction approval/rejection
- Refund authorization
- Account balance viewing
- Account permission setup

**Usage**:
```python
from integrations.payment.payment_service_integration import PaymentServiceIntegration

payment_service = PaymentServiceIntegration()

# Initiate transfer with authorization
result = await payment_service.initiate_transfer(
    user_id="user_123",
    from_account_id="acc_1",
    to_account_id="acc_2",
    amount=Decimal("100.00"),
    currency="NGN"
)
```

### 2. KYC Service Integration

**Location**: `integrations/kyc/kyc_service_integration.py`

**Features**:
- Document upload/verification
- KYC approval/rejection
- Reviewer/officer assignment

**Usage**:
```python
from integrations.kyc.kyc_service_integration import KYCServiceIntegration

kyc_service = KYCServiceIntegration()

# Verify KYC document with authorization
result = await kyc_service.verify_kyc_document(
    user_id="compliance_officer_123",
    document_id="doc_123",
    verification_result={"status": "verified"}
)
```

### 3. Fraud Detection Integration

**Location**: `integrations/fraud/fraud_service_integration.py`

**Features**:
- Transaction flagging
- Case investigation
- Case approval

**Usage**:
```python
from integrations.fraud.fraud_service_integration import FraudServiceIntegration

fraud_service = FraudServiceIntegration()

# Flag suspicious transaction
result = await fraud_service.flag_suspicious_transaction(
    user_id="fraud_analyst_123",
    transaction_id="txn_123",
    reason="Unusual pattern detected",
    risk_score=85.5
)
```

### 4. Compliance Service Integration

**Location**: `integrations/compliance/compliance_service_integration.py`

**Features**:
- AML case management
- SAR filing
- Compliance officer assignment

**Usage**:
```python
from integrations.compliance.compliance_service_integration import ComplianceServiceIntegration

compliance_service = ComplianceServiceIntegration()

# Create AML case
result = await compliance_service.create_aml_case(
    user_id="compliance_officer_123",
    subject_user_id="user_456",
    reason="Suspicious activity pattern",
    risk_indicators=["high_velocity", "unusual_destination"]
)
```

### 5. Admin Service Integration

**Location**: `integrations/admin/admin_service_integration.py`

**Features**:
- Admin panel access
- Organization management
- System settings management

**Usage**:
```python
from integrations.admin.admin_service_integration import AdminServiceIntegration

admin_service = AdminServiceIntegration()

# Access admin panel
result = await admin_service.access_admin_panel(
    user_id="admin_123",
    panel_id="main"
)
```

## FastAPI Integration

### Middleware Setup

```python
from fastapi import FastAPI
from middleware.fastapi_middleware import AuthorizationMiddleware

app = FastAPI()

# Add authorization middleware
app.add_middleware(AuthorizationMiddleware)
```

### Using Decorators

```python
from fastapi import Depends
from middleware.fastapi_middleware import (
    require_permission,
    require_role,
    get_current_user_id
)

@app.get("/accounts/{id}")
@require_permission("account", "view", "id")
async def get_account(
    id: str,
    user_id: str = Depends(get_current_user_id)
):
    return {"account_id": id}

@app.get("/admin/users")
@require_role("admin")
async def list_users(
    user_id: str = Depends(get_current_user_id)
):
    return {"users": []}
```

## Deployment

### With Temporal

Permify works seamlessly with Temporal workflows:

```python
# In Temporal workflow
from integrations.payment.payment_service_integration import PaymentServiceIntegration

@workflow.defn
class PaymentWorkflow:
    @workflow.run
    async def run(self, payment_data: dict) -> dict:
        payment_service = PaymentServiceIntegration()
        
        # Authorization check is built-in
        result = await payment_service.initiate_transfer(
            user_id=payment_data["user_id"],
            from_account_id=payment_data["from_account"],
            to_account_id=payment_data["to_account"],
            amount=payment_data["amount"],
            currency=payment_data["currency"]
        )
        
        return result
```

### With Dapr

Permify integrates with Dapr for distributed authorization:

```python
from dapr.clients import DaprClient

# Use Dapr to invoke Permify
with DaprClient() as dapr:
    result = dapr.invoke_method(
        app_id="permify-service",
        method_name="check-permission",
        data=json.dumps({
            "user_id": "user_123",
            "entity_type": "account",
            "entity_id": "acc_123",
            "permission": "transfer"
        })
    )
```

## Configuration

### Environment Variables

```bash
# Permify server
PERMIFY_HTTP_URL=http://permify-service:3476
PERMIFY_GRPC_ADDRESS=permify-service:3478
PERMIFY_API_KEY=your_api_key_here

# Tenant ID
PERMIFY_TENANT_ID=remittance-platform

# Caching
PERMIFY_CACHE_ENABLED=true
PERMIFY_CACHE_TTL=300

# Circuit breaker
PERMIFY_CIRCUIT_BREAKER_ENABLED=true
PERMIFY_CIRCUIT_BREAKER_THRESHOLD=5
PERMIFY_CIRCUIT_BREAKER_TIMEOUT=60
```

## Platform Services Directory Structure

```
services/
├── permify-production/          # Permify authorization system
│   ├── client/                  # Permify client
│   ├── service/                 # Authorization service
│   ├── policies/                # Policy engine
│   ├── middleware/              # FastAPI middleware
│   ├── integrations/            # Platform integrations
│   │   ├── payment/
│   │   ├── kyc/
│   │   ├── fraud/
│   │   ├── compliance/
│   │   └── admin/
│   ├── schemas/                 # Authorization schemas
│   ├── tests/                   # Test suite
│   └── docs/                    # Documentation
├── temporal-production/         # Temporal workflows
├── dapr-production/            # Dapr runtime
├── kafka-production/           # Kafka messaging
├── postgres-production/        # PostgreSQL database
└── ... (other services)
```

## Testing

Run Permify tests:

```bash
cd services/permify-production
pytest
```

Run integration tests:

```bash
pytest tests/integration/
```

## Monitoring

Permify metrics are exposed at:
- **Prometheus**: http://localhost:9090/metrics
- **Grafana**: http://localhost:3000

## Support

For Permify-related issues:
- Documentation: `services/permify-production/README.md`
- Deployment Guide: `services/permify-production/docs/DEPLOYMENT_GUIDE.md`
- GitHub Issues: [Create an issue](https://github.com/your-repo/issues)

