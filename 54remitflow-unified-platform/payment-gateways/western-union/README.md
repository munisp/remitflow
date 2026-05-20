# WESTERN-UNION Payment Gateway

## Configuration

Set environment variable:
```
WESTERN-UNION_API_KEY=your_api_key_here
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
