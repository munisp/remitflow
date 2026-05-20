// UPI domain models and request/response types
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── VPA (Virtual Payment Address) ────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct VpaLookupRequest {
    pub vpa: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VpaLookupResponse {
    pub found: bool,
    pub vpa: String,
    pub name: Option<String>,
    pub bank: Option<String>,
    pub bank_handle: Option<String>,
    pub account_type: Option<String>,
    pub verified: bool,
    pub metadata: Option<serde_json::Value>,
}

// ─── UPI Transfer (Pay flow) ──────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub payer_vpa: Option<String>,
    pub payee_vpa: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub remarks: Option<String>,
    pub reference: Option<String>,
    pub purpose_code: Option<String>,
    pub user_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferResponse {
    pub transaction_id: String,
    pub rrn: String,
    pub status: String,
    pub status_description: String,
    pub amount: f64,
    pub currency: String,
    pub payer_vpa: String,
    pub payee_vpa: String,
    pub fee_amount: f64,
    pub estimated_settlement: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ─── UPI Collect (Pull payment) ───────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectRequest {
    pub payer_vpa: String,
    pub payee_vpa: Option<String>,
    pub amount: f64,
    pub remarks: Option<String>,
    pub expiry_minutes: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectResponse {
    pub collect_id: String,
    pub status: String,
    pub payer_vpa: String,
    pub amount: f64,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ─── UPI Mandate ──────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct MandateRequest {
    pub payer_vpa: String,
    pub payee_vpa: Option<String>,
    pub amount: f64,
    pub frequency: String, // DAILY, WEEKLY, FORTNIGHTLY, MONTHLY, BIMONTHLY, QUARTERLY, HALFYEARLY, YEARLY, ASPRESENTED
    pub start_date: String,
    pub end_date: String,
    pub purpose: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MandateResponse {
    pub mandate_id: String,
    pub umn: String, // Unique Mandate Number
    pub status: String,
    pub payer_vpa: String,
    pub amount: f64,
    pub frequency: String,
    pub start_date: String,
    pub end_date: String,
    pub created_at: DateTime<Utc>,
}

// ─── Bank ─────────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpiBank {
    pub handle: String,
    pub name: String,
    pub ifsc_prefix: String,
    pub is_active: bool,
    pub supports_upi2: bool,
}

// ─── Compliance ───────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct ComplianceScreenRequest {
    pub payer_vpa: String,
    pub payee_vpa: String,
    pub amount: f64,
    pub purpose: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComplianceScreenResult {
    pub cleared: bool,
    pub risk_score: f64,
    pub risk_level: String,
    pub flags: Vec<String>,
    pub requires_additional_auth: bool,
    pub daily_limit_exceeded: bool,
    pub message: String,
}

// ─── Callback ─────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentCallback {
    pub transaction_id: String,
    pub rrn: String,
    pub status: String,
    pub amount: f64,
    pub payer_vpa: String,
    pub payee_vpa: String,
    pub timestamp: String,
    pub signature: String,
}

// ─── Health ───────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub timestamp: DateTime<Utc>,
    pub checks: std::collections::HashMap<String, String>,
}
