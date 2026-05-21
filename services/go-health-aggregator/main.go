// Package main implements a health check aggregator service.
// It probes all microservices and provides a unified health endpoint
// for Kubernetes readiness/liveness probes and monitoring dashboards.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type ServiceHealth struct {
	Name         string `json:"name"`
	URL          string `json:"url"`
	Status       string `json:"status"`
	ResponseTime int64  `json:"responseTimeMs"`
	LastChecked  string `json:"lastChecked"`
	Error        string `json:"error,omitempty"`
}

type AggregatedHealth struct {
	Status   string          `json:"status"`
	Services []ServiceHealth `json:"services"`
	Healthy  int             `json:"healthy"`
	Degraded int             `json:"degraded"`
	Down     int             `json:"down"`
	Total    int             `json:"total"`
}

type HealthChecker struct {
	mu       sync.RWMutex
	services []ServiceConfig
	results  map[string]ServiceHealth
	client   *http.Client
}

type ServiceConfig struct {
	Name string
	URL  string
}

func NewHealthChecker() *HealthChecker {
	services := []ServiceConfig{
		{Name: "api-server", URL: envOrDefault("API_SERVER_URL", "http://localhost:3000") + "/api/trpc/system.health"},
		{Name: "fx-aggregator", URL: envOrDefault("FX_AGGREGATOR_URL", "http://localhost:8100") + "/health"},
		{Name: "fee-engine", URL: envOrDefault("FEE_ENGINE_URL", "http://localhost:8101") + "/health"},
		{Name: "refund-engine", URL: envOrDefault("REFUND_ENGINE_URL", "http://localhost:8102") + "/health"},
		{Name: "kyc-event-consumer", URL: envOrDefault("KYC_EVENT_CONSUMER_URL", "http://localhost:8081") + "/health"},
		{Name: "bvn-nin-verification", URL: envOrDefault("BVN_NIN_URL", "http://localhost:8082") + "/health"},
		{Name: "sanctions-rescreener", URL: envOrDefault("SANCTIONS_URL", "http://localhost:8083") + "/health"},
		{Name: "goaml-integration", URL: envOrDefault("GOAML_URL", "http://localhost:8084") + "/health"},
		{Name: "liveness-proxy", URL: envOrDefault("LIVENESS_URL", "http://localhost:8085") + "/health"},
		{Name: "compliance-engine", URL: envOrDefault("COMPLIANCE_URL", "http://localhost:8092") + "/health"},
		{Name: "aml-engine", URL: envOrDefault("AML_URL", "http://localhost:8091") + "/health"},
		{Name: "transfer-engine", URL: envOrDefault("TRANSFER_ENGINE_URL", "http://localhost:50051") + "/health"},
		{Name: "pdf-receipt", URL: envOrDefault("PDF_RECEIPT_URL", "http://localhost:8099") + "/health"},
	}

	return &HealthChecker{
		services: services,
		results:  make(map[string]ServiceHealth),
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

func (hc *HealthChecker) checkService(ctx context.Context, svc ServiceConfig) ServiceHealth {
	start := time.Now()
	result := ServiceHealth{
		Name:        svc.Name,
		URL:         svc.URL,
		LastChecked: time.Now().UTC().Format(time.RFC3339),
	}

	req, err := http.NewRequestWithContext(ctx, "GET", svc.URL, nil)
	if err != nil {
		result.Status = "down"
		result.Error = err.Error()
		result.ResponseTime = time.Since(start).Milliseconds()
		return result
	}

	resp, err := hc.client.Do(req)
	result.ResponseTime = time.Since(start).Milliseconds()

	if err != nil {
		result.Status = "down"
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if result.ResponseTime > 2000 {
			result.Status = "degraded"
		} else {
			result.Status = "healthy"
		}
	} else if resp.StatusCode < 500 {
		result.Status = "degraded"
	} else {
		result.Status = "down"
		result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	return result
}

func (hc *HealthChecker) checkAll(ctx context.Context) AggregatedHealth {
	var wg sync.WaitGroup
	results := make(chan ServiceHealth, len(hc.services))

	for _, svc := range hc.services {
		wg.Add(1)
		go func(s ServiceConfig) {
			defer wg.Done()
			results <- hc.checkService(ctx, s)
		}(svc)
	}

	wg.Wait()
	close(results)

	agg := AggregatedHealth{
		Total: len(hc.services),
	}

	for r := range results {
		agg.Services = append(agg.Services, r)
		switch r.Status {
		case "healthy":
			agg.Healthy++
		case "degraded":
			agg.Degraded++
		default:
			agg.Down++
		}

		hc.mu.Lock()
		hc.results[r.Name] = r
		hc.mu.Unlock()
	}

	if agg.Down > 0 {
		agg.Status = "unhealthy"
	} else if agg.Degraded > 0 {
		agg.Status = "degraded"
	} else {
		agg.Status = "healthy"
	}

	return agg
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	port := envOrDefault("HEALTH_AGGREGATOR_PORT", "8200")
	checker := NewHealthChecker()

	// Background polling
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			result := checker.checkAll(ctx)
			slog.Info("Health check cycle complete",
				"status", result.Status,
				"healthy", result.Healthy,
				"degraded", result.Degraded,
				"down", result.Down,
			)
			cancel()
			time.Sleep(30 * time.Second)
		}
	}()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		result := checker.checkAll(ctx)

		w.Header().Set("Content-Type", "application/json")
		if result.Status == "unhealthy" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(result)
	})

	mux.HandleFunc("GET /health/service/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		checker.mu.RLock()
		result, ok := checker.results[name]
		checker.mu.RUnlock()

		if !ok {
			http.Error(w, `{"error": "service not found"}`, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	server := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		slog.Info("Shutting down health aggregator")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()

	slog.Info("Health aggregator starting", "port", port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("Server failed", "error", err)
		os.Exit(1)
	}
}
