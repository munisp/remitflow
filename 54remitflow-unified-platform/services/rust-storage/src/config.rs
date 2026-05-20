//! Configuration module for the storage service

use serde::Deserialize;
use std::env;

use crate::storage::StorageConfig;

/// Server configuration
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    /// Server port
    #[serde(default = "default_port")]
    pub port: u16,
    
    /// Server host
    #[serde(default = "default_host")]
    pub host: String,
}

fn default_port() -> u16 {
    8087
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

/// Application configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub storage: StorageConfig,
}

/// Load configuration from environment variables
pub fn load_config() -> anyhow::Result<AppConfig> {
    // Load .env file if present
    dotenvy::dotenv().ok();
    
    // Server config
    let server = ServerConfig {
        port: env::var("STORAGE_SERVICE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or_else(default_port),
        host: env::var("STORAGE_SERVICE_HOST")
            .unwrap_or_else(|_| default_host()),
    };
    
    // Storage config - RustFS by default
    let storage = StorageConfig {
        endpoint: env::var("RUSTFS_ENDPOINT")
            .or_else(|_| env::var("S3_ENDPOINT"))
            .or_else(|_| env::var("MINIO_ENDPOINT"))
            .unwrap_or_else(|_| "http://localhost:9000".to_string()),
        access_key: env::var("RUSTFS_ACCESS_KEY")
            .or_else(|_| env::var("S3_ACCESS_KEY"))
            .or_else(|_| env::var("MINIO_ACCESS_KEY"))
            .or_else(|_| env::var("AWS_ACCESS_KEY_ID"))
            .unwrap_or_else(|_| "minioadmin".to_string()),
        secret_key: env::var("RUSTFS_SECRET_KEY")
            .or_else(|_| env::var("S3_SECRET_KEY"))
            .or_else(|_| env::var("MINIO_SECRET_KEY"))
            .or_else(|_| env::var("AWS_SECRET_ACCESS_KEY"))
            .unwrap_or_else(|_| "minioadmin".to_string()),
        region: env::var("RUSTFS_REGION")
            .or_else(|_| env::var("S3_REGION"))
            .or_else(|_| env::var("AWS_REGION"))
            .unwrap_or_else(|_| "us-east-1".to_string()),
        default_bucket: env::var("RUSTFS_DEFAULT_BUCKET")
            .or_else(|_| env::var("S3_DEFAULT_BUCKET"))
            .ok(),
        force_path_style: env::var("RUSTFS_FORCE_PATH_STYLE")
            .or_else(|_| env::var("S3_FORCE_PATH_STYLE"))
            .map(|v| v.to_lowercase() == "true")
            .unwrap_or(true),
        backend_name: env::var("STORAGE_BACKEND_NAME")
            .unwrap_or_else(|_| "rustfs".to_string()),
        timeout_secs: env::var("STORAGE_TIMEOUT_SECS")
            .ok()
            .and_then(|t| t.parse().ok())
            .unwrap_or(30),
    };
    
    Ok(AppConfig { server, storage })
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_default_config() {
        // Clear any existing env vars
        env::remove_var("RUSTFS_ENDPOINT");
        env::remove_var("S3_ENDPOINT");
        env::remove_var("MINIO_ENDPOINT");
        
        let config = load_config().unwrap();
        
        assert_eq!(config.server.port, 8087);
        assert_eq!(config.server.host, "0.0.0.0");
        assert_eq!(config.storage.endpoint, "http://localhost:9000");
        assert_eq!(config.storage.region, "us-east-1");
        assert!(config.storage.force_path_style);
    }
}
