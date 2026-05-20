# WISE Payment Gateway

## Configuration

Set environment variable:
```
WISE_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.wise.service import WiseService

service = WiseService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
