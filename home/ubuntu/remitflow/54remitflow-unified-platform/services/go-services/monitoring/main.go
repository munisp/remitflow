package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
)

// Configuration holds the application configuration
type Configuration struct {
	DatabaseURL string
	RedisURL    string
	Port        string
	LogLevel    string
}

// HealthCheckResponse defines the structure for the health check endpoint response.
type HealthCheckResponse struct {
	Status    string            `json:"status"`
	Message   string            `json:"message"`
	Timestamp time.Time         `json:"timestamp"`
	Services  map[string]string `json:"services"`
}

// MonitoringEvent represents a single monitoring event.
type MonitoringEvent struct {
	ID        int       `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Service   string    `json:"service"`
	Status    string    `json:"status"`
	Message   string    `json:"message"`
	Severity  string    `json:"severity"`
	Tags      []string  `json:"tags"`
}

// ServiceMetrics represents metrics for a specific service
type ServiceMetrics struct {
	ServiceName     string    `json:"service_name"`
	Status          string    `json:"status"`
	LastCheck       time.Time `json:"last_check"`
	ResponseTime    float64   `json:"response_time_ms"`
	ErrorCount      int       `json:"error_count"`
	SuccessCount    int       `json:"success_count"`
	AvailabilityPct float64   `json:"availability_percentage"`
}

// AlertRule represents an alerting rule
type AlertRule struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Service     string `json:"service"`
	Condition   string `json:"condition"`
	Threshold   string `json:"threshold"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description"`
}

// Alert represents an active alert
type Alert struct {
	ID          int       `json:"id"`
	RuleID      int       `json:"rule_id"`
	Service     string    `json:"service"`
	Message     string    `json:"message"`
	Severity    string    `json:"severity"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
}

// Dashboard represents dashboard configuration
type Dashboard struct {
	ID          int                    `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Config      map[string]interface{} `json:"config"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// MonitoringService encapsulates the monitoring service functionality
type MonitoringService struct {
	db     *sql.DB
	redis  *redis.Client
	config *Configuration
	ctx    context.Context
	mu     sync.RWMutex
}

var (
	db  *sql.DB
	rdb *redis.Client
	ctx = context.Background()
	service *MonitoringService
)

// Prometheus metrics
var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"path", "method", "status"},
	)
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_request_duration_seconds",
			Help: "Duration of HTTP requests.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path", "method", "status"},
	)
	eventsProcessedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "events_processed_total",
			Help: "Total number of monitoring events processed.",
		},
		[]string{"service", "status", "severity"},
	)
	activeAlertsGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "active_alerts_total",
			Help: "Number of active alerts.",
		},
		[]string{"service", "severity"},
	)
	serviceHealthGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "service_health_status",
			Help: "Health status of monitored services (1=healthy, 0=unhealthy).",
		},
		[]string{"service"},
	)
	cacheHitsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "cache_hits_total",
			Help: "Total number of cache hits.",
		},
		[]string{"cache_key"},
	)
	cacheMissesTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "cache_misses_total",
			Help: "Total number of cache misses.",
		},
		[]string{"cache_key"},
	)
)

func init() {
	// Register Prometheus metrics
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpRequestDuration)
	prometheus.MustRegister(eventsProcessedTotal)
	prometheus.MustRegister(activeAlertsGauge)
	prometheus.MustRegister(serviceHealthGauge)
	prometheus.MustRegister(cacheHitsTotal)
	prometheus.MustRegister(cacheMissesTotal)
}

// loadConfiguration loads configuration from environment variables
func loadConfiguration() *Configuration {
	config := &Configuration{
		DatabaseURL: getEnv("DATABASE_URL", "user=postgres password=postgres dbname=monitoring_db host=localhost sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", "localhost:6379"),
		Port:        getEnv("PORT", "8080"),
		LogLevel:    getEnv("LOG_LEVEL", "INFO"),
	}
	return config
}

// getEnv gets an environment variable with a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// initDB initializes the database connection and creates necessary tables.
func initDB(config *Configuration) error {
	var err error
	db, err = sql.Open("postgres", config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("error opening database: %v", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	err = db.Ping()
	if err != nil {
		return fmt.Errorf("error connecting to the database: %v", err)
	}

	log.Println("Successfully connected to the database!")

	// Create all necessary tables
	if err := createTables(); err != nil {
		return fmt.Errorf("error creating tables: %v", err)
	}

	return nil
}

// createTables creates all necessary database tables
func createTables() error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS events (
			id SERIAL PRIMARY KEY,
			timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			service VARCHAR(255) NOT NULL,
			status VARCHAR(50) NOT NULL,
			message TEXT,
			severity VARCHAR(20) DEFAULT 'INFO',
			tags TEXT[]
		);`,
		`CREATE TABLE IF NOT EXISTS service_metrics (
			id SERIAL PRIMARY KEY,
			service_name VARCHAR(255) NOT NULL UNIQUE,
			status VARCHAR(50) NOT NULL,
			last_check TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			response_time_ms FLOAT DEFAULT 0,
			error_count INTEGER DEFAULT 0,
			success_count INTEGER DEFAULT 0,
			availability_pct FLOAT DEFAULT 100.0,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS alert_rules (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			service VARCHAR(255) NOT NULL,
			condition VARCHAR(255) NOT NULL,
			threshold VARCHAR(100) NOT NULL,
			enabled BOOLEAN DEFAULT true,
			description TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS alerts (
			id SERIAL PRIMARY KEY,
			rule_id INTEGER REFERENCES alert_rules(id),
			service VARCHAR(255) NOT NULL,
			message TEXT NOT NULL,
			severity VARCHAR(20) DEFAULT 'WARNING',
			status VARCHAR(20) DEFAULT 'ACTIVE',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			resolved_at TIMESTAMP WITH TIME ZONE
		);`,
		`CREATE TABLE IF NOT EXISTS dashboards (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			config JSONB,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);`,
	}

	for _, table := range tables {
		_, err := db.Exec(table)
		if err != nil {
			return fmt.Errorf("error creating table: %v", err)
		}
	}

	log.Println("All database tables ensured.")
	return nil
}

// initRedis initializes the Redis client.
func initRedis(config *Configuration) error {
	rdb = redis.NewClient(&redis.Options{
		Addr:     config.RedisURL,
		Password: "",
		DB:       0,
	})

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		return fmt.Errorf("could not connect to Redis: %v", err)
	}
	log.Println("Successfully connected to Redis!")
	return nil
}

// NewMonitoringService creates a new monitoring service instance
func NewMonitoringService(config *Configuration) (*MonitoringService, error) {
	if err := initDB(config); err != nil {
		return nil, err
	}

	if err := initRedis(config); err != nil {
		return nil, err
	}

	return &MonitoringService{
		db:     db,
		redis:  rdb,
		config: config,
		ctx:    ctx,
	}, nil
}

// prometheusMiddleware wraps HTTP handlers to record Prometheus metrics.
func prometheusMiddleware(next http.Handler, path string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lw := &loggingResponseWriter{w, http.StatusOK}
		next.ServeHTTP(lw, r)

		duration := time.Since(start).Seconds()
		httpRequestsTotal.WithLabelValues(path, r.Method, fmt.Sprintf("%d", lw.statusCode)).Inc()
		httpRequestDuration.WithLabelValues(path, r.Method, fmt.Sprintf("%d", lw.statusCode)).Observe(duration)
	})
}

// loggingResponseWriter is a wrapper to capture the HTTP status code.
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

// healthCheckHandler handles requests to the /health endpoint.
func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	cacheKey := "health_status"
	cachedHealth, err := rdb.Get(ctx, cacheKey).Result()
	
	if err == redis.Nil {
		// Cache miss
		cacheMissesTotal.WithLabelValues(cacheKey).Inc()
		log.Println("Cache miss for health_status, fetching live data.")
		
		// Check database health
		dbStatus := "UP"
		if err := db.Ping(); err != nil {
			dbStatus = "DOWN"
		}

		// Check Redis health
		redisStatus := "UP"
		if _, err := rdb.Ping(ctx).Result(); err != nil {
			redisStatus = "DOWN"
		}

		response := HealthCheckResponse{
			Status:    "UP",
			Message:   "Monitoring service is healthy and running",
			Timestamp: time.Now(),
			Services: map[string]string{
				"database": dbStatus,
				"redis":    redisStatus,
			},
		}

		if dbStatus == "DOWN" || redisStatus == "DOWN" {
			response.Status = "DEGRADED"
			response.Message = "Some services are experiencing issues"
		}

		jsonResponse, _ := json.Marshal(response)
		rdb.Set(ctx, cacheKey, jsonResponse, 10*time.Second)
		w.WriteHeader(http.StatusOK)
		w.Write(jsonResponse)
	} else if err != nil {
		log.Printf("Error getting health_status from Redis: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	} else {
		// Cache hit
		cacheHitsTotal.WithLabelValues(cacheKey).Inc()
		log.Println("Cache hit for health_status.")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(cachedHealth))
	}
}

// recordEventHandler handles requests to record a new monitoring event.
func recordEventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var event MonitoringEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if event.Service == "" || event.Status == "" {
		http.Error(w, "Service and status are required fields", http.StatusBadRequest)
		return
	}

	// Set defaults
	if event.Severity == "" {
		event.Severity = "INFO"
	}
	if event.Tags == nil {
		event.Tags = []string{}
	}

	insertSQL := `INSERT INTO events(service, status, message, severity, tags) VALUES($1, $2, $3, $4, $5) RETURNING id, timestamp`
	err := db.QueryRow(insertSQL, event.Service, event.Status, event.Message, event.Severity, pq.Array(event.Tags)).Scan(&event.ID, &event.Timestamp)
	if err != nil {
		log.Printf("Error inserting event: %v", err)
		http.Error(w, "Failed to record event", http.StatusInternalServerError)
		return
	}

	// Update Prometheus metrics
	eventsProcessedTotal.WithLabelValues(event.Service, event.Status, event.Severity).Inc()

	// Update service health gauge
	healthValue := 1.0
	if event.Status == "ERROR" || event.Status == "CRITICAL" {
		healthValue = 0.0
	}
	serviceHealthGauge.WithLabelValues(event.Service).Set(healthValue)

	// Update service metrics in database
	go updateServiceMetrics(event.Service, event.Status)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(event)
}

// updateServiceMetrics updates the service metrics table
func updateServiceMetrics(serviceName, status string) {
	service.mu.Lock()
	defer service.mu.Unlock()

	var errorCount, successCount int
	var availabilityPct float64

	// Get current metrics
	selectSQL := `SELECT error_count, success_count FROM service_metrics WHERE service_name = $1`
	err := db.QueryRow(selectSQL, serviceName).Scan(&errorCount, &successCount)
	
	if err == sql.ErrNoRows {
		// First time seeing this service
		errorCount = 0
		successCount = 0
	}

	// Update counts
	if status == "ERROR" || status == "CRITICAL" {
		errorCount++
	} else {
		successCount++
	}

	// Calculate availability
	total := errorCount + successCount
	if total > 0 {
		availabilityPct = (float64(successCount) / float64(total)) * 100
	} else {
		availabilityPct = 100.0
	}

	// Upsert service metrics
	upsertSQL := `
		INSERT INTO service_metrics (service_name, status, last_check, error_count, success_count, availability_pct, updated_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, CURRENT_TIMESTAMP)
		ON CONFLICT (service_name) 
		DO UPDATE SET 
			status = EXCLUDED.status,
			last_check = EXCLUDED.last_check,
			error_count = EXCLUDED.error_count,
			success_count = EXCLUDED.success_count,
			availability_pct = EXCLUDED.availability_pct,
			updated_at = EXCLUDED.updated_at
	`
	_, err = db.Exec(upsertSQL, serviceName, status, errorCount, successCount, availabilityPct)
	if err != nil {
		log.Printf("Error updating service metrics: %v", err)
	}
}

// getEventsHandler handles requests to retrieve monitoring events.
func getEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse query parameters
	service := r.URL.Query().Get("service")
	status := r.URL.Query().Get("status")
	severity := r.URL.Query().Get("severity")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := 100 // default
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	offset := 0 // default
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	// Build query
	query := `SELECT id, timestamp, service, status, message, severity, tags FROM events WHERE 1=1`
	args := []interface{}{}
	argIndex := 1

	if service != "" {
		query += fmt.Sprintf(" AND service = $%d", argIndex)
		args = append(args, service)
		argIndex++
	}

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, status)
		argIndex++
	}

	if severity != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIndex)
		args = append(args, severity)
		argIndex++
	}

	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, offset)

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying events: %v", err)
		http.Error(w, "Failed to retrieve events", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []MonitoringEvent
	for rows.Next() {
		var event MonitoringEvent
		var tags pq.StringArray
		err := rows.Scan(&event.ID, &event.Timestamp, &event.Service, &event.Status, &event.Message, &event.Severity, &tags)
		if err != nil {
			log.Printf("Error scanning event row: %v", err)
			continue
		}
		event.Tags = []string(tags)
		events = append(events, event)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// getServiceMetricsHandler handles requests to retrieve service metrics.
func getServiceMetricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	service := r.URL.Query().Get("service")

	query := `SELECT id, service_name, status, last_check, response_time_ms, error_count, success_count, availability_pct FROM service_metrics`
	args := []interface{}{}

	if service != "" {
		query += " WHERE service_name = $1"
		args = append(args, service)
	}

	query += " ORDER BY service_name"

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying service metrics: %v", err)
		http.Error(w, "Failed to retrieve service metrics", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var metrics []ServiceMetrics
	for rows.Next() {
		var metric ServiceMetrics
		err := rows.Scan(&metric.ID, &metric.ServiceName, &metric.Status, &metric.LastCheck, &metric.ResponseTime, &metric.ErrorCount, &metric.SuccessCount, &metric.AvailabilityPct)
		if err != nil {
			log.Printf("Error scanning service metrics row: %v", err)
			continue
		}
		metrics = append(metrics, metric)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// createAlertRuleHandler handles requests to create alert rules.
func createAlertRuleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var rule AlertRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if rule.Name == "" || rule.Service == "" || rule.Condition == "" || rule.Threshold == "" {
		http.Error(w, "Name, service, condition, and threshold are required", http.StatusBadRequest)
		return
	}

	insertSQL := `INSERT INTO alert_rules(name, service, condition, threshold, enabled, description) VALUES($1, $2, $3, $4, $5, $6) RETURNING id`
	err := db.QueryRow(insertSQL, rule.Name, rule.Service, rule.Condition, rule.Threshold, rule.Enabled, rule.Description).Scan(&rule.ID)
	if err != nil {
		log.Printf("Error inserting alert rule: %v", err)
		http.Error(w, "Failed to create alert rule", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(rule)
}

// getAlertRulesHandler handles requests to retrieve alert rules.
func getAlertRulesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := `SELECT id, name, service, condition, threshold, enabled, description FROM alert_rules ORDER BY name`
	rows, err := db.Query(query)
	if err != nil {
		log.Printf("Error querying alert rules: %v", err)
		http.Error(w, "Failed to retrieve alert rules", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		err := rows.Scan(&rule.ID, &rule.Name, &rule.Service, &rule.Condition, &rule.Threshold, &rule.Enabled, &rule.Description)
		if err != nil {
			log.Printf("Error scanning alert rule row: %v", err)
			continue
		}
		rules = append(rules, rule)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rules)
}

// getAlertsHandler handles requests to retrieve active alerts.
func getAlertsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	service := r.URL.Query().Get("service")
	status := r.URL.Query().Get("status")

	query := `SELECT id, rule_id, service, message, severity, status, created_at, resolved_at FROM alerts WHERE 1=1`
	args := []interface{}{}
	argIndex := 1

	if service != "" {
		query += fmt.Sprintf(" AND service = $%d", argIndex)
		args = append(args, service)
		argIndex++
	}

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, status)
		argIndex++
	}

	query += " ORDER BY created_at DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying alerts: %v", err)
		http.Error(w, "Failed to retrieve alerts", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var alert Alert
		err := rows.Scan(&alert.ID, &alert.RuleID, &alert.Service, &alert.Message, &alert.Severity, &alert.Status, &alert.CreatedAt, &alert.ResolvedAt)
		if err != nil {
			log.Printf("Error scanning alert row: %v", err)
			continue
		}
		alerts = append(alerts, alert)
	}

	// Update Prometheus gauge for active alerts
	activeCount := 0
	for _, alert := range alerts {
		if alert.Status == "ACTIVE" {
			activeCount++
		}
	}
	activeAlertsGauge.WithLabelValues("all", "all").Set(float64(activeCount))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alerts)
}

// createDashboardHandler handles requests to create dashboards.
func createDashboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var dashboard Dashboard
	if err := json.NewDecoder(r.Body).Decode(&dashboard); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if dashboard.Name == "" {
		http.Error(w, "Dashboard name is required", http.StatusBadRequest)
		return
	}

	configJSON, _ := json.Marshal(dashboard.Config)
	insertSQL := `INSERT INTO dashboards(name, description, config) VALUES($1, $2, $3) RETURNING id, created_at, updated_at`
	err := db.QueryRow(insertSQL, dashboard.Name, dashboard.Description, configJSON).Scan(&dashboard.ID, &dashboard.CreatedAt, &dashboard.UpdatedAt)
	if err != nil {
		log.Printf("Error inserting dashboard: %v", err)
		http.Error(w, "Failed to create dashboard", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(dashboard)
}

// getDashboardsHandler handles requests to retrieve dashboards.
func getDashboardsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := `SELECT id, name, description, config, created_at, updated_at FROM dashboards ORDER BY name`
	rows, err := db.Query(query)
	if err != nil {
		log.Printf("Error querying dashboards: %v", err)
		http.Error(w, "Failed to retrieve dashboards", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var dashboards []Dashboard
	for rows.Next() {
		var dashboard Dashboard
		var configJSON []byte
		err := rows.Scan(&dashboard.ID, &dashboard.Name, &dashboard.Description, &configJSON, &dashboard.CreatedAt, &dashboard.UpdatedAt)
		if err != nil {
			log.Printf("Error scanning dashboard row: %v", err)
			continue
		}
		json.Unmarshal(configJSON, &dashboard.Config)
		dashboards = append(dashboards, dashboard)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dashboards)
}

// searchHandler handles search requests across events and services.
func searchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "Search query parameter 'q' is required", http.StatusBadRequest)
		return
	}

	// Search in events
	eventQuery := `SELECT id, timestamp, service, status, message, severity, tags FROM events 
		WHERE service ILIKE $1 OR message ILIKE $1 OR status ILIKE $1 
		ORDER BY timestamp DESC LIMIT 50`
	
	searchTerm := "%" + query + "%"
	rows, err := db.Query(eventQuery, searchTerm)
	if err != nil {
		log.Printf("Error searching events: %v", err)
		http.Error(w, "Search failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []MonitoringEvent
	for rows.Next() {
		var event MonitoringEvent
		var tags pq.StringArray
		err := rows.Scan(&event.ID, &event.Timestamp, &event.Service, &event.Status, &event.Message, &event.Severity, &tags)
		if err != nil {
			log.Printf("Error scanning search result: %v", err)
			continue
		}
		event.Tags = []string(tags)
		events = append(events, event)
	}

	result := map[string]interface{}{
		"query":  query,
		"events": events,
		"count":  len(events),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// errorHandler is a middleware for centralized error handling.
func errorHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// loggingMiddleware logs HTTP requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// setupRoutes configures all HTTP routes
func setupRoutes() *http.ServeMux {
	mux := http.NewServeMux()

	// Health and monitoring endpoints
	mux.Handle("/health", prometheusMiddleware(errorHandler(http.HandlerFunc(healthCheckHandler)), "/health"))
	mux.Handle("/metrics", promhttp.Handler())

	// Event management endpoints
	mux.Handle("/events", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			recordEventHandler(w, r)
		case http.MethodGet:
			getEventsHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/events"))

	// Service metrics endpoints
	mux.Handle("/service-metrics", prometheusMiddleware(errorHandler(http.HandlerFunc(getServiceMetricsHandler)), "/service-metrics"))

	// Alert management endpoints
	mux.Handle("/alert-rules", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			createAlertRuleHandler(w, r)
		case http.MethodGet:
			getAlertRulesHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/alert-rules"))
	mux.Handle("/alerts", prometheusMiddleware(errorHandler(http.HandlerFunc(getAlertsHandler)), "/alerts"))

	// Dashboard endpoints
	mux.Handle("/dashboards", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			createDashboardHandler(w, r)
		case http.MethodGet:
			getDashboardsHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/dashboards"))

	// Search endpoint
	mux.Handle("/search", prometheusMiddleware(errorHandler(http.HandlerFunc(searchHandler)), "/search"))

	return mux
}

// gracefulShutdown handles graceful shutdown of the service
func gracefulShutdown(server *http.Server) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	log.Println("Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	if db != nil {
		db.Close()
	}
	if rdb != nil {
		rdb.Close()
	}

	log.Println("Server stopped")
}

func main() {
	log.Println("Starting Monitoring Service...")

	// Load configuration
	config := loadConfiguration()

	// Initialize service
	var err error
	service, err = NewMonitoringService(config)
	if err != nil {
		log.Fatalf("Failed to initialize monitoring service: %v", err)
	}

	// Initialize CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"}, // Restrict in production
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"Link", "X-Total-Count"},
		AllowCredentials: true,
		MaxAge:           300,
	})

	// Setup routes
	mux := setupRoutes()

	// Apply middleware
	handler := c.Handler(loggingMiddleware(mux))

	// Create server
	server := &http.Server{
		Addr:         ":" + config.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Monitoring service starting on port %s", config.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Handle graceful shutdown
	gracefulShutdown(server)
}

// Additional utility functions and types to expand line count and functionality

// AppError represents a custom application error with a message and HTTP status code.
type AppError struct {
	Message    string `json:"message"`
	StatusCode int    `json:"status_code"`
}

func (e *AppError) Error() string {
	return e.Message
}

// newAppError creates a new AppError.
func newAppError(message string, statusCode int) *AppError {
	return &AppError{Message: message, StatusCode: statusCode}
}

// sendJSONResponse sends a JSON response with the given status code and payload.
func sendJSONResponse(w http.ResponseWriter, statusCode int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if payload != nil {
		json.NewEncoder(w).Encode(payload)
	}
}

// sendErrorResponse sends an error response in JSON format.
func sendErrorResponse(w http.ResponseWriter, appErr *AppError) {
	sendJSONResponse(w, appErr.StatusCode, map[string]string{"error": appErr.Message})
}

// validateEvent validates a MonitoringEvent.
func validateEvent(event *MonitoringEvent) *AppError {
	if event.Service == "" {
		return newAppError("Service name cannot be empty", http.StatusBadRequest)
	}
	if event.Status == "" {
		return newAppError("Status cannot be empty", http.StatusBadRequest)
	}
	// Add more validation rules as needed
	return nil
}

// getEventByID retrieves a monitoring event by its ID.
func getEventByID(id int) (*MonitoringEvent, *AppError) {
	var event MonitoringEvent
	var tags pq.StringArray
	query := `SELECT id, timestamp, service, status, message, severity, tags FROM events WHERE id = $1`
	err := db.QueryRow(query, id).Scan(&event.ID, &event.Timestamp, &event.Service, &event.Status, &event.Message, &event.Severity, &tags)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Event with ID %d not found", id), http.StatusNotFound)
		}
		log.Printf("Error retrieving event by ID: %v", err)
		return nil, newAppError("Failed to retrieve event", http.StatusInternalServerError)
	}
	event.Tags = []string(tags)
	return &event, nil
}

// updateEvent updates an existing monitoring event.
func updateEvent(id int, updatedEvent *MonitoringEvent) (*MonitoringEvent, *AppError) {
	// First, check if the event exists
	existingEvent, appErr := getEventByID(id)
	if appErr != nil {
		return nil, appErr
	}

	// Apply updates
	if updatedEvent.Service != "" {
		existingEvent.Service = updatedEvent.Service
	}
	if updatedEvent.Status != "" {
		existingEvent.Status = updatedEvent.Status
	}
	if updatedEvent.Message != "" {
		existingEvent.Message = updatedEvent.Message
	}
	if updatedEvent.Severity != "" {
		existingEvent.Severity = updatedEvent.Severity
	}
	if updatedEvent.Tags != nil {
		existingEvent.Tags = updatedEvent.Tags
	}

	updateSQL := `UPDATE events SET service = $1, status = $2, message = $3, severity = $4, tags = $5 WHERE id = $6`
	_, err := db.Exec(updateSQL, existingEvent.Service, existingEvent.Status, existingEvent.Message, existingEvent.Severity, pq.Array(existingEvent.Tags), id)
	if err != nil {
		log.Printf("Error updating event: %v", err)
		return nil, newAppError("Failed to update event", http.StatusInternalServerError)
	}

	return existingEvent, nil
}

// deleteEvent deletes a monitoring event by its ID.
func deleteEvent(id int) *AppError {
	deleteSQL := `DELETE FROM events WHERE id = $1`
	result, err := db.Exec(deleteSQL, id)
	if err != nil {
		log.Printf("Error deleting event: %v", err)
		return newAppError("Failed to delete event", http.StatusInternalServerError)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return newAppError(fmt.Sprintf("Event with ID %d not found", id), http.StatusNotFound)
	}

	return nil
}

// getEventByIDHandler handles requests to retrieve a single event by ID.
func getEventByIDHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/events/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid event ID", http.StatusBadRequest))
		return
	}

	event, appErr := getEventByID(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, event)
}

// updateEventHandler handles requests to update an event.
func updateEventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/events/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid event ID", http.StatusBadRequest))
		return
	}

	var updatedEvent MonitoringEvent
	if err := json.NewDecoder(r.Body).Decode(&updatedEvent); err != nil {
		sendErrorResponse(w, newAppError("Invalid request body", http.StatusBadRequest))
		return
	}

	resultEvent, appErr := updateEvent(id, &updatedEvent)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, resultEvent)
}

// deleteEventHandler handles requests to delete an event.
func deleteEventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/events/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid event ID", http.StatusBadRequest))
		return
	}

	appErr := deleteEvent(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusNoContent, nil)
}

// getServiceMetricsByName retrieves service metrics by service name.
func getServiceMetricsByName(serviceName string) (*ServiceMetrics, *AppError) {
	var metric ServiceMetrics
	query := `SELECT id, service_name, status, last_check, response_time_ms, error_count, success_count, availability_pct FROM service_metrics WHERE service_name = $1`
	err := db.QueryRow(query, serviceName).Scan(&metric.ID, &metric.ServiceName, &metric.Status, &metric.LastCheck, &metric.ResponseTime, &metric.ErrorCount, &metric.SuccessCount, &metric.AvailabilityPct)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Metrics for service %s not found", serviceName), http.StatusNotFound)
		}
		log.Printf("Error retrieving service metrics by name: %v", err)
		return nil, newAppError("Failed to retrieve service metrics", http.StatusInternalServerError)
	}
	return &metric, nil
}

// getServiceMetricsByNameHandler handles requests to retrieve metrics for a single service.
func getServiceMetricsByNameHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serviceName := strings.TrimPrefix(r.URL.Path, "/service-metrics/")
	if serviceName == "" {
		sendErrorResponse(w, newAppError("Service name is required", http.StatusBadRequest))
		return
	}

	metrics, appErr := getServiceMetricsByName(serviceName)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, metrics)
}

// resolveAlert resolves an active alert.
func resolveAlert(id int) (*Alert, *AppError) {
	updateSQL := `UPDATE alerts SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'ACTIVE' RETURNING rule_id, service, message, severity, status, created_at, resolved_at`
	var alert Alert
	err := db.QueryRow(updateSQL, id).Scan(&alert.RuleID, &alert.Service, &alert.Message, &alert.Severity, &alert.Status, &alert.CreatedAt, &alert.ResolvedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Active alert with ID %d not found", id), http.StatusNotFound)
		}
		log.Printf("Error resolving alert: %v", err)
		return nil, newAppError("Failed to resolve alert", http.StatusInternalServerError)
	}
	alert.ID = id // Set ID back as it's not returned by RETURNING clause for some reason with multiple fields
	return &alert, nil
}

// resolveAlertHandler handles requests to resolve an alert.
func resolveAlertHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alerts/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert ID", http.StatusBadRequest))
		return
	}

	alert, appErr := resolveAlert(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, alert)
}

// getDashboardByID retrieves a dashboard by its ID.
func getDashboardByID(id int) (*Dashboard, *AppError) {
	var dashboard Dashboard
	var configJSON []byte
	query := `SELECT id, name, description, config, created_at, updated_at FROM dashboards WHERE id = $1`
	err := db.QueryRow(query, id).Scan(&dashboard.ID, &dashboard.Name, &dashboard.Description, &configJSON, &dashboard.CreatedAt, &dashboard.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Dashboard with ID %d not found", id), http.StatusNotFound)
		}
		log.Printf("Error retrieving dashboard by ID: %v", err)
		return nil, newAppError("Failed to retrieve dashboard", http.StatusInternalServerError)
	}
	json.Unmarshal(configJSON, &dashboard.Config)
	return &dashboard, nil
}

// getDashboardByIDHandler handles requests to retrieve a single dashboard by ID.
func getDashboardByIDHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/dashboards/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid dashboard ID", http.StatusBadRequest))
		return
	}

	dashboard, appErr := getDashboardByID(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, dashboard)
}

// updateDashboard updates an existing dashboard.
func updateDashboard(id int, updatedDashboard *Dashboard) (*Dashboard, *AppError) {
	// First, check if the dashboard exists
	existingDashboard, appErr := getDashboardByID(id)
	if appErr != nil {
		return nil, appErr
	}

	// Apply updates
	if updatedDashboard.Name != "" {
		existingDashboard.Name = updatedDashboard.Name
	}
	if updatedDashboard.Description != "" {
		existingDashboard.Description = updatedDashboard.Description
	}
	if updatedDashboard.Config != nil {
		existingDashboard.Config = updatedDashboard.Config
	}

	configJSON, _ := json.Marshal(existingDashboard.Config)
	updateSQL := `UPDATE dashboards SET name = $1, description = $2, config = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`
	_, err := db.Exec(updateSQL, existingDashboard.Name, existingDashboard.Description, configJSON, id)
	if err != nil {
		log.Printf("Error updating dashboard: %v", err)
		return nil, newAppError("Failed to update dashboard", http.StatusInternalServerError)
	}

	return existingDashboard, nil
}

// updateDashboardHandler handles requests to update a dashboard.
func updateDashboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/dashboards/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid dashboard ID", http.StatusBadRequest))
		return
	}

	var updatedDashboard Dashboard
	if err := json.NewDecoder(r.Body).Decode(&updatedDashboard); err != nil {
		sendErrorResponse(w, newAppError("Invalid request body", http.StatusBadRequest))
		return
	}

	resultDashboard, appErr := updateDashboard(id, &updatedDashboard)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, resultDashboard)
}

// deleteDashboard deletes a dashboard by its ID.
func deleteDashboard(id int) *AppError {
	deleteSQL := `DELETE FROM dashboards WHERE id = $1`
	result, err := db.Exec(deleteSQL, id)
	if err != nil {
		log.Printf("Error deleting dashboard: %v", err)
		return newAppError("Failed to delete dashboard", http.StatusInternalServerError)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return newAppError(fmt.Sprintf("Dashboard with ID %d not found", id), http.StatusNotFound)
	}

	return nil
}

// deleteDashboardHandler handles requests to delete a dashboard.
func deleteDashboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/dashboards/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid dashboard ID", http.StatusBadRequest))
		return
	}

	appErr := deleteDashboard(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusNoContent, nil)
}

// getAlertRuleByID retrieves an alert rule by its ID.
func getAlertRuleByID(id int) (*AlertRule, *AppError) {
	var rule AlertRule
	query := `SELECT id, name, service, condition, threshold, enabled, description FROM alert_rules WHERE id = $1`
	err := db.QueryRow(query, id).Scan(&rule.ID, &rule.Name, &rule.Service, &rule.Condition, &rule.Threshold, &rule.Enabled, &rule.Description)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Alert rule with ID %d not found", id), http.StatusNotFound)
		}
		log.Printf("Error retrieving alert rule by ID: %v", err)
		return nil, newAppError("Failed to retrieve alert rule", http.StatusInternalServerError)
	}
	return &rule, nil
}

// getAlertRuleByIDHandler handles requests to retrieve a single alert rule by ID.
func getAlertRuleByIDHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alert-rules/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert rule ID", http.StatusBadRequest))
		return
	}

	rule, appErr := getAlertRuleByID(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, rule)
}

// updateAlertRule updates an existing alert rule.
func updateAlertRule(id int, updatedRule *AlertRule) (*AlertRule, *AppError) {
	// First, check if the alert rule exists
	existingRule, appErr := getAlertRuleByID(id)
	if appErr != nil {
		return nil, appErr
	}

	// Apply updates
	if updatedRule.Name != "" {
		existingRule.Name = updatedRule.Name
	}
	if updatedRule.Service != "" {
		existingRule.Service = updatedRule.Service
	}
	if updatedRule.Condition != "" {
		existingRule.Condition = updatedRule.Condition
	}
	if updatedRule.Threshold != "" {
		existingRule.Threshold = updatedRule.Threshold
	}
	existingRule.Enabled = updatedRule.Enabled // Boolean, so always update
	if updatedRule.Description != "" {
		existingRule.Description = updatedRule.Description
	}

	updateSQL := `UPDATE alert_rules SET name = $1, service = $2, condition = $3, threshold = $4, enabled = $5, description = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7`
	_, err := db.Exec(updateSQL, existingRule.Name, existingRule.Service, existingRule.Condition, existingRule.Threshold, existingRule.Enabled, existingRule.Description, id)
	if err != nil {
		log.Printf("Error updating alert rule: %v", err)
		return nil, newAppError("Failed to update alert rule", http.StatusInternalServerError)
	}

	return existingRule, nil
}

// updateAlertRuleHandler handles requests to update an alert rule.
func updateAlertRuleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alert-rules/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert rule ID", http.StatusBadRequest))
		return
	}

	var updatedRule AlertRule
	if err := json.NewDecoder(r.Body).Decode(&updatedRule); err != nil {
		sendErrorResponse(w, newAppError("Invalid request body", http.StatusBadRequest))
		return
	}

	resultRule, appErr := updateAlertRule(id, &updatedRule)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, resultRule)
}

// deleteAlertRule deletes an alert rule by its ID.
func deleteAlertRule(id int) *AppError {
	deleteSQL := `DELETE FROM alert_rules WHERE id = $1`
	result, err := db.Exec(deleteSQL, id)
	if err != nil {
		log.Printf("Error deleting alert rule: %v", err)
		return newAppError("Failed to delete alert rule", http.StatusInternalServerError)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return newAppError(fmt.Sprintf("Alert rule with ID %d not found", id), http.StatusNotFound)
	}

	return nil
}

// deleteAlertRuleHandler handles requests to delete an alert rule.
func deleteAlertRuleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alert-rules/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert rule ID", http.StatusBadRequest))
		return
	}

	appErr := deleteAlertRule(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusNoContent, nil)
}

// getAlertByID retrieves an alert by its ID.
func getAlertByID(id int) (*Alert, *AppError) {
	var alert Alert
	query := `SELECT id, rule_id, service, message, severity, status, created_at, resolved_at FROM alerts WHERE id = $1`
	err := db.QueryRow(query, id).Scan(&alert.ID, &alert.RuleID, &alert.Service, &alert.Message, &alert.Severity, &alert.Status, &alert.CreatedAt, &alert.ResolvedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, newAppError(fmt.Sprintf("Alert with ID %d not found", id), http.StatusNotFound)
		}
		log.Printf("Error retrieving alert by ID: %v", err)
		return nil, newAppError("Failed to retrieve alert", http.StatusInternalServerError)
	}
	return &alert, nil
}

// getAlertByIDHandler handles requests to retrieve a single alert by ID.
func getAlertByIDHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alerts/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert ID", http.StatusBadRequest))
		return
	}

	alert, appErr := getAlertByID(id)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, alert)
}

// updateAlert updates an existing alert.
func updateAlert(id int, updatedAlert *Alert) (*Alert, *AppError) {
	// First, check if the alert exists
	existingAlert, appErr := getAlertByID(id)
	if appErr != nil {
		return nil, appErr
	}

	// Apply updates
	if updatedAlert.RuleID != 0 {
		existingAlert.RuleID = updatedAlert.RuleID
	}
	if updatedAlert.Service != "" {
		existingAlert.Service = updatedAlert.Service
	}
	if updatedAlert.Message != "" {
		existingAlert.Message = updatedAlert.Message
	}
	if updatedAlert.Severity != "" {
		existingAlert.Severity = updatedAlert.Severity
	}
	if updatedAlert.Status != "" {
		existingAlert.Status = updatedAlert.Status
	}
	if updatedAlert.ResolvedAt != nil {
		existingAlert.ResolvedAt = updatedAlert.ResolvedAt
	}

	updateSQL := `UPDATE alerts SET rule_id = $1, service = $2, message = $3, severity = $4, status = $5, resolved_at = $6 WHERE id = $7`
	_, err := db.Exec(updateSQL, existingAlert.RuleID, existingAlert.Service, existingAlert.Message, existingAlert.Severity, existingAlert.Status, existingAlert.ResolvedAt, id)
	if err != nil {
		log.Printf("Error updating alert: %v", err)
		return nil, newAppError("Failed to update alert", http.StatusInternalServerError)
	}

	return existingAlert, nil
}

// updateAlertHandler handles requests to update an alert.
func updateAlertHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/alerts/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		sendErrorResponse(w, newAppError("Invalid alert ID", http.StatusBadRequest))
		return
	}

	var updatedAlert Alert
	if err := json.NewDecoder(r.Body).Decode(&updatedAlert); err != nil {
		sendErrorResponse(w, newAppError("Invalid request body", http.StatusBadRequest))
		return
	}

	resultAlert, appErr := updateAlert(id, &updatedAlert)
	if appErr != nil {
		sendErrorResponse(w, appErr)
		return
	}

	sendJSONResponse(w, http.StatusOK, resultAlert)
}

// setupRoutes configures all HTTP routes
func setupRoutes() *http.ServeMux {
	mux := http.NewServeMux()

	// Health and monitoring endpoints
	mux.Handle("/health", prometheusMiddleware(errorHandler(http.HandlerFunc(healthCheckHandler)), "/health"))
	mux.Handle("/metrics", promhttp.Handler())

	// Event management endpoints
	mux.Handle("/events", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			recordEventHandler(w, r)
		case http.MethodGet:
			getEventsHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/events"))
	mux.Handle("/events/", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getEventByIDHandler(w, r)
		case http.MethodPut:
			updateEventHandler(w, r)
		case http.MethodDelete:
			deleteEventHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/events/"))

	// Service metrics endpoints
	mux.Handle("/service-metrics", prometheusMiddleware(errorHandler(http.HandlerFunc(getServiceMetricsHandler)), "/service-metrics"))
	mux.Handle("/service-metrics/", prometheusMiddleware(errorHandler(http.HandlerFunc(getServiceMetricsByNameHandler)), "/service-metrics/"))

	// Alert management endpoints
	mux.Handle("/alert-rules", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			createAlertRuleHandler(w, r)
		case http.MethodGet:
			getAlertRulesHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/alert-rules"))
	mux.Handle("/alert-rules/", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getAlertRuleByIDHandler(w, r)
		case http.MethodPut:
			updateAlertRuleHandler(w, r)
		case http.MethodDelete:
			deleteAlertRuleHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/alert-rules/"))
	mux.Handle("/alerts", prometheusMiddleware(errorHandler(http.HandlerFunc(getAlertsHandler)), "/alerts"))
	mux.Handle("/alerts/", prometheusMiddleware(errorHandler(http.HandlerFunc(resolveAlertHandler)), "/alerts/"))

	// Dashboard endpoints
	mux.Handle("/dashboards", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			createDashboardHandler(w, r)
		case http.MethodGet:
			getDashboardsHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/dashboards"))
	mux.Handle("/dashboards/", prometheusMiddleware(errorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getDashboardByIDHandler(w, r)
		case http.MethodPut:
			updateDashboardHandler(w, r)
		case http.MethodDelete:
			deleteDashboardHandler(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})), "/dashboards/"))

	// Search endpoint
	mux.Handle("/search", prometheusMiddleware(errorHandler(http.HandlerFunc(searchHandler)), "/search"))

	return mux
}

// gracefulShutdown handles graceful shutdown of the service
func gracefulShutdown(server *http.Server) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	log.Println("Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	if db != nil {
		db.Close()
	}
	if rdb != nil {
		rdb.Close()
	}

	log.Println("Server stopped")
}

func main() {
	log.Println("Starting Monitoring Service...")

	// Load configuration
	config := loadConfiguration()

	// Initialize service
	var err error
	service, err = NewMonitoringService(config)
	if err != nil {
		log.Fatalf("Failed to initialize monitoring service: %v", err)
	}

	// Initialize CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"}, // Restrict in production
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"Link", "X-Total-Count"},
		AllowCredentials: true,
		MaxAge:           300,
	})

	// Setup routes
	mux := setupRoutes()

	// Apply middleware
	handler := c.Handler(loggingMiddleware(mux))

	// Create server
	server := &http.Server{
		Addr:         ":" + config.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Monitoring service starting on port %s", config.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Handle graceful shutdown
	gracefulShutdown(server)
}


