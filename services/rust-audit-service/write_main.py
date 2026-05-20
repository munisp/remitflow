content = '''// RemitFlow — Rust Audit-Log Microservice
// High-performance, tamper-evident audit log service.
// Port: 8082 | POST /audit/log, GET /audit/events, GET /health, GET /metrics

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    env,
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

const RING_BUFFER_CAPACITY: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuditSeverity { Info, Warning, Critical }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub id: String,
    pub user_id: Option<i64>,
    pub action: String,
    pub resource: String,
    pub resource_id: Option<String>,
    pub ip_address: Option<String>,
    pub details: Option<serde_json::Value>,
    pub severity: AuditSeverity,
    pub success: bool,
    pub error_message: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub checksum: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAuditEventRequest {
    pub user_id: Option<i64>,
    pub action: String,
    pub resource: String,
    pub resource_id: Option<String>,
    pub ip_address: Option<String>,
    pub details: Option<serde_json::Value>,
    pub severity: Option<AuditSeverity>,
    pub success: Option<bool>,
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    pub user_id: Option<i64>,
    pub action: Option<String>,
    pub resource: Option<String>,
    pub severity: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

pub struct AppState {
    pub events: Mutex<VecDeque<AuditEvent>>,
    pub total_received: Mutex<u64>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            events: Mutex::new(VecDeque::with_capacity(RING_BUFFER_CAPACITY)),
            total_received: Mutex::new(0),
        }
    }

    pub fn push_event(&self, event: AuditEvent) {
        let mut buf = self.events.lock().unwrap();
        if buf.len() >= RING_BUFFER_CAPACITY { buf.pop_front(); }
        buf.push_back(event);
        *self.total_received.lock().unwrap() += 1;
    }

    pub fn query_events(&self, params: &QueryParams) -> Vec<AuditEvent> {
        let buf = self.events.lock().unwrap();
        let limit = params.limit.unwrap_or(50).min(500);
        let offset = params.offset.unwrap_or(0);
        buf.iter()
            .filter(|e| {
                if let Some(uid) = params.user_id { if e.user_id != Some(uid) { return false; } }
                if let Some(ref a) = params.action { if !e.action.contains(a.as_str()) { return false; } }
                if let Some(ref r) = params.resource { if !e.resource.contains(r.as_str()) { return false; } }
                if let Some(ref s) = params.severity {
                    let es = match e.severity {
                        AuditSeverity::Info => "info",
                        AuditSeverity::Warning => "warning",
                        AuditSeverity::Critical => "critical",
                    };
                    if es != s.as_str() { return false; }
                }
                true
            })
            .rev().skip(offset).take(limit).cloned().collect()
    }
}

fn compute_checksum(user_id: Option<i64>, action: &str, resource: &str, success: bool, ts: &DateTime<Utc>, id: &str) -> String {
    let payload = format!("{}:{}:{}:{}:{}:{}", id, user_id.unwrap_or(0), action, resource, success, ts.timestamp_millis());
    let mut hash: u64 = 14695981039346656037;
    for byte in payload.bytes() { hash ^= byte as u64; hash = hash.wrapping_mul(1099511628211); }
    format!("{:016x}", hash)
}

async fn create_audit_event(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateAuditEventRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if req.action.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "action is required"}))));
    }
    if req.resource.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "resource is required"}))));
    }
    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now();
    let success = req.success.unwrap_or(true);
    let checksum = compute_checksum(req.user_id, &req.action, &req.resource, success, &timestamp, &id);
    let event = AuditEvent {
        id: id.clone(), user_id: req.user_id, action: req.action, resource: req.resource,
        resource_id: req.resource_id, ip_address: req.ip_address, details: req.details,
        severity: req.severity.unwrap_or(AuditSeverity::Info), success,
        error_message: req.error_message, timestamp, checksum: Some(checksum.clone()),
    };
    state.push_event(event);
    Ok(Json(serde_json::json!({"id": id, "checksum": checksum, "timestamp": timestamp.to_rfc3339(), "status": "recorded"})))
}

async fn batch_create_audit_events(
    State(state): State<Arc<AppState>>,
    Json(events): Json<Vec<CreateAuditEventRequest>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if events.len() > 100 {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Batch size exceeds 100"}))));
    }
    let mut ids = Vec::new();
    for req in events {
        let id = Uuid::new_v4().to_string();
        let timestamp = Utc::now();
        let success = req.success.unwrap_or(true);
        let checksum = compute_checksum(req.user_id, &req.action, &req.resource, success, &timestamp, &id);
        state.push_event(AuditEvent {
            id: id.clone(), user_id: req.user_id, action: req.action, resource: req.resource,
            resource_id: req.resource_id, ip_address: req.ip_address, details: req.details,
            severity: req.severity.unwrap_or(AuditSeverity::Info), success,
            error_message: req.error_message, timestamp, checksum: Some(checksum),
        });
        ids.push(id);
    }
    Ok(Json(serde_json::json!({"recorded": ids.len(), "ids": ids})))
}

async fn query_audit_events(
    State(state): State<Arc<AppState>>,
    Query(params): Query<QueryParams>,
) -> Json<serde_json::Value> {
    let events = state.query_events(&params);
    let total = events.len();
    Json(serde_json::json!({"events": events, "total": total}))
}

async fn get_audit_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<AuditEvent>, (StatusCode, Json<serde_json::Value>)> {
    let buf = state.events.lock().unwrap();
    if let Some(event) = buf.iter().find(|e| e.id == id) {
        Ok(Json(event.clone()))
    } else {
        Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Not found"}))))
    }
}

async fn verify_audit_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let buf = state.events.lock().unwrap();
    if let Some(event) = buf.iter().find(|e| e.id == id) {
        let expected = compute_checksum(event.user_id, &event.action, &event.resource, event.success, &event.timestamp, &event.id);
        let stored = event.checksum.as_deref().unwrap_or("");
        Json(serde_json::json!({"id": id, "valid": expected == stored, "storedChecksum": stored, "computedChecksum": expected}))
    } else {
        Json(serde_json::json!({"id": id, "valid": false, "error": "Not found"}))
    }
}

async fn get_stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let buf = state.events.lock().unwrap();
    let total = buf.len();
    let critical = buf.iter().filter(|e| e.severity == AuditSeverity::Critical).count();
    let failures = buf.iter().filter(|e| !e.success).count();
    drop(buf);
    Json(serde_json::json!({"bufferSize": total, "bufferCapacity": RING_BUFFER_CAPACITY, "criticalEvents": critical, "failureEvents": failures, "totalReceived": *state.total_received.lock().unwrap()}))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok", "service": "remitflow-rust-audit-service", "version": "1.0.0"}))
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    let buf = state.events.lock().unwrap();
    let size = buf.len();
    let critical = buf.iter().filter(|e| e.severity == AuditSeverity::Critical).count();
    drop(buf);
    let received = *state.total_received.lock().unwrap();
    format!("# HELP remitflow_audit_events_total Total audit events\\n# TYPE remitflow_audit_events_total counter\\nremitflow_audit_events_total {received}\\n\\n# HELP remitflow_audit_buffer_size Buffer size\\n# TYPE remitflow_audit_buffer_size gauge\\nremitflow_audit_buffer_size {size}\\n\\n# HELP remitflow_audit_critical_events Critical events\\n# TYPE remitflow_audit_critical_events gauge\\nremitflow_audit_critical_events {critical}\\n")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string())).init();
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8082".to_string()).parse().unwrap_or(8082);
    let state = Arc::new(AppState::new());
    let app = Router::new()
        .route("/audit/log", post(create_audit_event))
        .route("/audit/batch", post(batch_create_audit_events))
        .route("/audit/events", get(query_audit_events))
        .route("/audit/events/:id", get(get_audit_event))
        .route("/audit/verify/:id", get(verify_audit_event))
        .route("/audit/stats", get(get_stats))
        .route("/health", get(health_check))
        .route("/metrics", get(metrics))
        .layer(CorsLayer::permissive())
        .with_state(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("[RemitFlow] Rust Audit Service on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;

    fn build_app() -> Router {
        let state = Arc::new(AppState::new());
        Router::new()
            .route("/audit/log", post(create_audit_event))
            .route("/audit/batch", post(batch_create_audit_events))
            .route("/audit/events", get(query_audit_events))
            .route("/audit/events/:id", get(get_audit_event))
            .route("/audit/verify/:id", get(verify_audit_event))
            .route("/audit/stats", get(get_stats))
            .route("/health", get(health_check))
            .route("/metrics", get(metrics))
            .with_state(state)
    }

    #[tokio::test]
    async fn test_health() {
        let app = build_app();
        let res = app.oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_create_event() {
        let app = build_app();
        let payload = serde_json::json!({"userId": 1, "action": "transfer.create", "resource": "transfer"});
        let res = app.oneshot(Request::builder().method("POST").uri("/audit/log").header("content-type", "application/json").body(Body::from(payload.to_string())).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_missing_action() {
        let app = build_app();
        let payload = serde_json::json!({"resource": "transfer"});
        let res = app.oneshot(Request::builder().method("POST").uri("/audit/log").header("content-type", "application/json").body(Body::from(payload.to_string())).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_query_events() {
        let app = build_app();
        let res = app.oneshot(Request::builder().uri("/audit/events").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_batch_create() {
        let app = build_app();
        let payload = serde_json::json!([{"action": "kyc.submit", "resource": "kyc"}, {"action": "wallet.withdraw", "resource": "wallet"}]);
        let res = app.oneshot(Request::builder().method("POST").uri("/audit/batch").header("content-type", "application/json").body(Body::from(payload.to_string())).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_ring_buffer_eviction() {
        let state = Arc::new(AppState::new());
        for i in 0..(RING_BUFFER_CAPACITY + 100) {
            let id = Uuid::new_v4().to_string();
            let ts = Utc::now();
            state.push_event(AuditEvent { id, user_id: Some(i as i64), action: format!("a.{}", i), resource: "test".to_string(), resource_id: None, ip_address: None, details: None, severity: AuditSeverity::Info, success: true, error_message: None, timestamp: ts, checksum: None });
        }
        assert_eq!(state.events.lock().unwrap().len(), RING_BUFFER_CAPACITY);
    }

    #[tokio::test]
    async fn test_checksum_deterministic() {
        let ts = Utc::now();
        let c1 = compute_checksum(Some(42), "transfer.create", "transfer", true, &ts, "test-id");
        let c2 = compute_checksum(Some(42), "transfer.create", "transfer", true, &ts, "test-id");
        assert_eq!(c1, c2);
        assert!(!c1.is_empty());
    }

    #[tokio::test]
    async fn test_metrics() {
        let app = build_app();
        let res = app.oneshot(Request::builder().uri("/metrics").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_stats() {
        let app = build_app();
        let res = app.oneshot(Request::builder().uri("/audit/stats").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
}
'''

with open('/home/ubuntu/remitflow/services/rust-audit-service/src/main.rs', 'w') as f:
    f.write(content)
print("Written successfully")
