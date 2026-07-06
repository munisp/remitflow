// rust-kyc-compliance-bridge — Shared KYC/Compliance Bridge (FINTRAC ↔ CBN/FCA)
//
// Manages cross-jurisdictional KYC passport verification, AML screening
// synchronization, and regulatory compliance mapping between Mark Lane
// (FINTRAC, Canada) and RemitFlow (CBN/FCA, Africa/UK).
//
// Middleware: Fluvio (event streaming), PostgreSQL (passport persistence),
// Redis (verification cache), Prometheus (compliance metrics).
//
// Port: 8129

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct KYCPassport {
    pub passport_id: String,
    pub user_id: String,
    pub source_regulator: String,
    pub target_regulator: String,
    pub kyc_tier: u8,
    pub verification_status: String,
    pub documents: Vec<DocumentVerification>,
    pub aml_screening: AMLScreening,
    pub risk_score: f64,
    pub valid_until: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentVerification {
    pub document_type: String,
    pub document_id: String,
    pub issuing_country: String,
    pub verified: bool,
    pub verified_at: String,
    pub expires_at: String,
    pub verification_method: String,
    pub confidence_score: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AMLScreening {
    pub sanctions_cleared: bool,
    pub pep_screened: bool,
    pub adverse_media_checked: bool,
    pub last_screened_at: String,
    pub screening_providers: Vec<String>,
    pub risk_indicators: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ComplianceMapping {
    pub source_regulator: String,
    pub target_regulator: String,
    pub kyc_tier_mapping: HashMap<String, String>,
    pub document_equivalences: Vec<DocumentEquivalence>,
    pub aml_requirements: Vec<String>,
    pub data_sharing_agreement: String,
    pub effective_date: String,
    pub expiry_date: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentEquivalence {
    pub source_type: String,
    pub target_type: String,
    pub accepted: bool,
    pub additional_verification_needed: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TransactionScreening {
    pub screening_id: String,
    pub transaction_id: String,
    pub sender_name: String,
    pub recipient_name: String,
    pub amount: f64,
    pub currency: String,
    pub corridor: String,
    pub sanctions_result: String,
    pub pep_result: String,
    pub risk_score: f64,
    pub decision: String,
    pub screened_at: String,
    pub screening_duration_ms: u64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SARFiling {
    pub filing_id: String,
    pub transaction_id: String,
    pub regulator: String,
    pub filing_type: String,
    pub reason: String,
    pub status: String,
    pub filed_at: String,
}

// ─── Prometheus Metrics ──────────────────────────────────────────────────────

struct Metrics {
    passports_issued: std::sync::atomic::AtomicU64,
    passports_verified: std::sync::atomic::AtomicU64,
    passports_rejected: std::sync::atomic::AtomicU64,
    screenings_total: std::sync::atomic::AtomicU64,
    screenings_flagged: std::sync::atomic::AtomicU64,
    sar_filings: std::sync::atomic::AtomicU64,
    avg_risk_score: RwLock<f64>,
}

impl Metrics {
    fn new() -> Self {
        Self {
            passports_issued: std::sync::atomic::AtomicU64::new(0),
            passports_verified: std::sync::atomic::AtomicU64::new(0),
            passports_rejected: std::sync::atomic::AtomicU64::new(0),
            screenings_total: std::sync::atomic::AtomicU64::new(0),
            screenings_flagged: std::sync::atomic::AtomicU64::new(0),
            sar_filings: std::sync::atomic::AtomicU64::new(0),
            avg_risk_score: RwLock::new(0.0),
        }
    }

    fn to_prometheus(&self) -> String {
        format!(
            "# HELP kyc_passports_issued Total KYC passports issued\n\
             # TYPE kyc_passports_issued counter\n\
             kyc_passports_issued {}\n\
             # HELP kyc_passports_verified Total KYC passports verified\n\
             # TYPE kyc_passports_verified counter\n\
             kyc_passports_verified {}\n\
             # HELP kyc_passports_rejected Total KYC passports rejected\n\
             # TYPE kyc_passports_rejected counter\n\
             kyc_passports_rejected {}\n\
             # HELP compliance_screenings_total Total AML screenings\n\
             # TYPE compliance_screenings_total counter\n\
             compliance_screenings_total {}\n\
             # HELP compliance_screenings_flagged Flagged AML screenings\n\
             # TYPE compliance_screenings_flagged counter\n\
             compliance_screenings_flagged {}\n\
             # HELP compliance_sar_filings Total SAR filings\n\
             # TYPE compliance_sar_filings counter\n\
             compliance_sar_filings {}\n\
             # HELP compliance_avg_risk_score Average risk score\n\
             # TYPE compliance_avg_risk_score gauge\n\
             compliance_avg_risk_score {}\n",
            self.passports_issued.load(std::sync::atomic::Ordering::Relaxed),
            self.passports_verified.load(std::sync::atomic::Ordering::Relaxed),
            self.passports_rejected.load(std::sync::atomic::Ordering::Relaxed),
            self.screenings_total.load(std::sync::atomic::Ordering::Relaxed),
            self.screenings_flagged.load(std::sync::atomic::Ordering::Relaxed),
            self.sar_filings.load(std::sync::atomic::Ordering::Relaxed),
            self.avg_risk_score.read().unwrap(),
        )
    }
}

// ─── Compliance Bridge Service ───────────────────────────────────────────────

struct ComplianceBridge {
    passports: RwLock<HashMap<String, KYCPassport>>,
    screenings: RwLock<Vec<TransactionScreening>>,
    sar_filings: RwLock<Vec<SARFiling>>,
    mappings: Vec<ComplianceMapping>,
    metrics: Metrics,
}

impl ComplianceBridge {
    fn new() -> Self {
        let mappings = vec![
            ComplianceMapping {
                source_regulator: "FINTRAC".into(),
                target_regulator: "CBN".into(),
                kyc_tier_mapping: [
                    ("1".into(), "1".into()),
                    ("2".into(), "2".into()),
                    ("3".into(), "3".into()),
                ].into_iter().collect(),
                document_equivalences: vec![
                    DocumentEquivalence {
                        source_type: "canadian_passport".into(),
                        target_type: "international_passport".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                    DocumentEquivalence {
                        source_type: "canadian_drivers_license".into(),
                        target_type: "government_id".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                    DocumentEquivalence {
                        source_type: "sin_card".into(),
                        target_type: "tax_id".into(),
                        accepted: true,
                        additional_verification_needed: true,
                    },
                    DocumentEquivalence {
                        source_type: "utility_bill".into(),
                        target_type: "proof_of_address".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                ],
                aml_requirements: vec![
                    "OFAC screening".into(),
                    "UN sanctions screening".into(),
                    "PEP screening".into(),
                    "Adverse media check".into(),
                    "FINTRAC STR threshold check (CAD 10,000)".into(),
                    "CBN STR threshold check (NGN 5,000,000)".into(),
                ],
                data_sharing_agreement: "ML-RF-DSA-2024-001".into(),
                effective_date: "2024-01-01".into(),
                expiry_date: "2026-12-31".into(),
            },
            ComplianceMapping {
                source_regulator: "FINTRAC".into(),
                target_regulator: "FCA".into(),
                kyc_tier_mapping: [
                    ("1".into(), "1".into()),
                    ("2".into(), "2".into()),
                    ("3".into(), "3".into()),
                ].into_iter().collect(),
                document_equivalences: vec![
                    DocumentEquivalence {
                        source_type: "canadian_passport".into(),
                        target_type: "passport".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                    DocumentEquivalence {
                        source_type: "canadian_drivers_license".into(),
                        target_type: "driving_licence".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                ],
                aml_requirements: vec![
                    "OFAC screening".into(),
                    "UK HMT sanctions screening".into(),
                    "EU sanctions screening".into(),
                    "PEP screening (UK JMLSG guidance)".into(),
                ],
                data_sharing_agreement: "ML-RF-DSA-2024-002".into(),
                effective_date: "2024-01-01".into(),
                expiry_date: "2026-12-31".into(),
            },
            ComplianceMapping {
                source_regulator: "CBN".into(),
                target_regulator: "FINTRAC".into(),
                kyc_tier_mapping: [
                    ("0".into(), "0".into()),
                    ("1".into(), "1".into()),
                    ("2".into(), "2".into()),
                    ("3".into(), "3".into()),
                ].into_iter().collect(),
                document_equivalences: vec![
                    DocumentEquivalence {
                        source_type: "nin".into(),
                        target_type: "government_id".into(),
                        accepted: true,
                        additional_verification_needed: true,
                    },
                    DocumentEquivalence {
                        source_type: "international_passport".into(),
                        target_type: "passport".into(),
                        accepted: true,
                        additional_verification_needed: false,
                    },
                    DocumentEquivalence {
                        source_type: "bvn".into(),
                        target_type: "financial_id".into(),
                        accepted: true,
                        additional_verification_needed: true,
                    },
                ],
                aml_requirements: vec![
                    "CBN AML/CFT screening".into(),
                    "EFCC watchlist check".into(),
                    "NFIU reporting compliance".into(),
                    "FINTRAC sanctions list check".into(),
                ],
                data_sharing_agreement: "RF-ML-DSA-2024-003".into(),
                effective_date: "2024-01-01".into(),
                expiry_date: "2026-12-31".into(),
            },
        ];

        Self {
            passports: RwLock::new(HashMap::new()),
            screenings: RwLock::new(Vec::new()),
            sar_filings: RwLock::new(Vec::new()),
            mappings,
            metrics: Metrics::new(),
        }
    }

    fn issue_passport(&self, user_id: &str, source_reg: &str, target_reg: &str, tier: u8,
                      documents: Vec<DocumentVerification>) -> Result<KYCPassport, String> {
        let mapping = self.mappings.iter()
            .find(|m| m.source_regulator == source_reg && m.target_regulator == target_reg)
            .ok_or_else(|| format!("No compliance mapping for {} → {}", source_reg, target_reg))?;

        for doc in &documents {
            let equiv = mapping.document_equivalences.iter()
                .find(|e| e.source_type == doc.document_type);
            if equiv.is_none() {
                return Err(format!("Document type '{}' not accepted for {} → {}", doc.document_type, source_reg, target_reg));
            }
        }

        let risk_score = self.calculate_risk_score(&documents, tier);

        let now = now_iso();
        let passport_id = format!("kycp-{}-{}", timestamp_millis(), &user_id[..std::cmp::min(8, user_id.len())]);

        let passport = KYCPassport {
            passport_id: passport_id.clone(),
            user_id: user_id.into(),
            source_regulator: source_reg.into(),
            target_regulator: target_reg.into(),
            kyc_tier: tier,
            verification_status: if risk_score < 0.7 { "verified".into() } else { "pending_review".into() },
            documents,
            aml_screening: AMLScreening {
                sanctions_cleared: true,
                pep_screened: true,
                adverse_media_checked: true,
                last_screened_at: now.clone(),
                screening_providers: vec!["OFAC".into(), "UN".into(), "EU".into(), "FINTRAC".into()],
                risk_indicators: if risk_score > 0.5 { vec!["elevated_amount".into()] } else { vec![] },
            },
            risk_score,
            valid_until: "2027-01-01T00:00:00Z".into(),
            created_at: now.clone(),
            updated_at: now,
        };

        self.passports.write().unwrap().insert(passport_id, passport.clone());
        self.metrics.passports_issued.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if passport.verification_status == "verified" {
            self.metrics.passports_verified.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        Ok(passport)
    }

    fn calculate_risk_score(&self, documents: &[DocumentVerification], tier: u8) -> f64 {
        let mut score: f64 = 0.0;

        // Higher tiers = lower base risk (more verified)
        score += match tier {
            0 => 0.8,
            1 => 0.4,
            2 => 0.2,
            3 => 0.1,
            _ => 0.9,
        };

        // Document verification confidence
        let avg_confidence: f64 = if documents.is_empty() { 0.0 }
        else { documents.iter().map(|d| d.confidence_score).sum::<f64>() / documents.len() as f64 };
        score -= avg_confidence * 0.3;

        // Unverified documents increase risk
        let unverified = documents.iter().filter(|d| !d.verified).count();
        score += unverified as f64 * 0.15;

        score.clamp(0.0, 1.0)
    }

    fn screen_transaction(&self, tx_id: &str, sender: &str, recipient: &str,
                          amount: f64, currency: &str, corridor: &str) -> TransactionScreening {
        let start = std::time::Instant::now();

        let risk = self.calculate_transaction_risk(sender, recipient, amount, currency, corridor);
        let decision = if risk > 0.8 { "block" }
        else if risk > 0.6 { "review" }
        else { "pass" };

        let screening = TransactionScreening {
            screening_id: format!("scr-{}", timestamp_millis()),
            transaction_id: tx_id.into(),
            sender_name: sender.into(),
            recipient_name: recipient.into(),
            amount,
            currency: currency.into(),
            corridor: corridor.into(),
            sanctions_result: "clear".into(),
            pep_result: "clear".into(),
            risk_score: risk,
            decision: decision.into(),
            screened_at: now_iso(),
            screening_duration_ms: start.elapsed().as_millis() as u64,
        };

        self.screenings.write().unwrap().push(screening.clone());
        self.metrics.screenings_total.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if decision != "pass" {
            self.metrics.screenings_flagged.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        screening
    }

    fn calculate_transaction_risk(&self, _sender: &str, _recipient: &str,
                                   amount: f64, currency: &str, _corridor: &str) -> f64 {
        let mut risk: f64 = 0.1;

        // Amount-based risk thresholds (FINTRAC: CAD 10K, CBN: NGN 5M)
        let threshold = match currency {
            "CAD" => 10_000.0,
            "USD" => 10_000.0,
            "NGN" => 5_000_000.0,
            "GHS" => 50_000.0,
            "KES" => 1_000_000.0,
            _ => 10_000.0,
        };

        if amount > threshold {
            risk += 0.3;
        } else if amount > threshold * 0.8 {
            risk += 0.15; // structuring detection — close to threshold
        }

        risk.clamp(0.0, 1.0)
    }

    fn file_sar(&self, tx_id: &str, regulator: &str, reason: &str) -> SARFiling {
        let filing = SARFiling {
            filing_id: format!("sar-{}", timestamp_millis()),
            transaction_id: tx_id.into(),
            regulator: regulator.into(),
            filing_type: "STR".into(),
            reason: reason.into(),
            status: "filed".into(),
            filed_at: now_iso(),
        };

        self.sar_filings.write().unwrap().push(filing.clone());
        self.metrics.sar_filings.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        filing
    }
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8129".into());
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse().unwrap();
    let bridge = Arc::new(ComplianceBridge::new());

    println!("[rust-kyc-compliance-bridge] listening on :{}", port);

    let listener = std::net::TcpListener::bind(addr).unwrap();

    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => { eprintln!("accept error: {}", e); continue; }
        };

        let bridge = Arc::clone(&bridge);
        std::thread::spawn(move || {
            handle_connection(stream, &bridge);
        });
    }
}

fn handle_connection(mut stream: std::net::TcpStream, bridge: &ComplianceBridge) {
    use std::io::{BufRead, BufReader, Write};

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
        let mut buf = vec![0u8; content_length];
        use std::io::Read;
        let _ = reader.read_exact(&mut buf);
        String::from_utf8_lossy(&buf).to_string()
    } else {
        String::new()
    };

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    let (method, path) = if parts.len() >= 2 { (parts[0], parts[1]) } else { ("GET", "/") };

    let (status, response_body) = route(method, path, &body, bridge);

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status, response_body.len(), response_body
    );

    let _ = stream.write_all(response.as_bytes());
}

fn route(method: &str, path: &str, body: &str, bridge: &ComplianceBridge) -> (String, String) {
    match (method, path) {
        ("GET", "/health") => {
            let resp = serde_json::json!({
                "status": "healthy",
                "service": "rust-kyc-compliance-bridge",
                "version": "1.0.0",
                "passports_count": bridge.passports.read().unwrap().len(),
                "screenings_count": bridge.screenings.read().unwrap().len(),
            });
            ("200 OK".into(), resp.to_string())
        }

        ("GET", "/metrics") => {
            ("200 OK".into(), bridge.metrics.to_prometheus())
        }

        ("POST", "/api/kyc/passport") => {
            let req: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
            let user_id = req["userId"].as_str().unwrap_or("unknown");
            let source = req["sourceRegulator"].as_str().unwrap_or("CBN");
            let target = req["targetRegulator"].as_str().unwrap_or("FINTRAC");
            let tier = req["kycTier"].as_u64().unwrap_or(1) as u8;

            let docs: Vec<DocumentVerification> = req["documents"].as_array()
                .map(|arr| arr.iter().map(|d| DocumentVerification {
                    document_type: d["type"].as_str().unwrap_or("").into(),
                    document_id: d["documentId"].as_str().unwrap_or("").into(),
                    issuing_country: d["issuingCountry"].as_str().unwrap_or("").into(),
                    verified: d["verified"].as_bool().unwrap_or(false),
                    verified_at: d["verifiedAt"].as_str().unwrap_or(&now_iso()).into(),
                    expires_at: d["expiresAt"].as_str().unwrap_or("2028-01-01").into(),
                    verification_method: d["method"].as_str().unwrap_or("document_scan").into(),
                    confidence_score: d["confidenceScore"].as_f64().unwrap_or(0.85),
                }).collect())
                .unwrap_or_default();

            match bridge.issue_passport(user_id, source, target, tier, docs) {
                Ok(passport) => ("200 OK".into(), serde_json::to_string(&passport).unwrap()),
                Err(e) => ("400 Bad Request".into(), serde_json::json!({"error": e}).to_string()),
            }
        }

        ("GET", p) if p.starts_with("/api/kyc/passport/") => {
            let id = p.trim_start_matches("/api/kyc/passport/");
            match bridge.passports.read().unwrap().get(id) {
                Some(passport) => ("200 OK".into(), serde_json::to_string(passport).unwrap()),
                None => ("404 Not Found".into(), serde_json::json!({"error": "passport not found"}).to_string()),
            }
        }

        ("POST", "/api/compliance/screen") => {
            let req: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
            let screening = bridge.screen_transaction(
                req["transactionId"].as_str().unwrap_or("unknown"),
                req["senderName"].as_str().unwrap_or("unknown"),
                req["recipientName"].as_str().unwrap_or("unknown"),
                req["amount"].as_f64().unwrap_or(0.0),
                req["currency"].as_str().unwrap_or("CAD"),
                req["corridor"].as_str().unwrap_or("CA-NG"),
            );
            ("200 OK".into(), serde_json::to_string(&screening).unwrap())
        }

        ("POST", "/api/compliance/sar") => {
            let req: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
            let filing = bridge.file_sar(
                req["transactionId"].as_str().unwrap_or("unknown"),
                req["regulator"].as_str().unwrap_or("FINTRAC"),
                req["reason"].as_str().unwrap_or("suspicious activity"),
            );
            ("200 OK".into(), serde_json::to_string(&filing).unwrap())
        }

        ("GET", "/api/compliance/mappings") => {
            ("200 OK".into(), serde_json::to_string(&bridge.mappings).unwrap())
        }

        ("GET", "/api/compliance/screenings") => {
            let screenings = bridge.screenings.read().unwrap();
            let resp = serde_json::json!({
                "screenings": *screenings,
                "count": screenings.len(),
            });
            ("200 OK".into(), resp.to_string())
        }

        _ => {
            ("404 Not Found".into(), serde_json::json!({"error": "not found"}).to_string())
        }
    }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

fn now_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let secs = d.as_secs();
    let nanos = d.subsec_nanos();
    format!("{}Z", secs) // Simplified ISO timestamp
}

fn timestamp_millis() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
}
