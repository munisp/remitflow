//! RemitFlow PDF Receipt Service
//!
//! Generates branded PDF transaction receipts using printpdf.
//! Merchants/customers download a cryptographically verifiable PDF for each transaction.
//!
//! Endpoints:
//!   POST /receipt             — generate a PDF receipt, returns { url, sha256, file_path }
//!   GET  /receipt/:txn_id     — download a previously generated receipt PDF
//!   GET  /health              — liveness probe
//!   GET  /metrics             — Prometheus text exposition
//!
//! Storage layout (PDF_STORAGE_PATH, default ./receipts):
//!   {PDF_STORAGE_PATH}/{txn_id}.pdf   — PDF bytes
//!   {PDF_STORAGE_PATH}/{txn_id}.meta  — JSON metadata (sha256, template, generated_at)
//!
//! Every generated PDF embeds a SHA-256 checksum in metadata and returns it
//! to the caller, so receipt integrity can be verified after the fact.

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use prometheus::{Encoder, IntCounter, IntGauge, Registry, TextEncoder};
use printpdf::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Configuration ───────────────────────────────────────────────────────────

struct Config {
    port: u16,
    storage_path: PathBuf,
}

impl Config {
    fn from_env() -> Self {
        let storage_path = env::var("PDF_STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./receipts"));
        Self {
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8112),
            storage_path,
        }
    }
}

// ─── Shared state ─────────────────────────────────────────────────────────────

struct AppState {
    config: Config,
    registry: Registry,
    receipts_generated: IntCounter,
    receipts_errors: IntCounter,
    active_requests: IntGauge,
    cache: RwLock<HashMap<String, CachedReceipt>>,
}

struct CachedReceipt {
    file_path: PathBuf,
    sha256: String,
    size_bytes: usize,
}

// ─── Request / response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptRequest {
    transaction_id: String,
    user_id: String,
    user_name: String,
    transaction_type: String,
    from_currency: String,
    from_amount: f64,
    to_currency: String,
    to_amount: f64,
    exchange_rate: f64,
    fee: f64,
    status: String,
    description: Option<String>,
    recipient_name: Option<String>,
    recipient_account: Option<String>,
    created_at: Option<String>,
    template: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptResponse {
    transaction_id: String,
    url: String,
    file_path: String,
    sha256: String,
    size_bytes: usize,
    template: String,
    generated_at: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    storage_path: String,
    storage_writable: bool,
    cached_receipts: usize,
}

#[derive(Debug, Serialize)]
struct ReceiptMeta {
    transaction_id: String,
    sha256: String,
    template: String,
    size_bytes: usize,
    generated_at: String,
}

// ─── PDF generation ───────────────────────────────────────────────────────────

fn fmt_amount(amount: f64, currency: &str) -> String {
    format!("{} {:.2}", currency, amount)
}

fn build_receipt_pdf(req: &ReceiptRequest) -> Result<Vec<u8>, String> {
    let (doc, page1, layer1) = PdfDocument::new(
        "RemitFlow Receipt",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let layer = doc.get_page(page1).get_layer(layer1);

    // Load a built-in font (no external font file required)
    let font = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("font error: {}", e))?;
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("font error: {}", e))?;

    let blue = Color::Rgb(Rgb::new(0.12, 0.25, 0.69, None)); // #1E40AF
    let green = Color::Rgb(Rgb::new(0.06, 0.72, 0.51, None)); // #10B981
    let gray = Color::Rgb(Rgb::new(0.42, 0.45, 0.50, None));
    let dark = Color::Rgb(Rgb::new(0.07, 0.09, 0.15, None));

    // ── Header banner ────────────────────────────────────────────────────────
    let points = vec![
        (Point::new(Mm(0.0), Mm(297.0)), false),
        (Point::new(Mm(210.0), Mm(297.0)), false),
        (Point::new(Mm(210.0), Mm(265.0)), false),
        (Point::new(Mm(0.0), Mm(265.0)), false),
    ];
    let header = Line {
        points,
        is_closed: true,
        has_fill: true,
        has_stroke: false,
        is_clipping_path: false,
    };
    layer.set_fill_color(blue.clone());
    layer.add_shape(header);

    // Logo text
    layer.set_fill_color(Color::Rgb(Rgb::new(1.0, 1.0, 1.0, None)));
    layer.use_text("RemitFlow", 28.0, Mm(15.0), Mm(275.0), &font);
    layer.use_text(
        "TRANSACTION RECEIPT",
        12.0,
        Mm(15.0),
        Mm(267.0),
        &font_regular,
    );

    // Status badge
    let status_color = if req.status == "completed" || req.status == "COMPLETED" {
        green.clone()
    } else {
        Color::Rgb(Rgb::new(0.96, 0.62, 0.04, None)) // amber
    };
    layer.set_fill_color(status_color);
    let badge_text = req.status.to_uppercase();
    layer.use_text(&badge_text, 11.0, Mm(160.0), Mm(273.0), &font);

    // ── Transaction ID ────────────────────────────────────────────────────────
    layer.set_fill_color(gray.clone());
    layer.use_text("TRANSACTION ID", 8.0, Mm(15.0), Mm(255.0), &font_regular);
    layer.set_fill_color(dark.clone());
    layer.use_text(&req.transaction_id, 11.0, Mm(15.0), Mm(248.0), &font);

    // Date
    let date_str = req
        .created_at
        .clone()
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string());
    layer.set_fill_color(gray.clone());
    layer.use_text("DATE", 8.0, Mm(120.0), Mm(255.0), &font_regular);
    layer.set_fill_color(dark.clone());
    layer.use_text(&date_str, 10.0, Mm(120.0), Mm(248.0), &font_regular);

    // ── Amount box ────────────────────────────────────────────────────────────
    let amount_y = Mm(228.0);
    let box_pts = vec![
        (Point::new(Mm(15.0), Mm(245.0)), false),
        (Point::new(Mm(195.0), Mm(245.0)), false),
        (Point::new(Mm(195.0), amount_y), false),
        (Point::new(Mm(15.0), amount_y), false),
    ];
    let amt_box = Line {
        points: box_pts,
        is_closed: true,
        has_fill: true,
        has_stroke: false,
        is_clipping_path: false,
    };
    layer.set_fill_color(Color::Rgb(Rgb::new(0.94, 0.97, 1.0, None))); // light blue
    layer.add_shape(amt_box);

    layer.set_fill_color(gray.clone());
    layer.use_text("AMOUNT SENT", 8.0, Mm(20.0), Mm(240.0), &font_regular);
    layer.set_fill_color(blue.clone());
    layer.use_text(
        &fmt_amount(req.from_amount, &req.from_currency),
        24.0,
        Mm(20.0),
        Mm(232.0),
        &font,
    );

    // ── Transfer details ──────────────────────────────────────────────────────
    let details: Vec<(&str, String)> = vec![
        ("Sender", req.user_name.clone()),
        ("User ID", req.user_id.clone()),
        ("Type", req.transaction_type.clone()),
        (
            "Recipient",
            req.recipient_name.clone().unwrap_or_else(|| "—".into()),
        ),
        (
            "Recipient Account",
            req.recipient_account.clone().unwrap_or_else(|| "—".into()),
        ),
        (
            "You Sent",
            fmt_amount(req.from_amount, &req.from_currency),
        ),
        ("They Receive", fmt_amount(req.to_amount, &req.to_currency)),
        ("Exchange Rate", format!("1 {} = {:.4} {}", req.from_currency, req.exchange_rate, req.to_currency)),
        ("Fee", fmt_amount(req.fee, &req.from_currency)),
        (
            "Total Charged",
            fmt_amount(req.from_amount + req.fee, &req.from_currency),
        ),
        (
            "Description",
            req.description.clone().unwrap_or_else(|| "—".into()),
        ),
    ];

    let mut y = 218.0_f32;
    for (label, value) in &details {
        // Alternating row background
        if (y as i32) % 2 == 0 {
            let row_pts = vec![
                (Point::new(Mm(15.0), Mm(y + 4.0)), false),
                (Point::new(Mm(195.0), Mm(y + 4.0)), false),
                (Point::new(Mm(195.0), Mm(y - 3.0)), false),
                (Point::new(Mm(15.0), Mm(y - 3.0)), false),
            ];
            let row = Line {
                points: row_pts,
                is_closed: true,
                has_fill: true,
                has_stroke: false,
                is_clipping_path: false,
            };
            layer.set_fill_color(Color::Rgb(Rgb::new(0.97, 0.98, 0.99, None)));
            layer.add_shape(row);
        }

        layer.set_fill_color(gray.clone());
        layer.use_text(label.to_uppercase(), 7.5, Mm(20.0), Mm(y), &font_regular);
        layer.set_fill_color(dark.clone());
        layer.use_text(value, 10.0, Mm(90.0), Mm(y), &font_regular);
        y -= 8.0;
    }

    // ── Divider ───────────────────────────────────────────────────────────────
    let div_y = y + 2.0;
    let div_pts = vec![
        (Point::new(Mm(15.0), Mm(div_y)), false),
        (Point::new(Mm(195.0), Mm(div_y)), false),
    ];
    let div = Line {
        points: div_pts,
        is_closed: false,
        has_fill: false,
        has_stroke: true,
        is_clipping_path: false,
    };
    layer.set_outline_color(gray.clone());
    layer.set_outline_thickness(0.5);
    layer.add_shape(div);

    // ── Security footer ───────────────────────────────────────────────────────
    let footer_y = div_y - 8.0;
    layer.set_fill_color(gray.clone());
    layer.use_text(
        "This is an official RemitFlow transaction receipt.",
        8.0,
        Mm(15.0),
        Mm(footer_y),
        &font_regular,
    );
    layer.use_text(
        "Verify this receipt at https://remitflow.example.com/verify",
        8.0,
        Mm(15.0),
        Mm(footer_y - 5.0),
        &font_regular,
    );
    layer.use_text(
        "RemitFlow Inc. | support@remitflow.example.com | PCI-DSS Compliant",
        7.5,
        Mm(15.0),
        Mm(footer_y - 12.0),
        &font_regular,
    );

    // Watermark
    layer.set_fill_color(Color::Rgb(Rgb::new(0.95, 0.95, 0.95, None)));
    layer.use_text("REMITFLOW", 60.0, Mm(40.0), Mm(120.0), &font);

    doc.save(&mut Vec::new().into())
        .map_err(|e| format!("PDF save error: {}", e))
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let writable = std::fs::create_dir_all(&state.config.storage_path).is_ok();
    let cached = state.cache.read().map(|c| c.len()).unwrap_or(0);
    Json(HealthResponse {
        status: "healthy",
        service: "rust-pdf-receipt",
        version: "1.0.0",
        storage_path: state.config.storage_path.display().to_string(),
        storage_writable: writable,
        cached_receipts: cached,
    })
}

async fn metrics(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = state.registry.gather();
    let mut buf = Vec::new();
    encoder.encode(&metric_families, &mut buf).unwrap_or_default();
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buf,
    )
}

async fn generate_receipt(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ReceiptRequest>,
) -> Response {
    state.active_requests.inc();
    let result = generate_receipt_inner(state.clone(), req).await;
    state.active_requests.dec();

    match result {
        Ok(resp) => {
            state.receipts_generated.inc();
            Json(resp).into_response()
        }
        Err((status, msg)) => {
            state.receipts_errors.inc();
            (
                status,
                Json(ErrorResponse {
                    error: msg,
                    code: status.as_u16().to_string(),
                }),
            )
                .into_response()
        }
    }
}

async fn generate_receipt_inner(
    state: Arc<AppState>,
    req: ReceiptRequest,
) -> Result<ReceiptResponse, (StatusCode, String)> {
    // Validate
    if req.transaction_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "transaction_id is required".into()));
    }
    if req.user_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "user_id is required".into()));
    }
    if req.from_amount <= 0.0 {
        return Err((StatusCode::BAD_REQUEST, "from_amount must be positive".into()));
    }

    let template = req.template.clone().unwrap_or_else(|| "standard".into());
    let txn_id = req.transaction_id.clone();

    // Check cache first
    {
        let cache = state.cache.read().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("cache error: {}", e))
        })?;
        if let Some(cached) = cache.get(&txn_id) {
            info!(txn_id, "receipt served from cache");
            return Ok(ReceiptResponse {
                transaction_id: txn_id,
                url: format!("/receipt/{}", cached.file_path.display()),
                file_path: cached.file_path.display().to_string(),
                sha256: cached.sha256.clone(),
                size_bytes: cached.size_bytes,
                template,
                generated_at: Utc::now().to_rfc3339(),
            });
        }
    }

    // Generate PDF (sync, CPU-bound — spawn_blocking)
    let req_clone = ReceiptRequest {
        transaction_id: req.transaction_id.clone(),
        user_id: req.user_id.clone(),
        user_name: req.user_name.clone(),
        transaction_type: req.transaction_type.clone(),
        from_currency: req.from_currency.clone(),
        from_amount: req.from_amount,
        to_currency: req.to_currency.clone(),
        to_amount: req.to_amount,
        exchange_rate: req.exchange_rate,
        fee: req.fee,
        status: req.status.clone(),
        description: req.description.clone(),
        recipient_name: req.recipient_name.clone(),
        recipient_account: req.recipient_account.clone(),
        created_at: req.created_at.clone(),
        template: req.template.clone(),
    };

    let pdf_bytes = tokio::task::spawn_blocking(move || build_receipt_pdf(&req_clone))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("task error: {}", e)))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Compute checksum
    let sha256 = hex::encode(Sha256::digest(&pdf_bytes));
    let size_bytes = pdf_bytes.len();

    // Write to storage
    let storage_dir = &state.config.storage_path;
    tokio::fs::create_dir_all(storage_dir)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("storage error: {}", e)))?;

    let pdf_path = storage_dir.join(format!("{}.pdf", txn_id));
    tokio::fs::write(&pdf_path, &pdf_bytes)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write error: {}", e)))?;

    // Write metadata sidecar
    let meta = ReceiptMeta {
        transaction_id: txn_id.clone(),
        sha256: sha256.clone(),
        template: template.clone(),
        size_bytes,
        generated_at: Utc::now().to_rfc3339(),
    };
    let meta_path = storage_dir.join(format!("{}.meta", txn_id));
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = tokio::fs::write(&meta_path, meta_json).await;
    }

    // Update cache
    if let Ok(mut cache) = state.cache.write() {
        cache.insert(
            txn_id.clone(),
            CachedReceipt {
                file_path: pdf_path.clone(),
                sha256: sha256.clone(),
                size_bytes,
            },
        );
        // Evict oldest if cache too large
        if cache.len() > 1000 {
            let keys: Vec<String> = cache.keys().take(100).cloned().collect();
            for k in keys {
                cache.remove(&k);
            }
        }
    }

    info!(txn_id, sha256, size_bytes, "receipt generated");

    Ok(ReceiptResponse {
        transaction_id: txn_id,
        url: format!("/receipt/{}", pdf_path.display()),
        file_path: pdf_path.display().to_string(),
        sha256,
        size_bytes,
        template,
        generated_at: Utc::now().to_rfc3339(),
    })
}

async fn download_receipt(
    State(state): State<Arc<AppState>>,
    Path(txn_id): Path<String>,
) -> Response {
    let pdf_path = state.config.storage_path.join(format!("{}.pdf", txn_id));

    match tokio::fs::read(&pdf_path).await {
        Ok(bytes) => {
            let sha256 = hex::encode(Sha256::digest(&bytes));
            (
                [
                    (header::CONTENT_TYPE, "application/pdf".to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"remitflow-receipt-{}.pdf\"", txn_id),
                    ),
                    ("X-SHA256", sha256),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Receipt not found: {}", txn_id),
                code: "404".into(),
            }),
        )
            .into_response(),
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_pdf_receipt=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env();

    // Ensure storage directory exists
    if let Err(e) = std::fs::create_dir_all(&config.storage_path) {
        error!(path = %config.storage_path.display(), err = %e, "failed to create storage directory");
        std::process::exit(1);
    }

    // Build Prometheus registry
    let registry = Registry::new();
    let receipts_generated =
        IntCounter::new("pdf_receipts_generated_total", "Total PDF receipts generated")
            .expect("metric can be created");
    let receipts_errors =
        IntCounter::new("pdf_receipts_errors_total", "Total PDF generation errors")
            .expect("metric can be created");
    let active_requests = IntGauge::new("pdf_active_requests", "Currently active requests")
        .expect("metric can be created");
    registry.register(Box::new(receipts_generated.clone())).unwrap();
    registry.register(Box::new(receipts_errors.clone())).unwrap();
    registry.register(Box::new(active_requests.clone())).unwrap();

    let state = Arc::new(AppState {
        config,
        registry,
        receipts_generated,
        receipts_errors,
        active_requests,
        cache: RwLock::new(HashMap::new()),
    });

    let port = state.config.port;

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/receipt", post(generate_receipt))
        .route("/receipt/:txn_id", get(download_receipt))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap_or_else(|e| {
            error!(err = %e, "failed to bind port");
            std::process::exit(1);
        });

    info!(port, "rust-pdf-receipt service started");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|e| {
            error!(err = %e, "server error");
            std::process::exit(1);
        });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("shutdown signal received, draining connections");
}
