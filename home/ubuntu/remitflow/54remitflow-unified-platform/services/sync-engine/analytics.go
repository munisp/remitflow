// Package sync provides sync analytics and dashboards
// Implements real-time metrics, anomaly detection, and Grafana integration
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"
)

// AnalyticsConfig configures analytics behavior
type AnalyticsConfig struct {
	Enabled              bool          `json:"enabled"`
	AggregationInterval  time.Duration `json:"aggregation_interval"`
	RetentionPeriod      time.Duration `json:"retention_period"`
	AnomalyThreshold     float64       `json:"anomaly_threshold"`
	AlertingEnabled      bool          `json:"alerting_enabled"`
	GrafanaEnabled       bool          `json:"grafana_enabled"`
	GrafanaEndpoint      string        `json:"grafana_endpoint"`
}

// DefaultAnalyticsConfig returns default analytics configuration
func DefaultAnalyticsConfig() *AnalyticsConfig {
	return &AnalyticsConfig{
		Enabled:             true,
		AggregationInterval: 1 * time.Minute,
		RetentionPeriod:     7 * 24 * time.Hour,
		AnomalyThreshold:    2.0, // Standard deviations
		AlertingEnabled:     true,
		GrafanaEnabled:      true,
		GrafanaEndpoint:     "http://grafana:3000",
	}
}

// SyncAnalytics provides sync analytics
type SyncAnalytics struct {
	mu              sync.RWMutex
	config          *AnalyticsConfig
	metrics         *SyncMetrics
	timeSeries      map[string]*TimeSeries
	aggregates      map[string]*AggregatedMetrics
	anomalyDetector *AnomalyDetector
	alertManager    *AlertManager
	stopCh          chan struct{}
	wg              sync.WaitGroup
}

// TimeSeries represents a time series of metrics
type TimeSeries struct {
	Name       string       `json:"name"`
	Labels     map[string]string `json:"labels"`
	DataPoints []DataPoint  `json:"data_points"`
}

// DataPoint represents a single data point
type DataPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

// AggregatedMetrics represents aggregated metrics
type AggregatedMetrics struct {
	Period    string    `json:"period"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	
	// Sync metrics
	TotalSyncs       int64   `json:"total_syncs"`
	SuccessfulSyncs  int64   `json:"successful_syncs"`
	FailedSyncs      int64   `json:"failed_syncs"`
	SuccessRate      float64 `json:"success_rate"`
	
	// Latency metrics
	AvgLatency       float64 `json:"avg_latency_ms"`
	P50Latency       float64 `json:"p50_latency_ms"`
	P95Latency       float64 `json:"p95_latency_ms"`
	P99Latency       float64 `json:"p99_latency_ms"`
	MaxLatency       float64 `json:"max_latency_ms"`
	
	// Throughput metrics
	BytesTransferred int64   `json:"bytes_transferred"`
	BytesCompressed  int64   `json:"bytes_compressed"`
	CompressionRatio float64 `json:"compression_ratio"`
	
	// Conflict metrics
	TotalConflicts   int64   `json:"total_conflicts"`
	ResolvedConflicts int64  `json:"resolved_conflicts"`
	ConflictRate     float64 `json:"conflict_rate"`
	
	// Offline metrics
	OfflineSyncs     int64   `json:"offline_syncs"`
	OfflineRate      float64 `json:"offline_rate"`
	
	// Agent metrics
	ActiveAgents     int     `json:"active_agents"`
	TopAgents        []AgentMetrics `json:"top_agents"`
	
	// Entity metrics
	ByEntityType     map[string]int64 `json:"by_entity_type"`
}

// AgentMetrics represents metrics for a single agent
type AgentMetrics struct {
	AgentID      string  `json:"agent_id"`
	SyncCount    int64   `json:"sync_count"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatency   float64 `json:"avg_latency_ms"`
	BytesSynced  int64   `json:"bytes_synced"`
}

// NewSyncAnalytics creates a new sync analytics instance
func NewSyncAnalytics(config *AnalyticsConfig, metrics *SyncMetrics) *SyncAnalytics {
	if config == nil {
		config = DefaultAnalyticsConfig()
	}

	sa := &SyncAnalytics{
		config:          config,
		metrics:         metrics,
		timeSeries:      make(map[string]*TimeSeries),
		aggregates:      make(map[string]*AggregatedMetrics),
		anomalyDetector: NewAnomalyDetector(config.AnomalyThreshold),
		alertManager:    NewAlertManager(config.AlertingEnabled),
		stopCh:          make(chan struct{}),
	}

	return sa
}

// Start starts the analytics engine
func (sa *SyncAnalytics) Start(ctx context.Context) {
	sa.wg.Add(2)
	go sa.aggregationLoop(ctx)
	go sa.anomalyDetectionLoop(ctx)
}

// Stop stops the analytics engine
func (sa *SyncAnalytics) Stop() {
	close(sa.stopCh)
	sa.wg.Wait()
}

// RecordSyncEvent records a sync event for analytics
func (sa *SyncAnalytics) RecordSyncEvent(event *SyncAnalyticsEvent) {
	sa.mu.Lock()
	defer sa.mu.Unlock()

	// Record to time series
	sa.recordTimeSeries("sync_count", map[string]string{
		"entity_type": event.EntityType,
		"status":      event.Status,
	}, 1)

	sa.recordTimeSeries("sync_latency", map[string]string{
		"entity_type": event.EntityType,
	}, float64(event.Latency.Milliseconds()))

	sa.recordTimeSeries("sync_bytes", map[string]string{
		"entity_type": event.EntityType,
	}, float64(event.BytesTransferred))

	if event.IsConflict {
		sa.recordTimeSeries("sync_conflicts", map[string]string{
			"entity_type": event.EntityType,
		}, 1)
	}

	if event.IsOffline {
		sa.recordTimeSeries("sync_offline", map[string]string{
			"entity_type": event.EntityType,
		}, 1)
	}
}

// SyncAnalyticsEvent represents an analytics event
type SyncAnalyticsEvent struct {
	Timestamp        time.Time
	AgentID          string
	EntityID         string
	EntityType       string
	Operation        string
	Status           string // success, failed
	Latency          time.Duration
	BytesTransferred int64
	IsConflict       bool
	IsOffline        bool
}

// GetDashboardData returns data for the analytics dashboard
func (sa *SyncAnalytics) GetDashboardData(period string) *DashboardData {
	sa.mu.RLock()
	defer sa.mu.RUnlock()

	aggregate := sa.aggregates[period]
	if aggregate == nil {
		aggregate = &AggregatedMetrics{Period: period}
	}

	return &DashboardData{
		Period:     period,
		UpdatedAt:  time.Now(),
		Aggregate:  aggregate,
		TimeSeries: sa.getTimeSeriesForPeriod(period),
		Alerts:     sa.alertManager.GetActiveAlerts(),
		Anomalies:  sa.anomalyDetector.GetRecentAnomalies(),
	}
}

// DashboardData represents dashboard data
type DashboardData struct {
	Period     string              `json:"period"`
	UpdatedAt  time.Time           `json:"updated_at"`
	Aggregate  *AggregatedMetrics  `json:"aggregate"`
	TimeSeries map[string][]DataPoint `json:"time_series"`
	Alerts     []*Alert            `json:"alerts"`
	Anomalies  []*Anomaly          `json:"anomalies"`
}

// GetGrafanaDashboard returns Grafana dashboard JSON
func (sa *SyncAnalytics) GetGrafanaDashboard() *GrafanaDashboard {
	return &GrafanaDashboard{
		Title: "Sync Engine Analytics",
		UID:   "sync-engine-analytics",
		Panels: []GrafanaPanel{
			{
				ID:    1,
				Title: "Sync Success Rate",
				Type:  "gauge",
				Targets: []GrafanaTarget{
					{
						Expr:   "sync_success_rate",
						Legend: "Success Rate",
					},
				},
				GridPos: GrafanaGridPos{X: 0, Y: 0, W: 6, H: 4},
			},
			{
				ID:    2,
				Title: "Sync Latency (P95)",
				Type:  "stat",
				Targets: []GrafanaTarget{
					{
						Expr:   "histogram_quantile(0.95, sync_latency_bucket)",
						Legend: "P95 Latency",
					},
				},
				GridPos: GrafanaGridPos{X: 6, Y: 0, W: 6, H: 4},
			},
			{
				ID:    3,
				Title: "Sync Throughput",
				Type:  "graph",
				Targets: []GrafanaTarget{
					{
						Expr:   "rate(sync_bytes_total[5m])",
						Legend: "Bytes/sec",
					},
				},
				GridPos: GrafanaGridPos{X: 12, Y: 0, W: 12, H: 4},
			},
			{
				ID:    4,
				Title: "Sync Operations",
				Type:  "graph",
				Targets: []GrafanaTarget{
					{
						Expr:   "rate(sync_operations_total[5m])",
						Legend: "{{status}}",
					},
				},
				GridPos: GrafanaGridPos{X: 0, Y: 4, W: 12, H: 6},
			},
			{
				ID:    5,
				Title: "Conflicts",
				Type:  "graph",
				Targets: []GrafanaTarget{
					{
						Expr:   "rate(sync_conflicts_total[5m])",
						Legend: "Conflicts/sec",
					},
				},
				GridPos: GrafanaGridPos{X: 12, Y: 4, W: 12, H: 6},
			},
			{
				ID:    6,
				Title: "Latency Distribution",
				Type:  "heatmap",
				Targets: []GrafanaTarget{
					{
						Expr:   "sync_latency_bucket",
						Legend: "Latency",
					},
				},
				GridPos: GrafanaGridPos{X: 0, Y: 10, W: 12, H: 6},
			},
			{
				ID:    7,
				Title: "Active Agents",
				Type:  "stat",
				Targets: []GrafanaTarget{
					{
						Expr:   "sync_active_agents",
						Legend: "Agents",
					},
				},
				GridPos: GrafanaGridPos{X: 12, Y: 10, W: 6, H: 3},
			},
			{
				ID:    8,
				Title: "Offline Syncs",
				Type:  "stat",
				Targets: []GrafanaTarget{
					{
						Expr:   "sync_offline_total",
						Legend: "Offline",
					},
				},
				GridPos: GrafanaGridPos{X: 18, Y: 10, W: 6, H: 3},
			},
			{
				ID:    9,
				Title: "Sync by Entity Type",
				Type:  "piechart",
				Targets: []GrafanaTarget{
					{
						Expr:   "sum by (entity_type) (sync_operations_total)",
						Legend: "{{entity_type}}",
					},
				},
				GridPos: GrafanaGridPos{X: 12, Y: 13, W: 12, H: 6},
			},
			{
				ID:    10,
				Title: "Compression Ratio",
				Type:  "gauge",
				Targets: []GrafanaTarget{
					{
						Expr:   "sync_compression_ratio",
						Legend: "Compression",
					},
				},
				GridPos: GrafanaGridPos{X: 0, Y: 16, W: 6, H: 4},
			},
		},
		Refresh: "10s",
		Time: GrafanaTime{
			From: "now-1h",
			To:   "now",
		},
	}
}

// GrafanaDashboard represents a Grafana dashboard
type GrafanaDashboard struct {
	Title   string         `json:"title"`
	UID     string         `json:"uid"`
	Panels  []GrafanaPanel `json:"panels"`
	Refresh string         `json:"refresh"`
	Time    GrafanaTime    `json:"time"`
}

// GrafanaPanel represents a Grafana panel
type GrafanaPanel struct {
	ID      int             `json:"id"`
	Title   string          `json:"title"`
	Type    string          `json:"type"`
	Targets []GrafanaTarget `json:"targets"`
	GridPos GrafanaGridPos  `json:"gridPos"`
}

// GrafanaTarget represents a Grafana target
type GrafanaTarget struct {
	Expr   string `json:"expr"`
	Legend string `json:"legendFormat"`
}

// GrafanaGridPos represents Grafana grid position
type GrafanaGridPos struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// GrafanaTime represents Grafana time range
type GrafanaTime struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Helper methods

func (sa *SyncAnalytics) recordTimeSeries(name string, labels map[string]string, value float64) {
	key := sa.timeSeriesKey(name, labels)
	
	ts, ok := sa.timeSeries[key]
	if !ok {
		ts = &TimeSeries{
			Name:       name,
			Labels:     labels,
			DataPoints: make([]DataPoint, 0),
		}
		sa.timeSeries[key] = ts
	}

	ts.DataPoints = append(ts.DataPoints, DataPoint{
		Timestamp: time.Now(),
		Value:     value,
	})

	// Trim old data points
	cutoff := time.Now().Add(-sa.config.RetentionPeriod)
	for len(ts.DataPoints) > 0 && ts.DataPoints[0].Timestamp.Before(cutoff) {
		ts.DataPoints = ts.DataPoints[1:]
	}
}

func (sa *SyncAnalytics) timeSeriesKey(name string, labels map[string]string) string {
	key := name
	for k, v := range labels {
		key += fmt.Sprintf("_%s_%s", k, v)
	}
	return key
}

func (sa *SyncAnalytics) getTimeSeriesForPeriod(period string) map[string][]DataPoint {
	result := make(map[string][]DataPoint)
	
	var duration time.Duration
	switch period {
	case "1h":
		duration = 1 * time.Hour
	case "6h":
		duration = 6 * time.Hour
	case "24h":
		duration = 24 * time.Hour
	case "7d":
		duration = 7 * 24 * time.Hour
	default:
		duration = 1 * time.Hour
	}

	cutoff := time.Now().Add(-duration)

	for key, ts := range sa.timeSeries {
		points := make([]DataPoint, 0)
		for _, dp := range ts.DataPoints {
			if dp.Timestamp.After(cutoff) {
				points = append(points, dp)
			}
		}
		if len(points) > 0 {
			result[key] = points
		}
	}

	return result
}

func (sa *SyncAnalytics) aggregationLoop(ctx context.Context) {
	defer sa.wg.Done()

	ticker := time.NewTicker(sa.config.AggregationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-sa.stopCh:
			return
		case <-ticker.C:
			sa.aggregate()
		}
	}
}

func (sa *SyncAnalytics) aggregate() {
	sa.mu.Lock()
	defer sa.mu.Unlock()

	periods := []string{"1h", "6h", "24h", "7d"}
	
	for _, period := range periods {
		sa.aggregates[period] = sa.computeAggregate(period)
	}
}

func (sa *SyncAnalytics) computeAggregate(period string) *AggregatedMetrics {
	var duration time.Duration
	switch period {
	case "1h":
		duration = 1 * time.Hour
	case "6h":
		duration = 6 * time.Hour
	case "24h":
		duration = 24 * time.Hour
	case "7d":
		duration = 7 * 24 * time.Hour
	default:
		duration = 1 * time.Hour
	}

	now := time.Now()
	startTime := now.Add(-duration)

	aggregate := &AggregatedMetrics{
		Period:       period,
		StartTime:    startTime,
		EndTime:      now,
		ByEntityType: make(map[string]int64),
	}

	// Aggregate from time series
	latencies := make([]float64, 0)
	
	for _, ts := range sa.timeSeries {
		for _, dp := range ts.DataPoints {
			if dp.Timestamp.Before(startTime) {
				continue
			}

			switch ts.Name {
			case "sync_count":
				aggregate.TotalSyncs++
				if ts.Labels["status"] == "success" {
					aggregate.SuccessfulSyncs++
				} else {
					aggregate.FailedSyncs++
				}
				if entityType, ok := ts.Labels["entity_type"]; ok {
					aggregate.ByEntityType[entityType]++
				}
			case "sync_latency":
				latencies = append(latencies, dp.Value)
			case "sync_bytes":
				aggregate.BytesTransferred += int64(dp.Value)
			case "sync_conflicts":
				aggregate.TotalConflicts++
			case "sync_offline":
				aggregate.OfflineSyncs++
			}
		}
	}

	// Calculate rates
	if aggregate.TotalSyncs > 0 {
		aggregate.SuccessRate = float64(aggregate.SuccessfulSyncs) / float64(aggregate.TotalSyncs) * 100
		aggregate.ConflictRate = float64(aggregate.TotalConflicts) / float64(aggregate.TotalSyncs) * 100
		aggregate.OfflineRate = float64(aggregate.OfflineSyncs) / float64(aggregate.TotalSyncs) * 100
	}

	// Calculate latency percentiles
	if len(latencies) > 0 {
		sort.Float64s(latencies)
		aggregate.AvgLatency = average(latencies)
		aggregate.P50Latency = percentile(latencies, 50)
		aggregate.P95Latency = percentile(latencies, 95)
		aggregate.P99Latency = percentile(latencies, 99)
		aggregate.MaxLatency = latencies[len(latencies)-1]
	}

	return aggregate
}

func (sa *SyncAnalytics) anomalyDetectionLoop(ctx context.Context) {
	defer sa.wg.Done()

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-sa.stopCh:
			return
		case <-ticker.C:
			sa.detectAnomalies()
		}
	}
}

func (sa *SyncAnalytics) detectAnomalies() {
	sa.mu.Lock()
	defer sa.mu.Unlock()

	// Check for anomalies in key metrics
	for name, ts := range sa.timeSeries {
		if len(ts.DataPoints) < 10 {
			continue
		}

		values := make([]float64, len(ts.DataPoints))
		for i, dp := range ts.DataPoints {
			values[i] = dp.Value
		}

		if anomaly := sa.anomalyDetector.Detect(name, values); anomaly != nil {
			sa.alertManager.CreateAlert(anomaly)
		}
	}
}

// AnomalyDetector detects anomalies in metrics
type AnomalyDetector struct {
	mu        sync.RWMutex
	threshold float64
	anomalies []*Anomaly
}

// Anomaly represents a detected anomaly
type Anomaly struct {
	ID          string    `json:"id"`
	MetricName  string    `json:"metric_name"`
	DetectedAt  time.Time `json:"detected_at"`
	Value       float64   `json:"value"`
	ExpectedMin float64   `json:"expected_min"`
	ExpectedMax float64   `json:"expected_max"`
	Severity    string    `json:"severity"` // low, medium, high, critical
	Description string    `json:"description"`
}

// NewAnomalyDetector creates a new anomaly detector
func NewAnomalyDetector(threshold float64) *AnomalyDetector {
	return &AnomalyDetector{
		threshold: threshold,
		anomalies: make([]*Anomaly, 0),
	}
}

// Detect detects anomalies in values
func (ad *AnomalyDetector) Detect(metricName string, values []float64) *Anomaly {
	if len(values) < 10 {
		return nil
	}

	// Calculate mean and standard deviation
	mean := average(values)
	stdDev := standardDeviation(values, mean)

	// Check if latest value is anomalous
	latest := values[len(values)-1]
	zScore := (latest - mean) / stdDev

	if math.Abs(zScore) > ad.threshold {
		severity := "low"
		if math.Abs(zScore) > ad.threshold*2 {
			severity = "high"
		} else if math.Abs(zScore) > ad.threshold*1.5 {
			severity = "medium"
		}

		anomaly := &Anomaly{
			ID:          fmt.Sprintf("anomaly-%d", time.Now().UnixNano()),
			MetricName:  metricName,
			DetectedAt:  time.Now(),
			Value:       latest,
			ExpectedMin: mean - ad.threshold*stdDev,
			ExpectedMax: mean + ad.threshold*stdDev,
			Severity:    severity,
			Description: fmt.Sprintf("%s value %.2f is %.2f standard deviations from mean %.2f", metricName, latest, zScore, mean),
		}

		ad.mu.Lock()
		ad.anomalies = append(ad.anomalies, anomaly)
		// Keep only recent anomalies
		if len(ad.anomalies) > 100 {
			ad.anomalies = ad.anomalies[len(ad.anomalies)-100:]
		}
		ad.mu.Unlock()

		return anomaly
	}

	return nil
}

// GetRecentAnomalies returns recent anomalies
func (ad *AnomalyDetector) GetRecentAnomalies() []*Anomaly {
	ad.mu.RLock()
	defer ad.mu.RUnlock()

	result := make([]*Anomaly, len(ad.anomalies))
	copy(result, ad.anomalies)
	return result
}

// AlertManager manages alerts
type AlertManager struct {
	mu       sync.RWMutex
	enabled  bool
	alerts   []*Alert
	handlers []AlertHandler
}

// Alert represents an alert
type Alert struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Severity    string    `json:"severity"`
	Status      string    `json:"status"` // firing, resolved
	FiredAt     time.Time `json:"fired_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
	Description string    `json:"description"`
	Labels      map[string]string `json:"labels"`
}

// AlertHandler handles alerts
type AlertHandler interface {
	Handle(alert *Alert) error
}

// NewAlertManager creates a new alert manager
func NewAlertManager(enabled bool) *AlertManager {
	return &AlertManager{
		enabled:  enabled,
		alerts:   make([]*Alert, 0),
		handlers: make([]AlertHandler, 0),
	}
}

// CreateAlert creates an alert from an anomaly
func (am *AlertManager) CreateAlert(anomaly *Anomaly) {
	if !am.enabled {
		return
	}

	am.mu.Lock()
	defer am.mu.Unlock()

	alert := &Alert{
		ID:          fmt.Sprintf("alert-%d", time.Now().UnixNano()),
		Name:        fmt.Sprintf("Anomaly in %s", anomaly.MetricName),
		Severity:    anomaly.Severity,
		Status:      "firing",
		FiredAt:     time.Now(),
		Description: anomaly.Description,
		Labels: map[string]string{
			"metric": anomaly.MetricName,
		},
	}

	am.alerts = append(am.alerts, alert)

	// Notify handlers
	for _, handler := range am.handlers {
		go handler.Handle(alert)
	}
}

// ResolveAlert resolves an alert
func (am *AlertManager) ResolveAlert(alertID string) {
	am.mu.Lock()
	defer am.mu.Unlock()

	for _, alert := range am.alerts {
		if alert.ID == alertID {
			alert.Status = "resolved"
			now := time.Now()
			alert.ResolvedAt = &now
			break
		}
	}
}

// GetActiveAlerts returns active alerts
func (am *AlertManager) GetActiveAlerts() []*Alert {
	am.mu.RLock()
	defer am.mu.RUnlock()

	active := make([]*Alert, 0)
	for _, alert := range am.alerts {
		if alert.Status == "firing" {
			active = append(active, alert)
		}
	}
	return active
}

// RegisterHandler registers an alert handler
func (am *AlertManager) RegisterHandler(handler AlertHandler) {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.handlers = append(am.handlers, handler)
}

// Helper functions

func average(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func standardDeviation(values []float64, mean float64) float64 {
	if len(values) < 2 {
		return 0
	}
	var sumSquares float64
	for _, v := range values {
		diff := v - mean
		sumSquares += diff * diff
	}
	return math.Sqrt(sumSquares / float64(len(values)-1))
}

func percentile(sortedValues []float64, p float64) float64 {
	if len(sortedValues) == 0 {
		return 0
	}
	index := (p / 100) * float64(len(sortedValues)-1)
	lower := int(index)
	upper := lower + 1
	if upper >= len(sortedValues) {
		return sortedValues[len(sortedValues)-1]
	}
	weight := index - float64(lower)
	return sortedValues[lower]*(1-weight) + sortedValues[upper]*weight
}

// ExportPrometheusMetrics exports metrics in Prometheus format
func (sa *SyncAnalytics) ExportPrometheusMetrics() string {
	sa.mu.RLock()
	defer sa.mu.RUnlock()

	var output string

	// Export aggregated metrics
	for period, agg := range sa.aggregates {
		output += fmt.Sprintf("# HELP sync_total_%s Total syncs in %s\n", period, period)
		output += fmt.Sprintf("sync_total_%s %d\n", period, agg.TotalSyncs)
		output += fmt.Sprintf("sync_success_rate_%s %.2f\n", period, agg.SuccessRate)
		output += fmt.Sprintf("sync_latency_avg_%s %.2f\n", period, agg.AvgLatency)
		output += fmt.Sprintf("sync_latency_p95_%s %.2f\n", period, agg.P95Latency)
		output += fmt.Sprintf("sync_conflict_rate_%s %.2f\n", period, agg.ConflictRate)
	}

	return output
}

// ExportJSON exports analytics data as JSON
func (sa *SyncAnalytics) ExportJSON() ([]byte, error) {
	sa.mu.RLock()
	defer sa.mu.RUnlock()

	data := map[string]interface{}{
		"timestamp":   time.Now(),
		"aggregates":  sa.aggregates,
		"time_series": sa.timeSeries,
		"anomalies":   sa.anomalyDetector.GetRecentAnomalies(),
		"alerts":      sa.alertManager.GetActiveAlerts(),
	}

	return json.MarshalIndent(data, "", "  ")
}
