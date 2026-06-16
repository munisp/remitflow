# RemitFlow — Incident Response Runbook

## Severity Levels

| Level | Definition | Response Time | Escalation |
|---|---|---|---|
| **SEV1** | Complete platform outage, data loss, or security breach | 5 min | VP Eng + CTO immediately |
| **SEV2** | Partial outage (>10% users affected) or payment failures | 15 min | On-call lead + PM |
| **SEV3** | Degraded performance or non-critical feature failure | 30 min | On-call engineer |
| **SEV4** | Cosmetic issues or single-user impact | Next business day | Ticket queue |

---

## 1. Platform Outage (SEV1)

### Symptoms
- Health endpoints returning 5xx
- All API requests failing
- Grafana: `remitflow_api_up == 0`

### Immediate Actions
```bash
# 1. Check pod status
kubectl get pods -n remitflow -l app=remitflow-api

# 2. Check recent deployments (was something deployed?)
kubectl rollout history deployment/remitflow-api -n remitflow

# 3. Check node health
kubectl get nodes
kubectl top nodes

# 4. If recent deployment caused it — ROLLBACK
kubectl rollout undo deployment/remitflow-api -n remitflow

# 5. Check PgBouncer (DB connection pool)
kubectl logs -l app=pgbouncer -n remitflow --tail=50

# 6. Check Redis
kubectl exec -it $(kubectl get pod -l app=redis-cache -n remitflow -o name | head -1) -n remitflow -- redis-cli ping
```

### If Database Is Down
```bash
# Check PostgreSQL status
kubectl get pods -n remitflow -l app=postgresql
kubectl logs -l app=postgresql -n remitflow --tail=100

# Check connections
kubectl exec -it pgbouncer-pod -n remitflow -- psql -p 6432 -U pgbouncer_stats pgbouncer -c "SHOW POOLS;"

# Emergency: increase max connections
kubectl edit configmap pgbouncer-config -n remitflow
# Set max_client_conn = 5000, restart pgbouncer
kubectl rollout restart deployment/pgbouncer -n remitflow
```

### Recovery Verification
```bash
# Confirm health
curl -s https://api.remitflow.io/health | jq .
curl -s https://api.remitflow.io/api/trpc/systemHealth.getStatus | jq .

# Check error rate is back to normal
# Grafana: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])
```

---

## 2. Payment Processing Failures (SEV1/SEV2)

### Symptoms
- Transfers stuck in "processing" state
- TigerBeetle returning errors
- Wallet balances not updating
- Alert: `remitflow_transfer_failures_total > 10` in 5 min

### Immediate Actions
```bash
# 1. Check transfer engine
kubectl logs -l app=go-transfer-engine -n remitflow --tail=100 | grep -i error

# 2. Check TigerBeetle connectivity
kubectl exec -it $(kubectl get pod -l app=tigerbeetle -n remitflow -o name | head -1) -- tigerbeetle status

# 3. Check Kafka lag (are events backed up?)
kubectl exec -it kafka-pod -n remitflow -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --describe --group remitflow-transfers

# 4. Check Rust escrow ledger
kubectl logs -l app=rust-escrow-ledger -n remitflow --tail=50

# 5. Emergency: pause new transfers (circuit breaker)
kubectl set env deployment/remitflow-api -n remitflow TRANSFERS_CIRCUIT_BREAKER=open
```

### Resolution Steps
1. Identify which payment rail is failing (check logs for corridor-specific errors)
2. If 3rd party rail is down → enable fallback rail or queue transfers
3. If TigerBeetle is overloaded → scale up or drain queue
4. After fix, replay stuck transfers from Kafka dead letter queue

### Recovery
```bash
# Re-enable transfers
kubectl set env deployment/remitflow-api -n remitflow TRANSFERS_CIRCUIT_BREAKER=closed

# Verify stuck transfers are processing
psql -c "SELECT status, count(*) FROM transactions WHERE status='processing' AND created_at > now() - interval '1 hour' GROUP BY status;"
```

---

## 3. High Latency / Performance Degradation (SEV2/SEV3)

### Symptoms
- P95 latency > 2s (normal: <500ms)
- Alert: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2`

### Diagnosis
```bash
# 1. Check CPU/memory pressure
kubectl top pods -n remitflow --sort-by=cpu | head -20

# 2. Check HPA status (are we at max replicas?)
kubectl get hpa -n remitflow

# 3. Check PgBouncer pool saturation
kubectl exec -it pgbouncer-pod -- psql -p 6432 pgbouncer -c "SHOW POOLS;" | grep remitflow

# 4. Check slow queries
psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 seconds';"

# 5. Check Redis memory
kubectl exec -it redis-pod -- redis-cli INFO memory | grep used_memory_human

# 6. Check Kafka consumer lag
kubectl exec -it kafka-pod -- kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups | grep -v "^$"
```

### Mitigation
```bash
# Scale up API pods
kubectl scale deployment/remitflow-api -n remitflow --replicas=10

# Kill long-running queries
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '30 seconds' AND query NOT LIKE '%pg_stat%';"

# Flush Redis if memory pressure (non-critical cache)
kubectl exec -it redis-pod -- redis-cli FLUSHDB ASYNC
```

---

## 4. Security Incident (SEV1)

### Symptoms
- Unusual login patterns (brute force detected)
- Data exfiltration alert
- WAF blocking surge
- Alert: `remitflow_security_events_total{severity="critical"} > 0`

### Immediate Actions (DO NOT DELAY)
```bash
# 1. If data breach suspected — notify compliance IMMEDIATELY
# Contact: compliance@remitflow.io, +1-xxx-xxx-xxxx

# 2. Block suspicious IPs
kubectl exec -it apisix-pod -- curl -X PUT http://localhost:9080/apisix/admin/global_rules/1 \
  -d '{"plugins":{"ip-restriction":{"blacklist":["SUSPICIOUS_IP"]}}}'

# 3. Force logout all sessions (nuclear option)
kubectl exec -it redis-pod -- redis-cli KEYS "session:*" | xargs redis-cli DEL

# 4. Enable enhanced logging
kubectl set env deployment/remitflow-api -n remitflow LOG_LEVEL=debug

# 5. Capture forensic snapshot
kubectl exec -it api-pod -- tar czf /tmp/forensic-$(date +%s).tar.gz /var/log/ /tmp/

# 6. Check audit logs for unauthorized access
psql -c "SELECT * FROM audit_logs WHERE severity='critical' AND created_at > now() - interval '1 hour' ORDER BY created_at DESC LIMIT 50;"
```

### Post-Incident
1. Preserve all logs (do NOT delete)
2. Document timeline in incident channel
3. Conduct post-mortem within 24 hours
4. File regulatory notification if PII exposed (72-hour deadline for GDPR/NDPR)

---

## 5. FX Rate Feed Failure (SEV3)

### Symptoms
- Stale FX rates (>5 min old)
- Alert: `remitflow_fx_rate_age_seconds > 300`

### Actions
```bash
# 1. Check FX aggregator
kubectl logs -l app=go-fx-aggregator -n remitflow --tail=30

# 2. Check external provider connectivity
kubectl exec -it api-pod -- curl -s "https://open.er-api.com/v6/latest/USD" | jq .result

# 3. If all providers are down — use cached rates
kubectl set env deployment/remitflow-api -n remitflow FX_FALLBACK_MODE=cache

# 4. If stale >30 min — pause FX-dependent transfers
kubectl set env deployment/remitflow-api -n remitflow FX_CIRCUIT_BREAKER=open
```

---

## 6. Fraud Detection Alert (SEV2)

### Symptoms
- GNN fraud model flagging high volume
- Alert: `remitflow_fraud_alerts_total{severity="high"} > 5` in 10 min
- Agent reconciliation showing large discrepancies

### Actions
```bash
# 1. Check fraud model alerts
kubectl logs -l app=python-gnn-fraud -n remitflow --tail=50

# 2. Check agent reconciliation
kubectl logs -l app=rust-agent-reconciliation -n remitflow --tail=50

# 3. Freeze suspicious accounts
psql -c "UPDATE users SET status='frozen' WHERE id IN (SELECT user_id FROM fraud_alerts WHERE severity='critical' AND created_at > now() - interval '1 hour' AND resolved=false);"

# 4. Notify compliance team
# Automated: Goes to Slack #compliance-alerts
```

---

## On-Call Checklist

### Start of Shift
- [ ] Check Grafana dashboards (all green?)
- [ ] Review overnight alerts in PagerDuty
- [ ] Check Kafka consumer lag (all groups caught up?)
- [ ] Verify secrets rotation status (any expiring <7 days?)
- [ ] Check PgBouncer pool utilization (<80%)

### Useful Commands
```bash
# Quick health check
curl -s https://api.remitflow.io/health | jq .
curl -s https://api.remitflow.io/readiness | jq .

# All pod status
kubectl get pods -n remitflow | grep -v Running

# Recent OOMKills
kubectl get events -n remitflow --field-selector reason=OOMKilled --sort-by='.lastTimestamp' | tail -10

# Disk usage
kubectl exec -it postgres-pod -- df -h /var/lib/postgresql/data
```

### Escalation Contacts
| Role | Primary | Secondary |
|---|---|---|
| On-Call Engineer | PagerDuty rotation | #oncall Slack |
| Engineering Lead | @eng-lead | Phone (in 1Password) |
| Security | @security-team | security@remitflow.io |
| Compliance | @compliance | compliance@remitflow.io |
| CTO | @cto | Phone (emergency only) |
