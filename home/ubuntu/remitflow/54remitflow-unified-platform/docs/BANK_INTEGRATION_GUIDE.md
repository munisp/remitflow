# Bank Integration Guide

## Overview

This document provides comprehensive guidance for integrating the Nigerian Remittance Platform with banking partners. It covers all integration points, security requirements, compliance configurations, and operational procedures required for bank-grade deployment.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Security Requirements](#security-requirements)
3. [Compliance Configuration](#compliance-configuration)
4. [Payment Corridor Integration](#payment-corridor-integration)
5. [KYC/AML Integration](#kycaml-integration)
6. [Operational Requirements](#operational-requirements)
7. [Testing & Certification](#testing--certification)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway (APISIX)                        │
│                   Rate Limiting, Auth, TLS                      │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  Transaction  │     │   Compliance  │     │     KYC       │
│   Service     │     │    Service    │     │   Service     │
└───────────────┘     └───────────────┘     └───────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
                    ┌───────────────────┐
                    │    TigerBeetle    │
                    │  Financial Ledger │
                    └───────────────────┘
```

### High Availability Configuration

All services are deployed with:
- 3+ replicas for redundancy
- PostgreSQL with streaming replication
- Redis cluster (6 nodes + 3 sentinel)
- Kafka cluster (3 brokers + 3 ZooKeeper)
- Geographic distribution across availability zones

---

## Security Requirements

### 1. Secrets Management

**Required Configuration:**

```bash
# Production secrets backend (choose one)
SECRETS_BACKEND=aws          # AWS Secrets Manager
SECRETS_BACKEND=vault        # HashiCorp Vault

# AWS Secrets Manager
AWS_REGION=us-east-1
SECRETS_PREFIX=remittance/prod/

# HashiCorp Vault
VAULT_ADDR=https://vault.example.com
VAULT_TOKEN=s.xxxxx
VAULT_NAMESPACE=remittance
```

**Required Secrets:**

| Secret Name | Description | Rotation Period |
|-------------|-------------|-----------------|
| DATABASE_URL | PostgreSQL connection string | 90 days |
| REDIS_URL | Redis cluster connection | 90 days |
| JWT_SECRET | JWT signing key (min 256 bits) | 90 days |
| ENCRYPTION_KEY | Data encryption key (256 bits) | 90 days |
| SANCTIONS_PROVIDER_API_KEY | Sanctions screening API | 90 days |
| PAYSTACK_SECRET_KEY | Paystack payment gateway | 90 days |
| FLUTTERWAVE_SECRET_KEY | Flutterwave gateway | 90 days |
| NIBSS_API_KEY | NIBSS integration | 90 days |

### 2. TLS Configuration

All services require TLS 1.2+ with:
- Certificate from trusted CA
- HSTS enabled
- Certificate pinning for mobile apps

### 3. Authentication & Authorization

- OAuth 2.0 / OpenID Connect via Keycloak
- JWT tokens with short expiry (15 minutes)
- Refresh tokens with longer expiry (7 days)
- Role-based access control via Permify

---

## Compliance Configuration

### 1. Sanctions Screening Provider

**Required:** External sanctions screening provider (World-Check, Dow Jones, etc.)

```bash
# Sanctions provider configuration
SANCTIONS_PROVIDER=external
SANCTIONS_PROVIDER_URL=https://api.worldcheck.com/v2
SANCTIONS_PROVIDER_API_KEY=your-api-key
SANCTIONS_PROVIDER_TIMEOUT=30
SANCTIONS_PROVIDER_MAX_RETRIES=3
```

**Expected API Contract:**

```json
// POST /v1/screen
{
  "entity_id": "string",
  "full_name": "string",
  "entity_type": "individual|organization",
  "date_of_birth": "YYYY-MM-DD",
  "nationality": "string",
  "country": "string",
  "screening_types": ["sanctions", "pep", "adverse_media"]
}

// Response
{
  "matches": [
    {
      "list_name": "ofac_sdn",
      "list_type": "sanctions",
      "matched_name": "string",
      "match_score": 0.95,
      "entry_id": "string"
    }
  ]
}
```

### 2. Transaction Monitoring Rules

Default rules included:
- High Value Transaction (>$10,000)
- Rapid Succession Transactions (5+ in 60 minutes)
- High Risk Country (IR, KP, SY, CU, VE)
- Structuring Detection
- Round Amount Pattern
- New Account High Activity
- Dormant Account Reactivation

**Customization:** Rules can be added/modified via `/monitoring/rules` API.

### 3. SAR Filing Integration

Configure regulatory reporting endpoint:

```bash
SAR_FILING_ENDPOINT=https://nfiu.gov.ng/api/sar
SAR_FILING_API_KEY=your-api-key
```

---

## Payment Corridor Integration

### 1. Mojaloop (FSPIOP)

**Configuration:**

```bash
MOJALOOP_HUB_URL=https://hub.mojaloop.io
MOJALOOP_FSP_ID=your-fsp-id
MOJALOOP_SIGNING_KEY=/path/to/signing-key.pem
MOJALOOP_TIMEOUT=30
MOJALOOP_MAX_RETRIES=3
```

**Certification Requirements:**
- Complete Mojaloop certification program
- Pass all FSPIOP compliance tests
- Implement callback endpoints for async responses

### 2. UPI (India)

**Configuration:**

```bash
UPI_BASE_URL=https://api.npci.org.in
UPI_MERCHANT_ID=your-merchant-id
UPI_API_KEY=your-api-key
UPI_CHECKSUM_KEY=your-checksum-key
```

**Certification Requirements:**
- NPCI certification
- PCI DSS compliance
- UPI 2.0 specification compliance

### 3. PIX (Brazil)

**Configuration:**

```bash
PIX_BASE_URL=https://api.bcb.gov.br/pix
PIX_CLIENT_ID=your-client-id
PIX_CLIENT_SECRET=your-client-secret
PIX_CERTIFICATE_PATH=/path/to/certificate.pem
```

**Certification Requirements:**
- BCB (Central Bank of Brazil) certification
- PIX specification compliance
- mTLS certificate from authorized CA

### 4. PAPSS (Pan-African)

**Configuration:**

```bash
PAPSS_BASE_URL=https://api.papss.com
PAPSS_PARTICIPANT_ID=your-participant-id
PAPSS_API_KEY=your-api-key
```

**Certification Requirements:**
- PAPSS participant certification
- Settlement account with clearing bank

---

## KYC/AML Integration

### 1. Tiered KYC Limits

| Tier | Daily Limit | Monthly Limit | Requirements |
|------|-------------|---------------|--------------|
| 1 | ₦50,000 | ₦300,000 | Phone + Email |
| 2 | ₦200,000 | ₦500,000 | + Government ID |
| 3 | ₦5,000,000 | ₦10,000,000 | + Address + BVN |
| 4 | Unlimited | Unlimited | + Income Proof + Enhanced Due Diligence |

### 2. Property Transaction KYC

For property transactions, the following are required:

1. **Buyer KYC**
   - Government-issued ID (NIN, Passport, Driver's License)
   - BVN verification
   - Address verification

2. **Seller KYC** (Closed-loop ecosystem)
   - Government-issued ID
   - Bank account verification
   - Property ownership verification

3. **Source of Funds**
   - Declaration of source (Employment, Business, Savings, Gift, Loan, etc.)
   - Supporting documentation

4. **Bank Statements**
   - Minimum 3 months coverage
   - Must be within last 6 months
   - Validated for date range and authenticity

5. **Income Documents**
   - W-2 / PAYE records
   - Tax returns
   - Employment letter
   - Business registration (for business income)

6. **Purchase Agreement**
   - Must include buyer and seller names
   - Property address and details
   - Purchase price
   - Signatures from both parties
   - Date of agreement

### 3. Document Verification Integration

Configure document verification provider:

```bash
DOCUMENT_VERIFICATION_PROVIDER=onfido  # or jumio, veriff
DOCUMENT_VERIFICATION_API_KEY=your-api-key
DOCUMENT_VERIFICATION_WEBHOOK_URL=https://your-domain/webhooks/document-verification
```

---

## Operational Requirements

### 1. Database Configuration

**PostgreSQL:**
```bash
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=40
DATABASE_POOL_RECYCLE=3600
```

**Backup Requirements:**
- Point-in-time recovery enabled
- Daily full backups
- 30-day retention
- Cross-region replication for DR

### 2. Logging & Monitoring

**Structured Logging:**
```bash
LOG_FORMAT=json
LOG_LEVEL=INFO
ENVIRONMENT=production
```

**Required Metrics:**
- Transaction success/failure rates
- Response latency (p50, p95, p99)
- Error rates by type
- Compliance alert counts
- KYC verification success rates

**Alerting Thresholds:**
- Error rate > 1%: Warning
- Error rate > 5%: Critical
- Latency p99 > 5s: Warning
- Latency p99 > 10s: Critical

### 3. Rate Limiting

**Default Limits:**
```bash
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=1000
RATE_LIMIT_PER_DAY=10000
RATE_LIMIT_BURST=10
```

**Per-Endpoint Overrides:**
- `/screening/check`: 30/minute (compliance-sensitive)
- `/transactions`: 100/minute (high-volume)
- `/health`: No limit

### 4. CORS Configuration

```bash
CORS_ALLOWED_ORIGINS=https://app.yourbank.com,https://admin.yourbank.com
```

---

## Testing & Certification

### 1. Pre-Production Testing

**Required Test Coverage:**
- Unit tests: 70%+ coverage
- Integration tests: All critical paths
- E2E tests: User journeys
- Load tests: 10x expected peak traffic
- Security tests: OWASP Top 10

### 2. Sandbox Environment

Each payment corridor provides sandbox endpoints:

| Corridor | Sandbox URL |
|----------|-------------|
| Mojaloop | https://sandbox.mojaloop.io |
| UPI | https://sandbox.npci.org.in |
| PIX | https://sandbox.bcb.gov.br |
| PAPSS | https://sandbox.papss.com |

### 3. Certification Checklist

- [ ] All secrets configured in production secrets manager
- [ ] TLS certificates installed and valid
- [ ] Sanctions provider integrated and tested
- [ ] All payment corridors certified
- [ ] KYC document verification integrated
- [ ] Database backups configured and tested
- [ ] Monitoring and alerting configured
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] Penetration testing completed
- [ ] Load testing completed
- [ ] DR procedures documented and tested
- [ ] Incident response procedures documented
- [ ] Compliance team trained on case management
- [ ] Operations team trained on monitoring

---

## Support & Contacts

For integration support:
- Technical: tech-support@remittance-platform.com
- Compliance: compliance@remittance-platform.com
- Security: security@remittance-platform.com

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2025-12-11 | Added PostgreSQL persistence, sanctions provider abstraction, rate limiting, structured logging |
| 1.0.0 | 2025-12-01 | Initial release |
