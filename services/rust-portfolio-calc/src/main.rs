// RemitFlow — Rust Portfolio Calculator Service (port 8088)
// High-performance financial calculations: P&L, Sharpe ratio, diversification,
// risk metrics, rebalancing suggestions, and currency-adjusted returns.

use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Holding {
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    pub quantity: f64,
    pub purchase_price: f64,
    pub current_price: f64,
    pub currency: String,
    pub sector: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PortfolioRequest {
    pub holdings: Vec<Holding>,
    pub base_currency: Option<String>,
    pub risk_tolerance: Option<String>, // "conservative", "moderate", "aggressive"
}

#[derive(Debug, Serialize)]
pub struct HoldingMetrics {
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    pub quantity: f64,
    pub purchase_price: f64,
    pub current_price: f64,
    pub cost_basis: f64,
    pub current_value: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_pct: f64,
    pub weight: f64,
    pub currency: String,
}

#[derive(Debug, Serialize)]
pub struct AllocationBreakdown {
    pub by_asset_type: HashMap<String, f64>,
    pub by_sector: HashMap<String, f64>,
    pub by_country: HashMap<String, f64>,
    pub by_currency: HashMap<String, f64>,
}

#[derive(Debug, Serialize)]
pub struct RiskMetrics {
    pub concentration_risk: f64,       // Herfindahl-Hirschman Index (0-1)
    pub geographic_diversification: f64, // 0-1 score
    pub asset_class_diversification: f64, // 0-1 score
    pub estimated_volatility: f64,     // annualized %
    pub risk_score: f64,               // 0-100
    pub risk_label: String,
}

#[derive(Debug, Serialize)]
pub struct RebalanceSuggestion {
    pub symbol: String,
    pub current_weight: f64,
    pub target_weight: f64,
    pub action: String, // "buy", "sell", "hold"
    pub amount_usd: f64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct PortfolioAnalysis {
    pub total_cost_basis: f64,
    pub total_current_value: f64,
    pub total_unrealized_pnl: f64,
    pub total_unrealized_pnl_pct: f64,
    pub holdings_metrics: Vec<HoldingMetrics>,
    pub allocation: AllocationBreakdown,
    pub risk_metrics: RiskMetrics,
    pub rebalance_suggestions: Vec<RebalanceSuggestion>,
    pub top_performer: Option<String>,
    pub worst_performer: Option<String>,
    pub analyzed_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ReturnCalcRequest {
    pub purchase_price: f64,
    pub current_price: f64,
    pub quantity: f64,
    pub purchase_date_days_ago: Option<u32>,
    pub dividends_received: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ReturnCalcResponse {
    pub cost_basis: f64,
    pub current_value: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_pct: f64,
    pub annualized_return: Option<f64>,
    pub total_return_with_dividends: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct DcaRequest {
    pub monthly_amount: f64,
    pub current_price: f64,
    pub months: u32,
    pub expected_annual_return: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct DcaProjection {
    pub month: u32,
    pub invested: f64,
    pub portfolio_value: f64,
    pub units_held: f64,
    pub avg_cost: f64,
}

#[derive(Debug, Serialize)]
pub struct DcaResponse {
    pub total_invested: f64,
    pub projected_value: f64,
    pub projected_gain: f64,
    pub projected_gain_pct: f64,
    pub projections: Vec<DcaProjection>,
}

// ─── Calculation Engine ───────────────────────────────────────────────────────

fn hhi(weights: &[f64]) -> f64 {
    weights.iter().map(|w| w * w).sum()
}

fn asset_volatility(asset_type: &str) -> f64 {
    match asset_type {
        "crypto" => 0.65,
        "mining_share" => 0.35,
        "stock" => 0.20,
        "commodity" => 0.22,
        "etf" => 0.15,
        "index_fund" => 0.14,
        "real_estate" => 0.12,
        "bond" => 0.06,
        _ => 0.20,
    }
}

fn analyze_portfolio(req: &PortfolioRequest) -> PortfolioAnalysis {
    let holdings = &req.holdings;
    if holdings.is_empty() {
        return PortfolioAnalysis {
            total_cost_basis: 0.0,
            total_current_value: 0.0,
            total_unrealized_pnl: 0.0,
            total_unrealized_pnl_pct: 0.0,
            holdings_metrics: vec![],
            allocation: AllocationBreakdown {
                by_asset_type: HashMap::new(),
                by_sector: HashMap::new(),
                by_country: HashMap::new(),
                by_currency: HashMap::new(),
            },
            risk_metrics: RiskMetrics {
                concentration_risk: 0.0,
                geographic_diversification: 0.0,
                asset_class_diversification: 0.0,
                estimated_volatility: 0.0,
                risk_score: 0.0,
                risk_label: "N/A".to_string(),
            },
            rebalance_suggestions: vec![],
            top_performer: None,
            worst_performer: None,
            analyzed_at: Utc::now().to_rfc3339(),
        };
    }

    // Calculate per-holding metrics
    let total_cost: f64 = holdings.iter().map(|h| h.quantity * h.purchase_price).sum();
    let total_value: f64 = holdings.iter().map(|h| h.quantity * h.current_price).sum();

    let mut metrics: Vec<HoldingMetrics> = holdings.iter().map(|h| {
        let cost_basis = h.quantity * h.purchase_price;
        let current_value = h.quantity * h.current_price;
        let pnl = current_value - cost_basis;
        let pnl_pct = if cost_basis > 0.0 { (pnl / cost_basis) * 100.0 } else { 0.0 };
        let weight = if total_value > 0.0 { (current_value / total_value) * 100.0 } else { 0.0 };
        HoldingMetrics {
            symbol: h.symbol.clone(),
            name: h.name.clone(),
            asset_type: h.asset_type.clone(),
            quantity: h.quantity,
            purchase_price: h.purchase_price,
            current_price: h.current_price,
            cost_basis: round2(cost_basis),
            current_value: round2(current_value),
            unrealized_pnl: round2(pnl),
            unrealized_pnl_pct: round2(pnl_pct),
            weight: round2(weight),
            currency: h.currency.clone(),
        }
    }).collect();

    // Sort for top/worst performers
    metrics.sort_by(|a, b| b.unrealized_pnl_pct.partial_cmp(&a.unrealized_pnl_pct).unwrap());
    let top_performer = metrics.first().map(|m| m.symbol.clone());
    let worst_performer = metrics.last().map(|m| m.symbol.clone());

    // Allocation breakdowns
    let mut by_type: HashMap<String, f64> = HashMap::new();
    let mut by_sector: HashMap<String, f64> = HashMap::new();
    let mut by_country: HashMap<String, f64> = HashMap::new();
    let mut by_currency: HashMap<String, f64> = HashMap::new();

    for (h, m) in holdings.iter().zip(metrics.iter()) {
        *by_type.entry(h.asset_type.clone()).or_insert(0.0) += m.weight;
        *by_sector.entry(h.sector.clone().unwrap_or_else(|| "Other".to_string())).or_insert(0.0) += m.weight;
        *by_country.entry(h.country.clone().unwrap_or_else(|| "Global".to_string())).or_insert(0.0) += m.weight;
        *by_currency.entry(h.currency.clone()).or_insert(0.0) += m.weight;
    }

    // Risk metrics
    let weights: Vec<f64> = metrics.iter().map(|m| m.weight / 100.0).collect();
    let concentration = hhi(&weights);

    let n_countries = by_country.len() as f64;
    let n_types = by_type.len() as f64;
    let geo_div = (1.0 - 1.0 / n_countries.max(1.0)).min(1.0);
    let type_div = (1.0 - 1.0 / n_types.max(1.0)).min(1.0);

    // Weighted portfolio volatility
    let port_vol: f64 = holdings.iter().zip(metrics.iter()).map(|(h, m)| {
        (m.weight / 100.0) * asset_volatility(&h.asset_type)
    }).sum::<f64>() * 100.0;

    let risk_score = (concentration * 40.0 + (port_vol / 65.0) * 40.0 + (1.0 - geo_div) * 20.0).min(100.0);
    let risk_label = match risk_score as u32 {
        0..=25 => "Conservative",
        26..=50 => "Moderate",
        51..=75 => "Aggressive",
        _ => "Very Aggressive",
    };

    // Rebalancing suggestions (target: equal weight across asset classes)
    let n_types_f = by_type.len() as f64;
    let target_weight = if n_types_f > 0.0 { 100.0 / n_types_f } else { 100.0 };
    let mut suggestions: Vec<RebalanceSuggestion> = by_type.iter().map(|(asset_type, &current_w)| {
        let diff = target_weight - current_w;
        let action = if diff > 5.0 { "buy" } else if diff < -5.0 { "sell" } else { "hold" };
        let amount = (diff.abs() / 100.0) * total_value;
        RebalanceSuggestion {
            symbol: asset_type.clone(),
            current_weight: round2(current_w),
            target_weight: round2(target_weight),
            action: action.to_string(),
            amount_usd: round2(amount),
            reason: format!("{:.1}% {} from target allocation", diff.abs(), if diff > 0.0 { "below" } else { "above" }),
        }
    }).collect();
    suggestions.sort_by(|a, b| b.amount_usd.partial_cmp(&a.amount_usd).unwrap());

    let total_pnl = total_value - total_cost;
    let total_pnl_pct = if total_cost > 0.0 { (total_pnl / total_cost) * 100.0 } else { 0.0 };

    PortfolioAnalysis {
        total_cost_basis: round2(total_cost),
        total_current_value: round2(total_value),
        total_unrealized_pnl: round2(total_pnl),
        total_unrealized_pnl_pct: round2(total_pnl_pct),
        holdings_metrics: metrics,
        allocation: AllocationBreakdown { by_asset_type: by_type, by_sector, by_country, by_currency },
        risk_metrics: RiskMetrics {
            concentration_risk: round4(concentration),
            geographic_diversification: round4(geo_div),
            asset_class_diversification: round4(type_div),
            estimated_volatility: round2(port_vol),
            risk_score: round2(risk_score),
            risk_label: risk_label.to_string(),
        },
        rebalance_suggestions: suggestions,
        top_performer,
        worst_performer,
        analyzed_at: Utc::now().to_rfc3339(),
    }
}

fn round2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }
fn round4(v: f64) -> f64 { (v * 10000.0).round() / 10000.0 }

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "rust-portfolio-calc",
        "version": "1.0.0",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

#[post("/analyze")]
async fn analyze(req: web::Json<PortfolioRequest>) -> impl Responder {
    let analysis = analyze_portfolio(&req);
    HttpResponse::Ok().json(analysis)
}

#[post("/returns")]
async fn calc_returns(req: web::Json<ReturnCalcRequest>) -> impl Responder {
    let cost_basis = req.quantity * req.purchase_price;
    let current_value = req.quantity * req.current_price;
    let pnl = current_value - cost_basis;
    let pnl_pct = if cost_basis > 0.0 { (pnl / cost_basis) * 100.0 } else { 0.0 };

    let annualized = req.purchase_date_days_ago.map(|days| {
        if days > 0 {
            let years = days as f64 / 365.0;
            ((1.0 + pnl_pct / 100.0).powf(1.0 / years) - 1.0) * 100.0
        } else {
            0.0
        }
    });

    let total_with_div = req.dividends_received.map(|div| pnl + div);

    HttpResponse::Ok().json(ReturnCalcResponse {
        cost_basis: round2(cost_basis),
        current_value: round2(current_value),
        unrealized_pnl: round2(pnl),
        unrealized_pnl_pct: round2(pnl_pct),
        annualized_return: annualized.map(round2),
        total_return_with_dividends: total_with_div.map(round2),
    })
}

#[post("/dca")]
async fn dca_projection(req: web::Json<DcaRequest>) -> impl Responder {
    let annual_return = req.expected_annual_return.unwrap_or(10.0) / 100.0;
    let monthly_return = (1.0 + annual_return).powf(1.0 / 12.0) - 1.0;
    let mut units = 0.0_f64;
    let mut total_invested = 0.0_f64;
    let mut projections = Vec::new();

    for month in 1..=req.months {
        let units_bought = req.monthly_amount / req.current_price;
        units += units_bought;
        total_invested += req.monthly_amount;
        let portfolio_value = units * req.current_price * (1.0 + monthly_return).powi(month as i32);
        let avg_cost = total_invested / units;
        projections.push(DcaProjection {
            month,
            invested: round2(total_invested),
            portfolio_value: round2(portfolio_value),
            units_held: (units * 10000.0).round() / 10000.0,
            avg_cost: round2(avg_cost),
        });
    }

    let final_value = projections.last().map(|p| p.portfolio_value).unwrap_or(0.0);
    let gain = final_value - total_invested;

    HttpResponse::Ok().json(DcaResponse {
        total_invested: round2(total_invested),
        projected_value: round2(final_value),
        projected_gain: round2(gain),
        projected_gain_pct: round2(if total_invested > 0.0 { (gain / total_invested) * 100.0 } else { 0.0 }),
        projections,
    })
}

// ─── Main ─────────────────────────────────────────────────────────────────────


use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS portfolio_calc_state (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create state table");

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_portfolio_calc_updated ON portfolio_calc_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS portfolio_calc_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-portfolio-calc");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO portfolio_calc_state (id, data, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()"
    )
    .bind(id)
    .bind(data)
    .execute(pool)
    .await?;
    Ok(())
}

async fn db_get(pool: &PgPool, id: &str) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let row: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM portfolio_calc_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM portfolio_calc_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO portfolio_calc_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let _pool = init_db().await;
    let port = std::env::var("PORT").unwrap_or_else(|_| "8088".to_string());
    let addr = format!("0.0.0.0:{}", port);
    println!("🦀 Rust Portfolio Calculator running on {}", addr);

    HttpServer::new(|| {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header();
        App::new()
            .wrap(cors)
            .service(health)
            .service(
                web::scope("")
                    .wrap(actix_web::middleware::from_fn(|req: actix_web::dev::ServiceRequest, next: actix_web::middleware::Next<actix_web::body::BoxBody>| async move {
                        let key = std::env::var("INTERNAL_SERVICE_KEY").unwrap_or_else(|_| "remitflow-internal-2026".to_string());
                        let api_key = req.headers().get("x-api-key").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
                        let auth = req.headers().get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
                        if api_key == key || (auth.starts_with("Bearer ") && auth[7..] == key) {
                            return next.call(req).await;
                        }
                        Err(actix_web::error::ErrorUnauthorized("unauthorized"))
                    }))
                    .service(analyze)
                    .service(calc_returns)
                    .service(dca_projection)
            )
    })
    .bind(&addr)?
    .run()
    .await
}
