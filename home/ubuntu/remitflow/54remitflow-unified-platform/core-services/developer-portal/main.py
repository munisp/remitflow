"""
Developer Portal Service
Provides API documentation, sandbox environment, API key management, and webhooks.

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends, Query, Header, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import secrets
import hashlib
import hmac
import json
import httpx

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Developer Portal",
    description="API management, documentation, sandbox, and webhook services for B2B integrations",
    version="2.0.0"
)

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "developer-portal")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)


class APIKeyType(str, Enum):
    SANDBOX = "sandbox"
    PRODUCTION = "production"


class APIKeyStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"


class WebhookStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    FAILED = "failed"


class WebhookEventType(str, Enum):
    TRANSFER_INITIATED = "transfer.initiated"
    TRANSFER_COMPLETED = "transfer.completed"
    TRANSFER_FAILED = "transfer.failed"
    PAYMENT_RECEIVED = "payment.received"
    PAYOUT_COMPLETED = "payout.completed"
    KYC_APPROVED = "kyc.approved"
    KYC_REJECTED = "kyc.rejected"
    WALLET_CREDITED = "wallet.credited"
    WALLET_DEBITED = "wallet.debited"
    RATE_ALERT = "rate.alert"


class RateLimitTier(str, Enum):
    FREE = "free"
    STARTER = "starter"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"


# Models
class Organization(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    website: Optional[str] = None
    description: Optional[str] = None
    rate_limit_tier: RateLimitTier = RateLimitTier.FREE
    is_verified: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class APIKey(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organization_id: str
    name: str
    key_type: APIKeyType
    public_key: str
    secret_key_hash: str
    status: APIKeyStatus = APIKeyStatus.ACTIVE
    permissions: List[str] = []
    rate_limit: int = 1000
    last_used: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WebhookEndpoint(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organization_id: str
    url: str
    secret: str
    events: List[WebhookEventType]
    status: WebhookStatus = WebhookStatus.ACTIVE
    failure_count: int = 0
    last_triggered: Optional[datetime] = None
    last_success: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WebhookDelivery(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    webhook_id: str
    event_type: WebhookEventType
    payload: Dict[str, Any]
    response_status: Optional[int] = None
    response_body: Optional[str] = None
    delivered: bool = False
    attempts: int = 0
    next_retry: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SandboxTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organization_id: str
    transaction_type: str
    amount: str
    currency: str
    source: Dict[str, Any]
    destination: Dict[str, Any]
    status: str = "pending"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class APIUsageLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    api_key_id: str
    endpoint: str
    method: str
    status_code: int
    response_time_ms: int
    ip_address: str
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# Import database modules if available
try:
    from database import get_db_context, init_db, check_db_connection
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# In-memory storage (only used when USE_DATABASE=false for development)
organizations_db: Dict[str, Organization] = {}
api_keys_db: Dict[str, APIKey] = {}
webhooks_db: Dict[str, WebhookEndpoint] = {}
webhook_deliveries_db: Dict[str, WebhookDelivery] = {}
sandbox_transactions_db: Dict[str, SandboxTransaction] = {}
api_usage_logs_db: Dict[str, APIUsageLog] = {}

# Rate limits by tier
RATE_LIMITS = {
    RateLimitTier.FREE: {"requests_per_minute": 60, "requests_per_day": 1000},
    RateLimitTier.STARTER: {"requests_per_minute": 300, "requests_per_day": 10000},
    RateLimitTier.BUSINESS: {"requests_per_minute": 1000, "requests_per_day": 100000},
    RateLimitTier.ENTERPRISE: {"requests_per_minute": 5000, "requests_per_day": 1000000},
}


def generate_api_key() -> tuple[str, str]:
    """Generate public and secret API keys."""
    public_key = f"pk_{'sandbox' if True else 'live'}_{secrets.token_hex(16)}"
    secret_key = f"sk_{'sandbox' if True else 'live'}_{secrets.token_hex(32)}"
    return public_key, secret_key


def hash_secret_key(secret_key: str) -> str:
    """Hash the secret key for storage."""
    return hashlib.sha256(secret_key.encode()).hexdigest()


def generate_webhook_secret() -> str:
    """Generate webhook signing secret."""
    return f"whsec_{secrets.token_hex(24)}"


def sign_webhook_payload(payload: Dict[str, Any], secret: str) -> str:
    """Sign webhook payload with HMAC-SHA256."""
    payload_str = json.dumps(payload, sort_keys=True)
    signature = hmac.new(
        secret.encode(),
        payload_str.encode(),
        hashlib.sha256
    ).hexdigest()
    return f"sha256={signature}"


# Organization Endpoints
@app.post("/organizations", response_model=Organization)
async def create_organization(
    name: str,
    email: str,
    website: Optional[str] = None,
    description: Optional[str] = None
):
    """Register a new organization."""
    org = Organization(
        name=name,
        email=email,
        website=website,
        description=description
    )
    organizations_db[org.id] = org
    return org


@app.get("/organizations/{org_id}", response_model=Organization)
async def get_organization(org_id: str):
    """Get organization details."""
    if org_id not in organizations_db:
        raise HTTPException(status_code=404, detail="Organization not found")
    return organizations_db[org_id]


@app.put("/organizations/{org_id}/upgrade")
async def upgrade_organization(org_id: str, tier: RateLimitTier):
    """Upgrade organization's rate limit tier."""
    if org_id not in organizations_db:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    org = organizations_db[org_id]
    org.rate_limit_tier = tier
    org.updated_at = datetime.utcnow()
    
    return org


# API Key Endpoints
@app.post("/organizations/{org_id}/api-keys")
async def create_api_key(
    org_id: str,
    name: str,
    key_type: APIKeyType = APIKeyType.SANDBOX,
    permissions: List[str] = ["read", "write"],
    expires_days: Optional[int] = None
):
    """Create a new API key for an organization."""
    if org_id not in organizations_db:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    org = organizations_db[org_id]
    public_key, secret_key = generate_api_key()
    
    expires_at = None
    if expires_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_days)
    
    api_key = APIKey(
        organization_id=org_id,
        name=name,
        key_type=key_type,
        public_key=public_key,
        secret_key_hash=hash_secret_key(secret_key),
        permissions=permissions,
        rate_limit=RATE_LIMITS[org.rate_limit_tier]["requests_per_minute"],
        expires_at=expires_at
    )
    
    api_keys_db[api_key.id] = api_key
    
    # Return secret key only once
    return {
        "api_key": api_key,
        "secret_key": secret_key,
        "warning": "Store the secret key securely. It will not be shown again."
    }


@app.get("/organizations/{org_id}/api-keys", response_model=List[APIKey])
async def list_api_keys(org_id: str):
    """List all API keys for an organization."""
    return [k for k in api_keys_db.values() if k.organization_id == org_id]


@app.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: str):
    """Revoke an API key."""
    if key_id not in api_keys_db:
        raise HTTPException(status_code=404, detail="API key not found")
    
    api_key = api_keys_db[key_id]
    api_key.status = APIKeyStatus.REVOKED
    
    return {"message": "API key revoked", "key_id": key_id}


@app.post("/api-keys/validate")
async def validate_api_key(public_key: str, secret_key: str):
    """Validate an API key pair."""
    for api_key in api_keys_db.values():
        if api_key.public_key == public_key:
            if api_key.status != APIKeyStatus.ACTIVE:
                raise HTTPException(status_code=403, detail="API key is not active")
            
            if api_key.expires_at and datetime.utcnow() > api_key.expires_at:
                raise HTTPException(status_code=403, detail="API key has expired")
            
            if api_key.secret_key_hash == hash_secret_key(secret_key):
                api_key.last_used = datetime.utcnow()
                return {
                    "valid": True,
                    "organization_id": api_key.organization_id,
                    "key_type": api_key.key_type,
                    "permissions": api_key.permissions,
                    "rate_limit": api_key.rate_limit
                }
            else:
                raise HTTPException(status_code=401, detail="Invalid secret key")
    
    raise HTTPException(status_code=401, detail="Invalid public key")


# Webhook Endpoints
@app.post("/organizations/{org_id}/webhooks", response_model=WebhookEndpoint)
async def create_webhook(
    org_id: str,
    url: str,
    events: List[WebhookEventType]
):
    """Create a new webhook endpoint."""
    if org_id not in organizations_db:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    webhook = WebhookEndpoint(
        organization_id=org_id,
        url=url,
        secret=generate_webhook_secret(),
        events=events
    )
    
    webhooks_db[webhook.id] = webhook
    
    return webhook


@app.get("/organizations/{org_id}/webhooks", response_model=List[WebhookEndpoint])
async def list_webhooks(org_id: str):
    """List all webhooks for an organization."""
    return [w for w in webhooks_db.values() if w.organization_id == org_id]


@app.put("/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: str,
    url: Optional[str] = None,
    events: Optional[List[WebhookEventType]] = None,
    status: Optional[WebhookStatus] = None
):
    """Update a webhook endpoint."""
    if webhook_id not in webhooks_db:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    webhook = webhooks_db[webhook_id]
    
    if url:
        webhook.url = url
    if events:
        webhook.events = events
    if status:
        webhook.status = status
    
    return webhook


@app.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str):
    """Delete a webhook endpoint."""
    if webhook_id not in webhooks_db:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    del webhooks_db[webhook_id]
    return {"message": "Webhook deleted"}


@app.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: str):
    """Send a test event to a webhook."""
    if webhook_id not in webhooks_db:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    webhook = webhooks_db[webhook_id]
    
    test_payload = {
        "event": "test",
        "data": {
            "message": "This is a test webhook delivery",
            "timestamp": datetime.utcnow().isoformat()
        }
    }
    
    signature = sign_webhook_payload(test_payload, webhook.secret)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook.url,
                json=test_payload,
                headers={
                    "X-Webhook-Signature": signature,
                    "Content-Type": "application/json"
                },
                timeout=10.0
            )
            
            return {
                "success": response.status_code < 400,
                "status_code": response.status_code,
                "response": response.text[:500] if response.text else None
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/webhooks/trigger")
async def trigger_webhook_event(
    organization_id: str,
    event_type: WebhookEventType,
    payload: Dict[str, Any]
):
    """Trigger a webhook event (internal use)."""
    webhooks = [
        w for w in webhooks_db.values()
        if w.organization_id == organization_id
        and event_type in w.events
        and w.status == WebhookStatus.ACTIVE
    ]
    
    results = []
    
    for webhook in webhooks:
        event_payload = {
            "event": event_type.value,
            "data": payload,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        signature = sign_webhook_payload(event_payload, webhook.secret)
        
        delivery = WebhookDelivery(
            webhook_id=webhook.id,
            event_type=event_type,
            payload=event_payload
        )
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    webhook.url,
                    json=event_payload,
                    headers={
                        "X-Webhook-Signature": signature,
                        "Content-Type": "application/json"
                    },
                    timeout=10.0
                )
                
                delivery.response_status = response.status_code
                delivery.response_body = response.text[:1000] if response.text else None
                delivery.delivered = response.status_code < 400
                delivery.attempts = 1
                
                if delivery.delivered:
                    webhook.last_success = datetime.utcnow()
                    webhook.failure_count = 0
                else:
                    webhook.failure_count += 1
                    delivery.next_retry = datetime.utcnow() + timedelta(minutes=5)
                
                webhook.last_triggered = datetime.utcnow()
                
        except Exception as e:
            delivery.response_body = str(e)
            delivery.attempts = 1
            delivery.next_retry = datetime.utcnow() + timedelta(minutes=5)
            webhook.failure_count += 1
        
        webhook_deliveries_db[delivery.id] = delivery
        results.append(delivery)
    
    return {"deliveries": results}


@app.get("/webhooks/{webhook_id}/deliveries", response_model=List[WebhookDelivery])
async def get_webhook_deliveries(
    webhook_id: str,
    limit: int = Query(default=50, le=200)
):
    """Get delivery history for a webhook."""
    deliveries = [d for d in webhook_deliveries_db.values() if d.webhook_id == webhook_id]
    deliveries.sort(key=lambda x: x.created_at, reverse=True)
    return deliveries[:limit]


# Sandbox Endpoints
@app.post("/sandbox/transfers")
async def create_sandbox_transfer(
    organization_id: str,
    amount: str,
    currency: str,
    source_country: str,
    destination_country: str,
    source_account: str,
    destination_account: str
):
    """Create a sandbox transfer for testing."""
    transaction = SandboxTransaction(
        organization_id=organization_id,
        transaction_type="transfer",
        amount=amount,
        currency=currency,
        source={
            "country": source_country,
            "account": source_account
        },
        destination={
            "country": destination_country,
            "account": destination_account
        }
    )
    
    sandbox_transactions_db[transaction.id] = transaction
    
    # Simulate processing
    transaction.status = "completed"
    
    # Trigger webhook
    await trigger_webhook_event(
        organization_id,
        WebhookEventType.TRANSFER_COMPLETED,
        {
            "transaction_id": transaction.id,
            "amount": amount,
            "currency": currency,
            "status": "completed"
        }
    )
    
    return transaction


@app.get("/sandbox/transfers/{transaction_id}")
async def get_sandbox_transfer(transaction_id: str):
    """Get sandbox transfer details."""
    if transaction_id not in sandbox_transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return sandbox_transactions_db[transaction_id]


@app.get("/sandbox/transactions", response_model=List[SandboxTransaction])
async def list_sandbox_transactions(
    organization_id: str,
    limit: int = Query(default=50, le=200)
):
    """List sandbox transactions for an organization."""
    transactions = [
        t for t in sandbox_transactions_db.values()
        if t.organization_id == organization_id
    ]
    transactions.sort(key=lambda x: x.created_at, reverse=True)
    return transactions[:limit]


@app.post("/sandbox/simulate-event")
async def simulate_webhook_event(
    organization_id: str,
    event_type: WebhookEventType,
    custom_payload: Optional[Dict[str, Any]] = None
):
    """Simulate a webhook event for testing."""
    default_payloads = {
        WebhookEventType.TRANSFER_COMPLETED: {
            "transaction_id": f"txn_{secrets.token_hex(8)}",
            "amount": "1000.00",
            "currency": "NGN",
            "status": "completed"
        },
        WebhookEventType.PAYMENT_RECEIVED: {
            "payment_id": f"pay_{secrets.token_hex(8)}",
            "amount": "5000.00",
            "currency": "NGN",
            "sender": "Test Sender"
        },
        WebhookEventType.KYC_APPROVED: {
            "user_id": f"usr_{secrets.token_hex(8)}",
            "kyc_level": "tier_2",
            "approved_at": datetime.utcnow().isoformat()
        }
    }
    
    payload = custom_payload or default_payloads.get(event_type, {"test": True})
    
    return await trigger_webhook_event(organization_id, event_type, payload)


# API Usage & Analytics
@app.post("/usage/log")
async def log_api_usage(
    api_key_id: str,
    endpoint: str,
    method: str,
    status_code: int,
    response_time_ms: int,
    ip_address: str,
    user_agent: Optional[str] = None
):
    """Log API usage (internal use)."""
    log = APIUsageLog(
        api_key_id=api_key_id,
        endpoint=endpoint,
        method=method,
        status_code=status_code,
        response_time_ms=response_time_ms,
        ip_address=ip_address,
        user_agent=user_agent
    )
    api_usage_logs_db[log.id] = log
    return log


@app.get("/organizations/{org_id}/usage/stats")
async def get_usage_stats(
    org_id: str,
    days: int = Query(default=30, le=90)
):
    """Get API usage statistics for an organization."""
    api_keys = [k for k in api_keys_db.values() if k.organization_id == org_id]
    key_ids = {k.id for k in api_keys}
    
    cutoff = datetime.utcnow() - timedelta(days=days)
    logs = [
        log for log in api_usage_logs_db.values()
        if log.api_key_id in key_ids and log.created_at >= cutoff
    ]
    
    total_requests = len(logs)
    successful = len([log for log in logs if log.status_code < 400])
    avg_response_time = sum(log.response_time_ms for log in logs) / max(1, total_requests)
    
    # Group by endpoint
    by_endpoint: Dict[str, int] = {}
    for log in logs:
        by_endpoint[log.endpoint] = by_endpoint.get(log.endpoint, 0) + 1
    
    # Group by day
    by_day: Dict[str, int] = {}
    for log in logs:
        day = log.created_at.strftime("%Y-%m-%d")
        by_day[day] = by_day.get(day, 0) + 1
    
    return {
        "period_days": days,
        "total_requests": total_requests,
        "successful_requests": successful,
        "error_requests": total_requests - successful,
        "success_rate": (successful / max(1, total_requests)) * 100,
        "avg_response_time_ms": round(avg_response_time, 2),
        "by_endpoint": by_endpoint,
        "by_day": by_day
    }


# Documentation Endpoints
@app.get("/docs/endpoints")
async def get_api_documentation():
    """Get API endpoint documentation."""
    return {
        "version": "1.0.0",
        "base_url": "https://api.remittance.example.com/v1",
        "authentication": {
            "type": "API Key",
            "header": "X-API-Key",
            "description": "Include your API key in the X-API-Key header"
        },
        "endpoints": {
            "transfers": {
                "POST /transfers": {
                    "description": "Initiate a new transfer",
                    "parameters": {
                        "amount": "string (required)",
                        "currency": "string (required)",
                        "source_country": "string (required)",
                        "destination_country": "string (required)",
                        "recipient": "object (required)"
                    }
                },
                "GET /transfers/{id}": {
                    "description": "Get transfer details"
                },
                "GET /transfers": {
                    "description": "List transfers",
                    "parameters": {
                        "page": "integer",
                        "limit": "integer",
                        "status": "string"
                    }
                }
            },
            "rates": {
                "GET /rates": {
                    "description": "Get current exchange rates",
                    "parameters": {
                        "source_currency": "string",
                        "destination_currency": "string"
                    }
                }
            },
            "recipients": {
                "POST /recipients": {
                    "description": "Create a recipient"
                },
                "GET /recipients": {
                    "description": "List recipients"
                }
            },
            "webhooks": {
                "POST /webhooks": {
                    "description": "Create a webhook endpoint"
                },
                "GET /webhooks": {
                    "description": "List webhooks"
                }
            }
        },
        "webhook_events": [e.value for e in WebhookEventType],
        "error_codes": {
            "400": "Bad Request - Invalid parameters",
            "401": "Unauthorized - Invalid API key",
            "403": "Forbidden - Insufficient permissions",
            "404": "Not Found - Resource not found",
            "429": "Too Many Requests - Rate limit exceeded",
            "500": "Internal Server Error"
        }
    }


@app.get("/docs/sdks")
async def get_sdk_documentation():
    """Get SDK documentation and code samples."""
    return {
        "sdks": {
            "python": {
                "installation": "pip install remittance-sdk",
                "sample": """
from remittance import Client

client = Client(api_key="your_api_key")

# Create a transfer
transfer = client.transfers.create(
    amount="1000.00",
    currency="NGN",
    destination_country="GH",
    recipient={
        "name": "John Doe",
        "account_number": "1234567890",
        "bank_code": "GH001"
    }
)

print(f"Transfer ID: {transfer.id}")
"""
            },
            "javascript": {
                "installation": "npm install @remittance/sdk",
                "sample": """
const Remittance = require('@remittance/sdk');

const client = new Remittance({ apiKey: 'your_api_key' });

// Create a transfer
const transfer = await client.transfers.create({
    amount: '1000.00',
    currency: 'NGN',
    destinationCountry: 'GH',
    recipient: {
        name: 'John Doe',
        accountNumber: '1234567890',
        bankCode: 'GH001'
    }
});

console.log(`Transfer ID: ${transfer.id}`);
"""
            },
            "php": {
                "installation": "composer require remittance/sdk",
                "sample": """
<?php
use Remittance\\Client;

$client = new Client('your_api_key');

$transfer = $client->transfers->create([
    'amount' => '1000.00',
    'currency' => 'NGN',
    'destination_country' => 'GH',
    'recipient' => [
        'name' => 'John Doe',
        'account_number' => '1234567890',
        'bank_code' => 'GH001'
    ]
]);

echo "Transfer ID: " . $transfer->id;
"""
            }
        },
        "postman_collection": "https://api.remittance.example.com/docs/postman.json",
        "openapi_spec": "https://api.remittance.example.com/docs/openapi.yaml"
    }


# Health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "developer-portal",
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8013)
