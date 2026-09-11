# RemitFlow — TypeScript Core Telemetry (W11-C2)

Per-tenant OpenTelemetry enrichment and trace-context propagation for the
Node.js API server, Kafka event bus, and Temporal workers. **No new npm
dependencies** — everything is built on the already-present
`@opentelemetry/*` and `@temporalio/*@1.16` packages. The Temporal
interceptors are hand-rolled on `@opentelemetry/api` because
`@temporalio/interceptors-opentelemetry` is not an allowed dependency.

## Fail-soft posture (hard rule)

Telemetry NEVER blocks a money path.

- Every helper in `tenantContext.ts`, every interceptor in
  `temporal/interceptors.ts`, and the Kafka propagation wrappers in
  `middleware/kafka.ts` are wrapped: an OTel failure is **debug-logged and
  becomes a no-op**.
- Interceptor fail-soft catches ONLY telemetry-setup errors. Errors from the
  actual Temporal call (`next(...)`) always propagate to the caller unchanged
  — a workflow start can never be silently retried or double-invoked by the
  interceptor.
- Absence of telemetry is logged, never faked: no active span → nothing is
  stamped; no tenant → the `tenant.id` attribute is **omitted** (no
  `"unknown"` buckets); missing traceparent header → the consumer/activity
  starts an honest root span instead of pretending continuity.

## What is instrumented vs. not

| Path | Status |
|---|---|
| tRPC `publicProcedure` / `protectedProcedure` / `adminProcedure` | Span attributes `tenant.id` + `enduser.id`; metrics `remitflow_requests_total`, `remitflow_request_duration_ms` (tenant-tagged) |
| tRPC `auditedProcedure` / `auditedAdminProcedure` / `rateLimitedProcedure` / `strictRateLimitedProcedure` | **Not enriched in this pass** (they bypass `protectedProcedure`/`adminProcedure` chains; they also pre-date `tracingMiddleware`) |
| Kafka `publishEvent` (producer) | Injects W3C `traceparent`/`tracestate` + `x-tenant-id` headers from the active context / request tenant ALS |
| Kafka `subscribeWithHandler` (consumer) | Extracts the context and runs each message in a `kafka.consume/<topic>` CONSUMER span (covers `services/searchIndexer.ts`, which uses this helper) |
| Kafka consumers that bypass `subscribeWithHandler` (`middleware/kafkaConsumer.ts`, `middleware/middlewareIntegration.ts`, `_core/stablecoinHardening.ts`) | **Not instrumented** (outside W11-C2 scope) — they start no consumer span; traces break at that hop |
| Temporal activities (all 3 workers: `remitflow-main`, `ap-approvals`, `ar-aging`) | `temporal.activity/<type>` SERVER span per execution; attributes `temporal.workflow_id`, `temporal.run_id`, `temporal.task_queue`, `temporal.workflow_type`, `temporal.activity_type`, `tenant.id` when forwarded in headers |
| Temporal workflow start / signal (`temporal/client.ts`, `temporal/temporalClient.ts`) | `temporal.workflow.start/<type>` / `temporal.workflow.signal/<name>` CLIENT spans; injects `traceparent`/`tracestate`/`x-tenant-id` into workflow headers |
| Temporal clients outside scope (`_core/temporal.ts`, `middleware/tier-events.ts`, schedule registration in `temporal/arAgingWorkflow.ts`) | **Not instrumented** (outside W11-C2 scope) |
| Express HTTP layer (`otelRequestMiddleware` in `otel.ts`) | Exists but is **not registered** in `_core/index.ts` — out of this mission's boot-wiring scope |
| Workflow sandbox internals | **Not instrumented by design** — workflow files may only import `@temporalio/workflow` at top level; interceptors run worker/client side only |

### Known propagation gap (honest note)

Temporal does not automatically copy *workflow* headers into *activity*
headers. The client interceptor injects `traceparent`/`x-tenant-id` into
workflow start headers; the activity inbound interceptor reads *activity*
headers. End-to-end continuity workflow→activity therefore requires workflow
code to forward headers via `ActivityOptions.headers` (readable inside the
sandbox via `workflow.info().headers`). Current workflow definitions do not
forward them, so activity spans currently start a fresh (root) trace unless
the caller passes headers explicitly. The codec and extraction side are
ready; closing the gap is a follow-up in the workflow files (sandbox-safe:
uses only `@temporalio/workflow`).

## How tenant.id flows

```
tRPC request
  └─ tenantGucMiddleware resolves tenant once → AsyncLocalStorage (tenantGuc.ts)
       └─ tenantEnrichmentMiddleware (trpc.ts)
            ├─ reads tenant from ALS (free) or per-request ctx cache
            ├─ span attrs: tenant.id, enduser.id
            └─ metrics: remitflow_requests_total / remitflow_request_duration_ms
       └─ publishEvent (kafka.ts) ──► headers: traceparent, tracestate, x-tenant-id
            └─ subscribeWithHandler consumer span (attrs incl. tenant.id)
       └─ Temporal client interceptor ──► workflow headers: traceparent, tracestate, x-tenant-id
            └─ (see propagation gap above for the activity hop)
```

## Per-request tenant cache design

`tenantEnrichmentMiddleware` resolves the tenant **at most once per request**:

1. On protected/admin chains it runs *after* `tenantGucMiddleware`, so the
   tenant id is read **for free** from the request AsyncLocalStorage
   (`getRequestTenantContext()`) — zero lookups.
2. Otherwise (chains without the GUC middleware) the resolved
   `TenantContext` is cached on the request-scoped tRPC `ctx` object under
   `__otelTenantContext`, so repeat access in the same request never
   re-resolves.
3. `resolveTenantContext` itself is backed by a 60s TTL bounded LRU
   (5k entries) in `tenantMiddleware.ts`, so even a cold ctx costs at most
   one cache hit, effectively never a second DB query.
4. Fail-soft: a resolution error yields `tenantId = null` and the request
   proceeds — enrichment never aborts. (Note: `tenantGucMiddleware` itself
   still fails closed for RLS — that auth/RLS semantic is unchanged.)

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP collector base URL (`/v1/traces`, `/v1/metrics` appended) |
| `OTEL_SERVICE_NAME` | `remitflow-api` | service.name resource attribute |
| `OTEL_SERVICE_VERSION` | `1.0.0` | service.version resource attribute |
| `NODE_ENV` | — | `production` → parentbased ratio sampler 0.1; otherwise 1.0 |

Boot wiring: `_core/index.ts` imports `../telemetry/otel` **first** (right
after `dotenv/config`) and calls `initTelemetry()` as the first statement of
`startServer()`. The module logs endpoint + sample rate on init.

## Files

- `server/telemetry/otel.ts` — NodeSDK bootstrap (pre-existing)
- `server/telemetry/slo.ts` — SLO/error-budget tracker (pre-existing)
- `server/telemetry/tenantContext.ts` — span-attribute + per-tenant metric helpers (W11-C2)
- `server/_core/trpc.ts` — `tenantEnrichmentMiddleware` on public/protected/admin chains (W11-C2)
- `server/middleware/kafka.ts` — traceparent/tracestate/x-tenant-id inject on publish, extract + consumer span on subscribe (W11-C2)
- `server/temporal/interceptors.ts` — hand-rolled worker/client OTel interceptors (W11-C2; **never import from workflow files**)
- `server/temporal/worker.ts`, `server/temporal/client.ts`, `server/temporal/temporalClient.ts` — interceptor wiring (W11-C2)
