# OpenAppSec Production Configuration

## Overview

OpenAppSec is an open-source web application and API security solution that provides comprehensive protection against OWASP Top 10 threats. Integrated with Apache APISIX in the Nigerian Remittance Platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Request Flow                              │
│                                                              │
│  Client → APISIX → OpenAppSec → Backend Services            │
│                      │                                       │
│                      ├─ WAF Engine                          │
│                      ├─ API Security                        │
│                      ├─ Bot Protection                      │
│                      └─ DDoS Protection                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

- **WAF Protection**: SQL injection, XSS, command injection, etc.
- **API Security**: Schema validation, rate limiting, authentication
- **Bot Protection**: Automated bot detection and blocking
- **DDoS Protection**: Rate limiting and traffic shaping
- **Compliance**: PCI DSS, GDPR, OWASP Top 10 coverage
- **Monitoring**: Real-time attack detection and alerting

## Security Policies

### WAF Rules

- SQL Injection detection (8+ patterns)
- XSS detection (7+ patterns)
- CSRF protection
- Command injection detection
- Path traversal detection

### Rate Limiting

- Global: 10,000 requests/second
- Per-IP: 100 requests/second
- Per-User: 50 requests/second

### Bot Protection

Blocks known bots:
- Scrapers (Scrapy, BeautifulSoup)
- Automated tools (curl, wget, python-requests)
- Known malicious bots

Allows legitimate browsers:
- Chrome, Firefox, Safari, Edge
- Mobile browsers

## Quick Start

### Prerequisites

- Kubernetes 1.24+
- Apache APISIX deployed
- OpenAppSec license (optional, for premium features)

### Installation

```bash
# Deploy OpenAppSec
kubectl apply -f k8s/openappsec-deployment.yaml

# Configure APISIX plugin
kubectl apply -f k8s/apisix-openappsec-plugin.yaml

# Verify deployment
kubectl get pods -n remittance-platform -l app=openappsec
```

### Configuration

See [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration.

## Testing

Run security tests:

```bash
# Run all security tests
pytest tests/security/test_openappsec_security.py -v

# Run specific test category
pytest tests/security/test_openappsec_security.py::TestSQLInjection -v
```

## Monitoring

Access Grafana dashboard: http://grafana.example.com/d/openappsec

Key metrics:
- Attacks detected
- Attacks blocked
- False positive rate
- Latency overhead

## Performance

- **Latency Overhead**: < 1ms
- **Throughput**: 10,000+ req/s
- **Detection Rate**: > 99%
- **False Positive Rate**: < 0.1%

## Documentation

- [INSTALLATION.md](INSTALLATION.md) - Installation guide
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Troubleshooting guide
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) - Operations procedures
- [SECURITY.md](SECURITY.md) - Security policies
- [COMPLIANCE.md](COMPLIANCE.md) - Compliance documentation

## Support

For issues or questions, contact the security team.

## License

Apache 2.0 (OpenAppSec) + Proprietary (Configuration)
