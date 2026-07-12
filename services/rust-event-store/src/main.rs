/*!
 * RemitFlow — Rust Event Store Service
 * ══════════════════════════════════════════════════════════════════════════════
 * Implements the Event Sourcing pattern for RemitFlow's financial domain.
 *
 * Architecture:
 *   - Every state change is recorded as an immutable, append-only domain event
 *   - Aggregates are rebuilt by replaying their event stream
 *   - Optimistic concurrency via expected_version prevents lost updates
 *   - Snapshot support for fast aggregate hydration (every N events)
 *   - Outbox-style projection dispatch for CQRS read models
 *
 * Endpoints:
 *   POST   /streams/{aggregate_type}/{aggregate_id}/events  — Append events
 *   GET    /streams/{aggregate_type}/{aggregate_id}/events  — Read event stream
 *   GET    /streams/{aggregate_type}/{aggregate_id}/snapshot — Get latest snapshot
 *   POST   /streams/{aggregate_type}/{aggregate_id}/snapshot — Save snapshot
 *   GET    /projections/status                              — Projection lag
 *   GET    /health                                          — Liveness probe
 *   GET    /metrics                                         — Prometheus metrics
 *
 * Language: Rust (performance-critical, memory-safe, zero-copy serialization)
 */

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use prometheus::{
    register_counter_vec, register_histogram_vec, register_int_gauge_vec,
    CounterVec, Encoder, HistogramVec, IntGaugeVec, TextEncoder,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{collections::HashMap, sync::Arc};
use tokio::net::TcpListener;
use tracing::{error, info, instrument, warn};
use uuid::Uuid;

// ─── Domain Types ─────────────────────────────────────────────────────────────

/// A single immutable domain event stored in the event log.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StoredEvent {
    pub id:             Uuid,
    pub stream_id:      String,   // "{aggregate_type}-{aggregate_id}"
    pub aggregate_type: String,
    pub aggregate_id:   String,
    pub event_type:     String,
    pub event_version:  i64,      // monotonically increasing per stream
    pub payload:        serde_json::Value,
    pub metadata:       serde_json::Value,
    pub checksum:       String,   // SHA-256 of payload for tamper detection
    pub created_at:     DateTime<Utc>,
}

/// Snapshot of an aggregate at a given event version.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AggregateSnapshot {
    pub id:             Uuid,
    pub stream_id:      String,
    pub aggregate_type: String,
    pub aggregate_id:   String,
    pub snapshot_version: i64,
    pub state:          serde_json::Value,
    pub created_at:     DateTime<Utc>,
}

// ─── Request / Response DTOs ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AppendEventsRequest {
    /// Client must pass the version they last read; -1 means "any version"
    pub expected_version: i64,
    pub events: Vec<EventInput>,
}

#[derive(Debug, Deserialize)]
pub struct EventInput {
    pub event_type: String,
    pub payload:    serde_json::Value,
    pub metadata:   Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct AppendEventsResponse {
    pub stream_id:       String,
    pub events_appended: usize,
    pub new_version:     i64,
}

#[derive(Debug, Deserialize)]
pub struct ReadEventsQuery {
    pub from_version: Option<i64>,
    pub limit:        Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ReadEventsResponse {
    pub stream_id:   String,
    pub events:      Vec<StoredEvent>,
    pub total_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct SaveSnapshotRequest {
    pub snapshot_version: i64,
    pub state:            serde_json::Value,
}

// ─── Application State ────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub pool:    PgPool,
    pub metrics: Arc<Metrics>,
}

pub struct Metrics {
    pub events_appended:   CounterVec,
    pub events_read:       CounterVec,
    pub append_latency_ms: HistogramVec,
    pub read_latency_ms:   HistogramVec,
    pub stream_length:     IntGaugeVec,
    pub optimistic_conflicts: CounterVec,
}

impl Metrics {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            events_appended: register_counter_vec!(
                "event_store_events_appended_total",
                "Total events appended to the event store",
                &["aggregate_type"]
            )?,
            events_read: register_counter_vec!(
                "event_store_events_read_total",
                "Total events read from the event store",
                &["aggregate_type"]
            )?,
            append_latency_ms: register_histogram_vec!(
                "event_store_append_latency_ms",
                "Latency of event append operations in milliseconds",
                &["aggregate_type"],
                vec![1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0]
            )?,
            read_latency_ms: register_histogram_vec!(
                "event_store_read_latency_ms",
                "Latency of event read operations in milliseconds",
                &["aggregate_type"],
                vec![1.0, 5.0, 10.0, 25.0, 50.0, 100.0]
            )?,
            stream_length: register_int_gauge_vec!(
                "event_store_stream_length",
                "Current length of event streams by aggregate type",
                &["aggregate_type"]
            )?,
            optimistic_conflicts: register_counter_vec!(
                "event_store_optimistic_conflicts_total",
                "Total optimistic concurrency conflicts",
                &["aggregate_type"]
            )?,
        })
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// POST /streams/{aggregate_type}/{aggregate_id}/events
#[instrument(skip(state, body))]
async fn append_events(
    State(state): State<Arc<AppState>>,
    Path((aggregate_type, aggregate_id)): Path<(String, String)>,
    Json(body): Json<AppendEventsRequest>,
) -> impl IntoResponse {
    let start = std::time::Instant::now();
    let stream_id = format!("{}-{}", aggregate_type, aggregate_id);

    // Fetch current max version for optimistic concurrency
    let current_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(event_version), -1) FROM event_store WHERE stream_id = $1"
    )
    .bind(&stream_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(-1);

    if body.expected_version != -1 && current_version != body.expected_version {
        state.metrics.optimistic_conflicts
            .with_label_values(&[&aggregate_type])
            .inc();
        warn!(
            stream_id = %stream_id,
            expected = body.expected_version,
            actual = current_version,
            "Optimistic concurrency conflict"
        );
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "optimistic_concurrency_conflict",
                "expected_version": body.expected_version,
                "current_version": current_version
            })),
        ).into_response();
    }

    let mut next_version = current_version + 1;
    let mut stored = Vec::with_capacity(body.events.len());

    for event in &body.events {
        let id = Uuid::new_v4();
        let payload_str = serde_json::to_string(&event.payload).unwrap_or_default();
        let checksum = format!("{:x}", Sha256::digest(payload_str.as_bytes()));
        let metadata = event.metadata.clone().unwrap_or(serde_json::json!({}));

        let result = sqlx::query(
            r#"INSERT INTO event_store
               (id, stream_id, aggregate_type, aggregate_id, event_type,
                event_version, payload, metadata, checksum, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())"#
        )
        .bind(id)
        .bind(&stream_id)
        .bind(&aggregate_type)
        .bind(&aggregate_id)
        .bind(&event.event_type)
        .bind(next_version)
        .bind(&event.payload)
        .bind(&metadata)
        .bind(&checksum)
        .execute(&state.pool)
        .await;

        match result {
            Ok(_) => {
                stored.push(next_version);
                next_version += 1;
            }
            Err(e) => {
                error!(error = %e, "Failed to append event");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "append_failed", "detail": e.to_string()})),
                ).into_response();
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as f64;
    state.metrics.events_appended
        .with_label_values(&[&aggregate_type])
        .inc_by(stored.len() as f64);
    state.metrics.append_latency_ms
        .with_label_values(&[&aggregate_type])
        .observe(elapsed);
    state.metrics.stream_length
        .with_label_values(&[&aggregate_type])
        .set(next_version);

    // Dispatch projection update notification (non-blocking)
    let pool = state.pool.clone();
    let sid = stream_id.clone();
    let atype = aggregate_type.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "INSERT INTO projection_dispatch_queue (stream_id, aggregate_type, from_version, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (stream_id) DO UPDATE SET from_version = EXCLUDED.from_version, created_at = NOW()"
        )
        .bind(&sid)
        .bind(&atype)
        .bind(current_version + 1)
        .execute(&pool)
        .await;
    });

    info!(
        stream_id = %stream_id,
        events_appended = stored.len(),
        new_version = next_version - 1,
        elapsed_ms = elapsed,
        "Events appended"
    );

    (
        StatusCode::CREATED,
        Json(AppendEventsResponse {
            stream_id,
            events_appended: stored.len(),
            new_version: next_version - 1,
        }),
    ).into_response()
}

/// GET /streams/{aggregate_type}/{aggregate_id}/events
#[instrument(skip(state))]
async fn read_events(
    State(state): State<Arc<AppState>>,
    Path((aggregate_type, aggregate_id)): Path<(String, String)>,
    Query(q): Query<ReadEventsQuery>,
) -> impl IntoResponse {
    let start = std::time::Instant::now();
    let stream_id = format!("{}-{}", aggregate_type, aggregate_id);
    let from_version = q.from_version.unwrap_or(0);
    let limit = q.limit.unwrap_or(1000).min(10_000);

    let events: Vec<StoredEvent> = sqlx::query_as(
        r#"SELECT id, stream_id, aggregate_type, aggregate_id, event_type,
                  event_version, payload, metadata, checksum, created_at
           FROM event_store
           WHERE stream_id = $1 AND event_version >= $2
           ORDER BY event_version ASC
           LIMIT $3"#
    )
    .bind(&stream_id)
    .bind(from_version)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let total_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM event_store WHERE stream_id = $1"
    )
    .bind(&stream_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    let elapsed = start.elapsed().as_millis() as f64;
    state.metrics.events_read
        .with_label_values(&[&aggregate_type])
        .inc_by(events.len() as f64);
    state.metrics.read_latency_ms
        .with_label_values(&[&aggregate_type])
        .observe(elapsed);

    Json(ReadEventsResponse { stream_id, events, total_count }).into_response()
}

/// GET /streams/{aggregate_type}/{aggregate_id}/snapshot
async fn get_snapshot(
    State(state): State<Arc<AppState>>,
    Path((aggregate_type, aggregate_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let stream_id = format!("{}-{}", aggregate_type, aggregate_id);

    let snapshot: Option<AggregateSnapshot> = sqlx::query_as(
        r#"SELECT id, stream_id, aggregate_type, aggregate_id, snapshot_version, state, created_at
           FROM aggregate_snapshots
           WHERE stream_id = $1
           ORDER BY snapshot_version DESC
           LIMIT 1"#
    )
    .bind(&stream_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    match snapshot {
        Some(s) => Json(s).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no_snapshot"}))).into_response(),
    }
}

/// POST /streams/{aggregate_type}/{aggregate_id}/snapshot
async fn save_snapshot(
    State(state): State<Arc<AppState>>,
    Path((aggregate_type, aggregate_id)): Path<(String, String)>,
    Json(body): Json<SaveSnapshotRequest>,
) -> impl IntoResponse {
    let stream_id = format!("{}-{}", aggregate_type, aggregate_id);

    let result = sqlx::query(
        r#"INSERT INTO aggregate_snapshots
           (id, stream_id, aggregate_type, aggregate_id, snapshot_version, state, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())"#
    )
    .bind(Uuid::new_v4())
    .bind(&stream_id)
    .bind(&aggregate_type)
    .bind(&aggregate_id)
    .bind(body.snapshot_version)
    .bind(&body.state)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => (StatusCode::CREATED, Json(serde_json::json!({"status": "snapshot_saved"}))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ).into_response(),
    }
}

/// GET /projections/status
async fn projection_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let rows: Vec<(String, i64, i64, Option<DateTime<Utc>>)> = sqlx::query_as(
        r#"SELECT p.projection_name, p.last_processed_version,
                  COALESCE(MAX(e.event_version), 0) as latest_version,
                  p.updated_at
           FROM projection_checkpoints p
           LEFT JOIN event_store e ON e.aggregate_type = p.aggregate_type
           GROUP BY p.projection_name, p.last_processed_version, p.updated_at
           ORDER BY p.projection_name"#
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let status: Vec<serde_json::Value> = rows.into_iter().map(|(name, processed, latest, updated)| {
        serde_json::json!({
            "projection": name,
            "last_processed_version": processed,
            "latest_version": latest,
            "lag": latest - processed,
            "updated_at": updated
        })
    }).collect();

    Json(serde_json::json!({"projections": status})).into_response()
}

/// GET /health
async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "rust-event-store",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

/// GET /metrics
async fn metrics_handler() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let families = prometheus::gather();
    let mut buf = Vec::new();
    encoder.encode(&families, &mut buf).unwrap_or_default();
    (
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buf,
    )
}

// ─── Database Setup ───────────────────────────────────────────────────────────

async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS event_store (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            stream_id      VARCHAR(512) NOT NULL,
            aggregate_type VARCHAR(100) NOT NULL,
            aggregate_id   VARCHAR(255) NOT NULL,
            event_type     VARCHAR(100) NOT NULL,
            event_version  BIGINT NOT NULL,
            payload        JSONB NOT NULL DEFAULT '{}',
            metadata       JSONB NOT NULL DEFAULT '{}',
            checksum       VARCHAR(64) NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (stream_id, event_version)
        );
        CREATE INDEX IF NOT EXISTS idx_event_store_stream ON event_store (stream_id, event_version);
        CREATE INDEX IF NOT EXISTS idx_event_store_type   ON event_store (aggregate_type, created_at);

        CREATE TABLE IF NOT EXISTS aggregate_snapshots (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            stream_id        VARCHAR(512) NOT NULL,
            aggregate_type   VARCHAR(100) NOT NULL,
            aggregate_id     VARCHAR(255) NOT NULL,
            snapshot_version BIGINT NOT NULL,
            state            JSONB NOT NULL DEFAULT '{}',
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_stream ON aggregate_snapshots (stream_id, snapshot_version DESC);

        CREATE TABLE IF NOT EXISTS projection_dispatch_queue (
            stream_id      VARCHAR(512) PRIMARY KEY,
            aggregate_type VARCHAR(100) NOT NULL,
            from_version   BIGINT NOT NULL DEFAULT 0,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS projection_checkpoints (
            projection_name       VARCHAR(100) PRIMARY KEY,
            aggregate_type        VARCHAR(100) NOT NULL,
            last_processed_version BIGINT NOT NULL DEFAULT 0,
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    "#)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/remitflow".to_string());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8090".to_string())
        .parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .connect(&database_url)
        .await?;

    run_migrations(&pool).await?;
    info!("Database migrations applied");

    let metrics = Arc::new(Metrics::new()?);
    let state = Arc::new(AppState { pool, metrics });

    let app = Router::new()
        .route("/streams/:aggregate_type/:aggregate_id/events", post(append_events).get(read_events))
        .route("/streams/:aggregate_type/:aggregate_id/snapshot", get(get_snapshot).post(save_snapshot))
        .route("/projections/status", get(projection_status))
        .route("/health", get(health))
        .route("/metrics", get(metrics_handler))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    info!(port = port, "rust-event-store listening");
    axum::serve(listener, app).await?;
    Ok(())
}
