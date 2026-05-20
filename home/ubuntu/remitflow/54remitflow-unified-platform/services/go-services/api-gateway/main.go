import os
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Configuration structures
type Config struct {
	Port                string            `json:"port"`
	JWTSecret          string            `json:"jwt_secret"`
	RedisURL           string            `json:"redis_url"`
	Services           map[string]string `json:"services"`
	RateLimits         RateLimitConfig   `json:"rate_limits"`
	CircuitBreaker     CircuitConfig     `json:"circuit_breaker"`
	LoadBalancer       LoadBalancerConfig `json:"load_balancer"`
	SecurityConfig     SecurityConfig    `json:"security"`
	MonitoringConfig   MonitoringConfig  `json:"monitoring"`
}

type RateLimitConfig struct {
	RequestsPerMinute int `json:"requests_per_minute"`
	BurstSize         int `json:"burst_size"`
}

type CircuitConfig struct {
	FailureThreshold int           `json:"failure_threshold"`
	RecoveryTimeout  time.Duration `json:"recovery_timeout"`
	RequestTimeout   time.Duration `json:"request_timeout"`
}

type LoadBalancerConfig struct {
	Algorithm string   `json:"algorithm"`
	Backends  []string `json:"backends"`
}

type SecurityConfig struct {
	EnableHTTPS       bool     `json:"enable_https"`
	CertFile          string   `json:"cert_file"`
	KeyFile           string   `json:"key_file"`
	AllowedOrigins    []string `json:"allowed_origins"`
	TrustedProxies    []string `json:"trusted_proxies"`
	EnableCSRF        bool     `json:"enable_csrf"`
	EnableHSTS        bool     `json:"enable_hsts"`
}

type MonitoringConfig struct {
	EnableMetrics     bool   `json:"enable_metrics"`
	EnableTracing     bool   `json:"enable_tracing"`
	MetricsPath       string `json:"metrics_path"`
	HealthCheckPath   string `json:"health_check_path"`
}

// Service structures
type APIGateway struct {
	config         *Config
	logger         *zap.Logger
	redisClient    *redis.Client
	circuitBreaker *CircuitBreaker
	loadBalancer   *LoadBalancer
	rateLimiter    *RateLimiter
	metrics        *Metrics
	router         *gin.Engine
}

type CircuitBreaker struct {
	mu               sync.RWMutex
	failureCount     int
	lastFailureTime  time.Time
	state            CircuitState
	config           CircuitConfig
}

type CircuitState int

const (
	Closed CircuitState = iota
	Open
	HalfOpen
)

type LoadBalancer struct {
	mu        sync.RWMutex
	backends  []string
	current   int
	algorithm string
	health    map[string]bool
}

type RateLimiter struct {
	redisClient *redis.Client
	config      RateLimitConfig
}

type Metrics struct {
	RequestsTotal     *prometheus.CounterVec
	RequestDuration   *prometheus.HistogramVec
	ActiveConnections prometheus.Gauge
	CircuitBreakerState prometheus.Gauge
	BackendHealth     *prometheus.GaugeVec
}

// JWT Claims structure
type Claims struct {
	UserID   string   `json:"user_id"`
	UserType string   `json:"user_type"`
	Roles    []string `json:"roles"`
	AgentID  string   `json:"agent_id,omitempty"`
	jwt.RegisteredClaims
}

// Request/Response structures
type ProxyRequest struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    interface{}       `json:"body"`
}

type ProxyResponse struct {
	StatusCode int                    `json:"status_code"`
	Headers    map[string]string      `json:"headers"`
	Body       interface{}            `json:"body"`
	Latency    time.Duration          `json:"latency"`
	Backend    string                 `json:"backend"`
	Cached     bool                   `json:"cached"`
}

type HealthCheck struct {
	Status    string            `json:"status"`
	Timestamp time.Time         `json:"timestamp"`
	Services  map[string]string `json:"services"`
	Version   string            `json:"version"`
	Uptime    time.Duration     `json:"uptime"`
}

func main() {
	// Initialize logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Load configuration
	config := loadConfig()

	// Initialize API Gateway
	gateway := &APIGateway{
		config: config,
		logger: logger,
	}

	// Initialize components
	if err := gateway.initialize(); err != nil {
		logger.Fatal("Failed to initialize API Gateway", zap.Error(err))
	}

	// Setup routes
	gateway.setupRoutes()

	// Start server
	gateway.start()
}

func loadConfig() *Config {
	config := &Config{
		Port:      getEnv("PORT", "8080"),
		JWTSecret: getEnv("JWT_SECRET", "your-secret-key"),
		RedisURL:  getEnv("REDIS_URL", "redis://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):6379"),
		Services: map[string]string{
			"agent-management":      getEnv("AGENT_MANAGEMENT_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8081"),
			"customer-management":   getEnv("CUSTOMER_MANAGEMENT_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8082"),
			"transaction-processing": getEnv("TRANSACTION_PROCESSING_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8083"),
			"fraud-detection":       getEnv("FRAUD_DETECTION_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8084"),
			"notification":          getEnv("NOTIFICATION_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8085"),
			"audit-compliance":      getEnv("AUDIT_COMPLIANCE_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8086"),
			"commission-settlement": getEnv("COMMISSION_SETTLEMENT_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8087"),
			"cash-management":       getEnv("CASH_MANAGEMENT_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")")"):8088"),
		},
		RateLimits: RateLimitConfig{
			RequestsPerMinute: 1000,
			BurstSize:         100,
		},
		CircuitBreaker: CircuitConfig{
			FailureThreshold: 5,
			RecoveryTimeout:  30 * time.Second,
			RequestTimeout:   10 * time.Second,
		},
		LoadBalancer: LoadBalancerConfig{
			Algorithm: "round_robin",
			Backends:  []string{},
		},
		SecurityConfig: SecurityConfig{
			EnableHTTPS:    false,
			AllowedOrigins: []string{"*"},
			TrustedProxies: []string{"127.0.0.1"},
			EnableCSRF:     false,
			EnableHSTS:     false,
		},
		MonitoringConfig: MonitoringConfig{
			EnableMetrics:   true,
			EnableTracing:   true,
			MetricsPath:     "/metrics",
			HealthCheckPath: "/health",
		},
	}

	return config
}

func (gw *APIGateway) initialize() error {
	// Initialize Redis client
	opt, err := redis.ParseURL(gw.config.RedisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	gw.redisClient = redis.NewClient(opt)

	// Test Redis connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := gw.redisClient.Ping(ctx).Err(); err != nil {
		gw.logger.Warn("Redis connection failed, continuing without cache", zap.Error(err))
	}

	// Initialize circuit breaker
	gw.circuitBreaker = &CircuitBreaker{
		config: gw.config.CircuitBreaker,
		state:  Closed,
	}

	// Initialize load balancer
	gw.loadBalancer = &LoadBalancer{
		backends:  gw.config.LoadBalancer.Backends,
		algorithm: gw.config.LoadBalancer.Algorithm,
		health:    make(map[string]bool),
	}

	// Initialize rate limiter
	gw.rateLimiter = &RateLimiter{
		redisClient: gw.redisClient,
		config:      gw.config.RateLimits,
	}

	// Initialize metrics
	gw.initializeMetrics()

	// Initialize Gin router
	if os.Getenv("GIN_MODE") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	gw.router = gin.New()

	// Setup middleware
	gw.setupMiddleware()

	return nil
}

func (gw *APIGateway) initializeMetrics() {
	gw.metrics = &Metrics{
		RequestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "api_gateway_requests_total",
				Help: "Total number of requests processed by the API gateway",
			},
			[]string{"method", "path", "status", "service"},
		),
		RequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "api_gateway_request_duration_seconds",
				Help:    "Request duration in seconds",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"method", "path", "service"},
		),
		ActiveConnections: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "api_gateway_active_connections",
				Help: "Number of active connections",
			},
		),
		CircuitBreakerState: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "api_gateway_circuit_breaker_state",
				Help: "Circuit breaker state (0=closed, 1=open, 2=half-open)",
			},
		),
		BackendHealth: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "api_gateway_backend_health",
				Help: "Backend service health status",
			},
			[]string{"service"},
		),
	}

	// Register metrics
	prometheus.MustRegister(
		gw.metrics.RequestsTotal,
		gw.metrics.RequestDuration,
		gw.metrics.ActiveConnections,
		gw.metrics.CircuitBreakerState,
		gw.metrics.BackendHealth,
	)
}

func (gw *APIGateway) setupMiddleware() {
	// Recovery middleware
	gw.router.Use(gin.Recovery())

	// Logger middleware
	gw.router.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s %s %d %s \"%s\" %s\"\n",
			param.ClientIP,
			param.TimeStamp.Format(time.RFC1123),
			param.Method,
			param.Path,
			param.Request.Proto,
			param.StatusCode,
			param.Latency,
			param.Request.UserAgent(),
			param.ErrorMessage,
		)
	}))

	// CORS middleware
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = gw.config.SecurityConfig.AllowedOrigins
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization", "X-Requested-With"}
	corsConfig.AllowCredentials = true
	gw.router.Use(cors.New(corsConfig))

	// Security headers middleware
	gw.router.Use(gw.securityHeadersMiddleware())

	// Rate limiting middleware
	gw.router.Use(gw.rateLimitMiddleware())

	// Metrics middleware
	gw.router.Use(gw.metricsMiddleware())

	// Authentication middleware (applied to protected routes)
	// This will be applied selectively in setupRoutes
}

func (gw *APIGateway) setupRoutes() {
	// Health check endpoint
	gw.router.GET(gw.config.MonitoringConfig.HealthCheckPath, gw.healthCheckHandler)

	// Metrics endpoint
	if gw.config.MonitoringConfig.EnableMetrics {
		gw.router.GET(gw.config.MonitoringConfig.MetricsPath, gin.WrapH(promhttp.Handler()))
	}

	// Authentication endpoints (no auth required)
	auth := gw.router.Group("/api/v1/auth")
	{
		auth.POST("/login", gw.loginHandler)
		auth.POST("/refresh", gw.refreshTokenHandler)
		auth.POST("/logout", gw.logoutHandler)
	}

	// Protected API routes
	api := gw.router.Group("/api/v1")
	api.Use(gw.authMiddleware())
	{
		// Agent Management Service
		agents := api.Group("/agents")
		{
			agents.GET("", gw.proxyHandler("agent-management"))
			agents.POST("", gw.proxyHandler("agent-management"))
			agents.GET("/:id", gw.proxyHandler("agent-management"))
			agents.PUT("/:id", gw.proxyHandler("agent-management"))
			agents.DELETE("/:id", gw.proxyHandler("agent-management"))
			agents.GET("/:id/transactions", gw.proxyHandler("agent-management"))
			agents.POST("/:id/float", gw.proxyHandler("agent-management"))
		}

		// Customer Management Service
		customers := api.Group("/customers")
		{
			customers.GET("", gw.proxyHandler("customer-management"))
			customers.POST("", gw.proxyHandler("customer-management"))
			customers.GET("/:id", gw.proxyHandler("customer-management"))
			customers.PUT("/:id", gw.proxyHandler("customer-management"))
			customers.DELETE("/:id", gw.proxyHandler("customer-management"))
			customers.GET("/:id/transactions", gw.proxyHandler("customer-management"))
			customers.POST("/:id/kyc", gw.proxyHandler("customer-management"))
		}

		// Transaction Processing Service
		transactions := api.Group("/transactions")
		{
			transactions.GET("", gw.proxyHandler("transaction-processing"))
			transactions.POST("", gw.proxyHandler("transaction-processing"))
			transactions.GET("/:id", gw.proxyHandler("transaction-processing"))
			transactions.PUT("/:id", gw.proxyHandler("transaction-processing"))
			transactions.POST("/:id/reverse", gw.proxyHandler("transaction-processing"))
			transactions.GET("/:id/status", gw.proxyHandler("transaction-processing"))
		}

		// Fraud Detection Service
		fraud := api.Group("/fraud")
		{
			fraud.GET("/alerts", gw.proxyHandler("fraud-detection"))
			fraud.GET("/alerts/:id", gw.proxyHandler("fraud-detection"))
			fraud.PUT("/alerts/:id", gw.proxyHandler("fraud-detection"))
			fraud.POST("/analyze", gw.proxyHandler("fraud-detection"))
			fraud.GET("/rules", gw.proxyHandler("fraud-detection"))
			fraud.POST("/rules", gw.proxyHandler("fraud-detection"))
		}

		// Notification Service
		notifications := api.Group("/notifications")
		{
			notifications.GET("", gw.proxyHandler("notification"))
			notifications.POST("", gw.proxyHandler("notification"))
			notifications.GET("/:id", gw.proxyHandler("notification"))
			notifications.PUT("/:id/read", gw.proxyHandler("notification"))
		}

		// Audit & Compliance Service
		audit := api.Group("/audit")
		{
			audit.GET("/logs", gw.proxyHandler("audit-compliance"))
			audit.GET("/reports", gw.proxyHandler("audit-compliance"))
			audit.POST("/reports", gw.proxyHandler("audit-compliance"))
			audit.GET("/compliance", gw.proxyHandler("audit-compliance"))
		}

		// Commission Settlement Service
		commissions := api.Group("/commissions")
		{
			commissions.GET("", gw.proxyHandler("commission-settlement"))
			commissions.POST("/calculate", gw.proxyHandler("commission-settlement"))
			commissions.POST("/settle", gw.proxyHandler("commission-settlement"))
			commissions.GET("/reports", gw.proxyHandler("commission-settlement"))
		}

		// Cash Management Service
		cash := api.Group("/cash")
		{
			cash.GET("/balances", gw.proxyHandler("cash-management"))
			cash.POST("/float", gw.proxyHandler("cash-management"))
			cash.GET("/reconciliation", gw.proxyHandler("cash-management"))
			cash.POST("/reconciliation", gw.proxyHandler("cash-management"))
		}
	}

	// WebSocket endpoints for real-time features
	gw.router.GET("/ws/notifications", gw.websocketHandler)
	gw.router.GET("/ws/transactions", gw.websocketHandler)

	// Admin endpoints (require admin role)
	admin := gw.router.Group("/admin")
	admin.Use(gw.authMiddleware(), gw.adminMiddleware())
	{
		admin.GET("/services", gw.servicesStatusHandler)
		admin.POST("/services/:service/restart", gw.restartServiceHandler)
		admin.GET("/metrics", gw.adminMetricsHandler)
		admin.POST("/cache/clear", gw.clearCacheHandler)
	}
}

// Middleware implementations
func (gw *APIGateway) securityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		
		if gw.config.SecurityConfig.EnableHSTS {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		
		c.Next()
	}
}

func (gw *APIGateway) rateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		
		if !gw.rateLimiter.Allow(c.Request.Context(), clientIP) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
				"retry_after": 60,
			})
			c.Abort()
			return
		}
		
		c.Next()
	}
}

func (gw *APIGateway) metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		
		gw.metrics.ActiveConnections.Inc()
		defer gw.metrics.ActiveConnections.Dec()
		
		c.Next()
		
		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())
		
		gw.metrics.RequestsTotal.WithLabelValues(
			c.Request.Method,
			c.FullPath(),
			status,
			"gateway",
		).Inc()
		
		gw.metrics.RequestDuration.WithLabelValues(
			c.Request.Method,
			c.FullPath(),
			"gateway",
		).Observe(duration.Seconds())
	}
}

func (gw *APIGateway) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Bearer token required"})
			c.Abort()
			return
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(gw.config.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		// Set user context
		c.Set("user_id", claims.UserID)
		c.Set("user_type", claims.UserType)
		c.Set("roles", claims.Roles)
		c.Set("agent_id", claims.AgentID)

		c.Next()
	}
}

func (gw *APIGateway) adminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		roles, exists := c.Get("roles")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
			c.Abort()
			return
		}

		roleList, ok := roles.([]string)
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "Invalid roles"})
			c.Abort()
			return
		}

		hasAdminRole := false
		for _, role := range roleList {
			if role == "admin" || role == "super_admin" {
				hasAdminRole = true
				break
			}
		}

		if !hasAdminRole {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// Handler implementations
func (gw *APIGateway) healthCheckHandler(c *gin.Context) {
	startTime := time.Now()
	
	health := HealthCheck{
		Status:    "healthy",
		Timestamp: time.Now(),
		Services:  make(map[string]string),
		Version:   "2.0.0",
		Uptime:    time.Since(startTime),
	}

	// Check backend services
	for serviceName, serviceURL := range gw.config.Services {
		status := gw.checkServiceHealth(serviceURL)
		health.Services[serviceName] = status
		
		if status != "healthy" {
			health.Status = "degraded"
		}
	}

	c.JSON(http.StatusOK, health)
}

func (gw *APIGateway) loginHandler(c *gin.Context) {
	// This would typically validate credentials against the user service
	// For now, we'll create a mock implementation
	
	var loginReq struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
		UserType string `json:"user_type"`
	}

	if err := c.ShouldBindJSON(&loginReq); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Mock authentication - in production, validate against user service
	if loginReq.Username == "" || loginReq.Password == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Create JWT token
	claims := &Claims{
		UserID:   "user_" + loginReq.Username,
		UserType: loginReq.UserType,
		Roles:    []string{"user"},
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(gw.config.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      tokenString,
		"expires_at": claims.ExpiresAt.Time,
		"user_type":  claims.UserType,
	})
}

func (gw *APIGateway) refreshTokenHandler(c *gin.Context) {
	// Implementation for token refresh
	c.JSON(http.StatusOK, gin.H{"message": "Token refreshed"})
}

func (gw *APIGateway) logoutHandler(c *gin.Context) {
	// Implementation for logout (token blacklisting)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func (gw *APIGateway) proxyHandler(serviceName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		serviceURL, exists := gw.config.Services[serviceName]
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
			return
		}

		// Check circuit breaker
		if !gw.circuitBreaker.Allow() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Service temporarily unavailable"})
			return
		}

		// Create proxy request
		target, err := url.Parse(serviceURL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid service URL"})
			return
		}

		proxy := httputil.NewSingleHostReverseProxy(target)
		
		// Customize the proxy
		proxy.ModifyResponse = func(resp *http.Response) error {
			// Add custom headers
			resp.Header.Set("X-Proxied-By", "Remittance-Gateway")
			return nil
		}

		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			gw.circuitBreaker.RecordFailure()
			gw.logger.Error("Proxy error", zap.Error(err), zap.String("service", serviceName))
			
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(gin.H{"error": "Service unavailable"})
		}

		// Record success
		defer gw.circuitBreaker.RecordSuccess()

		// Forward the request
		proxy.ServeHTTP(c.Writer, c.Request)
	}
}

func (gw *APIGateway) websocketHandler(c *gin.Context) {
	// WebSocket implementation for real-time features
	c.JSON(http.StatusNotImplemented, gin.H{"message": "WebSocket endpoint - implementation pending"})
}

func (gw *APIGateway) servicesStatusHandler(c *gin.Context) {
	services := make(map[string]interface{})
	
	for serviceName, serviceURL := range gw.config.Services {
		status := gw.checkServiceHealth(serviceURL)
		services[serviceName] = gin.H{
			"url":    serviceURL,
			"status": status,
		}
	}

	c.JSON(http.StatusOK, gin.H{"services": services})
}

func (gw *APIGateway) restartServiceHandler(c *gin.Context) {
	serviceName := c.Param("service")
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Restart signal sent to %s", serviceName)})
}

func (gw *APIGateway) adminMetricsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Admin metrics endpoint"})
}

func (gw *APIGateway) clearCacheHandler(c *gin.Context) {
	if gw.redisClient != nil {
		err := gw.redisClient.FlushAll(c.Request.Context()).Err()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear cache"})
			return
		}
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "Cache cleared successfully"})
}

// Helper functions
func (gw *APIGateway) checkServiceHealth(serviceURL string) string {
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	resp, err := client.Get(serviceURL + "/health")
	if err != nil {
		return "unhealthy"
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return "healthy"
	}
	return "unhealthy"
}

// Circuit Breaker implementation
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	switch cb.state {
	case Closed:
		return true
	case Open:
		if time.Since(cb.lastFailureTime) > cb.config.RecoveryTimeout {
			cb.mu.RUnlock()
			cb.mu.Lock()
			cb.state = HalfOpen
			cb.mu.Unlock()
			cb.mu.RLock()
			return true
		}
		return false
	case HalfOpen:
		return true
	default:
		return false
	}
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount = 0
	cb.state = Closed
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount++
	cb.lastFailureTime = time.Now()

	if cb.failureCount >= cb.config.FailureThreshold {
		cb.state = Open
	}
}

// Rate Limiter implementation
func (rl *RateLimiter) Allow(ctx context.Context, key string) bool {
	if rl.redisClient == nil {
		return true // Allow if Redis is not available
	}

	pipe := rl.redisClient.Pipeline()
	
	// Sliding window rate limiting
	now := time.Now().Unix()
	window := now - 60 // 1 minute window
	
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", window))
	pipe.ZCard(ctx, key)
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})
	pipe.Expire(ctx, key, time.Minute)
	
	results, err := pipe.Exec(ctx)
	if err != nil {
		return true // Allow on error
	}
	
	count := results[1].(*redis.IntCmd).Val()
	return count < int64(rl.config.RequestsPerMinute)
}

func (gw *APIGateway) start() {
	server := &http.Server{
		Addr:    ":" + gw.config.Port,
		Handler: gw.router,
	}

	if gw.config.SecurityConfig.EnableHTTPS {
		gw.logger.Info("Starting HTTPS server", zap.String("port", gw.config.Port))
		log.Fatal(server.ListenAndServeTLS(
			gw.config.SecurityConfig.CertFile,
			gw.config.SecurityConfig.KeyFile,
		))
	} else {
		gw.logger.Info("Starting HTTP server", zap.String("port", gw.config.Port))
		log.Fatal(server.ListenAndServe())
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

