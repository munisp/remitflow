# Runbook: Stuck Transfers

**Alert:** `TransferStuckInFlight`
**Severity:** CRITICAL
**Impact:** Users' funds are locked; delivery delayed
**SLO:** 99.9% of transfers complete within 30 seconds

## Symptoms

- Transfers initiated but not completing
- `transfers_in_flight` metric growing without `transfers_completed_total` increasing
- Users reporting "pending" status for extended periods
- Settlement queue growing

## Immediate Actions (First 5 minutes)

1. **Assess scope** — how many transfers are stuck:
   ```sql
   SELECT corridor, count(*), min(created_at) as oldest
   FROM transfers
   WHERE status = 'in_flight'
   AND created_at < now() - interval '5 minutes'
   GROUP BY corridor;
   ```

2. **Check Temporal workflows**:
   ```bash
   # List stuck workflows
   tctl workflow list --query "ExecutionStatus='Running' AND StartTime < '2024-01-01'"
   ```

3. **Check external rail health**:
   ```bash
   curl http://localhost:8125/health  # Go fiat rails service
   curl http://localhost:3001/api/services/health | jq '.services'
   ```

4. **Check circuit breaker status**:
   ```bash
   curl http://localhost:3001/metrics/features | grep circuit_breaker
   ```

## Investigation

### Decision Tree

```
Stuck transfers found
├── All same corridor?
│   ├── YES → Rail provider issue (check provider status page)
│   └── NO → Platform-level issue
│       ├── Temporal worker down?
│       │   ├── YES → Restart Temporal worker
│       │   └── NO → Check DB/Kafka/TigerBeetle
│       ├── Kafka consumer lag?
│       │   ├── YES → Scale consumers or check processing errors
│       │   └── NO → Check TigerBeetle connectivity
│       └── TigerBeetle unreachable?
│           ├── YES → Restart TB sidecar, check TB cluster health
│           └── NO → Check application logs for errors
```

### Common Causes

| Cause | Indicator | Fix |
|-------|-----------|-----|
| Rail provider down | All stuck in one corridor | Wait for provider, activate backup rail |
| Temporal worker crashed | No workflow activity | Restart worker: `systemctl restart temporal-worker` |
| Kafka consumer stuck | High consumer lag | Reset offset or restart consumer |
| DB connection exhausted | Connection pool errors in logs | Restart API, increase pool size |
| TigerBeetle timeout | TB errors in application logs | Restart TB sidecar |

## Resolution

### Option A: Retry stuck transfers
```bash
# For transfers stuck < 30 minutes
psql -c "UPDATE transfers SET status = 'retry' WHERE status = 'in_flight' AND created_at < now() - interval '5 minutes' AND created_at > now() - interval '30 minutes';"
# Temporal will pick up retries automatically
```

### Option B: Force-complete with compensation
```bash
# For transfers stuck > 30 minutes — refund to sender
psql -c "UPDATE transfers SET status = 'compensating' WHERE status = 'in_flight' AND created_at < now() - interval '30 minutes';"
# Compensation workflow will reverse the debit and notify user
```

### Option C: Rail failover
```bash
# Switch corridor to backup rail
curl -X POST http://localhost:8125/admin/failover \
  -d '{"corridor":"US-NG","primary_rail":"flutterwave","backup_rail":"paystack"}'
```

## Post-Resolution

1. Verify `transfers_in_flight` metric decreasing
2. Check affected users received funds or refunds
3. Verify ledger balance is still zero
4. Send user notifications for delayed transfers

## Escalation

- If > 1000 transfers stuck: Activate incident bridge
- If > $100K in stuck funds: Notify CFO + Compliance
- If rail provider unresponsive > 1 hour: Activate manual settlement process
