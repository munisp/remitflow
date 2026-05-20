# RemitFlow Microservices Smoke Tests

Python smoke test suite for all RemitFlow microservices.

## Services Tested

| Service | Port | Description |
|---|---|---|
| analytics | 8085 | Analytics pipeline (KPIs, reports) |
| pdf-receipt | 8086 | PDF receipt/statement generator |
| fraud-ml | 8082 | ML-based fraud scoring |
| aml-engine | 8083 | AML/sanctions screening |
| node-api | 3000 | Main Node.js API |

## Usage

```bash
# Install dependencies
pip install -r requirements.txt

# Run all tests (services must be running)
python smoke_test.py

# Test a single service
python smoke_test.py --service analytics

# Custom URLs
python smoke_test.py --analytics-url http://analytics:8085 --node-api-url http://api:3000
```

## Exit Codes

- `0` — all tests passed
- `1` — one or more tests failed

## CI Integration

```yaml
- name: Run microservice smoke tests
  run: |
    pip install -r services/smoke-tests/requirements.txt
    python services/smoke-tests/smoke_test.py
```
