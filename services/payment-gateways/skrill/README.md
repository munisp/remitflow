# SKRILL Payment Gateway

## Configuration

Set environment variable:
```
SKRILL_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.skrill.service import SkrillService

service = SkrillService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
