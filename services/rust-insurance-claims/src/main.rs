/// rust-insurance-claims: Micro-insurance claims processing engine.
/// High-throughput policy management, premium calculation, and claims adjudication.
/// Port: 8135
use std::collections::HashMap;
use warp::Filter;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub id: String,
    pub user_id: String,
    pub product_id: String,
    pub product_name: String,
    pub coverage_amount: f64,
    pub premium: f64,
    pub currency: String,
    pub status: String,
    pub start_date: u64,
    pub end_date: u64,
    pub linked_transaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claim {
    pub id: String,
    pub policy_id: String,
    pub user_id: String,
    pub claim_type: String,
    pub amount: f64,
    pub description: String,
    pub evidence_urls: Vec<String>,
    pub status: String,
    pub submitted_at: u64,
    pub resolved_at: Option<u64>,
    pub payout_amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PremiumQuote {
    pub product_id: String,
    pub coverage_amount: f64,
    pub premium: f64,
    pub duration_days: u32,
    pub premium_rate_bps: f64,
}

struct InsuranceProduct {
    id: &'static str,
    name: &'static str,
    premium_rate: f64,
    min_premium: f64,
    max_coverage: f64,
}

const PRODUCTS: &[InsuranceProduct] = &[
    InsuranceProduct { id: "transfer_protection", name: "Transfer Protection", premium_rate: 0.0005, min_premium: 100.0, max_coverage: 5_000_000.0 },
    InsuranceProduct { id: "diaspora_health", name: "Diaspora Health Cover", premium_rate: 0.002, min_premium: 500.0, max_coverage: 2_000_000.0 },
    InsuranceProduct { id: "device_insurance", name: "Device Protection", premium_rate: 0.01, min_premium: 200.0, max_coverage: 500_000.0 },
    InsuranceProduct { id: "crop_weather", name: "Crop & Weather Insurance", premium_rate: 0.015, min_premium: 300.0, max_coverage: 1_000_000.0 },
];

type PolicyStore = Arc<Mutex<HashMap<String, Policy>>>;
type ClaimStore = Arc<Mutex<HashMap<String, Claim>>>;

fn compute_premium(product: &InsuranceProduct, coverage: f64, days: u32) -> f64 {
    let raw = coverage * product.premium_rate * (days as f64 / 30.0);
    if raw < product.min_premium { product.min_premium } else { raw }
}


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
        "CREATE TABLE IF NOT EXISTS insurance_claims_state (
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
        "CREATE INDEX IF NOT EXISTS idx_insurance_claims_updated ON insurance_claims_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS insurance_claims_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-insurance-claims");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO insurance_claims_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM insurance_claims_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM insurance_claims_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO insurance_claims_events (event_type, payload) VALUES ($1, $2)"
    )
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Panic hook for logging panics without crashing silently
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    let _pool = init_db().await;
    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "8135".into()).parse().unwrap_or(8135);
    let policies: PolicyStore = Arc::new(Mutex::new(HashMap::new()));
    let claims: ClaimStore = Arc::new(Mutex::new(HashMap::new()));

    let policies_create = policies.clone();
    let policies_list = policies.clone();
    let claims_file = claims.clone();
    let claims_list = claims.clone();

    let health = warp::path("health").map(|| {
        warp::reply::json(&serde_json::json!({"status": "ok", "service": "rust-insurance-claims"}))
    });

    let products = warp::path("products").and(warp::get()).map(|| {
        let list: Vec<serde_json::Value> = PRODUCTS.iter().map(|p| {
            serde_json::json!({
                "id": p.id, "name": p.name,
                "premiumRateBps": p.premium_rate * 10000.0,
                "minPremium": p.min_premium,
                "maxCoverage": p.max_coverage,
            })
        }).collect();
        warp::reply::json(&list)
    });

    let quote = warp::path("quote").and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<HashMap<String, String>>())
        .map(|params: HashMap<String, String>| {
            let product_id = params.get("productId").cloned().unwrap_or_default();
            let coverage: f64 = params.get("coverage").and_then(|c| c.parse().ok()).unwrap_or(100000.0);
            let days: u32 = params.get("days").and_then(|d| d.parse().ok()).unwrap_or(30);
            let product = PRODUCTS.iter().find(|p| p.id == product_id);
            match product {
                Some(p) => {
                    let premium = compute_premium(p, coverage, days);
                    warp::reply::json(&PremiumQuote { product_id: p.id.into(), coverage_amount: coverage, premium, duration_days: days, premium_rate_bps: p.premium_rate * 10000.0 })
                }
                None => warp::reply::json(&serde_json::json!({"error": "product not found"})),
            }
        });

    let purchase = warp::path("policy").and(warp::path("purchase")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(move |mut policy: Policy| {
            policy.id = format!("POL-{}", now_ms());
            policy.status = "active".into();
            policy.start_date = now_ms();
            policy.end_date = now_ms() + 30 * 86400 * 1000;
            policies_create.lock().unwrap().insert(policy.id.clone(), policy.clone());
            warp::reply::json(&policy)
        });

    let my_policies = warp::path!("policy" / "list" / String)
        .and(warp::get())
        .map(move |user_id: String| {
            let store = policies_list.lock().unwrap();
            let user_policies: Vec<&Policy> = store.values().filter(|p| p.user_id == user_id).collect();
            warp::reply::json(&user_policies)
        });

    let file_claim = warp::path("claim").and(warp::path("file")).and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .map(move |mut claim: Claim| {
            claim.id = format!("CLM-{}", now_ms());
            claim.status = "submitted".into();
            claim.submitted_at = now_ms();
            claims_file.lock().unwrap().insert(claim.id.clone(), claim.clone());
            warp::reply::json(&claim)
        });

    let list_claims = warp::path!("claim" / "list" / String)
        .and(warp::get())
        .map(move |user_id: String| {
            let store = claims_list.lock().unwrap();
            let user_claims: Vec<&Claim> = store.values().filter(|c| c.user_id == user_id).collect();
            warp::reply::json(&user_claims)
        });

    let routes = health.or(products).or(quote).or(purchase).or(my_policies).or(file_claim).or(list_claims);
    eprintln!("rust-insurance-claims starting on port {}", port);
    let (addr, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            tokio::signal::ctrl_c().await.ok();
            eprintln!("[rust-insurance-claims] Graceful shutdown initiated");
        },
    );
    eprintln!("[rust-insurance-claims] Listening on {}", addr);
    server.await;
    Ok(())
}
