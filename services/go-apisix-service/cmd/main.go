// RemitFlow — APISIX Gateway Configuration Service (Go)
// Manages APISIX routes, upstreams, plugins, and consumers via Admin API.
//
// APISIX provides:
// - Rate limiting per user/IP
// - JWT validation at gateway level
// - Request/response transformation
// - Load balancing across microservices
// - Circuit breaker
// - Observability (Prometheus, OpenTelemetry)
//
// APISIX Admin API: http://apisix:9180 (default)

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
)

// ─── Configuration ────────────────────────────────────────────────────────────
var (
	apisixAdminURL = getEnv("APISIX_ADMIN_URL", "http://apisix:9180")
	apisixAdminKey = getEnv("APISIX_ADMIN_KEY", "edd1c9f034335f136f87ad84b625c8f1")
	servicePort    = getEnv("PORT", "8103")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── APISIX Route Definitions ─────────────────────────────────────────────────
type Route struct {
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	URI      string                 `json:"uri"`
	Methods  []string               `json:"methods"`
	Upstream map[string]interface{} `json:"upstream"`
	Plugins  map[string]interface{} `json:"plugins"`
	Labels   map[string]string      `json:"labels,omitempty"`
}

type Upstream struct {
	ID    string                 `json:"id"`
	Name  string                 `json:"name"`
	Type  string                 `json:"type"`
	Nodes map[string]interface{} `json:"nodes"`
}

// ─── RemitFlow Routes ─────────────────────────────────────────────────────────
func buildRoutes() []Route {
	services := map[string]string{
		"app":          "remitflow-app:3000",
		"cips":         "go-cips-adapter:8091",
		"upi":          "rust-upi-adapter:8092",
		"pix":          "python-pix-adapter:8093",
		"kafka":        "go-kafka-service:8094",
		"temporal":     "go-temporal-worker:8095",
		"permify":      "go-permify-service:8096",
		"redis":        "rust-redis-service:8097",
		"fluvio":       "rust-fluvio-service:8098",
		"keycloak":     "python-keycloak-service:8099",
		"opensearch":   "python-opensearch-service:8100",
		"lakehouse":    "python-lakehouse-service:8101",
		"pg":           "rust-pg-service:8102",
		"tigerbeetle":  "rust-tigerbeetle-service:8104",
		"mojaloop":     "go-mojaloop-adapter:8105",
	}

	rateLimitPlugin := map[string]interface{}{
		"limit-req": map[string]interface{}{
			"rate":  100,
			"burst": 50,
			"key":   "consumer_name",
		},
	}

	corsPlugin := map[string]interface{}{
		"cors": map[string]interface{}{
			"allow_origins": "*",
			"allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
			"allow_headers": "Content-Type,Authorization,X-API-Key",
		},
	}

	prometheusPlugin := map[string]interface{}{
		"prometheus": map[string]interface{}{
			"prefer_name": true,
		},
	}

	routes := []Route{}
	routeID := 1

	for svc, addr := range services {
		plugins := map[string]interface{}{}
		for k, v := range rateLimitPlugin {
			plugins[k] = v
		}
		for k, v := range corsPlugin {
			plugins[k] = v
		}
		for k, v := range prometheusPlugin {
			plugins[k] = v
		}

		// Add JWT validation for app routes
		if svc == "app" {
			plugins["jwt-auth"] = map[string]interface{}{}
		}

		routes = append(routes, Route{
			ID:      fmt.Sprintf("%d", routeID),
			Name:    fmt.Sprintf("remitflow-%s", svc),
			URI:     fmt.Sprintf("/gateway/%s/*", svc),
			Methods: []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
			Upstream: map[string]interface{}{
				"type": "roundrobin",
				"nodes": map[string]int{
					addr: 1,
				},
				"timeout": map[string]int{
					"connect": 6000,
					"send":    6000,
					"read":    6000,
				},
				"checks": map[string]interface{}{
					"active": map[string]interface{}{
						"type":                  "http",
						"http_path":             "/health",
						"healthy":               map[string]interface{}{"interval": 2, "successes": 1},
						"unhealthy":             map[string]interface{}{"interval": 1, "http_failures": 2},
					},
				},
			},
			Plugins: plugins,
			Labels: map[string]string{
				"service": svc,
				"version": "v110",
			},
		})
		routeID++
	}

	return routes
}

// ─── APISIX Admin API Client ──────────────────────────────────────────────────
func apisixRequest(method, path string, body interface{}) (int, []byte, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	url := fmt.Sprintf("%s%s", apisixAdminURL, path)
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", apisixAdminKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, respBody, nil
}

func syncRoutes() error {
	routes := buildRoutes()
	log.Printf("[APISIX] Syncing %d routes...", len(routes))

	for _, route := range routes {
		status, body, err := apisixRequest("PUT", fmt.Sprintf("/apisix/admin/routes/%s", route.ID), route)
		if err != nil {
			log.Printf("[APISIX] Route %s sync failed: %v", route.Name, err)
			continue
		}
		if status == 200 || status == 201 {
			log.Printf("[APISIX] Route %s synced OK", route.Name)
		} else {
			log.Printf("[APISIX] Route %s sync returned %d: %s", route.Name, status, string(body))
		}
	}
	return nil
}

func syncUpstreams() error {
	upstreams := []Upstream{
		{
			ID:   "1",
			Name: "remitflow-app-upstream",
			Type: "roundrobin",
			Nodes: map[string]interface{}{"remitflow-app:3000": 1},
		},
	}

	for _, upstream := range upstreams {
		status, _, err := apisixRequest("PUT", fmt.Sprintf("/apisix/admin/upstreams/%s", upstream.ID), upstream)
		if err != nil {
			log.Printf("[APISIX] Upstream %s sync failed: %v", upstream.Name, err)
			continue
		}
		log.Printf("[APISIX] Upstream %s synced: %d", upstream.Name, status)
	}
	return nil
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "apisix-config",
		"version":   "v110.0.0",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func syncHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := syncRoutes(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"synced":    true,
		"routes":    len(buildRoutes()),
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func routesHandler(w http.ResponseWriter, r *http.Request) {
	routes := buildRoutes()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"routes": routes,
		"count":  len(routes),
	})
}


// ── PostgreSQL Persistence Layer ─────────────────────────────────────────────
var db *sql.DB

func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("db connect: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS go_apisix_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_apisix_service_updated ON go_apisix_service_state(updated_at);
		CREATE TABLE IF NOT EXISTS go_apisix_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_apisix_service_events_type ON go_apisix_service_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	slog.Info("PostgreSQL connected", "service", "go-apisix-service", "table", "go_apisix_service_state")
	return nil
}

func dbUpsert(id string, data interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(data)
	if err != nil { return err }
	_, err = db.Exec(`INSERT INTO go_apisix_service_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`, id, jsonData)
	return err
}

func dbGet(id string, dest interface{}) error {
	if db == nil { return fmt.Errorf("no db") }
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM go_apisix_service_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil { return err }
	return json.Unmarshal(jsonData, dest)
}

func dbList(limit int) ([]json.RawMessage, error) {
	if db == nil { return nil, nil }
	rows, err := db.Query("SELECT data FROM go_apisix_service_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil { return nil, err }
		results = append(results, data)
	}
	return results, rows.Err()
}

func dbLogEvent(eventType string, payload interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(payload)
	if err != nil { return err }
	_, err = db.Exec("INSERT INTO go_apisix_service_events (event_type, payload) VALUES ($1, $2)", eventType, jsonData)
	return err
}
// ── End PostgreSQL Layer ─────────────────────────────────────────────────────

func main() {
	if err := initDB(); err != nil {
		slog.Warn("PostgreSQL init failed, using in-memory fallback", "err", err)
	}

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[APISIX] Config service starting on port %s", servicePort)

	// Try to sync routes on startup
	go func() {
		time.Sleep(5 * time.Second) // Wait for APISIX to be ready
		if err := syncRoutes(); err != nil {
			log.Printf("[APISIX] Initial sync failed (will retry on demand): %v", err)
		}
		syncUpstreams()
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/v1/sync", syncHandler)
	mux.HandleFunc("/api/v1/routes", routesHandler)

	addr := fmt.Sprintf("0.0.0.0:%s", servicePort)
	log.Printf("[APISIX] Listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[APISIX] Server failed: %v", err)
	}
}
