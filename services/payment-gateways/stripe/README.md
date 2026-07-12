# STRIPE Payment Gateway

## Configuration

Set environment variable:
```
STRIPE_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.stripe.service import StripeService

service = StripeService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
