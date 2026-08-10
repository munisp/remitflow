// RemitFlow — APISIX Dynamic Route Manager (Go)
// ═══════════════════════════════════════════════
// Manages APISIX routes, upstreams, and plugins programmatically.
// Provides a REST API that the Node.js layer calls to register/update
// API routes, configure rate limits, and manage consumer credentials.
//
// Why Go:
//   - APISIX Admin API is HTTP-based — Go's net/http is ideal
//   - Goroutines handle concurrent route sync efficiently
//   - Strong typing prevents misconfigured route objects
//   - Fast startup time for sidecar deployment
//
// Endpoints:
//   POST   /routes              — Create or upsert a route
//   DELETE /routes/:id          — Delete a route
//   GET    /routes              — List all routes
//   POST   /upstreams           — Create or upsert an upstream
//   POST   /consumers           — Create a consumer (API key auth)
//   POST   /plugins/rate-limit  — Configure rate limiting for a route
//   GET    /health              — Liveness probe
//   GET    /metrics             — Prometheus metrics

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	Port           string
	ApisixAdminURL string
	ApisixAdminKey string
	LogLevel       string
	// OIDC (Keycloak) settings for the bootstrap /api/* route
	OIDCDiscoveryURL string
	OIDCClientID     string
	OIDCBearerOnly   bool
	OIDCSslVerify    bool
}

func loadConfig() (Config, error) {
	cfg := Config{
		Port:           getEnv("APISIX_MANAGER_PORT", "8100"),
		ApisixAdminURL: getEnv("APISIX_ADMIN_URL", "http://apisix:9180"),
		// Fail-fast: no default admin key. An unset key means the gateway was
		// not provisioned and this service must refuse to start.
		ApisixAdminKey: os.Getenv("APISIX_ADMIN_KEY"),
		LogLevel:       getEnv("LOG_LEVEL", "info"),
		OIDCClientID:   getEnv("KEYCLOAK_CLIENT_ID", "remitflow-api"),
		OIDCBearerOnly: getEnv("APISIX_OIDC_BEARER_ONLY", "true") == "true",
		// ssl_verify defaults to true; set APISIX_OIDC_SSL_VERIFY=false only for
		// local Keycloak dev instances without valid certs.
		OIDCSslVerify:  getEnv("APISIX_OIDC_SSL_VERIFY", "true") == "true",
	}
	if cfg.ApisixAdminKey == "" {
		return cfg, fmt.Errorf("APISIX_ADMIN_KEY is not set — refusing to start without gateway credentials")
	}
	// Keycloak discovery URL from env (explicit URL or derived from issuer)
	cfg.OIDCDiscoveryURL = os.Getenv("KEYCLOAK_DISCOVERY_URL")
	if cfg.OIDCDiscoveryURL == "" {
		if issuer := os.Getenv("KEYCLOAK_ISSUER"); issuer != "" {
			cfg.OIDCDiscoveryURL = issuer + "/.well-known/openid-configuration"
		}
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

type Route struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	URI         string                 `json:"uri"`
	Methods     []string               `json:"methods"`
	UpstreamID  string                 `json:"upstream_id,omitempty"`
	Upstream    *Upstream              `json:"upstream,omitempty"`
	Plugins     map[string]interface{} `json:"plugins,omitempty"`
	Status      int                    `json:"status"` // 1=enabled, 0=disabled
}

type Upstream struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Type   string `json:"type"` // "roundrobin" | "least_conn" | "chash"
	Scheme string `json:"scheme"` // "http" | "https" | "grpc"
	Nodes  map[string]int `json:"nodes"` // "host:port" → weight
	Checks *HealthCheck   `json:"checks,omitempty"`
}

type HealthCheck struct {
	Active *ActiveCheck `json:"active,omitempty"`
}

type ActiveCheck struct {
	Type     string   `json:"type"` // "http" | "https" | "tcp"
	HTTPPath string   `json:"http_path"`
	Interval int      `json:"interval"`
	Timeout  int      `json:"timeout"`
	Healthy  *Healthy `json:"healthy,omitempty"`
}

type Healthy struct {
	Interval     int `json:"interval"`
	Successes    int `json:"successes"`
	HTTPStatuses []int `json:"http_statuses"`
}

type Consumer struct {
	Username string                 `json:"username"`
	Plugins  map[string]interface{} `json:"plugins"`
}

type RateLimitConfig struct {
	RouteID   string `json:"route_id"`
	Count     int    `json:"count"`
	TimeWindow int   `json:"time_window"` // seconds
	Policy    string `json:"policy"` // "local" | "redis"
	Rejected  int    `json:"rejected_code"` // HTTP status for rejected requests
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

var (
	routeOpsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "apisix_manager_route_ops_total",
		Help: "Total route operations",
	}, []string{"operation", "status"})

	apisixRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "apisix_manager_request_duration_seconds",
		Help:    "APISIX Admin API request duration",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5},
	}, []string{"method", "path"})
)

// ─── APISIX Client ────────────────────────────────────────────────────────────

type ApisixClient struct {
	baseURL    string
	adminKey   string
	httpClient *http.Client
}

func NewApisixClient(baseURL, adminKey string) *ApisixClient {
	return &ApisixClient{
		baseURL:  baseURL,
		adminKey: adminKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *ApisixClient) do(ctx context.Context, method, path string, body interface{}) ([]byte, int, error) {
	start := time.Now()
	url := c.baseURL + "/apisix/admin" + path

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("X-API-KEY", c.adminKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	duration := time.Since(start).Seconds()
	apisixRequestDuration.WithLabelValues(method, path).Observe(duration)

	if err != nil {
		return nil, 0, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}

	return respBody, resp.StatusCode, nil
}

func (c *ApisixClient) UpsertRoute(ctx context.Context, route Route) error {
	path := fmt.Sprintf("/routes/%s", route.ID)
	body, statusCode, err := c.do(ctx, http.MethodPut, path, route)
	if err != nil {
		routeOpsTotal.WithLabelValues("upsert", "error").Inc()
		return err
	}
	if statusCode >= 400 {
		routeOpsTotal.WithLabelValues("upsert", "error").Inc()
		return fmt.Errorf("APISIX error %d: %s", statusCode, string(body))
	}
	routeOpsTotal.WithLabelValues("upsert", "success").Inc()
	return nil
}

func (c *ApisixClient) DeleteRoute(ctx context.Context, routeID string) error {
	path := fmt.Sprintf("/routes/%s", routeID)
	_, statusCode, err := c.do(ctx, http.MethodDelete, path, nil)
	if err != nil {
		routeOpsTotal.WithLabelValues("delete", "error").Inc()
		return err
	}
	if statusCode >= 400 && statusCode != 404 {
		routeOpsTotal.WithLabelValues("delete", "error").Inc()
		return fmt.Errorf("APISIX delete error %d", statusCode)
	}
	routeOpsTotal.WithLabelValues("delete", "success").Inc()
	return nil
}

func (c *ApisixClient) ListRoutes(ctx context.Context) ([]byte, error) {
	body, statusCode, err := c.do(ctx, http.MethodGet, "/routes", nil)
	if err != nil {
		return nil, err
	}
	if statusCode >= 400 {
		return nil, fmt.Errorf("APISIX list error %d", statusCode)
	}
	return body, nil
}

// GetRoute fetches the full current route object (uri, upstream, plugins…).
// Returns (nil, nil) when the route does not exist.
func (c *ApisixClient) GetRoute(ctx context.Context, routeID string) (map[string]interface{}, error) {
	body, statusCode, err := c.do(ctx, http.MethodGet, fmt.Sprintf("/routes/%s", routeID), nil)
	if err != nil {
		return nil, err
	}
	if statusCode == 404 {
		return nil, nil
	}
	if statusCode >= 400 {
		return nil, fmt.Errorf("APISIX get route error %d: %s", statusCode, string(body))
	}
	// APISIX v3 Admin API wraps the object in {"value": {...}}
	var envelope struct {
		Value map[string]interface{} `json:"value"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Value != nil {
		return envelope.Value, nil
	}
	var direct map[string]interface{}
	if err := json.Unmarshal(body, &direct); err != nil {
		return nil, fmt.Errorf("decode route %s: %w", routeID, err)
	}
	return direct, nil
}

func (c *ApisixClient) UpsertUpstream(ctx context.Context, upstream Upstream) error {
	path := fmt.Sprintf("/upstreams/%s", upstream.ID)
	_, statusCode, err := c.do(ctx, http.MethodPut, path, upstream)
	if err != nil {
		return err
	}
	if statusCode >= 400 {
		return fmt.Errorf("APISIX upstream error %d", statusCode)
	}
	return nil
}

func (c *ApisixClient) UpsertConsumer(ctx context.Context, consumer Consumer) error {
	path := fmt.Sprintf("/consumers/%s", consumer.Username)
	_, statusCode, err := c.do(ctx, http.MethodPut, path, consumer)
	if err != nil {
		return err
	}
	if statusCode >= 400 {
		return fmt.Errorf("APISIX consumer error %d", statusCode)
	}
	return nil
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	cfg    Config
	client *ApisixClient
	logger *slog.Logger
}

func (s *Server) handleUpsertRoute(w http.ResponseWriter, r *http.Request) {
	var route Route
	if err := json.NewDecoder(r.Body).Decode(&route); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if route.ID == "" || route.URI == "" {
		http.Error(w, `{"error":"id and uri are required"}`, http.StatusBadRequest)
		return
	}

	if err := s.client.UpsertRoute(r.Context(), route); err != nil {
		s.logger.Error("upsert route failed", "error", err, "route_id", route.ID)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	s.logger.Info("route upserted", "route_id", route.ID, "uri", route.URI)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"route_id": route.ID,
	})
}

func (s *Server) handleDeleteRoute(w http.ResponseWriter, r *http.Request) {
	routeID := r.PathValue("id")
	if routeID == "" {
		http.Error(w, `{"error":"route id required"}`, http.StatusBadRequest)
		return
	}

	if err := s.client.DeleteRoute(r.Context(), routeID); err != nil {
		s.logger.Error("delete route failed", "error", err, "route_id", routeID)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "deleted": routeID})
}

func (s *Server) handleListRoutes(w http.ResponseWriter, r *http.Request) {
	data, err := s.client.ListRoutes(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleUpsertUpstream(w http.ResponseWriter, r *http.Request) {
	var upstream Upstream
	if err := json.NewDecoder(r.Body).Decode(&upstream); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if err := s.client.UpsertUpstream(r.Context(), upstream); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "upstream_id": upstream.ID})
}

func (s *Server) handleUpsertConsumer(w http.ResponseWriter, r *http.Request) {
	var consumer Consumer
	if err := json.NewDecoder(r.Body).Decode(&consumer); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if err := s.client.UpsertConsumer(r.Context(), consumer); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "username": consumer.Username})
}

func (s *Server) handleConfigureRateLimit(w http.ResponseWriter, r *http.Request) {
	var cfg RateLimitConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if cfg.RouteID == "" {
		http.Error(w, `{"error":"route_id is required"}`, http.StatusBadRequest)
		return
	}

	// GET the existing route and MERGE the rate-limit plugin — a bare PUT with
	// only plugins would clobber the route's uri/upstream.
	existing, err := s.client.GetRoute(r.Context(), cfg.RouteID)
	if err != nil {
		s.logger.Error("rate-limit: fetch route failed", "error", err, "route_id", cfg.RouteID)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	if existing == nil {
		http.Error(w, `{"error":"route not found"}`, http.StatusNotFound)
		return
	}

	plugins, _ := existing["plugins"].(map[string]interface{})
	if plugins == nil {
		plugins = map[string]interface{}{}
	}
	plugins["limit-count"] = map[string]interface{}{
		"count":         cfg.Count,
		"time_window":   cfg.TimeWindow,
		"policy":        cfg.Policy,
		"rejected_code": cfg.Rejected,
		"key":           "consumer_name",
	}
	existing["plugins"] = plugins
	existing["id"] = cfg.RouteID
	// Strip read-only fields the Admin API echoes back
	delete(existing, "create_time")
	delete(existing, "update_time")

	body, statusCode, err := s.client.do(r.Context(), http.MethodPut,
		fmt.Sprintf("/routes/%s", cfg.RouteID), existing)
	if err != nil || statusCode >= 400 {
		routeOpsTotal.WithLabelValues("upsert", "error").Inc()
		errMsg := fmt.Sprintf("APISIX error %d: %s", statusCode, string(body))
		if err != nil {
			errMsg = err.Error()
		}
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, errMsg), http.StatusBadGateway)
		return
	}
	routeOpsTotal.WithLabelValues("upsert", "success").Inc()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"route_id": cfg.RouteID,
		"rate_limit": map[string]interface{}{
			"count":       cfg.Count,
			"time_window": cfg.TimeWindow,
		},
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Check APISIX reachability
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	_, statusCode, err := s.client.do(ctx, http.MethodGet, "/routes", nil)
	apisixOk := err == nil && statusCode < 500

	status := "ok"
	httpStatus := http.StatusOK
	if !apisixOk {
		status = "degraded"
		httpStatus = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      status,
		"service":     "apisix-manager",
		"apisix_ok":   apisixOk,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Bootstrap: Register Default RemitFlow Routes ─────────────────────────────

func (s *Server) bootstrapDefaultRoutes(ctx context.Context) {
	nodeHost := getEnv("API_NODE_HOST", "remitflow-api:3000")

	// Register the main Node.js API upstream
	upstream := Upstream{
		ID:     "remitflow-api",
		Name:   "RemitFlow API",
		Type:   "roundrobin",
		Scheme: "http",
		Nodes:  map[string]int{nodeHost: 1},
		Checks: &HealthCheck{
			Active: &ActiveCheck{
				Type:     "http",
				HTTPPath: "/api/health",
				Interval: 5,
				Timeout:  2,
				Healthy: &Healthy{
					Interval:     2,
					Successes:    2,
					HTTPStatuses: []int{200, 204},
				},
			},
		},
	}

	if err := s.client.UpsertUpstream(ctx, upstream); err != nil {
		s.logger.Warn("bootstrap upstream failed", "error", err)
	} else {
		s.logger.Info("bootstrap upstream registered")
	}

	// Register core API routes
	apiPlugins := map[string]interface{}{
		"cors": map[string]interface{}{
			"allow_origins": getEnv("CORS_ORIGINS", "https://app.remitflow.com"),
			"allow_methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
			"allow_headers": "Authorization,Content-Type,X-Request-ID",
			"max_age":       3600,
		},
		"limit-req": map[string]interface{}{
			"rate":         100,
			"burst":        50,
			"key":          "remote_addr",
			"rejected_code": 429,
		},
		"response-rewrite": map[string]interface{}{
			"headers": map[string]interface{}{
				"X-Frame-Options":        "DENY",
				"X-Content-Type-Options": "nosniff",
				"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
			},
		},
	}
	// OIDC protection via Keycloak discovery — only when discovery is configured.
	// bearer_only is enabled for machine-to-machine endpoints (no browser redirect);
	// ssl_verify defaults to true and is configurable via APISIX_OIDC_SSL_VERIFY.
	if s.cfg.OIDCDiscoveryURL != "" {
		apiPlugins["openid-connect"] = map[string]interface{}{
			"discovery":   s.cfg.OIDCDiscoveryURL,
			"client_id":   s.cfg.OIDCClientID,
			"bearer_only": s.cfg.OIDCBearerOnly,
			"ssl_verify":  s.cfg.OIDCSslVerify,
		}
	} else {
		s.logger.Warn("KEYCLOAK_DISCOVERY_URL/KEYCLOAK_ISSUER not set — /api/* route registered WITHOUT openid-connect")
	}

	routes := []Route{
		{
			ID:         "remitflow-api-all",
			Name:       "RemitFlow API — All Routes",
			URI:        "/api/*",
			Methods:    []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			UpstreamID: "remitflow-api",
			Plugins:    apiPlugins,
			Status:     1,
		},
		{
			ID:         "remitflow-health",
			Name:       "Health Check",
			URI:        "/health",
			Methods:    []string{"GET"},
			UpstreamID: "remitflow-api",
			Status:     1,
		},
	}

	for _, route := range routes {
		if err := s.client.UpsertRoute(ctx, route); err != nil {
			s.logger.Warn("bootstrap route failed", "route_id", route.ID, "error", err)
		} else {
			s.logger.Info("bootstrap route registered", "route_id", route.ID)
		}
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg, err := loadConfig()
	if err != nil {
		slog.Error("configuration error", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	client := NewApisixClient(cfg.ApisixAdminURL, cfg.ApisixAdminKey)

	srv := &Server{
		cfg:    cfg,
		client: client,
		logger: logger,
	}

	// Bootstrap default routes on startup (non-blocking)
	go func() {
		time.Sleep(5 * time.Second) // Wait for APISIX to be ready
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		srv.bootstrapDefaultRoutes(ctx)
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /routes", srv.handleUpsertRoute)
	mux.HandleFunc("DELETE /routes/{id}", srv.handleDeleteRoute)
	mux.HandleFunc("GET /routes", srv.handleListRoutes)
	mux.HandleFunc("POST /upstreams", srv.handleUpsertUpstream)
	mux.HandleFunc("POST /consumers", srv.handleUpsertConsumer)
	mux.HandleFunc("POST /plugins/rate-limit", srv.handleConfigureRateLimit)
	mux.HandleFunc("GET /health", srv.handleHealth)
	mux.Handle("GET /metrics", promhttp.Handler())

	addr := ":" + cfg.Port
	logger.Info("APISIX manager listening", "addr", addr)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
