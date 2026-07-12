# WORLDREMIT Payment Gateway

## Configuration

Set environment variable:
```
WORLDREMIT_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.worldremit.service import WorldremitService

service = WorldremitService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
