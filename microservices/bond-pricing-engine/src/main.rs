// RemitFlow Bond Pricing Engine — Rust microservice
// Handles: YTM calculation, Macaulay/modified duration, accrued interest,
//          secondary market fair value, coupon schedule generation
// Port: 8201

use actix_web::{web, App, HttpResponse, HttpServer};
use chrono::{DateTime, Utc, Datelike};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BondInput {
    pub bond_id: i64,
    pub face_value: f64,
    pub coupon_rate: f64,
    pub coupon_frequency: String,
    pub issue_date: String,
    pub maturity_date: String,
    pub market_price: Option<f64>,
    pub units: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CouponPayment {
    pub coupon_number: i32,
    pub period_start: String,
    pub period_end: String,
    pub scheduled_date: String,
    pub gross_amount: f64,
    pub withholding_tax: f64,
    pub net_amount: f64,
}

#[derive(Debug, Serialize)]
pub struct BondPricingResult {
    pub bond_id: i64,
    pub face_value: f64,
    pub coupon_rate: f64,
    pub periods_per_year: i32,
    pub total_periods: i32,
    pub remaining_periods: i32,
    pub yield_to_maturity: f64,
    pub macaulay_duration: f64,
    pub modified_duration: f64,
    pub convexity: f64,
    pub accrued_interest: f64,
    pub clean_price: f64,
    pub dirty_price: f64,
    pub fair_value_usd: f64,
    pub coupon_schedule: Vec<CouponPayment>,
    pub computed_at: String,
    pub engine_version: String,
}

#[derive(Debug, Deserialize)]
pub struct SecondaryMarketRequest {
    pub bond: BondInput,
    pub ask_price: f64,
    pub units: i64,
    pub withholding_tax_rate: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SecondaryMarketResult {
    pub bond_id: i64,
    pub units: i64,
    pub ask_price: f64,
    pub fair_value: f64,
    pub premium_discount_pct: f64,
    pub ytm_at_ask: f64,
    pub accrued_interest: f64,
    pub total_consideration: f64,
    pub recommendation: String,
    pub computed_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PortfolioRequest {
    pub holdings: Vec<HoldingInput>,
}

#[derive(Debug, Deserialize)]
pub struct HoldingInput {
    pub subscription_id: i64,
    pub bond: BondInput,
    pub units: i64,
    pub purchase_price: f64,
    pub total_paid: f64,
}

#[derive(Debug, Serialize)]
pub struct PortfolioResult {
    pub total_face_value: f64,
    pub total_current_value: f64,
    pub total_accrued_interest: f64,
    pub total_unrealised_pnl: f64,
    pub portfolio_yield: f64,
    pub weighted_duration: f64,
    pub holdings: Vec<HoldingValuation>,
    pub computed_at: String,
}

#[derive(Debug, Serialize)]
pub struct HoldingValuation {
    pub subscription_id: i64,
    pub bond_id: i64,
    pub units: i64,
    pub face_value_total: f64,
    pub current_value: f64,
    pub accrued_interest: f64,
    pub unrealised_pnl: f64,
    pub ytm: f64,
    pub duration: f64,
}

fn periods_per_year(freq: &str) -> i32 {
    match freq { "monthly" => 12, "quarterly" => 4, "semi_annual" => 2, _ => 1 }
}

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn calc_ytm(face: f64, coupon_pp: f64, n: i32, price: f64) -> f64 {
    if n <= 0 || price <= 0.0 { return 0.0; }
    let mut ytm = coupon_pp / price;
    for _ in 0..200 {
        let mut pv = 0.0;
        let mut dpv = 0.0;
        for t in 1..=n {
            let disc = (1.0 + ytm).powi(t);
            pv += coupon_pp / disc;
            dpv -= (t as f64) * coupon_pp / (disc * (1.0 + ytm));
        }
        pv += face / (1.0 + ytm).powi(n);
        dpv -= (n as f64) * face / ((1.0 + ytm).powi(n) * (1.0 + ytm));
        let f = pv - price;
        if f.abs() < 1e-10 { break; }
        let step = f / dpv;
        ytm -= step;
        if ytm < 1e-6 { ytm = 1e-6; }
    }
    ytm
}

fn calc_macaulay(face: f64, coupon_pp: f64, n: i32, ytm_pp: f64) -> f64 {
    if n <= 0 { return 0.0; }
    let mut num = 0.0;
    let mut den = 0.0;
    for t in 1..=n {
        let pv = coupon_pp / (1.0 + ytm_pp).powi(t);
        num += t as f64 * pv;
        den += pv;
    }
    let pv_face = face / (1.0 + ytm_pp).powi(n);
    num += n as f64 * pv_face;
    den += pv_face;
    if den == 0.0 { 0.0 } else { num / den }
}

fn calc_convexity(face: f64, coupon_pp: f64, n: i32, ytm_pp: f64, price: f64) -> f64 {
    if n <= 0 || price == 0.0 { return 0.0; }
    let mut conv = 0.0;
    for t in 1..=n {
        let cf = if t == n { coupon_pp + face } else { coupon_pp };
        conv += cf * (t as f64) * (t as f64 + 1.0) / (1.0 + ytm_pp).powi(t + 2);
    }
    conv / price
}

fn accrued_per_unit(coupon_rate: f64, freq: i32, last_coupon: DateTime<Utc>, now: DateTime<Utc>) -> f64 {
    let period_days = 365.0 / freq as f64;
    let days = (now - last_coupon).num_days() as f64;
    let frac = (days / period_days).min(1.0).max(0.0);
    (coupon_rate / freq as f64) * frac
}

fn gen_schedule(face: f64, rate: f64, freq: i32, issue: DateTime<Utc>, maturity: DateTime<Utc>, wht: f64) -> Vec<CouponPayment> {
    let mut sched = Vec::new();
    let months_pp = 12 / freq;
    let cpp = face * rate / freq as f64;
    let mut cur = issue;
    let mut num = 1i32;
    loop {
        if cur >= maturity { break; }
        let start = cur;
        let mut nm = cur.month() as i32 + months_pp;
        let mut ny = cur.year();
        while nm > 12 { nm -= 12; ny += 1; }
        let next = cur.with_month(nm as u32).and_then(|d| d.with_year(ny)).unwrap_or(maturity);
        let end = next.min(maturity);
        let gross = cpp;
        let tax = gross * wht;
        sched.push(CouponPayment {
            coupon_number: num,
            period_start: start.to_rfc3339(),
            period_end: end.to_rfc3339(),
            scheduled_date: end.to_rfc3339(),
            gross_amount: r2(gross),
            withholding_tax: r2(tax),
            net_amount: r2(gross - tax),
        });
        cur = next;
        num += 1;
    }
    sched
}

fn r2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }
fn r4(v: f64) -> f64 { (v * 10000.0).round() / 10000.0 }

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status":"ok","service":"bond-pricing-engine","version":"1.0.0"}))
}

async fn price_bond(body: web::Json<BondInput>) -> HttpResponse {
    let b = body.into_inner();
    let freq = periods_per_year(&b.coupon_frequency);
    let now = Utc::now();
    let issue = parse_dt(&b.issue_date);
    let maturity = parse_dt(&b.maturity_date);
    let total_months = (maturity.year() - issue.year()) * 12 + maturity.month() as i32 - issue.month() as i32;
    let total_periods = ((total_months * freq / 12).max(1)) as i32;
    let rem_months = (maturity.year() - now.year()) * 12 + maturity.month() as i32 - now.month() as i32;
    let rem_periods = ((rem_months * freq / 12).max(0).min(total_months)) as i32;
    let cpp = b.face_value * b.coupon_rate / freq as f64;
    let price = b.market_price.unwrap_or(b.face_value);
    let ytm_pp = calc_ytm(b.face_value, cpp, rem_periods, price);
    let ytm_a = ytm_pp * freq as f64;
    let mac_pp = calc_macaulay(b.face_value, cpp, rem_periods, ytm_pp);
    let mac_yr = mac_pp / freq as f64;
    let mod_dur = if (1.0 + ytm_pp) > 0.0 { mac_yr / (1.0 + ytm_pp) } else { 0.0 };
    let conv = calc_convexity(b.face_value, cpp, rem_periods, ytm_pp, price);
    let accrued = accrued_per_unit(b.coupon_rate, freq, issue, now) * b.units.unwrap_or(1) as f64;
    let dirty = price + accrued / b.units.unwrap_or(1) as f64;
    let fair = dirty * b.units.unwrap_or(1) as f64;
    let sched = gen_schedule(b.face_value, b.coupon_rate, freq, issue, maturity, 0.10);
    HttpResponse::Ok().json(BondPricingResult {
        bond_id: b.bond_id, face_value: b.face_value, coupon_rate: b.coupon_rate,
        periods_per_year: freq, total_periods, remaining_periods: rem_periods,
        yield_to_maturity: r4(ytm_a), macaulay_duration: r4(mac_yr), modified_duration: r4(mod_dur),
        convexity: r4(conv), accrued_interest: r2(accrued), clean_price: r2(price),
        dirty_price: r2(dirty), fair_value_usd: r2(fair), coupon_schedule: sched,
        computed_at: now.to_rfc3339(), engine_version: "1.0.0".to_string(),
    })
}

async fn secondary_market(body: web::Json<SecondaryMarketRequest>) -> HttpResponse {
    let req = body.into_inner();
    let freq = periods_per_year(&req.bond.coupon_frequency);
    let now = Utc::now();
    let issue = parse_dt(&req.bond.issue_date);
    let maturity = parse_dt(&req.bond.maturity_date);
    let rem_months = (maturity.year() - now.year()) * 12 + maturity.month() as i32 - now.month() as i32;
    let rem_periods = ((rem_months * freq / 12).max(0)) as i32;
    let cpp = req.bond.face_value * req.bond.coupon_rate / freq as f64;
    let par_yield = req.bond.coupon_rate / freq as f64;
    let mut fair = 0.0f64;
    for t in 1..=rem_periods { fair += cpp / (1.0 + par_yield).powi(t); }
    fair += req.bond.face_value / (1.0 + par_yield).powi(rem_periods);
    let accrued = accrued_per_unit(req.bond.coupon_rate, freq, issue, now) * req.units as f64;
    let total = req.ask_price * req.units as f64 + accrued;
    let pd = if fair > 0.0 { (req.ask_price - fair) / fair * 100.0 } else { 0.0 };
    let ytm = calc_ytm(req.bond.face_value, cpp, rem_periods, req.ask_price) * freq as f64;
    let rec = if pd.abs() < 1.0 { "fair" } else if pd > 1.0 { "premium" } else { "discount" };
    HttpResponse::Ok().json(SecondaryMarketResult {
        bond_id: req.bond.bond_id, units: req.units, ask_price: req.ask_price,
        fair_value: r2(fair), premium_discount_pct: r2(pd), ytm_at_ask: r4(ytm),
        accrued_interest: r2(accrued), total_consideration: r2(total),
        recommendation: rec.to_string(), computed_at: now.to_rfc3339(),
    })
}

async fn portfolio(body: web::Json<PortfolioRequest>) -> HttpResponse {
    let req = body.into_inner();
    let now = Utc::now();
    let mut hvs = Vec::new();
    let (mut tf, mut tc, mut ta, mut tp, mut wd, mut wy) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for h in &req.holdings {
        let freq = periods_per_year(&h.bond.coupon_frequency);
        let issue = parse_dt(&h.bond.issue_date);
        let maturity = parse_dt(&h.bond.maturity_date);
        let rm = (maturity.year() - now.year()) * 12 + maturity.month() as i32 - now.month() as i32;
        let rp = ((rm * freq / 12).max(0)) as i32;
        let cpp = h.bond.face_value * h.bond.coupon_rate / freq as f64;
        let mp = h.bond.market_price.unwrap_or(h.bond.face_value);
        let ytm_pp = calc_ytm(h.bond.face_value, cpp, rp, mp);
        let ytm_a = ytm_pp * freq as f64;
        let mac = calc_macaulay(h.bond.face_value, cpp, rp, ytm_pp) / freq as f64;
        let acc = accrued_per_unit(h.bond.coupon_rate, freq, issue, now) * h.units as f64;
        let cv = (mp + acc / h.units as f64) * h.units as f64;
        let ft = h.bond.face_value * h.units as f64;
        let pnl = cv - h.total_paid;
        tf += ft; tc += cv; ta += acc; tp += pnl;
        wd += mac * cv; wy += ytm_a * cv;
        hvs.push(HoldingValuation {
            subscription_id: h.subscription_id, bond_id: h.bond.bond_id, units: h.units,
            face_value_total: r2(ft), current_value: r2(cv), accrued_interest: r2(acc),
            unrealised_pnl: r2(pnl), ytm: r4(ytm_a), duration: r4(mac),
        });
    }
    let py = if tc > 0.0 { wy / tc } else { 0.0 };
    let pd = if tc > 0.0 { wd / tc } else { 0.0 };
    HttpResponse::Ok().json(PortfolioResult {
        total_face_value: r2(tf), total_current_value: r2(tc), total_accrued_interest: r2(ta),
        total_unrealised_pnl: r2(tp), portfolio_yield: r4(py), weighted_duration: r4(pd),
        holdings: hvs, computed_at: now.to_rfc3339(),
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("BOND_ENGINE_PORT").unwrap_or_else(|_| "8201".to_string());
    println!("[bond-pricing-engine] Listening on :{}", port);
    HttpServer::new(|| {
        App::new()
            .route("/health",           web::get().to(health))
            .route("/price",            web::post().to(price_bond))
            .route("/secondary-market", web::post().to(secondary_market))
            .route("/portfolio",        web::post().to(portfolio))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
