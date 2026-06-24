use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Corridor-specific fee configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CorridorFee {
    from_currency: String,
    to_currency: String,
    /// Fixed fee in source currency
    fixed_fee: f64,
    /// Percentage fee (0.0 - 100.0)
    percentage_fee: f64,
    /// Minimum fee in source currency
    min_fee: f64,
    /// Maximum fee in source currency (0 = no max)
    max_fee: f64,
    /// FX markup percentage
    fx_markup: f64,
}

/// Rail-specific fee overlay
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RailFee {
    rail: String,
    /// Additional fixed fee for this rail
    surcharge: f64,
    /// Additional percentage for this rail
    percentage_addon: f64,
}

/// User tier discount
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TierDiscount {
    tier: String,
    /// Percentage discount on total fees (0-100)
    discount_pct: f64,
}

/// Fee calculation request
#[derive(Debug, Deserialize)]
struct FeeRequest {
    from_currency: String,
    to_currency: String,
    amount: f64,
    rail: Option<String>,
    user_tier: Option<String>,
    promo_code: Option<String>,
    promo_discount_amount: Option<f64>,
}

/// Fee calculation response with full breakdown
#[derive(Debug, Serialize)]
struct FeeResponse {
    corridor_fee: f64,
    rail_fee: f64,
    fx_markup: f64,
    tier_discount: f64,
    promo_discount: f64,
    total_fee: f64,
    effective_rate: f64,
    breakdown: Vec<FeeLineItem>,
}

#[derive(Debug, Serialize)]
struct FeeLineItem {
    label: String,
    amount: f64,
    #[serde(rename = "type")]
    item_type: String,
}

/// Application state holding fee configurations
struct AppState {
    corridor_fees: HashMap<String, CorridorFee>,
    rail_fees: HashMap<String, RailFee>,
    tier_discounts: HashMap<String, TierDiscount>,
    pub db_pool: Option<PgPool>,
}

impl AppState {
    fn new() -> Self {
        let mut corridor_fees = HashMap::new();
        let mut rail_fees = HashMap::new();
        let mut tier_discounts = HashMap::new();

        // Define corridor fees (source → target)
        let corridors = vec![
            ("GBP", "NGN", 0.99, 0.5, 0.50, 50.0, 0.3),
            ("USD", "NGN", 0.99, 0.6, 0.50, 50.0, 0.35),
            ("EUR", "NGN", 1.29, 0.55, 0.50, 50.0, 0.32),
            ("GBP", "KES", 0.99, 0.5, 0.50, 50.0, 0.25),
            ("USD", "KES", 0.99, 0.6, 0.50, 50.0, 0.28),
            ("GBP", "GHS", 1.49, 0.6, 0.50, 50.0, 0.35),
            ("USD", "GHS", 1.49, 0.65, 0.50, 50.0, 0.38),
            ("GBP", "ZAR", 0.99, 0.45, 0.50, 50.0, 0.22),
            ("USD", "INR", 0.99, 0.5, 0.50, 50.0, 0.20),
            ("EUR", "MAD", 1.29, 0.5, 0.50, 50.0, 0.30),
            ("GBP", "EGP", 1.49, 0.6, 0.50, 50.0, 0.40),
            ("USD", "ETB", 1.99, 0.7, 0.50, 50.0, 0.45),
        ];

        for (from, to, fixed, pct, min, max, markup) in corridors {
            let key = format!("{}_{}", from, to);
            corridor_fees.insert(key, CorridorFee {
                from_currency: from.to_string(),
                to_currency: to.to_string(),
                fixed_fee: fixed,
                percentage_fee: pct,
                min_fee: min,
                max_fee: max,
                fx_markup: markup,
            });
        }

        // Rail-specific fees
        let rails = vec![
            ("stripe", 0.30, 0.0),
            ("paypal", 0.0, 0.5),
            ("flutterwave", 0.0, 0.3),
            ("mpesa", 0.0, 0.0),
            ("wise", 0.0, 0.1),
            ("mojaloop", 0.0, 0.0),
            ("bank_transfer", 0.0, 0.0),
            ("mobile_money", 0.0, 0.1),
        ];

        for (rail, surcharge, pct) in rails {
            rail_fees.insert(rail.to_string(), RailFee {
                rail: rail.to_string(),
                surcharge,
                percentage_addon: pct,
            });
        }

        // Tier discounts
        let tiers = vec![
            ("free", 0.0),
            ("basic", 10.0),
            ("premium", 25.0),
            ("business", 35.0),
            ("enterprise", 50.0),
        ];

        for (tier, discount) in tiers {
            tier_discounts.insert(tier.to_string(), TierDiscount {
                tier: tier.to_string(),
                discount_pct: discount,
            });
        }

        Self { corridor_fees, rail_fees, tier_discounts }
    }
}

/// POST /calculate - Calculate fees for a transfer
async fn calculate_fee(
    data: web::Data<AppState>,
    req: web::Json<FeeRequest>,
) -> HttpResponse {
    let corridor_key = format!("{}_{}", req.from_currency, req.to_currency);

    let corridor = match data.corridor_fees.get(&corridor_key) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("Unsupported corridor: {} → {}", req.from_currency, req.to_currency),
                "supportedCorridors": data.corridor_fees.keys().collect::<Vec<_>>()
            }));
        }
    };

    let mut breakdown = Vec::new();

    // 1. Corridor base fee (fixed + percentage)
    let pct_fee = req.amount * corridor.percentage_fee / 100.0;
    let mut corridor_fee = corridor.fixed_fee + pct_fee;
    corridor_fee = corridor_fee.max(corridor.min_fee);
    if corridor.max_fee > 0.0 {
        corridor_fee = corridor_fee.min(corridor.max_fee);
    }

    breakdown.push(FeeLineItem {
        label: format!("Transfer fee ({} → {})", req.from_currency, req.to_currency),
        amount: (corridor_fee * 100.0).round() / 100.0,
        item_type: "fee".to_string(),
    });

    // 2. FX markup
    let fx_markup = req.amount * corridor.fx_markup / 100.0;
    breakdown.push(FeeLineItem {
        label: "Exchange rate markup".to_string(),
        amount: (fx_markup * 100.0).round() / 100.0,
        item_type: "markup".to_string(),
    });

    // 3. Rail-specific fee
    let mut rail_fee = 0.0;
    if let Some(rail_name) = &req.rail {
        if let Some(rail) = data.rail_fees.get(rail_name) {
            rail_fee = rail.surcharge + (req.amount * rail.percentage_addon / 100.0);
            if rail_fee > 0.0 {
                breakdown.push(FeeLineItem {
                    label: format!("{} processing fee", rail_name),
                    amount: (rail_fee * 100.0).round() / 100.0,
                    item_type: "rail".to_string(),
                });
            }
        }
    }

    // 4. Tier discount
    let mut tier_discount = 0.0;
    if let Some(tier_name) = &req.user_tier {
        if let Some(tier) = data.tier_discounts.get(tier_name) {
            if tier.discount_pct > 0.0 {
                tier_discount = (corridor_fee + rail_fee) * tier.discount_pct / 100.0;
                breakdown.push(FeeLineItem {
                    label: format!("{} tier discount ({}%)", tier_name, tier.discount_pct),
                    amount: -(tier_discount * 100.0).round() / 100.0,
                    item_type: "discount".to_string(),
                });
            }
        }
    }

    // 5. Promo discount (validated against promo DB via PROMO_VALIDATION_URL)
    let promo_discount = if let Some(ref promo) = req.promo_code {
        if !promo.is_empty() {
            // Promo validation is handled at the application layer (tRPC promoRedemptions router)
            // The discount amount is passed through from the validated promo
            req.promo_discount_amount.unwrap_or(0.0)
        } else { 0.0 }
    } else { 0.0 };

    let total_fee = ((corridor_fee + rail_fee + fx_markup - tier_discount - promo_discount) * 100.0).round() / 100.0;
    let effective_rate = if req.amount > 0.0 { total_fee / req.amount * 100.0 } else { 0.0 };

    HttpResponse::Ok().json(FeeResponse {
        corridor_fee: (corridor_fee * 100.0).round() / 100.0,
        rail_fee: (rail_fee * 100.0).round() / 100.0,
        fx_markup: (fx_markup * 100.0).round() / 100.0,
        tier_discount: (tier_discount * 100.0).round() / 100.0,
        promo_discount,
        total_fee,
        effective_rate: (effective_rate * 100.0).round() / 100.0,
        breakdown,
    })
}

/// GET /corridors - List all supported corridors
async fn list_corridors(data: web::Data<AppState>) -> HttpResponse {
    let corridors: Vec<&CorridorFee> = data.corridor_fees.values().collect();
    HttpResponse::Ok().json(serde_json::json!({ "corridors": corridors }))
}

/// GET /rails - List all supported payment rails
async fn list_rails(data: web::Data<AppState>) -> HttpResponse {
    let rails: Vec<&RailFee> = data.rail_fees.values().collect();
    HttpResponse::Ok().json(serde_json::json!({ "rails": rails }))
}

/// GET /tiers - List all user tiers and discounts
async fn list_tiers(data: web::Data<AppState>) -> HttpResponse {
    let tiers: Vec<&TierDiscount> = data.tier_discounts.values().collect();
    HttpResponse::Ok().json(serde_json::json!({ "tiers": tiers }))
}

/// GET /health
async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "healthy", "service": "fee-engine" }))
}


use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Instant;
static _PROCESS_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fee_engine_state (
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
        "CREATE INDEX IF NOT EXISTS idx_fee_engine_updated ON fee_engine_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fee_engine_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-fee-engine");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fee_engine_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM fee_engine_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM fee_engine_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO fee_engine_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[actix_web::main]
async fn load_from_db(pool: &PgPool) {
    match sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT id, data FROM fee_engine_state ORDER BY updated_at DESC LIMIT 1000"
    )
    .fetch_all(pool)
    .await {
        Ok(rows) => {
            tracing::info!("loaded {} persisted records from fee_engine_state", rows.len());
        }
        Err(e) => {
            tracing::warn!("failed to load from DB: {}", e);
        }
    }
}

async fn main() -> std::io::Result<()> {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let pool = init_db().await;
    load_from_db(&pool).await;
    tracing_subscriber::fmt().json().init();

    let port: u16 = std::env::var("FEE_ENGINE_PORT")
        .unwrap_or_else(|_| "8101".to_string())
        .parse()
        .unwrap_or(8101);

    let state = web::Data::new(AppState::new(Some(pool.clone())));

    tracing::info!(port = port, "Fee engine starting");

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/calculate", web::post().to(calculate_fee))
            .route("/corridors", web::get().to(list_corridors))
            .route("/rails", web::get().to(list_rails))
            .route("/tiers", web::get().to(list_tiers))
            .route("/health", web::get().to(health))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
