# MTN-MOMO Payment Gateway

## Configuration

Set environment variable:
```
MTN-MOMO_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.mtn-momo.service import MtnMomoService

service = MtnMomoService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
