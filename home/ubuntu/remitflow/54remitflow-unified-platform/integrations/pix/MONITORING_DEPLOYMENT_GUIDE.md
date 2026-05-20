# Monitoring for Failed Login Attempts - Deployment Guide

## Overview

This guide covers the deployment and configuration of the comprehensive monitoring system for failed login attempts in the PIX Integration Service.

## Features

### 1. Real-Time Monitoring
- Track failed login attempts in real-time
- Monitor successful logins
- Track account lockouts
- Identify suspicious IP addresses
- Detect targeted accounts

### 2. Automated Alerts
- Email notifications for security events
- Webhook integration (Slack, Discord, PagerDuty, etc.)
- Configurable alert thresholds
- Multiple severity levels (INFO, WARNING, ERROR, CRITICAL)

### 3. Attack Detection
- **Brute Force Detection**: Excessive failed logins from single IP
- **Credential Stuffing**: Multiple usernames from single IP
- **Distributed Attacks**: Multiple IPs targeting single account
- **Mass Lockouts**: Coordinated attacks locking multiple accounts

### 4. Monitoring Dashboard
- Comprehensive statistics and metrics
- Top suspicious IPs
- Top targeted accounts
- Real-time metrics
- Historical analysis (up to 7 days)

---

## Quick Start

### 1. Environment Configuration

Add these settings to your `.env` file:

```bash
# Email Alerts
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_TO=security@yourcompany.com

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@yourcompany.com
SMTP_USE_TLS=true

# Webhook Alerts (optional)
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 2. Register Monitoring Router

The monitoring router should already be registered in `main.py`. Verify:

```python
from monitoring_router import router as monitoring_router

app.include_router(monitoring_router, prefix="/api/v1")
```

### 3. Test the System

```bash
# Send test alert
curl -X POST http://localhost:8000/api/v1/monitoring/test-alert \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Check metrics
curl -X GET http://localhost:8000/api/v1/monitoring/metrics \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Configuration

### Alert Thresholds

Customize thresholds in `monitoring_service.py`:

```python
class AlertThresholds:
    FAILED_LOGINS_PER_IP_HOUR = 10      # Alert if IP has 10+ failed logins
    FAILED_LOGINS_PER_USERNAME_HOUR = 5  # Alert if username has 5+ failed logins
    FAILED_LOGINS_TOTAL_HOUR = 50       # Alert if total exceeds 50
    LOCKED_ACCOUNTS_HOUR = 5            # Alert if 5+ accounts locked
    UNIQUE_USERNAMES_PER_IP = 5         # Alert if IP tries 5+ usernames
    DISTRIBUTED_ATTACK_IPS = 10         # Alert if 10+ IPs target username
```

### Email Configuration

#### Gmail
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password  # Use App Password, not regular password
SMTP_USE_TLS=true
```

#### SendGrid
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_USE_TLS=true
```

#### AWS SES
```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USERNAME=your-ses-smtp-username
SMTP_PASSWORD=your-ses-smtp-password
SMTP_USE_TLS=true
```

### Webhook Configuration

#### Slack
1. Create Slack Incoming Webhook: https://api.slack.com/messaging/webhooks
2. Add to `.env`:
```bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
```

#### Discord
1. Create Discord Webhook in channel settings
2. Add to `.env`:
```bash
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/abcdefghijklmnop
```

#### PagerDuty
1. Create PagerDuty integration
2. Add to `.env`:
```bash
ALERT_WEBHOOK_URL=https://events.pagerduty.com/v2/enqueue
```

---

## API Endpoints

All endpoints require authentication with Admin or PIX Operator role.

### 1. Get Current Metrics
```bash
GET /api/v1/monitoring/metrics
```

**Response**:
```json
{
  "failed_login_count": 15,
  "successful_login_count": 142,
  "locked_accounts_count": 2,
  "suspicious_ips_count": 3,
  "failed_attempts_by_ip": {
    "192.168.1.100": 8,
    "10.0.0.50": 5
  },
  "failed_attempts_by_username": {
    "admin": 6,
    "user1": 4
  },
  "last_reset": "2024-11-01T14:00:00"
}
```

### 2. Get Failed Login Statistics
```bash
GET /api/v1/monitoring/failed-logins/stats?hours=24
```

**Parameters**:
- `hours`: Number of hours to analyze (1-168, default: 24)

**Response**:
```json
{
  "period_hours": 24,
  "total_failed_logins": 47,
  "locked_accounts": 3,
  "top_ips": [
    {"ip": "192.168.1.100", "count": 15},
    {"ip": "10.0.0.50", "count": 12}
  ],
  "top_usernames": [
    {"username": "admin", "count": 18},
    {"username": "user1", "count": 10}
  ],
  "current_metrics": {...}
}
```

### 3. Get Suspicious IPs
```bash
GET /api/v1/monitoring/suspicious-ips?hours=24
```

**Response**:
```json
[
  {
    "ip_address": "192.168.1.100",
    "failed_attempts": 15,
    "unique_usernames": 7,
    "last_attempt": "2024-11-01T14:30:00",
    "risk_level": "critical"
  }
]
```

### 4. Get Targeted Accounts
```bash
GET /api/v1/monitoring/targeted-accounts?hours=24
```

**Response**:
```json
[
  {
    "username": "admin",
    "failed_attempts": 18,
    "unique_ips": 12,
    "last_attempt": "2024-11-01T14:30:00",
    "attack_type": "distributed"
  }
]
```

### 5. Get Monitoring Dashboard
```bash
GET /api/v1/monitoring/dashboard?hours=24
```

**Response**: Complete monitoring overview with all statistics

### 6. Send Test Alert
```bash
POST /api/v1/monitoring/test-alert
```

**Response**:
```json
{
  "message": "Test alert sent successfully",
  "note": "Check your email and webhook endpoints for the test alert"
}
```

---

## Alert Types

### 1. IP Threshold Exceeded
**Trigger**: IP has 10+ failed logins in 1 hour  
**Severity**: CRITICAL  
**Action**: IP is marked as suspicious

### 2. Username Threshold Exceeded
**Trigger**: Username has 5+ failed logins in 1 hour  
**Severity**: CRITICAL  
**Action**: Alert sent to security team

### 3. Account Locked
**Trigger**: Account locked due to failed attempts  
**Severity**: WARNING  
**Action**: Alert sent, account requires manual unlock

### 4. Mass Account Lockout
**Trigger**: 5+ accounts locked in 1 hour  
**Severity**: CRITICAL  
**Action**: Possible coordinated attack detected

### 5. Distributed Attack
**Trigger**: 10+ IPs targeting same username  
**Severity**: CRITICAL  
**Action**: Distributed brute force attack detected

### 6. Credential Stuffing
**Trigger**: IP tries 5+ different usernames  
**Severity**: CRITICAL  
**Action**: Credential stuffing attack detected

---

## Integration with Existing Systems

### Audit Logging
Monitoring is integrated with the audit logging system. All events are:
1. Logged to audit_logs table (permanent record)
2. Tracked in monitoring metrics (real-time)
3. Analyzed for suspicious patterns
4. Trigger alerts when thresholds exceeded

### Rate Limiting
Monitoring works alongside rate limiting:
1. Rate limiter blocks excessive requests
2. Monitoring tracks failed attempts that pass rate limiting
3. Combined defense against attacks

### Account Locking
When account is locked:
1. User model updated with lock status
2. Audit log created
3. Monitoring records lockout
4. Alert sent to security team

---

## Monitoring Best Practices

### 1. Regular Review
- Check dashboard daily
- Review suspicious IPs weekly
- Analyze trends monthly

### 2. Threshold Tuning
- Start with default thresholds
- Adjust based on your traffic patterns
- Lower thresholds for high-security environments

### 3. Alert Fatigue Prevention
- Don't set thresholds too low
- Use different channels for different severities
- Implement alert aggregation

### 4. Incident Response
- Document response procedures
- Assign responsibility for alerts
- Test incident response regularly

### 5. Data Retention
- Keep audit logs for compliance (90+ days)
- Archive old data regularly
- Implement log rotation

---

## Troubleshooting

### Alerts Not Sending

**Email alerts not working**:
1. Check SMTP configuration
2. Verify SMTP credentials
3. Check firewall/network settings
4. Test with `test-alert` endpoint
5. Check application logs

**Webhook alerts not working**:
1. Verify webhook URL
2. Check webhook service status
3. Test with curl manually
4. Check application logs

### Metrics Not Updating

1. Check database connection
2. Verify audit logging is working
3. Check monitoring service initialization
4. Review application logs

### False Positives

1. Review alert thresholds
2. Whitelist legitimate IPs if needed
3. Adjust thresholds for your environment
4. Implement IP reputation checking

---

## Security Considerations

### 1. Sensitive Data
- Passwords are NEVER logged
- Only metadata is stored (IP, username, timestamp)
- Alerts contain minimal PII

### 2. Access Control
- All monitoring endpoints require authentication
- Admin role required for most endpoints
- Audit all monitoring access

### 3. Alert Security
- Use TLS for SMTP
- Secure webhook URLs
- Rotate credentials regularly

### 4. Data Protection
- Encrypt database at rest
- Use secure connections (SSL/TLS)
- Implement data retention policies

---

## Performance Optimization

### 1. Database Indexes
Ensure these indexes exist:
```sql
CREATE INDEX idx_audit_logs_event_type_created ON audit_logs(event_type, created_at);
CREATE INDEX idx_audit_logs_ip_created ON audit_logs(ip_address, created_at);
CREATE INDEX idx_audit_logs_username_created ON audit_logs(username, created_at);
```

### 2. Metrics Reset
- Metrics reset hourly automatically
- Reduces memory usage
- Maintains real-time accuracy

### 3. Query Optimization
- Use time-based filters
- Limit result sets
- Cache dashboard data if needed

---

## Production Deployment Checklist

- [ ] Configure SMTP settings
- [ ] Set up webhook URL (optional)
- [ ] Configure alert email recipients
- [ ] Adjust alert thresholds for your environment
- [ ] Test email alerts
- [ ] Test webhook alerts
- [ ] Verify monitoring endpoints work
- [ ] Set up monitoring dashboard access
- [ ] Document incident response procedures
- [ ] Train security team on monitoring system
- [ ] Set up log retention policy
- [ ] Configure database backups
- [ ] Test full alert workflow
- [ ] Monitor system performance
- [ ] Schedule regular reviews

---

## Support and Maintenance

### Logs Location
- Application logs: Check your logging configuration
- Audit logs: `audit_logs` table in database
- Monitoring metrics: In-memory (resets hourly)

### Monitoring the Monitor
- Set up health checks for monitoring service
- Alert if monitoring stops working
- Regular testing of alert system

### Updates and Maintenance
- Review and update thresholds quarterly
- Update email/webhook configurations as needed
- Archive old audit logs
- Monitor database growth

---

## Conclusion

The monitoring system provides comprehensive protection against authentication attacks with:

✅ Real-time attack detection  
✅ Automated alerting  
✅ Comprehensive statistics  
✅ Easy integration  
✅ Production-ready  

For questions or issues, refer to the application logs or contact the security team.

**Status**: ✅ Production Ready  
**Version**: 2.6.0  
**Last Updated**: November 1, 2024
