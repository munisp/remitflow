# etcd Disaster Recovery Plan

**Platform**: Nigerian Remittance Platform  
**Component**: etcd for APISIX  
**Version**: 1.0  
**Last Updated**: October 24, 2024

---

## Overview

This document outlines the disaster recovery procedures for etcd, the configuration store for APISIX API Gateway.

---

## Recovery Objectives

- **RTO (Recovery Time Objective)**: 15 minutes
- **RPO (Recovery Point Objective)**: 24 hours (daily backups)
- **Data Loss Tolerance**: Maximum 24 hours of configuration changes

---

## Backup Strategy

### Automated Daily Backups

**Schedule**: Daily at 2:00 AM UTC

**Backup Script**: `/scripts/backup-etcd.sh`

**Backup Location**:
- Local: `/backup/etcd-YYYYMMDD-HHMMSS.db.gz`
- S3 (optional): `s3://your-bucket/etcd-backups/`

**Retention Policy**: 30 days

**Backup Size**: Typically 10-50 MB (compressed)

### Backup Verification

Daily automated verification:
```bash
etcdctl snapshot status /backup/etcd-latest.db
```

---

## Disaster Scenarios

### Scenario 1: Single Node Failure (Kubernetes)

**Impact**: No service disruption (3-node cluster provides HA)

**Recovery Steps**:
1. Kubernetes automatically restarts failed pod
2. etcd cluster rebalances automatically
3. No manual intervention required

**Recovery Time**: 2-5 minutes (automatic)

---

### Scenario 2: Data Corruption

**Impact**: etcd cluster unstable or returning incorrect data

**Recovery Steps**:

1. **Stop APISIX** (prevent further writes)
   ```bash
   kubectl scale deployment apisix --replicas=0 -n apisix
   ```

2. **Stop etcd cluster**
   ```bash
   kubectl scale statefulset etcd --replicas=0 -n apisix
   ```

3. **Identify latest good backup**
   ```bash
   ls -lh /backup/ | grep etcd-
   ```

4. **Restore from backup**
   ```bash
   ./scripts/restore-etcd.sh /backup/etcd-20241024-020000.db.gz
   ```

5. **Start etcd cluster**
   ```bash
   kubectl scale statefulset etcd --replicas=3 -n apisix
   ```

6. **Verify etcd health**
   ```bash
   kubectl exec -it etcd-0 -n apisix -- etcdctl \
     --endpoints=https://localhost:2379 \
     --cacert=/certs/ca.pem \
     --cert=/certs/etcd-client.pem \
     --key=/certs/etcd-client-key.pem \
     endpoint health
   ```

7. **Start APISIX**
   ```bash
   kubectl scale deployment apisix --replicas=3 -n apisix
   ```

8. **Verify APISIX functionality**
   ```bash
   curl https://api.remittance-platform.ng/apisix/status
   ```

**Recovery Time**: 10-15 minutes

---

### Scenario 3: Complete Cluster Loss

**Impact**: Total etcd cluster failure, all nodes lost

**Recovery Steps**:

1. **Provision new etcd cluster**
   ```bash
   kubectl apply -f kubernetes-secure.yaml
   ```

2. **Wait for pods to be ready**
   ```bash
   kubectl wait --for=condition=ready pod -l app=etcd -n apisix --timeout=300s
   ```

3. **Restore from latest backup on first node**
   ```bash
   kubectl exec -it etcd-0 -n apisix -- /scripts/restore-etcd.sh /backup/etcd-latest.db.gz
   ```

4. **Restart etcd cluster**
   ```bash
   kubectl delete pod etcd-0 etcd-1 etcd-2 -n apisix
   ```

5. **Verify cluster health**
   ```bash
   kubectl exec -it etcd-0 -n apisix -- etcdctl \
     --endpoints=https://etcd-0.etcd:2379,https://etcd-1.etcd:2379,https://etcd-2.etcd:2379 \
     --cacert=/certs/ca.pem \
     --cert=/certs/etcd-client.pem \
     --key=/certs/etcd-client-key.pem \
     endpoint health --cluster
   ```

6. **Restart APISIX**
   ```bash
   kubectl rollout restart deployment apisix -n apisix
   ```

7. **Verify APISIX connectivity**
   ```bash
   curl https://api.remittance-platform.ng/apisix/status
   ```

**Recovery Time**: 15-20 minutes

---

### Scenario 4: Accidental Data Deletion

**Impact**: Critical APISIX configuration deleted (routes, upstreams, etc.)

**Recovery Steps**:

1. **Identify when deletion occurred**
   - Check etcd audit logs
   - Check APISIX logs

2. **Find backup before deletion**
   ```bash
   ls -lh /backup/ | grep "etcd-2024"
   ```

3. **Restore from backup** (follow Scenario 2 steps)

4. **Verify restored configuration**
   ```bash
   # List all routes
   curl http://localhost:9180/apisix/admin/routes \
     -H "X-API-KEY: $ADMIN_KEY"
   
   # List all upstreams
   curl http://localhost:9180/apisix/admin/upstreams \
     -H "X-API-KEY: $ADMIN_KEY"
   ```

**Recovery Time**: 10-15 minutes

---

## Recovery Testing

### Monthly DR Drill

**Schedule**: First Sunday of each month

**Procedure**:
1. Create test etcd cluster
2. Restore from latest backup
3. Verify data integrity
4. Document results
5. Update procedures if needed

**Success Criteria**:
- Restore completes in < 15 minutes
- All data verified correct
- APISIX connects successfully

---

## Backup Verification Checklist

Daily automated checks:
- [ ] Backup file created
- [ ] Backup file size reasonable (10-50 MB)
- [ ] Snapshot status verified
- [ ] Backup compressed successfully
- [ ] Old backups cleaned up
- [ ] Backup count matches retention policy

---

## Emergency Contacts

### On-Call Team

**Primary**: Platform Engineering Team  
**Email**: platform@remittance-platform.ng  
**Phone**: +234-XXX-XXX-XXXX

**Secondary**: Infrastructure Team  
**Email**: infra@remittance-platform.ng  
**Phone**: +234-XXX-XXX-XXXX

### Escalation Path

1. On-Call Engineer (0-15 min)
2. Platform Lead (15-30 min)
3. CTO (30+ min)

---

## Post-Recovery Checklist

After any recovery:
- [ ] Verify etcd cluster health
- [ ] Verify all 3 nodes running
- [ ] Verify APISIX connectivity
- [ ] Test all routes
- [ ] Test all upstreams
- [ ] Check monitoring dashboards
- [ ] Document incident
- [ ] Update runbook if needed
- [ ] Conduct post-mortem

---

## Monitoring & Alerts

### Critical Alerts

1. **etcd Node Down**
   - Alert: Immediate
   - Action: Check node status, restart if needed

2. **etcd Cluster Unhealthy**
   - Alert: Immediate
   - Action: Check all nodes, verify quorum

3. **Backup Failed**
   - Alert: Within 1 hour
   - Action: Check backup script, verify storage

4. **High Disk Usage** (> 80%)
   - Alert: Within 15 minutes
   - Action: Check compaction, clean old data

### Warning Alerts

1. **etcd Latency High** (> 100ms)
   - Alert: Within 5 minutes
   - Action: Check network, check load

2. **Backup Size Unusual**
   - Alert: Within 1 hour
   - Action: Verify data integrity

---

## Appendix

### Useful Commands

**Check cluster health**:
```bash
etcdctl --endpoints=https://etcd-0.etcd:2379 \
  --cacert=/certs/ca.pem \
  --cert=/certs/etcd-client.pem \
  --key=/certs/etcd-client-key.pem \
  endpoint health --cluster
```

**List all keys**:
```bash
etcdctl --endpoints=https://etcd-0.etcd:2379 \
  --cacert=/certs/ca.pem \
  --cert=/certs/etcd-client.pem \
  --key=/certs/etcd-client-key.pem \
  get --prefix=true ''
```

**Check member list**:
```bash
etcdctl --endpoints=https://etcd-0.etcd:2379 \
  --cacert=/certs/ca.pem \
  --cert=/certs/etcd-client.pem \
  --key=/certs/etcd-client-key.pem \
  member list
```

**Defragment**:
```bash
etcdctl --endpoints=https://etcd-0.etcd:2379 \
  --cacert=/certs/ca.pem \
  --cert=/certs/etcd-client.pem \
  --key=/certs/etcd-client-key.pem \
  defrag
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-10-24 | Platform Team | Initial version |

---

**Document Owner**: Platform Engineering Team  
**Review Frequency**: Quarterly  
**Next Review**: January 2025

