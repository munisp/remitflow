/*!
 * RemitFlow AML/Compliance Rules Engine
 * Built with Axum + Tokio + Serde
 * Port: 8083
 *
 * Endpoints:
 *   GET  /health
 *   GET  /rules
 *   POST /screen
 *   POST /sanctions-check
 *   POST /pep-check
 */

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use std::time::{SystemTime, UNIX_EPOCH};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

// ─── AML Rule Definitions ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AmlRule {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub severity: &'static str,
    pub threshold: Option<f64>,
    pub active: bool,
}

fn get_rules() -> Vec<AmlRule> {
    vec![
        AmlRule {
            id: "R001",
            name: "High-Value Transaction",
            description: "Single transaction exceeds $10,000 USD — CTR filing required",
            category: "threshold",
            severity: "high",
            threshold: Some(10_000.0),
            active: true,
        },
        AmlRule {
            id: "R002",
            name: "Structuring Detection",
            description: "Multiple transactions just below $10,000 within 24h (smurfing)",
            category: "structuring",
            severity: "critical",
            threshold: Some(9_500.0),
            active: true,
        },
        AmlRule {
            id: "R003",
            name: "High-Risk Country",
            description: "Transaction involves FATF high-risk or sanctioned jurisdiction",
            category: "geographic",
            severity: "critical",
            threshold: None,
            active: true,
        },
        AmlRule {
            id: "R004",
            name: "Velocity Breach — 1h",
            description: "More than 5 transactions in a 1-hour window",
            category: "velocity",
            severity: "high",
            threshold: Some(5.0),
            active: true,
        },
        AmlRule {
            id: "R005",
            name: "Velocity Breach — 24h",
            description: "More than 15 transactions in a 24-hour window",
            category: "velocity",
            severity: "medium",
            threshold: Some(15.0),
            active: true,
        },
        AmlRule {
            id: "R006",
            name: "Round Number Pattern",
            description: "Suspiciously round amounts (e.g., exactly $1000, $5000) repeated",
            category: "pattern",
            severity: "low",
            threshold: None,
            active: true,
        },
        AmlRule {
            id: "R007",
            name: "Sanctions List Match",
            description: "Sender or receiver name matches OFAC/UN sanctions list",
            category: "sanctions",
            severity: "critical",
            threshold: None,
            active: true,
        },
        AmlRule {
            id: "R008",
            name: "PEP Involvement",
            description: "Transaction involves a Politically Exposed Person",
            category: "pep",
            severity: "high",
            threshold: None,
            active: true,
        },
        AmlRule {
            id: "R009",
            name: "Unusual Hour",
            description: "Transaction initiated between 01:00–04:00 UTC",
            category: "behavioral",
            severity: "low",
            threshold: None,
            active: true,
        },
        AmlRule {
            id: "R010",
            name: "New Beneficiary High Value",
            description: "First transaction to a new beneficiary exceeds $2,000",
            category: "behavioral",
            severity: "medium",
            threshold: Some(2_000.0),
            active: true,
        },
    ]
}

// ─── High-risk countries (FATF grey/black list + sanctioned) ──────────────────
fn high_risk_countries() -> Vec<&'static str> {
    vec![
        "IR", "KP", "SY", "MM", "YE", "LY", "SO", "SD", "CF", "SS",
        "AF", "HT", "PA", "PK", "PH", "VN", "TR",
    ]
}

// ─── Embedded sanctions list (OFAC-style, illustrative) ───────────────────────
fn sanctions_list() -> Vec<&'static str> {
    vec![
        "JOHN DOE SANCTIONED",
        "ACME SHELL CORP",
        "DARK MONEY LLC",
        "TERROR FINANCE GROUP",
        "NORTH KOREA BANK",
        "IRAN PETROLEUM",
        "GLOBAL LAUNDERING INC",
        "SHADOW REMIT CO",
    ]
}

// ─── PEP list (illustrative) ──────────────────────────────────────────────────
fn pep_list() -> Vec<&'static str> {
    vec![
        "JOHN POLITICIAN",
        "JANE MINISTER",
        "ROBERT GENERAL",
        "ALICE GOVERNOR",
        "CORRUPT OFFICIAL",
    ]
}

fn name_matches(name: &str, list: &[&str]) -> bool {
    let name_upper = name.to_uppercase();
    list.iter().any(|entry| {
        let entry_upper = entry.to_uppercase();
        // Fuzzy: check if any word in the list entry appears in the name
        entry_upper.split_whitespace().any(|word| name_upper.contains(word) && word.len() > 3)
    })
}

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ScreenRequest {
    pub transaction_id: String,
    pub amount_usd: f64,
    pub sender_country: Option<String>,
    pub receiver_country: Option<String>,
    pub sender_name: Option<String>,
    pub receiver_name: Option<String>,
    pub velocity_1h: Option<u32>,
    pub velocity_24h: Option<u32>,
    pub is_new_beneficiary: Option<bool>,
    pub hour_utc: Option<u8>,
    pub is_round_number: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct MatchedRule {
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct ScreenResponse {
    pub transaction_id: String,
    pub decision: String, // PASS | REVIEW | BLOCK
    pub risk_score: f64,
    pub matched_rules: Vec<MatchedRule>,
    pub screened_at: String,
    pub screen_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SanctionsRequest {
    pub name: String,
    pub country: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SanctionsResponse {
    pub name: String,
    pub is_match: bool,
    pub match_type: Option<String>,
    pub confidence: f64,
    pub screened_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PepRequest {
    pub name: String,
    pub country: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PepResponse {
    pub name: String,
    pub is_pep: bool,
    pub pep_category: Option<String>,
    pub confidence: f64,
    pub screened_at: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "aml-engine",
        "version": "1.0.0",
        "rules_loaded": get_rules().len(),
    }))
}

async fn list_rules() -> impl IntoResponse {
    let rules = get_rules();
    Json(serde_json::json!({
        "rules": rules,
        "count": rules.len(),
    }))
}

async fn screen_transaction(Json(req): Json<ScreenRequest>) -> impl IntoResponse {
    let mut matched: Vec<MatchedRule> = Vec::new();
    let high_risk = high_risk_countries();

    // R001 — High-value transaction
    if req.amount_usd >= 10_000.0 {
        matched.push(MatchedRule {
            rule_id: "R001".into(),
            rule_name: "High-Value Transaction".into(),
            severity: "high".into(),
            detail: format!("Amount ${:.2} exceeds $10,000 CTR threshold", req.amount_usd),
        });
    }

    // R002 — Structuring
    if req.amount_usd >= 9_500.0 && req.amount_usd < 10_000.0 {
        matched.push(MatchedRule {
            rule_id: "R002".into(),
            rule_name: "Structuring Detection".into(),
            severity: "critical".into(),
            detail: format!("Amount ${:.2} is suspiciously just below $10,000 CTR threshold", req.amount_usd),
        });
    }

    // R003 — High-risk country
    let sender_c = req.sender_country.as_deref().unwrap_or("").to_uppercase();
    let receiver_c = req.receiver_country.as_deref().unwrap_or("").to_uppercase();
    if high_risk.contains(&sender_c.as_str()) || high_risk.contains(&receiver_c.as_str()) {
        matched.push(MatchedRule {
            rule_id: "R003".into(),
            rule_name: "High-Risk Country".into(),
            severity: "critical".into(),
            detail: format!(
                "Transaction involves high-risk jurisdiction: sender={} receiver={}",
                sender_c, receiver_c
            ),
        });
    }

    // R004 — Velocity 1h
    if let Some(v) = req.velocity_1h {
        if v > 5 {
            matched.push(MatchedRule {
                rule_id: "R004".into(),
                rule_name: "Velocity Breach — 1h".into(),
                severity: "high".into(),
                detail: format!("{} transactions in last 1h (limit: 5)", v),
            });
        }
    }

    // R005 — Velocity 24h
    if let Some(v) = req.velocity_24h {
        if v > 15 {
            matched.push(MatchedRule {
                rule_id: "R005".into(),
                rule_name: "Velocity Breach — 24h".into(),
                severity: "medium".into(),
                detail: format!("{} transactions in last 24h (limit: 15)", v),
            });
        }
    }

    // R006 — Round number
    if req.is_round_number.unwrap_or(false) {
        matched.push(MatchedRule {
            rule_id: "R006".into(),
            rule_name: "Round Number Pattern".into(),
            severity: "low".into(),
            detail: format!("Amount ${:.2} is a suspiciously round number", req.amount_usd),
        });
    }

    // R007 — Sanctions
    let sanctions = sanctions_list();
    if let Some(ref sname) = req.sender_name {
        if name_matches(sname, &sanctions) {
            matched.push(MatchedRule {
                rule_id: "R007".into(),
                rule_name: "Sanctions List Match".into(),
                severity: "critical".into(),
                detail: format!("Sender '{}' matches sanctions list", sname),
            });
        }
    }
    if let Some(ref rname) = req.receiver_name {
        if name_matches(rname, &sanctions) {
            matched.push(MatchedRule {
                rule_id: "R007".into(),
                rule_name: "Sanctions List Match".into(),
                severity: "critical".into(),
                detail: format!("Receiver '{}' matches sanctions list", rname),
            });
        }
    }

    // R008 — PEP
    let peps = pep_list();
    if let Some(ref sname) = req.sender_name {
        if name_matches(sname, &peps) {
            matched.push(MatchedRule {
                rule_id: "R008".into(),
                rule_name: "PEP Involvement".into(),
                severity: "high".into(),
                detail: format!("Sender '{}' identified as PEP", sname),
            });
        }
    }

    // R009 — Unusual hour
    if let Some(h) = req.hour_utc {
        if h <= 4 {
            matched.push(MatchedRule {
                rule_id: "R009".into(),
                rule_name: "Unusual Hour".into(),
                severity: "low".into(),
                detail: format!("Transaction at {:02}:00 UTC (unusual hours 00-04)", h),
            });
        }
    }

    // R010 — New beneficiary high value
    if req.is_new_beneficiary.unwrap_or(false) && req.amount_usd > 2_000.0 {
        matched.push(MatchedRule {
            rule_id: "R010".into(),
            rule_name: "New Beneficiary High Value".into(),
            severity: "medium".into(),
            detail: format!(
                "First transaction to new beneficiary: ${:.2} exceeds $2,000",
                req.amount_usd
            ),
        });
    }

    // Compute risk score and decision
    let risk_score: f64 = matched.iter().map(|r| match r.severity.as_str() {
        "critical" => 0.40,
        "high"     => 0.25,
        "medium"   => 0.15,
        "low"      => 0.05,
        _          => 0.0,
    }).sum::<f64>().min(1.0);

    let has_critical = matched.iter().any(|r| r.severity == "critical");
    let decision = if has_critical || risk_score >= 0.60 {
        "BLOCK"
    } else if risk_score >= 0.25 {
        "REVIEW"
    } else {
        "PASS"
    };

    info!(
        "[SCREEN] txn={} decision={} risk={:.2} rules={}",
        req.transaction_id, decision, risk_score, matched.len()
    );
    if decision == "BLOCK" {
        warn!("[SCREEN] BLOCKED txn={} rules={:?}", req.transaction_id, matched.iter().map(|r| &r.rule_id).collect::<Vec<_>>());
    }

    Json(ScreenResponse {
        transaction_id: req.transaction_id,
        decision: decision.into(),
        risk_score,
        matched_rules: matched,
        screened_at: Utc::now().to_rfc3339(),
        screen_id: Uuid::new_v4().to_string(),
    })
}

async fn sanctions_check(Json(req): Json<SanctionsRequest>) -> impl IntoResponse {
    let list = sanctions_list();
    let is_match = name_matches(&req.name, &list);
    let confidence = if is_match { 0.92 } else { 0.02 };
    Json(SanctionsResponse {
        name: req.name,
        is_match,
        match_type: if is_match { Some("name_fuzzy".into()) } else { None },
        confidence,
        screened_at: Utc::now().to_rfc3339(),
    })
}

async fn pep_check(Json(req): Json<PepRequest>) -> impl IntoResponse {
    let list = pep_list();
    let is_pep = name_matches(&req.name, &list);
    let confidence = if is_pep { 0.88 } else { 0.03 };
    Json(PepResponse {
        name: req.name,
        is_pep,
        pep_category: if is_pep { Some("government_official".into()) } else { None },
        confidence,
        screened_at: Utc::now().to_rfc3339(),
    })
}

// ─── Velocity Check ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VelocityRequest {
    pub user_id: String,
    pub amount_usd: f64,
    pub transfers_1h: u32,
    pub transfers_24h: u32,
    pub total_usd_24h: f64,
    pub kyc_tier: u8,
}

#[derive(Debug, Serialize)]
pub struct VelocityResponse {
    pub user_id: String,
    pub allowed: bool,
    pub reason: Option<String>,
    pub limit_1h: u32,
    pub limit_24h: u32,
    pub daily_limit_usd: f64,
    pub remaining_usd_24h: f64,
    pub checked_at: String,
}

/// KYC-tier-based velocity limits:
/// Tier 0: $500/day, 3 tx/hour, 5 tx/day
/// Tier 1: $2,000/day, 5 tx/hour, 10 tx/day
/// Tier 2: $10,000/day, 10 tx/hour, 20 tx/day
/// Tier 3: $50,000/day, 20 tx/hour, 50 tx/day
fn tier_limits(tier: u8) -> (u32, u32, f64) {
    match tier {
        0 => (3, 5, 500.0),
        1 => (5, 10, 2_000.0),
        2 => (10, 20, 10_000.0),
        3 => (20, 50, 50_000.0),
        _ => (3, 5, 500.0),
    }
}

async fn velocity_check(Json(req): Json<VelocityRequest>) -> impl IntoResponse {
    let (limit_1h, limit_24h, daily_limit) = tier_limits(req.kyc_tier);
    let remaining = (daily_limit - req.total_usd_24h).max(0.0);

    let mut reason: Option<String> = None;
    let allowed;

    if req.transfers_1h >= limit_1h {
        allowed = false;
        reason = Some(format!(
            "Hourly velocity limit reached: {} of {} allowed transfers in last 1h",
            req.transfers_1h, limit_1h
        ));
    } else if req.transfers_24h >= limit_24h {
        allowed = false;
        reason = Some(format!(
            "Daily velocity limit reached: {} of {} allowed transfers in last 24h",
            req.transfers_24h, limit_24h
        ));
    } else if req.total_usd_24h + req.amount_usd > daily_limit {
        allowed = false;
        reason = Some(format!(
            "Daily amount limit would be exceeded: ${:.2} remaining of ${:.2} daily limit (KYC Tier {})",
            remaining, daily_limit, req.kyc_tier
        ));
    } else {
        allowed = true;
    }

    if !allowed {
        warn!(
            "[VELOCITY] BLOCKED user={} tier={} reason={:?}",
            req.user_id, req.kyc_tier, reason
        );
    }

    Json(VelocityResponse {
        user_id: req.user_id,
        allowed,
        reason,
        limit_1h,
        limit_24h,
        daily_limit_usd: daily_limit,
        remaining_usd_24h: remaining,
        checked_at: Utc::now().to_rfc3339(),
    })
}

async fn metrics_handler() -> impl IntoResponse {
    let uptime = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    (StatusCode::OK, format!(
        "# HELP aml_engine_uptime_seconds Uptime in seconds\n# TYPE aml_engine_uptime_seconds gauge\naml_engine_uptime_seconds {}\n",
        uptime
    ))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env()
            .add_directive("aml_engine=info".parse().unwrap()))
        .init();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/rules", get(list_rules))
        .route("/screen", post(screen_transaction))
        .route("/sanctions-check", post(sanctions_check))
        .route("/pep-check", post(pep_check))
        .route("/velocity-check", post(velocity_check))
        .route("/metrics", get(metrics_handler))
        .layer(cors);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8083);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("RemitFlow AML Engine starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
