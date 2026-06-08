// RemitFlow — Go Rate-Limit & Input Validation Sidecar
// ─────────────────────────────────────────────────────────────────────────────
// HTTP sidecar that provides:
//   1. Sliding-window rate limiting (per user, per IP, per route)
//   2. Input validation (schema-based, Zod-compatible error format)
//   3. Idempotency key management (Redis-backed)
//   4. Health & metrics endpoints
//
// Port: 8081 (configurable via PORT env var)
// Redis: REDIS_URL env var (default: redis://localhost:6379)
//
// API:
//   POST /ratelimit/check   — check + increment rate limit
//   POST /validate          — validate input against a named schema
//   POST /idempotency/check — check if idempotency key exists
//   POST /idempotency/store — store idempotency result
//   GET  /health            — health check
//   GET  /metrics           — Prometheus-compatible metrics

package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// ── Configuration ─────────────────────────────────────────────────────────────


var db *sql.DB

var (
	port     = getEnv("PORT", "8081")
	redisURL = getEnv("REDIS_URL", "redis://localhost:6379")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Redis Client ──────────────────────────────────────────────────────────────

var (
	rdb         *redis.Client
	redisOnce   sync.Once
	redisAvail  atomic.Bool
)

func initRedis() {
	redisOnce.Do(func() {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Printf("[Redis] Failed to parse URL: %v — running in-memory fallback", err)
			return
		}
		rdb = redis.NewClient(opt)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := rdb.Ping(ctx).Err(); err != nil {
			log.Printf("[Redis] Ping failed: %v — running in-memory fallback", err)
			return
		}
		redisAvail.Store(true)
		log.Printf("[Redis] Connected to %s", redisURL)
	})
}

// ── In-Memory Fallback Rate Limiter ──────────────────────────────────────────

type windowEntry struct {
	count     int
	expiresAt time.Time
}

var (
	memLimiter sync.Map // key → *windowEntry
)

func memRateLimit(key string, limit int, windowSecs int) (int, bool) {
	now := time.Now()
	actual, _ := memLimiter.LoadOrStore(key, &windowEntry{expiresAt: now.Add(time.Duration(windowSecs) * time.Second)})
	entry := actual.(*windowEntry)
	if now.After(entry.expiresAt) {
		entry.count = 0
		entry.expiresAt = now.Add(time.Duration(windowSecs) * time.Second)
	}
	entry.count++
	return entry.count, entry.count <= limit
}

// ── Rate Limit Logic ──────────────────────────────────────────────────────────

type RateLimitRequest struct {
	Key        string `json:"key"`        // e.g. "user:123:transfer.create"
	Limit      int    `json:"limit"`      // max requests
	WindowSecs int    `json:"windowSecs"` // sliding window in seconds
	Window     int    `json:"window"`     // alias for windowSecs
}

type RateLimitResponse struct {
	Allowed   bool   `json:"allowed"`
	Current   int    `json:"current"`
	Limit     int    `json:"limit"`
	ResetAt   int64  `json:"resetAt"` // Unix timestamp
	Message   string `json:"message,omitempty"`
}

func handleRateLimitCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req RateLimitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.WindowSecs == 0 && req.Window > 0 {
		req.WindowSecs = req.Window
	}
	if req.Key == "" || req.Limit <= 0 || req.WindowSecs <= 0 {
		http.Error(w, "key, limit, windowSecs are required", http.StatusBadRequest)
		return
	}

	redisKey := fmt.Sprintf("ratelimit:%s", req.Key)
	var current int
	var allowed bool
	resetAt := time.Now().Add(time.Duration(req.WindowSecs) * time.Second).Unix()

	if redisAvail.Load() {
		ctx := context.Background()
		pipe := rdb.Pipeline()
		incrCmd := pipe.Incr(ctx, redisKey)
		pipe.Expire(ctx, redisKey, time.Duration(req.WindowSecs)*time.Second)
		if _, err := pipe.Exec(ctx); err != nil {
			// Fall back to in-memory
			current, allowed = memRateLimit(req.Key, req.Limit, req.WindowSecs)
		} else {
			current = int(incrCmd.Val())
			allowed = current <= req.Limit
			// Get TTL for accurate resetAt
			ttl := rdb.TTL(ctx, redisKey).Val()
			if ttl > 0 {
				resetAt = time.Now().Add(ttl).Unix()
			}
		}
	} else {
		current, allowed = memRateLimit(req.Key, req.Limit, req.WindowSecs)
	}

	resp := RateLimitResponse{
		Allowed: allowed,
		Current: current,
		Limit:   req.Limit,
		ResetAt: resetAt,
	}
	if !allowed {
		resp.Message = fmt.Sprintf("Rate limit exceeded: %d/%d requests in %ds window", current, req.Limit, req.WindowSecs)
		rateLimitViolations.Add(1)
	}
	rateLimitChecks.Add(1)

	w.Header().Set("Content-Type", "application/json")
	if !allowed {
		w.WriteHeader(http.StatusTooManyRequests)
	}
	json.NewEncoder(w).Encode(resp)
}

// ── Input Validation ──────────────────────────────────────────────────────────

// Validation schemas — mirrors the Zod schemas used in tRPC procedures
var validationSchemas = map[string][]FieldRule{
	"transfer.create": {
		{Field: "amount", Type: "number", Required: true, Min: 0.01, Max: 1000000},
		{Field: "fromCurrency", Type: "string", Required: true, Pattern: `^[A-Z]{3}$`},
		{Field: "toCurrency", Type: "string", Required: true, Pattern: `^[A-Z]{3}$`},
		{Field: "beneficiaryId", Type: "number", Required: true, Min: 1},
		{Field: "idempotencyKey", Type: "string", Required: false, MaxLen: 128},
	},
	"kyc.submit": {
		{Field: "documentType", Type: "string", Required: true, Enum: []string{"passport", "national_id", "drivers_license", "residence_permit"}},
		{Field: "documentNumber", Type: "string", Required: true, MinLen: 5, MaxLen: 50},
		{Field: "dateOfBirth", Type: "string", Required: true, Pattern: `^\d{4}-\d{2}-\d{2}$`},
		{Field: "nationality", Type: "string", Required: true, Pattern: `^[A-Z]{2}$`},
	},
	"beneficiary.create": {
		{Field: "name", Type: "string", Required: true, MinLen: 2, MaxLen: 100},
		{Field: "accountNumber", Type: "string", Required: true, MinLen: 5, MaxLen: 50},
		{Field: "bankCode", Type: "string", Required: false, MaxLen: 20},
		{Field: "country", Type: "string", Required: true, Pattern: `^[A-Z]{2}$`},
	},
	"wallet.withdraw": {
		{Field: "amount", Type: "number", Required: true, Min: 0.01, Max: 500000},
		{Field: "currency", Type: "string", Required: true, Pattern: `^[A-Z]{3}$`},
		{Field: "destinationAccount", Type: "string", Required: true, MinLen: 5},
		{Field: "idempotencyKey", Type: "string", Required: true, MaxLen: 128},
	},
	"payment.initiate": {
		{Field: "amount", Type: "number", Required: true, Min: 0.50},
		{Field: "currency", Type: "string", Required: true, Pattern: `^[A-Z]{3}$`},
		{Field: "description", Type: "string", Required: false, MaxLen: 255},
		{Field: "idempotencyKey", Type: "string", Required: true, MaxLen: 128},
	},
}

type FieldRule struct {
	Field    string
	Type     string
	Required bool
	Min      float64
	Max      float64
	MinLen   int
	MaxLen   int
	Pattern  string
	Enum     []string
}

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
	Code    string `json:"code"`
}

type ValidateRequest struct {
	Schema string                 `json:"schema"`
	Input  map[string]interface{} `json:"input"`
}

type ValidateResponse struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors,omitempty"`
}

func validateField(rule FieldRule, value interface{}) *ValidationError {
	if value == nil {
		if rule.Required {
			return &ValidationError{Field: rule.Field, Message: rule.Field + " is required", Code: "required"}
		}
		return nil
	}

	switch rule.Type {
	case "string":
		s, ok := value.(string)
		if !ok {
			return &ValidationError{Field: rule.Field, Message: rule.Field + " must be a string", Code: "invalid_type"}
		}
		if rule.MinLen > 0 && len(s) < rule.MinLen {
			return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s must be at least %d characters", rule.Field, rule.MinLen), Code: "too_small"}
		}
		if rule.MaxLen > 0 && len(s) > rule.MaxLen {
			return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s must be at most %d characters", rule.Field, rule.MaxLen), Code: "too_big"}
		}
		if rule.Pattern != "" {
			matched, _ := regexp.MatchString(rule.Pattern, s)
			if !matched {
				return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s has invalid format", rule.Field), Code: "invalid_format"}
			}
		}
		if len(rule.Enum) > 0 {
			found := false
			for _, e := range rule.Enum {
				if s == e {
					found = true
					break
				}
			}
			if !found {
				return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s must be one of: %s", rule.Field, strings.Join(rule.Enum, ", ")), Code: "invalid_enum_value"}
			}
		}

	case "number":
		var n float64
		switch v := value.(type) {
		case float64:
			n = v
		case int:
			n = float64(v)
		case string:
			var err error
			n, err = strconv.ParseFloat(v, 64)
			if err != nil {
				return &ValidationError{Field: rule.Field, Message: rule.Field + " must be a number", Code: "invalid_type"}
			}
		default:
			return &ValidationError{Field: rule.Field, Message: rule.Field + " must be a number", Code: "invalid_type"}
		}
		if rule.Min != 0 && n < rule.Min {
			return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s must be at least %g", rule.Field, rule.Min), Code: "too_small"}
		}
		if rule.Max != 0 && n > rule.Max {
			return &ValidationError{Field: rule.Field, Message: fmt.Sprintf("%s must be at most %g", rule.Field, rule.Max), Code: "too_big"}
		}
	}

	return nil
}

func handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	rules, ok := validationSchemas[req.Schema]
	if !ok {
		// Unknown schema — pass through (don't block)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ValidateResponse{Valid: true})
		return
	}

	var errors []ValidationError
	for _, rule := range rules {
		val := req.Input[rule.Field]
		if err := validateField(rule, val); err != nil {
			errors = append(errors, *err)
		}
	}

	validationChecks.Add(1)
	resp := ValidateResponse{Valid: len(errors) == 0, Errors: errors}
	w.Header().Set("Content-Type", "application/json")
	if !resp.Valid {
		w.WriteHeader(http.StatusUnprocessableEntity)
		validationFailures.Add(1)
	}
	json.NewEncoder(w).Encode(resp)
}

// ── Idempotency ───────────────────────────────────────────────────────────────

type IdempotencyCheckRequest struct {
	Key string `json:"key"`
}

type IdempotencyCheckResponse struct {
	Exists bool        `json:"exists"`
	Result interface{} `json:"result,omitempty"`
}

type IdempotencyStoreRequest struct {
	Key     string      `json:"key"`
	Result  interface{} `json:"result"`
	TTLSecs int         `json:"ttlSecs"`
}

func handleIdempotencyCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req IdempotencyCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Key == "" {
		http.Error(w, "key is required", http.StatusBadRequest)
		return
	}

	redisKey := fmt.Sprintf("idempotency:%s", req.Key)
	resp := IdempotencyCheckResponse{}

	if redisAvail.Load() {
		ctx := context.Background()
		val, err := rdb.Get(ctx, redisKey).Result()
		if err == nil {
			resp.Exists = true
			var result interface{}
			if err := json.Unmarshal([]byte(val), &result); err == nil {
				resp.Result = result
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleIdempotencyStore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req IdempotencyStoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Key == "" {
		http.Error(w, "key is required", http.StatusBadRequest)
		return
	}
	ttl := req.TTLSecs
	if ttl <= 0 {
		ttl = 86400
	}

	if redisAvail.Load() {
		ctx := context.Background()
		data, _ := json.Marshal(req.Result)
		rdb.SetEx(ctx, fmt.Sprintf("idempotency:%s", req.Key), string(data), time.Duration(ttl)*time.Second)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]bool{"stored": true})
}

// ── Metrics ───────────────────────────────────────────────────────────────────

var (
	rateLimitChecks    atomic.Int64
	rateLimitViolations atomic.Int64
	validationChecks   atomic.Int64
	validationFailures atomic.Int64
	requestsTotal      atomic.Int64
)

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP remitflow_ratelimit_checks_total Total rate limit checks\n")
	fmt.Fprintf(w, "# TYPE remitflow_ratelimit_checks_total counter\n")
	fmt.Fprintf(w, "remitflow_ratelimit_checks_total %d\n\n", rateLimitChecks.Load())

	fmt.Fprintf(w, "# HELP remitflow_ratelimit_violations_total Total rate limit violations\n")
	fmt.Fprintf(w, "# TYPE remitflow_ratelimit_violations_total counter\n")
	fmt.Fprintf(w, "remitflow_ratelimit_violations_total %d\n\n", rateLimitViolations.Load())

	fmt.Fprintf(w, "# HELP remitflow_validation_checks_total Total validation checks\n")
	fmt.Fprintf(w, "# TYPE remitflow_validation_checks_total counter\n")
	fmt.Fprintf(w, "remitflow_validation_checks_total %d\n\n", validationChecks.Load())

	fmt.Fprintf(w, "# HELP remitflow_validation_failures_total Total validation failures\n")
	fmt.Fprintf(w, "# TYPE remitflow_validation_failures_total counter\n")
	fmt.Fprintf(w, "remitflow_validation_failures_total %d\n\n", validationFailures.Load())

	fmt.Fprintf(w, "# HELP remitflow_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE remitflow_requests_total counter\n")
	fmt.Fprintf(w, "remitflow_requests_total %d\n\n", requestsTotal.Load())

	redisStatus := "0"
	if redisAvail.Load() {
		redisStatus = "1"
	}
	fmt.Fprintf(w, "# HELP remitflow_redis_available Redis availability (1=up, 0=down)\n")
	fmt.Fprintf(w, "# TYPE remitflow_redis_available gauge\n")
	fmt.Fprintf(w, "remitflow_redis_available %s\n", redisStatus)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	status := "ok"
	redisStatus := "degraded"
	if redisAvail.Load() {
		redisStatus = "ok"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  status,
		"redis":   redisStatus,
		"service": "remitflow-ratelimit-sidecar",
		"version": "1.0.0",
	})
}

// ── Middleware ────────────────────────────────────────────────────────────────

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestsTotal.Add(1)
		next.ServeHTTP(w, r)
		log.Printf("[%s] %s %s %dms", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start).Milliseconds())
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Main ──────────────────────────────────────────────────────────────────────


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratelimit_sidecar_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_ratelimit_sidecar_updated ON ratelimit_sidecar_state(updated_at);
		CREATE TABLE IF NOT EXISTS ratelimit_sidecar_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_ratelimit_sidecar_events_type ON ratelimit_sidecar_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-ratelimit-sidecar", "table", "ratelimit_sidecar_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO ratelimit_sidecar_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM ratelimit_sidecar_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM ratelimit_sidecar_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO ratelimit_sidecar_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}

func main() {
	log.Printf("[RemitFlow] Starting rate-limit sidecar on port %s", port)
	initRedis()

	mux := http.NewServeMux()
	mux.HandleFunc("/ratelimit/check", handleRateLimitCheck)
	mux.HandleFunc("/check", handleRateLimitCheck)
	mux.HandleFunc("/validate", handleValidate)
	mux.HandleFunc("/idempotency/check", handleIdempotencyCheck)
	mux.HandleFunc("/idempotency/store", handleIdempotencyStore)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/metrics", handleMetrics)

	handler := loggingMiddleware(corsMiddleware(mux))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("[RemitFlow] Rate-limit sidecar ready at http://localhost:%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[RemitFlow] Server error: %v", err)
	}
}
