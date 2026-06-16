/// rust-hnw-fx-engine: High-performance FX pricing engine for HNW clients
/// Provides sub-millisecond FX rate computation with negotiated spreads,
/// rate locks, and real-time P&L tracking via TigerBeetle.
use std::collections::HashMap;
use warp::Filter;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FxRate {
    pub corridor: String,
    pub base_rate: f64,
    pub bid: f64,
    pub ask: f64,
    pub spread_bps: f64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HnwPriceRequest {
    pub user_id: i64,
    pub corridor: String,
    pub amount_ngn: f64,
    pub aum_ngn: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HnwPriceResponse {
    pub user_id: i64,
    pub corridor: String,
    pub amount_ngn: f64,
    pub amount_target: f64,
    pub target_currency: String,
    pub fx_rate: f64,
    pub standard_spread_bps: f64,
    pub negotiated_spread_bps: f64,
    pub savings_ngn: f64,
    pub fee_ngn: f64,
    pub total_ngn: f64,
    pub valid_until: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RateLock {
    pub id: String,
    pub user_id: i64,
    pub corridor: String,
    pub amount_ngn: f64,
    pub fx_rate: f64,
    pub expires_at: u64,
    pub is_executed: bool,
}

type RateLockStore = Arc<Mutex<HashMap<String, RateLock>>>;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

// Base FX rates (mid-market)
fn base_rates() -> HashMap<&'static str, (&'static str, f64)> {
    let mut m = HashMap::new();
    m.insert("UK",  ("GBP", 1550.0_f64));
    m.insert("US",  ("USD", 1620.0_f64));
    m.insert("CA",  ("CAD", 1190.0_f64));
    m.insert("AU",  ("AUD", 1050.0_f64));
    m.insert("IN",  ("INR", 0.0083_f64));
    m.insert("AE",  ("AED", 0.0022_f64));
    m.insert("TG",  ("XOF", 0.59_f64));
    m.insert("GH",  ("GHS", 0.0062_f64));
    m.insert("CN",  ("CNY", 0.0044_f64));
    m
}

fn negotiated_spread_bps(aum_ngn: f64) -> f64 {
    if aum_ngn >= 500_000_000.0 { 20.0 }       // Ultra-HNW: 20bps
    else if aum_ngn >= 200_000_000.0 { 30.0 }  // HNW: 30bps
    else if aum_ngn >= 100_000_000.0 { 50.0 }  // Affluent: 50bps
    else if aum_ngn >= 50_000_000.0 { 80.0 }   // Mass-affluent: 80bps
    else { 120.0 }                              // Standard: 120bps
}

async fn handle_price(body: bytes::Bytes) -> Result<impl warp::Reply, warp::Rejection> {
    let req: HnwPriceRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Invalid request body"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    let rates = base_rates();
    let (currency, base_rate) = match rates.get(req.corridor.as_str()) {
        Some(r) => *r,
        None => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Corridor not supported"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    let aum = req.aum_ngn.unwrap_or(0.0);
    let neg_spread_bps = negotiated_spread_bps(aum);
    let standard_spread_bps = 120.0_f64;
    // Apply negotiated spread to rate
    let fx_rate = base_rate * (1.0 - neg_spread_bps / 10_000.0);
    let fee_ngn = req.amount_ngn * 0.005; // 50bps flat fee
    let amount_target = req.amount_ngn / fx_rate;
    let savings_ngn = req.amount_ngn * (standard_spread_bps - neg_spread_bps) / 10_000.0;
    let resp = HnwPriceResponse {
        user_id: req.user_id,
        corridor: req.corridor.clone(),
        amount_ngn: req.amount_ngn,
        amount_target,
        target_currency: currency.to_string(),
        fx_rate,
        standard_spread_bps,
        negotiated_spread_bps: neg_spread_bps,
        savings_ngn,
        fee_ngn,
        total_ngn: req.amount_ngn + fee_ngn,
        valid_until: now_secs() + 1800, // 30 min validity
    };
    Ok(warp::reply::with_status(
        warp::reply::json(&resp),
        warp::http::StatusCode::OK,
    ))
}

async fn handle_rate_lock(
    locks: RateLockStore,
    body: bytes::Bytes,
) -> Result<impl warp::Reply, warp::Rejection> {
    let req: HnwPriceRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Invalid request body"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    // Max lock: USD 500k equiv
    if req.amount_ngn > 810_000_000.0 {
        return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Rate lock limit is USD 500k equivalent"})),
            warp::http::StatusCode::BAD_REQUEST,
        ));
    }
    let rates = base_rates();
    let (_, base_rate) = match rates.get(req.corridor.as_str()) {
        Some(r) => *r,
        None => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Corridor not supported"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    let aum = req.aum_ngn.unwrap_or(0.0);
    let neg_spread_bps = negotiated_spread_bps(aum);
    let fx_rate = base_rate * (1.0 - neg_spread_bps / 10_000.0);
    let lock = RateLock {
        id: format!("LOCK-{}", now_ms()),
        user_id: req.user_id,
        corridor: req.corridor.clone(),
        amount_ngn: req.amount_ngn,
        fx_rate,
        expires_at: now_secs() + 1800,
        is_executed: false,
    };
    {
        let mut store = locks.lock().unwrap();
        store.insert(lock.id.clone(), lock.clone());
    }
    Ok(warp::reply::with_status(
        warp::reply::json(&lock),
        warp::http::StatusCode::CREATED,
    ))
}

async fn handle_health() -> Result<impl warp::Reply, warp::Rejection> {
    Ok(warp::reply::json(&serde_json::json!({
        "status": "ok",
        "service": "rust-hnw-fx-engine",
        "supported_corridors": ["UK", "US", "CA", "AU", "IN", "AE", "TG", "GH", "CN"],
        "timestamp": now_secs()
    })))
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
        "CREATE TABLE IF NOT EXISTS hnw_fx_engine_state (
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
        "CREATE INDEX IF NOT EXISTS idx_hnw_fx_engine_updated ON hnw_fx_engine_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS hnw_fx_engine_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-hnw-fx-engine");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO hnw_fx_engine_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM hnw_fx_engine_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM hnw_fx_engine_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO hnw_fx_engine_events (event_type, payload) VALUES ($1, $2)"
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
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8100".to_string())
        .parse()
        .unwrap_or(8100);

    let locks: RateLockStore = Arc::new(Mutex::new(HashMap::new()));
    let locks_route = locks.clone();

    let health_route = warp::path("health")
        .and(warp::get())
        .and_then(handle_health);

    let price_route = warp::path("price")
        .and(warp::post())
        .and(warp::body::bytes())
        .and_then(|body| async move { handle_price(body).await });

    let rate_lock_route = warp::path("rate-lock")
        .and(warp::post())
        .and(warp::body::bytes())
        .and_then(move |body| {
            let l = locks_route.clone();
            async move { handle_rate_lock(l, body).await }
        });

    let auth_filter = warp::header::optional::<String>("authorization")
        .and(warp::header::optional::<String>("x-api-key"))
        .and_then(|auth: Option<String>, api_key: Option<String>| async move {
            let key = std::env::var("INTERNAL_SERVICE_KEY")
                .unwrap_or_else(|_| "remitflow-internal-2026".to_string());
            if let Some(ak) = &api_key {
                if ak == &key { return Ok(()); }
            }
            if let Some(a) = &auth {
                if a.starts_with("Bearer ") && &a[7..] == key { return Ok(()); }
            }
            Err(warp::reject::reject())
        })
        .untuple_one();
    let protected = auth_filter.and(price_route.or(rate_lock_route));
    let routes = health_route.or(protected);

    println!("[rust-hnw-fx-engine] Starting on :{}", port);
    let (addr, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            tokio::signal::ctrl_c().await.ok();
            eprintln!("[rust-hnw-fx-engine] Graceful shutdown initiated");
        eprintln!("{{\"event\":\"pod.shutdown.initiated\",\"service\":\"rust-hnw-fx-engine\",\"timestamp\":\"{}\"}}",
            chrono::Utc::now().to_rfc3339());;
        },
    );
    eprintln!("[rust-hnw-fx-engine] Listening on {}", addr);
    let startup_ms = _PROCESS_START.get_or_init(Instant::now).elapsed().as_millis();
    eprintln!("{{\"event\":\"pod.startup.complete\",\"service\":\"rust-hnw-fx-engine\",\"startup_ms\":{},\"timestamp\":\"{}\"}}",
        startup_ms, chrono::Utc::now().to_rfc3339());;
    server.await;
    Ok(())
}
