// RemitFlow — Permify Authorization Facade
//
// Real HTTP facade in front of Permify. The TypeScript serviceRegistry
// (server/_core/serviceRegistry.ts) calls POST /check with the Zanzibar-style
// contract {subject, permission, object}; this service translates that into a
// Permify permissions/check call for the configured tenant and reports honest
// results — when Permify is unreachable the check fails closed (allowed=false
// with an explicit reason), never fabricated.
//
// Endpoints (main server, PORT — default 8109):
//   POST /check               permission check facade
//   GET  /health              liveness (process up)
//   GET  /readyz              readiness (Permify reachable)
//
// Metrics server (METRICS_PORT — default 9109, see cmd/metrics.go):
//   GET /metrics, /healthz, /readyz
//
// Required env:
//   PERMIFY_URL        e.g. http://permify:3476   (or PERMIFY_ENDPOINT host:port)
//   PERMIFY_TENANT_ID  e.g. remitflow             (or PERMIFY_TENANT)
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// ─── Configuration ──────────────────────────────────────────────────────────

type config struct {
	port        string
	metricsPort string
	permifyURL  string
	tenantID    string
	httpClient  *http.Client
}

func getenv(primary, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(primary)); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv(fallback))
}

func loadConfig() (*config, error) {
	permifyURL := getenv("PERMIFY_URL", "")
	if permifyURL == "" {
		// PERMIFY_ENDPOINT carries host:port (gRPC-style config); the HTTP
		// gateway default port is 3476.
		endpoint := getenv("PERMIFY_ENDPOINT", "")
		if endpoint == "" {
			return nil, errors.New("PERMIFY_URL (or PERMIFY_ENDPOINT) must be configured — refusing to start without a real authorization backend")
		}
		host, port, ok := strings.Cut(endpoint, ":")
		if !ok {
			host, port = endpoint, "3476"
		}
		permifyURL = fmt.Sprintf("http://%s:%s", host, port)
	}
	tenantID := getenv("PERMIFY_TENANT_ID", "PERMIFY_TENANT")
	if tenantID == "" {
		return nil, errors.New("PERMIFY_TENANT_ID must be configured — refusing to start without a tenant")
	}
	port := getenv("PORT", "")
	if port == "" {
		port = "8109"
	}
	metricsPort := getenv("METRICS_PORT", "")
	if metricsPort == "" {
		metricsPort = "9109"
	}
	return &config{
		port:        port,
		metricsPort: metricsPort,
		permifyURL:  strings.TrimRight(permifyURL, "/"),
		tenantID:    tenantID,
		httpClient:  &http.Client{Timeout: 5 * time.Second},
	}, nil
}

// ─── Contracts ──────────────────────────────────────────────────────────────

// checkRequest mirrors server/_core/serviceRegistry.ts permifyCheck().
type checkRequest struct {
	Subject    string `json:"subject"`    // "user:123" or bare "123" (user assumed)
	Permission string `json:"permission"` // e.g. "transfer"
	Object     string `json:"object"`     // "entity_type:entity_id", e.g. "wallet:123"
}

type checkResponse struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

type permifyCheckRequest struct {
	Metadata   permifyMetadata `json:"metadata"`
	Entity     permifyRef      `json:"entity"`
	Permission string          `json:"permission"`
	Subject    permifyRef      `json:"subject"`
}

type permifyMetadata struct {
	SchemaVersion string `json:"schema_version"`
	SnapToken     string `json:"snap_token"`
	Depth         int    `json:"depth"`
}

type permifyRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type permifyCheckResponse struct {
	Can string `json:"can"`
}

// splitRef parses "type:id" — a bare id is interpreted as the default type.
func splitRef(raw, defaultType string) (permifyRef, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return permifyRef{}, errors.New("empty reference")
	}
	typ, id, found := strings.Cut(raw, ":")
	if !found {
		return permifyRef{Type: defaultType, ID: raw}, nil
	}
	if typ == "" || id == "" {
		return permifyRef{}, fmt.Errorf("malformed reference %q (want type:id)", raw)
	}
	return permifyRef{Type: typ, ID: id}, nil
}

// ─── Permify client ─────────────────────────────────────────────────────────

func (c *config) checkPermission(ctx context.Context, req checkRequest) (bool, error) {
	entity, err := splitRef(req.Object, "")
	if err != nil {
		return false, fmt.Errorf("invalid object: %w", err)
	}
	subject, err := splitRef(req.Subject, "user")
	if err != nil {
		return false, fmt.Errorf("invalid subject: %w", err)
	}
	if req.Permission == "" {
		return false, errors.New("permission is required")
	}

	payload := permifyCheckRequest{
		Metadata:   permifyMetadata{SchemaVersion: "", SnapToken: "", Depth: 20},
		Entity:     entity,
		Permission: req.Permission,
		Subject:    subject,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}

	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", c.permifyURL, c.tenantID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false, fmt.Errorf("permify unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return false, fmt.Errorf("permify returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var result permifyCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("permify response undecodable: %w", err)
	}
	return result.Can == "CHECK_RESULT_ALLOWED", nil
}

func (c *config) permifyReachable(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.permifyURL+"/healthz", nil)
	if err != nil {
		return false
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ─── HTTP handlers ──────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (c *config) handleCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	var req checkRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}

	entityType, _, _ := strings.Cut(req.Object, ":")
	start := time.Now()
	allowed, err := c.checkPermission(r.Context(), req)
	permifyCheckDuration.WithLabelValues(entityType).Observe(time.Since(start).Seconds())
	if err != nil {
		// Fail closed — the registry contract requires allowed=false on any
		// backend failure, with the real reason surfaced for observability.
		permifyErrors.WithLabelValues("check_failed").Inc()
		permifyChecks.WithLabelValues(entityType, req.Permission, "error").Inc()
		log.Printf("[permify-facade] check denied (backend error): %v", err)
		writeJSON(w, http.StatusOK, checkResponse{Allowed: false, Reason: err.Error()})
		return
	}
	result := "denied"
	if allowed {
		result = "allowed"
	}
	permifyChecks.WithLabelValues(entityType, req.Permission, result).Inc()
	writeJSON(w, http.StatusOK, checkResponse{Allowed: allowed})
}

func (c *config) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "go-permify-service",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (c *config) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if !c.permifyReachable(ctx) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "unavailable",
			"reason": "permify backend unreachable at " + c.permifyURL,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// ─── Main ───────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("[permify-facade] configuration error: %v", err)
	}

	initPermifyMetrics()

	// Background connectivity gauge so dashboards see Permify outages even
	// when no checks are flowing.
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if cfg.permifyReachable(ctx) {
				permifyConnectionStatus.Set(1)
			} else {
				permifyConnectionStatus.Set(0)
			}
			cancel()
			<-ticker.C
		}
	}()

	// Metrics/health sidecar server (cmd/metrics.go).
	go startPermifyMetricsServer(":" + cfg.metricsPort)

	mux := http.NewServeMux()
	mux.HandleFunc("/check", cfg.handleCheck)
	mux.HandleFunc("/health", cfg.handleHealth)
	mux.HandleFunc("/readyz", cfg.handleReadyz)

	server := &http.Server{
		Addr:         ":" + cfg.port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[permify-facade] listening on :%s (permify=%s tenant=%s, metrics=:%s)", cfg.port, cfg.permifyURL, cfg.tenantID, cfg.metricsPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[permify-facade] server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("[permify-facade] shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("[permify-facade] shutdown error: %v", err)
	}
}
