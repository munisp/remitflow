// RemitFlow — Permify Service Prometheus Metrics
package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	permifyChecks = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "permify",
		Name:      "permission_checks_total",
		Help:      "Total number of Permify permission checks.",
	}, []string{"entity", "permission", "result"})

	permifyCheckDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "remitflow",
		Subsystem: "permify",
		Name:      "check_duration_seconds",
		Help:      "Duration of Permify permission check calls.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"entity"})

	permifyWriteOps = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "permify",
		Name:      "write_operations_total",
		Help:      "Total number of Permify relationship write operations.",
	}, []string{"operation", "status"})

	permifyErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "permify",
		Name:      "errors_total",
		Help:      "Total number of Permify errors.",
	}, []string{"error_type"})

	permifyConnectionStatus = prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "remitflow",
		Subsystem: "permify",
		Name:      "connection_status",
		Help:      "Permify gRPC connection status (1=connected, 0=disconnected).",
	})
)

func initPermifyMetrics() {
	prometheus.MustRegister(
		permifyChecks,
		permifyCheckDuration,
		permifyWriteOps,
		permifyErrors,
		permifyConnectionStatus,
	)
}

func permifyMetricsHealthHandler(w http.ResponseWriter, r *http.Request) {
	resp := map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"service":   "go-permify-service",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

func startPermifyMetricsServer(addr string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", permifyMetricsHealthHandler)
	mux.HandleFunc("/readyz", permifyMetricsHealthHandler)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic("permify metrics server failed: " + err.Error())
	}
}
