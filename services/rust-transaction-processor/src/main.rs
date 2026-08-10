use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};
use uuid::Uuid;

// ─── PostgreSQL Schema (run on startup) ─────────────────────────────────────
/*
CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    balance_cents BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    sender_account_id TEXT NOT NULL REFERENCES accounts(account_id),
    receiver_account_id TEXT NOT NULL REFERENCES accounts(account_id),
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending',
    settlement_status TEXT NOT NULL DEFAULT 'pending',
    reference TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    entry_id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
    account_id TEXT NOT NULL REFERENCES accounts(account_id),
    entry_type TEXT NOT NULL,  -- 'debit' | 'credit'
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_events (
    event_id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
    event_type TEXT NOT NULL,  -- 'submitted' | 'confirmed' | 'completed' | 'failed'
    provider TEXT,
    provider_reference TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_status ON transactions(status);
CREATE INDEX idx_tx_settlement ON transactions(settlement_status);
CREATE INDEX idx_ledger_tx ON ledger_entries(transaction_id);
CREATE INDEX idx_settlement_tx ON settlement_events(transaction_id);
*/

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Account {
    account_id: String,
    user_id: String,
    currency: String,
    balance_cents: i64,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Transaction {
    transaction_id: String,
    sender_account_id: String,
    receiver_account_id: String,
    amount_cents: i64,
    currency: String,
    status: String,           // pending, processing, completed, failed, reversed
    settlement_status: String, // pending, submitted, confirmed, completed, failed
    reference: Option<String>,
    metadata: Option<serde_json::Value>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    settled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CreateAccountRequest {
    user_id: String,
    currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TransferRequest {
    sender_account_id: String,
    receiver_account_id: String,
    amount: f64,
    currency: String,
    reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SettlementUpdateRequest {
    status: String, // submitted, confirmed, completed, failed
    provider: Option<String>,
    provider_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

// ─── App State ───────────────────────────────────────────────────────────────

struct AppState {
    db: Client,
}

// ─── Database Helpers ────────────────────────────────────────────────────────

async fn init_db() -> Client {
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());

    let (client, connection) = tokio_postgres::connect(&db_url, NoTls)
        .await
        .expect("Failed to connect to PostgreSQL. Transaction processor cannot start without a database.");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("PostgreSQL connection error: {}", e);
        }
    });

    // Create tables if they don't exist
    client.batch_execute(r#"
        CREATE TABLE IF NOT EXISTS accounts (
            account_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            balance_cents BIGINT NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id TEXT PRIMARY KEY,
            sender_account_id TEXT NOT NULL REFERENCES accounts(account_id),
            receiver_account_id TEXT NOT NULL REFERENCES accounts(account_id),
            amount_cents BIGINT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            status TEXT NOT NULL DEFAULT 'pending',
            settlement_status TEXT NOT NULL DEFAULT 'pending',
            reference TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            settled_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS ledger_entries (
            entry_id BIGSERIAL PRIMARY KEY,
            transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
            account_id TEXT NOT NULL REFERENCES accounts(account_id),
            entry_type TEXT NOT NULL,
            amount_cents BIGINT NOT NULL,
            currency TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS settlement_events (
            event_id BIGSERIAL PRIMARY KEY,
            transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
            event_type TEXT NOT NULL,
            provider TEXT,
            provider_reference TEXT,
            raw_response JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
        CREATE INDEX IF NOT EXISTS idx_tx_settlement ON transactions(settlement_status);
        CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_settlement_tx ON settlement_events(transaction_id);
    "#).await.expect("Failed to initialize database schema");

    client
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<Arc<Mutex<AppState>>>) -> Json<ApiResponse<serde_json::Value>> {
    let state = state.lock().await;
    let db_ok = state.db.query_one("SELECT 1", &[]).await.is_ok();

    Json(ApiResponse {
        success: db_ok,
        data: Some(json!({
            "service": "rust-transaction-processor",
            "version": "2.0.0",
            "database": if db_ok { "connected" } else { "disconnected" },
            "ledger_type": "double_entry_postgresql",
            "timestamp": Utc::now().to_rfc3339(),
        })),
        error: if !db_ok { Some("Database connection failed".to_string()) } else { None },
    })
}

async fn create_account(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(req): Json<CreateAccountRequest>,
) -> Result<Json<ApiResponse<Account>>, (StatusCode, Json<ApiResponse<()>>)> {
    let state = state.lock().await;
    let account_id = Uuid::new_v4().to_string();

    state.db.execute(
        "INSERT INTO accounts (account_id, user_id, currency) VALUES ($1, $2, $3)",
        &[&account_id, &req.user_id, &req.currency],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("DB error: {}", e)) }),
    ))?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(Account {
            account_id,
            user_id: req.user_id,
            currency: req.currency,
            balance_cents: 0,
            status: "active".to_string(),
        }),
        error: None,
    }))
}

async fn get_account(
    State(state): State<Arc<Mutex<AppState>>>,
    Path(account_id): Path<String>,
) -> Result<Json<ApiResponse<Account>>, (StatusCode, Json<ApiResponse<()>>)> {
    let state = state.lock().await;

    let row = state.db.query_one(
        "SELECT account_id, user_id, currency, balance_cents, status FROM accounts WHERE account_id = $1",
        &[&account_id],
    ).await.map_err(|e| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Account not found: {}", e)) }),
    ))?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(Account {
            account_id: row.get(0),
            user_id: row.get(1),
            currency: row.get(2),
            balance_cents: row.get(3),
            status: row.get(4),
        }),
        error: None,
    }))
}

async fn create_transfer(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(req): Json<TransferRequest>,
) -> Result<Json<ApiResponse<Transaction>>, (StatusCode, Json<ApiResponse<()>>)> {
    let mut state = state.lock().await;
    let tx_id = Uuid::new_v4().to_string();
    let amount_cents = (req.amount * 100.0) as i64;

    // Validate sender has sufficient balance
    let sender_row = state.db.query_one(
        "SELECT balance_cents, status FROM accounts WHERE account_id = $1 FOR UPDATE",
        &[&req.sender_account_id],
    ).await.map_err(|e| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Sender account not found: {}", e)) }),
    ))?;

    let sender_balance: i64 = sender_row.get(0);
    let sender_status: String = sender_row.get(1);

    if sender_status != "active" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse { success: false, data: None, error: Some("Sender account is not active".to_string()) }),
        ));
    }

    if sender_balance < amount_cents {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse { success: false, data: None, error: Some("Insufficient balance".to_string()) }),
        ));
    }

    // Validate receiver exists and is active
    let receiver_row = state.db.query_one(
        "SELECT status FROM accounts WHERE account_id = $1 FOR UPDATE",
        &[&req.receiver_account_id],
    ).await.map_err(|e| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Receiver account not found: {}", e)) }),
    ))?;

    let receiver_status: String = receiver_row.get(0);
    if receiver_status != "active" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse { success: false, data: None, error: Some("Receiver account is not active".to_string()) }),
        ));
    }

    // Create transaction record
    let now = Utc::now();
    state.db.execute(
        "INSERT INTO transactions (transaction_id, sender_account_id, receiver_account_id, amount_cents, currency, status, reference) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        &[&tx_id, &req.sender_account_id, &req.receiver_account_id, &amount_cents, &req.currency, &"pending", &req.reference],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Failed to create transaction: {}", e)) }),
    ))?;

    // Double-entry ledger: debit sender, credit receiver
    state.db.execute(
        "UPDATE accounts SET balance_cents = balance_cents - $1, updated_at = NOW() WHERE account_id = $2",
        &[&amount_cents, &req.sender_account_id],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Failed to debit sender: {}", e)) }),
    ))?;

    state.db.execute(
        "UPDATE accounts SET balance_cents = balance_cents + $1, updated_at = NOW() WHERE account_id = $2",
        &[&amount_cents, &req.receiver_account_id],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Failed to credit receiver: {}", e)) }),
    ))?;

    // Ledger entries
    state.db.execute(
        "INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount_cents, currency, description) VALUES ($1, $2, $3, $4, $5, $6)",
        &[&tx_id, &req.sender_account_id, &"debit", &amount_cents, &req.currency, &"Transfer debit"],
    ).await.ok();

    state.db.execute(
        "INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount_cents, currency, description) VALUES ($1, $2, $3, $4, $5, $6)",
        &[&tx_id, &req.receiver_account_id, &"credit", &amount_cents, &req.currency, &"Transfer credit"],
    ).await.ok();

    // Update transaction status to processing (pending settlement)
    state.db.execute(
        "UPDATE transactions SET status = 'processing', updated_at = NOW() WHERE transaction_id = $1",
        &[&tx_id],
    ).await.ok();

    Ok(Json(ApiResponse {
        success: true,
        data: Some(Transaction {
            transaction_id: tx_id,
            sender_account_id: req.sender_account_id,
            receiver_account_id: req.receiver_account_id,
            amount_cents,
            currency: req.currency,
            status: "processing".to_string(),
            settlement_status: "pending".to_string(),
            reference: req.reference,
            metadata: None,
            created_at: now,
            updated_at: now,
            settled_at: None,
        }),
        error: None,
    }))
}

async fn get_transaction(
    State(state): State<Arc<Mutex<AppState>>>,
    Path(tx_id): Path<String>,
) -> Result<Json<ApiResponse<Transaction>>, (StatusCode, Json<ApiResponse<()>>)> {
    let state = state.lock().await;

    let row = state.db.query_one(
        "SELECT transaction_id, sender_account_id, receiver_account_id, amount_cents, currency, status, settlement_status, reference, metadata, created_at, updated_at, settled_at FROM transactions WHERE transaction_id = $1",
        &[&tx_id],
    ).await.map_err(|e| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Transaction not found: {}", e)) }),
    ))?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(Transaction {
            transaction_id: row.get(0),
            sender_account_id: row.get(1),
            receiver_account_id: row.get(2),
            amount_cents: row.get(3),
            currency: row.get(4),
            status: row.get(5),
            settlement_status: row.get(6),
            reference: row.get(7),
            metadata: row.get(8),
            created_at: row.get(9),
            updated_at: row.get(10),
            settled_at: row.get(11),
        }),
        error: None,
    }))
}

async fn update_settlement(
    State(state): State<Arc<Mutex<AppState>>>,
    Path(tx_id): Path<String>,
    Json(req): Json<SettlementUpdateRequest>,
) -> Result<Json<ApiResponse<Transaction>>, (StatusCode, Json<ApiResponse<()>>)> {
    let state = state.lock().await;
    let now = Utc::now();

    // Validate status transition
    let valid_statuses = ["submitted", "confirmed", "completed", "failed"];
    if !valid_statuses.contains(&req.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse { success: false, data: None, error: Some(format!("Invalid settlement status: {}", req.status)) }),
        ));
    }

    // Record settlement event
    state.db.execute(
        "INSERT INTO settlement_events (transaction_id, event_type, provider, provider_reference) VALUES ($1, $2, $3, $4)",
        &[&tx_id, &req.status, &req.provider, &req.provider_reference],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Failed to record settlement event: {}", e)) }),
    ))?;

    // Update transaction
    let settled_at = if req.status == "completed" { Some(&now) } else { None };
    let tx_status = if req.status == "completed" { "completed" } else if req.status == "failed" { "failed" } else { "processing" };

    state.db.execute(
        "UPDATE transactions SET settlement_status = $1, status = $2, settled_at = $3, updated_at = NOW() WHERE transaction_id = $4",
        &[&req.status, &tx_status, &settled_at, &tx_id],
    ).await.map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Failed to update transaction: {}", e)) }),
    ))?;

    // Return updated transaction
    let row = state.db.query_one(
        "SELECT transaction_id, sender_account_id, receiver_account_id, amount_cents, currency, status, settlement_status, reference, metadata, created_at, updated_at, settled_at FROM transactions WHERE transaction_id = $1",
        &[&tx_id],
    ).await.map_err(|e| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse { success: false, data: None, error: Some(format!("Transaction not found after update: {}", e)) }),
    ))?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(Transaction {
            transaction_id: row.get(0),
            sender_account_id: row.get(1),
            receiver_account_id: row.get(2),
            amount_cents: row.get(3),
            currency: row.get(4),
            status: row.get(5),
            settlement_status: row.get(6),
            reference: row.get(7),
            metadata: row.get(8),
            created_at: row.get(9),
            updated_at: row.get(10),
            settled_at: row.get(11),
        }),
        error: None,
    }))
}

async fn list_transactions(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<ApiResponse<Vec<Transaction>>> {
    let state = state.lock().await;

    let rows = state.db.query(
        "SELECT transaction_id, sender_account_id, receiver_account_id, amount_cents, currency, status, settlement_status, reference, metadata, created_at, updated_at, settled_at FROM transactions ORDER BY created_at DESC LIMIT 100",
        &[],
    ).await.unwrap_or_default();

    let transactions: Vec<Transaction> = rows.iter().map(|row| Transaction {
        transaction_id: row.get(0),
        sender_account_id: row.get(1),
        receiver_account_id: row.get(2),
        amount_cents: row.get(3),
        currency: row.get(4),
        status: row.get(5),
        settlement_status: row.get(6),
        reference: row.get(7),
        metadata: row.get(8),
        created_at: row.get(9),
        updated_at: row.get(10),
        settled_at: row.get(11),
    }).collect();

    Json(ApiResponse {
        success: true,
        data: Some(transactions),
        error: None,
    })
}

// ─── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let db = init_db().await;
    let state = Arc::new(Mutex::new(AppState { db }));

    let app = Router::new()
        .route("/health", get(health))
        .route("/accounts", post(create_account))
        .route("/accounts/:account_id", get(get_account))
        .route("/transactions", post(create_transfer))
        .route("/transactions", get(list_transactions))
        .route("/transactions/:transaction_id", get(get_transaction))
        .route("/transactions/:transaction_id/settlement", post(update_settlement))
        .with_state(state);

    let port = env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind to port");

    println!("Rust Transaction Processor v2.0 running on port {}", port);
    println!("   Ledger: Double-entry PostgreSQL");
    println!("   Settlement: Async state machine (pending -> submitted -> confirmed -> completed)");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
