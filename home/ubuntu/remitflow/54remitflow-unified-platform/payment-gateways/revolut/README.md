# REVOLUT Payment Gateway

## Configuration

Set environment variable:
```
REVOLUT_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.revolut.service import RevolutService

service = RevolutService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
