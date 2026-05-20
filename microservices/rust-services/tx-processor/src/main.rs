// RemitFlow TX Processor — Rust microservice
// Transaction state machine with idempotency, retry logic, and event sourcing
// REST API: POST /transactions, GET /transactions/:id, POST /transactions/:id/advance, GET /health
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use dashmap::DashMap;
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TxState {
    Initiated,
    PendingCompliance,
    CompliancePassed,
    ComplianceFailed,
    PendingFunding,
    Funded,
    Processing,
    Completed,
    Failed,
    Reversed,
    Cancelled,
}

impl TxState {
    pub fn transitions(&self) -> Vec<TxState> {
        match self {
            TxState::Initiated => vec![TxState::PendingCompliance, TxState::Cancelled],
            TxState::PendingCompliance => vec![TxState::CompliancePassed, TxState::ComplianceFailed],
            TxState::CompliancePassed => vec![TxState::PendingFunding, TxState::Cancelled],
            TxState::ComplianceFailed => vec![TxState::Cancelled],
            TxState::PendingFunding => vec![TxState::Funded, TxState::Failed],
            TxState::Funded => vec![TxState::Processing, TxState::Reversed],
            TxState::Processing => vec![TxState::Completed, TxState::Failed],
            TxState::Completed => vec![TxState::Reversed],
            TxState::Failed => vec![TxState::Initiated], // retry
            TxState::Reversed => vec![],
            TxState::Cancelled => vec![],
        }
    }

    pub fn can_transition_to(&self, next: &TxState) -> bool {
        self.transitions().contains(next)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxEvent {
    pub event_id: String,
    pub tx_id: String,
    pub from_state: Option<String>,
    pub to_state: String,
    pub reason: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub idempotency_key: String,
    pub user_id: String,
    pub source_currency: String,
    pub dest_currency: String,
    pub amount_source: f64,
    pub amount_dest: f64,
    pub fee_usd: f64,
    pub exchange_rate: f64,
    pub corridor_id: String,
    pub state: TxState,
    pub retry_count: u32,
    pub max_retries: u32,
    pub events: Vec<TxEvent>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTxRequest {
    pub idempotency_key: String,
    pub user_id: String,
    pub source_currency: String,
    pub dest_currency: String,
    pub amount_source: f64,
    pub amount_dest: f64,
    pub fee_usd: f64,
    pub exchange_rate: f64,
    pub corridor_id: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AdvanceRequest {
    pub target_state: TxState,
    pub reason: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

// ─── State ───────────────────────────────────────────────────────────────────

pub struct AppState {
    pub transactions: DashMap<String, Transaction>,
    pub idempotency_map: DashMap<String, String>, // key → tx_id
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            transactions: DashMap::new(),
            idempotency_map: DashMap::new(),
        }
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "tx-processor",
        "version": "1.0.0",
        "tx_count": state.transactions.len(),
        "timestamp": Utc::now().timestamp_millis()
    }))
}

async fn create_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTxRequest>,
) -> Result<Json<Transaction>, (StatusCode, Json<serde_json::Value>)> {
    // Idempotency check
    if let Some(existing_id) = state.idempotency_map.get(&req.idempotency_key) {
        if let Some(tx) = state.transactions.get(existing_id.value()) {
            return Ok(Json(tx.value().clone()));
        }
    }

    let now = Utc::now().timestamp_millis();
    let tx_id = format!("TX-{}", Uuid::new_v4());

    let initial_event = TxEvent {
        event_id: format!("EVT-{}", Uuid::new_v4()),
        tx_id: tx_id.clone(),
        from_state: None,
        to_state: "initiated".to_string(),
        reason: Some("Transaction created".to_string()),
        metadata: req.metadata.clone(),
        created_at: now,
    };

    let tx = Transaction {
        id: tx_id.clone(),
        idempotency_key: req.idempotency_key.clone(),
        user_id: req.user_id,
        source_currency: req.source_currency,
        dest_currency: req.dest_currency,
        amount_source: req.amount_source,
        amount_dest: req.amount_dest,
        fee_usd: req.fee_usd,
        exchange_rate: req.exchange_rate,
        corridor_id: req.corridor_id,
        state: TxState::Initiated,
        retry_count: 0,
        max_retries: 3,
        events: vec![initial_event],
        created_at: now,
        updated_at: now,
        completed_at: None,
        metadata: req.metadata,
    };

    state.idempotency_map.insert(req.idempotency_key, tx_id.clone());
    state.transactions.insert(tx_id, tx.clone());

    Ok(Json(tx))
}

async fn get_transaction(
    Path(tx_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Transaction>, StatusCode> {
    state
        .transactions
        .get(&tx_id)
        .map(|t| Json(t.value().clone()))
        .ok_or(StatusCode::NOT_FOUND)
}

async fn advance_transaction(
    Path(tx_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<AdvanceRequest>,
) -> Result<Json<Transaction>, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state
        .transactions
        .get_mut(&tx_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "transaction_not_found"})),
            )
        })?;

    if !tx.state.can_transition_to(&req.target_state) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_transition",
                "message": format!("Cannot transition from {:?} to {:?}", tx.state, req.target_state),
                "allowed": tx.state.transitions().iter().map(|s| format!("{:?}", s)).collect::<Vec<_>>()
            })),
        ));
    }

    let now = Utc::now().timestamp_millis();
    let event = TxEvent {
        event_id: format!("EVT-{}", Uuid::new_v4()),
        tx_id: tx_id.clone(),
        from_state: Some(format!("{:?}", tx.state).to_lowercase()),
        to_state: format!("{:?}", req.target_state).to_lowercase(),
        reason: req.reason,
        metadata: req.metadata,
        created_at: now,
    };

    tx.events.push(event);
    tx.state = req.target_state.clone();
    tx.updated_at = now;

    if req.target_state == TxState::Completed {
        tx.completed_at = Some(now);
    }

    Ok(Json(tx.clone()))
}

async fn list_transactions(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let txs: Vec<Transaction> = state
        .transactions
        .iter()
        .map(|t| t.value().clone())
        .collect();
    Json(serde_json::json!({
        "data": txs,
        "count": txs.len(),
        "timestamp": Utc::now().timestamp_millis()
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8085".to_string())
        .parse()
        .unwrap_or(8085);

    let state = Arc::new(AppState::new());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let recorder_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/transactions", get(list_transactions).post(create_transaction))
        .route("/transactions/:id", get(get_transaction))
        .route("/transactions/:id/advance", post(advance_transaction))
        .route("/metrics", get(|State(h): State<PrometheusHandle>| async move {
            let body = h.render();
            ([(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")], body).into_response()
        }).with_state(recorder_handle))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("TX Processor listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
