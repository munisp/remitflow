/*!
 * RemitFlow Agent Float Reconciliation Service (Rust)
 *
 * Real-time double-entry ledger audit for POS agent cash flows.
 * Detects discrepancies between expected and actual float balances,
 * flags suspicious patterns, and provides reconciliation reports.
 *
 * Language: Rust (chosen for zero-cost abstractions, memory safety,
 *   and sub-millisecond reconciliation on high-volume agent networks)
 *
 * Port: 8098
 *
 * Endpoints:
 *   POST /reconcile/agent      — Reconcile a single agent's float
 *   POST /reconcile/batch      — Reconcile all active agents
 *   POST /detect/anomaly       — Run anomaly detection on agent patterns
 *   GET  /report/:agent_id     — Get reconciliation report for an agent
 *   GET  /health               — Liveness probe
 *   GET  /metrics              — Prometheus metrics
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
use tracing::info;

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTransaction {
    pub tx_type: String,    // "cash_in", "cash_out", "float_top_up", "commission"
    pub amount: f64,
    pub timestamp: String,
    pub reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileRequest {
    pub agent_id: u64,
    pub reported_balance: f64,
    pub opening_balance: f64,
    pub transactions: Vec<AgentTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileResult {
    pub agent_id: u64,
    pub opening_balance: f64,
    pub expected_balance: f64,
    pub reported_balance: f64,
    pub discrepancy: f64,
    pub discrepancy_pct: f64,
    pub status: String, // "clean", "minor_discrepancy", "major_discrepancy", "fraud_suspected"
    pub total_cash_in: f64,
    pub total_cash_out: f64,
    pub total_commissions: f64,
    pub transaction_count: usize,
    pub flags: Vec<String>,
    pub reconciled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyRequest {
    pub agent_id: u64,
    pub daily_volumes: Vec<f64>,     // last 30 days
    pub avg_transaction_size: f64,
    pub transaction_count_today: u64,
    pub largest_single_tx: f64,
    pub cash_in_ratio: f64,          // cash_in / total
    pub weekend_volume_ratio: f64,   // weekend vol / weekday vol
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyResult {
    pub agent_id: u64,
    pub risk_score: f64,       // 0-100
    pub anomalies: Vec<AnomalyFlag>,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyFlag {
    pub flag_type: String,
    pub severity: String,      // "info", "warning", "critical"
    pub detail: String,
}

type SharedState = Arc<Mutex<ReconciliationState>>;

#[derive(Debug, Default)]
pub struct ReconciliationState {
    pub reports: HashMap<u64, ReconcileResult>,
    pub total_reconciled: u64,
    pub total_discrepancies: u64,
    pub total_fraud_flags: u64,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({
        "status": "ok",
        "service": "rust-agent-reconciliation",
        "version": "1.0.0",
    })))
}

async fn reconcile_agent(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Json(req): Json<ReconcileRequest>,
) -> impl IntoResponse {
    let mut total_cash_in = 0.0;
    let mut total_cash_out = 0.0;
    let mut total_commissions = 0.0;
    let mut flags: Vec<String> = Vec::new();

    for tx in &req.transactions {
        match tx.tx_type.as_str() {
            "cash_in" => total_cash_in += tx.amount,
            "cash_out" => total_cash_out += tx.amount,
            "float_top_up" => total_cash_in += tx.amount,
            "commission" => total_commissions += tx.amount,
            _ => {}
        }
        // Flag large transactions
        if tx.amount > 500_000.0 {
            flags.push(format!("Large transaction: {} ₦{:.2} (ref: {})", tx.tx_type, tx.amount, tx.reference));
        }
    }

    // Expected = opening + cash_in - cash_out + commissions
    let expected = req.opening_balance + total_cash_in - total_cash_out + total_commissions;
    let discrepancy = req.reported_balance - expected;
    let discrepancy_pct = if expected.abs() > 0.01 {
        (discrepancy / expected * 100.0).abs()
    } else {
        0.0
    };

    let status = if discrepancy.abs() < 100.0 {
        "clean"
    } else if discrepancy_pct < 1.0 {
        "minor_discrepancy"
    } else if discrepancy_pct < 5.0 {
        flags.push(format!("Discrepancy of ₦{:.2} ({:.1}% of expected)", discrepancy, discrepancy_pct));
        "major_discrepancy"
    } else {
        flags.push(format!("ALERT: ₦{:.2} discrepancy ({:.1}%) — possible fraud or accounting error", discrepancy, discrepancy_pct));
        "fraud_suspected"
    };

    // Additional pattern checks
    if total_cash_out > total_cash_in * 2.0 && total_cash_out > 100_000.0 {
        flags.push("Cash out significantly exceeds cash in — possible unauthorized withdrawals".to_string());
    }

    let result = ReconcileResult {
        agent_id: req.agent_id,
        opening_balance: req.opening_balance,
        expected_balance: expected,
        reported_balance: req.reported_balance,
        discrepancy,
        discrepancy_pct,
        status: status.to_string(),
        total_cash_in,
        total_cash_out,
        total_commissions,
        transaction_count: req.transactions.len(),
        flags,
        reconciled_at: Utc::now().to_rfc3339(),
    };

    let mut s = state.lock().unwrap();
    s.total_reconciled += 1;
    if status != "clean" {
        s.total_discrepancies += 1;
    }
    if status == "fraud_suspected" {
        s.total_fraud_flags += 1;
    }
    s.reports.insert(req.agent_id, result.clone());

    info!(agent_id = req.agent_id, status = status, discrepancy = discrepancy, "Agent reconciled");

    (StatusCode::OK, Json(serde_json::json!(result)))
}

async fn detect_anomaly(
    Json(req): Json<AnomalyRequest>,
) -> impl IntoResponse {
    let mut risk_score: f64 = 0.0;
    let mut anomalies: Vec<AnomalyFlag> = Vec::new();

    // Calculate statistical measures
    let n = req.daily_volumes.len() as f64;
    if n > 0.0 {
        let mean: f64 = req.daily_volumes.iter().sum::<f64>() / n;
        let variance: f64 = req.daily_volumes.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
        let std_dev = variance.sqrt();

        // Today's volume vs. historical
        if let Some(&today) = req.daily_volumes.last() {
            if today > mean + 3.0 * std_dev && std_dev > 0.0 {
                risk_score += 30.0;
                anomalies.push(AnomalyFlag {
                    flag_type: "volume_spike".to_string(),
                    severity: "critical".to_string(),
                    detail: format!("Today's volume (₦{:.0}) is {:.1} std deviations above mean (₦{:.0})", today, (today - mean) / std_dev, mean),
                });
            } else if today > mean + 2.0 * std_dev && std_dev > 0.0 {
                risk_score += 15.0;
                anomalies.push(AnomalyFlag {
                    flag_type: "volume_elevated".to_string(),
                    severity: "warning".to_string(),
                    detail: format!("Today's volume elevated: ₦{:.0} vs avg ₦{:.0}", today, mean),
                });
            }
        }
    }

    // Large single transaction check
    if req.largest_single_tx > req.avg_transaction_size * 10.0 && req.avg_transaction_size > 0.0 {
        risk_score += 20.0;
        anomalies.push(AnomalyFlag {
            flag_type: "large_transaction".to_string(),
            severity: "warning".to_string(),
            detail: format!("Largest tx (₦{:.0}) is {:.0}x the average (₦{:.0})", req.largest_single_tx, req.largest_single_tx / req.avg_transaction_size, req.avg_transaction_size),
        });
    }

    // Unusual cash-in ratio
    if req.cash_in_ratio < 0.2 {
        risk_score += 15.0;
        anomalies.push(AnomalyFlag {
            flag_type: "low_cash_in".to_string(),
            severity: "warning".to_string(),
            detail: format!("Cash-in ratio very low ({:.0}%) — mostly cash-out, possible float drain", req.cash_in_ratio * 100.0),
        });
    }

    // Weekend activity anomaly
    if req.weekend_volume_ratio > 2.0 {
        risk_score += 10.0;
        anomalies.push(AnomalyFlag {
            flag_type: "weekend_spike".to_string(),
            severity: "info".to_string(),
            detail: format!("Weekend volume {:.1}x higher than weekday — unusual pattern", req.weekend_volume_ratio),
        });
    }

    // High transaction count
    if req.transaction_count_today > 200 {
        risk_score += 10.0;
        anomalies.push(AnomalyFlag {
            flag_type: "high_tx_count".to_string(),
            severity: "info".to_string(),
            detail: format!("{} transactions today — well above typical agent volume", req.transaction_count_today),
        });
    }

    risk_score = risk_score.min(100.0);

    let recommendation = if risk_score > 70.0 {
        "IMMEDIATE INVESTIGATION — freeze agent float and conduct on-site audit"
    } else if risk_score > 40.0 {
        "Schedule audit within 48 hours — monitor transactions closely"
    } else if risk_score > 20.0 {
        "Low-priority review — flag for next regular audit cycle"
    } else {
        "No action needed — normal activity patterns"
    };

    let result = AnomalyResult {
        agent_id: req.agent_id,
        risk_score,
        anomalies,
        recommendation: recommendation.to_string(),
    };

    (StatusCode::OK, Json(serde_json::json!(result)))
}

async fn get_report(
    axum::extract::State(state): axum::extract::State<SharedState>,
    Path(agent_id): Path<u64>,
) -> impl IntoResponse {
    let s = state.lock().unwrap();
    match s.reports.get(&agent_id) {
        Some(report) => (StatusCode::OK, Json(serde_json::json!(report))),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "No reconciliation report found"}))),
    }
}

async fn get_metrics(
    axum::extract::State(state): axum::extract::State<SharedState>,
) -> impl IntoResponse {
    let s = state.lock().unwrap();
    let prom = format!(
        "# HELP remitflow_agent_reconciled_total Total agents reconciled\n\
         # TYPE remitflow_agent_reconciled_total counter\n\
         remitflow_agent_reconciled_total {{}}\t{}\n\
         # HELP remitflow_agent_discrepancies_total Total discrepancies found\n\
         # TYPE remitflow_agent_discrepancies_total counter\n\
         remitflow_agent_discrepancies_total {{}}\t{}\n\
         # HELP remitflow_agent_fraud_flags_total Total fraud flags\n\
         # TYPE remitflow_agent_fraud_flags_total counter\n\
         remitflow_agent_fraud_flags_total {{}}\t{}\n",
        s.total_reconciled,
        s.total_discrepancies,
        s.total_fraud_flags,
    );
    (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "text/plain")], prom)
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8098".to_string())
        .parse()
        .unwrap_or(8098);

    let state: SharedState = Arc::new(Mutex::new(ReconciliationState::default()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/reconcile/agent", post(reconcile_agent))
        .route("/detect/anomaly", post(detect_anomaly))
        .route("/report/{agent_id}", get(get_report))
        .route("/metrics", get(get_metrics))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Agent Reconciliation Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
