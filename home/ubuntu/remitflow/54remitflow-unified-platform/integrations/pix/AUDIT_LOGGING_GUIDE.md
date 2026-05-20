# Audit Logging Implementation Guide
## PIX Integration Service - Authentication & Security Event Logging

**Version**: 2.4.0  
**Date**: November 1, 2024  
**Status**: ✅ Production Ready

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Setup Instructions](#setup-instructions)
5. [Event Types](#event-types)
6. [API Endpoints](#api-endpoints)
7. [Usage Examples](#usage-examples)
8. [Monitoring & Alerts](#monitoring--alerts)
9. [Security Best Practices](#security-best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The audit logging system provides comprehensive tracking of all authentication and security events in the PIX Integration Service. Every login attempt, token operation, and security event is logged with full context for compliance, security monitoring, and forensic analysis.

### Key Benefits

- ✅ **Compliance**: Meet regulatory requirements for audit trails
- ✅ **Security Monitoring**: Detect suspicious activity in real-time
- ✅ **Forensic Analysis**: Investigate security incidents
- ✅ **User Activity Tracking**: Monitor user behavior
- ✅ **Anomaly Detection**: Identify unusual patterns

---

## Features

### 1. Comprehensive Event Logging

**25 Event Types** across 5 categories:

#### Authentication Events (4)
- `login_success` - Successful user login
- `login_failed` - Failed login attempt
- `logout` - User logout
- `logout_all` - Logout from all devices

#### Token Events (5)
- `token_refresh` - Access token refreshed
- `token_refresh_failed` - Token refresh failed
- `token_reuse_detected` - **CRITICAL**: Token reuse attempt
- `token_revoked` - Single token revoked
- `token_family_revoked` - Entire token family revoked

#### Account Events (5)
- `account_locked` - Account locked due to failed attempts
- `account_unlocked` - Account manually unlocked
- `password_changed` - Password updated
- `password_reset_requested` - Password reset initiated
- `password_reset_completed` - Password reset completed

#### Security Events (6)
- `rate_limit_exceeded` - Rate limit violation
- `invalid_token` - Invalid JWT presented
- `expired_token` - Expired token used
- `insufficient_permissions` - Authorization failure
- `suspicious_activity` - Anomaly detected

#### User Management (5)
- `user_created` - New user registered
- `user_updated` - User profile updated
- `user_deleted` - User account deleted
- `user_activated` - User account activated
- `user_deactivated` - User account deactivated

### 2. Rich Context Information

Each audit log includes:

- **Event Details**: Type, severity, message, structured data
- **User Information**: ID, username
- **Request Context**: IP address, user agent, endpoint, HTTP method
- **Security Context**: Token family ID, device info
- **Outcome**: Success/failure, error messages
- **Geolocation**: Country, city (optional)
- **Timestamp**: UTC timestamp with timezone

### 3. Severity Levels

- `INFO` - Normal operations
- `WARNING` - Potential security concerns
- `ERROR` - Errors requiring attention
- `CRITICAL` - Severe security events

### 4. Query & Analysis API

**8 API endpoints** for querying audit logs:

- Get all logs with filtering
- Get user's own logs
- Security event summary
- Failed login attempts
- Token reuse attempts
- Activity by IP address
- Activity by user ID

### 5. Automatic Cleanup

- Configurable retention period
- Automatic deletion of old INFO logs
- Retention of WARNING+ logs for compliance

---

## Architecture

```
┌─────────────────┐
│  Auth Router    │
│  (Login, etc.)  │
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         v                  v
┌─────────────────┐  ┌──────────────────┐
│  AuditLogger    │  │  Authentication  │
│  Service        │  │  Logic           │
└────────┬────────┘  └──────────────────┘
         │
         v
┌─────────────────┐
│  audit_logs     │
│  Table          │
│  (PostgreSQL)   │
└─────────────────┘
         │
         v
┌─────────────────┐
│  Audit Router   │
│  (Query API)    │
└─────────────────┘
```

### Database Schema

```sql
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    
    -- Event information
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    
    -- User information
    user_id INTEGER,
    username VARCHAR(50),
    
    -- Request information
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    endpoint VARCHAR(255),
    http_method VARCHAR(10),
    
    -- Event details
    message TEXT NOT NULL,
    details JSONB,
    
    -- Outcome
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    
    -- Security context
    token_family_id VARCHAR(100),
    device_info VARCHAR(500),
    
    -- Geolocation
    country VARCHAR(2),
    city VARCHAR(100),
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_audit_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_severity ON audit_logs(severity);
CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_username ON audit_logs(username);
CREATE INDEX idx_audit_ip_address ON audit_logs(ip_address);
CREATE INDEX idx_audit_success ON audit_logs(success);
CREATE INDEX idx_audit_token_family ON audit_logs(token_family_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at);
```

---

## Setup Instructions

### 1. Run Database Migration

```bash
cd services/pix-integration
python migrations/add_audit_logs.py
```

**Expected Output**:
```
Creating audit_logs table...
Creating indexes...
✅ Migration completed successfully!
✅ audit_logs table created with indexes
```

### 2. Update Main Application

Add audit router to `main.py`:

```python
from audit_router import audit_router

app.include_router(audit_router, prefix="/api/v1")
```

### 3. Verify Installation

```bash
# Check table exists
psql -d pix_db -c "\d audit_logs"

# Check indexes
psql -d pix_db -c "\di audit_logs*"
```

### 4. Test Audit Logging

```bash
# Login (should create audit log)
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"

# Check logs
curl -X GET http://localhost:8000/api/v1/audit/logs/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Event Types

### Critical Security Events

These events require immediate attention:

#### 1. Token Reuse Detected
```json
{
  "event_type": "token_reuse_detected",
  "severity": "critical",
  "message": "TOKEN REUSE DETECTED for user admin - Revoking token family",
  "details": {
    "action_taken": "Revoked entire token family",
    "security_breach": true
  }
}
```

**Action**: Possible token theft. Entire token family revoked. User must re-authenticate.

#### 2. Suspicious Activity
```json
{
  "event_type": "suspicious_activity",
  "severity": "critical",
  "message": "Suspicious activity detected: Multiple failed logins from different IPs",
  "details": {
    "pattern": "distributed_brute_force",
    "ip_count": 15
  }
}
```

**Action**: Investigate immediately. May indicate coordinated attack.

### Warning Events

These events indicate potential security issues:

#### 3. Failed Login
```json
{
  "event_type": "login_failed",
  "severity": "warning",
  "message": "Failed login attempt for user admin",
  "error_message": "Invalid credentials"
}
```

**Action**: Monitor for brute force patterns.

#### 4. Rate Limit Exceeded
```json
{
  "event_type": "rate_limit_exceeded",
  "severity": "warning",
  "message": "Rate limit exceeded for endpoint /api/v1/auth/login",
  "error_message": "Too many requests"
}
```

**Action**: May indicate automated attack. IP may be banned.

---

## API Endpoints

### 1. Get Audit Logs (Admin Only)

```http
GET /api/v1/audit/logs
```

**Query Parameters**:
- `event_type` (optional) - Filter by event type
- `severity` (optional) - Filter by severity
- `username` (optional) - Filter by username
- `ip_address` (optional) - Filter by IP
- `success` (optional) - Filter by success status
- `hours` (default: 24) - Look back period (1-720)
- `limit` (default: 100) - Max results (1-1000)

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/logs?severity=critical&hours=48" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

**Response**:
```json
{
  "total": 3,
  "logs": [
    {
      "id": 123,
      "event_type": "token_reuse_detected",
      "severity": "critical",
      "user_id": 1,
      "username": "admin",
      "ip_address": "192.168.1.100",
      "message": "TOKEN REUSE DETECTED...",
      "created_at": "2024-11-01T14:30:00Z"
    }
  ]
}
```

### 2. Get My Audit Logs

```http
GET /api/v1/audit/logs/me
```

**Query Parameters**:
- `event_type` (optional)
- `hours` (default: 24)
- `limit` (default: 100, max: 500)

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/logs/me?hours=168" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Get Security Summary (Admin Only)

```http
GET /api/v1/audit/security/summary
```

**Query Parameters**:
- `hours` (default: 24)

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/security/summary?hours=24" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

**Response**:
```json
{
  "total_events": 45,
  "failed_logins": 12,
  "token_reuse_attempts": 1,
  "rate_limit_violations": 8,
  "account_lockouts": 2,
  "suspicious_activities": 0,
  "period_hours": 24
}
```

### 4. Get Failed Login Attempts (Admin Only)

```http
GET /api/v1/audit/security/failed-logins
```

**Query Parameters**:
- `username` (optional)
- `ip_address` (optional)
- `hours` (default: 24)
- `limit` (default: 100)

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/security/failed-logins?username=admin&hours=1" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### 5. Get Token Reuse Attempts (Admin Only)

```http
GET /api/v1/audit/security/token-reuse
```

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/security/token-reuse?hours=168" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### 6. Get Activity by IP (Admin Only)

```http
GET /api/v1/audit/activity/ip/{ip_address}
```

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/activity/ip/192.168.1.100" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### 7. Get Activity by User (Admin Only)

```http
GET /api/v1/audit/activity/user/{user_id}
```

**Example**:
```bash
curl -X GET "http://localhost:8000/api/v1/audit/activity/user/1?hours=720" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

## Usage Examples

### Python Client

```python
import requests

# Login
response = requests.post(
    "http://localhost:8000/api/v1/auth/login",
    data={"username": "admin", "password": "admin123"}
)
tokens = response.json()
access_token = tokens["access_token"]

# Get my audit logs
response = requests.get(
    "http://localhost:8000/api/v1/audit/logs/me",
    headers={"Authorization": f"Bearer {access_token}"},
    params={"hours": 168}  # Last 7 days
)
my_logs = response.json()

print(f"Total events: {my_logs['total']}")
for log in my_logs['logs']:
    print(f"{log['created_at']}: {log['event_type']} - {log['message']}")
```

### SQL Queries

```sql
-- Get all failed logins in last 24 hours
SELECT username, ip_address, created_at, error_message
FROM audit_logs
WHERE event_type = 'login_failed'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Count events by type
SELECT event_type, COUNT(*) as count
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY event_type
ORDER BY count DESC;

-- Get suspicious IPs (multiple failed logins)
SELECT ip_address, COUNT(*) as failed_attempts
FROM audit_logs
WHERE event_type = 'login_failed'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
HAVING COUNT(*) > 5
ORDER BY failed_attempts DESC;

-- Get user activity timeline
SELECT created_at, event_type, message, ip_address
FROM audit_logs
WHERE user_id = 1
ORDER BY created_at DESC
LIMIT 50;
```

---

## Monitoring & Alerts

### 1. Failed Login Monitoring

**Alert on**: 5+ failed logins for same user in 5 minutes

```sql
SELECT username, COUNT(*) as attempts
FROM audit_logs
WHERE event_type = 'login_failed'
  AND created_at > NOW() - INTERVAL '5 minutes'
GROUP BY username
HAVING COUNT(*) >= 5;
```

### 2. Token Reuse Detection

**Alert on**: Any token reuse attempt (CRITICAL)

```sql
SELECT *
FROM audit_logs
WHERE event_type = 'token_reuse_detected'
  AND created_at > NOW() - INTERVAL '1 hour';
```

### 3. Rate Limit Violations

**Alert on**: 10+ rate limit violations from same IP in 1 hour

```sql
SELECT ip_address, COUNT(*) as violations
FROM audit_logs
WHERE event_type = 'rate_limit_exceeded'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
HAVING COUNT(*) >= 10;
```

### 4. Suspicious Activity Patterns

**Alert on**: Multiple failed logins from different IPs for same user

```sql
SELECT username, COUNT(DISTINCT ip_address) as ip_count
FROM audit_logs
WHERE event_type = 'login_failed'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY username
HAVING COUNT(DISTINCT ip_address) > 3;
```

---

## Security Best Practices

### 1. Log Retention

- **INFO logs**: 30-90 days
- **WARNING+ logs**: 1-2 years (compliance)
- **CRITICAL logs**: Indefinite retention

### 2. Access Control

- Audit logs contain sensitive data
- Restrict access to admin users only
- Use `GET /audit/logs/me` for regular users

### 3. Regular Review

- Daily: Review critical events
- Weekly: Analyze failed login patterns
- Monthly: Security trend analysis

### 4. Automated Alerts

Set up alerts for:
- Token reuse attempts
- Account lockouts
- Unusual login patterns
- Rate limit violations

### 5. Backup

- Regular backups of audit_logs table
- Separate backup retention from production data
- Test restore procedures

---

## Troubleshooting

### Audit Logs Not Being Created

**Check**:
1. Database migration completed: `\d audit_logs`
2. AuditLogger imported in auth_router
3. Application logs for errors

### Performance Issues

**Optimize**:
1. Add indexes on frequently queried columns
2. Implement log archiving
3. Use pagination for large result sets
4. Consider partitioning by date

### Missing Events

**Verify**:
1. All auth endpoints call audit logger
2. Database commits successful
3. No exceptions in application logs

---

## Conclusion

The audit logging system provides comprehensive security event tracking for the PIX Integration Service. All authentication events are logged with full context for compliance, security monitoring, and forensic analysis.

**Status**: ✅ Production Ready  
**Coverage**: 100% of authentication events  
**Performance**: Optimized with indexes  
**Compliance**: Meets audit trail requirements

---

**Version**: 2.4.0  
**Last Updated**: November 1, 2024  
**Maintainer**: PIX Integration Team
