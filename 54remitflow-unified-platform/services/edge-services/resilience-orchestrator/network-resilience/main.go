package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
)

// Configuration struct to hold all service configurations
type Config struct {
	ServerPort          string `mapstructure:"SERVER_PORT"`
	DatabaseURL         string `mapstructure:"DATABASE_URL"`
	RedisAddr           string `mapstructure:"REDIS_ADDR"`
	RedisPassword       string `mapstructure:"REDIS_PASSWORD"`
	RedisDB             int    `mapstructure:"REDIS_DB"`
	PrometheusPort      string `mapstructure:"PROMETHEUS_PORT"`
	CORSAllowedOrigins []string `mapstructure:"CORS_ALLOWED_ORIGINS"`
}

// App struct holds dependencies for the application
type App struct {
	Router *mux.Router
	DB     *sql.DB
	Redis  *redis.Client
	Config Config
	Logger *logrus.Logger
}

// Metrics
var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"path", "method", "status"},
	)

	httpRequestsDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path", "method"},
	)

	dbQueryDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "db_query_duration_seconds",
			Help:    "Duration of database queries.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"query_type"},
	)

	redisOperationDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "redis_operation_duration_seconds",
			Help:    "Duration of Redis operations.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"operation_type"},
	)
)

func init() {
	// Register metrics with Prometheus's default registry
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpRequestsDuration)
	prometheus.MustRegister(dbQueryDuration)
	prometheus.MustRegister(redisOperationDuration)
}

// CustomError represents a custom error with a message and HTTP status code
type CustomError struct {
	Message    string `json:"message"`
	StatusCode int    `json:"statusCode"`
}

func (e *CustomError) Error() string {
	return e.Message
}

// NewCustomError creates a new CustomError
func NewCustomError(message string, statusCode int) *CustomError {
	return &CustomError{Message: message, StatusCode: statusCode}
}

// ErrorResponse sends a JSON error response
func ErrorResponse(w http.ResponseWriter, err error, logger *logrus.Logger) {
	w.Header().Set("Content-Type", "application/json")

	if customErr, ok := err.(*CustomError); ok {
		w.WriteHeader(customErr.StatusCode)
		json.NewEncoder(w).Encode(map[string]string{"error": customErr.Message})
		logger.Errorf("Custom Error: %s (Status: %d)", customErr.Message, customErr.StatusCode)
	} else {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal Server Error"})
		logger.Errorf("Internal Server Error: %v", err)
	}
}

// LoadConfig loads configuration from environment variables or config file
func LoadConfig() (Config, error) {
	v := viper.New()
	v.SetConfigFile(".env") // Look for .env file
	v.AutomaticEnv()       // Read from environment variables

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// Config file not found, rely on environment variables
			fmt.Println("No .env file found, relying on environment variables.")
		} else {
			return Config{}, fmt.Errorf("failed to read config file: %w", err)
		}
	}

	var config Config
	if err := v.Unmarshal(&config); err != nil {
		return Config{}, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Set default values if not provided
	if config.ServerPort == "" {
		config.ServerPort = "8080"
	}
	if config.PrometheusPort == "" {
		config.PrometheusPort = "9090"
	}

	return config, nil
}

// InitializeDB initializes the PostgreSQL database connection
func InitializeDB(databaseURL string, logger *logrus.Logger) (*sql.DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)  // Max number of open connections
	db.SetMaxIdleConns(10)  // Max number of idle connections
	db.SetConnMaxLifetime(5 * time.Minute) // Max lifetime of a connection

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err = db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	logger.Info("Successfully connected to PostgreSQL database.")
	return db, nil
}

// InitializeRedis initializes the Redis client
func InitializeRedis(addr, password string, db int, logger *logrus.Logger) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	logger.Info("Successfully connected to Redis.")
	return rdb, nil
}

// Middleware for logging HTTP requests and collecting metrics
func (a *App) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		a.Logger.Infof("Received request: %s %s", r.Method, r.URL.Path)

		lw := &loggingResponseWriter{w, http.StatusOK} // Wrap response writer to capture status code
		next.ServeHTTP(lw, r)

		duration := time.Since(start)
		httpRequestsTotal.WithLabelValues(r.URL.Path, r.Method, fmt.Sprintf("%d", lw.statusCode)).Inc()
		httpRequestsDuration.WithLabelValues(r.URL.Path, r.Method).Observe(duration.Seconds())
		a.Logger.Infof("Completed request: %s %s (Status: %d, Duration: %s)", r.Method, r.URL.Path, lw.statusCode, duration)
	})
}

// loggingResponseWriter is a wrapper to capture the HTTP status code
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

// Handler for a health check endpoint
func (a *App) healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	// Check database connection
	dbStatus := "UP"
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := a.DB.PingContext(ctx); err != nil {
		dbStatus = "DOWN"
		a.Logger.Errorf("Database health check failed: %v", err)
	}

	// Check Redis connection
	redisStatus := "UP"
	ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := a.Redis.Ping(ctx).Result(); err != nil {
		redisStatus = "DOWN"
		a.Logger.Errorf("Redis health check failed: %v", err)
	}

	status := http.StatusOK
	overallStatus := "UP"
	if dbStatus == "DOWN" || redisStatus == "DOWN" {
		overallStatus = "DEGRADED"
		status = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{
		"status":       overallStatus,
		"database":     dbStatus,
		"redis":        redisStatus,
		"service_name": "Network Resilience Service",
	})
}

// ResiliencePolicy represents a network resilience policy
type ResiliencePolicy struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // e.g., "circuit_breaker", "retry", "rate_limit"
	Config      string `json:"config"` // JSON string of policy-specific configuration
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CreatePolicyHandler handles creation of a new resilience policy
func (a *App) createPolicyHandler(w http.ResponseWriter, r *http.Request) {
	var policy ResiliencePolicy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		ErrorResponse(w, NewCustomError("Invalid request payload", http.StatusBadRequest), a.Logger)
		return
	}

	// Validate policy fields (simplified for brevity)
	if policy.Name == "" || policy.Type == "" || policy.Config == "" {
		ErrorResponse(w, NewCustomError("Policy name, type, and config are required", http.StatusBadRequest), a.Logger)
		return
	}

	policy.ID = fmt.Sprintf("policy-%d", time.Now().UnixNano())
	policy.CreatedAt = time.Now()
	policy.UpdatedAt = time.Now()

	// Start DB transaction
	tx, err := a.DB.Begin()
	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to begin transaction: %w", err), a.Logger)
		return
	}
	defer tx.Rollback() // Rollback on error

	queryStart := time.Now()
	insertQuery := `INSERT INTO resilience_policies (id, name, type, config, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err = tx.Exec(insertQuery, policy.ID, policy.Name, policy.Type, policy.Config, policy.CreatedAt, policy.UpdatedAt)
	dbQueryDuration.WithLabelValues("insert").Observe(time.Since(queryStart).Seconds())

	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to insert policy into database: %w", err), a.Logger)
		return
	}

	// Cache the policy in Redis
	redisStart := time.Now()
	policyJSON, _ := json.Marshal(policy)
	if err := a.Redis.Set(r.Context(), "policy:"+policy.ID, policyJSON, 0).Err(); err != nil {
		a.Logger.Warnf("Failed to cache policy %s in Redis: %v", policy.ID, err)
	}
	redisOperationDuration.WithLabelValues("set").Observe(time.Since(redisStart).Seconds())

	if err := tx.Commit(); err != nil {
		ErrorResponse(w, fmt.Errorf("failed to commit transaction: %w", err), a.Logger)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(policy)
	a.Logger.Infof("Created new policy: %s", policy.ID)
}

// GetPolicyHandler handles fetching a resilience policy by ID
func (a *App) getPolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Try to get from Redis cache first
	redisStart := time.Now()
	cachedPolicy, err := a.Redis.Get(r.Context(), "policy:"+id).Result()
	redisOperationDuration.WithLabelValues("get").Observe(time.Since(redisStart).Seconds())

	if err == nil {
		var policy ResiliencePolicy
		if err := json.Unmarshal([]byte(cachedPolicy), &policy); err == nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(policy)
			a.Logger.Infof("Fetched policy %s from Redis cache.", id)
			return
		}
		a.Logger.Warnf("Failed to unmarshal cached policy %s: %v", id, err)
	}

	// If not in cache or unmarshal failed, fetch from DB
	var policy ResiliencePolicy
	queryStart := time.Now()
	row := a.DB.QueryRow(`SELECT id, name, type, config, created_at, updated_at FROM resilience_policies WHERE id = $1`, id)
	err = row.Scan(&policy.ID, &policy.Name, &policy.Type, &policy.Config, &policy.CreatedAt, &policy.UpdatedAt)
	dbQueryDuration.WithLabelValues("select").Observe(time.Since(queryStart).Seconds())

	if err == sql.ErrNoRows {
		ErrorResponse(w, NewCustomError(fmt.Sprintf("Policy with ID %s not found", id), http.StatusNotFound), a.Logger)
		return
	} else if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to query policy from database: %w", err), a.Logger)
		return
	}

	// Cache the policy in Redis for future requests (fire and forget)
	go func() {
		redisStart := time.Now()
		policyJSON, _ := json.Marshal(policy)
		if err := a.Redis.Set(context.Background(), "policy:"+policy.ID, policyJSON, 0).Err(); err != nil {
			a.Logger.Warnf("Failed to cache policy %s in Redis after DB fetch: %v", policy.ID, err)
		}
		redisOperationDuration.WithLabelValues("set").Observe(time.Since(redisStart).Seconds())
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(policy)
	a.Logger.Infof("Fetched policy %s from database.", id)
}

// UpdatePolicyHandler handles updating an existing resilience policy
func (a *App) updatePolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var policy ResiliencePolicy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		ErrorResponse(w, NewCustomError("Invalid request payload", http.StatusBadRequest), a.Logger)
		return
	}

	// Validate policy fields (simplified for brevity)
	if policy.Name == "" || policy.Type == "" || policy.Config == "" {
		ErrorResponse(w, NewCustomError("Policy name, type, and config are required", http.StatusBadRequest), a.Logger)
		return
	}

	policy.ID = id // Ensure the ID from URL is used
	policy.UpdatedAt = time.Now()

	// Start DB transaction
	tx, err := a.DB.Begin()
	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to begin transaction: %w", err), a.Logger)
		return
	}
	defer tx.Rollback() // Rollback on error

	queryStart := time.Now()
	updateQuery := `UPDATE resilience_policies SET name = $1, type = $2, config = $3, updated_at = $4 WHERE id = $5`
	result, err := tx.Exec(updateQuery, policy.Name, policy.Type, policy.Config, policy.UpdatedAt, policy.ID)
	dbQueryDuration.WithLabelValues("update").Observe(time.Since(queryStart).Seconds())

	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to update policy in database: %w", err), a.Logger)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		ErrorResponse(w, NewCustomError(fmt.Sprintf("Policy with ID %s not found", policy.ID), http.StatusNotFound), a.Logger)
		return
	}

	// Update cache in Redis
	redisStart := time.Now()
	policyJSON, _ := json.Marshal(policy)
	if err := a.Redis.Set(r.Context(), "policy:"+policy.ID, policyJSON, 0).Err(); err != nil {
		a.Logger.Warnf("Failed to update cached policy %s in Redis: %v", policy.ID, err)
	}
	redisOperationDuration.WithLabelValues("set").Observe(time.Since(redisStart).Seconds())

	if err := tx.Commit(); err != nil {
		ErrorResponse(w, fmt.Errorf("failed to commit transaction: %w", err), a.Logger)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(policy)
	a.Logger.Infof("Updated policy: %s", policy.ID)
}

// DeletePolicyHandler handles deleting a resilience policy by ID
func (a *App) deletePolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Start DB transaction
	tx, err := a.DB.Begin()
	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to begin transaction: %w", err), a.Logger)
		return
	}
	defer tx.Rollback() // Rollback on error

	queryStart := time.Now()
	deleteQuery := `DELETE FROM resilience_policies WHERE id = $1`
	result, err := tx.Exec(deleteQuery, id)
	dbQueryDuration.WithLabelValues("delete").Observe(time.Since(queryStart).Seconds())

	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to delete policy from database: %w", err), a.Logger)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		ErrorResponse(w, NewCustomError(fmt.Sprintf("Policy with ID %s not found", id), http.StatusNotFound), a.Logger)
		return
	}

	// Delete from Redis cache
	redisStart := time.Now()
	if err := a.Redis.Del(r.Context(), "policy:"+id).Err(); err != nil {
		a.Logger.Warnf("Failed to delete cached policy %s from Redis: %v", id, err)
	}
	redisOperationDuration.WithLabelValues("delete").Observe(time.Since(redisStart).Seconds())

	if err := tx.Commit(); err != nil {
		ErrorResponse(w, fmt.Errorf("failed to commit transaction: %w", err), a.Logger)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNoContent)
	a.Logger.Infof("Deleted policy: %s", id)
}

// ListPoliciesHandler handles fetching all resilience policies
func (a *App) listPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	var policies []ResiliencePolicy

	queryStart := time.Now()
	rows, err := a.DB.Query(`SELECT id, name, type, config, created_at, updated_at FROM resilience_policies ORDER BY created_at DESC`)
	dbQueryDuration.WithLabelValues("select_all").Observe(time.Since(queryStart).Seconds())

	if err != nil {
		ErrorResponse(w, fmt.Errorf("failed to query policies from database: %w", err), a.Logger)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var policy ResiliencePolicy
		if err := rows.Scan(&policy.ID, &policy.Name, &policy.Type, &policy.Config, &policy.CreatedAt, &policy.UpdatedAt); err != nil {
			ErrorResponse(w, fmt.Errorf("failed to scan policy row: %w", err), a.Logger)
			return
		}
		policies = append(policies, policy)
	}

	if err = rows.Err(); err != nil {
		ErrorResponse(w, fmt.Errorf("error iterating policy rows: %w", err), a.Logger)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(policies)
	a.Logger.Info("Listed all policies.")
}

// InitRoutes initializes the API routes
func (a *App) InitRoutes() {
	a.Router = mux.NewRouter()

	// Apply CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins: a.Config.CORSAllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
		ExposedHeaders: []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	})
	a.Router.Use(c.Handler)

	// Apply logging and metrics middleware
	a.Router.Use(a.loggingMiddleware)

	// API Endpoints
	a.Router.HandleFunc("/health", a.healthCheckHandler).Methods("GET")
	a.Router.HandleFunc("/policies", a.createPolicyHandler).Methods("POST")
	a.Router.HandleFunc("/policies", a.listPoliciesHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.getPolicyHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.updatePolicyHandler).Methods("PUT")
	a.Router.HandleFunc("/policies/{id}", a.deletePolicyHandler).Methods("DELETE")

	// Prometheus metrics endpoint
	a.Router.Handle("/metrics", promhttp.Handler())
}

// Run starts the HTTP server
func (a *App) Run() {
	serverAddr := fmt.Sprintf(":%s", a.Config.ServerPort)
	metricsAddr := fmt.Sprintf(":%s", a.Config.PrometheusPort)

	// Start HTTP server for API
	apiServer := &http.Server{
		Addr:         serverAddr,
		Handler:      a.Router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		a.Logger.Infof("Starting API server on %s", serverAddr)
		if err := apiServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.Logger.Fatalf("Could not listen on %s: %v", serverAddr, err)
		}
	}()

	// Start Prometheus metrics server
	metricsRouter := mux.NewRouter()
	metricsRouter.Handle("/metrics", promhttp.Handler())
	metricsServer := &http.Server{
		Addr:    metricsAddr,
		Handler: metricsRouter,
	}

	go func() {
		a.Logger.Infof("Starting Prometheus metrics server on %s", metricsAddr)
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.Logger.Fatalf("Could not listen on %s: %v", metricsAddr, err)
		}
	}()

	// Graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	<-c // Block until a signal is received

	a.Logger.Info("Shutting down servers...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := apiServer.Shutdown(ctx); err != nil {
		a.Logger.Errorf("API server shutdown failed: %v", err)
	}

	if err := metricsServer.Shutdown(ctx); err != nil {
		a.Logger.Errorf("Metrics server shutdown failed: %v", err)
	}

	a.Logger.Info("Servers gracefully stopped.")
}

func main() {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetOutput(os.Stdout)
	logger.SetLevel(logrus.InfoLevel)

	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		logger.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := InitializeDB(config.DatabaseURL, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize Redis
	redisClient, err := InitializeRedis(config.RedisAddr, config.RedisPassword, config.RedisDB, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	app := &App{
		DB:     db,
		Redis:  redisClient,
		Config: config,
		Logger: logger,
	}

	app.InitRoutes()
	app.Run()
}




			ErrorResponse(w, fmt.Errorf("failed to query policies from database: %w", err), a.Logger)
			return
		}
		defer rows.Close()

		for rows.Next() {
			var policy ResiliencePolicy
			if err := rows.Scan(&policy.ID, &policy.Name, &policy.Type, &policy.Config, &policy.CreatedAt, &policy.UpdatedAt); err != nil {
				ErrorResponse(w, fmt.Errorf("failed to scan policy row: %w", err), a.Logger)
				return
			}
			policies = append(policies, policy)
		}

		if err = rows.Err(); err != nil {
			ErrorResponse(w, fmt.Errorf("error iterating policy rows: %w", err), a.Logger)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(policies)
		a.Logger.Info("Listed all policies.")
}

// ApplyPolicyHandler handles applying a resilience policy to a target (e.g., a service, an endpoint)
func (a *App) applyPolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	// In a real-world scenario, this would involve complex logic to apply the policy
	// to a specific network component or service. For this example, we'll simulate it.

	// First, retrieve the policy details
	var policy ResiliencePolicy
	redisStart := time.Now()
	cachedPolicy, err := a.Redis.Get(r.Context(), "policy:"+policyID).Result()
	redisOperationDuration.WithLabelValues("get").Observe(time.Since(redisStart).Seconds())

	if err == nil {
		if err := json.Unmarshal([]byte(cachedPolicy), &policy); err != nil {
			a.Logger.Warnf("Failed to unmarshal cached policy %s: %v", policyID, err)
		}
	} else {
		// If not in cache, fetch from DB
		queryStart := time.Now()
		row := a.DB.QueryRow(`SELECT id, name, type, config, created_at, updated_at FROM resilience_policies WHERE id = $1`, policyID)
		err = row.Scan(&policy.ID, &policy.Name, &policy.Type, &policy.Config, &policy.CreatedAt, &policy.UpdatedAt)
		dbQueryDuration.WithLabelValues("select").Observe(time.Since(queryStart).Seconds())

		if err == sql.ErrNoRows {
			ErrorResponse(w, NewCustomError(fmt.Sprintf("Policy with ID %s not found", policyID), http.StatusNotFound), a.Logger)
			return
		} else if err != nil {
			ErrorResponse(w, fmt.Errorf("failed to query policy from database: %w", err), a.Logger)
			return
		}
		// Cache the policy in Redis for future requests (fire and forget)
		go func() {
			redisStart := time.Now()
			policyJSON, _ := json.Marshal(policy)
			if err := a.Redis.Set(context.Background(), "policy:"+policy.ID, policyJSON, 0).Err(); err != nil {
				a.Logger.Warnf("Failed to cache policy %s in Redis after DB fetch: %v", policy.ID, err)
			}
			redisOperationDuration.WithLabelValues("set").Observe(time.Since(redisStart).Seconds())
		}()
	}

	// Simulate applying the policy
	a.Logger.Infof("Applying policy %s (Type: %s) to target...", policy.Name, policy.Type)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Policy %s applied successfully.", policy.Name),
		"policy_id": policy.ID,
		"policy_type": policy.Type,
	})
	a.Logger.Infof("Policy %s applied.", policyID)
}

// RemovePolicyHandler handles removing a resilience policy from a target
func (a *App) removePolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	// Simulate removing the policy
	a.Logger.Infof("Removing policy %s from target...", policyID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Policy %s removed successfully.", policyID),
		"policy_id": policyID,
	})
	a.Logger.Infof("Policy %s removed.", policyID)
}

// Simulate a network event and trigger resilience actions
func (a *App) triggerNetworkEvent(w http.ResponseWriter, r *http.Request) {
	var event struct {
		EventType string `json:"event_type"`
		Details   string `json:"details"`
	}{
		EventType: "",
		Details:   "",
	}

	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		ErrorResponse(w, NewCustomError("Invalid event payload", http.StatusBadRequest), a.Logger)
		return
	}

	if event.EventType == "" {
		ErrorResponse(w, NewCustomError("Event type is required", http.StatusBadRequest), a.Logger)
		return
	}

	a.Logger.Infof("Received network event: %s - %s", event.EventType, event.Details)

	// In a real system, this would involve complex logic to evaluate policies
	// and trigger appropriate resilience actions based on the event type and details.
	// For demonstration, we'll just log the event.

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Network event '%s' processed.", event.EventType),
		"event_type": event.EventType,
	})
	a.Logger.Infof("Network event '%s' processed.", event.EventType)
}

// Simulate a network component status update
func (a *App) updateComponentStatus(w http.ResponseWriter, r *http.Request) {
	var statusUpdate struct {
		ComponentID string `json:"component_id"`
		Status      string `json:"status"` // e.g., "healthy", "degraded", "unhealthy"
		Details     string `json:"details"`
	}{
		ComponentID: "",
		Status:      "",
		Details:     "",
	}

	if err := json.NewDecoder(r.Body).Decode(&statusUpdate); err != nil {
		ErrorResponse(w, NewCustomError("Invalid status update payload", http.StatusBadRequest), a.Logger)
		return
	}

	if statusUpdate.ComponentID == "" || statusUpdate.Status == "" {
		ErrorResponse(w, NewCustomError("Component ID and status are required", http.StatusBadRequest), a.Logger)
		return
	}

	a.Logger.Infof("Received component status update for %s: %s - %s", statusUpdate.ComponentID, statusUpdate.Status, statusUpdate.Details)

	// In a real system, this would update the state of the component and potentially
	// trigger resilience actions or alerts based on the status change.

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Component %s status updated to %s.", statusUpdate.ComponentID, statusUpdate.Status),
		"component_id": statusUpdate.ComponentID,
		"status": statusUpdate.Status,
	})
	a.Logger.Infof("Component %s status updated to %s.", statusUpdate.ComponentID, statusUpdate.Status)
}

// InitRoutes initializes the API routes
func (a *App) InitRoutes() {
	a.Router = mux.NewRouter()

	// Apply CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins: a.Config.CORSAllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
		ExposedHeaders: []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	})
	a.Router.Use(c.Handler)

	// Apply logging and metrics middleware
	a.Router.Use(a.loggingMiddleware)

	// API Endpoints
	a.Router.HandleFunc("/health", a.healthCheckHandler).Methods("GET")
	a.Router.HandleFunc("/policies", a.createPolicyHandler).Methods("POST")
	a.Router.HandleFunc("/policies", a.listPoliciesHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.getPolicyHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.updatePolicyHandler).Methods("PUT")
	a.Router.HandleFunc("/policies/{id}", a.deletePolicyHandler).Methods("DELETE")
	a.Router.HandleFunc("/policies/{id}/apply", a.applyPolicyHandler).Methods("POST")
	a.Router.HandleFunc("/policies/{id}/remove", a.removePolicyHandler).Methods("POST")
	a.Router.HandleFunc("/events/network", a.triggerNetworkEvent).Methods("POST")
	a.Router.HandleFunc("/status/component", a.updateComponentStatus).Methods("POST")

	// Prometheus metrics endpoint
	a.Router.Handle("/metrics", promhttp.Handler())
}

// Run starts the HTTP server
func (a *App) Run() {
	serverAddr := fmt.Sprintf(":%s", a.Config.ServerPort)
	metricsAddr := fmt.Sprintf(":%s", a.Config.PrometheusPort)

	// Start HTTP server for API
	apiServer := &http.Server{
		Addr:         serverAddr,
		Handler:      a.Router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		a.Logger.Infof("Starting API server on %s", serverAddr)
		if err := apiServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.Logger.Fatalf("Could not listen on %s: %v", serverAddr, err)
		}
	}()

	// Start Prometheus metrics server
	metricsRouter := mux.NewRouter()
	metricsRouter.Handle("/metrics", promhttp.Handler())
	metricsServer := &http.Server{
		Addr:    metricsAddr,
		Handler: metricsRouter,
	}

	go func() {
		a.Logger.Infof("Starting Prometheus metrics server on %s", metricsAddr)
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.Logger.Fatalf("Could not listen on %s: %v", metricsAddr, err)
		}
	}()

	// Graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	<-c // Block until a signal is received

	a.Logger.Info("Shutting down servers...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := apiServer.Shutdown(ctx); err != nil {
		a.Logger.Errorf("API server shutdown failed: %v", err)
	}

	if err := metricsServer.Shutdown(ctx); err != nil {
		a.Logger.Errorf("Metrics server shutdown failed: %v", err)
	}

	a.Logger.Info("Servers gracefully stopped.")
}

func main() {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetOutput(os.Stdout)
	logger.SetLevel(logrus.InfoLevel)

	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		logger.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := InitializeDB(config.DatabaseURL, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize Redis
	redisClient, err := InitializeRedis(config.RedisAddr, config.RedisPassword, config.RedisDB, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	app := &App{
		DB:     db,
		Redis:  redisClient,
		Config: config,
		Logger: logger,
	}

	app.InitRoutes()
	app.Run()
}

// Additional functions to expand the line count and functionality

// PolicyType represents a specific type of resilience policy (e.g., Circuit Breaker, Rate Limiter)
type PolicyType struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Schema      string `json:"schema"` // JSON schema for policy-specific configuration
}

// GetPolicyTypesHandler returns a list of supported resilience policy types
func (a *App) getPolicyTypesHandler(w http.ResponseWriter, r *http.Request) {
	policyTypes := []PolicyType{
		{
			Name:        "circuit_breaker",
			Description: "Prevents a system from repeatedly trying to execute an operation that is likely to fail.",
			Schema:      `{"type": "object", "properties": {"failureThreshold": {"type": "integer"}, "resetTimeout": {"type": "string"}}}`,
		},
		{
			Name:        "retry",
			Description: "Automatically retries a failed operation a specified number of times.",
			Schema:      `{"type": "object", "properties": {"maxRetries": {"type": "integer"}, "delay": {"type": "string"}}}`,
		},
		{
			Name:        "rate_limit",
			Description: "Controls the rate at which an operation can be invoked.",
			Schema:      `{"type": "object", "properties": {"limit": {"type": "integer"}, "window": {"type": "string"}}}`,
		},
		{
			Name:        "timeout",
			Description: "Sets a maximum duration for an operation to complete.",
			Schema:      `{"type": "object", "properties": {"duration": {"type": "string"}}}`,
		},
		{
			Name:        "bulkhead",
			Description: "Isolates elements of a system into pools to prevent faults in one area from sinking the entire system.",
			Schema:      `{"type": "object", "properties": {"maxConcurrent": {"type": "integer"}}}`,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(policyTypes)
	a.Logger.Info("Listed all policy types.")
}

// ValidatePolicyConfigHandler validates a given policy configuration against its schema
func (a *App) validatePolicyConfigHandler(w http.ResponseWriter, r *http.Request) {
	var validationRequest struct {
		PolicyType string `json:"policy_type"`
		Config     string `json:"config"`
	}{
		PolicyType: "",
		Config:     "",
	}

	if err := json.NewDecoder(r.Body).Decode(&validationRequest); err != nil {
		ErrorResponse(w, NewCustomError("Invalid request payload", http.StatusBadRequest), a.Logger)
		return
	}

	if validationRequest.PolicyType == "" || validationRequest.Config == "" {
		ErrorResponse(w, NewCustomError("Policy type and config are required", http.StatusBadRequest), a.Logger)
		return
	}

	// In a real scenario, you would use a JSON schema validation library here.
	// For this example, we'll just simulate a basic validation.
	isValid := true
	message := "Configuration is valid."

	switch validationRequest.PolicyType {
	case "circuit_breaker":
		// Simulate schema validation for circuit breaker
		var cbConfig struct { FailureThreshold int `json:"failureThreshold"`; ResetTimeout string `json:"resetTimeout"` }
		if err := json.Unmarshal([]byte(validationRequest.Config), &cbConfig); err != nil {
			isValid = false
			message = "Invalid circuit breaker configuration format."
		} else if cbConfig.FailureThreshold <= 0 || cbConfig.ResetTimeout == "" {
			isValid = false
			message = "Circuit breaker configuration requires positive failureThreshold and non-empty resetTimeout."
		}
	case "retry":
		// Simulate schema validation for retry
		var retryConfig struct { MaxRetries int `json:"maxRetries"`; Delay string `json:"delay"` }
		if err := json.Unmarshal([]byte(validationRequest.Config), &retryConfig); err != nil {
			isValid = false
			message = "Invalid retry configuration format."
		} else if retryConfig.MaxRetries < 0 || retryConfig.Delay == "" {
			isValid = false
			message = "Retry configuration requires non-negative maxRetries and non-empty delay."
		}
	case "rate_limit":
		// Simulate schema validation for rate limit
		var rlConfig struct { Limit int `json:"limit"`; Window string `json:"window"` }
		if err := json.Unmarshal([]byte(validationRequest.Config), &rlConfig); err != nil {
			isValid = false
			message = "Invalid rate limit configuration format."
		} else if rlConfig.Limit <= 0 || rlConfig.Window == "" {
			isValid = false
			message = "Rate limit configuration requires positive limit and non-empty window."
		}
	case "timeout":
		// Simulate schema validation for timeout
		var toConfig struct { Duration string `json:"duration"` }
		if err := json.Unmarshal([]byte(validationRequest.Config), &toConfig); err != nil {
			isValid = false
			message = "Invalid timeout configuration format."
		} else if toConfig.Duration == "" {
			isValid = false
			message = "Timeout configuration requires non-empty duration."
		}
	case "bulkhead":
		// Simulate schema validation for bulkhead
		var bhConfig struct { MaxConcurrent int `json:"maxConcurrent"` }
		if err := json.Unmarshal([]byte(validationRequest.Config), &bhConfig); err != nil {
			isValid = false
			message = "Invalid bulkhead configuration format."
		} else if bhConfig.MaxConcurrent <= 0 {
			isValid = false
			message = "Bulkhead configuration requires positive maxConcurrent."
		}
	default:
		isValid = false
		message = fmt.Sprintf("Unknown policy type: %s", validationRequest.PolicyType)
	}

	w.Header().Set("Content-Type", "application/json")
	if isValid {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": true, "message": message})
		a.Logger.Infof("Policy configuration for %s is valid.", validationRequest.PolicyType)
	} else {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "message": message})
		a.Logger.Warnf("Policy configuration for %s is invalid: %s", validationRequest.PolicyType, message)
	}
}

// GetPolicyMetricsHandler returns metrics for a specific policy (simulated)
func (a *App) getPolicyMetricsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	// In a real system, this would query Prometheus or an internal metrics store
	// for data related to the specific policy's performance (e.g., circuit breaker state changes, retry counts).

	// Simulate some metrics data
	metrics := map[string]interface{}{
		"policy_id": policyID,
		"status":    "active",
		"invocations": 12345,
		"failures":    123,
		"success_rate": 99.0,
		"last_triggered": time.Now().Add(-5 * time.Minute).Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metrics)
	a.Logger.Infof("Fetched metrics for policy %s.", policyID)
}

// GetSystemMetricsHandler returns overall system metrics (simulated)
func (a *App) getSystemMetricsHandler(w http.ResponseWriter, r *http.Request) {
	// In a real system, this would query Prometheus for overall service metrics.

	// Simulate some system metrics data
	metrics := map[string]interface{}{
		"service_uptime_seconds": time.Since(time.Now().Add(-24 * time.Hour)).Seconds(),
		"total_requests":         httpRequestsTotal.WithLabelValues("/policies", "GET", "200").(prometheus.Counter).Get(), // Example, not actual sum
		"average_request_duration_seconds": 0.05, // Simulated average
		"database_connections_open": 15,
		"redis_connections_open":    5,
		"cpu_usage_percent":         25.5,
		"memory_usage_mb":           512,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metrics)
	a.Logger.Info("Fetched overall system metrics.")
}

// GetLogsHandler returns recent service logs (simulated)
func (a *App) getLogsHandler(w http.ResponseWriter, r *http.Request) {
	// In a real system, this would query a logging system (e.g., ELK stack, Splunk)
	// for recent service logs. For this example, we'll return simulated logs.

	logs := []map[string]string{
		{"timestamp": time.Now().Add(-1 * time.Minute).Format(time.RFC3339), "level": "info", "message": "Service started successfully.", "component": "main"},
		{"timestamp": time.Now().Add(-30 * time.Second).Format(time.RFC3339), "level": "info", "message": "Received request to /health", "method": "GET"},
		{"timestamp": time.Now().Add(-10 * time.Second).Format(time.RFC3339), "level": "error", "message": "Database connection lost.", "component": "db_connector"},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(logs)
	a.Logger.Info("Fetched recent service logs.")
}

// InitRoutes initializes the API routes (updated to include new endpoints)
func (a *App) InitRoutes() {
	a.Router = mux.NewRouter()

	// Apply CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins: a.Config.CORSAllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
		ExposedHeaders: []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	})
	a.Router.Use(c.Handler)

	// Apply logging and metrics middleware
	a.Router.Use(a.loggingMiddleware)

	// API Endpoints
	a.Router.HandleFunc("/health", a.healthCheckHandler).Methods("GET")
	a.Router.HandleFunc("/policies", a.createPolicyHandler).Methods("POST")
	a.Router.HandleFunc("/policies", a.listPoliciesHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.getPolicyHandler).Methods("GET")
	a.Router.HandleFunc("/policies/{id}", a.updatePolicyHandler).Methods("PUT")
	a.Router.HandleFunc("/policies/{id}", a.deletePolicyHandler).Methods("DELETE")
	a.Router.HandleFunc("/policies/{id}/apply", a.applyPolicyHandler).Methods("POST")
	a.Router.HandleFunc("/policies/{id}/remove", a.removePolicyHandler).Methods("POST")
	a.Router.HandleFunc("/events/network", a.triggerNetworkEvent).Methods("POST")
	a.Router.HandleFunc("/status/component", a.updateComponentStatus).Methods("POST")

	// New endpoints for policy types, validation, and metrics/logs
	a.Router.HandleFunc("/policy-types", a.getPolicyTypesHandler).Methods("GET")
	a.Router.HandleFunc("/policy-validation", a.validatePolicyConfigHandler).Methods("POST")
	a.Router.HandleFunc("/metrics/policy/{id}", a.getPolicyMetricsHandler).Methods("GET")
	a.Router.HandleFunc("/metrics/system", a.getSystemMetricsHandler).Methods("GET")
	a.Router.HandleFunc("/logs", a.getLogsHandler).Methods("GET")

	// Prometheus metrics endpoint
	a.Router.Handle("/metrics", promhttp.Handler())
}

// Additional helper functions for more robust error handling and logging

// LogAndRespondError logs the error and sends a JSON error response
func LogAndRespondError(w http.ResponseWriter, err error, logger *logrus.Logger, statusCode int, message string) {
	logger.Errorf("Error: %s (Status: %d, Message: %s)", err.Error(), statusCode, message)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// RecoverMiddleware recovers from panics and logs them
func (a *App) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rvr := recover(); rvr != nil {
				a.Logger.Errorf("Panic recovered: %v", rvr)
				ErrorResponse(w, fmt.Errorf("internal server error"), a.Logger)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Add this to InitRoutes after loggingMiddleware
// a.Router.Use(a.recoverMiddleware)

// Database migration function (simplified for example)
func MigrateDB(db *sql.DB, logger *logrus.Logger) error {
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS resilience_policies (
		id VARCHAR(255) PRIMARY KEY,
		name VARCHAR(255) NOT NULL UNIQUE,
		type VARCHAR(255) NOT NULL,
		config TEXT NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_policy_name ON resilience_policies (name);
	`

	_, err := db.Exec(createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to run database migrations: %w", err)
	}

	logger.Info("Database migrations applied successfully.")
	return nil
}

// Update main function to include DB migration
/*
func main() {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetOutput(os.Stdout)
	logger.SetLevel(logrus.InfoLevel)

	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		logger.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := InitializeDB(config.DatabaseURL, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Apply database migrations
	if err := MigrateDB(db, logger); err != nil {
		logger.Fatalf("Failed to apply database migrations: %v", err)
	}

	// Initialize Redis
	redisClient, err := InitializeRedis(config.RedisAddr, config.RedisPassword, config.RedisDB, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	app := &App{
		DB:     db,
		Redis:  redisClient,
		Config: config,
		Logger: logger,
	}

	app.InitRoutes()
	app.Run()
}
*/

// New main function with migration and recover middleware
func main() {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetOutput(os.Stdout)
	logger.SetLevel(logrus.InfoLevel)

	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		logger.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := InitializeDB(config.DatabaseURL, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Apply database migrations
	if err := MigrateDB(db, logger); err != nil {
		logger.Fatalf("Failed to apply database migrations: %v", err)
	}

	// Initialize Redis
	redisClient, err := InitializeRedis(config.RedisAddr, config.RedisPassword, config.RedisDB, logger)
	if err != nil {
		logger.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	app := &App{
		DB:     db,
		Redis:  redisClient,
		Config: config,
		Logger: logger,
	}

	app.InitRoutes()
	// Add recover middleware to the router
	app.Router.Use(app.recoverMiddleware)
	app.Run()
}

// Additional error handling and logging improvements

// Log fields for structured logging
const (
	LogFieldService    = "service"
	LogFieldComponent  = "component"
	LogFieldOperation  = "operation"
	LogFieldPolicyID   = "policy_id"
	LogFieldEventType  = "event_type"
	LogFieldStatusCode = "status_code"
	LogFieldMethod     = "method"
	LogFieldPath       = "path"
	LogFieldDuration   = "duration_ms"
)

// Custom log entry for common operations
func (a *App) logOperation(level logrus.Level, component, operation string, fields map[string]interface{}) {
	entry := a.Logger.WithFields(logrus.Fields{
		LogFieldService:   "network-resilience-service",
		LogFieldComponent: component,
		LogFieldOperation: operation,
	})
	for k, v := range fields {
		entry = entry.WithField(k, v)
	}
	entry.Log(level, "Operation completed.")
}

// Example usage of structured logging in handlers
/*
func (a *App) createPolicyHandler(w http.ResponseWriter, r *http.Request) {
	// ... existing code ...

	// Instead of a.Logger.Infof("Created new policy: %s", policy.ID)
	a.logOperation(logrus.InfoLevel, "policy_api", "create_policy", map[string]interface{}{
		LogFieldPolicyID: policy.ID,
		"policy_name":    policy.Name,
		"policy_type":    policy.Type,
		LogFieldStatusCode: http.StatusCreated,
	})
}
*/

// Advanced metrics for specific policy types (simulated)
var (
	circuitBreakerTripped = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "circuit_breaker_tripped_total",
			Help: "Total number of times a circuit breaker has tripped.",
		},
		[]string{"policy_id"},
	)

	retryAttemptsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "retry_attempts_total",
			Help: "Total number of retry attempts.",
		},
		[]string{"policy_id"},
	)

	rateLimitBlockedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "rate_limit_blocked_total",
			Help: "Total number of requests blocked by rate limiting.",
		},
		[]string{"policy_id"},
	)
)

func init() {
	// Register new metrics
	prometheus.MustRegister(circuitBreakerTripped)
	prometheus.MustRegister(retryAttemptsTotal)
	prometheus.MustRegister(rateLimitBlockedTotal)
}

// Simulate a circuit breaker tripping
func (a *App) simulateCircuitBreakerTrip(policyID string) {
	circuitBreakerTripped.WithLabelValues(policyID).Inc()
	a.Logger.Warnf("Simulating circuit breaker trip for policy: %s", policyID)
}

// Simulate a retry attempt
func (a *App) simulateRetryAttempt(policyID string) {
	retryAttemptsTotal.WithLabelValues(policyID).Inc()
	a.Logger.Debugf("Simulating retry attempt for policy: %s", policyID)
}

// Simulate a rate limit block
func (a *App) simulateRateLimitBlock(policyID string) {
	rateLimitBlockedTotal.WithLabelValues(policyID).Inc()
	a.Logger.Warnf("Simulating rate limit block for policy: %s", policyID)
}

// Example of how these simulations could be integrated into policy application logic
/*
func (a *App) applyPolicyHandler(w http.ResponseWriter, r *http.Request) {
	// ... existing code ...

	switch policy.Type {
	case "circuit_breaker":
		// Logic to apply circuit breaker, and potentially trip it
		a.simulateCircuitBreakerTrip(policy.ID)
	case "retry":
		// Logic to apply retry, and potentially log attempts
		a.simulateRetryAttempt(policy.ID)
	case "rate_limit":
		// Logic to apply rate limit, and potentially block requests
		a.simulateRateLimitBlock(policy.ID)
	}

	// ... rest of the code ...
}
*/

// More detailed error handling for database operations
func handleDBError(err error, logger *logrus.Logger, operation string) *CustomError {
	if pgErr, ok := err.(*pq.Error); ok {
		// PostgreSQL specific error codes
		switch pgErr.Code.Name() {
		case "unique_violation":
			logger.Errorf("Database unique constraint violation during %s: %v", operation, err)
			return NewCustomError("Duplicate entry already exists.", http.StatusConflict)
		case "foreign_key_violation":
			logger.Errorf("Database foreign key violation during %s: %v", operation, err)
			return NewCustomError("Referenced entity does not exist.", http.StatusUnprocessableEntity)
		case "serialization_failure", "deadlock_detected":
			logger.Warnf("Database concurrency error during %s: %v", operation, err)
			return NewCustomError("Concurrent modification detected, please try again.", http.StatusConflict)
		default:
			logger.Errorf("PostgreSQL error during %s: %v (Code: %s)", operation, err, pgErr.Code.Name())
			return NewCustomError("Database error occurred.", http.StatusInternalServerError)
		}
	} else if err == sql.ErrNoRows {
		logger.Warnf("No rows found during %s operation.", operation)
		return NewCustomError("Resource not found.", http.StatusNotFound)
	} else {
		logger.Errorf("Generic database error during %s: %v", operation, err)
		return NewCustomError("Internal database error.", http.StatusInternalServerError)
	}
}

// Example usage in handlers:
/*
func (a *App) createPolicyHandler(w http.ResponseWriter, r *http.Request) {
	// ... existing code ...

	_, err = tx.Exec(insertQuery, policy.ID, policy.Name, policy.Type, policy.Config, policy.CreatedAt, policy.UpdatedAt)
	if err != nil {
		ErrorResponse(w, handleDBError(err, a.Logger, "insert policy"), a.Logger)
		return
	}

	// ... rest of the code ...
}
*/

// More robust configuration loading with validation
func LoadConfigRobust() (Config, error) {
	v := viper.New()
	v.SetConfigFile(".env")
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			fmt.Println("No .env file found, relying on environment variables.")
		} else {
			return Config{}, fmt.Errorf("failed to read config file: %w", err)
		}
	}

	var config Config
	if err := v.Unmarshal(&config); err != nil {
		return Config{}, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Validate essential configuration parameters
	if config.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is not set in configuration")
	}
	if config.RedisAddr == "" {
		return Config{}, fmt.Errorf("REDIS_ADDR is not set in configuration")
	}

	// Set default values if not provided
	if config.ServerPort == "" {
		config.ServerPort = "8080"
	}
	if config.PrometheusPort == "" {
		config.PrometheusPort = "9090"
	}

	// Parse CORS allowed origins (if provided)
	if len(config.CORSAllowedOrigins) == 0 {
		// Default to allowing localhost for development
		config.CORSAllowedOrigins = []string{"http://localhost:3000", "http://localhost:8080"}
	}

	return config, nil
}

// Replace LoadConfig() with LoadConfigRobust() in main function
/*
func main() {
	// ...
	config, err := LoadConfigRobust()
	// ...
}
*/

// Add more detailed logging for Redis operations
/*
func InitializeRedis(addr, password string, db int, logger *logrus.Logger) (*redis.Client, error) {
	// ...
	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		logger.Errorf("Failed to ping Redis at %s: %v", addr, err)
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	logger.Info("Successfully connected to Redis.", logrus.Fields{"address": addr, "db": db})
	return rdb, nil
}
*/

// Add more detailed logging for DB operations
/*
func InitializeDB(databaseURL string, logger *logrus.Logger) (*sql.DB, error) {
	// ...
	if err = db.PingContext(ctx); err != nil {
		logger.Errorf("Failed to ping database: %v", err)
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	logger.Info("Successfully connected to PostgreSQL database.", logrus.Fields{"url": databaseURL})
	return db, nil
}
*/

// Add more detailed logging for HTTP requests
/*
func (a *App) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := uuid.New().String() // Assuming you have a UUID generation library

		a.Logger.WithFields(logrus.Fields{
			LogFieldMethod: r.Method,
			LogFieldPath:   r.URL.Path,
			"request_id":   requestID,
		}).Infof("Received request.")

		lw := &loggingResponseWriter{w, http.StatusOK}
		next.ServeHTTP(lw, r)

		duration := time.Since(start)
		httpRequestsTotal.WithLabelValues(r.URL.Path, r.Method, fmt.Sprintf("%d", lw.statusCode)).Inc()
		httpRequestsDuration.WithLabelValues(r.URL.Path, r.Method).Observe(duration.Seconds())

		a.Logger.WithFields(logrus.Fields{
			LogFieldMethod:     r.Method,
			LogFieldPath:       r.URL.Path,
			LogFieldStatusCode: lw.statusCode,
			LogFieldDuration:   duration.Milliseconds(),
			"request_id":       requestID,
		}).Infof("Completed request.")
	})
}
*/

// Further enhancements for a production-ready service:
// 1. Implement proper authentication and authorization (e.g., JWT, OAuth2).
// 2. Add input validation for all API endpoints using a library like `go-playground/validator`.
// 3. Implement graceful shutdown for long-running tasks and connections.
// 4. Use a more sophisticated configuration management system for different environments (e.g., Consul, Kubernetes ConfigMaps).
// 5. Implement distributed tracing with OpenTelemetry for better observability across microservices.
// 6. Add unit and integration tests for all components.
// 7. Consider using a framework like Gin or Echo for more streamlined API development if preferred over Gorilla Mux.
// 8. Implement a more robust health check that includes external dependencies beyond just pinging.
// 9. Add database connection retry logic with exponential backoff.
// 10. Implement a proper schema migration tool (e.g., `golang-migrate/migrate`) instead of simple `CREATE TABLE IF NOT EXISTS`.


