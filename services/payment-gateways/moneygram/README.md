# MONEYGRAM Payment Gateway

## Configuration

Set environment variable:
```
MONEYGRAM_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.moneygram.service import MoneygramService

service = MoneygramService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
