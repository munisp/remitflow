// RemitFlow P2P Engine (Rust)
// Handles: ILP Streaming payments, Fraud Graph analysis, QR code generation,
// Payment link validation, Multi-party escrow state machine, Alias portability

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::io::{BufRead, Write};

// ═══════════════════════════════════════════════════════════════════════════════
// ILP Streaming Payments — micro-payments streamed per-second
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug)]
struct StreamPayment {
    stream_id: String,
    sender_id: u64,
    receiver_alias: String,
    rate_per_second: f64,  // e.g., $0.001/sec
    currency: String,
    max_amount: f64,
    duration_seconds: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct StreamChunk {
    stream_id: String,
    chunk_number: u64,
    amount: f64,
    cumulative: f64,
    ilp_condition: String,
    ilp_fulfillment: String,
    timestamp_ms: u64,
}

fn generate_ilp_pair(data: &str) -> (String, String) {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    let fulfillment = hex::encode(hasher.finalize());
    let mut cond_hasher = Sha256::new();
    cond_hasher.update(fulfillment.as_bytes());
    let condition = hex::encode(cond_hasher.finalize());
    (condition, fulfillment)
}

fn process_stream(payment: &StreamPayment) -> Vec<StreamChunk> {
    let mut chunks = Vec::new();
    let mut cumulative = 0.0;

    for i in 0..payment.duration_seconds {
        cumulative += payment.rate_per_second;
        if cumulative > payment.max_amount {
            break;
        }
        let data = format!("{}:{}:{}", payment.stream_id, i, payment.rate_per_second);
        let (condition, fulfillment) = generate_ilp_pair(&data);
        chunks.push(StreamChunk {
            stream_id: payment.stream_id.clone(),
            chunk_number: i + 1,
            amount: payment.rate_per_second,
            cumulative,
            ilp_condition: condition,
            ilp_fulfillment: fulfillment,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
                + (i * 1000),
        });
    }
    chunks
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fraud Graph Analysis — detect mule accounts via transaction patterns
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug)]
struct TransactionEdge {
    sender_id: u64,
    receiver_id: u64,
    amount: f64,
    currency: String,
    timestamp_ms: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct FraudGraphResult {
    total_nodes: usize,
    total_edges: usize,
    suspicious_nodes: Vec<SuspiciousNode>,
    ring_detected: bool,
    max_fan_out: usize,
    max_fan_in: usize,
}

#[derive(Serialize, Deserialize, Debug)]
struct SuspiciousNode {
    node_id: u64,
    reason: String,
    risk_score: f64,
    fan_out: usize,
    fan_in: usize,
    total_sent: f64,
    total_received: f64,
}

fn analyze_fraud_graph(edges: &[TransactionEdge]) -> FraudGraphResult {
    let mut out_degree: HashMap<u64, Vec<&TransactionEdge>> = HashMap::new();
    let mut in_degree: HashMap<u64, Vec<&TransactionEdge>> = HashMap::new();
    let mut nodes = std::collections::HashSet::new();

    for e in edges {
        out_degree.entry(e.sender_id).or_default().push(e);
        in_degree.entry(e.receiver_id).or_default().push(e);
        nodes.insert(e.sender_id);
        nodes.insert(e.receiver_id);
    }

    let mut suspicious = Vec::new();
    let mut max_fan_out = 0usize;
    let mut max_fan_in = 0usize;

    for &node in &nodes {
        let outs = out_degree.get(&node).map(|v| v.len()).unwrap_or(0);
        let ins = in_degree.get(&node).map(|v| v.len()).unwrap_or(0);
        let total_sent: f64 = out_degree.get(&node).map(|v| v.iter().map(|e| e.amount).sum()).unwrap_or(0.0);
        let total_received: f64 = in_degree.get(&node).map(|v| v.iter().map(|e| e.amount).sum()).unwrap_or(0.0);

        max_fan_out = max_fan_out.max(outs);
        max_fan_in = max_fan_in.max(ins);

        // Mule detection: high fan-in + high fan-out (pass-through)
        if outs >= 5 && ins >= 5 {
            suspicious.push(SuspiciousNode {
                node_id: node,
                reason: "high_fanin_fanout_mule_pattern".to_string(),
                risk_score: 0.9,
                fan_out: outs,
                fan_in: ins,
                total_sent,
                total_received,
            });
        }
        // Structuring: many small outgoing transactions
        else if outs >= 10 && total_sent / (outs as f64) < 50.0 {
            suspicious.push(SuspiciousNode {
                node_id: node,
                reason: "structuring_many_small_sends".to_string(),
                risk_score: 0.75,
                fan_out: outs,
                fan_in: ins,
                total_sent,
                total_received,
            });
        }
        // Velocity: received a lot then sent a lot quickly
        else if total_received > 10000.0 && total_sent > total_received * 0.9 {
            suspicious.push(SuspiciousNode {
                node_id: node,
                reason: "rapid_pass_through".to_string(),
                risk_score: 0.85,
                fan_out: outs,
                fan_in: ins,
                total_sent,
                total_received,
            });
        }
    }

    // Ring detection: A→B→C→A (simple cycle detection)
    let ring_detected = detect_rings(&out_degree);

    FraudGraphResult {
        total_nodes: nodes.len(),
        total_edges: edges.len(),
        suspicious_nodes: suspicious,
        ring_detected,
        max_fan_out,
        max_fan_in,
    }
}

fn detect_rings(graph: &HashMap<u64, Vec<&TransactionEdge>>) -> bool {
    for (&start, neighbors) in graph {
        for edge in neighbors {
            if let Some(second_hop) = graph.get(&edge.receiver_id) {
                for e2 in second_hop {
                    if e2.receiver_id == start {
                        return true; // Found A→B→A or A→B→C→A
                    }
                    if let Some(third_hop) = graph.get(&e2.receiver_id) {
                        for e3 in third_hop {
                            if e3.receiver_id == start {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

// ═══════════════════════════════════════════════════════════════════════════════
// QR Code Payment Data — generates structured payment payload
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug)]
struct QRPaymentData {
    version: u8,
    alias: String,
    alias_type: String,
    amount: Option<f64>,
    currency: String,
    note: Option<String>,
    checksum: String,
}

fn generate_qr_data(alias: &str, alias_type: &str, amount: Option<f64>, currency: &str, note: Option<&str>) -> QRPaymentData {
    let payload = format!("{}:{}:{}:{}", alias, alias_type, amount.unwrap_or(0.0), currency);
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    let checksum = hex::encode(&hasher.finalize()[..4]);

    QRPaymentData {
        version: 1,
        alias: alias.to_string(),
        alias_type: alias_type.to_string(),
        amount,
        currency: currency.to_string(),
        note: note.map(|s| s.to_string()),
        checksum,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-Party Escrow State Machine
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
enum EscrowState {
    Created,
    Funded,
    ConditionMet,
    Released,
    Disputed,
    Refunded,
}

#[derive(Serialize, Deserialize, Debug)]
struct EscrowContract {
    escrow_id: String,
    buyer_id: u64,
    seller_id: u64,
    arbiter_id: Option<u64>,
    amount: f64,
    currency: String,
    state: EscrowState,
    conditions: Vec<String>,
    conditions_met: Vec<bool>,
}

fn transition_escrow(contract: &mut EscrowContract, action: &str) -> Result<String, String> {
    match (contract.state.clone(), action) {
        (EscrowState::Created, "fund") => {
            contract.state = EscrowState::Funded;
            Ok("Escrow funded — awaiting conditions".to_string())
        }
        (EscrowState::Funded, "meet_condition") => {
            let all_met = contract.conditions_met.iter().all(|&m| m);
            if all_met {
                contract.state = EscrowState::ConditionMet;
                Ok("All conditions met — ready for release".to_string())
            } else {
                Ok("Condition recorded — waiting for remaining conditions".to_string())
            }
        }
        (EscrowState::ConditionMet, "release") | (EscrowState::Funded, "release") => {
            contract.state = EscrowState::Released;
            Ok("Funds released to seller".to_string())
        }
        (EscrowState::Funded, "dispute") => {
            contract.state = EscrowState::Disputed;
            Ok("Dispute opened — arbiter will review".to_string())
        }
        (EscrowState::Disputed, "refund") => {
            contract.state = EscrowState::Refunded;
            Ok("Funds refunded to buyer".to_string())
        }
        (EscrowState::Disputed, "release") => {
            contract.state = EscrowState::Released;
            Ok("Arbiter released funds to seller".to_string())
        }
        _ => Err(format!("Invalid transition: {:?} + {}", contract.state, action)),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON-RPC style stdin/stdout protocol (like LSP)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug)]
struct RpcRequest {
    method: String,
    params: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
struct RpcResponse {
    method: String,
    result: serde_json::Value,
    error: Option<String>,
}

fn handle_request(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "ilp_stream" => {
            match serde_json::from_value::<StreamPayment>(req.params) {
                Ok(payment) => {
                    let chunks = process_stream(&payment);
                    RpcResponse {
                        method: req.method,
                        result: serde_json::to_value(&chunks).unwrap_or_default(),
                        error: None,
                    }
                }
                Err(e) => RpcResponse { method: req.method, result: serde_json::Value::Null, error: Some(e.to_string()) },
            }
        }
        "fraud_graph" => {
            match serde_json::from_value::<Vec<TransactionEdge>>(req.params) {
                Ok(edges) => {
                    let result = analyze_fraud_graph(&edges);
                    RpcResponse {
                        method: req.method,
                        result: serde_json::to_value(&result).unwrap_or_default(),
                        error: None,
                    }
                }
                Err(e) => RpcResponse { method: req.method, result: serde_json::Value::Null, error: Some(e.to_string()) },
            }
        }
        "qr_generate" => {
            #[derive(Deserialize)]
            struct QRReq { alias: String, alias_type: String, amount: Option<f64>, currency: String, note: Option<String> }
            match serde_json::from_value::<QRReq>(req.params) {
                Ok(qr) => {
                    let data = generate_qr_data(&qr.alias, &qr.alias_type, qr.amount, &qr.currency, qr.note.as_deref());
                    RpcResponse {
                        method: req.method,
                        result: serde_json::to_value(&data).unwrap_or_default(),
                        error: None,
                    }
                }
                Err(e) => RpcResponse { method: req.method, result: serde_json::Value::Null, error: Some(e.to_string()) },
            }
        }
        "escrow_transition" => {
            #[derive(Deserialize)]
            struct EscrowReq { contract: EscrowContract, action: String }
            match serde_json::from_value::<EscrowReq>(req.params) {
                Ok(mut er) => {
                    match transition_escrow(&mut er.contract, &er.action) {
                        Ok(msg) => RpcResponse {
                            method: req.method,
                            result: serde_json::json!({ "state": er.contract.state, "message": msg, "contract": er.contract }),
                            error: None,
                        },
                        Err(e) => RpcResponse { method: req.method, result: serde_json::Value::Null, error: Some(e) },
                    }
                }
                Err(e) => RpcResponse { method: req.method, result: serde_json::Value::Null, error: Some(e.to_string()) },
            }
        }
        _ => RpcResponse {
            method: req.method,
            result: serde_json::Value::Null,
            error: Some("Unknown method".to_string()),
        },
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("unknown panic");
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        eprintln!("[PANIC] {} at {}", msg, location);
    }));

    eprintln!("[P2P Engine Rust] Ready — stdin/stdout JSON-RPC");
    eprintln!("[P2P Engine Rust] Methods: ilp_stream, fraud_graph, qr_generate, escrow_transition");

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let req: RpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let err = RpcResponse {
                    method: "error".to_string(),
                    result: serde_json::Value::Null,
                    error: Some(format!("Parse error: {}", e)),
                };
                let _ = writeln!(stdout, "{}", serde_json::to_string(&err).unwrap_or_default());
                let _ = stdout.flush();
                continue;
            }
        };

        let resp = handle_request(req);
        let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap_or_default());
        let _ = stdout.flush();
    }
}
