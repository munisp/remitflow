# Attached Requirement Adaptation Matrix

The attached content was written for an insurance platform. This document adapts its controls to **RemitFlow’s multi-tenant remittance, payment, ledger, AML, and compliance architecture**. It deliberately replaces insurance-only concepts, including parametric insurance and NAICOM loss-ratio reporting, with equivalent remittance operational controls.

> **Evidence rule.** A repository or controlled-environment test may validate implementation and failure handling. It cannot truthfully claim live WAF penetration, 100,000-request production load, multi-region failover, or provider recovery evidence unless run against an authorized Kubernetes environment with the required secrets, monitoring stack, and target services. The implementation therefore provides executable, controlled test assets and reports live-cluster prerequisites separately.

| Attached items | RemitFlow adaptation | Deliverable and acceptance evidence |
|---|---|---|
| 2, 10, 17 | OpenAppSec/APISIX defensive verification, strict JWT parsing, Keycloak and Permify authorization checks. | Gateway security test suite, hardened JWT validation, and route-policy inventory. |
| 3, 4, 6 | Tenant A/B financial-resource isolation and full route authorization. | Tenant-scoped permission model, authorization cache isolation, APISIX route inventory, and integration test requiring Tenant B denial. |
| 5, 7 | Redis outage without transaction loss. | PostgreSQL-backed idempotency reservation/replay lifecycle, transaction-scoped fallback, migration, and failure-mode test. |
| 8, 9, 12, 15, 19, 31, 33–38 | Workflow, ledger, Temporal, Redis, TigerBeetle, Fluvio, Postgres, and network-partition resilience. | Controlled chaos scenarios, workflow/ledger reconciliation tests, health probes, metrics, and explicit live-cluster execution gates. |
| 11, 20–22 | Kubernetes production deployment, zero-trust controls, observability, rollback, and capacity exercises. | Cilium policy chart, Kubernetes workload security posture, Prometheus/Grafana observability assets, GitOps rollback validation, and k6 plans. |
| 13 | Replace parametric insurance with a **cross-border transfer settlement saga**. | Saga compensation test that proves a rejected settlement does not create a final ledger transfer. |
| 14, 41 | Production architecture presentation and incident report. | Slide deck plus a PDF incident report based only on measured or clearly designated simulation evidence. |
| 16, 18 | PCI DSS, SOC 2, GDPR, NDPR, and remittance record handling. | Compliance control matrix and endpoint/data-retention test coverage. |
| 23, 25–30, 32, 34–35 | Replace insurance NFIU/NAICOM concepts with NFIU/CBN-aligned AML SAR, CTR, travel-rule, and remittance regulatory reporting. | Durable SAR submission queue, retry/backoff, DLQ, officer requeue API, forensic audit log, alert rules, and reporting endpoint. |
| 39, 42, 44 | Node.js runtime GC/memory analysis and CI guardrails. | Runtime flag policy, CI `NODE_OPTIONS` patch, metrics test, and non-fabricated report template. |
| 40, 45–50 | Multi-region quorum, split-brain, fencing, lease renewals, and regional network impairment. | Quorum-fence implementation and unit tests; controlled chaos manifests for an authorized multi-region environment. |
| 51 | MapLibre, GeoLibre, and Cesium integration. | Dependency and route audit, geospatial security/data-minimisation review, and a RemitFlow corridor/agent-map integration assessment. |

## Adapted execution model

| Test tier | Scope | Permitted execution here | Required for final live evidence |
|---|---|---|---|
| Static and contract validation | Schema, router, policy, manifest, and test-contract checks. | Yes. | Repository checkout and declared package tools. |
| Controlled component tests | Local deterministic tests that do not contact a live payment, identity, or regulatory provider. | Yes. | Test credentials only where real service integration is required. |
| Kubernetes integration | Cilium, OpenAppSec, APISIX, Keycloak, Permify, Temporal, Fluvio, TigerBeetle, Postgres, Redis, lakehouse, Prometheus, Grafana. | Not in this sandbox; no Kubernetes/Docker runtime is attached. | Authorized cluster, secrets, target namespaces, observability credentials, and a maintenance window. |
| High-volume and chaos tests | 5,000–100,000 workflow/request runs, node failures, partitions, DR failover, and rollback. | Test plans and safety interlocks only. | Isolated non-production environment, approved load budget, real dashboards, and stop conditions. |

## RemitFlow-specific safety boundaries

Financial transfers, TigerBeetle settlements, SAR submissions, Keycloak revocations, and provider integrations must **fail closed** when their durable dependency is unavailable. A resilience test may demonstrate a safe rejection or a durable queue state; it must not produce a simulated success response, write a fabricated ledger result, or emit a false regulatory filing reference.

All cross-tenant checks must derive tenant identity from authenticated identity and database membership. Callers must not choose effective tenant scope through a header, body field, object identifier prefix, or cache key omission.

The implementation also keeps a strict distinction between a **policy render** and **policy enforcement**. Cilium default-deny policy remains opt-in until Hubble evidence confirms the declared dependency graph for each labeled workload.
