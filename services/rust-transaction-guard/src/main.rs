//! RemitFlow — Rust Transaction Guard
//!
//! High-performance service providing:
//!   - Cryptographic receipts for every fund movement (SHA-256 hash chain)
//!   - Double-spend prevention via serial verification
//!   - Atomic balance assertions (pre/post invariant checking)
//!   - Fencing token management for distributed locks
//!   - Receipt verification for audit/compliance
//!
//! Port: 8160
//!
//! Every financial transaction produces a cryptographic receipt linking:
//!   prev_receipt_hash → operation → new_receipt_hash
//! This creates an immutable hash chain that can detect tampering.

use std::collections::HashMap;
use std::sync::{Arc, RwLock, atomic::{AtomicU64, Ordering}};
use std::time::{SystemTime, UNIX_EPOCH};
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};
use warp::{Filter, Reply};
use tokio::signal;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

const MIGRATION_SQL: &str = include_str!("../migrations/0001_init.sql");

// ── Domain Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionReceipt {
    pub receipt_id: String,
    pub operation_id: String,
    pub flow_type: String,
    pub user_id: i64,
    pub amount: f64,
    pub currency: String,
    pub debit_account: String,
    pub credit_account: String,
    pub prev_receipt_hash: String,
    pub receipt_hash: String,
    pub timestamp: u64,
    pub fencing_token: u64,
    pub balance_pre: f64,
    pub balance_post: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceAssertion {
    pub account_id: String,
    pub currency: String,
    pub expected_balance: f64,
    pub actual_balance: f64,
    pub operation_id: String,
    pub assertion_type: String, // "pre_debit", "post_debit", "pre_credit", "post_credit"
    pub passed: bool,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FencingToken {
    pub token: u64,
    pub resource: String,
    pub owner: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoubleSpendCheck {
    pub operation_id: String,
    pub transfer_ref: String,
    pub already_processed: bool,
    pub original_receipt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub receipt_id: String,
    pub valid: bool,
    pub chain_intact: bool,
    pub balance_consistent: bool,
    pub reason: Option<String>,
}

// ── Request/Response ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateReceiptRequest {
    pub operation_id: String,
    pub flow_type: String,
    pub user_id: i64,
    pub amount: f64,
    pub currency: String,
    pub debit_account: String,
    pub credit_account: String,
    pub balance_pre: f64,
    pub balance_post: f64,
}

#[derive(Debug, Deserialize)]
pub struct CheckDoubleSpendRequest {
    pub operation_id: String,
    pub transfer_ref: String,
}

#[derive(Debug, Deserialize)]
pub struct AssertBalanceRequest {
    pub account_id: String,
    pub currency: String,
    pub expected_balance: f64,
    pub actual_balance: f64,
    pub operation_id: String,
    pub assertion_type: String,
}

#[derive(Debug, Deserialize)]
pub struct IssueFencingTokenRequest {
    pub resource: String,
    pub owner: String,
    pub ttl_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct VerifyReceiptRequest {
    pub receipt_id: String,
}

// ── State ───────────────────────────────────────────────────────────────────

struct AppState {
    receipts: RwLock<Vec<TransactionReceipt>>,
    receipt_map: RwLock<HashMap<String, usize>>, // operation_id -> receipt index
    processed_ops: RwLock<HashMap<String, String>>, // operation_id -> receipt_id (double-spend)
    fencing_tokens: RwLock<HashMap<String, FencingToken>>,
    balance_assertions: RwLock<Vec<BalanceAssertion>>,
    fencing_counter: AtomicU64,
    metrics: Metrics,
    /// PostgreSQL write-through pool (None = degraded in-memory mode, boot WARN).
    db: Option<PgPool>,
    /// Serializes receipt creation across the PG write + in-memory append so the
    /// hash chain stays ordered.
    receipt_lock: tokio::sync::Mutex<()>,
}

struct Metrics {
    receipts_created: AtomicU64,
    double_spend_blocked: AtomicU64,
    balance_assertions_passed: AtomicU64,
    balance_assertions_failed: AtomicU64,
    fencing_tokens_issued: AtomicU64,
    verifications_passed: AtomicU64,
    verifications_failed: AtomicU64,
}

impl AppState {
    fn new() -> Self {
        Self {
            receipts: RwLock::new(Vec::new()),
            receipt_map: RwLock::new(HashMap::new()),
            processed_ops: RwLock::new(HashMap::new()),
            fencing_tokens: RwLock::new(HashMap::new()),
            balance_assertions: RwLock::new(Vec::new()),
            fencing_counter: AtomicU64::new(1),
            metrics: Metrics {
                receipts_created: AtomicU64::new(0),
                double_spend_blocked: AtomicU64::new(0),
                balance_assertions_passed: AtomicU64::new(0),
                balance_assertions_failed: AtomicU64::new(0),
                fencing_tokens_issued: AtomicU64::new(0),
                verifications_passed: AtomicU64::new(0),
                verifications_failed: AtomicU64::new(0),
            },
            db: None,
            receipt_lock: tokio::sync::Mutex::new(()),
        }
    }
}

// ── PostgreSQL persistence (boot-load + write-through) ──────────────────────

async fn init_db() -> Option<PgPool> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => {
            eprintln!("[TransactionGuard] WARN: DATABASE_URL unset — DEGRADED in-memory mode; receipts/double-spend state will NOT survive restart");
            return None;
        }
    };
    let pool = PgPoolOptions::new().max_connections(10).connect(&db_url).await
        .expect("DATABASE_URL set but PostgreSQL unreachable — refusing to start guard without durable storage");
    sqlx::raw_sql(MIGRATION_SQL).execute(&pool).await.expect("failed to apply tx_guard migrations");
    eprintln!("[TransactionGuard] PostgreSQL connected, migrations applied");
    Some(pool)
}

async fn load_from_db(pool: &PgPool, state: &AppState) {
    // Receipts (ordered — hash chain)
    match sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT receipt_id, data FROM tx_guard_receipts ORDER BY timestamp_unix ASC, created_at ASC"
    ).fetch_all(pool).await {
        Ok(rows) => {
            let mut receipts = state.receipts.write().unwrap();
            let mut receipt_map = state.receipt_map.write().unwrap();
            for (rid, data) in rows {
                match serde_json::from_value::<TransactionReceipt>(data) {
                    Ok(r) => {
                        receipt_map.insert(r.operation_id.clone(), receipts.len());
                        receipts.push(r);
                        let _ = rid;
                    }
                    Err(e) => eprintln!("[TransactionGuard] WARN: skipping corrupt receipt row: {}", e),
                }
            }
            eprintln!("[TransactionGuard] boot-loaded {} receipts", receipts.len());
        }
        Err(e) => eprintln!("[TransactionGuard] ERROR: receipt boot-load failed: {}", e),
    }
    // Processed ops (double-spend registry)
    match sqlx::query_as::<_, (String, String)>(
        "SELECT operation_id, receipt_id FROM tx_guard_processed_ops"
    ).fetch_all(pool).await {
        Ok(rows) => {
            let mut processed = state.processed_ops.write().unwrap();
            for (op, rid) in rows { processed.insert(op, rid); }
            eprintln!("[TransactionGuard] boot-loaded {} processed ops", processed.len());
        }
        Err(e) => eprintln!("[TransactionGuard] ERROR: processed_ops boot-load failed: {}", e),
    }
    // Fencing tokens + counter resume
    match sqlx::query_as::<_, (String, i64, String, i64, i64)>(
        "SELECT resource, token, owner, issued_at, expires_at FROM tx_guard_fencing_tokens"
    ).fetch_all(pool).await {
        Ok(rows) => {
            let mut tokens = state.fencing_tokens.write().unwrap();
            let mut max_tok = 0i64;
            for (resource, token, owner, issued_at, expires_at) in rows {
                if token > max_tok { max_tok = token; }
                tokens.insert(resource.clone(), FencingToken {
                    token: token as u64, resource, owner,
                    issued_at: issued_at as u64, expires_at: expires_at as u64,
                });
            }
            if max_tok > 0 {
                state.fencing_counter.store(max_tok as u64 + 1, Ordering::SeqCst);
            }
            eprintln!("[TransactionGuard] boot-loaded {} fencing tokens (counter resumed at {})", tokens.len(), max_tok + 1);
        }
        Err(e) => eprintln!("[TransactionGuard] ERROR: fencing token boot-load failed: {}", e),
    }
}

async fn persist_receipt(pool: &PgPool, r: &TransactionReceipt) -> Result<(), sqlx::Error> {
    let data = serde_json::to_value(r).unwrap_or_default();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO tx_guard_receipts
            (receipt_id, operation_id, flow_type, user_id, amount, currency, debit_account, credit_account,
             prev_receipt_hash, receipt_hash, timestamp_unix, fencing_token, balance_pre, balance_post, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)"
    )
    .bind(&r.receipt_id).bind(&r.operation_id).bind(&r.flow_type).bind(r.user_id)
    .bind(r.amount).bind(&r.currency).bind(&r.debit_account).bind(&r.credit_account)
    .bind(&r.prev_receipt_hash).bind(&r.receipt_hash).bind(r.timestamp as i64)
    .bind(r.fencing_token as i64).bind(r.balance_pre).bind(r.balance_post).bind(&data)
    .execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO tx_guard_processed_ops (operation_id, receipt_id) VALUES ($1,$2)
         ON CONFLICT (operation_id) DO NOTHING"
    )
    .bind(&r.operation_id).bind(&r.receipt_id)
    .execute(&mut *tx).await?;
    tx.commit().await
}

async fn persist_fencing_token(pool: &PgPool, t: &FencingToken) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO tx_guard_fencing_tokens (resource, token, owner, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (resource) DO UPDATE SET token=$2, owner=$3, issued_at=$4, expires_at=$5"
    )
    .bind(&t.resource).bind(t.token as i64).bind(&t.owner)
    .bind(t.issued_at as i64).bind(t.expires_at as i64)
    .execute(pool).await?;
    Ok(())
}

async fn persist_assertion(pool: &PgPool, a: &BalanceAssertion) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO tx_guard_balance_assertions
            (account_id, currency, expected_balance, actual_balance, operation_id, assertion_type, passed, timestamp_unix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
    )
    .bind(&a.account_id).bind(&a.currency).bind(a.expected_balance).bind(a.actual_balance)
    .bind(&a.operation_id).bind(&a.assertion_type).bind(a.passed).bind(a.timestamp as i64)
    .execute(pool).await?;
    Ok(())
}

// ── Core Logic ──────────────────────────────────────────────────────────────

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn compute_receipt_hash(
    prev_hash: &str,
    operation_id: &str,
    amount: f64,
    debit: &str,
    credit: &str,
    timestamp: u64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.as_bytes());
    hasher.update(operation_id.as_bytes());
    hasher.update(amount.to_be_bytes());
    hasher.update(debit.as_bytes());
    hasher.update(credit.as_bytes());
    hasher.update(timestamp.to_be_bytes());
    format!("{:x}", hasher.finalize())
}

async fn create_receipt(state: &AppState, req: CreateReceiptRequest) -> Result<TransactionReceipt, String> {
    let _guard = state.receipt_lock.lock().await;
    let ts = now_epoch();
    let fencing_token = state.fencing_counter.fetch_add(1, Ordering::SeqCst);

    let prev_hash = {
        let receipts = state.receipts.read().unwrap();
        if let Some(last) = receipts.last() {
            last.receipt_hash.clone()
        } else {
            "genesis".to_string()
        }
    };

    let receipt_hash = compute_receipt_hash(
        &prev_hash,
        &req.operation_id,
        req.amount,
        &req.debit_account,
        &req.credit_account,
        ts,
    );

    let receipt_id = format!("rcpt_{}", &receipt_hash[..16]);

    let receipt = TransactionReceipt {
        receipt_id: receipt_id.clone(),
        operation_id: req.operation_id.clone(),
        flow_type: req.flow_type,
        user_id: req.user_id,
        amount: req.amount,
        currency: req.currency,
        debit_account: req.debit_account,
        credit_account: req.credit_account,
        prev_receipt_hash: prev_hash,
        receipt_hash,
        timestamp: ts,
        fencing_token,
        balance_pre: req.balance_pre,
        balance_post: req.balance_post,
    };

    // Durable write-through FIRST — receipt + processed-op marker in one PG
    // transaction. Fail closed: a receipt that cannot be persisted is not issued.
    if let Some(ref pool) = state.db {
        if let Err(e) = persist_receipt(pool, &receipt).await {
            eprintln!("[TransactionGuard] ERROR: receipt persist failed (fail-closed): {}", e);
            return Err("durable store unavailable".to_string());
        }
    }

    // Store receipt
    let mut receipts = state.receipts.write().unwrap();
    let idx = receipts.len();
    receipts.push(receipt.clone());
    drop(receipts);

    let mut receipt_map = state.receipt_map.write().unwrap();
    receipt_map.insert(req.operation_id.clone(), idx);
    drop(receipt_map);

    // Mark as processed (for double-spend detection)
    let mut processed = state.processed_ops.write().unwrap();
    processed.insert(req.operation_id, receipt_id.clone());
    drop(processed);

    state.metrics.receipts_created.fetch_add(1, Ordering::Relaxed);
    Ok(receipt)
}

async fn check_double_spend(state: &AppState, operation_id: &str, transfer_ref: &str) -> Result<DoubleSpendCheck, String> {
    // In-memory check first (guard dropped before any await).
    let memory_hit: Option<String> = {
        let processed = state.processed_ops.read().unwrap();
        if let Some(receipt_id) = processed.get(operation_id) {
            Some(receipt_id.clone())
        } else {
            let mut hit = None;
            for (op_id, receipt_id) in processed.iter() {
                if op_id.contains(transfer_ref) || transfer_ref.contains(op_id) {
                    hit = Some(receipt_id.clone());
                    break;
                }
            }
            hit
        }
    };

    if let Some(receipt_id) = memory_hit {
        state.metrics.double_spend_blocked.fetch_add(1, Ordering::Relaxed);
        return Ok(DoubleSpendCheck {
            operation_id: operation_id.to_string(),
            transfer_ref: transfer_ref.to_string(),
            already_processed: true,
            original_receipt: Some(receipt_id),
        });
    }

    // Cross-check the durable registry (covers other replicas / pre-boot history).
    if let Some(ref pool) = state.db {
        let hit: Option<(String,)> = sqlx::query_as(
            "SELECT receipt_id FROM tx_guard_processed_ops WHERE operation_id = $1 OR operation_id LIKE '%' || $2 || '%' OR $2 LIKE '%' || operation_id || '%' LIMIT 1"
        )
        .bind(operation_id)
        .bind(transfer_ref)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            eprintln!("[TransactionGuard] ERROR: double-spend DB check failed (fail-closed): {}", e);
            "durable store unavailable".to_string()
        })?;
        if let Some((rid,)) = hit {
            state.metrics.double_spend_blocked.fetch_add(1, Ordering::Relaxed);
            let mut processed = state.processed_ops.write().unwrap();
            processed.insert(operation_id.to_string(), rid.clone());
            return Ok(DoubleSpendCheck {
                operation_id: operation_id.to_string(),
                transfer_ref: transfer_ref.to_string(),
                already_processed: true,
                original_receipt: Some(rid),
            });
        }
    }

    Ok(DoubleSpendCheck {
        operation_id: operation_id.to_string(),
        transfer_ref: transfer_ref.to_string(),
        already_processed: false,
        original_receipt: None,
    })
}

async fn assert_balance(state: &AppState, req: AssertBalanceRequest) -> BalanceAssertion {
    let passed = (req.expected_balance - req.actual_balance).abs() < 0.01;
    let assertion = BalanceAssertion {
        account_id: req.account_id,
        currency: req.currency,
        expected_balance: req.expected_balance,
        actual_balance: req.actual_balance,
        operation_id: req.operation_id,
        assertion_type: req.assertion_type,
        passed,
        timestamp: now_epoch(),
    };

    if passed {
        state.metrics.balance_assertions_passed.fetch_add(1, Ordering::Relaxed);
    } else {
        state.metrics.balance_assertions_failed.fetch_add(1, Ordering::Relaxed);
    }

    if let Some(ref pool) = state.db {
        if let Err(e) = persist_assertion(pool, &assertion).await {
            eprintln!("[TransactionGuard] ERROR: balance assertion persist failed (audit record lost in PG, kept in memory): {}", e);
        }
    }

    let mut assertions = state.balance_assertions.write().unwrap();
    assertions.push(assertion.clone());

    assertion
}

async fn issue_fencing_token(state: &AppState, req: IssueFencingTokenRequest) -> Result<FencingToken, String> {
    let ts = now_epoch();
    let token_value = state.fencing_counter.fetch_add(1, Ordering::SeqCst);

    let token = FencingToken {
        token: token_value,
        resource: req.resource.clone(),
        owner: req.owner,
        issued_at: ts,
        expires_at: ts + req.ttl_seconds,
    };

    if let Some(ref pool) = state.db {
        if let Err(e) = persist_fencing_token(pool, &token).await {
            eprintln!("[TransactionGuard] ERROR: fencing token persist failed (fail-closed): {}", e);
            return Err("durable store unavailable".to_string());
        }
    }

    let mut tokens = state.fencing_tokens.write().unwrap();
    tokens.insert(req.resource, token.clone());

    state.metrics.fencing_tokens_issued.fetch_add(1, Ordering::Relaxed);
    Ok(token)
}

fn verify_receipt(state: &AppState, receipt_id: &str) -> VerificationResult {
    let receipts = state.receipts.read().unwrap();

    // Find the receipt
    let receipt = receipts.iter().find(|r| r.receipt_id == receipt_id);
    let receipt = match receipt {
        Some(r) => r,
        None => {
            state.metrics.verifications_failed.fetch_add(1, Ordering::Relaxed);
            return VerificationResult {
                receipt_id: receipt_id.to_string(),
                valid: false,
                chain_intact: false,
                balance_consistent: false,
                reason: Some("Receipt not found".to_string()),
            };
        }
    };

    // Verify hash chain
    let expected_hash = compute_receipt_hash(
        &receipt.prev_receipt_hash,
        &receipt.operation_id,
        receipt.amount,
        &receipt.debit_account,
        &receipt.credit_account,
        receipt.timestamp,
    );

    let chain_intact = expected_hash == receipt.receipt_hash;

    // Verify balance consistency (post = pre - amount for debit side)
    let balance_consistent = (receipt.balance_pre - receipt.amount - receipt.balance_post).abs() < 0.01
        || (receipt.balance_post - receipt.balance_pre - receipt.amount).abs() < 0.01; // credit side

    let valid = chain_intact && balance_consistent;

    if valid {
        state.metrics.verifications_passed.fetch_add(1, Ordering::Relaxed);
    } else {
        state.metrics.verifications_failed.fetch_add(1, Ordering::Relaxed);
    }

    VerificationResult {
        receipt_id: receipt_id.to_string(),
        valid,
        chain_intact,
        balance_consistent,
        reason: if !valid {
            Some(format!(
                "chain_intact={}, balance_consistent={}",
                chain_intact, balance_consistent
            ))
        } else {
            None
        },
    }
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8160".to_string())
        .parse()
        .unwrap_or(8160);

    let mut state_owned = AppState::new();
    state_owned.db = init_db().await;
    let state = Arc::new(state_owned);
    if let Some(ref pool) = state.db {
        load_from_db(pool, &state).await;
    }

    let state_filter = {
        let state = state.clone();
        warp::any().map(move || state.clone())
    };

    // GET /health
    let health = warp::path("health")
        .and(warp::get())
        .map(|| {
            warp::reply::json(&serde_json::json!({
                "status": "healthy",
                "service": "rust-transaction-guard",
                "version": "1.0.0"
            }))
            .into_response()
        });

    // POST /receipt/create
    let create_receipt_route = warp::path!("receipt" / "create")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .then(|req: CreateReceiptRequest, state: Arc<AppState>| async move {
            match create_receipt(&state, req).await {
                Ok(receipt) => warp::reply::with_status(
                    warp::reply::json(&receipt),
                    warp::http::StatusCode::OK,
                )
                .into_response(),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": e})),
                    warp::http::StatusCode::SERVICE_UNAVAILABLE,
                )
                .into_response(),
            }
        });

    // POST /receipt/verify
    let verify_receipt_route = warp::path!("receipt" / "verify")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: VerifyReceiptRequest, state: Arc<AppState>| {
            let result = verify_receipt(&state, &req.receipt_id);
            warp::reply::json(&result).into_response()
        });

    // POST /double-spend/check
    let double_spend_route = warp::path!("double-spend" / "check")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .then(|req: CheckDoubleSpendRequest, state: Arc<AppState>| async move {
            match check_double_spend(&state, &req.operation_id, &req.transfer_ref).await {
                Ok(result) => warp::reply::with_status(
                    warp::reply::json(&result),
                    warp::http::StatusCode::OK,
                )
                .into_response(),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": e})),
                    warp::http::StatusCode::SERVICE_UNAVAILABLE,
                )
                .into_response(),
            }
        });

    // POST /balance/assert
    let balance_assert_route = warp::path!("balance" / "assert")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .then(|req: AssertBalanceRequest, state: Arc<AppState>| async move {
            let result = assert_balance(&state, req).await;
            warp::reply::json(&result).into_response()
        });

    // POST /fencing-token/issue
    let fencing_token_route = warp::path!("fencing-token" / "issue")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .then(|req: IssueFencingTokenRequest, state: Arc<AppState>| async move {
            match issue_fencing_token(&state, req).await {
                Ok(token) => warp::reply::with_status(
                    warp::reply::json(&token),
                    warp::http::StatusCode::OK,
                )
                .into_response(),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": e})),
                    warp::http::StatusCode::SERVICE_UNAVAILABLE,
                )
                .into_response(),
            }
        });

    // GET /metrics
    let metrics_route = warp::path("metrics")
        .and(warp::get())
        .and(state_filter.clone())
        .map(|state: Arc<AppState>| {
            let m = &state.metrics;
            let body = format!(
                "# HELP tx_guard_receipts_total Cryptographic receipts created\n\
                 # TYPE tx_guard_receipts_total counter\n\
                 tx_guard_receipts_total {}\n\
                 # HELP tx_guard_double_spend_blocked Double-spend attempts blocked\n\
                 # TYPE tx_guard_double_spend_blocked counter\n\
                 tx_guard_double_spend_blocked {}\n\
                 # HELP tx_guard_balance_assertions_passed Balance assertions passed\n\
                 # TYPE tx_guard_balance_assertions_passed counter\n\
                 tx_guard_balance_assertions_passed {}\n\
                 # HELP tx_guard_balance_assertions_failed Balance assertions failed\n\
                 # TYPE tx_guard_balance_assertions_failed counter\n\
                 tx_guard_balance_assertions_failed {}\n\
                 # HELP tx_guard_fencing_tokens_issued Fencing tokens issued\n\
                 # TYPE tx_guard_fencing_tokens_issued counter\n\
                 tx_guard_fencing_tokens_issued {}\n\
                 # HELP tx_guard_verifications_passed Receipt verifications passed\n\
                 # TYPE tx_guard_verifications_passed counter\n\
                 tx_guard_verifications_passed {}\n\
                 # HELP tx_guard_verifications_failed Receipt verifications failed\n\
                 # TYPE tx_guard_verifications_failed counter\n\
                 tx_guard_verifications_failed {}\n",
                m.receipts_created.load(Ordering::Relaxed),
                m.double_spend_blocked.load(Ordering::Relaxed),
                m.balance_assertions_passed.load(Ordering::Relaxed),
                m.balance_assertions_failed.load(Ordering::Relaxed),
                m.fencing_tokens_issued.load(Ordering::Relaxed),
                m.verifications_passed.load(Ordering::Relaxed),
                m.verifications_failed.load(Ordering::Relaxed),
            );
            warp::reply::with_header(body, "content-type", "text/plain; charset=utf-8")
                .into_response()
        });

    let routes = health
        .or(create_receipt_route)
        .or(verify_receipt_route)
        .or(double_spend_route)
        .or(balance_assert_route)
        .or(fencing_token_route)
        .or(metrics_route);

    let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            signal::ctrl_c().await.ok();
            eprintln!("[TransactionGuard] Shutting down gracefully...");
        },
    );

    eprintln!("[TransactionGuard] Listening on :{}", port);
    server.await;
}
