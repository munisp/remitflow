# Runbook: Low Transfer Success Rate

**Alert:** `TransferSuccessRateLow`
**Severity:** CRITICAL
**Impact:** Fund delivery failing; SLO breach
**SLO:** 99.9% transfer success rate

## Immediate Actions

1. **Assess scope**:
   ```sql
   SELECT corridor, count(*) as failed, count(*) * 100.0 / 
     (SELECT count(*) FROM transfers WHERE created_at > now() - interval '1 hour') as pct
   FROM transfers
   WHERE status = 'failed' AND created_at > now() - interval '1 hour'
   GROUP BY corridor ORDER BY failed DESC;
   ```

2. **Check error breakdown**:
   ```sql
   SELECT error_code, count(*) FROM transfers
   WHERE status = 'failed' AND created_at > now() - interval '1 hour'
   GROUP BY error_code ORDER BY count DESC;
   ```

3. **Check external service health**:
   ```bash
   curl http://localhost:3001/api/services/health | jq '.'
   curl http://localhost:8125/health | jq '.'
   ```

## Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `RAIL_TIMEOUT` | Payment rail not responding | Failover to backup |
| `INSUFFICIENT_BALANCE` | LP pool depleted | Top up liquidity |
| `SANCTIONS_HIT` | Sanctions screening flagged | Review manually |
| `KYC_EXPIRED` | User KYC needs renewal | Notify user |
| `RATE_EXPIRED` | FX quote expired before execution | Reduce quote TTL |
| `TB_ERROR` | TigerBeetle ledger error | Check TB cluster |

## Resolution

1. Fix the root cause per error code table above
2. Retry failed transfers: `UPDATE transfers SET status = 'retry' WHERE status = 'failed' AND error_code = '<fixable_code>' AND created_at > now() - interval '1 hour';`
3. Monitor success rate recovering above 99.9%
4. Compensate users with >10 min delay
