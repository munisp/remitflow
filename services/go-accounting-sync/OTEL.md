# OpenTelemetry pattern for RemitFlow Go services

`services/go-accounting-sync/otel.go` is the **reference implementation**.
Copy this pattern to every Go service (~60) so all of them emit coherent
traces and metrics. This file is the contract: follow the naming and the
fail-soft rule exactly.

## The hard rule: telemetry is fail-soft

Telemetry **never blocks a money path**:

- `OTEL_SDK_DISABLED=true` → full no-op (one WARN log at boot).
- Collector absent / endpoint unreachable → exporters retry in the
  background; requests are unaffected (BatchSpanProcessor + PeriodicReader
  are asynchronous).
- Exporter/SDK construction failure → WARN log, no-op tracer/meter,
  **never** a panic or a boot failure.
- `/health` reports `"telemetry": true|false` — honest about whether the
  SDK actually initialized. Never claim observability you don't have.

Sync/payment logic stays **fail-closed**; telemetry stays **fail-open**.
Do not mix the two.

## Per-service checklist (copy this)

1. **Copy `otel.go`** into the service (package `main`), then adjust:
   - `instrumentationName` → `"remitflow/<service-name>"`
   - `metricSyncEntities`/`metricSyncDuration` labels to the service's domain
     (see conventions below) — keep the `remitflow_` prefix.
2. **`go.mod`** — add the coherent set (all the SAME version, they
   version-lock; reference: `v1.34.0`):
   ```
   go.opentelemetry.io/otel v1.34.0
   go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.34.0
   go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.34.0
   go.opentelemetry.io/otel/metric v1.34.0
   go.opentelemetry.io/otel/sdk v1.34.0
   go.opentelemetry.io/otel/sdk/metric v1.34.0
   go.opentelemetry.io/otel/trace v1.34.0
   ```
   (`semconv/v1.26.0` ships inside the `otel` module — no extra require.)
3. **`main()`** — init early, before the server starts:
   ```go
   shutdownTelemetry, _, _ := initTelemetry(context.Background())
   defer func() {
       ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
       defer cancel()
       if err := shutdownTelemetry(ctx); err != nil {
           log.Printf("[%s] WARN telemetry shutdown failed: %v", serviceName, err)
       }
   }()
   ```
4. **Middleware** — wrap every mux route (outermost), threading the route
   pattern through for bounded-cardinality span names (`POST /sync/push`):
   ```go
   route := func(pattern string, h http.HandlerFunc) (string, http.HandlerFunc) {
       return pattern, otelMiddlewareRoute(pattern, h)
   }
   mux.HandleFunc(route("POST /x", handler))
   ```
   (`http.Request.Pattern` is Go 1.23+; on go 1.22 the pattern is passed
   explicitly. The bare `otelMiddleware(h)` variant falls back to the
   method only.)
5. **Business spans** — child spans for the work that matters
   (`sync.entity`, `odoo.rpc`, …) with low-cardinality attributes.
   **Never** put payloads, tokens, API keys, or RPC args on spans.
6. **Health** — add `"telemetry": telemetryEnabled.Load()` to `/health`.

## Environment variables (identical across all services)

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_SDK_DISABLED` | unset | `true` → full no-op |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP base URL (scheme required; `http` ⇒ insecure transport, handled via `WithEndpointURL`) |
| `OTEL_SERVICE_NAME` | service name | `service.name` resource attribute |
| `OTEL_ENVIRONMENT` | `unknown` | `deployment.environment` resource attribute |
| `OTEL_RESOURCE_ATTRIBUTES` | — | standard extra resource attrs (merged via `resource.WithFromEnv()`) |

Propagator: **W3C TraceContext + Baggage** (set globally in `initTelemetry`).
Incoming trace context is extracted (spans parent to the TS core); nothing is
injected into upstream provider calls.

## `tenant.id` convention

The TS core sets the **`X-Tenant-Id`** header on tenant-scoped internal
calls. The middleware maps it to the span attribute **`tenant.id`**
(exactly that casing). Rules:

- Only from the header, never from request bodies or JWTs (the middleware is
  outermost and sees the raw header).
- Only when non-empty — absence is normal for browser-facing OAuth routes.
- It is an attribute, **not** a metric label (cardinality).

## Metric naming conventions (all Go services)

Pattern: `remitflow_<domain>_<noun>[_<unit>]`, snake_case, OTel unit set via
`metric.WithUnit`. Labels are lowercase snake_case and **low cardinality**.

Reference series (go-accounting-sync):

| Name | Instrument | Labels | Unit |
|---|---|---|---|
| `remitflow_sync_entities_total` | Int64Counter | `provider`, `direction` (`push`/`pull`), `status` (`success`/`failed`) | `{entity}` |
| `remitflow_sync_duration_ms` | Float64Histogram | `provider`, `direction` | `ms` |
| `remitflow_odoo_rpc_inflight` | Int64UpDownCounter | — | `{call}` |

Rules:

- Counters end in `_total`; histograms carry their unit suffix.
- `status` is always the bounded pair `success`/`failed`.
- No tenant/connection/entity IDs in labels — those are span attributes.

## CI: `go mod tidy` verification (go.sum)

This change adds the first third-party dependencies to a previously
stdlib-only module. `go.sum` and the indirect `require` block were generated
by `go mod tidy` with **go1.22.12** — never hand-edit hashes. CI must
re-verify that the committed files are exactly what the toolchain produces:

```yaml
# CI step (Go 1.22+) — run before build/test:
- name: Verify Go modules (W11 OTel deps)
  working-directory: services/go-accounting-sync
  run: |
    go mod tidy
    git diff --exit-code -- go.mod go.sum   # fails if deps drift
    go build ./...
    go test ./...
```

The Dockerfile prefers `go mod download` against the committed `go.sum` and
falls back to `go mod tidy` at image-build time only as a bootstrap for
branches where `go.sum` is absent.

## Verification without a collector

`OTEL_SDK_DISABLED=true` + the existing test suite must pass identically —
see `TestOtelMiddlewareDoesNotBlockRequests` and `TestHealthReportsTelemetry`
in `main_test.go`. Telemetry absence must change nothing but one WARN log
line and `"telemetry": false` in `/health`.
