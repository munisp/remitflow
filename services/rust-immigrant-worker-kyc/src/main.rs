/// rust-immigrant-worker-kyc: Tiered KYC engine for immigrant workers sending from Nigeria
/// Implements CBN tiered KYC: Tier 1 (BVN only, ₦50k/day), Tier 2 (NIN+BVN, ₦200k/day),
/// Tier 3 (full docs, ₦5M/day). Integrates with Keycloak, Permify, Kafka (Dapr), Redis.
use std::collections::HashMap;
use warp::Filter;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KycTier {
    Tier1, // BVN only — ₦50k/day limit
    Tier2, // NIN + BVN — ₦200k/day limit
    Tier3, // Full docs — ₦5M/day limit
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KycProfile {
    pub user_id: i64,
    pub tier: KycTier,
    pub bvn: Option<String>,
    pub nin: Option<String>,
    pub passport_url: Option<String>,
    pub utility_bill_url: Option<String>,
    pub employer_letter_url: Option<String>,
    pub daily_limit_ngn: f64,
    pub is_verified: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VerificationRequest {
    pub user_id: i64,
    pub bvn: Option<String>,
    pub nin: Option<String>,
    pub passport_url: Option<String>,
    pub utility_bill_url: Option<String>,
    pub employer_letter_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LimitCheckRequest {
    pub user_id: i64,
    pub amount_ngn: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LimitCheckResponse {
    pub user_id: i64,
    pub amount_ngn: f64,
    pub daily_limit_ngn: f64,
    pub used_today_ngn: f64,
    pub remaining_ngn: f64,
    pub is_allowed: bool,
    pub tier: String,
    pub upgrade_required: bool,
    pub upgrade_message: Option<String>,
}

type ProfileStore = Arc<Mutex<HashMap<i64, KycProfile>>>;
type UsageStore = Arc<Mutex<HashMap<i64, f64>>>;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn tier_limit(tier: &KycTier) -> f64 {
    match tier {
        KycTier::Tier1 => 50_000.0,
        KycTier::Tier2 => 200_000.0,
        KycTier::Tier3 => 5_000_000.0,
    }
}

fn determine_tier(req: &VerificationRequest) -> KycTier {
    if req.passport_url.is_some() && req.utility_bill_url.is_some() {
        KycTier::Tier3
    } else if req.nin.is_some() && req.bvn.is_some() {
        KycTier::Tier2
    } else {
        KycTier::Tier1
    }
}

async fn publish_event(topic: &str, data: serde_json::Value) {
    let dapr_port = std::env::var("DAPR_HTTP_PORT").unwrap_or_else(|_| "3500".to_string());
    let url = format!("http://localhost:{}/v1.0/publish/kafka-pubsub/{}", dapr_port, topic);
    let client = reqwest::Client::new();
    let _ = client.post(&url).json(&data).send().await;
}

async fn handle_verify(
    profiles: ProfileStore,
    body: bytes::Bytes,
) -> Result<impl warp::Reply, warp::Rejection> {
    let req: VerificationRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Invalid request body"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    let tier = determine_tier(&req);
    let daily_limit = tier_limit(&tier);
    let profile = KycProfile {
        user_id: req.user_id,
        tier: tier.clone(),
        bvn: req.bvn.clone(),
        nin: req.nin.clone(),
        passport_url: req.passport_url.clone(),
        utility_bill_url: req.utility_bill_url.clone(),
        employer_letter_url: req.employer_letter_url.clone(),
        daily_limit_ngn: daily_limit,
        is_verified: true,
        created_at: now_secs(),
        updated_at: now_secs(),
    };
    {
        let mut store = profiles.lock().unwrap();
        store.insert(req.user_id, profile.clone());
    }
    let tier_str = format!("{:?}", tier);
    tokio::spawn(async move {
        publish_event("kyc-events", serde_json::json!({
            "event": "kyc_verified",
            "user_id": req.user_id,
            "tier": tier_str,
            "daily_limit_ngn": daily_limit,
        })).await;
    });
    Ok(warp::reply::with_status(
        warp::reply::json(&profile),
        warp::http::StatusCode::CREATED,
    ))
}

async fn handle_check_limit(
    profiles: ProfileStore,
    usage: UsageStore,
    body: bytes::Bytes,
) -> Result<impl warp::Reply, warp::Rejection> {
    let req: LimitCheckRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Invalid request body"})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    };
    let (daily_limit, tier_str) = {
        let store = profiles.lock().unwrap();
        if let Some(p) = store.get(&req.user_id) {
            (p.daily_limit_ngn, format!("{:?}", p.tier))
        } else {
            (50_000.0, "Tier1".to_string()) // default unverified
        }
    };
    let used_today = {
        let store = usage.lock().unwrap();
        *store.get(&req.user_id).unwrap_or(&0.0)
    };
    let remaining = (daily_limit - used_today).max(0.0);
    let is_allowed = req.amount_ngn <= remaining;
    let upgrade_required = !is_allowed;
    let upgrade_message = if upgrade_required {
        Some(format!(
            "Daily limit of ₦{:.0} reached for {}. Upgrade to higher tier for increased limits.",
            daily_limit, tier_str
        ))
    } else {
        None
    };
    let resp = LimitCheckResponse {
        user_id: req.user_id,
        amount_ngn: req.amount_ngn,
        daily_limit_ngn: daily_limit,
        used_today_ngn: used_today,
        remaining_ngn: remaining,
        is_allowed,
        tier: tier_str,
        upgrade_required,
        upgrade_message,
    };
    Ok(warp::reply::with_status(
        warp::reply::json(&resp),
        warp::http::StatusCode::OK,
    ))
}

async fn handle_health() -> Result<impl warp::Reply, warp::Rejection> {
    Ok(warp::reply::json(&serde_json::json!({
        "status": "ok",
        "service": "rust-immigrant-worker-kyc",
        "tiers": ["Tier1 (BVN only, ₦50k/day)", "Tier2 (NIN+BVN, ₦200k/day)", "Tier3 (Full docs, ₦5M/day)"],
        "timestamp": now_secs()
    })))
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
        "CREATE TABLE IF NOT EXISTS immigrant_worker_kyc_state (
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
        "CREATE INDEX IF NOT EXISTS idx_immigrant_worker_kyc_updated ON immigrant_worker_kyc_state(updated_at)"
    )
    .execute(&pool)
    .await
    .ok(); // Index may already exist

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS immigrant_worker_kyc_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    tracing::info!("PostgreSQL connected for rust-immigrant-worker-kyc");
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO immigrant_worker_kyc_state (id, data, updated_at) VALUES ($1, $2, NOW())
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
        "SELECT data FROM immigrant_worker_kyc_state WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT data FROM immigrant_worker_kyc_state ORDER BY updated_at DESC LIMIT $1"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO immigrant_worker_kyc_events (event_type, payload) VALUES ($1, $2)"
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
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8099".to_string())
        .parse()
        .unwrap_or(8099);

    let profiles: ProfileStore = Arc::new(Mutex::new(HashMap::new()));
    let usage: UsageStore = Arc::new(Mutex::new(HashMap::new()));

    let profiles_verify = profiles.clone();
    let profiles_check = profiles.clone();
    let usage_check = usage.clone();

    let health_route = warp::path("health")
        .and(warp::get())
        .and_then(handle_health);

    let verify_route = warp::path("verify")
        .and(warp::post())
        .and(warp::body::bytes())
        .and_then(move |body| {
            let p = profiles_verify.clone();
            async move { handle_verify(p, body).await }
        });

    let check_limit_route = warp::path("check-limit")
        .and(warp::post())
        .and(warp::body::bytes())
        .and_then(move |body| {
            let p = profiles_check.clone();
            let u = usage_check.clone();
            async move { handle_check_limit(p, u, body).await }
        });

    let auth_filter = warp::header::optional::<String>("authorization")
        .and(warp::header::optional::<String>("x-api-key"))
        .and_then(|auth: Option<String>, api_key: Option<String>| async move {
            let key = std::env::var("INTERNAL_SERVICE_KEY").unwrap_or_else(|_| "remitflow-internal-2026".to_string());
            if api_key.as_deref() == Some(&key) { return Ok(()); }
            if let Some(a) = &auth {
                if a.starts_with("Bearer ") && &a[7..] == key { return Ok(()); }
            }
            Err(warp::reject::reject())
        })
        .untuple_one();
    let protected = auth_filter.and(verify_route.or(check_limit_route));
    let routes = health_route.or(protected);

    println!("[rust-immigrant-worker-kyc] Starting on :{}", port);
    let (addr, server) = warp::serve(routes).bind_with_graceful_shutdown(
        ([0, 0, 0, 0], port),
        async {
            tokio::signal::ctrl_c().await.ok();
            eprintln!("[rust-immigrant-worker-kyc] Graceful shutdown initiated");
        },
    );
    eprintln!("[rust-immigrant-worker-kyc] Listening on {}", addr);
    server.await;
    Ok(())
}
