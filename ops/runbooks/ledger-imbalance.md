# Runbook: Ledger Imbalance

**Alert:** `LedgerImbalance`
**Severity:** CRITICAL — Page immediately
**Impact:** Potential fund loss, duplication, or accounting error
**SLO:** Debits - Credits = 0 at all times (zero tolerance)

## Symptoms

- Alert fires when `abs(sum(tigerbeetle_debits_total) - sum(tigerbeetle_credits_total)) > 0`
- Dashboard shows non-zero value in "TigerBeetle Ledger Balance" panel
- Users may report missing or extra funds

## Immediate Actions (First 5 minutes)

1. **HALT all new transfers** — prevent further imbalance:
   ```bash
   # Activate kill switch via Temporal
   curl -X POST http://temporal:7233/api/v1/namespaces/default/workflows \
     -d '{"workflowId":"kill-switch","workflowType":{"name":"haltTransfers"}}'
   ```

2. **Identify the imbalanced account(s)**:
   ```sql
   -- Find accounts where debits != credits
   SELECT account_id,
          sum(debit_amount) as debits,
          sum(credit_amount) as credits,
          sum(debit_amount) - sum(credit_amount) as imbalance
   FROM tigerbeetle_journal
   GROUP BY account_id
   HAVING sum(debit_amount) != sum(credit_amount)
   ORDER BY abs(sum(debit_amount) - sum(credit_amount)) DESC
   LIMIT 20;
   ```

3. **Check recent transfer failures**:
   ```sql
   SELECT * FROM transfers
   WHERE status IN ('failed', 'compensating', 'stuck')
   AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC;
   ```

4. **Check dead letter queue**:
   ```bash
   kafka-console-consumer --bootstrap-server kafka:9092 \
     --topic remitflow.dlq \
     --from-beginning --max-messages 10
   ```

## Investigation

### Common Causes

| Cause | How to Identify | Resolution |
|-------|----------------|------------|
| Failed saga compensation | Transfer status = 'failed' but no reversal entry | Manually create reversal entry |
| Duplicate credit | Two credits for same transfer ID | Delete duplicate, verify with user |
| Race condition | Concurrent transfers to same account | Review timestamps, apply locking |
| External rail timeout | Fiat payout submitted but settlement unknown | Check rail provider portal |

### Diagnostic Queries

```sql
-- Find the exact transfer(s) causing imbalance
SELECT t.id, t.amount, t.status, t.corridor,
       j.debit_amount, j.credit_amount
FROM transfers t
LEFT JOIN tigerbeetle_journal j ON t.id = j.transfer_id
WHERE t.created_at > now() - interval '2 hours'
AND (j.debit_amount IS NULL OR j.credit_amount IS NULL
     OR j.debit_amount != j.credit_amount);
```

## Resolution Steps

1. **For failed compensation**: Create manual reversal entry
   ```bash
   # Use TB admin CLI
   tigerbeetle-admin create-transfer \
     --debit-account <credited_account> \
     --credit-account <debited_account> \
     --amount <imbalance_amount> \
     --flags compensation \
     --user-data "manual-fix-$(date +%s)"
   ```

2. **For duplicate**: Void the duplicate entry (append-only — add negation)

3. **After fix**: Verify balance is zero again
   ```bash
   curl http://localhost:3001/api/services/health | jq '.tigerbeetle.balance'
   ```

4. **Resume transfers**:
   ```bash
   curl -X POST http://temporal:7233/api/v1/namespaces/default/workflows \
     -d '{"workflowId":"kill-switch","workflowType":{"name":"resumeTransfers"}}'
   ```

## Escalation

- If imbalance > $10,000: Notify CFO immediately
- If imbalance persists > 30 minutes: Engage TigerBeetle support
- If user funds affected: Notify compliance team for SAR consideration

## Post-Incident

1. File incident report
2. Add regression test for the specific failure mode
3. Update chaos engineering suite with new scenario
4. Review if circuit breaker thresholds need adjustment
