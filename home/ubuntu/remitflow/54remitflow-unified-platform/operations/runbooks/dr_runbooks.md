# Disaster Recovery Runbooks

## Overview

This document contains critical runbooks for disaster recovery procedures. These runbooks are designed for on-call engineers and should be followed step-by-step during incidents.

---

## 1. TigerBeetle Recovery

### 1.1 TigerBeetle Primary Failure

**Severity:** P1 - Critical
**SLO Impact:** tigerbeetle_availability (99.99%)
**Owner:** Platform Team

#### Symptoms
- TigerBeetle health check failing
- Transaction processing errors
- "Connection refused" errors from services

#### Immediate Actions

```bash
# 1. Check TigerBeetle status
kubectl get pods -n tigerbeetle -l app=tigerbeetle

# 2. Check logs
kubectl logs -n tigerbeetle -l app=tigerbeetle --tail=100

# 3. Check disk usage
kubectl exec -n tigerbeetle tigerbeetle-0 -- df -h /data

# 4. Check memory
kubectl top pods -n tigerbeetle
```

#### Recovery Steps

**Option A: Pod Restart (if data intact)**
```bash
# Delete pod to trigger restart
kubectl delete pod -n tigerbeetle tigerbeetle-0

# Wait for pod to be ready
kubectl wait --for=condition=ready pod/tigerbeetle-0 -n tigerbeetle --timeout=300s

# Verify health
curl -s http://tigerbeetle:3000/health
```

**Option B: Restore from Backup**
```bash
# 1. Scale down TigerBeetle
kubectl scale statefulset tigerbeetle -n tigerbeetle --replicas=0

# 2. List available backups
aws s3 ls s3://remittance-backups/tigerbeetle/

# 3. Download latest backup
BACKUP_DATE=$(aws s3 ls s3://remittance-backups/tigerbeetle/ | tail -1 | awk '{print $4}')
aws s3 cp s3://remittance-backups/tigerbeetle/$BACKUP_DATE /tmp/tigerbeetle-backup.tar.gz

# 4. Clear existing data
kubectl exec -n tigerbeetle tigerbeetle-0 -- rm -rf /data/*

# 5. Restore backup
kubectl cp /tmp/tigerbeetle-backup.tar.gz tigerbeetle/tigerbeetle-0:/tmp/
kubectl exec -n tigerbeetle tigerbeetle-0 -- tar -xzf /tmp/tigerbeetle-backup.tar.gz -C /data/

# 6. Scale up
kubectl scale statefulset tigerbeetle -n tigerbeetle --replicas=1

# 7. Verify
kubectl wait --for=condition=ready pod/tigerbeetle-0 -n tigerbeetle --timeout=300s
```

#### Verification
```bash
# Check ledger integrity
curl -s http://tigerbeetle:3000/accounts | jq '.count'

# Verify recent transactions
curl -s http://tigerbeetle:3000/transfers?limit=10 | jq '.'

# Run reconciliation
kubectl exec -n tigerbeetle tigerbeetle-0 -- /app/reconcile.sh
```

---

## 2. PostgreSQL Recovery

### 2.1 PostgreSQL Primary Failure

**Severity:** P1 - Critical
**Owner:** Platform Team

#### Symptoms
- Database connection errors
- "FATAL: the database system is not yet accepting connections"
- Replication lag alerts

#### Immediate Actions

```bash
# 1. Check PostgreSQL status
kubectl get pods -n postgres -l app=postgresql

# 2. Check if primary is running
kubectl exec -n postgres postgresql-0 -- pg_isready

# 3. Check replication status
kubectl exec -n postgres postgresql-0 -- psql -U postgres -c "SELECT * FROM pg_stat_replication;"
```

#### Recovery Steps

**Option A: Failover to Replica**
```bash
# 1. Promote replica to primary
kubectl exec -n postgres postgresql-1 -- pg_ctl promote -D /var/lib/postgresql/data

# 2. Update service to point to new primary
kubectl patch svc postgresql -n postgres -p '{"spec":{"selector":{"statefulset.kubernetes.io/pod-name":"postgresql-1"}}}'

# 3. Update connection strings in secrets
kubectl create secret generic postgres-credentials -n default \
  --from-literal=host=postgresql-1.postgresql.postgres.svc.cluster.local \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart dependent services
kubectl rollout restart deployment -n default -l depends-on=postgresql
```

**Option B: Point-in-Time Recovery**
```bash
# 1. Stop PostgreSQL
kubectl scale statefulset postgresql -n postgres --replicas=0

# 2. Download WAL archives
aws s3 sync s3://remittance-backups/postgres/wal/ /tmp/wal/

# 3. Create recovery.conf
cat > /tmp/recovery.conf << EOF
restore_command = 'cp /tmp/wal/%f %p'
recovery_target_time = '2024-01-15 10:00:00 UTC'
recovery_target_action = 'promote'
EOF

# 4. Apply recovery config
kubectl cp /tmp/recovery.conf postgres/postgresql-0:/var/lib/postgresql/data/

# 5. Start PostgreSQL
kubectl scale statefulset postgresql -n postgres --replicas=1
```

#### Verification
```bash
# Check database is accepting connections
kubectl exec -n postgres postgresql-0 -- psql -U postgres -c "SELECT 1;"

# Check table counts
kubectl exec -n postgres postgresql-0 -- psql -U postgres -d remittance -c "
SELECT schemaname, relname, n_live_tup 
FROM pg_stat_user_tables 
ORDER BY n_live_tup DESC 
LIMIT 10;"

# Verify application connectivity
curl -s http://api-gateway/health | jq '.database'
```

---

## 3. Key/Certificate Rotation

### 3.1 Emergency Certificate Rotation

**Severity:** P2 - High
**Owner:** Security Team

#### When to Use
- Certificate compromise suspected
- Certificate expiration imminent
- Security audit requirement

#### Steps

```bash
# 1. Generate new CA (if CA compromised)
openssl genrsa -out /tmp/ca.key 4096
openssl req -new -x509 -days 365 -key /tmp/ca.key -out /tmp/ca.crt \
  -subj "/CN=Remittance Platform CA/O=Remittance Platform/C=KE"

# 2. Generate new service certificates
for SERVICE in api-gateway transaction-service auth-service; do
  openssl genrsa -out /tmp/${SERVICE}.key 2048
  openssl req -new -key /tmp/${SERVICE}.key -out /tmp/${SERVICE}.csr \
    -subj "/CN=${SERVICE}/O=Remittance Platform/C=KE"
  openssl x509 -req -in /tmp/${SERVICE}.csr -CA /tmp/ca.crt -CAkey /tmp/ca.key \
    -CAcreateserial -out /tmp/${SERVICE}.crt -days 90
done

# 3. Update Kubernetes secrets
kubectl create secret tls api-gateway-tls -n default \
  --cert=/tmp/api-gateway.crt --key=/tmp/api-gateway.key \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart services to pick up new certs
kubectl rollout restart deployment -n default -l uses-mtls=true

# 5. Verify new certificates
for SERVICE in api-gateway transaction-service auth-service; do
  echo "Checking $SERVICE..."
  kubectl exec -n default deploy/$SERVICE -- \
    openssl x509 -in /etc/ssl/certs/service.crt -noout -dates
done
```

### 3.2 API Key Rotation

```bash
# 1. Generate new API keys
NEW_KEY=$(openssl rand -hex 32)

# 2. Update in Vault
vault kv put secret/api-keys/payment-gateway key=$NEW_KEY

# 3. Update Kubernetes secret
kubectl create secret generic payment-gateway-key -n default \
  --from-literal=api-key=$NEW_KEY \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart services
kubectl rollout restart deployment payment-service -n default

# 5. Verify
kubectl exec -n default deploy/payment-service -- env | grep API_KEY
```

---

## 4. Event Stream Replay

### 4.1 Kafka Event Replay

**Severity:** P2 - High
**Owner:** Platform Team

#### When to Use
- Data inconsistency detected
- Service recovered from failure
- Audit requirement

#### Steps

```bash
# 1. Identify topic and offset range
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group transaction-processor --describe

# 2. Reset consumer group offset
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group transaction-processor --topic transactions \
  --reset-offsets --to-datetime 2024-01-15T00:00:00.000 --execute

# 3. Or reset to specific offset
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group transaction-processor --topic transactions \
  --reset-offsets --to-offset 12345 --execute

# 4. Restart consumer service
kubectl rollout restart deployment transaction-processor -n default

# 5. Monitor replay progress
watch -n 5 'kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group transaction-processor --describe'
```

### 4.2 TigerBeetle Edge Replay

```bash
# 1. Get current sync state
curl -s http://edge-sync:8080/state | jq '.'

# 2. Create snapshot before replay
curl -X POST http://edge-sync:8080/snapshot

# 3. Trigger replay from specific sequence
curl -X POST http://edge-sync:8080/replay \
  -H "Content-Type: application/json" \
  -d '{"from_sequence": 12345}'

# 4. Monitor replay progress
watch -n 5 'curl -s http://edge-sync:8080/state | jq ".pending_events"'
```

---

## 5. Ledger Reconciliation

### 5.1 Daily Reconciliation

**Schedule:** Daily at 02:00 UTC
**Owner:** Finance Team

#### Automated Steps

```bash
# Run reconciliation job
kubectl create job --from=cronjob/ledger-reconciliation ledger-reconciliation-manual

# Monitor progress
kubectl logs -f job/ledger-reconciliation-manual

# Check results
curl -s http://reconciliation-service:8080/results/latest | jq '.'
```

#### Manual Reconciliation

```bash
# 1. Export TigerBeetle balances
curl -s http://tigerbeetle:3000/accounts/export > /tmp/tb_balances.json

# 2. Export PostgreSQL balances
kubectl exec -n postgres postgresql-0 -- psql -U postgres -d remittance -c "
COPY (
  SELECT agent_id, SUM(amount) as balance 
  FROM transactions 
  WHERE status = 'completed' 
  GROUP BY agent_id
) TO STDOUT WITH CSV HEADER" > /tmp/pg_balances.csv

# 3. Run comparison script
python3 /scripts/reconcile.py \
  --tigerbeetle /tmp/tb_balances.json \
  --postgres /tmp/pg_balances.csv \
  --output /tmp/reconciliation_report.json

# 4. Review discrepancies
cat /tmp/reconciliation_report.json | jq '.discrepancies'
```

---

## 6. Service Recovery Procedures

### 6.1 API Gateway Recovery

```bash
# 1. Check APISIX status
kubectl get pods -n apisix

# 2. Verify etcd connectivity
kubectl exec -n apisix deploy/apisix -- curl -s http://etcd:2379/health

# 3. Reload routes
kubectl exec -n apisix deploy/apisix -- apisix reload

# 4. Verify routes
curl -s http://apisix-admin:9180/apisix/admin/routes | jq '.list | length'
```

### 6.2 Keycloak Recovery

```bash
# 1. Check Keycloak status
kubectl get pods -n keycloak

# 2. Export realm (backup)
kubectl exec -n keycloak deploy/keycloak -- \
  /opt/keycloak/bin/kc.sh export --dir /tmp/export --realm remittance

# 3. Import realm (restore)
kubectl exec -n keycloak deploy/keycloak -- \
  /opt/keycloak/bin/kc.sh import --dir /tmp/import --override true

# 4. Clear caches
kubectl exec -n keycloak deploy/keycloak -- \
  /opt/keycloak/bin/kcadm.sh update realms/remittance \
  -s 'eventsEnabled=true' --server http://localhost:8080 \
  --realm master --user admin --password $KEYCLOAK_ADMIN_PASSWORD
```

---

## 7. Incident Response Checklist

### Initial Response (First 5 minutes)

- [ ] Acknowledge alert in PagerDuty/OpsGenie
- [ ] Join incident Slack channel #incidents
- [ ] Assess impact and severity
- [ ] Notify stakeholders if P1/P2
- [ ] Start incident timeline document

### Investigation (5-15 minutes)

- [ ] Check service health dashboards
- [ ] Review recent deployments
- [ ] Check infrastructure metrics
- [ ] Review error logs
- [ ] Identify affected services

### Mitigation (15-60 minutes)

- [ ] Implement fix or workaround
- [ ] Verify fix is working
- [ ] Monitor for recurrence
- [ ] Update stakeholders

### Post-Incident

- [ ] Document root cause
- [ ] Create follow-up tickets
- [ ] Schedule post-mortem
- [ ] Update runbooks if needed

---

## Contact Information

| Role | Name | Phone | Slack |
|------|------|-------|-------|
| Platform On-Call | Rotating | +254-XXX-XXXX | @platform-oncall |
| Security On-Call | Rotating | +254-XXX-XXXX | @security-oncall |
| Finance On-Call | Rotating | +254-XXX-XXXX | @finance-oncall |
| Incident Commander | Rotating | +254-XXX-XXXX | @incident-commander |

---

## Escalation Matrix

| Severity | Response Time | Escalation After | Escalate To |
|----------|--------------|------------------|-------------|
| P1 | 5 minutes | 15 minutes | Engineering Manager |
| P2 | 15 minutes | 1 hour | Team Lead |
| P3 | 1 hour | 4 hours | Team Lead |
| P4 | 4 hours | Next business day | Team Lead |
