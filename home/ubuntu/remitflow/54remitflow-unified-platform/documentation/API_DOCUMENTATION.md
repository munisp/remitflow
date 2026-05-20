# 📚 Remittance Platform - API Documentation

**Version:** 1.0.0  
**Date:** October 29, 2025  
**Base URL:** `https://api.remittance-platform.com/v1`

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Mobile APIs](#mobile-apis)
3. [Security APIs](#security-apis)
4. [Analytics APIs](#analytics-apis)
5. [Advanced Features APIs](#advanced-features-apis)
6. [Developing Countries APIs](#developing-countries-apis)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [Webhooks](#webhooks)

---

## Authentication

### **JWT Authentication**

All API requests require a valid JWT token in the Authorization header.

```http
Authorization: Bearer <your_jwt_token>
```

### **Get Access Token**

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password",
  "device_id": "unique_device_id"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### **Refresh Token**

```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

## Mobile APIs

### **User Profile**

#### Get Profile
```http
GET /users/profile
Authorization: Bearer <token>
```

**Response:**
```json
{
  "user_id": "usr_123",
  "email": "user@example.com",
  "name": "John Doe",
  "phone": "+2348012345678",
  "kyc_status": "verified",
  "account_balance": 50000.00,
  "currency": "NGN"
}
```

#### Update Profile
```http
PUT /users/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Updated",
  "phone": "+2348012345679"
}
```

### **Transactions**

#### Get Transactions
```http
GET /transactions?limit=20&offset=0&status=completed
Authorization: Bearer <token>
```

**Response:**
```json
{
  "transactions": [
    {
      "transaction_id": "txn_123",
      "type": "transfer",
      "amount": 5000.00,
      "currency": "NGN",
      "status": "completed",
      "timestamp": "2025-10-29T10:30:00Z",
      "recipient": {
        "name": "Jane Doe",
        "account": "1234567890"
      }
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

#### Create Transaction
```http
POST /transactions
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "transfer",
  "amount": 5000.00,
  "currency": "NGN",
  "recipient_account": "1234567890",
  "description": "Payment for services",
  "pin": "1234"
}
```

**Response:**
```json
{
  "transaction_id": "txn_124",
  "status": "pending",
  "estimated_completion": "2025-10-29T10:35:00Z",
  "reference": "REF123456"
}
```

---

## Security APIs

### **Certificate Pinning**

#### Verify Certificate
```http
POST /security/certificate/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "domain": "api.remittance-platform.com",
  "certificate_hash": "sha256/AAAAAAAAAA..."
}
```

### **Device Binding**

#### Register Device
```http
POST /security/device/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_id": "unique_device_id",
  "device_name": "iPhone 14 Pro",
  "os": "iOS",
  "os_version": "17.0",
  "app_version": "1.0.0",
  "fingerprint": {
    "model": "iPhone15,2",
    "manufacturer": "Apple",
    "brand": "Apple"
  }
}
```

**Response:**
```json
{
  "device_token": "dev_token_123",
  "status": "registered",
  "requires_mfa": true
}
```

#### Verify Device
```http
POST /security/device/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_id": "unique_device_id",
  "device_token": "dev_token_123"
}
```

### **Multi-Factor Authentication**

#### Setup TOTP
```http
POST /security/mfa/totp/setup
Authorization: Bearer <token>
```

**Response:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_code": "data:image/png;base64,iVBORw0KGgo...",
  "backup_codes": [
    "12345678",
    "23456789",
    "34567890"
  ]
}
```

#### Verify TOTP
```http
POST /security/mfa/totp/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "123456"
}
```

### **Transaction Signing**

#### Sign Transaction
```http
POST /security/transaction/sign
Authorization: Bearer <token>
Content-Type: application/json

{
  "transaction_id": "txn_123",
  "biometric_signature": "base64_encoded_signature"
}
```

---

## Analytics APIs

### **User Analytics**

#### Track Event
```http
POST /analytics/events
Authorization: Bearer <token>
Content-Type: application/json

{
  "event_type": "screen_view",
  "screen_name": "Dashboard",
  "timestamp": "2025-10-29T10:30:00Z",
  "properties": {
    "session_id": "sess_123",
    "duration": 45
  }
}
```

#### Get User Metrics
```http
GET /analytics/users/metrics?period=30d
Authorization: Bearer <token>
```

**Response:**
```json
{
  "period": "30d",
  "metrics": {
    "total_sessions": 45,
    "avg_session_duration": 320,
    "total_transactions": 28,
    "total_spent": 150000.00,
    "most_used_features": [
      "transfers",
      "bill_payments",
      "airtime"
    ]
  }
}
```

### **A/B Testing**

#### Get Variant
```http
POST /analytics/ab-test/variant
Authorization: Bearer <token>
Content-Type: application/json

{
  "experiment_id": "exp_123",
  "user_id": "usr_123"
}
```

**Response:**
```json
{
  "experiment_id": "exp_123",
  "variant": "variant_b",
  "features": {
    "button_color": "blue",
    "layout": "grid"
  }
}
```

#### Track Conversion
```http
POST /analytics/ab-test/conversion
Authorization: Bearer <token>
Content-Type: application/json

{
  "experiment_id": "exp_123",
  "variant": "variant_b",
  "conversion_type": "signup",
  "value": 1
}
```

---

## Advanced Features APIs

### **Voice Assistant**

#### Process Voice Command
```http
POST /features/voice/command
Authorization: Bearer <token>
Content-Type: multipart/form-data

audio: <audio_file>
language: en-US
```

**Response:**
```json
{
  "command": "check balance",
  "intent": "balance_inquiry",
  "confidence": 0.95,
  "response": {
    "text": "Your current balance is 50,000 Naira",
    "audio_url": "https://cdn.remittance-platform.com/audio/response_123.mp3",
    "data": {
      "balance": 50000.00,
      "currency": "NGN"
    }
  }
}
```

### **QR Code Payments**

#### Generate QR Code
```http
POST /features/qr/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 5000.00,
  "currency": "NGN",
  "description": "Payment for goods",
  "expires_in": 300
}
```

**Response:**
```json
{
  "qr_code_id": "qr_123",
  "qr_code_data": "data:image/png;base64,iVBORw0KGgo...",
  "qr_code_string": "remittance://pay?id=qr_123&amount=5000",
  "expires_at": "2025-10-29T10:35:00Z"
}
```

#### Scan QR Code
```http
POST /features/qr/scan
Authorization: Bearer <token>
Content-Type: application/json

{
  "qr_code_string": "remittance://pay?id=qr_123&amount=5000"
}
```

**Response:**
```json
{
  "qr_code_id": "qr_123",
  "merchant": {
    "name": "ABC Store",
    "account": "1234567890"
  },
  "amount": 5000.00,
  "currency": "NGN",
  "description": "Payment for goods",
  "valid": true
}
```

### **Wearable Integration**

#### Sync to Wearable
```http
POST /features/wearable/sync
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_type": "apple_watch",
  "data": {
    "balance": true,
    "recent_transactions": 5,
    "notifications": true
  }
}
```

---

## Developing Countries APIs

### **Offline Sync**

#### Queue Offline Request
```http
POST /offline/queue
Authorization: Bearer <token>
Content-Type: application/json

{
  "request_id": "req_123",
  "method": "POST",
  "endpoint": "/transactions",
  "payload": {
    "type": "transfer",
    "amount": 1000.00
  },
  "timestamp": "2025-10-29T10:30:00Z",
  "priority": "high"
}
```

#### Sync Offline Requests
```http
POST /offline/sync
Authorization: Bearer <token>
Content-Type: application/json

{
  "requests": [
    {
      "request_id": "req_123",
      "method": "POST",
      "endpoint": "/transactions",
      "payload": {...}
    }
  ]
}
```

**Response:**
```json
{
  "synced": 5,
  "failed": 0,
  "results": [
    {
      "request_id": "req_123",
      "status": "success",
      "transaction_id": "txn_124"
    }
  ]
}
```

### **SMS Banking**

#### Send SMS Command
```http
POST /sms/command
Content-Type: application/json

{
  "phone": "+2348012345678",
  "command": "BAL",
  "pin": "1234"
}
```

**Response (via SMS):**
```
Your balance is NGN 50,000.00
Available: NGN 45,000.00
```

### **Data Compression**

#### Get Compressed Data
```http
GET /data/compressed?resource=transactions&limit=100
Authorization: Bearer <token>
Accept-Encoding: gzip
```

**Response Headers:**
```
Content-Encoding: gzip
X-Original-Size: 125000
X-Compressed-Size: 12500
X-Compression-Ratio: 90%
```

---

## Error Handling

### **Error Response Format**

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient funds for this transaction",
    "details": {
      "available_balance": 5000.00,
      "required_amount": 10000.00
    },
    "request_id": "req_123",
    "timestamp": "2025-10-29T10:30:00Z"
  }
}
```

### **Common Error Codes**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or expired token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `INSUFFICIENT_FUNDS` | 400 | Not enough balance |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Internal server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Rate Limiting

### **Rate Limit Headers**

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1635523200
```

### **Rate Limits by Endpoint**

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/auth/login` | 5 | 15 minutes |
| `/transactions` | 100 | 1 hour |
| `/analytics/events` | 1000 | 1 hour |
| `/features/voice/command` | 50 | 1 hour |
| Default | 1000 | 1 hour |

---

## Webhooks

### **Configure Webhook**

```http
POST /webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": ["transaction.completed", "transaction.failed"],
  "secret": "webhook_secret_key"
}
```

### **Webhook Payload**

```json
{
  "event": "transaction.completed",
  "timestamp": "2025-10-29T10:30:00Z",
  "data": {
    "transaction_id": "txn_123",
    "type": "transfer",
    "amount": 5000.00,
    "status": "completed"
  },
  "signature": "sha256=..."
}
```

### **Verify Webhook Signature**

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

---

## SDK Examples

### **JavaScript/TypeScript**

```typescript
import { AgentBankingClient } from '@remittance/sdk';

const client = new AgentBankingClient({
  apiKey: 'your_api_key',
  environment: 'production'
});

// Get user profile
const profile = await client.users.getProfile();

// Create transaction
const transaction = await client.transactions.create({
  type: 'transfer',
  amount: 5000.00,
  recipient: '1234567890'
});
```

### **Python**

```python
from remittance import Client

client = Client(api_key='your_api_key')

# Get user profile
profile = client.users.get_profile()

# Create transaction
transaction = client.transactions.create(
    type='transfer',
    amount=5000.00,
    recipient='1234567890'
)
```

### **React Native**

```typescript
import { useAgentBanking } from '@remittance/react-native';

function TransferScreen() {
  const { createTransaction } = useAgentBanking();
  
  const handleTransfer = async () => {
    const result = await createTransaction({
      type: 'transfer',
      amount: 5000.00,
      recipient: '1234567890'
    });
  };
}
```

---

## Testing

### **Sandbox Environment**

**Base URL:** `https://sandbox-api.remittance-platform.com/v1`

### **Test Credentials**

```
Email: test@remittance-platform.com
Password: Test123!
PIN: 1234
```

### **Test Cards**

```
Successful: 4242 4242 4242 4242
Declined: 4000 0000 0000 0002
Insufficient Funds: 4000 0000 0000 9995
```

---

**API Documentation Version:** 1.0.0  
**Last Updated:** October 29, 2025  
**Status:** ✅ Production Ready

