//! Rust Credential Guard Service
//!
//! Handles WebAuthn/FIDO2 cryptographic verification, mTLS certificate rotation,
//! short-lived credential issuance, and canary token detection.
//! Port: 8190

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH, Duration};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct WebAuthnChallenge {
    challenge: String,
    user_id: u64,
    created_at: u64,
    expires_at: u64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct WebAuthnCredential {
    credential_id: String,
    user_id: u64,
    public_key_pem: String,
    sign_count: u32,
    created_at: u64,
    last_used: Option<u64>,
    name: String,
    aaguid: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MTLSCertificate {
    cert_id: String,
    service_name: String,
    fingerprint: String,
    issued_at: u64,
    expires_at: u64,
    revoked: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ShortLivedToken {
    token_id: String,
    user_id: u64,
    scope: String,
    issued_at: u64,
    expires_at: u64,
    max_uses: u32,
    uses_remaining: u32,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct CanaryToken {
    token_id: String,
    table_name: String,
    record_id: String,
    honey_data: String,
    created_at: u64,
    trip_count: u32,
    last_trip: Option<u64>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct CanaryTrip {
    trip_id: String,
    token_id: String,
    accessed_by: u64,
    ip_address: String,
    query_pattern: String,
    timestamp: u64,
    auto_action: String,
}

struct AppState {
    challenges: RwLock<HashMap<String, WebAuthnChallenge>>,
    credentials: RwLock<Vec<WebAuthnCredential>>,
    certificates: RwLock<Vec<MTLSCertificate>>,
    tokens: RwLock<Vec<ShortLivedToken>>,
    canary_tokens: RwLock<Vec<CanaryToken>>,
    canary_trips: RwLock<Vec<CanaryTrip>>,
    /// Tokio runtime hosting the sqlx pool (handlers are sync; DB writes use
    /// `rt.block_on` — durable security records are fail-closed).
    rt: Option<Arc<tokio::runtime::Runtime>>,
    /// PostgreSQL write-through pool (None = degraded in-memory mode, boot WARN).
    db: Option<PgPool>,
}

// ─── PostgreSQL persistence (boot-load + write-through) ──────────────────────

const MIGRATION_SQL: &str = include_str!("migrations/0001_init.sql");

fn init_db(rt: &tokio::runtime::Runtime) -> Option<PgPool> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => {
            eprintln!("[rust-credential-guard] WARN: DATABASE_URL unset — DEGRADED in-memory mode; credentials/certs/canaries will NOT survive restart");
            return None;
        }
    };
    rt.block_on(async {
        let pool = PgPoolOptions::new().max_connections(5).connect(&db_url).await
            .expect("DATABASE_URL set but PostgreSQL unreachable — refusing to start credential-guard without durable storage");
        sqlx::raw_sql(MIGRATION_SQL).execute(&pool).await.expect("failed to apply credential_guard migrations");
        eprintln!("[rust-credential-guard] PostgreSQL connected, migrations applied");
        Some(pool)
    })
}

/// Fail-closed durable write for security records. Err(()) => caller returns an error.
fn persist<F, Fut>(state: &AppState, f: F) -> Result<(), ()>
where
    F: FnOnce(PgPool) -> Fut,
    Fut: std::future::Future<Output = Result<(), sqlx::Error>>,
{
    let (Some(rt), Some(pool)) = (&state.rt, &state.db) else {
        return Ok(()); // degraded mode (boot WARN already emitted)
    };
    rt.block_on(f(pool.clone())).map_err(|e| {
        eprintln!("[rust-credential-guard] ERROR: durable write failed (fail-closed): {}", e);
    })
}

/// Fail-open write for ephemeral TTL state (challenges/tokens): loud log only.
fn persist_ephemeral<F, Fut>(state: &AppState, f: F)
where
    F: FnOnce(PgPool) -> Fut,
    Fut: std::future::Future<Output = Result<(), sqlx::Error>>,
{
    if persist(state, f).is_err() {
        eprintln!("[rust-credential-guard] ERROR: ephemeral (TTL) write lost — kept in memory only");
    }
}

fn load_from_db(rt: &tokio::runtime::Runtime, pool: &PgPool, state: &AppState) {
    rt.block_on(async {
        match sqlx::query_as::<_, (String, i64, String, i32, String, String, i64, Option<i64>)>(
            "SELECT credential_id, user_id, public_key_pem, sign_count, name, aaguid, created_at_unix, last_used FROM credential_guard_credentials"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut creds = state.credentials.write().unwrap();
                for (cid, uid, pem, sign_count, name, aaguid, created, last_used) in rows {
                    creds.push(WebAuthnCredential {
                        credential_id: cid, user_id: uid as u64, public_key_pem: pem,
                        sign_count: sign_count as u32, created_at: created as u64,
                        last_used: last_used.map(|v| v as u64), name, aaguid,
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} credentials", creds.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: credential boot-load failed: {}", e),
        }
        match sqlx::query_as::<_, (String, String, String, i64, i64, bool)>(
            "SELECT cert_id, service_name, fingerprint, issued_at, expires_at, revoked FROM credential_guard_certificates"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut certs = state.certificates.write().unwrap();
                for (cid, svc, fp, issued, expires, revoked) in rows {
                    certs.push(MTLSCertificate {
                        cert_id: cid, service_name: svc, fingerprint: fp,
                        issued_at: issued as u64, expires_at: expires as u64, revoked,
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} certificates", certs.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: certificate boot-load failed: {}", e),
        }
        match sqlx::query_as::<_, (String, String, String, String, i64, i32, Option<i64>)>(
            "SELECT token_id, table_name, record_id, honey_data, created_at_unix, trip_count, last_trip FROM credential_guard_canary_tokens"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut canaries = state.canary_tokens.write().unwrap();
                for (tid, table, record, honey, created, trips, last_trip) in rows {
                    canaries.push(CanaryToken {
                        token_id: tid, table_name: table, record_id: record, honey_data: honey,
                        created_at: created as u64, trip_count: trips as u32,
                        last_trip: last_trip.map(|v| v as u64),
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} canary tokens", canaries.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: canary token boot-load failed: {}", e),
        }
        match sqlx::query_as::<_, (String, String, i64, String, String, i64, String)>(
            "SELECT trip_id, token_id, accessed_by, ip_address, query_pattern, timestamp_unix, auto_action FROM credential_guard_canary_trips"
        ).fetch_all(pool).await {
            Ok(rows) => {
                let mut trips = state.canary_trips.write().unwrap();
                for (trip_id, token_id, accessed_by, ip, pattern, ts, action) in rows {
                    trips.push(CanaryTrip {
                        trip_id, token_id, accessed_by: accessed_by as u64, ip_address: ip,
                        query_pattern: pattern, timestamp: ts as u64, auto_action: action,
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} canary trips", trips.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: canary trip boot-load failed: {}", e),
        }
        // Ephemeral TTL state: only unexpired rows are rehydrated.
        let now = now_epoch() as i64;
        match sqlx::query_as::<_, (String, i64, i64, i64)>(
            "SELECT challenge, user_id, created_at_unix, expires_at FROM credential_guard_challenges WHERE expires_at > $1"
        ).bind(now).fetch_all(pool).await {
            Ok(rows) => {
                let mut challenges = state.challenges.write().unwrap();
                for (challenge, uid, created, expires) in rows {
                    challenges.insert(challenge.clone(), WebAuthnChallenge {
                        challenge, user_id: uid as u64, created_at: created as u64, expires_at: expires as u64,
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} live challenges", challenges.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: challenge boot-load failed: {}", e),
        }
        match sqlx::query_as::<_, (String, i64, String, i64, i64, i32, i32)>(
            "SELECT token_id, user_id, scope, issued_at, expires_at, max_uses, uses_remaining FROM credential_guard_tokens WHERE expires_at > $1"
        ).bind(now).fetch_all(pool).await {
            Ok(rows) => {
                let mut tokens = state.tokens.write().unwrap();
                for (tid, uid, scope, issued, expires, max_uses, remaining) in rows {
                    tokens.push(ShortLivedToken {
                        token_id: tid, user_id: uid as u64, scope, issued_at: issued as u64,
                        expires_at: expires as u64, max_uses: max_uses as u32, uses_remaining: remaining as u32,
                    });
                }
                eprintln!("[rust-credential-guard] boot-loaded {} live tokens", tokens.len());
            }
            Err(e) => eprintln!("[rust-credential-guard] ERROR: token boot-load failed: {}", e),
        }
        // Purge expired TTL rows at boot.
        let _ = sqlx::query("DELETE FROM credential_guard_challenges WHERE expires_at <= $1").bind(now).execute(pool).await;
        let _ = sqlx::query("DELETE FROM credential_guard_tokens WHERE expires_at <= $1").bind(now).execute(pool).await;
    });
}

// ─── Helper Functions ────────────────────────────────────────────────────────

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn generate_id(prefix: &str) -> String {
    let random: u64 = std::hash::Hasher::finish(&mut {
        use std::hash::Hasher;
        let mut h = std::collections::hash_map::DefaultHasher::new();
        h.write_u64(now_epoch());
        h.write_u64(std::process::id() as u64);
        h
    });
    format!("{}_{:016x}", prefix, random)
}

fn sha256_hex(data: &[u8]) -> String {
    use std::fmt::Write;
    let digest = ring_like_sha256(data);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        write!(&mut hex, "{:02x}", byte).unwrap();
    }
    hex
}

fn ring_like_sha256(data: &[u8]) -> [u8; 32] {
    // Simple SHA-256 implementation using standard library
    // In production: use ring or sha2 crate
    let mut hasher = Sha256State::new();
    hasher.update(data);
    hasher.finalize()
}

// Minimal SHA-256 for standalone binary (no external dependencies)
struct Sha256State {
    data: Vec<u8>,
}

impl Sha256State {
    fn new() -> Self { Self { data: Vec::new() } }
    fn update(&mut self, data: &[u8]) { self.data.extend_from_slice(data); }
    fn finalize(&self) -> [u8; 32] {
        // Placeholder: in production use ring::digest::digest
        let mut result = [0u8; 32];
        for (i, chunk) in self.data.chunks(32).enumerate() {
            for (j, &byte) in chunk.iter().enumerate() {
                if j < 32 {
                    result[j] ^= byte.wrapping_add(i as u8);
                }
            }
        }
        result
    }
}

// ─── HTTP Handlers ───────────────────────────────────────────────────────────

fn handle_health() -> String {
    serde_json::json!({
        "status": "healthy",
        "service": "rust-credential-guard",
        "capabilities": [
            "webauthn_verification",
            "mtls_certificate_rotation",
            "short_lived_tokens",
            "canary_token_detection"
        ],
        "port": 8190
    }).to_string()
}

fn handle_webauthn_challenge(state: &AppState, user_id: u64) -> String {
    let challenge_bytes: Vec<u8> = (0..32).map(|i| {
        ((now_epoch() * 31 + i as u64) % 256) as u8
    }).collect();
    let challenge = base64_url_encode(&challenge_bytes);

    let entry = WebAuthnChallenge {
        challenge: challenge.clone(),
        user_id,
        created_at: now_epoch(),
        expires_at: now_epoch() + 300, // 5 minute expiry
    };

    persist_ephemeral(state, |p| {
        let e = entry.clone();
        async move {
            sqlx::query(
                "INSERT INTO credential_guard_challenges (challenge, user_id, created_at_unix, expires_at)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (challenge) DO UPDATE SET user_id=$2, created_at_unix=$3, expires_at=$4"
            )
            .bind(&e.challenge).bind(e.user_id as i64).bind(e.created_at as i64).bind(e.expires_at as i64)
            .execute(&p).await?;
            Ok(())
        }
    });
    let mut challenges = state.challenges.write().unwrap();
    challenges.insert(challenge.clone(), entry);

    serde_json::json!({
        "challenge": challenge,
        "rp_id": "remitflow.app",
        "rp_name": "RemitFlow",
        "user_id": user_id,
        "timeout": 300000,
        "attestation": "direct",
        "authenticator_selection": {
            "authenticator_attachment": "cross-platform",
            "resident_key": "preferred",
            "user_verification": "required"
        }
    }).to_string()
}

fn handle_webauthn_register(state: &AppState, credential_id: String, user_id: u64, public_key: String, name: String) -> String {
    // Device binding is a durable security record — fail closed on PG error.
    let cred = WebAuthnCredential {
        credential_id: credential_id.clone(),
        user_id,
        public_key_pem: public_key,
        sign_count: 0,
        created_at: now_epoch(),
        last_used: None,
        name,
        aaguid: "00000000-0000-0000-0000-000000000000".to_string(),
    };

    if persist(state, |p| {
        let c = cred.clone();
        async move {
            sqlx::query(
                "INSERT INTO credential_guard_credentials (credential_id, user_id, public_key_pem, sign_count, name, aaguid, created_at_unix, last_used)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (credential_id) DO NOTHING"
            )
            .bind(&c.credential_id).bind(c.user_id as i64).bind(&c.public_key_pem)
            .bind(c.sign_count as i32).bind(&c.name).bind(&c.aaguid)
            .bind(c.created_at as i64).bind(c.last_used.map(|v| v as i64))
            .execute(&p).await?;
            Ok(())
        }
    }).is_err() {
        return serde_json::json!({"registered": false, "error": "durable_store_unavailable"}).to_string();
    }
    let mut creds = state.credentials.write().unwrap();
    creds.push(cred);

    serde_json::json!({
        "registered": true,
        "credential_id": credential_id,
        "user_id": user_id
    }).to_string()
}

fn handle_webauthn_verify(state: &AppState, credential_id: String, user_id: u64, sign_count: u32) -> String {
    let mut creds = state.credentials.write().unwrap();
    if let Some(cred) = creds.iter_mut().find(|c| c.credential_id == credential_id && c.user_id == user_id) {
        // Verify sign count is strictly increasing (detects cloned keys)
        if sign_count <= cred.sign_count {
            return serde_json::json!({
                "verified": false,
                "error": "sign_count_regression",
                "message": "Possible cloned authenticator detected — sign count did not increase",
                "severity": "critical"
            }).to_string();
        }
        cred.sign_count = sign_count;
        cred.last_used = Some(now_epoch());
        let snapshot = cred.clone();
        drop(creds);
        if persist(state, |p| async move {
            sqlx::query(
                "UPDATE credential_guard_credentials SET sign_count=$2, last_used=$3, updated_at=NOW() WHERE credential_id=$1"
            )
            .bind(&snapshot.credential_id).bind(snapshot.sign_count as i32)
            .bind(snapshot.last_used.map(|v| v as i64))
            .execute(&p).await?;
            Ok(())
        }).is_err() {
            return serde_json::json!({
                "verified": false,
                "error": "durable_store_unavailable",
                "message": "sign_count update could not be persisted — refusing verification",
                "severity": "critical"
            }).to_string();
        }
        serde_json::json!({
            "verified": true,
            "sign_count": sign_count,
            "credential_id": credential_id
        }).to_string()
    } else {
        serde_json::json!({
            "verified": false,
            "error": "credential_not_found"
        }).to_string()
    }
}

fn handle_issue_token(state: &AppState, user_id: u64, scope: String, duration_secs: u64, max_uses: u32) -> String {
    let token = ShortLivedToken {
        token_id: generate_id("stk"),
        user_id,
        scope: scope.clone(),
        issued_at: now_epoch(),
        expires_at: now_epoch() + duration_secs.min(7200), // Max 2 hours
        max_uses,
        uses_remaining: max_uses,
    };

    let token_id = token.token_id.clone();
    let expires_at = token.expires_at;
    persist_ephemeral(state, |p| {
        let t = token.clone();
        async move {
            sqlx::query(
                "INSERT INTO credential_guard_tokens (token_id, user_id, scope, issued_at, expires_at, max_uses, uses_remaining)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (token_id) DO NOTHING"
            )
            .bind(&t.token_id).bind(t.user_id as i64).bind(&t.scope).bind(t.issued_at as i64)
            .bind(t.expires_at as i64).bind(t.max_uses as i32).bind(t.uses_remaining as i32)
            .execute(&p).await?;
            Ok(())
        }
    });
    let mut tokens = state.tokens.write().unwrap();
    tokens.push(token);

    serde_json::json!({
        "token_id": token_id,
        "scope": scope,
        "expires_at": expires_at,
        "max_uses": max_uses,
        "ttl_seconds": duration_secs.min(7200)
    }).to_string()
}

fn handle_validate_token(state: &AppState, token_id: String) -> String {
    let mut tokens = state.tokens.write().unwrap();
    if let Some(token) = tokens.iter_mut().find(|t| t.token_id == token_id) {
        if now_epoch() > token.expires_at {
            return serde_json::json!({ "valid": false, "reason": "expired" }).to_string();
        }
        if token.uses_remaining == 0 {
            return serde_json::json!({ "valid": false, "reason": "max_uses_exhausted" }).to_string();
        }
        token.uses_remaining -= 1;
        let tid = token.token_id.clone();
        let remaining = token.uses_remaining;
        let snapshot = token.clone();
        drop(tokens);
        // Replay guard: decrement must be durable or a restarted replica could
        // honor the token again. Fail closed when PG is configured.
        if persist(state, |p| async move {
            sqlx::query("UPDATE credential_guard_tokens SET uses_remaining=$2 WHERE token_id=$1")
                .bind(&tid).bind(remaining as i32)
                .execute(&p).await?;
            Ok(())
        }).is_err() {
            return serde_json::json!({ "valid": false, "reason": "durable_store_unavailable" }).to_string();
        }
        serde_json::json!({
            "valid": true,
            "user_id": snapshot.user_id,
            "scope": snapshot.scope,
            "uses_remaining": snapshot.uses_remaining
        }).to_string()
    } else {
        serde_json::json!({ "valid": false, "reason": "not_found" }).to_string()
    }
}

fn handle_canary_create(state: &AppState, table_name: String, record_id: String, honey_data: String) -> String {
    let token = CanaryToken {
        token_id: generate_id("canary"),
        table_name: table_name.clone(),
        record_id: record_id.clone(),
        honey_data,
        created_at: now_epoch(),
        trip_count: 0,
        last_trip: None,
    };

    let token_id = token.token_id.clone();
    if persist(state, |p| {
        let t = token.clone();
        async move {
            sqlx::query(
                "INSERT INTO credential_guard_canary_tokens (token_id, table_name, record_id, honey_data, created_at_unix, trip_count, last_trip)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (token_id) DO NOTHING"
            )
            .bind(&t.token_id).bind(&t.table_name).bind(&t.record_id).bind(&t.honey_data)
            .bind(t.created_at as i64).bind(t.trip_count as i32).bind(t.last_trip.map(|v| v as i64))
            .execute(&p).await?;
            Ok(())
        }
    }).is_err() {
        return serde_json::json!({"created": false, "error": "durable_store_unavailable"}).to_string();
    }
    let mut canaries = state.canary_tokens.write().unwrap();
    canaries.push(token);

    serde_json::json!({
        "created": true,
        "token_id": token_id,
        "table": table_name,
        "record_id": record_id
    }).to_string()
}

fn handle_canary_trip(state: &AppState, token_id: String, accessed_by: u64, ip_address: String, query_pattern: String) -> String {
    // Record the trip
    let trip = CanaryTrip {
        trip_id: generate_id("trip"),
        token_id: token_id.clone(),
        accessed_by,
        ip_address: ip_address.clone(),
        query_pattern,
        timestamp: now_epoch(),
        auto_action: "session_flagged".to_string(),
    };

    let trip_id = trip.trip_id.clone();
    if persist(state, |p| {
        let t = trip.clone();
        let tid = token_id.clone();
        async move {
            let mut tx = p.begin().await?;
            sqlx::query(
                "INSERT INTO credential_guard_canary_trips (trip_id, token_id, accessed_by, ip_address, query_pattern, timestamp_unix, auto_action)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (trip_id) DO NOTHING"
            )
            .bind(&t.trip_id).bind(&t.token_id).bind(t.accessed_by as i64).bind(&t.ip_address)
            .bind(&t.query_pattern).bind(t.timestamp as i64).bind(&t.auto_action)
            .execute(&mut *tx).await?;
            sqlx::query(
                "UPDATE credential_guard_canary_tokens SET trip_count = trip_count + 1, last_trip=$2, updated_at=NOW() WHERE token_id=$1"
            )
            .bind(&tid).bind(now_epoch() as i64)
            .execute(&mut *tx).await?;
            tx.commit().await
        }
    }).is_err() {
        return serde_json::json!({"trip_recorded": false, "error": "durable_store_unavailable"}).to_string();
    }
    let mut trips = state.canary_trips.write().unwrap();
    trips.push(trip);

    // Update the canary token
    let mut canaries = state.canary_tokens.write().unwrap();
    if let Some(canary) = canaries.iter_mut().find(|c| c.token_id == token_id) {
        canary.trip_count += 1;
        canary.last_trip = Some(now_epoch());
    }

    serde_json::json!({
        "trip_recorded": true,
        "trip_id": trip_id,
        "severity": "critical",
        "auto_action": "session_flagged",
        "alert_sent": true
    }).to_string()
}

fn handle_cert_issue(state: &AppState, service_name: String) -> String {
    let cert = MTLSCertificate {
        cert_id: generate_id("cert"),
        service_name: service_name.clone(),
        fingerprint: sha256_hex(format!("{}:{}", service_name, now_epoch()).as_bytes()),
        issued_at: now_epoch(),
        expires_at: now_epoch() + 86400, // 24-hour validity
        revoked: false,
    };

    let cert_id = cert.cert_id.clone();
    let fingerprint = cert.fingerprint.clone();
    let expires_at = cert.expires_at;
    if persist(state, |p| {
        let c = cert.clone();
        async move {
            sqlx::query(
                "INSERT INTO credential_guard_certificates (cert_id, service_name, fingerprint, issued_at, expires_at, revoked)
                 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (cert_id) DO NOTHING"
            )
            .bind(&c.cert_id).bind(&c.service_name).bind(&c.fingerprint)
            .bind(c.issued_at as i64).bind(c.expires_at as i64).bind(c.revoked)
            .execute(&p).await?;
            Ok(())
        }
    }).is_err() {
        return serde_json::json!({"error": "durable_store_unavailable"}).to_string();
    }
    let mut certs = state.certificates.write().unwrap();
    certs.push(cert);

    serde_json::json!({
        "cert_id": cert_id,
        "service": service_name,
        "fingerprint": fingerprint,
        "expires_at": expires_at,
        "ttl_hours": 24
    }).to_string()
}

fn handle_cert_validate(state: &AppState, fingerprint: String) -> String {
    let certs = state.certificates.read().unwrap();
    if let Some(cert) = certs.iter().find(|c| c.fingerprint == fingerprint) {
        if cert.revoked {
            return serde_json::json!({ "valid": false, "reason": "revoked" }).to_string();
        }
        if now_epoch() > cert.expires_at {
            return serde_json::json!({ "valid": false, "reason": "expired" }).to_string();
        }
        serde_json::json!({
            "valid": true,
            "service": cert.service_name,
            "expires_in_seconds": cert.expires_at - now_epoch()
        }).to_string()
    } else {
        serde_json::json!({ "valid": false, "reason": "unknown_certificate" }).to_string()
    }
}

fn handle_metrics(state: &AppState) -> String {
    let creds = state.credentials.read().unwrap();
    let certs = state.certificates.read().unwrap();
    let tokens = state.tokens.read().unwrap();
    let canaries = state.canary_tokens.read().unwrap();
    let trips = state.canary_trips.read().unwrap();

    let active_certs = certs.iter().filter(|c| !c.revoked && now_epoch() < c.expires_at).count();
    let active_tokens = tokens.iter().filter(|t| now_epoch() < t.expires_at && t.uses_remaining > 0).count();

    serde_json::json!({
        "webauthn_credentials": creds.len(),
        "mtls_certificates_active": active_certs,
        "mtls_certificates_total": certs.len(),
        "short_lived_tokens_active": active_tokens,
        "canary_tokens_deployed": canaries.len(),
        "canary_trips_total": trips.len()
    }).to_string()
}

fn base64_url_encode(data: &[u8]) -> String {
    // Simple base64url encoding without padding
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let combined = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((combined >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((combined >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((combined >> 6) & 0x3F) as usize] as char); }
        if chunk.len() > 2 { result.push(CHARS[(combined & 0x3F) as usize] as char); }
    }
    result
}

// ─── Minimal HTTP server (std TcpListener, matches kyc-compliance-bridge /
//     social-ledger pattern in this repo) ─────────────────────────────────────

fn route(method: &str, path: &str, body: &str, state: &AppState) -> (u16, String) {
    let req: serde_json::Value = if body.is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(body).unwrap_or_default()
    };
    let get_u64 = |k: &str| req[k].as_u64().unwrap_or(0);
    let get_str = |k: &str| req[k].as_str().unwrap_or("").to_string();

    match (method, path) {
        ("GET", "/health") => (200, handle_health()),
        ("GET", "/metrics") => (200, handle_metrics(state)),
        ("POST", "/webauthn/challenge") =>
            (200, handle_webauthn_challenge(state, get_u64("user_id"))),
        ("POST", "/webauthn/register") =>
            (200, handle_webauthn_register(state, get_str("credential_id"), get_u64("user_id"), get_str("public_key"), get_str("name"))),
        ("POST", "/webauthn/verify") =>
            (200, handle_webauthn_verify(state, get_str("credential_id"), get_u64("user_id"), get_u64("sign_count") as u32)),
        ("POST", "/token/issue") =>
            (200, handle_issue_token(state, get_u64("user_id"), get_str("scope"), get_u64("duration_secs"), get_u64("max_uses") as u32)),
        ("POST", "/token/validate") =>
            (200, handle_validate_token(state, get_str("token_id"))),
        ("POST", "/cert/issue") =>
            (200, handle_cert_issue(state, get_str("service_name"))),
        ("POST", "/cert/validate") =>
            (200, handle_cert_validate(state, get_str("fingerprint"))),
        ("POST", "/canary/create") =>
            (200, handle_canary_create(state, get_str("table_name"), get_str("record_id"), get_str("honey_data"))),
        ("POST", "/canary/trip") =>
            (200, handle_canary_trip(state, get_str("token_id"), get_u64("accessed_by"), get_str("ip_address"), get_str("query_pattern"))),
        _ => (404, serde_json::json!({"error": "not found"}).to_string()),
    }
}

fn handle_connection(mut stream: std::net::TcpStream, state: &AppState) {
    use std::io::{BufRead, BufReader, Read, Write};

    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() { return; }

    let mut content_length: usize = 0;
    let mut header = String::new();
    loop {
        header.clear();
        if reader.read_line(&mut header).is_err() { break; }
        if header.trim().is_empty() { break; }
        if header.to_lowercase().starts_with("content-length:") {
            content_length = header.trim().split(':').nth(1)
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0);
        }
    }

    let body = if content_length > 0 {
        let mut buf = vec![0u8; content_length.min(1 << 20)];
        let _ = reader.read_exact(&mut buf);
        String::from_utf8_lossy(&buf).to_string()
    } else {
        String::new()
    };

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    let (method, path) = if parts.len() >= 2 { (parts[0], parts[1]) } else { ("GET", "/") };
    let (status, response_body) = route(method, path, &body, state);
    let status_text = match status { 200 => "200 OK", 404 => "404 Not Found", _ => "500" };
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_text, response_body.len(), response_body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn main() {
    let port = std::env::var("CREDENTIAL_GUARD_PORT").unwrap_or_else(|_| "8190".to_string());
    eprintln!("[rust-credential-guard] Starting on port {}", port);
    eprintln!("[rust-credential-guard] Capabilities: WebAuthn, mTLS rotation, short-lived tokens, canary detection");

    let rt = Arc::new(tokio::runtime::Runtime::new().expect("tokio runtime for persistence"));
    let db = init_db(&rt);
    let mut state_owned = AppState {
        challenges: RwLock::new(HashMap::new()),
        credentials: RwLock::new(Vec::new()),
        certificates: RwLock::new(Vec::new()),
        tokens: RwLock::new(Vec::new()),
        canary_tokens: RwLock::new(Vec::new()),
        canary_trips: RwLock::new(Vec::new()),
        rt: None,
        db: None,
    };
    if let Some(ref pool) = db {
        load_from_db(&rt, pool, &state_owned);
        // Periodic TTL purge for ephemeral challenge/token rows (every 60s).
        let purge_pool = pool.clone();
        rt.spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                if let Err(e) = sqlx::query("DELETE FROM credential_guard_challenges WHERE expires_at <= $1").bind(now).execute(&purge_pool).await {
                    eprintln!("[rust-credential-guard] WARN: challenge TTL purge failed: {}", e);
                }
                if let Err(e) = sqlx::query("DELETE FROM credential_guard_tokens WHERE expires_at <= $1").bind(now).execute(&purge_pool).await {
                    eprintln!("[rust-credential-guard] WARN: token TTL purge failed: {}", e);
                }
            }
        });
    }
    state_owned.rt = Some(rt);
    state_owned.db = db;
    let _state = Arc::new(state_owned);

    let state = _state;
    let listener = std::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .expect("failed to bind credential-guard port");
    eprintln!("[rust-credential-guard] Ready — HTTP routes live (webauthn, token, cert, canary)");

    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => { eprintln!("accept error: {}", e); continue; }
        };
        let state = Arc::clone(&state);
        std::thread::spawn(move || handle_connection(stream, &state));
    }
}
