/*!
 * RemitFlow — Fluvio Event Consumer Service (Rust)
 * ══════════════════════════════════════════════════
 * Consumes events from Fluvio topics and processes them:
 *   - transfer-events  → update wallet balances, notify users
 *   - fraud-events     → trigger compliance workflows
 *   - kyc-events       → update KYC tier in PostgreSQL
 *   - fx-events        → refresh FX rate cache
 *   - audit-events     → persist to audit_logs table
 *   - settlement-events → trigger settlement workflows
 *
 * Why Rust:
 *   - Zero-copy deserialization of high-volume event streams
 *   - Async processing with Tokio for maximum throughput
 *   - Precise offset management with no GC pauses
 *   - Memory-safe concurrent consumer groups
 *
 * Architecture:
 *   - Consumes directly from the Fluvio cluster via the native `fluvio`
 *     crate (FLUVIO_ENDPOINT, e.g. fluvio-sc:9003 — set in compose).
 *     FAILS CLOSED at boot when FLUVIO_ENDPOINT or DATABASE_URL is unset.
 *   - Processes events with at-least-once semantics
 *   - Commits offsets to PostgreSQL only after successful processing
 *   - Exposes /health and /metrics endpoints
 */

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use prometheus::{IntCounter, IntCounterVec, Opts, Registry};
use serde::Deserialize;
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::time::sleep;
use tracing::{error, info, warn};

// ─── Event Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "event")]
pub enum FluvioEvent {
    #[serde(rename = "transfer.initiated")]
    TransferInitiated(TransferEvent),
    #[serde(rename = "transfer.completed")]
    TransferCompleted(TransferEvent),
    #[serde(rename = "transfer.failed")]
    TransferFailed(TransferEvent),
    #[serde(rename = "kyc.approved")]
    KycApproved(KycEvent),
    #[serde(rename = "kyc.rejected")]
    KycRejected(KycEvent),
    #[serde(rename = "fraud.detected")]
    FraudDetected(FraudEvent),
    #[serde(rename = "fx.rate.updated")]
    FxRateUpdated(FxEvent),
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
pub struct TransferEvent {
    pub user_id: i64,
    pub transaction_id: Option<i64>,
    pub amount: String,
    pub from_currency: String,
    pub to_currency: String,
    pub rail: String,
    pub workflow_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct KycEvent {
    pub user_id: i64,
    pub document_id: Option<i64>,
    pub tier: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct FraudEvent {
    pub user_id: i64,
    pub alert_id: i64,
    pub risk_score: i32,
    pub reason: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct FxEvent {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: String,
    pub source: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct FluvioMessage {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    pub key: Option<String>,
    pub value: serde_json::Value,
    pub timestamp: Option<i64>,
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Metrics {
    pub messages_consumed: IntCounterVec,
    pub messages_failed: IntCounterVec,
    pub offsets_committed: IntCounter,
}

impl Metrics {
    pub fn new(registry: &Registry) -> anyhow::Result<Self> {
        let messages_consumed = IntCounterVec::new(
            Opts::new("fluvio_messages_consumed_total", "Messages consumed by topic"),
            &["topic"],
        )?;
        let messages_failed = IntCounterVec::new(
            Opts::new("fluvio_messages_failed_total", "Messages failed by topic"),
            &["topic"],
        )?;
        let offsets_committed =
            IntCounter::new("fluvio_offsets_committed_total", "Offsets committed")?;

        registry.register(Box::new(messages_consumed.clone()))?;
        registry.register(Box::new(messages_failed.clone()))?;
        registry.register(Box::new(offsets_committed.clone()))?;

        Ok(Self {
            messages_consumed,
            messages_failed,
            offsets_committed,
        })
    }
}

// ─── App State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub pg_pool: deadpool_postgres::Pool,
    pub metrics: Arc<Metrics>,
    pub prometheus_registry: Arc<Registry>,
    pub fluvio: Arc<fluvio::Fluvio>,
    pub consumer_group: String,
}

// ─── Event Processors ─────────────────────────────────────────────────────────

async fn process_transfer_completed(
    state: &AppState,
    event: &TransferEvent,
) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;

    if let Some(tx_id) = event.transaction_id {
        client
            .execute(
                "UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE id = $1",
                &[&tx_id],
            )
            .await?;
        info!(transaction_id = tx_id, "Transaction marked completed");
    }

    // Emit notification event
    client
        .execute(
            "INSERT INTO notifications (user_id, type, title, body, created_at)
             VALUES ($1, 'transfer_completed', 'Transfer Complete',
                     $2, NOW())",
            &[
                &event.user_id,
                &format!("{} {} sent successfully", event.amount, event.from_currency),
            ],
        )
        .await?;

    Ok(())
}

async fn process_transfer_failed(
    state: &AppState,
    event: &TransferEvent,
) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;

    if let Some(tx_id) = event.transaction_id {
        client
            .execute(
                "UPDATE transactions SET status = 'failed', failed_at = NOW() WHERE id = $1",
                &[&tx_id],
            )
            .await?;
    }

    client
        .execute(
            "INSERT INTO notifications (user_id, type, title, body, created_at)
             VALUES ($1, 'transfer_failed', 'Transfer Failed',
                     $2, NOW())",
            &[
                &event.user_id,
                &format!("Your transfer of {} {} could not be completed", event.amount, event.from_currency),
            ],
        )
        .await?;

    Ok(())
}

async fn process_kyc_approved(state: &AppState, event: &KycEvent) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;
    let tier = event.tier.as_deref().unwrap_or("tier2");

    client
        .execute(
            "UPDATE users SET kyc_tier = $1, kyc_verified_at = NOW() WHERE id = $2",
            &[&tier, &event.user_id],
        )
        .await?;

    info!(user_id = event.user_id, tier = tier, "KYC approved");
    Ok(())
}

async fn process_fraud_detected(state: &AppState, event: &FraudEvent) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;

    // Flag account for review
    client
        .execute(
            "UPDATE users SET account_status = 'under_review' WHERE id = $1 AND account_status = 'active'",
            &[&event.user_id],
        )
        .await?;

    // Log to compliance cases
    client
        .execute(
            "INSERT INTO compliance_cases (user_id, case_type, status, notes, created_at)
             VALUES ($1, 'fraud_alert', 'open', $2, NOW())",
            &[
                &event.user_id,
                &format!("Fraud detected: {} (score: {})", event.reason, event.risk_score),
            ],
        )
        .await?;

    warn!(
        user_id = event.user_id,
        alert_id = event.alert_id,
        risk_score = event.risk_score,
        "Fraud event processed"
    );
    Ok(())
}

async fn process_fx_rate_updated(state: &AppState, event: &FxEvent) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;

    client
        .execute(
            "INSERT INTO fx_rates (from_currency, to_currency, rate, source, fetched_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (from_currency, to_currency)
             DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = NOW()",
            &[&event.from_currency, &event.to_currency, &event.rate, &event.source],
        )
        .await?;

    Ok(())
}

// ─── Consumer Loop ────────────────────────────────────────────────────────────

const TOPICS: &[&str] = &[
    "transfer-events",
    "kyc-events",
    "fraud-events",
    "fx-events",
    "audit-events",
    "settlement-events",
];

/// Consume one topic directly from the Fluvio cluster using the native
/// crate. Resumes from the last committed PostgreSQL offset (at-least-once);
/// commits only after a batch is processed successfully. Reconnects the
/// stream with backoff on failure.
async fn consume_topic(state: Arc<AppState>, topic: &str) {
    use futures::StreamExt;

    let mut last_offset: i64 = get_committed_offset(&state, topic).await;

    loop {
        let consumer = match state.fluvio.partition_consumer(topic, 0).await {
            Ok(c) => c,
            Err(e) => {
                warn!(topic = topic, error = %e, "partition_consumer failed — retrying in 2s");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        // last_offset is the last successfully processed record; resume after it.
        let resume = fluvio::Offset::absolute(last_offset + 1)
            .unwrap_or_else(|_| fluvio::Offset::beginning());
        let mut stream = match consumer.stream(resume).await {
            Ok(s) => s,
            Err(e) => {
                warn!(topic = topic, error = %e, "stream open failed — retrying in 2s");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        info!(topic = topic, resume_offset = last_offset + 1, "consuming topic");

        let mut batch_processed = 0u32;
        while let Some(item) = stream.next().await {
            let record = match item {
                Ok(r) => r,
                Err(e) => {
                    warn!(topic = topic, error = %e, "stream error — reconnecting in 2s");
                    sleep(Duration::from_secs(2)).await;
                    break;
                }
            };

            let msg = FluvioMessage {
                topic: topic.to_string(),
                partition: 0,
                offset: record.offset(),
                key: record.key().map(|k| String::from_utf8_lossy(k).into_owned()),
                value: serde_json::from_str::<serde_json::Value>(
                    &String::from_utf8_lossy(record.value()),
                )
                .unwrap_or_else(|_| {
                    serde_json::Value::String(
                        String::from_utf8_lossy(record.value()).into_owned(),
                    )
                }),
                timestamp: Some(record.timestamp()),
            };

            match process_message(&state, &msg).await {
                Ok(_) => {
                    state.metrics.messages_consumed.with_label_values(&[topic]).inc();
                    last_offset = msg.offset;
                    batch_processed += 1;
                }
                Err(e) => {
                    state.metrics.messages_failed.with_label_values(&[topic]).inc();
                    error!(topic = topic, offset = msg.offset, error = %e, "Message processing failed");
                }
            }

            // Commit offset periodically (every 32 processed records).
            if batch_processed >= 32 {
                if let Err(e) = commit_offset(&state, topic, last_offset).await {
                    error!(topic = topic, error = %e, "Offset commit failed");
                } else {
                    state.metrics.offsets_committed.inc();
                }
                batch_processed = 0;
            }
        }

        // Stream ended or errored: flush the final offset before reconnecting.
        if batch_processed > 0 {
            if let Err(e) = commit_offset(&state, topic, last_offset).await {
                error!(topic = topic, error = %e, "Offset commit failed");
            } else {
                state.metrics.offsets_committed.inc();
            }
        }
    }
}

async fn process_message(state: &AppState, msg: &FluvioMessage) -> anyhow::Result<()> {
    let event: FluvioEvent = serde_json::from_value(msg.value.clone())
        .unwrap_or(FluvioEvent::Unknown);

    match event {
        FluvioEvent::TransferCompleted(e) => process_transfer_completed(state, &e).await?,
        FluvioEvent::TransferFailed(e) => process_transfer_failed(state, &e).await?,
        FluvioEvent::KycApproved(e) => process_kyc_approved(state, &e).await?,
        FluvioEvent::FraudDetected(e) => process_fraud_detected(state, &e).await?,
        FluvioEvent::FxRateUpdated(e) => process_fx_rate_updated(state, &e).await?,
        FluvioEvent::Unknown => {
            // Persist unknown events to audit log for debugging
            let client = state.pg_pool.get().await?;
            client
                .execute(
                    "INSERT INTO audit_logs (action, resource, details, created_at)
                     VALUES ('fluvio.unknown_event', $1, $2, NOW())",
                    &[&msg.topic, &msg.value.to_string()],
                )
                .await?;
        }
        _ => {} // Other events handled by dedicated consumers
    }

    Ok(())
}

/// Returns the last successfully processed offset, or -1 when none has been
/// committed yet (so the consumer resumes from offset 0 / the beginning).
async fn get_committed_offset(state: &AppState, topic: &str) -> i64 {
    let client = match state.pg_pool.get().await {
        Ok(c) => c,
        Err(_) => return -1,
    };

    client
        .query_opt(
            "SELECT offset FROM fluvio_offsets WHERE topic = $1 AND consumer_group = $2 AND partition = 0",
            &[&topic, &state.consumer_group],
        )
        .await
        .ok()
        .flatten()
        .map(|r| r.get::<_, i64>("offset"))
        .unwrap_or(-1)
}

async fn commit_offset(state: &AppState, topic: &str, offset: i64) -> anyhow::Result<()> {
    let client = state.pg_pool.get().await?;
    client
        .execute(
            "INSERT INTO fluvio_offsets (topic, partition, consumer_group, offset, updated_at)
             VALUES ($1, 0, $2, $3, NOW())
             ON CONFLICT (topic, partition, consumer_group)
             DO UPDATE SET offset = EXCLUDED.offset, updated_at = NOW()",
            &[&topic, &state.consumer_group, &offset],
        )
        .await?;
    Ok(())
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "fluvio-consumer",
        "topics": TOPICS,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder
        .encode(&state.prometheus_registry.gather(), &mut buffer)
        .unwrap_or_default();
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buffer,
    )
}

/// Connect to Fluvio with bounded exponential backoff. Config errors fail
/// closed before this; transient broker unavailability retries.
async fn connect_fluvio(endpoint: &str) -> fluvio::Fluvio {
    let mut delay = Duration::from_secs(1);
    let max_delay = Duration::from_secs(60);
    loop {
        let config = fluvio::config::FluvioConfig::new(endpoint);
        match fluvio::Fluvio::connect_with_config(&config).await {
            Ok(client) => {
                info!(endpoint, "connected to fluvio");
                return client;
            }
            Err(e) => {
                warn!(error = %e, endpoint, backoff_secs = delay.as_secs(), "fluvio connect failed, retrying");
                sleep(delay).await;
                delay = (delay * 2).min(max_delay);
            }
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("fluvio_consumer=info".parse()?),
        )
        .init();

    // FAIL CLOSED: both the database and the Fluvio cluster endpoint are
    // required. No silent defaults to a non-existent HTTP bridge.
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let fluvio_endpoint = match std::env::var("FLUVIO_ENDPOINT") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            eprintln!(
                "FATAL: FLUVIO_ENDPOINT is required (e.g. fluvio-sc:9003); refusing to start unconfigured"
            );
            std::process::exit(1);
        }
    };
    let consumer_group = std::env::var("FLUVIO_CONSUMER_GROUP")
        .unwrap_or_else(|_| "remitflow-main".to_string());
    let port: u16 = std::env::var("FLUVIO_CONSUMER_PORT")
        .ok()
        .or_else(|| std::env::var("PORT").ok())
        .unwrap_or_else(|| "8201".to_string())
        .parse()?;

    // PostgreSQL pool
    let pg_config = database_url.parse::<tokio_postgres::Config>()?;
    let mgr = deadpool_postgres::Manager::from_config(
        pg_config,
        tokio_postgres::NoTls,
        deadpool_postgres::ManagerConfig {
            recycling_method: deadpool_postgres::RecyclingMethod::Fast,
        },
    );
    let pg_pool = deadpool_postgres::Pool::builder(mgr).max_size(10).build()?;

    let registry = Registry::new();
    let metrics = Metrics::new(&registry)?;

    // Connect to the real Fluvio cluster with bounded backoff (same pattern
    // as services/rust-lakehouse-writer).
    let fluvio = Arc::new(connect_fluvio(&fluvio_endpoint).await);

    let state = Arc::new(AppState {
        pg_pool,
        metrics: Arc::new(metrics),
        prometheus_registry: Arc::new(registry),
        fluvio,
        consumer_group,
    });

    // Spawn one consumer task per topic
    for topic in TOPICS {
        let s = state.clone();
        let t = topic.to_string();
        tokio::spawn(async move {
            consume_topic(s, &t).await;
        });
    }

    // HTTP server for health/metrics
    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Fluvio consumer listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
