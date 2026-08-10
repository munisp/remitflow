// RemitFlow — Dapr Service Proxy (Go)
//
// Minimal real service that fronts the Dapr sidecar HTTP API:
//
//	GET  /healthz                      — service + sidecar health (503 when sidecar down)
//	POST /publish/{pubsub}/{topic}     — proxy to /v1.0/publish/{pubsub}/{topic}
//	ANY  /invoke/{appId}/{method...}   — proxy to /v1.0/invoke/{appId}/method/{method...}
//	GET  /state/{store}/{key}          — proxy to /v1.0/state/{store}/{key}
//
// Fails loudly: any sidecar error is surfaced to the caller with the sidecar's
// status code and body — nothing is fabricated locally.
//
// CLI: `-health` performs a one-shot sidecar health check and exits 0/1
// (used by the Dockerfile HEALTHCHECK).
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	serviceName = "go-dapr-service"
	version     = "v1.0.0"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func sidecarBaseURL() string {
	host := getEnv("DAPR_HOST", "localhost")
	port := getEnv("DAPR_HTTP_PORT", "3500")
	return fmt.Sprintf("http://%s:%s", host, port)
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// checkSidecar pings the Dapr sidecar health endpoint.
func checkSidecar() error {
	res, err := httpClient.Get(sidecarBaseURL() + "/v1.0/healthz")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("sidecar healthz returned %d", res.StatusCode)
	}
	return nil
}

// proxyToSidecar forwards the request to the Dapr sidecar and streams the
// response back verbatim (status code, content type, body).
func proxyToSidecar(w http.ResponseWriter, r *http.Request, sidecarPath string) {
	url := sidecarBaseURL() + sidecarPath

	req, err := http.NewRequestWithContext(r.Context(), r.Method, url, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"proxy request build failed: %s"}`, err), http.StatusInternalServerError)
		return
	}
	req.Header = r.Header.Clone()

	res, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[%s] sidecar unreachable for %s %s: %v", serviceName, r.Method, sidecarPath, err)
		http.Error(w, fmt.Sprintf(`{"error":"dapr sidecar unreachable: %s"}`, err), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	if ct := res.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(res.StatusCode)
	if _, err := io.Copy(w, res.Body); err != nil {
		log.Printf("[%s] error streaming sidecar response: %v", serviceName, err)
	}
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := checkSidecar(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"service":%q,"version":%q,"status":"degraded","dapr_sidecar":"unreachable","error":%q}`,
			serviceName, version, err.Error())
		return
	}
	fmt.Fprintf(w, `{"service":%q,"version":%q,"status":"healthy","dapr_sidecar":"connected"}`,
		serviceName, version)
}

func mux() *http.ServeMux {
	m := http.NewServeMux()

	m.HandleFunc("/healthz", healthHandler)

	// Publish proxy: /publish/{pubsub}/{topic...}
	m.HandleFunc("/publish/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, "/publish/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.Error(w, `{"error":"path must be /publish/{pubsubName}/{topic}"}`, http.StatusBadRequest)
			return
		}
		proxyToSidecar(w, r, fmt.Sprintf("/v1.0/publish/%s/%s", parts[0], parts[1]))
	})

	// Service invocation proxy: /invoke/{appId}/{method...}
	m.HandleFunc("/invoke/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/invoke/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.Error(w, `{"error":"path must be /invoke/{appId}/{method}"}`, http.StatusBadRequest)
			return
		}
		proxyToSidecar(w, r, fmt.Sprintf("/v1.0/invoke/%s/method/%s", parts[0], parts[1]))
	})

	// State proxy: /state/{store}/{key...}
	m.HandleFunc("/state/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/state/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.Error(w, `{"error":"path must be /state/{storeName}/{key}"}`, http.StatusBadRequest)
			return
		}
		proxyToSidecar(w, r, fmt.Sprintf("/v1.0/state/%s/%s", parts[0], parts[1]))
	})

	return m
}

func main() {
	healthCheck := flag.Bool("health", false, "perform a one-shot Dapr sidecar health check and exit")
	flag.Parse()

	if *healthCheck {
		if err := checkSidecar(); err != nil {
			fmt.Fprintf(os.Stderr, "[%s] sidecar unhealthy: %v\n", serviceName, err)
			os.Exit(1)
		}
		fmt.Printf("[%s] sidecar healthy\n", serviceName)
		os.Exit(0)
	}

	port := getEnv("PORT", "8097")
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("[%s] %s listening on :%s (dapr sidecar: %s)", serviceName, version, port, sidecarBaseURL())
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[%s] server failed: %v", serviceName, err)
	}
}
