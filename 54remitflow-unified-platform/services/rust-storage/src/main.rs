//! Remittance Platform - High-Performance Storage Service
//! 
//! This service provides S3-compatible storage operations using RustFS as the backend.
//! It offers 2.3x better performance than MinIO for small objects while maintaining
//! full S3 API compatibility.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, State, Multipart},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, error, Level};
use tracing_subscriber::FmtSubscriber;

mod storage;
mod config;
mod error;
mod metrics;

use storage::{StorageClient, StorageConfig, ObjectMetadata};
use error::StorageError;
use metrics::StorageMetrics;

#[derive(Clone)]
struct AppState {
    storage: Arc<StorageClient>,
    metrics: Arc<RwLock<StorageMetrics>>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    storage_backend: String,
    storage_healthy: bool,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    success: bool,
    object_key: String,
    bucket: String,
    size: u64,
    etag: Option<String>,
    url: String,
}

#[derive(Debug, Serialize)]
struct ListResponse {
    objects: Vec<ObjectInfo>,
    prefix: Option<String>,
    truncated: bool,
    next_continuation_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct ObjectInfo {
    key: String,
    size: u64,
    last_modified: String,
    etag: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    prefix: Option<String>,
    max_keys: Option<i32>,
    continuation_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .init();

    info!("Starting Remittance Platform Storage Service");

    // Load configuration
    let config = config::load_config()?;
    
    info!(
        "Connecting to storage backend: {} at {}",
        config.storage.backend_name,
        config.storage.endpoint
    );

    // Initialize storage client
    let storage = StorageClient::new(config.storage.clone()).await?;
    
    // Verify storage connection
    if let Err(e) = storage.health_check().await {
        error!("Storage health check failed: {}", e);
    } else {
        info!("Storage connection verified");
    }

    // Initialize metrics
    let metrics = Arc::new(RwLock::new(StorageMetrics::new()));

    // Create app state
    let state = AppState {
        storage: Arc::new(storage),
        metrics,
    };

    // Build router
    let app = Router::new()
        // Health endpoints
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .route("/metrics", get(get_metrics))
        
        // Object operations
        .route("/objects/:bucket/*key", get(get_object))
        .route("/objects/:bucket/*key", post(put_object))
        .route("/objects/:bucket/*key", delete(delete_object))
        
        // Bucket operations
        .route("/buckets/:bucket", get(list_objects))
        .route("/buckets/:bucket", post(create_bucket))
        .route("/buckets/:bucket", delete(delete_bucket))
        
        // Presigned URLs
        .route("/presign/:bucket/*key", get(get_presigned_url))
        
        // Multipart upload
        .route("/upload/:bucket", post(multipart_upload))
        
        // Add middleware
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("Storage service listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// Health check endpoint
async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    let storage_healthy = state.storage.health_check().await.is_ok();
    
    Json(HealthResponse {
        status: if storage_healthy { "healthy".to_string() } else { "degraded".to_string() },
        service: "remittance-storage".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        storage_backend: "rustfs".to_string(),
        storage_healthy,
    })
}

// Readiness check endpoint
async fn readiness_check(State(state): State<AppState>) -> Result<Json<HealthResponse>, StatusCode> {
    match state.storage.health_check().await {
        Ok(_) => Ok(Json(HealthResponse {
            status: "ready".to_string(),
            service: "remittance-storage".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            storage_backend: "rustfs".to_string(),
            storage_healthy: true,
        })),
        Err(_) => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}

// Get metrics endpoint
async fn get_metrics(State(state): State<AppState>) -> String {
    let metrics = state.metrics.read().await;
    metrics.to_prometheus_format()
}

// Get object
async fn get_object(
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
) -> Result<Vec<u8>, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.get_object(&bucket, &key).await {
        Ok(data) => {
            let mut metrics = state.metrics.write().await;
            metrics.record_download(data.len() as u64);
            Ok(data)
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "ObjectNotFound".to_string(),
            }),
        )),
    }
}

// Put object
async fn put_object(
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
    body: bytes::Bytes,
) -> Result<Json<UploadResponse>, (StatusCode, Json<ErrorResponse>)> {
    let size = body.len() as u64;
    
    match state.storage.put_object(&bucket, &key, body.to_vec()).await {
        Ok(etag) => {
            let mut metrics = state.metrics.write().await;
            metrics.record_upload(size);
            
            let url = state.storage.get_object_url(&bucket, &key);
            
            Ok(Json(UploadResponse {
                success: true,
                object_key: key,
                bucket,
                size,
                etag: Some(etag),
                url,
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "UploadFailed".to_string(),
            }),
        )),
    }
}

// Delete object
async fn delete_object(
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.delete_object(&bucket, &key).await {
        Ok(_) => {
            let mut metrics = state.metrics.write().await;
            metrics.record_delete();
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "DeleteFailed".to_string(),
            }),
        )),
    }
}

// List objects in bucket
async fn list_objects(
    State(state): State<AppState>,
    Path(bucket): Path<String>,
    axum::extract::Query(query): axum::extract::Query<ListQuery>,
) -> Result<Json<ListResponse>, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.list_objects(
        &bucket,
        query.prefix.as_deref(),
        query.max_keys.unwrap_or(1000),
        query.continuation_token.as_deref(),
    ).await {
        Ok((objects, truncated, next_token)) => {
            let object_infos: Vec<ObjectInfo> = objects
                .into_iter()
                .map(|obj| ObjectInfo {
                    key: obj.key,
                    size: obj.size,
                    last_modified: obj.last_modified.to_rfc3339(),
                    etag: obj.etag,
                })
                .collect();
            
            Ok(Json(ListResponse {
                objects: object_infos,
                prefix: query.prefix,
                truncated,
                next_continuation_token: next_token,
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "ListFailed".to_string(),
            }),
        )),
    }
}

// Create bucket
async fn create_bucket(
    State(state): State<AppState>,
    Path(bucket): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.create_bucket(&bucket).await {
        Ok(_) => Ok(StatusCode::CREATED),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "BucketCreationFailed".to_string(),
            }),
        )),
    }
}

// Delete bucket
async fn delete_bucket(
    State(state): State<AppState>,
    Path(bucket): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.delete_bucket(&bucket).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "BucketDeletionFailed".to_string(),
            }),
        )),
    }
}

// Get presigned URL
async fn get_presigned_url(
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.get_presigned_url(&bucket, &key, 3600).await {
        Ok(url) => Ok(Json(serde_json::json!({
            "url": url,
            "expires_in": 3600,
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "PresignFailed".to_string(),
            }),
        )),
    }
}

// Multipart upload
async fn multipart_upload(
    State(state): State<AppState>,
    Path(bucket): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Vec<UploadResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let mut responses = Vec::new();
    
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: e.to_string(),
                code: "MultipartError".to_string(),
            }),
        )
    })? {
        let name = field.file_name().unwrap_or("unknown").to_string();
        let data = field.bytes().await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: e.to_string(),
                    code: "ReadError".to_string(),
                }),
            )
        })?;
        
        let size = data.len() as u64;
        let key = format!("uploads/{}/{}", uuid::Uuid::new_v4(), name);
        
        match state.storage.put_object(&bucket, &key, data.to_vec()).await {
            Ok(etag) => {
                let mut metrics = state.metrics.write().await;
                metrics.record_upload(size);
                
                let url = state.storage.get_object_url(&bucket, &key);
                
                responses.push(UploadResponse {
                    success: true,
                    object_key: key,
                    bucket: bucket.clone(),
                    size,
                    etag: Some(etag),
                    url,
                });
            }
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: e.to_string(),
                        code: "UploadFailed".to_string(),
                    }),
                ));
            }
        }
    }
    
    Ok(Json(responses))
}
