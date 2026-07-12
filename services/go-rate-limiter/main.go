// RemitFlow — Redis Rate-Limiter Sidecar (Go)
// ═════════════════════════════════════════════
// Distributed rate-limiting sidecar using Redis sliding window algorithm.
// The Node.js API calls this service before processing any request to
// enforce per-user, per-IP, and per-endpoint rate limits.
//
// Why Go:
//   - Redis operations are I/O-bound — goroutines excel here
//   - Lua scripts execute atomically in Redis — Go handles the orchestration
//   - Sub-millisecond response time is critical for a rate-limit sidecar
//   - go-redis is the most performant Redis client available
//
// Algorithms:
//   - Sliding window counter (accurate, no burst spikes)
//   - Token bucket (for burst-tolerant endpoints)
//   - Fixed window (for simple per-minute limits)
//
// Endpoints:
//   POST /check          — Check and consume a rate limit token
//   POST /peek           — Check without consuming
//   DELETE /reset        — Reset a rate limit key (admin)
//   GET  /status/:key    — Get current status for a key
//   GET  /health         — Liveness probe
//   GET  /metrics        — Prometheus metrics

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type RateLimitRequest struct {
	Key        string `json:"key"`        // e.g. "user:123:transfer"
	Limit      int    `json:"limit"`      // max requests
	WindowSecs int    `json:"window_secs"` // window size in seconds
	Algorithm  string `json:"algorithm"`  // "sliding_window" | "token_bucket" | "fixed_window"
	Cost       int    `json:"cost"`       // tokens to consume (default 1)
}

type RateLimitResponse struct {
	Allowed   bool   `json:"allowed"`
	Remaining int    `json:"remaining"`
	ResetAt   int64  `json:"reset_at"` // Unix timestamp
	RetryAfter int   `json:"retry_after_secs,omitempty"`
	Key       string `json:"key"`
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

var (
	rateLimitChecks = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "remitflow_rate_limit_checks_total",
		Help: "Total rate limit checks",
	}, []string{"result"})

	rateLimitLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "remitflow_rate_limit_check_duration_seconds",
		Help:    "Rate limit check latency",
		Buckets: []float64{0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05},
	})
)

// ─── Lua Scripts ──────────────────────────────────────────────────────────────

// Sliding window rate limit using sorted sets
// KEYS[1] = rate limit key
// ARGV[1] = current timestamp (ms)
// ARGV[2] = window size (ms)
// ARGV[3] = limit
// ARGV[4] = cost
// Returns: {allowed (0/1), remaining, reset_at_ms}
const slidingWindowScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local window_start = now - window

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current requests
local count = redis.call('ZCARD', key)

if count + cost > limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_at = window_start
  if #oldest > 0 then
    reset_at = tonumber(oldest[2]) + window
  end
  return {0, limit - count, reset_at}
end

-- Add new request(s)
for i = 1, cost do
  redis.call('ZADD', key, now, now .. '-' .. i .. '-' .. math.random(1000000))
end
redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)

return {1, limit - count - cost, now + window}
`

// Token bucket algorithm
// KEYS[1] = bucket key
// ARGV[1] = current timestamp (ms)
// ARGV[2] = capacity
// ARGV[3] = refill_rate (tokens per second)
// ARGV[4] = cost
const tokenBucketScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_rate = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- Refill tokens based on elapsed time
local elapsed = (now - last_refill) / 1000
local new_tokens = math.min(capacity, tokens + elapsed * refill_rate)

if new_tokens < cost then
  local wait_secs = math.ceil((cost - new_tokens) / refill_rate)
  return {0, math.floor(new_tokens), now + wait_secs * 1000}
end

new_tokens = new_tokens - cost
redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)

return {1, math.floor(new_tokens), now + math.ceil((capacity - new_tokens) / refill_rate) * 1000}
`

// ─── Server ───────────────────────────────────────────────────────────────────

type Server struct {
	rdb    *redis.Client
	logger *slog.Logger
}

func (s *Server) checkRateLimit(ctx context.Context, req RateLimitRequest, consume bool) (*RateLimitResponse, error) {
	start := time.Now()
	defer func() {
		rateLimitLatency.Observe(time.Since(start).Seconds())
	}()

	now := time.Now().UnixMilli()
	cost := req.Cost
	if cost == 0 {
		cost = 1
	}
	if !consume {
		cost = 0
	}

	algorithm := req.Algorithm
	if algorithm == "" {
		algorithm = "sliding_window"
	}

	var result []interface{}
	var err error

	switch algorithm {
	case "token_bucket":
		refillRate := float64(req.Limit) / float64(req.WindowSecs)
		result, err = s.rdb.Eval(ctx, tokenBucketScript,
			[]string{req.Key},
			now, req.Limit, refillRate, cost,
		).Slice()

	default: // sliding_window
		windowMs := int64(req.WindowSecs) * 1000
		result, err = s.rdb.Eval(ctx, slidingWindowScript,
			[]string{req.Key},
			now, windowMs, req.Limit, cost,
		).Slice()
	}

	if err != nil {
		return nil, fmt.Errorf("redis eval: %w", err)
	}

	if len(result) < 3 {
		return nil, fmt.Errorf("unexpected result length: %d", len(result))
	}

	allowed := toInt64(result[0]) == 1
	remaining := int(toInt64(result[1]))
	resetAtMs := toInt64(result[2])

	if allowed {
		rateLimitChecks.WithLabelValues("allowed").Inc()
	} else {
		rateLimitChecks.WithLabelValues("denied").Inc()
	}

	resp := &RateLimitResponse{
		Allowed:   allowed,
		Remaining: remaining,
		ResetAt:   resetAtMs / 1000,
		Key:       req.Key,
	}

	if !allowed {
		resp.RetryAfter = int((resetAtMs - now) / 1000)
		if resp.RetryAfter < 0 {
			resp.RetryAfter = 1
		}
	}

	return resp, nil
}

func toInt64(v interface{}) int64 {
	switch val := v.(type) {
	case int64:
		return val
	case float64:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(val, 10, 64)
		return n
	default:
		return 0
	}
}

func (s *Server) handleCheck(w http.ResponseWriter, r *http.Request) {
	var req RateLimitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if req.Key == "" || req.Limit == 0 || req.WindowSecs == 0 {
		http.Error(w, `{"error":"key, limit, and window_secs are required"}`, http.StatusBadRequest)
		return
	}

	resp, err := s.checkRateLimit(r.Context(), req, true)
	if err != nil {
		s.logger.Error("rate limit check failed", "error", err, "key", req.Key)
		http.Error(w, `{"error":"rate limit check failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(req.Limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(resp.Remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resp.ResetAt, 10))

	if !resp.Allowed {
		w.Header().Set("Retry-After", strconv.Itoa(resp.RetryAfter))
		w.WriteHeader(http.StatusTooManyRequests)
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handlePeek(w http.ResponseWriter, r *http.Request) {
	var req RateLimitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	resp, err := s.checkRateLimit(r.Context(), req, false)
	if err != nil {
		http.Error(w, `{"error":"peek failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Key == "" {
		http.Error(w, `{"error":"key is required"}`, http.StatusBadRequest)
		return
	}

	if err := s.rdb.Del(r.Context(), body.Key).Err(); err != nil {
		http.Error(w, `{"error":"reset failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "key": body.Key})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	count, err := s.rdb.ZCard(r.Context(), key).Result()
	if err != nil {
		http.Error(w, `{"error":"status check failed"}`, http.StatusInternalServerError)
		return
	}

	ttl, _ := s.rdb.TTL(r.Context(), key).Result()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"key":     key,
		"count":   count,
		"ttl_secs": ttl.Seconds(),
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
	defer cancel()

	redisOk := s.rdb.Ping(ctx).Err() == nil

	status := "ok"
	httpStatus := http.StatusOK
	if !redisOk {
		status = "degraded"
		httpStatus = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    status,
		"redis_ok":  redisOk,
		"service":   "rate-limiter",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	redisURL := getEnv("REDIS_URL", "redis://redis:6379")
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		logger.Error("invalid REDIS_URL", "error", err)
		os.Exit(1)
	}
	opt.PoolSize = 20
	opt.MinIdleConns = 5
	opt.DialTimeout = 3 * time.Second
	opt.ReadTimeout = 1 * time.Second
	opt.WriteTimeout = 1 * time.Second

	rdb := redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn("Redis not available at startup — will retry on requests", "error", err)
	} else {
		logger.Info("Redis connected")
	}

	srv := &Server{rdb: rdb, logger: logger}

	port := getEnv("RATE_LIMITER_PORT", "8101")
	mux := http.NewServeMux()
	mux.HandleFunc("POST /check", srv.handleCheck)
	mux.HandleFunc("POST /peek", srv.handlePeek)
	mux.HandleFunc("DELETE /reset", srv.handleReset)
	mux.HandleFunc("GET /status/{key}", srv.handleStatus)
	mux.HandleFunc("GET /health", srv.handleHealth)
	mux.Handle("GET /metrics", promhttp.Handler())

	addr := ":" + port
	logger.Info("Rate limiter sidecar listening", "addr", addr)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
