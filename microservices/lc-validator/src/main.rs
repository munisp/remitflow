// lc-validator — Rust microservice for Letter of Credit document validation.
// Implements UCP 600 compliance checks, document completeness validation,
// discrepancy detection, and expiry/presentation period enforcement.
// Listens on :8221.

use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use chrono::{NaiveDate, Utc};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone)]
struct LCDocument {
    doc_type: String,       // bill_of_lading | commercial_invoice | packing_list | certificate_of_origin | insurance | draft | inspection
    reference: String,
    amount_usd: Option<f64>,
    issue_date: Option<String>,
    description: String,
    consignee: Option<String>,
    shipper: Option<String>,
    port_of_loading: Option<String>,
    port_of_discharge: Option<String>,
}

#[derive(Deserialize)]
struct LCValidationRequest {
    lc_number: String,
    lc_amount_usd: f64,
    lc_currency: String,
    applicant: String,
    beneficiary: String,
    issuing_bank: String,
    expiry_date: String,         // YYYY-MM-DD
    latest_shipment_date: String, // YYYY-MM-DD
    presentation_period_days: u32,
    lc_type: String,             // sight | usance | deferred | red_clause | standby
    incoterms: String,           // FOB | CIF | CFR | EXW | DDP | DAP
    documents: Vec<LCDocument>,
    partial_shipment_allowed: bool,
    transhipment_allowed: bool,
}

#[derive(Serialize)]
struct Discrepancy {
    severity: String,   // fatal | major | minor
    code: String,
    description: String,
    document: Option<String>,
    ucp_article: Option<String>,
}

#[derive(Serialize)]
struct LCValidationResponse {
    lc_number: String,
    is_compliant: bool,
    discrepancy_count: usize,
    fatal_count: usize,
    major_count: usize,
    minor_count: usize,
    discrepancies: Vec<Discrepancy>,
    documents_received: Vec<String>,
    documents_missing: Vec<String>,
    expiry_status: String,    // valid | expired | expiring_soon
    days_to_expiry: i64,
    presentation_deadline: String,
    recommendation: String,
}

// ─── Required Documents by LC Type ───────────────────────────────────────────

fn required_docs_for_lc(lc_type: &str, incoterms: &str) -> Vec<&'static str> {
    let mut docs = vec!["commercial_invoice", "packing_list"];
    
    // Bill of lading required for sea shipments (CIF, CFR, FOB)
    match incoterms {
        "CIF" | "CFR" | "FOB" => docs.push("bill_of_lading"),
        "EXW" | "FCA" => docs.push("air_waybill"),
        _ => docs.push("bill_of_lading"),
    }
    
    // Insurance required for CIF
    if incoterms == "CIF" {
        docs.push("insurance");
    }
    
    // Certificate of origin always required
    docs.push("certificate_of_origin");
    
    // Draft required for usance/deferred
    if lc_type == "usance" || lc_type == "deferred" {
        docs.push("draft");
    }
    
    docs
}

// ─── Validation Logic ─────────────────────────────────────────────────────────

fn validate_lc(req: &LCValidationRequest) -> LCValidationResponse {
    let mut discrepancies: Vec<Discrepancy> = Vec::new();
    let today = Utc::now().date_naive();

    // Parse dates
    let expiry = NaiveDate::parse_from_str(&req.expiry_date, "%Y-%m-%d")
        .unwrap_or(today);
    let days_to_expiry = (expiry - today).num_days();

    let expiry_status = if days_to_expiry < 0 {
        "expired"
    } else if days_to_expiry <= 7 {
        "expiring_soon"
    } else {
        "valid"
    };

    // Presentation deadline
    let latest_shipment = NaiveDate::parse_from_str(&req.latest_shipment_date, "%Y-%m-%d")
        .unwrap_or(today);
    let presentation_deadline = latest_shipment + chrono::Duration::days(req.presentation_period_days as i64);
    let presentation_deadline_str = presentation_deadline.format("%Y-%m-%d").to_string();

    // Check 1: LC expiry
    if expiry_status == "expired" {
        discrepancies.push(Discrepancy {
            severity: "fatal".to_string(),
            code: "LC001".to_string(),
            description: format!("LC expired on {} — presentation not accepted", req.expiry_date),
            document: None,
            ucp_article: Some("UCP 600 Art. 6".to_string()),
        });
    }

    // Check 2: Presentation period
    if today > presentation_deadline {
        discrepancies.push(Discrepancy {
            severity: "fatal".to_string(),
            code: "LC002".to_string(),
            description: format!("Presentation period of {} days from shipment date has expired", req.presentation_period_days),
            document: None,
            ucp_article: Some("UCP 600 Art. 14c".to_string()),
        });
    }

    // Check 3: Required documents
    let required = required_docs_for_lc(&req.lc_type, &req.incoterms);
    let received: Vec<String> = req.documents.iter().map(|d| d.doc_type.clone()).collect();
    let mut missing: Vec<String> = Vec::new();

    for req_doc in &required {
        if !received.iter().any(|r| r == req_doc) {
            missing.push(req_doc.to_string());
            discrepancies.push(Discrepancy {
                severity: "fatal".to_string(),
                code: "LC003".to_string(),
                description: format!("Required document missing: {}", req_doc.replace('_', " ")),
                document: Some(req_doc.to_string()),
                ucp_article: Some("UCP 600 Art. 14".to_string()),
            });
        }
    }

    // Check 4: Invoice amount vs LC amount
    let mut total_invoice_amount = 0.0f64;
    for doc in &req.documents {
        if doc.doc_type == "commercial_invoice" {
            if let Some(amt) = doc.amount_usd {
                total_invoice_amount += amt;
            }
        }
    }
    if total_invoice_amount > 0.0 && total_invoice_amount > req.lc_amount_usd * 1.001 {
        discrepancies.push(Discrepancy {
            severity: "fatal".to_string(),
            code: "LC004".to_string(),
            description: format!(
                "Invoice amount ${:.2} exceeds LC amount ${:.2}",
                total_invoice_amount, req.lc_amount_usd
            ),
            document: Some("commercial_invoice".to_string()),
            ucp_article: Some("UCP 600 Art. 18b".to_string()),
        });
    }

    // Check 5: Bill of lading — consignee/shipper consistency
    for doc in &req.documents {
        if doc.doc_type == "bill_of_lading" {
            if doc.consignee.is_none() || doc.consignee.as_deref() == Some("") {
                discrepancies.push(Discrepancy {
                    severity: "major".to_string(),
                    code: "LC005".to_string(),
                    description: "Bill of Lading: consignee field is blank".to_string(),
                    document: Some("bill_of_lading".to_string()),
                    ucp_article: Some("UCP 600 Art. 20a".to_string()),
                });
            }
            if doc.port_of_loading.is_none() || doc.port_of_discharge.is_none() {
                discrepancies.push(Discrepancy {
                    severity: "major".to_string(),
                    code: "LC006".to_string(),
                    description: "Bill of Lading: port of loading or discharge missing".to_string(),
                    document: Some("bill_of_lading".to_string()),
                    ucp_article: Some("UCP 600 Art. 20a".to_string()),
                });
            }
        }
    }

    // Check 6: Document date consistency
    for doc in &req.documents {
        if let Some(date_str) = &doc.issue_date {
            if let Ok(doc_date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                if doc_date > expiry {
                    discrepancies.push(Discrepancy {
                        severity: "major".to_string(),
                        code: "LC007".to_string(),
                        description: format!("{}: document date {} is after LC expiry", doc.doc_type, date_str),
                        document: Some(doc.doc_type.clone()),
                        ucp_article: Some("UCP 600 Art. 14i".to_string()),
                    });
                }
                if doc_date < latest_shipment && doc.doc_type == "bill_of_lading" {
                    discrepancies.push(Discrepancy {
                        severity: "minor".to_string(),
                        code: "LC008".to_string(),
                        description: format!("Bill of Lading date {} is before latest shipment date {}", date_str, req.latest_shipment_date),
                        document: Some("bill_of_lading".to_string()),
                        ucp_article: Some("UCP 600 Art. 20a".to_string()),
                    });
                }
            }
        }
    }

    // Check 7: LC amount tolerance (UCP 600 Art. 30 — 5% tolerance)
    if total_invoice_amount > 0.0 {
        let tolerance_lower = req.lc_amount_usd * 0.95;
        if total_invoice_amount < tolerance_lower {
            discrepancies.push(Discrepancy {
                severity: "minor".to_string(),
                code: "LC009".to_string(),
                description: format!(
                    "Invoice amount ${:.2} is more than 5% below LC amount ${:.2} — partial drawing",
                    total_invoice_amount, req.lc_amount_usd
                ),
                document: Some("commercial_invoice".to_string()),
                ucp_article: Some("UCP 600 Art. 30".to_string()),
            });
        }
    }

    let fatal_count = discrepancies.iter().filter(|d| d.severity == "fatal").count();
    let major_count = discrepancies.iter().filter(|d| d.severity == "major").count();
    let minor_count = discrepancies.iter().filter(|d| d.severity == "minor").count();
    let is_compliant = fatal_count == 0 && major_count == 0;

    let recommendation = if fatal_count > 0 {
        "REJECT — Fatal discrepancies prevent payment. Beneficiary must correct and re-present.".to_string()
    } else if major_count > 0 {
        "HOLD — Major discrepancies found. Seek applicant waiver or request corrected documents.".to_string()
    } else if minor_count > 0 {
        "ACCEPT WITH NOTATION — Minor discrepancies noted. Payment may proceed with applicant acknowledgment.".to_string()
    } else {
        "ACCEPT — All documents comply with LC terms and UCP 600. Payment authorised.".to_string()
    };

    LCValidationResponse {
        lc_number: req.lc_number.clone(),
        is_compliant,
        discrepancy_count: discrepancies.len(),
        fatal_count,
        major_count,
        minor_count,
        discrepancies,
        documents_received: received,
        documents_missing: missing,
        expiry_status: expiry_status.to_string(),
        days_to_expiry,
        presentation_deadline: presentation_deadline_str,
        recommendation,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "service": "lc-validator",
        "status": "healthy",
        "version": "1.0.0"
    }))
}

async fn validate(req: web::Json<LCValidationRequest>) -> HttpResponse {
    let result = validate_lc(&req);
    HttpResponse::Ok().json(result)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("LC_VALIDATOR_PORT").unwrap_or_else(|_| "8221".to_string());
    let addr = format!("0.0.0.0:{}", port);
    println!("[lc-validator] Starting on {}", addr);

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/validate", web::post().to(validate))
    })
    .bind(&addr)?
    .run()
    .await
}
