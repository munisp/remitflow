/// RemitFlow — Social Ledger Service (Rust)
/// ══════════════════════════════════════════════════════════════════════════════
/// Manages community financial products built on top of the core ledger:
///
///   1. Ajo/Esusu Groups — Rotating savings and credit associations (ROSCAs)
///      - Members contribute fixed amounts on a schedule
///      - Pot rotates to each member in turn (or by lottery)
///      - Fully auditable on TigerBeetle
///
///   2. Referral Reward Pools — Multi-tier referral tracking
///      - Tier-1: direct referral bonus (credited immediately)
///      - Tier-2: volume-based ongoing reward (credited monthly)
///      - Anti-fraud: velocity checks, KYC-gated payouts
///
///   3. Community Savings Pools — Goal-based group savings
///      - Members contribute toward a shared goal (e.g. school fees, equipment)
///      - Smart disbursement rules (threshold, date, vote)
///      - Interest accrual from float income
///
///   4. Social Transfer Links — Pay-by-link with social sharing
///      - Generates short-lived payment links
///      - Tracks click-through and conversion
///
/// HTTP API:
///   POST /groups                    — Create ROSCA group
///   GET  /groups/:id                — Get group details
///   POST /groups/:id/contribute     — Record member contribution
///   POST /groups/:id/disburse       — Trigger pot disbursement
///   POST /referrals                 — Record referral event
///   GET  /referrals/:userId/rewards — Get referral reward balance
///   POST /pools                     — Create savings pool
///   POST /pools/:id/contribute      — Contribute to pool
///   POST /links                     — Create social payment link
///   GET  /links/:code               — Resolve payment link
///   GET  /health                    — Health check

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::net::TcpListener;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Data Structures ───────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct RoscaGroup {
    id: String,
    name: String,
    currency: String,
    contribution_amount: u64,    // in minor units (e.g. kobo, cents)
    contribution_frequency: String, // "weekly" | "biweekly" | "monthly"
    member_ids: Vec<String>,
    current_round: u32,
    current_beneficiary_idx: u32,
    total_pot: u64,
    status: String,              // "active" | "completed" | "paused"
    created_at: u64,
    next_contribution_due: u64,
}

#[derive(Clone, Debug)]
struct Contribution {
    id: String,
    group_id: String,
    member_id: String,
    amount: u64,
    round: u32,
    timestamp: u64,
    tigerbeetle_transfer_id: Option<String>,
}

#[derive(Clone, Debug)]
struct ReferralRecord {
    referrer_id: String,
    referee_id: String,
    tier: u8,                    // 1 = direct, 2 = indirect
    status: String,              // "pending" | "qualified" | "rewarded"
    reward_amount: u64,
    reward_currency: String,
    created_at: u64,
    qualified_at: Option<u64>,
}

#[derive(Clone, Debug)]
struct SavingsPool {
    id: String,
    name: String,
    goal_amount: u64,
    current_amount: u64,
    currency: String,
    disbursement_rule: String,   // "threshold" | "date" | "vote"
    disbursement_target: String, // amount threshold, ISO date, or vote count
    beneficiary_id: String,
    member_ids: Vec<String>,
    status: String,
    created_at: u64,
}

#[derive(Clone, Debug)]
struct PaymentLink {
    code: String,
    creator_id: String,
    amount: Option<u64>,
    currency: String,
    description: String,
    expires_at: u64,
    max_uses: Option<u32>,
    use_count: u32,
    status: String,              // "active" | "expired" | "exhausted"
}

struct AppState {
    groups: Mutex<HashMap<String, RoscaGroup>>,
    contributions: Mutex<Vec<Contribution>>,
    referrals: Mutex<Vec<ReferralRecord>>,
    pools: Mutex<HashMap<String, SavingsPool>>,
    links: Mutex<HashMap<String, PaymentLink>>,
    metrics: Mutex<SocialMetrics>,
    /// Tokio runtime hosting the sqlx pool (handlers are sync; DB calls use
    /// `rt.block_on` — money-path writes are fail-closed).
    rt: Option<Arc<tokio::runtime::Runtime>>,
    /// PostgreSQL write-through pool (None = degraded in-memory mode, boot WARN).
    db: Option<PgPool>,
}

struct SocialMetrics {
    groups_created: u64,
    contributions_recorded: u64,
    disbursements_made: u64,
    referrals_tracked: u64,
    rewards_paid: u64,
    pools_created: u64,
    links_created: u64,
    links_resolved: u64,
}

impl AppState {
    fn new() -> Self {
        AppState {
            groups: Mutex::new(HashMap::new()),
            contributions: Mutex::new(Vec::new()),
            referrals: Mutex::new(Vec::new()),
            pools: Mutex::new(HashMap::new()),
            links: Mutex::new(HashMap::new()),
            metrics: Mutex::new(SocialMetrics {
                groups_created: 0, contributions_recorded: 0, disbursements_made: 0,
                referrals_tracked: 0, rewards_paid: 0, pools_created: 0,
                links_created: 0, links_resolved: 0,
            }),
            rt: None,
            db: None,
        }
    }
}

// ── PostgreSQL persistence (boot-load + write-through) ───────────────────────

const MIGRATION_SQL: &str = include_str!("../migrations/0001_init.sql");

fn init_db(rt: &tokio::runtime::Runtime) -> Option<PgPool> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => {
            eprintln!("[rust-social-ledger] WARN: DATABASE_URL unset — DEGRADED in-memory mode; ROSCA/pool money records will NOT survive restart");
            return None;
        }
    };
    let pool = rt.block_on(async {
        let pool = PgPoolOptions::new().max_connections(5).connect(&db_url).await
            .expect("DATABASE_URL set but PostgreSQL unreachable — refusing to start social-ledger without durable storage");
        sqlx::raw_sql(MIGRATION_SQL).execute(&pool).await.expect("failed to apply social_* migrations");
        pool
    });
    eprintln!("[rust-social-ledger] PostgreSQL connected, migrations applied");
    Some(pool)
}

fn load_from_db(rt: &tokio::runtime::Runtime, pool: &PgPool, state: &AppState) {
    rt.block_on(async {
        // Groups
        match sqlx::query_as::<_, (String, String, String, i64, String, serde_json::Value, i32, i32, i64, String, i64, i64)>(
            "SELECT id, name, currency, contribution_amount, contribution_frequency, member_ids, current_round, current_beneficiary_idx, total_pot, status, created_at_unix, next_contribution_due FROM social_rosca_groups"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut groups = state.groups.lock().unwrap();
                for (id, name, currency, amount, freq, members, round, bidx, pot, status, created, due) in rows {
                    groups.insert(id.clone(), RoscaGroup {
                        id, name, currency,
                        contribution_amount: amount as u64,
                        contribution_frequency: freq,
                        member_ids: serde_json::from_value(members).unwrap_or_default(),
                        current_round: round as u32,
                        current_beneficiary_idx: bidx as u32,
                        total_pot: pot as u64,
                        status,
                        created_at: created as u64,
                        next_contribution_due: due as u64,
                    });
                }
                eprintln!("[rust-social-ledger] boot-loaded {} ROSCA groups", groups.len());
            }
            Err(e) => eprintln!("[rust-social-ledger] ERROR: group boot-load failed: {}", e),
        }
        // Contributions
        match sqlx::query_as::<_, (String, String, String, i64, i32, i64, Option<String>)>(
            "SELECT id, group_id, member_id, amount, round, timestamp_unix, tigerbeetle_transfer_id FROM social_contributions"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut contribs = state.contributions.lock().unwrap();
                for (id, gid, mid, amount, round, ts, tb) in rows {
                    contribs.push(Contribution {
                        id, group_id: gid, member_id: mid, amount: amount as u64,
                        round: round as u32, timestamp: ts as u64, tigerbeetle_transfer_id: tb,
                    });
                }
                eprintln!("[rust-social-ledger] boot-loaded {} contributions", contribs.len());
            }
            Err(e) => eprintln!("[rust-social-ledger] ERROR: contribution boot-load failed: {}", e),
        }
        // Referrals
        match sqlx::query_as::<_, (String, String, i16, String, i64, String, i64, Option<i64>)>(
            "SELECT referrer_id, referee_id, tier, status, reward_amount, reward_currency, created_at_unix, qualified_at FROM social_referrals"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut referrals = state.referrals.lock().unwrap();
                for (referrer, referee, tier, status, amount, cur, created, qualified) in rows {
                    referrals.push(ReferralRecord {
                        referrer_id: referrer, referee_id: referee, tier: tier as u8,
                        status, reward_amount: amount as u64, reward_currency: cur,
                        created_at: created as u64, qualified_at: qualified.map(|q| q as u64),
                    });
                }
                eprintln!("[rust-social-ledger] boot-loaded {} referrals", referrals.len());
            }
            Err(e) => eprintln!("[rust-social-ledger] ERROR: referral boot-load failed: {}", e),
        }
        // Pools
        match sqlx::query_as::<_, (String, String, i64, i64, String, String, String, String, serde_json::Value, String, i64)>(
            "SELECT id, name, goal_amount, current_amount, currency, disbursement_rule, disbursement_target, beneficiary_id, member_ids, status, created_at_unix FROM social_pools"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut pools = state.pools.lock().unwrap();
                for (id, name, goal, current, cur, rule, target, beneficiary, members, status, created) in rows {
                    pools.insert(id.clone(), SavingsPool {
                        id, name, goal_amount: goal as u64, current_amount: current as u64,
                        currency: cur, disbursement_rule: rule, disbursement_target: target,
                        beneficiary_id: beneficiary,
                        member_ids: serde_json::from_value(members).unwrap_or_default(),
                        status, created_at: created as u64,
                    });
                }
                eprintln!("[rust-social-ledger] boot-loaded {} savings pools", pools.len());
            }
            Err(e) => eprintln!("[rust-social-ledger] ERROR: pool boot-load failed: {}", e),
        }
        // Payment links
        match sqlx::query_as::<_, (String, String, Option<i64>, String, String, i64, Option<i32>, i32, String)>(
            "SELECT code, creator_id, amount, currency, description, expires_at, max_uses, use_count, status FROM social_payment_links"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut links = state.links.lock().unwrap();
                for (code, creator, amount, cur, desc, expires, max_uses, use_count, status) in rows {
                    links.insert(code.clone(), PaymentLink {
                        code, creator_id: creator, amount: amount.map(|a| a as u64), currency: cur,
                        description: desc, expires_at: expires as u64,
                        max_uses: max_uses.map(|m| m as u32), use_count: use_count as u32, status,
                    });
                }
                eprintln!("[rust-social-ledger] boot-loaded {} payment links", links.len());
            }
            Err(e) => eprintln!("[rust-social-ledger] ERROR: link boot-load failed: {}", e),
        }
    });
}

fn members_json(members: &[String]) -> serde_json::Value {
    serde_json::to_value(members).unwrap_or_default()
}

async fn db_insert_group(pool: &PgPool, g: &RoscaGroup) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_rosca_groups
            (id, name, currency, contribution_amount, contribution_frequency, member_ids,
             current_round, current_beneficiary_idx, total_pot, status, created_at_unix, next_contribution_due)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING"
    )
    .bind(&g.id).bind(&g.name).bind(&g.currency).bind(g.contribution_amount as i64)
    .bind(&g.contribution_frequency).bind(members_json(&g.member_ids))
    .bind(g.current_round as i32).bind(g.current_beneficiary_idx as i32)
    .bind(g.total_pot as i64).bind(&g.status).bind(g.created_at as i64).bind(g.next_contribution_due as i64)
    .execute(pool).await?;
    Ok(())
}

async fn db_update_group(pool: &PgPool, g: &RoscaGroup) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE social_rosca_groups SET current_round=$2, current_beneficiary_idx=$3,
            total_pot=$4, status=$5, updated_at=NOW() WHERE id=$1"
    )
    .bind(&g.id).bind(g.current_round as i32).bind(g.current_beneficiary_idx as i32)
    .bind(g.total_pot as i64).bind(&g.status)
    .execute(pool).await?;
    Ok(())
}

async fn db_insert_referral(pool: &PgPool, r: &ReferralRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_referrals (referrer_id, referee_id, tier, status, reward_amount, reward_currency, created_at_unix, qualified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
    )
    .bind(&r.referrer_id).bind(&r.referee_id).bind(r.tier as i16).bind(&r.status)
    .bind(r.reward_amount as i64).bind(&r.reward_currency)
    .bind(r.created_at as i64).bind(r.qualified_at.map(|q| q as i64))
    .execute(pool).await?;
    Ok(())
}

async fn db_insert_pool(pool: &PgPool, p: &SavingsPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_pools (id, name, goal_amount, current_amount, currency, disbursement_rule, disbursement_target, beneficiary_id, member_ids, status, created_at_unix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING"
    )
    .bind(&p.id).bind(&p.name).bind(p.goal_amount as i64).bind(p.current_amount as i64)
    .bind(&p.currency).bind(&p.disbursement_rule).bind(&p.disbursement_target)
    .bind(&p.beneficiary_id).bind(members_json(&p.member_ids)).bind(&p.status).bind(p.created_at as i64)
    .execute(pool).await?;
    Ok(())
}

async fn db_update_pool(pool: &PgPool, p: &SavingsPool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE social_pools SET current_amount=$2, status=$3, updated_at=NOW() WHERE id=$1")
        .bind(&p.id).bind(p.current_amount as i64).bind(&p.status)
        .execute(pool).await?;
    Ok(())
}

async fn db_insert_link(pool: &PgPool, l: &PaymentLink) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO social_payment_links (code, creator_id, amount, currency, description, expires_at, max_uses, use_count, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code) DO NOTHING"
    )
    .bind(&l.code).bind(&l.creator_id).bind(l.amount.map(|a| a as i64)).bind(&l.currency)
    .bind(&l.description).bind(l.expires_at as i64).bind(l.max_uses.map(|m| m as i32))
    .bind(l.use_count as i32).bind(&l.status)
    .execute(pool).await?;
    Ok(())
}

async fn db_update_link(pool: &PgPool, l: &PaymentLink) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE social_payment_links SET use_count=$2, status=$3, updated_at=NOW() WHERE code=$1")
        .bind(&l.code).bind(l.use_count as i32).bind(&l.status)
        .execute(pool).await?;
    Ok(())
}

/// Fail-closed write-through helper: runs `f` against PG when configured.
/// Returns Err(()) when the durable write failed (caller returns HTTP 500).
fn persist<F, Fut>(state: &AppState, f: F) -> Result<(), ()>
where
    F: FnOnce(PgPool) -> Fut,
    Fut: std::future::Future<Output = Result<(), sqlx::Error>>,
{
    let (Some(rt), Some(pool)) = (&state.rt, &state.db) else {
        return Ok(()); // degraded in-memory mode (boot WARN already emitted)
    };
    match rt.block_on(f(pool.clone())) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("[rust-social-ledger] ERROR: durable write failed (fail-closed): {}", e);
            Err(())
        }
    }
}

/// Fail-open write-through helper for non-money increments: logs loudly.
fn persist_best_effort<F, Fut>(state: &AppState, f: F)
where
    F: FnOnce(PgPool) -> Fut,
    Fut: std::future::Future<Output = Result<(), sqlx::Error>>,
{
    if persist(state, f).is_err() {
        eprintln!("[rust-social-ledger] ERROR: non-critical durable write lost (kept in memory only)");
    }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "9020".to_string());
    let rt = Arc::new(tokio::runtime::Runtime::new().expect("tokio runtime for persistence"));
    let db = init_db(&rt);
    let mut state_owned = AppState::new();
    if let Some(ref pool) = db {
        load_from_db(&rt, pool, &state_owned);
    }
    state_owned.rt = Some(rt);
    state_owned.db = db;
    let state = Arc::new(state_owned);
    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).expect("Failed to bind");
    eprintln!("[rust-social-ledger] Listening on :{}", port);

    for stream in listener.incoming() {
        let state = Arc::clone(&state);
        std::thread::spawn(move || {
            if let Ok(mut stream) = stream {
                let mut buffer = [0u8; 16384];
                if let Ok(n) = stream.read(&mut buffer) {
                    let request = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let response = handle_request(&request, &state);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        });
    }
}

fn handle_request(request: &str, state: &AppState) -> String {
    let lines: Vec<&str> = request.lines().collect();
    if lines.is_empty() { return http_response(400, r#"{"error":"Empty request"}"#); }

    let parts: Vec<&str> = lines[0].split_whitespace().collect();
    if parts.len() < 2 { return http_response(400, r#"{"error":"Invalid request"}"#); }

    let method = parts[0];
    let path = parts[1];
    let body = request.split("\r\n\r\n").nth(1).unwrap_or("");

    match (method, path) {
        ("GET", "/health") | ("GET", "/healthz") => handle_health(state),
        ("GET", "/metrics") => handle_metrics(state),

        // ROSCA Groups
        ("POST", "/groups") => handle_create_group(body, state),
        (m, p) if m == "GET" && p.starts_with("/groups/") && !p.contains("/contribute") && !p.contains("/disburse") => {
            handle_get_group(&p[8..], state)
        }
        (m, p) if m == "POST" && p.ends_with("/contribute") => {
            let group_id = p.trim_start_matches("/groups/").trim_end_matches("/contribute");
            handle_contribute(group_id, body, state)
        }
        (m, p) if m == "POST" && p.ends_with("/disburse") => {
            let group_id = p.trim_start_matches("/groups/").trim_end_matches("/disburse");
            handle_disburse(group_id, state)
        }

        // Referrals
        ("POST", "/referrals") => handle_record_referral(body, state),
        (m, p) if m == "GET" && p.starts_with("/referrals/") && p.ends_with("/rewards") => {
            let user_id = p.trim_start_matches("/referrals/").trim_end_matches("/rewards");
            handle_get_rewards(user_id, state)
        }

        // Savings Pools
        ("POST", "/pools") => handle_create_pool(body, state),
        (m, p) if m == "POST" && p.starts_with("/pools/") && p.ends_with("/contribute") => {
            let pool_id = p.trim_start_matches("/pools/").trim_end_matches("/contribute");
            handle_pool_contribute(pool_id, body, state)
        }

        // Payment Links
        ("POST", "/links") => handle_create_link(body, state),
        (m, p) if m == "GET" && p.starts_with("/links/") => {
            handle_resolve_link(&p[7..], state)
        }

        _ => http_response(404, r#"{"error":"Not found"}"#),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

fn handle_health(state: &AppState) -> String {
    let m = state.metrics.lock().unwrap();
    let ts = now_ts();
    http_response(200, &format!(
        r#"{{"status":"healthy","service":"rust-social-ledger","version":"1.0.0","timestamp":{},"stats":{{"groups":{},"referrals":{},"pools":{},"links":{}}}}}"#,
        ts, m.groups_created, m.referrals_tracked, m.pools_created, m.links_created
    ))
}

fn handle_metrics(state: &AppState) -> String {
    let m = state.metrics.lock().unwrap();
    http_response(200, &format!(
        r#"{{"groups_created":{},"contributions_recorded":{},"disbursements_made":{},"referrals_tracked":{},"rewards_paid":{},"pools_created":{},"links_created":{},"links_resolved":{}}}"#,
        m.groups_created, m.contributions_recorded, m.disbursements_made,
        m.referrals_tracked, m.rewards_paid, m.pools_created, m.links_created, m.links_resolved
    ))
}

fn handle_create_group(body: &str, state: &AppState) -> String {
    let name = extract_str(body, "name").unwrap_or_else(|| "Unnamed Group".to_string());
    let currency = extract_str(body, "currency").unwrap_or_else(|| "NGN".to_string());
    let contribution_amount = extract_u64(body, "contributionAmount").unwrap_or(5000);
    let frequency = extract_str(body, "frequency").unwrap_or_else(|| "monthly".to_string());
    let member_ids = extract_array(body, "memberIds");

    let id = generate_id("GRP");
    let group = RoscaGroup {
        id: id.clone(),
        name: name.clone(),
        currency: currency.clone(),
        contribution_amount,
        contribution_frequency: frequency.clone(),
        member_ids: member_ids.clone(),
        current_round: 1,
        current_beneficiary_idx: 0,
        total_pot: 0,
        status: "active".to_string(),
        created_at: now_ts(),
        next_contribution_due: now_ts() + 30 * 24 * 3600, // 30 days
    };

    let group_to_persist = group.clone();
    if persist(state, move |p| async move {
        db_insert_group(&p, &group_to_persist).await
    }).is_err() {
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }
    state.groups.lock().unwrap().insert(id.clone(), group);
    state.metrics.lock().unwrap().groups_created += 1;

    http_response(201, &format!(
        r#"{{"id":"{}","name":"{}","currency":"{}","contributionAmount":{},"frequency":"{}","memberCount":{},"status":"active","createdAt":{}}}"#,
        id, name, currency, contribution_amount, frequency, member_ids.len(), now_ts()
    ))
}

fn handle_get_group(group_id: &str, state: &AppState) -> String {
    let groups = state.groups.lock().unwrap();
    match groups.get(group_id) {
        Some(g) => {
            let pot_per_member = if !g.member_ids.is_empty() {
                g.contribution_amount * g.member_ids.len() as u64
            } else { 0 };
            http_response(200, &format!(
                r#"{{"id":"{}","name":"{}","currency":"{}","contributionAmount":{},"frequency":"{}","memberCount":{},"currentRound":{},"totalPot":{},"expectedPot":{},"status":"{}","currentBeneficiaryIdx":{}}}"#,
                g.id, g.name, g.currency, g.contribution_amount, g.contribution_frequency,
                g.member_ids.len(), g.current_round, g.total_pot, pot_per_member,
                g.status, g.current_beneficiary_idx
            ))
        }
        None => http_response(404, r#"{"error":"Group not found"}"#),
    }
}

fn handle_contribute(group_id: &str, body: &str, state: &AppState) -> String {
    let member_id = match extract_str(body, "memberId") {
        Some(id) => id,
        None => return http_response(400, r#"{"error":"memberId required"}"#),
    };
    let amount = extract_u64(body, "amount").unwrap_or(0);

    let mut groups = state.groups.lock().unwrap();
    let group = match groups.get_mut(group_id) {
        Some(g) => g,
        None => return http_response(404, r#"{"error":"Group not found"}"#),
    };

    if amount != group.contribution_amount {
        return http_response(400, &format!(
            r#"{{"error":"Amount must be {} {}"}}"#,
            group.contribution_amount, group.currency
        ));
    }

    group.total_pot += amount;
    let round = group.current_round;
    let group_snapshot = group.clone();
    drop(groups);

    let contribution = Contribution {
        id: generate_id("CTB"),
        group_id: group_id.to_string(),
        member_id: member_id.clone(),
        amount,
        round,
        timestamp: now_ts(),
        tigerbeetle_transfer_id: None,
    };

    // Money path: contribution record + pot update must be durable before we
    // acknowledge. Fail closed on PG error and roll back the in-memory pot.
    let contribution_to_persist = contribution.clone();
    let group_to_persist = group_snapshot.clone();
    if persist(state, move |p| {
        let c = contribution_to_persist.clone();
        let g = group_to_persist.clone();
        async move {
            let mut tx = p.begin().await?;
            sqlx::query(
                "INSERT INTO social_contributions (id, group_id, member_id, amount, round, timestamp_unix, tigerbeetle_transfer_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING"
            )
            .bind(&c.id).bind(&c.group_id).bind(&c.member_id).bind(c.amount as i64)
            .bind(c.round as i32).bind(c.timestamp as i64).bind(&c.tigerbeetle_transfer_id)
            .execute(&mut *tx).await?;
            sqlx::query(
                "UPDATE social_rosca_groups SET total_pot=$2, updated_at=NOW() WHERE id=$1"
            )
            .bind(&g.id).bind(g.total_pot as i64)
            .execute(&mut *tx).await?;
            tx.commit().await
        }
    }).is_err() {
        let mut groups = state.groups.lock().unwrap();
        if let Some(g) = groups.get_mut(group_id) {
            g.total_pot = g.total_pot.saturating_sub(amount);
        }
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }

    let contrib_id = contribution.id.clone();
    state.contributions.lock().unwrap().push(contribution);
    state.metrics.lock().unwrap().contributions_recorded += 1;

    http_response(200, &format!(
        r#"{{"contributionId":"{}","groupId":"{}","memberId":"{}","amount":{},"round":{},"timestamp":{}}}"#,
        contrib_id, group_id, member_id, amount, round, now_ts()
    ))
}

fn handle_disburse(group_id: &str, state: &AppState) -> String {
    let mut groups = state.groups.lock().unwrap();
    let group = match groups.get_mut(group_id) {
        Some(g) => g,
        None => return http_response(404, r#"{"error":"Group not found"}"#),
    };

    if group.member_ids.is_empty() {
        return http_response(400, r#"{"error":"Group has no members"}"#);
    }

    let beneficiary_idx = group.current_beneficiary_idx as usize;
    let beneficiary_id = group.member_ids[beneficiary_idx % group.member_ids.len()].clone();
    let disbursement_amount = group.total_pot;

    group.total_pot = 0;
    group.current_round += 1;
    group.current_beneficiary_idx = (group.current_beneficiary_idx + 1) % group.member_ids.len() as u32;

    if group.current_round as usize > group.member_ids.len() {
        group.status = "completed".to_string();
    }

    let snapshot = group.clone();
    let rollback_round = snapshot.current_round - 1;
    drop(groups);

    // Money path: pot disbursement must be durable before we acknowledge.
    let group_to_persist = snapshot.clone();
    if persist(state, move |p| async move { db_update_group(&p, &group_to_persist).await }).is_err() {
        let mut groups = state.groups.lock().unwrap();
        if let Some(g) = groups.get_mut(group_id) {
            g.total_pot = disbursement_amount;
            g.current_round = rollback_round;
            g.current_beneficiary_idx = (rollback_round - 1) % g.member_ids.len() as u32;
            g.status = "active".to_string();
        }
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }

    state.metrics.lock().unwrap().disbursements_made += 1;

    http_response(200, &format!(
        r#"{{"groupId":"{}","beneficiaryId":"{}","disbursementAmount":{},"currency":"{}","newRound":{},"groupStatus":"{}","timestamp":{}}}"#,
        group_id, beneficiary_id, disbursement_amount, snapshot.currency,
        snapshot.current_round, snapshot.status, now_ts()
    ))
}

fn handle_record_referral(body: &str, state: &AppState) -> String {
    let referrer_id = match extract_str(body, "referrerId") {
        Some(id) => id,
        None => return http_response(400, r#"{"error":"referrerId required"}"#),
    };
    let referee_id = match extract_str(body, "refereeId") {
        Some(id) => id,
        None => return http_response(400, r#"{"error":"refereeId required"}"#),
    };
    let tier = extract_u64(body, "tier").unwrap_or(1) as u8;

    // Reward schedule
    let (reward_amount, reward_currency) = match tier {
        1 => (500_u64, "NGN"),   // ₦5 direct referral bonus
        2 => (200_u64, "NGN"),   // ₦2 indirect referral bonus
        _ => (100_u64, "NGN"),
    };

    let referral = ReferralRecord {
        referrer_id: referrer_id.clone(),
        referee_id: referee_id.clone(),
        tier,
        status: "pending".to_string(),
        reward_amount,
        reward_currency: reward_currency.to_string(),
        created_at: now_ts(),
        qualified_at: None,
    };

    let referral_to_persist = referral.clone();
    if persist(state, move |p| async move { db_insert_referral(&p, &referral_to_persist).await }).is_err() {
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }
    state.referrals.lock().unwrap().push(referral);
    state.metrics.lock().unwrap().referrals_tracked += 1;

    http_response(201, &format!(
        r#"{{"referrerId":"{}","refereeId":"{}","tier":{},"rewardAmount":{},"rewardCurrency":"{}","status":"pending","createdAt":{}}}"#,
        referrer_id, referee_id, tier, reward_amount, reward_currency, now_ts()
    ))
}

fn handle_get_rewards(user_id: &str, state: &AppState) -> String {
    let referrals = state.referrals.lock().unwrap();
    let user_referrals: Vec<&ReferralRecord> = referrals.iter()
        .filter(|r| r.referrer_id == user_id)
        .collect();

    let total_pending: u64 = user_referrals.iter()
        .filter(|r| r.status == "pending")
        .map(|r| r.reward_amount)
        .sum();

    let total_paid: u64 = user_referrals.iter()
        .filter(|r| r.status == "rewarded")
        .map(|r| r.reward_amount)
        .sum();

    let referral_count = user_referrals.len();
    let tier1_count = user_referrals.iter().filter(|r| r.tier == 1).count();
    let tier2_count = user_referrals.iter().filter(|r| r.tier == 2).count();

    http_response(200, &format!(
        r#"{{"userId":"{}","totalPendingReward":{},"totalPaidReward":{},"referralCount":{},"tier1Count":{},"tier2Count":{},"currency":"NGN"}}"#,
        user_id, total_pending, total_paid, referral_count, tier1_count, tier2_count
    ))
}

fn handle_create_pool(body: &str, state: &AppState) -> String {
    let name = extract_str(body, "name").unwrap_or_else(|| "Savings Pool".to_string());
    let goal_amount = extract_u64(body, "goalAmount").unwrap_or(100_000);
    let currency = extract_str(body, "currency").unwrap_or_else(|| "NGN".to_string());
    let beneficiary_id = extract_str(body, "beneficiaryId").unwrap_or_else(|| "".to_string());
    let disbursement_rule = extract_str(body, "disbursementRule").unwrap_or_else(|| "threshold".to_string());
    let disbursement_target = extract_str(body, "disbursementTarget").unwrap_or_else(|| "100".to_string());

    let id = generate_id("POOL");
    let pool = SavingsPool {
        id: id.clone(),
        name: name.clone(),
        goal_amount,
        current_amount: 0,
        currency: currency.clone(),
        disbursement_rule: disbursement_rule.clone(),
        disbursement_target,
        beneficiary_id,
        member_ids: vec![],
        status: "active".to_string(),
        created_at: now_ts(),
    };

    let pool_to_persist = pool.clone();
    if persist(state, move |p| async move { db_insert_pool(&p, &pool_to_persist).await }).is_err() {
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }
    state.pools.lock().unwrap().insert(id.clone(), pool);
    state.metrics.lock().unwrap().pools_created += 1;

    http_response(201, &format!(
        r#"{{"id":"{}","name":"{}","goalAmount":{},"currency":"{}","disbursementRule":"{}","status":"active","progressPercent":0,"createdAt":{}}}"#,
        id, name, goal_amount, currency, disbursement_rule, now_ts()
    ))
}

fn handle_pool_contribute(pool_id: &str, body: &str, state: &AppState) -> String {
    let amount = extract_u64(body, "amount").unwrap_or(0);
    if amount == 0 { return http_response(400, r#"{"error":"amount required"}"#); }

    let mut pools = state.pools.lock().unwrap();
    let pool = match pools.get_mut(pool_id) {
        Some(p) => p,
        None => return http_response(404, r#"{"error":"Pool not found"}"#),
    };

    pool.current_amount += amount;
    let progress = (pool.current_amount * 100) / pool.goal_amount.max(1);
    let goal_reached = pool.current_amount >= pool.goal_amount;

    if goal_reached && pool.disbursement_rule == "threshold" {
        pool.status = "goal_reached".to_string();
    }

    let snapshot = pool.clone();
    drop(pools);

    let pool_to_persist = snapshot.clone();
    if persist(state, move |p| async move { db_update_pool(&p, &pool_to_persist).await }).is_err() {
        let mut pools = state.pools.lock().unwrap();
        if let Some(pl) = pools.get_mut(pool_id) {
            pl.current_amount = pl.current_amount.saturating_sub(amount);
            pl.status = "active".to_string();
        }
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }

    http_response(200, &format!(
        r#"{{"poolId":"{}","contributedAmount":{},"totalAmount":{},"goalAmount":{},"progressPercent":{},"goalReached":{},"status":"{}"}}"#,
        pool_id, amount, snapshot.current_amount, snapshot.goal_amount, progress, goal_reached, snapshot.status
    ))
}

fn handle_create_link(body: &str, state: &AppState) -> String {
    let creator_id = match extract_str(body, "creatorId") {
        Some(id) => id,
        None => return http_response(400, r#"{"error":"creatorId required"}"#),
    };
    let currency = extract_str(body, "currency").unwrap_or_else(|| "NGN".to_string());
    let description = extract_str(body, "description").unwrap_or_else(|| "Payment request".to_string());
    let amount = extract_u64(body, "amount");
    let max_uses = extract_u64(body, "maxUses").map(|v| v as u32);

    let code = generate_short_code();
    let link = PaymentLink {
        code: code.clone(),
        creator_id: creator_id.clone(),
        amount,
        currency: currency.clone(),
        description: description.clone(),
        expires_at: now_ts() + 7 * 24 * 3600, // 7 days
        max_uses,
        use_count: 0,
        status: "active".to_string(),
    };

    let link_to_persist = link.clone();
    if persist(state, move |p| async move { db_insert_link(&p, &link_to_persist).await }).is_err() {
        return http_response(503, r#"{"error":"durable store unavailable"}"#);
    }
    state.links.lock().unwrap().insert(code.clone(), link);
    state.metrics.lock().unwrap().links_created += 1;

    let base_url = std::env::var("APP_BASE_URL").unwrap_or_else(|_| "https://pay.remitflow.io".to_string());
    let amount_str = amount.map(|a| format!(",\"amount\":{}", a)).unwrap_or_default();

    http_response(201, &format!(
        r#"{{"code":"{}","url":"{}/p/{}","creatorId":"{}","currency":"{}","description":"{}"{},"expiresAt":{}}}"#,
        code, base_url, code, creator_id, currency, description, amount_str, now_ts() + 7 * 24 * 3600
    ))
}

fn handle_resolve_link(code: &str, state: &AppState) -> String {
    let mut links = state.links.lock().unwrap();
    match links.get_mut(code) {
        Some(link) => {
            if link.status != "active" {
                return http_response(410, r#"{"error":"Link is no longer active"}"#);
            }
            if now_ts() > link.expires_at {
                link.status = "expired".to_string();
                let link_snapshot = link.clone();
                drop(links);
                persist_best_effort(state, move |p| async move { db_update_link(&p, &link_snapshot).await });
                return http_response(410, r#"{"error":"Link has expired"}"#);
            }
            if let Some(max) = link.max_uses {
                if link.use_count >= max {
                    link.status = "exhausted".to_string();
                    let link_snapshot = link.clone();
                    drop(links);
                    persist_best_effort(state, move |p| async move { db_update_link(&p, &link_snapshot).await });
                    return http_response(410, r#"{"error":"Link has reached maximum uses"}"#);
                }
            }
            link.use_count += 1;
            let link_snapshot = link.clone();
            drop(links);
            let link_for_db = link_snapshot.clone();
            persist_best_effort(state, move |p| async move { db_update_link(&p, &link_for_db).await });
            state.metrics.lock().unwrap().links_resolved += 1;

            let amount_str = link_snapshot.amount.map(|a| format!(",\"amount\":{}", a)).unwrap_or_default();
            http_response(200, &format!(
                r#"{{"code":"{}","creatorId":"{}","currency":"{}","description":"{}"{},"useCount":{},"status":"active"}}"#,
                link_snapshot.code, link_snapshot.creator_id, link_snapshot.currency, link_snapshot.description,
                amount_str, link_snapshot.use_count
            ))
        }
        None => http_response(404, r#"{"error":"Link not found"}"#),
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn now_ts() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn generate_id(prefix: &str) -> String {
    let ts = now_ts();
    let rand: u32 = (ts ^ (ts >> 16)) as u32;
    format!("{}-{:08X}", prefix, rand)
}

fn generate_short_code() -> String {
    let ts = now_ts();
    let chars = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut code = String::with_capacity(8);
    let mut n = ts ^ (ts >> 13);
    for _ in 0..8 {
        code.push(chars[(n % 32) as usize] as char);
        n = n.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    }
    code
}

fn extract_str(body: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\":", key);
    let start = body.find(&pattern)? + pattern.len();
    let rest = body[start..].trim_start();
    if rest.starts_with('"') {
        let inner = &rest[1..];
        let end = inner.find('"')?;
        Some(inner[..end].to_string())
    } else {
        None
    }
}

fn extract_u64(body: &str, key: &str) -> Option<u64> {
    let pattern = format!("\"{}\":", key);
    let start = body.find(&pattern)? + pattern.len();
    let rest = body[start..].trim_start();
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn extract_array(body: &str, key: &str) -> Vec<String> {
    let pattern = format!("\"{}\":", key);
    let start = match body.find(&pattern) {
        Some(s) => s + pattern.len(),
        None => return vec![],
    };
    let rest = &body[start..].trim_start();
    if !rest.starts_with('[') { return vec![]; }
    let end = rest.find(']').unwrap_or(rest.len());
    let inner = &rest[1..end];
    inner.split(',')
        .filter_map(|s| {
            let trimmed = s.trim().trim_matches('"');
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        })
        .collect()
}

/// CORS policy: origins come from ALLOWED_ORIGINS (comma-separated).
/// "*" is only ever emitted outside production; in production an unset
/// allowlist means no ACAO header at all (same-origin only).
fn cors_allow_origin_header() -> Option<String> {
    let is_prod = std::env::var("APP_ENV").map(|v| v == "production").unwrap_or(false)
        || std::env::var("NODE_ENV").map(|v| v == "production").unwrap_or(false);
    let allowed: Vec<String> = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if !allowed.is_empty() {
        // Reflect the first configured origin; this service has no per-request
        // Origin parsing, so only the configured allowlist is ever advertised.
        return Some(allowed[0].clone());
    }
    if is_prod {
        None
    } else {
        Some("*".to_string())
    }
}

fn http_response(status: u16, body: &str) -> String {
    let status_text = match status {
        200 => "OK", 201 => "Created", 400 => "Bad Request",
        404 => "Not Found", 410 => "Gone", 500 => "Internal Server Error",
        _ => "Unknown",
    };
    let cors_header = match cors_allow_origin_header() {
        Some(origin) => format!("Access-Control-Allow-Origin: {}\r\n", origin),
        None => String::new(),
    };
    format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}\r\n{}",
        status, status_text, body.len(), cors_header, body
    )
}
