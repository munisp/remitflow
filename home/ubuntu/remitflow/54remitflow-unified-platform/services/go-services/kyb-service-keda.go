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

    "github.com/go-redis/redis/v8"
    "github.com/gorilla/mux"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

// KEDA-compatible metrics
var (
    httpRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total number of HTTP requests",
        },
        []string{"service", "method", "status"},
    )
    
    httpRequestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "http_request_duration_seconds",
            Help: "HTTP request duration in seconds",
            Buckets: prometheus.DefBuckets,
        },
        []string{"service", "method"},
    )
    
    redisQueueLength = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "redis_queue_length",
            Help: "Length of Redis queues",
        },
        []string{"queue_name"},
    )
    
    activeConnections = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "active_database_connections",
            Help: "Number of active database connections",
        },
    )
    
    kybVerificationsProcessed = prometheus.NewCounter(
        prometheus.CounterOpts{
            Name: "kyb_verifications_processed_total",
            Help: "Total number of KYB verifications processed",
        },
    )
)

type KYBService struct {
    db          *gorm.DB
    redisClient *redis.Client
    mu          sync.RWMutex
    metrics     map[string]interface{}
}

type Business struct {
    ID                uint      `json:"id" gorm:"primaryKey"`
    BusinessName      string    `json:"business_name" gorm:"not null"`
    RegistrationNumber string   `json:"registration_number" gorm:"unique;not null"`
    TaxID             string    `json:"tax_id" gorm:"unique"`
    BusinessType      string    `json:"business_type"`
    Industry          string    `json:"industry"`
    Address           string    `json:"address"`
    City              string    `json:"city"`
    State             string    `json:"state"`
    Country           string    `json:"country" gorm:"default:'Nigeria'"`
    PostalCode        string    `json:"postal_code"`
    PhoneNumber       string    `json:"phone_number"`
    Email             string    `json:"email"`
    Website           string    `json:"website"`
    EstablishedDate   time.Time `json:"established_date"`
    VerificationStatus string   `json:"verification_status" gorm:"default:'pending'"`
    RiskScore         float64   `json:"risk_score" gorm:"default:0"`
    ComplianceScore   float64   `json:"compliance_score" gorm:"default:0"`
    CreatedAt         time.Time `json:"created_at"`
    UpdatedAt         time.Time `json:"updated_at"`
}

func init() {
    prometheus.MustRegister(httpRequestsTotal)
    prometheus.MustRegister(httpRequestDuration)
    prometheus.MustRegister(redisQueueLength)
    prometheus.MustRegister(activeConnections)
    prometheus.MustRegister(kybVerificationsProcessed)
}

func NewKYBService() *KYBService {
    // Database connection
    dbPassword := os.Getenv("DB_PASSWORD")
    if dbPassword == "" {
        log.Fatal("DB_PASSWORD environment variable is required")
    }
    dbUser := os.Getenv("DB_USER")
    if dbUser == "" {
        log.Fatal("DB_USER environment variable is required")
    }
    dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable",
        getEnv("DB_HOST", "localhost"),
        dbUser,
        dbPassword,
        getEnv("DB_NAME", "kyb_db"),
        getEnv("DB_PORT", "5432"),
    )
    
    db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
    if err != nil {
        log.Fatal("Failed to connect to database:", err)
    }
    
    // Auto-migrate the schema
    db.AutoMigrate(&Business{})
    
    // Redis connection
    redisClient := redis.NewClient(&redis.Options{
        Addr:     getEnv("REDIS_HOST", "localhost") + ":" + getEnv("REDIS_PORT", "6379"),
        Password: getEnv("REDIS_PASSWORD", ""),
        DB:       0,
    })
    
    return &KYBService{
        db:          db,
        redisClient: redisClient,
        metrics:     make(map[string]interface{}),
    }
}

func (s *KYBService) metricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        
        // Wrap response writer to capture status code
        wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        
        next.ServeHTTP(wrapped, r)
        
        duration := time.Since(start)
        
        // Record metrics
        httpRequestsTotal.WithLabelValues("kyb-service", r.Method, strconv.Itoa(wrapped.statusCode)).Inc()
        httpRequestDuration.WithLabelValues("kyb-service", r.Method).Observe(duration.Seconds())
    })
}

type responseWriter struct {
    http.ResponseWriter
    statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
    rw.statusCode = code
    rw.ResponseWriter.WriteHeader(code)
}

func (s *KYBService) updateRedisMetrics() {
    ctx := context.Background()
    
    // Update queue length metrics
    queueLength, err := s.redisClient.LLen(ctx, "kyb_verification_queue").Result()
    if err == nil {
        redisQueueLength.WithLabelValues("kyb_verification_queue").Set(float64(queueLength))
    }
    
    // Update active connections metric
    sqlDB, err := s.db.DB()
    if err == nil {
        stats := sqlDB.Stats()
        activeConnections.Set(float64(stats.OpenConnections))
    }
}

func (s *KYBService) startMetricsUpdater() {
    ticker := time.NewTicker(10 * time.Second)
    go func() {
        for range ticker.C {
            s.updateRedisMetrics()
        }
    }()
}

func (s *KYBService) verifyBusiness(w http.ResponseWriter, r *http.Request) {
    var business Business
    if err := json.NewDecoder(r.Body).Decode(&business); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }
    
    // Add to Redis queue for processing
    ctx := context.Background()
    businessJSON, _ := json.Marshal(business)
    s.redisClient.LPush(ctx, "kyb_verification_queue", businessJSON)
    
    business.VerificationStatus = "pending"
    business.RiskScore = calculateRiskScore(business)
    business.ComplianceScore = calculateComplianceScore(business)
    business.CreatedAt = time.Now()
    business.UpdatedAt = time.Now()

    result := s.db.Create(&business)
    if result.Error != nil {
        http.Error(w, "Database error", http.StatusInternalServerError)
        return
    }

    var existingCount int64
    s.db.Model(&Business{}).Where("registration_number = ? AND verification_status = ?", business.RegistrationNumber, "verified").Count(&existingCount)
    if existingCount > 0 {
        business.VerificationStatus = "duplicate"
    } else {
        business.VerificationStatus = "verified"
    }
    business.UpdatedAt = time.Now()
    s.db.Save(&business)
    
    // Update metrics
    kybVerificationsProcessed.Inc()
    
    // Remove from queue
    s.redisClient.LPop(ctx, "kyb_verification_queue")
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(business)
}

func (s *KYBService) healthCheck(w http.ResponseWriter, r *http.Request) {
    // Check database connection
    sqlDB, err := s.db.DB()
    if err != nil {
        http.Error(w, "Database connection failed", http.StatusServiceUnavailable)
        return
    }
    
    if err := sqlDB.Ping(); err != nil {
        http.Error(w, "Database ping failed", http.StatusServiceUnavailable)
        return
    }
    
    // Check Redis connection
    ctx := context.Background()
    if err := s.redisClient.Ping(ctx).Err(); err != nil {
        http.Error(w, "Redis connection failed", http.StatusServiceUnavailable)
        return
    }
    
    response := map[string]interface{}{
        "status": "healthy",
        "timestamp": time.Now(),
        "service": "kyb-service",
        "version": "2.0.0-keda",
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}

func (s *KYBService) metricsHandler(w http.ResponseWriter, r *http.Request) {
    promhttp.Handler().ServeHTTP(w, r)
}

func calculateRiskScore(business Business) float64 {
    score := 50.0 // Base score
    
    // Industry-based risk adjustment
    highRiskIndustries := map[string]float64{
        "cryptocurrency": 30.0,
        "gambling": 25.0,
        "money_transfer": 20.0,
    }
    
    if risk, exists := highRiskIndustries[business.Industry]; exists {
        score += risk
    }
    
    // Age-based risk (newer businesses are riskier)
    age := time.Since(business.EstablishedDate).Hours() / (24 * 365)
    if age < 1 {
        score += 15.0
    } else if age < 3 {
        score += 10.0
    }
    
    // Ensure score is between 0 and 100
    if score > 100 {
        score = 100
    }
    if score < 0 {
        score = 0
    }
    
    return score
}

func calculateComplianceScore(business Business) float64 {
    score := 100.0 // Start with perfect score
    
    // Deduct points for missing information
    if business.TaxID == "" {
        score -= 20.0
    }
    if business.Address == "" {
        score -= 15.0
    }
    if business.PhoneNumber == "" {
        score -= 10.0
    }
    if business.Email == "" {
        score -= 10.0
    }
    
    // Ensure score is between 0 and 100
    if score < 0 {
        score = 0
    }
    
    return score
}

func getEnv(key, defaultValue string) string {
    if value := os.Getenv(key); value != "" {
        return value
    }
    return defaultValue
}

func main() {
    service := NewKYBService()
    
    // Start metrics updater
    service.startMetricsUpdater()
    
    router := mux.NewRouter()
    
    // Apply metrics middleware
    router.Use(service.metricsMiddleware)
    
    // Routes
    router.HandleFunc("/verify", service.verifyBusiness).Methods("POST")
    router.HandleFunc("/health", service.healthCheck).Methods("GET")
    router.HandleFunc("/metrics", service.metricsHandler).Methods("GET")
    
    port := getEnv("PORT", "8082")
    
    log.Printf("🚀 KYB Service with KEDA support starting on port %s", port)
    log.Printf("📊 Metrics endpoint: http://localhost:%s/metrics", port)
    log.Printf("🏥 Health endpoint: http://localhost:%s/health", port)
    
    if err := http.ListenAndServe(":"+port, router); err != nil {
        log.Fatal("Server failed to start:", err)
    }
}
