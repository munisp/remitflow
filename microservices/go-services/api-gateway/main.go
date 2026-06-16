// RemitFlow API Gateway — Go microservice
// Reverse proxy for all microservices with rate limiting, auth forwarding, and request logging
// Routes: /ngx/* → ngx-price-feed:8081, /fx/* → fx-engine:8084, /fraud/* → fraud-detection:8087
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Config ──────────────────────────────────────────────────────────────────

type ServiceConfig struct {
	Name    string
	Target  string
	Prefix  string
}

type Config struct {
	Port           string
	JWTSecret      string
	RateLimitRPM   int
	Services       []ServiceConfig
}

func loadConfig() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	return Config{
		Port:         port,
		JWTSecret:    getEnvOrDefault("JWT_SECRET", "remitflow-jwt-secret-change-in-production"),
		RateLimitRPM: 300,
		Services: []ServiceConfig{
			{Name: "ngx-price-feed", Target: getEnvOrDefault("NGX_SERVICE_URL", "http://ngx-price-feed:8081"), Prefix: "/ngx"},
			{Name: "corridor-pricing", Target: getEnvOrDefault("CORRIDOR_SERVICE_URL", "http://corridor-pricing:8083"), Prefix: "/corridor"},
			{Name: "fx-engine", Target: getEnvOrDefault("FX_SERVICE_URL", "http://fx-engine:8084"), Prefix: "/fx"},
			{Name: "tx-processor", Target: getEnvOrDefault("TX_SERVICE_URL", "http://tx-processor:8085"), Prefix: "/tx"},
			{Name: "compliance-engine", Target: getEnvOrDefault("COMPLIANCE_SERVICE_URL", "http://compliance-engine:8086"), Prefix: "/compliance"},
			{Name: "fraud-detection", Target: getEnvOrDefault("FRAUD_SERVICE_URL", "http://fraud-detection:8087"), Prefix: "/fraud"},
			{Name: "aml-compliance", Target: getEnvOrDefault("AML_SERVICE_URL", "http://aml-compliance:8088"), Prefix: "/aml"},
			{Name: "analytics-engine", Target: getEnvOrDefault("ANALYTICS_SERVICE_URL", "http://analytics-engine:8089"), Prefix: "/analytics"},
		},
	}
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

type RateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func NewRateLimiter(rpm int) *RateLimiter {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    rpm,
		window:   time.Minute,
	}
	// Cleanup goroutine
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	reqs := rl.requests[key]
	var valid []time.Time
	for _, t := range reqs {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.limit {
		rl.requests[key] = valid
		return false
	}

	rl.requests[key] = append(valid, now)
	return true
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-rl.window)
	for key, reqs := range rl.requests {
		var valid []time.Time
		for _, t := range reqs {
			if t.After(cutoff) {
				valid = append(valid, t)
			}
		}
		if len(valid) == 0 {
			delete(rl.requests, key)
		} else {
			rl.requests[key] = valid
		}
	}
}

// ─── Proxy Builder ────────────────────────────────────────────────────────────

func buildProxy(target string) (*httputil.ReverseProxy, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("PROXY ERROR [%s]: %v", target, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{
			"error":   "upstream_unavailable",
			"message": fmt.Sprintf("Service at %s is unavailable", target),
		})
	}
	return proxy, nil
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

type Gateway struct {
	cfg     Config
	limiter *RateLimiter
	proxies map[string]*httputil.ReverseProxy
	mux     *http.ServeMux
}

func NewGateway(cfg Config) (*Gateway, error) {
	g := &Gateway{
		cfg:     cfg,
		limiter: NewRateLimiter(cfg.RateLimitRPM),
		proxies: make(map[string]*httputil.ReverseProxy),
		mux:     http.NewServeMux(),
	}

	for _, svc := range cfg.Services {
		proxy, err := buildProxy(svc.Target)
		if err != nil {
			return nil, fmt.Errorf("build proxy for %s: %w", svc.Name, err)
		}
		g.proxies[svc.Prefix] = proxy
		log.Printf("INFO: Registered route %s → %s", svc.Prefix, svc.Target)
	}

	g.mux.HandleFunc("/health", g.handleHealth)
	g.mux.HandleFunc("/routes", g.handleRoutes)
	g.mux.Handle("/metrics", promhttp.Handler())
	g.mux.HandleFunc("/", g.handleProxy)

	return g, nil
}

func (g *Gateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"service":   "api-gateway",
		"version":   "1.0.0",
		"routes":    len(g.cfg.Services),
		"timestamp": time.Now().UnixMilli(),
	})
}

func (g *Gateway) handleRoutes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	routes := make([]map[string]string, 0, len(g.cfg.Services))
	for _, svc := range g.cfg.Services {
		routes = append(routes, map[string]string{
			"name":   svc.Name,
			"prefix": svc.Prefix,
			"target": svc.Target,
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"routes": routes,
	})
}

func (g *Gateway) handleProxy(w http.ResponseWriter, r *http.Request) {
	// Rate limiting by IP
	ip := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		ip = strings.Split(forwarded, ",")[0]
	}

	if !g.limiter.Allow(ip) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]string{
			"error":   "rate_limit_exceeded",
			"message": "Too many requests. Please retry after 60 seconds.",
		})
		return
	}

	// Find matching proxy
	path := r.URL.Path
	var matchedProxy *httputil.ReverseProxy
	var matchedPrefix string

	for prefix, proxy := range g.proxies {
		if strings.HasPrefix(path, prefix) {
			if len(prefix) > len(matchedPrefix) {
				matchedPrefix = prefix
				matchedProxy = proxy
			}
		}
	}

	if matchedProxy == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"error":   "route_not_found",
			"message": fmt.Sprintf("No route found for path: %s", path),
		})
		return
	}

	// Strip prefix and forward
	r.URL.Path = strings.TrimPrefix(path, matchedPrefix)
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	// Forward auth headers
	r.Header.Set("X-Gateway-Version", "1.0.0")
	r.Header.Set("X-Request-Time", fmt.Sprintf("%d", time.Now().UnixMilli()))

	start := time.Now()
	matchedProxy.ServeHTTP(w, r)
	log.Printf("PROXY %s %s%s → %s [%dms]", r.Method, matchedPrefix, r.URL.Path, matchedPrefix, time.Since(start).Milliseconds())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	log.Printf("INFO: Starting API Gateway on :%s", cfg.Port)

	gw, err := NewGateway(cfg)
	if err != nil {
		log.Fatalf("FATAL: init gateway: %v", err)
	}

	// CORS + logging middleware
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := os.Getenv("CORS_ALLOWED_ORIGIN")
		if origin == "" && os.Getenv("NODE_ENV") != "production" {
			origin = r.Header.Get("Origin")
			if origin == "" { origin = "*" }
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		gw.mux.ServeHTTP(w, r)
	})

	log.Printf("INFO: API Gateway ready — %d routes registered", len(cfg.Services))
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		log.Fatalf("FATAL: server: %v", err)
	}
}
