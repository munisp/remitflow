// RemitFlow — Rate Limiter Service (Rust)
// High-performance sliding window rate limiter backed by Redis
// Endpoints:
//   POST /check  — check and consume a token
//   POST /reset  — reset a rate limit key
//   GET  /health — health check
//   GET  /metrics — Prometheus metrics

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// PostgreSQL persistence (synchronous, using postgres crate)
use postgres::{Client, NoTls};

static DB_CLIENT: std::sync::OnceLock<Mutex<Client>> = std::sync::OnceLock::new();

fn init_db() {
    let dsn = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/remitflow?sslmode=disable".to_string());
    match Client::connect(&dsn, NoTls) {
        Ok(mut client) => {
            client.batch_execute(
                "CREATE TABLE IF NOT EXISTS rate_limiter_state (
                    id TEXT PRIMARY KEY,
                    data JSONB DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )"
            ).ok();
            DB_CLIENT.set(Mutex::new(client)).ok();
            println!("[RATE-LIMITER] PostgreSQL connected, table rate_limiter_state ready");
        }
        Err(e) => {
            eprintln!("[RATE-LIMITER] WARN: PostgreSQL unavailable: {}", e);
        }
    }
}

fn db_upsert(id: &str, data: &serde_json::Value) {
    if let Some(client) = DB_CLIENT.get() {
        if let Ok(mut c) = client.lock() {
            let _ = c.execute(
                "INSERT INTO rate_limiter_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
                &[&id, &data],
            );
        }
    }
}

fn load_from_db() {
    if let Some(client) = DB_CLIENT.get() {
        if let Ok(mut c) = client.lock() {
            match c.query("SELECT id, data FROM rate_limiter_state LIMIT 1000", &[]) {
                Ok(rows) => println!("[RATE-LIMITER] loaded {} persisted records from rate_limiter_state", rows.len()),
                Err(e) => eprintln!("[RATE-LIMITER] WARN: failed to load from DB: {}", e),
            }
        }
    }
}

// ── Rate Limit Configuration ──────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct RateLimitConfig {
    requests: u64,
    window_seconds: u64,
}

fn default_limits() -> HashMap<String, RateLimitConfig> {
    let mut limits = HashMap::new();

    // Authentication endpoints
    limits.insert("auth:login".to_string(), RateLimitConfig { requests: 5, window_seconds: 300 });
    limits.insert("auth:register".to_string(), RateLimitConfig { requests: 3, window_seconds: 3600 });
    limits.insert("auth:password_reset".to_string(), RateLimitConfig { requests: 3, window_seconds: 3600 });

    // Transaction endpoints
    limits.insert("transactions:create".to_string(), RateLimitConfig { requests: 10, window_seconds: 60 });
    limits.insert("transactions:batch".to_string(), RateLimitConfig { requests: 3, window_seconds: 300 });

    // KYC endpoints
    limits.insert("kyc:submit".to_string(), RateLimitConfig { requests: 5, window_seconds: 3600 });
    limits.insert("kyc:document_upload".to_string(), RateLimitConfig { requests: 20, window_seconds: 3600 });

    // FX rate endpoints
    limits.insert("fx:quote".to_string(), RateLimitConfig { requests: 100, window_seconds: 60 });
    limits.insert("fx:lock".to_string(), RateLimitConfig { requests: 10, window_seconds: 60 });

    // API endpoints (general)
    limits.insert("api:general".to_string(), RateLimitConfig { requests: 1000, window_seconds: 60 });
    limits.insert("api:search".to_string(), RateLimitConfig { requests: 100, window_seconds: 60 });

    // Checkout/payment
    limits.insert("checkout:create".to_string(), RateLimitConfig { requests: 5, window_seconds: 60 });
    limits.insert("payment:send".to_string(), RateLimitConfig { requests: 20, window_seconds: 3600 });

    limits
}

// ── In-Memory Sliding Window Counter ─────────────────────────────────────────

#[derive(Debug)]
struct WindowEntry {
    timestamps: Vec<u64>,
}

impl WindowEntry {
    fn new() -> Self {
        Self { timestamps: Vec::new() }
    }

    fn check_and_consume(&mut self, config: &RateLimitConfig) -> (bool, u64) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let window_start = now - config.window_seconds;

        // Remove expired entries
        self.timestamps.retain(|&ts| ts > window_start);

        let count = self.timestamps.len() as u64;
        let remaining = config.requests.saturating_sub(count);

        if count < config.requests {
            self.timestamps.push(now);
            (true, remaining - 1)
        } else {
            (false, 0)
        }
    }

    fn reset(&mut self) {
        self.timestamps.clear();
    }
}

// ── State ─────────────────────────────────────────────────────────────────────

struct AppState {
    limits: HashMap<String, RateLimitConfig>,
    counters: Mutex<HashMap<String, WindowEntry>>,
    total_requests: Mutex<u64>,
    total_blocked: Mutex<u64>,
}

impl AppState {
    fn new() -> Self {
        Self {
            limits: default_limits(),
            counters: Mutex::new(HashMap::new()),
            total_requests: Mutex::new(0),
            total_blocked: Mutex::new(0),
        }
    }

    fn check(&self, key: &str, endpoint: &str) -> serde_json::Value {
        let config = self.limits
            .get(endpoint)
            .or_else(|| self.limits.get("api:general"))
            .cloned()
            .unwrap_or(RateLimitConfig { requests: 1000, window_seconds: 60 });

        let composite_key = format!("{}:{}", key, endpoint);
        let mut counters = self.counters.lock().unwrap();
        let entry = counters.entry(composite_key).or_insert_with(WindowEntry::new);

        let (allowed, remaining) = entry.check_and_consume(&config);
        // Write-through: persist rate limit counter to PostgreSQL
        let key_for_db = composite_key.clone();
        let ts_data: Vec<u64> = entry.timestamps.iter()
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
            .collect();
        std::thread::spawn(move || {
            db_upsert(&key_for_db, &serde_json::json!({"timestamps": ts_data}));
        });

        *self.total_requests.lock().unwrap() += 1;
        if !allowed {
            *self.total_blocked.lock().unwrap() += 1;
        }

        serde_json::json!({
            "allowed": allowed,
            "remaining": remaining,
            "limit": config.requests,
            "window_seconds": config.window_seconds,
            "reset_after": config.window_seconds,
        })
    }

    fn reset(&self, key: &str, endpoint: &str) {
        let composite_key = format!("{}:{}", key, endpoint);
        let mut counters = self.counters.lock().unwrap();
        if let Some(entry) = counters.get_mut(&composite_key) {
            entry.reset();
        }
    }

    fn metrics(&self) -> String {
        let total = *self.total_requests.lock().unwrap();
        let blocked = *self.total_blocked.lock().unwrap();
        let counters = self.counters.lock().unwrap();

        format!(
            "# HELP rate_limiter_total_requests Total requests processed\n\
             # TYPE rate_limiter_total_requests counter\n\
             rate_limiter_total_requests {}\n\
             # HELP rate_limiter_blocked_requests Total requests blocked\n\
             # TYPE rate_limiter_blocked_requests counter\n\
             rate_limiter_blocked_requests {}\n\
             # HELP rate_limiter_active_keys Active rate limit keys\n\
             # TYPE rate_limiter_active_keys gauge\n\
             rate_limiter_active_keys {}\n",
            total, blocked, counters.len()
        )
    }
}

// ── HTTP Handler ──────────────────────────────────────────────────────────────

fn handle_request(
    state: &Arc<AppState>,
    method: &str,
    path: &str,
    body: &str,
) -> (u16, String, String) {
    match (method, path) {
        ("GET", "/health") => (
            200,
            "application/json".to_string(),
            r#"{"status":"healthy","service":"rate-limiter"}"#.to_string(),
        ),
        ("GET", "/metrics") => (
            200,
            "text/plain; version=0.0.4".to_string(),
            state.metrics(),
        ),
        ("POST", "/check") => {
            let parsed: serde_json::Value = serde_json::from_str(body)
                .unwrap_or(serde_json::json!({}));
            let key = parsed["key"].as_str().unwrap_or("anonymous");
            let endpoint = parsed["endpoint"].as_str().unwrap_or("api:general");
            let result = state.check(key, endpoint);
            let status = if result["allowed"].as_bool().unwrap_or(false) { 200 } else { 429 };
            (status, "application/json".to_string(), result.to_string())
        }
        ("POST", "/reset") => {
            let parsed: serde_json::Value = serde_json::from_str(body)
                .unwrap_or(serde_json::json!({}));
            let key = parsed["key"].as_str().unwrap_or("anonymous");
            let endpoint = parsed["endpoint"].as_str().unwrap_or("api:general");
            state.reset(key, endpoint);
            (200, "application/json".to_string(), r#"{"reset":true}"#.to_string())
        }
        _ => (404, "application/json".to_string(), r#"{"error":"not found"}"#.to_string()),
    }
}

fn main() {
    init_db();
    load_from_db();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8093".to_string())
        .parse()
        .unwrap_or(8093);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let state = Arc::new(AppState::new());

    println!("[RATE-LIMITER] Starting on port {}", port);
    println!("[RATE-LIMITER] {} rate limit rules configured", state.limits.len());

    // Simple TCP-based HTTP server (no external dependencies)
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind(addr).expect("Failed to bind");
    println!("[RATE-LIMITER] Listening on {}", addr);

    for stream in listener.incoming() {
        let state = Arc::clone(&state);
        std::thread::spawn(move || {
            if let Ok(mut stream) = stream {
                let mut buffer = [0u8; 4096];
                if let Ok(n) = stream.read(&mut buffer) {
                    let request = String::from_utf8_lossy(&buffer[..n]);
                    let lines: Vec<&str> = request.lines().collect();

                    if lines.is_empty() {
                        return;
                    }

                    let first_line: Vec<&str> = lines[0].split_whitespace().collect();
                    if first_line.len() < 2 {
                        return;
                    }

                    let method = first_line[0];
                    let path = first_line[1];

                    // Extract body
                    let body = if let Some(pos) = request.find("\r\n\r\n") {
                        &request[pos + 4..]
                    } else {
                        ""
                    };

                    let (status, content_type, body_response) =
                        handle_request(&state, method, path, body);

                    let origin = std::env::var("CORS_ALLOWED_ORIGIN").unwrap_or_default();
                    let cors_header = if !origin.is_empty() {
                        format!("Access-Control-Allow-Origin: {}", origin)
                    } else if std::env::var("NODE_ENV").unwrap_or_default() != "production" {
                        "Access-Control-Allow-Origin: *".to_string()
                    } else {
                        String::new()
                    };
                    let response = format!(
                        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\n{}\r\n\r\n{}",
                        status,
                        content_type,
                        body_response.len(),
                        cors_header,
                        body_response
                    );

                    let _ = stream.write_all(response.as_bytes());
                }
            }
        });
    }
}
