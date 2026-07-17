// ═══════════════════════════════════════════════════════════════════════════════
// RemitFlow — Caddy On-Demand TLS Validator
// ═══════════════════════════════════════════════════════════════════════════════
//
// Caddy's on_demand_tls feature can automatically provision TLS certificates
// for tenant subdomains (e.g., tenant-abc.remitflow.io). Before issuing a
// certificate, Caddy asks this service whether the domain is allowed.
//
// This service:
//   1. Receives GET /tls/ask?domain=<domain> from Caddy
//   2. Queries the RemitFlow API to check if the domain belongs to a valid tenant
//   3. Returns 200 (allow) or 403 (deny)
//
// This prevents certificate issuance for arbitrary domains (rate-limit abuse).
//
// Port: 8070
// ═══════════════════════════════════════════════════════════════════════════════

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	apiBaseURL = getEnv("API_BASE_URL", "http://api:3000")
	apiKey     = getEnv("INTERNAL_API_KEY", "caddy-ondemand-key-change-in-production")
	listenAddr = getEnv("LISTEN_ADDR", ":8070")
	logLevel   = getEnv("LOG_LEVEL", "info")

	// Allowed base domains — only subdomains of these are eligible for on-demand TLS
	allowedBaseDomains = strings.Split(
		getEnv("ALLOWED_BASE_DOMAINS", "remitflow.io,remitflow.local"),
		",")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Prometheus Metrics ────────────────────────────────────────────────────────

var (
	tlsAskTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "caddy_ondemand_tls_ask_total",
			Help: "Total on-demand TLS certificate requests",
		},
		[]string{"result"}, // "allowed", "denied", "error"
	)
)

func init() {
	prometheus.MustRegister(tlsAskTotal)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func askHandler(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		http.Error(w, "missing domain parameter", http.StatusBadRequest)
		return
	}

	// Basic domain validation — must be a subdomain of an allowed base domain
	if !isAllowedBaseDomain(domain) {
		slog.Warn("on-demand TLS denied: not an allowed base domain", "domain", domain)
		tlsAskTotal.WithLabelValues("denied").Inc()
		http.Error(w, "domain not allowed", http.StatusForbidden)
		return
	}

	// Check with RemitFlow API if this tenant domain is registered
	allowed, err := checkTenantDomain(domain)
	if err != nil {
		slog.Error("tenant domain check failed", "domain", domain, "error", err)
		tlsAskTotal.WithLabelValues("error").Inc()
		// Fail closed — deny certificate if we can't verify
		http.Error(w, "domain validation error", http.StatusForbidden)
		return
	}

	if !allowed {
		slog.Info("on-demand TLS denied: tenant not found", "domain", domain)
		tlsAskTotal.WithLabelValues("denied").Inc()
		http.Error(w, "tenant domain not registered", http.StatusForbidden)
		return
	}

	slog.Info("on-demand TLS allowed", "domain", domain)
	tlsAskTotal.WithLabelValues("allowed").Inc()
	w.WriteHeader(http.StatusOK)
}

func isAllowedBaseDomain(domain string) bool {
	for _, base := range allowedBaseDomains {
		base = strings.TrimSpace(base)
		if strings.HasSuffix(domain, "."+base) || domain == base {
			return true
		}
	}
	return false
}

func checkTenantDomain(domain string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	url := fmt.Sprintf("%s/api/trpc/system.validateTenantDomain?input=%s", apiBaseURL, domain)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("X-Internal-API-Key", apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result struct {
		Result struct {
			Data struct {
				Valid bool `json:"valid"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("API response decode error: %w", err)
	}
	return result.Result.Data.Valid, nil
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","service":"caddy-ondemand-validator"}`)
}

func main() {
	level := slog.LevelInfo
	if logLevel == "debug" {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))

	slog.Info("starting caddy-ondemand-validator",
		"addr", listenAddr,
		"api_base_url", apiBaseURL,
		"allowed_base_domains", allowedBaseDomains)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /tls/ask", askHandler)
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		promhttp.Handler().ServeHTTP(w, r)
	})

	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	slog.Info("caddy-ondemand-validator listening", "addr", listenAddr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
