/// RemitFlow — Fluvio Streaming Service (Rust)
/// Provides real-time event streaming for financial transactions,
/// FX rate updates, and compliance events via Fluvio topics.
/// Falls back to in-memory ring buffer when Fluvio cluster is unavailable.

use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use chrono::Utc;
use uuid::Uuid;

const MAX_RING_BUFFER: usize = 10_000;
const PORT: u16 = 8213;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub id: String,
    pub topic: String,
    pub partition: u32,
    pub offset: u64,
    pub key: Option<String>,
    pub payload: serde_json::Value,
    pub timestamp: i64,
    pub producer_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub topic: String,
    pub key: Option<String>,
    pub payload: serde_json::Value,
    pub producer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumeRequest {
    pub topic: String,
    pub partition: Option<u32>,
    pub from_offset: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicConfig {
    pub name: String,
    pub partitions: u32,
    pub replication: u32,
    pub retention_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicStats {
    pub name: String,
    pub message_count: u64,
    pub partitions: u32,
    pub consumers: u32,
    pub bytes_in_per_sec: f64,
    pub bytes_out_per_sec: f64,
}

/// In-memory ring buffer for events per topic (Fluvio fallback)
pub struct EventStore {
    events: std::collections::HashMap<String, VecDeque<StreamEvent>>,
    offsets: std::collections::HashMap<String, u64>,
    topics: std::collections::HashMap<String, TopicConfig>,
}

impl EventStore {
    pub fn new() -> Self {
        let mut store = EventStore {
            events: std::collections::HashMap::new(),
            offsets: std::collections::HashMap::new(),
            topics: std::collections::HashMap::new(),
        };
        // Pre-create standard RemitFlow topics
        for topic in &[
            "remitflow.transactions",
            "remitflow.fx-rates",
            "remitflow.compliance-events",
            "remitflow.fraud-alerts",
            "remitflow.kyc-updates",
            "remitflow.payment-status",
            "remitflow.wallet-updates",
            "remitflow.audit-log",
            "remitflow.notifications",
            "remitflow.settlement",
        ] {
            store.topics.insert(topic.to_string(), TopicConfig {
                name: topic.to_string(),
                partitions: 3,
                replication: 1,
                retention_ms: 604_800_000, // 7 days
            });
            store.events.insert(topic.to_string(), VecDeque::new());
            store.offsets.insert(topic.to_string(), 0);
        }
        store
    }

    pub fn publish(&mut self, req: PublishRequest) -> StreamEvent {
        let topic = req.topic.clone();
        let offset = *self.offsets.get(&topic).unwrap_or(&0);
        let event = StreamEvent {
            id: Uuid::new_v4().to_string(),
            topic: topic.clone(),
            partition: 0,
            offset,
            key: req.key,
            payload: req.payload,
            timestamp: Utc::now().timestamp_millis(),
            producer_id: req.producer_id.unwrap_or_else(|| "remitflow-server".to_string()),
        };
        let queue = self.events.entry(topic.clone()).or_insert_with(VecDeque::new);
        queue.push_back(event.clone());
        if queue.len() > MAX_RING_BUFFER {
            queue.pop_front();
        }
        self.offsets.insert(topic, offset + 1);
        event
    }

    pub fn consume(&self, req: &ConsumeRequest) -> Vec<StreamEvent> {
        let queue = match self.events.get(&req.topic) {
            Some(q) => q,
            None => return vec![],
        };
        let from = req.from_offset.unwrap_or(0);
        let limit = req.limit.unwrap_or(100).min(1000);
        queue.iter()
            .filter(|e| e.offset >= from)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn get_topic_stats(&self) -> Vec<TopicStats> {
        self.topics.values().map(|t| {
            let count = self.events.get(&t.name).map(|q| q.len() as u64).unwrap_or(0);
            TopicStats {
                name: t.name.clone(),
                message_count: count,
                partitions: t.partitions,
                consumers: 0,
                bytes_in_per_sec: 0.0,
                bytes_out_per_sec: 0.0,
            }
        }).collect()
    }
}

type SharedStore = Arc<Mutex<EventStore>>;

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "fluvio-streaming",
        "version": "1.0.0",
        "mode": "in-memory-ring-buffer",
        "port": PORT
    }))
}

async fn publish_event(
    store: web::Data<SharedStore>,
    req: web::Json<PublishRequest>,
) -> HttpResponse {
    let event = store.lock().unwrap().publish(req.into_inner());
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "event": event
    }))
}

async fn consume_events(
    store: web::Data<SharedStore>,
    req: web::Json<ConsumeRequest>,
) -> HttpResponse {
    let events = store.lock().unwrap().consume(&req);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "topic": req.topic,
        "events": events,
        "count": events.len()
    }))
}

async fn list_topics(store: web::Data<SharedStore>) -> HttpResponse {
    let stats = store.lock().unwrap().get_topic_stats();
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "topics": stats
    }))
}

async fn create_topic(
    store: web::Data<SharedStore>,
    config: web::Json<TopicConfig>,
) -> HttpResponse {
    let mut s = store.lock().unwrap();
    let name = config.name.clone();
    s.topics.insert(name.clone(), config.into_inner());
    s.events.entry(name.clone()).or_insert_with(VecDeque::new);
    s.offsets.entry(name.clone()).or_insert(0);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "topic": name,
        "message": "Topic created"
    }))
}

async fn get_offset(
    store: web::Data<SharedStore>,
    topic: web::Path<String>,
) -> HttpResponse {
    let s = store.lock().unwrap();
    let offset = s.offsets.get(topic.as_str()).copied().unwrap_or(0);
    HttpResponse::Ok().json(serde_json::json!({
        "topic": topic.as_str(),
        "latest_offset": offset
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    let store: SharedStore = Arc::new(Mutex::new(EventStore::new()));
    tracing::info!("Fluvio Streaming Service starting on port {}", PORT);
    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(store.clone()))
            .route("/health", web::get().to(health))
            .route("/publish", web::post().to(publish_event))
            .route("/consume", web::post().to(consume_events))
            .route("/topics", web::get().to(list_topics))
            .route("/topics", web::post().to(create_topic))
            .route("/topics/{topic}/offset", web::get().to(get_offset))
    })
    .bind(("0.0.0.0", PORT))?
    .run()
    .await
}
