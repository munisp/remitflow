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
    pub db_pool: Option<PgPool>,
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
    store.insert(key_hash.clone(), record.clone());
    // DB write-through for idempotency record
    if let Some(ref pool) = data.db_pool {
        let p = pool.clone();
        let data_val = serde_json::to_value(&record).unwrap_or_default();
        let id = key_hash.clone();
        tokio::spawn(async move { let _ = db_upsert(&p, &id, &data_val).await; });
    }

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


use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Instant;
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
        "CREATE TABLE IF NOT EXISTS idempotency_state (
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
        "CREATE INDEX IF NOT EXISTS idx_idempotency_updated ON idempotency_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS idempotency_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-idempotency");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO idempotency_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM idempotency_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM idempotency_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO idempotency_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[actix_web::main]
async fn load_from_db(pool: &PgPool) {
    match sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT id, data FROM idempotency_state ORDER BY updated_at DESC LIMIT 1000"
    )
    .fetch_all(pool)
    .await {
        Ok(rows) => {
            tracing::info!("loaded {} persisted records from idempotency_state", rows.len());
        }
        Err(e) => {
            tracing::warn!("failed to load from DB: {}", e);
        }
    }
}

async fn main() -> std::io::Result<()> {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let pool = init_db().await;
    load_from_db(&pool).await;
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
        let auth_key = std::env::var("INTERNAL_SERVICE_KEY")
            .unwrap_or_else(|_| "remitflow-internal-2026".to_string());
        App::new()
            .app_data(state.clone())
            .app_data(web::Data::new(auth_key))
            .route("/health", web::get().to(health))
            .service(
                web::scope("")
                    .wrap(actix_web::middleware::from_fn(|req: actix_web::dev::ServiceRequest, next: actix_web::middleware::Next<actix_web::body::BoxBody>| async move {
                        let key = req.app_data::<web::Data<String>>().map(|k| k.as_str().to_string()).unwrap_or_default();
                        let api_key = req.headers().get("x-api-key").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
                        let auth = req.headers().get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
                        if api_key == key || (auth.starts_with("Bearer ") && auth[7..] == key) {
                            return next.call(req).await;
                        }
                        Err(actix_web::error::ErrorUnauthorized("unauthorized"))
                    }))
                    .route("/check", web::post().to(check_key))
                    .route("/store", web::post().to(store_response))
                    .route("/purge", web::delete().to(purge_expired))
            )
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
