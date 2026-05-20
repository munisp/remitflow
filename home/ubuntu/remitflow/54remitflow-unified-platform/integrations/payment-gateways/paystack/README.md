# Paystack Integration Module

**Production-ready Paystack payment gateway integration for Nigerian Remittance Platform**

## Overview

This module provides a comprehensive, production-ready integration with the Paystack payment gateway. It includes:

- ✅ Complete API client with all Paystack endpoints
- ✅ High-level service layer with business logic
- ✅ FastAPI REST API for easy integration
- ✅ Webhook handling with signature verification
- ✅ Transaction, customer, and refund management
- ✅ Bank account verification
- ✅ Comprehensive error handling
- ✅ Logging and monitoring
- ✅ Type hints and documentation

## Features

### Payment Processing
- Initialize transactions
- Verify payments
- Charge saved cards
- Support multiple payment channels (card, bank, USSD, QR, mobile money, bank transfer)

### Customer Management
- Create and manage customers
- Save card authorizations for recurring payments
- Get customer transaction history

### Refunds & Transfers
- Process full or partial refunds
- Initiate transfers to customers
- Verify transfer status

### Bank Operations
- List supported banks
- Verify bank account numbers
- Get account names

### Webhooks
- Secure webhook handling with signature verification
- Support for all Paystack events
- Automatic event processing

## Installation

### 1. Install Dependencies

```bash
cd PAYSTACK_INTEGRATION
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file:

```bash
# Paystack API Keys
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here

# Application Settings
APP_ENV=development
LOG_LEVEL=INFO
```

### 3. Run the Service

```bash
# Development
uvicorn src.main:app --reload --port 8000

# Production
uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## Usage

### Python Client Usage

```python
from src.api.paystack_client import PaystackClient
from src.services.paystack_service import PaystackService

# Initialize client
client = PaystackClient(
    secret_key="sk_test_your_key",
    public_key="pk_test_your_key"
)

# Or use the service layer (recommended)
service = PaystackService()

# Initiate payment
payment = service.initiate_payment(
    email="customer@example.com",
    amount_ngn=5000.00,
    callback_url="https://yoursite.com/payment/callback"
)

print(f"Payment URL: {payment['authorization_url']}")
print(f"Reference: {payment['reference']}")

# Verify payment
result = service.verify_payment(reference=payment['reference'])
print(f"Status: {result['status']}")
print(f"Amount: {result['amount']} NGN")
```

### REST API Usage

#### 1. Initiate Payment

```bash
curl -X POST http://localhost:8000/payments/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "amount_ngn": 5000.00,
    "callback_url": "https://yoursite.com/callback"
  }'
```

Response:
```json
{
  "status": "success",
  "data": {
    "reference": "TXN-20231102120000-ABC12345",
    "authorization_url": "https://checkout.paystack.com/abc123",
    "access_code": "abc123xyz",
    "amount_ngn": 5000.0,
    "amount_kobo": 500000
  }
}
```

#### 2. Verify Payment

```bash
curl -X POST http://localhost:8000/payments/verify \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "TXN-20231102120000-ABC12345"
  }'
```

Response:
```json
{
  "status": "success",
  "data": {
    "reference": "TXN-20231102120000-ABC12345",
    "status": "success",
    "amount": 5000.0,
    "currency": "NGN",
    "customer": {
      "email": "customer@example.com"
    },
    "paid_at": "2023-11-02T12:05:00Z",
    "channel": "card"
  }
}
```

#### 3. Create Customer

```bash
curl -X POST http://localhost:8000/customers \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+2348012345678"
  }'
```

#### 4. Verify Bank Account

```bash
curl -X POST http://localhost:8000/banks/verify-account \
  -H "Content-Type: application/json" \
  -d '{
    "account_number": "0123456789",
    "bank_code": "058"
  }'
```

Response:
```json
{
  "status": "success",
  "data": {
    "account_number": "0123456789",
    "account_name": "JOHN DOE",
    "bank_code": "058"
  }
}
```

#### 5. Process Refund

```bash
curl -X POST http://localhost:8000/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_reference": "TXN-20231102120000-ABC12345",
    "amount_ngn": 1000.00,
    "customer_note": "Partial refund for order cancellation"
  }'
```

### Webhook Integration

#### 1. Configure Webhook URL in Paystack Dashboard

Set your webhook URL to: `https://yoursite.com/webhooks/paystack/`

#### 2. Webhook Handler

The webhook handler automatically:
- Verifies signature
- Processes events
- Updates transaction status
- Logs all events

Supported events:
- `charge.success` - Payment successful
- `transfer.success` - Transfer completed
- `transfer.failed` - Transfer failed
- `refund.processed` - Refund processed

## API Endpoints

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments/initiate` | Initialize payment |
| POST | `/payments/verify` | Verify payment |
| POST | `/payments/charge` | Charge saved card |

### Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/customers` | Create customer |
| GET | `/customers/{email_or_code}` | Get customer |

### Refunds

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/refunds` | Process refund |

### Transfers

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transfers` | Initiate transfer |

### Banks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/banks` | List banks |
| POST | `/banks/verify-account` | Verify account |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhooks/paystack/` | Handle webhook |

## Testing

### Run Tests

```bash
pytest tests/ -v --cov=src
```

### Test with Paystack Test Keys

Use Paystack test keys for development:
- Secret: `sk_test_...`
- Public: `pk_test_...`

Test cards:
- Success: `4084084084084081`
- Insufficient funds: `4084080000000408`
- Invalid card: `4084080000001234`

## Production Deployment

### 1. Environment Configuration

```bash
# Production .env
PAYSTACK_SECRET_KEY=sk_live_your_live_secret_key
PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
APP_ENV=production
LOG_LEVEL=WARNING
```

### 2. Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

Build and run:
```bash
docker build -t paystack-integration .
docker run -p 8000:8000 --env-file .env paystack-integration
```

### 3. Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: paystack-integration
spec:
  replicas: 3
  selector:
    matchLabels:
      app: paystack-integration
  template:
    metadata:
      labels:
        app: paystack-integration
    spec:
      containers:
      - name: paystack-integration
        image: paystack-integration:latest
        ports:
        - containerPort: 8000
        env:
        - name: PAYSTACK_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: paystack-secrets
              key: secret-key
        - name: PAYSTACK_PUBLIC_KEY
          valueFrom:
            secretKeyRef:
              name: paystack-secrets
              key: public-key
```

## Security Best Practices

1. **Never commit API keys** - Use environment variables
2. **Verify webhook signatures** - Always validate Paystack signatures
3. **Use HTTPS** - All communication should be over HTTPS
4. **Validate amounts** - Always verify transaction amounts
5. **Log everything** - Maintain audit logs for all transactions
6. **Rate limiting** - Implement rate limiting on API endpoints
7. **Monitor transactions** - Set up alerts for suspicious activity

## Integration with Nigerian Remittance Platform

### 1. Add to Platform

```bash
# Copy to platform
cp -r PAYSTACK_INTEGRATION /path/to/NIGERIAN_REMITTANCE_UNIFIED_ALL_COMPLETE/integrations/paystack

# Install dependencies
cd /path/to/NIGERIAN_REMITTANCE_UNIFIED_ALL_COMPLETE/integrations/paystack
pip install -r requirements.txt
```

### 2. Configure Service

Add to `docker-compose.yml`:

```yaml
services:
  paystack-integration:
    build: ./integrations/paystack
    ports:
      - "8003:8000"
    environment:
      - PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}
      - PAYSTACK_PUBLIC_KEY=${PAYSTACK_PUBLIC_KEY}
    networks:
      - remittance-network
```

### 3. Update API Gateway

Add Paystack routes to API gateway configuration.

## Monitoring

### Metrics to Track

- Transaction success rate
- Average transaction amount
- Failed transaction reasons
- Webhook processing time
- API response times
- Refund rate

### Logging

All operations are logged with:
- Timestamp
- Operation type
- Transaction reference
- Status
- Error messages (if any)

## Support

### Paystack Documentation
- [Paystack API Docs](https://paystack.com/docs/api/)
- [Paystack Dashboard](https://dashboard.paystack.com/)

### Common Issues

1. **Invalid signature** - Check secret key configuration
2. **Transaction not found** - Verify reference format
3. **Insufficient funds** - Customer's card has insufficient balance
4. **Network timeout** - Increase timeout or retry

## License

This module is part of the Nigerian Remittance Platform.

## Changelog

### Version 1.0.0 (2023-11-02)
- Initial release
- Complete Paystack API integration
- FastAPI REST API
- Webhook handling
- Comprehensive documentation
