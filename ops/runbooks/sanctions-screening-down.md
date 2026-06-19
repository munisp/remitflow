# Runbook: Sanctions Screening Down

**Alert:** `SanctionsScreeningDown`
**Severity:** CRITICAL
**Impact:** REGULATORY — all transfers must be held until resolved
**Legal:** CBN AML/CFT, FATF Recommendation 6, FCA Financial Sanctions

## ⚠️ REGULATORY REQUIREMENT

Transfers MUST NOT be processed without sanctions screening. Proceeding without screening is a regulatory violation that can result in license revocation.

## Immediate Actions

1. **HOLD all pending transfers** (automatic if circuit breaker is working):
   ```bash
   curl -X POST http://localhost:3001/api/admin/sanctions-hold \
     -d '{"action":"hold","reason":"screening_service_unavailable"}'
   ```

2. **Check screening provider status**:
   ```bash
   # OFAC
   curl -s -o /dev/null -w "%{http_code}" https://sanctionssearch.ofac.treas.gov/
   # UN
   curl -s -o /dev/null -w "%{http_code}" https://scsanctions.un.org/
   ```

3. **Check circuit breaker**:
   ```bash
   curl http://localhost:3001/metrics/features | grep circuit_breaker | grep sanctions
   ```

4. **Notify compliance team** immediately — this is a mandatory escalation.

## Resolution

1. When provider recovers, close circuit breaker
2. Process held transfers through screening
3. Release transfers that pass
4. File SARs for any flagged during batch screening
5. Document the outage for regulatory reporting

## Fallback

If primary provider (OFAC API) is down > 30 minutes:
- Switch to cached sanctions list (must be < 24 hours old)
- Log all transfers processed against cached list
- Re-screen against live list when available

**Never bypass screening entirely.**

## Escalation

- Immediately: Compliance Officer
- > 30 minutes: Chief Compliance Officer
- > 2 hours: External legal counsel
- > 4 hours: Regulatory notification (CBN, FCA as applicable)
