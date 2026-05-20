# Backup & Disaster Recovery (DR) Plan

## Overview

RemitFlow uses a multi-layer backup strategy to ensure data durability and rapid recovery in the event of infrastructure failure, data corruption, or a security incident.

---

## Database Backup

### Automated Daily Snapshots

The PostgreSQL database (TiDB-compatible) is backed up daily using the Manus managed database backup service. Retention policy:

| Backup Type | Frequency | Retention |
|---|---|---|
| Full snapshot | Daily at 02:00 UTC | 30 days |
| Transaction log backup | Every 15 minutes | 7 days |
| Weekly archive | Every Sunday | 90 days |

### Manual Backup Procedure

```bash
# Export full schema + data
pg_dump $DATABASE_URL --format=custom --compress=9 \
  --file="remitflow-backup-$(date +%Y%m%d-%H%M%S).dump"

# Upload to S3 backup bucket
aws s3 cp remitflow-backup-*.dump s3://remitflow-backups/postgres/ \
  --storage-class STANDARD_IA
```

### Restore Procedure

```bash
# Restore from a specific dump file
pg_restore --clean --if-exists --no-owner \
  --dbname=$DATABASE_URL remitflow-backup-YYYYMMDD-HHMMSS.dump
```

---

## File Storage Backup

All user-uploaded files (KYC documents, receipts, profile images) are stored in S3 with the following configuration:

- **Versioning**: Enabled — all object versions retained for 90 days
- **Cross-region replication**: Enabled to a secondary region
- **Lifecycle policy**: Move to S3 Glacier after 365 days

---

## Recovery Time Objectives

| Scenario | RTO | RPO |
|---|---|---|
| Single service failure | < 2 minutes (auto-restart) | 0 (stateless service) |
| Database node failure | < 5 minutes (replica promotion) | < 15 minutes |
| Full region outage | < 30 minutes (failover to DR region) | < 15 minutes |
| Data corruption | < 2 hours (restore from snapshot) | < 24 hours |
| Security incident | < 4 hours (incident response) | Varies |

---

## Kubernetes Disaster Recovery

The `k8s/` directory contains all Kubernetes manifests. To redeploy the full stack from scratch:

```bash
# 1. Apply namespace and secrets
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/configmap.yaml

# 2. Deploy core services
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml

# 3. Scale microservices
kubectl apply -f k8s/microservices-v76.yaml
kubectl apply -f k8s/v100-deployment.yaml

# 4. Configure autoscaling
kubectl apply -f k8s/hpa.yaml
```

---

## Runbook: Database Point-in-Time Recovery

1. Identify the target recovery timestamp (UTC)
2. Stop all write traffic by scaling down the API deployment: `kubectl scale deployment remitflow-api --replicas=0`
3. Restore the database from the nearest snapshot before the target time
4. Apply transaction log backups up to the target timestamp
5. Verify data integrity: run `pnpm db:push --dry-run` to check schema consistency
6. Restart the API: `kubectl scale deployment remitflow-api --replicas=3`
7. Monitor `/api/health/detailed` for all services to report `ok`

---

## Runbook: Full Platform Recovery

1. Provision a new PostgreSQL instance from the latest snapshot
2. Update `DATABASE_URL` in Kubernetes secrets
3. Deploy all services via `kubectl apply -f k8s/`
4. Verify health at `/api/health/detailed`
5. Run smoke tests: `pnpm test`
6. Notify stakeholders and update the incident log

---

## Contact

For DR activation, contact the on-call engineer via PagerDuty or the #incidents Slack channel.
