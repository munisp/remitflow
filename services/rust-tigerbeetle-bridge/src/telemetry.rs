/*!
 * OpenTelemetry tracing for the TigerBeetle bridge.
 *
 * FAIL-SOFT CONTRACT: telemetry is strictly optional. If OTEL_SDK_DISABLED is
 * set, or the OTLP exporter cannot be constructed, the service installs a
 * logs-only subscriber, logs exactly one WARN, and keeps serving money paths
 * without telemetry. `init()` never panics and never blocks startup on a
 * collector being reachable (the batch exporter retries in the background).
 *
 * Configuration (all optional, standard OTel names where one exists):
 *   OTEL_SDK_DISABLED             "true"/"1" → no spans are produced
 *   OTEL_EXPORTER_OTLP_ENDPOINT   base OTLP/HTTP endpoint (default
 *                                 http://localhost:4318; the exporter appends
 *                                 /v1/traces and also honors the signal-level
 *                                 OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
 *   OTEL_SERVICE_NAME             resource service.name (default
 *                                 rust-tigerbeetle-bridge)
 *   OTEL_ENVIRONMENT              resource deployment.environment (default
 *                                 development)
 *   RUST_LOG                      tracing filter (unchanged behavior)
 *
 * Crate family pinned to the 0.27 line (opentelemetry, opentelemetry_sdk,
 * opentelemetry-otlp, opentelemetry-http) + tracing-opentelemetry 0.28, the
 * matching bridge release. Transport is OTLP/HTTP+protobuf via reqwest —
 * the service does not use tonic, so no gRPC stack is pulled in.
 */

use std::sync::atomic::{AtomicBool, Ordering};

use opentelemetry::{global, trace::TracerProvider as _, KeyValue};
use opentelemetry_otlp::{SpanExporter, WithHttpConfig as _};
use opentelemetry_sdk::{
    propagation::TraceContextPropagator,
    trace::TracerProvider,
    Resource,
};
use tracing::{info, warn};
use tracing_subscriber::{
    layer::{Layer as _, SubscriberExt as _},
    util::SubscriberInitExt as _,
    EnvFilter,
};

/// Process-wide honesty flag: true only when spans are actually exported.
static TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(false);

/// Whether OTLP tracing is active. Surfaced verbatim in /health.
pub fn telemetry_enabled() -> bool {
    TELEMETRY_ENABLED.load(Ordering::Relaxed)
}

/// Holds the tracer provider so spans are flushed on shutdown. Drop (or call
/// [`OtelGuard::shutdown`]) after the server stops accepting requests.
pub struct OtelGuard {
    provider: Option<TracerProvider>,
}

impl OtelGuard {
    /// Flush queued spans and shut the exporter down. Idempotent; also runs
    /// on Drop, so calling it explicitly is optional.
    pub fn shutdown(mut self) {
        self.flush_and_shutdown();
    }

    fn flush_and_shutdown(&mut self) {
        if let Some(provider) = self.provider.take() {
            if let Err(e) = provider.force_flush().into_iter().collect::<Result<Vec<_>, _>>() {
                warn!(error = %e, "opentelemetry force_flush failed during shutdown");
            }
            if let Err(e) = provider.shutdown() {
                warn!(error = %e, "opentelemetry tracer provider shutdown failed");
            }
            TELEMETRY_ENABLED.store(false, Ordering::Relaxed);
        }
    }
}

impl Drop for OtelGuard {
    fn drop(&mut self) {
        self.flush_and_shutdown();
    }
}

/// Install tracing (logs always, OTLP spans when possible). Never panics.
pub fn init() -> OtelGuard {
    if sdk_disabled() {
        install_subscriber(None);
        TELEMETRY_ENABLED.store(false, Ordering::Relaxed);
        warn!("OTEL_SDK_DISABLED is set — running WITHOUT telemetry (fail-soft)");
        return OtelGuard { provider: None };
    }

    match build_provider() {
        Ok(provider) => {
            // W3C traceparent/tracestate propagation so spans join the traces
            // started by the TypeScript API layer.
            global::set_text_map_propagator(TraceContextPropagator::new());
            let tracer = provider.tracer("rust-tigerbeetle-bridge");
            global::set_tracer_provider(provider.clone());
            install_subscriber(Some(tracer));
            TELEMETRY_ENABLED.store(true, Ordering::Relaxed);
            info!(
                endpoint = %std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
                    .unwrap_or_else(|_| "http://localhost:4318".to_string()),
                "opentelemetry OTLP/HTTP tracing enabled"
            );
            OtelGuard { provider: Some(provider) }
        }
        Err(e) => {
            // One WARN, then run without telemetry — money paths must not
            // depend on the observability stack.
            install_subscriber(None);
            TELEMETRY_ENABLED.store(false, Ordering::Relaxed);
            warn!(error = %e, "opentelemetry exporter init failed — continuing WITHOUT telemetry (fail-soft)");
            OtelGuard { provider: None }
        }
    }
}

fn sdk_disabled() -> bool {
    std::env::var("OTEL_SDK_DISABLED")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false)
}

/// JSON fmt layer (unchanged log behavior) + env filter; the OTLP span layer
/// is added when a provider was built. `try_init` so repeated calls (tests)
/// cannot panic on an already-installed global subscriber.
fn install_subscriber(otel_tracer: Option<opentelemetry_sdk::trace::Tracer>) {
    // Same filter for both layers (RUST_LOG, default info): spans the logs
    // would suppress are not exported either. Constructed twice so no Clone
    // bound is needed.
    let filter = || {
        EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,tigerbeetle_bridge=info"))
    };
    let otel_layer = otel_tracer
        .map(|tracer| tracing_opentelemetry::OpenTelemetryLayer::new(tracer).with_filter(filter()));
    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().json().with_filter(filter()))
        .with(otel_layer)
        .try_init();
}

fn build_provider() -> anyhow::Result<TracerProvider> {
    // Endpoint resolution is delegated to the exporter: it honors
    // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, then OTEL_EXPORTER_OTLP_ENDPOINT,
    // then the spec default http://localhost:4318, appending /v1/traces.
    let exporter = SpanExporter::builder()
        .with_http()
        .with_http_client(reqwest::Client::new())
        .build()?;

    let service_name = std::env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "rust-tigerbeetle-bridge".to_string());
    let environment = std::env::var("OTEL_ENVIRONMENT")
        .or_else(|_| std::env::var("DEPLOYMENT_ENVIRONMENT"))
        .unwrap_or_else(|_| "development".to_string());

    // new_with_defaults keeps the SDK/telemetry-sdk/* attributes and the
    // OTEL_RESOURCE_ATTRIBUTES detector, then layers ours on top.
    let resource = Resource::new_with_defaults(vec![
        KeyValue::new("service.name", service_name),
        KeyValue::new("service.version", env!("CARGO_PKG_VERSION")),
        KeyValue::new("deployment.environment", environment),
    ]);

    Ok(TracerProvider::builder()
        // Batch export on the tokio runtime — spans never block handlers.
        .with_batch_exporter(exporter, opentelemetry_sdk::runtime::Tokio)
        .with_resource(resource)
        .build())
}
