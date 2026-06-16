/// rust-social-ledger: High-performance ledger for savings circles & lending groups.
/// Manages ajo/esusu/chama circle accounting with atomic contribution tracking.
/// Port: 8134
use std::collections::HashMap;
use warp::Filter;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Circle {
    pub id: String,
    pub name: String,
    pub circle_type: String,
    pub creator_id: String,
    pub currency: String,
    pub target_amount: f64,
    pub current_amount: f64,
    pub max_members: u32,
    pub members: Vec<CircleMember>,
    pub contribution_frequency: String,
    pub status: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircleMember {
    pub user_id: String,
    pub role: String,
    pub total_contributed: f64,
    pub total_received: f64,
    pub joined_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contribution {
    pub id: String,
    pub circle_id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub round: u32,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payout {
    pub id: String,
    pub circle_id: String,
    pub recipient_id: String,
    pub amount: f64,
    pub round: u32,
    pub status: String,
    pub timestamp: u64,
}

type CircleStore = Arc<Mutex<HashMap<String, Circle>>>;
type ContribStore = Arc<Mutex<Vec<Contribution>>>;


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
        "CREATE TABLE IF NOT EXISTS social_ledger_state (
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
        "CREATE INDEX IF NOT EXISTS idx_social_ledger_updated ON social_ledger_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS social_ledger_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-social-ledger");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_ledger_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM social_ledger_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM social_ledger_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_ledger_events (event_type, payload) VALUES ($1, $2)"
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
    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "8134".into()).parse().unwrap_or(8134);
    let circles: CircleStore = Arc::new(Mutex::new(HashMap::new()));
    let contribs: ContribStore = Arc::new(Mutex::new(Vec::new()));

    let circles_create = circles.clone();
    let circles_get = circles.clone();
    let circles_contrib = circles.clone();
    let contribs_add = contribs.clone();

    let metrics_route = warp::path("metrics").map(|| {
        let uptime = _PROCESS_START.get_or_init(Instant::now).elapsed().as_secs();
        warp::reply::with_header(
            format!("# HELP pod_uptime_seconds Time since process started\n# TYPE pod_uptime_seconds gauge\npod_uptime_seconds{{service=\"rust-social-ledger\"}} {}\n# HELP pod_ready Whether pod is ready\n# TYPE pod_ready gauge\npod_ready{{service=\"rust-social-ledger\"}} 1\n", uptime),
            "content-type", "text/plain; version=0.0.4")
    });
    let health = warp::path("health").map(|| {
        warp::reply::json(&serde_json::json!({"status": "ok", "service": "rust-social-ledger"}))
    });

    let create = warp::path("circle").and(warp::path("create")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(move |mut circle: Circle| {
            circle.id = format!("CIR-{}", now_ms());
            circle.current_amount = 0.0;
            circle.status = "active".into();
            circle.created_at = now_ms();
            circle.members = vec![CircleMember {
                user_id: circle.creator_id.clone(),
                role: "admin".into(),
                total_contributed: 0.0,
                total_received: 0.0,
                joined_at: now_ms(),
            }];
            circles_create.lock().unwrap().insert(circle.id.clone(), circle.clone());
            warp::reply::json(&circle)
        });

    let get = warp::path!("circle" / String)
        .and(warp::get())
        .map(move |id: String| {
            let store = circles_get.lock().unwrap();
            match store.get(&id) {
                Some(c) => warp::reply::json(c),
                None => warp::reply::json(&serde_json::json!({"error": "not found"})),
            }
        });

    let contribute = warp::path("circle").and(warp::path("contribute")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(move |mut contrib: Contribution| {
            contrib.id = format!("CON-{}", now_ms());
            contrib.timestamp = now_ms();
            // Update circle balance
            if let Some(circle) = circles_contrib.lock().unwrap().get_mut(&contrib.circle_id) {
                circle.current_amount += contrib.amount;
                if let Some(member) = circle.members.iter_mut().find(|m| m.user_id == contrib.user_id) {
                    member.total_contributed += contrib.amount;
                }
            }
            contribs_add.lock().unwrap().push(contrib.clone());
            warp::reply::json(&contrib)
        });

    let payout = warp::path("circle").and(warp::path("payout")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(|req: serde_json::Value| {
            let payout = Payout {
                id: format!("PAY-{}", now_ms()),
                circle_id: req["circleId"].as_str().unwrap_or("").into(),
                recipient_id: req["recipientId"].as_str().unwrap_or("").into(),
                amount: req["amount"].as_f64().unwrap_or(0.0),
                round: req["round"].as_u64().unwrap_or(0) as u32,
                status: "processing".into(),
                timestamp: now_ms(),
            };
            warp::reply::json(&payout)
        });

    let routes = metrics_route.or(health).or(create).or(get).or(contribute).or(payout);
    eprintln!("rust-social-ledger starting on port {}", port);
    let (addr, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            tokio::signal::ctrl_c().await.ok();
            eprintln!("[rust-social-ledger] Graceful shutdown initiated");
        eprintln!("{{\"event\":\"pod.shutdown.initiated\",\"service\":\"rust-social-ledger\",\"timestamp\":\"{}\"}}",
            chrono::Utc::now().to_rfc3339());;
        },
    );
    eprintln!("[rust-social-ledger] Listening on {}", addr);
    let startup_ms = _PROCESS_START.get_or_init(Instant::now).elapsed().as_millis();
    eprintln!("{{\"event\":\"pod.startup.complete\",\"service\":\"rust-social-ledger\",\"startup_ms\":{},\"timestamp\":\"{}\"}}",
        startup_ms, chrono::Utc::now().to_rfc3339());;
    server.await;
    Ok(())
}
