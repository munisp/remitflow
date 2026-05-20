// credit-scoring-engine — Rust microservice for business credit scoring.
// Uses a weighted scorecard model across 6 dimensions:
//   1. Transaction volume & consistency
//   2. KYB completeness & verification status
//   3. Repayment history (if any prior credit)
//   4. Business age & stability
//   5. Industry risk classification
//   6. Cross-border payment volume (remittance platform signal)
// Listens on :8220.

use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Request/Response Types ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreditScoreRequest {
    business_id: i64,
    business_name: String,
    business_age_months: u32,
    industry: String,
    kyb_status: String,           // verified | pending | failed
    kyb_completeness_pct: f64,    // 0-100
    monthly_tx_volume_usd: f64,
    monthly_tx_count: u32,
    tx_consistency_score: f64,    // 0-100 (stddev-based consistency)
    prior_credit_count: u32,
    prior_defaults: u32,
    repayment_rate_pct: f64,      // 0-100 if has prior credit
    cross_border_volume_usd: f64,
    country: String,
}

#[derive(Serialize)]
struct ScoreComponent {
    name: String,
    raw_score: f64,
    weight: f64,
    weighted_score: f64,
    max_possible: f64,
}

#[derive(Serialize)]
struct CreditScoreResponse {
    business_id: i64,
    business_name: String,
    total_score: f64,
    max_score: f64,
    score_pct: f64,
    risk_band: String,           // AAA | AA | A | BBB | BB | B | CCC | D
    credit_limit_usd: f64,
    recommended_rate_pct: f64,
    max_tenor_days: u32,
    components: Vec<ScoreComponent>,
    flags: Vec<String>,
    decision: String,            // approve | conditional | decline
    decision_reason: String,
}

#[derive(Serialize)]
struct HealthResponse {
    service: String,
    status: String,
    version: String,
}

// ─── Industry Risk Table ──────────────────────────────────────────────────────

fn industry_risk_score(industry: &str) -> f64 {
    let scores: HashMap<&str, f64> = [
        ("fintech", 80.0),
        ("technology", 78.0),
        ("healthcare", 75.0),
        ("manufacturing", 70.0),
        ("agriculture", 68.0),
        ("logistics", 65.0),
        ("retail", 60.0),
        ("construction", 55.0),
        ("hospitality", 50.0),
        ("mining", 45.0),
        ("gambling", 10.0),
        ("crypto_exchange", 30.0),
    ].iter().cloned().collect();
    *scores.get(industry.to_lowercase().as_str()).unwrap_or(&55.0)
}

// ─── Country Risk Multiplier ──────────────────────────────────────────────────

fn country_risk_multiplier(country: &str) -> f64 {
    match country.to_uppercase().as_str() {
        "GB" | "DE" | "SG" | "AU" => 1.0,
        "US" | "CA" | "NL" | "FR" => 1.0,
        "AE" | "ZA" => 0.95,
        "NG" | "KE" | "GH" => 0.85,
        "TZ" | "UG" | "RW" => 0.80,
        _ => 0.75,
    }
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────

fn compute_credit_score(req: &CreditScoreRequest) -> CreditScoreResponse {
    let mut components = Vec::new();
    let mut flags = Vec::new();

    // 1. Transaction Volume & Consistency (25 points)
    let vol_score = if req.monthly_tx_volume_usd >= 500_000.0 { 25.0 }
        else if req.monthly_tx_volume_usd >= 100_000.0 { 20.0 }
        else if req.monthly_tx_volume_usd >= 50_000.0 { 15.0 }
        else if req.monthly_tx_volume_usd >= 10_000.0 { 10.0 }
        else if req.monthly_tx_volume_usd >= 1_000.0 { 5.0 }
        else { 1.0 };
    let consistency_bonus = req.tx_consistency_score / 100.0 * 5.0;
    let tx_score = (vol_score + consistency_bonus).min(25.0);
    components.push(ScoreComponent {
        name: "Transaction Volume & Consistency".to_string(),
        raw_score: req.monthly_tx_volume_usd,
        weight: 0.25,
        weighted_score: tx_score,
        max_possible: 25.0,
    });

    // 2. KYB Completeness (20 points)
    let kyb_score = match req.kyb_status.as_str() {
        "verified" => req.kyb_completeness_pct / 100.0 * 20.0,
        "pending"  => req.kyb_completeness_pct / 100.0 * 10.0,
        _          => 0.0,
    };
    if req.kyb_status != "verified" {
        flags.push("KYB not fully verified — conditional approval only".to_string());
    }
    components.push(ScoreComponent {
        name: "KYB Completeness & Verification".to_string(),
        raw_score: req.kyb_completeness_pct,
        weight: 0.20,
        weighted_score: kyb_score,
        max_possible: 20.0,
    });

    // 3. Repayment History (20 points)
    let repayment_score = if req.prior_credit_count == 0 {
        10.0 // neutral — no history
    } else if req.prior_defaults > 0 {
        let default_penalty = (req.prior_defaults as f64 * 5.0).min(20.0);
        (20.0 - default_penalty).max(0.0)
    } else {
        req.repayment_rate_pct / 100.0 * 20.0
    };
    if req.prior_defaults > 0 {
        flags.push(format!("{} prior default(s) on record — risk elevated", req.prior_defaults));
    }
    components.push(ScoreComponent {
        name: "Repayment History".to_string(),
        raw_score: req.repayment_rate_pct,
        weight: 0.20,
        weighted_score: repayment_score,
        max_possible: 20.0,
    });

    // 4. Business Age & Stability (15 points)
    let age_score = if req.business_age_months >= 60 { 15.0 }
        else if req.business_age_months >= 36 { 12.0 }
        else if req.business_age_months >= 24 { 9.0 }
        else if req.business_age_months >= 12 { 6.0 }
        else { 3.0 };
    if req.business_age_months < 12 {
        flags.push("Business less than 12 months old — limited trading history".to_string());
    }
    components.push(ScoreComponent {
        name: "Business Age & Stability".to_string(),
        raw_score: req.business_age_months as f64,
        weight: 0.15,
        weighted_score: age_score,
        max_possible: 15.0,
    });

    // 5. Industry Risk (10 points)
    let ind_score = industry_risk_score(&req.industry) / 100.0 * 10.0;
    components.push(ScoreComponent {
        name: "Industry Risk Classification".to_string(),
        raw_score: industry_risk_score(&req.industry),
        weight: 0.10,
        weighted_score: ind_score,
        max_possible: 10.0,
    });

    // 6. Cross-Border Payment Volume (10 points)
    let cbv_score = if req.cross_border_volume_usd >= 200_000.0 { 10.0 }
        else if req.cross_border_volume_usd >= 50_000.0 { 7.0 }
        else if req.cross_border_volume_usd >= 10_000.0 { 4.0 }
        else { 1.0 };
    components.push(ScoreComponent {
        name: "Cross-Border Payment Volume".to_string(),
        raw_score: req.cross_border_volume_usd,
        weight: 0.10,
        weighted_score: cbv_score,
        max_possible: 10.0,
    });

    let raw_total: f64 = components.iter().map(|c| c.weighted_score).sum();
    let country_mult = country_risk_multiplier(&req.country);
    let total_score = (raw_total * country_mult).min(100.0);
    let score_pct = total_score;

    // Risk band
    let risk_band = if score_pct >= 90.0 { "AAA" }
        else if score_pct >= 80.0 { "AA" }
        else if score_pct >= 70.0 { "A" }
        else if score_pct >= 60.0 { "BBB" }
        else if score_pct >= 50.0 { "BB" }
        else if score_pct >= 40.0 { "B" }
        else if score_pct >= 30.0 { "CCC" }
        else { "D" };

    // Credit limit: based on monthly tx volume and score
    let base_limit = req.monthly_tx_volume_usd * 2.0; // 2x monthly volume
    let score_factor = score_pct / 100.0;
    let credit_limit = (base_limit * score_factor * country_mult).min(5_000_000.0);
    let credit_limit = (credit_limit / 1000.0).round() * 1000.0; // round to nearest $1k

    // Interest rate: inverse of score
    let base_rate = 8.0; // 8% floor
    let rate_premium = ((100.0 - score_pct) / 100.0) * 12.0; // up to 12% premium
    let recommended_rate = base_rate + rate_premium;

    // Tenor
    let max_tenor = if score_pct >= 80.0 { 365 }
        else if score_pct >= 60.0 { 180 }
        else if score_pct >= 40.0 { 90 }
        else { 30 };

    // Decision
    let (decision, decision_reason) = if req.prior_defaults > 2 || risk_band == "D" {
        ("decline".to_string(), "Credit risk exceeds acceptable threshold — prior defaults or insufficient score".to_string())
    } else if req.kyb_status != "verified" || score_pct < 40.0 {
        ("conditional".to_string(), "Conditional approval pending KYB verification or additional documentation".to_string())
    } else {
        ("approve".to_string(), format!("Credit approved — {} risk band, limit ${:.0}, rate {:.1}%", risk_band, credit_limit, recommended_rate))
    };

    CreditScoreResponse {
        business_id: req.business_id,
        business_name: req.business_name.clone(),
        total_score: (total_score * 100.0).round() / 100.0,
        max_score: 100.0,
        score_pct: (score_pct * 100.0).round() / 100.0,
        risk_band: risk_band.to_string(),
        credit_limit_usd: credit_limit,
        recommended_rate_pct: (recommended_rate * 100.0).round() / 100.0,
        max_tenor_days: max_tenor,
        components,
        flags,
        decision,
        decision_reason,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        service: "credit-scoring-engine".to_string(),
        status: "healthy".to_string(),
        version: "1.0.0".to_string(),
    })
}

async fn score_credit(req: web::Json<CreditScoreRequest>) -> HttpResponse {
    let result = compute_credit_score(&req);
    HttpResponse::Ok().json(result)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("CREDIT_SCORING_PORT").unwrap_or_else(|_| "8220".to_string());
    let addr = format!("0.0.0.0:{}", port);
    println!("[credit-scoring-engine] Starting on {}", addr);

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/score", web::post().to(score_credit))
    })
    .bind(&addr)?
    .run()
    .await
}
