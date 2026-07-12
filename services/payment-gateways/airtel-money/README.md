# AIRTEL-MONEY Payment Gateway

## Configuration

Set environment variable:
```
AIRTEL-MONEY_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.airtel-money.service import AirtelMoneyService

service = AirtelMoneyService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
