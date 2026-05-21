use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Idempotency key record
#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdempotencyRecord {
    key: String,
    key_hash: String,
    request_hash: String,
    response: serde_json::Value,
    status: String,
    created_at: u64,
    expires_at: u64,
}

/// Request to check/store idempotency key
#[derive(Debug, Deserialize)]
struct CheckRequest {
    idempotency_key: String,
    request_body: serde_json::Value,
    ttl_seconds: Option<u64>,
}

/// Response
#[derive(Debug, Serialize)]
struct CheckResponse {
    is_duplicate: bool,
    cached_response: Option<serde_json::Value>,
    key_hash: String,
}

#[derive(Debug, Deserialize)]
struct StoreRequest {
    idempotency_key: String,
    response: serde_json::Value,
    status: String,
}

struct AppState {
    store: Mutex<HashMap<String, IdempotencyRecord>>,
}

fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hex::encode(hasher.finalize())
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

/// POST /check - Check if an idempotency key has been seen
async fn check_key(
    data: web::Data<AppState>,
    req: web::Json<CheckRequest>,
) -> HttpResponse {
    let key_hash = hash_key(&req.idempotency_key);

    let store = data.store.lock().unwrap();

    if let Some(record) = store.get(&key_hash) {
        // Check if expired
        if record.expires_at > now_epoch() {
            return HttpResponse::Ok().json(CheckResponse {
                is_duplicate: true,
                cached_response: Some(record.response.clone()),
                key_hash: key_hash.clone(),
            });
        }
    }

    HttpResponse::Ok().json(CheckResponse {
        is_duplicate: false,
        cached_response: None,
        key_hash,
    })
}

/// POST /store - Store a response for an idempotency key
async fn store_response(
    data: web::Data<AppState>,
    req: web::Json<StoreRequest>,
) -> HttpResponse {
    let key_hash = hash_key(&req.idempotency_key);
    let now = now_epoch();

    let mut hasher = Sha256::new();
    hasher.update(req.response.to_string().as_bytes());
    let request_hash = hex::encode(hasher.finalize());

    let record = IdempotencyRecord {
        key: req.idempotency_key.clone(),
        key_hash: key_hash.clone(),
        request_hash,
        response: req.response.clone(),
        status: req.status.clone(),
        created_at: now,
        expires_at: now + 86400, // 24h default
    };

    let mut store = data.store.lock().unwrap();
    store.insert(key_hash, record);

    HttpResponse::Ok().json(serde_json::json!({ "stored": true }))
}

/// DELETE /purge - Remove expired keys
async fn purge_expired(data: web::Data<AppState>) -> HttpResponse {
    let now = now_epoch();
    let mut store = data.store.lock().unwrap();
    let before = store.len();
    store.retain(|_, record| record.expires_at > now);
    let after = store.len();

    HttpResponse::Ok().json(serde_json::json!({
        "purged": before - after,
        "remaining": after,
    }))
}

/// GET /health
async fn health(data: web::Data<AppState>) -> HttpResponse {
    let store = data.store.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "idempotency",
        "keys_stored": store.len(),
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt().json().init();

    let port: u16 = std::env::var("IDEMPOTENCY_PORT")
        .unwrap_or_else(|_| "8103".to_string())
        .parse()
        .unwrap_or(8103);

    let state = web::Data::new(AppState {
        store: Mutex::new(HashMap::new()),
    });

    // Background cleanup every 5 minutes
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;
            let now = now_epoch();
            let mut store = cleanup_state.store.lock().unwrap();
            store.retain(|_, record| record.expires_at > now);
            tracing::info!(keys = store.len(), "Idempotency key cleanup complete");
        }
    });

    tracing::info!(port = port, "Idempotency service starting");

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/check", web::post().to(check_key))
            .route("/store", web::post().to(store_response))
            .route("/purge", web::delete().to(purge_expired))
            .route("/health", web::get().to(health))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
