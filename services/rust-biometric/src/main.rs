/*!
RemitFlow — Rust Biometric Matching Service (wave-15 REAL implementation)

Pipeline (no pseudo-embeddings anywhere — all failure modes are errors):
  base64 image → stb_image decode (vendored C, public domain/MIT)
    → YuNet ONNX face detection (env YUNET_MODEL_PATH; opencv_zoo, MIT)
    → similarity-transform alignment to 112×112 (ArcFace reference landmarks)
    → AdaFace IR-50 ONNX embedding (env ADAFACE_MODEL_PATH; weights MIT,
      dataset-provenance gray zone — trained on MS1MV2, see
      THIRD-PARTY-NOTICES.md) or SFace (env SFACE_MODEL_PATH; Apache-2.0,
      zero-gray alternative) selected via env FACE_MODEL=adaface|sface
    → L2-normalized embedding (512-d AdaFace / 128-d SFace)
    → PostgreSQL persistence (`biometric_embeddings`, drizzle 0095)

Replaces the previous stub: SHA-256 hash pseudo-embeddings in an in-memory
HashMap, plus a commented-out non-commercial ArcFace/buffalo_l sketch.
InsightFace buffalo_l weights carry a NON-COMMERCIAL license and are
PROHIBITED in this repo (THIRD-PARTY-NOTICES.md); AdaFace/SFace via `ort`
is the compliant replacement and there is no fallback path.

FAIL CLOSED:
  - missing/unloadable model weights → service refuses to boot (exit 1)
  - DB down / not configured → endpoints return 503, /readyz fails,
    /health reports db_connected:false — never an in-memory substitute

Port: 8149
*/

mod db;
mod face;
mod imgdec;

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use prometheus::{
    register_counter_vec, register_histogram, register_int_gauge, CounterVec, Histogram, IntGauge,
    TextEncoder,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use tracing::{error, info, warn};

use db::Db;
use face::ModelKind;

// ── Config ────────────────────────────────────────────────────────────────────
fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(default)
}

// ── Prometheus Metrics ────────────────────────────────────────────────────────
lazy_static::lazy_static! {
    static ref MATCH_REQUESTS: CounterVec = register_counter_vec!(
        "remitflow_biometric_match_total",
        "Total biometric match requests",
        &["result"]
    ).unwrap();

    static ref ENROLL_REQUESTS: CounterVec = register_counter_vec!(
        "remitflow_biometric_enroll_total",
        "Total biometric enrollment requests",
        &["status"]
    ).unwrap();

    static ref DEDUP_FLAGS: CounterVec = register_counter_vec!(
        "remitflow_biometric_dedup_total",
        "Duplicate-identity review flags (never auto-block)",
        &["action"]
    ).unwrap();

    static ref MATCH_LATENCY: Histogram = register_histogram!(
        "remitflow_biometric_match_duration_seconds",
        "Biometric match processing time",
        vec![0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0]
    ).unwrap();

    static ref ENROLLED_COUNT: IntGauge = register_int_gauge!(
        "remitflow_biometric_enrolled_count",
        "Total enrolled biometric profiles (from Postgres)"
    ).unwrap();
}

// ── Data Models ───────────────────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
struct EnrollRequest {
    user_id: i64,
    image_base64: String,
    /// Accepted for legacy API compatibility; the DB schema stores `source`
    /// (capture|document_portrait|nfc_dg2), not document type.
    #[allow(dead_code)]
    doc_type: Option<String>,
    quality_score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct EmbedRequest {
    /// Optional: when absent, /embed runs stateless — computes and returns the
    /// embedding without touching Postgres (python-kyc-liveness calls it this
    /// way). When present, behavior is unchanged: upsert-persist the embedding.
    user_id: Option<i64>,
    image_base64: String,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MatchRequest {
    user_id: i64,
    image_base64: String,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    user_id: i64,
    image_base64: String,
    /// Accepted for legacy API compatibility (token-echo field); the service
    /// issues a fresh HMAC token on a successful match instead.
    #[allow(dead_code)]
    token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DedupRequest {
    image_base64: String,
}

#[derive(Debug, Deserialize)]
struct DedupScanRequest {
    image_base64: String,
    exclude_user_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct EnrollResponse {
    profile_id: String,
    user_id: i64,
    quality_score: f64,
    enrolled: bool,
    message: String,
    model: String,
    embedding_dim: usize,
    persisted: bool,
}

#[derive(Debug, Serialize)]
struct EmbedResponse {
    /// Echoes the request's user_id, or null for stateless embeds.
    user_id: Option<i64>,
    model: String,
    embedding_dim: usize,
    /// The raw embedding vector — always returned (stateless callers need it).
    embedding: Vec<f32>,
    persisted: bool,
    message: String,
}

#[derive(Debug, Serialize)]
struct MatchResponse {
    user_id: i64,
    matched: bool,
    similarity: f64,
    threshold: f64,
    profile_id: Option<String>,
    token: Option<String>,
    latency_ms: u64,
}

#[derive(Debug, Serialize)]
struct VerifyResponse {
    user_id: i64,
    matched: bool,
    similarity: f64,
    threshold: f64,
    model: String,
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct DedupMatch {
    user_id: i64,
    similarity: f64,
}

/// Review-flag response: NEVER auto-blocks. Consumers must route positive
/// flags to manual review.
#[derive(Debug, Serialize)]
struct DedupResponse {
    is_duplicate: bool,
    matched_user_id: Option<i64>,
    similarity: f64,
    action: String, // "flag_for_review" | "allow"
    threshold: f64,
    matches: Vec<DedupMatch>,
}

#[derive(Debug, Serialize)]
struct DedupScanResponse {
    flagged: bool,
    flag_count: usize,
    matches: Vec<DedupMatch>,
    threshold: f64,
    action: String, // always "flag_for_review" when flagged
    model: String,
}

// ── App State ─────────────────────────────────────────────────────────────────
struct AppState {
    det: Mutex<ort::session::Session>,
    rec: Mutex<ort::session::Session>,
    model_kind: ModelKind,
    model_name: String,
    embedding_dim: usize,
    det_score_threshold: f32,
    det_max_dim: usize,
    match_threshold: f64,
    dedup_flag_threshold: f64,
    db: tokio::sync::RwLock<Option<Db>>,
    db_url: Option<String>,
    hmac_key: Vec<u8>,
}

type SharedState = Arc<AppState>;

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, String) {
    (status, msg.into())
}

/// DB handle or 503. Reconnects lazily after an outage; never substitutes
/// an in-memory store (fail closed).
async fn get_db(state: &SharedState) -> Result<Db, (StatusCode, String)> {
    if let Some(db) = state.db.read().await.as_ref() {
        return Ok(db.clone());
    }
    let url = match &state.db_url {
        Some(u) => u.clone(),
        None => {
            return Err(err(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATABASE_URL not configured: biometric persistence unavailable (fail closed)",
            ))
        }
    };
    match Db::connect(&url).await {
        Ok(db) => {
            info!("[Biometric] Postgres (re)connected");
            *state.db.write().await = Some(db.clone());
            Ok(db)
        }
        Err(e) => Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("database unavailable: {e} (fail closed)"),
        )),
    }
}

fn to_db_user_id(user_id: i64) -> Result<i32, (StatusCode, String)> {
    i32::try_from(user_id).map_err(|_| {
        err(
            StatusCode::BAD_REQUEST,
            format!("user_id {user_id} out of range for biometric_embeddings.\"userId\" (integer)"),
        )
    })
}

/// Map a sqlx error to an HTTP error. Connectivity failures evict the cached
/// pool (next request lazily reconnects) and return 503 — fail closed, never
/// a substitute store.
async fn db_err(state: &SharedState, e: sqlx::Error) -> (StatusCode, String) {
    let connectivity = matches!(
        e,
        sqlx::Error::Io(_)
            | sqlx::Error::PoolTimedOut
            | sqlx::Error::PoolClosed
            | sqlx::Error::WorkerCrashed
    );
    if connectivity {
        *state.db.write().await = None;
        err(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("database unavailable: {e} (fail closed)"),
        )
    } else {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("database error: {e}"),
        )
    }
}

/// Full pipeline: base64 → decode → detect → align → embed. Runs on the
/// blocking pool because ONNX inference is CPU-bound. FAIL CLOSED on every
/// stage; there is deliberately no pseudo-embedding fallback.
async fn embed_pipeline(
    state: &SharedState,
    image_base64: &str,
) -> Result<Vec<f64>, (StatusCode, String)> {
    let image_bytes = B64
        .decode(image_base64)
        .map_err(|e| err(StatusCode::BAD_REQUEST, format!("Invalid base64: {e}")))?;

    let st = state.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<f64>, String> {
        let img = imgdec::decode_rgb(&image_bytes)?;
        let (face_found, n_faces) = {
            let mut det = st
                .det
                .lock()
                .map_err(|_| "detector lock poisoned".to_string())?;
            face::detect_face(&mut det, &img, st.det_score_threshold, st.det_max_dim)?
        };
        if n_faces > 1 {
            warn!(
                "[Biometric] {n_faces} faces detected; using highest-scoring (score={:.3})",
                face_found.score
            );
        }
        let aligned = face::align_face(&img, &face_found)?;
        let mut rec = st
            .rec
            .lock()
            .map_err(|_| "recognizer lock poisoned".to_string())?;
        face::compute_embedding(&mut rec, &aligned, st.model_kind)
    })
    .await
    .map_err(|e| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("pipeline join: {e}"),
        )
    })?
    .map_err(|e| err(StatusCode::UNPROCESSABLE_ENTITY, e))
}

/// Estimate image quality score from raw bytes (legacy heuristic: larger
/// images tend to be higher quality; NOT a certified quality metric).
fn estimate_quality(image_base64: &str) -> f64 {
    let approx_bytes = image_base64.len() as f64 * 0.75;
    0.5 + (approx_bytes / 50_000.0).min(1.0) * 0.5
}

/// HMAC-signed biometric verification token (legacy cross-service contract).
fn sign_token(user_id: i64, similarity: f64, key: &[u8]) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let payload = format!("{user_id}:{similarity:.4}:{timestamp}");
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key error");
    mac.update(payload.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    B64.encode(format!("{payload}:{sig}").as_bytes())
}

// ── Handlers ──────────────────────────────────────────────────────────────────
async fn health_handler(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let db_connected = match state.db.read().await.as_ref() {
        Some(db) => db.ping().await,
        None => false,
    };
    Json(serde_json::json!({
        "status":  if db_connected { "healthy" } else { "degraded" },
        "service": "rust-biometric",
        "version": "2.0.0",
        "detector": "yunet",
        "model": state.model_name,
        "model_loaded": true,   // service refuses to boot without weights
        "db_connected": db_connected,
        "embedding_dim": state.embedding_dim,
        "match_threshold": state.match_threshold,
        "dedup_flag_threshold": state.dedup_flag_threshold,
        "persistence": "postgres:biometric_embeddings",
    }))
}

async fn readyz_handler(State(state): State<SharedState>) -> (StatusCode, Json<serde_json::Value>) {
    // Readiness reflects REAL dependencies: model is guaranteed by fail-closed
    // boot; DB must be reachable.
    let db_connected = match state.db.read().await.as_ref() {
        Some(db) => db.ping().await,
        None => false,
    };
    let code = if db_connected {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        code,
        Json(serde_json::json!({
            "ready": db_connected,
            "model_loaded": true,
            "db_connected": db_connected,
        })),
    )
}

async fn metrics_handler() -> (StatusCode, String) {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    match encoder.encode_to_string(&metric_families) {
        Ok(output) => (StatusCode::OK, output),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// POST /embed — image → embedding.
///
/// Two shapes, backward compatible:
///   - `{user_id, image_base64, source?}`: embed + upsert-persist (unchanged;
///     DB down → error, fail-closed).
///   - `{image_base64}` only (python-kyc-liveness): stateless — computes and
///     returns the embedding, skips Postgres entirely so it still answers when
///     the DB is down.
async fn embed_handler(
    State(state): State<SharedState>,
    Json(req): Json<EmbedRequest>,
) -> Result<Json<EmbedResponse>, (StatusCode, String)> {
    let embedding = embed_pipeline(&state, &req.image_base64).await?;
    let embedding_dim = embedding.len();
    // Response contract is Vec<f32> (native ONNX precision); the pipeline
    // works in f64 internally, so narrow a copy for the wire.
    let embedding_f32: Vec<f32> = embedding.iter().map(|&x| x as f32).collect();

    if let Some(user_id) = req.user_id {
        // Persistent path — identical semantics to the pre-wave-15-final handler.
        let db = get_db(&state).await?;
        let uid = to_db_user_id(user_id)?;
        let source = req.source.unwrap_or_else(|| "capture".to_string());
        if let Err(e) = db.upsert(uid, &state.model_name, &embedding, &source).await {
            return Err(db_err(&state, e).await);
        }

        ENROLL_REQUESTS.with_label_values(&["success"]).inc();
        if let Ok(n) = db.count().await {
            ENROLLED_COUNT.set(n);
        }
        info!(
            "[Biometric] /embed user_id={} model={} dim={} persisted",
            user_id, state.model_name, embedding_dim
        );

        return Ok(Json(EmbedResponse {
            user_id: Some(user_id),
            model: state.model_name.clone(),
            embedding_dim,
            embedding: embedding_f32,
            persisted: true,
            message: "Embedding computed and persisted (upsert)".to_string(),
        }));
    }

    // Stateless path — no get_db() call at all; must answer even with Postgres down.
    info!(
        "[Biometric] /embed stateless model={} dim={} (no user_id — not persisted, DB untouched)",
        state.model_name, embedding_dim
    );

    Ok(Json(EmbedResponse {
        user_id: None,
        model: state.model_name.clone(),
        embedding_dim,
        embedding: embedding_f32,
        persisted: false,
        message: "Embedding computed (stateless, not persisted)".to_string(),
    }))
}

/// POST /verify — 1:1 cosine against the stored embedding.
async fn verify_handler(
    State(state): State<SharedState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, (StatusCode, String)> {
    let db = get_db(&state).await?;
    let uid = to_db_user_id(req.user_id)?;
    let probe = embed_pipeline(&state, &req.image_base64).await?;

    let stored = match db.get(uid).await {
        Ok(v) => v,
        Err(e) => return Err(db_err(&state, e).await),
    };

    let (stored_model, stored_emb) = match stored {
        None => {
            MATCH_REQUESTS.with_label_values(&["no_profile"]).inc();
            return Ok(Json(VerifyResponse {
                user_id: req.user_id,
                matched: false,
                similarity: 0.0,
                threshold: state.match_threshold,
                model: state.model_name.clone(),
                token: None,
            }));
        }
        Some(v) => v,
    };
    if stored_model != state.model_name || stored_emb.len() != probe.len() {
        MATCH_REQUESTS.with_label_values(&["model_mismatch"]).inc();
        return Err(err(
            StatusCode::CONFLICT,
            format!(
                "stored embedding is model={} dim={} but service runs model={} dim={} — re-enroll required",
                stored_model, stored_emb.len(), state.model_name, probe.len()
            ),
        ));
    }

    let similarity = face::cosine_similarity(&probe, &stored_emb);
    let matched = similarity >= state.match_threshold;
    let token = if matched {
        Some(sign_token(req.user_id, similarity, &state.hmac_key))
    } else {
        None
    };
    MATCH_REQUESTS
        .with_label_values(&[if matched { "match" } else { "no_match" }])
        .inc();
    info!(
        "[Biometric] /verify user_id={} similarity={:.4} matched={}",
        req.user_id, similarity, matched
    );

    Ok(Json(VerifyResponse {
        user_id: req.user_id,
        matched,
        similarity: (similarity * 10000.0).round() / 10000.0,
        threshold: state.match_threshold,
        model: state.model_name.clone(),
        token,
    }))
}

/// POST /dedup-scan — 1:N cosine scan in SQL. Returns matches ≥
/// DEDUP_FLAG_THRESHOLD as REVIEW FLAGS. Never auto-blocks.
async fn dedup_scan_handler(
    State(state): State<SharedState>,
    Json(req): Json<DedupScanRequest>,
) -> Result<Json<DedupScanResponse>, (StatusCode, String)> {
    let db = get_db(&state).await?;
    let probe = embed_pipeline(&state, &req.image_base64).await?;

    let exclude = match req.exclude_user_id {
        Some(id) => Some(to_db_user_id(id)?),
        None => None,
    };

    let matches = match db
        .scan(&probe, &state.model_name, state.dedup_flag_threshold, 10)
        .await
    {
        Ok(m) => m,
        Err(e) => return Err(db_err(&state, e).await),
    }
    .into_iter()
    .filter(|m| Some(m.user_id) != exclude)
    .map(|m| DedupMatch {
        user_id: m.user_id as i64,
        similarity: (m.similarity * 10000.0).round() / 10000.0,
    })
    .collect::<Vec<_>>();

    let flagged = !matches.is_empty();
    if flagged {
        DEDUP_FLAGS.with_label_values(&["flag_for_review"]).inc();
        warn!("[Biometric] /dedup-scan flagged {} candidate(s) ≥ {:.2} — route to manual review (never auto-block)",
              matches.len(), state.dedup_flag_threshold);
    } else {
        DEDUP_FLAGS.with_label_values(&["clear"]).inc();
    }

    Ok(Json(DedupScanResponse {
        flagged,
        flag_count: matches.len(),
        matches,
        threshold: state.dedup_flag_threshold,
        action: if flagged { "flag_for_review" } else { "allow" }.to_string(),
        model: state.model_name.clone(),
    }))
}

// ── Legacy endpoints (pre-wave-15 API shape preserved) ───────────────────────

/// POST /biometric/enroll — legacy shape; same real pipeline + Postgres.
async fn enroll_handler(
    State(state): State<SharedState>,
    Json(req): Json<EnrollRequest>,
) -> Result<Json<EnrollResponse>, (StatusCode, String)> {
    let quality = req
        .quality_score
        .unwrap_or_else(|| estimate_quality(&req.image_base64));
    if quality < 0.30 {
        ENROLL_REQUESTS
            .with_label_values(&["rejected_low_quality"])
            .inc();
        return Ok(Json(EnrollResponse {
            profile_id: String::new(),
            user_id: req.user_id,
            quality_score: quality,
            enrolled: false,
            message: format!("Image quality too low: {quality:.3}. Minimum: 0.30"),
            model: state.model_name.clone(),
            embedding_dim: state.embedding_dim,
            persisted: false,
        }));
    }

    let db = get_db(&state).await?;
    let uid = to_db_user_id(req.user_id)?;
    let embedding = embed_pipeline(&state, &req.image_base64).await?;
    if let Err(e) = db
        .upsert(uid, &state.model_name, &embedding, "capture")
        .await
    {
        return Err(db_err(&state, e).await);
    }

    ENROLL_REQUESTS.with_label_values(&["success"]).inc();
    if let Ok(n) = db.count().await {
        ENROLLED_COUNT.set(n);
    }
    info!(
        "[Biometric] /biometric/enroll user_id={} quality={:.3} dim={}",
        req.user_id,
        quality,
        embedding.len()
    );

    Ok(Json(EnrollResponse {
        profile_id: format!("pg:{uid}"), // embeddings are keyed by "userId"; no separate profile store
        user_id: req.user_id,
        quality_score: quality,
        enrolled: true,
        message: "Biometric profile enrolled (Postgres upsert)".to_string(),
        model: state.model_name.clone(),
        embedding_dim: embedding.len(),
        persisted: true,
    }))
}

/// POST /biometric/match — legacy shape; identical semantics to /verify.
async fn match_handler(
    State(state): State<SharedState>,
    Json(req): Json<MatchRequest>,
) -> Result<Json<MatchResponse>, (StatusCode, String)> {
    let start = std::time::Instant::now();
    let resp = verify_handler(
        State(state.clone()),
        Json(VerifyRequest {
            user_id: req.user_id,
            image_base64: req.image_base64,
            token: None,
        }),
    )
    .await?;
    let latency_ms = start.elapsed().as_millis() as u64;
    MATCH_LATENCY.observe(start.elapsed().as_secs_f64());
    let r = resp.0;
    Ok(Json(MatchResponse {
        user_id: r.user_id,
        matched: r.matched,
        similarity: r.similarity,
        threshold: r.threshold,
        profile_id: if r.matched {
            Some(format!("pg:{}", r.user_id))
        } else {
            None
        },
        token: r.token,
        latency_ms,
    }))
}

/// POST /biometric/dedup — legacy shape. ACTION CHANGED in wave 15: was
/// "block_duplicate_identity", now always "flag_for_review" (never auto-block).
async fn dedup_handler(
    State(state): State<SharedState>,
    Json(req): Json<DedupRequest>,
) -> Result<Json<DedupResponse>, (StatusCode, String)> {
    let resp = dedup_scan_handler(
        State(state),
        Json(DedupScanRequest {
            image_base64: req.image_base64,
            exclude_user_id: None,
        }),
    )
    .await?;
    let r = resp.0;
    let best = r.matches.first();
    Ok(Json(DedupResponse {
        is_duplicate: r.flagged,
        matched_user_id: best.map(|m| m.user_id),
        similarity: best.map(|m| m.similarity).unwrap_or(0.0),
        action: if r.flagged {
            "flag_for_review"
        } else {
            "allow"
        }
        .to_string(),
        threshold: r.threshold,
        matches: r.matches,
    }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

/// `--health-check`: used by the Dockerfile HEALTHCHECK. Exits 0 only if the
/// local /livez endpoint answers; no HTTP client dep, raw TCP.
fn health_check_cli() -> ! {
    use std::io::{Read, Write};
    let port: u16 = env("PORT", "8149").parse().unwrap_or(8149);
    let ok = (|| -> std::io::Result<bool> {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port))?;
        s.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
        s.write_all(b"GET /livez HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
        let mut buf = String::new();
        s.read_to_string(&mut buf)?;
        Ok(buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200"))
    })()
    .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 });
}

#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--health-check") {
        health_check_cli();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("rust_biometric=info".parse().unwrap()),
        )
        .init();

    let port = env("PORT", "8149");
    // FAIL CLOSED: no default HMAC key — refuse to boot when unset rather
    // than ship a publicly known biometric-token signing key.
    let hmac_key = std::env::var("BIOMETRIC_HMAC_KEY")
        .expect("BIOMETRIC_HMAC_KEY is not set: refusing to fall back to a well-known default credential; configure it explicitly");

    // ── Model selection ────────────────────────────────────────────────────
    // FACE_MODEL=adaface (default; MIT weights, MS1MV2 dataset-provenance
    // gray zone — disclosed in THIRD-PARTY-NOTICES.md) | sface (Apache-2.0,
    // zero gray zone, lower accuracy).
    let model_kind = match env("FACE_MODEL", "adaface").as_str() {
        "adaface" => ModelKind::AdaFace,
        "sface" => ModelKind::SFace,
        other => {
            error!(
                "[Biometric] FACE_MODEL={other} invalid (expected adaface|sface); refusing to boot"
            );
            std::process::exit(1);
        }
    };
    let rec_path = match model_kind {
        ModelKind::AdaFace => env("ADAFACE_MODEL_PATH", "models/adaface_ir50.onnx"),
        ModelKind::SFace => env("SFACE_MODEL_PATH", "models/sface_2021dec.onnx"),
    };
    let det_path = env("YUNET_MODEL_PATH", "models/yunet_2023mar.onnx");

    // FAIL CLOSED: missing weights → no pseudo-embedding fallback, no boot.
    for (label, path) in [("YuNet detector", &det_path), ("recognizer", &rec_path)] {
        if !std::path::Path::new(path).is_file() {
            error!(
                "[Biometric] FAIL CLOSED: {label} weights not found at '{path}'. \
                 Set YUNET_MODEL_PATH/ADAFACE_MODEL_PATH/SFACE_MODEL_PATH. \
                 There is no fallback — refusing to boot."
            );
            std::process::exit(1);
        }
    }

    let _ = ort::init().with_name("rust-biometric").commit();

    let build_session = |path: &str, label: &str| -> ort::session::Session {
        let built = (|| -> Result<ort::session::Session, String> {
            let b = ort::session::Session::builder().map_err(|e| e.to_string())?;
            let b = b
                .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                .map_err(|e| e.to_string())?;
            let mut b = b.with_intra_threads(2).map_err(|e| e.to_string())?;
            b.commit_from_file(path).map_err(|e| e.to_string())
        })();
        match built {
            Ok(s) => s,
            Err(e) => {
                error!("[Biometric] FAIL CLOSED: could not load {label} ONNX from '{path}': {e}. Refusing to boot.");
                std::process::exit(1);
            }
        }
    };
    let det_session = build_session(&det_path, "YuNet detector");
    let rec_session = build_session(&rec_path, model_kind.model_label());

    let embedding_dim = model_kind.expected_dim();
    info!(
        "[Biometric] Models loaded: detector=YuNet ({det_path}) recognizer={} ({rec_path}) dim={embedding_dim}",
        model_kind.model_label()
    );

    // ── Postgres (fail closed at request time, not at boot) ────────────────
    let db_url = std::env::var("DATABASE_URL").ok();
    let db = match &db_url {
        None => {
            error!("[Biometric] DATABASE_URL not set — endpoints will return 503 (fail closed, no in-memory fallback)");
            None
        }
        Some(url) => match Db::connect(url).await {
            Ok(db) => {
                info!("[Biometric] Postgres connected; biometric_embeddings ready");
                if let Ok(n) = db.count().await {
                    ENROLLED_COUNT.set(n);
                }
                Some(db)
            }
            Err(e) => {
                error!("[Biometric] Postgres unavailable at boot: {e} — will retry lazily; endpoints return 503 until connected");
                None
            }
        },
    };

    let state = Arc::new(AppState {
        det: Mutex::new(det_session),
        rec: Mutex::new(rec_session),
        model_kind,
        model_name: model_kind.model_label().to_string(),
        embedding_dim,
        det_score_threshold: env_f64("FACE_DET_SCORE_THRESHOLD", 0.7) as f32,
        det_max_dim: env("FACE_DET_MAX_DIM", "640").parse().unwrap_or(640),
        match_threshold: env_f64("FACE_MATCH_THRESHOLD", 0.35),
        dedup_flag_threshold: env_f64("DEDUP_FLAG_THRESHOLD", 0.5),
        db: tokio::sync::RwLock::new(db),
        db_url,
        hmac_key: hmac_key.into_bytes(),
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route(
            "/livez",
            get(|| async { Json(serde_json::json!({"ok": true})) }),
        )
        .route("/readyz", get(readyz_handler))
        .route("/metrics", get(metrics_handler))
        // wave-15 API
        .route("/embed", post(embed_handler))
        .route("/verify", post(verify_handler))
        .route("/dedup-scan", post(dedup_scan_handler))
        // legacy pre-wave-15 API shape (preserved)
        .route("/biometric/enroll", post(enroll_handler))
        .route("/biometric/match", post(match_handler))
        .route("/biometric/dedup", post(dedup_handler))
        .with_state(state.clone());

    let addr = format!("0.0.0.0:{port}");
    info!(
        "[Biometric] Starting on {addr} | model={} dim={} | match_threshold={} dedup_flag_threshold={} (review flags only, never auto-block)",
        state.model_name, state.embedding_dim, state.match_threshold, state.dedup_flag_threshold
    );

    let listener = TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    /// wave-15-final seam: python-kyc-liveness posts {image_base64} only.
    #[test]
    fn embed_request_deserializes_stateless_shape() {
        let req: EmbedRequest =
            serde_json::from_str(r#"{"image_base64":"aGVsbG8="}"#).expect("stateless shape");
        assert_eq!(req.user_id, None);
        assert_eq!(req.image_base64, "aGVsbG8=");
        assert_eq!(req.source, None);
    }

    /// Legacy shape with user_id (+ optional source) must still parse.
    #[test]
    fn embed_request_deserializes_persistent_shape() {
        let req: EmbedRequest = serde_json::from_str(
            r#"{"user_id":42,"image_base64":"aGVsbG8=","source":"document_portrait"}"#,
        )
        .expect("persistent shape");
        assert_eq!(req.user_id, Some(42));
        assert_eq!(req.source.as_deref(), Some("document_portrait"));
    }

    /// EmbedResponse must always carry the embedding vector; persisted flag
    /// reflects reality.
    #[test]
    fn embed_response_serializes_embedding_and_persisted() {
        let resp = EmbedResponse {
            user_id: None,
            model: "adaface".to_string(),
            embedding_dim: 3,
            embedding: vec![0.1, 0.2, 0.3],
            persisted: false,
            message: "Embedding computed (stateless, not persisted)".to_string(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["user_id"], serde_json::Value::Null);
        assert_eq!(v["embedding"], serde_json::json!([0.1f32, 0.2f32, 0.3f32]));
        assert_eq!(v["persisted"], false);
        assert_eq!(v["embedding_dim"], 3);
    }
}
