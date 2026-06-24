# RemitFlow — SOC 2 Type II Controls Matrix

## Trust Service Criteria Coverage

| Category | Controls | Automated Evidence | Manual Evidence |
|----------|----------|-------------------|-----------------|
| Security (CC) | 28 | 22 | 6 |
| Availability (A) | 12 | 10 | 2 |
| Processing Integrity (PI) | 15 | 12 | 3 |
| Confidentiality (C) | 10 | 8 | 2 |
| Privacy (P) | 8 | 5 | 3 |
| **Total** | **73** | **57** | **16** |

---

## CC1: Control Environment

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC1.1 | Code of conduct acknowledged by all personnel | HR system export | Annual | No |
| CC1.2 | Background checks completed before access granted | HR records | Per hire | No |
| CC1.3 | Security awareness training completed | LMS completion records | Annual | Yes |
| CC1.4 | Organizational chart and reporting lines documented | Confluence/wiki | Quarterly | No |

## CC2: Communication & Information

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC2.1 | Information security policy published and accessible | Git repo (ops/security/) | Version-controlled | Yes |
| CC2.2 | Incident communication procedures documented | ops/runbooks/ | Per incident | Yes |
| CC2.3 | System changes communicated to stakeholders | GitHub PR notifications | Per change | Yes |

## CC3: Risk Assessment

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC3.1 | Risk register maintained and reviewed | Risk assessment doc | Quarterly | No |
| CC3.2 | Threat modeling performed for new features | GitHub PR template includes threat model section | Per feature | Yes |
| CC3.3 | Vulnerability scanning performed | Dependabot + Snyk reports | Continuous | Yes |
| CC3.4 | Penetration testing performed | qa/security/ test results | Annual + per release | Yes |

## CC4: Monitoring Activities

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC4.1 | System metrics collected and monitored | Prometheus + Grafana | Real-time | Yes |
| CC4.2 | Security events logged and reviewed | Compliance audit trail | Real-time | Yes |
| CC4.3 | Anomaly alerts configured and responded to | Alertmanager + PagerDuty | Real-time | Yes |
| CC4.4 | Compliance dashboard reviewed | Grafana compliance dashboard | Daily | Yes |

## CC5: Control Activities

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC5.1 | Logical access restricted by role (RBAC) | Keycloak/Permify config | Continuous | Yes |
| CC5.2 | MFA enforced for all administrative access | Auth system config | Continuous | Yes |
| CC5.3 | Principle of least privilege applied | IAM policy audit | Quarterly | Yes |
| CC5.4 | Segregation of duties for financial operations | Code review requirements, approval workflows | Per operation | Yes |
| CC5.5 | Privileged access reviewed and recertified | Access review logs | Quarterly | No |

## CC6: Logical & Physical Access

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC6.1 | User provisioning follows documented process | JIRA/ticket audit trail | Per request | Yes |
| CC6.2 | User deprovisioning within 24h of termination | HR trigger → auto-disable | Per event | Yes |
| CC6.3 | Password policy enforced (12+ chars, complexity) | Auth config | Continuous | Yes |
| CC6.4 | Session timeouts configured (30 min inactive) | App config | Continuous | Yes |
| CC6.5 | Failed login lockout (5 attempts) | Auth system + rate limiting | Continuous | Yes |
| CC6.6 | Encryption at rest (AES-256) | Vault Transit + disk encryption | Continuous | Yes |
| CC6.7 | Encryption in transit (TLS 1.3) | Certificate manager + config | Continuous | Yes |
| CC6.8 | Network segmentation (VPC, security groups) | Terraform state / K8s NetworkPolicy | Continuous | Yes |
| CC6.9 | WAF rules configured | CloudFront/Cloudflare config | Continuous | Yes |
| CC6.10 | DDoS protection active | Cloud provider WAF | Continuous | Yes |

## CC7: System Operations

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC7.1 | Change management process followed | GitHub PRs + reviews | Per change | Yes |
| CC7.2 | Changes tested before deployment | CI/CD pipeline results | Per deploy | Yes |
| CC7.3 | Rollback capability available | Canary deployment + rollback scripts | Per deploy | Yes |
| CC7.4 | Production access restricted to authorized personnel | K8s RBAC, SSH key audit | Continuous | Yes |
| CC7.5 | Capacity planning performed | Grafana dashboards + load test results | Monthly | Yes |

## CC8: Change Management

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC8.1 | All changes go through PR review | GitHub branch protection rules | Per change | Yes |
| CC8.2 | CI/CD pipeline validates all changes | GitHub Actions workflow results | Per change | Yes |
| CC8.3 | Emergency changes documented retrospectively | Incident postmortem template | Per incident | No |
| CC8.4 | Database migrations reviewed and approved | Drizzle migration PRs | Per migration | Yes |

## CC9: Risk Mitigation

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| CC9.1 | Vendor risk assessments performed | Vendor questionnaire responses | Annual | No |
| CC9.2 | SLAs monitored for critical vendors | Uptime monitoring | Real-time | Yes |
| CC9.3 | Insurance coverage maintained | Policy documents | Annual | No |

---

## A1: Availability

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| A1.1 | SLOs defined and monitored (99.95% API uptime) | Prometheus SLI metrics | Real-time | Yes |
| A1.2 | Auto-scaling configured | K8s HPA + cloud auto-scaling config | Real-time | Yes |
| A1.3 | Health checks on all services | K8s liveness/readiness probes | Every 10s | Yes |
| A1.4 | Backup performed daily | Backup job logs | Daily | Yes |
| A1.5 | Backup restoration tested | DR drill results | Monthly | Yes |
| A1.6 | Disaster recovery plan maintained | ops/disaster-recovery/ | Semi-annual | Yes |
| A1.7 | DR drill executed successfully | DR test results | Semi-annual | No |
| A1.8 | Redundancy for critical components | Multi-AZ deployment config | Continuous | Yes |
| A1.9 | Incident response plan maintained | ops/runbooks/ | Continuous | Yes |
| A1.10 | Incident response drills conducted | Drill records | Quarterly | No |
| A1.11 | Uptime SLA communicated to customers | Terms of Service | Continuous | Yes |
| A1.12 | Status page maintained | status.remitflow.app config | Real-time | Yes |

---

## PI1: Processing Integrity

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| PI1.1 | Double-entry ledger enforces balance | TigerBeetle constraints | Per transaction | Yes |
| PI1.2 | Idempotency keys prevent duplicate processing | DB unique constraints + test results | Per transaction | Yes |
| PI1.3 | Reconciliation performed between ledger and bank | Reconciliation job logs | Daily | Yes |
| PI1.4 | Transaction integrity verified (hash chain) | Audit trail verification | Continuous | Yes |
| PI1.5 | Input validation on all API endpoints | Zod schema validation + test coverage | Per request | Yes |
| PI1.6 | FX rates sourced from multiple providers | FX aggregator logs | Per quote | Yes |
| PI1.7 | Transaction limits enforced per KYC tier | Tier enforcement test results | Per transaction | Yes |
| PI1.8 | Sanctions screening before every transaction | Screening logs | Per transaction | Yes |
| PI1.9 | Circuit breakers prevent cascading failures | Circuit breaker state metrics | Real-time | Yes |
| PI1.10 | Dead letter queue captures failed transactions | DLQ metrics | Real-time | Yes |
| PI1.11 | Saga compensation reverses failed operations | Temporal workflow history | Per failure | Yes |
| PI1.12 | Fee calculation accuracy verified | Fee unit test results | Per release | Yes |

---

## C1: Confidentiality

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| C1.1 | PII encrypted at rest (Vault Transit) | Vault audit logs | Continuous | Yes |
| C1.2 | Data classified by sensitivity | Data category register | Continuous | Yes |
| C1.3 | Access to PII logged and auditable | Access logs | Continuous | Yes |
| C1.4 | Data retention policies enforced | Retention job logs | Daily | Yes |
| C1.5 | Secure data deletion (crypto-shredding) | Deletion audit trail | Per request | Yes |
| C1.6 | API keys and secrets in Vault (not env vars) | Vault config | Continuous | Yes |
| C1.7 | Logs redacted of PII | Log config inspection | Per deploy | Yes |
| C1.8 | NDAs signed by all personnel | HR records | Per hire | No |

---

## P1: Privacy

| ID | Control | Evidence Source | Frequency | Automated |
|----|---------|----------------|-----------|-----------|
| P1.1 | Privacy policy published and current | Website privacy policy | Annual review | Yes |
| P1.2 | Consent obtained before data collection | Consent records DB | Per signup | Yes |
| P1.3 | Data subject requests processed within 30 days | DSAR tracking system | Per request | Yes |
| P1.4 | Data minimization practiced | Schema review | Per feature | No |
| P1.5 | Cross-border transfers documented (SCCs/BCRs) | Transfer impact assessments | Per new corridor | No |
| P1.6 | Data Protection Impact Assessments conducted | DPIA documents | Per high-risk processing | No |
| P1.7 | DPO appointed and accessible | Org chart + contact info | Continuous | Yes |
| P1.8 | Breach notification process defined (72h) | Incident response plan | Per breach | Yes |
