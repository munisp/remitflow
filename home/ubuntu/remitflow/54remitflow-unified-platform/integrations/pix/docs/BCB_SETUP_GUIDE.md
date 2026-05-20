# BCB PIX Integration Setup Guide
## Complete Step-by-Step Instructions

**Version:** 1.0.0  
**Last Updated:** January 2025  
**Status:** Production-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: BCB Registration](#step-1-bcb-registration)
4. [Step 2: Obtain ISPB](#step-2-obtain-ispb)
5. [Step 3: Generate Certificates](#step-3-generate-certificates)
6. [Step 4: Configure OAuth2](#step-4-configure-oauth2)
7. [Step 5: Sandbox Testing](#step-5-sandbox-testing)
8. [Step 6: Production Deployment](#step-6-production-deployment)
9. [Troubleshooting](#troubleshooting)

---

## 1. Overview

This guide provides complete instructions for integrating with BCB (Banco Central do Brasil) PIX system.

**What you'll accomplish:**
- Register with BCB as a PIX participant
- Obtain necessary credentials (ISPB, API keys, certificates)
- Configure the PIX gateway
- Test in BCB sandbox
- Deploy to production

**Timeline:** 4-6 weeks (including BCB approval process)

---

## 2. Prerequisites

### Legal Requirements
- [ ] Brazilian legal entity (CNPJ)
- [ ] Payment institution license (IP) or equivalent
- [ ] Compliance with BCB regulations
- [ ] AML/KYC procedures in place

### Technical Requirements
- [ ] TLS 1.3 support
- [ ] mTLS (mutual TLS) capability
- [ ] OAuth2 client implementation
- [ ] ISO 20022 message format support
- [ ] 24/7 operational capability

### Documentation Needed
- [ ] Company registration (CNPJ)
- [ ] Payment license documentation
- [ ] Technical architecture documentation
- [ ] Security policies
- [ ] Incident response plan

---

## 3. Step 1: BCB Registration

### 3.1 Access BCB Portal

1. Visit: https://www.bcb.gov.br/estabilidadefinanceira/pix
2. Click "Participantes" → "Cadastro de Participantes"
3. Login with your BCB credentials

### 3.2 Submit Registration

**Required Information:**
- Company legal name
- CNPJ (14 digits)
- Payment institution type (ISPB, PSPB, PSPD)
- Technical contact information
- Operational contact information
- Compliance officer information

**Documents to Upload:**
- Company registration certificate
- Payment license
- Technical architecture document
- Security policy
- Incident response plan
- Insurance policy (if required)

### 3.3 Wait for Approval

**Timeline:** 2-4 weeks

**BCB will verify:**
- Legal documentation
- Technical capabilities
- Security measures
- Compliance procedures

**You'll receive:**
- Email confirmation
- ISPB code (8 digits)
- Access to BCB portal
- Sandbox credentials

---

## 4. Step 2: Obtain ISPB

### 4.1 What is ISPB?

ISPB (Identificador do Sistema de Pagamentos Brasileiro) is your unique 8-digit identifier in the Brazilian payment system.

**Example:** `12345678`

### 4.2 Receive ISPB

After BCB approval, you'll receive your ISPB via:
- Email from BCB
- BCB portal notification
- Registered mail

### 4.3 Configure ISPB

Update configuration:

```yaml
# config/bcb_credentials.yaml
participant:
  ispb: "12345678"  # Your ISPB
  name: "Nigerian Remittance Platform Brasil Ltda"
  type: "PSPB"
```

Set environment variable:

```bash
export PIX_PARTICIPANT_ISPB="12345678"
```

---

## 5. Step 3: Generate Certificates

### 5.1 Generate Private Key

```bash
# Generate 2048-bit RSA private key
openssl genrsa -out bcb-key.pem 2048

# Secure the private key
chmod 400 bcb-key.pem
```

### 5.2 Generate Certificate Signing Request (CSR)

```bash
openssl req -new -key bcb-key.pem -out bcb-csr.pem \
  -subj "/C=BR/ST=DF/L=Brasilia/O=Nigerian Remittance Platform/OU=PIX/CN=pix.remittance.com"
```

**Certificate Details:**
- Country (C): BR (Brazil)
- State (ST): DF (Distrito Federal)
- Locality (L): Brasilia
- Organization (O): Your company name
- Organizational Unit (OU): PIX
- Common Name (CN): Your PIX domain

### 5.3 Submit CSR to BCB

1. Login to BCB portal
2. Navigate to "Certificados" → "Solicitar Certificado"
3. Upload `bcb-csr.pem`
4. Wait for BCB to sign (1-2 days)

### 5.4 Download Signed Certificate

1. Download signed certificate from BCB portal
2. Save as `bcb-cert.pem`
3. Download BCB CA certificate
4. Save as `bcb-ca.pem`

### 5.5 Verify Certificate

```bash
# Verify certificate
openssl x509 -in bcb-cert.pem -text -noout

# Verify certificate chain
openssl verify -CAfile bcb-ca.pem bcb-cert.pem
```

### 5.6 Install Certificates

```bash
# Create certificates directory
mkdir -p /etc/pix/certs

# Copy certificates
cp bcb-cert.pem /etc/pix/certs/
cp bcb-key.pem /etc/pix/certs/
cp bcb-ca.pem /etc/pix/certs/

# Set permissions
chmod 400 /etc/pix/certs/bcb-key.pem
chmod 444 /etc/pix/certs/bcb-cert.pem
chmod 444 /etc/pix/certs/bcb-ca.pem
```

### 5.7 Configure Certificate Paths

```bash
export BCB_CERT_FILE="/etc/pix/certs/bcb-cert.pem"
export BCB_KEY_FILE="/etc/pix/certs/bcb-key.pem"
export BCB_CA_FILE="/etc/pix/certs/bcb-ca.pem"
```

---

## 6. Step 4: Configure OAuth2

### 6.1 Obtain OAuth2 Credentials

1. Login to BCB portal
2. Navigate to "API" → "OAuth2 Credentials"
3. Click "Create New Client"
4. Select scopes: `pix.read pix.write dict.read dict.write`
5. Note down:
   - Client ID
   - Client Secret

### 6.2 Configure OAuth2

```bash
export BCB_CLIENT_ID="your-client-id"
export BCB_CLIENT_SECRET="your-client-secret"
```

### 6.3 Test OAuth2 Token

```bash
curl -X POST https://oauth.bcb.gov.br/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$BCB_CLIENT_ID" \
  -d "client_secret=$BCB_CLIENT_SECRET" \
  -d "scope=pix.read pix.write dict.read dict.write"
```

**Expected Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "pix.read pix.write dict.read dict.write"
}
```

---

## 7. Step 5: Sandbox Testing

### 7.1 Configure Sandbox Environment

```bash
export PIX_ENVIRONMENT="sandbox"
export BCB_ENDPOINT="https://api-sandbox.bcb.gov.br/pix/v2"
export BCB_DICT_ENDPOINT="https://dict-sandbox.pi.rsfn.net.br/api/v1"
export BCB_SPI_ENDPOINT="https://spi-sandbox.pi.rsfn.net.br/api/v1"
```

### 7.2 Run Sandbox Tests

```bash
# Run comprehensive test suite
cd /home/ubuntu/NIGERIAN-REMITTANCE-FINAL-COMPLETE/services/pix-integration
python3 tests/bcb_sandbox_tests.py

# Expected output:
# ✅ Test 1: BCB Connection - PASSED
# ✅ Test 2: PIX Key Registration - PASSED
# ✅ Test 3: PIX Transfer - PASSED
# ✅ Test 4: QR Code Generation - PASSED
# ✅ Test 5: Transaction Query - PASSED
# ✅ Test 6: Refund Processing - PASSED
# 
# All 6 tests passed!
```

### 7.3 Test Scenarios

**Test 1: PIX Key Registration**
```bash
curl -X POST $BCB_DICT_ENDPOINT/keys \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "keyType": "CPF",
    "key": "12345678901",
    "accountType": "CACC",
    "branch": "0001",
    "accountNumber": "123456"
  }'
```

**Test 2: PIX Transfer**
```bash
curl -X POST $BCB_SPI_ENDPOINT/payments \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "currency": "BRL",
    "pixKey": "12345678901",
    "description": "Test payment"
  }'
```

**Test 3: QR Code Generation**
```bash
curl -X POST $BCB_ENDPOINT/qrcodes \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50.00,
    "pixKey": "12345678901",
    "description": "Test QR code"
  }'
```

### 7.4 Verify Results

Check BCB sandbox portal for:
- Transaction history
- Key registrations
- QR codes generated
- Error logs

---

## 8. Step 6: Production Deployment

### 8.1 Pre-Production Checklist

- [ ] All sandbox tests passed
- [ ] BCB production approval received
- [ ] Production certificates installed
- [ ] Production credentials configured
- [ ] Monitoring configured
- [ ] Alerts configured
- [ ] Incident response plan ready
- [ ] 24/7 support team ready

### 8.2 Configure Production Environment

```bash
export PIX_ENVIRONMENT="production"
export BCB_ENDPOINT="https://api.bcb.gov.br/pix/v2"
export BCB_DICT_ENDPOINT="https://dict.pi.rsfn.net.br/api/v1"
export BCB_SPI_ENDPOINT="https://spi.pi.rsfn.net.br/api/v1"
```

### 8.3 Deploy to Kubernetes

```bash
# Apply Kubernetes manifests
kubectl apply -f kubernetes/pix-deployment.yaml

# Verify deployment
kubectl get pods -l app=pix-gateway
kubectl logs -l app=pix-gateway
```

### 8.4 Run Production Smoke Tests

```bash
# Run smoke tests
./scripts/pix-smoke-tests.sh

# Expected output:
# ✅ Health check: OK
# ✅ BCB connection: OK
# ✅ Database connection: OK
# ✅ Metrics endpoint: OK
```

### 8.5 Monitor Production

- Grafana dashboard: https://grafana.remittance.com/d/pix
- Prometheus metrics: https://prometheus.remittance.com
- Kibana logs: https://kibana.remittance.com

---

## 9. Troubleshooting

### Issue 1: Certificate Verification Failed

**Error:**
```
SSL certificate problem: unable to get local issuer certificate
```

**Solution:**
```bash
# Verify certificate chain
openssl verify -CAfile bcb-ca.pem bcb-cert.pem

# If failed, download latest BCB CA certificate
curl -o bcb-ca.pem https://www.bcb.gov.br/pix/ca-certificate.pem
```

---

### Issue 2: OAuth2 Token Expired

**Error:**
```
401 Unauthorized: Token expired
```

**Solution:**
```bash
# Tokens expire after 1 hour
# Implement automatic token refresh:

# Get new token
curl -X POST https://oauth.bcb.gov.br/token \
  -d "grant_type=client_credentials" \
  -d "client_id=$BCB_CLIENT_ID" \
  -d "client_secret=$BCB_CLIENT_SECRET"
```

---

### Issue 3: PIX Key Already Registered

**Error:**
```
409 Conflict: PIX key already registered
```

**Solution:**
```bash
# Query existing key
curl -X GET $BCB_DICT_ENDPOINT/keys/12345678901 \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Delete key if owned by you
curl -X DELETE $BCB_DICT_ENDPOINT/keys/12345678901 \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Re-register
curl -X POST $BCB_DICT_ENDPOINT/keys \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"keyType": "CPF", "key": "12345678901", ...}'
```

---

### Issue 4: High Latency

**Symptom:** BCB API calls taking >1 second

**Solution:**
1. Check network connectivity
2. Verify DNS resolution
3. Check BCB status page: https://status.bcb.gov.br
4. Enable connection pooling
5. Implement caching for DICT lookups

---

### Issue 5: Rate Limiting

**Error:**
```
429 Too Many Requests
```

**Solution:**
```bash
# BCB rate limits:
# - 100 requests/second
# - 200 burst

# Implement exponential backoff:
# - Wait 1s, retry
# - Wait 2s, retry
# - Wait 4s, retry
# - Wait 8s, retry
# - Give up after 4 retries
```

---

## 10. Support Contacts

### BCB Support
- **Email:** pix@bcb.gov.br
- **Phone:** +55 61 3414-1000
- **Website:** https://www.bcb.gov.br/estabilidadefinanceira/pix
- **Portal:** https://portal.bcb.gov.br

### Technical Support
- **Email:** tech@remittance.com
- **Slack:** #pix-integration
- **On-Call:** pix-oncall
- **PagerDuty:** pix-alerts

---

## 11. Additional Resources

### Documentation
- BCB PIX Manual: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix.pdf
- API Documentation: https://www.bcb.gov.br/estabilidadefinanceira/pix_api
- DICT Specification: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/DICT_Especificacao.pdf

### Tools
- BCB Sandbox: https://api-sandbox.bcb.gov.br
- Certificate Generator: https://www.bcb.gov.br/pix/certificados
- API Testing Tool: https://www.bcb.gov.br/pix/api-test

---

**Document Status:** ✅ Complete  
**Last Reviewed:** January 2025  
**Next Review:** February 2025

