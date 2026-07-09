# RIA Payment Gateway

## Configuration

Set environment variable:
```
RIA_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.ria.service import RiaService

service = RiaService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
