/*!
 * RemitFlow — Rust Rate Governance Service (BDC platform)
 * ═══════════════════════════════════════════════════════
 * Band validation and cross-rate computation for the BDC bounded context
 * (SPEC-bdc §4.4). Pure-compute service: no database, no external calls —
 * every answer is derived from the request body with integer-exact math
 * (no floats anywhere in the computation).
 *
 *   POST /quote/validate  { rate, reference, bandBps }
 *                         → { withinBand, deviationBps }
 *   POST /quote/cross     { fromCcy, toCcy, ngnMidPerUnit: { from, to } }
 *                         → { buyRate, sellRate, legs: [...] }
 *   GET  /healthz         → { status: "healthy", ... }
 *   GET  /metrics         → Prometheus exposition
 *
 * Rate scale: rates are integers scaled 1e4 — a wire value of 16002500 is the
 * rate 1600.2500 (kobo per 1 FX unit). JSON numbers must be integers; a
 * fractional JSON number is rejected 400.
 *
 * Errors: typed JSON — { "error": { "code": "...", "message": "..." } }.
 * 400 on invalid input (including zero/negative reference), 500 otherwise.
 *
 * Trace-id passthrough (sibling convention, rust-tigerbeetle-bridge): the W3C
 * `traceparent` header is honored — its trace id is attached to the request
 * log span and echoed back as the `x-trace-id` response header (an incoming
 * `x-trace-id` is passed through verbatim as fallback).
 *
 * Environment:
 *   PORT | RATE_GOVERNANCE_PORT   listen port (default 8310)
 *   RUST_LOG                     tracing filter (default info)
 */

mod rate_math;
#[cfg(test)]
mod tests;

use axum::{
    extract::{rejection::JsonRejection, Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use prometheus::{IntCounter, Registry};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};
use tracing::{info, info_span, Instrument as _};

use rate_math::{cross_rate_scaled, deviation_bps, within_band, RATE_SCALE};

// ─── Typed errors ─────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("malformed JSON body: {0}")]
    MalformedBody(String),
    #[error("rate must be a positive integer (scaled 1e4)")]
    InvalidRate,
    #[error("reference must be a positive integer — zero/negative reference rejected")]
    InvalidReference,
    #[error("bandBps must be a non-negative integer")]
    InvalidBand,
    #[error("currency codes must be exactly 3 ASCII letters")]
    InvalidCurrency,
    #[error("fromCcy and toCcy must be different currencies")]
    SameCurrency,
    #[error("ngnMidPerUnit.from and ngnMidPerUnit.to must be positive integers (scaled 1e4)")]
    InvalidMid,
}

impl ApiError {
    fn code(&self) -> &'static str {
        match self {
            ApiError::MalformedBody(_) => "MALFORMED_BODY",
            ApiError::InvalidRate => "INVALID_RATE",
            ApiError::InvalidReference => "INVALID_REFERENCE",
            ApiError::InvalidBand => "INVALID_BAND",
            ApiError::InvalidCurrency => "INVALID_CURRENCY",
            ApiError::SameCurrency => "SAME_CURRENCY",
            ApiError::InvalidMid => "INVALID_MID",
        }
    }

    fn status(&self) -> StatusCode {
        // Every variant here is a client-input problem → 400. Unexpected
        // internal failures map to 500 INTERNAL_ERROR in error_response().
        StatusCode::BAD_REQUEST
    }
}

/// Typed JSON error shape: { "error": { "code", "message" } }.
fn error_response(status: StatusCode, code: &str, message: String) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({
            "error": { "code": code, "message": message }
        })),
    )
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        error_response(self.status(), self.code(), self.to_string()).into_response()
    }
}

/// 500 contract: this deterministic pure-compute service has no fallible
/// internal operations, so every error it produces is a typed 400. Any
/// unexpected failure (panic in a handler) is isolated by axum/tower and
/// surfaced as 500 INTERNAL_ERROR via the standard rejection path.
#[allow(dead_code)]
fn internal_error_response(message: String) -> (StatusCode, Json<serde_json::Value>) {
    error_response(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}

// ─── Request/response bodies ──────────────────────────────────────────────────
// Field names follow the C3 contract; `rateMinor`/`referenceMinor` aliases are
// accepted for SPEC-bdc §4.4 naming compatibility (same i64 scaled values).

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateBody {
    #[serde(alias = "rateMinor")]
    rate: i64,
    #[serde(alias = "referenceMinor")]
    reference: i64,
    band_bps: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidateResponse {
    within_band: bool,
    deviation_bps: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CrossBody {
    from_ccy: String,
    to_ccy: String,
    ngn_mid_per_unit: NgnMidPerUnit,
}

#[derive(Debug, Deserialize)]
struct NgnMidPerUnit {
    from: i64,
    to: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrossLeg {
    leg: u8,
    action: &'static str,
    currency: String,
    ngn_mid_per_unit: i64,
    description: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrossResponse {
    from_ccy: String,
    to_ccy: String,
    buy_rate: i64,
    sell_rate: i64,
    scale: i64,
    rounding: &'static str,
    legs: [CrossLeg; 2],
}

// ─── Input validation (unit-tested directly — see tests.rs) ──────────────────

fn check_validate_body(body: &ValidateBody) -> Result<(), ApiError> {
    if body.reference <= 0 {
        return Err(ApiError::InvalidReference);
    }
    if body.rate <= 0 {
        return Err(ApiError::InvalidRate);
    }
    if body.band_bps < 0 {
        return Err(ApiError::InvalidBand);
    }
    Ok(())
}

fn normalize_currency(code: &str) -> Result<String, ApiError> {
    let up = code.trim().to_ascii_uppercase();
    if up.len() == 3 && up.bytes().all(|b| b.is_ascii_uppercase()) {
        Ok(up)
    } else {
        Err(ApiError::InvalidCurrency)
    }
}

fn check_cross_body(body: &CrossBody) -> Result<(String, String), ApiError> {
    let from = normalize_currency(&body.from_ccy)?;
    let to = normalize_currency(&body.to_ccy)?;
    if from == to {
        return Err(ApiError::SameCurrency);
    }
    if body.ngn_mid_per_unit.from <= 0 || body.ngn_mid_per_unit.to <= 0 {
        return Err(ApiError::InvalidMid);
    }
    Ok((from, to))
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

struct Metrics {
    requests_total: IntCounter,
    errors_total: IntCounter,
}

impl Metrics {
    fn new(registry: &Registry) -> anyhow::Result<Self> {
        let requests_total = IntCounter::new("rate_governance_requests_total", "Total HTTP requests")?;
        let errors_total = IntCounter::new("rate_governance_errors_total", "Total failed requests")?;
        registry.register(Box::new(requests_total.clone()))?;
        registry.register(Box::new(errors_total.clone()))?;
        Ok(Self { requests_total, errors_total })
    }
}

struct AppState {
    metrics: Metrics,
    registry: Registry,
}

// ─── Trace-id passthrough middleware ─────────────────────────────────────────

/// Extracts the trace id from the W3C `traceparent` header
/// (version-traceid-parentid-flags; trace id = 32 lowercase hex chars), or an
/// explicit `x-trace-id` fallback. Returns None when absent/malformed.
fn extract_trace_id(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(tp) = headers.get("traceparent").and_then(|v| v.to_str().ok()) {
        let mut parts = tp.split('-');
        let version = parts.next().unwrap_or("");
        if let Some(trace_id) = parts.next() {
            if !version.is_empty()
                && trace_id.len() == 32
                && trace_id.bytes().all(|b| b.is_ascii_hexdigit())
                && trace_id != "00000000000000000000000000000000"
            {
                return Some(trace_id.to_string());
            }
        }
    }
    headers
        .get("x-trace-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(|s| s.to_string())
}

/// One request log span per call carrying the propagated trace id; the trace
/// id is echoed back to the caller as the `x-trace-id` response header.
async fn trace_id_passthrough(req: Request, next: Next) -> Response {
    let trace_id = extract_trace_id(req.headers());
    let span = info_span!(
        "http.request",
        http.request.method = %req.method(),
        url.path = %req.uri().path(),
        trace.id = trace_id.as_deref().unwrap_or(""),
        http.response.status_code = tracing::field::Empty,
    );
    let mut response = next.run(req).instrument(span.clone()).await;
    span.record("http.response.status_code", response.status().as_u16() as u64);
    if let Some(id) = trace_id {
        if let Ok(v) = HeaderValue::from_str(&id) {
            response.headers_mut().insert("x-trace-id", v);
        }
    }
    response
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn quote_validate(
    State(state): State<Arc<AppState>>,
    body: Result<Json<ValidateBody>, JsonRejection>,
) -> Response {
    state.metrics.requests_total.inc();
    let Json(body) = match body {
        Ok(b) => b,
        Err(rej) => {
            state.metrics.errors_total.inc();
            return ApiError::MalformedBody(rej.body_text()).into_response();
        }
    };
    if let Err(e) = check_validate_body(&body) {
        state.metrics.errors_total.inc();
        return e.into_response();
    }
    // Exact integer band decision; deviation reported floor-rounded (display).
    let within = within_band(body.rate, body.reference, body.band_bps);
    let deviation = deviation_bps(body.rate, body.reference);
    (
        StatusCode::OK,
        Json(ValidateResponse { within_band: within, deviation_bps: deviation }),
    )
        .into_response()
}

async fn quote_cross(
    State(state): State<Arc<AppState>>,
    body: Result<Json<CrossBody>, JsonRejection>,
) -> Response {
    state.metrics.requests_total.inc();
    let Json(body) = match body {
        Ok(b) => b,
        Err(rej) => {
            state.metrics.errors_total.inc();
            return ApiError::MalformedBody(rej.body_text()).into_response();
        }
    };
    let (from, to) = match check_cross_body(&body) {
        Ok(pair) => pair,
        Err(e) => {
            state.metrics.errors_total.inc();
            return e.into_response();
        }
    };
    let mid_from = body.ngn_mid_per_unit.from;
    let mid_to = body.ngn_mid_per_unit.to;

    // Two-leg composition via the naira mid (SPEC-bdc §4.4):
    //   leg 1 — buy fromCcy with naira at mid_from (kobo per fromCcy unit);
    //   leg 2 — sell toCcy for naira at mid_to   (kobo per toCcy unit).
    // buyRate: toCcy units (scaled 1e4) per 1 fromCcy unit  = mid_from/mid_to.
    // sellRate: fromCcy units (scaled 1e4) per 1 toCcy unit = mid_to/mid_from.
    // Both rounded HALF-AWAY-FROM-ZERO in integer math (rate_math).
    let buy_rate = cross_rate_scaled(mid_from, mid_to);
    let sell_rate = cross_rate_scaled(mid_to, mid_from);

    (
        StatusCode::OK,
        Json(CrossResponse {
            from_ccy: from.clone(),
            to_ccy: to.clone(),
            buy_rate,
            sell_rate,
            scale: RATE_SCALE,
            rounding: "round-half-away-from-zero",
            legs: [
                CrossLeg {
                    leg: 1,
                    action: "buy",
                    currency: from,
                    ngn_mid_per_unit: mid_from,
                    description: "buy fromCcy with naira at the naira mid",
                },
                CrossLeg {
                    leg: 2,
                    action: "sell",
                    currency: to,
                    ngn_mid_per_unit: mid_to,
                    description: "sell toCcy for naira at the naira mid",
                },
            ],
        }),
    )
        .into_response()
}

/// Pure-compute service with no dependencies: healthy means the process is up
/// and serving. No fabricated dependency probes (contrast with the sibling,
/// which probes Postgres/TigerBeetle — this service has none).
async fn healthz() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "healthy",
            "service": "rust-rate-governance",
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder.encode(&state.registry.gather(), &mut buffer).unwrap_or_default();
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buffer,
    )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,rate_governance=info"));
    tracing_subscriber::fmt().json().with_env_filter(filter).init();

    let port: u16 = std::env::var("PORT")
        .or_else(|_| std::env::var("RATE_GOVERNANCE_PORT"))
        .unwrap_or_else(|_| "8310".to_string())
        .parse()
        .expect("PORT/RATE_GOVERNANCE_PORT must be a valid port number");

    let registry = Registry::new();
    let metrics = Metrics::new(&registry)?;
    let state = Arc::new(AppState { metrics, registry });

    let app = Router::new()
        .route("/quote/validate", post(quote_validate))
        .route("/quote/cross", post(quote_cross))
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics_handler))
        .layer(middleware::from_fn(trace_id_passthrough))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(30)))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Rate governance service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// SIGINT (Ctrl+C) or SIGTERM → begin graceful shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    info!("shutdown signal received — draining requests");
}

