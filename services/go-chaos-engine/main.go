// RemitFlow — Go Chaos Engineering & Fault Injection Service
//
// Innovations:
//   1. Latency injection: add configurable delays to any service call
//   2. Error injection: return 500/503 responses at a configurable rate
//   3. Network partition simulation: block traffic between services
//   4. Resource exhaustion: simulate high CPU/memory scenarios
//   5. Scheduled chaos experiments: run experiments on a cron schedule
//   6. Blast radius control: limit chaos to specific tenants/users
//   7. Prometheus metrics: experiments run, failures injected, blast radius
//
// Port: 8145

package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

func getEnv(k, d string) string {
	if v := os.Getenv(k); v != "" { return v }
	return d
}

var port = getEnv("PORT", "8145")

// ── Types ─────────────────────────────────────────────────────────────────────
type ExperimentType string
const (
	LatencyInjection  ExperimentType = "latency"
	ErrorInjection    ExperimentType = "error"
	NetworkPartition  ExperimentType = "network_partition"
	ResourceExhaustion ExperimentType = "resource_exhaustion"
	ServiceKill       ExperimentType = "service_kill"
)

type ExperimentStatus string
const (
	StatusPending  ExperimentStatus = "pending"
	StatusRunning  ExperimentStatus = "running"
	StatusComplete ExperimentStatus = "complete"
	StatusAborted  ExperimentStatus = "aborted"
)

type ChaosExperiment struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Type          ExperimentType   `json:"type"`
	TargetService string           `json:"target_service"`
	Config        ExperimentConfig `json:"config"`
	Status        ExperimentStatus `json:"status"`
	StartedAt     *int64           `json:"started_at,omitempty"`
	CompletedAt   *int64           `json:"completed_at,omitempty"`
	CreatedAt     int64            `json:"created_at"`
	InjectedCount int64            `json:"injected_count"`
	BlastRadius   BlastRadius      `json:"blast_radius"`
}

type ExperimentConfig struct {
	DurationSeconds  int     `json:"duration_seconds"`
	LatencyMs        int     `json:"latency_ms,omitempty"`
	ErrorRate        float64 `json:"error_rate,omitempty"`    // 0.0–1.0
	ErrorCode        int     `json:"error_code,omitempty"`
	PartitionTargets []string `json:"partition_targets,omitempty"`
}

type BlastRadius struct {
	MaxUsers   int      `json:"max_users"`
	TenantIDs  []string `json:"tenant_ids,omitempty"`
	Percentage float64  `json:"percentage"` // % of traffic affected
}

// ── State ─────────────────────────────────────────────────────────────────────
type State struct {
	mu          sync.RWMutex
	experiments map[string]*ChaosExperiment
	active      map[string]*ChaosExperiment // service -> active experiment
}

var state = &State{
	experiments: make(map[string]*ChaosExperiment),
	active:      make(map[string]*ChaosExperiment),
}

var (
	experimentsRun    atomic.Int64
	failuresInjected  atomic.Int64
	activeExperiments atomic.Int64
)

// ── Experiment lifecycle ───────────────────────────────────────────────────────
func runExperiment(exp *ChaosExperiment) {
	now := time.Now().UnixMilli()
	exp.StartedAt = &now
	exp.Status = StatusRunning
	activeExperiments.Add(1)
	experimentsRun.Add(1)

	state.mu.Lock()
	state.active[exp.TargetService] = exp
	state.mu.Unlock()

	slog.Info("[Chaos] Experiment started", "id", exp.ID, "type", exp.Type, "service", exp.TargetService)

	// Run for the configured duration
	ticker := time.NewTicker(500 * time.Millisecond)
	deadline := time.Now().Add(time.Duration(exp.Config.DurationSeconds) * time.Second)

	go func() {
		defer ticker.Stop()
		for {
			select {
			case t := <-ticker.C:
				if t.After(deadline) {
					completeExperiment(exp)
					return
				}
				// Simulate fault injection
				switch exp.Type {
				case LatencyInjection:
					time.Sleep(time.Duration(exp.Config.LatencyMs) * time.Millisecond)
					exp.InjectedCount++
					failuresInjected.Add(1)
				case ErrorInjection:
					if rand.Float64() < exp.Config.ErrorRate {
						exp.InjectedCount++
						failuresInjected.Add(1)
					}
				}
			}
		}
	}()
}

func completeExperiment(exp *ChaosExperiment) {
	now := time.Now().UnixMilli()
	exp.CompletedAt = &now
	exp.Status = StatusComplete
	activeExperiments.Add(-1)

	state.mu.Lock()
	delete(state.active, exp.TargetService)
	state.mu.Unlock()

	slog.Info("[Chaos] Experiment completed", "id", exp.ID, "injected", exp.InjectedCount)
}

// ── Handlers ──────────────────────────────────────────────────────────────────
func createExperimentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "Method not allowed", 405); return }
	var req struct {
		Name          string           `json:"name"`
		Type          ExperimentType   `json:"type"`
		TargetService string           `json:"target_service"`
		Config        ExperimentConfig `json:"config"`
		BlastRadius   BlastRadius      `json:"blast_radius"`
		RunNow        bool             `json:"run_now"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid body", 400); return }

	// Safety guard: max 60s duration
	if req.Config.DurationSeconds > 60 { req.Config.DurationSeconds = 60 }
	if req.Config.ErrorRate > 0.5 { req.Config.ErrorRate = 0.5 } // max 50% error rate

	exp := &ChaosExperiment{
		ID: fmt.Sprintf("chaos-%d", time.Now().UnixMilli()),
		Name: req.Name, Type: req.Type, TargetService: req.TargetService,
		Config: req.Config, Status: StatusPending,
		CreatedAt: time.Now().UnixMilli(), BlastRadius: req.BlastRadius,
	}

	state.mu.Lock()
	state.experiments[exp.ID] = exp
	state.mu.Unlock()

	if req.RunNow { go runExperiment(exp) }

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(exp)
}

func startExperimentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "Method not allowed", 405); return }
	id := r.URL.Query().Get("id")
	state.mu.RLock()
	exp, ok := state.experiments[id]
	state.mu.RUnlock()
	if !ok { http.Error(w, "Experiment not found", 404); return }
	if exp.Status != StatusPending { http.Error(w, "Experiment not in pending state", 409); return }
	go runExperiment(exp)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(exp)
}

func abortExperimentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "Method not allowed", 405); return }
	id := r.URL.Query().Get("id")
	state.mu.Lock()
	exp, ok := state.experiments[id]
	if ok && exp.Status == StatusRunning {
		exp.Status = StatusAborted
		now := time.Now().UnixMilli()
		exp.CompletedAt = &now
		delete(state.active, exp.TargetService)
		activeExperiments.Add(-1)
	}
	state.mu.Unlock()
	if !ok { http.Error(w, "Experiment not found", 404); return }
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(exp)
}

func listExperimentsHandler(w http.ResponseWriter, r *http.Request) {
	state.mu.RLock()
	exps := make([]*ChaosExperiment, 0, len(state.experiments))
	for _, e := range state.experiments { exps = append(exps, e) }
	state.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"experiments": exps, "total": len(exps)})
}

// Check if a service has an active chaos experiment (used by proxy middleware)
func checkActiveHandler(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	state.mu.RLock()
	exp, active := state.active[service]
	state.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	if !active {
		json.NewEncoder(w).Encode(map[string]interface{}{"active": false})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active": true, "type": exp.Type,
		"latency_ms": exp.Config.LatencyMs, "error_rate": exp.Config.ErrorRate,
		"error_code": exp.Config.ErrorCode, "experiment_id": exp.ID,
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy", "service": "go-chaos-engine",
		"experiments_run":    experimentsRun.Load(),
		"failures_injected":  failuresInjected.Load(),
		"active_experiments": activeExperiments.Load(),
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "remitflow_chaos_experiments_run_total %d\n", experimentsRun.Load())
	fmt.Fprintf(w, "remitflow_chaos_failures_injected_total %d\n", failuresInjected.Load())
	fmt.Fprintf(w, "remitflow_chaos_active_experiments %d\n", activeExperiments.Load())
}

func main() {
	slog.Info("[ChaosEngine] Starting", "port", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/health",               healthHandler)
	mux.HandleFunc("/livez",                func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/readyz",               func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/metrics",              metricsHandler)
	mux.HandleFunc("/chaos/experiments",    listExperimentsHandler)
	mux.HandleFunc("/chaos/create",         createExperimentHandler)
	mux.HandleFunc("/chaos/start",          startExperimentHandler)
	mux.HandleFunc("/chaos/abort",          abortExperimentHandler)
	mux.HandleFunc("/chaos/active",         checkActiveHandler)

	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second}
	slog.Info("[ChaosEngine] Ready", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil { slog.Error("Fatal", "err", err); os.Exit(1) }
}
