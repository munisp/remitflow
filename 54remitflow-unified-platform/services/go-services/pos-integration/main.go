// Package main provides the core functionality for the POS Integration Service.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
)

// Configuration holds service-wide settings.
type Config struct {
	Port            string
	DatabaseURL     string
	RedisAddr       string
	RedisPassword   string
	RedisDB         int
	AllowedOrigins  []string
}

// App holds the application's dependencies.
type App struct {
	DB      *sqlx.DB
	Redis   *redis.Client
	Config  *Config
	Router  *mux.Router
}

// NewConfig loads configuration from environment variables.
func NewConfig() *Config {
	return &Config{
		Port:            getEnv("PORT", "8080"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://user:password@localhost:5432/pos_db?sslmode=disable"),
		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   getEnv("REDIS_PASSWORD", ""),
		RedisDB:         getEnvAsInt("REDIS_DB", 0),
		AllowedOrigins:  []string{"*"}, // For simplicity, allow all origins. In production, specify allowed domains.
	}
}

// getEnv gets an environment variable or returns a default value.
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// getEnvAsInt gets an environment variable as an integer or returns a default value.
func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, fmt.Sprintf("%d", defaultValue))
	value, err := fmt.Sscanf(valueStr, "%d", &defaultValue)
	if err != nil || value != 1 {
		log.Printf("Warning: Could not parse environment variable %s as int, using default %d. Error: %v", key, defaultValue, err)
	}
	return defaultValue
}

// InitializeApp sets up the application with database, Redis, and router.
func (a *App) InitializeApp() {
	log.Println("Initializing application...")
	
	// Load configuration
	a.Config = NewConfig()

	// Initialize Database
	var err error
	a.DB, err = sqlx.Connect("postgres", a.Config.DatabaseURL)
	if err != nil {
		log.Fatalf("Could not connect to database: %v", err)
	}
	log.Println("Database connected successfully.")

	if err := a.setupDatabase(); err != nil {
		log.Fatalf("Failed to setup database: %v", err)
	}

	// Initialize Redis
	a.Redis = redis.NewClient(&redis.Options{
		Addr:     a.Config.RedisAddr,
		Password: a.Config.RedisPassword,
		DB:       a.Config.RedisDB,
	})

	_, err = a.Redis.Ping(a.Redis.Context()).Result()
	if err != nil {
		log.Fatalf("Could not connect to Redis: %v", err)
	}
	log.Println("Redis connected successfully.")

	// Initialize Router
	a.Router = mux.NewRouter()
	a.Router.Use(prometheusMiddleware)
	log.Println("Router initialized.")

	// Register Prometheus metrics
	registerMetrics()

	// Setup routes
	a.setupRoutes()

	log.Println("Application initialization complete.")
}

// Run starts the HTTP server.
func (a *App) Run() {
	log.Printf("Server starting on port %s", a.Config.Port)
	
	// Apply CORS middleware
	handler := cors.New(cors.Options{
		AllowedOrigins: a.Config.AllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
		Debug:            true, // Set to false in production
	}).Handler(a.Router)

	log.Fatal(http.ListenAndServe(":"+a.Config.Port, handler))
}

// setupRoutes defines all API endpoints.
func (a *App) setupRoutes() {
		a.Router.HandleFunc("/health", a.healthCheckHandler).Methods("GET")

	// Prometheus metrics endpoint
	a.Router.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// POS Integration specific routes
	a.Router.HandleFunc("/transactions", a.createTransaction).Methods("POST")
	a.Router.HandleFunc("/transactions/{id}", a.getTransactionByID).Methods("GET")
	a.Router.HandleFunc("/transactions/{id}", a.updateTransactionStatus).Methods("PUT")
	a.Router.HandleFunc("/transactions/{id}", a.deleteTransaction).Methods("DELETE")
	a.Router.HandleFunc("/devices", a.createDevice).Methods("POST")
	a.Router.HandleFunc("/devices/{id}", a.getDeviceByID).Methods("GET")
	a.Router.HandleFunc("/devices/{id}", a.updateDeviceStatus).Methods("PUT")
	a.Router.HandleFunc("/devices/{id}", a.deleteDevice).Methods("DELETE")
	a.Router.HandleFunc("/devices", a.getDevices).Methods("GET")

	// Additional transaction-related routes
	a.Router.HandleFunc("/transactions/{id}/process", a.processTransaction).Methods("POST")
	a.Router.HandleFunc("/transactions/{id}/payment", a.processPayment).Methods("POST")
	a.Router.HandleFunc("/transactions/{id}/refund", a.refundTransaction).Methods("POST")
	a.Router.HandleFunc("/transactions/{id}/void", a.voidTransaction).Methods("POST")
	a.Router.HandleFunc("/transactions/device/{device_id}", a.getTransactionsByDevice).Methods("GET")
	a.Router.HandleFunc("/transactions/status/{status}", a.getTransactionsByStatus).Methods("GET")
	a.Router.HandleFunc("/transactions/count", a.getTransactionCount).Methods("GET")
	a.Router.HandleFunc("/devices/count", a.getDeviceCount).Methods("GET")
	a.Router.HandleFunc("/summary/daily", a.getDailyTransactionSummary).Methods("GET")
	a.Router.HandleFunc("/devices/health", a.getDeviceHealthStatus).Methods("GET")

	log.Println("Routes configured.")
}

// healthCheckHandler provides a simple health check.
func (a *App) healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "POS Integration Service is healthy!")
}

// registerMetrics initializes Prometheus metrics.
var ( 
	requestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status"},
	)

	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_request_duration_seconds",
			Help: "Duration of HTTP requests.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path", "status"},
	)
)

func registerMetrics() {
	prometheus.MustRegister(requestsTotal)
	prometheus.MustRegister(requestDuration)
	log.Println("Prometheus metrics registered.")
}

// main function to start the application.
func main() {
	app := App{}
	app.InitializeApp()
	app.Run()
}




// PosTransaction represents a POS transaction.
type PosTransaction struct {
	ID        string  `db:"id" json:"id"`
	Amount    float64 `db:"amount" json:"amount"`
	Currency  string  `db:"currency" json:"currency"`
	Timestamp string  `db:"timestamp" json:"timestamp"`
	DeviceID  string  `db:"device_id" json:"device_id"`
	Status    string  `db:"status" json:"status"`
}

// createTransaction handles the creation of a new POS transaction.
func (a *App) createTransaction(w http.ResponseWriter, r *http.Request) {
	var transaction PosTransaction
	err := json.NewDecoder(r.Body).Decode(&transaction)
	if err != nil {
		sendError(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `INSERT INTO pos_transactions (id, amount, currency, timestamp, device_id, status) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err = a.DB.Exec(query, transaction.ID, transaction.Amount, transaction.Currency, transaction.Timestamp, transaction.DeviceID, transaction.Status)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		updateTransactionMetrics(Sale, "FAILED")
		return
	}

	// Invalidate cache for this transaction
	cacheKey := fmt.Sprintf("transaction:%s", transaction.ID)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", transaction.ID, err)
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(transaction)
	updateTransactionMetrics(Sale, "COMPLETED")

// getTransactionByID retrieves a POS transaction by its ID.
func (a *App) getTransactionByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var transaction PosTransaction

	// Try to get from cache first
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if found, err := a.getCache(cacheKey, &transaction); found && err == nil {
		log.Printf("Cache hit for transaction %s", id)
		json.NewEncoder(w).Encode(transaction)
		return
	} else if err != nil {
		log.Printf("Error getting from cache: %v", err)
	}

	err := a.DB.Get(&transaction, "SELECT * FROM pos_transactions WHERE id=$1", id)
	if err != nil {
		sendError(w, err.Error(), http.StatusNotFound)
		return
	}

	// Set to cache
	if err := a.setCache(cacheKey, transaction, 5*time.Minute); err != nil {
		log.Printf("Error setting cache for transaction %s: %v", id, err)
	}

	json.NewEncoder(w).Encode(transaction)
}

// updateTransactionStatus updates the status of a POS transaction.
func (a *App) updateTransactionStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var transaction PosTransaction
	err := json.NewDecoder(r.Body).Decode(&transaction)
	if err != nil {
		sendError(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, transaction.Status, id)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		updateTransactionMetrics("UNKNOWN", "FAILED")
		return
	}

	// Invalidate cache for this transaction
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(transaction)
	updateTransactionMetrics("UNKNOWN", transaction.Status)
}

// deleteTransaction deletes a POS transaction by its ID.
func (a *App) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	_, err := a.DB.Exec("DELETE FROM pos_transactions WHERE id=$1", id)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		updateTransactionMetrics("UNKNOWN", "FAILED")
		return
	}

	// Invalidate cache for this transaction
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, atabase creates necessary tables if they don't exist.
func (a *App) setupDatabase() error {
	schema := `
	CREATE TABLE IF NOT EXISTS pos_transactions (
		id VARCHAR(255) PRIMARY KEY,
		amount NUMERIC(10, 2) NOT NULL,
		currency VARCHAR(3) NOT NULL,
		timestamp VARCHAR(255) NOT NULL,
		device_id VARCHAR(255) NOT NULL,
		status VARCHAR(50) NOT NULL
	);
	`
	_, err := a.DB.Exec(schema)
	if err != nil {
		return fmt.Errorf("error creating pos_transactions table: %w", err)
	}
	log.Println("pos_transactions table ensured.")

	// Add more tables as needed for a comprehensive service
	// For example, a 'devices' table:
	// CREATE TABLE IF NOT EXISTS pos_devices (
	//    id VARCHAR(255) PRIMARY KEY,
	//    location VARCHAR(255) NOT NULL,
	//    status VARCHAR(50) NOT NULL
	// );

	return nil
}

// In InitializeApp, call setupDatabase after connecting to DB
// func (a *App) InitializeApp() {
// ...
//    a.DB, err = sqlx.Connect("postgres", a.Config.DatabaseURL)
//    if err != nil {
//        log.Fatalf("Could not connect to database: %v", err)
//    }
//    log.Println("Database connected successfully.")
//
//    if err := a.setupDatabase(); err != nil {
//        log.Fatalf("Failed to setup database: %v", err)
//    }
// ...
// }




// setCache sets a key-value pair in Redis with an expiration.
func (a *App) setCache(key string, value interface{}, expiration time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal data for cache: %w", err)
	}
	return a.Redis.Set(a.Redis.Context(), key, data, expiration).Err()
}

// getCache retrieves a value from Redis and unmarshals it into the target interface.
func (a *App) getCache(key string, dest interface{}) (bool, error) {
	val, err := a.Redis.Get(a.Redis.Context(), key).Result()
	if err == redis.Nil {
		return false, nil // Key not found
	} else if err != nil {
		return false, fmt.Errorf("failed to get data from cache: %w", err)
	}

	err = json.Unmarshal([]byte(val), dest)
	if err != nil {
		return false, fmt.Errorf("failed to unmarshal data from cache: %w", err)
	}
	return true, nil
}

// deleteCache deletes a key from Redis.
func (a *App) deleteCache(key string) error {
	return a.Redis.Del(a.Redis.Context(), key).Err()
}




// prometheusMiddleware measures request duration and total requests.
func prometheusMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		timer := prometheus.NewTimer(requestDuration.WithLabelValues(r.Method, r.URL.Path, "200")) // Status will be updated later
		defer timer.ObserveDuration()

		// Use a custom ResponseWriter to capture the status code
		lw := NewResponseWriter(w)
		next.ServeHTTP(lw, r)

		requestsTotal.WithLabelValues(r.Method, r.URL.Path, fmt.Sprintf("%d", lw.statusCode)).Inc()
	})
}

// ResponseWriter is a wrapper to capture the HTTP status code.
type ResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func NewResponseWriter(w http.ResponseWriter) *ResponseWriter {
	return &ResponseWriter{w, http.StatusOK}
}

func (lw *ResponseWriter) WriteHeader(code int) {
	lw.statusCode = code
	lw.ResponseWriter.WriteHeader(code)
}




// ErrorResponse represents a generic error response.
type ErrorResponse struct {
	Message string `json:"message"`
	Code    int    `json:"code"`
}

// sendError sends a JSON error response.
func sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{Message: message, Code: statusCode})
}




// TransactionType defines the type of transaction.
type TransactionType string

const (
	Sale         TransactionType = "SALE"
	Refund       TransactionType = "REFUND"
	Void         TransactionType = "VOID"
	Authorization TransactionType = "AUTHORIZATION"
)

// PosDevice represents a POS device.
type PosDevice struct {
	ID       string `db:"id" json:"id"`
	Location string `db:"location" json:"location"`
	Status   string `db:"status" json:"status"`
}

// createDevice handles the registration of a new POS device.
func (a *App) createDevice(w http.ResponseWriter, r *http.Request) {
	var device PosDevice
	err := json.NewDecoder(r.Body).Decode(&device)
	if err != nil {
		sendError(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	query := `INSERT INTO pos_devices (id, location, status) VALUES ($1, $2, $3)`
	_, err = a.DB.Exec(query, device.ID, device.Location, device.Status)
	if err != nil {
		sendError(w, "Failed to create device", http.StatusInternalServerError)
		updateDeviceStatusMetrics(device.ID, "FAILED_CREATION")
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(device)
	updateDeviceStatusMetrics(device.ID, device.Status)

// getDeviceByID retrieves a POS device by its ID.
func (a *App) getDeviceByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var device PosDevice
	cacheKey := fmt.Sprintf("device:%s", id)
	if found, err := a.getCache(cacheKey, &device); found && err == nil {
		log.Printf("Cache hit for device %s", id)
		json.NewEncoder(w).Encode(device)
		return
	} else if err != nil {
		log.Printf("Error getting from cache: %v", err)
	}

	err := a.DB.Get(&device, "SELECT * FROM pos_devices WHERE id=$1", id)
	if err != nil {
		sendError(w, "Device not found", http.StatusNotFound)
		return
	}

	if err := a.setCache(cacheKey, device, 5*time.Minute); err != nil {
		log.Printf("Error setting cache for device %s: %v", id, err)
	}

	json.NewEncoder(w).Encode(device)
}

// updateDeviceStatus updates the status of a POS device.
func (a *App) updateDeviceStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var device PosDevice
	err := json.NewDecoder(r.Body).Decode(&device)
	if err != nil {
		sendError(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	query := `UPDATE pos_devices SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, device.Status, id)
	if err != nil {
		sendError(w, "Failed to update device status", http.StatusInternalServerError)
		updateDeviceStatusMetrics(id, "FAILED_UPDATE")
		return
	}

	cacheKey := fmt.Sprintf("device:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for device %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(device)
	updateDeviceStatusMetrics(id, device.Status)

// deleteDevice deletes a POS device by its ID.
func (a *App) deleteDevice(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	_, err := a.DB.Exec("DELETE FROM pos_devices WHERE id=$1", id)
	if err != nil {
		sendError(w, "Failed to delete device", http.StatusInternalServerError)
		return
	}

	cacheKey := fmt.Sprintf("device:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for device %s: %v", id, err)
	}

	w.WriteHeader(http.StatusNoContent)
}

// getDevices retrieves a list of POS devices.
func (a *App) getDevices(w http.ResponseWriter, r *http.Request) {
	var devices []PosDevice
	err := a.DB.Select(&devices, "SELECT * FROM pos_devices")
	if err != nil {
		sendError(w, "Failed to retrieve devices", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(devices)
}

// setupDatabase creates necessary tables if they don't exist.
func (a *App) setupDatabase() error {
	schema := `
	CREATE TABLE IF NOT EXISTS pos_transactions (
		id VARCHAR(255) PRIMARY KEY,
		amount NUMERIC(10, 2) NOT NULL,
		currency VARCHAR(3) NOT NULL,
		timestamp VARCHAR(255) NOT NULL,
		device_id VARCHAR(255) NOT NULL,
		status VARCHAR(50) NOT NULL
	);

	CREATE TABLE IF NOT EXISTS pos_devices (
		id VARCHAR(255) PRIMARY KEY,
		location VARCHAR(255) NOT NULL,
		status VARCHAR(50) NOT NULL
	);
	`
	_, err := a.DB.Exec(schema)
	if err != nil {
		return fmt.Errorf("error creating tables: %w", err)
	}
	log.Println("Database tables ensured.")
	return nil
}

// Add more transaction-related functions

// processTransaction handles the overall processing of a transaction, including validation and status updates.
func (a *App) processTransaction(w http.ResponseWriter, r *http.Request) {
	var transaction PosTransaction
	err := json.NewDecoder(r.Body).Decode(&transaction)
	if err != nil {
		sendError(w, "Invalid transaction payload", http.StatusBadRequest)
		return
	}

	// Basic validation
	if transaction.Amount <= 0 {
		sendError(w, "Transaction amount must be positive", http.StatusBadRequest)
		return
	}

	// Simulate processing time
	time.Sleep(100 * time.Millisecond)

	// Update transaction status (e.g., from PENDING to COMPLETED or FAILED)
	transaction.Status = "COMPLETED"

	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, transaction.Status, transaction.ID)
	if err != nil {
		sendError(w, "Failed to update transaction status during processing", http.StatusInternalServerError)
		return
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf("transaction:%s", transaction.ID)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", transaction.ID, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(transaction)
}

// getTransactionsByDevice retrieves transactions for a specific device.
func (a *App) getTransactionsByDevice(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deviceID 	w.WriteHeader(http.StatusNoContent)
	updateTransactionMetrics("UNKNOWN", "DELETED")
}

// getTransactions retrieves a list of POS transactions.
func (a *App) getTransactions(w http.ResponseWriter, r *http.Request) {
	var transactions []PosTransaction
	err := a.DB.Select(&transactions, "SELECT * FROM pos_transactions")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transactions)
}/ getTransactionsByStatus retrieves transactions by their status.
func (a *App) getTransactionsByStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	status := vars["status"]

// getTransactions retrieves a list of POS transactions.
func (a *App) getTransactions(w http.ResponseWriter, r *http.Request) {


// simulateExternalPaymentGateway simulates an external payment gateway.
func (a *App) simulateExternalPaymentGateway(transactionID string, amount float64) (bool, error) {
	log.Printf("Simulating payment for transaction %s with amount %.2f", transactionID, amount)
	// Simulate success or failure based on some logic, e.g., amount
	if amount > 10000 {
		return false, fmt.Errorf("payment declined for large amount")
	}
	time.Sleep(50 * time.Millisecond) // Simulate network latency
	return true, nil
}

// processPayment handles payment processing for a transaction.
func (a *App) processPayment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var transaction PosTransaction
	err := a.DB.Get(&transaction, "SELECT * FROM pos_transactions WHERE id=$1", id)
	if err != nil {
		sendError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	if transaction.Status != "PENDING" {
		sendError(w, "Transaction already processed or in invalid state", http.StatusBadRequest)
		return
	}

	success, err := a.simulateExternalPaymentGateway(transaction.ID, transaction.Amount)
	if err != nil || !success {
		transaction.Status = "FAILED"
		sendError(w, fmt.Sprintf("Payment failed: %v", err), http.StatusInternalServerError)
	} else {
		transaction.Status = "COMPLETED"
	}

	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, transaction.Status, transaction.ID)
	if err != nil {
		sendError(w, "Failed to update transaction status after payment", http.StatusInternalServerError)
		return
	}

	cacheKey := fmt.Sprintf("transaction:%s", transaction.ID)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", transaction.ID, err)
	}

	json.NewEncoder(w).Encode(transaction)
}

// refundTransaction handles refund processing.
func (a *App) refundTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var transaction PosTransaction
	err := a.DB.Get(&transaction, "SELECT * FROM pos_transactions WHERE id=$1", id)
	if err != nil {
		sendError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	if transaction.Status != "COMPLETED" {
		sendError(w, "Only completed transactions can be refunded", http.StatusBadRequest)
		return
	}

	// Simulate refund process
	time.Sleep(50 * time.Millisecond)

	transaction.Status = "REFUNDED"
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, transaction.Status, transaction.ID)
	if err != nil {
		sendError(w, "Failed to update transaction status after refund", http.StatusInternalServerError)
		return
	}

	cacheKey := fmt.Sprintf("transaction:%s", transaction.ID)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", transaction.ID, err)
	}

	json.NewEncoder(w).Encode(transaction)
}

// voidTransaction handles voiding a transaction.
func (a *App) voidTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var transaction PosTransaction
	err := a.DB.Get(&transaction, "SELECT * FROM pos_transactions WHERE id=$1", id)
	if err != nil {
		sendError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	if transaction.Status == "VOIDED" || transaction.Status == "REFUNDED" {
		sendError(w, "Transaction already voided or refunded", http.StatusBadRequest)
		return
	}

	// Simulate void process
	time.Sleep(50 * time.Millisecond)

	transaction.Status = "VOIDED"
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err = a.DB.Exec(query, transaction.Status, transaction.ID)
	if err != nil {
		sendError(w, "Failed to update transaction status after void", http.StatusInternalServerError)
		return
	}

	cacheKey := fmt.Sprintf("transaction:%s", transaction.ID)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", transaction.ID, err)
	}

	json.NewEncoder(w).Encode(transaction)
}

// getDailyTransactionSummary provides a summary of daily transactions.
func (a *App) getDailyTransactionSummary(w http.ResponseWriter, r *http.Request) {
	// This would typically involve more complex SQL queries with date filtering and aggregation.
	// For simplicity, we'll just return a dummy summary.

	summary := map[string]interface{}{
		"date":         time.Now().Format("2006-01-02"),
		"total_sales":  1500.75,
		"total_refunds": 50.25,
		"transaction_count": 120,
	}

	json.NewEncoder(w).Encode(summary)
}

// getDeviceHealthStatus provides health status of all devices.
func (a *App) getDeviceHealthStatus(w http.ResponseWriter, r *http.Request) {
	var devices []PosDevice
	err := a.DB.Select(&devices, "SELECT id, status FROM pos_devices")
	if err != nil {
		sendError(w, "Failed to retrieve device health status", http.StatusInternalServerError)
		return
	}

	healthStatus := make(map[string]string)
	for _, device := range devices {
		healthStatus[device.ID] = device.Status
	}

	json.NewEncoder(w).Encode(healthStatus)
}

// registerMetrics initializes Prometheus metrics.
var (
	// Existing metrics
	requestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status"},
	)

	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_request_duration_seconds",
			Help: "Duration of HTTP requests.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path", "status"},
	)

	// New metrics for business logic
	transactionsProcessed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "pos_transactions_processed_total",
			Help: "Total number of POS transactions processed.",
		},
		[]string{"type", "status"},
	)

	deviceStatusChanges = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "pos_device_status_changes_total",
			Help: "Total number of POS device status changes.",
		},
		[]string{"device_id", "new_status"},
	)

	activeDevices = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "pos_active_devices",
			Help: "Number of currently active POS devices.",
		},
	)
)

func registerMetrics() {
	prometheus.MustRegister(requestsTotal)
	prometheus.MustRegister(requestDuration)
	prometheus.MustRegister(transactionsProcessed)
	prometheus.MustRegister(deviceStatusChanges)
	prometheus.MustRegister(activeDevices)
	log.Println("Prometheus metrics registered.")
}

// updateTransactionMetrics increments the transaction counter.
func updateTransactionMetrics(transactionType TransactionType, status string) {
	transactionsProcessed.WithLabelValues(string(transactionType), status).Inc()
}

// updateDeviceStatusMetrics increments the device status change counter.
func updateDeviceStatusMetrics(deviceID, newStatus string) {
	deviceStatusChanges.WithLabelValues(deviceID, newStatus).Inc()
}

// updateActiveDevicesMetrics sets the current number of active devices.
func updateActiveDevicesMetrics(count float64) {
	activeDevices.Set(count)
}

// In createTransaction, update metrics
// func (a *App) createTransaction(w http.ResponseWriter, r *http.Request) {
// ...
//    if err != nil {
//        sendError(w, err.Error(), http.StatusInternalServerError)
//        updateTransactionMetrics(Sale, "FAILED")
//        return
//    }
//    updateTransactionMetrics(Sale, "COMPLETED")
// ...
// }

// In updateTransactionStatus, update metrics
// func (a *App) updateTransactionStatus(w http.ResponseWriter, r *http.Request) {
// ...
//    if err != nil {
//        sendError(w, "Failed to update transaction status", http.StatusInternalServerError)
//        updateTransactionMetrics(Unknown, "FAILED") // Assuming Unknown type for status update
//        return
//    }
//    updateTransactionMetrics(Unknown, transaction.Status)
// ...
// }

// In createDevice, update metrics
// func (a *App) createDevice(w http.ResponseWriter, r *http.Request) {
// ...
//    if err != nil {
//        sendError(w, "Failed to create device", http.StatusInternalServerError)
//        return
//    }
//    updateDeviceStatusMetrics(device.ID, device.Status)
//    // Consider updating activeDevices gauge here if device status implies active
// ...
// }

// In updateDeviceStatus, update metrics
// func (a *App) updateDeviceStatus(w http.ResponseWriter, r *http.Request) {
// ...
//    if err != nil {
//        sendError(w, "Failed to update device status", http.StatusInternalServerError)
//        return
//    }
//    updateDeviceStatusMetrics(id, device.Status)
//    // Consider updating activeDevices gauge here if device status implies active
// ...
// }

// In deleteDevice, update metrics
// func (a *App) deleteDevice(w http.ResponseWriter, r *http.Request) {
// ...
//    if err != nil {
//        sendError(w, "Failed to delete device", http.StatusInternalServerError)
//        return
//    }
//    // Consider updating activeDevices gauge here if device is no longer active
// ...
// }

// In getDeviceCount, update activeDevices gauge periodically or on demand
// func (a *App) getDeviceCount(w http.ResponseWriter, r *http.Request) {
// ...
//    updateActiveD	"os"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/cors"
)

// processTransaction handles the processing of a transaction.
func (a *App) processTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Simulate transaction processing logic
	log.Printf("Processing transaction %s", id)

	// Update transaction status in DB
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err := a.DB.Exec(query, "PROCESSED", id)
	if err != nil {
		sendError(w, "Failed to process transaction", http.StatusInternalServerError)
		return
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Transaction %s processed successfully", id)})
}

// processPayment handles payment for a transaction.
func (a *App) processPayment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Simulate payment processing logic
	log.Printf("Processing payment for transaction %s", id)

	// Update transaction status in DB
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err := a.DB.Exec(query, "PAID", id)
	if err != nil {
		sendError(w, "Failed to process payment", http.StatusInternalServerError)
		return
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Payment for transaction %s processed successfully", id)})
}

// refundTransaction handles refunding a transaction.
func (a *App) refundTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Simulate refund processing logic
	log.Printf("Refunding transaction %s", id)

	// Update transaction status in DB
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err := a.DB.Exec(query, "REFUNDED", id)
	if err != nil {
		sendError(w, "Failed to refund transaction", http.StatusInternalServerError)
		return
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Transaction %s refunded successfully", id)})
}

// voidTransaction handles voiding a transaction.
func (a *App) voidTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Simulate void processing logic
	log.Printf("Voiding transaction %s", id)

	// Update transaction status in DB
	query := `UPDATE pos_transactions SET status=$1 WHERE id=$2`
	_, err := a.DB.Exec(query, "VOIDED", id)
	if err != nil {
		sendError(w, "Failed to void transaction", http.StatusInternalServerError)
		return
	}

	// Invalidate cache
	cacheKey := fmt.Sprintf("transaction:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for transaction %s: %v", id, err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Transaction %s voided successfully", id)})
}

// getTransactionsByDevice retrieves transactions for a specific device.
func (a *App) getTransactionsByDevice(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deviceID := vars["device_id"]

	var transactions []PosTransaction
	err := a.DB.Select(&transactions, "SELECT * FROM pos_transactions WHERE device_id=$1", deviceID)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transactions)
}

// getTransactionsByStatus retrieves transactions by their status.
func (a *App) getTransactionsByStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	status := vars["status"]

	var transactions []PosTransaction
	err := a.DB.Select(&transactions, "SELECT * FROM pos_transactions WHERE status=$1", status)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transactions)
}

// getTransactionCount retrieves the total number of transactions.
func (a *App) getTransactionCount(w http.ResponseWriter, r *http.Request) {
	var count int
	err := a.DB.Get(&count, "SELECT COUNT(*) FROM pos_transactions")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]int{"count": count})
}

// getDeviceCount retrieves the total number of devices.
func (a *App) getDeviceCount(w http.ResponseWriter, r *http.Request) {
	var count int
	err := a.DB.Get(&count, "SELECT COUNT(*) FROM pos_devices")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]int{"count": count})
}

// getDailyTransactionSummary retrieves a summary of transactions for the current day.
func (a *App) getDailyTransactionSummary(w http.ResponseWriter, r *http.Request) {
	// This is a simplified example. In a real application, you'd query by date.
	var totalAmount float64
	var transactionCount int

	err := a.DB.Get(&totalAmount, "SELECT COALESCE(SUM(amount), 0) FROM pos_transactions WHERE timestamp LIKE ?", time.Now().Format("2006-01-02")+"%")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	err = a.DB.Get(&transactionCount, "SELECT COUNT(*) FROM pos_transactions WHERE timestamp LIKE ?", time.Now().Format("2006-01-02")+"%")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"date": time.Now().Format("2006-01-02"),
		"total_amount": totalAmount,
		"transaction_count": transactionCount,
	})
}

// getDeviceHealthStatus retrieves the health status of all devices.
func (a *App) getDeviceHealthStatus(w http.ResponseWriter, r *http.Request) {
	var devices []PosDevice
	err := a.DB.Select(&devices, "SELECT id, status FROM pos_devices")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	healthStatus := make(map[string]string)
	for _, device := range devices {
		healthStatus[device.ID] = device.Status
	}

	json.NewEncoder(w).Encode(healthStatus)
}

// updateTransactionMetrics updates Prometheus metrics for transactions.
func updateTransactionMetrics(transactionType TransactionType, status string) {
	requestsTotal.WithLabelValues(string(transactionType), "/transactions", status).Inc()
}

// updateDeviceStatusMetrics updates Prometheus metrics for device status.
func updateDeviceStatusMetrics(deviceID, status string) {
	requestsTotal.WithLabelValues("DEVICE_UPDATE", fmt.Sprintf("/devices/%s", deviceID), status).Inc()
}

// deleteDevice deletes a POS device by its ID.
func (a *App) deleteDevice(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	_, err := a.DB.Exec("DELETE FROM pos_devices WHERE id=$1", id)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		updateDeviceStatusMetrics(id, "FAILED_DELETION")
		return
	}

	// Invalidate cache for this device
	cacheKey := fmt.Sprintf("device:%s", id)
	if err := a.deleteCache(cacheKey); err != nil {
		log.Printf("Error deleting cache for device %s: %v", id, err)
	}

	w.WriteHeader(http.StatusNoContent)
	updateDeviceStatusMetrics(id, "DELETED")
}

// getDevices retrieves a list of POS devices.
func (a *App) getDevices(w http.ResponseWriter, r *http.Request) {
	var devices []PosDevice
	err := a.DB.Select(&devices, "SELECT * FROM pos_devices")
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(devices)
}


