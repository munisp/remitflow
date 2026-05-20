# RemitFlow Incident Response Runbook

**Version:** 1.0 | **Owner:** Platform Engineering | **Review Cycle:** Quarterly

---

## Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|-----------|---------------|------------|
| **SEV-1** | Complete platform outage or data breach | 15 min | CTO + Legal immediately |
| **SEV-2** | Payment processing failure or partial outage | 30 min | Engineering Lead |
| **SEV-3** | Single service degraded, no customer impact | 2 hours | On-call engineer |
| **SEV-4** | Minor bug, no service impact | Next business day | Ticket only |

---

## On-Call Contacts

```
Primary On-Call:   PagerDuty schedule → https://remitflow.pagerduty.com
Engineering Lead:  Slack #incidents channel
CTO:               Direct escalation for SEV-1 only
Legal/Compliance:  Required for any data breach (GDPR 72-hour notification window)
```

---

## SEV-1: Complete Platform Outage

### Detection
- Uptime monitor alert (Grafana/PagerDuty)
- Multiple customer reports via support
- Health endpoint `GET /health` returning non-200

### Immediate Actions (0–15 min)
```bash
# 1. Check all service health
kubectl get pods -n remitflow-prod
kubectl get pods -n remitflow-prod | grep -v Running

# 2. Check recent deployments
kubectl rollout history deployment/remitflow-api -n remitflow-prod

# 3. Check error logs
kubectl logs -n remitflow-prod deployment/remitflow-api --tail=100 | grep ERROR

# 4. Check database connectivity
kubectl exec -n remitflow-prod deployment/remitflow-api -- python3 -c "import asyncpg; import asyncio; asyncio.run(asyncpg.connect('$DATABASE_URL'))"

# 5. Check Redis
kubectl exec -n remitflow-prod deployment/remitflow-api -- redis-cli -u $REDIS_URL ping
```

### Rollback Procedure
```bash
# Rollback to previous deployment
kubectl rollout undo deployment/remitflow-api -n remitflow-prod
kubectl rollout undo deployment/remitflow-pwa -n remitflow-prod

# Verify rollback
kubectl rollout status deployment/remitflow-api -n remitflow-prod
```

### Communication Template
```
[STATUS UPDATE - SEV-1] RemitFlow Platform Incident
Time: {timestamp}
Impact: {description of customer impact}
Status: Investigating / Identified / Mitigating / Resolved
ETA: {estimated resolution time}
Next update in: 15 minutes
```

---

## SEV-2: Payment Processing Failure

### Detection
- Transaction failure rate > 5% (Grafana alert)
- Wise/Paystack/Flutterwave webhook failures
- AML blocking rate spike

### Diagnostic Steps
```bash
# Check payment service logs
kubectl logs -n remitflow-prod deployment/remitflow-api | grep -E "payment|transaction|wise|paystack" | tail -50

# Check Wise integration status
curl -H "Authorization: Bearer $WISE_API_KEY" https://api.wise.com/v1/profiles

# Check Paystack balance
curl -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" https://api.paystack.co/balance

# Check pending transactions
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status;"

# Check AML block rate
psql $DATABASE_URL -c "SELECT COUNT(*) FROM aml_transaction_log WHERE is_blocked=true AND created_at > NOW() - INTERVAL '1 hour';"
```

### Mitigation Options
1. **Switch payment rail**: Update smart routing to bypass failing provider
2. **Enable stablecoin fallback**: Route to USDC/USDT if fiat rails fail
3. **Pause new transactions**: Set `PAYMENT_PROCESSING_ENABLED=false` in ConfigMap
4. **Manual processing**: Operations team can process stuck transactions via admin panel

---

## SEV-1: Data Breach / Security Incident

### Immediate Actions (0–15 min)
```bash
# 1. Rotate ALL secrets immediately
python3 backend/scripts/generate_secrets.py --rotate-all

# 2. Revoke all active JWT tokens (Redis flush)
redis-cli -u $REDIS_URL FLUSHDB

# 3. Block suspicious IPs at Nginx level
kubectl exec -n remitflow-prod deployment/nginx -- nginx -s reload

# 4. Enable read-only mode
kubectl set env deployment/remitflow-api -n remitflow-prod READ_ONLY_MODE=true
```

### GDPR 72-Hour Notification Checklist
- [ ] Identify scope of breach (which users, what data)
- [ ] Notify DPO within 1 hour
- [ ] File ICO/DPA notification within 72 hours if EU/UK users affected
- [ ] Prepare user notification email (if high risk to individuals)
- [ ] Document: what happened, when, what data, what action taken

### Evidence Preservation
```bash
# Export audit logs before any cleanup
psql $DATABASE_URL -c "\COPY audit_logs TO '/tmp/audit_logs_incident_$(date +%Y%m%d).csv' CSV HEADER"
kubectl logs -n remitflow-prod --all-containers=true > /tmp/k8s_logs_$(date +%Y%m%d_%H%M%S).txt
```

---

## Database Recovery

### Point-in-Time Recovery from S3 Backup
```bash
# List available backups
aws s3 ls s3://$BACKUP_S3_BUCKET/postgres/ --region $BACKUP_S3_REGION | sort -r | head -10

# Download latest backup
aws s3 cp s3://$BACKUP_S3_BUCKET/postgres/YYYYMMDD_HHMMSS.dump /tmp/restore.dump

# Restore to new database
pg_restore -h $DB_HOST -U $DB_USER -d remittance_restore --clean --if-exists /tmp/restore.dump

# Verify restore
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM transactions;"
```

---

## Post-Incident Review (PIR)

Within 48 hours of resolution, document:
1. **Timeline**: Exact sequence of events with timestamps
2. **Root Cause**: Technical root cause (not blame)
3. **Impact**: Number of users affected, transactions impacted, duration
4. **Detection**: How was it detected? Was alerting adequate?
5. **Resolution**: What fixed it?
6. **Action Items**: Specific tasks with owners and deadlines to prevent recurrence

PIR template: `/docs/PIR_TEMPLATE.md`

---

## Monitoring Dashboards

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| Platform Overview | `https://grafana.remitflow.com/d/overview` | All services health |
| Transaction Metrics | `https://grafana.remitflow.com/d/transactions` | Payment success rates |
| AML Alerts | `https://grafana.remitflow.com/d/aml` | Compliance monitoring |
| Error Rates | `https://sentry.io/organizations/remitflow` | Application errors |
| Infrastructure | `https://grafana.remitflow.com/d/infra` | CPU/memory/disk |
