# M-PESA Payment Gateway

## Configuration

Set environment variable:
```
M-PESA_API_KEY=your_api_key_here
```

## Usage

```python
from backend.payment_gateways.m-pesa.service import MPesaService

service = MPesaService()
result = await service.process_transfer({
    "amount": 1000,
    "currency": "NGN",
    "recipient": "account_id"
})
```
