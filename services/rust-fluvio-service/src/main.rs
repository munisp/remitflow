// RemitFlow — Fluvio Real-Time Streaming Service (Rust)
// Fluvio is a cloud-native streaming platform built in Rust.
// Handles: real-time FX rate streaming, live transfer status updates,
//          compliance event streaming, analytics pipeline.
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
use tracing::info;
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

// ─── In-Memory Stream (replace with Fluvio client in production) ─────────────
type StreamStore = Arc<Mutex<HashMap<String, VecDeque<StreamEvent>>>>;

fn get_or_create_topic(store: &StreamStore, topic: &str) -> () {
    let mut s = store.lock().unwrap();
    s.entry(topic.to_string()).or_insert_with(VecDeque::new);
}

fn publish_event(store: &StreamStore, topic: &str, event_type: &str, payload: serde_json::Value) -> StreamEvent {
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
#[tokio::main]
async fn main() {
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
    axum::serve(listener, app).await.unwrap();
}
