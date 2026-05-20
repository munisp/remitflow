//! Metrics collection for the storage service

use std::time::Instant;

/// Storage metrics
#[derive(Debug, Clone)]
pub struct StorageMetrics {
    /// Total uploads
    pub uploads_total: u64,
    
    /// Total downloads
    pub downloads_total: u64,
    
    /// Total deletes
    pub deletes_total: u64,
    
    /// Total bytes uploaded
    pub bytes_uploaded: u64,
    
    /// Total bytes downloaded
    pub bytes_downloaded: u64,
    
    /// Failed operations
    pub failed_operations: u64,
    
    /// Service start time
    pub start_time: Instant,
}

impl StorageMetrics {
    /// Create new metrics instance
    pub fn new() -> Self {
        Self {
            uploads_total: 0,
            downloads_total: 0,
            deletes_total: 0,
            bytes_uploaded: 0,
            bytes_downloaded: 0,
            failed_operations: 0,
            start_time: Instant::now(),
        }
    }
    
    /// Record an upload
    pub fn record_upload(&mut self, bytes: u64) {
        self.uploads_total += 1;
        self.bytes_uploaded += bytes;
    }
    
    /// Record a download
    pub fn record_download(&mut self, bytes: u64) {
        self.downloads_total += 1;
        self.bytes_downloaded += bytes;
    }
    
    /// Record a delete
    pub fn record_delete(&mut self) {
        self.deletes_total += 1;
    }
    
    /// Record a failed operation
    pub fn record_failure(&mut self) {
        self.failed_operations += 1;
    }
    
    /// Get uptime in seconds
    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
    
    /// Convert to Prometheus format
    pub fn to_prometheus_format(&self) -> String {
        format!(
            r#"# HELP storage_uploads_total Total number of uploads
# TYPE storage_uploads_total counter
storage_uploads_total {}

# HELP storage_downloads_total Total number of downloads
# TYPE storage_downloads_total counter
storage_downloads_total {}

# HELP storage_deletes_total Total number of deletes
# TYPE storage_deletes_total counter
storage_deletes_total {}

# HELP storage_bytes_uploaded_total Total bytes uploaded
# TYPE storage_bytes_uploaded_total counter
storage_bytes_uploaded_total {}

# HELP storage_bytes_downloaded_total Total bytes downloaded
# TYPE storage_bytes_downloaded_total counter
storage_bytes_downloaded_total {}

# HELP storage_failed_operations_total Total failed operations
# TYPE storage_failed_operations_total counter
storage_failed_operations_total {}

# HELP storage_uptime_seconds Service uptime in seconds
# TYPE storage_uptime_seconds gauge
storage_uptime_seconds {}
"#,
            self.uploads_total,
            self.downloads_total,
            self.deletes_total,
            self.bytes_uploaded,
            self.bytes_downloaded,
            self.failed_operations,
            self.uptime_secs(),
        )
    }
}

impl Default for StorageMetrics {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_metrics_recording() {
        let mut metrics = StorageMetrics::new();
        
        metrics.record_upload(1000);
        metrics.record_upload(2000);
        metrics.record_download(500);
        metrics.record_delete();
        metrics.record_failure();
        
        assert_eq!(metrics.uploads_total, 2);
        assert_eq!(metrics.bytes_uploaded, 3000);
        assert_eq!(metrics.downloads_total, 1);
        assert_eq!(metrics.bytes_downloaded, 500);
        assert_eq!(metrics.deletes_total, 1);
        assert_eq!(metrics.failed_operations, 1);
    }
    
    #[test]
    fn test_prometheus_format() {
        let metrics = StorageMetrics::new();
        let output = metrics.to_prometheus_format();
        
        assert!(output.contains("storage_uploads_total"));
        assert!(output.contains("storage_downloads_total"));
        assert!(output.contains("storage_uptime_seconds"));
    }
}
