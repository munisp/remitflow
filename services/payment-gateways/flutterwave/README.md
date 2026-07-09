# FLUTTERWAVE Payment Gateway

## Configuration

Set environment variable:
```
FLUTTERWAVE_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.flutterwave.service import FlutterwaveService

service = FlutterwaveService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
