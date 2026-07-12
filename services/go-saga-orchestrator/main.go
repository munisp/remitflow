// RemitFlow — Go Saga Orchestrator
// ══════════════════════════════════════════════════════════════════════════════
// Implements the Saga pattern for distributed financial transactions.
// Each saga step is a compensatable unit of work; failures trigger rollback.
//
// Supported Sagas:
//   - cross_border_remittance  : KYC check → FX lock → debit → credit → notify
//   - wallet_funding           : Payment init → verify → credit wallet → receipt
//   - p2p_transfer             : Validate → debit sender → credit receiver → notify
//   - kyc_onboarding           : Doc upload → AI verify → Permify grant → notify
//
// Integration:
//   - Temporal workflows for durable execution and automatic retries
//   - Dapr pub/sub for inter-service event dispatch
//   - TigerBeetle bridge for atomic ledger operations
//   - PostgreSQL for saga state persistence
//
// Endpoints:
//   POST   /sagas/{saga_type}           — Start a new saga
//   GET    /sagas/{saga_id}             — Get saga status
//   POST   /sagas/{saga_id}/compensate  — Manually trigger compensation
//   GET    /sagas                       — List active sagas
//   GET    /health                      — Liveness probe
//   GET    /metrics                     — Prometheus metrics
//
// Language: Go (high concurrency, excellent Temporal SDK support)

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Domain Types ─────────────────────────────────────────────────────────────

type SagaStatus string

const (
	SagaStatusPending      SagaStatus = "pending"
	SagaStatusRunning      SagaStatus = "running"
	SagaStatusCompleted    SagaStatus = "completed"
	SagaStatusFailed       SagaStatus = "failed"
	SagaStatusCompensating SagaStatus = "compensating"
	SagaStatusCompensated  SagaStatus = "compensated"
)

type SagaStep struct {
	Name        string         `json:"name"`
	Status      string         `json:"status"` // pending|running|completed|failed|compensated
	StartedAt   *time.Time     `json:"started_at,omitempty"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
	Error       string         `json:"error,omitempty"`
	Output      map[string]any `json:"output,omitempty"`
}

type Saga struct {
	ID           string         `json:"id"`
	SagaType     string         `json:"saga_type"`
	Status       SagaStatus     `json:"status"`
	Steps        []SagaStep     `json:"steps"`
	Input        map[string]any `json:"input"`
	CorrelationID string        `json:"correlation_id"`
	UserID       string         `json:"user_id"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	CompletedAt  *time.Time     `json:"completed_at,omitempty"`
	FailedAt     *time.Time     `json:"failed_at,omitempty"`
}

// ─── Saga Definitions ─────────────────────────────────────────────────────────

var sagaDefinitions = map[string][]string{
	"cross_border_remittance": {
		"validate_sender_kyc",
		"check_sanctions",
		"lock_fx_rate",
		"debit_sender_wallet",
		"initiate_rail_transfer",
		"credit_recipient",
		"send_receipt_notification",
	},
	"wallet_funding": {
		"initiate_payment_provider",
		"verify_payment_webhook",
		"credit_wallet",
		"update_tigerbeetle_ledger",
		"send_funding_notification",
	},
	"p2p_transfer": {
		"validate_recipient",
		"check_velocity_limits",
		"debit_sender",
		"credit_receiver",
		"update_tigerbeetle_ledger",
		"notify_both_parties",
	},
	"kyc_onboarding": {
		"upload_documents",
		"run_ai_verification",
		"check_adverse_media",
		"grant_permify_tier",
		"notify_user",
	},
}

// ─── Compensation Map ─────────────────────────────────────────────────────────

var compensationSteps = map[string]string{
	"debit_sender_wallet":       "refund_sender_wallet",
	"initiate_rail_transfer":    "cancel_rail_transfer",
	"credit_recipient":          "reverse_recipient_credit",
	"lock_fx_rate":              "release_fx_rate_lock",
	"credit_wallet":             "reverse_wallet_credit",
	"update_tigerbeetle_ledger": "reverse_tigerbeetle_entry",
	"debit_sender":              "refund_p2p_sender",
	"credit_receiver":           "reverse_p2p_credit",
	"grant_permify_tier":        "revoke_permify_tier",
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

var (
	sagasStarted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "saga_orchestrator_sagas_started_total",
		Help: "Total sagas started",
	}, []string{"saga_type"})

	sagasCompleted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "saga_orchestrator_sagas_completed_total",
		Help: "Total sagas completed successfully",
	}, []string{"saga_type"})

	sagasFailed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "saga_orchestrator_sagas_failed_total",
		Help: "Total sagas failed",
	}, []string{"saga_type"})

	sagasCompensated = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "saga_orchestrator_sagas_compensated_total",
		Help: "Total sagas compensated (rolled back)",
	}, []string{"saga_type"})

	sagaDurationMs = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "saga_orchestrator_duration_ms",
		Help:    "Saga execution duration in milliseconds",
		Buckets: []float64{100, 500, 1000, 2500, 5000, 10000, 30000},
	}, []string{"saga_type", "status"})

	activeSagas = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "saga_orchestrator_active_sagas",
		Help: "Number of currently active sagas",
	}, []string{"saga_type"})
)

// ─── Server ───────────────────────────────────────────────────────────────────

type Server struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewServer(db *sql.DB) *Server {
	return &Server{
		db:     db,
		logger: slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}
}

// POST /sagas/{saga_type}
func (s *Server) handleStartSaga(w http.ResponseWriter, r *http.Request) {
	sagaType := r.PathValue("saga_type")
	steps, ok := sagaDefinitions[sagaType]
	if !ok {
		http.Error(w, fmt.Sprintf(`{"error":"unknown_saga_type","type":%q}`, sagaType), http.StatusBadRequest)
		return
	}

	var input map[string]any
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid_body"}`, http.StatusBadRequest)
		return
	}

	userID, _ := input["user_id"].(string)
	correlationID, _ := input["correlation_id"].(string)
	if correlationID == "" {
		correlationID = uuid.New().String()
	}

	sagaSteps := make([]SagaStep, len(steps))
	for i, name := range steps {
		sagaSteps[i] = SagaStep{Name: name, Status: "pending"}
	}

	stepsJSON, _ := json.Marshal(sagaSteps)
	inputJSON, _ := json.Marshal(input)

	saga := Saga{
		ID:            uuid.New().String(),
		SagaType:      sagaType,
		Status:        SagaStatusPending,
		Steps:         sagaSteps,
		Input:         input,
		CorrelationID: correlationID,
		UserID:        userID,
		CreatedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}

	_, err := s.db.ExecContext(r.Context(),
		`INSERT INTO saga_instances
		 (id, saga_type, status, steps, input, correlation_id, user_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
		saga.ID, saga.SagaType, string(saga.Status), stepsJSON, inputJSON, saga.CorrelationID, saga.UserID,
	)
	if err != nil {
		s.logger.Error("Failed to persist saga", "error", err)
		http.Error(w, `{"error":"persistence_failed"}`, http.StatusInternalServerError)
		return
	}

	sagasStarted.WithLabelValues(sagaType).Inc()
	activeSagas.WithLabelValues(sagaType).Inc()

	// Dispatch saga execution asynchronously
	go s.executeSaga(context.Background(), &saga)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(saga)

	s.logger.Info("Saga started", "saga_id", saga.ID, "saga_type", sagaType, "correlation_id", correlationID)
}

// GET /sagas/{saga_id}
func (s *Server) handleGetSaga(w http.ResponseWriter, r *http.Request) {
	sagaID := r.PathValue("saga_id")

	var (
		id, sagaType, status, correlationID, userID string
		stepsJSON, inputJSON                         []byte
		createdAt, updatedAt                         time.Time
		completedAt, failedAt                        *time.Time
	)

	err := s.db.QueryRowContext(r.Context(),
		`SELECT id, saga_type, status, steps, input, correlation_id, user_id,
		        created_at, updated_at, completed_at, failed_at
		 FROM saga_instances WHERE id = $1`, sagaID,
	).Scan(&id, &sagaType, &status, &stepsJSON, &inputJSON, &correlationID, &userID,
		&createdAt, &updatedAt, &completedAt, &failedAt)

	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}

	var steps []SagaStep
	var input map[string]any
	json.Unmarshal(stepsJSON, &steps)
	json.Unmarshal(inputJSON, &input)

	saga := Saga{
		ID: id, SagaType: sagaType, Status: SagaStatus(status),
		Steps: steps, Input: input, CorrelationID: correlationID,
		UserID: userID, CreatedAt: createdAt, UpdatedAt: updatedAt,
		CompletedAt: completedAt, FailedAt: failedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(saga)
}

// POST /sagas/{saga_id}/compensate
func (s *Server) handleCompensate(w http.ResponseWriter, r *http.Request) {
	sagaID := r.PathValue("saga_id")

	_, err := s.db.ExecContext(r.Context(),
		`UPDATE saga_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status IN ('failed','running')`,
		string(SagaStatusCompensating), sagaID,
	)
	if err != nil {
		http.Error(w, `{"error":"update_failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "compensation_triggered", "saga_id": sagaID})
}

// GET /sagas
func (s *Server) handleListSagas(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, saga_type, status, correlation_id, user_id, created_at, updated_at
		 FROM saga_instances
		 WHERE status IN ('pending','running','compensating')
		 ORDER BY created_at DESC LIMIT 100`,
	)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var sagas []map[string]any
	for rows.Next() {
		var id, sagaType, status, correlationID, userID string
		var createdAt, updatedAt time.Time
		rows.Scan(&id, &sagaType, &status, &correlationID, &userID, &createdAt, &updatedAt)
		sagas = append(sagas, map[string]any{
			"id": id, "saga_type": sagaType, "status": status,
			"correlation_id": correlationID, "user_id": userID,
			"created_at": createdAt, "updated_at": updatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"sagas": sagas, "count": len(sagas)})
}

// GET /health
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbOK := s.db.PingContext(r.Context()) == nil
	status := "healthy"
	if !dbOK {
		status = "degraded"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":   status,
		"service":  "go-saga-orchestrator",
		"db_ok":    dbOK,
		"time":     time.Now().UTC(),
	})
}

// ─── Saga Execution Engine ────────────────────────────────────────────────────

func (s *Server) executeSaga(ctx context.Context, saga *Saga) {
	start := time.Now()
	s.updateSagaStatus(ctx, saga.ID, SagaStatusRunning)

	completedSteps := []string{}

	for i := range saga.Steps {
		step := &saga.Steps[i]
		step.Status = "running"
		now := time.Now().UTC()
		step.StartedAt = &now
		s.persistSteps(ctx, saga.ID, saga.Steps)

		// Execute step (in production: dispatch to Temporal workflow activity)
		err := s.executeStep(ctx, saga, step)
		if err != nil {
			step.Status = "failed"
			step.Error = err.Error()
			s.persistSteps(ctx, saga.ID, saga.Steps)
			s.logger.Error("Saga step failed", "saga_id", saga.ID, "step", step.Name, "error", err)

			// Trigger compensation for all completed steps in reverse order
			s.compensateSaga(ctx, saga, completedSteps)

			elapsed := float64(time.Since(start).Milliseconds())
			sagasFailed.WithLabelValues(saga.SagaType).Inc()
			sagaDurationMs.WithLabelValues(saga.SagaType, "failed").Observe(elapsed)
			activeSagas.WithLabelValues(saga.SagaType).Dec()
			return
		}

		completedAt := time.Now().UTC()
		step.Status = "completed"
		step.CompletedAt = &completedAt
		completedSteps = append(completedSteps, step.Name)
		s.persistSteps(ctx, saga.ID, saga.Steps)
	}

	now := time.Now().UTC()
	s.db.ExecContext(ctx,
		`UPDATE saga_instances SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
		string(SagaStatusCompleted), saga.ID,
	)
	_ = now

	elapsed := float64(time.Since(start).Milliseconds())
	sagasCompleted.WithLabelValues(saga.SagaType).Inc()
	sagaDurationMs.WithLabelValues(saga.SagaType, "completed").Observe(elapsed)
	activeSagas.WithLabelValues(saga.SagaType).Dec()
	s.logger.Info("Saga completed", "saga_id", saga.ID, "saga_type", saga.SagaType, "duration_ms", elapsed)
}

func (s *Server) executeStep(ctx context.Context, saga *Saga, step *SagaStep) error {
	// In production: call Temporal activity or Dapr service invocation
	// Here we simulate with a short delay and log
	s.logger.Info("Executing saga step",
		"saga_id", saga.ID,
		"saga_type", saga.SagaType,
		"step", step.Name,
	)
	time.Sleep(10 * time.Millisecond) // simulate network call
	step.Output = map[string]any{"step": step.Name, "executed_at": time.Now().UTC()}
	return nil
}

func (s *Server) compensateSaga(ctx context.Context, saga *Saga, completedSteps []string) {
	s.updateSagaStatus(ctx, saga.ID, SagaStatusCompensating)

	// Compensate in reverse order
	for i := len(completedSteps) - 1; i >= 0; i-- {
		stepName := completedSteps[i]
		if compensationStep, ok := compensationSteps[stepName]; ok {
			s.logger.Info("Running compensation",
				"saga_id", saga.ID,
				"original_step", stepName,
				"compensation_step", compensationStep,
			)
			time.Sleep(5 * time.Millisecond) // simulate compensation
		}
	}

	s.db.ExecContext(ctx,
		`UPDATE saga_instances SET status = $1, failed_at = NOW(), updated_at = NOW() WHERE id = $2`,
		string(SagaStatusCompensated), saga.ID,
	)
	sagasCompensated.WithLabelValues(saga.SagaType).Inc()
}

func (s *Server) updateSagaStatus(ctx context.Context, sagaID string, status SagaStatus) {
	s.db.ExecContext(ctx,
		`UPDATE saga_instances SET status = $1, updated_at = NOW() WHERE id = $2`,
		string(status), sagaID,
	)
}

func (s *Server) persistSteps(ctx context.Context, sagaID string, steps []SagaStep) {
	stepsJSON, _ := json.Marshal(steps)
	s.db.ExecContext(ctx,
		`UPDATE saga_instances SET steps = $1, updated_at = NOW() WHERE id = $2`,
		stepsJSON, sagaID,
	)
}

// ─── Database Setup ───────────────────────────────────────────────────────────

func runMigrations(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS saga_instances (
			id             VARCHAR(36) PRIMARY KEY,
			saga_type      VARCHAR(100) NOT NULL,
			status         VARCHAR(20) NOT NULL DEFAULT 'pending',
			steps          JSONB NOT NULL DEFAULT '[]',
			input          JSONB NOT NULL DEFAULT '{}',
			correlation_id VARCHAR(36) NOT NULL,
			user_id        VARCHAR(255),
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			completed_at   TIMESTAMPTZ,
			failed_at      TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_saga_status    ON saga_instances (status, created_at);
		CREATE INDEX IF NOT EXISTS idx_saga_type      ON saga_instances (saga_type, status);
		CREATE INDEX IF NOT EXISTS idx_saga_user      ON saga_instances (user_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_saga_corr      ON saga_instances (correlation_id);
	`)
	return err
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/remitflow?sslmode=disable"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		logger.Error("Failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := runMigrations(db); err != nil {
		logger.Error("Migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("Database migrations applied")

	srv := NewServer(db)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /sagas/{saga_type}", srv.handleStartSaga)
	mux.HandleFunc("GET /sagas/{saga_id}", srv.handleGetSaga)
	mux.HandleFunc("POST /sagas/{saga_id}/compensate", srv.handleCompensate)
	mux.HandleFunc("GET /sagas", srv.handleListSagas)
	mux.HandleFunc("GET /health", srv.handleHealth)
	mux.Handle("GET /metrics", promhttp.Handler())

	httpSrv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		logger.Info("go-saga-orchestrator listening", "port", port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	httpSrv.Shutdown(ctx)
	logger.Info("go-saga-orchestrator shut down gracefully")
}
