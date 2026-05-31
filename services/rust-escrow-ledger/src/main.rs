/*!
 * RemitFlow Property Escrow Ledger Service (Rust)
 *
 * High-performance, memory-safe escrow accounting service using Axum + Tokio.
 * Handles TigerBeetle-style double-entry accounting for property escrow:
 *   - Lock funds (buyer → escrow account, pending transfer)
 *   - Release funds (escrow → builder, on milestone approval)
 *   - Refund funds (escrow → buyer, on dispute/default)
 *   - Ledger queries (balance, history, audit trail)
 *
 * Language: Rust (chosen for zero-cost abstractions, memory safety guarantees,
 *   and sub-millisecond latency on financial accounting operations)
 *
 * Port: 8096
 *
 * Endpoints:
 *   GET  /health
 *   POST /escrow/lock         — Lock funds from buyer into escrow
 *   POST /escrow/release      — Release milestone funds to builder
 *   POST /escrow/refund       — Refund escrow funds to buyer
 *   GET  /escrow/balance/:id  — Get escrow account balance
 *   GET  /escrow/history/:id  — Get escrow transaction history
 *   GET  /metrics             — Prometheus-compatible metrics
 */

use axum::{
    extract::{Json, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowAccount {
    pub account_id: String,
    pub plan_id: String,
    pub buyer_id: u64,
    pub builder_id: u64,
    pub total_locked: f64,
    pub total_released: f64,
    pub total_refunded: f64,
    pub pending_amount: f64,
    pub status: String,     // "active", "frozen", "closed"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub entry_id: String,
    pub account_id: String,
    pub entry_type: String, // "lock", "release", "refund", "fee"
    pub debit_account: String,
    pub credit_account: String,
    pub amount: f64,
    pub currency: String,
    pub milestone_id: Option<String>,
    pub reference: String,
    pub status: String,     // "pending", "posted", "voided"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct EscrowMetrics {
    pub total_accounts: u64,
    pub active_accounts: u64,
    pub total_locked_usd: f64,
    pub total_released_usd: f64,
    pub total_refunded_usd: f64,
    pub total_entries: u64,
    pub locks_count: u64,
    pub releases_count: u64,
    pub refunds_count: u64,
}

type SharedState = Arc<Mutex<EscrowState>>;

#[derive(Debug, Default)]
pub struct EscrowState {
    pub accounts: HashMap<String, EscrowAccount>,
    pub ledger: Vec<LedgerEntry>,
    pub metrics: EscrowMetrics,
}

// ─── Request/Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LockRequest {
    pub plan_id: String,
    pub buyer_id: u64,
    pub builder_id: u64,
    pub amount: f64,
    pub currency: Option<String>,
    pub milestone_id: Option<String>,
    pub reference: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseRequest {
    pub account_id: String,
    pub milestone_id: String,
    pub amount: f64,
    pub builder_account: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RefundRequest {
    pub account_id: String,
    pub amount: f64,
    pub reason: String,
    pub dispute_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LockResponse {
    pub account_id: String,
    pub entry_id: String,
    pub amount_locked: f64,
    pub total_locked: f64,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ReleaseResponse {
    pub entry_id: String,
    pub amount_released: f64,
    pub total_released: f64,
    pub remaining_in_escrow: f64,
    pub milestone_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct RefundResponse {
    pub entry_id: String,
    pub amount_refunded: f64,
    pub total_refunded: f64,
    pub remaining_in_escrow: f64,
    pub status: String,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "service": "rust-escrow-ledger",
            "version": "1.0.0",
            "timestamp": Utc::now().to_rfc3339(),
        })),
    )
}

async fn lock_funds(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Json(req): Json<LockRequest>,
) -> impl IntoResponse {
    let mut s = state.lock().unwrap();
    let currency = req.currency.unwrap_or_else(|| "USD".to_string());

    // Validate amount
    if req.amount <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Amount must be positive"})),
        );
    }

    // Find or create escrow account
    let account_id = format!("ESC-{}", req.plan_id);
    let account = s.accounts.entry(account_id.clone()).or_insert_with(|| {
        s.metrics.total_accounts += 1;
        s.metrics.active_accounts += 1;
        EscrowAccount {
            account_id: account_id.clone(),
            plan_id: req.plan_id.clone(),
            buyer_id: req.buyer_id,
            builder_id: req.builder_id,
            total_locked: 0.0,
            total_released: 0.0,
            total_refunded: 0.0,
            pending_amount: 0.0,
            status: "active".to_string(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    });

    if account.status == "frozen" {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Account is frozen due to dispute"})),
        );
    }

    // Create double-entry ledger entry
    let entry_id = Uuid::new_v4().to_string();
    let entry = LedgerEntry {
        entry_id: entry_id.clone(),
        account_id: account_id.clone(),
        entry_type: "lock".to_string(),
        debit_account: format!("BUYER-{}", req.buyer_id),
        credit_account: account_id.clone(),
        amount: req.amount,
        currency: currency.clone(),
        milestone_id: req.milestone_id,
        reference: req.reference.unwrap_or_else(|| format!("LOCK-{}", &entry_id[..8])),
        status: "pending".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };

    account.total_locked += req.amount;
    account.pending_amount += req.amount;
    account.updated_at = Utc::now().to_rfc3339();

    s.ledger.push(entry);
    s.metrics.total_entries += 1;
    s.metrics.locks_count += 1;
    s.metrics.total_locked_usd += req.amount;

    let total_locked = account.total_locked;

    info!(
        plan_id = %req.plan_id,
        amount = req.amount,
        total_locked = total_locked,
        "Funds locked in escrow"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!(LockResponse {
            account_id,
            entry_id,
            amount_locked: req.amount,
            total_locked,
            status: "pending".to_string(),
        })),
    )
}

async fn release_funds(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Json(req): Json<ReleaseRequest>,
) -> impl IntoResponse {
    let mut s = state.lock().unwrap();

    let account = match s.accounts.get_mut(&req.account_id) {
        Some(a) => a,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Escrow account not found"})),
            );
        }
    };

    if account.status == "frozen" {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Cannot release from frozen account"})),
        );
    }

    let available = account.total_locked - account.total_released - account.total_refunded;
    if req.amount > available {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Insufficient escrow balance",
                "available": available,
                "requested": req.amount,
            })),
        );
    }

    let entry_id = Uuid::new_v4().to_string();
    let builder_account = req
        .builder_account
        .unwrap_or_else(|| format!("BUILDER-{}", account.builder_id));

    let entry = LedgerEntry {
        entry_id: entry_id.clone(),
        account_id: req.account_id.clone(),
        entry_type: "release".to_string(),
        debit_account: req.account_id.clone(),
        credit_account: builder_account,
        amount: req.amount,
        currency: "USD".to_string(),
        milestone_id: Some(req.milestone_id.clone()),
        reference: format!("REL-{}-{}", req.milestone_id, &entry_id[..8]),
        status: "posted".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };

    account.total_released += req.amount;
    account.pending_amount -= req.amount;
    account.updated_at = Utc::now().to_rfc3339();

    let total_released = account.total_released;
    let remaining = account.total_locked - account.total_released - account.total_refunded;

    s.ledger.push(entry);
    s.metrics.total_entries += 1;
    s.metrics.releases_count += 1;
    s.metrics.total_released_usd += req.amount;

    info!(
        account_id = %req.account_id,
        milestone_id = %req.milestone_id,
        amount = req.amount,
        remaining = remaining,
        "Milestone funds released to builder"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!(ReleaseResponse {
            entry_id,
            amount_released: req.amount,
            total_released,
            remaining_in_escrow: remaining,
            milestone_id: req.milestone_id,
            status: "posted".to_string(),
        })),
    )
}

async fn refund_funds(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Json(req): Json<RefundRequest>,
) -> impl IntoResponse {
    let mut s = state.lock().unwrap();

    let account = match s.accounts.get_mut(&req.account_id) {
        Some(a) => a,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Escrow account not found"})),
            );
        }
    };

    let available = account.total_locked - account.total_released - account.total_refunded;
    if req.amount > available {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Insufficient escrow balance for refund",
                "available": available,
                "requested": req.amount,
            })),
        );
    }

    let entry_id = Uuid::new_v4().to_string();
    let entry = LedgerEntry {
        entry_id: entry_id.clone(),
        account_id: req.account_id.clone(),
        entry_type: "refund".to_string(),
        debit_account: req.account_id.clone(),
        credit_account: format!("BUYER-{}", account.buyer_id),
        amount: req.amount,
        currency: "USD".to_string(),
        milestone_id: None,
        reference: format!(
            "REFUND-{}-{}",
            req.dispute_id.as_deref().unwrap_or("MANUAL"),
            &entry_id[..8]
        ),
        status: "posted".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };

    account.total_refunded += req.amount;
    account.pending_amount -= req.amount;
    account.updated_at = Utc::now().to_rfc3339();

    // Close account if fully refunded
    if (account.total_released + account.total_refunded - account.total_locked).abs() < 0.01 {
        account.status = "closed".to_string();
        s.metrics.active_accounts -= 1;
    }

    let total_refunded = account.total_refunded;
    let remaining = account.total_locked - account.total_released - account.total_refunded;

    s.ledger.push(entry);
    s.metrics.total_entries += 1;
    s.metrics.refunds_count += 1;
    s.metrics.total_refunded_usd += req.amount;

    info!(
        account_id = %req.account_id,
        amount = req.amount,
        reason = %req.reason,
        remaining = remaining,
        "Escrow funds refunded to buyer"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!(RefundResponse {
            entry_id,
            amount_refunded: req.amount,
            total_refunded,
            remaining_in_escrow: remaining,
            status: "posted".to_string(),
        })),
    )
}

async fn get_balance(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Path(account_id): Path<String>,
) -> impl IntoResponse {
    let s = state.lock().unwrap();
    match s.accounts.get(&account_id) {
        Some(account) => {
            let available = account.total_locked - account.total_released - account.total_refunded;
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "accountId": account.account_id,
                    "planId": account.plan_id,
                    "totalLocked": account.total_locked,
                    "totalReleased": account.total_released,
                    "totalRefunded": account.total_refunded,
                    "availableInEscrow": available,
                    "status": account.status,
                })),
            )
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Account not found"})),
        ),
    }
}

async fn get_history(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Path(account_id): Path<String>,
) -> impl IntoResponse {
    let s = state.lock().unwrap();
    let entries: Vec<&LedgerEntry> = s
        .ledger
        .iter()
        .filter(|e| e.account_id == account_id)
        .collect();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "accountId": account_id,
            "entries": entries,
            "totalEntries": entries.len(),
        })),
    )
}

async fn get_metrics(
    axum::extract::State(state): axum::extract::State<SharedState>,
) -> impl IntoResponse {
    let s = state.lock().unwrap();

    // Prometheus text format
    let prom = format!(
        "# HELP remitflow_escrow_accounts_total Total escrow accounts\n\
         # TYPE remitflow_escrow_accounts_total gauge\n\
         remitflow_escrow_accounts_total {{}}\t{}\n\
         # HELP remitflow_escrow_active_accounts Active escrow accounts\n\
         # TYPE remitflow_escrow_active_accounts gauge\n\
         remitflow_escrow_active_accounts {{}}\t{}\n\
         # HELP remitflow_escrow_locked_usd Total locked USD\n\
         # TYPE remitflow_escrow_locked_usd gauge\n\
         remitflow_escrow_locked_usd {{}}\t{:.2}\n\
         # HELP remitflow_escrow_released_usd Total released USD\n\
         # TYPE remitflow_escrow_released_usd gauge\n\
         remitflow_escrow_released_usd {{}}\t{:.2}\n\
         # HELP remitflow_escrow_refunded_usd Total refunded USD\n\
         # TYPE remitflow_escrow_refunded_usd gauge\n\
         remitflow_escrow_refunded_usd {{}}\t{:.2}\n\
         # HELP remitflow_escrow_entries_total Total ledger entries\n\
         # TYPE remitflow_escrow_entries_total counter\n\
         remitflow_escrow_entries_total {{}}\t{}\n",
        s.metrics.total_accounts,
        s.metrics.active_accounts,
        s.metrics.total_locked_usd,
        s.metrics.total_released_usd,
        s.metrics.total_refunded_usd,
        s.metrics.total_entries,
    );

    (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "text/plain")], prom)
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8096".to_string())
        .parse()
        .unwrap_or(8096);

    let state: SharedState = Arc::new(Mutex::new(EscrowState::default()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/escrow/lock", post(lock_funds))
        .route("/escrow/release", post(release_funds))
        .route("/escrow/refund", post(refund_funds))
        .route("/escrow/balance/{account_id}", get(get_balance))
        .route("/escrow/history/{account_id}", get(get_history))
        .route("/metrics", get(get_metrics))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Property Escrow Ledger Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
