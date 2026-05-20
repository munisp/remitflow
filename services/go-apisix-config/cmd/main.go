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

func main() {
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
