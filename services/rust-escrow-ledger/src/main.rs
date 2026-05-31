/*!
 * RemitFlow Property Escrow Ledger Service (Rust)
 *
 * High-performance, memory-safe escrow accounting service using Axum + Tokio + PostgreSQL.
 * Handles TigerBeetle-style double-entry accounting for property escrow:
 *   - Lock funds (buyer → escrow account, pending transfer)
 *   - Release funds (escrow → builder, on milestone approval)
 *   - Refund funds (escrow → buyer, on dispute/default)
 *   - Ledger queries (balance, history, audit trail)
 *
 * Language: Rust (chosen for zero-cost abstractions, memory safety guarantees,
 *   and sub-millisecond latency on financial accounting operations)
 *
 * Port: 8096 (configurable via PORT env var)
 *
 * Endpoints:
 *   GET  /health              — Liveness probe (always 200 if process is alive)
 *   GET  /readiness           — Readiness probe (checks DB connectivity)
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
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Configuration ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub max_db_connections: u32,
}

impl Config {
    fn from_env() -> Self {
        Self {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8096".to_string())
                .parse()
                .unwrap_or(8096),
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://remitflow:remitflow@localhost:5432/remitflow".to_string()),
            max_db_connections: std::env::var("MAX_DB_CONNECTIONS")
                .unwrap_or_else(|_| "10".to_string())
                .parse()
                .unwrap_or(10),
        }
    }
}

// ─── Application State ───────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub start_time: Instant,
    pub metrics: Arc<RwLock<EscrowMetrics>>,
}

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowAccount {
    pub account_id: String,
    pub plan_id: String,
    pub buyer_id: i64,
    pub builder_id: i64,
    pub total_locked: f64,
    pub total_released: f64,
    pub total_refunded: f64,
    pub pending_amount: f64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub entry_id: String,
    pub account_id: String,
    pub entry_type: String,
    pub debit_account: String,
    pub credit_account: String,
    pub amount: f64,
    pub currency: String,
    pub milestone_id: Option<String>,
    pub reference: String,
    pub status: String,
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
    pub errors_count: u64,
}

// ─── Request/Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LockRequest {
    pub plan_id: String,
    pub buyer_id: i64,
    pub builder_id: i64,
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

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    let uptime = state.start_time.elapsed();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "service": "rust-escrow-ledger",
            "version": "1.0.0",
            "uptime_seconds": uptime.as_secs(),
            "timestamp": Utc::now().to_rfc3339(),
        })),
    )
}

async fn readiness(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ready",
                "database": "connected",
                "timestamp": Utc::now().to_rfc3339(),
            })),
        ),
        Err(e) => {
            error!(error = %e, "Readiness check failed: DB unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "not_ready",
                    "database": "disconnected",
                    "error": e.to_string(),
                })),
            )
        }
    }
}

async fn lock_funds(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<LockRequest>,
) -> impl IntoResponse {
    let currency = req.currency.unwrap_or_else(|| "USD".to_string());

    if req.amount <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Amount must be positive"})),
        );
    }

    let account_id = format!("ESC-{}", req.plan_id);
    let entry_id = Uuid::new_v4().to_string();
    let reference = req.reference.unwrap_or_else(|| format!("LOCK-{}", &entry_id[..8]));

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            error!(error = %e, "Failed to begin transaction");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database transaction failed"})),
            );
        }
    };

    // Upsert escrow account
    let upsert_result = sqlx::query(
        r#"INSERT INTO escrow_accounts (account_id, plan_id, buyer_id, builder_id, total_locked, total_released, total_refunded, pending_amount, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, 0, $5, 'active', NOW(), NOW())
           ON CONFLICT (account_id) DO UPDATE SET
             total_locked = escrow_accounts.total_locked + $5,
             pending_amount = escrow_accounts.pending_amount + $5,
             updated_at = NOW()
           RETURNING total_locked, status"#
    )
    .bind(&account_id)
    .bind(&req.plan_id)
    .bind(req.buyer_id)
    .bind(req.builder_id)
    .bind(req.amount)
    .fetch_one(&mut *tx)
    .await;

    let (total_locked, account_status) = match upsert_result {
        Ok(row) => (row.get::<f64, _>("total_locked"), row.get::<String, _>("status")),
        Err(e) => {
            error!(error = %e, plan_id = %req.plan_id, "Failed to upsert escrow account");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to create/update escrow account"})),
            );
        }
    };

    if account_status == "frozen" {
        let _ = tx.rollback().await;
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Account is frozen due to dispute"})),
        );
    }

    // Insert ledger entry
    let insert_result = sqlx::query(
        r#"INSERT INTO escrow_ledger_entries (entry_id, account_id, entry_type, debit_account, credit_account, amount, currency, milestone_id, reference, status, created_at)
           VALUES ($1, $2, 'lock', $3, $4, $5, $6, $7, $8, 'pending', NOW())"#
    )
    .bind(&entry_id)
    .bind(&account_id)
    .bind(format!("BUYER-{}", req.buyer_id))
    .bind(&account_id)
    .bind(req.amount)
    .bind(&currency)
    .bind(&req.milestone_id)
    .bind(&reference)
    .execute(&mut *tx)
    .await;

    if let Err(e) = insert_result {
        error!(error = %e, "Failed to insert ledger entry");
        let _ = tx.rollback().await;
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to record ledger entry"})),
        );
    }

    if let Err(e) = tx.commit().await {
        error!(error = %e, "Failed to commit lock transaction");
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Transaction commit failed"})),
        );
    }

    let mut m = state.metrics.write().await;
    m.locks_count += 1;
    m.total_entries += 1;
    m.total_locked_usd += req.amount;

    info!(plan_id = %req.plan_id, amount = req.amount, total_locked = total_locked, "Funds locked in escrow");

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
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<ReleaseRequest>,
) -> impl IntoResponse {
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            error!(error = %e, "Failed to begin release transaction");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database transaction failed"})),
            );
        }
    };

    let account_row = sqlx::query(
        "SELECT total_locked, total_released, total_refunded, builder_id, status FROM escrow_accounts WHERE account_id = $1 FOR UPDATE"
    )
    .bind(&req.account_id)
    .fetch_optional(&mut *tx)
    .await;

    let row = match account_row {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Escrow account not found"})),
            );
        }
        Err(e) => {
            error!(error = %e, "Failed to fetch escrow account for release");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database query failed"})),
            );
        }
    };

    let status: String = row.get("status");
    if status == "frozen" {
        let _ = tx.rollback().await;
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Cannot release from frozen account"})),
        );
    }

    let total_locked: f64 = row.get("total_locked");
    let total_released: f64 = row.get("total_released");
    let total_refunded: f64 = row.get("total_refunded");
    let builder_id: i64 = row.get("builder_id");
    let available = total_locked - total_released - total_refunded;

    if req.amount > available {
        let _ = tx.rollback().await;
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
    let builder_account = req.builder_account.unwrap_or_else(|| format!("BUILDER-{}", builder_id));

    // Update account
    if let Err(e) = sqlx::query(
        "UPDATE escrow_accounts SET total_released = total_released + $1, pending_amount = pending_amount - $1, updated_at = NOW() WHERE account_id = $2"
    )
    .bind(req.amount)
    .bind(&req.account_id)
    .execute(&mut *tx)
    .await {
        error!(error = %e, "Failed to update escrow account for release");
        let _ = tx.rollback().await;
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to update account"})),
        );
    }

    // Insert ledger entry
    if let Err(e) = sqlx::query(
        r#"INSERT INTO escrow_ledger_entries (entry_id, account_id, entry_type, debit_account, credit_account, amount, currency, milestone_id, reference, status, created_at)
           VALUES ($1, $2, 'release', $3, $4, $5, 'USD', $6, $7, 'posted', NOW())"#
    )
    .bind(&entry_id)
    .bind(&req.account_id)
    .bind(&req.account_id)
    .bind(&builder_account)
    .bind(req.amount)
    .bind(&req.milestone_id)
    .bind(format!("REL-{}-{}", req.milestone_id, &entry_id[..8]))
    .execute(&mut *tx)
    .await {
        error!(error = %e, "Failed to insert release ledger entry");
        let _ = tx.rollback().await;
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to record release"})),
        );
    }

    if let Err(e) = tx.commit().await {
        error!(error = %e, "Failed to commit release transaction");
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Transaction commit failed"})),
        );
    }

    let new_total_released = total_released + req.amount;
    let remaining = total_locked - new_total_released - total_refunded;

    let mut m = state.metrics.write().await;
    m.releases_count += 1;
    m.total_entries += 1;
    m.total_released_usd += req.amount;

    info!(account_id = %req.account_id, milestone_id = %req.milestone_id, amount = req.amount, remaining = remaining, "Milestone funds released to builder");

    (
        StatusCode::OK,
        Json(serde_json::json!(ReleaseResponse {
            entry_id,
            amount_released: req.amount,
            total_released: new_total_released,
            remaining_in_escrow: remaining,
            milestone_id: req.milestone_id,
            status: "posted".to_string(),
        })),
    )
}

async fn refund_funds(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<RefundRequest>,
) -> impl IntoResponse {
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            error!(error = %e, "Failed to begin refund transaction");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database transaction failed"})),
            );
        }
    };

    let account_row = sqlx::query(
        "SELECT total_locked, total_released, total_refunded, buyer_id, status FROM escrow_accounts WHERE account_id = $1 FOR UPDATE"
    )
    .bind(&req.account_id)
    .fetch_optional(&mut *tx)
    .await;

    let row = match account_row {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Escrow account not found"})),
            );
        }
        Err(e) => {
            error!(error = %e, "Failed to fetch escrow account for refund");
            let mut m = state.metrics.write().await;
            m.errors_count += 1;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database query failed"})),
            );
        }
    };

    let total_locked: f64 = row.get("total_locked");
    let total_released: f64 = row.get("total_released");
    let total_refunded: f64 = row.get("total_refunded");
    let buyer_id: i64 = row.get("buyer_id");
    let available = total_locked - total_released - total_refunded;

    if req.amount > available {
        let _ = tx.rollback().await;
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
    let new_total_refunded = total_refunded + req.amount;
    let remaining = total_locked - total_released - new_total_refunded;

    // Close account if fully disbursed
    let new_status = if (total_released + new_total_refunded - total_locked).abs() < 0.01 {
        "closed"
    } else {
        "active"
    };

    if let Err(e) = sqlx::query(
        "UPDATE escrow_accounts SET total_refunded = total_refunded + $1, pending_amount = pending_amount - $1, status = $2, updated_at = NOW() WHERE account_id = $3"
    )
    .bind(req.amount)
    .bind(new_status)
    .bind(&req.account_id)
    .execute(&mut *tx)
    .await {
        error!(error = %e, "Failed to update account for refund");
        let _ = tx.rollback().await;
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to update account"})),
        );
    }

    if let Err(e) = sqlx::query(
        r#"INSERT INTO escrow_ledger_entries (entry_id, account_id, entry_type, debit_account, credit_account, amount, currency, milestone_id, reference, status, created_at)
           VALUES ($1, $2, 'refund', $3, $4, $5, 'USD', NULL, $6, 'posted', NOW())"#
    )
    .bind(&entry_id)
    .bind(&req.account_id)
    .bind(&req.account_id)
    .bind(format!("BUYER-{}", buyer_id))
    .bind(req.amount)
    .bind(format!("REFUND-{}-{}", req.dispute_id.as_deref().unwrap_or("MANUAL"), &entry_id[..8]))
    .execute(&mut *tx)
    .await {
        error!(error = %e, "Failed to insert refund ledger entry");
        let _ = tx.rollback().await;
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to record refund"})),
        );
    }

    if let Err(e) = tx.commit().await {
        error!(error = %e, "Failed to commit refund transaction");
        let mut m = state.metrics.write().await;
        m.errors_count += 1;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Transaction commit failed"})),
        );
    }

    let mut m = state.metrics.write().await;
    m.refunds_count += 1;
    m.total_entries += 1;
    m.total_refunded_usd += req.amount;
    if new_status == "closed" {
        m.active_accounts = m.active_accounts.saturating_sub(1);
    }

    info!(account_id = %req.account_id, amount = req.amount, reason = %req.reason, remaining = remaining, "Escrow funds refunded to buyer");

    (
        StatusCode::OK,
        Json(serde_json::json!(RefundResponse {
            entry_id,
            amount_refunded: req.amount,
            total_refunded: new_total_refunded,
            remaining_in_escrow: remaining,
            status: "posted".to_string(),
        })),
    )
}

async fn get_balance(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(account_id): Path<String>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "SELECT account_id, plan_id, total_locked, total_released, total_refunded, status FROM escrow_accounts WHERE account_id = $1"
    )
    .bind(&account_id)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(row)) => {
            let total_locked: f64 = row.get("total_locked");
            let total_released: f64 = row.get("total_released");
            let total_refunded: f64 = row.get("total_refunded");
            let available = total_locked - total_released - total_refunded;
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "accountId": row.get::<String, _>("account_id"),
                    "planId": row.get::<String, _>("plan_id"),
                    "totalLocked": total_locked,
                    "totalReleased": total_released,
                    "totalRefunded": total_refunded,
                    "availableInEscrow": available,
                    "status": row.get::<String, _>("status"),
                })),
            )
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Account not found"})),
        ),
        Err(e) => {
            error!(error = %e, account_id = %account_id, "Failed to fetch balance");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database query failed"})),
            )
        }
    }
}

async fn get_history(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(account_id): Path<String>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "SELECT entry_id, account_id, entry_type, debit_account, credit_account, amount, currency, milestone_id, reference, status, created_at FROM escrow_ledger_entries WHERE account_id = $1 ORDER BY created_at DESC LIMIT 100"
    )
    .bind(&account_id)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(rows) => {
            let entries: Vec<serde_json::Value> = rows.iter().map(|r| {
                serde_json::json!({
                    "entryId": r.get::<String, _>("entry_id"),
                    "accountId": r.get::<String, _>("account_id"),
                    "entryType": r.get::<String, _>("entry_type"),
                    "debitAccount": r.get::<String, _>("debit_account"),
                    "creditAccount": r.get::<String, _>("credit_account"),
                    "amount": r.get::<f64, _>("amount"),
                    "currency": r.get::<String, _>("currency"),
                    "milestoneId": r.get::<Option<String>, _>("milestone_id"),
                    "reference": r.get::<String, _>("reference"),
                    "status": r.get::<String, _>("status"),
                    "createdAt": r.get::<String, _>("created_at"),
                })
            }).collect();
            let count = entries.len();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "accountId": account_id,
                    "entries": entries,
                    "totalEntries": count,
                })),
            )
        }
        Err(e) => {
            error!(error = %e, account_id = %account_id, "Failed to fetch history");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database query failed"})),
            )
        }
    }
}

async fn get_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    let m = state.metrics.read().await;
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
         remitflow_escrow_entries_total {{}}\t{}\n\
         # HELP remitflow_escrow_errors_total Total errors\n\
         # TYPE remitflow_escrow_errors_total counter\n\
         remitflow_escrow_errors_total {{}}\t{}\n",
        m.total_accounts, m.active_accounts,
        m.total_locked_usd, m.total_released_usd, m.total_refunded_usd,
        m.total_entries, m.errors_count,
    );
    (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "text/plain")], prom)
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let config = Config::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(config.max_db_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to PostgreSQL — check DATABASE_URL");

    // Run migrations (create tables if not exist)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS escrow_accounts (
            account_id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            buyer_id BIGINT NOT NULL,
            builder_id BIGINT NOT NULL,
            total_locked DOUBLE PRECISION NOT NULL DEFAULT 0,
            total_released DOUBLE PRECISION NOT NULL DEFAULT 0,
            total_refunded DOUBLE PRECISION NOT NULL DEFAULT 0,
            pending_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ).execute(&pool).await.expect("Failed to create escrow_accounts table");

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS escrow_ledger_entries (
            entry_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES escrow_accounts(account_id),
            entry_type TEXT NOT NULL,
            debit_account TEXT NOT NULL,
            credit_account TEXT NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            milestone_id TEXT,
            reference TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ).execute(&pool).await.expect("Failed to create escrow_ledger_entries table");

    let state = AppState {
        db: pool,
        start_time: Instant::now(),
        metrics: Arc::new(RwLock::new(EscrowMetrics::default())),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/readiness", get(readiness))
        .route("/escrow/lock", post(lock_funds))
        .route("/escrow/release", post(release_funds))
        .route("/escrow/refund", post(refund_funds))
        .route("/escrow/balance/{account_id}", get(get_balance))
        .route("/escrow/history/{account_id}", get(get_history))
        .route("/metrics", get(get_metrics))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Property Escrow Ledger Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await
        .expect("Failed to bind TCP listener");
    axum::serve(listener, app).await
        .expect("Server failed to start");
}
