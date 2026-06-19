# RemitFlow — Incident Response Procedure

## Severity Classification

| Level | Definition | Response Time | Example |
|-------|-----------|---------------|---------|
| **SEV1** | Service fully down, funds at risk | 5 min | Ledger imbalance, all transfers failing |
| **SEV2** | Major feature degraded, some users impacted | 15 min | One corridor down, high error rate |
| **SEV3** | Minor degradation, workaround exists | 1 hour | Slow quotes, analytics delayed |
| **SEV4** | Cosmetic / informational | Next business day | Dashboard rendering issue |

## Incident Lifecycle

```
DETECT → TRIAGE → MITIGATE → RESOLVE → POST-MORTEM
  │         │         │          │           │
  │         │         │          │           └─ Within 48h
  │         │         │          └─ Fix root cause
  │         │         └─ Stop bleeding (failover, rollback, hold)
  │         └─ Assess severity, assign IC
  └─ Alert fires or user reports
```

## Roles

| Role | Responsibility |
|------|---------------|
| **Incident Commander (IC)** | Coordinates response, makes decisions, communicates |
| **Tech Lead** | Investigates root cause, implements fix |
| **Comms Lead** | Updates status page, notifies affected users |
| **Finance Lead** | Assesses financial impact, authorizes compensations |

## Step-by-Step Response

### 1. DETECT (Automated)
- Prometheus alert fires → PagerDuty pages on-call
- User reports via support channel
- Automated monitoring detects anomaly

### 2. TRIAGE (First 5 minutes)
```
IC Checklist:
□ Acknowledge alert in PagerDuty
□ Open incident channel: #incident-YYYY-MM-DD-<title>
□ Assess severity (SEV1-4)
□ Page additional responders if needed
□ Post initial status: "Investigating [symptom]"
```

### 3. MITIGATE (Stop the bleeding)

**For transfer failures:**
```bash
# Option A: Activate kill switch (stops new transfers)
curl -X POST http://temporal:7233/kill-switch/activate

# Option B: Failover to backup rail
curl -X POST http://localhost:8125/admin/failover -d '{"rail":"<affected>","backup":"<backup>"}'

# Option C: Rollback last deployment
kubectl argo rollouts abort remitflow-api -n remitflow
```

**For ledger issues:**
```bash
# Halt all financial operations
curl -X POST http://localhost:3001/api/admin/maintenance-mode -d '{"enabled":true}'
```

**For security incidents:**
```bash
# Revoke compromised credentials
curl -X POST http://keycloak:8080/admin/revoke-all-sessions
# Activate WAF emergency rules
curl -X POST http://apisix:9180/apisix/admin/routes/emergency-block
```

### 4. RESOLVE (Root cause fix)
- Identify root cause using runbooks
- Implement fix (code change, config update, infrastructure fix)
- Deploy fix through canary pipeline (fast-track for SEV1)
- Verify fix resolves the issue
- Verify no secondary effects

### 5. POST-MORTEM (Within 48 hours)

Template:
```markdown
## Incident Post-Mortem: [Title]

**Date:** YYYY-MM-DD
**Duration:** X hours Y minutes
**Severity:** SEV[1-4]
**Impact:** [number of users, amount of funds, corridors affected]

### Timeline
- HH:MM — [Event]

### Root Cause
[Explanation]

### Resolution
[What fixed it]

### Action Items
| Priority | Action | Owner | Due Date |
|----------|--------|-------|----------|
| P0 | [action] | [name] | [date] |

### Lessons Learned
1. [lesson]
```

## Communication Templates

### Status Page Update (SEV1)
```
[Investigating] We are aware of an issue affecting [transfers/payments/logins]
in [corridor/region]. Our team is actively investigating.

[Identified] The issue has been identified as [brief description].
We are working on a fix.

[Monitoring] A fix has been deployed. We are monitoring to confirm resolution.

[Resolved] The issue has been fully resolved.
[X] transfers were affected and have been [completed/refunded].
```

### User Notification (Delayed Transfer)
```
Your transfer of [amount] [currency] to [recipient] is taking longer
than expected. We're working to complete it as soon as possible.
You will receive a confirmation once delivery is complete.
If not resolved within [timeframe], your funds will be automatically refunded.
Reference: [transfer_id]
```

## On-Call Schedule

| Week | Primary | Secondary | Escalation |
|------|---------|-----------|------------|
| Rotation | Platform Engineer | Backend Engineer | Engineering Manager |

On-call expectations:
- Acknowledge pages within 5 minutes
- Laptop + internet within 15 minutes
- Follow runbooks before escalating
- Document all actions taken

## Key Dashboards

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| Transfer Operations | `/grafana/d/remitflow-transfers` | Real-time transfer health |
| Infrastructure | `/grafana/d/remitflow-infra` | Service health, resources |
| Alertmanager | `:9093` | Active alerts, silences |
| Temporal UI | `:8088` | Workflow execution status |
