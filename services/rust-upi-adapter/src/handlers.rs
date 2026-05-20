// UPI handler implementations
use axum::{
    extract::{Json, Path},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::Utc;
use rand::Rng;
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::*;

// ─── Bank Registry ────────────────────────────────────────────────────────────
fn get_banks() -> Vec<UpiBank> {
    vec![
        UpiBank { handle: "oksbi".into(), name: "State Bank of India".into(), ifsc_prefix: "SBIN".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "okaxis".into(), name: "Axis Bank".into(), ifsc_prefix: "UTIB".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "okicici".into(), name: "ICICI Bank".into(), ifsc_prefix: "ICIC".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "okhdfcbank".into(), name: "HDFC Bank".into(), ifsc_prefix: "HDFC".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "paytm".into(), name: "Paytm Payments Bank".into(), ifsc_prefix: "PYTM".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "ybl".into(), name: "Yes Bank (PhonePe)".into(), ifsc_prefix: "YESB".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "ibl".into(), name: "IndusInd Bank".into(), ifsc_prefix: "INDB".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "upi".into(), name: "NPCI UPI".into(), ifsc_prefix: "NPCI".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "kotak".into(), name: "Kotak Mahindra Bank".into(), ifsc_prefix: "KKBK".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "apl".into(), name: "Amazon Pay".into(), ifsc_prefix: "UTIB".into(), is_active: true, supports_upi2: true },
        UpiBank { handle: "gpay".into(), name: "Google Pay (Federal Bank)".into(), ifsc_prefix: "FDRL".into(), is_active: true, supports_upi2: true },
    ]
}

fn get_bank_name(handle: &str) -> String {
    get_banks()
        .into_iter()
        .find(|b| b.handle == handle)
        .map(|b| b.name)
        .unwrap_or_else(|| format!("{} Bank", handle.to_uppercase()))
}

fn validate_vpa_format(vpa: &str) -> bool {
    let re = regex::Regex::new(r"^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$").unwrap();
    re.is_match(vpa)
}

fn generate_rrn() -> String {
    let mut rng = rand::thread_rng();
    format!("{:012}", rng.gen_range(100000000000u64..999999999999u64))
}

fn generate_txn_id() -> String {
    format!("UPI{}{}", Utc::now().timestamp_millis(), &Uuid::new_v4().to_string().replace('-', "")[..8].to_uppercase())
}

// ─── Health ────────────────────────────────────────────────────────────────────
pub async fn health() -> impl IntoResponse {
    let mut checks = HashMap::new();
    checks.insert("npci_gateway".to_string(), "connected".to_string());
    checks.insert("database".to_string(), "connected".to_string());
    checks.insert("fraud_engine".to_string(), "connected".to_string());

    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "upi-adapter".to_string(),
        version: "v110.0.0".to_string(),
        timestamp: Utc::now(),
        checks,
    })
}

pub async fn ready() -> impl IntoResponse {
    Json(serde_json::json!({"ready": true}))
}

pub async fn metrics() -> impl IntoResponse {
    Json(serde_json::json!({
        "service": "upi-adapter",
        "language": "rust",
        "version": "v110.0.0",
        "uptime": "running"
    }))
}

// ─── VPA Lookup ───────────────────────────────────────────────────────────────
pub async fn lookup_vpa(Json(req): Json<VpaLookupRequest>) -> impl IntoResponse {
    if !validate_vpa_format(&req.vpa) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid VPA format. Expected: user@bank",
            "code": "INVALID_VPA"
        }))).into_response();
    }

    let parts: Vec<&str> = req.vpa.split('@').collect();
    let handle = parts.get(1).copied().unwrap_or("unknown");
    let bank_name = get_bank_name(handle);

    // In production: call NPCI VPA lookup API with PSP credentials
    // Sandbox: return mock verified VPA
    Json(VpaLookupResponse {
        found: true,
        vpa: req.vpa.clone(),
        name: Some("Verified UPI Account".to_string()),
        bank: Some(bank_name),
        bank_handle: Some(handle.to_string()),
        account_type: Some("Savings Account".to_string()),
        verified: true,
        metadata: Some(serde_json::json!({
            "currency": "INR",
            "country": "IN",
            "upi_version": "2.0"
        })),
    }).into_response()
}

pub async fn validate_vpa(Json(req): Json<VpaLookupRequest>) -> impl IntoResponse {
    let valid = validate_vpa_format(&req.vpa);
    Json(serde_json::json!({
        "vpa": req.vpa,
        "valid": valid,
        "message": if valid { "VPA format is valid" } else { "Invalid VPA format" }
    }))
}

// ─── Transfer (Pay flow) ──────────────────────────────────────────────────────
pub async fn initiate_transfer(Json(req): Json<TransferRequest>) -> impl IntoResponse {
    if req.amount <= 0.0 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Amount must be greater than 0",
            "code": "INVALID_AMOUNT"
        }))).into_response();
    }
    // UPI daily limit: ₹1,00,000 per transaction (NPCI mandate)
    if req.amount > 100000.0 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Amount exceeds UPI per-transaction limit of ₹1,00,000",
            "code": "LIMIT_EXCEEDED"
        }))).into_response();
    }
    if !validate_vpa_format(&req.payee_vpa) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid payee VPA format",
            "code": "INVALID_VPA"
        }))).into_response();
    }

    let txn_id = generate_txn_id();
    let rrn = generate_rrn();
    let payer_vpa = req.payer_vpa.clone().unwrap_or_else(|| "remitflow@icici".to_string());

    // UPI P2P transfers are free (NPCI mandate)
    // UPI P2M (merchant) may have MDR
    let fee = 0.0_f64;

    // UPI is near-instant: T+0, typically < 30 seconds
    let settlement = Utc::now() + chrono::Duration::seconds(30);

    // In production: call NPCI UPI API with PSP credentials + device binding
    // Simulate async settlement
    let response = TransferResponse {
        transaction_id: txn_id,
        rrn,
        status: "SUCCESS".to_string(),
        status_description: "UPI transfer completed successfully".to_string(),
        amount: req.amount,
        currency: req.currency.unwrap_or_else(|| "INR".to_string()),
        payer_vpa,
        payee_vpa: req.payee_vpa,
        fee_amount: fee,
        estimated_settlement: settlement,
        created_at: Utc::now(),
    };

    (StatusCode::CREATED, Json(response)).into_response()
}

pub async fn get_transfer_status(Path(id): Path<String>) -> impl IntoResponse {
    // In production: query NPCI transaction status API
    Json(serde_json::json!({
        "transaction_id": id,
        "status": "SUCCESS",
        "status_description": "Transfer completed",
        "updated_at": Utc::now()
    }))
}

pub async fn refund_transfer(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "original_transaction_id": id,
        "refund_id": format!("REFUND{}", generate_txn_id()),
        "status": "INITIATED",
        "message": "Refund initiated. Processing within 5-7 business days."
    }))
}

// ─── Collect (Pull payment) ───────────────────────────────────────────────────
pub async fn initiate_collect(Json(req): Json<CollectRequest>) -> impl IntoResponse {
    if !validate_vpa_format(&req.payer_vpa) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid payer VPA",
            "code": "INVALID_VPA"
        }))).into_response();
    }

    let collect_id = format!("COL{}", &Uuid::new_v4().to_string().replace('-', "")[..12].to_uppercase());
    let expiry_mins = req.expiry_minutes.unwrap_or(30);
    let expires_at = Utc::now() + chrono::Duration::minutes(expiry_mins);

    let response = CollectResponse {
        collect_id,
        status: "PENDING".to_string(),
        payer_vpa: req.payer_vpa,
        amount: req.amount,
        expires_at,
        created_at: Utc::now(),
    };

    (StatusCode::CREATED, Json(response)).into_response()
}

pub async fn approve_collect(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "collect_id": id,
        "status": "APPROVED",
        "rrn": generate_rrn(),
        "message": "Collect request approved and payment processed"
    }))
}

pub async fn reject_collect(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "collect_id": id,
        "status": "REJECTED",
        "message": "Collect request rejected by payer"
    }))
}

// ─── Mandate ──────────────────────────────────────────────────────────────────
pub async fn create_mandate(Json(req): Json<MandateRequest>) -> impl IntoResponse {
    let mandate_id = format!("MND{}", &Uuid::new_v4().to_string().replace('-', "")[..12].to_uppercase());
    let umn = format!("{}@remitflow@{}", mandate_id, req.payer_vpa.split('@').next().unwrap_or("user"));

    let response = MandateResponse {
        mandate_id,
        umn,
        status: "CREATED".to_string(),
        payer_vpa: req.payer_vpa,
        amount: req.amount,
        frequency: req.frequency,
        start_date: req.start_date,
        end_date: req.end_date,
        created_at: Utc::now(),
    };

    (StatusCode::CREATED, Json(response)).into_response()
}

pub async fn get_mandate(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "mandate_id": id,
        "status": "ACTIVE",
        "message": "Mandate is active"
    }))
}

pub async fn revoke_mandate(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "mandate_id": id,
        "status": "REVOKED",
        "message": "Mandate revoked successfully"
    }))
}

// ─── Banks ────────────────────────────────────────────────────────────────────
pub async fn list_banks() -> impl IntoResponse {
    Json(serde_json::json!({
        "banks": get_banks(),
        "total": get_banks().len()
    }))
}

// ─── Compliance ───────────────────────────────────────────────────────────────
pub async fn screen_transaction(Json(req): Json<ComplianceScreenRequest>) -> impl IntoResponse {
    let mut risk_score = 0.05_f64;
    let mut flags = Vec::new();

    // UPI per-transaction limit check
    if req.amount > 100000.0 {
        risk_score += 0.5;
        flags.push("EXCEEDS_UPI_LIMIT".to_string());
    }
    // High-value threshold (RBI reporting: >₹50,000)
    if req.amount > 50000.0 {
        risk_score += 0.2;
        flags.push("HIGH_VALUE_TRANSACTION".to_string());
    }
    // Round-number transactions (potential structuring)
    if req.amount % 10000.0 == 0.0 && req.amount >= 10000.0 {
        risk_score += 0.1;
        flags.push("ROUND_AMOUNT".to_string());
    }

    let risk_level = if risk_score > 0.7 { "CRITICAL" }
        else if risk_score > 0.4 { "HIGH" }
        else if risk_score > 0.2 { "MEDIUM" }
        else { "LOW" };

    Json(ComplianceScreenResult {
        cleared: risk_score < 0.7,
        risk_score,
        risk_level: risk_level.to_string(),
        flags,
        requires_additional_auth: req.amount > 50000.0,
        daily_limit_exceeded: false,
        message: format!("UPI compliance check complete. Risk: {} ({:.2})", risk_level, risk_score),
    })
}

// ─── Callbacks ────────────────────────────────────────────────────────────────
pub async fn handle_payment_callback(Json(cb): Json<PaymentCallback>) -> impl IntoResponse {
    // In production: verify HMAC signature from NPCI
    tracing::info!("[UPI Callback] Payment: {} status={}", cb.transaction_id, cb.status);
    Json(serde_json::json!({"acknowledged": true, "transaction_id": cb.transaction_id}))
}

pub async fn handle_collect_callback(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    tracing::info!("[UPI Callback] Collect: {:?}", body);
    Json(serde_json::json!({"acknowledged": true}))
}
