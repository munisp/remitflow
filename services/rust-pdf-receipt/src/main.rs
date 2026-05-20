/*!
 * RemitFlow — Rust PDF Receipt Service
 * High-performance receipt data generator using Actix-web + Tokio
 * Port: 8096
 *
 * This service generates structured receipt data (JSON) that the
 * frontend renders into a downloadable PDF using browser print API.
 * For server-side PDF bytes, it delegates to the Python pdf-receipt service.
 *
 * Endpoints:
 *   GET  /health
 *   POST /receipt/transfer     — Generate transfer receipt data
 *   POST /receipt/statement    — Generate account statement data
 *   POST /receipt/kyc          — Generate KYC confirmation letter data
 *   POST /receipt/batch        — Generate batch payment summary receipt
 *   GET  /receipt/template/:type — Get HTML receipt template
 */

use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TransferReceiptRequest {
    pub transaction_id: Option<i64>,
    pub reference: String,
    pub sender_name: String,
    pub sender_email: String,
    pub recipient_name: String,
    pub recipient_bank: Option<String>,
    pub recipient_account: Option<String>,
    pub recipient_country: Option<String>,
    pub send_amount: f64,
    pub send_currency: String,
    pub receive_amount: Option<f64>,
    pub receive_currency: Option<String>,
    pub exchange_rate: Option<f64>,
    pub fee: f64,
    pub total_cost: Option<f64>,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StatementRequest {
    pub user_name: String,
    pub user_email: String,
    pub account_number: Option<String>,
    pub period_from: String,
    pub period_to: String,
    pub opening_balance: f64,
    pub closing_balance: f64,
    pub currency: String,
    pub transactions: Vec<StatementTransaction>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StatementTransaction {
    pub date: String,
    pub description: String,
    pub reference: String,
    pub debit: Option<f64>,
    pub credit: Option<f64>,
    pub balance: f64,
    pub status: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct KycReceiptRequest {
    pub user_name: String,
    pub user_email: String,
    pub kyc_tier: String,
    pub approved_at: String,
    pub daily_limit: f64,
    pub monthly_limit: f64,
    pub currency: String,
    pub documents_verified: Vec<String>,
    pub reference: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BatchReceiptRequest {
    pub batch_id: String,
    pub initiator_name: String,
    pub total_payments: i32,
    pub completed: i32,
    pub failed: i32,
    pub total_amount: f64,
    pub currency: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub payments: Vec<BatchPaymentLine>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BatchPaymentLine {
    pub recipient: String,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub reference: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReceiptData {
    pub receipt_id: String,
    pub receipt_type: String,
    pub generated_at: String,
    pub branding: BrandingInfo,
    pub data: serde_json::Value,
    pub html_template: String,
    pub print_ready: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct BrandingInfo {
    pub company: String,
    pub tagline: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    pub website: String,
    pub fca_reg: String,
    pub emi_licence: String,
    pub logo_text: String,
}

// ─── Branding ─────────────────────────────────────────────────────────────────

fn get_branding() -> BrandingInfo {
    BrandingInfo {
        company: "RemitFlow Financial Services Ltd".to_string(),
        tagline: "Borderless Money, Boundless Opportunity".to_string(),
        address: "1 Canada Square, Canary Wharf, London E14 5AB, United Kingdom".to_string(),
        phone: "+44 20 7946 0958".to_string(),
        email: "support@remitflow.app".to_string(),
        website: "https://remitflow.app".to_string(),
        fca_reg: "FCA Authorised Payment Institution: 900001".to_string(),
        emi_licence: "EMI Licence: EMI-2024-001".to_string(),
        logo_text: "RemitFlow".to_string(),
    }
}

// ─── HTML Template Builder ────────────────────────────────────────────────────

fn build_transfer_html(req: &TransferReceiptRequest, receipt_id: &str, branding: &BrandingInfo) -> String {
    let receive_section = if let (Some(recv_amt), Some(recv_curr)) = (req.receive_amount, &req.receive_currency) {
        format!(
            r#"<tr><td class="label">Recipient Receives</td><td class="value highlight">{:.2} {}</td></tr>"#,
            recv_amt, recv_curr
        )
    } else {
        String::new()
    };

    let rate_section = if let Some(rate) = req.exchange_rate {
        format!(
            r#"<tr><td class="label">Exchange Rate</td><td class="value">1 {} = {:.6} {}</td></tr>"#,
            req.send_currency,
            rate,
            req.receive_currency.as_deref().unwrap_or("")
        )
    } else {
        String::new()
    };

    let bank_section = if let Some(bank) = &req.recipient_bank {
        format!(r#"<tr><td class="label">Recipient Bank</td><td class="value">{}</td></tr>"#, bank)
    } else {
        String::new()
    };

    let account_section = if let Some(acc) = &req.recipient_account {
        let masked = if acc.len() > 4 { format!("****{}", &acc[acc.len()-4..]) } else { acc.clone() };
        format!(r#"<tr><td class="label">Account Number</td><td class="value">{}</td></tr>"#, masked)
    } else {
        String::new()
    };

    let status_color = match req.status.as_str() {
        "completed" => "#10b981",
        "pending" | "processing" => "#f59e0b",
        "failed" => "#ef4444",
        _ => "#6b7280",
    };

    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transfer Receipt — {reference}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; }}
  .receipt {{ max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden; }}
  .header {{ background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); color: white; padding: 32px; text-align: center; }}
  .logo {{ font-size: 28px; font-weight: 800; letter-spacing: -0.5px; color: #10b981; }}
  .tagline {{ font-size: 12px; color: #94a3b8; margin-top: 4px; }}
  .status-badge {{ display: inline-block; padding: 6px 20px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-top: 16px; background: {status_color}22; color: {status_color}; border: 1px solid {status_color}44; }}
  .amount-hero {{ padding: 32px; text-align: center; border-bottom: 1px solid #f1f5f9; }}
  .send-amount {{ font-size: 42px; font-weight: 800; color: #0f172a; }}
  .currency {{ font-size: 20px; color: #64748b; font-weight: 500; }}
  .arrow {{ font-size: 24px; color: #10b981; margin: 8px 0; }}
  .receive-amount {{ font-size: 28px; font-weight: 700; color: #10b981; }}
  .details {{ padding: 24px 32px; }}
  .section-title {{ font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 12px; margin-top: 20px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  .label {{ color: #64748b; font-size: 14px; padding: 8px 0; width: 45%; }}
  .value {{ font-size: 14px; font-weight: 500; text-align: right; padding: 8px 0; }}
  .value.highlight {{ color: #10b981; font-weight: 700; }}
  .divider {{ border: none; border-top: 1px solid #f1f5f9; margin: 16px 0; }}
  .footer {{ background: #f8fafc; padding: 24px 32px; text-align: center; }}
  .footer p {{ font-size: 11px; color: #94a3b8; line-height: 1.6; }}
  .receipt-id {{ font-size: 10px; color: #cbd5e1; margin-top: 8px; }}
  @media print {{
    body {{ background: white; }}
    .receipt {{ box-shadow: none; margin: 0; border-radius: 0; }}
  }}
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <div class="logo">{logo}</div>
    <div class="tagline">{tagline}</div>
    <div class="status-badge">{status_upper}</div>
  </div>
  <div class="amount-hero">
    <div><span class="send-amount">{send_amount:.2}</span> <span class="currency">{send_currency}</span></div>
    {receive_section_hero}
  </div>
  <div class="details">
    <div class="section-title">Transfer Details</div>
    <table>
      <tr><td class="label">Reference</td><td class="value">{reference}</td></tr>
      <tr><td class="label">Date</td><td class="value">{created_at}</td></tr>
      {rate_section}
      <tr><td class="label">Transfer Fee</td><td class="value">{fee:.2} {send_currency}</td></tr>
      {total_cost_row}
    </table>
    <hr class="divider">
    <div class="section-title">Recipient</div>
    <table>
      <tr><td class="label">Name</td><td class="value">{recipient_name}</td></tr>
      {bank_section}
      {account_section}
      {country_section}
    </table>
    <hr class="divider">
    <div class="section-title">Sender</div>
    <table>
      <tr><td class="label">Name</td><td class="value">{sender_name}</td></tr>
      <tr><td class="label">Email</td><td class="value">{sender_email}</td></tr>
    </table>
  </div>
  <div class="footer">
    <p>{company}<br>{address}<br>{phone} · {email}<br>{fca_reg}</p>
    <p class="receipt-id">Receipt ID: {receipt_id} · Generated: {generated_at}</p>
  </div>
</div>
</body>
</html>"#,
        reference = req.reference,
        status_color = status_color,
        logo = branding.logo_text,
        tagline = branding.tagline,
        status_upper = req.status.to_uppercase(),
        send_amount = req.send_amount,
        send_currency = req.send_currency,
        receive_section_hero = if let (Some(recv_amt), Some(recv_curr)) = (req.receive_amount, &req.receive_currency) {
            format!(r#"<div class="arrow">↓</div><div><span class="receive-amount">{:.2}</span> <span class="currency">{}</span></div>"#, recv_amt, recv_curr)
        } else { String::new() },
        rate_section = rate_section,
        fee = req.fee,
        total_cost_row = if let Some(tc) = req.total_cost {
            format!(r#"<tr><td class="label">Total Cost</td><td class="value">{:.2} {}</td></tr>"#, tc, req.send_currency)
        } else { String::new() },
        recipient_name = req.recipient_name,
        bank_section = bank_section,
        account_section = account_section,
        country_section = if let Some(c) = &req.recipient_country {
            format!(r#"<tr><td class="label">Country</td><td class="value">{}</td></tr>"#, c)
        } else { String::new() },
        sender_name = req.sender_name,
        sender_email = req.sender_email,
        company = branding.company,
        address = branding.address,
        phone = branding.phone,
        email = branding.email,
        fca_reg = branding.fca_reg,
        receipt_id = receipt_id,
        created_at = req.created_at,
        generated_at = Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string(),
    )
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "rust-pdf-receipt",
        "version": "1.0.0",
        "language": "Rust",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

#[post("/receipt/transfer")]
async fn transfer_receipt(req: web::Json<TransferReceiptRequest>) -> impl Responder {
    let receipt_id = format!("RFR-{}", Uuid::new_v4().to_string().to_uppercase().replace('-', "")[..12].to_string());
    let branding = get_branding();
    let html = build_transfer_html(&req, &receipt_id, &branding);

    let data = ReceiptData {
        receipt_id: receipt_id.clone(),
        receipt_type: "transfer".to_string(),
        generated_at: Utc::now().to_rfc3339(),
        branding: branding.clone(),
        data: serde_json::to_value(&*req).unwrap_or_default(),
        html_template: html,
        print_ready: true,
    };

    HttpResponse::Ok().json(data)
}

#[post("/receipt/statement")]
async fn statement_receipt(req: web::Json<StatementRequest>) -> impl Responder {
    let receipt_id = format!("RFS-{}", Uuid::new_v4().to_string().to_uppercase().replace('-', "")[..12].to_string());
    let branding = get_branding();

    // Build statement HTML
    let rows: String = req.transactions.iter().map(|t| {
        let debit = t.debit.map(|d| format!("{:.2}", d)).unwrap_or_default();
        let credit = t.credit.map(|c| format!("{:.2}", c)).unwrap_or_default();
        format!(
            r#"<tr><td>{}</td><td>{}</td><td>{}</td><td class="debit">{}</td><td class="credit">{}</td><td>{:.2}</td></tr>"#,
            t.date, t.description, t.reference, debit, credit, t.balance
        )
    }).collect();

    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Account Statement</title>
<style>
  body {{ font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; }}
  .header {{ background: #0f172a; color: white; padding: 20px; }}
  .logo {{ font-size: 22px; font-weight: 800; color: #10b981; }}
  h2 {{ margin: 20px 0 10px; font-size: 14px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th {{ background: #f1f5f9; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }}
  td {{ padding: 8px; border-bottom: 1px solid #f1f5f9; }}
  .debit {{ color: #ef4444; }}
  .credit {{ color: #10b981; }}
  .summary {{ display: flex; gap: 20px; margin: 20px 0; }}
  .summary-card {{ flex: 1; background: #f8fafc; padding: 12px; border-radius: 8px; }}
  .footer {{ margin-top: 30px; font-size: 10px; color: #94a3b8; text-align: center; }}
</style>
</head>
<body>
<div class="header"><div class="logo">{logo}</div><div style="font-size:11px;color:#94a3b8;margin-top:4px;">{tagline}</div></div>
<div style="padding:20px;">
<h2>Account Statement</h2>
<p><strong>{name}</strong> · {email}</p>
<p>Period: {from} to {to} · Currency: {currency}</p>
<div class="summary">
  <div class="summary-card"><div style="font-size:10px;color:#64748b;">Opening Balance</div><div style="font-size:18px;font-weight:700;">{opening:.2} {currency}</div></div>
  <div class="summary-card"><div style="font-size:10px;color:#64748b;">Closing Balance</div><div style="font-size:18px;font-weight:700;color:#10b981;">{closing:.2} {currency}</div></div>
  <div class="summary-card"><div style="font-size:10px;color:#64748b;">Transactions</div><div style="font-size:18px;font-weight:700;">{count}</div></div>
</div>
<table>
<thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
<tbody>{rows}</tbody>
</table>
</div>
<div class="footer"><p>{company} · {address} · {fca}</p></div>
</body></html>"#,
        logo = branding.logo_text,
        tagline = branding.tagline,
        name = req.user_name,
        email = req.user_email,
        from = req.period_from,
        to = req.period_to,
        currency = req.currency,
        opening = req.opening_balance,
        closing = req.closing_balance,
        count = req.transactions.len(),
        rows = rows,
        company = branding.company,
        address = branding.address,
        fca = branding.fca_reg,
    );

    let data = ReceiptData {
        receipt_id: receipt_id.clone(),
        receipt_type: "statement".to_string(),
        generated_at: Utc::now().to_rfc3339(),
        branding,
        data: serde_json::to_value(&*req).unwrap_or_default(),
        html_template: html,
        print_ready: true,
    };

    HttpResponse::Ok().json(data)
}

#[post("/receipt/kyc")]
async fn kyc_receipt(req: web::Json<KycReceiptRequest>) -> impl Responder {
    let receipt_id = format!("RFK-{}", Uuid::new_v4().to_string().to_uppercase().replace('-', "")[..12].to_string());
    let branding = get_branding();

    let docs_list: String = req.documents_verified.iter()
        .map(|d| format!("<li>✓ {}</li>", d))
        .collect();

    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>KYC Confirmation Letter</title>
<style>
  body {{ font-family: 'Georgia', serif; font-size: 13px; color: #1e293b; max-width: 700px; margin: 40px auto; padding: 40px; }}
  .header {{ display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; }}
  .logo {{ font-family: Arial, sans-serif; font-size: 24px; font-weight: 800; color: #10b981; }}
  .date {{ font-size: 12px; color: #64748b; }}
  h1 {{ font-size: 18px; margin-bottom: 20px; }}
  .badge {{ display: inline-block; background: #10b981; color: white; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 20px; }}
  .limits-table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
  .limits-table th {{ background: #f1f5f9; padding: 10px; text-align: left; }}
  .limits-table td {{ padding: 10px; border-bottom: 1px solid #f1f5f9; }}
  ul {{ padding-left: 20px; line-height: 2; }}
  .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }}
  .signature {{ margin-top: 40px; }}
</style>
</head>
<body>
<div class="header">
  <div><div class="logo">{logo}</div><div style="font-size:10px;color:#94a3b8;margin-top:4px;">{tagline}</div></div>
  <div class="date">Reference: {reference}<br>Date: {approved_at}</div>
</div>
<p>Dear <strong>{name}</strong>,</p>
<h1>KYC Verification Confirmation</h1>
<div class="badge">✓ {tier} VERIFIED</div>
<p>We are pleased to confirm that your identity verification has been successfully completed. Your account has been upgraded to <strong>{tier}</strong> status, effective {approved_at}.</p>
<h3 style="margin-top:24px;">Documents Verified</h3>
<ul>{docs}</ul>
<h3 style="margin-top:24px;">Account Limits</h3>
<table class="limits-table">
  <thead><tr><th>Limit Type</th><th>Amount</th><th>Currency</th></tr></thead>
  <tbody>
    <tr><td>Daily Transfer Limit</td><td><strong>{daily:,.2}</strong></td><td>{currency}</td></tr>
    <tr><td>Monthly Transfer Limit</td><td><strong>{monthly:,.2}</strong></td><td>{currency}</td></tr>
  </tbody>
</table>
<p>Your account is now fully verified and you can enjoy the full benefits of RemitFlow's cross-border payment services.</p>
<div class="signature">
  <p>Yours sincerely,</p>
  <p style="margin-top:20px;"><strong>Compliance Team</strong><br>{company}</p>
</div>
<div class="footer">
  <p>{company} · {address}</p>
  <p>{fca} · {emi}</p>
  <p>This letter is computer-generated and does not require a physical signature. Receipt ID: {receipt_id}</p>
</div>
</body></html>"#,
        logo = branding.logo_text,
        tagline = branding.tagline,
        reference = req.reference,
        approved_at = req.approved_at,
        name = req.user_name,
        tier = req.kyc_tier.to_uppercase(),
        docs = docs_list,
        daily = req.daily_limit,
        monthly = req.monthly_limit,
        currency = req.currency,
        company = branding.company,
        address = branding.address,
        fca = branding.fca_reg,
        emi = branding.emi_licence,
        receipt_id = receipt_id,
    );

    let data = ReceiptData {
        receipt_id: receipt_id.clone(),
        receipt_type: "kyc".to_string(),
        generated_at: Utc::now().to_rfc3339(),
        branding,
        data: serde_json::to_value(&*req).unwrap_or_default(),
        html_template: html,
        print_ready: true,
    };

    HttpResponse::Ok().json(data)
}

#[post("/receipt/batch")]
async fn batch_receipt(req: web::Json<BatchReceiptRequest>) -> impl Responder {
    let receipt_id = format!("RFB-{}", Uuid::new_v4().to_string().to_uppercase().replace('-', "")[..12].to_string());
    let branding = get_branding();
    let success_rate = if req.total_payments > 0 {
        (req.completed as f64 / req.total_payments as f64) * 100.0
    } else { 0.0 };

    let rows: String = req.payments.iter().map(|p| {
        let status_color = match p.status.as_str() {
            "completed" => "#10b981",
            "failed" => "#ef4444",
            _ => "#f59e0b",
        };
        format!(
            r#"<tr><td>{}</td><td>{:.2} {}</td><td style="color:{}">{}</td><td>{}</td><td>{}</td></tr>"#,
            p.recipient, p.amount, p.currency, status_color, p.status.to_uppercase(),
            p.reference, p.error.as_deref().unwrap_or("")
        )
    }).collect();

    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Batch Payment Receipt</title>
<style>
  body {{ font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; }}
  .header {{ background: #0f172a; color: white; padding: 24px; }}
  .logo {{ font-size: 22px; font-weight: 800; color: #10b981; }}
  .content {{ padding: 24px; }}
  .stats {{ display: flex; gap: 16px; margin: 20px 0; }}
  .stat {{ flex: 1; background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center; }}
  .stat-value {{ font-size: 24px; font-weight: 800; }}
  .stat-label {{ font-size: 10px; color: #64748b; text-transform: uppercase; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
  th {{ background: #f1f5f9; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }}
  td {{ padding: 8px; border-bottom: 1px solid #f1f5f9; }}
  .footer {{ margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; padding: 16px; border-top: 1px solid #f1f5f9; }}
</style>
</head>
<body>
<div class="header">
  <div class="logo">{logo}</div>
  <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Batch Payment Receipt</div>
</div>
<div class="content">
  <p><strong>Batch ID:</strong> {batch_id} &nbsp;|&nbsp; <strong>Initiated by:</strong> {initiator} &nbsp;|&nbsp; <strong>Date:</strong> {created_at}</p>
  <div class="stats">
    <div class="stat"><div class="stat-value">{total}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value" style="color:#10b981">{completed}</div><div class="stat-label">Completed</div></div>
    <div class="stat"><div class="stat-value" style="color:#ef4444">{failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value" style="color:#10b981">{rate:.1}%</div><div class="stat-label">Success Rate</div></div>
    <div class="stat"><div class="stat-value">{amount:.2}</div><div class="stat-label">Total {currency}</div></div>
  </div>
  <table>
    <thead><tr><th>Recipient</th><th>Amount</th><th>Status</th><th>Reference</th><th>Notes</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>
<div class="footer"><p>{company} · {address} · {fca}</p><p>Receipt ID: {receipt_id}</p></div>
</body></html>"#,
        logo = branding.logo_text,
        batch_id = req.batch_id,
        initiator = req.initiator_name,
        created_at = req.created_at,
        total = req.total_payments,
        completed = req.completed,
        failed = req.failed,
        rate = success_rate,
        amount = req.total_amount,
        currency = req.currency,
        rows = rows,
        company = branding.company,
        address = branding.address,
        fca = branding.fca_reg,
        receipt_id = receipt_id,
    );

    let data = ReceiptData {
        receipt_id,
        receipt_type: "batch".to_string(),
        generated_at: Utc::now().to_rfc3339(),
        branding,
        data: serde_json::to_value(&*req).unwrap_or_default(),
        html_template: html,
        print_ready: true,
    };

    HttpResponse::Ok().json(data)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    let port = std::env::var("PORT").unwrap_or_else(|_| "8096".to_string());
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("[rust-pdf-receipt] Starting on {}", addr);

    HttpServer::new(|| {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .service(health)
            .service(transfer_receipt)
            .service(statement_receipt)
            .service(kyc_receipt)
            .service(batch_receipt)
    })
    .bind(&addr)?
    .run()
    .await
}
