# Security Policy

## Supported Versions

RemitFlow follows a rolling release model. Security patches are applied to the latest main branch. We recommend always running the latest version.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

RemitFlow processes financial transactions and personally identifiable information. We take security vulnerabilities extremely seriously.

**Please do NOT report security vulnerabilities through public GitHub issues.**

### Responsible Disclosure Process

1. **Email** your findings to `security@remitflow.io` with the subject line `[SECURITY] <brief description>`.
2. **Encrypt** your report using our PGP key (available at `https://remitflow.io/.well-known/security.txt`).
3. **Include** the following in your report:
   - Type of vulnerability (e.g. SQL injection, XSS, authentication bypass, IDOR)
   - Affected component (e.g. API endpoint, service name, UI page)
   - Steps to reproduce
   - Proof of concept (if available)
   - Potential impact assessment
   - Your suggested remediation (optional)

### What to Expect

- **Acknowledgement** within 24 hours of receipt.
- **Initial assessment** within 72 hours.
- **Regular updates** every 5 business days until the issue is resolved.
- **Resolution timeline**: Critical issues within 7 days; High within 30 days; Medium/Low within 90 days.
- **Credit**: We will acknowledge your contribution in our release notes (unless you prefer anonymity).

### Scope

The following are **in scope** for our bug bounty programme:

- All API endpoints under `api.remitflow.io`
- The RemitFlow PWA (`app.remitflow.io`)
- The RemitFlow mobile apps (iOS and Android)
- Authentication and authorisation flows (Keycloak, Permify, WebAuthn)
- Financial transaction processing (TigerBeetle, Mojaloop)
- KYC document handling and storage
- Webhook signature verification

The following are **out of scope**:

- Third-party services (Keycloak upstream, Mojaloop upstream)
- Denial of service attacks
- Social engineering attacks against RemitFlow employees
- Physical security attacks
- Issues in dependencies that have already been publicly disclosed

### Security Hardening Measures

RemitFlow implements the following security controls:

**Authentication & Authorisation**
- Keycloak-backed OAuth2/OIDC with PKCE
- Permify relationship-based access control (ReBAC)
- WebAuthn/FIDO2 passkey support
- JWT with short expiry (15 minutes) and refresh token rotation
- Per-tenant rate limiting with Redis sliding window

**Transport Security**
- TLS 1.3 minimum for all external connections
- HSTS with preloading
- Certificate pinning in mobile apps
- Post-quantum cryptography (Kyber1024) for key exchange (experimental)

**Data Protection**
- AES-256-GCM encryption at rest for sensitive fields
- PII tokenisation before analytics/lakehouse ingestion
- HMAC-SHA256 webhook signature verification
- Secrets managed via environment variables (production: HashiCorp Vault)

**Application Security**
- Helmet.js security headers
- CORS allowlist
- Input validation via Zod on all tRPC procedures
- SQL injection prevention via Drizzle ORM parameterised queries
- XSS prevention via React's built-in escaping
- CSRF protection via SameSite cookies

**Monitoring & Incident Response**
- OpenTelemetry distributed tracing
- Prometheus/Grafana alerting for anomalies
- OpenSearch audit log indexing
- Automated STR (Suspicious Transaction Report) generation
- Real-time fraud scoring via GNN + ML ensemble

**Compliance**
- GDPR / NDPR data subject rights implementation
- FATF Travel Rule enforcement (>$1,000 threshold)
- PCI DSS Level 4 controls for card data
- ISO 27001 aligned security controls

## Security Contact

- **Email**: security@remitflow.io
- **PGP Key**: https://remitflow.io/.well-known/security.txt
- **Bug Bounty**: https://hackerone.com/remitflow (coming soon)
