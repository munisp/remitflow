//! Rust Tamper-Proof Audit Chain Service
//!
//! Implements an append-only audit trail with SHA-256 hash chaining.
//! Each entry includes the hash of the previous entry, forming an
//! immutable chain that detects tampering.
//!
//! Endpoints:
//!   GET  /health           - Health check
//!   POST /entries          - Create new audit entry
//!   GET  /entries          - List recent entries
//!   POST /verify           - Verify chain integrity
//!   GET  /entries/:id      - Get specific entry
//!   POST /entries/batch    - Batch create entries
//!
//! Port: 8317 (configurable via PORT env var)

use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

// Database connection pool
struct AppState {
    db: tokio_postgres::Client,
    last_hash: Mutex<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AuditEntry {
    id: Option<i64>,
    entry_id: String,
    actor_id: String,
    action: String,
    resource_type: String,
    resource_id: String,
    details: serde_json::Value,
    ip_address: Option<String>,
    user_agent: Option<String>,
    previous_hash: String,
    entry_hash: String,
    created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CreateEntryRequest {
    actor_id: String,
    action: String,
    resource_type: String,
    resource_id: String,
    details: Option<serde_json::Value>,
    ip_address: Option<String>,
    user_agent: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VerifyResult {
    is_valid: bool,
    entries_checked: i64,
    first_invalid_at: Option<i64>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchCreateRequest {
    entries: Vec<CreateEntryRequest>,
}

fn compute_hash(
    actor_id: &str,
    action: &str,
    resource_type: &str,
    resource_id: &str,
    details: &serde_json::Value,
    previous_hash: &str,
    timestamp: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(actor_id.as_bytes());
    hasher.update(b"|");
    hasher.update(action.as_bytes());
    hasher.update(b"|");
    hasher.update(resource_type.as_bytes());
    hasher.update(b"|");
    hasher.update(resource_id.as_bytes());
    hasher.update(b"|");
    hasher.update(details.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(previous_hash.as_bytes());
    hasher.update(b"|");
    hasher.update(timestamp.as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn init_schema(client: &tokio_postgres::Client) {
    let schema = "
        CREATE TABLE IF NOT EXISTS audit_chain (
            id BIGSERIAL PRIMARY KEY,
            entry_id TEXT UNIQUE NOT NULL,
            actor_id TEXT NOT NULL,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}',
            ip_address TEXT,
            user_agent TEXT,
            previous_hash TEXT NOT NULL,
            entry_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_audit_chain_actor ON audit_chain(actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_chain_action ON audit_chain(action);
        CREATE INDEX IF NOT EXISTS idx_audit_chain_resource ON audit_chain(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_chain_created ON audit_chain(created_at DESC);
    ";

    if let Err(e) = client.batch_execute(schema).await {
        eprintln!("[audit-chain] Schema init warning: {}", e);
    }
}

async fn get_last_hash(client: &tokio_postgres::Client) -> String {
    match client
        .query_one(
            "SELECT entry_hash FROM audit_chain ORDER BY id DESC LIMIT 1",
            &[],
        )
        .await
    {
        Ok(row) => row.get::<_, String>(0),
        Err(_) => "genesis".to_string(),
    }
}

async fn handle_health(
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let result = state.db.query_one("SELECT 1", &[]).await;
    match result {
        Ok(_) => Ok(warp::reply::json(&serde_json::json!({
            "status": "healthy",
            "service": "rust-audit-chain"
        }))),
        Err(e) => Ok(warp::reply::json(&serde_json::json!({
            "status": "unhealthy",
            "error": e.to_string()
        }))),
    }
}

async fn handle_create_entry(
    state: Arc<AppState>,
    req: CreateEntryRequest,
) -> Result<impl warp::Reply, warp::Rejection> {
    let mut last_hash = state.last_hash.lock().await;
    let timestamp = Utc::now().to_rfc3339();
    let details = req.details.unwrap_or(serde_json::json!({}));

    let entry_hash = compute_hash(
        &req.actor_id,
        &req.action,
        &req.resource_type,
        &req.resource_id,
        &details,
        &last_hash,
        &timestamp,
    );

    let entry_id = format!(
        "audit_{}_{}_{}",
        Utc::now().timestamp_millis(),
        &req.actor_id[..std::cmp::min(8, req.actor_id.len())],
        &entry_hash[..8]
    );

    let result = state
        .db
        .execute(
            "INSERT INTO audit_chain (entry_id, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, previous_hash, entry_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
            &[
                &entry_id,
                &req.actor_id,
                &req.action,
                &req.resource_type,
                &req.resource_id,
                &details,
                &req.ip_address,
                &req.user_agent,
                &*last_hash,
                &entry_hash,
                &Utc::now(),
            ],
        )
        .await;

    match result {
        Ok(_) => {
            *last_hash = entry_hash.clone();
            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "entry_id": entry_id,
                    "entry_hash": entry_hash,
                    "previous_hash": &*last_hash,
                    "created_at": timestamp,
                })),
                warp::http::StatusCode::CREATED,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": e.to_string()
            })),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_list_entries(
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let rows = state
        .db
        .query(
            "SELECT id, entry_id, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, previous_hash, entry_hash, created_at
             FROM audit_chain ORDER BY id DESC LIMIT 100",
            &[],
        )
        .await
        .unwrap_or_default();

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<_, i64>(0),
                "entry_id": row.get::<_, String>(1),
                "actor_id": row.get::<_, String>(2),
                "action": row.get::<_, String>(3),
                "resource_type": row.get::<_, String>(4),
                "resource_id": row.get::<_, String>(5),
                "details": row.get::<_, serde_json::Value>(6),
                "ip_address": row.get::<_, Option<String>>(7),
                "user_agent": row.get::<_, Option<String>>(8),
                "previous_hash": row.get::<_, String>(9),
                "entry_hash": row.get::<_, String>(10),
                "created_at": row.get::<_, DateTime<Utc>>(11).to_rfc3339(),
            })
        })
        .collect();

    Ok(warp::reply::json(&entries))
}

async fn handle_verify(
    state: Arc<AppState>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let rows = state
        .db
        .query(
            "SELECT id, actor_id, action, resource_type, resource_id, details, previous_hash, entry_hash, created_at
             FROM audit_chain ORDER BY id ASC",
            &[],
        )
        .await
        .unwrap_or_default();

    let mut expected_previous = "genesis".to_string();
    let mut entries_checked: i64 = 0;

    for row in &rows {
        let id: i64 = row.get(0);
        let actor_id: String = row.get(1);
        let action: String = row.get(2);
        let resource_type: String = row.get(3);
        let resource_id: String = row.get(4);
        let details: serde_json::Value = row.get(5);
        let previous_hash: String = row.get(6);
        let entry_hash: String = row.get(7);
        let created_at: DateTime<Utc> = row.get(8);

        // Verify chain linkage
        if previous_hash != expected_previous {
            return Ok(warp::reply::json(&VerifyResult {
                is_valid: false,
                entries_checked,
                first_invalid_at: Some(id),
                error: Some(format!(
                    "Chain broken at entry {}: expected previous_hash '{}', got '{}'",
                    id, expected_previous, previous_hash
                )),
            }));
        }

        // Verify hash integrity
        let computed = compute_hash(
            &actor_id,
            &action,
            &resource_type,
            &resource_id,
            &details,
            &previous_hash,
            &created_at.to_rfc3339(),
        );

        if computed != entry_hash {
            return Ok(warp::reply::json(&VerifyResult {
                is_valid: false,
                entries_checked,
                first_invalid_at: Some(id),
                error: Some(format!(
                    "Hash mismatch at entry {}: computed '{}', stored '{}'",
                    id, &computed[..16], &entry_hash[..16]
                )),
            }));
        }

        expected_previous = entry_hash;
        entries_checked += 1;
    }

    Ok(warp::reply::json(&VerifyResult {
        is_valid: true,
        entries_checked,
        first_invalid_at: None,
        error: None,
    }))
}

async fn handle_batch_create(
    state: Arc<AppState>,
    req: BatchCreateRequest,
) -> Result<impl warp::Reply, warp::Rejection> {
    let mut last_hash = state.last_hash.lock().await;
    let mut created = Vec::new();

    for entry_req in req.entries {
        let timestamp = Utc::now().to_rfc3339();
        let details = entry_req.details.unwrap_or(serde_json::json!({}));

        let entry_hash = compute_hash(
            &entry_req.actor_id,
            &entry_req.action,
            &entry_req.resource_type,
            &entry_req.resource_id,
            &details,
            &last_hash,
            &timestamp,
        );

        let entry_id = format!(
            "audit_{}_{}_{}",
            Utc::now().timestamp_millis(),
            &entry_req.actor_id[..std::cmp::min(8, entry_req.actor_id.len())],
            &entry_hash[..8]
        );

        let _ = state
            .db
            .execute(
                "INSERT INTO audit_chain (entry_id, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, previous_hash, entry_hash, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                &[
                    &entry_id,
                    &entry_req.actor_id,
                    &entry_req.action,
                    &entry_req.resource_type,
                    &entry_req.resource_id,
                    &details,
                    &entry_req.ip_address,
                    &entry_req.user_agent,
                    &*last_hash,
                    &entry_hash,
                    &Utc::now(),
                ],
            )
            .await;

        *last_hash = entry_hash.clone();
        created.push(serde_json::json!({
            "entry_id": entry_id,
            "entry_hash": entry_hash,
        }));
    }

    Ok(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({
            "created": created.len(),
            "entries": created,
        })),
        warp::http::StatusCode::CREATED,
    ))
}

#[tokio::main]
async fn main() {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/remitflow".to_string());

    let (client, connection) = tokio_postgres::connect(&database_url, tokio_postgres::NoTls)
        .await
        .expect("Failed to connect to database");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("[audit-chain] DB connection error: {}", e);
        }
    });

    init_schema(&client).await;
    let last_hash = get_last_hash(&client).await;

    let state = Arc::new(AppState {
        db: client,
        last_hash: Mutex::new(last_hash),
    });

    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8317".to_string())
        .parse()
        .unwrap_or(8317);

    use warp::Filter;

    let state_filter = warp::any().map(move || state.clone());

    let health = warp::get()
        .and(warp::path("health"))
        .and(state_filter.clone())
        .and_then(handle_health);

    let create = warp::post()
        .and(warp::path("entries"))
        .and(warp::path::end())
        .and(state_filter.clone())
        .and(warp::body::json())
        .and_then(handle_create_entry);

    let list = warp::get()
        .and(warp::path("entries"))
        .and(warp::path::end())
        .and(state_filter.clone())
        .and_then(handle_list_entries);

    let verify = warp::post()
        .and(warp::path("verify"))
        .and(state_filter.clone())
        .and_then(handle_verify);

    let batch = warp::post()
        .and(warp::path("entries"))
        .and(warp::path("batch"))
        .and(state_filter.clone())
        .and(warp::body::json())
        .and_then(handle_batch_create);

    let routes = health.or(create).or(list).or(verify).or(batch);

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    println!("[rust-audit-chain] Starting on port {}", port);
    warp::serve(routes).run(addr).await;
}
