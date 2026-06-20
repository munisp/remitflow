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
use warp::Filter;
use tokio::signal;

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
        }
    }
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

fn create_receipt(state: &AppState, req: CreateReceiptRequest) -> TransactionReceipt {
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
    receipt
}

fn check_double_spend(state: &AppState, operation_id: &str, transfer_ref: &str) -> DoubleSpendCheck {
    let processed = state.processed_ops.read().unwrap();

    // Check by operation_id
    if let Some(receipt_id) = processed.get(operation_id) {
        state.metrics.double_spend_blocked.fetch_add(1, Ordering::Relaxed);
        return DoubleSpendCheck {
            operation_id: operation_id.to_string(),
            transfer_ref: transfer_ref.to_string(),
            already_processed: true,
            original_receipt: Some(receipt_id.clone()),
        };
    }

    // Check by transfer_ref (different operation_id but same logical transfer)
    for (op_id, receipt_id) in processed.iter() {
        if op_id.contains(transfer_ref) || transfer_ref.contains(op_id) {
            state.metrics.double_spend_blocked.fetch_add(1, Ordering::Relaxed);
            return DoubleSpendCheck {
                operation_id: operation_id.to_string(),
                transfer_ref: transfer_ref.to_string(),
                already_processed: true,
                original_receipt: Some(receipt_id.clone()),
            };
        }
    }

    DoubleSpendCheck {
        operation_id: operation_id.to_string(),
        transfer_ref: transfer_ref.to_string(),
        already_processed: false,
        original_receipt: None,
    }
}

fn assert_balance(state: &AppState, req: AssertBalanceRequest) -> BalanceAssertion {
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

    let mut assertions = state.balance_assertions.write().unwrap();
    assertions.push(assertion.clone());

    assertion
}

fn issue_fencing_token(state: &AppState, req: IssueFencingTokenRequest) -> FencingToken {
    let ts = now_epoch();
    let token_value = state.fencing_counter.fetch_add(1, Ordering::SeqCst);

    let token = FencingToken {
        token: token_value,
        resource: req.resource.clone(),
        owner: req.owner,
        issued_at: ts,
        expires_at: ts + req.ttl_seconds,
    };

    let mut tokens = state.fencing_tokens.write().unwrap();
    tokens.insert(req.resource, token.clone());

    state.metrics.fencing_tokens_issued.fetch_add(1, Ordering::Relaxed);
    token
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

    let state = Arc::new(AppState::new());

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
        });

    // POST /receipt/create
    let create_receipt_route = warp::path!("receipt" / "create")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: CreateReceiptRequest, state: Arc<AppState>| {
            let receipt = create_receipt(&state, req);
            warp::reply::json(&receipt)
        });

    // POST /receipt/verify
    let verify_receipt_route = warp::path!("receipt" / "verify")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: VerifyReceiptRequest, state: Arc<AppState>| {
            let result = verify_receipt(&state, &req.receipt_id);
            warp::reply::json(&result)
        });

    // POST /double-spend/check
    let double_spend_route = warp::path!("double-spend" / "check")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: CheckDoubleSpendRequest, state: Arc<AppState>| {
            let result = check_double_spend(&state, &req.operation_id, &req.transfer_ref);
            warp::reply::json(&result)
        });

    // POST /balance/assert
    let balance_assert_route = warp::path!("balance" / "assert")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: AssertBalanceRequest, state: Arc<AppState>| {
            let result = assert_balance(&state, req);
            warp::reply::json(&result)
        });

    // POST /fencing-token/issue
    let fencing_token_route = warp::path!("fencing-token" / "issue")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .map(|req: IssueFencingTokenRequest, state: Arc<AppState>| {
            let token = issue_fencing_token(&state, req);
            warp::reply::json(&token)
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
