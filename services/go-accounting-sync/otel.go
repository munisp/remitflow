// RemitFlow — Accounting Sync Service (Go) — OpenTelemetry instrumentation
// ═══════════════════════════════════════════════════════════════════════════
// HARD RULE (fail-soft): telemetry NEVER blocks a money path. If the SDK is
// disabled (OTEL_SDK_DISABLED=true), the collector is absent, or exporter
// construction fails, this service logs one WARN and runs with no-op
// tracer/meter/instruments — sync logic is completely unaffected. Nothing
// here may panic, fatal, or alter a response.
//
// The pattern in this file is the reference for all RemitFlow Go services;
// see OTEL.md for the copyable checklist and conventions.

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	metricnoop "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	// instrumentationName is the tracer/meter scope name.
	instrumentationName = "remitflow/go-accounting-sync"

	// defaultOTLPEndpoint is the local-collector default (OTLP/HTTP). The
	// http scheme is intentional for in-cluster collectors; WithEndpointURL
	// derives the (in)secure transport from the URL scheme.
	defaultOTLPEndpoint = "http://localhost:4318"

	// tenantHeader is set by the TS core when the request is tenant-scoped.
	// It becomes the low-risk `tenant.id` span attribute — never a token,
	// never a payload field.
	tenantHeader = "X-Tenant-Id"

	// Metric names — the RemitFlow convention for ALL Go services (OTEL.md):
	// remitflow_<domain>_<noun>_<unit>. Keep label cardinality bounded.
	metricSyncEntities = "remitflow_sync_entities_total" // labels: provider, direction, status
	metricSyncDuration = "remitflow_sync_duration_ms"    // labels: provider, direction
	metricOdooInflight = "remitflow_odoo_rpc_inflight"   // no labels
)

// telemetryEnabled reports whether the OTel SDK actually initialized with
// real exporters. /health surfaces it honestly — never claim telemetry when
// running no-op.
var telemetryEnabled atomic.Bool

// svcTracer / svcMeter default to the global NO-OP provider so every call
// site (including tests that never call initTelemetry) is safe. initTelemetry
// replaces them with real instruments only on success.
var (
	svcTracer trace.Tracer = otel.Tracer(instrumentationName)
	svcMeter  metric.Meter = otel.Meter(instrumentationName)
)

// syncInstruments bundles the service-level metric instruments.
type syncInstruments struct {
	entities        metric.Int64Counter
	durationMs      metric.Float64Histogram
	odooRPCInflight metric.Int64UpDownCounter
}

var (
	instrumentsOnce sync.Once
	instruments     *syncInstruments
)

// otelInstruments lazily builds the instruments exactly once from the current
// svcMeter (real after a successful initTelemetry, no-op otherwise). Any
// instrument-construction failure falls back to a fully no-op set — recording
// a metric must never be able to break a request.
func otelInstruments() *syncInstruments {
	instrumentsOnce.Do(func() {
		instruments = newInstruments(svcMeter)
	})
	return instruments
}

func newInstruments(m metric.Meter) *syncInstruments {
	entities, err1 := m.Int64Counter(metricSyncEntities,
		metric.WithDescription("Entities processed by accounting sync, by provider/direction/status"),
		metric.WithUnit("{entity}"))
	duration, err2 := m.Float64Histogram(metricSyncDuration,
		metric.WithDescription("Per-entity accounting sync processing duration"),
		metric.WithUnit("ms"))
	inflight, err3 := m.Int64UpDownCounter(metricOdooInflight,
		metric.WithDescription("Odoo JSON-RPC calls currently in flight"),
		metric.WithUnit("{call}"))
	if err1 != nil || err2 != nil || err3 != nil {
		log.Printf("[%s] WARN telemetry instrument creation failed (entities=%v duration=%v inflight=%v) — using no-op instruments", serviceName, err1, err2, err3)
		nm := metricnoop.NewMeterProvider().Meter(instrumentationName)
		// No-op instrument construction cannot fail; errors are ignored here
		// deliberately so this path never degrades further.
		entities, _ = nm.Int64Counter(metricSyncEntities)
		duration, _ = nm.Float64Histogram(metricSyncDuration)
		inflight, _ = nm.Int64UpDownCounter(metricOdooInflight)
	}
	return &syncInstruments{entities: entities, durationMs: duration, odooRPCInflight: inflight}
}

// recordSyncEntity records one processed entity: the counter with the
// terminal status and the duration histogram. Called exactly once per entity.
func recordSyncEntity(ctx context.Context, provider, direction, status string, start time.Time) {
	inst := otelInstruments()
	inst.entities.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("direction", direction),
		attribute.String("status", status),
	))
	inst.durationMs.Record(ctx, float64(time.Since(start).Milliseconds()), metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("direction", direction),
	))
}

// initTelemetry sets up OTLP/HTTP trace+metric exporters, the global
// providers, and the TraceContext+Baggage propagator. It is FAIL-SOFT: any
// problem produces a WARN log and a no-op configuration — never a panic,
// never a boot failure.
func initTelemetry(ctx context.Context) (shutdown func(context.Context) error, tracer trace.Tracer, meter metric.Meter) {
	noopShutdown := func(context.Context) error { return nil }
	// failSoft returns the current (no-op) global tracer/meter and leaves the
	// process-wide defaults untouched.
	failSoft := func(reason string) (func(context.Context) error, trace.Tracer, metric.Meter) {
		log.Printf("[%s] WARN telemetry disabled: %s — continuing with no-op tracer/meter (sync unaffected)", serviceName, reason)
		return noopShutdown, svcTracer, svcMeter
	}

	if strings.EqualFold(strings.TrimSpace(os.Getenv("OTEL_SDK_DISABLED")), "true") {
		return failSoft("OTEL_SDK_DISABLED=true")
	}

	endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	if endpoint == "" {
		endpoint = defaultOTLPEndpoint
	}
	svcName := strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME"))
	if svcName == "" {
		svcName = serviceName
	}
	env := strings.TrimSpace(os.Getenv("OTEL_ENVIRONMENT"))
	if env == "" {
		env = "unknown"
	}

	res, err := resource.New(ctx,
		resource.WithFromEnv(), // OTEL_RESOURCE_ATTRIBUTES overrides/extends
		resource.WithAttributes(
			semconv.ServiceName(svcName),
			semconv.ServiceVersion(version),
			semconv.DeploymentEnvironment(env),
		),
	)
	if err != nil {
		return failSoft("resource build failed: " + err.Error())
	}

	// WithEndpointURL handles the http scheme correctly (insecure transport
	// derived from the URL) — do NOT combine WithEndpoint+WithInsecure here.
	// Exporter construction is lazy (no network I/O), so an absent collector
	// only surfaces as background export errors, never request failures.
	traceExp, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint))
	if err != nil {
		return failSoft("trace exporter init failed: " + err.Error())
	}
	metricExp, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithEndpointURL(endpoint))
	if err != nil {
		// Best-effort cleanup of the trace exporter; its error is only logged.
		if serr := traceExp.Shutdown(ctx); serr != nil {
			log.Printf("[%s] WARN telemetry trace exporter cleanup failed: %v", serviceName, serr)
		}
		return failSoft("metric exporter init failed: " + err.Error())
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExp), // BatchSpanProcessor with sane defaults
	)
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
	)

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	svcTracer = tp.Tracer(instrumentationName)
	svcMeter = mp.Meter(instrumentationName)
	telemetryEnabled.Store(true)

	log.Printf("[%s] telemetry initialized: OTLP/HTTP endpoint=%s service=%s env=%s", serviceName, endpoint, svcName, env)

	shutdown = func(ctx context.Context) error {
		// Flush + stop both providers; surface the first error but always
		// attempt both shutdowns.
		var firstErr error
		if err := tp.Shutdown(ctx); err != nil {
			firstErr = err
		}
		if err := mp.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
		return firstErr
	}
	return shutdown, svcTracer, svcMeter
}

// statusRecorder captures the response status code for the span. Handlers
// that never call WriteHeader get the implicit 200.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// otelMiddleware starts a server span per request. Prefer
// otelMiddlewareRoute (used by newMux) which names the span after the
// registered route pattern; this bare variant falls back to the method only
// to keep span-name cardinality bounded.
func otelMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return otelMiddlewareRoute("", next)
}

// otelMiddlewareRoute is otelMiddleware with the route pattern the mux
// registered (e.g. "POST /sync/push") — http.Request.Pattern is Go 1.23+,
// so on go 1.22 the pattern is threaded through explicitly. The span is a
// server span named "method + route pattern"; it records the status code and
// attaches tenant.id when the TS core forwarded X-Tenant-Id. It CONTINUES any
// incoming TraceContext so spans parent to the TS core trace, and never
// injects anything into upstream (provider) calls.
func otelMiddlewareRoute(route string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		if route == "" {
			// No registered pattern known — method only, never the raw path
			// (raw paths are unbounded cardinality).
			route = r.Method
		}
		attrs := []attribute.KeyValue{
			attribute.String("http.request.method", r.Method),
			attribute.String("url.path", r.URL.Path),
			semconv.HTTPRoute(route),
		}
		if tenantID := strings.TrimSpace(r.Header.Get(tenantHeader)); tenantID != "" {
			attrs = append(attrs, attribute.String("tenant.id", tenantID))
		}
		ctx, span := svcTracer.Start(ctx, route,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attrs...),
		)
		defer span.End()

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next(rec, r.WithContext(ctx))

		span.SetAttributes(attribute.Int("http.response.status_code", rec.status))
		if rec.status >= http.StatusInternalServerError {
			span.SetStatus(codes.Error, http.StatusText(rec.status))
		} else {
			span.SetStatus(codes.Ok, "")
		}
	}
}
