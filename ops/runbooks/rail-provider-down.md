# Runbook: Payment Rail Provider Down

**Alert:** `RailProviderDown`
**Severity:** CRITICAL
**Impact:** Transfers on affected corridor(s) will fail
**SLO:** 99.9% rail availability

## Symptoms

- `rail_provider_health == 0` for specific rail
- Circuit breaker in OPEN state for the rail
- Transfers to affected corridor returning errors
- Settlement queue growing for that rail

## Payment Rails & Backup Strategy

| Rail | Provider | Corridors | Backup Rail | Backup Provider |
|------|----------|-----------|-------------|-----------------|
| ACH | Stripe | US domestic | Wire | Banking Circle |
| SEPA | Banking Circle | EU corridors | SWIFT | Wise Business |
| SWIFT | Wise Business | International | — | Manual settlement |
| NIBSS | Flutterwave | NG domestic | Paystack | Paystack |
| M-Pesa | Safaricom | KE corridors | Airtel Money | Airtel |
| MTN MoMo | MTN | GH, UG, CM | — | Manual |
| Mojaloop | Hub | Cross-border | PAPSS | PAPSS Hub |
| PAPSS | PAPSS Hub | Pan-African | — | Manual |

## Immediate Actions

1. **Confirm rail is actually down** (not just a timeout):
   ```bash
   # Check circuit breaker state
   curl http://localhost:8125/health | jq '.rails'
   
   # Direct provider health check
   curl -s -o /dev/null -w "%{http_code}" https://api.flutterwave.com/v3/health
   curl -s -o /dev/null -w "%{http_code}" https://api.paystack.co/health
   ```

2. **Activate backup rail** (if available):
   ```bash
   curl -X POST http://localhost:8125/admin/failover \
     -H "Content-Type: application/json" \
     -d '{
       "rail": "nibss",
       "action": "failover",
       "backup": "paystack"
     }'
   ```

3. **Hold new transfers on affected corridor** (if no backup):
   ```bash
   curl -X POST http://localhost:3001/api/admin/corridor-hold \
     -H "Content-Type: application/json" \
     -d '{"corridor": "US-NG", "reason": "rail_provider_down", "hold": true}'
   ```

4. **Notify users with pending transfers**:
   ```bash
   # Trigger notification for users with in-flight transfers on this rail
   curl -X POST http://localhost:3001/api/admin/notify-delay \
     -d '{"rail": "nibss", "estimated_delay_minutes": 30}'
   ```

## Resolution

### When provider recovers:

1. Run health check to confirm:
   ```bash
   curl http://localhost:8125/health | jq '.rails.nibss'
   ```

2. Close circuit breaker manually (or wait for half-open probe):
   ```bash
   curl -X POST http://localhost:8125/admin/circuit-breaker \
     -d '{"rail": "nibss", "action": "close"}'
   ```

3. Process stuck settlement queue:
   ```bash
   curl -X POST http://localhost:8125/admin/flush-queue \
     -d '{"rail": "nibss"}'
   ```

4. Verify transfers completing:
   ```bash
   watch 'curl -s http://localhost:3001/metrics/features | grep settlement_queue_depth'
   ```

5. Release corridor hold:
   ```bash
   curl -X POST http://localhost:3001/api/admin/corridor-hold \
     -d '{"corridor": "US-NG", "hold": false}'
   ```

## Escalation

- If backup rail also fails: Engage manual settlement team
- If downtime > 4 hours: Notify CBN/FCA (regulatory reporting obligation)
- If user funds at risk: Activate compensation workflow for refunds

## Provider Status Pages

- Flutterwave: https://status.flutterwave.com
- Paystack: https://status.paystack.com
- Stripe: https://status.stripe.com
- Wise: https://status.wise.com
- Safaricom M-Pesa: https://developer.safaricom.co.ke/status
