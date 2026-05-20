// RemitFlow FX Engine — Rust microservice
// Real-time FX rate aggregation, spread calculation, and rate locking
// REST API: GET /rates, GET /rates/:pair, POST /lock, GET /health
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use once_cell::sync::Lazy;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::time;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxRate {
    pub pair: String,
    pub base: String,
    pub quote: String,
    pub bid: f64,
    pub ask: f64,
    pub mid: f64,
    pub spread_percent: f64,
    pub source: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedRate {
    pub lock_id: String,
    pub pair: String,
    pub rate: f64,
    pub amount_base: f64,
    pub amount_quote: f64,
    pub fee_percent: f64,
    pub locked_at: i64,
    pub expires_at: i64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct LockRequest {
    pub pair: String,
    pub amount_base: f64,
    pub fee_percent: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub rate_count: usize,
    pub locked_count: usize,
    pub timestamp: i64,
}

// ─── State ───────────────────────────────────────────────────────────────────

pub struct AppState {
    pub rates: DashMap<String, FxRate>,
    pub locked_rates: DashMap<String, LockedRate>,
}

impl AppState {
    pub fn new() -> Self {
        let state = AppState {
            rates: DashMap::new(),
            locked_rates: DashMap::new(),
        };
        state.seed_rates();
        state
    }

    fn seed_rates(&self) {
        // Base USD rates (mid-market)
        let base_rates: Vec<(&str, f64)> = vec![
            ("NGN", 1580.0),
            ("GHS", 15.2),
            ("KES", 129.5),
            ("ZAR", 18.7),
            ("GBP", 0.79),
            ("EUR", 0.92),
            ("CAD", 1.36),
            ("AUD", 1.53),
            ("XOF", 603.5),
            ("XAF", 603.5),
            ("TZS", 2580.0),
            ("UGX", 3750.0),
            ("RWF", 1310.0),
            ("ETB", 56.5),
            ("MAD", 9.95),
            ("EGP", 30.9),
            ("INR", 83.2),
            ("PHP", 56.1),
            ("MXN", 17.1),
            ("CNY", 7.24),
        ];

        let now = Utc::now().timestamp_millis();
        let mut rng = rand::thread_rng();

        for (quote, mid) in &base_rates {
            let spread = rng.gen_range(0.001..0.015);
            let bid = mid * (1.0 - spread / 2.0);
            let ask = mid * (1.0 + spread / 2.0);
            let pair = format!("USD{}", quote);
            self.rates.insert(
                pair.clone(),
                FxRate {
                    pair,
                    base: "USD".to_string(),
                    quote: quote.to_string(),
                    bid,
                    ask,
                    mid: *mid,
                    spread_percent: spread * 100.0,
                    source: "remitflow-aggregator".to_string(),
                    updated_at: now,
                },
            );
        }

        // Cross rates (GBP base)
        let gbp_usd = 1.0 / 0.79;
        for (quote, usd_rate) in &base_rates {
            if *quote == "GBP" { continue; }
            let mid = usd_rate * gbp_usd;
            let spread = rng.gen_range(0.002..0.018);
            let bid = mid * (1.0 - spread / 2.0);
            let ask = mid * (1.0 + spread / 2.0);
            let pair = format!("GBP{}", quote);
            self.rates.insert(
                pair.clone(),
                FxRate {
                    pair,
                    base: "GBP".to_string(),
                    quote: quote.to_string(),
                    bid,
                    ask,
                    mid,
                    spread_percent: spread * 100.0,
                    source: "remitflow-aggregator".to_string(),
                    updated_at: now,
                },
            );
        }
    }

    pub fn update_rates(&self) {
        let mut rng = rand::thread_rng();
        let now = Utc::now().timestamp_millis();
        for mut entry in self.rates.iter_mut() {
            let rate = entry.value_mut();
            // Simulate ±0.3% tick
            let delta = rng.gen_range(-0.003..0.003);
            rate.mid *= 1.0 + delta;
            let spread = rng.gen_range(0.001..0.015);
            rate.bid = rate.mid * (1.0 - spread / 2.0);
            rate.ask = rate.mid * (1.0 + spread / 2.0);
            rate.spread_percent = spread * 100.0;
            rate.updated_at = now;
        }
    }

    pub fn cleanup_expired_locks(&self) {
        let now = Utc::now().timestamp_millis();
        self.locked_rates.retain(|_, lock| {
            if lock.expires_at < now && lock.status == "active" {
                false
            } else {
                true
            }
        });
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "fx-engine".to_string(),
        version: "1.0.0".to_string(),
        rate_count: state.rates.len(),
        locked_count: state.locked_rates.len(),
        timestamp: Utc::now().timestamp_millis(),
    })
}

async fn get_all_rates(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let rates: Vec<FxRate> = state.rates.iter().map(|r| r.value().clone()).collect();
    Json(serde_json::json!({
        "data": rates,
        "count": rates.len(),
        "timestamp": Utc::now().timestamp_millis()
    }))
}

async fn get_rate_by_pair(
    Path(pair): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<FxRate>, StatusCode> {
    let pair_upper = pair.to_uppercase();
    state
        .rates
        .get(&pair_upper)
        .map(|r| Json(r.value().clone()))
        .ok_or(StatusCode::NOT_FOUND)
}

async fn lock_rate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LockRequest>,
) -> Result<Json<LockedRate>, (StatusCode, Json<serde_json::Value>)> {
    let pair_upper = req.pair.to_uppercase();
    let rate = state.rates.get(&pair_upper).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "pair_not_found",
                "message": format!("FX pair {} not available", pair_upper)
            })),
        )
    })?;

    let fee_percent = req.fee_percent.unwrap_or(0.5);
    let effective_rate = rate.ask * (1.0 + fee_percent / 100.0);
    let amount_quote = req.amount_base * effective_rate;

    let now = Utc::now().timestamp_millis();
    let lock = LockedRate {
        lock_id: format!("LK-{}", Uuid::new_v4()),
        pair: pair_upper,
        rate: effective_rate,
        amount_base: req.amount_base,
        amount_quote,
        fee_percent,
        locked_at: now,
        expires_at: now + 5 * 60 * 1000, // 5 minutes
        status: "active".to_string(),
    };

    state.locked_rates.insert(lock.lock_id.clone(), lock.clone());
    Ok(Json(lock))
}

async fn get_locked_rate(
    Path(lock_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<LockedRate>, StatusCode> {
    state
        .locked_rates
        .get(&lock_id)
        .map(|l| Json(l.value().clone()))
        .ok_or(StatusCode::NOT_FOUND)
}

// ─── Prometheus Handler ──────────────────────────────────────────────────────

async fn metrics_handler(
    State(handle): State<PrometheusHandle>,
) -> Response {
    let body = handle.render();
    ([(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")], body).into_response()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Install Prometheus recorder
    let recorder_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8084".to_string())
        .parse()
        .unwrap_or(8084);

    let state = Arc::new(AppState::new());

    // Background rate updater (every 30s)
    let update_state = state.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            update_state.update_rates();
            update_state.cleanup_expired_locks();
            tracing::info!("FX rates updated");
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/rates", get(get_all_rates))
        .route("/rates/:pair", get(get_rate_by_pair))
        .route("/lock", post(lock_rate))
        .route("/lock/:lock_id", get(get_locked_rate))
        .route("/metrics", get(metrics_handler).with_state(recorder_handle))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("FX Engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
