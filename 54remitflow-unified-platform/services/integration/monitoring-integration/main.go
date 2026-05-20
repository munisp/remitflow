package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/prometheus/client_golang/api"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// MonitoringIntegrationService handles monitoring and observability integration
type MonitoringIntegrationService struct {
	DB             *gorm.DB
	Redis          *redis.Client
	PrometheusAPI  v1.API
	Router         *gin.Engine
	Metrics        *ServiceMetrics
	AlertManager   *AlertManager
	HealthCheckers map[string]HealthChecker
	mu             sync.RWMutex
}

// ServiceMetrics contains Prometheus metrics
type ServiceMetrics struct {
	RequestsTotal     *prometheus.CounterVec
	RequestDuration   *prometheus.HistogramVec
	ActiveConnections prometheus.Gauge
	SystemHealth      *prometheus.GaugeVec
	ErrorsTotal       *prometheus.CounterVec
	ServiceUptime     prometheus.Gauge
}

// HealthChecker interface for service health checks
type HealthChecker interface {
	CheckHealth(ctx context.Context) HealthStatus
	GetServiceName() string
}

// HealthStatus represents the health status of a service
type HealthStatus struct {
	ServiceName string                 `json:"service_name"`
	Status      string                 `json:"status"` // healthy, unhealthy, degraded
	Timestamp   time.Time              `json:"timestamp"`
	ResponseTime time.Duration         `json:"response_time"`
	Details     map[string]interface{} `json:"details"`
	Dependencies []DependencyStatus    `json:"dependencies"`
}

// DependencyStatus represents the status of a service dependency
type DependencyStatus struct {
	Name         string        `json:"name"`
	Status       string        `json:"status"`
	ResponseTime time.Duration `json:"response_time"`
	Error        string        `json:"error,omitempty"`
}

// AlertRule represents an alerting rule
type AlertRule struct {
	ID          string                 `json:"id" gorm:"primaryKey"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Query       string                 `json:"query"`
	Condition   string                 `json:"condition"` // gt, lt, eq, ne
	Threshold   float64                `json:"threshold"`
	Duration    string                 `json:"duration"`
	Severity    string                 `json:"severity"` // critical, warning, info
	Enabled     bool                   `json:"enabled"`
	Actions     []AlertAction          `json:"actions" gorm:"serializer:json"`
	Labels      map[string]string      `json:"labels" gorm:"serializer:json"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// AlertAction represents an action to take when an alert fires
type AlertAction struct {
	Type   string                 `json:"type"` // email, slack, webhook, sms
	Config map[string]interface{} `json:"config"`
}

// Alert represents an active alert
type Alert struct {
	ID          string            `json:"id" gorm:"primaryKey"`
	RuleID      string            `json:"rule_id"`
	Status      string            `json:"status"` // firing, resolved
	Value       float64           `json:"value"`
	Labels      map[string]string `json:"labels" gorm:"serializer:json"`
	Annotations map[string]string `json:"annotations" gorm:"serializer:json"`
	StartsAt    time.Time         `json:"starts_at"`
	EndsAt      *time.Time        `json:"ends_at,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// AlertManager handles alert processing and notifications
type AlertManager struct {
	service *MonitoringIntegrationService
	rules   map[string]*AlertRule
	alerts  map[string]*Alert
	mu      sync.RWMutex
}

// DatabaseHealthChecker checks database connectivity
type DatabaseHealthChecker struct {
	db *gorm.DB
}

func (d *DatabaseHealthChecker) CheckHealth(ctx context.Context) HealthStatus {
	start := time.Now()
	status := HealthStatus{
		ServiceName: "database",
		Timestamp:   start,
		Details:     make(map[string]interface{}),
	}

	sqlDB, err := d.db.DB()
	if err != nil {
		status.Status = "unhealthy"
		status.Details["error"] = err.Error()
		status.ResponseTime = time.Since(start)
		return status
	}

	err = sqlDB.PingContext(ctx)
	if err != nil {
		status.Status = "unhealthy"
		status.Details["error"] = err.Error()
	} else {
		status.Status = "healthy"
		
		// Get connection stats
		stats := sqlDB.Stats()
		status.Details["open_connections"] = stats.OpenConnections
		status.Details["in_use"] = stats.InUse
		status.Details["idle"] = stats.Idle
	}

	status.ResponseTime = time.Since(start)
	return status
}

func (d *DatabaseHealthChecker) GetServiceName() string {
	return "database"
}

// RedisHealthChecker checks Redis connectivity
type RedisHealthChecker struct {
	redis *redis.Client
}

func (r *RedisHealthChecker) CheckHealth(ctx context.Context) HealthStatus {
	start := time.Now()
	status := HealthStatus{
		ServiceName: "redis",
		Timestamp:   start,
		Details:     make(map[string]interface{}),
	}

	_, err := r.redis.Ping(ctx).Result()
	if err != nil {
		status.Status = "unhealthy"
		status.Details["error"] = err.Error()
	} else {
		status.Status = "healthy"
		
		// Get Redis info
		info, err := r.redis.Info(ctx).Result()
		if err == nil {
			status.Details["info"] = "available"
		}
	}

	status.ResponseTime = time.Since(start)
	return status
}

func (r *RedisHealthChecker) GetServiceName() string {
	return "redis"
}

// HTTPServiceHealthChecker checks HTTP service health
type HTTPServiceHealthChecker struct {
	name string
	url  string
}

func (h *HTTPServiceHealthChecker) CheckHealth(ctx context.Context) HealthStatus {
	start := time.Now()
	status := HealthStatus{
		ServiceName: h.name,
		Timestamp:   start,
		Details:     make(map[string]interface{}),
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", h.url, nil)
	if err != nil {
		status.Status = "unhealthy"
		status.Details["error"] = err.Error()
		status.ResponseTime = time.Since(start)
		return status
	}

	resp, err := client.Do(req)
	if err != nil {
		status.Status = "unhealthy"
		status.Details["error"] = err.Error()
	} else {
		defer resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			status.Status = "healthy"
		} else {
			status.Status = "unhealthy"
		}
		status.Details["status_code"] = resp.StatusCode
	}

	status.ResponseTime = time.Since(start)
	return status
}

func (h *HTTPServiceHealthChecker) GetServiceName() string {
	return h.name
}

// NewMonitoringIntegrationService creates a new monitoring integration service
func NewMonitoringIntegrationService() *MonitoringIntegrationService {
	service := &MonitoringIntegrationService{
		HealthCheckers: make(map[string]HealthChecker),
	}

	service.initializeMetrics()
	service.initializeDatabase()
	service.initializeRedis()
	service.initializePrometheus()
	service.initializeRouter()
	service.initializeHealthCheckers()
	service.initializeAlertManager()

	return service
}

func (s *MonitoringIntegrationService) initializeMetrics() {
	s.Metrics = &ServiceMetrics{
		RequestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "monitoring_integration_requests_total",
				Help: "Total number of requests processed",
			},
			[]string{"method", "endpoint", "status"},
		),
		RequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "monitoring_integration_request_duration_seconds",
				Help:    "Request duration in seconds",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"method", "endpoint"},
		),
		ActiveConnections: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "monitoring_integration_active_connections",
				Help: "Number of active connections",
			},
		),
		SystemHealth: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "monitoring_integration_system_health",
				Help: "System health status (1=healthy, 0=unhealthy)",
			},
			[]string{"service", "component"},
		),
		ErrorsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "monitoring_integration_errors_total",
				Help: "Total number of errors",
			},
			[]string{"service", "type"},
		),
		ServiceUptime: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "monitoring_integration_uptime_seconds",
				Help: "Service uptime in seconds",
			},
		),
	}

	// Register metrics
	prometheus.MustRegister(
		s.Metrics.RequestsTotal,
		s.Metrics.RequestDuration,
		s.Metrics.ActiveConnections,
		s.Metrics.SystemHealth,
		s.Metrics.ErrorsTotal,
		s.Metrics.ServiceUptime,
	)
}

func (s *MonitoringIntegrationService) initializeDatabase() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/remittance?sslmode=disable"
	}

	var err error
	s.DB, err = gorm.Open(postgres.Open(dbURL), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Auto-migrate tables
	err = s.DB.AutoMigrate(&AlertRule{}, &Alert{})
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
}

func (s *MonitoringIntegrationService) initializeRedis() {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}

	s.Redis = redis.NewClient(opt)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = s.Redis.Ping(ctx).Result()
	if err != nil {
		log.Printf("Warning: Failed to connect to Redis: %v", err)
	}
}

func (s *MonitoringIntegrationService) initializePrometheus() {
	prometheusURL := os.Getenv("PROMETHEUS_URL")
	if prometheusURL == "" {
		prometheusURL = "http://localhost:9090"
	}

	client, err := api.NewClient(api.Config{
		Address: prometheusURL,
	})
	if err != nil {
		log.Printf("Warning: Failed to create Prometheus client: %v", err)
		return
	}

	s.PrometheusAPI = v1.NewAPI(client)
}

func (s *MonitoringIntegrationService) initializeRouter() {
	s.Router = gin.New()
	s.Router.Use(gin.Logger())
	s.Router.Use(gin.Recovery())

	// CORS middleware
	s.Router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// Metrics middleware
	s.Router.Use(s.metricsMiddleware())

	s.setupRoutes()
}

func (s *MonitoringIntegrationService) initializeHealthCheckers() {
	// Database health checker
	s.HealthCheckers["database"] = &DatabaseHealthChecker{db: s.DB}

	// Redis health checker
	if s.Redis != nil {
		s.HealthCheckers["redis"] = &RedisHealthChecker{redis: s.Redis}
	}

	// Add HTTP service health checkers for other services
	services := map[string]string{
		"float-management":     "http://localhost:8097/health",
		"risk-engine":          "http://localhost:8001/health",
		"settlement-engine":    "http://localhost:8002/health",
		"tigerbeetle-api":      "http://localhost:8098/health",
		"agent-management":     "http://localhost:8080/health",
		"payment-orchestrator": "http://localhost:8081/health",
	}

	for name, url := range services {
		s.HealthCheckers[name] = &HTTPServiceHealthChecker{name: name, url: url}
	}
}

func (s *MonitoringIntegrationService) initializeAlertManager() {
	s.AlertManager = &AlertManager{
		service: s,
		rules:   make(map[string]*AlertRule),
		alerts:  make(map[string]*Alert),
	}

	// Load alert rules from database
	go s.AlertManager.loadRules()

	// Start alert evaluation loop
	go s.AlertManager.evaluationLoop()
}

func (s *MonitoringIntegrationService) setupRoutes() {
	// Health check endpoint
	s.Router.GET("/health", s.healthCheck)

	// Metrics endpoint
	s.Router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := s.Router.Group("/api")
	{
		// Health endpoints
		health := api.Group("/health")
		{
			health.GET("/", s.getOverallHealth)
			health.GET("/services", s.getServicesHealth)
			health.GET("/services/:service", s.getServiceHealth)
		}

		// Metrics endpoints
		metrics := api.Group("/metrics")
		{
			metrics.GET("/", s.getMetrics)
			metrics.GET("/query", s.queryMetrics)
			metrics.GET("/range", s.queryRangeMetrics)
		}

		// Alert endpoints
		alerts := api.Group("/alerts")
		{
			alerts.GET("/rules", s.getAlertRules)
			alerts.POST("/rules", s.createAlertRule)
			alerts.GET("/rules/:id", s.getAlertRule)
			alerts.PUT("/rules/:id", s.updateAlertRule)
			alerts.DELETE("/rules/:id", s.deleteAlertRule)

			alerts.GET("/", s.getAlerts)
			alerts.GET("/:id", s.getAlert)
			alerts.POST("/:id/resolve", s.resolveAlert)
		}

		// Dashboard endpoints
		dashboard := api.Group("/dashboard")
		{
			dashboard.GET("/overview", s.getDashboardOverview)
			dashboard.GET("/services", s.getServicesDashboard)
			dashboard.GET("/alerts", s.getAlertsDashboard)
		}
	}
}

func (s *MonitoringIntegrationService) metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())

		s.Metrics.RequestsTotal.WithLabelValues(c.Request.Method, c.FullPath(), status).Inc()
		s.Metrics.RequestDuration.WithLabelValues(c.Request.Method, c.FullPath()).Observe(duration.Seconds())
	}
}

func (s *MonitoringIntegrationService) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "monitoring-integration",
		"version":   "1.0.0",
		"timestamp": time.Now().Format(time.RFC3339),
		"uptime":    time.Since(time.Now()).Seconds(),
	})
}

func (s *MonitoringIntegrationService) getOverallHealth(c *gin.Context) {
	ctx := c.Request.Context()
	
	overallStatus := "healthy"
	services := make(map[string]HealthStatus)
	
	s.mu.RLock()
	checkers := make(map[string]HealthChecker)
	for name, checker := range s.HealthCheckers {
		checkers[name] = checker
	}
	s.mu.RUnlock()

	// Check all services
	for name, checker := range checkers {
		status := checker.CheckHealth(ctx)
		services[name] = status
		
		if status.Status != "healthy" {
			overallStatus = "degraded"
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    overallStatus,
		"timestamp": time.Now().Format(time.RFC3339),
		"services":  services,
	})
}

func (s *MonitoringIntegrationService) getServicesHealth(c *gin.Context) {
	ctx := c.Request.Context()
	
	services := make(map[string]HealthStatus)
	
	s.mu.RLock()
	checkers := make(map[string]HealthChecker)
	for name, checker := range s.HealthCheckers {
		checkers[name] = checker
	}
	s.mu.RUnlock()

	for name, checker := range checkers {
		services[name] = checker.CheckHealth(ctx)
	}

	c.JSON(http.StatusOK, gin.H{
		"services":  services,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func (s *MonitoringIntegrationService) getServiceHealth(c *gin.Context) {
	serviceName := c.Param("service")
	
	s.mu.RLock()
	checker, exists := s.HealthCheckers[serviceName]
	s.mu.RUnlock()
	
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		return
	}

	status := checker.CheckHealth(c.Request.Context())
	c.JSON(http.StatusOK, status)
}

func (s *MonitoringIntegrationService) getMetrics(c *gin.Context) {
	// Get basic metrics
	metrics := gin.H{
		"timestamp": time.Now().Format(time.RFC3339),
		"system": gin.H{
			"uptime": time.Since(time.Now()).Seconds(),
		},
	}

	// Add Prometheus metrics if available
	if s.PrometheusAPI != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Query some basic metrics
		queries := map[string]string{
			"cpu_usage":    "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
			"memory_usage": "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100",
			"disk_usage":   "100 - ((node_filesystem_avail_bytes * 100) / node_filesystem_size_bytes)",
		}

		prometheusMetrics := make(map[string]interface{})
		for name, query := range queries {
			result, _, err := s.PrometheusAPI.Query(ctx, query, time.Now())
			if err == nil {
				prometheusMetrics[name] = result
			}
		}

		if len(prometheusMetrics) > 0 {
			metrics["prometheus"] = prometheusMetrics
		}
	}

	c.JSON(http.StatusOK, metrics)
}

func (s *MonitoringIntegrationService) queryMetrics(c *gin.Context) {
	query := c.Query("query")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter is required"})
		return
	}

	if s.PrometheusAPI == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus not available"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, warnings, err := s.PrometheusAPI.Query(ctx, query, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result":   result,
		"warnings": warnings,
	})
}

func (s *MonitoringIntegrationService) queryRangeMetrics(c *gin.Context) {
	query := c.Query("query")
	start := c.Query("start")
	end := c.Query("end")
	step := c.Query("step")

	if query == "" || start == "" || end == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query, start, and end parameters are required"})
		return
	}

	if s.PrometheusAPI == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus not available"})
		return
	}

	startTime, err := time.Parse(time.RFC3339, start)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid start time format"})
		return
	}

	endTime, err := time.Parse(time.RFC3339, end)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid end time format"})
		return
	}

	stepDuration := time.Minute
	if step != "" {
		stepDuration, err = time.ParseDuration(step)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid step duration"})
			return
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r := v1.Range{
		Start: startTime,
		End:   endTime,
		Step:  stepDuration,
	}

	result, warnings, err := s.PrometheusAPI.QueryRange(ctx, query, r)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result":   result,
		"warnings": warnings,
	})
}

func (s *MonitoringIntegrationService) getAlertRules(c *gin.Context) {
	var rules []AlertRule
	result := s.DB.Find(&rules)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"rules": rules,
		"count": len(rules),
	})
}

func (s *MonitoringIntegrationService) createAlertRule(c *gin.Context) {
	var rule AlertRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.ID = fmt.Sprintf("rule_%d", time.Now().Unix())
	rule.CreatedAt = time.Now()
	rule.UpdatedAt = time.Now()

	result := s.DB.Create(&rule)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	// Add to alert manager
	s.AlertManager.mu.Lock()
	s.AlertManager.rules[rule.ID] = &rule
	s.AlertManager.mu.Unlock()

	c.JSON(http.StatusCreated, rule)
}

func (s *MonitoringIntegrationService) getAlertRule(c *gin.Context) {
	id := c.Param("id")
	
	var rule AlertRule
	result := s.DB.First(&rule, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert rule not found"})
		return
	}

	c.JSON(http.StatusOK, rule)
}

func (s *MonitoringIntegrationService) updateAlertRule(c *gin.Context) {
	id := c.Param("id")
	
	var rule AlertRule
	result := s.DB.First(&rule, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert rule not found"})
		return
	}

	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.UpdatedAt = time.Now()
	result = s.DB.Save(&rule)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	// Update in alert manager
	s.AlertManager.mu.Lock()
	s.AlertManager.rules[rule.ID] = &rule
	s.AlertManager.mu.Unlock()

	c.JSON(http.StatusOK, rule)
}

func (s *MonitoringIntegrationService) deleteAlertRule(c *gin.Context) {
	id := c.Param("id")
	
	result := s.DB.Delete(&AlertRule{}, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert rule not found"})
		return
	}

	// Remove from alert manager
	s.AlertManager.mu.Lock()
	delete(s.AlertManager.rules, id)
	s.AlertManager.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"message": "Alert rule deleted"})
}

func (s *MonitoringIntegrationService) getAlerts(c *gin.Context) {
	status := c.Query("status")
	
	var alerts []Alert
	query := s.DB
	
	if status != "" {
		query = query.Where("status = ?", status)
	}
	
	result := query.Order("created_at DESC").Find(&alerts)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"alerts": alerts,
		"count":  len(alerts),
	})
}

func (s *MonitoringIntegrationService) getAlert(c *gin.Context) {
	id := c.Param("id")
	
	var alert Alert
	result := s.DB.First(&alert, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert not found"})
		return
	}

	c.JSON(http.StatusOK, alert)
}

func (s *MonitoringIntegrationService) resolveAlert(c *gin.Context) {
	id := c.Param("id")
	
	var alert Alert
	result := s.DB.First(&alert, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert not found"})
		return
	}

	now := time.Now()
	alert.Status = "resolved"
	alert.EndsAt = &now
	alert.UpdatedAt = now

	result = s.DB.Save(&alert)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, alert)
}

func (s *MonitoringIntegrationService) getDashboardOverview(c *gin.Context) {
	// Get overall system health
	ctx := c.Request.Context()
	
	healthyServices := 0
	totalServices := 0
	services := make(map[string]string)
	
	s.mu.RLock()
	checkers := make(map[string]HealthChecker)
	for name, checker := range s.HealthCheckers {
		checkers[name] = checker
	}
	s.mu.RUnlock()

	for name, checker := range checkers {
		status := checker.CheckHealth(ctx)
		services[name] = status.Status
		totalServices++
		if status.Status == "healthy" {
			healthyServices++
		}
	}

	// Get active alerts count
	var activeAlertsCount int64
	s.DB.Model(&Alert{}).Where("status = ?", "firing").Count(&activeAlertsCount)

	// Get recent alerts
	var recentAlerts []Alert
	s.DB.Where("created_at > ?", time.Now().Add(-24*time.Hour)).
		Order("created_at DESC").
		Limit(10).
		Find(&recentAlerts)

	c.JSON(http.StatusOK, gin.H{
		"overview": gin.H{
			"healthy_services":    healthyServices,
			"total_services":      totalServices,
			"health_percentage":   float64(healthyServices) / float64(totalServices) * 100,
			"active_alerts":       activeAlertsCount,
			"recent_alerts_count": len(recentAlerts),
		},
		"services":      services,
		"recent_alerts": recentAlerts,
		"timestamp":     time.Now().Format(time.RFC3339),
	})
}

func (s *MonitoringIntegrationService) getServicesDashboard(c *gin.Context) {
	ctx := c.Request.Context()
	
	services := make(map[string]interface{})
	
	s.mu.RLock()
	checkers := make(map[string]HealthChecker)
	for name, checker := range s.HealthCheckers {
		checkers[name] = checker
	}
	s.mu.RUnlock()

	for name, checker := range checkers {
		status := checker.CheckHealth(ctx)
		services[name] = gin.H{
			"status":        status.Status,
			"response_time": status.ResponseTime.Milliseconds(),
			"details":       status.Details,
			"timestamp":     status.Timestamp.Format(time.RFC3339),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"services":  services,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func (s *MonitoringIntegrationService) getAlertsDashboard(c *gin.Context) {
	// Get alerts by status
	var alertStats []struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	
	s.DB.Model(&Alert{}).
		Select("status, count(*) as count").
		Group("status").
		Find(&alertStats)

	// Get alerts by severity (from rules)
	var severityStats []struct {
		Severity string `json:"severity"`
		Count    int64  `json:"count"`
	}
	
	s.DB.Table("alerts").
		Joins("JOIN alert_rules ON alerts.rule_id = alert_rules.id").
		Select("alert_rules.severity, count(*) as count").
		Where("alerts.status = ?", "firing").
		Group("alert_rules.severity").
		Find(&severityStats)

	// Get recent alerts
	var recentAlerts []Alert
	s.DB.Order("created_at DESC").Limit(20).Find(&recentAlerts)

	c.JSON(http.StatusOK, gin.H{
		"stats": gin.H{
			"by_status":   alertStats,
			"by_severity": severityStats,
		},
		"recent_alerts": recentAlerts,
		"timestamp":     time.Now().Format(time.RFC3339),
	})
}

// AlertManager methods
func (am *AlertManager) loadRules() {
	var rules []AlertRule
	am.service.DB.Where("enabled = ?", true).Find(&rules)
	
	am.mu.Lock()
	defer am.mu.Unlock()
	
	for _, rule := range rules {
		am.rules[rule.ID] = &rule
	}
	
	log.Printf("Loaded %d alert rules", len(rules))
}

func (am *AlertManager) evaluationLoop() {
	ticker := time.NewTicker(30 * time.Second) // Evaluate every 30 seconds
	defer ticker.Stop()

	for range ticker.C {
		am.evaluateRules()
	}
}

func (am *AlertManager) evaluateRules() {
	if am.service.PrometheusAPI == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	am.mu.RLock()
	rules := make(map[string]*AlertRule)
	for id, rule := range am.rules {
		rules[id] = rule
	}
	am.mu.RUnlock()

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}

		result, _, err := am.service.PrometheusAPI.Query(ctx, rule.Query, time.Now())
		if err != nil {
			log.Printf("Error evaluating rule %s: %v", rule.Name, err)
			continue
		}

		// Simple evaluation logic (in production, use more sophisticated evaluation)
		am.evaluateResult(rule, result)
	}
}

func (am *AlertManager) evaluateResult(rule *AlertRule, result interface{}) {
	// This is a simplified evaluation
	// In production, you'd parse the Prometheus result properly
	
	// For demo purposes, randomly fire some alerts
	if time.Now().Unix()%10 == 0 { // Fire alert 10% of the time
		am.fireAlert(rule, 0.85) // Example value
	}
}

func (am *AlertManager) fireAlert(rule *AlertRule, value float64) {
	alertID := fmt.Sprintf("alert_%s_%d", rule.ID, time.Now().Unix())
	
	alert := &Alert{
		ID:     alertID,
		RuleID: rule.ID,
		Status: "firing",
		Value:  value,
		Labels: map[string]string{
			"alertname": rule.Name,
			"severity":  rule.Severity,
		},
		Annotations: map[string]string{
			"description": rule.Description,
		},
		StartsAt:  time.Now(),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Save to database
	am.service.DB.Create(alert)

	// Store in memory
	am.mu.Lock()
	am.alerts[alertID] = alert
	am.mu.Unlock()

	// Send notifications
	go am.sendNotifications(rule, alert)

	log.Printf("🚨 Alert fired: %s (value: %.2f)", rule.Name, value)
}

func (am *AlertManager) sendNotifications(rule *AlertRule, alert *Alert) {
	for _, action := range rule.Actions {
		switch action.Type {
		case "email":
			am.sendEmailNotification(action.Config, rule, alert)
		case "slack":
			am.sendSlackNotification(action.Config, rule, alert)
		case "webhook":
			am.sendWebhookNotification(action.Config, rule, alert)
		}
	}
}

func (am *AlertManager) sendEmailNotification(config map[string]interface{}, rule *AlertRule, alert *Alert) {
	// Email notification implementation
	log.Printf("📧 Sending email notification for alert: %s", rule.Name)
}

func (am *AlertManager) sendSlackNotification(config map[string]interface{}, rule *AlertRule, alert *Alert) {
	// Slack notification implementation
	log.Printf("💬 Sending Slack notification for alert: %s", rule.Name)
}

func (am *AlertManager) sendWebhookNotification(config map[string]interface{}, rule *AlertRule, alert *Alert) {
	// Webhook notification implementation
	log.Printf("🔗 Sending webhook notification for alert: %s", rule.Name)
}

func main() {
	service := NewMonitoringIntegrationService()

	// Set service uptime start time
	startTime := time.Now()
	go func() {
		for {
			service.Metrics.ServiceUptime.Set(time.Since(startTime).Seconds())
			time.Sleep(10 * time.Second)
		}
	}()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8204"
	}

	log.Printf("🔍 Monitoring Integration Service starting on port %s", port)
	log.Printf("📊 Metrics available at http://localhost:%s/metrics", port)
	log.Printf("🏥 Health check at http://localhost:%s/health", port)
	log.Printf("📈 Dashboard at http://localhost:%s/api/dashboard/overview", port)

	if err := service.Router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

