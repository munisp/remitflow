# Wave 11 — Platform-wide OpenTelemetry + Open-Source Alerting

**Branch:** `audit-fixes` (HEAD `ec8ffcf`). **Decisions (user: no preference → recommended defaults):** Grafana LGTM stack (Tempo + Prometheus + Loki + Grafana), Alertmanager for alert routing, attribute-based per-tenant observability (`tenant.id` on all signals + per-tenant alert routing capability).

**Standing constraints:** no new npm deps TS-side (OTel SDK already present — satisfied); existing drizzle tables READ-ONLY; fail closed for money paths (observability itself must NEVER block a money path — no-op + WARN on telemetry failure is the honest posture); never fake telemetry (uninstrumented paths say so); Go/Rust compile deferred to CI (residual R1); worktree isolation per coder, disjoint scopes.

## Current state (surveyed)
- TS core: full @opentelemetry SDK + `server/telemetry/otel.ts`, `slo.ts` exist. NO tenant.id enrichment. Temporal TS interceptors pkg absent → hand-rolled via @opentelemetry/api.
- Go/Rust/Python services: zero OTel. python-geo-analytics is stdlib-only (guarded-optional pattern established).
- No collector/Tempo/Prometheus/Loki/Grafana/Alertmanager anywhere in deploy/ or compose.
- APISIX has a stock `opentelemetry` plugin; Dapr has native tracing config; Keycloak (Quarkus) has OTel/metrics flags; OpenSearch has a prometheus-exporter plugin; Temporal Go SDK metrics; Mojaloop `/metrics`.

## Stage 1 — parallel coders (worktrees, disjoint scopes)

### C1 — Infra/observability stack (worktree `w11-infra`)
Scope: `deploy/observability/**` (new), `docker-compose.observability.yml` (new), `deploy/apisix/**`, `deploy/dapr/**`, `docker-compose.middleware.yml`, `docker-compose.wave10.yml`.
- OTel Collector config: receivers otlp(grpc/http), postgresql, redis, kafkametrics, prometheus scrape (apisix, keycloak, permify, temporal, mojaloop, tigerbeetle, opensearch, open-appsec); processors batch + memory_limiter; exporters otlp→Tempo, prometheusremotewrite→Prometheus, loki. All endpoints env-driven, fail-closed honest docs.
- Compose: otel-collector, tempo, prometheus, loki, grafana (provisioned datasources + dashboards), alertmanager.
- `alertmanager.yml`: default webhook receiver + per-tenant route example matching `tenant_id` label; inhibit/group rules.
- `alerts.yml` (Prometheus rules): money-path alerts — sweeper stall, railUncertain parks, TB post-commit failure, Stripe refund failure, payout stuck executing, SLO burn-rate; middleware down alerts (kafka/postgres/redis/temporal collector targets absent).
- Grafana dashboards: platform overview + per-tenant dashboard (tenant.id template variable).
- APISIX: enable `opentelemetry` plugin (stock 3.9 only) + prometheus plugin.
- Dapr: `configuration.yaml` tracing → otel exporter.
- Keycloak: metrics/OTel env flags in compose. OpenSearch: prometheus-exporter plugin note.

### C2 — TS core (worktree `w11-ts`)
Scope: `server/telemetry/**`, `server/_core/trpc.ts`, `server/temporal/**`, `server/middleware/kafka.ts`, `server/_core/index.ts` (boot wiring only).
- Tenant enrichment: tRPC middleware setting `tenant.id` (from resolveTenantContext) + `enduser.id` on the ACTIVE span + meter attrs. Never throws — telemetry failure = no-op + warn.
- Kafka publish: inject W3C traceparent into event headers; consumers extract.
- Temporal: hand-rolled worker/client interceptors using existing @opentelemetry/api (no new deps) — workflow/activity spans, trace context through workflow headers.
- Boot: verify otel.ts imported before everything; document OTEL_* envs; NO new npm deps.
- Validate: esbuild syntax + bundle per file.

### C3 — Go reference instrumentation (worktree `w11-go`)
Scope: `services/go-accounting-sync/**` only.
- `otel.go`: OTLP/HTTP trace+metric exporters via go.opentelemetry.io/otel SDK (go.mod additions fine); net/http handler middleware; span attrs `tenant.id` from X-Tenant-Id header; provider/entity spans on sync push/pull; /metrics passthrough honest; telemetry init failure = WARN + no-op (never block sync).
- `OTEL.md`: copyable pattern for the other ~60 Go services.
- go.mod/go.sum additions documented; compile = CI (residual R1).

### C4 — Python (worktree `w11-py`)
Scope: `services/_shared/otel_helper.py` (new), `services/python-geo-analytics/**`, `services/python-bill-capture/**`.
- `otel_helper.py`: guarded opentelemetry-sdk import (repo's guarded-optional pattern — service boots + WARNs without it); OTLP/HTTP exporters; WSGI/ASGI + manual span helpers; `tenant.id` from header.
- Instrument geo-analytics (:8114) and bill-capture: request spans, handler spans, tenant attr. requirements.txt additions (opentelemetry-sdk, exporter-otlp-proto-http or http-json).
- Validate: python3 -m py_compile + import smoke (without otel installed → guard path).

### C5 — Rust reference instrumentation (worktree `w11-rust`)
Scope: `services/rust-tigerbeetle-bridge/**` only.
- tracing + tracing-opentelemetry + opentelemetry-otlp (Cargo.toml additions); subscriber init in main; spans around TB transfer create/lookup with `tenant.id`; graceful no-op on collector absence.
- `OTEL.md`: pattern for other Rust services. Compile = CI (residual R1).

## Stage 2 — merge (orchestrator, fixed order)
infra → ts → go → py → rust. Validate: esbuild TS files, py_compile, yaml parse all configs, promql rule syntax review.

## Stage 3 — verification (V2-style integration reality verifier)
Attack: configs actually valid (collector receivers exist in contrib distro, APISIX plugin names stock, Dapr config schema, Keycloak flags real), no fake telemetry presented as real, tenant.id propagation end-to-end coherent, alert rules reference metrics that actually exist, no money-path blocking introduced, no new npm deps.

## Stage 4 — report + deliver
Update build report with Wave 11 section; final summary with residual list (per-service rollout beyond reference services, Fluvio app-layer-only coverage, CI compile).
