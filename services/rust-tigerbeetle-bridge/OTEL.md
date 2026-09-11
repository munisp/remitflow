# OpenTelemetry pattern for RemitFlow Rust services

This service (`rust-tigerbeetle-bridge`) is the reference implementation. Copy
the pattern below into the other ~25 Rust services so every service emits
coherent traces that join the TypeScript API layer's traces end-to-end
(payout disputes must be debuggable from HTTP edge to ledger round-trip).

## Checklist (per service)

1. **Copy `src/telemetry.rs`** and adjust only the default service name
   (`rust-tigerbeetle-bridge` → your service name) and the crate-name
   directive in the fallback `EnvFilter`.
2. **`Cargo.toml`** — add, keeping versions in lockstep with this service:

   ```toml
   opentelemetry = { version = "0.27.1", default-features = false, features = ["trace"] }
   opentelemetry_sdk = { version = "0.27.1", default-features = false, features = ["trace", "rt-tokio"] }
   opentelemetry-otlp = { version = "0.27.0", default-features = false, features = ["trace", "http-proto", "reqwest-client"] }
   tracing-opentelemetry = "0.28.0"
   reqwest = { version = "0.12", default-features = false, features = ["default-tls"] }
   ```

   If the service already depends on `reqwest` or `tracing`/`tracing-subscriber`,
   reuse the existing entries — Cargo unifies features. If a service already
   uses tonic, you may swap `http-proto, reqwest-client` for `grpc-tonic` and
   `.with_http()` for `.with_tonic()`, dropping the reqwest dep.
3. **`main.rs`** — call `let otel_guard = telemetry::init();` **before**
   building the router/server, install the per-request middleware
   (`middleware::from_fn(otel_request_span)`), and call
   `otel_guard.shutdown()` after `axum::serve(...)` returns (graceful
   shutdown on SIGINT/SIGTERM so the tail of the trace is flushed).
4. **Request span** — copy `otel_request_span` + `HeaderExtractor`. It
   extracts `traceparent`/`tracestate` (W3C) so spans parent onto the
   incoming trace, sets `otel.kind = "server"`, `http.request.method`,
   `url.path`, `http.response.status_code`, and `tenant.id`.
5. **Health** — surface `telemetry::telemetry_enabled()` as a `"telemetry"`
   boolean in `/health`. It must be honest: `false` when the SDK is disabled
   or the exporter failed to initialize.
6. **Fail-soft test** — copy the
   `telemetry_init_fail_soft_when_sdk_disabled` test.

## Environment variables (all services, same names)

| Variable | Default | Meaning |
| --- | --- | --- |
| `OTEL_SDK_DISABLED` | unset | `"true"`/`"1"` → no spans, logs only |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP base endpoint (`/v1/traces` appended; `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` overrides per-signal) |
| `OTEL_SERVICE_NAME` | service name | `service.name` resource attribute |
| `OTEL_ENVIRONMENT` | `development` | `deployment.environment` resource attribute |
| `RUST_LOG` | `info,<crate>=info` | tracing filter (unchanged) |

## Fail-soft rule (non-negotiable)

**Telemetry never blocks money paths.** `telemetry::init()` never panics and
never waits for a collector: exporter construction failure → one WARN, run
with logs only; batch export retries in the background and drops spans under
overload rather than slowing requests. `/health` stays honest via
`telemetry_enabled()`.

## Conventions

- **tenant.id**: HTTP header `X-Tenant-Id` → span attribute `tenant.id` on the
  server span. Every service does this so a payout trace can be filtered by
  tenant across the whole fleet.
- **Span names**: `<system>.<noun>.<verb>` —
  - `tb.transfer.create` / `tb.account.lookup` / `tb.account.create`
    (TigerBeetle ledger round-trips)
  - `kafka.<topic>.consume` / `kafka.<topic>.produce` for Kafka consumers/producers
  - `fluvio.<topic>.consume` / `fluvio.<topic>.produce` for Fluvio
  - `http.request` for the server span (with `otel.name = "<METHOD> <route>"`)
- **Span kinds**: `server` for inbound HTTP, `client` for outbound calls
  (ledger, DB, HTTP), `producer`/`consumer` for Kafka/Fluvio. Set via the
  `otel.kind` field at span creation.
- **Attributes**: low cardinality only — counts, booleans, enums
  (`tb.transfer.kind` = `pending|post|void|standard|mixed`,
  `tb.transfer.id_deterministic`, `tb.transfer.error_count`,
  `tb.lookup.requested/found`). Follow each service's existing log discipline:
  **never attach raw account/transfer ids or amounts unless the service
  already logs them at the same sensitivity** (this bridge does not, so it
  does not).
- **Status**: declare `otel.status_code = tracing::field::Empty` at span
  creation, then `span.record("otel.status_code", "error" | "ok")` on the
  outcome path. Per-index ledger rejections (e.g. `exceeds_debits`) mark the
  span `error` so dispute triage can query `status = ERROR`.
- **Errors**: keep the existing `error!(error = %e, ...)` logs inside the
  span scope — the tracing-opentelemetry bridge turns them into exception
  events on the span.

## Build / CI note (residual R1)

No Rust toolchain is available in the authoring environment — `cargo build`,
`cargo generate-lockfile`, and `cargo test` run in CI (the Dockerfile already
generates the lockfile in-image). The crate versions above were pinned from
the published 0.27/0.28 sources and are mutually coherent
(`tracing-opentelemetry 0.28` requires `opentelemetry ^0.27`;
`opentelemetry-http 0.27` implements `HttpClient` for `reqwest ^0.12`), but
the first CI build is the real compile check. If CI surfaces API drift,
bump the whole family together — never mix `opentelemetry` minor versions.
