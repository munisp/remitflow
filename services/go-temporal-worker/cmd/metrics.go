// RemitFlow — Temporal Worker Prometheus Metrics & Health
package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Metrics ──────────────────────────────────────────────────────────────────
var (
	workflowsStarted = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "workflows_started_total",
		Help:      "Total number of Temporal workflows started.",
	}, []string{"workflow_type"})

	workflowsCompleted = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "workflows_completed_total",
		Help:      "Total number of Temporal workflows completed.",
	}, []string{"workflow_type", "status"})

	workflowDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "workflow_duration_seconds",
		Help:      "Duration of Temporal workflow executions.",
		Buckets:   prometheus.ExponentialBuckets(0.1, 2, 12),
	}, []string{"workflow_type"})

	activitiesExecuted = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "activities_executed_total",
		Help:      "Total number of Temporal activities executed.",
	}, []string{"activity_type", "status"})

	activityDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "activity_duration_seconds",
		Help:      "Duration of Temporal activity executions.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"activity_type"})

	workerPollerCount = prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "worker_pollers_active",
		Help:      "Number of active Temporal worker pollers.",
	})

	taskQueueBacklog = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "task_queue_backlog",
		Help:      "Number of pending tasks in Temporal task queues.",
	}, []string{"task_queue"})

	temporalConnectionErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "remitflow",
		Subsystem: "temporal",
		Name:      "connection_errors_total",
		Help:      "Total number of Temporal connection errors.",
	})
)

// ─── Health State ─────────────────────────────────────────────────────────────
var (
	workerHealthy    int32 = 1
	lastHealthCheck  int64
	temporalConnected int32 = 0
)

func initMetrics() {
	prometheus.MustRegister(
		workflowsStarted,
		workflowsCompleted,
		workflowDuration,
		activitiesExecuted,
		activityDuration,
		workerPollerCount,
		taskQueueBacklog,
		temporalConnectionErrors,
	)
}

// ─── Health Handler ───────────────────────────────────────────────────────────
type HealthResponse struct {
	Status    string            `json:"status"`
	Timestamp string            `json:"timestamp"`
	Checks    map[string]string `json:"checks"`
	Version   string            `json:"version"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	atomic.StoreInt64(&lastHealthCheck, time.Now().UnixMilli())
	checks := map[string]string{
		"worker":   "healthy",
		"temporal": "unknown",
	}
	status := "healthy"

	if atomic.LoadInt32(&workerHealthy) == 0 {
		status = "unhealthy"
		checks["worker"] = "unhealthy"
	}
	if atomic.LoadInt32(&temporalConnected) == 1 {
		checks["temporal"] = "connected"
	} else {
		checks["temporal"] = "disconnected"
		status = "degraded"
	}

	resp := HealthResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Checks:    checks,
		Version:   "v1.0.0",
	}
	w.Header().Set("Content-Type", "application/json")
	if status == "unhealthy" {
		w.WriteHeader(http.StatusServiceUnavailable)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	json.NewEncoder(w).Encode(resp)
}

func readinessHandler(w http.ResponseWriter, r *http.Request) {
	if atomic.LoadInt32(&temporalConnected) == 0 {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "temporal_disconnected"})
		return
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

// ─── Metrics Server ───────────────────────────────────────────────────────────
func startMetricsServer(addr string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/ready", readinessHandler)
	mux.HandleFunc("/readyz", readinessHandler)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic("metrics server failed: " + err.Error())
	}
}
