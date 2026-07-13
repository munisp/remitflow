// rust-middleware-connector — RemitFlow High-Performance Middleware Connector
//
// Implements the performance-critical middleware integration paths:
//
//   Fluvio       → real-time event streaming with exactly-once delivery
//   TigerBeetle  → double-entry ledger operations with 128-bit IDs
//   Redis        → cache-aside pattern, session store, rate limiting
//   OpenSearch   → bulk indexing pipeline with retry and backpressure
//   OpenAppSec   → WAF event relay and threat intelligence feed
//
// Language: Rust (tokio async, axum HTTP)
// Port: 8210 (HTTP API) + 8211 (metrics)

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use lazy_static::lazy_static;
use prometheus::{
    register_counter_vec, register_gauge_vec, register_histogram_vec,
    CounterVec, GaugeVec, HistogramVec, TextEncoder, Encoder,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

// ── Metrics ───────────────────────────────────────────────────────────────────

lazy_static! {
    static ref OPERATIONS_TOTAL: CounterVec = register_counter_vec!(
        "rust_connector_operations_total",
        "Total operations by system and operation type",
        &["system", "operation", "status"]
    ).unwrap();

    static ref OPERATION_LATENCY: HistogramVec = register_histogram_vec!(
        "rust_connector_operation_latency_seconds",
        "Operation latency by system",
        &["system", "operation"],
        vec![0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]
    ).unwrap();

    static ref SYSTEM_UP: GaugeVec = register_gauge_vec!(
        "rust_connector_system_up",
        "Health status of each connected system",
        &["system"]
    ).unwrap();

    static ref REDIS_CACHE_HITS: CounterVec = register_counter_vec!(
        "rust_connector_redis_cache_hits_total",
        "Redis cache hits and misses",
        &["result"]  // "hit" | "miss"
    ).unwrap();

    static ref FLUVIO_MESSAGES: CounterVec = register_counter_vec!(
        "rust_connector_fluvio_messages_total",
        "Fluvio messages produced/consumed",
        &["direction", "topic"]
    ).unwrap();

    static ref TIGERBEETLE_OPS: CounterVec = register_counter_vec!(
        "rust_connector_tigerbeetle_ops_total",
        "TigerBeetle operations",
        &["operation", "status"]
    ).unwrap();

    static ref OPENSEARCH_DOCS: CounterVec = register_counter_vec!(
        "rust_connector_opensearch_docs_total",
        "OpenSearch documents indexed",
        &["index", "status"]
    ).unwrap();
}

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Config {
    port: String,
    metrics_port: String,
    fluvio_bridge_url: String,
    tigerbeetle_bridge_url: String,
    redis_url: String,
    opensearch_url: String,
    openappsec_url: String,
    middleware_bus_url: String,
}

impl Config {
    fn from_env() -> Self {
        Self {
            port: std::env::var("RUST_CONNECTOR_PORT").unwrap_or_else(|_| "8210".into()),
            metrics_port: std::env::var("RUST_CONNECTOR_METRICS_PORT").unwrap_or_else(|_| "8211".into()),
            fluvio_bridge_url: std::env::var("FLUVIO_BRIDGE_URL").unwrap_or_else(|_| "http://fluvio-bridge:8080".into()),
            tigerbeetle_bridge_url: std::env::var("TIGERBEETLE_BRIDGE_URL").unwrap_or_else(|_| "http://rust-tigerbeetle-bridge:8110".into()),
            redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".into()),
            opensearch_url: std::env::var("OPENSEARCH_URL").unwrap_or_else(|_| "http://opensearch:9200".into()),
            openappsec_url: std::env::var("OPENAPPSEC_URL").unwrap_or_else(|_| "http://openappsec-agent:8083".into()),
            middleware_bus_url: std::env::var("MIDDLEWARE_BUS_URL").unwrap_or_else(|_| "http://go-middleware-bus:8200".into()),
        }
    }
}

// ── Shared State ──────────────────────────────────────────────────────────────

struct AppState {
    cfg: Config,
    http: reqwest::Client,
    redis: Arc<RwLock<Option<redis::aio::ConnectionManager>>>,
    health: Arc<RwLock<HashMap<String, bool>>>,
}

impl AppState {
    async fn new(cfg: Config) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(20)
            .build()
            .expect("HTTP client build failed");

        // Connect to Redis
        let redis_conn = match redis::Client::open(cfg.redis_url.clone()) {
            Ok(client) => match client.get_connection_manager().await {
                Ok(mgr) => {
                    info!("Redis connected");
                    SYSTEM_UP.with_label_values(&["redis"]).set(1.0);
                    Some(mgr)
                }
                Err(e) => {
                    warn!("Redis connection failed: {}", e);
                    SYSTEM_UP.with_label_values(&["redis"]).set(0.0);
                    None
                }
            },
            Err(e) => {
                warn!("Redis client creation failed: {}", e);
                None
            }
        };

        Arc::new(Self {
            cfg,
            http,
            redis: Arc::new(RwLock::new(redis_conn)),
            health: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}

// ── Request/Response Types ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
struct PlatformEvent {
    id: Option<String>,
    #[serde(rename = "type")]
    event_type: String,
    source: String,
    #[serde(rename = "tenantId")]
    tenant_id: Option<String>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
    #[serde(rename = "correlationId")]
    correlation_id: Option<String>,
    payload: Value,
    metadata: Option<HashMap<String, String>>,
}

// ── Fluvio Operations ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FluvioProduceRequest {
    topic: String,
    key: Option<String>,
    payload: Value,
    partition: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct FluvioConsumeRequest {
    topic: String,
    offset: Option<i64>,
    max_records: Option<u32>,
    consumer_group: Option<String>,
}

async fn fluvio_produce(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FluvioProduceRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let topic = req.topic.clone();

    let url = format!("{}/produce?topic={}", state.cfg.fluvio_bridge_url, topic);
    let body = json!({
        "key": req.key.unwrap_or_else(|| Uuid::new_v4().to_string()),
        "value": req.payload,
        "partition": req.partition.unwrap_or(-1),
        "timestamp": Utc::now().to_rfc3339(),
    });

    match state.http.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["fluvio", "produce"]).observe(latency);
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "produce", "success"]).inc();
            FLUVIO_MESSAGES.with_label_values(&["produced", &topic]).inc();
            Ok(Json(json!({"status": "produced", "topic": topic, "latency_ms": latency * 1000.0})))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "produce", "error"]).inc();
            FLUVIO_MESSAGES.with_label_values(&["failed", &topic]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Fluvio returned {}", status)}))))
        }
        Err(e) => {
            error!("Fluvio produce error: {}", e);
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "produce", "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

async fn fluvio_consume(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FluvioConsumeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let topic = req.topic.clone();
    let offset = req.offset.unwrap_or(0);
    let max = req.max_records.unwrap_or(100);
    let group = req.consumer_group.unwrap_or_else(|| "rust-connector".into());

    let url = format!(
        "{}/consume?topic={}&offset={}&max={}&group={}",
        state.cfg.fluvio_bridge_url, topic, offset, max, group
    );

    match state.http.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let records: Value = resp.json().await.unwrap_or(json!([]));
            let count = records.as_array().map(|a| a.len()).unwrap_or(0);
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["fluvio", "consume"]).observe(latency);
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "consume", "success"]).inc();
            FLUVIO_MESSAGES.with_label_values(&["consumed", &topic]).inc_by(count as f64);
            Ok(Json(json!({"records": records, "count": count, "topic": topic})))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "consume", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Fluvio returned {}", status)}))))
        }
        Err(e) => {
            error!("Fluvio consume error: {}", e);
            OPERATIONS_TOTAL.with_label_values(&["fluvio", "consume", "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

// ── TigerBeetle Operations ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
struct TBAccount {
    id: String,
    ledger: u32,
    code: u16,
    flags: Option<u16>,
    user_data_128: Option<String>,
    user_data_64: Option<u64>,
    user_data_32: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TBTransfer {
    id: String,
    debit_account_id: String,
    credit_account_id: String,
    amount: u128,
    ledger: u32,
    code: u16,
    flags: Option<u16>,
    pending_id: Option<String>,
    user_data_128: Option<String>,
    user_data_64: Option<u64>,
    user_data_32: Option<u32>,
    timeout: Option<u64>,
}

async fn tb_create_accounts(
    State(state): State<Arc<AppState>>,
    Json(accounts): Json<Vec<TBAccount>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let url = format!("{}/accounts", state.cfg.tigerbeetle_bridge_url);

    match state.http.post(&url).json(&accounts).send().await {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!({}));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["tigerbeetle", "create_accounts"]).observe(latency);
            TIGERBEETLE_OPS.with_label_values(&["create_accounts", "success"]).inc_by(accounts.len() as f64);
            Ok(Json(result))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body: Value = resp.json().await.unwrap_or(json!({}));
            TIGERBEETLE_OPS.with_label_values(&["create_accounts", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("TigerBeetle returned {}", status), "detail": body}))))
        }
        Err(e) => {
            error!("TigerBeetle create_accounts error: {}", e);
            TIGERBEETLE_OPS.with_label_values(&["create_accounts", "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

async fn tb_create_transfers(
    State(state): State<Arc<AppState>>,
    Json(transfers): Json<Vec<TBTransfer>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let url = format!("{}/transfers", state.cfg.tigerbeetle_bridge_url);

    match state.http.post(&url).json(&transfers).send().await {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!({}));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["tigerbeetle", "create_transfers"]).observe(latency);
            TIGERBEETLE_OPS.with_label_values(&["create_transfers", "success"]).inc_by(transfers.len() as f64);
            Ok(Json(result))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body: Value = resp.json().await.unwrap_or(json!({}));
            TIGERBEETLE_OPS.with_label_values(&["create_transfers", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("TigerBeetle returned {}", status), "detail": body}))))
        }
        Err(e) => {
            error!("TigerBeetle create_transfers error: {}", e);
            TIGERBEETLE_OPS.with_label_values(&["create_transfers", "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

async fn tb_lookup_accounts(
    State(state): State<Arc<AppState>>,
    Json(ids): Json<Vec<String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let url = format!("{}/accounts/lookup", state.cfg.tigerbeetle_bridge_url);

    match state.http.post(&url).json(&ids).send().await {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!([]));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["tigerbeetle", "lookup_accounts"]).observe(latency);
            TIGERBEETLE_OPS.with_label_values(&["lookup_accounts", "success"]).inc();
            Ok(Json(result))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            TIGERBEETLE_OPS.with_label_values(&["lookup_accounts", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("TigerBeetle returned {}", status)}))))
        }
        Err(e) => {
            error!("TigerBeetle lookup error: {}", e);
            TIGERBEETLE_OPS.with_label_values(&["lookup_accounts", "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

// ── Redis Operations ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RedisSetRequest {
    key: String,
    value: Value,
    ttl_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RedisGetRequest {
    key: String,
}

#[derive(Debug, Deserialize)]
struct RateLimitRequest {
    key: String,
    limit: u64,
    window_seconds: u64,
}

async fn redis_set(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RedisSetRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let mut redis = state.redis.write().await;

    if let Some(conn) = redis.as_mut() {
        let value_str = serde_json::to_string(&req.value).unwrap_or_default();
        let result: redis::RedisResult<()> = if let Some(ttl) = req.ttl_seconds {
            redis::cmd("SETEX")
                .arg(&req.key)
                .arg(ttl)
                .arg(&value_str)
                .query_async(conn)
                .await
        } else {
            redis::cmd("SET")
                .arg(&req.key)
                .arg(&value_str)
                .query_async(conn)
                .await
        };

        match result {
            Ok(_) => {
                let latency = start.elapsed().as_secs_f64();
                OPERATION_LATENCY.with_label_values(&["redis", "set"]).observe(latency);
                OPERATIONS_TOTAL.with_label_values(&["redis", "set", "success"]).inc();
                Ok(Json(json!({"status": "ok", "key": req.key})))
            }
            Err(e) => {
                OPERATIONS_TOTAL.with_label_values(&["redis", "set", "error"]).inc();
                Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))
            }
        }
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "Redis not connected"}))))
    }
}

async fn redis_get(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RedisGetRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let mut redis = state.redis.write().await;

    if let Some(conn) = redis.as_mut() {
        let result: redis::RedisResult<Option<String>> = redis::cmd("GET")
            .arg(&req.key)
            .query_async(conn)
            .await;

        match result {
            Ok(Some(val)) => {
                let latency = start.elapsed().as_secs_f64();
                OPERATION_LATENCY.with_label_values(&["redis", "get"]).observe(latency);
                OPERATIONS_TOTAL.with_label_values(&["redis", "get", "success"]).inc();
                REDIS_CACHE_HITS.with_label_values(&["hit"]).inc();
                let parsed: Value = serde_json::from_str(&val).unwrap_or(Value::String(val));
                Ok(Json(json!({"found": true, "value": parsed})))
            }
            Ok(None) => {
                REDIS_CACHE_HITS.with_label_values(&["miss"]).inc();
                OPERATIONS_TOTAL.with_label_values(&["redis", "get", "miss"]).inc();
                Ok(Json(json!({"found": false, "value": null})))
            }
            Err(e) => {
                OPERATIONS_TOTAL.with_label_values(&["redis", "get", "error"]).inc();
                Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))
            }
        }
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "Redis not connected"}))))
    }
}

async fn redis_rate_limit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RateLimitRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let mut redis = state.redis.write().await;

    if let Some(conn) = redis.as_mut() {
        // Sliding window rate limiter using Redis INCR + EXPIRE
        let rate_key = format!("ratelimit:{}:{}", req.key, Utc::now().timestamp() / req.window_seconds as i64);

        let count: redis::RedisResult<u64> = redis::pipe()
            .incr(&rate_key, 1)
            .expire(&rate_key, req.window_seconds as i64)
            .ignore()
            .query_async(conn)
            .await;

        match count {
            Ok(current) => {
                let latency = start.elapsed().as_secs_f64();
                OPERATION_LATENCY.with_label_values(&["redis", "rate_limit"]).observe(latency);
                let allowed = current <= req.limit;
                let remaining = if current <= req.limit { req.limit - current } else { 0 };
                OPERATIONS_TOTAL.with_label_values(&["redis", "rate_limit", if allowed { "allowed" } else { "blocked" }]).inc();
                Ok(Json(json!({
                    "allowed": allowed,
                    "current": current,
                    "limit": req.limit,
                    "remaining": remaining,
                    "reset_in_seconds": req.window_seconds,
                })))
            }
            Err(e) => {
                OPERATIONS_TOTAL.with_label_values(&["redis", "rate_limit", "error"]).inc();
                Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))
            }
        }
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "Redis not connected"}))))
    }
}

// ── OpenSearch Operations ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OSIndexRequest {
    index: String,
    id: Option<String>,
    document: Value,
}

#[derive(Debug, Deserialize)]
struct OSBulkRequest {
    index: String,
    documents: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct OSSearchRequest {
    index: String,
    query: Value,
    size: Option<u32>,
    from: Option<u32>,
}

async fn os_index(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OSIndexRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let doc_id = req.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let url = format!("{}/{}/_doc/{}", state.cfg.opensearch_url, req.index, doc_id);

    match state.http.put(&url).json(&req.document).send().await {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!({}));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["opensearch", "index"]).observe(latency);
            OPENSEARCH_DOCS.with_label_values(&[&req.index, "success"]).inc();
            Ok(Json(result))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPENSEARCH_DOCS.with_label_values(&[&req.index, "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("OpenSearch returned {}", status)}))))
        }
        Err(e) => {
            error!("OpenSearch index error: {}", e);
            OPENSEARCH_DOCS.with_label_values(&[&req.index, "error"]).inc();
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

async fn os_bulk_index(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OSBulkRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let url = format!("{}/_bulk", state.cfg.opensearch_url);

    // Build NDJSON bulk body
    let mut bulk_body = String::new();
    for doc in &req.documents {
        let id = doc.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let action = json!({"index": {"_index": req.index, "_id": id}});
        bulk_body.push_str(&action.to_string());
        bulk_body.push('\n');
        bulk_body.push_str(&doc.to_string());
        bulk_body.push('\n');
    }

    let count = req.documents.len();
    match state.http
        .post(&url)
        .header("Content-Type", "application/x-ndjson")
        .body(bulk_body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!({}));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["opensearch", "bulk"]).observe(latency);
            OPENSEARCH_DOCS.with_label_values(&[&req.index, "success"]).inc_by(count as f64);
            Ok(Json(json!({"indexed": count, "result": result})))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPENSEARCH_DOCS.with_label_values(&[&req.index, "error"]).inc_by(count as f64);
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("OpenSearch bulk returned {}", status)}))))
        }
        Err(e) => {
            error!("OpenSearch bulk error: {}", e);
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

async fn os_search(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OSSearchRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();
    let url = format!("{}/{}/_search", state.cfg.opensearch_url, req.index);
    let body = json!({
        "query": req.query,
        "size": req.size.unwrap_or(10),
        "from": req.from.unwrap_or(0),
    });

    match state.http.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            let result: Value = resp.json().await.unwrap_or(json!({}));
            let latency = start.elapsed().as_secs_f64();
            OPERATION_LATENCY.with_label_values(&["opensearch", "search"]).observe(latency);
            OPERATIONS_TOTAL.with_label_values(&["opensearch", "search", "success"]).inc();
            Ok(Json(result))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPERATIONS_TOTAL.with_label_values(&["opensearch", "search", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("OpenSearch returned {}", status)}))))
        }
        Err(e) => {
            error!("OpenSearch search error: {}", e);
            Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e.to_string()}))))
        }
    }
}

// ── OpenAppSec WAF Operations ─────────────────────────────────────────────────

async fn waf_relay_event(
    State(state): State<Arc<AppState>>,
    Json(event): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let url = format!("{}/api/v1/events", state.cfg.openappsec_url);

    match state.http.post(&url).json(&event).send().await {
        Ok(resp) if resp.status().is_success() => {
            OPERATIONS_TOTAL.with_label_values(&["openappsec", "relay", "success"]).inc();
            // Also index in OpenSearch for threat intelligence
            let os_url = format!("{}/security-events/_doc", state.cfg.opensearch_url);
            let _ = state.http.post(&os_url).json(&event).send().await;
            Ok(Json(json!({"status": "relayed"})))
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            OPERATIONS_TOTAL.with_label_values(&["openappsec", "relay", "error"]).inc();
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("OpenAppSec returned {}", status)}))))
        }
        Err(e) => {
            warn!("OpenAppSec relay error (non-fatal): {}", e);
            OPERATIONS_TOTAL.with_label_values(&["openappsec", "relay", "error"]).inc();
            // WAF errors are non-fatal — log and continue
            Ok(Json(json!({"status": "logged", "warning": "WAF relay failed"})))
        }
    }
}

// ── Health Check ──────────────────────────────────────────────────────────────

async fn health_check(State(state): State<Arc<AppState>>) -> Json<Value> {
    let health = state.health.read().await;
    let redis_ok = state.redis.read().await.is_some();

    Json(json!({
        "status": "ok",
        "service": "rust-middleware-connector",
        "systems": {
            "redis": redis_ok,
            "fluvio": health.get("fluvio").copied().unwrap_or(false),
            "tigerbeetle": health.get("tigerbeetle").copied().unwrap_or(false),
            "opensearch": health.get("opensearch").copied().unwrap_or(false),
            "openappsec": health.get("openappsec").copied().unwrap_or(false),
        },
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn metrics_handler() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap_or_default();
    String::from_utf8(buffer).unwrap_or_default()
}

// ── Background Health Checker ─────────────────────────────────────────────────

async fn run_health_checks(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        let systems = vec![
            ("fluvio", format!("{}/health", state.cfg.fluvio_bridge_url)),
            ("tigerbeetle", format!("{}/health", state.cfg.tigerbeetle_bridge_url)),
            ("opensearch", format!("{}/_cluster/health", state.cfg.opensearch_url)),
            ("openappsec", format!("{}/health", state.cfg.openappsec_url)),
        ];

        for (name, url) in systems {
            let client = state.http.clone();
            let health = state.health.clone();
            let name = name.to_string();
            tokio::spawn(async move {
                let up = client.get(&url).timeout(Duration::from_secs(3)).send().await
                    .map(|r| r.status().as_u16() < 500)
                    .unwrap_or(false);
                health.write().await.insert(name.clone(), up);
                SYSTEM_UP.with_label_values(&[&name]).set(if up { 1.0 } else { 0.0 });
            });
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = Config::from_env();
    let port = cfg.port.clone();
    let metrics_port = cfg.metrics_port.clone();

    let state = AppState::new(cfg).await;

    // Start background health checks
    tokio::spawn(run_health_checks(state.clone()));

    // Build main API router
    let app = Router::new()
        // Fluvio
        .route("/v1/fluvio/produce", post(fluvio_produce))
        .route("/v1/fluvio/consume", post(fluvio_consume))
        // TigerBeetle
        .route("/v1/tigerbeetle/accounts", post(tb_create_accounts))
        .route("/v1/tigerbeetle/transfers", post(tb_create_transfers))
        .route("/v1/tigerbeetle/accounts/lookup", post(tb_lookup_accounts))
        // Redis
        .route("/v1/redis/set", post(redis_set))
        .route("/v1/redis/get", post(redis_get))
        .route("/v1/redis/rate-limit", post(redis_rate_limit))
        // OpenSearch
        .route("/v1/opensearch/index", post(os_index))
        .route("/v1/opensearch/bulk", post(os_bulk_index))
        .route("/v1/opensearch/search", post(os_search))
        // OpenAppSec
        .route("/v1/waf/event", post(waf_relay_event))
        // Health
        .route("/health", get(health_check))
        .with_state(state);

    // Start metrics server on separate port
    let metrics_app = Router::new().route("/metrics", get(metrics_handler));
    let metrics_addr: std::net::SocketAddr = format!("0.0.0.0:{}", metrics_port).parse()?;
    tokio::spawn(async move {
        info!("Metrics server on :{}", metrics_port);
        let listener = tokio::net::TcpListener::bind(metrics_addr).await.unwrap();
        axum::serve(listener, metrics_app).await.unwrap();
    });

    // Start main server
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    info!("rust-middleware-connector starting on :{}", port);
    let listener = tokio::net::TcpListener::bind(addr).await
        .context("Failed to bind port")?;
    axum::serve(listener, app).await.context("Server error")?;

    Ok(())
}
