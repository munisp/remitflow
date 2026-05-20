# Critical Security Fixes Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the critical security fixes for CVE-2024-SEC-001 and CVE-2024-SEC-002.

## Prerequisites

- Go 1.19+
- Redis server
- PostgreSQL database
- Git version control

## Implementation Timeline

### Phase 1: CVE-2024-SEC-001 (Input Validation) - 3 days
### Phase 2: CVE-2024-SEC-002 (JWT Authentication) - 2 days

## CVE-2024-SEC-001: Input Validation Fix

### Step 1: Deploy Validation Library (Day 1)

1. Copy the validation library:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/security/validation-middleware/validator.go \
      services/security/validation-middleware/
   ```

2. Install dependencies:
   ```bash
   go mod tidy
   ```

3. Run unit tests:
   ```bash
   go test ./services/security/validation-middleware/...
   ```

### Step 2: Update PIX Gateway (Day 2)

1. Backup current PIX Gateway:
   ```bash
   cp services/pix-integration/pix-gateway/main.go \
      services/pix-integration/pix-gateway/main.go.backup
   ```

2. Deploy new PIX Gateway:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/pix-integration/pix-gateway/main.go \
      services/pix-integration/pix-gateway/
   ```

3. Test PIX Gateway:
   ```bash
   go run services/pix-integration/pix-gateway/main.go
   curl -X POST http://localhost:5001/api/v1/pix/transfer \
        -H "Content-Type: application/json" \
        -d '{"request_id":"test","recipient_key":"invalid","key_type":"CPF","amount":100}'
   ```

### Step 3: Update API Gateway (Day 3)

1. Deploy API Gateway security middleware:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/core-infrastructure/api-gateway/main.go \
      services/core-infrastructure/api-gateway/
   ```

2. Test security headers:
   ```bash
   curl -I http://localhost:8000/health
   ```

## CVE-2024-SEC-002: JWT Authentication Fix

### Step 1: Deploy JWT Manager (Day 1)

1. Generate RSA key pair:
   ```bash
   openssl genrsa -out private_key.pem 2048
   openssl rsa -in private_key.pem -pubout -out public_key.pem
   ```

2. Deploy JWT manager:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/security/jwt-manager/token_manager.go \
      services/security/jwt-manager/
   ```

3. Deploy session manager:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/security/session-manager/session.go \
      services/security/session-manager/
   ```

### Step 2: Update User Management (Day 2)

1. Deploy enhanced user management:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/enhanced-platform/user-management/main.go \
      services/enhanced-platform/user-management/
   ```

2. Test authentication:
   ```bash
   curl -X POST http://localhost:3001/api/v1/auth/login \
        -H "Content-Type: application/json" \
        -d '{"email":"user@example.com","password":"password123"}'
   ```

## Testing Procedures

### Security Testing

1. **Input Validation Tests**:
   ```bash
   # Test XSS prevention
   curl -X POST http://localhost:5001/api/v1/pix/transfer \
        -H "Content-Type: application/json" \
        -d '{"description":"<script>alert(\'xss\')</script>"}'
   
   # Test SQL injection prevention
   curl -X POST http://localhost:5001/api/v1/pix/keys/validate \
        -H "Content-Type: application/json" \
        -d '{"key":"\'; DROP TABLE users; --","key_type":"EMAIL"}'
   ```

2. **JWT Authentication Tests**:
   ```bash
   # Test token validation
   curl -H "Authorization: Bearer invalid_token" \
        http://localhost:3001/api/v1/auth/profile
   
   # Test token refresh
   curl -X POST http://localhost:3001/api/v1/auth/refresh \
        -H "Content-Type: application/json" \
        -d '{"refresh_token":"valid_refresh_token"}'
   ```

### Performance Testing

1. **Load Testing**:
   ```bash
   # Install Apache Bench
   sudo apt-get install apache2-utils
   
   # Test PIX Gateway
   ab -n 1000 -c 10 -H "Content-Type: application/json" \
      -p test_data.json http://localhost:5001/api/v1/pix/transfer
   ```

## Deployment Checklist

### Pre-deployment
- [ ] All tests pass
- [ ] Code review completed
- [ ] Security scan completed
- [ ] Performance benchmarks met

### Deployment
- [ ] Database backup completed
- [ ] Blue-green environment prepared
- [ ] Monitoring alerts configured
- [ ] Rollback plan ready

### Post-deployment
- [ ] Health checks pass
- [ ] Security tests pass
- [ ] Performance metrics normal
- [ ] Error rates < 0.1%

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Security Metrics**:
   - Failed authentication attempts
   - Invalid token attempts
   - Input validation failures
   - Suspicious activity patterns

2. **Performance Metrics**:
   - Response time < 100ms
   - Error rate < 0.1%
   - Throughput > 1000 RPS
   - Memory usage stable

### Alert Thresholds

- **Critical**: Error rate > 2%
- **Warning**: Response time > 200ms
- **Info**: Failed auth attempts > 10/minute

## Rollback Procedures

If issues are detected:

1. **Immediate Rollback**:
   ```bash
   # Restore backup files
   cp services/pix-integration/pix-gateway/main.go.backup \
      services/pix-integration/pix-gateway/main.go
   
   # Restart services
   systemctl restart pix-gateway
   systemctl restart api-gateway
   systemctl restart user-management
   ```

2. **Verify Rollback**:
   ```bash
   curl http://localhost:5001/health
   curl http://localhost:8000/health
   curl http://localhost:3001/health
   ```

## Support and Troubleshooting

### Common Issues

1. **Validation Errors**: Check input format and validation rules
2. **JWT Errors**: Verify key configuration and token format
3. **Session Errors**: Check Redis connectivity and configuration

### Log Locations

- PIX Gateway: `/var/log/pix-gateway/app.log`
- API Gateway: `/var/log/api-gateway/app.log`
- User Management: `/var/log/user-management/app.log`

### Contact Information

- Security Team: security@nigerianremittance.com
- DevOps Team: devops@nigerianremittance.com
- On-call Engineer: +1-555-0123

## Conclusion

Following this implementation guide will ensure that both critical security vulnerabilities are properly addressed with comprehensive fixes, testing, and monitoring in place.
