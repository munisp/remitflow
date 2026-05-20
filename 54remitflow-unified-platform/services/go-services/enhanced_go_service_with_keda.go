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

// Enhanced service with KEDA-compatible metrics
type KEDAEnhancedService struct {
	router     *gin.Engine
	redis      *redis.ClusterClient
	dbPool     *pgxpool.Pool
	instanceID string
	metrics    *KEDAMetrics
	
	// Prometheus metrics for KEDA
	httpRequestsTotal     *prometheus.CounterVec
	httpRequestDuration   *prometheus.HistogramVec
	activeConnections     prometheus.Gauge
	queueDepth           prometheus.Gauge
	activeVerifications  prometheus.Gauge
	documentQueue        prometheus.Gauge
	cpuUsage             prometheus.Gauge
	memoryUsage          prometheus.Gauge
}

type KEDAMetrics struct {
	TotalRequests        int64
	SuccessfulRequests   int64
	FailedRequests       int64
	ActiveConnections    int64
	QueueDepth          int64
	ActiveVerifications int64
	DocumentQueueSize   int64
	StartTime           time.Time
}

func NewKEDAEnhancedService() *KEDAEnhancedService {
	// Optimize for container environment
	if cpuLimit := os.Getenv("CPU_LIMIT"); cpuLimit != "" {
		if limit, err := strconv.Atoi(cpuLimit); err == nil {
			runtime.GOMAXPROCS(limit)
		}
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	// Redis cluster connection with enhanced configuration
	redisCluster := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{
			"redis-0:6379", "redis-1:6379", "redis-2:6379",
			"redis-3:6379", "redis-4:6379", "redis-5:6379",
		},
		PoolSize:           300,  // Increased for KEDA scaling
		MinIdleConns:       100,
		MaxRetries:         3,
		DialTimeout:        time.Second * 5,
		ReadTimeout:        time.Second * 3,
		WriteTimeout:       time.Second * 3,
		PoolTimeout:        time.Second * 4,
		IdleTimeout:        time.Minute * 5,
		IdleCheckFrequency: time.Minute,
	})

	// Enhanced database connection pool
	dbConfig, _ := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	dbConfig.MaxConns = 150        // Increased for KEDA scaling
	dbConfig.MinConns = 30
	dbConfig.MaxConnLifetime = time.Hour
	dbConfig.MaxConnIdleTime = time.Minute * 30
	dbConfig.HealthCheckPeriod = time.Minute

	dbPool, err := pgxpool.ConnectConfig(context.Background(), dbConfig)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	service := &KEDAEnhancedService{
		router:     router,
		redis:      redisCluster,
		dbPool:     dbPool,
		instanceID: os.Getenv("POD_NAME"),
		metrics: &KEDAMetrics{
			StartTime: time.Now(),
		},
	}

	service.initPrometheusMetrics()
	service.setupRoutes()
	service.startMetricsUpdater()

	return service
}

func (s *KEDAEnhancedService) initPrometheusMetrics() {
	// HTTP request metrics
	s.httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "endpoint", "status", "instance"},
	)

	s.httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "endpoint", "instance"},
	)

	// KEDA scaling metrics
	s.activeConnections = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_connections_total",
			Help: "Number of active connections",
		},
	)

	s.queueDepth = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "kyb_processing_queue_size",
			Help: "Size of KYB processing queue",
		},
	)

	s.activeVerifications = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "kyb_active_verifications_total",
			Help: "Number of active KYB verifications",
		},
	)

	s.documentQueue = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "document_processing_queue_size",
			Help: "Size of document processing queue",
		},
	)

	s.cpuUsage = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "cpu_usage_percentage",
			Help: "CPU usage percentage",
		},
	)

	s.memoryUsage = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "memory_usage_percentage",
			Help: "Memory usage percentage",
		},
	)

	// Register metrics
	prometheus.MustRegister(
		s.httpRequestsTotal,
		s.httpRequestDuration,
		s.activeConnections,
		s.queueDepth,
		s.activeVerifications,
		s.documentQueue,
		s.cpuUsage,
		s.memoryUsage,
	)
}

func (s *KEDAEnhancedService) setupRoutes() {
	// Add metrics middleware
	s.router.Use(s.metricsMiddleware())

	// Health and readiness endpoints
	s.router.GET("/api/v1/health", s.healthCheck)
	s.router.GET("/api/v1/ready", s.readinessCheck)
	s.router.GET("/api/v1/metrics", gin.WrapH(promhttp.Handler()))

	// Business endpoints
	s.router.POST("/api/v1/process", s.processRequest)
	s.router.POST("/api/v1/bulk-process", s.bulkProcess)
	s.router.POST("/api/v1/kyb/verify", s.kybVerify)
	s.router.POST("/api/v1/document/process", s.processDocument)

	// KEDA scaling endpoints
	s.router.GET("/api/v1/keda/metrics", s.kedaMetrics)
	s.router.POST("/api/v1/queue/add", s.addToQueue)
	s.router.GET("/api/v1/queue/status", s.queueStatus)
}

func (s *KEDAEnhancedService) metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		atomic.AddInt64(&s.metrics.TotalRequests, 1)
		atomic.AddInt64(&s.metrics.ActiveConnections, 1)

		c.Next()

		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())

		// Update Prometheus metrics
		s.httpRequestsTotal.WithLabelValues(
			c.Request.Method,
			c.FullPath(),
			status,
			s.instanceID,
		).Inc()

		s.httpRequestDuration.WithLabelValues(
			c.Request.Method,
			c.FullPath(),
			s.instanceID,
		).Observe(duration.Seconds())

		atomic.AddInt64(&s.metrics.ActiveConnections, -1)

		if c.Writer.Status() >= 200 && c.Writer.Status() < 400 {
			atomic.AddInt64(&s.metrics.SuccessfulRequests, 1)
		} else {
			atomic.AddInt64(&s.metrics.FailedRequests, 1)
		}
	}
}

func (s *KEDAEnhancedService) healthCheck(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 100*time.Millisecond)
	defer cancel()

	healthy := true
	checks := make(map[string]string)

	// Check Redis
	if err := s.redis.Ping(ctx).Err(); err != nil {
		healthy = false
		checks["redis"] = "unhealthy: " + err.Error()
	} else {
		checks["redis"] = "healthy"
	}

	// Check Database
	if err := s.dbPool.Ping(ctx); err != nil {
		healthy = false
		checks["database"] = "unhealthy: " + err.Error()
	} else {
		checks["database"] = "healthy"
	}

	status := http.StatusOK
	if !healthy {
		status = http.StatusServiceUnavailable
	}

	uptime := time.Since(s.metrics.StartTime).Seconds()
	currentRPS := float64(atomic.LoadInt64(&s.metrics.TotalRequests)) / uptime

	response := gin.H{
		"status":           map[bool]string{true: "healthy", false: "unhealthy"}[healthy],
		"instance":         s.instanceID,
		"uptime_seconds":   int64(uptime),
		"current_rps":      int64(currentRPS),
		"total_requests":   atomic.LoadInt64(&s.metrics.TotalRequests),
		"success_rate":     s.calculateSuccessRate(),
		"active_connections": atomic.LoadInt64(&s.metrics.ActiveConnections),
		"checks":           checks,
		"timestamp":        time.Now().Unix(),
	}

	c.JSON(status, response)
}

func (s *KEDAEnhancedService) readinessCheck(c *gin.Context) {
	// More strict readiness check for KEDA
	ctx, cancel := context.WithTimeout(c.Request.Context(), 50*time.Millisecond)
	defer cancel()

	// Check if service can handle requests
	if atomic.LoadInt64(&s.metrics.ActiveConnections) > 1000 {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "not_ready",
			"reason": "too_many_active_connections",
			"active_connections": atomic.LoadInt64(&s.metrics.ActiveConnections),
		})
		return
	}

	// Quick health checks
	if err := s.redis.Ping(ctx).Err(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "not_ready",
			"reason": "redis_unavailable",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ready",
		"instance": s.instanceID,
		"active_connections": atomic.LoadInt64(&s.metrics.ActiveConnections),
	})
}

func (s *KEDAEnhancedService) processRequest(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// Simulate business logic processing
	processingTime := time.Millisecond * 10 // Base processing time

	// Check cache first
	cacheKey := fmt.Sprintf("process:%s", c.GetHeader("X-Request-ID"))
	cached := s.redis.Get(ctx, cacheKey)
	if cached.Err() == nil {
		c.JSON(http.StatusOK, gin.H{
			"result":              "processed",
			"cached":              true,
			"instance":            s.instanceID,
			"processing_time_ms":  0.5,
			"timestamp":           time.Now().Unix(),
		})
		return
	}

	// Simulate database operation
	time.Sleep(processingTime)

	// Cache result
	s.redis.Set(ctx, cacheKey, "processed", time.Minute*5)

	c.JSON(http.StatusOK, gin.H{
		"result":              "processed",
		"cached":              false,
		"instance":            s.instanceID,
		"processing_time_ms":  processingTime.Milliseconds(),
		"timestamp":           time.Now().Unix(),
	})
}

func (s *KEDAEnhancedService) kybVerify(c *gin.Context) {
	// Simulate KYB verification process
	atomic.AddInt64(&s.metrics.ActiveVerifications, 1)
	defer atomic.AddInt64(&s.metrics.ActiveVerifications, -1)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// Simulate complex verification process
	time.Sleep(time.Millisecond * 50)

	// Add to processing queue for background work
	queueItem := map[string]interface{}{
		"type":       "kyb_verification",
		"request_id": c.GetHeader("X-Request-ID"),
		"timestamp":  time.Now().Unix(),
		"instance":   s.instanceID,
	}

	queueData, _ := json.Marshal(queueItem)
	s.redis.LPush(ctx, "kyb_processing_queue", queueData)
	atomic.AddInt64(&s.metrics.QueueDepth, 1)

	c.JSON(http.StatusOK, gin.H{
		"status":              "verification_started",
		"verification_id":     fmt.Sprintf("kyb_%d", time.Now().UnixNano()),
		"instance":            s.instanceID,
		"estimated_completion": time.Now().Add(time.Minute * 5).Unix(),
		"queue_position":      atomic.LoadInt64(&s.metrics.QueueDepth),
	})
}

func (s *KEDAEnhancedService) processDocument(c *gin.Context) {
	// Simulate document processing
	atomic.AddInt64(&s.metrics.DocumentQueueSize, 1)
	defer atomic.AddInt64(&s.metrics.DocumentQueueSize, -1)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	// Simulate OCR processing time
	time.Sleep(time.Millisecond * 100)

	// Add to document processing queue
	queueItem := map[string]interface{}{
		"type":       "document_processing",
		"request_id": c.GetHeader("X-Request-ID"),
		"timestamp":  time.Now().Unix(),
		"instance":   s.instanceID,
	}

	queueData, _ := json.Marshal(queueItem)
	s.redis.LPush(ctx, "document_processing_queue", queueData)

	c.JSON(http.StatusOK, gin.H{
		"status":              "document_processing_started",
		"document_id":         fmt.Sprintf("doc_%d", time.Now().UnixNano()),
		"instance":            s.instanceID,
		"estimated_completion": time.Now().Add(time.Minute * 2).Unix(),
		"processing_engines":  []string{"EasyOCR", "PaddleOCR", "TrOCR", "OLMOCR", "GOT-OCR2.0"},
	})
}

func (s *KEDAEnhancedService) addToQueue(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	var request struct {
		QueueName string      `json:"queue_name"`
		Data      interface{} `json:"data"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	queueData, _ := json.Marshal(request.Data)
	result := s.redis.LPush(ctx, request.QueueName, queueData)

	if request.QueueName == "kyb_processing_queue" {
		atomic.AddInt64(&s.metrics.QueueDepth, 1)
	} else if request.QueueName == "document_processing_queue" {
		atomic.AddInt64(&s.metrics.DocumentQueueSize, 1)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       "added_to_queue",
		"queue_name":   request.QueueName,
		"queue_length": result.Val(),
		"instance":     s.instanceID,
	})
}

func (s *KEDAEnhancedService) queueStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 1*time.Second)
	defer cancel()

	kybQueueLen := s.redis.LLen(ctx, "kyb_processing_queue").Val()
	docQueueLen := s.redis.LLen(ctx, "document_processing_queue").Val()

	c.JSON(http.StatusOK, gin.H{
		"queues": map[string]interface{}{
			"kyb_processing_queue": map[string]interface{}{
				"length":     kybQueueLen,
				"active":     atomic.LoadInt64(&s.metrics.ActiveVerifications),
				"total_processed": atomic.LoadInt64(&s.metrics.QueueDepth),
			},
			"document_processing_queue": map[string]interface{}{
				"length":     docQueueLen,
				"active":     atomic.LoadInt64(&s.metrics.DocumentQueueSize),
				"total_processed": atomic.LoadInt64(&s.metrics.DocumentQueueSize),
			},
		},
		"instance": s.instanceID,
		"timestamp": time.Now().Unix(),
	})
}

func (s *KEDAEnhancedService) kedaMetrics(c *gin.Context) {
	uptime := time.Since(s.metrics.StartTime).Seconds()
	currentRPS := float64(atomic.LoadInt64(&s.metrics.TotalRequests)) / uptime

	c.JSON(http.StatusOK, gin.H{
		"keda_metrics": map[string]interface{}{
			"http_requests_per_second":     currentRPS,
			"active_connections":           atomic.LoadInt64(&s.metrics.ActiveConnections),
			"kyb_processing_queue_depth":   atomic.LoadInt64(&s.metrics.QueueDepth),
			"document_processing_queue_depth": atomic.LoadInt64(&s.metrics.DocumentQueueSize),
			"active_kyb_verifications":     atomic.LoadInt64(&s.metrics.ActiveVerifications),
			"cpu_usage_percentage":         s.getCPUUsage(),
			"memory_usage_percentage":      s.getMemoryUsage(),
			"success_rate_percentage":      s.calculateSuccessRate() * 100,
		},
		"instance": s.instanceID,
		"timestamp": time.Now().Unix(),
		"uptime_seconds": int64(uptime),
	})
}

func (s *KEDAEnhancedService) bulkProcess(c *gin.Context) {
	var request struct {
		Items []map[string]interface{} `json:"items"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	results := make([]map[string]interface{}, len(request.Items))
	
	// Process items in batches to avoid overwhelming the system
	batchSize := 10
	for i := 0; i < len(request.Items); i += batchSize {
		end := i + batchSize
		if end > len(request.Items) {
			end = len(request.Items)
		}

		// Process batch
		for j := i; j < end; j++ {
			// Simulate processing
			time.Sleep(time.Millisecond * 5)
			results[j] = map[string]interface{}{
				"index":     j,
				"status":    "processed",
				"instance":  s.instanceID,
				"timestamp": time.Now().Unix(),
			}
		}

		// Small delay between batches
		if end < len(request.Items) {
			time.Sleep(time.Millisecond * 10)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status":           "bulk_processing_complete",
		"total_items":      len(request.Items),
		"processed_items":  len(results),
		"instance":         s.instanceID,
		"processing_time_ms": time.Since(time.Now()).Milliseconds(),
		"results":          results,
	})
}

func (s *KEDAEnhancedService) startMetricsUpdater() {
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			s.updatePrometheusMetrics()
		}
	}()
}

func (s *KEDAEnhancedService) updatePrometheusMetrics() {
	// Update Prometheus gauges with current values
	s.activeConnections.Set(float64(atomic.LoadInt64(&s.metrics.ActiveConnections)))
	s.queueDepth.Set(float64(atomic.LoadInt64(&s.metrics.QueueDepth)))
	s.activeVerifications.Set(float64(atomic.LoadInt64(&s.metrics.ActiveVerifications)))
	s.documentQueue.Set(float64(atomic.LoadInt64(&s.metrics.DocumentQueueSize)))
	s.cpuUsage.Set(s.getCPUUsage())
	s.memoryUsage.Set(s.getMemoryUsage())
}

func (s *KEDAEnhancedService) calculateSuccessRate() float64 {
	total := atomic.LoadInt64(&s.metrics.TotalRequests)
	if total == 0 {
		return 1.0
	}
	successful := atomic.LoadInt64(&s.metrics.SuccessfulRequests)
	return float64(successful) / float64(total)
}

func (s *KEDAEnhancedService) getCPUUsage() float64 {
	// Simplified CPU usage calculation
	// In production, use proper system metrics
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(runtime.NumGoroutine()) / 1000.0 * 100 // Rough approximation
}

func (s *KEDAEnhancedService) getMemoryUsage() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	// Convert bytes to percentage (assuming 8GB limit)
	return float64(m.Alloc) / (8 * 1024 * 1024 * 1024) * 100
}

func (s *KEDAEnhancedService) Start() {
	server := &http.Server{
		Addr:           ":8080",
		Handler:        s.router,
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   15 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	log.Printf("🚀 Starting KEDA-enhanced service instance %s on :8080", s.instanceID)
	log.Printf("🎯 KEDA autoscaling enabled with multiple triggers")
	log.Printf("📊 Prometheus metrics available at /api/v1/metrics")
	log.Printf("🔗 Connected to Redis cluster and PostgreSQL")
	log.Printf("⚡ Ready for event-driven scaling")

	if err := server.ListenAndServe(); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}

func main() {
	service := NewKEDAEnhancedService()
	service.Start()
}

