// RemitFlow — UPI (Unified Payments Interface) Adapter
// Language: Rust (Axum + Tokio)
// Purpose: Implements NPCI UPI 2.0 payment flows for INR instant transfers.
//          Supports VPA lookup, collect flow, pay flow, and mandate management.
//
// UPI Compliance:
//   - NPCI UPI 2.0 specification
//   - RBI Payment Aggregator Guidelines
//   - PCI DSS for payment data handling
//   - FEMA for cross-border INR transfers
//
// Default sandbox: https://api.npci.org.in/upi/v2 (sandbox)

mod handlers;
mod models;
mod middleware;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::time::Duration;


// ─── PostgreSQL Persistence (middleware-ready: swap to TigerBeetle/Kafka in production) ───

use sqlx::{PgPool, postgres::PgPoolOptions, Row};

async fn init_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .unwrap_or_else(|e| { eprintln!("DB connection failed (will use in-memory): {}", e); std::process::exit(1); });
    sqlx::query("CREATE TABLE IF NOT EXISTS upi_adapter_state (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())")
        .execute(&pool).await.unwrap_or_default();
    sqlx::query("CREATE TABLE IF NOT EXISTS upi_adapter_events (id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())")
        .execute(&pool).await.unwrap_or_default();
    pool
}

async fn db_upsert(pool: &PgPool, id: &str, data: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO upi_adapter_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()")
        .bind(id).bind(data).execute(pool).await?;
    Ok(())
}

async fn db_get(pool: &PgPool, id: &str) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let row = sqlx::query("SELECT data FROM upi_adapter_state WHERE id = $1")
        .bind(id).fetch_optional(pool).await?;
    Ok(row.map(|r| r.get("data")))
}

async fn db_list(pool: &PgPool, limit: i64) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows = sqlx::query("SELECT data FROM upi_adapter_state ORDER BY updated_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| r.get("data")).collect())
}

async fn db_log_event(pool: &PgPool, event_type: &str, payload: &serde_json::Value) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO upi_adapter_events (event_type, payload) VALUES ($1, $2)")
        .bind(event_type).bind(payload).execute(pool).await?;
    Ok(())
}

#[tokio::main]
async fn main() {
    let _db_pool = init_db().await;
    eprintln!("[DB] PostgreSQL connected for rust-upi-adapter");

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "upi_adapter=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    // PostgreSQL persistence for transfer state
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://remitflow:remitflow123@localhost:5432/remitflow".to_string());
    match tokio_postgres::connect(&db_url, tokio_postgres::NoTls).await {
        Ok((client, connection)) => {
            tokio::spawn(async move { let _ = connection.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS rust_upi_adapter_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )", &[]).await;
            tracing::info!("[UPI] PostgreSQL connected");
        }
        Err(e) => {
            tracing::warn!("[UPI] PostgreSQL unavailable ({}), using in-memory", e);
        }
    }

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8092".to_string())
        .parse()
        .unwrap_or(8092);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Health & readiness
        .route("/health", get(handlers::health))
        .route("/ready", get(handlers::ready))
        .route("/metrics", get(handlers::metrics))
        // UPI API v1
        .route("/api/v1/vpa/lookup", post(handlers::lookup_vpa))
        .route("/api/v1/vpa/validate", post(handlers::validate_vpa))
        .route("/api/v1/transfers", post(handlers::initiate_transfer))
        .route("/api/v1/transfers/:id", get(handlers::get_transfer_status))
        .route("/api/v1/transfers/:id/refund", post(handlers::refund_transfer))
        .route("/api/v1/collect", post(handlers::initiate_collect))
        .route("/api/v1/collect/:id/approve", post(handlers::approve_collect))
        .route("/api/v1/collect/:id/reject", post(handlers::reject_collect))
        .route("/api/v1/mandates", post(handlers::create_mandate))
        .route("/api/v1/mandates/:id", get(handlers::get_mandate))
        .route("/api/v1/mandates/:id/revoke", post(handlers::revoke_mandate))
        .route("/api/v1/banks", get(handlers::list_banks))
        .route("/api/v1/compliance/screen", post(handlers::screen_transaction))
        // Callbacks (from NPCI / PSP)
        .route("/api/v1/callbacks/payment", post(handlers::handle_payment_callback))
        .route("/api/v1/callbacks/collect", post(handlers::handle_collect_callback))
        .layer(cors)
        .layer(TimeoutLayer::new(Duration::from_secs(30)))
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[UPI] Adapter listening on :{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
