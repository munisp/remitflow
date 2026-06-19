# Runbook: Slow Fund Delivery

**Alert:** `TransferDeliverySlowP95`
**Severity:** WARNING
**Impact:** User experience degraded; SLO breach risk
**SLO:** p95 delivery < 30 seconds

## Symptoms

- Transfer delivery p95 latency exceeding 30 seconds
- Users complaining about slow transfers
- Settlement queue growing

## Investigation

1. **Identify slow corridor(s)**:
   ```promql
   histogram_quantile(0.95, sum(rate(transfer_delivery_duration_seconds_bucket[5m])) by (le, corridor))
   ```

2. **Check if it's a specific rail**:
   ```bash
   curl http://localhost:8125/health | jq '.rails'
   ```

3. **Check settlement queue depth**:
   ```bash
   curl http://localhost:3001/metrics/features | grep settlement_queue
   ```

## Common Causes & Fixes

| Cause | Fix |
|-------|-----|
| Rail provider slow | Monitor; failover if > 5 min |
| High transaction volume | Scale settlement workers |
| DB query slow | Check PostgreSQL slow query log |
| Kafka consumer lag | Scale consumers |
| TigerBeetle contention | Check TB cluster health |

## Resolution

1. If single rail: Consider temporary failover
2. If all corridors: Check shared infrastructure (DB, Kafka, TB)
3. Scale settlement workers if queue depth is growing
4. After resolution: Verify p95 returns below 30s
