# WESTERN-UNION Payment Gateway

## Configuration

Set environment variable:
```
WESTERN_UNION_API_KEY=...
WESTERN_UNION_SECRET_KEY=...
WESTERN_UNION_PARTNER_ID=...
```

## Usage

```python
from backend.payment_gateways.western-union.service import WesternUnionService

service = WesternUnionService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
