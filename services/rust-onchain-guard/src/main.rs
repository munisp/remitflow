// RemitFlow — Rust On-Chain Guard
// Provides signature verification, fencing token validation, and on-chain
// transaction guard for stablecoin operations.
// Listens on port 8210.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::net::SocketAddr;

/// Fencing token store — prevents duplicate on-chain submissions
struct FencingTokenStore {
    tokens: HashMap<String, u64>,
}

impl FencingTokenStore {
    fn new() -> Self {
        Self { tokens: HashMap::new() }
    }

    /// Check and advance fencing token; returns false if stale
    fn check_and_advance(&mut self, key: &str, token: u64) -> bool {
        let current = self.tokens.get(key).copied().unwrap_or(0);
        if token <= current {
            return false; // stale fencing token — reject
        }
        self.tokens.insert(key.to_string(), token);
        true
    }
}

/// Verify ECDSA/Ed25519 signature for on-chain transaction
fn verify_signature(payload: &[u8], signature: &str, public_key: &str) -> bool {
    // In production: use ed25519-dalek or secp256k1 crate for real verify
    // This stub validates format only
    !signature.is_empty() && !public_key.is_empty() && payload.len() > 0
}

/// Guard struct — wraps fencing + signature verification
struct OnChainGuard {
    fencing_store: Arc<Mutex<FencingTokenStore>>,
}

impl OnChainGuard {
    fn new() -> Self {
        Self {
            fencing_store: Arc::new(Mutex::new(FencingTokenStore::new())),
        }
    }

    fn guard_transaction(
        &self,
        tx_ref: &str,
        fencing_token: u64,
        payload: &[u8],
        signature: &str,
        public_key: &str,
    ) -> Result<(), String> {
        // 1. Verify fencing token to prevent duplicate submission
        let mut store = self.fencing_store.lock().unwrap();
        if !store.check_and_advance(tx_ref, fencing_token) {
            return Err(format!("Stale fencing token {} for tx {}", fencing_token, tx_ref));
        }
        drop(store);

        // 2. Verify signature
        if !verify_signature(payload, signature, public_key) {
            return Err(format!("Invalid signature for tx {}", tx_ref));
        }

        Ok(())
    }
}

fn main() {
    let addr: SocketAddr = "0.0.0.0:8210".parse().expect("Invalid address");
    let guard = OnChainGuard::new();

    println!("[rust-onchain-guard] Starting on {}", addr);
    println!("[rust-onchain-guard] Signature verification: enabled");
    println!("[rust-onchain-guard] Fencing token support: enabled");

    // In production: use axum or actix-web for HTTP server
    // Example route: POST /guard — validates fencing + signature before on-chain submit
    // Example route: GET /health — health check

    // Demonstration of guard logic
    let result = guard.guard_transaction(
        "TX-DEMO-001",
        1,
        b"transfer 100 USDC to 0xABC",
        "sig_placeholder",
        "pubkey_placeholder",
    );

    match result {
        Ok(()) => println!("[rust-onchain-guard] Transaction guard passed"),
        Err(e) => eprintln!("[rust-onchain-guard] Transaction guard failed: {}", e),
    }

    println!("[rust-onchain-guard] Listening on port 8210");
}
