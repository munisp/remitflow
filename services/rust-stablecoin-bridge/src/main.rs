/*!
 * RemitFlow — Rust Stablecoin Bridge Service
 * Cross-chain bridge engine, ILP streaming, escrow state machine, and gas oracle.
 * Port: 8114
 *
 * Responsibilities:
 *   - Cross-chain bridge: Ethereum ↔ Polygon ↔ BSC ↔ Solana ↔ Tron ↔ L2s
 *   - ILP streaming micropayments for stablecoin transfers
 *   - Multi-party escrow state machine for P2P stablecoin trades
 *   - Gas oracle: real-time gas estimation across 9 chains
 *   - De-peg detection: monitoring stablecoin price feeds
 *   - Virtual card transaction authorization
 *
 * Middleware:
 *   - Kafka: stablecoin.bridge, stablecoin.escrow events
 *   - TigerBeetle: double-entry ledger for bridge movements
 *   - Redis: gas price cache, bridge status tracking
 *   - OpenSearch: bridge transaction indexing
 *
 * FAIL-CLOSED (SPEC-wave12 §3.4): this service has zero chain interaction.
 * /bridge, /escrow/*, /card/authorize and /depeg return 503 "unavailable"
 * (no chain client configured) instead of fabricating ids/tx_hashes/states.
 * BRIDGE_EXECUTION_ENABLED=true + CHAIN_RPC_URL merely documents the future
 * provisioning point — no RPC client is implemented here.
 */

use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static BRIDGE_COUNT: AtomicU64 = AtomicU64::new(0);
static ESCROW_COUNT: AtomicU64 = AtomicU64::new(0);

static _PROCESS_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

fn process_start() -> &'static Instant {
    _PROCESS_START.get_or_init(Instant::now)
}

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct ChainConfig {
    name: String,
    native_currency: String,
    avg_block_time_s: f64,
    transfer_gas_usd: f64,
    approval_gas_usd: f64,
    explorer_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BridgeRequest {
    stablecoin: String,
    amount: f64,
    from_chain: String,
    to_chain: String,
    user_id: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct EscrowRequest {
    stablecoin: String,
    amount: f64,
    buyer_id: u64,
    seller_id: u64,
    condition: String,
    expiry_hours: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct GasEstimate {
    chain: String,
    transfer_gas_usd: f64,
    approval_gas_usd: f64,
    swap_gas_usd: f64,
    bridge_gas_usd: f64,
    block_time_s: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CardAuthRequest {
    card_id: String,
    merchant: String,
    amount_usd: f64,
    stablecoin: String,
    user_id: u64,
}

// ── Chain Registry ──────────────────────────────────────────────────────────

fn get_chains() -> HashMap<String, ChainConfig> {
    let mut chains = HashMap::new();
    chains.insert("ethereum".into(), ChainConfig {
        name: "Ethereum Mainnet".into(), native_currency: "ETH".into(),
        avg_block_time_s: 12.0, transfer_gas_usd: 3.50, approval_gas_usd: 1.80,
        explorer_url: "https://etherscan.io".into(),
    });
    chains.insert("polygon".into(), ChainConfig {
        name: "Polygon PoS".into(), native_currency: "MATIC".into(),
        avg_block_time_s: 2.0, transfer_gas_usd: 0.01, approval_gas_usd: 0.005,
        explorer_url: "https://polygonscan.com".into(),
    });
    chains.insert("bsc".into(), ChainConfig {
        name: "BNB Smart Chain".into(), native_currency: "BNB".into(),
        avg_block_time_s: 3.0, transfer_gas_usd: 0.10, approval_gas_usd: 0.05,
        explorer_url: "https://bscscan.com".into(),
    });
    chains.insert("solana".into(), ChainConfig {
        name: "Solana".into(), native_currency: "SOL".into(),
        avg_block_time_s: 0.4, transfer_gas_usd: 0.001, approval_gas_usd: 0.0,
        explorer_url: "https://solscan.io".into(),
    });
    chains.insert("tron".into(), ChainConfig {
        name: "Tron".into(), native_currency: "TRX".into(),
        avg_block_time_s: 3.0, transfer_gas_usd: 1.00, approval_gas_usd: 0.50,
        explorer_url: "https://tronscan.org".into(),
    });
    chains.insert("arbitrum".into(), ChainConfig {
        name: "Arbitrum One".into(), native_currency: "ETH".into(),
        avg_block_time_s: 0.25, transfer_gas_usd: 0.15, approval_gas_usd: 0.08,
        explorer_url: "https://arbiscan.io".into(),
    });
    chains.insert("optimism".into(), ChainConfig {
        name: "Optimism".into(), native_currency: "ETH".into(),
        avg_block_time_s: 2.0, transfer_gas_usd: 0.10, approval_gas_usd: 0.05,
        explorer_url: "https://optimistic.etherscan.io".into(),
    });
    chains.insert("base".into(), ChainConfig {
        name: "Base".into(), native_currency: "ETH".into(),
        avg_block_time_s: 2.0, transfer_gas_usd: 0.05, approval_gas_usd: 0.03,
        explorer_url: "https://basescan.org".into(),
    });
    chains.insert("avalanche".into(), ChainConfig {
        name: "Avalanche C-Chain".into(), native_currency: "AVAX".into(),
        avg_block_time_s: 2.0, transfer_gas_usd: 0.05, approval_gas_usd: 0.03,
        explorer_url: "https://snowscan.xyz".into(),
    });
    chains
}

// ── Handlers ────────────────────────────────────────────────────────────────

#[get("/health")]
async fn health() -> impl Responder {
    let uptime = process_start().elapsed().as_secs();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "rust-stablecoin-bridge",
        "uptime_seconds": uptime,
        "bridges_processed": BRIDGE_COUNT.load(Ordering::Relaxed),
        "escrows_created": ESCROW_COUNT.load(Ordering::Relaxed),
    }))
}

#[get("/livez")]
async fn livez() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({"status": "alive"}))
}

#[get("/readyz")]
async fn readyz() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({"status": "ready"}))
}

#[get("/metrics")]
async fn metrics() -> impl Responder {
    let uptime = process_start().elapsed().as_secs_f64();
    let bridges = BRIDGE_COUNT.load(Ordering::Relaxed);
    let escrows = ESCROW_COUNT.load(Ordering::Relaxed);
    HttpResponse::Ok().content_type("text/plain").body(format!(
        "# HELP stablecoin_bridge_uptime_seconds Service uptime\n\
         # TYPE stablecoin_bridge_uptime_seconds gauge\n\
         stablecoin_bridge_uptime_seconds {:.2}\n\
         # HELP stablecoin_bridges_total Total bridges processed\n\
         # TYPE stablecoin_bridges_total counter\n\
         stablecoin_bridges_total {}\n\
         # HELP stablecoin_escrows_total Total escrows created\n\
         # TYPE stablecoin_escrows_total counter\n\
         stablecoin_escrows_total {}\n",
        uptime, bridges, escrows,
    ))
}

// ── Fail-closed execution gate (SPEC-wave12 §3.4) ───────────────────────────
//
// This binary has ZERO chain interaction: no RPC client, no wallet, no signer.
// The previous implementation fabricated bridge_id / tx_hash / escrow_id /
// auth_id from Uuid::new_v4 and reported fake "processing"/"funded"/"released"
// states. That dishonesty is removed: every execution endpoint below returns
// 503 {error, status:"unavailable"}.
//
// `BRIDGE_EXECUTION_ENABLED=true` + `CHAIN_RPC_URL` set is the documented
// PROVISIONING POINT for a future real chain client. Per SPEC §3.4 we must
// NOT implement an RPC client here — so even when the gate is satisfied the
// endpoints still return 503 honestly (the gate only records that an operator
// intended to provision execution).

/// True when the operator has signalled intent to provision chain execution.
/// NOTE: no chain client exists in this binary, so a `true` result does NOT
/// enable execution — see `execution_unavailable`.
fn execution_provisioned() -> bool {
    let enabled = std::env::var("BRIDGE_EXECUTION_ENABLED").map(|v| v == "true").unwrap_or(false);
    let rpc_set = std::env::var("CHAIN_RPC_URL").map(|v| !v.trim().is_empty()).unwrap_or(false);
    enabled && rpc_set
}

/// Honest 503 for every chain-execution endpoint. Evaluates the provisioning
/// gate purely so the intent is logged; the response is 503 either way.
fn execution_unavailable(endpoint: &str) -> HttpResponse {
    if execution_provisioned() {
        println!(
            "[rust-stablecoin-bridge] {} requested with BRIDGE_EXECUTION_ENABLED=true and CHAIN_RPC_URL set, \
             but no chain client is implemented — failing closed (503)",
            endpoint
        );
    }
    HttpResponse::ServiceUnavailable().json(serde_json::json!({
        "error": "bridge execution path not provisioned — no chain client configured",
        "status": "unavailable",
    }))
}

#[post("/bridge")]
async fn bridge(_req: web::Json<BridgeRequest>) -> impl Responder {
    // No chain client: never fabricate a bridge_id/tx_hash. Fail closed.
    execution_unavailable("/bridge")
}

#[post("/escrow/create")]
async fn create_escrow(_req: web::Json<EscrowRequest>) -> impl Responder {
    // No chain client: never fabricate an escrow_id or a 'funded' state. Fail closed.
    execution_unavailable("/escrow/create")
}

#[post("/escrow/release")]
async fn release_escrow(_req: web::Json<serde_json::Value>) -> impl Responder {
    // No escrow state machine exists — there is nothing to release. Fail closed.
    execution_unavailable("/escrow/release")
}

#[post("/escrow/dispute")]
async fn dispute_escrow(_req: web::Json<serde_json::Value>) -> impl Responder {
    // No escrow state machine exists — there is nothing to dispute. Fail closed.
    execution_unavailable("/escrow/dispute")
}

#[get("/gas")]
async fn gas_estimates() -> impl Responder {
    let chains = get_chains();
    let estimates: Vec<GasEstimate> = chains.iter().map(|(key, cfg)| {
        GasEstimate {
            chain: key.clone(),
            transfer_gas_usd: cfg.transfer_gas_usd,
            approval_gas_usd: cfg.approval_gas_usd,
            swap_gas_usd: cfg.transfer_gas_usd * 1.5,
            bridge_gas_usd: cfg.transfer_gas_usd * 2.0,
            block_time_s: cfg.avg_block_time_s,
        }
    }).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "source": "static_config",
        "estimates": estimates,
    }))
}

#[get("/depeg")]
async fn depeg_status() -> impl Responder {
    // SPEC-wave12 §3.4: /depeg should proxy the python oracle POST /depeg/check.
    // Proxying requires an HTTP client crate (reqwest) which is NOT vendored in
    // Cargo.toml, and SPEC §0.1 forbids new external deps — so there is no way
    // to reach the oracle from this binary. The old static "everything is $1.00"
    // response was dishonest; fail closed with 503 instead.
    HttpResponse::ServiceUnavailable().json(serde_json::json!({
        "error": "bridge execution path not provisioned — no chain client configured",
        "status": "unavailable",
    }))
}

#[post("/card/authorize")]
async fn card_authorize(_req: web::Json<CardAuthRequest>) -> impl Responder {
    // No card network / chain client: never fabricate an auth decision. Fail closed.
    execution_unavailable("/card/authorize")
}

// ── Core Fund Flow Event Verification ────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FundFlowEvent {
    transaction_id: String,
    user_id: u64,
    amount: f64,
    currency: String,
    feature: String,
    status: String,
    timestamp: String,
}

#[derive(Debug, Serialize)]
struct FundFlowVerification {
    transaction_id: String,
    verified: bool,
    checks: Vec<VerificationCheck>,
    verified_at: String,
}

#[derive(Debug, Serialize)]
struct VerificationCheck {
    check: String,
    passed: bool,
    detail: String,
}

static VERIFIED_FEATURES: &[&str] = &[
    "savings", "cbdc", "bill_payment", "airtime", "batch",
    "wallet", "stablecoin_swap", "transfer",
];

#[post("/verify/fund-flow")]
async fn verify_fund_flow(req: web::Json<FundFlowEvent>) -> impl Responder {
    let mut checks = Vec::new();

    let amount_valid = req.amount > 0.0 && req.amount <= 10_000_000.0;
    checks.push(VerificationCheck {
        check: "amount_range".into(),
        passed: amount_valid,
        detail: format!("amount={} within [0, 10M]", req.amount),
    });

    let feature_valid = VERIFIED_FEATURES.iter().any(|f| req.feature.contains(f));
    checks.push(VerificationCheck {
        check: "known_feature".into(),
        passed: feature_valid,
        detail: format!("feature='{}' in allowed set", req.feature),
    });

    let status_valid = ["completed", "created", "failed", "pending"].contains(&req.status.as_str());
    checks.push(VerificationCheck {
        check: "valid_status".into(),
        passed: status_valid,
        detail: format!("status='{}' in allowed set", req.status),
    });

    let ts_valid = !req.timestamp.is_empty();
    checks.push(VerificationCheck {
        check: "timestamp_present".into(),
        passed: ts_valid,
        detail: format!("timestamp='{}'", req.timestamp),
    });

    let user_valid = req.user_id > 0;
    checks.push(VerificationCheck {
        check: "user_id_positive".into(),
        passed: user_valid,
        detail: format!("user_id={}", req.user_id),
    });

    let all_passed = checks.iter().all(|c| c.passed);

    HttpResponse::Ok().json(FundFlowVerification {
        transaction_id: req.transaction_id.clone(),
        verified: all_passed,
        checks,
        verified_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[get("/chains")]
async fn list_chains() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "source": "static_config",
        "chains": get_chains(),
    }))
}

// ── Main ────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let _ = process_start();
    let port = std::env::var("STABLECOIN_BRIDGE_PORT").unwrap_or_else(|_| "8114".into());
    let bind_addr = format!("0.0.0.0:{}", port);

    println!("[rust-stablecoin-bridge] Starting on {}", bind_addr);

    // Graceful shutdown
    let server = HttpServer::new(|| {
        let cors = Cors::permissive();
        App::new()
            .wrap(cors)
            .service(health)
            .service(livez)
            .service(readyz)
            .service(metrics)
            .service(bridge)
            .service(create_escrow)
            .service(release_escrow)
            .service(dispute_escrow)
            .service(gas_estimates)
            .service(depeg_status)
            .service(card_authorize)
            .service(verify_fund_flow)
            .service(list_chains)
    })
    .bind(&bind_addr)?
    .shutdown_timeout(30)
    .run();

    // Handle SIGTERM for K8s graceful shutdown
    let srv = server.handle();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        println!("[rust-stablecoin-bridge] Received shutdown signal, draining...");
        srv.stop(true).await;
    });

    let startup_ms = process_start().elapsed().as_millis();
    println!("[rust-stablecoin-bridge] Ready in {}ms on port {}", startup_ms, port);

    server.await
}
