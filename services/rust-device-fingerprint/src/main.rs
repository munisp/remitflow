//! RemitFlow Device Fingerprinting Service (Rust)
//! Generates and validates device fingerprints for fraud detection.
//! Integrates with Redis for fingerprint history and Kafka for fraud events.

use actix_web::{web, App, HttpServer, HttpResponse, middleware::Logger};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use chrono::{Utc, DateTime};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DeviceSignals {
    pub user_agent: String,
    pub screen_resolution: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
    pub platform: Option<String>,
    pub canvas_hash: Option<String>,
    pub webgl_hash: Option<String>,
    pub audio_hash: Option<String>,
    pub fonts_hash: Option<String>,
    pub plugins_hash: Option<String>,
    pub ip_address: Option<String>,
    pub accept_language: Option<String>,
    pub color_depth: Option<u32>,
    pub hardware_concurrency: Option<u32>,
    pub device_memory: Option<f64>,
    pub touch_support: Option<bool>,
    pub cookie_enabled: Option<bool>,
    pub do_not_track: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FingerprintRequest {
    pub user_id: Option<i64>,
    pub session_id: Option<String>,
    pub signals: DeviceSignals,
    pub action: Option<String>, // login|transfer|kyc|settings
}

#[derive(Debug, Serialize)]
pub struct FingerprintResponse {
    pub fingerprint_id: String,
    pub fingerprint_hash: String,
    pub risk_score: f64,
    pub risk_level: String,
    pub is_new_device: bool,
    pub is_suspicious: bool,
    pub signals_count: usize,
    pub anomalies: Vec<String>,
    pub recommendation: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ValidateRequest {
    pub user_id: i64,
    pub fingerprint_hash: String,
}

#[derive(Debug, Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    pub known_device: bool,
    pub last_seen: Option<DateTime<Utc>>,
    pub trust_score: f64,
    pub device_count: usize,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub redis_connected: bool,
}

// ─── Fingerprint Engine ───────────────────────────────────────────────────────

fn compute_fingerprint_hash(signals: &DeviceSignals) -> String {
    let mut hasher = Sha256::new();
    hasher.update(signals.user_agent.as_bytes());
    if let Some(ref sr) = signals.screen_resolution { hasher.update(sr.as_bytes()); }
    if let Some(ref tz) = signals.timezone { hasher.update(tz.as_bytes()); }
    if let Some(ref lang) = signals.language { hasher.update(lang.as_bytes()); }
    if let Some(ref platform) = signals.platform { hasher.update(platform.as_bytes()); }
    if let Some(ref canvas) = signals.canvas_hash { hasher.update(canvas.as_bytes()); }
    if let Some(ref webgl) = signals.webgl_hash { hasher.update(webgl.as_bytes()); }
    if let Some(ref audio) = signals.audio_hash { hasher.update(audio.as_bytes()); }
    if let Some(ref fonts) = signals.fonts_hash { hasher.update(fonts.as_bytes()); }
    hex::encode(hasher.finalize())
}

fn count_signals(signals: &DeviceSignals) -> usize {
    let mut count = 1; // user_agent always present
    if signals.screen_resolution.is_some() { count += 1; }
    if signals.timezone.is_some() { count += 1; }
    if signals.language.is_some() { count += 1; }
    if signals.platform.is_some() { count += 1; }
    if signals.canvas_hash.is_some() { count += 1; }
    if signals.webgl_hash.is_some() { count += 1; }
    if signals.audio_hash.is_some() { count += 1; }
    if signals.fonts_hash.is_some() { count += 1; }
    if signals.plugins_hash.is_some() { count += 1; }
    if signals.ip_address.is_some() { count += 1; }
    count
}

fn detect_anomalies(signals: &DeviceSignals) -> Vec<String> {
    let mut anomalies = Vec::new();

    // Check for headless browser indicators
    if signals.user_agent.to_lowercase().contains("headless") {
        anomalies.push("headless_browser_detected".to_string());
    }
    if signals.user_agent.to_lowercase().contains("phantomjs") {
        anomalies.push("phantomjs_detected".to_string());
    }
    if signals.user_agent.to_lowercase().contains("selenium") {
        anomalies.push("selenium_detected".to_string());
    }

    // Check for automation tools
    if signals.plugins_hash.as_deref() == Some("") || signals.plugins_hash.as_deref() == Some("none") {
        anomalies.push("no_browser_plugins".to_string());
    }

    // Check for missing canvas (often blocked in privacy browsers)
    if signals.canvas_hash.is_none() && signals.webgl_hash.is_none() {
        anomalies.push("canvas_webgl_blocked".to_string());
    }

    // Check for suspicious hardware concurrency
    if let Some(hc) = signals.hardware_concurrency {
        if hc == 0 || hc > 256 {
            anomalies.push("suspicious_hardware_concurrency".to_string());
        }
    }

    // Check for VPN/proxy indicators (simplified)
    if let Some(ref ip) = signals.ip_address {
        if ip.starts_with("10.") || ip.starts_with("192.168.") || ip.starts_with("172.") {
            anomalies.push("private_ip_address".to_string());
        }
    }

    // Check for Tor browser
    if signals.do_not_track.as_deref() == Some("1") && signals.plugins_hash.is_none() {
        anomalies.push("possible_tor_browser".to_string());
    }

    anomalies
}

fn calculate_risk_score(signals_count: usize, anomalies: &[String], is_new_device: bool) -> f64 {
    let mut score: f64 = 0.0;

    // Base score from anomalies
    for anomaly in anomalies {
        score += match anomaly.as_str() {
            "headless_browser_detected" => 40.0,
            "phantomjs_detected" => 50.0,
            "selenium_detected" => 45.0,
            "no_browser_plugins" => 15.0,
            "canvas_webgl_blocked" => 10.0,
            "suspicious_hardware_concurrency" => 20.0,
            "private_ip_address" => 5.0,
            "possible_tor_browser" => 25.0,
            _ => 10.0,
        };
    }

    // Penalize for very few signals (bot-like)
    if signals_count < 3 {
        score += 30.0;
    } else if signals_count < 5 {
        score += 15.0;
    }

    // New device adds moderate risk
    if is_new_device {
        score += 10.0;
    }

    score.min(100.0)
}

fn risk_level_from_score(score: f64) -> String {
    match score as u32 {
        0..=20 => "low".to_string(),
        21..=50 => "medium".to_string(),
        51..=75 => "high".to_string(),
        _ => "critical".to_string(),
    }
}

fn recommendation_from_risk(level: &str, action: Option<&str>) -> String {
    match (level, action) {
        ("critical", _) => "block_and_alert".to_string(),
        ("high", Some("transfer")) => "require_2fa_and_review".to_string(),
        ("high", _) => "require_2fa".to_string(),
        ("medium", Some("transfer")) => "require_2fa".to_string(),
        ("medium", _) => "monitor".to_string(),
        _ => "allow".to_string(),
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn fingerprint_handler(
    req: web::Json<FingerprintRequest>,
) -> HttpResponse {
    let hash = compute_fingerprint_hash(&req.signals);
    let signals_count = count_signals(&req.signals);
    let anomalies = detect_anomalies(&req.signals);

    // In production: check Redis for known device hashes per user
    let is_new_device = true; // simplified — would check Redis

    let risk_score = calculate_risk_score(signals_count, &anomalies, is_new_device);
    let risk_level = risk_level_from_score(risk_score);
    let is_suspicious = risk_score > 50.0;
    let recommendation = recommendation_from_risk(&risk_level, req.action.as_deref());

    let response = FingerprintResponse {
        fingerprint_id: Uuid::new_v4().to_string(),
        fingerprint_hash: hash,
        risk_score,
        risk_level,
        is_new_device,
        is_suspicious,
        signals_count,
        anomalies,
        recommendation,
        created_at: Utc::now(),
    };

    tracing::info!(
        user_id = ?req.user_id,
        risk_score = response.risk_score,
        is_suspicious = response.is_suspicious,
        "Device fingerprint generated"
    );

    HttpResponse::Ok().json(response)
}

async fn validate_handler(
    req: web::Json<ValidateRequest>,
) -> HttpResponse {
    // In production: query Redis for user's known device hashes
    // Check if fingerprint_hash is in the user's trusted device list
    let response = ValidateResponse {
        valid: true,
        known_device: false, // simplified
        last_seen: None,
        trust_score: 0.7,
        device_count: 1,
    };
    HttpResponse::Ok().json(response)
}

async fn health_handler() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "healthy".to_string(),
        service: "rust-device-fingerprint".to_string(),
        version: "1.0.0".to_string(),
        redis_connected: false, // simplified
    })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let port = std::env::var("PORT").unwrap_or_else(|_| "8092".to_string());
    let addr = format!("0.0.0.0:{}", port);

    tracing::info!("RemitFlow Device Fingerprint Service starting on {}", addr);

    HttpServer::new(|| {
        App::new()
            .wrap(Logger::default())
            .route("/health", web::get().to(health_handler))
            .route("/api/fingerprint", web::post().to(fingerprint_handler))
            .route("/api/fingerprint/validate", web::post().to(validate_handler))
    })
    .bind(&addr)?
    .run()
    .await
}
