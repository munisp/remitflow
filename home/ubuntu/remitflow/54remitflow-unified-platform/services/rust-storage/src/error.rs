//! Error types for the storage service

use thiserror::Error;

/// Storage error types
#[derive(Error, Debug)]
pub enum StorageError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    
    #[error("Bucket error: {0}")]
    BucketError(String),
    
    #[error("Failed to put object: {0}")]
    PutObjectFailed(String),
    
    #[error("Failed to get object: {0}")]
    GetObjectFailed(String),
    
    #[error("Failed to delete object: {0}")]
    DeleteObjectFailed(String),
    
    #[error("Failed to list objects: {0}")]
    ListObjectsFailed(String),
    
    #[error("Failed to copy object: {0}")]
    CopyObjectFailed(String),
    
    #[error("Failed to generate presigned URL: {0}")]
    PresignFailed(String),
    
    #[error("Configuration error: {0}")]
    ConfigError(String),
    
    #[error("Authentication error: {0}")]
    AuthError(String),
    
    #[error("Object not found: {0}")]
    NotFound(String),
    
    #[error("Access denied: {0}")]
    AccessDenied(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

impl StorageError {
    /// Get HTTP status code for this error
    pub fn status_code(&self) -> u16 {
        match self {
            StorageError::NotFound(_) => 404,
            StorageError::AccessDenied(_) | StorageError::AuthError(_) => 403,
            StorageError::ConfigError(_) => 400,
            _ => 500,
        }
    }
    
    /// Get error code string
    pub fn error_code(&self) -> &'static str {
        match self {
            StorageError::ConnectionFailed(_) => "CONNECTION_FAILED",
            StorageError::BucketError(_) => "BUCKET_ERROR",
            StorageError::PutObjectFailed(_) => "PUT_OBJECT_FAILED",
            StorageError::GetObjectFailed(_) => "GET_OBJECT_FAILED",
            StorageError::DeleteObjectFailed(_) => "DELETE_OBJECT_FAILED",
            StorageError::ListObjectsFailed(_) => "LIST_OBJECTS_FAILED",
            StorageError::CopyObjectFailed(_) => "COPY_OBJECT_FAILED",
            StorageError::PresignFailed(_) => "PRESIGN_FAILED",
            StorageError::ConfigError(_) => "CONFIG_ERROR",
            StorageError::AuthError(_) => "AUTH_ERROR",
            StorageError::NotFound(_) => "NOT_FOUND",
            StorageError::AccessDenied(_) => "ACCESS_DENIED",
            StorageError::Internal(_) => "INTERNAL_ERROR",
        }
    }
}
