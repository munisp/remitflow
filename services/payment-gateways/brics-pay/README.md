# BRICS-PAY Payment Gateway

## Configuration

Set environment variable:
```
BRICS_PAY_API_KEY=...
BRICS_PAY_SECRET_KEY=...
BRICS_PAY_MERCHANT_ID=...
```

## Usage

```python
from backend.payment_gateways.brics-pay.service import BricsPayService

service = BricsPayService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
