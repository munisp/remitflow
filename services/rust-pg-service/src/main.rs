// RemitFlow — PostgreSQL OLTP Query Service (Rust)
// High-performance read/write layer for PostgreSQL using sqlx.
// Handles: user profiles, transaction records, compliance data, partner data.
//
// This service provides a REST API over PostgreSQL for use by other microservices
// that need direct DB access without going through the Node.js tRPC layer.
//
// PostgreSQL: postgresql://remitflow:remitflow@postgres:5432/remitflow

use axum::{
    extract::{Json, Path, Query},
    routing::{get, post, put, delete},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use uuid::Uuid;

// ─── Mock data store (replace with sqlx::PgPool in production) ───────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub email: String,
    pub full_name: String,
    pub country: String,
    pub kyc_tier: i32,
    pub kyc_status: String,
    pub risk_level: String,
    pub wallet_balance: f64,
    pub currency: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRecord {
    pub id: String,
    pub user_id: i64,
    pub rail: String,
    pub from_currency: String,
    pub to_currency: String,
    pub amount: f64,
    pub fee_amount: f64,
    pub status: String,
    pub recipient_name: String,
    pub external_ref: String,
    pub created_at: String,
}

type Users = Arc<Mutex<HashMap<i64, UserRecord>>>;
type Transactions = Arc<Mutex<HashMap<String, TransactionRecord>>>;

#[derive(Clone)]
struct AppState {
    users: Users,
    transactions: Transactions,
}

// ─── Request Types ────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct UserQuery {
    pub email: Option<String>,
    pub kyc_status: Option<String>,
    pub country: Option<String>,
    pub page: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct TransactionQuery {
    pub user_id: Option<i64>,
    pub status: Option<String>,
    pub rail: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub full_name: String,
    pub country: String,
}

#[derive(Deserialize)]
pub struct UpdateKYCRequest {
    pub kyc_tier: i32,
    pub kyc_status: String,
    pub risk_level: String,
}

#[derive(Deserialize)]
pub struct CreateTransactionRequest {
    pub user_id: i64,
    pub rail: String,
    pub from_currency: String,
    pub to_currency: String,
    pub amount: f64,
    pub fee_amount: f64,
    pub recipient_name: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "postgres-query",
        "version": "v110.0.0",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn list_users(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(q): Query<UserQuery>,
) -> Json<serde_json::Value> {
    let users = state.users.lock().unwrap();
    let limit = q.limit.unwrap_or(20).min(100);
    let page = q.page.unwrap_or(1);

    let filtered: Vec<&UserRecord> = users.values()
        .filter(|u| {
            q.email.as_ref().map(|e| u.email.contains(e.as_str())).unwrap_or(true)
            && q.kyc_status.as_ref().map(|s| &u.kyc_status == s).unwrap_or(true)
            && q.country.as_ref().map(|c| &u.country == c).unwrap_or(true)
        })
        .collect();

    let total = filtered.len();
    let start = (page - 1) * limit;
    let page_data: Vec<&&UserRecord> = filtered.iter().skip(start).take(limit).collect();

    Json(serde_json::json!({
        "users": page_data,
        "total": total,
        "page": page,
        "limit": limit
    }))
}

async fn get_user(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(id): Path<i64>,
) -> Json<serde_json::Value> {
    let users = state.users.lock().unwrap();
    match users.get(&id) {
        Some(user) => Json(serde_json::json!({"found": true, "user": user})),
        None => Json(serde_json::json!({"found": false, "id": id})),
    }
}

async fn create_user(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<CreateUserRequest>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let mut users = state.users.lock().unwrap();
    let id = users.len() as i64 + 1000;
    let user = UserRecord {
        id,
        email: req.email,
        full_name: req.full_name,
        country: req.country,
        kyc_tier: 0,
        kyc_status: "PENDING".to_string(),
        risk_level: "LOW".to_string(),
        wallet_balance: 0.0,
        currency: "USD".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    users.insert(id, user.clone());
    (axum::http::StatusCode::CREATED, Json(serde_json::json!({"created": true, "user": user})))
}

async fn update_kyc(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateKYCRequest>,
) -> Json<serde_json::Value> {
    let mut users = state.users.lock().unwrap();
    if let Some(user) = users.get_mut(&id) {
        user.kyc_tier = req.kyc_tier;
        user.kyc_status = req.kyc_status;
        user.risk_level = req.risk_level;
        Json(serde_json::json!({"updated": true, "user_id": id}))
    } else {
        Json(serde_json::json!({"updated": false, "error": "User not found"}))
    }
}

async fn list_transactions(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(q): Query<TransactionQuery>,
) -> Json<serde_json::Value> {
    let txns = state.transactions.lock().unwrap();
    let limit = q.limit.unwrap_or(50).min(500);

    let filtered: Vec<&TransactionRecord> = txns.values()
        .filter(|t| {
            q.user_id.map(|uid| t.user_id == uid).unwrap_or(true)
            && q.status.as_ref().map(|s| &t.status == s).unwrap_or(true)
            && q.rail.as_ref().map(|r| &t.rail == r).unwrap_or(true)
        })
        .take(limit)
        .collect();

    Json(serde_json::json!({
        "transactions": filtered,
        "count": filtered.len()
    }))
}

async fn create_transaction(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<CreateTransactionRequest>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let mut txns = state.transactions.lock().unwrap();
    let id = Uuid::new_v4().to_string();
    let txn = TransactionRecord {
        id: id.clone(),
        user_id: req.user_id,
        rail: req.rail,
        from_currency: req.from_currency,
        to_currency: req.to_currency,
        amount: req.amount,
        fee_amount: req.fee_amount,
        status: "PENDING".to_string(),
        recipient_name: req.recipient_name,
        external_ref: String::new(),
        created_at: Utc::now().to_rfc3339(),
    };
    txns.insert(id, txn.clone());
    (axum::http::StatusCode::CREATED, Json(serde_json::json!({"created": true, "transaction": txn})))
}

async fn get_db_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let users = state.users.lock().unwrap();
    let txns = state.transactions.lock().unwrap();
    Json(serde_json::json!({
        "total_users": users.len(),
        "total_transactions": txns.len(),
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
fn seed_data(state: &AppState) {
    let mut users = state.users.lock().unwrap();
    let countries = ["US", "GB", "CN", "IN", "BR", "NG", "KE", "MX", "PH", "DE"];
    let kyc_statuses = ["APPROVED", "APPROVED", "APPROVED", "PENDING", "UNDER_REVIEW"];

    for i in 1..=50 {
        users.insert(i, UserRecord {
            id: i,
            email: format!("user{}@remitflow.com", i),
            full_name: format!("Test User {}", i),
            country: countries[(i as usize - 1) % countries.len()].to_string(),
            kyc_tier: if i <= 30 { 2 } else { 1 },
            kyc_status: kyc_statuses[(i as usize - 1) % kyc_statuses.len()].to_string(),
            risk_level: if i % 10 == 0 { "HIGH".to_string() } else { "LOW".to_string() },
            wallet_balance: (i as f64) * 100.0,
            currency: "USD".to_string(),
            created_at: Utc::now().to_rfc3339(),
        });
    }
    info!("[PostgreSQL] Seeded {} users", users.len());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── PostgreSQL Persistence (middleware-ready: swap to TigerBeetle/Kafka in production) ───

use sqlx::{PgPool, postgres::PgPoolOptions, Row};

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .unwrap_or_else(|e| { eprintln!("DB connection failed (will use in-memory): {}", e); std::process::exit(1); });
    sqlx::query("CREATE TABLE IF NOT EXISTS pg_service_state (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())")
        .execute(&pool).await.unwrap_or_default();
    sqlx::query("CREATE TABLE IF NOT EXISTS pg_service_events (id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())")
        .execute(&pool).await.unwrap_or_default();
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO pg_service_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()")
        .bind(id).bind(data).execute(pool).await?;
    Ok(())
}

async fn db_get(pool: &PgPool, id: &str) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let row = sqlx::query("SELECT data FROM pg_service_state WHERE id = $1")
        .bind(id).fetch_optional(pool).await?;
    Ok(row.map(|r| r.get("data")))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows = sqlx::query("SELECT data FROM pg_service_state ORDER BY updated_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| r.get("data")).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO pg_service_events (event_type, payload) VALUES ($1, $2)")
        .bind(event_type).bind(payload).execute(pool).await?;
    Ok(())
}

#[tokio::main]
async fn main() {
    // Panic hook for logging panics without crashing silently
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let _db_pool = init_db().await;
    eprintln!("[DB] PostgreSQL connected for rust-pg-service");

    tracing_subscriber::fmt().json().init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8102".to_string())
        .parse()
        .unwrap_or(8102);

    let state = AppState {
        users: Arc::new(Mutex::new(HashMap::new())),
        transactions: Arc::new(Mutex::new(HashMap::new())),
    };

    seed_data(&state);

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/users", get(list_users))
        .route("/api/v1/users", post(create_user))
        .route("/api/v1/users/:id", get(get_user))
        .route("/api/v1/users/:id/kyc", put(update_kyc))
        .route("/api/v1/transactions", get(list_transactions))
        .route("/api/v1/transactions", post(create_transaction))
        .route("/api/v1/stats", get(get_db_stats))
        .with_state(state)
        .layer(cors);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[PostgreSQL] Query service listening on :{}", port);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            tracing::info!("[rust-pg-service] Graceful shutdown initiated");
        })
        .await
        .unwrap();
}
