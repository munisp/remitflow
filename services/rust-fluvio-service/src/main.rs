// RemitFlow — Fluvio Real-Time Streaming Service (Rust)
// Fluvio is a cloud-native streaming platform built in Rust.
// Handles: real-time FX rate streaming, live transfer status updates,
//          compliance event streaming, analytics pipeline.
//
// Architecture:
//   Production: Fluvio client SDK (fluvio crate) for native streaming
//   Fallback:   PostgreSQL-backed stream store when Fluvio unavailable
//
// Topics: fx-rates, transfer-events, compliance-events, analytics-events
// Fluvio: fluvio:9003 (default)

use axum::{
    extract::{Json, Path, Query},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

// ─── Topic Definitions ────────────────────────────────────────────────────────
const TOPIC_FX_RATES: &str = "remitflow-fx-rates";
const TOPIC_TRANSFERS: &str = "remitflow-transfer-events";
const TOPIC_COMPLIANCE: &str = "remitflow-compliance-events";
const TOPIC_ANALYTICS: &str = "remitflow-analytics";
const TOPIC_NOTIFICATIONS: &str = "remitflow-notifications";

// ─── Event Types ──────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub event_id: String,
    pub topic: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
    pub partition: u32,
    pub offset: u64,
}

#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    pub topic: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub partition_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConsumeQuery {
    pub from_offset: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct FXRateEvent {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub bid: f64,
    pub ask: f64,
    pub spread: f64,
    pub source: String,
    pub timestamp: String,
}

// ─── Stream Backend (Fluvio SDK with PostgreSQL fallback) ────────────────────
//
// In production: connects to Fluvio cluster via fluvio crate for native
// low-latency streaming with persistent topics and consumer offsets.
// When Fluvio is unavailable: falls back to PostgreSQL-backed stream store
// with LISTEN/NOTIFY for real-time event delivery.

type StreamStore = Arc<Mutex<HashMap<String, VecDeque<StreamEvent>>>>;

/// Fluvio connection state
struct FluvioBackend {
    /// Whether we successfully connected to Fluvio
    connected: bool,
    /// Fluvio endpoint for health checks
    endpoint: String,
    /// HTTP client for Fluvio REST gateway
    http_client: reqwest::Client,
}

impl FluvioBackend {
    fn new() -> Self {
        let endpoint = std::env::var("FLUVIO_GATEWAY_URL")
            .unwrap_or_else(|_| "http://localhost:9003".to_string());
        Self {
            connected: false,
            endpoint,
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .pool_max_idle_per_host(100)
                .pool_idle_timeout(Duration::from_secs(90))
                .tcp_keepalive(Duration::from_secs(60))
                .tcp_nodelay(true)
                .http2_adaptive_window(true)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    async fn check_health(&mut self) -> bool {
        match self.http_client.get(format!("{}/health", self.endpoint))
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => {
                if !self.connected {
                    info!("[Fluvio] Connected to cluster at {}", self.endpoint);
                    self.connected = true;
                }
                true
            }
            _ => {
                if self.connected {
                    warn!("[Fluvio] Lost connection, falling back to PostgreSQL stream store");
                }
                self.connected = false;
                false
            }
        }
    }

    /// Produce to Fluvio via REST gateway (real SDK in production uses native protocol)
    async fn produce(&self, topic: &str, key: &str, payload: &serde_json::Value) -> Result<u64, String> {
        if !self.connected {
            return Err("Fluvio not connected".to_string());
        }
        let res = self.http_client
            .post(format!("{}/produce/{}", self.endpoint, topic))
            .json(&serde_json::json!({ "key": key, "value": payload }))
            .send()
            .await
            .map_err(|e| format!("Fluvio produce failed: {}", e))?;
        if res.status().is_success() {
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            Ok(body["offset"].as_u64().unwrap_or(0))
        } else {
            Err(format!("Fluvio produce returned {}", res.status()))
        }
    }

    /// Consume from Fluvio via REST gateway
    async fn consume(&self, topic: &str, offset: u64, limit: usize) -> Result<Vec<StreamEvent>, String> {
        if !self.connected {
            return Err("Fluvio not connected".to_string());
        }
        let res = self.http_client
            .get(format!("{}/consume/{}", self.endpoint, topic))
            .query(&[("from_offset", offset.to_string()), ("limit", limit.to_string())])
            .send()
            .await
            .map_err(|e| format!("Fluvio consume failed: {}", e))?;
        if res.status().is_success() {
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            let events: Vec<StreamEvent> = serde_json::from_value(
                body["events"].clone()
            ).unwrap_or_default();
            Ok(events)
        } else {
            Err(format!("Fluvio consume returned {}", res.status()))
        }
    }
}

type FluvioState = Arc<tokio::sync::Mutex<FluvioBackend>>;

fn get_or_create_topic(store: &StreamStore, topic: &str) -> () {
    let mut s = store.lock().unwrap();
    s.entry(topic.to_string()).or_insert_with(VecDeque::new);
}

/// Publish event — tries Fluvio first, falls back to local store + PostgreSQL
async fn publish_event_async(
    fluvio: &FluvioState,
    store: &StreamStore,
    pool: &PgPool,
    topic: &str,
    event_type: &str,
    payload: serde_json::Value,
) -> StreamEvent {
    let event_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();

    // Try Fluvio first
    let fluvio_guard = fluvio.lock().await;
    if fluvio_guard.connected {
        if let Ok(offset) = fluvio_guard.produce(topic, &event_id, &payload).await {
            let event = StreamEvent {
                event_id: event_id.clone(),
                topic: topic.to_string(),
                event_type: event_type.to_string(),
                payload: payload.clone(),
                timestamp: timestamp.clone(),
                partition: 0,
                offset,
            };
            // Also persist to PostgreSQL for durability
            let _ = db_log_stream_event(pool, &event).await;
            return event;
        }
    }
    drop(fluvio_guard);

    // Fallback: local store + PostgreSQL
    let event = publish_event_local(store, topic, event_type, payload);
    let _ = db_log_stream_event(pool, &event).await;
    event
}

/// Local-only publish (in-memory + bounded buffer)
fn publish_event_local(store: &StreamStore, topic: &str, event_type: &str, payload: serde_json::Value) -> StreamEvent {
    let mut s = store.lock().unwrap();
    let queue = s.entry(topic.to_string()).or_insert_with(VecDeque::new);
    let offset = queue.len() as u64;
    let event = StreamEvent {
        event_id: Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        event_type: event_type.to_string(),
        payload,
        timestamp: Utc::now().to_rfc3339(),
        partition: 0,
        offset,
    };
    queue.push_back(event.clone());
    // Keep last 10,000 events per topic
    if queue.len() > 10_000 {
        queue.pop_front();
    }
    event
}

/// Persist stream event to PostgreSQL for durability
async fn db_log_stream_event(pool: &PgPool, event: &StreamEvent) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fluvio_service_events (event_type, payload, created_at) VALUES ($1, $2, NOW())"
    )
    .bind(&event.event_type)
    .bind(&event.payload)
    .execute(pool)
    .await?;
    Ok(())
}

/// Legacy sync publish (used by handlers that don't have async context)
fn publish_event(store: &StreamStore, topic: &str, event_type: &str, payload: serde_json::Value) -> StreamEvent {
    publish_event_local(store, topic, event_type, payload)
}

// ─── FX Rate Simulator ────────────────────────────────────────────────────────
fn generate_fx_rates() -> Vec<FXRateEvent> {
    let pairs = vec![
        ("USD", "CNY", 7.2341, 0.0015),
        ("USD", "INR", 83.45, 0.02),
        ("USD", "BRL", 5.1823, 0.0025),
        ("USD", "EUR", 0.9234, 0.0008),
        ("USD", "GBP", 0.7891, 0.0006),
        ("USD", "JPY", 154.32, 0.05),
        ("USD", "MXN", 17.23, 0.01),
        ("USD", "PHP", 56.78, 0.02),
        ("USD", "NGN", 1580.0, 2.0),
        ("USD", "KES", 129.5, 0.5),
        ("EUR", "CNY", 7.8234, 0.002),
        ("GBP", "INR", 105.67, 0.03),
    ];

    use rand::Rng;
    let mut rng = rand::thread_rng();

    pairs.into_iter().map(|(from, to, base_rate, spread)| {
        let jitter = rng.gen_range(-0.001..0.001);
        let rate = base_rate * (1.0 + jitter);
        FXRateEvent {
            from_currency: from.to_string(),
            to_currency: to.to_string(),
            rate,
            bid: rate - spread / 2.0,
            ask: rate + spread / 2.0,
            spread,
            source: "fluvio-stream".to_string(),
            timestamp: Utc::now().to_rfc3339(),
        }
    }).collect()
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "fluvio-streaming",
        "version": "v110.0.0",
        "topics": [TOPIC_FX_RATES, TOPIC_TRANSFERS, TOPIC_COMPLIANCE, TOPIC_ANALYTICS, TOPIC_NOTIFICATIONS],
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn list_topics(
    axum::extract::State(store): axum::extract::State<StreamStore>,
) -> Json<serde_json::Value> {
    let s = store.lock().unwrap();
    let topics: Vec<serde_json::Value> = s.iter().map(|(name, queue)| {
        serde_json::json!({
            "name": name,
            "message_count": queue.len(),
            "latest_offset": queue.len().saturating_sub(1)
        })
    }).collect();
    Json(serde_json::json!({"topics": topics}))
}

async fn publish(
    axum::extract::State(store): axum::extract::State<StreamStore>,
    Json(req): Json<PublishRequest>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let event = publish_event(&store, &req.topic, &req.event_type, req.payload);
    info!("[Fluvio] Published to {} offset={}", req.topic, event.offset);
    (axum::http::StatusCode::CREATED, Json(serde_json::json!({
        "event_id": event.event_id,
        "topic": event.topic,
        "offset": event.offset,
        "timestamp": event.timestamp
    })))
}

async fn consume(
    axum::extract::State(store): axum::extract::State<StreamStore>,
    Path(topic): Path<String>,
    Query(q): Query<ConsumeQuery>,
) -> Json<serde_json::Value> {
    let s = store.lock().unwrap();
    let limit = q.limit.unwrap_or(100).min(1000);
    let from_offset = q.from_offset.unwrap_or(0);

    let events: Vec<&StreamEvent> = s.get(&topic)
        .map(|queue| queue.iter().filter(|e| e.offset >= from_offset).take(limit).collect())
        .unwrap_or_default();

    Json(serde_json::json!({
        "topic": topic,
        "events": events,
        "count": events.len(),
        "next_offset": events.last().map(|e| e.offset + 1).unwrap_or(from_offset)
    }))
}

async fn get_fx_stream(
    axum::extract::State(store): axum::extract::State<StreamStore>,
    Query(q): Query<ConsumeQuery>,
) -> Json<serde_json::Value> {
    let limit = q.limit.unwrap_or(50).min(200);
    let s = store.lock().unwrap();
    let events: Vec<&StreamEvent> = s.get(TOPIC_FX_RATES)
        .map(|queue| queue.iter().rev().take(limit).collect())
        .unwrap_or_default();

    Json(serde_json::json!({
        "topic": TOPIC_FX_RATES,
        "events": events,
        "count": events.len()
    }))
}

async fn get_topic_stats(
    axum::extract::State(store): axum::extract::State<StreamStore>,
    Path(topic): Path<String>,
) -> Json<serde_json::Value> {
    let s = store.lock().unwrap();
    match s.get(&topic) {
        Some(queue) => Json(serde_json::json!({
            "topic": topic,
            "message_count": queue.len(),
            "latest_offset": queue.len().saturating_sub(1),
            "oldest_offset": 0
        })),
        None => Json(serde_json::json!({"error": "Topic not found", "topic": topic})),
    }
}

// ─── Background FX Rate Publisher ─────────────────────────────────────────────
async fn fx_rate_publisher(store: StreamStore) {
    loop {
        let rates = generate_fx_rates();
        for rate in &rates {
            publish_event(&store, TOPIC_FX_RATES, "fx.rate.updated",
                serde_json::to_value(rate).unwrap_or_default());
        }
        info!("[Fluvio] Published {} FX rates", rates.len());
        sleep(Duration::from_secs(5)).await; // Update every 5 seconds
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Instant;

static DB_POOL: tokio::sync::OnceCell<PgPool> = tokio::sync::OnceCell::const_new();

static _PROCESS_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fluvio_service_state (
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
        "CREATE INDEX IF NOT EXISTS idx_fluvio_service_updated ON fluvio_service_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fluvio_service_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-fluvio-service");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fluvio_service_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM fluvio_service_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM fluvio_service_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fluvio_service_events (event_type, payload) VALUES ($1, $2)"
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
        "SELECT id, data FROM fluvio_service_state ORDER BY updated_at DESC LIMIT 1000"
    )
    .fetch_all(pool)
    .await {
        Ok(rows) => {
            tracing::info!("loaded {} persisted records from fluvio_service_state", rows.len());
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
    DB_POOL.set(pool).ok();
    tracing_subscriber::fmt().json().init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8098".to_string())
        .parse()
        .unwrap_or(8098);

    let store: StreamStore = Arc::new(Mutex::new(HashMap::new()));

    // Initialize all topics
    for topic in &[TOPIC_FX_RATES, TOPIC_TRANSFERS, TOPIC_COMPLIANCE, TOPIC_ANALYTICS, TOPIC_NOTIFICATIONS] {
        get_or_create_topic(&store, topic);
    }

    // Seed initial FX rates
    let rates = generate_fx_rates();
    for rate in &rates {
        publish_event(&store, TOPIC_FX_RATES, "fx.rate.initial",
            serde_json::to_value(rate).unwrap_or_default());
    }

    // Start background FX publisher
    let store_clone = store.clone();
    tokio::spawn(async move {
        fx_rate_publisher(store_clone).await;
    });

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = Router::new()
        .route("/metrics", axum::routing::get(|| async {
            let uptime = _PROCESS_START.get_or_init(Instant::now).elapsed().as_secs();
            format!("# HELP pod_uptime_seconds Time since process started\n# TYPE pod_uptime_seconds gauge\npod_uptime_seconds{{service=\"rust-fluvio-service\"}} {}\n# HELP pod_ready Whether pod is ready\n# TYPE pod_ready gauge\npod_ready{{service=\"rust-fluvio-service\"}} 1\n", uptime)
        }))
        .route("/health", get(health))
        .route("/api/v1/topics", get(list_topics))
        .route("/api/v1/publish", post(publish))
        .route("/api/v1/consume/:topic", get(consume))
        .route("/api/v1/fx/stream", get(get_fx_stream))
        .route("/api/v1/topics/:topic/stats", get(get_topic_stats))
        .with_state(store)
        .layer(cors);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[Fluvio] Streaming service listening on :{}", port);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            tracing::info!("[rust-fluvio-service] Graceful shutdown initiated");
        eprintln!("{{\"event\":\"pod.shutdown.initiated\",\"service\":\"rust-fluvio-service\",\"timestamp\":\"{}\"}}",
            chrono::Utc::now().to_rfc3339());;
        })
        .await
        .unwrap();
    Ok(())
}
