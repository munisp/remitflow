// RemitFlow — Redis Cache & Session Service (Rust)
// Manages: FX rate cache, session tokens, rate-limit counters, idempotency keys,
//          OTP codes, transfer locks, compliance cache, leaderboard.
//
// Redis: redis:6379 (default)

use axum::{
    extract::{Json, Path, Query},
    routing::{delete, get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

// ─── In-memory Redis mock (replace with redis-rs client in production) ────────
type Cache = Arc<Mutex<HashMap<String, (String, Option<i64>)>>>;

fn cache_get(cache: &Cache, key: &str) -> Option<String> {
    let c = cache.lock().unwrap();
    if let Some((val, expiry)) = c.get(key) {
        if let Some(exp) = expiry {
            if Utc::now().timestamp() > *exp {
                return None; // Expired
            }
        }
        return Some(val.clone());
    }
    None
}

fn cache_set(cache: &Cache, key: &str, value: &str, ttl_secs: Option<i64>) {
    let mut c = cache.lock().unwrap();
    let expiry = ttl_secs.map(|t| Utc::now().timestamp() + t);
    c.insert(key.to_string(), (value.to_string(), expiry));
}

fn cache_del(cache: &Cache, key: &str) -> bool {
    cache.lock().unwrap().remove(key).is_some()
}

// ─── Request/Response Types ───────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct SetRequest {
    pub value: String,
    pub ttl_secs: Option<i64>,
}

#[derive(Deserialize)]
pub struct FXRateRequest {
    pub from: String,
    pub to: String,
    pub rate: f64,
    pub source: String,
}

#[derive(Serialize)]
pub struct FXRateResponse {
    pub from: String,
    pub to: String,
    pub rate: f64,
    pub source: String,
    pub cached_at: String,
    pub ttl_remaining: Option<i64>,
}

#[derive(Deserialize)]
pub struct OTPRequest {
    pub user_id: String,
    pub purpose: String, // login, transfer, kyc
}

#[derive(Serialize)]
pub struct OTPResponse {
    pub otp: String,
    pub expires_in: i64,
    pub purpose: String,
}

#[derive(Deserialize)]
pub struct IdempotencyRequest {
    pub key: String,
    pub result: Option<String>,
}

#[derive(Deserialize)]
pub struct RateLimitQuery {
    pub window_secs: Option<i64>,
    pub max_requests: Option<i64>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "redis-cache",
        "version": "v110.0.0",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// Generic key-value
async fn get_key(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(key): Path<String>,
) -> Json<serde_json::Value> {
    match cache_get(&cache, &key) {
        Some(val) => Json(serde_json::json!({"key": key, "value": val, "found": true})),
        None => Json(serde_json::json!({"key": key, "found": false})),
    }
}

async fn set_key(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(key): Path<String>,
    Json(req): Json<SetRequest>,
) -> Json<serde_json::Value> {
    cache_set(&cache, &key, &req.value, req.ttl_secs);
    Json(serde_json::json!({"key": key, "set": true, "ttl_secs": req.ttl_secs}))
}

async fn delete_key(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(key): Path<String>,
) -> Json<serde_json::Value> {
    let deleted = cache_del(&cache, &key);
    Json(serde_json::json!({"key": key, "deleted": deleted}))
}

// FX Rate cache (TTL: 30 seconds for live rates)
async fn set_fx_rate(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Json(req): Json<FXRateRequest>,
) -> Json<serde_json::Value> {
    let key = format!("fx:{}:{}", req.from.to_uppercase(), req.to.to_uppercase());
    let val = serde_json::json!({
        "rate": req.rate,
        "source": req.source,
        "cached_at": Utc::now().to_rfc3339()
    }).to_string();
    cache_set(&cache, &key, &val, Some(30)); // 30s TTL for FX rates
    info!("[Redis] FX rate cached: {}/{} = {}", req.from, req.to, req.rate);
    Json(serde_json::json!({"cached": true, "key": key, "ttl_secs": 30}))
}

async fn get_fx_rate(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path((from, to)): Path<(String, String)>,
) -> Json<serde_json::Value> {
    let key = format!("fx:{}:{}", from.to_uppercase(), to.to_uppercase());
    match cache_get(&cache, &key) {
        Some(val) => {
            let parsed: serde_json::Value = serde_json::from_str(&val).unwrap_or_default();
            Json(serde_json::json!({"found": true, "key": key, "data": parsed}))
        }
        None => Json(serde_json::json!({"found": false, "key": key})),
    }
}

// OTP generation and verification
async fn generate_otp(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Json(req): Json<OTPRequest>,
) -> Json<OTPResponse> {
    use rand::Rng;
    let otp = format!("{:06}", rand::thread_rng().gen_range(100000..999999));
    let key = format!("otp:{}:{}", req.user_id, req.purpose);
    cache_set(&cache, &key, &otp, Some(300)); // 5 min TTL
    info!("[Redis] OTP generated for user={} purpose={}", req.user_id, req.purpose);
    Json(OTPResponse {
        otp: otp.clone(),
        expires_in: 300,
        purpose: req.purpose,
    })
}

async fn verify_otp(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path((user_id, purpose, otp)): Path<(String, String, String)>,
) -> Json<serde_json::Value> {
    let key = format!("otp:{}:{}", user_id, purpose);
    match cache_get(&cache, &key) {
        Some(stored_otp) if stored_otp == otp => {
            cache_del(&cache, &key); // One-time use
            Json(serde_json::json!({"valid": true, "consumed": true}))
        }
        Some(_) => Json(serde_json::json!({"valid": false, "reason": "INVALID_OTP"})),
        None => Json(serde_json::json!({"valid": false, "reason": "OTP_EXPIRED_OR_NOT_FOUND"})),
    }
}

// Idempotency key management (prevent duplicate transfers)
async fn check_idempotency(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Json(req): Json<IdempotencyRequest>,
) -> Json<serde_json::Value> {
    let key = format!("idempotency:{}", req.key);
    if let Some(existing) = cache_get(&cache, &key) {
        return Json(serde_json::json!({
            "duplicate": true,
            "existing_result": existing
        }));
    }
    // Store the result if provided
    if let Some(result) = &req.result {
        cache_set(&cache, &key, result, Some(86400)); // 24h TTL
    }
    Json(serde_json::json!({"duplicate": false}))
}

// Rate limiting check
async fn check_rate_limit(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(identifier): Path<String>,
    Query(q): Query<RateLimitQuery>,
) -> Json<serde_json::Value> {
    let window = q.window_secs.unwrap_or(60);
    let max = q.max_requests.unwrap_or(100);
    let key = format!("ratelimit:{}:{}", identifier, Utc::now().timestamp() / window);

    let current = cache_get(&cache, &key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);

    let new_count = current + 1;
    cache_set(&cache, &key, &new_count.to_string(), Some(window));

    Json(serde_json::json!({
        "allowed": new_count <= max,
        "current": new_count,
        "limit": max,
        "window_secs": window,
        "remaining": (max - new_count).max(0)
    }))
}

// Transfer lock (prevent concurrent duplicate transfers)
async fn acquire_transfer_lock(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(transfer_id): Path<String>,
) -> Json<serde_json::Value> {
    let key = format!("lock:transfer:{}", transfer_id);
    if cache_get(&cache, &key).is_some() {
        return Json(serde_json::json!({"acquired": false, "reason": "LOCK_EXISTS"}));
    }
    cache_set(&cache, &key, "locked", Some(300)); // 5 min lock
    Json(serde_json::json!({"acquired": true, "ttl_secs": 300}))
}

async fn release_transfer_lock(
    axum::extract::State(cache): axum::extract::State<Cache>,
    Path(transfer_id): Path<String>,
) -> Json<serde_json::Value> {
    let key = format!("lock:transfer:{}", transfer_id);
    let released = cache_del(&cache, &key);
    Json(serde_json::json!({"released": released}))
}

// Cache stats
async fn get_stats(
    axum::extract::State(cache): axum::extract::State<Cache>,
) -> Json<serde_json::Value> {
    let c = cache.lock().unwrap();
    let total = c.len();
    let now = Utc::now().timestamp();
    let active: usize = c.values().filter(|(_, exp)| {
        exp.map(|e| e > now).unwrap_or(true)
    }).count();

    Json(serde_json::json!({
        "total_keys": total,
        "active_keys": active,
        "expired_keys": total - active,
        "timestamp": Utc::now().to_rfc3339()
    }))
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
        "CREATE TABLE IF NOT EXISTS redis_service_state (
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
        "CREATE INDEX IF NOT EXISTS idx_redis_service_updated ON redis_service_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS redis_service_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-redis-service");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO redis_service_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM redis_service_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM redis_service_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO redis_service_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Panic hook for logging panics without crashing silently
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let _pool = init_db().await;
    tracing_subscriber::fmt().json().init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8097".to_string())
        .parse()
        .unwrap_or(8097);

    let cache: Cache = Arc::new(Mutex::new(HashMap::new()));

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/cache/:key", get(get_key))
        .route("/api/v1/cache/:key", post(set_key))
        .route("/api/v1/cache/:key", delete(delete_key))
        .route("/api/v1/fx/:from/:to", get(get_fx_rate))
        .route("/api/v1/fx", post(set_fx_rate))
        .route("/api/v1/otp", post(generate_otp))
        .route("/api/v1/otp/:user_id/:purpose/:otp/verify", get(verify_otp))
        .route("/api/v1/idempotency", post(check_idempotency))
        .route("/api/v1/ratelimit/:identifier", get(check_rate_limit))
        .route("/api/v1/locks/transfer/:id", post(acquire_transfer_lock))
        .route("/api/v1/locks/transfer/:id", delete(release_transfer_lock))
        .route("/api/v1/stats", get(get_stats))
        .with_state(cache)
        .layer(cors);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[Redis] Cache service listening on :{}", port);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            tracing::info!("[rust-redis-service] Graceful shutdown initiated");
        })
        .await
        .unwrap();
    Ok(())
}
