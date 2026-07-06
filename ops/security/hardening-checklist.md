# RemitFlow — Security Hardening Checklist

## Pre-Production Security Requirements

### 1. Transport Security

- [x] TLS 1.3 minimum on all endpoints
- [x] HSTS with preload (max-age=31536000, includeSubDomains)
- [x] Certificate pinning for mobile apps
- [x] mTLS between internal services (via service mesh)
- [x] Database connections require SSL (sslmode=verify-full)
- [x] gRPC channels use TLS (Temporal, internal)

### 2. Authentication & Authorization

- [x] Session tokens: HttpOnly, Secure, SameSite=Lax
- [x] JWT: RS256 signing (asymmetric), 15-min expiry, refresh tokens 7 days
- [x] MFA required for: admin access, high-value transfers (>$5K), account recovery
- [x] RBAC enforced via Permify (attribute-based access control)
- [x] API keys: scoped, rotatable, rate-limited per key
- [x] OAuth 2.0 + PKCE for third-party integrations
- [x] Account lockout: 5 failed attempts → 30-min lockout
- [x] Brute-force protection: progressive delays (1s, 2s, 4s, 8s...)

### 3. Input Validation & Injection Prevention

- [x] Zod v4 schema validation on all tRPC inputs
- [x] Parameterized SQL queries (Drizzle ORM, no raw SQL without binds)
- [x] XSS prevention: CSP headers, output encoding, DOMPurify
- [x] CSRF: SameSite cookies + origin validation
- [x] SSRF: URL allowlist for outbound requests
- [x] File upload: type validation, size limits, virus scanning
- [x] GraphQL/tRPC depth limiting (max 10 nested queries)

### 4. Data Protection

- [x] PII encrypted at rest (Vault Transit, AES-256-GCM)
- [x] Encryption keys per region (GDPR/NDPR compliance)
- [x] Key rotation every 90 days (automated)
- [x] Crypto-shredding for data deletion (destroy key → data unrecoverable)
- [x] Database field-level encryption for: SSN, passport, BVN, NIN, bank accounts
- [x] Tokenization for card numbers (PCI-DSS scope reduction)
- [x] Log redaction: PII never appears in application logs

### 5. Network Security

- [x] Zero-trust network policies (deny-all default)
- [x] WAF: AWS Managed Rules (Common, SQLi, BadInputs) + custom rate limits
- [x] DDoS protection: CloudFront + Shield Advanced
- [x] VPC isolation: private subnets for all data stores
- [x] No public IPs on application/database pods
- [x] Egress filtering: only allow HTTPS to known API providers
- [x] DNS over HTTPS for external resolution

### 6. Container & Cluster Security

- [x] Non-root containers (runAsUser: 1000)
- [x] Read-only root filesystem
- [x] Drop all capabilities (CAP_DROP: ALL)
- [x] No privilege escalation (allowPrivilegeEscalation: false)
- [x] Pod Security Standards: restricted
- [x] Image scanning: Trivy in CI/CD pipeline
- [x] Signed images: cosign/sigstore
- [x] No latest tag in production (pin to SHA digest)
- [x] Secret rotation: Vault Agent sidecar (auto-renew)

### 7. Secrets Management

- [x] No secrets in environment variables (Vault injection at runtime)
- [x] No secrets in source code (pre-commit hook: detect-secrets)
- [x] No secrets in Docker images (multi-stage builds, no COPY of .env)
- [x] Dynamic database credentials (Vault database secrets engine, TTL 1h)
- [x] API key rotation: automated every 90 days
- [x] Emergency revocation: single command to rotate all secrets

### 8. Monitoring & Detection

- [x] Security event logging (all auth events, permission changes, data access)
- [x] Anomaly detection: unusual login patterns, impossible travel
- [x] Real-time alerts: brute force, privilege escalation, data exfiltration
- [x] Audit trail: immutable, hash-chained, 7-year retention
- [x] SIEM integration: CloudWatch → OpenSearch → PagerDuty
- [x] Honeypot accounts: fake admin accounts that trigger alerts on any access

### 9. Incident Response

- [x] Incident response plan documented
- [x] 24/7 on-call rotation (PagerDuty)
- [x] Breach notification process (72h GDPR, 24h NCA/SAR)
- [x] Forensic capability: full request/response logging (encrypted, retention 90d)
- [x] Kill switch: immediate platform freeze capability
- [x] Communication templates: customer notification, regulator notification, press

### 10. Supply Chain Security

- [x] Dependency scanning: Dependabot + Snyk (daily)
- [x] SBOM generation: CycloneDX format
- [x] Lock files committed: package-lock.json, Cargo.lock, go.sum
- [x] Minimal base images: distroless for production
- [x] Vendor review: annual assessment of critical dependencies
- [x] npm audit / cargo audit in CI (block on critical)

---

## Financial-Specific Security

### 11. Transaction Security

- [x] Idempotency keys on all financial operations
- [x] Double-entry ledger (TigerBeetle — mathematically guaranteed balance)
- [x] Velocity checks: per-user, per-IP, per-device transaction limits
- [x] Duplicate detection: same amount + same recipient within 5 minutes → confirm
- [x] FX rate locking: 30-second quote validity (prevent rate manipulation)
- [x] Settlement finality: no reversal after T+0 settlement

### 12. Fraud Prevention

- [x] Device fingerprinting (persistent device ID across sessions)
- [x] Behavioral biometrics: typing patterns, navigation flow
- [x] IP geolocation: flag transfers to/from sanctioned countries
- [x] Machine learning: anomaly scoring on transaction patterns
- [x] Manual review queue: transactions scoring >0.7 risk held for review
- [x] Beneficiary verification: first-time recipients require additional verification

### 13. AML/CFT Controls

- [x] Real-time sanctions screening (OFAC, UN, EU, HMT)
- [x] PEP screening with Enhanced Due Diligence
- [x] Transaction monitoring: 15 detection scenarios
- [x] Structuring detection: pattern analysis across 24h windows
- [x] SAR filing automation: FINTRAC, FinCEN, NCA, NFIU
- [x] Travel Rule compliance: IVMS101 via Notabene
- [x] Risk scoring: customer, transaction, and geographic risk
