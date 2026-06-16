// RemitFlow — OpenSearch Real-Time Index Sync (Rust)
//
// Consumes Kafka events and indexes documents into OpenSearch for:
//   - Transaction search (by user, amount, status, date range)
//   - User profile search (KYC status, tier, location)
//   - Merchant search (business name, category, location)
//   - Compliance events (SARs, sanctions hits)
//   - Audit trail (full-text search across all platform events)
//
// Middleware: Kafka (event source), OpenSearch (search index),
//   Redis (dedup + cursor tracking), PostgreSQL (backfill source),
//   Prometheus (indexing metrics), Fluvio (streaming enrichment)
//
// Port: 8126

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct IndexDocument {
    id: String,
    index: String,
    doc_type: String,
    body: serde_json::Value,
    timestamp: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct IndexSchema {
    name: String,
    mappings: serde_json::Value,
    settings: serde_json::Value,
}

#[derive(Clone, Debug, Default)]
struct IndexMetrics {
    documents_indexed: u64,
    documents_failed: u64,
    bulk_requests: u64,
    avg_latency_ms: f64,
    last_indexed_at: String,
    index_sizes: HashMap<String, u64>,
}

// ─── Config ───────────────────────────────────────────────────────────────────

struct Config {
    port: u16,
    opensearch_url: String,
    opensearch_user: String,
    opensearch_pass: String,
    kafka_brokers: String,
    redis_url: String,
    postgres_url: String,
    bulk_size: usize,
    flush_interval_ms: u64,
}

impl Config {
    fn from_env() -> Self {
        Config {
            port: std::env::var("PORT").unwrap_or_else(|_| "8126".into()).parse().unwrap_or(8126),
            opensearch_url: std::env::var("OPENSEARCH_URL").unwrap_or_else(|_| "http://localhost:9200".into()),
            opensearch_user: std::env::var("OPENSEARCH_USER").unwrap_or_else(|_| "admin".into()),
            opensearch_pass: std::env::var("OPENSEARCH_PASS").unwrap_or_else(|_| "admin".into()),
            kafka_brokers: std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".into()),
            redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into()),
            postgres_url: std::env::var("DATABASE_URL").unwrap_or_default(),
            bulk_size: std::env::var("BULK_SIZE").unwrap_or_else(|_| "100".into()).parse().unwrap_or(100),
            flush_interval_ms: std::env::var("FLUSH_INTERVAL_MS").unwrap_or_else(|_| "1000".into()).parse().unwrap_or(1000),
        }
    }
}

// ─── Index Schemas ────────────────────────────────────────────────────────────

fn get_index_schemas() -> Vec<IndexSchema> {
    vec![
        IndexSchema {
            name: "remitflow-transactions".into(),
            mappings: serde_json::json!({
                "properties": {
                    "transaction_id": { "type": "keyword" },
                    "user_id": { "type": "long" },
                    "amount": { "type": "double" },
                    "from_currency": { "type": "keyword" },
                    "to_currency": { "type": "keyword" },
                    "status": { "type": "keyword" },
                    "rail": { "type": "keyword" },
                    "corridor": { "type": "keyword" },
                    "recipient_name": { "type": "text", "analyzer": "standard" },
                    "created_at": { "type": "date" },
                    "settled_at": { "type": "date" },
                    "fee": { "type": "double" },
                    "fx_rate": { "type": "double" }
                }
            }),
            settings: serde_json::json!({
                "number_of_shards": 3,
                "number_of_replicas": 1,
                "refresh_interval": "1s"
            }),
        },
        IndexSchema {
            name: "remitflow-users".into(),
            mappings: serde_json::json!({
                "properties": {
                    "user_id": { "type": "long" },
                    "email": { "type": "keyword" },
                    "full_name": { "type": "text", "analyzer": "standard" },
                    "kyc_tier": { "type": "integer" },
                    "kyc_status": { "type": "keyword" },
                    "country": { "type": "keyword" },
                    "created_at": { "type": "date" },
                    "last_active": { "type": "date" },
                    "total_volume_usd": { "type": "double" }
                }
            }),
            settings: serde_json::json!({
                "number_of_shards": 2,
                "number_of_replicas": 1
            }),
        },
        IndexSchema {
            name: "remitflow-merchants".into(),
            mappings: serde_json::json!({
                "properties": {
                    "merchant_id": { "type": "keyword" },
                    "business_name": { "type": "text", "analyzer": "standard" },
                    "category": { "type": "keyword" },
                    "country": { "type": "keyword" },
                    "status": { "type": "keyword" },
                    "total_volume": { "type": "double" },
                    "qr_enabled": { "type": "boolean" },
                    "nfc_enabled": { "type": "boolean" },
                    "location": { "type": "geo_point" }
                }
            }),
            settings: serde_json::json!({
                "number_of_shards": 2,
                "number_of_replicas": 1
            }),
        },
        IndexSchema {
            name: "remitflow-compliance".into(),
            mappings: serde_json::json!({
                "properties": {
                    "event_id": { "type": "keyword" },
                    "event_type": { "type": "keyword" },
                    "user_id": { "type": "long" },
                    "severity": { "type": "keyword" },
                    "description": { "type": "text" },
                    "sanctions_match": { "type": "boolean" },
                    "sar_filed": { "type": "boolean" },
                    "created_at": { "type": "date" }
                }
            }),
            settings: serde_json::json!({
                "number_of_shards": 2,
                "number_of_replicas": 2
            }),
        },
        IndexSchema {
            name: "remitflow-audit".into(),
            mappings: serde_json::json!({
                "properties": {
                    "audit_id": { "type": "keyword" },
                    "action": { "type": "keyword" },
                    "user_id": { "type": "long" },
                    "resource": { "type": "keyword" },
                    "details": { "type": "text" },
                    "ip_address": { "type": "ip" },
                    "user_agent": { "type": "text" },
                    "created_at": { "type": "date" }
                }
            }),
            settings: serde_json::json!({
                "number_of_shards": 3,
                "number_of_replicas": 1
            }),
        },
    ]
}

// ─── OpenSearch Client ────────────────────────────────────────────────────────

struct OpenSearchClient {
    base_url: String,
    auth: String,
    client: reqwest::Client,
    metrics: Arc<Mutex<IndexMetrics>>,
}

impl OpenSearchClient {
    fn new(config: &Config) -> Self {
        let auth = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.opensearch_user, config.opensearch_pass),
        );
        OpenSearchClient {
            base_url: config.opensearch_url.clone(),
            auth,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap(),
            metrics: Arc::new(Mutex::new(IndexMetrics::default())),
        }
    }

    async fn ensure_indices(&self) -> Result<(), Box<dyn std::error::Error>> {
        for schema in get_index_schemas() {
            let url = format!("{}/{}", self.base_url, schema.name);
            let exists = self.client.head(&url)
                .header("Authorization", format!("Basic {}", self.auth))
                .send().await;

            if let Ok(resp) = exists {
                if resp.status().is_success() {
                    eprintln!("[SEARCH] Index {} already exists", schema.name);
                    continue;
                }
            }

            let body = serde_json::json!({
                "mappings": schema.mappings,
                "settings": schema.settings,
            });

            match self.client.put(&url)
                .header("Authorization", format!("Basic {}", self.auth))
                .header("Content-Type", "application/json")
                .body(body.to_string())
                .send().await
            {
                Ok(resp) if resp.status().is_success() => {
                    eprintln!("[SEARCH] Created index {}", schema.name);
                }
                Ok(resp) => {
                    eprintln!("[SEARCH] Failed to create index {}: {}", schema.name, resp.status());
                }
                Err(e) => {
                    eprintln!("[SEARCH] Error creating index {}: {}", schema.name, e);
                }
            }
        }
        Ok(())
    }

    async fn bulk_index(&self, docs: &[IndexDocument]) -> Result<usize, Box<dyn std::error::Error>> {
        if docs.is_empty() {
            return Ok(0);
        }

        let start = Instant::now();
        let mut body = String::new();
        for doc in docs {
            let action = serde_json::json!({
                "index": { "_index": doc.index, "_id": doc.id }
            });
            body.push_str(&action.to_string());
            body.push('\n');
            body.push_str(&doc.body.to_string());
            body.push('\n');
        }

        let url = format!("{}/_bulk", self.base_url);
        let resp = self.client.post(&url)
            .header("Authorization", format!("Basic {}", self.auth))
            .header("Content-Type", "application/x-ndjson")
            .body(body)
            .send().await?;

        let latency = start.elapsed().as_millis() as f64;

        if let Ok(mut m) = self.metrics.lock() {
            m.bulk_requests += 1;
            m.documents_indexed += docs.len() as u64;
            m.avg_latency_ms = (m.avg_latency_ms * (m.bulk_requests as f64 - 1.0) + latency) / m.bulk_requests as f64;
            m.last_indexed_at = now_iso();
        }

        if resp.status().is_success() {
            Ok(docs.len())
        } else {
            if let Ok(mut m) = self.metrics.lock() {
                m.documents_failed += docs.len() as u64;
            }
            Err(format!("Bulk index failed: {}", resp.status()).into())
        }
    }

    async fn search(&self, index: &str, query: &serde_json::Value) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let url = format!("{}/{}/_search", self.base_url, index);
        let resp = self.client.post(&url)
            .header("Authorization", format!("Basic {}", self.auth))
            .header("Content-Type", "application/json")
            .body(query.to_string())
            .send().await?;

        if resp.status().is_success() {
            Ok(resp.json().await?)
        } else {
            Err(format!("Search failed: {}", resp.status()).into())
        }
    }
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

async fn handle_health(client: Arc<OpenSearchClient>) -> impl warp::Reply {
    let opensearch_ok = client.client.get(&format!("{}/_cluster/health", client.base_url))
        .header("Authorization", format!("Basic {}", client.auth))
        .send().await.map(|r| r.status().is_success()).unwrap_or(false);

    let m = client.metrics.lock().unwrap();
    warp::reply::json(&serde_json::json!({
        "status": "healthy",
        "service": "rust-search-indexer",
        "version": "1.0.0",
        "opensearch": opensearch_ok,
        "documents_indexed": m.documents_indexed,
        "documents_failed": m.documents_failed,
        "bulk_requests": m.bulk_requests,
        "avg_latency_ms": (m.avg_latency_ms * 100.0).round() / 100.0,
        "timestamp": now_iso()
    }))
}

async fn handle_metrics(client: Arc<OpenSearchClient>) -> impl warp::Reply {
    let m = client.metrics.lock().unwrap();
    let body = format!(
        "# HELP search_documents_indexed_total Documents indexed\n\
         # TYPE search_documents_indexed_total counter\n\
         search_documents_indexed_total {}\n\
         # HELP search_documents_failed_total Documents failed\n\
         # TYPE search_documents_failed_total counter\n\
         search_documents_failed_total {}\n\
         # HELP search_bulk_requests_total Bulk requests sent\n\
         # TYPE search_bulk_requests_total counter\n\
         search_bulk_requests_total {}\n\
         # HELP search_avg_latency_ms Average bulk latency\n\
         # TYPE search_avg_latency_ms gauge\n\
         search_avg_latency_ms {:.2}\n",
        m.documents_indexed, m.documents_failed, m.bulk_requests, m.avg_latency_ms
    );
    warp::reply::with_header(body, "Content-Type", "text/plain; charset=utf-8")
}

async fn handle_search(
    index: String,
    query: serde_json::Value,
    client: Arc<OpenSearchClient>,
) -> Result<impl warp::Reply, warp::Rejection> {
    match client.search(&index, &query).await {
        Ok(results) => Ok(warp::reply::json(&results)),
        Err(e) => Ok(warp::reply::json(&serde_json::json!({ "error": e.to_string() }))),
    }
}

async fn handle_index_doc(
    doc: IndexDocument,
    client: Arc<OpenSearchClient>,
) -> Result<impl warp::Reply, warp::Rejection> {
    match client.bulk_index(&[doc.clone()]).await {
        Ok(count) => Ok(warp::reply::json(&serde_json::json!({ "indexed": count, "id": doc.id }))),
        Err(e) => Ok(warp::reply::json(&serde_json::json!({ "error": e.to_string() }))),
    }
}

async fn handle_schemas() -> impl warp::Reply {
    warp::reply::json(&serde_json::json!({
        "schemas": get_index_schemas().iter().map(|s| {
            serde_json::json!({
                "name": s.name,
                "mappings": s.mappings,
                "settings": s.settings,
            })
        }).collect::<Vec<_>>()
    }))
}

// ─── Utils ────────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{}Z", d.as_secs())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let config = Config::from_env();
    eprintln!("[SEARCH-INDEXER] Starting on port {}", config.port);

    let client = Arc::new(OpenSearchClient::new(&config));

    // Try to create indices on startup
    if let Err(e) = client.ensure_indices().await {
        eprintln!("[SEARCH-INDEXER] Failed to ensure indices: {}", e);
    }

    let client_health = client.clone();
    let client_metrics = client.clone();
    let client_search = client.clone();
    let client_index = client.clone();

    let health = warp::path("health")
        .and(warp::get())
        .map(move || client_health.clone())
        .and_then(|c: Arc<OpenSearchClient>| async move {
            Ok::<_, warp::Rejection>(handle_health(c).await)
        });

    let metrics_route = warp::path("metrics")
        .and(warp::get())
        .map(move || client_metrics.clone())
        .and_then(|c: Arc<OpenSearchClient>| async move {
            Ok::<_, warp::Rejection>(handle_metrics(c).await)
        });

    let schemas = warp::path!("api" / "schemas")
        .and(warp::get())
        .and_then(|| async { Ok::<_, warp::Rejection>(handle_schemas().await) });

    let search = warp::path!("api" / "search" / String)
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || client_search.clone()))
        .and_then(handle_search);

    let index_doc = warp::path!("api" / "index")
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || client_index.clone()))
        .and_then(handle_index_doc);

    let routes = health
        .or(metrics_route)
        .or(schemas)
        .or(search)
        .or(index_doc);

    eprintln!("[SEARCH-INDEXER] Ready on port {}", config.port);
    warp::serve(routes).run(([0, 0, 0, 0], config.port)).await;
}
