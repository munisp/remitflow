// RemitFlow Compliance Engine — Rust microservice
// Sanctions screening, velocity checks, AML rules, OFAC/UN/EU watchlist matching
// REST API: POST /screen, POST /velocity-check, GET /watchlist, GET /health
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use dashmap::DashMap;
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistEntry {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub list_type: String, // OFAC, UN, EU, PEP, ADVERSE_MEDIA
    pub country: Option<String>,
    pub date_of_birth: Option<String>,
    pub risk_score: u8,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
pub struct ScreenRequest {
    pub user_id: String,
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub country: Option<String>,
    pub amount_usd: Option<f64>,
    pub source_of_funds: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScreenResult {
    pub screen_id: String,
    pub user_id: String,
    pub status: String, // clear, review, blocked
    pub risk_score: u8,
    pub matches: Vec<WatchlistMatch>,
    pub flags: Vec<String>,
    pub recommendation: String,
    pub screened_at: i64,
}

#[derive(Debug, Serialize)]
pub struct WatchlistMatch {
    pub entry_id: String,
    pub name: String,
    pub list_type: String,
    pub match_score: f64,
    pub match_type: String, // exact, fuzzy, alias
}

#[derive(Debug, Deserialize)]
pub struct VelocityRequest {
    pub user_id: String,
    pub amount_usd: f64,
    pub currency: String,
    pub transaction_type: String,
}

#[derive(Debug, Serialize)]
pub struct VelocityResult {
    pub check_id: String,
    pub user_id: String,
    pub allowed: bool,
    pub reason: Option<String>,
    pub daily_total_usd: f64,
    pub monthly_total_usd: f64,
    pub daily_limit_usd: f64,
    pub monthly_limit_usd: f64,
    pub checked_at: i64,
}

// ─── State ───────────────────────────────────────────────────────────────────

pub struct AppState {
    pub watchlist: Vec<WatchlistEntry>,
    pub velocity_tracker: DashMap<String, Vec<(i64, f64)>>, // user_id → [(timestamp, amount)]
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            watchlist: build_sample_watchlist(),
            velocity_tracker: DashMap::new(),
        }
    }
}

fn build_sample_watchlist() -> Vec<WatchlistEntry> {
    vec![
        WatchlistEntry {
            id: "WL-001".to_string(),
            name: "JOHN DOE SANCTIONED".to_string(),
            aliases: vec!["J. Doe".to_string(), "John D.".to_string()],
            list_type: "OFAC".to_string(),
            country: Some("IR".to_string()),
            date_of_birth: Some("1970-01-01".to_string()),
            risk_score: 100,
            active: true,
        },
        WatchlistEntry {
            id: "WL-002".to_string(),
            name: "ACME SHELL CORP".to_string(),
            aliases: vec!["Acme Corp".to_string()],
            list_type: "UN".to_string(),
            country: Some("KP".to_string()),
            date_of_birth: None,
            risk_score: 95,
            active: true,
        },
        WatchlistEntry {
            id: "WL-003".to_string(),
            name: "POLITICALLY EXPOSED PERSON TEST".to_string(),
            aliases: vec!["PEP Test".to_string()],
            list_type: "PEP".to_string(),
            country: Some("NG".to_string()),
            date_of_birth: None,
            risk_score: 70,
            active: true,
        },
    ]
}

// ─── Screening Logic ──────────────────────────────────────────────────────────

fn normalize(s: &str) -> String {
    s.to_uppercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn fuzzy_match_score(a: &str, b: &str) -> f64 {
    let a = normalize(a);
    let b = normalize(b);
    if a == b { return 1.0; }

    // Simple Jaccard similarity on word sets
    let a_words: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let b_words: std::collections::HashSet<&str> = b.split_whitespace().collect();
    let intersection = a_words.intersection(&b_words).count();
    let union = a_words.union(&b_words).count();
    if union == 0 { return 0.0; }
    intersection as f64 / union as f64
}

fn screen_against_watchlist(name: &str, watchlist: &[WatchlistEntry]) -> Vec<WatchlistMatch> {
    let mut matches = Vec::new();
    for entry in watchlist {
        if !entry.active { continue; }

        // Check primary name
        let score = fuzzy_match_score(name, &entry.name);
        if score >= 0.85 {
            matches.push(WatchlistMatch {
                entry_id: entry.id.clone(),
                name: entry.name.clone(),
                list_type: entry.list_type.clone(),
                match_score: score,
                match_type: if score >= 0.99 { "exact".to_string() } else { "fuzzy".to_string() },
            });
            continue;
        }

        // Check aliases
        for alias in &entry.aliases {
            let alias_score = fuzzy_match_score(name, alias);
            if alias_score >= 0.85 {
                matches.push(WatchlistMatch {
                    entry_id: entry.id.clone(),
                    name: entry.name.clone(),
                    list_type: entry.list_type.clone(),
                    match_score: alias_score,
                    match_type: "alias".to_string(),
                });
                break;
            }
        }
    }
    matches
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "compliance-engine",
        "version": "1.0.0",
        "watchlist_size": state.watchlist.len(),
        "timestamp": Utc::now().timestamp_millis()
    }))
}

async fn screen_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScreenRequest>,
) -> Json<ScreenResult> {
    let matches = screen_against_watchlist(&req.full_name, &state.watchlist);

    let mut risk_score: u8 = 0;
    let mut flags = Vec::new();

    // Watchlist match risk
    for m in &matches {
        risk_score = risk_score.max(
            state.watchlist.iter()
                .find(|e| e.id == m.entry_id)
                .map(|e| e.risk_score)
                .unwrap_or(50)
        );
    }

    // High-value transaction flag
    if let Some(amount) = req.amount_usd {
        if amount >= 10000.0 {
            flags.push("HIGH_VALUE_TRANSACTION".to_string());
            risk_score = risk_score.max(40);
        }
        if amount >= 50000.0 {
            flags.push("VERY_HIGH_VALUE_TRANSACTION".to_string());
            risk_score = risk_score.max(60);
        }
    }

    // High-risk country
    if let Some(ref country) = req.country {
        let high_risk_countries = ["IR", "KP", "SY", "CU", "VE", "MM"];
        if high_risk_countries.contains(&country.as_str()) {
            flags.push("HIGH_RISK_COUNTRY".to_string());
            risk_score = risk_score.max(70);
        }
    }

    let status = if risk_score >= 70 {
        "blocked"
    } else if risk_score >= 30 || !matches.is_empty() {
        "review"
    } else {
        "clear"
    };

    let recommendation = match status {
        "blocked" => "Transaction blocked. Manual review and SAR filing required.",
        "review" => "Enhanced due diligence required before proceeding.",
        _ => "Transaction cleared for processing.",
    };

    Json(ScreenResult {
        screen_id: format!("SCR-{}", Uuid::new_v4()),
        user_id: req.user_id,
        status: status.to_string(),
        risk_score,
        matches,
        flags,
        recommendation: recommendation.to_string(),
        screened_at: Utc::now().timestamp_millis(),
    })
}

async fn velocity_check(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VelocityRequest>,
) -> Json<VelocityResult> {
    let now = Utc::now().timestamp_millis();
    let day_ago = now - 86_400_000;
    let month_ago = now - 30 * 86_400_000;

    // Daily limit: $5,000 USD; Monthly: $25,000 USD
    let daily_limit = 5000.0_f64;
    let monthly_limit = 25000.0_f64;

    let mut tracker = state.velocity_tracker.entry(req.user_id.clone()).or_default();

    // Clean old entries
    tracker.retain(|(ts, _)| *ts > month_ago);

    let daily_total: f64 = tracker.iter()
        .filter(|(ts, _)| *ts > day_ago)
        .map(|(_, amt)| amt)
        .sum();

    let monthly_total: f64 = tracker.iter().map(|(_, amt)| amt).sum();

    let allowed = daily_total + req.amount_usd <= daily_limit
        && monthly_total + req.amount_usd <= monthly_limit;

    let reason = if !allowed {
        if daily_total + req.amount_usd > daily_limit {
            Some(format!("Daily limit of ${:.0} USD exceeded", daily_limit))
        } else {
            Some(format!("Monthly limit of ${:.0} USD exceeded", monthly_limit))
        }
    } else {
        None
    };

    if allowed {
        tracker.push((now, req.amount_usd));
    }

    Json(VelocityResult {
        check_id: format!("VEL-{}", Uuid::new_v4()),
        user_id: req.user_id,
        allowed,
        reason,
        daily_total_usd: daily_total,
        monthly_total_usd: monthly_total,
        daily_limit_usd: daily_limit,
        monthly_limit_usd: monthly_limit,
        checked_at: now,
    })
}

async fn get_watchlist(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "data": state.watchlist,
        "count": state.watchlist.len(),
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
        .unwrap_or_else(|_| "8086".to_string())
        .parse()
        .unwrap_or(8086);

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
        .route("/screen", post(screen_handler))
        .route("/velocity-check", post(velocity_check))
        .route("/watchlist", get(get_watchlist))
        .route("/metrics", get(|State(h): State<PrometheusHandle>| async move {
            let body = h.render();
            ([(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")], body).into_response()
        }).with_state(recorder_handle))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Compliance Engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
