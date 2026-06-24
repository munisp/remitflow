# RemitFlow — Go-Live Checklist & Launch Plan

## Launch Timeline

```
Week -8:  Licensing applications submitted (FINTRAC first)
Week -6:  SOC 2 Type II audit engagement begins
Week -4:  Penetration test by CREST-certified firm
Week -3:  Load testing on production infrastructure (10K concurrent)
Week -2:  DR drill on production (failover + failback)
Week -1:  Canary deployment (internal users only)
Day -3:   Security review sign-off
Day -1:   Go/no-go decision meeting
Day 0:    Launch (5% traffic via canary)
Day +1:   Scale to 25% traffic
Day +3:   Scale to 50% traffic
Day +7:   Full traffic (100%)
Day +30:  Post-launch review
```

---

## Pre-Launch Checklist

### A. Legal & Compliance (Owner: CCO)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| A1 | FINTRAC MSB registration submitted | [ ] | Yes |
| A2 | CBN IMTO application submitted | [ ] | Yes (Nigeria corridor) |
| A3 | FCA PI application submitted | [ ] | Yes (UK corridor) |
| A4 | FinCEN MSB registration completed | [ ] | Yes (US corridor) |
| A5 | Terms of Service reviewed by legal counsel | [ ] | Yes |
| A6 | Privacy Policy reviewed (GDPR/NDPR/POPIA) | [ ] | Yes |
| A7 | AML/CFT policy approved by board | [ ] | Yes |
| A8 | Compliance officer appointed and registered | [ ] | Yes |
| A9 | MLRO registered with NCA (UK) | [ ] | Yes (UK corridor) |
| A10 | Insurance coverage obtained (fidelity + PI + cyber) | [ ] | Yes |
| A11 | Banking partner agreements signed | [ ] | Yes |
| A12 | Correspondent banking relationships established | [ ] | Yes |

### B. Technology (Owner: CTO)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| B1 | Multi-region infrastructure deployed (Terraform) | [ ] | Yes |
| B2 | All API keys configured (production, not sandbox) | [ ] | Yes |
| B3 | Vault initialized and unsealed (HA) | [ ] | Yes |
| B4 | PgBouncer deployed and tested (1000+ connections) | [ ] | Yes |
| B5 | Temporal server + workers running | [ ] | Yes |
| B6 | TigerBeetle cluster deployed (3-node) | [ ] | Yes |
| B7 | Kafka cluster deployed (3-broker, KRaft) | [ ] | Yes |
| B8 | Redis cluster deployed (master + 2 replicas) | [ ] | Yes |
| B9 | CDN configured (CloudFront + cache busting verified) | [ ] | No |
| B10 | DNS configured (GeoDNS for multi-region) | [ ] | Yes |
| B11 | SSL certificates provisioned (wildcard) | [ ] | Yes |
| B12 | CI/CD pipeline producing signed images | [ ] | Yes |
| B13 | Blue/green deployment tested | [ ] | No |
| B14 | Rollback tested (< 60s recovery) | [ ] | Yes |

### C. Security (Owner: CISO)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| C1 | Penetration test passed (no critical/high findings) | [ ] | Yes |
| C2 | Dependency audit passed (no critical CVEs) | [ ] | Yes |
| C3 | WAF rules deployed and tested | [ ] | Yes |
| C4 | Network policies applied (zero-trust) | [ ] | Yes |
| C5 | Secrets rotated (no dev/staging secrets in prod) | [ ] | Yes |
| C6 | Container images scanned (no critical vulnerabilities) | [ ] | Yes |
| C7 | DDoS protection configured (Shield Advanced) | [ ] | No |
| C8 | SIEM/SOC monitoring active | [ ] | Yes |
| C9 | Incident response team briefed | [ ] | Yes |
| C10 | Kill switch tested (can freeze platform in <30s) | [ ] | Yes |

### D. Operations (Owner: VP Eng)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| D1 | On-call rotation configured (24/7) | [ ] | Yes |
| D2 | Runbooks reviewed and accessible | [ ] | Yes |
| D3 | Escalation matrix defined | [ ] | Yes |
| D4 | Monitoring dashboards live (Grafana) | [ ] | Yes |
| D5 | Alert rules configured (PagerDuty) | [ ] | Yes |
| D6 | Status page configured (status.remitflow.app) | [ ] | No |
| D7 | Backup/restore tested within last 7 days | [ ] | Yes |
| D8 | DR drill completed successfully | [ ] | Yes |
| D9 | Load test passed (10K concurrent, p95 < 500ms) | [ ] | Yes |
| D10 | Soak test passed (30min, no memory leaks) | [ ] | No |

### E. Business (Owner: CEO)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| E1 | Customer support team trained | [ ] | Yes |
| E2 | Support channels active (email, chat, phone) | [ ] | Yes |
| E3 | FAQ and help center published | [ ] | No |
| E4 | Marketing materials reviewed for compliance | [ ] | No |
| E5 | Launch communications prepared | [ ] | No |
| E6 | Banking/funding runway > 18 months | [ ] | Yes |
| E7 | Settlement pre-funding complete (nostro accounts) | [ ] | Yes |
| E8 | FX liquidity confirmed (Mark Lane + additional) | [ ] | Yes |

### F. Testing (Owner: QA Lead)

| # | Item | Status | Blocker? |
|---|------|--------|----------|
| F1 | All unit tests passing (1526+) | [ ] | Yes |
| F2 | Integration tests passing (30 scenarios) | [ ] | Yes |
| F3 | End-to-end test (real money, sandbox) | [ ] | Yes |
| F4 | UAT completed (5 stakeholder journeys) | [ ] | Yes |
| F5 | Accessibility audit passed (WCAG 2.1 AA) | [ ] | No |
| F6 | Mobile testing (iOS + Android, 3 devices each) | [ ] | No |
| F7 | Cross-browser testing (Chrome, Safari, Firefox) | [ ] | No |
| F8 | Performance baseline established | [ ] | Yes |

---

## Go/No-Go Decision Framework

### Mandatory (all must be YES):
1. Regulatory license obtained or partnership in place for each active corridor
2. No critical or high security findings unresolved
3. Load test demonstrates capacity for 2x projected launch traffic
4. All financial reconciliation tests pass with zero discrepancy
5. On-call team confirmed available for first 7 days
6. Rollback tested and verified (< 60s)
7. Customer funds safeguarding verified (segregated account, reconciled)
8. Kill switch tested

### Advisory (preferred but not blocking):
1. SOC 2 Type II audit complete (can be in progress)
2. All state MTLs obtained (can use licensed partner initially)
3. Mobile apps approved in App Store / Google Play
4. Marketing campaign ready

---

## Launch Day Runbook

### T-4h: Pre-launch verification
```bash
# Verify all services healthy
kubectl get pods -n remitflow | grep -v Running

# Verify reconciliation balance
curl -s https://api.remitflow.app/internal/reconciliation | jq .

# Verify sanctions list freshness
curl -s https://api.remitflow.app/internal/sanctions-list-age | jq .

# Verify Vault sealed status
vault status -address=https://vault.internal.remitflow.app
```

### T-0: Go live
```bash
# Enable canary (5% traffic)
kubectl set image deployment/remitflow-api api=remitflow/api:v1.0.0 -n remitflow
kubectl annotate deployment/remitflow-api flagger.app/canary-weight=5

# Monitor error rate
watch -n5 'curl -s localhost:9090/api/v1/query?query=rate(http_requests_total{status=~"5.."}[1m])'
```

### T+30m: First checkpoint
- Error rate < 0.1%? → Proceed to 25%
- Error rate > 1%? → Rollback immediately
- Any ledger imbalance? → Freeze + investigate

### T+4h: Scale to 25%
```bash
kubectl annotate deployment/remitflow-api flagger.app/canary-weight=25
```

### T+24h: Scale to 50%
```bash
kubectl annotate deployment/remitflow-api flagger.app/canary-weight=50
```

### T+72h: Scale to 100%
```bash
kubectl annotate deployment/remitflow-api flagger.app/canary-weight=100
# Promote canary to primary
flagger promote remitflow-api -n remitflow
```

---

## Post-Launch Monitoring (First 30 Days)

| Metric | Target | Alert Threshold | Action |
|--------|--------|-----------------|--------|
| API error rate | < 0.1% | > 0.5% | Page on-call |
| P95 latency | < 200ms | > 500ms | Scale up |
| Transfer success rate | > 99.5% | < 99% | Investigate rail |
| Reconciliation balance | 0 discrepancy | Any discrepancy | Freeze + investigate |
| Sanctions screening coverage | 100% | < 100% | Block unscreened |
| KYC verification turnaround | < 5 min | > 30 min | Escalate to provider |
| Customer support response | < 2h | > 4h | Add staff |
| Daily active users | Growing | Declining | Marketing review |

---

## Rollback Procedure

If critical issues detected at any stage:

```bash
# 1. Freeze new transactions
curl -X POST https://api.remitflow.app/internal/freeze -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. Revert to previous version
kubectl rollout undo deployment/remitflow-api -n remitflow

# 3. Verify rollback healthy
kubectl rollout status deployment/remitflow-api -n remitflow

# 4. Reconcile any in-flight transactions
npx tsx ops/scripts/reconcile-inflight.ts

# 5. Unfreeze (only after reconciliation clean)
curl -X POST https://api.remitflow.app/internal/unfreeze -H "Authorization: Bearer $ADMIN_TOKEN"

# 6. Notify stakeholders
# - Engineering: Slack #incidents
# - Compliance: Email compliance@remitflow.app
# - Customers: Status page update
```
