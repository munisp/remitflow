# TRANSFERGO Payment Gateway

## Configuration

Set environment variable:
```
TRANSFERGO_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.transfergo.service import TransfergoService

service = TransfergoService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
