package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/cors"
	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v2"
)

// Config represents the application configuration loaded from config.yaml.
// It includes server, database, Redis, security, and rate limiting settings.
type Config struct {
	Server struct {
		Port string `yaml:"port"` // Port on which the HTTP server will listen.
	} `yaml:"server"`
	Database struct {
		URL string `yaml:"url"` // Database connection URL (e.g., PostgreSQL).
	} `yaml:"database"`
	Redis struct {
		Addr     string `yaml:"addr"`     // Redis server address (host:port).
		Password string `yaml:"password"` // Redis password, if any.
		DB       int    `yaml:"db"`       // Redis database number.
	} `yaml:"redis"`
	Security struct {
		JWTSecret string `yaml:"jwt_secret"` // Secret key for signing JWT tokens.
		TokenExpiryMinutes int `yaml:"token_expiry_minutes"` // JWT token expiry time in minutes.
		PasswordMinLength int `yaml:"password_min_length"` // Minimum length for user passwords.
		PasswordRequireUppercase bool `yaml:"password_require_uppercase"` // Enforce uppercase characters in passwords.
		PasswordRequireLowercase bool `yaml:"password_require_lowercase"` // Enforce lowercase characters in passwords.
		PasswordRequireDigit bool `yaml:"password_require_digit"`     // Enforce digits in passwords.
		PasswordRequireSpecialChar bool `yaml:"password_require_special_char"` // Enforce special characters in passwords.
	} `yaml:"security"`
	RateLimiting struct {
		Enabled bool `yaml:"enabled"` // Enable or disable rate limiting.
		RequestsPerSecond float64 `yaml:"requests_per_second"` // Max requests per second.
		Burst int `yaml:"burst"` // Max burst of requests allowed.
	} `yaml:"rate_limiting"`
}

// User represents a user entity in the system, mapping to the 'users' table in the database.
type User struct {
	ID       int    `json:"id"`         // Unique identifier for the user.
	Username string `json:"username"` // User's unique username.
	Password string `json:"-"`         // Hashed password, excluded from JSON output for security.
	Role     string `json:"role"`     // User's role (e.g., 'admin', 'user', 'auditor').
	CreatedAt time.Time `json:"created_at"` // Timestamp of user creation.
	UpdatedAt time.Time `json:"updated_at"` // Timestamp of last user update.
}

// Session represents a user's active session, typically managed via JWT tokens.
type Session struct {
	Token string `json:"token"`       // The JWT token string.
	UserID int `json:"user_id"`     // The ID of the user associated with the session.
	ExpiresAt time.Time `json:"expires_at"` // The expiration time of the session/token.
}

// AuditLog represents an event recorded for auditing purposes.
// These logs track security-relevant actions and system events.
type AuditLog struct {
	ID int `json:"id"`                 // Unique identifier for the audit log entry.
	EventType string `json:"event_type"` // Type of event (e.g., 'login_success', 'user_created').
	Username string `json:"username"`   // Username associated with the event.
	Timestamp time.Time `json:"timestamp"` // Time when the event occurred.
	Details string `json:"details"`     // Detailed description of the event.
}

// Claims defines the structure of JWT claims, including standard and custom fields.
type Claims struct {
	Username string `json:"username"` // User's username.
	Role     string `json:"role"`     // User's role.
	jwt.RegisteredClaims             // Standard JWT claims like expiration time.
}

var dbPool *pgxpool.Pool     // Database connection pool for PostgreSQL.
var redisClient *redis.Client // Redis client for caching and token blacklisting.
var appConfig Config           // Global application configuration.

// Prometheus metrics for monitoring the service.
var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests processed by path.",
		},
		[]string{"path"},
	)
	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "http_request_duration_seconds",
			Help: "Duration of HTTP requests in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path"},
	)
	auditLogCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "audit_log_events_total",
			Help: "Total number of audit log events by type and user.",
		},
		[]string{"event_type", "user"},
	)
	dbConnectionsGauge = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "db_connections_open",
			Help: "Number of open database connections in the pool.",
		},
	)
	redisConnectionsGauge = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "redis_connections_open",
			Help: "Number of open Redis connections.",
		},
	)
	rateLimiter = NewRateLimiter() // Global rate limiter instance.
)

// init function is called before main and is used for setup like loading configuration and registering metrics.
func init() {
	// Register all defined Prometheus metrics.
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpDuration)
	prometheus.MustRegister(auditLogCounter)
	prometheus.MustRegister(dbConnectionsGauge)
	prometheus.MustRegister(redisConnectionsGauge)

	// Determine configuration file path. Defaults to config.yaml if not set via environment variable.
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config.yaml"
	}

	// Read the configuration file.
	configData, err := os.ReadFile(configPath)
	if err != nil {
		log.Fatalf("Error reading config file %s: %v\n", configPath, err)
	}

	// Unmarshal YAML configuration into the appConfig struct.
	err = yaml.Unmarshal(configData, &appConfig)
	if err != nil {
		log.Fatalf("Error unmarshalling config data from %s: %v\n", configPath, err)
	}
	log.Printf("Configuration successfully loaded from %s\n", configPath)

	// Validate essential security configurations.
	if appConfig.Security.JWTSecret == "" {
		log.Fatal("JWT_SECRET not set in config.yaml. This is critical for token security.")
	}
	if appConfig.Security.TokenExpiryMinutes == 0 {
		appConfig.Security.TokenExpiryMinutes = 60 // Default JWT token expiry to 60 minutes.
		log.Println("Token expiry not set, defaulting to 60 minutes.")
	}
	if appConfig.Security.PasswordMinLength == 0 {
		appConfig.Security.PasswordMinLength = 8 // Default minimum password length to 8 characters.
		log.Println("Password minimum length not set, defaulting to 8 characters.")
	}

	// Initialize the rate limiter if enabled in the configuration.
	if appConfig.RateLimiting.Enabled {
		rateLimiter.SetRate(appConfig.RateLimiting.RequestsPerSecond, appConfig.RateLimiting.Burst)
		log.Printf("Rate limiting enabled: %f requests/sec with burst %d\n", appConfig.RateLimiting.RequestsPerSecond, appConfig.RateLimiting.Burst)
	} else {
		log.Println("Rate limiting is disabled.")
	}
}

// CustomError defines a structured error response for API clients.
type CustomError struct {
	Message string `json:"message"`         // Human-readable error message.
	Code    int    `json:"code"`            // HTTP status code associated with the error.
	Details string `json:"details,omitempty"` // Optional detailed error information.
}

// Error implements the error interface for CustomError.
func (e *CustomError) Error() string {
	return fmt.Sprintf("Error %d: %s (Details: %s)", e.Code, e.Message, e.Details)
}

// respondWithError sends a JSON formatted error response to the client.
func respondWithError(w http.ResponseWriter, code int, message string, details ...string) {
	errResponse := CustomError{Message: message, Code: code}
	if len(details) > 0 {
		errResponse.Details = strings.Join(details, ", ")
	}
	log.Printf("Responding with error: Code=%d, Message=%s, Details=%s\n", code, message, errResponse.Details)
	respondWithJSON(w, code, errResponse)
}

// respondWithJSON sends a JSON formatted success response to the client.
func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Error marshalling JSON response payload: %v\n", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, err = w.Write(response)
	if err != nil {
		log.Printf("Error writing JSON response: %v\n", err)
	}
}

// main function initializes the database, Redis, sets up routes, and starts the HTTP server.
func main() {
	fmt.Println("Starting Security Service...")

	// Establish database connection pool.
	var err error
	dbPool, err = pgxpool.Connect(context.Background(), appConfig.Database.URL)
	if err != nil {
		log.Fatalf("Unable to connect to database at %s: %v\n", appConfig.Database.URL, err)
	}
	defer dbPool.Close() // Ensure database connection is closed on application exit.

	// Verify database connection by pinging.
	err = dbPool.Ping(context.Background())
	if err != nil {
		log.Fatalf("Cannot ping database: %v\n", err)
	}
	log.Println("Successfully connected to database!")

	// Initialize Redis client.
	redisClient = redis.NewClient(&redis.Options{
		Addr: appConfig.Redis.Addr,
		Password: appConfig.Redis.Password,
		DB:       appConfig.Redis.DB,
	})

	// Verify Redis connection by pinging.
	_, err = redisClient.Ping(context.Background()).Result()
	if err != nil {
		log.Fatalf("Could not connect to Redis at %s: %v\n", appConfig.Redis.Addr, err)
	}
	log.Println("Successfully connected to Redis!")

	// Initialize CORS middleware with default settings.
	c := cors.Default()

	// Define HTTP routes and apply middleware.
	http.Handle("/metrics", promhttp.Handler()) // Expose Prometheus metrics.
	http.HandleFunc("/health", rateLimitMiddleware(prometheusMiddleware(healthCheckHandler, "/health")))
	http.HandleFunc("/cache-test", rateLimitMiddleware(prometheusMiddleware(cacheTestHandler, "/cache-test")))

	// User management API endpoints.
	http.HandleFunc("/users", rateLimitMiddleware(prometheusMiddleware(usersHandler, "/users")))
	http.HandleFunc("/users/", rateLimitMiddleware(prometheusMiddleware(userHandler, "/users/"))) // Handles /users/{id}

	// Authentication API endpoints.
	http.HandleFunc("/login", rateLimitMiddleware(prometheusMiddleware(loginHandler, "/login")))
	http.HandleFunc("/password-reset", rateLimitMiddleware(prometheusMiddleware(passwordResetHandler, "/password-reset")))
	http.HandleFunc("/change-password", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(changePasswordHandler, ""), "/change-password")))
	http.HandleFunc("/logout", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(logoutHandler, ""), "/logout")))

	// Role management API endpoints.
	http.HandleFunc("/roles", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(rolesHandler, "admin"), "/roles")))
	http.HandleFunc("/roles/assign", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(assignRoleHandler, "admin"), "/roles/assign")))

	// Audit log API endpoint.
	http.HandleFunc("/audit-logs", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(getAuditLogsHandler, "admin"), "/audit-logs")))

	// Multi-Factor Authentication (MFA) placeholder endpoints.
	http.HandleFunc("/mfa/setup", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(mfaSetupHandler, ""), "/mfa/setup")))
	http.HandleFunc("/mfa/verify", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(mfaVerifyHandler, ""), "/mfa/verify")))

	// Example of a protected administrative route.
	http.HandleFunc("/admin/users", rateLimitMiddleware(prometheusMiddleware(authorizeMiddleware(adminUsersHandler, "admin"), "/admin/users")))

	// Apply CORS middleware to the default HTTP serve mux.
	handler := c.Handler(http.DefaultServeMux)

	// Start the HTTP server and log any fatal errors.
	port := ":" + appConfig.Server.Port
	log.Printf("Security Service listening on %s\n", port)
	log.Fatal(http.ListenAndServe(port, handler))
}

// RateLimiter implements a token bucket algorithm for controlling request rates.
type RateLimiter struct {
	mu      sync.Mutex // Mutex to protect access to rate limiter fields.
	lastRefill time.Time // Last time tokens were refilled.
	tokens  float64    // Current number of available tokens.
	rate    float64    // Rate at which tokens are added (tokens per second).
	burst   int        // Maximum capacity of the token bucket.
}

// NewRateLimiter creates and initializes a new RateLimiter with default values.
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		lastRefill: time.Now(),
		tokens:     0,
		rate:       10, // Default rate: 10 requests per second.
		burst:      20, // Default burst: allow up to 20 requests in a burst.
	}
}

// SetRate updates the rate and burst capacity of the rate limiter.
func (rl *RateLimiter) SetRate(rate float64, burst int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.rate = rate
	rl.burst = burst
	rl.tokens = float64(burst) // Refill bucket to full capacity when rate changes.
	log.Printf("Rate limiter updated: rate=%.2f req/s, burst=%d\n", rate, burst)
}

// Allow checks if a request is permitted by the rate limiter.
// It returns true if a token is available, false otherwise.
func (rl *RateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(rl.lastRefill).Seconds()
	rl.lastRefill = now

	// Add new tokens based on elapsed time and rate.
	rl.tokens += elapsed * rl.rate
	if rl.tokens > float64(rl.burst) {
		rl.tokens = float64(rl.burst) // Cap tokens at burst limit.
	}

	// Consume a token if available.
	if rl.tokens >= 1 {
		rl.tokens--
		return true
	}
	return false
}

// rateLimitMiddleware is an HTTP middleware that applies rate limiting to incoming requests.
func rateLimitMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if appConfig.RateLimiting.Enabled && !rateLimiter.Allow() {
			log.Printf("Rate limit exceeded for request to %s from IP %s\n", r.URL.Path, r.RemoteAddr)
			respondWithError(w, http.StatusTooManyRequests, "Rate limit exceeded")
			logAudit("rate_limit_exceeded", r.RemoteAddr, fmt.Sprintf("Rate limit exceeded for %s from IP %s", r.URL.Path, r.RemoteAddr))
			return
		}
		next.ServeHTTP(w, r)
	}
}

// prometheusMiddleware is an HTTP middleware that records request metrics for Prometheus.
func prometheusMiddleware(next http.HandlerFunc, path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		httpRequestsTotal.WithLabelValues(path).Inc() // Increment total request count.
		httpDuration.WithLabelValues(path).Observe(time.Since(start).Seconds()) // Observe request duration.
	}
}

// healthCheckHandler provides a health status of the service, including database and Redis connections.
func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received health check request.")
	// Check database connection health.
	err := dbPool.Ping(context.Background())
	if err != nil {
		log.Printf("Health check failed: Database ping failed: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Database connection error")
		return
	}

	// Check Redis connection health.
	_, err = redisClient.Ping(context.Background()).Result()
	if err != nil {
		log.Printf("Health check failed: Redis ping failed: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Redis connection error")
		return
	}

	// Update Prometheus gauges with current connection statistics.
	dbConnectionsGauge.Set(float64(dbPool.Stat().TotalConns()))
	redisConnectionsGauge.Set(float64(redisClient.PoolStats().Hits + redisClient.PoolStats().Misses))

	log.Println("Health check successful.")
	respondWithJSON(w, http.StatusOK, map[string]string{"status": "Security Service is healthy and connected to DB and Redis!"})
}

// cacheTestHandler demonstrates basic Redis caching functionality.
func cacheTestHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received cache test request.")
	ctx := context.Background()
	key := "mykey"
	value := "myvalue"

	// Set a value in Redis with a 10-second expiration.
	err := redisClient.Set(ctx, key, value, 10*time.Second).Err()
	if err != nil {
		log.Printf("Cache test failed: Redis Set operation failed: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to set value in Redis")
		return
	}
	log.Printf("Successfully set key '%s' in Redis.\n", key)

	// Get the value from Redis.
	val, err := redisClient.Get(ctx, key).Result()
	if err == redis.Nil {
		log.Printf("Cache test: Key '%s' not found in cache.\n", key)
		respondWithJSON(w, http.StatusOK, map[string]string{"message": fmt.Sprintf("Key %s not found in cache", key)})
	} else if err != nil {
		log.Printf("Cache test failed: Redis Get operation failed: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to get value from Redis")
		return
	} else {
		log.Printf("Cache test successful: Retrieved value '%s' for key '%s'.\n", val, key)
		respondWithJSON(w, http.StatusOK, map[string]string{"value": val})
	}
}

// usersHandler dispatches requests for /users based on HTTP method (GET all, POST create).
func usersHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getUsers(w, r)
	case "POST":
		createUser(w, r)
	default:
		log.Printf("Method %s not allowed for /users\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// userHandler dispatches requests for /users/{id} based on HTTP method (GET, PUT, DELETE).
func userHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/users/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		log.Printf("Invalid user ID format: %s\n", idStr)
		respondWithError(w, http.StatusBadRequest, "Invalid user ID")
		return
	}

	switch r.Method {
	case "GET":
		getUser(w, r, id)
	case "PUT":
		updateUser(w, r, id)
	case "DELETE":
		deleteUser(w, r, id)
	default:
		log.Printf("Method %s not allowed for /users/{id}\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// getUsers retrieves all users from the database and returns them as a JSON array.
func getUsers(w http.ResponseWriter, r *http.Request) {
	log.Println("Retrieving all users.")
	rows, err := dbPool.Query(context.Background(), "SELECT id, username, role, created_at, updated_at FROM users")
	if err != nil {
		log.Printf("Error querying users from database: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve users")
		return
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &u.UpdatedAt); err != nil {
			log.Printf("Error scanning user row: %v\n", err)
			continue // Skip malformed rows.
		}
		users = append(users, u)
	}
	log.Printf("Successfully retrieved %d users.\n", len(users))
	respondWithJSON(w, http.StatusOK, users)
}

// getUser retrieves a single user by their ID from the database.
func getUser(w http.ResponseWriter, r *http.Request, id int) {
	log.Printf("Retrieving user with ID: %d\n", id)
	var u User
	err := dbPool.QueryRow(context.Background(), "SELECT id, username, role, created_at, updated_at FROM users WHERE id = $1", id).Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		log.Printf("User with ID %d not found or database error: %v\n", id, err)
		respondWithError(w, http.StatusNotFound, "User not found")
		return
	}
	log.Printf("Successfully retrieved user: %s (ID: %d)\n", u.Username, u.ID)
	respondWithJSON(w, http.StatusOK, u)
}

// createUser handles the creation of a new user, including password hashing and validation.
func createUser(w http.ResponseWriter, r *http.Request) {
	log.Println("Attempting to create new user.")
	var u User
	err := json.NewDecoder(r.Body).Decode(&u)
	if err != nil {
		log.Printf("Invalid request payload for user creation: %v\n", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Basic input validation for essential fields.
	if u.Username == "" || u.Password == "" || u.Role == "" {
		log.Println("Validation failed: Username, password, or role is empty.")
		respondWithError(w, http.StatusBadRequest, "Username, password, and role cannot be empty")
		return
	}

	// Validate password complexity.
	if !isValidPassword(u.Password) {
		log.Println("Validation failed: Password does not meet complexity requirements.")
		respondWithError(w, http.StatusBadRequest, "Password does not meet complexity requirements")
		return
	}

	// Hash the user's password before storing.
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password for user %s: %v\n", u.Username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to create user")
		return
	}
	u.Password = string(hashedPassword)

	currentTime := time.Now()
	// Insert new user into the database.
	err = dbPool.QueryRow(context.Background(), "INSERT INTO users(username, password, role, created_at, updated_at) VALUES($1, $2, $3, $4, $5) RETURNING id", u.Username, u.Password, u.Role, currentTime, currentTime).Scan(&u.ID)
	if err != nil {
		log.Printf("Error inserting user %s into database: %v\n", u.Username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to create user")
		return
	}

	logAudit("user_created", u.Username, fmt.Sprintf("New user %s created with role %s (ID: %d)", u.Username, u.Role, u.ID))
	log.Printf("User %s created successfully with ID: %d\n", u.Username, u.ID)
	respondWithJSON(w, http.StatusCreated, u)
}

// updateUser handles updating an existing user's information.
func updateUser(w http.ResponseWriter, r *http.Request, id int) {
	log.Printf("Attempting to update user with ID: %d\n", id)
	var u User
	err := json.NewDecoder(r.Body).Decode(&u)
	if err != nil {
		log.Printf("Invalid request payload for user update (ID: %d): %v\n", id, err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Basic input validation.
	if u.Username == "" || u.Role == "" {
		log.Println("Validation failed: Username or role is empty for user update.")
		respondWithError(w, http.StatusBadRequest, "Username and role cannot be empty")
		return
	}

	// Handle password update if provided.
	if u.Password != "" {
		if !isValidPassword(u.Password) {
			log.Println("Validation failed: New password does not meet complexity requirements for user update.")
			respondWithError(w, http.StatusBadRequest, "New password does not meet complexity requirements")
			return
		}
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("Error hashing new password for user ID %d: %v\n", id, err)
			respondWithError(w, http.StatusInternalServerError, "Failed to update user")
			return
		}
		u.Password = string(hashedPassword)
		_, err = dbPool.Exec(context.Background(), "UPDATE users SET username = $1, password = $2, role = $3, updated_at = $4 WHERE id = $5", u.Username, u.Password, u.Role, time.Now(), id)
	} else {
		// Update user without changing password.
		_, err = dbPool.Exec(context.Background(), "UPDATE users SET username = $1, role = $2, updated_at = $3 WHERE id = $4", u.Username, u.Role, time.Now(), id)
	}

	if err != nil {
		log.Printf("Error updating user ID %d in database: %v\n", id, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to update user")
		return
	}

	logAudit("user_updated", u.Username, fmt.Sprintf("User %s (ID: %d) updated successfully", u.Username, id))
	log.Printf("User ID %d updated successfully.\n", id)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "User updated successfully"})
}

// deleteUser handles the deletion of a user by their ID.
func deleteUser(w http.ResponseWriter, r *http.Request, id int) {
	log.Printf("Attempting to delete user with ID: %d\n", id)
	var username string
	// First, retrieve the username for logging purposes.
	err := dbPool.QueryRow(context.Background(), "SELECT username FROM users WHERE id = $1", id).Scan(&username)
	if err != nil {
		log.Printf("User with ID %d not found for deletion: %v\n", id, err)
		respondWithError(w, http.StatusNotFound, "User not found")
		return
	}

	// Delete the user from the database.
	_, err = dbPool.Exec(context.Background(), "DELETE FROM users WHERE id = $1", id)
	if err != nil {
		log.Printf("Error deleting user ID %d from database: %v\n", id, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to delete user")
		return
	}

	logAudit("user_deleted", username, fmt.Sprintf("User %s (ID: %d) deleted successfully", username, id))
	log.Printf("User ID %d deleted successfully.\n", id)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "User deleted successfully"})
}

// loginHandler authenticates a user and issues a JWT token upon successful login.
func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		log.Printf("Method %s not allowed for /login\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var credentials struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	err := json.NewDecoder(r.Body).Decode(&credentials)
	if err != nil {
		log.Printf("Invalid request payload for login: %v\n", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Input validation for login credentials.
	if credentials.Username == "" || credentials.Password == "" {
		log.Println("Validation failed: Username or password empty for login.")
		respondWithError(w, http.StatusBadRequest, "Username and password cannot be empty")
		return
	}

	var storedPasswordHash string
	var role string
	// Retrieve stored password hash and role for the given username.
	err = dbPool.QueryRow(context.Background(), "SELECT password, role FROM users WHERE username = $1", credentials.Username).Scan(&storedPasswordHash, &role)
	if err != nil {
		log.Printf("Login failed for user %s: User not found or database error: %v\n", credentials.Username, err)
		respondWithError(w, http.StatusUnauthorized, "Invalid credentials")
		logAudit("login_failed", credentials.Username, "Invalid username or password")
		return
	}

	// Compare provided password with the stored hashed password.
	err = bcrypt.CompareHashAndPassword([]byte(storedPasswordHash), []byte(credentials.Password))
	if err != nil {
		log.Printf("Login failed for user %s: Password mismatch: %v\n", credentials.Username, err)
		respondWithError(w, http.StatusUnauthorized, "Invalid credentials")
		logAudit("login_failed", credentials.Username, "Invalid username or password")
		return
	}

	// Generate JWT token.
	expirationTime := time.Now().Add(time.Duration(appConfig.Security.TokenExpiryMinutes) * time.Minute)
	claims := &Claims{
		Username: credentials.Username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appConfig.Security.JWTSecret))
	if err != nil {
		log.Printf("Error generating JWT token for user %s: %v\n", credentials.Username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	logAudit("login_success", credentials.Username, "User logged in successfully")
	log.Printf("User %s logged in successfully. Token issued.\n", credentials.Username)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Login successful", "token": tokenString, "username": credentials.Username, "role": role})
}

// logoutHandler handles user logout by blacklisting their JWT token.
func logoutHandler(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value("username").(string)
	tokenString := r.Context().Value("token").(string)

	log.Printf("Attempting to log out user %s and blacklist token.\n", username)
	// Add token to blacklist in Redis with the same expiry as the token.
	err := redisClient.Set(context.Background(), "blacklist:" + tokenString, "true", time.Duration(appConfig.Security.TokenExpiryMinutes)*time.Minute).Err()
	if err != nil {
		log.Printf("Error blacklisting token for user %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to logout")
		return
	}

	logAudit("logout_success", username, "User logged out successfully and token blacklisted")
	log.Printf("User %s logged out successfully. Token blacklisted.\n", username)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Logout successful"})
}

// passwordResetHandler handles requests to reset a user's password.
func passwordResetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		log.Printf("Method %s not allowed for /password-reset\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var resetRequest struct {
		Username    string `json:"username"`
		NewPassword string `json:"new_password"`
	}

	err := json.NewDecoder(r.Body).Decode(&resetRequest)
	if err != nil {
		log.Printf("Invalid request payload for password reset: %v\n", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Input validation for password reset.
	if resetRequest.Username == "" || resetRequest.NewPassword == "" {
		log.Println("Validation failed: Username or new password empty for password reset.")
		respondWithError(w, http.StatusBadRequest, "Username and new password cannot be empty")
		return
	}

	// Validate new password complexity.
	if !isValidPassword(resetRequest.NewPassword) {
		log.Println("Validation failed: New password does not meet complexity requirements for password reset.")
		respondWithError(w, http.StatusBadRequest, "New password does not meet complexity requirements")
		return
	}

	// Hash the new password.
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(resetRequest.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing new password for user %s: %v\n", resetRequest.Username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to reset password")
		return
	}

	// Update user's password in the database.
	cmdTag, err := dbPool.Exec(context.Background(), "UPDATE users SET password = $1, updated_at = $2 WHERE username = $3", string(hashedPassword), time.Now(), resetRequest.Username)
	if err != nil || cmdTag.RowsAffected() == 0 {
		log.Printf("Password reset failed for user %s: %v (Rows affected: %d)\n", resetRequest.Username, err, cmdTag.RowsAffected())
		respondWithError(w, http.StatusInternalServerError, "Failed to reset password or user not found")
		return
	}

	logAudit("password_reset", resetRequest.Username, "User password reset successfully")
	log.Printf("Password for user %s reset successfully.\n", resetRequest.Username)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Password reset successfully"})
}

// changePasswordHandler allows a logged-in user to change their own password.
func changePasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		log.Printf("Method %s not allowed for /change-password\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	username := r.Context().Value("username").(string)

	var changeRequest struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}

	err := json.NewDecoder(r.Body).Decode(&changeRequest)
	if err != nil {
		log.Printf("Invalid request payload for change password (user: %s): %v\n", username, err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Input validation for password change.
	if changeRequest.OldPassword == "" || changeRequest.NewPassword == "" {
		log.Println("Validation failed: Old or new password empty for password change.")
		respondWithError(w, http.StatusBadRequest, "Old and new passwords cannot be empty")
		return
	}

	var storedPasswordHash string
	// Retrieve current hashed password for comparison.
	err = dbPool.QueryRow(context.Background(), "SELECT password FROM users WHERE username = $1", username).Scan(&storedPasswordHash)
	if err != nil {
		log.Printf("Error retrieving password for user %s during change: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to change password")
		return
	}

	// Compare old password.
	err = bcrypt.CompareHashAndPassword([]byte(storedPasswordHash), []byte(changeRequest.OldPassword))
	if err != nil {
		log.Printf("Old password mismatch for user %s: %v\n", username, err)
		respondWithError(w, http.StatusUnauthorized, "Old password mismatch")
		logAudit("change_password_failed", username, "Old password mismatch")
		return
	}

	// Validate new password complexity.
	if !isValidPassword(changeRequest.NewPassword) {
		log.Println("Validation failed: New password does not meet complexity requirements for password change.")
		respondWithError(w, http.StatusBadRequest, "New password does not meet complexity requirements")
		return
	}

	// Hash and update the new password.
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(changeRequest.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing new password for user %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to change password")
		return
	}

	_, err = dbPool.Exec(context.Background(), "UPDATE users SET password = $1, updated_at = $2 WHERE username = $3", string(hashedPassword), time.Now(), username)
	if err != nil {
		log.Printf("Error updating password for user %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to change password")
		return
	}

	logAudit("change_password_success", username, "User changed password successfully")
	log.Printf("Password for user %s changed successfully.\n", username)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Password changed successfully"})
}

// rolesHandler dispatches requests for /roles based on HTTP method (GET all, POST create).
func rolesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getRoles(w, r)
	case "POST":
		createRole(w, r)
	default:
		log.Printf("Method %s not allowed for /roles\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// getRoles retrieves all available roles. (Currently hardcoded for simplicity).
func getRoles(w http.ResponseWriter, r *http.Request) {
	log.Println("Retrieving available roles.")
	// For simplicity, roles are hardcoded. In a real application, these might be dynamically loaded from a database or configuration.
	roles := []string{"admin", "user", "auditor"}
	respondWithJSON(w, http.StatusOK, roles)
}

// createRole handles the creation of a new role. (Currently a placeholder).
func createRole(w http.ResponseWriter, r *http.Request) {
	log.Println("Attempting to create new role.")
	var roleRequest struct {
		RoleName string `json:"role_name"`
	}
	err := json.NewDecoder(r.Body).Decode(&roleRequest)
	if err != nil {
		log.Printf("Invalid request payload for role creation: %v\n", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Input validation for role name.
	if roleRequest.RoleName == "" {
		log.Println("Validation failed: Role name is empty.")
		respondWithError(w, http.StatusBadRequest, "Role name cannot be empty")
		return
	}

	// In a real application, this would involve saving the new role to the database.
	log.Printf("New role created (placeholder): %s\n", roleRequest.RoleName)
	username := "system" // Assuming system action if no user context
	if u, ok := r.Context().Value("username").(string); ok {
		username = u
	}
	logAudit("role_created", username, fmt.Sprintf("Role %s created (placeholder)", roleRequest.RoleName))
	respondWithJSON(w, http.StatusCreated, map[string]string{"message": fmt.Sprintf("Role %s created successfully", roleRequest.RoleName)})
}

// assignRoleHandler handles assigning a specific role to a user.
func assignRoleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		log.Printf("Method %s not allowed for /roles/assign\n", r.Method)
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var assignRequest struct {
		UserID int `json:"user_id"`
		Role   string `json:"role"`
	}
	err := json.NewDecoder(r.Body).Decode(&assignRequest)
	if err != nil {
		log.Printf("Invalid request payload for role assignment: %v\n", err)
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err.Error())
		return
	}

	// Input validation for role assignment.
	if assignRequest.UserID == 0 || assignRequest.Role == "" {
		log.Println("Validation failed: User ID or role empty for role assignment.")
		respondWithError(w, http.StatusBadRequest, "User ID and role cannot be empty")
		return
	}

	// Update the user's role in the database.
	_, err = dbPool.Exec(context.Background(), "UPDATE users SET role = $1, updated_at = $2 WHERE id = $3", assignRequest.Role, time.Now(), assignRequest.UserID)
	if err != nil {
		log.Printf("Error assigning role %s to user ID %d: %v\n", assignRequest.Role, assignRequest.UserID, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to assign role")
		return
	}

	username := "system" // Assuming system action if no user context
	if u, ok := r.Context().Value("username").(string); ok {
		username = u
	}
	logAudit("role_assigned", username, fmt.Sprintf("Role %s assigned to user ID %d", assignRequest.Role, assignRequest.UserID))
	log.Printf("Role %s assigned to user ID %d successfully.\n", assignRequest.Role, assignRequest.UserID)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Role assigned successfully"})
}

// getAuditLogsHandler retrieves all audit logs from the database.
func getAuditLogsHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Retrieving audit logs.")
	rows, err := dbPool.Query(context.Background(), "SELECT id, event_type, username, timestamp, details FROM audit_logs ORDER BY timestamp DESC")
	if err != nil {
		log.Printf("Error querying audit logs from database: %v\n", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve audit logs")
		return
	}
	defer rows.Close()

	auditLogs := []AuditLog{}
	for rows.Next() {
		var al AuditLog
		if err := rows.Scan(&al.ID, &al.EventType, &al.Username, &al.Timestamp, &al.Details); err != nil {
			log.Printf("Error scanning audit log row: %v\n", err)
			continue // Skip malformed rows.
		}
		auditLogs = append(auditLogs, al)
	}
	log.Printf("Successfully retrieved %d audit logs.\n", len(auditLogs))
	respondWithJSON(w, http.StatusOK, auditLogs)
}

func mfaSetupHandler(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value("username").(string)
	log.Printf("MFA setup for user: %s\n", username)

	mfaSecret := make([]byte, 20)
	rand.Read(mfaSecret)
	encodedSecret := base64.StdEncoding.EncodeToString(mfaSecret)

	ctx := context.Background()
	_, err := dbPool.Exec(ctx, "UPDATE users SET mfa_secret = $1, mfa_enabled = false WHERE username = $2", encodedSecret, username)
	if err != nil {
		log.Printf("Error storing MFA secret for %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to setup MFA")
		return
	}

	otpauthURL := fmt.Sprintf("otpauth://totp/AgentBanking:%s?secret=%s&issuer=AgentBanking", username, encodedSecret)
	logAudit("mfa_setup", username, "MFA setup initiated")
	respondWithJSON(w, http.StatusOK, map[string]string{
		"message":    "MFA setup initiated",
		"user":       username,
		"secret":     encodedSecret,
		"otpauth_url": otpauthURL,
	})
}

func mfaVerifyHandler(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value("username").(string)
	log.Printf("MFA verification for user: %s\n", username)

	var verifyRequest struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&verifyRequest); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if verifyRequest.Code == "" {
		respondWithError(w, http.StatusBadRequest, "MFA code is required")
		return
	}

	var mfaSecret string
	ctx := context.Background()
	err := dbPool.QueryRow(ctx, "SELECT mfa_secret FROM users WHERE username = $1", username).Scan(&mfaSecret)
	if err != nil {
		log.Printf("Error retrieving MFA secret for %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to verify MFA")
		return
	}

	if mfaSecret == "" {
		respondWithError(w, http.StatusBadRequest, "MFA not set up for this user")
		return
	}

	_, err = dbPool.Exec(ctx, "UPDATE users SET mfa_enabled = true WHERE username = $1", username)
	if err != nil {
		log.Printf("Error enabling MFA for %s: %v\n", username, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to enable MFA")
		return
	}

	logAudit("mfa_verified", username, "MFA verification completed")
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "MFA verified and enabled", "user": username})
}

// authorizeMiddleware is an HTTP middleware that validates JWT tokens and checks user roles.
func authorizeMiddleware(next http.HandlerFunc, requiredRole string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokenString := r.Header.Get("Authorization")
		if tokenString == "" {
			log.Println("Authorization failed: Missing authorization header.")
			respondWithError(w, http.StatusUnauthorized, "Missing authorization header")
			return
		}

		tokenString = strings.TrimPrefix(tokenString, "Bearer ")

		claims := &Claims{}

		// Parse and validate the JWT token.
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(appConfig.Security.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			log.Printf("Authorization failed: Invalid or expired token: %v\n", err)
			respondWithError(w, http.StatusUnauthorized, "Invalid or expired token")
			logAudit("token_validation_failed", "unknown", fmt.Sprintf("Token validation failed: %v", err))
			return
		}

		// Check if the token is blacklisted (revoked).
		isBlacklisted, err := isTokenBlacklisted(tokenString)
		if err != nil {
			log.Printf("Error checking token blacklist for %s: %v\n", claims.Username, err)
			respondWithError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		if isBlacklisted {
			log.Printf("Authorization failed: Attempt to use a blacklisted token by user %s.\n", claims.Username)
			respondWithError(w, http.StatusUnauthorized, "Token has been revoked")
			logAudit("token_revoked_access_attempt", claims.Username, "Attempt to use a revoked token")
			return
		}

		// Check if the user's role meets the required role for the endpoint.
		if requiredRole != "" && claims.Role != requiredRole {
			log.Printf("Authorization failed for user %s: Insufficient permissions (required: %s, actual: %s) for path %s\n", claims.Username, requiredRole, claims.Role, r.URL.Path)
			respondWithError(w, http.StatusForbidden, "Insufficient permissions")
			logAudit("authorization_failed", claims.Username, fmt.Sprintf("User %s attempted to access %s with insufficient role %s", claims.Username, r.URL.Path, claims.Role))
			return
		}

		// Add user information (username, role, token) to the request context for downstream handlers.
		ctx := context.WithValue(r.Context(), "username", claims.Username)
		ctx = context.WithValue(ctx, "role", claims.Role)
		ctx = context.WithValue(ctx, "token", tokenString)
		r = r.WithContext(ctx)

		next.ServeHTTP(w, r)
	}
}

// adminUsersHandler is an example protected route accessible only by 'admin' role.
func adminUsersHandler(w http.ResponseWriter, r *http.Request) {
	// Retrieve username and role from the request context.
	username := r.Context().Value("username").(string)
	role := r.Context().Value("role").(string)

	logAudit("access_admin_users", username, fmt.Sprintf("Admin user %s accessed admin users data", username))
	log.Printf("Admin user %s (role: %s) accessed admin users data.\n", username, role)
	respondWithJSON(w, http.StatusOK, map[string]string{"message": fmt.Sprintf("Welcome, %s! You have access to admin users data as %s.", username, role)})
}

// isValidPassword checks if a given password meets the configured complexity requirements.
func isValidPassword(password string) bool {
	// Check minimum length.
	if len(password) < appConfig.Security.PasswordMinLength {
		log.Printf("Password too short: %d, min: %d\n", len(password), appConfig.Security.PasswordMinLength)
		return false
	}

	// Check for uppercase characters if required.
	if appConfig.Security.PasswordRequireUppercase && !regexp.MustCompile(`[A-Z]`).MatchString(password) {
		log.Println("Password missing uppercase character.")
		return false
	}
	// Check for lowercase characters if required.
	if appConfig.Security.PasswordRequireLowercase && !regexp.MustCompile(`[a-z]`).MatchString(password) {
		log.Println("Password missing lowercase character.")
		return false
	}
	// Check for digits if required.
	if appConfig.Security.PasswordRequireDigit && !regexp.MustCompile(`[0-9]`).MatchString(password) {
		log.Println("Password missing digit.")
		return false
	}
	// Check for special characters if required.
	if appConfig.Security.PasswordRequireSpecialChar && !regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};":\'\\|,.<>/?]`).MatchString(password) {
		log.Println("Password missing special character.")
		return false
	}

	return true // Password meets all requirements.
}

// logAudit records an audit event in the application logs and stores it in the database.
func logAudit(eventType, username, details string) {
	formattedTime := time.Now().Format(time.RFC3339)
	log.Printf("AUDIT: event=%s, user=%s, timestamp=%s, details=%s\n", eventType, username, formattedTime, details)
	auditLogCounter.WithLabelValues(eventType, username).Inc() // Increment audit log Prometheus counter.

	// Store audit log in the database.
	_, err := dbPool.Exec(context.Background(), "INSERT INTO audit_logs(event_type, username, timestamp, details) VALUES($1, $2, $3, $4)", eventType, username, time.Now(), details)
	if err != nil {
		log.Printf("Error storing audit log in database: %v\n", err)
	}
}

// isTokenBlacklisted checks if a given JWT token is present in the Redis blacklist.
// Returns true if blacklisted, false otherwise, and an error if Redis operation fails.
func isTokenBlacklisted(token string) (bool, error) {
	ctx := context.Background()
	val, err := redisClient.Get(ctx, "blacklist:" + token).Result()
	if err == redis.Nil {
		return false, nil // Token not found in blacklist, so it's not blacklisted.
	} else if err != nil {
		log.Printf("Redis error checking blacklist for token: %v\n", err)
		return false, err // An actual error occurred with Redis.
	}
	return val == "true", nil // Token is blacklisted if its value is "true".
}


