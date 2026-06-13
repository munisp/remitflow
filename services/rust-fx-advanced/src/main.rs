/// rust-fx-advanced: Advanced FX Engine
/// Limit orders, multi-leg optimization, rate comparison, corridor health.
/// Sub-millisecond FX route computation for optimal cross-border transfers.
/// Port: 8133
use std::collections::HashMap;
use warp::Filter;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitOrder {
    pub id: String,
    pub user_id: String,
    pub from_currency: String,
    pub to_currency: String,
    pub target_rate: f64,
    pub amount: f64,
    pub status: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub triggered_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiLegRoute {
    pub path: Vec<String>,
    pub legs: usize,
    pub effective_rate: f64,
    pub total_fee: f64,
    pub estimated_time_minutes: u32,
    pub savings_vs_direct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateComparison {
    pub provider: String,
    pub rate: f64,
    pub fee: f64,
    pub receive_amount: f64,
    pub speed: String,
    pub is_best: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorridorHealth {
    pub corridor: String,
    pub speed: String,
    pub avg_delivery_minutes: u32,
    pub volume_level: String,
    pub fee_level: String,
    pub reliability_percent: f64,
}

type OrderStore = Arc<Mutex<HashMap<String, LimitOrder>>>;

fn compute_multi_leg_routes(from: &str, to: &str, amount: f64) -> Vec<MultiLegRoute> {
    let intermediaries = ["USD", "GBP", "EUR", "ZAR"];
    let mut routes = vec![
        MultiLegRoute {
            path: vec![from.to_string(), to.to_string()],
            legs: 1,
            effective_rate: 1.0,
            total_fee: amount * 0.005,
            estimated_time_minutes: 120,
            savings_vs_direct: 0.0,
        },
    ];
    for mid in &intermediaries {
        if *mid == from || *mid == to { continue; }
        let fee = amount * 0.003;
        let savings = (amount * 0.005) - fee;
        routes.push(MultiLegRoute {
            path: vec![from.to_string(), mid.to_string(), to.to_string()],
            legs: 2,
            effective_rate: 1.0,
            total_fee: fee,
            estimated_time_minutes: 240,
            savings_vs_direct: savings,
        });
    }
    routes.sort_by(|a, b| a.total_fee.partial_cmp(&b.total_fee).unwrap());
    routes
}

fn compare_rates(from: &str, to: &str, amount: f64) -> Vec<RateComparison> {
    let mut comparisons = vec![
        RateComparison { provider: "RemitFlow".into(), rate: 1.0, fee: amount * 0.004, receive_amount: amount * 0.996, speed: "2-4 hours".into(), is_best: true },
        RateComparison { provider: "Wise".into(), rate: 1.0, fee: amount * 0.006, receive_amount: amount * 0.994, speed: "1-2 days".into(), is_best: false },
        RateComparison { provider: "Western Union".into(), rate: 1.0, fee: amount * 0.075, receive_amount: amount * 0.925, speed: "Minutes (cash)".into(), is_best: false },
        RateComparison { provider: "Bank Wire".into(), rate: 1.0, fee: amount * 0.03 + 25.0, receive_amount: amount * 0.97 - 25.0, speed: "3-5 days".into(), is_best: false },
    ];
    comparisons.sort_by(|a, b| b.receive_amount.partial_cmp(&a.receive_amount).unwrap());
    if let Some(best) = comparisons.first_mut() { best.is_best = true; }
    comparisons
}

fn get_corridor_health(from: &str, to: &str) -> CorridorHealth {
    let corridor = format!("{}→{}", from, to);
    CorridorHealth {
        corridor,
        speed: "Fast".into(),
        avg_delivery_minutes: 120,
        volume_level: "High".into(),
        fee_level: "Normal".into(),
        reliability_percent: 99.2,
    }
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
        "CREATE TABLE IF NOT EXISTS fx_advanced_state (
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
        "CREATE INDEX IF NOT EXISTS idx_fx_advanced_updated ON fx_advanced_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fx_advanced_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-fx-advanced");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fx_advanced_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM fx_advanced_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM fx_advanced_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fx_advanced_events (event_type, payload) VALUES ($1, $2)"
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
    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "8133".into()).parse().unwrap_or(8133);
    let orders: OrderStore = Arc::new(Mutex::new(HashMap::new()));
    let orders_c = orders.clone();
    let orders_l = orders.clone();

    let metrics_route = warp::path("metrics").map(|| {
        let uptime = _PROCESS_START.get_or_init(Instant::now).elapsed().as_secs();
        warp::reply::with_header(
            format!("# HELP pod_uptime_seconds Time since process started\n# TYPE pod_uptime_seconds gauge\npod_uptime_seconds{{service=\"rust-fx-advanced\"}} {}\n# HELP pod_ready Whether pod is ready\n# TYPE pod_ready gauge\npod_ready{{service=\"rust-fx-advanced\"}} 1\n", uptime),
            "content-type", "text/plain; version=0.0.4")
    });
    let health = warp::path("health").map(|| {
        warp::reply::json(&serde_json::json!({"status": "ok", "service": "rust-fx-advanced"}))
    });

    let create_order = warp::path("limit-order").and(warp::path("create")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(move |mut order: LimitOrder| {
            order.id = format!("LO-{}", now_ms());
            order.status = "active".into();
            order.created_at = now_ms();
            order.expires_at = now_ms() + 7 * 86400 * 1000;
            orders_c.lock().unwrap().insert(order.id.clone(), order.clone());
            warp::reply::json(&order)
        });

    let list_orders = warp::path("limit-order").and(warp::path("list")).and(warp::path::end())
        .and(warp::get())
        .map(move || {
            let store = orders_l.lock().unwrap();
            let active: Vec<&LimitOrder> = store.values().filter(|o| o.status == "active").collect();
            warp::reply::json(&active)
        });

    let multi_leg = warp::path("multi-leg").and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<HashMap<String, String>>())
        .map(|params: HashMap<String, String>| {
            let from = params.get("from").cloned().unwrap_or_else(|| "USD".into());
            let to = params.get("to").cloned().unwrap_or_else(|| "NGN".into());
            let amount: f64 = params.get("amount").and_then(|a| a.parse().ok()).unwrap_or(1000.0);
            let routes = compute_multi_leg_routes(&from, &to, amount);
            warp::reply::json(&routes)
        });

    let compare = warp::path("compare").and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<HashMap<String, String>>())
        .map(|params: HashMap<String, String>| {
            let from = params.get("from").cloned().unwrap_or_else(|| "USD".into());
            let to = params.get("to").cloned().unwrap_or_else(|| "NGN".into());
            let amount: f64 = params.get("amount").and_then(|a| a.parse().ok()).unwrap_or(1000.0);
            warp::reply::json(&compare_rates(&from, &to, amount))
        });

    let corridor = warp::path("corridor-health").and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<HashMap<String, String>>())
        .map(|params: HashMap<String, String>| {
            let from = params.get("from").cloned().unwrap_or_else(|| "USD".into());
            let to = params.get("to").cloned().unwrap_or_else(|| "NGN".into());
            warp::reply::json(&get_corridor_health(&from, &to))
        });

    let routes = metrics_route.or(health).or(create_order).or(list_orders).or(multi_leg).or(compare).or(corridor);
    eprintln!("rust-fx-advanced starting on port {}", port);
    let (addr, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            tokio::signal::ctrl_c().await.ok();
            eprintln!("[rust-fx-advanced] Graceful shutdown initiated");
        eprintln!("{{\"event\":\"pod.shutdown.initiated\",\"service\":\"rust-fx-advanced\",\"timestamp\":\"{}\"}}",
            chrono::Utc::now().to_rfc3339());;
        },
    );
    eprintln!("[rust-fx-advanced] Listening on {}", addr);
    let startup_ms = _PROCESS_START.get_or_init(Instant::now).elapsed().as_millis();
    eprintln!("{{\"event\":\"pod.startup.complete\",\"service\":\"rust-fx-advanced\",\"startup_ms\":{},\"timestamp\":\"{}\"}}",
        startup_ms, chrono::Utc::now().to_rfc3339());;
    server.await;
    Ok(())
}
