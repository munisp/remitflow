// rust-kyc-event-processor — RemitFlow Real-Time KYC Event Processor
//
// Responsibilities:
//  - Consume KYC events from Fluvio topics in real-time
//  - Monitor transaction streams for risk threshold breaches
//  - Execute immediate sanctions freeze (sub-100ms)
//  - Publish processed events to Go trigger engine via HTTP
//  - Expose Prometheus metrics for observability
//  - Maintain KYC state in Redis for fast lookups

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use prometheus::{Counter, Histogram, IntGauge, Registry};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

// ── Configuration ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Config {
    port: u16,
    fluvio_url: String,
    trigger_engine_url: String,
    redis_url: String,
    dapr_http_port: u16,
    risk_score_threshold: f64,
    transaction_ctr_threshold: f64,
    transaction_edd_threshold: f64,
}

impl Config {
    fn from_env() -> Self {
        Self {
            port: std::env::var("PORT").unwrap_or_else(|_| "8161".to_string()).parse().unwrap_or(8161),
            fluvio_url: std::env::var("FLUVIO_URL").unwrap_or_else(|_| "http://fluvio:9003".to_string()),
            trigger_engine_url: std::env::var("TRIGGER_ENGINE_URL").unwrap_or_else(|_| "http://go-kyc-trigger-engine:8160".to_string()),
            redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".to_string()),
            dapr_http_port: std::env::var("DAPR_HTTP_PORT").unwrap_or_else(|_| "3500".to_string()).parse().unwrap_or(3500),
            risk_score_threshold: std::env::var("RISK_SCORE_THRESHOLD").unwrap_or_else(|_| "75.0".to_string()).parse().unwrap_or(75.0),
            transaction_ctr_threshold: 1000.0,
            transaction_edd_threshold: 10000.0,
        }
    }
}

// ── Metrics ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Metrics {
    events_processed: Counter,
    sanctions_freezes: Counter,
    risk_escalations: Counter,
    threshold_breaches: Counter,
    processing_duration: Histogram,
    active_freezes: IntGauge,
    registry: Registry,
}

impl Metrics {
    fn new() -> Self {
        let registry = Registry::new();

        let events_processed = Counter::new("kyc_events_processed_total", "Total KYC events processed").unwrap();
        let sanctions_freezes = Counter::new("kyc_sanctions_freezes_total", "Total sanctions freezes executed").unwrap();
        let risk_escalations = Counter::new("kyc_risk_escalations_total", "Total risk score escalations").unwrap();
        let threshold_breaches = Counter::new("kyc_threshold_breaches_total", "Total transaction threshold breaches").unwrap();
        let processing_duration = Histogram::with_opts(
            prometheus::HistogramOpts::new("kyc_event_processing_duration_seconds", "KYC event processing duration")
                .buckets(vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]),
        ).unwrap();
        let active_freezes = IntGauge::new("kyc_active_freezes", "Number of active KYC freezes").unwrap();

        registry.register(Box::new(events_processed.clone())).unwrap();
        registry.register(Box::new(sanctions_freezes.clone())).unwrap();
        registry.register(Box::new(risk_escalations.clone())).unwrap();
        registry.register(Box::new(threshold_breaches.clone())).unwrap();
        registry.register(Box::new(processing_duration.clone())).unwrap();
        registry.register(Box::new(active_freezes.clone())).unwrap();

        Self { events_processed, sanctions_freezes, risk_escalations, threshold_breaches, processing_duration, active_freezes, registry }
    }
}

// ── Domain Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum KYCEventType {
    TransactionInitiated,
    SanctionsCheckResult,
    RiskScoreUpdated,
    KYCStatusChanged,
    DocumentUploaded,
    LivenessCheckCompleted,
    PEPMatchResult,
    AMLAlertFired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KYCEvent {
    event_type: KYCEventType,
    user_id: String,
    business_id: Option<String>,
    amount: Option<f64>,
    currency: Option<String>,
    risk_score: Option<f64>,
    sanctions_hit: Option<bool>,
    sanctions_list: Option<String>,
    pep_match: Option<bool>,
    pep_level: Option<String>,
    kyc_tier: Option<u8>,
    correlation_id: String,
    timestamp: DateTime<Utc>,
    metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TriggerRequest {
    trigger_type: String,
    entity_type: String,
    entity_id: String,
    user_id: String,
    business_id: Option<String>,
    amount: Option<f64>,
    currency: Option<String>,
    risk_score: Option<f64>,
    country: Option<String>,
    metadata: Option<HashMap<String, serde_json::Value>>,
    correlation_id: String,
    timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KYCState {
    user_id: String,
    kyc_tier: u8,
    kyc_status: String,
    frozen: bool,
    freeze_reason: Option<String>,
    risk_score: f64,
    last_updated: DateTime<Utc>,
}

// ── App State ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    config: Config,
    metrics: Metrics,
    http_client: Client,
    // In-memory KYC state cache (Redis in production)
    kyc_state_cache: Arc<RwLock<HashMap<String, KYCState>>>,
}

impl AppState {
    fn new(config: Config, metrics: Metrics) -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            metrics,
            http_client,
            kyc_state_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

// ── Event Processor ───────────────────────────────────────────────────────────

async fn process_kyc_event(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    let timer = state.metrics.processing_duration.start_timer();
    state.metrics.events_processed.inc();

    info!(
        event_type = ?event.event_type,
        user_id = %event.user_id,
        correlation_id = %event.correlation_id,
        "Processing KYC event"
    );

    match &event.event_type {
        KYCEventType::TransactionInitiated => {
            handle_transaction_event(state, event).await?;
        }
        KYCEventType::SanctionsCheckResult => {
            handle_sanctions_result(state, event).await?;
        }
        KYCEventType::RiskScoreUpdated => {
            handle_risk_score_update(state, event).await?;
        }
        KYCEventType::PEPMatchResult => {
            handle_pep_match(state, event).await?;
        }
        KYCEventType::AMLAlertFired => {
            handle_aml_alert(state, event).await?;
        }
        _ => {
            info!(event_type = ?event.event_type, "Event type handled by downstream services");
        }
    }

    timer.observe_duration();
    Ok(())
}

async fn handle_transaction_event(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    let amount = event.amount.unwrap_or(0.0);
    let currency = event.currency.clone().unwrap_or_else(|| "USD".to_string());

    // Check if this is the user's first transfer
    let cache = state.kyc_state_cache.read().await;
    let kyc_state = cache.get(&event.user_id);
    let is_first_transfer = kyc_state.map_or(true, |s| s.kyc_tier == 0);
    drop(cache);

    let trigger_type = if is_first_transfer {
        "first_transfer_attempt"
    } else if amount >= state.config.transaction_edd_threshold {
        state.metrics.threshold_breaches.inc();
        "transaction_over_10000"
    } else if amount >= state.config.transaction_ctr_threshold {
        state.metrics.threshold_breaches.inc();
        "transaction_over_1000"
    } else {
        return Ok(()); // No trigger needed
    };

    fire_trigger(state, TriggerRequest {
        trigger_type: trigger_type.to_string(),
        entity_type: "user".to_string(),
        entity_id: event.user_id.clone(),
        user_id: event.user_id.clone(),
        business_id: None,
        amount: Some(amount),
        currency: Some(currency),
        risk_score: None,
        country: None,
        metadata: None,
        correlation_id: event.correlation_id.clone(),
        timestamp: Utc::now(),
    }).await
}

async fn handle_sanctions_result(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    if event.sanctions_hit.unwrap_or(false) {
        state.metrics.sanctions_freezes.inc();
        state.metrics.active_freezes.inc();

        // Immediately update local cache — sub-millisecond freeze
        let mut cache = state.kyc_state_cache.write().await;
        let kyc_state = cache.entry(event.user_id.clone()).or_insert_with(|| KYCState {
            user_id: event.user_id.clone(),
            kyc_tier: 0,
            kyc_status: "pending".to_string(),
            frozen: false,
            freeze_reason: None,
            risk_score: 0.0,
            last_updated: Utc::now(),
        });
        kyc_state.frozen = true;
        kyc_state.freeze_reason = Some("sanctions_hit".to_string());
        kyc_state.last_updated = Utc::now();
        drop(cache);

        warn!(
            user_id = %event.user_id,
            list = ?event.sanctions_list,
            "SANCTIONS HIT — immediate freeze applied"
        );

        let mut metadata = HashMap::new();
        metadata.insert("list_name".to_string(), serde_json::json!(event.sanctions_list));
        metadata.insert("match_score".to_string(), serde_json::json!(1.0));

        fire_trigger(state, TriggerRequest {
            trigger_type: "sanctions_hit".to_string(),
            entity_type: "user".to_string(),
            entity_id: event.user_id.clone(),
            user_id: event.user_id.clone(),
            business_id: None,
            amount: None,
            currency: None,
            risk_score: None,
            country: None,
            metadata: Some(metadata),
            correlation_id: event.correlation_id.clone(),
            timestamp: Utc::now(),
        }).await
    } else {
        Ok(())
    }
}

async fn handle_risk_score_update(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    let risk_score = event.risk_score.unwrap_or(0.0);

    // Update cache
    let mut cache = state.kyc_state_cache.write().await;
    let kyc_state = cache.entry(event.user_id.clone()).or_insert_with(|| KYCState {
        user_id: event.user_id.clone(),
        kyc_tier: 0,
        kyc_status: "pending".to_string(),
        frozen: false,
        freeze_reason: None,
        risk_score: 0.0,
        last_updated: Utc::now(),
    });
    kyc_state.risk_score = risk_score;
    kyc_state.last_updated = Utc::now();
    drop(cache);

    if risk_score >= state.config.risk_score_threshold {
        state.metrics.risk_escalations.inc();

        warn!(
            user_id = %event.user_id,
            risk_score = risk_score,
            threshold = state.config.risk_score_threshold,
            "High risk score — triggering KYC escalation"
        );

        fire_trigger(state, TriggerRequest {
            trigger_type: "high_risk_score".to_string(),
            entity_type: "user".to_string(),
            entity_id: event.user_id.clone(),
            user_id: event.user_id.clone(),
            business_id: None,
            amount: None,
            currency: None,
            risk_score: Some(risk_score),
            country: None,
            metadata: None,
            correlation_id: event.correlation_id.clone(),
            timestamp: Utc::now(),
        }).await
    } else {
        Ok(())
    }
}

async fn handle_pep_match(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    if event.pep_match.unwrap_or(false) {
        let mut metadata = HashMap::new();
        metadata.insert("pep_level".to_string(), serde_json::json!(event.pep_level));
        metadata.insert("pep_type".to_string(), serde_json::json!("political_exposed_person"));

        fire_trigger(state, TriggerRequest {
            trigger_type: "pep_match_detected".to_string(),
            entity_type: "user".to_string(),
            entity_id: event.user_id.clone(),
            user_id: event.user_id.clone(),
            business_id: None,
            amount: None,
            currency: None,
            risk_score: None,
            country: None,
            metadata: Some(metadata),
            correlation_id: event.correlation_id.clone(),
            timestamp: Utc::now(),
        }).await
    } else {
        Ok(())
    }
}

async fn handle_aml_alert(state: &AppState, event: &KYCEvent) -> Result<(), String> {
    let sar_ref = format!("SAR-{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("000"));
    let mut metadata = HashMap::new();
    metadata.insert("sar_reference".to_string(), serde_json::json!(sar_ref));

    fire_trigger(state, TriggerRequest {
        trigger_type: "sar_filed".to_string(),
        entity_type: "user".to_string(),
        entity_id: event.user_id.clone(),
        user_id: event.user_id.clone(),
        business_id: None,
        amount: None,
        currency: None,
        risk_score: None,
        country: None,
        metadata: Some(metadata),
        correlation_id: event.correlation_id.clone(),
        timestamp: Utc::now(),
    }).await
}

async fn fire_trigger(state: &AppState, request: TriggerRequest) -> Result<(), String> {
    let url = format!("{}/trigger", state.config.trigger_engine_url);
    match state.http_client.post(&url).json(&request).send().await {
        Ok(resp) if resp.status().is_success() => {
            info!(trigger_type = %request.trigger_type, "Trigger fired successfully");
            Ok(())
        }
        Ok(resp) => {
            error!(trigger_type = %request.trigger_type, status = %resp.status(), "Trigger fire failed");
            Err(format!("Trigger engine returned {}", resp.status()))
        }
        Err(e) => {
            error!(trigger_type = %request.trigger_type, error = %e, "Failed to fire trigger");
            Err(format!("HTTP error: {}", e))
        }
    }
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    timestamp: DateTime<Utc>,
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "rust-kyc-event-processor".to_string(),
        version: "1.0.0".to_string(),
        timestamp: Utc::now(),
    })
}

async fn metrics_handler(State(state): State<AppState>) -> (StatusCode, String) {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder.encode(&state.metrics.registry.gather(), &mut buffer).unwrap();
    (StatusCode::OK, String::from_utf8(buffer).unwrap())
}

async fn process_event_handler(
    State(state): State<AppState>,
    Json(event): Json<KYCEvent>,
) -> (StatusCode, Json<serde_json::Value>) {
    match process_kyc_event(&state, &event).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"status": "processed", "event_type": format!("{:?}", event.event_type)})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "message": e})),
        ),
    }
}

async fn get_kyc_state_handler(
    State(state): State<AppState>,
    axum::extract::Path(user_id): axum::extract::Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let cache = state.kyc_state_cache.read().await;
    match cache.get(&user_id) {
        Some(kyc_state) => (StatusCode::OK, Json(serde_json::to_value(kyc_state).unwrap())),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "KYC state not found", "user_id": user_id})),
        ),
    }
}

// ── Background: Fluvio Consumer Simulation ───────────────────────────────────

async fn start_fluvio_consumer(state: AppState) {
    info!("Starting Fluvio KYC event consumer");
    // In production: use the Fluvio Rust SDK to consume from kyc-events, risk-events, compliance-events topics
    // Here we poll the Fluvio HTTP proxy for events
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        interval.tick().await;
        let url = format!("{}/topics/kyc-events/consume?count=100", state.config.fluvio_url);
        match state.http_client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(events) = resp.json::<Vec<KYCEvent>>().await {
                    for event in events {
                        if let Err(e) = process_kyc_event(&state, &event).await {
                            error!(error = %e, "Failed to process Fluvio event");
                        }
                    }
                }
            }
            _ => {} // Fluvio not available — skip silently
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .json()
        .init();

    let config = Config::from_env();
    let metrics = Metrics::new();
    let port = config.port;
    let state = AppState::new(config, metrics);

    // Start Fluvio consumer in background
    let consumer_state = state.clone();
    tokio::spawn(async move {
        start_fluvio_consumer(consumer_state).await;
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/events/process", post(process_event_handler))
        .route("/kyc-state/:user_id", get(get_kyc_state_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!(addr = %addr, "rust-kyc-event-processor starting");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
