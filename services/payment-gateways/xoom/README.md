# XOOM Payment Gateway

## Configuration

Set environment variable:
```
XOOM_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.xoom.service import XoomService

service = XoomService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
