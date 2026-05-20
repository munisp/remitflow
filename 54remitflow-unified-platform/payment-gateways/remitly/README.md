# REMITLY Payment Gateway

## Configuration

Set environment variable:
```
REMITLY_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.remitly.service import RemitlyService

service = RemitlyService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
