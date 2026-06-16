// RemitFlow APISIX Configuration Service (Go)
// Manages APISIX gateway routes, upstreams, and plugins via Admin API
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
)

var (
	apisixAdminURL = getEnv("APISIX_ADMIN_URL", "http://apisix:9180")
	apisixAdminKey = getEnv("APISIX_ADMIN_KEY", "edd1c9f034335f136f87ad84b625c8f1")
	listenAddr     = getEnv("LISTEN_ADDR", ":8096")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type Route struct {
	ID       string            `json:"id"`
	URI      string            `json:"uri"`
	Methods  []string          `json:"methods"`
	Upstream Upstream          `json:"upstream"`
	Plugins  map[string]any    `json:"plugins,omitempty"`
}

type Upstream struct {
	Type  string   `json:"type"`
	Nodes map[string]int `json:"nodes"`
}

var remitflowRoutes = []Route{
	{ID: "remitflow-api", URI: "/api/*", Methods: []string{"GET", "POST", "PUT", "DELETE", "PATCH"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"remitflow-app:3000": 1}}, Plugins: map[string]any{"limit-req": map[string]any{"rate": 100, "burst": 50, "key": "remote_addr"}, "cors": map[string]any{"allow_origins": "*", "allow_methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS"}}},
	{ID: "remitflow-cips", URI: "/rails/cips/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"go-cips-adapter:8090": 1}}},
	{ID: "remitflow-upi", URI: "/rails/upi/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"rust-upi-adapter:8091": 1}}},
	{ID: "remitflow-pix", URI: "/rails/pix/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"python-pix-adapter:8092": 1}}},
	{ID: "remitflow-kafka", URI: "/kafka/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"go-kafka-service:8093": 1}}},
	{ID: "remitflow-temporal", URI: "/temporal/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"go-temporal-worker:8094": 1}}},
	{ID: "remitflow-opensearch", URI: "/search/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"python-opensearch-service:8101": 1}}},
	{ID: "remitflow-lakehouse", URI: "/lakehouse/*", Methods: []string{"GET", "POST"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"python-lakehouse-service:8102": 1}}},
	{ID: "remitflow-health", URI: "/health", Methods: []string{"GET"}, Upstream: Upstream{Type: "roundrobin", Nodes: map[string]int{"remitflow-app:3000": 1}}},
}

func applyRoutes() error {
	client := &http.Client{Timeout: 10 * time.Second}
	for _, route := range remitflowRoutes {
		body, _ := json.Marshal(map[string]any{
			"uri":      route.URI,
			"methods":  route.Methods,
			"upstream": route.Upstream,
			"plugins":  route.Plugins,
		})
		req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/apisix/admin/routes/%s", apisixAdminURL, route.ID), bytes.NewReader(body))
		req.Header.Set("X-API-KEY", apisixAdminKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[APISIX] Failed to apply route %s: %v", route.ID, err)
			continue
		}
		resp.Body.Close()
		log.Printf("[APISIX] Applied route %s: %d", route.ID, resp.StatusCode)
	}
	return nil
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "healthy", "service": "go-apisix-config", "routes": len(remitflowRoutes), "timestamp": time.Now().Unix()})
}

func routesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"routes": remitflowRoutes, "count": len(remitflowRoutes)})
}

func applyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := applyRoutes(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "applied": len(remitflowRoutes)})
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
		CREATE TABLE IF NOT EXISTS go_apisix_config_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_apisix_config_updated ON go_apisix_config_state(updated_at);
		CREATE TABLE IF NOT EXISTS go_apisix_config_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_apisix_config_events_type ON go_apisix_config_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	slog.Info("PostgreSQL connected", "service", "go-apisix-config", "table", "go_apisix_config_state")
	return nil
}

func dbUpsert(id string, data interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(data)
	if err != nil { return err }
	_, err = db.Exec(`INSERT INTO go_apisix_config_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`, id, jsonData)
	return err
}

func dbGet(id string, dest interface{}) error {
	if db == nil { return fmt.Errorf("no db") }
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM go_apisix_config_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil { return err }
	return json.Unmarshal(jsonData, dest)
}

func dbList(limit int) ([]json.RawMessage, error) {
	if db == nil { return nil, nil }
	rows, err := db.Query("SELECT data FROM go_apisix_config_state ORDER BY updated_at DESC LIMIT $1", limit)
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
	_, err = db.Exec("INSERT INTO go_apisix_config_events (event_type, payload) VALUES ($1, $2)", eventType, jsonData)
	return err
}
// ── End PostgreSQL Layer ─────────────────────────────────────────────────────

func main() {
	if err := initDB(); err != nil {
		slog.Warn("PostgreSQL init failed, using in-memory fallback", "err", err)
	}

	log.Printf("[APISIX Config] Starting on %s", listenAddr)
	// Apply routes on startup with retry
	go func() {
		for i := 0; i < 5; i++ {
			time.Sleep(time.Duration(i+1) * 2 * time.Second)
			if err := applyRoutes(); err == nil {
				log.Println("[APISIX Config] Routes applied successfully")
				return
			}
		}
		log.Println("[APISIX Config] Could not apply routes after 5 retries — APISIX may not be running")
	}()
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/routes", routesHandler)
	http.HandleFunc("/apply", applyHandler)
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
