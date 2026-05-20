# AZIMO Payment Gateway

## Configuration

Set environment variable:
```
AZIMO_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.azimo.service import AzimoService

service = AzimoService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
