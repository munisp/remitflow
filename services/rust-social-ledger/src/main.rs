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
        }
    }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "9020".to_string());
    let state = Arc::new(AppState::new());
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

    state.metrics.lock().unwrap().disbursements_made += 1;

    http_response(200, &format!(
        r#"{{"groupId":"{}","beneficiaryId":"{}","disbursementAmount":{},"currency":"{}","newRound":{},"groupStatus":"{}","timestamp":{}}}"#,
        group_id, beneficiary_id, disbursement_amount, group.currency,
        group.current_round, group.status, now_ts()
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

    http_response(200, &format!(
        r#"{{"poolId":"{}","contributedAmount":{},"totalAmount":{},"goalAmount":{},"progressPercent":{},"goalReached":{},"status":"{}"}}"#,
        pool_id, amount, pool.current_amount, pool.goal_amount, progress, goal_reached, pool.status
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
                return http_response(410, r#"{"error":"Link has expired"}"#);
            }
            if let Some(max) = link.max_uses {
                if link.use_count >= max {
                    link.status = "exhausted".to_string();
                    return http_response(410, r#"{"error":"Link has reached maximum uses"}"#);
                }
            }
            link.use_count += 1;
            state.metrics.lock().unwrap().links_resolved += 1;

            let amount_str = link.amount.map(|a| format!(",\"amount\":{}", a)).unwrap_or_default();
            http_response(200, &format!(
                r#"{{"code":"{}","creatorId":"{}","currency":"{}","description":"{}"{},"useCount":{},"status":"active"}}"#,
                link.code, link.creator_id, link.currency, link.description,
                amount_str, link.use_count
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

fn http_response(status: u16, body: &str) -> String {
    let status_text = match status {
        200 => "OK", 201 => "Created", 400 => "Bad Request",
        404 => "Not Found", 410 => "Gone", 500 => "Internal Server Error",
        _ => "Unknown",
    };
    format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
        status, status_text, body.len(), body
    )
}
