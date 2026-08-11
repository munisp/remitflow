/*!
 * RemitFlow — TigerBeetle Bridge Service (Rust)
 * ═══════════════════════════════════════════════
 * HTTP bridge between the Node.js API layer and the TigerBeetle financial
 * ledger. Serves EXACTLY the contract server/_core/tigerBeetle.ts consumes:
 *
 *   POST /accounts/create    body { accounts: [...] }   → { errors: [...] }
 *   POST /transfers/create   body { transfers: [...] }  → { errors: [...] }
 *   POST /accounts/lookup    body { ids: [...] }        → { accounts: [...] }
 *   GET  /health             → { status: "healthy" | "unhealthy", ... }
 *   GET  /metrics            → Prometheus exposition
 *
 * All operations go through a real TigerBeetle client (tigerbeetle-unofficial,
 * the only Rust implementation of the TB wire protocol). Two-phase transfer
 * flags (PENDING / POST_PENDING_TRANSFER / VOID_PENDING_TRANSFER / LINKED)
 * are forwarded verbatim — TigerBeetle enforces them and the balance
 * invariants (debits_must_not_exceed_credits etc.) transactionally inside the
 * cluster; per-index result codes are surfaced in the errors array, never
 * swallowed. Nothing is written to PostgreSQL here — the mapping mirror is
 * owned by the TypeScript layer.
 *
 * Environment:
 *   TIGERBEETLE_ADDRESSES   comma-separated replica host:port list (required)
 *   TIGERBEETLE_CLUSTER_ID  cluster id, default 0
 *   DATABASE_URL            PostgreSQL (health dependency probe only)
 *   PORT | TB_BRIDGE_PORT   listen port (default 8200)
 */

mod tb_client;
#[cfg(test)]
mod tests;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use prometheus::{Histogram, HistogramOpts, IntCounter, Registry};
use serde::Deserialize;
use std::{net::SocketAddr, sync::Arc, time::{Duration, Instant}};
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};
use tracing::{error, info, warn};

use tb_client::{NewAccount, NewTransfer, TbClient, TbClientError};

// ─── TigerBeetle transfer flag bits (mirror server/_core/tigerBeetle.ts) ─────
const TRANSFER_FLAG_PENDING: u16 = 2;
const TRANSFER_FLAG_POST_PENDING: u16 = 4;
const TRANSFER_FLAG_VOID_PENDING: u16 = 8;

// ─── Request bodies (exact TS contract) ───────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateAccountsBody {
    accounts: Vec<NewAccount>,
}

#[derive(Debug, Deserialize)]
struct CreateTransfersBody {
    transfers: Vec<NewTransfer>,
}

#[derive(Debug, Deserialize)]
struct LookupAccountsBody {
    ids: Vec<String>,
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

struct Metrics {
    requests_total: IntCounter,
    errors_total: IntCounter,
    tb_op_latency: Histogram,
    accounts_created: IntCounter,
    transfers_posted: IntCounter,
}

impl Metrics {
    fn new(registry: &Registry) -> anyhow::Result<Self> {
        let requests_total = IntCounter::new("tb_bridge_requests_total", "Total HTTP requests")?;
        let errors_total = IntCounter::new("tb_bridge_errors_total", "Total failed requests")?;
        let tb_op_latency = Histogram::with_opts(
            HistogramOpts::new("tb_bridge_op_duration_seconds", "TigerBeetle operation latency")
                .buckets(vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]),
        )?;
        let accounts_created = IntCounter::new("tb_bridge_accounts_created_total", "Accounts created")?;
        let transfers_posted = IntCounter::new("tb_bridge_transfers_posted_total", "Transfers posted")?;
        registry.register(Box::new(requests_total.clone()))?;
        registry.register(Box::new(errors_total.clone()))?;
        registry.register(Box::new(tb_op_latency.clone()))?;
        registry.register(Box::new(accounts_created.clone()))?;
        registry.register(Box::new(transfers_posted.clone()))?;
        Ok(Self { requests_total, errors_total, tb_op_latency, accounts_created, transfers_posted })
    }
}

// ─── App state ────────────────────────────────────────────────────────────────

struct AppState {
    tb: TbClient,
    tb_addresses: Vec<String>,
    pg_pool: deadpool_postgres::Pool,
    metrics: Metrics,
    registry: Registry,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

fn tb_error_response(err: TbClientError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match err {
        TbClientError::InvalidId(_) | TbClientError::InvalidAmount(_) | TbClientError::InvalidField(_) => {
            StatusCode::BAD_REQUEST
        }
        TbClientError::Transport(_) => StatusCode::BAD_GATEWAY,
    };
    (status, Json(serde_json::json!({ "error": err.to_string() })))
}

async fn create_accounts(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateAccountsBody>,
) -> impl IntoResponse {
    state.metrics.requests_total.inc();
    let start = Instant::now();

    if body.accounts.is_empty() {
        state.metrics.errors_total.inc();
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "accounts must be non-empty" })));
    }
    // Every account must carry explicit flags — the balance invariants
    // (debits_must_not_exceed_credits & co.) are only enforced by TigerBeetle
    // when the caller declares them at creation time.
    for (i, a) in body.accounts.iter().enumerate() {
        if a.flags == 0 {
            warn!(index = i, "account created with flags=0 — no balance invariants will be enforced");
        }
    }

    match state.tb.create_accounts(&body.accounts).await {
        Ok(errors) => {
            state.metrics.tb_op_latency.observe(start.elapsed().as_secs_f64());
            state.metrics.accounts_created.inc_by((body.accounts.len() - errors.len()) as u64);
            if !errors.is_empty() {
                warn!(?errors, "tigerbeetle account creation returned per-index errors");
            }
            (StatusCode::OK, Json(serde_json::json!({ "errors": errors })))
        }
        Err(e) => {
            state.metrics.errors_total.inc();
            error!(error = %e, "create_accounts failed");
            tb_error_response(e)
        }
    }
}

async fn create_transfers(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateTransfersBody>,
) -> impl IntoResponse {
    state.metrics.requests_total.inc();
    let start = Instant::now();

    if body.transfers.is_empty() {
        state.metrics.errors_total.inc();
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "transfers must be non-empty" })));
    }

    // Two-phase protocol validation — fail fast on structurally invalid
    // requests instead of letting them fail opaquely inside the cluster.
    for (i, t) in body.transfers.iter().enumerate() {
        let is_post_or_void = (t.flags & (TRANSFER_FLAG_POST_PENDING | TRANSFER_FLAG_VOID_PENDING)) != 0;
        let is_pending = (t.flags & TRANSFER_FLAG_PENDING) != 0;
        if is_post_or_void && (t.pending_id.is_empty() || t.pending_id == "0") {
            state.metrics.errors_total.inc();
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("transfers[{}]: post/void-pending requires a non-zero pending_id", i)
                })),
            );
        }
        if is_pending && t.timeout == 0 {
            state.metrics.errors_total.inc();
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("transfers[{}]: pending transfer requires a non-zero timeout", i)
                })),
            );
        }
        if is_post_or_void && is_pending {
            state.metrics.errors_total.inc();
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("transfers[{}]: pending flag cannot be combined with post/void-pending", i)
                })),
            );
        }
    }

    match state.tb.create_transfers(&body.transfers).await {
        Ok(errors) => {
            state.metrics.tb_op_latency.observe(start.elapsed().as_secs_f64());
            state.metrics.transfers_posted.inc_by((body.transfers.len() - errors.len()) as u64);
            if !errors.is_empty() {
                // Balance-invariant violations (exceeds_debits, etc.) land here
                // as per-index result codes — surfaced verbatim to the caller.
                warn!(?errors, "tigerbeetle transfer creation returned per-index errors");
            }
            (StatusCode::OK, Json(serde_json::json!({ "errors": errors })))
        }
        Err(e) => {
            state.metrics.errors_total.inc();
            error!(error = %e, "create_transfers failed");
            tb_error_response(e)
        }
    }
}

async fn lookup_accounts(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LookupAccountsBody>,
) -> impl IntoResponse {
    state.metrics.requests_total.inc();
    if body.ids.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "ids must be non-empty" })));
    }
    match state.tb.lookup_accounts(&body.ids).await {
        Ok(accounts) => (StatusCode::OK, Json(serde_json::json!({ "accounts": accounts }))),
        Err(e) => {
            state.metrics.errors_total.inc();
            error!(error = %e, "lookup_accounts failed");
            tb_error_response(e)
        }
    }
}

/// Real dependency probes — no hardcoded truths. Status is "healthy" only
/// when BOTH PostgreSQL answers SELECT 1 and at least one TigerBeetle replica
/// accepts a TCP connection.
async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let pg = match state.pg_pool.get().await {
        Ok(client) => match client.query_one("SELECT 1", &[]).await {
            Ok(_) => serde_json::json!({ "connected": true }),
            Err(e) => serde_json::json!({ "connected": false, "error": e.to_string() }),
        },
        Err(e) => serde_json::json!({ "connected": false, "error": e.to_string() }),
    };

    let mut tb_probe = serde_json::json!({ "connected": false, "error": "no replicas configured" });
    for addr in &state.tb_addresses {
        match tokio::time::timeout(Duration::from_millis(500), tokio::net::TcpStream::connect(addr)).await {
            Ok(Ok(_)) => {
                tb_probe = serde_json::json!({ "connected": true, "replica": addr });
                break;
            }
            Ok(Err(e)) => {
                tb_probe = serde_json::json!({ "connected": false, "replica": addr, "error": e.to_string() });
            }
            Err(_) => {
                tb_probe = serde_json::json!({ "connected": false, "replica": addr, "error": "probe timed out" });
            }
        }
    }

    let healthy = pg["connected"] == true && tb_probe["connected"] == true;
    let status = if healthy { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (
        status,
        Json(serde_json::json!({
            "status": if healthy { "healthy" } else { "unhealthy" },
            "service": "tigerbeetle-bridge",
            "tigerbeetle": tb_probe,
            "postgres": pg,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder.encode(&state.registry.gather(), &mut buffer).unwrap_or_default();
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buffer,
    )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tigerbeetle_bridge=info".parse()?),
        )
        .init();

    // Fail loudly on misconfiguration — a bridge without a cluster address or
    // database can never serve honest responses.
    let addresses_raw = std::env::var("TIGERBEETLE_ADDRESSES")
        .expect("TIGERBEETLE_ADDRESSES must be set (comma-separated host:port list)");
    let tb_addresses: Vec<String> = addresses_raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if tb_addresses.is_empty() {
        panic!("TIGERBEETLE_ADDRESSES is set but empty");
    }
    let cluster_id: u128 = std::env::var("TIGERBEETLE_CLUSTER_ID")
        .unwrap_or_else(|_| "0".to_string())
        .parse()
        .expect("TIGERBEETLE_CLUSTER_ID must be a u128");
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let port: u16 = std::env::var("PORT")
        .or_else(|_| std::env::var("TB_BRIDGE_PORT"))
        .unwrap_or_else(|_| "8200".to_string())
        .parse()
        .expect("PORT/TB_BRIDGE_PORT must be a valid port number");

    // Real TigerBeetle client — the service refuses to start if the client
    // cannot be constructed; replica reachability is reported via /health.
    let tb = TbClient::connect(cluster_id, &addresses_raw)
        .expect("failed to construct TigerBeetle client — check TIGERBEETLE_ADDRESSES/TIGERBEETLE_CLUSTER_ID");
    info!(cluster_id = %cluster_id, addresses = %addresses_raw, "TigerBeetle client constructed");

    // PostgreSQL pool (health dependency probe)
    let pg_config = database_url.parse::<tokio_postgres::Config>()?;
    let mgr = deadpool_postgres::Manager::from_config(
        pg_config,
        tokio_postgres::NoTls,
        deadpool_postgres::ManagerConfig { recycling_method: deadpool_postgres::RecyclingMethod::Fast },
    );
    let pg_pool = deadpool_postgres::Pool::builder(mgr).max_size(4).build()?;

    let registry = Registry::new();
    let metrics = Metrics::new(&registry)?;

    let state = Arc::new(AppState { tb, tb_addresses, pg_pool, metrics, registry });

    let app = Router::new()
        .route("/accounts/create", post(create_accounts))
        .route("/transfers/create", post(create_transfers))
        .route("/accounts/lookup", post(lookup_accounts))
        .route("/health", get(health))
        .route("/metrics", get(metrics_handler))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(30)))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("TigerBeetle bridge listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
