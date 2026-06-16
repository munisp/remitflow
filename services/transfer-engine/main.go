package main

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

const (
	defaultGRPCPort    = "50051"
	defaultMetricsPort = "9090"
	version            = "1.0.0"
)

var (
	startTime = time.Now()

	// Prometheus metrics
	transfersProcessed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "remitflow_transfers_processed_total",
			Help: "Total number of transfer state transitions processed.",
		},
		[]string{"from_state", "to_state", "success"},
	)
	fraudScoresIssued = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "remitflow_fraud_scores_total",
			Help: "Total number of fraud scores issued.",
		},
		[]string{"risk_level"},
	)
	stateTransitionDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "remitflow_state_transition_duration_seconds",
			Help:    "Duration of state transition operations.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"target_state"},
	)
)

func init() {
	prometheus.MustRegister(transfersProcessed, fraudScoresIssued, stateTransitionDuration)
}

// ─── gRPC Server Implementation ───────────────────────────────────────────────

// TransferEngineServer implements the TransferEngine gRPC service.
type TransferEngineServer struct {
	sm     *StateMachineService
	fraud  *FraudScorerService
	logger *zap.Logger
}

// AdvanceState handles a single state transition request.
func (s *TransferEngineServer) AdvanceState(ctx context.Context, req *AdvanceStateProto) (*AdvanceStateResponseProto, error) {
	timer := prometheus.NewTimer(stateTransitionDuration.WithLabelValues(req.TargetState))
	defer timer.ObserveDuration()

	result, err := s.sm.AdvanceState(
		ctx,
		req.TransferId,
		req.UserId,
		TransferState(req.TargetState),
		req.FailureReason,
		req.PartnerRef,
		req.ManualReview,
	)
	if err != nil {
		return nil, err
	}

	successLabel := "true"
	if !result.Success {
		successLabel = "false"
	}
	transfersProcessed.WithLabelValues(
		string(result.PreviousState),
		string(result.NewState),
		successLabel,
	).Inc()

	return &AdvanceStateResponseProto{
		Success:        result.Success,
		PreviousState:  string(result.PreviousState),
		NewState:       string(result.NewState),
		Message:        result.Message,
		RequiresReview: result.RequiresReview,
		EstimatedMs:    result.EstimatedMs,
	}, nil
}

// RunPipeline starts the full automated transfer pipeline.
func (s *TransferEngineServer) RunPipeline(ctx context.Context, req *RunPipelineProto) (*RunPipelineResponseProto, error) {
	s.sm.RunPipeline(ctx, req.TransferId, req.UserId, req.FraudScore, req.AmlFlags, req.KycTier, req.AmountUsd)
	return &RunPipelineResponseProto{
		Started:    true,
		PipelineId: fmt.Sprintf("pipeline-%s-%d", req.TransferId, time.Now().UnixMilli()),
		Message:    "Pipeline started asynchronously",
	}, nil
}

// GetTransferStatus returns the current state and history of a transfer.
func (s *TransferEngineServer) GetTransferStatus(ctx context.Context, req *GetTransferStatusProto) (*GetTransferStatusResponseProto, error) {
	// Query DB for current status
	row := s.sm.db.QueryRowContext(ctx,
		"SELECT id, status, updated_at FROM transactions WHERE id = ? LIMIT 1",
		req.TransferId,
	)
	var id, status string
	var updatedAt int64
	if err := row.Scan(&id, &status, &updatedAt); err != nil {
		return nil, fmt.Errorf("transfer not found: %w", err)
	}

	label := StateLabels[TransferState(status)]
	return &GetTransferStatusResponseProto{
		TransferId:   id,
		CurrentState: status,
		StateLabel:   label,
		UpdatedAt:    updatedAt,
	}, nil
}

// HealthCheck returns the service health status.
func (s *TransferEngineServer) HealthCheck(_ context.Context, _ *HealthCheckProto) (*HealthCheckResponseProto, error) {
	return &HealthCheckResponseProto{
		Status:  "ok",
		Version: version,
		UptimeS: int64(time.Since(startTime).Seconds()),
	}, nil
}

// ScoreTransaction evaluates a transaction for fraud risk.
func (s *TransferEngineServer) ScoreTransaction(_ context.Context, req *ScoreRequestProto) (*ScoreResponseProto, error) {
	result := s.fraud.Score(&ScoreTransactionRequest{
		TransferID:       req.TransferId,
		UserID:           req.UserId,
		AmountUSD:        req.AmountUsd,
		SourceCountry:    req.SourceCountry,
		DestCountry:      req.DestCountry,
		PaymentMethod:    req.PaymentMethod,
		HourOfDay:        int(req.HourOfDay),
		IsNewDevice:      req.IsNewDevice,
		IsNewBeneficiary: req.IsNewBeneficiary,
		TransfersToday:   int(req.TransfersToday),
	})

	fraudScoresIssued.WithLabelValues(result.RiskLevel).Inc()

	return &ScoreResponseProto{
		Score:        result.Score,
		RiskLevel:    result.RiskLevel,
		Flags:        result.Flags,
		Block:        result.Block,
		ManualReview: result.ManualReview,
		Reason:       result.Reason,
	}, nil
}

// GetRules returns all configured fraud rules.
func (s *TransferEngineServer) GetRules(_ context.Context, _ *GetRulesProto) (*GetRulesResponseProto, error) {
	rules := s.fraud.Rules()
	protoRules := make([]*FraudRuleProto, len(rules))
	for i, r := range rules {
		protoRules[i] = &FraudRuleProto{
			Id: r.ID, Name: r.Name, Description: r.Description,
			Weight: r.Weight, Enabled: r.Enabled,
		}
	}
	return &GetRulesResponseProto{Rules: protoRules}, nil
}

// ─── Proto-equivalent types for gRPC wire format ─────────────────────────────
// Compatible with proto/transfer.proto definitions.

type AdvanceStateProto struct {
	TransferId    string
	UserId        int64
	TargetState   string
	FailureReason string
	PartnerRef    string
	ManualReview  bool
}
type AdvanceStateResponseProto struct {
	Success        bool
	PreviousState  string
	NewState       string
	Message        string
	RequiresReview bool
	EstimatedMs    int64
}
type RunPipelineProto struct {
	TransferId string
	UserId     int64
	FraudScore float64
	AmlFlags   []string
	KycTier    int32
	AmountUsd  float64
}
type RunPipelineResponseProto struct {
	Started    bool
	PipelineId string
	Message    string
}
type GetTransferStatusProto struct{ TransferId string }
type GetTransferStatusResponseProto struct {
	TransferId   string
	CurrentState string
	StateLabel   string
	UpdatedAt    int64
}
type HealthCheckProto struct{}
type HealthCheckResponseProto struct {
	Status  string
	Version string
	UptimeS int64
}
type ScoreRequestProto struct {
	TransferId       string
	UserId           int64
	AmountUsd        float64
	SourceCountry    string
	DestCountry      string
	PaymentMethod    string
	HourOfDay        int32
	IsNewDevice      bool
	IsNewBeneficiary bool
	TransfersToday   int32
}
type ScoreResponseProto struct {
	Score        float64
	RiskLevel    string
	Flags        []string
	Block        bool
	ManualReview bool
	Reason       string
}
type GetRulesProto struct{}
type GetRulesResponseProto struct{ Rules []*FraudRuleProto }
type FraudRuleProto struct {
	Id          string
	Name        string
	Description string
	Weight      float64
	Enabled     bool
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Connect to database
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "remitflow:remitflow@tcp(localhost:3306)/remitflow?parseTime=true"
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer db.Close()
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Initialise services
	sm := NewStateMachineService(db, logger)
	fraud := NewFraudScorerService()
	srv := &TransferEngineServer{sm: sm, fraud: fraud, logger: logger}

	// Start gRPC server
	grpcPort := os.Getenv("GRPC_PORT")
	if grpcPort == "" {
		grpcPort = defaultGRPCPort
	}
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	_ = srv // register with grpcServer.RegisterService in production with generated code
	reflection.Register(grpcServer)

	// Start Prometheus metrics server
	metricsPort := os.Getenv("METRICS_PORT")
	if metricsPort == "" {
		metricsPort = defaultMetricsPort
	}
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprintf(w, `{"status":"ok","version":"%s","uptime_s":%d}`, version, int64(time.Since(startTime).Seconds()))
		})
		logger.Info("metrics server listening", zap.String("port", metricsPort))
		if err := http.ListenAndServe(":"+metricsPort, mux); err != nil {
			logger.Error("metrics server error", zap.Error(err))
		}
	}()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		logger.Info("transfer engine gRPC server listening", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Error("gRPC server error", zap.Error(err))
		}
	}()

	<-stop
	logger.Info("shutting down gracefully...")
	grpcServer.GracefulStop()
	logger.Info("transfer engine stopped")
}
