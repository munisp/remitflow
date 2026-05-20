//! S3-Compatible Storage Client
//! 
//! This module provides a high-performance storage client that works with
//! RustFS, MinIO, AWS S3, and any S3-compatible object storage.

use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::{
    config::{Builder as S3ConfigBuilder, Region},
    primitives::ByteStream,
    Client as S3Client,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::error::StorageError;

/// Storage configuration
#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    /// Storage endpoint URL (e.g., http://localhost:9000 for RustFS)
    pub endpoint: String,
    
    /// Access key ID
    pub access_key: String,
    
    /// Secret access key
    pub secret_key: String,
    
    /// AWS region (default: us-east-1)
    #[serde(default = "default_region")]
    pub region: String,
    
    /// Default bucket name
    pub default_bucket: Option<String>,
    
    /// Use path-style addressing (required for most self-hosted S3-compatible storage)
    #[serde(default = "default_path_style")]
    pub force_path_style: bool,
    
    /// Backend name for logging/metrics
    #[serde(default = "default_backend_name")]
    pub backend_name: String,
    
    /// Connection timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_region() -> String {
    "us-east-1".to_string()
}

fn default_path_style() -> bool {
    true
}

fn default_backend_name() -> String {
    "rustfs".to_string()
}

fn default_timeout() -> u64 {
    30
}

/// Object metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMetadata {
    pub key: String,
    pub size: u64,
    pub last_modified: DateTime<Utc>,
    pub etag: Option<String>,
    pub content_type: Option<String>,
    pub metadata: std::collections::HashMap<String, String>,
}

/// Storage client for S3-compatible backends
pub struct StorageClient {
    client: S3Client,
    config: StorageConfig,
}

impl StorageClient {
    /// Create a new storage client
    pub async fn new(config: StorageConfig) -> Result<Self, StorageError> {
        info!(
            "Initializing storage client for {} at {}",
            config.backend_name, config.endpoint
        );

        // Create credentials
        let credentials = Credentials::new(
            &config.access_key,
            &config.secret_key,
            None,
            None,
            "remittance-storage",
        );

        // Build S3 config
        let s3_config = S3ConfigBuilder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .endpoint_url(&config.endpoint)
            .credentials_provider(credentials)
            .force_path_style(config.force_path_style)
            .build();

        let client = S3Client::from_conf(s3_config);

        Ok(Self { client, config })
    }

    /// Health check - verify storage connectivity
    pub async fn health_check(&self) -> Result<(), StorageError> {
        debug!("Performing storage health check");
        
        match self.client.list_buckets().send().await {
            Ok(_) => {
                debug!("Storage health check passed");
                Ok(())
            }
            Err(e) => {
                error!("Storage health check failed: {}", e);
                Err(StorageError::ConnectionFailed(e.to_string()))
            }
        }
    }

    /// Create a bucket
    pub async fn create_bucket(&self, bucket: &str) -> Result<(), StorageError> {
        info!("Creating bucket: {}", bucket);
        
        match self.client.create_bucket().bucket(bucket).send().await {
            Ok(_) => {
                info!("Bucket created: {}", bucket);
                Ok(())
            }
            Err(e) => {
                let error_str = e.to_string();
                if error_str.contains("BucketAlreadyExists") || error_str.contains("BucketAlreadyOwnedByYou") {
                    debug!("Bucket already exists: {}", bucket);
                    Ok(())
                } else {
                    error!("Failed to create bucket {}: {}", bucket, e);
                    Err(StorageError::BucketError(e.to_string()))
                }
            }
        }
    }

    /// Delete a bucket
    pub async fn delete_bucket(&self, bucket: &str) -> Result<(), StorageError> {
        info!("Deleting bucket: {}", bucket);
        
        self.client
            .delete_bucket()
            .bucket(bucket)
            .send()
            .await
            .map_err(|e| StorageError::BucketError(e.to_string()))?;
        
        info!("Bucket deleted: {}", bucket);
        Ok(())
    }

    /// Check if bucket exists
    pub async fn bucket_exists(&self, bucket: &str) -> Result<bool, StorageError> {
        match self.client.head_bucket().bucket(bucket).send().await {
            Ok(_) => Ok(true),
            Err(e) => {
                let error_str = e.to_string();
                if error_str.contains("NotFound") || error_str.contains("NoSuchBucket") {
                    Ok(false)
                } else {
                    Err(StorageError::BucketError(e.to_string()))
                }
            }
        }
    }

    /// Put an object
    pub async fn put_object(&self, bucket: &str, key: &str, data: Vec<u8>) -> Result<String, StorageError> {
        debug!("Putting object: {}/{} ({} bytes)", bucket, key, data.len());
        
        let body = ByteStream::from(data);
        
        let result = self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .map_err(|e| StorageError::PutObjectFailed(e.to_string()))?;
        
        let etag = result.e_tag().unwrap_or("").to_string();
        debug!("Object uploaded: {}/{} (etag: {})", bucket, key, etag);
        
        Ok(etag)
    }

    /// Put an object with content type
    pub async fn put_object_with_content_type(
        &self,
        bucket: &str,
        key: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> Result<String, StorageError> {
        debug!("Putting object: {}/{} ({} bytes, type: {})", bucket, key, data.len(), content_type);
        
        let body = ByteStream::from(data);
        
        let result = self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .content_type(content_type)
            .send()
            .await
            .map_err(|e| StorageError::PutObjectFailed(e.to_string()))?;
        
        let etag = result.e_tag().unwrap_or("").to_string();
        Ok(etag)
    }

    /// Get an object
    pub async fn get_object(&self, bucket: &str, key: &str) -> Result<Vec<u8>, StorageError> {
        debug!("Getting object: {}/{}", bucket, key);
        
        let result = self.client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| StorageError::GetObjectFailed(e.to_string()))?;
        
        let data = result
            .body
            .collect()
            .await
            .map_err(|e| StorageError::GetObjectFailed(e.to_string()))?
            .into_bytes()
            .to_vec();
        
        debug!("Object retrieved: {}/{} ({} bytes)", bucket, key, data.len());
        Ok(data)
    }

    /// Get object with range (for streaming)
    pub async fn get_object_range(
        &self,
        bucket: &str,
        key: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, StorageError> {
        debug!("Getting object range: {}/{} (bytes={}-{})", bucket, key, start, end);
        
        let range = format!("bytes={}-{}", start, end);
        
        let result = self.client
            .get_object()
            .bucket(bucket)
            .key(key)
            .range(range)
            .send()
            .await
            .map_err(|e| StorageError::GetObjectFailed(e.to_string()))?;
        
        let data = result
            .body
            .collect()
            .await
            .map_err(|e| StorageError::GetObjectFailed(e.to_string()))?
            .into_bytes()
            .to_vec();
        
        Ok(data)
    }

    /// Delete an object
    pub async fn delete_object(&self, bucket: &str, key: &str) -> Result<(), StorageError> {
        debug!("Deleting object: {}/{}", bucket, key);
        
        self.client
            .delete_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| StorageError::DeleteObjectFailed(e.to_string()))?;
        
        debug!("Object deleted: {}/{}", bucket, key);
        Ok(())
    }

    /// Check if object exists
    pub async fn object_exists(&self, bucket: &str, key: &str) -> Result<bool, StorageError> {
        match self.client.head_object().bucket(bucket).key(key).send().await {
            Ok(_) => Ok(true),
            Err(e) => {
                let error_str = e.to_string();
                if error_str.contains("NotFound") || error_str.contains("NoSuchKey") {
                    Ok(false)
                } else {
                    Err(StorageError::GetObjectFailed(e.to_string()))
                }
            }
        }
    }

    /// Get object metadata
    pub async fn get_object_metadata(&self, bucket: &str, key: &str) -> Result<ObjectMetadata, StorageError> {
        debug!("Getting object metadata: {}/{}", bucket, key);
        
        let result = self.client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| StorageError::GetObjectFailed(e.to_string()))?;
        
        let last_modified = result
            .last_modified()
            .map(|dt| DateTime::from_timestamp(dt.secs(), dt.subsec_nanos()))
            .flatten()
            .unwrap_or_else(Utc::now);
        
        let mut metadata = std::collections::HashMap::new();
        if let Some(meta) = result.metadata() {
            for (k, v) in meta {
                metadata.insert(k.clone(), v.clone());
            }
        }
        
        Ok(ObjectMetadata {
            key: key.to_string(),
            size: result.content_length().unwrap_or(0) as u64,
            last_modified,
            etag: result.e_tag().map(|s| s.to_string()),
            content_type: result.content_type().map(|s| s.to_string()),
            metadata,
        })
    }

    /// List objects in a bucket
    pub async fn list_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
        max_keys: i32,
        continuation_token: Option<&str>,
    ) -> Result<(Vec<ObjectMetadata>, bool, Option<String>), StorageError> {
        debug!("Listing objects in bucket: {} (prefix: {:?})", bucket, prefix);
        
        let mut request = self.client
            .list_objects_v2()
            .bucket(bucket)
            .max_keys(max_keys);
        
        if let Some(p) = prefix {
            request = request.prefix(p);
        }
        
        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }
        
        let result = request
            .send()
            .await
            .map_err(|e| StorageError::ListObjectsFailed(e.to_string()))?;
        
        let objects: Vec<ObjectMetadata> = result
            .contents()
            .iter()
            .map(|obj| {
                let last_modified = obj
                    .last_modified()
                    .map(|dt| DateTime::from_timestamp(dt.secs(), dt.subsec_nanos()))
                    .flatten()
                    .unwrap_or_else(Utc::now);
                
                ObjectMetadata {
                    key: obj.key().unwrap_or("").to_string(),
                    size: obj.size().unwrap_or(0) as u64,
                    last_modified,
                    etag: obj.e_tag().map(|s| s.to_string()),
                    content_type: None,
                    metadata: std::collections::HashMap::new(),
                }
            })
            .collect();
        
        let truncated = result.is_truncated().unwrap_or(false);
        let next_token = result.next_continuation_token().map(|s| s.to_string());
        
        debug!("Listed {} objects (truncated: {})", objects.len(), truncated);
        Ok((objects, truncated, next_token))
    }

    /// Get object URL (not presigned)
    pub fn get_object_url(&self, bucket: &str, key: &str) -> String {
        format!("{}/{}/{}", self.config.endpoint, bucket, key)
    }

    /// Get presigned URL for object download
    pub async fn get_presigned_url(
        &self,
        bucket: &str,
        key: &str,
        expires_in_secs: u64,
    ) -> Result<String, StorageError> {
        debug!("Generating presigned URL for: {}/{} (expires in {} secs)", bucket, key, expires_in_secs);
        
        // For S3-compatible storage, we generate a simple presigned URL
        // In production, you'd use the proper presigning mechanism
        let presigning_config = aws_sdk_s3::presigning::PresigningConfig::builder()
            .expires_in(Duration::from_secs(expires_in_secs))
            .build()
            .map_err(|e| StorageError::PresignFailed(e.to_string()))?;
        
        let presigned = self.client
            .get_object()
            .bucket(bucket)
            .key(key)
            .presigned(presigning_config)
            .await
            .map_err(|e| StorageError::PresignFailed(e.to_string()))?;
        
        Ok(presigned.uri().to_string())
    }

    /// Get presigned URL for object upload
    pub async fn get_presigned_upload_url(
        &self,
        bucket: &str,
        key: &str,
        expires_in_secs: u64,
    ) -> Result<String, StorageError> {
        debug!("Generating presigned upload URL for: {}/{}", bucket, key);
        
        let presigning_config = aws_sdk_s3::presigning::PresigningConfig::builder()
            .expires_in(Duration::from_secs(expires_in_secs))
            .build()
            .map_err(|e| StorageError::PresignFailed(e.to_string()))?;
        
        let presigned = self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .presigned(presigning_config)
            .await
            .map_err(|e| StorageError::PresignFailed(e.to_string()))?;
        
        Ok(presigned.uri().to_string())
    }

    /// Copy object within the same bucket or across buckets
    pub async fn copy_object(
        &self,
        source_bucket: &str,
        source_key: &str,
        dest_bucket: &str,
        dest_key: &str,
    ) -> Result<String, StorageError> {
        debug!("Copying object: {}/{} -> {}/{}", source_bucket, source_key, dest_bucket, dest_key);
        
        let copy_source = format!("{}/{}", source_bucket, source_key);
        
        let result = self.client
            .copy_object()
            .copy_source(&copy_source)
            .bucket(dest_bucket)
            .key(dest_key)
            .send()
            .await
            .map_err(|e| StorageError::CopyObjectFailed(e.to_string()))?;
        
        let etag = result
            .copy_object_result()
            .and_then(|r| r.e_tag())
            .unwrap_or("")
            .to_string();
        
        debug!("Object copied: {}/{} (etag: {})", dest_bucket, dest_key, etag);
        Ok(etag)
    }

    /// Delete multiple objects
    pub async fn delete_objects(&self, bucket: &str, keys: Vec<String>) -> Result<(), StorageError> {
        debug!("Deleting {} objects from bucket: {}", keys.len(), bucket);
        
        let objects: Vec<aws_sdk_s3::types::ObjectIdentifier> = keys
            .into_iter()
            .filter_map(|key| {
                aws_sdk_s3::types::ObjectIdentifier::builder()
                    .key(key)
                    .build()
                    .ok()
            })
            .collect();
        
        let delete = aws_sdk_s3::types::Delete::builder()
            .set_objects(Some(objects))
            .build()
            .map_err(|e| StorageError::DeleteObjectFailed(e.to_string()))?;
        
        self.client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .map_err(|e| StorageError::DeleteObjectFailed(e.to_string()))?;
        
        debug!("Objects deleted from bucket: {}", bucket);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_storage_config_defaults() {
        let config = StorageConfig {
            endpoint: "http://localhost:9000".to_string(),
            access_key: "test".to_string(),
            secret_key: "test".to_string(),
            region: default_region(),
            default_bucket: None,
            force_path_style: default_path_style(),
            backend_name: default_backend_name(),
            timeout_secs: default_timeout(),
        };
        
        assert_eq!(config.region, "us-east-1");
        assert!(config.force_path_style);
        assert_eq!(config.backend_name, "rustfs");
        assert_eq!(config.timeout_secs, 30);
    }
}
