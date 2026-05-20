# OpenAppSec Configuration Guide

## Configuration Files

### openappsec.yaml

```yaml
security:
  waf:
    enabled: true
    mode: blocking
    rules:
      - sql_injection
      - xss
      - command_injection
      - path_traversal
  
  api:
    enabled: true
    schema_validation: true
    rate_limiting:
      enabled: true
      requests_per_second: 100
  
  bot:
    enabled: true
    challenge: captcha
    blocked_user_agents:
      - python-requests
      - curl
      - wget
  
  ddos:
    enabled: true
    global_rate_limit: 10000
    per_ip_rate_limit: 100
```

## Environment Variables

- `OPENAPPSEC_MODE`: Operation mode (blocking, monitoring)
- `OPENAPPSEC_LOG_LEVEL`: Log level (debug, info, warning, error)
- `OPENAPPSEC_METRICS_PORT`: Prometheus metrics port (default: 9093)

## WAF Configuration

### SQL Injection Protection

```yaml
waf:
  sql_injection:
    enabled: true
    patterns:
      - "' OR '1'='1"
      - "UNION SELECT"
      - "DROP TABLE"
    action: block
```

### XSS Protection

```yaml
waf:
  xss:
    enabled: true
    patterns:
      - "<script>"
      - "javascript:"
      - "onerror="
    action: block
```

## API Security Configuration

### Schema Validation

```yaml
api:
  schema_validation:
    enabled: true
    schemas:
      - path: /api/v1/transfer
        method: POST
        schema_file: schemas/transfer.json
```

### Rate Limiting

```yaml
api:
  rate_limiting:
    global: 10000  # requests/second
    per_ip: 100    # requests/second
    per_user: 50   # requests/second
```

## Bot Protection Configuration

### Blocked User Agents

```yaml
bot:
  blocked_user_agents:
    - python-requests
    - curl
    - wget
    - scrapy
    - selenium
```

### CAPTCHA Configuration

```yaml
bot:
  captcha:
    enabled: true
    provider: recaptcha
    site_key: YOUR_SITE_KEY
    secret_key: YOUR_SECRET_KEY
```

## DDoS Protection Configuration

```yaml
ddos:
  enabled: true
  thresholds:
    global: 10000      # req/s
    per_ip: 100        # req/s
    per_endpoint: 500  # req/s
  action: rate_limit
```

## Compliance Configuration

### PCI DSS

```yaml
compliance:
  pci_dss:
    enabled: true
    requirements:
      - req_6_5_1  # SQL injection
      - req_6_5_7  # XSS
```

### GDPR

```yaml
compliance:
  gdpr:
    enabled: true
    data_protection: true
    privacy_controls: true
```

## Performance Tuning

### Cache Configuration

```yaml
cache:
  enabled: true
  size: 1GB
  ttl: 3600
```

### Thread Configuration

```yaml
threads:
  workers: 8
  max_connections: 10000
```
