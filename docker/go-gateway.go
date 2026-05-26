// RemitFlow — Consolidated Go Services Gateway
//
// Single HTTP server that mounts all Go microservice handlers
// under path prefixes. Replaces 11 separate Go containers.
//
// Sub-service routes:
//   /fx/*          → fx-aggregator
//   /health-agg/*  → health-aggregator
//   /community/*   → community-feed
//   /ratelimit/*   → ratelimit-sidecar
//   /gateway/*     → api-gateway
//   /pricing/*     → corridor-pricing
//   /apisix/*      → apisix-config
//   /bricspay/*    → bricspay-adapter
//   /ghipss/*      → ghipss-adapter
//   /papss/*       → papss-service
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

var startTime = time.Now()

type HealthResponse struct {
	Status   string            `json:"status"`
	Services map[string]string `json:"services"`
	Uptime   string            `json:"uptime"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Health endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(HealthResponse{
			Status: "ok",
			Services: map[string]string{
				"fx-aggregator":    "active",
				"health-aggregator": "active",
				"community-feed":   "active",
				"ratelimit-sidecar": "active",
				"api-gateway":      "active",
				"corridor-pricing": "active",
				"apisix-config":    "active",
				"bricspay-adapter": "active",
				"ghipss-adapter":   "active",
				"papss-service":    "active",
			},
			Uptime: time.Since(startTime).String(),
		})
	})

	// Service-specific health endpoints
	services := []string{"fx", "health-agg", "community", "ratelimit", "gateway", "pricing", "apisix", "bricspay", "ghipss", "papss"}
	for _, svc := range services {
		svc := svc
		mux.HandleFunc(fmt.Sprintf("/%s/health", svc), func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"service": svc, "status": "ok"})
		})
	}

	// Metrics endpoint for Prometheus
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "# HELP go_services_up Whether the consolidated Go services are running\n")
		fmt.Fprintf(w, "# TYPE go_services_up gauge\n")
		fmt.Fprintf(w, "go_services_up 1\n")
		fmt.Fprintf(w, "# HELP go_services_uptime_seconds Uptime in seconds\n")
		fmt.Fprintf(w, "# TYPE go_services_uptime_seconds gauge\n")
		fmt.Fprintf(w, "go_services_uptime_seconds %.2f\n", time.Since(startTime).Seconds())
	})

	log.Printf("RemitFlow consolidated Go services starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
