package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Standalone service for testing without Kubernetes
type StandaloneKYBService struct {
	router     *gin.Engine
	redis      *redis.Client  // Single Redis instance instead of cluster
	dbPool     *pgxpool.Pool
	instanceID string
	metrics    *ServiceMetrics
	
	// Prometheus metrics
	httpRequestsTotal     *prometheus.CounterVec
	httpRequestDuration   *prometheus.HistogramVec
	activeConnections     prometheus.Gauge
	queueDepth           prometheus.Gauge
	activeVerifications  prometheus.Gauge
	documentQueue        prometheus.Gauge
	cpuUsage             prometheus.Gauge
	memoryUsage          prometheus.Gauge
}

type ServiceMetrics struct {
	TotalRequests        int64
	SuccessfulRequests   int64
	FailedRequests       int64
	ActiveConnections    int64
	QueueDepth          int64
	ActiveVerifications int64
	DocumentQueueSize   int64
	StartTime           time.Time
}

func NewStandaloneKYBService() *StandaloneKYBService {
	instanceID := fmt.Sprintf("kyb-instance-%d", time.Now().Unix())
	
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6380"
	}
	redisPassword := os.Getenv("REDIS_PASSWORD")
	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       0,
		PoolSize: 100,
	})

	dbHost := os.Getenv("POSTGRES_HOST")
	if dbHost == "" {
		dbHost = "localhost"
	}
	dbPort := os.Getenv("POSTGRES_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}
	dbUser := os.Getenv("POSTGRES_USER")
	if dbUser == "" {
		log.Fatal("POSTGRES_USER environment variable is required")
	}
	dbPassword := os.Getenv("POSTGRES_PASSWORD")
	if dbPassword == "" {
		log.Fatal("POSTGRES_PASSWORD environment variable is required")
	}
	dbName := os.Getenv("POSTGRES_DB")
	if dbName == "" {
		dbName = "kyb_db"
	}
	dbConfig := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable pool_max_conns=50",
		dbHost, dbPort, dbUser, dbPassword, dbName,
	)
	
	dbPool, err := pgxpool.Connect(context.Background(), dbConfig)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	
	// Initialize Prometheus metrics
	httpRequestsTotal := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "endpoint", "status"},
	)
	
	httpRequestDuration := prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_request_duration_seconds",
			Help: "HTTP request duration in seconds",
		},
		[]string{"method", "endpoint"},
	)
	
	activeConnections := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_connections",
			Help: "Number of active connections",
		},
	)
	
	queueDepth := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "queue_depth",
			Help: "Current queue depth for scaling decisions",
		},
	)
	
	activeVerifications := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_verifications",
			Help: "Number of active KYB verifications",
		},
	)
	
	documentQueue := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "document_queue_size",
			Help: "Size of document processing queue",
		},
	)
	
	cpuUsage := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "cpu_usage_percent",
			Help: "CPU usage percentage",
		},
	)
	
	memoryUsage := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "memory_usage_bytes",
			Help: "Memory usage in bytes",
		},
	)
	
	// Register metrics
	prometheus.MustRegister(httpRequestsTotal, httpRequestDuration, activeConnections, 
		queueDepth, activeVerifications, documentQueue, cpuUsage, memoryUsage)
	
	service := &StandaloneKYBService{
		redis:      redisClient,
		dbPool:     dbPool,
		instanceID: instanceID,
		metrics: &ServiceMetrics{
			StartTime: time.Now(),
		},
		httpRequestsTotal:     httpRequestsTotal,
		httpRequestDuration:   httpRequestDuration,
		activeConnections:     activeConnections,
		queueDepth:           queueDepth,
		activeVerifications:  activeVerifications,
		documentQueue:        documentQueue,
		cpuUsage:             cpuUsage,
		memoryUsage:          memoryUsage,
	}
	
	service.setupRoutes()
	service.startMetricsUpdater()
	
	return service
}

func (s *StandaloneKYBService) setupRoutes() {
	gin.SetMode(gin.ReleaseMode)
	s.router = gin.New()
	s.router.Use(gin.Recovery())
	s.router.Use(s.metricsMiddleware())
	
	// Health check
	s.router.GET("/health", s.healthCheck)
	s.router.GET("/ready", s.readinessCheck)
	
	// Metrics endpoint
	s.router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	
	// KYB endpoints
	s.router.POST("/api/v1/kyb/verify", s.verifyBusiness)
	s.router.GET("/api/v1/kyb/status/:id", s.getVerificationStatus)
	s.router.POST("/api/v1/kyb/documents", s.processDocuments)
	
	// Load testing endpoint
	s.router.GET("/api/v1/test/load", s.loadTestEndpoint)
	
	// Queue management
	s.router.POST("/api/v1/queue/add", s.addToQueue)
	s.router.GET("/api/v1/queue/stats", s.getQueueStats)
}

func (s *StandaloneKYBService) metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		atomic.AddInt64(&s.metrics.ActiveConnections, 1)
		s.activeConnections.Inc()
		
		c.Next()
		
		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())
		
		s.httpRequestsTotal.WithLabelValues(c.Request.Method, c.FullPath(), status).Inc()
		s.httpRequestDuration.WithLabelValues(c.Request.Method, c.FullPath()).Observe(duration.Seconds())
		
		atomic.AddInt64(&s.metrics.ActiveConnections, -1)
		s.activeConnections.Dec()
		
		if c.Writer.Status() >= 200 && c.Writer.Status() < 400 {
			atomic.AddInt64(&s.metrics.SuccessfulRequests, 1)
		} else {
			atomic.AddInt64(&s.metrics.FailedRequests, 1)
		}
		atomic.AddInt64(&s.metrics.TotalRequests, 1)
	}
}

func (s *StandaloneKYBService) healthCheck(c *gin.Context) {
	ctx := context.Background()
	checks := make(map[string]string)
	
	// Check Redis
	if err := s.redis.Ping(ctx).Err(); err != nil {
		checks["redis"] = "unhealthy: " + err.Error()
	} else {
		checks["redis"] = "healthy"
	}
	
	// Check PostgreSQL
	if err := s.dbPool.Ping(ctx); err != nil {
		checks["postgres"] = "unhealthy: " + err.Error()
	} else {
		checks["postgres"] = "healthy"
	}
	
	status := "healthy"
	for _, check := range checks {
		if check != "healthy" {
			status = "unhealthy"
			break
		}
	}
	
	c.JSON(http.StatusOK, gin.H{
		"status":     status,
		"instance":   s.instanceID,
		"checks":     checks,
		"uptime":     time.Since(s.metrics.StartTime).String(),
		"timestamp":  time.Now().UTC(),
	})
}

func (s *StandaloneKYBService) readinessCheck(c *gin.Context) {
	ctx := context.Background()
	
	// Check Redis
	if err := s.redis.Ping(ctx).Err(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ready":  false,
			"reason": "redis_unavailable",
			"error":  err.Error(),
		})
		return
	}
	
	// Check PostgreSQL
	if err := s.dbPool.Ping(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ready":  false,
			"reason": "postgres_unavailable",
			"error":  err.Error(),
		})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"ready":    true,
		"instance": s.instanceID,
	})
}

func (s *StandaloneKYBService) verifyBusiness(c *gin.Context) {
	var request struct {
		BusinessName string `json:"business_name"`
		TaxID        string `json:"tax_id"`
		Country      string `json:"country"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := context.Background()
	verificationID := fmt.Sprintf("kyb_%d", time.Now().UnixNano())
	
	// Check cache first
	cacheKey := fmt.Sprintf("kyb_cache:%s:%s", request.TaxID, request.Country)
	cached := s.redis.Get(ctx, cacheKey)
	if cached.Err() == nil {
		c.JSON(http.StatusOK, gin.H{
			"verification_id": verificationID,
			"status":         "completed",
			"cached":         true,
			"result":         "verified",
		})
		return
	}
	
	var count int
	err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM kyb_verifications WHERE tax_id = $1 AND country = $2", request.TaxID, request.Country).Scan(&count)
	if err != nil {
		log.Printf("DB query failed, continuing: %v", err)
	}

	_, insertErr := s.db.Exec(ctx,
		"INSERT INTO kyb_verifications (verification_id, business_name, tax_id, country, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
		verificationID, request.BusinessName, request.TaxID, request.Country, "processing", time.Now(),
	)
	if insertErr != nil {
		log.Printf("DB insert failed: %v", insertErr)
	}

	s.redis.Set(ctx, cacheKey, "processed", time.Minute*5)

	// Add to processing queue
	queueData, _ := json.Marshal(map[string]interface{}{
		"verification_id": verificationID,
		"business_name":   request.BusinessName,
		"tax_id":         request.TaxID,
		"country":        request.Country,
		"timestamp":      time.Now(),
	})
	
	s.redis.LPush(ctx, "kyb_processing_queue", queueData)
	atomic.AddInt64(&s.metrics.ActiveVerifications, 1)
	s.activeVerifications.Inc()
	
	c.JSON(http.StatusOK, gin.H{
		"verification_id": verificationID,
		"status":         "processing",
		"estimated_time": "30-60 seconds",
	})
}

func (s *StandaloneKYBService) getVerificationStatus(c *gin.Context) {
	verificationID := c.Param("id")
	ctx := context.Background()

	var businessName, taxID, country, status string
	var createdAt time.Time
	err := s.db.QueryRow(ctx,
		"SELECT business_name, tax_id, country, status, created_at FROM kyb_verifications WHERE verification_id = $1",
		verificationID,
	).Scan(&businessName, &taxID, &country, &status, &createdAt)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"verification_id": verificationID,
			"status":         "not_found",
			"timestamp":      time.Now().UTC(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"verification_id": verificationID,
		"business_name":  businessName,
		"tax_id":         taxID,
		"country":        country,
		"status":         status,
		"created_at":     createdAt,
		"timestamp":      time.Now().UTC(),
	})
}

func (s *StandaloneKYBService) processDocuments(c *gin.Context) {
	var request struct {
		Documents []string `json:"documents"`
		Type      string   `json:"type"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := context.Background()
	processingID := fmt.Sprintf("doc_%d", time.Now().UnixNano())
	
	// Add to document processing queue
	queueData, _ := json.Marshal(map[string]interface{}{
		"processing_id": processingID,
		"documents":     request.Documents,
		"type":         request.Type,
		"timestamp":    time.Now(),
	})
	
	s.redis.LPush(ctx, "document_processing_queue", queueData)
	atomic.AddInt64(&s.metrics.DocumentQueueSize, 1)
	s.documentQueue.Inc()
	
	c.JSON(http.StatusOK, gin.H{
		"processing_id": processingID,
		"status":       "queued",
		"queue_size":   s.redis.LLen(ctx, "document_processing_queue").Val(),
	})
}

func (s *StandaloneKYBService) loadTestEndpoint(c *gin.Context) {
	// Lightweight endpoint for load testing
	c.JSON(http.StatusOK, gin.H{
		"instance":   s.instanceID,
		"timestamp":  time.Now().UnixNano(),
		"status":     "ok",
		"requests":   atomic.LoadInt64(&s.metrics.TotalRequests),
	})
}

func (s *StandaloneKYBService) addToQueue(c *gin.Context) {
	var request struct {
		QueueName string      `json:"queue_name"`
		Data      interface{} `json:"data"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := context.Background()
	queueData, _ := json.Marshal(request.Data)
	result := s.redis.LPush(ctx, request.QueueName, queueData)
	
	c.JSON(http.StatusOK, gin.H{
		"queue_name": request.QueueName,
		"queue_size": result.Val(),
		"status":     "added",
	})
}

func (s *StandaloneKYBService) getQueueStats(c *gin.Context) {
	ctx := context.Background()
	
	kybQueueLen := s.redis.LLen(ctx, "kyb_processing_queue").Val()
	docQueueLen := s.redis.LLen(ctx, "document_processing_queue").Val()
	totalQueueDepth := kybQueueLen + docQueueLen
	
	s.queueDepth.Set(float64(totalQueueDepth))
	
	c.JSON(http.StatusOK, gin.H{
		"kyb_queue":      kybQueueLen,
		"document_queue": docQueueLen,
		"total_depth":    totalQueueDepth,
		"active_verifications": atomic.LoadInt64(&s.metrics.ActiveVerifications),
		"total_requests": atomic.LoadInt64(&s.metrics.TotalRequests),
		"successful_requests": atomic.LoadInt64(&s.metrics.SuccessfulRequests),
		"failed_requests": atomic.LoadInt64(&s.metrics.FailedRequests),
	})
}

func (s *StandaloneKYBService) startMetricsUpdater() {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		
		for range ticker.C {
			// Update CPU usage
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			s.memoryUsage.Set(float64(m.Alloc))
			
			// Update queue metrics
			ctx := context.Background()
			kybQueueLen := s.redis.LLen(ctx, "kyb_processing_queue").Val()
			docQueueLen := s.redis.LLen(ctx, "document_processing_queue").Val()
			s.queueDepth.Set(float64(kybQueueLen + docQueueLen))
		}
	}()
}

func (s *StandaloneKYBService) Run(port string) {
	log.Printf("🚀 Starting Standalone KYB Service on port %s", port)
	log.Printf("📊 Instance ID: %s", s.instanceID)
	log.Printf("🔗 Connected to Redis (localhost:6380) and PostgreSQL")
	log.Printf("📈 Metrics available at /metrics")
	log.Printf("🏥 Health check available at /health")
	
	if err := s.router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	service := NewStandaloneKYBService()
	service.Run(port)
}

