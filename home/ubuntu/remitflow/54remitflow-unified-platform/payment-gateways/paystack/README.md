# PAYSTACK Payment Gateway

## Configuration

Set environment variable:
```
PAYSTACK_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.paystack.service import PaystackService

service = PaystackService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
