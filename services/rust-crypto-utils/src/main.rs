/*!
 * RemitFlow — Crypto Utilities Service (Rust)
 * ═════════════════════════════════════════════
 * Provides cryptographic primitives as an internal HTTP service.
 * The Node.js API layer calls this service for all sensitive operations
 * rather than implementing crypto in JavaScript.
 *
 * Why Rust:
 *   - Constant-time comparisons prevent timing attacks
 *   - Zeroize clears secrets from memory after use
 *   - No GC means no secret leakage via heap dumps
 *   - RustCrypto crates are audited and widely trusted
 *
 * Endpoints:
 *   POST /encrypt          — AES-256-GCM encrypt a payload
 *   POST /decrypt          — AES-256-GCM decrypt a payload
 *   POST /hmac             — Compute HMAC-SHA256
 *   POST /verify-hmac      — Constant-time HMAC verification
 *   POST /derive-key       — HKDF key derivation
 *   POST /idempotency-key  — Generate a cryptographically secure idempotency key
 *   POST /hash             — SHA-256 / SHA-512 hash
 *   GET  /health           — Liveness probe
 */

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use std::{net::SocketAddr, sync::Arc};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};
use uuid::Uuid;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EncryptRequest {
    pub plaintext: String, // base64-encoded
    pub key_id: Option<String>,
    pub aad: Option<String>, // additional authenticated data
}

#[derive(Serialize)]
pub struct EncryptResponse {
    pub ciphertext: String, // base64-encoded (nonce || ciphertext || tag)
    pub key_id: Option<String>,
    pub algorithm: String,
}

#[derive(Deserialize)]
pub struct DecryptRequest {
    pub ciphertext: String, // base64-encoded
    pub key_id: Option<String>,
    pub aad: Option<String>,
}

#[derive(Serialize)]
pub struct DecryptResponse {
    pub plaintext: String, // base64-encoded
}

#[derive(Deserialize)]
pub struct HmacRequest {
    pub message: String,
    pub key: Option<String>, // base64-encoded; if absent, uses master key
}

#[derive(Serialize)]
pub struct HmacResponse {
    pub mac: String, // hex-encoded
    pub algorithm: String,
}

#[derive(Deserialize)]
pub struct VerifyHmacRequest {
    pub message: String,
    pub mac: String,   // hex-encoded
    pub key: Option<String>,
}

#[derive(Serialize)]
pub struct VerifyHmacResponse {
    pub valid: bool,
}

#[derive(Deserialize)]
pub struct DeriveKeyRequest {
    pub ikm: String,   // input key material, base64
    pub salt: Option<String>, // base64
    pub info: String,  // context string
    pub length: Option<usize>, // output length in bytes, default 32
}

#[derive(Serialize)]
pub struct DeriveKeyResponse {
    pub key: String, // base64-encoded
    pub length: usize,
}

#[derive(Deserialize)]
pub struct HashRequest {
    pub data: String,
    pub algorithm: Option<String>, // "sha256" | "sha512", default "sha256"
}

#[derive(Serialize)]
pub struct HashResponse {
    pub hash: String, // hex-encoded
    pub algorithm: String,
}

#[derive(Deserialize)]
pub struct IdempotencyKeyRequest {
    pub prefix: Option<String>,
    pub user_id: Option<i64>,
    pub operation: Option<String>,
}

#[derive(Serialize)]
pub struct IdempotencyKeyResponse {
    pub key: String,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

// ─── App State ────────────────────────────────────────────────────────────────

pub struct AppState {
    /// Master encryption key (32 bytes for AES-256)
    master_key: Zeroizing<[u8; 32]>,
    /// Master HMAC key
    hmac_key: Zeroizing<Vec<u8>>,
}

impl AppState {
    pub fn new(master_key_hex: &str, hmac_key_hex: &str) -> anyhow::Result<Self> {
        let key_bytes = hex::decode(master_key_hex)
            .map_err(|e| anyhow::anyhow!("Invalid master key hex: {}", e))?;
        if key_bytes.len() != 32 {
            anyhow::bail!("Master key must be exactly 32 bytes (256 bits)");
        }
        let mut master_key = Zeroizing::new([0u8; 32]);
        master_key.copy_from_slice(&key_bytes);

        let hmac_key = Zeroizing::new(
            hex::decode(hmac_key_hex)
                .map_err(|e| anyhow::anyhow!("Invalid HMAC key hex: {}", e))?,
        );

        Ok(Self { master_key, hmac_key })
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn encrypt(
    State(state): State<Arc<AppState>>,
    Json(req): Json<EncryptRequest>,
) -> impl IntoResponse {
    let plaintext = match B64.decode(&req.plaintext) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid base64 plaintext" })),
            );
        }
    };

    let key = Key::<Aes256Gcm>::from_slice(&*state.master_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let aad = req.aad.as_deref().unwrap_or("").as_bytes().to_vec();

    let ciphertext = match cipher.encrypt(&nonce, aes_gcm::aead::Payload {
        msg: &plaintext,
        aad: &aad,
    }) {
        Ok(c) => c,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Encryption failed" })),
            );
        }
    };

    // Output: nonce (12 bytes) || ciphertext+tag
    let mut output = nonce.to_vec();
    output.extend_from_slice(&ciphertext);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ciphertext": B64.encode(&output),
            "key_id": req.key_id,
            "algorithm": "AES-256-GCM"
        })),
    )
}

async fn decrypt(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DecryptRequest>,
) -> impl IntoResponse {
    let data = match B64.decode(&req.ciphertext) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid base64 ciphertext" })),
            );
        }
    };

    if data.len() < 12 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Ciphertext too short" })),
        );
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(&*state.master_key);
    let cipher = Aes256Gcm::new(key);
    let aad = req.aad.as_deref().unwrap_or("").as_bytes().to_vec();

    match cipher.decrypt(nonce, aes_gcm::aead::Payload {
        msg: ciphertext,
        aad: &aad,
    }) {
        Ok(plaintext) => (
            StatusCode::OK,
            Json(serde_json::json!({ "plaintext": B64.encode(&plaintext) })),
        ),
        Err(_) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "error": "Decryption failed — invalid key or tampered data" })),
        ),
    }
}

async fn compute_hmac(
    State(state): State<Arc<AppState>>,
    Json(req): Json<HmacRequest>,
) -> impl IntoResponse {
    let key = if let Some(k) = &req.key {
        match B64.decode(k) {
            Ok(b) => b,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Invalid base64 key" })),
                );
            }
        }
    } else {
        state.hmac_key.clone()
    };

    let mut mac = HmacSha256::new_from_slice(&key)
        .expect("HMAC accepts any key length");
    mac.update(req.message.as_bytes());
    let result = mac.finalize();
    let mac_bytes = result.into_bytes();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "mac": hex::encode(mac_bytes),
            "algorithm": "HMAC-SHA256"
        })),
    )
}

async fn verify_hmac_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyHmacRequest>,
) -> impl IntoResponse {
    let key = if let Some(k) = &req.key {
        match B64.decode(k) {
            Ok(b) => b,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Invalid base64 key" })),
                );
            }
        }
    } else {
        state.hmac_key.clone()
    };

    let expected = match hex::decode(&req.mac) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid hex MAC" })),
            );
        }
    };

    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC accepts any key length");
    mac.update(req.message.as_bytes());

    let valid = mac.verify_slice(&expected).is_ok();
    if !valid {
        warn!("HMAC verification failed");
    }

    (StatusCode::OK, Json(serde_json::json!({ "valid": valid })))
}

async fn derive_key(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<DeriveKeyRequest>,
) -> impl IntoResponse {
    let ikm = match B64.decode(&req.ikm) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid base64 IKM" })),
            );
        }
    };

    let salt = req.salt.as_deref().and_then(|s| B64.decode(s).ok());
    let length = req.length.unwrap_or(32).min(64);

    let hk = Hkdf::<Sha256>::new(salt.as_deref(), &ikm);
    let mut okm = vec![0u8; length];

    if hk.expand(req.info.as_bytes(), &mut okm).is_err() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Key derivation failed — output too long" })),
        );
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "key": B64.encode(&okm),
            "length": length
        })),
    )
}

async fn hash_data(
    Json(req): Json<HashRequest>,
) -> impl IntoResponse {
    let algorithm = req.algorithm.as_deref().unwrap_or("sha256");

    let hash = match algorithm {
        "sha256" => {
            let mut h = Sha256::new();
            h.update(req.data.as_bytes());
            hex::encode(h.finalize())
        }
        "sha512" => {
            let mut h = Sha512::new();
            h.update(req.data.as_bytes());
            hex::encode(h.finalize())
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Unsupported algorithm. Use sha256 or sha512" })),
            );
        }
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({ "hash": hash, "algorithm": algorithm })),
    )
}

async fn generate_idempotency_key(
    Json(req): Json<IdempotencyKeyRequest>,
) -> impl IntoResponse {
    // UUIDv7 provides time-ordered, globally unique keys
    let uuid = Uuid::now_v7();
    let prefix = req.prefix.as_deref().unwrap_or("rf");
    let user_part = req.user_id.map(|u| format!("u{u}")).unwrap_or_default();
    let op_part = req.operation.as_deref().unwrap_or("op");

    let key = format!("{prefix}_{user_part}_{op_part}_{uuid}");

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "key": key,
            "timestamp": Utc::now().to_rfc3339()
        })),
    )
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "crypto-utils",
        "algorithms": ["AES-256-GCM", "HMAC-SHA256", "HKDF-SHA256", "SHA-256", "SHA-512"],
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("crypto_utils=info".parse()?),
        )
        .init();

    // Generate random keys if not set (dev only — production MUST set these)
    let master_key_hex = std::env::var("CRYPTO_MASTER_KEY").unwrap_or_else(|_| {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let hex_key = hex::encode(key);
        warn!("CRYPTO_MASTER_KEY not set — using ephemeral key (NOT for production)");
        hex_key
    });

    let hmac_key_hex = std::env::var("CRYPTO_HMAC_KEY").unwrap_or_else(|_| {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        hex::encode(key)
    });

    let port: u16 = std::env::var("CRYPTO_UTILS_PORT")
        .unwrap_or_else(|_| "8202".to_string())
        .parse()?;

    let state = Arc::new(AppState::new(&master_key_hex, &hmac_key_hex)?);

    let app = Router::new()
        .route("/encrypt", post(encrypt))
        .route("/decrypt", post(decrypt))
        .route("/hmac", post(compute_hmac))
        .route("/verify-hmac", post(verify_hmac_handler))
        .route("/derive-key", post(derive_key))
        .route("/hash", post(hash_data))
        .route("/idempotency-key", post(generate_idempotency_key))
        .route("/health", get(health))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Crypto utils service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
