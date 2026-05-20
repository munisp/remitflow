// bond-market-matcher — Rust microservice for diaspora bond secondary market.
// Implements price-time priority order book matching, yield-to-maturity calculation,
// accrued interest, dirty/clean price, and lock-up period enforcement.
// Listens on :8222.

use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use chrono::{NaiveDate, Utc};
use std::f64::consts::E;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone)]
struct AskOrder {
    order_id: i64,
    seller_id: i64,
    bond_id: i64,
    units: f64,
    ask_price_usd: f64,   // per unit
    face_value_usd: f64,  // per unit
    coupon_rate_pct: f64,
    maturity_date: String,
    issue_date: String,
    lock_up_end_date: String,
    created_at: String,
}

#[derive(Deserialize)]
struct MatchRequest {
    buyer_id: i64,
    bond_id: i64,
    units_wanted: f64,
    max_price_usd: f64,   // buyer's limit price per unit
    asks: Vec<AskOrder>,
}

#[derive(Serialize, Clone)]
struct MatchedFill {
    order_id: i64,
    seller_id: i64,
    units: f64,
    price_per_unit: f64,
    subtotal_usd: f64,
    accrued_interest_usd: f64,
    dirty_price_usd: f64,
    ytm_pct: f64,
}

#[derive(Serialize)]
struct MatchResponse {
    buyer_id: i64,
    bond_id: i64,
    units_requested: f64,
    units_filled: f64,
    units_unfilled: f64,
    fills: Vec<MatchedFill>,
    total_clean_price_usd: f64,
    total_accrued_interest_usd: f64,
    total_dirty_price_usd: f64,
    avg_ytm_pct: f64,
    fully_filled: bool,
    rejected_asks: Vec<String>,
}

#[derive(Deserialize)]
struct YTMRequest {
    face_value_usd: f64,
    coupon_rate_pct: f64,
    market_price_usd: f64,
    years_to_maturity: f64,
    payments_per_year: u32,
}

#[derive(Serialize)]
struct YTMResponse {
    ytm_pct: f64,
    duration_years: f64,
    modified_duration: f64,
    convexity: f64,
    accrued_interest_usd: f64,
    clean_price_usd: f64,
    dirty_price_usd: f64,
}

// ─── Bond Math ────────────────────────────────────────────────────────────────

fn calculate_accrued_interest(
    face_value: f64,
    coupon_rate_pct: f64,
    issue_date_str: &str,
    settlement_date: NaiveDate,
    payments_per_year: u32,
) -> f64 {
    let issue_date = NaiveDate::parse_from_str(issue_date_str, "%Y-%m-%d")
        .unwrap_or(settlement_date);
    
    let period_days = 365.0 / payments_per_year as f64;
    let days_since_issue = (settlement_date - issue_date).num_days() as f64;
    let days_in_period = days_since_issue % period_days;
    let fraction = days_in_period / period_days;
    
    let coupon_per_period = face_value * (coupon_rate_pct / 100.0) / payments_per_year as f64;
    coupon_per_period * fraction
}

// Newton-Raphson YTM solver
fn calculate_ytm(face: f64, coupon_rate: f64, price: f64, years: f64, freq: u32) -> f64 {
    if years <= 0.0 || price <= 0.0 {
        return 0.0;
    }
    
    let n = (years * freq as f64).round() as u32;
    let c = face * coupon_rate / 100.0 / freq as f64;
    
    // Initial guess: current yield
    let mut ytm = c * freq as f64 / price;
    
    for _ in 0..100 {
        let r = ytm / freq as f64;
        let mut pv = 0.0;
        let mut dpv = 0.0;
        
        for t in 1..=n {
            let df = (1.0 + r).powi(-(t as i32));
            pv += c * df;
            dpv -= (t as f64) * c * df / (1.0 + r);
        }
        let df_n = (1.0 + r).powi(-(n as i32));
        pv += face * df_n;
        dpv -= (n as f64) * face * df_n / (1.0 + r);
        
        let f = pv - price;
        if f.abs() < 1e-8 {
            break;
        }
        ytm -= f / (dpv / freq as f64);
    }
    
    (ytm * 10000.0).round() / 100.0 // return as percentage, 2dp
}

fn calculate_duration(face: f64, coupon_rate: f64, ytm_pct: f64, years: f64, freq: u32) -> (f64, f64) {
    if years <= 0.0 {
        return (0.0, 0.0);
    }
    
    let n = (years * freq as f64).round() as u32;
    let c = face * coupon_rate / 100.0 / freq as f64;
    let r = ytm_pct / 100.0 / freq as f64;
    
    let mut pv_total = 0.0;
    let mut weighted_pv = 0.0;
    let mut convexity = 0.0;
    
    for t in 1..=n {
        let df = (1.0 + r).powi(-(t as i32));
        let cf = if t == n { c + face } else { c };
        let pv = cf * df;
        pv_total += pv;
        weighted_pv += (t as f64 / freq as f64) * pv;
        convexity += (t as f64 * (t as f64 + 1.0)) * pv / ((1.0 + r).powi(2));
    }
    
    let macaulay = if pv_total > 0.0 { weighted_pv / pv_total } else { 0.0 };
    let modified = macaulay / (1.0 + r);
    let conv = if pv_total > 0.0 { convexity / (pv_total * (freq as f64).powi(2)) } else { 0.0 };
    
    (
        (modified * 100.0).round() / 100.0,
        (conv * 100.0).round() / 100.0,
    )
}

// ─── Order Matching ───────────────────────────────────────────────────────────

fn match_orders(req: &MatchRequest) -> MatchResponse {
    let today = Utc::now().date_naive();
    let mut rejected_asks: Vec<String> = Vec::new();
    
    // Filter eligible asks: within price limit, lock-up expired, same bond
    let mut eligible: Vec<&AskOrder> = req.asks.iter()
        .filter(|ask| {
            if ask.bond_id != req.bond_id {
                return false;
            }
            if ask.ask_price_usd > req.max_price_usd {
                rejected_asks.push(format!("Order {}: ask ${:.2} exceeds buyer limit ${:.2}", ask.order_id, ask.ask_price_usd, req.max_price_usd));
                return false;
            }
            // Check lock-up
            if let Ok(lockup_end) = NaiveDate::parse_from_str(&ask.lock_up_end_date, "%Y-%m-%d") {
                if today < lockup_end {
                    rejected_asks.push(format!("Order {}: still in lock-up period until {}", ask.order_id, ask.lock_up_end_date));
                    return false;
                }
            }
            true
        })
        .collect();
    
    // Price-time priority: sort by price ASC, then by created_at ASC
    eligible.sort_by(|a, b| {
        a.ask_price_usd.partial_cmp(&b.ask_price_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.created_at.cmp(&b.created_at))
    });
    
    let mut fills: Vec<MatchedFill> = Vec::new();
    let mut units_remaining = req.units_wanted;
    let mut total_clean = 0.0f64;
    let mut total_accrued = 0.0f64;
    
    for ask in &eligible {
        if units_remaining <= 0.0 {
            break;
        }
        
        let fill_units = units_remaining.min(ask.units);
        let maturity = NaiveDate::parse_from_str(&ask.maturity_date, "%Y-%m-%d")
            .unwrap_or(today + chrono::Duration::days(365));
        let years_to_maturity = (maturity - today).num_days() as f64 / 365.0;
        
        let accrued = calculate_accrued_interest(
            ask.face_value_usd,
            ask.coupon_rate_pct,
            &ask.issue_date,
            today,
            2, // semi-annual
        );
        
        let ytm = calculate_ytm(
            ask.face_value_usd,
            ask.coupon_rate_pct,
            ask.ask_price_usd,
            years_to_maturity,
            2,
        );
        
        let clean_subtotal = fill_units * ask.ask_price_usd;
        let accrued_subtotal = fill_units * accrued;
        let dirty_subtotal = clean_subtotal + accrued_subtotal;
        
        fills.push(MatchedFill {
            order_id: ask.order_id,
            seller_id: ask.seller_id,
            units: fill_units,
            price_per_unit: ask.ask_price_usd,
            subtotal_usd: (clean_subtotal * 100.0).round() / 100.0,
            accrued_interest_usd: (accrued_subtotal * 100.0).round() / 100.0,
            dirty_price_usd: (dirty_subtotal * 100.0).round() / 100.0,
            ytm_pct: ytm,
        });
        
        total_clean += clean_subtotal;
        total_accrued += accrued_subtotal;
        units_remaining -= fill_units;
    }
    
    let units_filled = req.units_wanted - units_remaining;
    let avg_ytm = if fills.is_empty() { 0.0 } else {
        fills.iter().map(|f| f.ytm_pct).sum::<f64>() / fills.len() as f64
    };
    
    MatchResponse {
        buyer_id: req.buyer_id,
        bond_id: req.bond_id,
        units_requested: req.units_wanted,
        units_filled: (units_filled * 100.0).round() / 100.0,
        units_unfilled: (units_remaining.max(0.0) * 100.0).round() / 100.0,
        fills,
        total_clean_price_usd: (total_clean * 100.0).round() / 100.0,
        total_accrued_interest_usd: (total_accrued * 100.0).round() / 100.0,
        total_dirty_price_usd: ((total_clean + total_accrued) * 100.0).round() / 100.0,
        avg_ytm_pct: (avg_ytm * 100.0).round() / 100.0,
        fully_filled: units_remaining <= 0.0,
        rejected_asks,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "service": "bond-market-matcher",
        "status": "healthy",
        "version": "1.0.0"
    }))
}

async fn match_handler(req: web::Json<MatchRequest>) -> HttpResponse {
    let result = match_orders(&req);
    HttpResponse::Ok().json(result)
}

async fn ytm_handler(req: web::Json<YTMRequest>) -> HttpResponse {
    let today = Utc::now().date_naive();
    let ytm = calculate_ytm(
        req.face_value_usd,
        req.coupon_rate_pct,
        req.market_price_usd,
        req.years_to_maturity,
        req.payments_per_year,
    );
    let (modified_dur, convexity) = calculate_duration(
        req.face_value_usd,
        req.coupon_rate_pct,
        ytm,
        req.years_to_maturity,
        req.payments_per_year,
    );
    let accrued = req.face_value_usd * req.coupon_rate_pct / 100.0 / req.payments_per_year as f64 * 0.5;
    let macaulay = modified_dur * (1.0 + ytm / 100.0 / req.payments_per_year as f64);
    
    HttpResponse::Ok().json(YTMResponse {
        ytm_pct: ytm,
        duration_years: (macaulay * 100.0).round() / 100.0,
        modified_duration: modified_dur,
        convexity,
        accrued_interest_usd: (accrued * 100.0).round() / 100.0,
        clean_price_usd: req.market_price_usd,
        dirty_price_usd: ((req.market_price_usd + accrued) * 100.0).round() / 100.0,
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("BOND_MATCHER_PORT").unwrap_or_else(|_| "8222".to_string());
    let addr = format!("0.0.0.0:{}", port);
    println!("[bond-market-matcher] Starting on {}", addr);

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/match", web::post().to(match_handler))
            .route("/ytm", web::post().to(ytm_handler))
    })
    .bind(&addr)?
    .run()
    .await
}
