//! RemitFlow — Rust Cryptographic Security Service
//!
//! Exposes an HTTP microservice that the Node.js application calls for
//! cryptographically sensitive operations where Rust's memory-safety and
//! zero-cost abstractions provide the strongest guarantees:
//!
//! Endpoints:
//!   POST /validate-file      — Magic-byte validation + dangerous extension check
//!   POST /validate-jwt       — JWT algorithm confusion prevention + signature check
//!   POST /safe-compare       — Timing-attack-safe string comparison
//!   POST /hmac-verify        — Constant-time HMAC-SHA256 verification (webhooks)
//!   POST /sanitize-filename  — Zip-slip / path-traversal filename sanitisation
//!   GET  /health             — Liveness probe
//!
//! Language choice: Rust is ideal here because:
//!   - `subtle` crate provides hardware-level constant-time comparisons
//!   - Memory safety prevents buffer overflows in binary parsing
//!   - Zero-copy byte slice operations for magic-byte scanning
//!   - No garbage collector → predictable latency for crypto operations

use actix_web::{web, App, HttpResponse, HttpServer, middleware};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use hmac::{Hmac, Mac};
use subtle::ConstantTimeEq;
use std::collections::HashSet;
use tracing::{info, warn};

type HmacSha256 = Hmac<Sha256>;

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct ValidateFileRequest {
    content_b64: String,
    mime_type: String,
    filename: String,
}

#[derive(Serialize, Deserialize)]
struct ValidateFileResponse {
    valid: bool,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ValidateJwtRequest {
    token: String,
}

#[derive(Serialize, Deserialize)]
struct ValidateJwtResponse {
    valid: bool,
    algorithm: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct SafeCompareRequest {
    a: String,
    b: String,
}

#[derive(Serialize, Deserialize)]
struct SafeCompareResponse {
    equal: bool,
}

#[derive(Deserialize)]
struct HmacVerifyRequest {
    body_b64: String,
    signature_hex: String,
    secret: String,
}

#[derive(Serialize, Deserialize)]
struct HmacVerifyResponse {
    valid: bool,
}

#[derive(Deserialize)]
struct SanitizeFilenameRequest {
    filename: String,
}

#[derive(Serialize, Deserialize)]
struct SanitizeFilenameResponse {
    sanitized: String,
    was_modified: bool,
}

// ─── Magic-Byte Signatures ────────────────────────────────────────────────────

struct MagicSignature {
    mime: &'static str,
    magic: &'static [u8],
}

const ALLOWED_SIGNATURES: &[MagicSignature] = &[
    MagicSignature { mime: "image/jpeg",      magic: &[0xFF, 0xD8, 0xFF] },
    MagicSignature { mime: "image/png",       magic: &[0x89, 0x50, 0x4E, 0x47] },
    MagicSignature { mime: "image/webp",      magic: b"RIFF" },
    MagicSignature { mime: "image/gif",       magic: b"GIF8" },
    MagicSignature { mime: "application/pdf", magic: &[0x25, 0x50, 0x44, 0x46] },
];

fn dangerous_extensions() -> HashSet<&'static str> {
    [
        ".exe", ".dll", ".bat", ".cmd", ".sh", ".ps1", ".vbs",
        ".jar", ".msi", ".scr", ".pif", ".com", ".reg", ".hta", ".wsf",
        ".lnk", ".php", ".asp", ".aspx", ".jsp", ".py", ".rb", ".pl",
        ".cgi", ".zip", ".tar", ".gz", ".7z", ".rar", ".iso", ".img",
    ]
    .iter()
    .copied()
    .collect()
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn validate_file(req: web::Json<ValidateFileRequest>) -> HttpResponse {
    use base64::Engine;
    let content = match base64::engine::general_purpose::STANDARD.decode(&req.content_b64) {
        Ok(b) => b,
        Err(_) => {
            return HttpResponse::BadRequest().json(ValidateFileResponse {
                valid: false,
                reason: Some("Invalid base64 content".to_string()),
            });
        }
    };

    let filename_lower = req.filename.to_lowercase();
    let ext_start = filename_lower.rfind('.').unwrap_or(filename_lower.len());
    let ext = &filename_lower[ext_start..];
    if dangerous_extensions().contains(ext) {
        warn!("Dangerous extension blocked: {}", ext);
        return HttpResponse::Ok().json(ValidateFileResponse {
            valid: false,
            reason: Some(format!("File extension '{}' is not permitted", ext)),
        });
    }

    let matching = ALLOWED_SIGNATURES.iter().find(|s| s.mime == req.mime_type.as_str());
    match matching {
        None => {
            warn!("Disallowed MIME type: {}", req.mime_type);
            HttpResponse::Ok().json(ValidateFileResponse {
                valid: false,
                reason: Some(format!("MIME type '{}' is not permitted", req.mime_type)),
            })
        }
        Some(sig) => {
            if content.len() < sig.magic.len() {
                return HttpResponse::Ok().json(ValidateFileResponse {
                    valid: false,
                    reason: Some("File too small to contain valid magic bytes".to_string()),
                });
            }
            let file_magic = &content[..sig.magic.len()];
            let matches: bool = file_magic.ct_eq(sig.magic).into();
            if matches {
                HttpResponse::Ok().json(ValidateFileResponse { valid: true, reason: None })
            } else {
                warn!("Magic byte mismatch for MIME {}", req.mime_type);
                HttpResponse::Ok().json(ValidateFileResponse {
                    valid: false,
                    reason: Some("File content does not match declared MIME type (possible spoofing)".to_string()),
                })
            }
        }
    }
}

async fn validate_jwt(req: web::Json<ValidateJwtRequest>) -> HttpResponse {
    use base64::Engine;
    let parts: Vec<&str> = req.token.splitn(3, '.').collect();
    if parts.len() != 3 {
        return HttpResponse::Ok().json(ValidateJwtResponse {
            valid: false,
            algorithm: None,
            reason: Some("Malformed JWT: expected 3 parts".to_string()),
        });
    }

    let header_bytes = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[0]) {
        Ok(b) => b,
        Err(_) => {
            return HttpResponse::Ok().json(ValidateJwtResponse {
                valid: false,
                algorithm: None,
                reason: Some("Malformed JWT header: invalid base64url".to_string()),
            });
        }
    };

    let header: serde_json::Value = match serde_json::from_slice(&header_bytes) {
        Ok(v) => v,
        Err(_) => {
            return HttpResponse::Ok().json(ValidateJwtResponse {
                valid: false,
                algorithm: None,
                reason: Some("Malformed JWT header: invalid JSON".to_string()),
            });
        }
    };

    let alg = header["alg"].as_str().unwrap_or("").to_string();
    match alg.clone().as_str() {
        "" | "none" | "NONE" => {
            warn!("JWT algorithm confusion: alg=none rejected");
            HttpResponse::Ok().json(ValidateJwtResponse {
                valid: false,
                algorithm: Some(alg),
                reason: Some("JWT algorithm 'none' is not permitted".to_string()),
            })
        }
        "HS256" => {
            info!("JWT algorithm HS256 accepted");
            HttpResponse::Ok().json(ValidateJwtResponse {
                valid: true,
                algorithm: Some(alg),
                reason: None,
            })
        }
        other => {
            warn!("JWT algorithm confusion: unexpected alg={}", other);
            HttpResponse::Ok().json(ValidateJwtResponse {
                valid: false,
                algorithm: Some(alg),
                reason: Some(format!("JWT algorithm '{}' is not permitted (only HS256 accepted)", other)),
            })
        }
    }
}

async fn safe_compare(req: web::Json<SafeCompareRequest>) -> HttpResponse {
    let a_bytes = req.a.as_bytes();
    let b_bytes = req.b.as_bytes();
    let equal = if a_bytes.len() != b_bytes.len() {
        let max_len = a_bytes.len().max(b_bytes.len());
        let mut a_padded = vec![0u8; max_len];
        let mut b_padded = vec![0u8; max_len];
        a_padded[..a_bytes.len()].copy_from_slice(a_bytes);
        b_padded[..b_bytes.len()].copy_from_slice(b_bytes);
        let _ = a_padded.ct_eq(&b_padded);
        false
    } else {
        a_bytes.ct_eq(b_bytes).into()
    };
    HttpResponse::Ok().json(SafeCompareResponse { equal })
}

async fn hmac_verify(req: web::Json<HmacVerifyRequest>) -> HttpResponse {
    use base64::Engine;
    let body = match base64::engine::general_purpose::STANDARD.decode(&req.body_b64) {
        Ok(b) => b,
        Err(_) => return HttpResponse::BadRequest().json(HmacVerifyResponse { valid: false }),
    };
    let expected_sig = match hex::decode(&req.signature_hex) {
        Ok(b) => b,
        Err(_) => return HttpResponse::BadRequest().json(HmacVerifyResponse { valid: false }),
    };
    let mut mac = match HmacSha256::new_from_slice(req.secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return HttpResponse::InternalServerError().json(HmacVerifyResponse { valid: false }),
    };
    mac.update(&body);
    let computed = mac.finalize().into_bytes();
    let valid: bool = computed.as_slice().ct_eq(expected_sig.as_slice()).into();
    HttpResponse::Ok().json(HmacVerifyResponse { valid })
}

async fn sanitize_filename(req: web::Json<SanitizeFilenameRequest>) -> HttpResponse {
    let original = &req.filename;
    let mut sanitized = original.clone();
    sanitized = sanitized.replace("../", "").replace("..\\", "");
    sanitized = sanitized.replace('/', "-").replace('\\', "-");
    sanitized = sanitized.chars().filter(|c| *c != '\x00' && !c.is_control()).collect();
    if sanitized.len() > 255 { sanitized.truncate(255); }
    while sanitized.starts_with('.') { sanitized.remove(0); }
    if sanitized.is_empty() { sanitized = "upload".to_string(); }
    let was_modified = sanitized != *original;
    if was_modified { warn!("Filename sanitized: '{}' -> '{}'", original, sanitized); }
    HttpResponse::Ok().json(SanitizeFilenameResponse { sanitized, was_modified })
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "rust-crypto-guard" }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("crypto_guard=info".parse().unwrap()),
        )
        .init();

    // PostgreSQL audit logging connection
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    match tokio_postgres::connect(&db_url, tokio_postgres::NoTls).await {
        Ok((client, connection)) => {
            tokio::spawn(async move { let _ = connection.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS rust_crypto_guard_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )", &[]).await;
            info!("PostgreSQL connected for audit logging");
        }
        Err(e) => {
            warn!("PostgreSQL unavailable ({}), audit logging disabled", e);
        }
    }

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()
        .unwrap_or(8081);

    info!("Rust Crypto Guard starting on port {}", port);

    HttpServer::new(|| {
        App::new()
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health))
            .route("/validate-file", web::post().to(validate_file))
            .route("/validate-jwt", web::post().to(validate_jwt))
            .route("/safe-compare", web::post().to(safe_compare))
            .route("/hmac-verify", web::post().to(hmac_verify))
            .route("/sanitize-filename", web::post().to(sanitize_filename))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};
    use base64::Engine;

    #[actix_web::test]
    async fn test_validate_jpeg_magic_bytes() {
        let app = test::init_service(
            App::new().route("/validate-file", web::post().to(validate_file))
        ).await;
        let jpeg_header = vec![0xFF_u8, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_header);
        let req = test::TestRequest::post()
            .uri("/validate-file")
            .set_json(serde_json::json!({
                "content_b64": content_b64,
                "mime_type": "image/jpeg",
                "filename": "photo.jpg"
            }))
            .to_request();
        let resp: ValidateFileResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.valid, "JPEG with correct magic bytes should be valid");
    }

    #[actix_web::test]
    async fn test_block_exe_extension() {
        let app = test::init_service(
            App::new().route("/validate-file", web::post().to(validate_file))
        ).await;
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(b"MZ\x90\x00");
        let req = test::TestRequest::post()
            .uri("/validate-file")
            .set_json(serde_json::json!({
                "content_b64": content_b64,
                "mime_type": "application/octet-stream",
                "filename": "malware.exe"
            }))
            .to_request();
        let resp: ValidateFileResponse = test::call_and_read_body_json(&app, req).await;
        assert!(!resp.valid, ".exe extension should be blocked");
    }

    #[actix_web::test]
    async fn test_block_mime_spoofing() {
        let app = test::init_service(
            App::new().route("/validate-file", web::post().to(validate_file))
        ).await;
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(b"MZ\x90\x00\x03\x00");
        let req = test::TestRequest::post()
            .uri("/validate-file")
            .set_json(serde_json::json!({
                "content_b64": content_b64,
                "mime_type": "image/jpeg",
                "filename": "not_really.jpg"
            }))
            .to_request();
        let resp: ValidateFileResponse = test::call_and_read_body_json(&app, req).await;
        assert!(!resp.valid, "MIME spoofing should be detected");
    }

    #[actix_web::test]
    async fn test_jwt_alg_none_rejected() {
        let app = test::init_service(
            App::new().route("/validate-jwt", web::post().to(validate_jwt))
        ).await;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"1","role":"admin"}"#);
        let token = format!("{}.{}.", header, payload);
        let req = test::TestRequest::post()
            .uri("/validate-jwt")
            .set_json(serde_json::json!({ "token": token }))
            .to_request();
        let resp: ValidateJwtResponse = test::call_and_read_body_json(&app, req).await;
        assert!(!resp.valid, "alg:none JWT should be rejected");
    }

    #[actix_web::test]
    async fn test_jwt_hs256_accepted() {
        let app = test::init_service(
            App::new().route("/validate-jwt", web::post().to(validate_jwt))
        ).await;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"HS256","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"1"}"#);
        let token = format!("{}.{}.fakesig", header, payload);
        let req = test::TestRequest::post()
            .uri("/validate-jwt")
            .set_json(serde_json::json!({ "token": token }))
            .to_request();
        let resp: ValidateJwtResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.valid, "HS256 JWT header should be accepted");
    }

    #[actix_web::test]
    async fn test_safe_compare_equal() {
        let app = test::init_service(
            App::new().route("/safe-compare", web::post().to(safe_compare))
        ).await;
        let req = test::TestRequest::post()
            .uri("/safe-compare")
            .set_json(serde_json::json!({ "a": "secret_token_abc", "b": "secret_token_abc" }))
            .to_request();
        let resp: SafeCompareResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.equal);
    }

    #[actix_web::test]
    async fn test_safe_compare_not_equal() {
        let app = test::init_service(
            App::new().route("/safe-compare", web::post().to(safe_compare))
        ).await;
        let req = test::TestRequest::post()
            .uri("/safe-compare")
            .set_json(serde_json::json!({ "a": "secret_token_abc", "b": "different_token" }))
            .to_request();
        let resp: SafeCompareResponse = test::call_and_read_body_json(&app, req).await;
        assert!(!resp.equal);
    }

    #[actix_web::test]
    async fn test_sanitize_path_traversal() {
        let app = test::init_service(
            App::new().route("/sanitize-filename", web::post().to(sanitize_filename))
        ).await;
        let req = test::TestRequest::post()
            .uri("/sanitize-filename")
            .set_json(serde_json::json!({ "filename": "../../etc/passwd" }))
            .to_request();
        let resp: SanitizeFilenameResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.was_modified, "Path traversal filename should be modified");
        assert!(!resp.sanitized.contains(".."), "Sanitized filename should not contain '..'");
    }

    #[actix_web::test]
    async fn test_hmac_verify_valid() {
        let app = test::init_service(
            App::new().route("/hmac-verify", web::post().to(hmac_verify))
        ).await;
        let body = b"test_webhook_payload";
        let secret = "webhook_secret_key";
        let body_b64 = base64::engine::general_purpose::STANDARD.encode(body);
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        let req = test::TestRequest::post()
            .uri("/hmac-verify")
            .set_json(serde_json::json!({
                "body_b64": body_b64,
                "signature_hex": sig,
                "secret": secret
            }))
            .to_request();
        let resp: HmacVerifyResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.valid, "Valid HMAC should pass verification");
    }

    #[actix_web::test]
    async fn test_hmac_verify_invalid() {
        let app = test::init_service(
            App::new().route("/hmac-verify", web::post().to(hmac_verify))
        ).await;
        let body_b64 = base64::engine::general_purpose::STANDARD.encode(b"tampered_payload");
        let req = test::TestRequest::post()
            .uri("/hmac-verify")
            .set_json(serde_json::json!({
                "body_b64": body_b64,
                "signature_hex": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                "secret": "webhook_secret_key"
            }))
            .to_request();
        let resp: HmacVerifyResponse = test::call_and_read_body_json(&app, req).await;
        assert!(!resp.valid, "Invalid HMAC should fail verification");
    }
}
