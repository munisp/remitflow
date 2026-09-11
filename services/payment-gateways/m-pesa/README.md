# M-PESA Payment Gateway

## Configuration

Set environment variable:
```
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...
MPESA_PASSKEY=...
MPESA_INITIATOR_NAME=...
MPESA_SECURITY_CREDENTIAL=...
MPESA_RESULT_URL=https://api.remitflow.example/webhooks/m-pesa/result
MPESA_TIMEOUT_URL=https://api.remitflow.example/webhooks/m-pesa/timeout
MPESA_CALLBACK_URL=https://api.remitflow.example/webhooks/m-pesa/stk
```

## Usage

```python
from backend.payment_gateways.m-pesa.service import MPesaService

service = MPesaService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
