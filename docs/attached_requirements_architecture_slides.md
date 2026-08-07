## Cover

**RemitFlow Resilience & Zero-Trust Architecture**

Implementation of the attached requirements, adapted for regulated payments and compliance operations

## Slide 1

### Insurance Requirements Were Reframed for Payments

- RemitFlow’s high-risk assets are payment mutations, ledger entries, regulatory filings, tenant boundaries, and agent operations—not policies or claims.
- The implementation converts each applicable requirement into a financial control and explicitly excludes insurance-only logic.
- The outcome is a cohesive platform hardening program rather than a copied domain model.

## Slide 2

### A Verified Principal Anchors Every Sensitive Path

- Keycloak-backed authentication attaches a trusted request principal before rate limits, idempotency, and tenant-sensitive middleware execute.
- Caller-controlled `X-User-ID` input no longer defines a rate-limit or idempotency scope.
- PostgreSQL row-level security supplies a database control beneath application authorization.

## Slide 3

### Financial Mutations Survive Redis and Process Loss

- Durable idempotency now reserves requests by verified tenant, user, operation, key, and request hash.
- PostgreSQL processing leases, replay state, and response binding prevent duplicate payment execution after cache or process failure.
- Redis remains a performance component, not the authority for financial replay correctness.

## Slide 4

### Regulatory Filing Becomes a Durable Workflow

- CTR and SAR submission now enters a tenant-scoped PostgreSQL queue before provider delivery.
- Atomic claims, retry backoff, dead-letter transitions, immutable audit events, and administrator-only requeue provide a complete recovery lifecycle.
- Prometheus tracks queue depth and outcomes; alerts identify dead letters, backlogs, and stalled workers.

## Slide 5

### Gateway and eBPF Layers Enforce Zero Trust

- APISIX rejects malformed or unsigned bearer tokens before external authorization calls and requires tenant-claim binding on protected routes.
- Cilium enforces workload identity policies with Hubble visibility and WireGuard node encryption.
- Strict default-deny remains staged behind an observation gate to avoid unmodeled-service outages.

## Slide 6

### Trace Context Connects Edge, Service, and Policy Evidence

- Validated W3C trace context travels from API ingress through service logs, metrics, and background work.
- APISIX request IDs, OpenTelemetry-compatible context, and Cilium/Hubble flow telemetry can be correlated during an investigation.
- Prometheus alerts cover transfer SLOs, regulatory filing health, Cilium policy drops, and immutable backup failures.

## Slide 7

### Recovery Is Immutable, Cross-Region, and Testable

- Terraform provisions encrypted, versioned, Object-Lock-protected backup storage with replication.
- A non-overlapping backup CronJob writes checksum manifests and verifies replication.
- Restore drills refuse non-isolated targets and require explicit operator confirmation before touching a database.

## Slide 8

### Operations Maps Expose Approved Data—Not Customer Telemetry

- MapLibre renders tenant-scoped agent, corridor, partner, and approved fraud-response locations through an administrator-only tRPC API.
- GeoLibre-compatible styles are configured explicitly; there is no public tile fallback or embedded coordinate fixture.
- CesiumJS is deferred because the active operational decision surface is 2D corridor and agent management, not 3D asset visualization.

## Slide 9

### Validation Is Strong Locally and Gated Live

- Production build and full TypeScript validation passed; the focused hardening suite passed 6 of 6 controls.
- Static checks validate migrations, Cilium/APISIX controls, backup scripts, chaos manifests, and geospatial wiring.
- Staging-only scripts require explicit approval, scoped tenant credentials, sandbox regulatory delivery, and canary/chaos labels before load or fault injection.

## Slide 10

### Production Promotion Requires Evidence, Not Assumption

- Complete staged migration and backup verification.
- Prove tenant isolation, sandbox regulatory retries, Cilium observation results, and an isolated restore drill.
- Resolve or formally accept remaining upstream dependency advisories before production release.
