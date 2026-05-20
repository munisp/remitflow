// Package sync provides Prometheus metrics for sync health monitoring
package sync

import (
	"net/http"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// SyncMetrics holds all Prometheus metrics for sync operations
type SyncMetrics struct {
	// Counters
	SyncOperationsTotal    *prometheus.CounterVec
	SyncBytesTotal         *prometheus.CounterVec
	ConflictsTotal         *prometheus.CounterVec
	DeltasTotal            *prometheus.CounterVec
	RetryTotal             *prometheus.CounterVec
	
	// Gauges
	PendingSyncItems       *prometheus.GaugeVec
	QueueSize              *prometheus.GaugeVec
	ActiveConnections      prometheus.Gauge
	LastSyncTimestamp      *prometheus.GaugeVec
	SyncLag                *prometheus.GaugeVec
	
	// Histograms
	SyncDuration           *prometheus.HistogramVec
	SyncLatency            *prometheus.HistogramVec
	DeltaSize              *prometheus.HistogramVec
	BatchSize              *prometheus.HistogramVec
	
	// Summaries
	ConflictResolutionTime *prometheus.SummaryVec
}

// NewSyncMetrics creates and registers all sync metrics
func NewSyncMetrics(namespace string) *SyncMetrics {
	m := &SyncMetrics{
		// Counters
		SyncOperationsTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "sync_operations_total",
				Help:      "Total number of sync operations",
			},
			[]string{"node_id", "direction", "status", "entity_type"},
		),
		
		SyncBytesTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "sync_bytes_total",
				Help:      "Total bytes synced",
			},
			[]string{"node_id", "direction", "compressed"},
		),
		
		ConflictsTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "sync_conflicts_total",
				Help:      "Total number of sync conflicts",
			},
			[]string{"node_id", "entity_type", "resolution"},
		),
		
		DeltasTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "sync_deltas_total",
				Help:      "Total number of deltas processed",
			},
			[]string{"node_id", "operation"},
		),
		
		RetryTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "sync_retry_total",
				Help:      "Total number of sync retries",
			},
			[]string{"node_id", "reason"},
		),
		
		// Gauges
		PendingSyncItems: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "sync_pending_items",
				Help:      "Number of items pending sync",
			},
			[]string{"node_id", "priority"},
		),
		
		QueueSize: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "sync_queue_size",
				Help:      "Current size of sync queue",
			},
			[]string{"node_id", "queue_type"},
		),
		
		ActiveConnections: promauto.NewGauge(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "sync_active_connections",
				Help:      "Number of active sync connections",
			},
		),
		
		LastSyncTimestamp: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "sync_last_timestamp_seconds",
				Help:      "Timestamp of last successful sync",
			},
			[]string{"node_id", "direction"},
		),
		
		SyncLag: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "sync_lag_seconds",
				Help:      "Current sync lag in seconds",
			},
			[]string{"node_id"},
		),
		
		// Histograms
		SyncDuration: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "sync_duration_seconds",
				Help:      "Duration of sync operations",
				Buckets:   []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
			},
			[]string{"node_id", "operation", "status"},
		),
		
		SyncLatency: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "sync_latency_seconds",
				Help:      "Network latency for sync operations",
				Buckets:   []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
			},
			[]string{"node_id", "endpoint"},
		),
		
		DeltaSize: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "sync_delta_size_bytes",
				Help:      "Size of delta payloads in bytes",
				Buckets:   []float64{100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000},
			},
			[]string{"node_id", "entity_type"},
		),
		
		BatchSize: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "sync_batch_size",
				Help:      "Number of items in sync batches",
				Buckets:   []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
			},
			[]string{"node_id"},
		),
		
		// Summaries
		ConflictResolutionTime: promauto.NewSummaryVec(
			prometheus.SummaryOpts{
				Namespace:  namespace,
				Name:       "sync_conflict_resolution_seconds",
				Help:       "Time to resolve sync conflicts",
				Objectives: map[float64]float64{0.5: 0.05, 0.9: 0.01, 0.99: 0.001},
			},
			[]string{"node_id", "resolution_type"},
		),
	}
	
	return m
}

// RecordSyncOperation records a sync operation
func (m *SyncMetrics) RecordSyncOperation(nodeID, direction, status, entityType string) {
	m.SyncOperationsTotal.WithLabelValues(nodeID, direction, status, entityType).Inc()
}

// RecordSyncBytes records bytes synced
func (m *SyncMetrics) RecordSyncBytes(nodeID, direction string, bytes float64, compressed bool) {
	compressedStr := "false"
	if compressed {
		compressedStr = "true"
	}
	m.SyncBytesTotal.WithLabelValues(nodeID, direction, compressedStr).Add(bytes)
}

// RecordConflict records a sync conflict
func (m *SyncMetrics) RecordConflict(nodeID, entityType, resolution string) {
	m.ConflictsTotal.WithLabelValues(nodeID, entityType, resolution).Inc()
}

// RecordDelta records a delta operation
func (m *SyncMetrics) RecordDelta(nodeID, operation string) {
	m.DeltasTotal.WithLabelValues(nodeID, operation).Inc()
}

// RecordRetry records a sync retry
func (m *SyncMetrics) RecordRetry(nodeID, reason string) {
	m.RetryTotal.WithLabelValues(nodeID, reason).Inc()
}

// SetPendingItems sets the number of pending sync items
func (m *SyncMetrics) SetPendingItems(nodeID, priority string, count float64) {
	m.PendingSyncItems.WithLabelValues(nodeID, priority).Set(count)
}

// SetQueueSize sets the queue size
func (m *SyncMetrics) SetQueueSize(nodeID, queueType string, size float64) {
	m.QueueSize.WithLabelValues(nodeID, queueType).Set(size)
}

// SetActiveConnections sets the number of active connections
func (m *SyncMetrics) SetActiveConnections(count float64) {
	m.ActiveConnections.Set(count)
}

// SetLastSyncTimestamp sets the last sync timestamp
func (m *SyncMetrics) SetLastSyncTimestamp(nodeID, direction string) {
	m.LastSyncTimestamp.WithLabelValues(nodeID, direction).SetToCurrentTime()
}

// SetSyncLag sets the current sync lag
func (m *SyncMetrics) SetSyncLag(nodeID string, lagSeconds float64) {
	m.SyncLag.WithLabelValues(nodeID).Set(lagSeconds)
}

// ObserveSyncDuration observes sync duration
func (m *SyncMetrics) ObserveSyncDuration(nodeID, operation, status string, duration time.Duration) {
	m.SyncDuration.WithLabelValues(nodeID, operation, status).Observe(duration.Seconds())
}

// ObserveSyncLatency observes sync latency
func (m *SyncMetrics) ObserveSyncLatency(nodeID, endpoint string, latency time.Duration) {
	m.SyncLatency.WithLabelValues(nodeID, endpoint).Observe(latency.Seconds())
}

// ObserveDeltaSize observes delta payload size
func (m *SyncMetrics) ObserveDeltaSize(nodeID, entityType string, sizeBytes float64) {
	m.DeltaSize.WithLabelValues(nodeID, entityType).Observe(sizeBytes)
}

// ObserveBatchSize observes batch size
func (m *SyncMetrics) ObserveBatchSize(nodeID string, size float64) {
	m.BatchSize.WithLabelValues(nodeID).Observe(size)
}

// ObserveConflictResolution observes conflict resolution time
func (m *SyncMetrics) ObserveConflictResolution(nodeID, resolutionType string, duration time.Duration) {
	m.ConflictResolutionTime.WithLabelValues(nodeID, resolutionType).Observe(duration.Seconds())
}

// MetricsServer serves Prometheus metrics
type MetricsServer struct {
	server  *http.Server
	metrics *SyncMetrics
}

// NewMetricsServer creates a new metrics server
func NewMetricsServer(addr string, metrics *SyncMetrics) *MetricsServer {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	
	return &MetricsServer{
		server: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
		metrics: metrics,
	}
}

// Start starts the metrics server
func (ms *MetricsServer) Start() error {
	return ms.server.ListenAndServe()
}

// Stop stops the metrics server
func (ms *MetricsServer) Stop() error {
	return ms.server.Close()
}

// SyncHealthChecker monitors sync health
type SyncHealthChecker struct {
	mu              sync.RWMutex
	metrics         *SyncMetrics
	nodeID          string
	lastSyncTime    time.Time
	consecutiveFails int
	isHealthy       bool
	healthThreshold time.Duration
	failThreshold   int
}

// NewSyncHealthChecker creates a new health checker
func NewSyncHealthChecker(metrics *SyncMetrics, nodeID string) *SyncHealthChecker {
	return &SyncHealthChecker{
		metrics:         metrics,
		nodeID:          nodeID,
		isHealthy:       true,
		healthThreshold: 30 * time.Second,
		failThreshold:   3,
	}
}

// RecordSuccess records a successful sync
func (hc *SyncHealthChecker) RecordSuccess() {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	
	hc.lastSyncTime = time.Now()
	hc.consecutiveFails = 0
	hc.isHealthy = true
	
	hc.metrics.SetLastSyncTimestamp(hc.nodeID, "outbound")
	hc.metrics.SetSyncLag(hc.nodeID, 0)
}

// RecordFailure records a failed sync
func (hc *SyncHealthChecker) RecordFailure(reason string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	
	hc.consecutiveFails++
	hc.metrics.RecordRetry(hc.nodeID, reason)
	
	if hc.consecutiveFails >= hc.failThreshold {
		hc.isHealthy = false
	}
}

// CheckHealth checks current health status
func (hc *SyncHealthChecker) CheckHealth() (bool, string) {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	
	if !hc.isHealthy {
		return false, "too many consecutive failures"
	}
	
	if time.Since(hc.lastSyncTime) > hc.healthThreshold {
		lag := time.Since(hc.lastSyncTime).Seconds()
		hc.metrics.SetSyncLag(hc.nodeID, lag)
		return false, "sync lag exceeded threshold"
	}
	
	return true, "healthy"
}

// IsHealthy returns current health status
func (hc *SyncHealthChecker) IsHealthy() bool {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	return hc.isHealthy
}

// GetLastSyncTime returns the last sync time
func (hc *SyncHealthChecker) GetLastSyncTime() time.Time {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	return hc.lastSyncTime
}

// AlertManager manages sync alerts
type AlertManager struct {
	mu       sync.RWMutex
	alerts   []Alert
	handlers []AlertHandler
}

// Alert represents a sync alert
type Alert struct {
	ID        string    `json:"id"`
	Severity  string    `json:"severity"` // critical, warning, info
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	NodeID    string    `json:"node_id"`
	Timestamp time.Time `json:"timestamp"`
	Resolved  bool      `json:"resolved"`
}

// AlertHandler handles alerts
type AlertHandler func(Alert)

// NewAlertManager creates a new alert manager
func NewAlertManager() *AlertManager {
	return &AlertManager{
		alerts:   make([]Alert, 0),
		handlers: make([]AlertHandler, 0),
	}
}

// AddHandler adds an alert handler
func (am *AlertManager) AddHandler(handler AlertHandler) {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.handlers = append(am.handlers, handler)
}

// RaiseAlert raises a new alert
func (am *AlertManager) RaiseAlert(severity, alertType, message, nodeID string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	
	alert := Alert{
		ID:        generateAlertID(),
		Severity:  severity,
		Type:      alertType,
		Message:   message,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Resolved:  false,
	}
	
	am.alerts = append(am.alerts, alert)
	
	// Notify handlers
	for _, handler := range am.handlers {
		go handler(alert)
	}
}

// ResolveAlert resolves an alert
func (am *AlertManager) ResolveAlert(id string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	
	for i := range am.alerts {
		if am.alerts[i].ID == id {
			am.alerts[i].Resolved = true
			break
		}
	}
}

// GetActiveAlerts returns all active alerts
func (am *AlertManager) GetActiveAlerts() []Alert {
	am.mu.RLock()
	defer am.mu.RUnlock()
	
	active := make([]Alert, 0)
	for _, alert := range am.alerts {
		if !alert.Resolved {
			active = append(active, alert)
		}
	}
	return active
}

func generateAlertID() string {
	return time.Now().Format("20060102150405.000")
}

// DashboardData represents data for a monitoring dashboard
type DashboardData struct {
	NodeID             string             `json:"node_id"`
	IsHealthy          bool               `json:"is_healthy"`
	LastSyncTime       time.Time          `json:"last_sync_time"`
	SyncLag            float64            `json:"sync_lag_seconds"`
	PendingItems       map[string]int     `json:"pending_items"`
	QueueSizes         map[string]int     `json:"queue_sizes"`
	ActiveConnections  int                `json:"active_connections"`
	RecentOperations   int                `json:"recent_operations"`
	RecentConflicts    int                `json:"recent_conflicts"`
	RecentRetries      int                `json:"recent_retries"`
	AvgSyncDuration    float64            `json:"avg_sync_duration_ms"`
	AvgLatency         float64            `json:"avg_latency_ms"`
	BytesSynced        int64              `json:"bytes_synced"`
	CompressionRatio   float64            `json:"compression_ratio"`
	ActiveAlerts       []Alert            `json:"active_alerts"`
}

// DashboardCollector collects data for the dashboard
type DashboardCollector struct {
	mu            sync.RWMutex
	nodeID        string
	healthChecker *SyncHealthChecker
	alertManager  *AlertManager
	
	// Rolling counters (reset periodically)
	recentOps       int
	recentConflicts int
	recentRetries   int
	bytesSynced     int64
	bytesRaw        int64
	syncDurations   []float64
	latencies       []float64
}

// NewDashboardCollector creates a new dashboard collector
func NewDashboardCollector(nodeID string, healthChecker *SyncHealthChecker, alertManager *AlertManager) *DashboardCollector {
	return &DashboardCollector{
		nodeID:        nodeID,
		healthChecker: healthChecker,
		alertManager:  alertManager,
		syncDurations: make([]float64, 0),
		latencies:     make([]float64, 0),
	}
}

// RecordOperation records an operation for dashboard
func (dc *DashboardCollector) RecordOperation() {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.recentOps++
}

// RecordConflict records a conflict for dashboard
func (dc *DashboardCollector) RecordConflict() {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.recentConflicts++
}

// RecordRetry records a retry for dashboard
func (dc *DashboardCollector) RecordRetry() {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.recentRetries++
}

// RecordBytes records bytes synced
func (dc *DashboardCollector) RecordBytes(compressed, raw int64) {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.bytesSynced += compressed
	dc.bytesRaw += raw
}

// RecordDuration records sync duration
func (dc *DashboardCollector) RecordDuration(d time.Duration) {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.syncDurations = append(dc.syncDurations, float64(d.Milliseconds()))
	if len(dc.syncDurations) > 100 {
		dc.syncDurations = dc.syncDurations[1:]
	}
}

// RecordLatency records latency
func (dc *DashboardCollector) RecordLatency(d time.Duration) {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.latencies = append(dc.latencies, float64(d.Milliseconds()))
	if len(dc.latencies) > 100 {
		dc.latencies = dc.latencies[1:]
	}
}

// GetDashboardData returns current dashboard data
func (dc *DashboardCollector) GetDashboardData() *DashboardData {
	dc.mu.RLock()
	defer dc.mu.RUnlock()
	
	// Calculate averages
	var avgDuration, avgLatency float64
	if len(dc.syncDurations) > 0 {
		var sum float64
		for _, d := range dc.syncDurations {
			sum += d
		}
		avgDuration = sum / float64(len(dc.syncDurations))
	}
	if len(dc.latencies) > 0 {
		var sum float64
		for _, l := range dc.latencies {
			sum += l
		}
		avgLatency = sum / float64(len(dc.latencies))
	}
	
	// Calculate compression ratio
	var compressionRatio float64
	if dc.bytesRaw > 0 {
		compressionRatio = float64(dc.bytesSynced) / float64(dc.bytesRaw)
	}
	
	healthy, _ := dc.healthChecker.CheckHealth()
	
	return &DashboardData{
		NodeID:            dc.nodeID,
		IsHealthy:         healthy,
		LastSyncTime:      dc.healthChecker.GetLastSyncTime(),
		SyncLag:           time.Since(dc.healthChecker.GetLastSyncTime()).Seconds(),
		RecentOperations:  dc.recentOps,
		RecentConflicts:   dc.recentConflicts,
		RecentRetries:     dc.recentRetries,
		AvgSyncDuration:   avgDuration,
		AvgLatency:        avgLatency,
		BytesSynced:       dc.bytesSynced,
		CompressionRatio:  compressionRatio,
		ActiveAlerts:      dc.alertManager.GetActiveAlerts(),
	}
}

// Reset resets the rolling counters
func (dc *DashboardCollector) Reset() {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	
	dc.recentOps = 0
	dc.recentConflicts = 0
	dc.recentRetries = 0
	dc.bytesSynced = 0
	dc.bytesRaw = 0
	dc.syncDurations = make([]float64, 0)
	dc.latencies = make([]float64, 0)
}
