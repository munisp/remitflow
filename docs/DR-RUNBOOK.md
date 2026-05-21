# Disaster Recovery Runbook — P2 DevOps 4.12

## 1. RTO/RPO Targets

| Tier | RTO | RPO | Services |
|------|-----|-----|----------|
| Critical | 15 min | 0 (synchronous) | API, Database, Auth |
| High | 1 hour | 5 min | Kafka, Redis, KYC |
| Medium | 4 hours | 1 hour | Analytics, Search, AI |
| Low | 24 hours | 24 hours | Docs, Monitoring |

## 2. Database Recovery

### Full Database Restore
```bash
# 1. Stop the application
kubectl scale deployment remitflow-api --replicas=0

# 2. Restore from latest RDS snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier remitflow-restored \
  --db-snapshot-identifier <snapshot-id> \
  --db-instance-class db.r6g.xlarge

# 3. Wait for restore
aws rds wait db-instance-available --db-instance-identifier remitflow-restored

# 4. Update connection string
kubectl set env deployment/remitflow-api \
  DATABASE_URL=postgresql://...@remitflow-restored.xxx.rds.amazonaws.com:5432/remitflow

# 5. Restart
kubectl scale deployment remitflow-api --replicas=3
```

### Point-in-Time Recovery
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier remitflow-production \
  --target-db-instance-identifier remitflow-pitr \
  --restore-time "2024-01-15T10:30:00Z"
```

## 3. Redis Cache Recovery

Redis is used as a cache layer. Recovery is automatic — the app falls back to direct DB queries.

```bash
# Force cache invalidation
kubectl exec -it redis-0 -- redis-cli FLUSHALL

# Verify app is serving
curl -s https://api.remitflow.com/api/trpc/system.health | jq
```

## 4. Kafka Recovery

```bash
# Check consumer group lag
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group remitflow --describe

# Reset consumer offset to replay events
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group remitflow --topic kyc.events \
  --reset-offsets --to-datetime "2024-01-15T10:00:00.000" --execute
```

## 5. Multi-Region Failover

```bash
# 1. Promote read replica to primary
aws rds promote-read-replica --db-instance-identifier remitflow-eu-west-1-replica

# 2. Update DNS
aws route53 change-resource-record-sets --hosted-zone-id Z123 \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"api.remitflow.com","Type":"CNAME","TTL":60,"ResourceRecords":[{"Value":"eu-west-1-alb.amazonaws.com"}]}}]}'

# 3. Verify
curl -s https://api.remitflow.com/api/trpc/system.health
```

## 6. Communication Plan

| Time | Action |
|------|--------|
| T+0 | Incident detected, on-call paged |
| T+5min | Incident commander assigned |
| T+10min | Status page updated |
| T+15min | First customer communication |
| T+30min | Progress update |
| Recovery | Post-mortem scheduled within 48h |

## 7. Verification Checklist

After any recovery:
- [ ] API health check passes
- [ ] Database connectivity verified
- [ ] Auth/JWT tokens validating
- [ ] Kafka consumers processing
- [ ] Redis caching active
- [ ] All microservices healthy
- [ ] Recent transactions visible
- [ ] Transfer flow end-to-end tested
- [ ] Monitoring/alerts restored
- [ ] Status page updated
