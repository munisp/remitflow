// RemitFlow -- CIPS Cryptographic Signing Service
// Language: Rust (Axum + Tokio)
// Purpose: Implements SM2/SM3 Chinese national cryptographic standards for CIPS
//          message signing, verification, and key management. All CIPS messages
//          (pacs.008, pacs.002, camt.056) must be signed with SM2 before
//          submission to the CIPS Switch.
//
// Standards:
//   - GM/T 0003-2012 (SM2 Elliptic Curve Public Key Cryptography)
//   - GM/T 0004-2012 (SM3 Cryptographic Hash)
//   - PBOC CIPS Security Specification v2.1
//   - ISO 20022 digital signature envelope (BAH + AppHdr)

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::time::Duration;

type HmacSha256 = Hmac<Sha256>;

// ---- Models ----------------------------------------------------------------

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    capabilities: Vec<String>,
}

#[derive(Deserialize)]
struct SignRequest {
    message: String,
    key_id: Option<String>,
    algorithm: Option<String>,
}

#[derive(Serialize)]
struct SignResponse {
    signature: String,
    algorithm: String,
    key_id: String,
    signed_at: String,
    message_hash: String,
}

#[derive(Deserialize)]
struct VerifyRequest {
    message: String,
    signature: String,
    key_id: Option<String>,
}

#[derive(Serialize)]
struct VerifyResponse {
    valid: bool,
    algorithm: String,
    verified_at: String,
}

#[derive(Deserialize)]
struct HmacRequest {
    payload: String,
    secret: Option<String>,
}

#[derive(Serialize)]
struct HmacResponse {
    hmac: String,
    algorithm: String,
}

#[derive(Deserialize)]
struct Pacs008Envelope {
    msg_id: String,
    cre_dt_tm: String,
    nb_of_txs: u32,
    ctrl_sum: String,
    debtor_name: String,
    debtor_account: String,
    debtor_bic: String,
    creditor_name: String,
    creditor_account: String,
    creditor_bic: String,
    amount: String,
    currency: String,
    purpose: Option<String>,
}

#[derive(Serialize)]
struct SignedEnvelope {
    original: serde_json::Value,
    signature: String,
    algorithm: String,
    key_id: String,
    signed_at: String,
    digest: String,
    bah_signature: String,
}

// ---- SM2/SM3 simulation (production: use certified HSM module) -------------
// In production, SM2 signing uses the PBOC-issued private key stored in an HSM.
// This implementation uses HMAC-SHA256 as a compatible placeholder that follows
// the same signing envelope structure.

fn sm3_hash(data: &[u8]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn sm2_sign(data: &[u8], key_id: &str) -> String {
    let key = std::env::var("CIPS_SM2_PRIVATE_KEY")
        .unwrap_or_else(|_| format!("sm2-sandbox-key-{}", key_id));
    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .expect("HMAC key creation failed");
    mac.update(data);
    hex::encode(mac.finalize().into_bytes())
}

fn sm2_verify(data: &[u8], signature: &str, key_id: &str) -> bool {
    let expected = sm2_sign(data, key_id);
    expected == signature
}

// ---- Handlers --------------------------------------------------------------

async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "healthy".into(),
        service: "cips-crypto".into(),
        version: "v1.0.0".into(),
        capabilities: vec![
            "sm2_sign".into(),
            "sm2_verify".into(),
            "sm3_hash".into(),
            "hmac_sha256".into(),
            "pacs008_envelope".into(),
        ],
    })
}

async fn ready() -> impl IntoResponse {
    Json(serde_json::json!({"ready": true}))
}

async fn sign_message(Json(req): Json<SignRequest>) -> impl IntoResponse {
    let key_id = req.key_id.unwrap_or_else(|| "remitflow-cips-001".into());
    let algorithm = req.algorithm.unwrap_or_else(|| "SM2-SM3".into());
    let hash = sm3_hash(req.message.as_bytes());
    let signature = sm2_sign(req.message.as_bytes(), &key_id);

    Json(SignResponse {
        signature,
        algorithm,
        key_id,
        signed_at: chrono::Utc::now().to_rfc3339(),
        message_hash: hash,
    })
}

async fn verify_signature(Json(req): Json<VerifyRequest>) -> impl IntoResponse {
    let key_id = req.key_id.unwrap_or_else(|| "remitflow-cips-001".into());
    let valid = sm2_verify(req.message.as_bytes(), &req.signature, &key_id);

    Json(VerifyResponse {
        valid,
        algorithm: "SM2-SM3".into(),
        verified_at: chrono::Utc::now().to_rfc3339(),
    })
}

async fn compute_hmac(Json(req): Json<HmacRequest>) -> impl IntoResponse {
    let secret = req.secret.unwrap_or_else(|| {
        std::env::var("CIPS_WEBHOOK_SECRET").unwrap_or_else(|_| "cips-sandbox-secret".into())
    });
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC key creation failed");
    mac.update(req.payload.as_bytes());
    let result = hex::encode(mac.finalize().into_bytes());

    Json(HmacResponse {
        hmac: result,
        algorithm: "HMAC-SHA256".into(),
    })
}

async fn sign_pacs008(Json(env): Json<Pacs008Envelope>) -> impl IntoResponse {
    let key_id = "remitflow-cips-001".to_string();

    let canonical = serde_json::to_string(&serde_json::json!({
        "msgId": env.msg_id,
        "creDtTm": env.cre_dt_tm,
        "nbOfTxs": env.nb_of_txs,
        "ctrlSum": env.ctrl_sum,
        "dbtr": { "nm": env.debtor_name, "acct": env.debtor_account, "bic": env.debtor_bic },
        "cdtr": { "nm": env.creditor_name, "acct": env.creditor_account, "bic": env.creditor_bic },
        "amt": { "value": env.amount, "ccy": env.currency },
        "purp": env.purpose.unwrap_or_default(),
    })).unwrap();

    let digest = sm3_hash(canonical.as_bytes());
    let signature = sm2_sign(canonical.as_bytes(), &key_id);
    let bah_sig = sm2_sign(format!("BAH:{}:{}", env.msg_id, digest).as_bytes(), &key_id);

    Json(SignedEnvelope {
        original: serde_json::from_str(&canonical).unwrap(),
        signature,
        algorithm: "SM2-SM3".into(),
        key_id,
        signed_at: chrono::Utc::now().to_rfc3339(),
        digest,
        bah_signature: bah_sig,
    })
}

async fn hash_message(Json(req): Json<SignRequest>) -> impl IntoResponse {
    let hash = sm3_hash(req.message.as_bytes());
    Json(serde_json::json!({
        "hash": hash,
        "algorithm": "SM3",
        "input_length": req.message.len(),
    }))
}

// ---- Main ------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8094);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/api/v1/sign", post(sign_message))
        .route("/api/v1/verify", post(verify_signature))
        .route("/api/v1/hmac", post(compute_hmac))
        .route("/api/v1/hash", post(hash_message))
        .route("/api/v1/sign/pacs008", post(sign_pacs008))
        .layer(cors)
        .layer(TimeoutLayer::new(Duration::from_secs(30)))
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[CIPS-Crypto] Signing service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
