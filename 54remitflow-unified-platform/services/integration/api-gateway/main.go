package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// APIGateway handles all service integration and routing
type APIGateway struct {
	DB          *gorm.DB
	RedisClient *redis.Client
	Router      *gin.Engine
	Services    map[string]ServiceConfig
}

// ServiceConfig defines configuration for each microservice
type ServiceConfig struct {
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	Port        int    `json:"port"`
	HealthPath  string `json:"health_path"`
	Version     string `json:"version"`
	Status      string `json:"status"`
	LastCheck   time.Time `json:"last_check"`
}

// RouteConfig defines API route configuration
type RouteConfig struct {
	ID          uint   `gorm:"primaryKey"`
	Path        string `gorm:"unique;not null"`
	Method      string `gorm:"not null"`
	ServiceName string `gorm:"not null"`
	TargetPath  string `gorm:"not null"`
	AuthRequired bool  `gorm:"default:true"`
	RateLimit   int    `gorm:"default:1000"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// RequestLog tracks all API requests
type RequestLog struct {
	ID          uint   `gorm:"primaryKey"`
	RequestID   string `gorm:"unique;not null"`
	Method      string `gorm:"not null"`
	Path        string `gorm:"not null"`
	ServiceName string
	StatusCode  int
	Duration    int64 // milliseconds
	UserID      string
	IPAddress   string
	UserAgent   string
	CreatedAt   time.Time
}

// ServiceHealth tracks service health status
type ServiceHealth struct {
	ID          uint   `gorm:"primaryKey"`
	ServiceName string `gorm:"unique;not null"`
	Status      string `gorm:"not null"`
	LastCheck   time.Time
	ResponseTime int64 // milliseconds
	ErrorCount  int
	SuccessCount int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func main() {
	gateway := &APIGateway{
		Services: make(map[string]ServiceConfig),
	}

	// Initialize database
	if err := gateway.initDatabase(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// Initialize Redis
	if err := gateway.initRedis(); err != nil {
		log.Fatal("Failed to initialize Redis:", err)
	}

	// Initialize router
	gateway.initRouter()

	// Load service configurations
	gateway.loadServiceConfigurations()

	// Start health monitoring
	go gateway.startHealthMonitoring()

	// Start metrics collection
	go gateway.startMetricsCollection()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8200"
	}

	log.Printf("🚀 API Gateway starting on port %s", port)
	log.Printf("📊 Monitoring %d services", len(gateway.Services))
	
	if err := gateway.Router.Run(":" + port); err != nil {
		log.Fatal("Failed to start API Gateway:", err)
	}
}

func (gw *APIGateway) initDatabase() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=remittance port=5432 sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return err
	}

	gw.DB = db

	// Auto-migrate schemas
	return db.AutoMigrate(&RouteConfig{}, &RequestLog{}, &ServiceHealth{})
}

func (gw *APIGateway) initRedis() error {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379"
	}

	gw.RedisClient = redis.NewClient(&redis.Options{
		Addr: redisURL,
		DB:   0,
	})

	// Test connection
	ctx := context.Background()
	_, err := gw.RedisClient.Ping(ctx).Result()
	return err
}

func (gw *APIGateway) initRouter() {
	gin.SetMode(gin.ReleaseMode)
	gw.Router = gin.New()

	// Middleware
	gw.Router.Use(gin.Logger())
	gw.Router.Use(gin.Recovery())
	gw.Router.Use(gw.corsMiddleware())
	gw.Router.Use(gw.requestLoggingMiddleware())
	gw.Router.Use(gw.rateLimitMiddleware())

	// Health check endpoint
	gw.Router.GET("/health", gw.healthCheck)
	gw.Router.GET("/health/services", gw.servicesHealth)

	// Service discovery endpoints
	gw.Router.GET("/api/services", gw.listServices)
	gw.Router.GET("/api/services/:name", gw.getService)
	gw.Router.POST("/api/services", gw.registerService)
	gw.Router.PUT("/api/services/:name", gw.updateService)
	gw.Router.DELETE("/api/services/:name", gw.unregisterService)

	// Route management endpoints
	gw.Router.GET("/api/routes", gw.listRoutes)
	gw.Router.POST("/api/routes", gw.createRoute)
	gw.Router.PUT("/api/routes/:id", gw.updateRoute)
	gw.Router.DELETE("/api/routes/:id", gw.deleteRoute)

	// Metrics endpoints
	gw.Router.GET("/api/metrics", gw.getMetrics)
	gw.Router.GET("/api/metrics/services", gw.getServiceMetrics)

	// Proxy all other requests
	gw.Router.NoRoute(gw.proxyRequest)
}

func (gw *APIGateway) loadServiceConfigurations() {
	// Core Banking Services
	services := []ServiceConfig{
		{Name: "agent-management", BaseURL: "http://localhost:8080", Port: 8080, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "payment-orchestrator", BaseURL: "http://localhost:8081", Port: 8081, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "cash-management", BaseURL: "http://localhost:8082", Port: 8082, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "commission-settlement", BaseURL: "http://localhost:8083", Port: 8083, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "account-services", BaseURL: "http://localhost:8084", Port: 8084, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "user-service", BaseURL: "http://localhost:8085", Port: 8085, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "notification-service", BaseURL: "http://localhost:8086", Port: 8086, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "rural-banking", BaseURL: "http://localhost:8087", Port: 8087, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "pos-management", BaseURL: "http://localhost:8095", Port: 8095, HealthPath: "/health", Version: "v1.0.0"},
		
		// Float Management Services
		{Name: "float-management", BaseURL: "http://localhost:8097", Port: 8097, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "float-risk-engine", BaseURL: "http://localhost:8001", Port: 8001, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "float-settlement-engine", BaseURL: "http://localhost:8002", Port: 8002, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "float-integration-models", BaseURL: "http://localhost:8098", Port: 8098, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "float-regulatory-compliance", BaseURL: "http://localhost:8003", Port: 8003, HealthPath: "/health", Version: "v1.0.0"},
		
		// Settlement Optimization Services
		{Name: "enhanced-retry-service", BaseURL: "http://localhost:8099", Port: 8099, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "balance-monitoring-service", BaseURL: "http://localhost:8100", Port: 8100, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "data-validation-service", BaseURL: "http://localhost:8101", Port: 8101, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "multi-provider-service", BaseURL: "http://localhost:8102", Port: 8102, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "predictive-ml-service", BaseURL: "http://localhost:8103", Port: 8103, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "automated-reconciliation-service", BaseURL: "http://localhost:8104", Port: 8104, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "ai-settlement-optimizer", BaseURL: "http://localhost:8105", Port: 8105, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "blockchain-settlement-network", BaseURL: "http://localhost:8106", Port: 8106, HealthPath: "/health", Version: "v1.0.0"},
		
		// TigerBeetle Services
		{Name: "tigerbeetle-api", BaseURL: "http://localhost:8088", Port: 8088, HealthPath: "/health", Version: "v1.0.0"},
		{Name: "tigerbeetle-edge", BaseURL: "http://localhost:8089", Port: 8089, HealthPath: "/health", Version: "v1.0.0"},
		
		// Analytics Services
		{Name: "pos-analytics", BaseURL: "http://localhost:8096", Port: 8096, HealthPath: "/health", Version: "v1.0.0"},
	}

	for _, service := range services {
		gw.Services[service.Name] = service
		
		// Initialize service health record
		gw.DB.FirstOrCreate(&ServiceHealth{
			ServiceName: service.Name,
			Status:      "unknown",
			LastCheck:   time.Now(),
		}, ServiceHealth{ServiceName: service.Name})
	}

	log.Printf("📋 Loaded %d service configurations", len(services))
}

func (gw *APIGateway) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func (gw *APIGateway) requestLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		requestID := fmt.Sprintf("%d", time.Now().UnixNano())
		
		c.Header("X-Request-ID", requestID)
		c.Set("request_id", requestID)

		c.Next()

		duration := time.Since(start).Milliseconds()
		
		// Log request to database
		go func() {
			requestLog := RequestLog{
				RequestID:  requestID,
				Method:     c.Request.Method,
				Path:       c.Request.URL.Path,
				StatusCode: c.Writer.Status(),
				Duration:   duration,
				IPAddress:  c.ClientIP(),
				UserAgent:  c.Request.UserAgent(),
				CreatedAt:  time.Now(),
			}
			
			if serviceName, exists := c.Get("service_name"); exists {
				requestLog.ServiceName = serviceName.(string)
			}
			
			if userID, exists := c.Get("user_id"); exists {
				requestLog.UserID = userID.(string)
			}
			
			gw.DB.Create(&requestLog)
		}()
	}
}

func (gw *APIGateway) rateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Simple rate limiting using Redis
		ctx := context.Background()
		key := fmt.Sprintf("rate_limit:%s", c.ClientIP())
		
		count, err := gw.RedisClient.Incr(ctx, key).Result()
		if err == nil {
			if count == 1 {
				gw.RedisClient.Expire(ctx, key, time.Minute)
			}
			
			if count > 1000 { // 1000 requests per minute
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded",
					"retry_after": 60,
				})
				c.Abort()
				return
			}
		}
		
		c.Next()
	}
}

func (gw *APIGateway) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "api-gateway",
		"version": "v1.0.0",
		"timestamp": time.Now().ISO8601(),
		"services_count": len(gw.Services),
	})
}

func (gw *APIGateway) servicesHealth(c *gin.Context) {
	var healthRecords []ServiceHealth
	gw.DB.Find(&healthRecords)
	
	healthMap := make(map[string]ServiceHealth)
	for _, record := range healthRecords {
		healthMap[record.ServiceName] = record
	}
	
	c.JSON(http.StatusOK, gin.H{
		"services": healthMap,
		"total_services": len(gw.Services),
		"healthy_services": gw.countHealthyServices(healthRecords),
		"timestamp": time.Now().ISO8601(),
	})
}

func (gw *APIGateway) countHealthyServices(records []ServiceHealth) int {
	count := 0
	for _, record := range records {
		if record.Status == "healthy" {
			count++
		}
	}
	return count
}

func (gw *APIGateway) listServices(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"services": gw.Services,
		"count": len(gw.Services),
	})
}

func (gw *APIGateway) getService(c *gin.Context) {
	name := c.Param("name")
	
	if service, exists := gw.Services[name]; exists {
		c.JSON(http.StatusOK, service)
	} else {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
	}
}

func (gw *APIGateway) registerService(c *gin.Context) {
	var service ServiceConfig
	if err := c.ShouldBindJSON(&service); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	gw.Services[service.Name] = service
	
	// Initialize health record
	gw.DB.FirstOrCreate(&ServiceHealth{
		ServiceName: service.Name,
		Status:      "unknown",
		LastCheck:   time.Now(),
	}, ServiceHealth{ServiceName: service.Name})
	
	c.JSON(http.StatusCreated, service)
}

func (gw *APIGateway) updateService(c *gin.Context) {
	name := c.Param("name")
	
	var service ServiceConfig
	if err := c.ShouldBindJSON(&service); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	service.Name = name
	gw.Services[name] = service
	
	c.JSON(http.StatusOK, service)
}

func (gw *APIGateway) unregisterService(c *gin.Context) {
	name := c.Param("name")
	
	if _, exists := gw.Services[name]; exists {
		delete(gw.Services, name)
		c.JSON(http.StatusOK, gin.H{"message": "Service unregistered"})
	} else {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
	}
}

func (gw *APIGateway) listRoutes(c *gin.Context) {
	var routes []RouteConfig
	gw.DB.Find(&routes)
	
	c.JSON(http.StatusOK, gin.H{
		"routes": routes,
		"count": len(routes),
	})
}

func (gw *APIGateway) createRoute(c *gin.Context) {
	var route RouteConfig
	if err := c.ShouldBindJSON(&route); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if err := gw.DB.Create(&route).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, route)
}

func (gw *APIGateway) updateRoute(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid route ID"})
		return
	}
	
	var route RouteConfig
	if err := gw.DB.First(&route, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Route not found"})
		return
	}
	
	if err := c.ShouldBindJSON(&route); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if err := gw.DB.Save(&route).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, route)
}

func (gw *APIGateway) deleteRoute(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid route ID"})
		return
	}
	
	if err := gw.DB.Delete(&RouteConfig{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "Route deleted"})
}

func (gw *APIGateway) getMetrics(c *gin.Context) {
	var requestLogs []RequestLog
	gw.DB.Where("created_at > ?", time.Now().Add(-24*time.Hour)).Find(&requestLogs)
	
	metrics := map[string]interface{}{
		"total_requests_24h": len(requestLogs),
		"avg_response_time": gw.calculateAverageResponseTime(requestLogs),
		"status_codes": gw.calculateStatusCodeDistribution(requestLogs),
		"top_endpoints": gw.calculateTopEndpoints(requestLogs),
		"requests_per_hour": gw.calculateRequestsPerHour(requestLogs),
	}
	
	c.JSON(http.StatusOK, metrics)
}

func (gw *APIGateway) getServiceMetrics(c *gin.Context) {
	var healthRecords []ServiceHealth
	gw.DB.Find(&healthRecords)
	
	serviceMetrics := make(map[string]interface{})
	for _, record := range healthRecords {
		serviceMetrics[record.ServiceName] = map[string]interface{}{
			"status": record.Status,
			"last_check": record.LastCheck,
			"response_time": record.ResponseTime,
			"error_count": record.ErrorCount,
			"success_count": record.SuccessCount,
			"uptime_percentage": gw.calculateUptimePercentage(record),
		}
	}
	
	c.JSON(http.StatusOK, serviceMetrics)
}

func (gw *APIGateway) calculateAverageResponseTime(logs []RequestLog) float64 {
	if len(logs) == 0 {
		return 0
	}
	
	total := int64(0)
	for _, log := range logs {
		total += log.Duration
	}
	
	return float64(total) / float64(len(logs))
}

func (gw *APIGateway) calculateStatusCodeDistribution(logs []RequestLog) map[string]int {
	distribution := make(map[string]int)
	
	for _, log := range logs {
		statusRange := fmt.Sprintf("%dxx", log.StatusCode/100)
		distribution[statusRange]++
	}
	
	return distribution
}

func (gw *APIGateway) calculateTopEndpoints(logs []RequestLog) []map[string]interface{} {
	endpointCounts := make(map[string]int)
	
	for _, log := range logs {
		endpoint := fmt.Sprintf("%s %s", log.Method, log.Path)
		endpointCounts[endpoint]++
	}
	
	// Convert to sorted slice (simplified)
	var topEndpoints []map[string]interface{}
	for endpoint, count := range endpointCounts {
		topEndpoints = append(topEndpoints, map[string]interface{}{
			"endpoint": endpoint,
			"count": count,
		})
	}
	
	return topEndpoints
}

func (gw *APIGateway) calculateRequestsPerHour(logs []RequestLog) map[string]int {
	hourCounts := make(map[string]int)
	
	for _, log := range logs {
		hour := log.CreatedAt.Format("2006-01-02 15:00")
		hourCounts[hour]++
	}
	
	return hourCounts
}

func (gw *APIGateway) calculateUptimePercentage(health ServiceHealth) float64 {
	total := health.ErrorCount + health.SuccessCount
	if total == 0 {
		return 0
	}
	
	return (float64(health.SuccessCount) / float64(total)) * 100
}

func (gw *APIGateway) proxyRequest(c *gin.Context) {
	path := c.Request.URL.Path
	
	// Find matching service based on path
	serviceName := gw.findServiceForPath(path)
	if serviceName == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "No service found for path"})
		return
	}
	
	service, exists := gw.Services[serviceName]
	if !exists {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Service not available"})
		return
	}
	
	// Set service name for logging
	c.Set("service_name", serviceName)
	
	// Proxy the request (simplified implementation)
	targetURL := fmt.Sprintf("%s%s", service.BaseURL, path)
	
	c.JSON(http.StatusOK, gin.H{
		"message": "Request would be proxied to",
		"target": targetURL,
		"service": serviceName,
		"method": c.Request.Method,
	})
}

func (gw *APIGateway) findServiceForPath(path string) string {
	// Simple path-based routing
	pathParts := strings.Split(strings.Trim(path, "/"), "/")
	if len(pathParts) == 0 {
		return ""
	}
	
	// Map common paths to services
	pathServiceMap := map[string]string{
		"agents": "agent-management",
		"payments": "payment-orchestrator",
		"cash": "cash-management",
		"commissions": "commission-settlement",
		"accounts": "account-services",
		"users": "user-service",
		"notifications": "notification-service",
		"rural": "rural-banking",
		"pos": "pos-management",
		"float": "float-management",
		"settlement": "enhanced-retry-service",
		"tigerbeetle": "tigerbeetle-api",
		"analytics": "pos-analytics",
	}
	
	for _, part := range pathParts {
		if serviceName, exists := pathServiceMap[part]; exists {
			return serviceName
		}
	}
	
	return ""
}

func (gw *APIGateway) startHealthMonitoring() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			gw.checkServicesHealth()
		}
	}
}

func (gw *APIGateway) checkServicesHealth() {
	for name, service := range gw.Services {
		go func(serviceName string, serviceConfig ServiceConfig) {
			start := time.Now()
			healthURL := fmt.Sprintf("%s%s", serviceConfig.BaseURL, serviceConfig.HealthPath)
			
			resp, err := http.Get(healthURL)
			duration := time.Since(start).Milliseconds()
			
			var health ServiceHealth
			gw.DB.First(&health, "service_name = ?", serviceName)
			
			if err != nil || resp.StatusCode != http.StatusOK {
				health.Status = "unhealthy"
				health.ErrorCount++
			} else {
				health.Status = "healthy"
				health.SuccessCount++
			}
			
			health.LastCheck = time.Now()
			health.ResponseTime = duration
			
			gw.DB.Save(&health)
			
			if resp != nil {
				resp.Body.Close()
			}
		}(name, service)
	}
}

func (gw *APIGateway) startMetricsCollection() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			gw.collectMetrics()
		}
	}
}

func (gw *APIGateway) collectMetrics() {
	// Collect and store metrics in Redis for real-time access
	ctx := context.Background()
	
	// Service health metrics
	var healthRecords []ServiceHealth
	gw.DB.Find(&healthRecords)
	
	healthyCount := 0
	for _, record := range healthRecords {
		if record.Status == "healthy" {
			healthyCount++
		}
	}
	
	metrics := map[string]interface{}{
		"total_services": len(gw.Services),
		"healthy_services": healthyCount,
		"unhealthy_services": len(gw.Services) - healthyCount,
		"timestamp": time.Now().Unix(),
	}
	
	metricsJSON, _ := json.Marshal(metrics)
	gw.RedisClient.Set(ctx, "gateway:metrics", metricsJSON, time.Hour)
	
	log.Printf("📊 Metrics collected: %d/%d services healthy", healthyCount, len(gw.Services))
}

