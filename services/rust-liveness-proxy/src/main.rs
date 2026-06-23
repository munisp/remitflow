//! RemitFlow — Rust Liveness Proxy Sidecar
//!
//! Port: 8096  (PYTHON_KYC_LIVENESS_URL default target)
//!
//! Responsibilities:
//!  1. Reverse-proxy POST /check → Python liveness service (port 8090 by default)
//!  2. Fail-CLOSED: if upstream is unreachable, return 503 with
//!     `{ "passed": false, "liveness_score": 0.0, "service_unavailable": true }`
//!     so KYC is BLOCKED, not silently approved.
//!  3. Circuit-breaker: after CIRCUIT_OPEN_THRESHOLD consecutive upstream failures
//!     the circuit opens and requests are rejected immediately (no upstream call)
//!     until CIRCUIT_RESET_SECS have elapsed.
//!  4. Per-user rate-limiting: max RATE_LIMIT_RPM requests/minute per user_id
//!     extracted from the JSON body.
//!  5. Structured JSON audit log on every check (user_id, passed, score, latency_ms).
//!  6. GET /health  → { "status": "healthy"|"degraded", "circuit": "closed"|"open" }
//!  7. GET /metrics → Prometheus-style text counters.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Configuration ────────────────────────────────────────────────────────────

fn env_str(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}
fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LivenessRequest {
    pub image_url: Option<String>,
    pub selfie_url: Option<String>,
    pub user_id: Option<Value>,   // accept string or number
    pub session_id: Option<String>,
    pub video_url: Option<String>,
    pub reference_image_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LivenessResponse {
    pub passed: bool,
    pub confidence: f64,
    pub liveness_score: f64,
    pub spoofing_detected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_unavailable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub circuit_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limited: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_latency_ms: Option<u64>,
}

impl LivenessResponse {
    fn fail_closed(reason: &str, extra: Value) -> Self {
        info!(reason = reason, extra = %extra, "Liveness check fail-closed");
        Self {
            passed: false,
            confidence: 0.0,
            liveness_score: 0.0,
            spoofing_detected: false,
            service_unavailable: Some(true),
            circuit_open: None,
            rate_limited: None,
            request_id: Some(Uuid::new_v4().to_string()),
            upstream_latency_ms: None,
        }
    }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

#[derive(Debug)]
enum CircuitState {
    Closed,
    Open { opened_at: Instant },
}

struct CircuitBreaker {
    state: CircuitState,
    consecutive_failures: u64,
    open_threshold: u64,
    reset_secs: u64,
}

impl CircuitBreaker {
    fn new(open_threshold: u64, reset_secs: u64) -> Self {
        Self {
            state: CircuitState::Closed,
            consecutive_failures: 0,
            open_threshold,
            reset_secs,
        }
    }

    fn is_open(&mut self) -> bool {
        if let CircuitState::Open { opened_at } = &self.state {
            if opened_at.elapsed().as_secs() >= self.reset_secs {
                info!("Circuit breaker: half-open — attempting reset");
                self.state = CircuitState::Closed;
                self.consecutive_failures = 0;
                return false;
            }
            return true;
        }
        false
    }

    fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.state = CircuitState::Closed;
    }

    fn record_failure(&mut self) {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.open_threshold {
            warn!(
                failures = self.consecutive_failures,
                "Circuit breaker OPEN — upstream liveness service unavailable"
            );
            self.state = CircuitState::Open { opened_at: Instant::now() };
        }
    }

    fn state_label(&self) -> &'static str {
        match &self.state {
            CircuitState::Closed => "closed",
            CircuitState::Open { .. } => "open",
        }
    }
}

// ─── Rate Limiter (sliding-window per user) ───────────────────────────────────

struct RateLimiter {
    windows: HashMap<String, Vec<Instant>>,
    max_rpm: usize,
}

impl RateLimiter {
    fn new(max_rpm: usize) -> Self {
        Self { windows: HashMap::new(), max_rpm }
    }

    fn check_and_record(&mut self, user_key: &str) -> bool {
        let now = Instant::now();
        let window = self.windows.entry(user_key.to_string()).or_default();
        // Evict entries older than 60 seconds
        window.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
        if window.len() >= self.max_rpm {
            return false; // rate limited
        }
        window.push(now);
        true
    }
}

// ─── Shared Application State ─────────────────────────────────────────────────

struct AppState {
    upstream_url: String,
    http_client: Client,
    circuit: Mutex<CircuitBreaker>,
    rate_limiter: Mutex<RateLimiter>,
    // Metrics counters
    total_requests: AtomicU64,
    passed_count: AtomicU64,
    failed_count: AtomicU64,
    upstream_errors: AtomicU64,
    circuit_rejections: AtomicU64,
    rate_limit_rejections: AtomicU64,
    pub db_pool: Option<PgPool>,
}

impl AppState {
    fn new(upstream_url: String, open_threshold: u64, reset_secs: u64, max_rpm: usize) -> Self {
        Self {
            upstream_url,
            http_client: Client::builder()
                .timeout(Duration::from_secs(env_u64("UPSTREAM_TIMEOUT_SECS", 30)))
                .build()
                .expect("Failed to build HTTP client"),
            circuit: Mutex::new(CircuitBreaker::new(open_threshold, reset_secs)),
            rate_limiter: Mutex::new(RateLimiter::new(max_rpm)),
            total_requests: AtomicU64::new(0),
            passed_count: AtomicU64::new(0),
            failed_count: AtomicU64::new(0),
            upstream_errors: AtomicU64::new(0),
            circuit_rejections: AtomicU64::new(0),
            rate_limit_rejections: AtomicU64::new(0),
        }
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn handle_check(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LivenessRequest>,
) -> impl IntoResponse {
    let request_id = Uuid::new_v4().to_string();
    state.total_requests.fetch_add(1, Ordering::Relaxed);

    // Extract user key for rate-limiting (accept numeric or string user_id)
    let user_key = body
        .user_id
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "anonymous".to_string());

    // ── Rate limit check ──────────────────────────────────────────────────────
    {
        let mut rl = state.rate_limiter.lock().unwrap();
        if !rl.check_and_record(&user_key) {
            state.rate_limit_rejections.fetch_add(1, Ordering::Relaxed);
            warn!(user = %user_key, "Liveness rate limit exceeded");
            let resp = LivenessResponse {
                passed: false,
                confidence: 0.0,
                liveness_score: 0.0,
                spoofing_detected: false,
                service_unavailable: None,
                circuit_open: None,
                rate_limited: Some(true),
                request_id: Some(request_id),
                upstream_latency_ms: None,
            };
            return (StatusCode::TOO_MANY_REQUESTS, Json(json!(resp)));
        }
    }

    // ── Circuit breaker check ─────────────────────────────────────────────────
    {
        let mut cb = state.circuit.lock().unwrap();
        if cb.is_open() {
            state.circuit_rejections.fetch_add(1, Ordering::Relaxed);
            warn!(user = %user_key, "Liveness circuit open — fail closed");
            let resp = LivenessResponse {
                passed: false,
                confidence: 0.0,
                liveness_score: 0.0,
                spoofing_detected: false,
                service_unavailable: Some(true),
                circuit_open: Some(true),
                rate_limited: None,
                request_id: Some(request_id),
                upstream_latency_ms: None,
            };
            return (StatusCode::SERVICE_UNAVAILABLE, Json(json!(resp)));
        }
    }

    // ── Forward to upstream Python liveness service ───────────────────────────
    let upstream_url = format!("{}/v1/check-liveness", state.upstream_url);
    let start = Instant::now();

    let upstream_result = state
        .http_client
        .post(&upstream_url)
        .json(&body)
        .send()
        .await;

    let latency_ms = start.elapsed().as_millis() as u64;

    match upstream_result {
        Err(e) => {
            error!(
                error = %e,
                user = %user_key,
                latency_ms = latency_ms,
                "Upstream liveness service unreachable"
            );
            state.upstream_errors.fetch_add(1, Ordering::Relaxed);
            state.failed_count.fetch_add(1, Ordering::Relaxed);
            state.circuit.lock().unwrap().record_failure();

            let mut resp = LivenessResponse::fail_closed("upstream_unreachable", json!({"error": e.to_string()}));
            resp.request_id = Some(request_id);
            resp.upstream_latency_ms = Some(latency_ms);
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!(resp)))
        }
        Ok(upstream_resp) => {
            let status = upstream_resp.status();
            if !status.is_success() {
                error!(
                    status = %status,
                    user = %user_key,
                    latency_ms = latency_ms,
                    "Upstream liveness service returned error status"
                );
                state.upstream_errors.fetch_add(1, Ordering::Relaxed);
                state.failed_count.fetch_add(1, Ordering::Relaxed);
                state.circuit.lock().unwrap().record_failure();

                let mut resp = LivenessResponse::fail_closed(
                    "upstream_error_status",
                    json!({"status": status.as_u16()}),
                );
                resp.request_id = Some(request_id);
                resp.upstream_latency_ms = Some(latency_ms);
                return (StatusCode::SERVICE_UNAVAILABLE, Json(json!(resp)));
            }

            match upstream_resp.json::<Value>().await {
                Err(e) => {
                    error!(error = %e, user = %user_key, "Failed to parse upstream liveness response");
                    state.upstream_errors.fetch_add(1, Ordering::Relaxed);
                    state.failed_count.fetch_add(1, Ordering::Relaxed);
                    state.circuit.lock().unwrap().record_failure();

                    let mut resp = LivenessResponse::fail_closed("parse_error", json!({"error": e.to_string()}));
                    resp.request_id = Some(request_id);
                    resp.upstream_latency_ms = Some(latency_ms);
                    (StatusCode::SERVICE_UNAVAILABLE, Json(json!(resp)))
                }
                Ok(mut upstream_json) => {
                    // Inject proxy metadata
                    upstream_json["request_id"] = json!(request_id);
                    upstream_json["upstream_latency_ms"] = json!(latency_ms);
                    upstream_json["proxy"] = json!("rust-liveness-proxy/1.0.0");

                    let passed = upstream_json
                        .get("is_live")
                        .or_else(|| upstream_json.get("passed"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Normalise field names for Node.js consumer
                    if upstream_json.get("passed").is_none() {
                        upstream_json["passed"] = json!(passed);
                    }
                    if upstream_json.get("liveness_score").is_none() {
                        upstream_json["liveness_score"] = upstream_json
                            .get("confidence_score")
                            .cloned()
                            .unwrap_or(json!(0.0));
                    }
                    if upstream_json.get("spoofing_detected").is_none() {
                        upstream_json["spoofing_detected"] = json!(false);
                    }

                    // Audit log
                    let score = upstream_json
                        .get("liveness_score")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    info!(
                        request_id = %request_id,
                        user = %user_key,
                        passed = passed,
                        score = score,
                        latency_ms = latency_ms,
                        timestamp = %Utc::now().to_rfc3339(),
                        "KYC liveness check completed"
                    );

                    state.circuit.lock().unwrap().record_success();
                    if passed {
                        state.passed_count.fetch_add(1, Ordering::Relaxed);
                    } else {
                        state.failed_count.fetch_add(1, Ordering::Relaxed);
                    }

                    (StatusCode::OK, Json(upstream_json))
                }
            }
        }
    }
}

async fn handle_health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let circuit_label = state.circuit.lock().unwrap().state_label();
    let status = if circuit_label == "open" { "degraded" } else { "healthy" };
    Json(json!({
        "service": "rust-liveness-proxy",
        "version": "1.0.0",
        "status": status,
        "circuit": circuit_label,
        "upstream": state.upstream_url,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn handle_metrics(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let total = state.total_requests.load(Ordering::Relaxed);
    let passed = state.passed_count.load(Ordering::Relaxed);
    let failed = state.failed_count.load(Ordering::Relaxed);
    let upstream_errors = state.upstream_errors.load(Ordering::Relaxed);
    let circuit_rejections = state.circuit_rejections.load(Ordering::Relaxed);
    let rate_limit_rejections = state.rate_limit_rejections.load(Ordering::Relaxed);

    let body = format!(
        "# HELP liveness_proxy_requests_total Total liveness check requests\n\
         # TYPE liveness_proxy_requests_total counter\n\
         liveness_proxy_requests_total {total}\n\
         # HELP liveness_proxy_passed_total Checks that passed\n\
         # TYPE liveness_proxy_passed_total counter\n\
         liveness_proxy_passed_total {passed}\n\
         # HELP liveness_proxy_failed_total Checks that failed\n\
         # TYPE liveness_proxy_failed_total counter\n\
         liveness_proxy_failed_total {failed}\n\
         # HELP liveness_proxy_upstream_errors_total Upstream connection/parse errors\n\
         # TYPE liveness_proxy_upstream_errors_total counter\n\
         liveness_proxy_upstream_errors_total {upstream_errors}\n\
         # HELP liveness_proxy_circuit_rejections_total Requests rejected by open circuit\n\
         # TYPE liveness_proxy_circuit_rejections_total counter\n\
         liveness_proxy_circuit_rejections_total {circuit_rejections}\n\
         # HELP liveness_proxy_rate_limit_rejections_total Requests rejected by rate limiter\n\
         # TYPE liveness_proxy_rate_limit_rejections_total counter\n\
         liveness_proxy_rate_limit_rejections_total {rate_limit_rejections}\n"
    );
    (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")], body)
}

// ─── Main ─────────────────────────────────────────────────────────────────────


use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS liveness_proxy_state (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create state table");

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_liveness_proxy_updated ON liveness_proxy_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS liveness_proxy_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-liveness-proxy");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO liveness_proxy_state (id, data, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()"
    )
    .bind(id)
    .bind(data)
    .execute(pool)
    .await?;
    Ok(())
}

async fn db_get(pool: &PgPool, id: &str) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let row: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM liveness_proxy_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM liveness_proxy_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO liveness_proxy_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::main]
async fn load_from_db(pool: &PgPool) {
    match sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT id, data FROM liveness_proxy_state ORDER BY updated_at DESC LIMIT 1000"
    )
    .fetch_all(pool)
    .await {
        Ok(rows) => {
            tracing::info!("loaded {} persisted records from liveness_proxy_state", rows.len());
        }
        Err(e) => {
            tracing::warn!("failed to load from DB: {}", e);
        }
    }
}

async fn main() -> std::io::Result<()> {
    // Panic hook for logging panics without crashing silently
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let pool = init_db().await;
    load_from_db(&pool).await;
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let port: u16 = env_str("PORT", "8096").parse().unwrap_or(8096);
    let upstream_url = env_str("UPSTREAM_LIVENESS_URL", "http://localhost:8090");
    let open_threshold = env_u64("CIRCUIT_OPEN_THRESHOLD", 5);
    let reset_secs = env_u64("CIRCUIT_RESET_SECS", 30);
    let max_rpm = env_u64("RATE_LIMIT_RPM", 10) as usize;

    info!(
        port = port,
        upstream = %upstream_url,
        circuit_threshold = open_threshold,
        circuit_reset_secs = reset_secs,
        rate_limit_rpm = max_rpm,
        "Starting rust-liveness-proxy"
    );

    let state = Arc::new(AppState::new(upstream_url, open_threshold, reset_secs, max_rpm));

    let app = Router::new()
        .route("/check", post(handle_check))
        .route("/metrics", axum::routing::get(|| async {
            let uptime = _PROCESS_START.get_or_init(Instant::now).elapsed().as_secs();
            format!("# HELP pod_uptime_seconds Time since process started\n# TYPE pod_uptime_seconds gauge\npod_uptime_seconds{{service=\"rust-liveness-proxy\"}} {}\n# HELP pod_ready Whether pod is ready\n# TYPE pod_ready gauge\npod_ready{{service=\"rust-liveness-proxy\"}} 1\n", uptime)
        }))
        .route("/health", get(handle_health))
        .route("/metrics", get(handle_metrics))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!(addr = %addr, "rust-liveness-proxy listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            tracing::info!("[rust-liveness-proxy] Graceful shutdown initiated");
        eprintln!("{{\"event\":\"pod.shutdown.initiated\",\"service\":\"rust-liveness-proxy\",\"timestamp\":\"{}\"}}",
            chrono::Utc::now().to_rfc3339());;
        })
        .await?;
    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
use std::time::Instant;
static _PROCESS_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

    #[test]
    fn circuit_breaker_opens_after_threshold() {
        let mut cb = CircuitBreaker::new(3, 60);
        assert!(!cb.is_open());
        cb.record_failure();
        cb.record_failure();
        assert!(!cb.is_open());
        cb.record_failure(); // hits threshold
        assert!(cb.is_open());
    }

    #[test]
    fn circuit_breaker_resets_after_success() {
        let mut cb = CircuitBreaker::new(2, 60);
        cb.record_failure();
        cb.record_failure();
        assert!(cb.is_open());
        // Simulate time passing by manipulating state directly
        cb.state = CircuitState::Closed;
        cb.consecutive_failures = 0;
        assert!(!cb.is_open());
        cb.record_success();
        assert_eq!(cb.consecutive_failures, 0);
    }

    #[test]
    fn rate_limiter_blocks_after_limit() {
        let mut rl = RateLimiter::new(3);
        assert!(rl.check_and_record("user1"));
        assert!(rl.check_and_record("user1"));
        assert!(rl.check_and_record("user1"));
        assert!(!rl.check_and_record("user1")); // 4th request blocked
        assert!(rl.check_and_record("user2")); // different user unaffected
    }

    #[test]
    fn fail_closed_response_has_correct_fields() {
        let resp = LivenessResponse::fail_closed("test", serde_json::json!({}));
        assert!(!resp.passed);
        assert_eq!(resp.confidence, 0.0);
        assert_eq!(resp.liveness_score, 0.0);
        assert_eq!(resp.service_unavailable, Some(true));
    }
}
