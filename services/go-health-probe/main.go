// RemitFlow — Platform Health Probe Server (Go)
// ═══════════════════════════════════════════════
// Lightweight health check aggregator that polls all 12 infrastructure
// components and exposes a unified health endpoint for Kubernetes
// liveness/readiness probes and Prometheus alerting.
//
// Why Go:
//   - Goroutine-per-service concurrent health checks in <100ms
//   - Minimal memory footprint for a sidecar probe
//   - net/http stdlib is sufficient — no framework needed
//   - Compiles to a tiny static binary for distroless containers
//
// Endpoints:
//   GET /healthz          — Kubernetes liveness probe (200/503)
//   GET /readyz           — Kubernetes readiness probe (200/503)
//   GET /health/full      — Detailed health of all 12 services
//   GET /health/:service  — Single service health
//   GET /metrics          — Prometheus metrics

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceStatus string

const (
	StatusHealthy   ServiceStatus = "healthy"
	StatusDegraded  ServiceStatus = "degraded"
	StatusUnhealthy ServiceStatus = "unhealthy"
	StatusUnknown   ServiceStatus = "unknown"
)

type ServiceHealth struct {
	Name      string        `json:"name"`
	Status    ServiceStatus `json:"status"`
	Latency   string        `json:"latency_ms"`
	Error     string        `json:"error,omitempty"`
	CheckedAt string        `json:"checked_at"`
}

type PlatformHealth struct {
	Status     ServiceStatus   `json:"status"`
	Score      int             `json:"score"` // 0–100
	Services   []ServiceHealth `json:"services"`
	Healthy    int             `json:"healthy"`
	Degraded   int             `json:"degraded"`
	Unhealthy  int             `json:"unhealthy"`
	CheckedAt  string          `json:"checked_at"`
	Version    string          `json:"version"`
}

type ServiceCheck struct {
	Name    string
	Check   func(ctx context.Context) error
	Timeout time.Duration
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

var (
	serviceHealthGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "remitflow_service_health",
		Help: "Service health status (1=healthy, 0.5=degraded, 0=unhealthy)",
	}, []string{"service"})

	healthCheckDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "remitflow_health_check_duration_seconds",
		Help:    "Health check duration per service",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0},
	}, []string{"service"})

	platformScoreGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "remitflow_platform_health_score",
		Help: "Overall platform health score (0–100)",
	})
)

// ─── Health Checks ────────────────────────────────────────────────────────────

func httpCheck(url string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 500 {
			return fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return nil
	}
}

func tcpCheck(addr string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		d := net.Dialer{}
		conn, err := d.DialContext(ctx, "tcp", addr)
		if err != nil {
			return err
		}
		conn.Close()
		return nil
	}
}

func postgresCheck(dsn string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Simple TCP check to PostgreSQL port
		host := getEnv("POSTGRES_HOST", "postgres")
		port := getEnv("POSTGRES_PORT", "5432")
		return tcpCheck(host + ":" + port)(ctx)
	}
}

func buildServiceChecks() []ServiceCheck {
	return []ServiceCheck{
		{
			Name:    "PostgreSQL",
			Check:   postgresCheck(getEnv("DATABASE_URL", "")),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "Redis",
			Check:   tcpCheck(getEnv("REDIS_ADDR", "redis:6379")),
			Timeout: 2 * time.Second,
		},
		{
			Name:    "Keycloak",
			Check:   httpCheck(getEnv("KEYCLOAK_URL", "http://keycloak:8080") + "/health/ready"),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "Permify",
			Check:   httpCheck(getEnv("PERMIFY_URL", "http://permify:3476") + "/healthz"),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "Dapr",
			Check:   httpCheck("http://localhost:" + getEnv("DAPR_HTTP_PORT", "3500") + "/v1.0/healthz"),
			Timeout: 2 * time.Second,
		},
		{
			Name:    "Temporal",
			Check:   tcpCheck(getEnv("TEMPORAL_ADDRESS", "temporal:7233")),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "TigerBeetle",
			Check:   httpCheck("http://" + getEnv("TB_BRIDGE_HOST", "tb-bridge:8200") + "/health"),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "APISIX",
			Check:   httpCheck(getEnv("APISIX_ADMIN_URL", "http://apisix:9180") + "/apisix/admin/routes"),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "Fluvio",
			Check:   httpCheck("http://" + getEnv("FLUVIO_CONSUMER_HOST", "fluvio-consumer:8201") + "/health"),
			Timeout: 3 * time.Second,
		},
		{
			Name:    "Lakehouse",
			Check:   httpCheck(getEnv("LAKEHOUSE_URL", "http://lakehouse:8102") + "/health"),
			Timeout: 5 * time.Second,
		},
		{
			Name:    "OpenAppSec",
			Check:   httpCheck(getEnv("OPENAPPSEC_AGENT_URL", "http://openappsec:8765") + "/health"),
			Timeout: 2 * time.Second,
		},
		{
			Name:    "CryptoUtils",
			Check:   httpCheck("http://" + getEnv("CRYPTO_UTILS_HOST", "crypto-utils:8202") + "/health"),
			Timeout: 2 * time.Second,
		},
	}
}

// ─── Health Aggregator ────────────────────────────────────────────────────────

func runHealthChecks(checks []ServiceCheck) PlatformHealth {
	results := make([]ServiceHealth, len(checks))
	var wg sync.WaitGroup

	for i, check := range checks {
		wg.Add(1)
		go func(idx int, sc ServiceCheck) {
			defer wg.Done()
			start := time.Now()

			ctx, cancel := context.WithTimeout(context.Background(), sc.Timeout)
			defer cancel()

			timer := prometheus.NewTimer(healthCheckDuration.WithLabelValues(sc.Name))
			err := sc.Check(ctx)
			timer.ObserveDuration()

			latencyMs := fmt.Sprintf("%.1f", float64(time.Since(start).Microseconds())/1000.0)

			if err != nil {
				results[idx] = ServiceHealth{
					Name:      sc.Name,
					Status:    StatusUnhealthy,
					Latency:   latencyMs,
					Error:     err.Error(),
					CheckedAt: time.Now().UTC().Format(time.RFC3339),
				}
				serviceHealthGauge.WithLabelValues(sc.Name).Set(0)
			} else {
				results[idx] = ServiceHealth{
					Name:      sc.Name,
					Status:    StatusHealthy,
					Latency:   latencyMs,
					CheckedAt: time.Now().UTC().Format(time.RFC3339),
				}
				serviceHealthGauge.WithLabelValues(sc.Name).Set(1)
			}
		}(i, check)
	}

	wg.Wait()

	healthy, degraded, unhealthy := 0, 0, 0
	for _, r := range results {
		switch r.Status {
		case StatusHealthy:
			healthy++
		case StatusDegraded:
			degraded++
		default:
			unhealthy++
		}
	}

	total := len(results)
	score := 0
	if total > 0 {
		score = (healthy*100 + degraded*50) / total
	}
	platformScoreGauge.Set(float64(score))

	overallStatus := StatusHealthy
	if unhealthy > 0 {
		overallStatus = StatusUnhealthy
	} else if degraded > 0 {
		overallStatus = StatusDegraded
	}

	return PlatformHealth{
		Status:    overallStatus,
		Score:     score,
		Services:  results,
		Healthy:   healthy,
		Degraded:  degraded,
		Unhealthy: unhealthy,
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Version:   getEnv("APP_VERSION", "1.0.0"),
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	checks []ServiceCheck
	logger *slog.Logger
}

func (s *Server) handleLiveness(w http.ResponseWriter, r *http.Request) {
	// Liveness: just return 200 — if the process is running, it's alive
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "alive",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	// Readiness: check critical dependencies (PostgreSQL + Redis)
	critical := []ServiceCheck{}
	for _, c := range s.checks {
		if c.Name == "PostgreSQL" || c.Name == "Redis" {
			critical = append(critical, c)
		}
	}

	health := runHealthChecks(critical)
	w.Header().Set("Content-Type", "application/json")

	if health.Unhealthy > 0 {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(health)
}

func (s *Server) handleFullHealth(w http.ResponseWriter, r *http.Request) {
	health := runHealthChecks(s.checks)
	w.Header().Set("Content-Type", "application/json")

	if health.Unhealthy > len(s.checks)/2 {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(health)
}

func (s *Server) handleServiceHealth(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("service")
	for _, check := range s.checks {
		if check.Name == name {
			result := runHealthChecks([]ServiceCheck{check})
			w.Header().Set("Content-Type", "application/json")
			if result.Unhealthy > 0 {
				w.WriteHeader(http.StatusServiceUnavailable)
			}
			json.NewEncoder(w).Encode(result.Services[0])
			return
		}
	}
	http.Error(w, `{"error":"service not found"}`, http.StatusNotFound)
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

	checks := buildServiceChecks()
	srv := &Server{checks: checks, logger: logger}

	port := getEnv("HEALTH_PROBE_PORT", "8099")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", srv.handleLiveness)
	mux.HandleFunc("GET /readyz", srv.handleReadiness)
	mux.HandleFunc("GET /health/full", srv.handleFullHealth)
	mux.HandleFunc("GET /health/{service}", srv.handleServiceHealth)
	mux.Handle("GET /metrics", promhttp.Handler())

	addr := ":" + port
	logger.Info("Health probe server listening", "addr", addr)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
