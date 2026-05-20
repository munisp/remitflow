// Command aggregator is the RemitFlow liveness score aggregator.
//
// It consumes "kyc.liveness.result" events from Kafka, persists raw audit
// rows to kyc_liveness_audit, and maintains hourly time-series stats in
// liveness_stats_hourly for the compliance dashboard.
//
// HTTP endpoints:
//
//	GET /healthz           — liveness probe
//	GET /metrics           — Prometheus metrics
//	GET /stats/hourly      — last 24h hourly stats (JSON)
//	GET /stats/hourly?hours=N&corridor=NG — filtered stats
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/remitflow/liveness-aggregator/internal/consumer"
	"github.com/remitflow/liveness-aggregator/internal/db"
	"github.com/remitflow/liveness-aggregator/internal/metrics"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// ── Logging ──────────────────────────────────────────────────────────────
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("LOG_FORMAT") != "json" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	}
	level, err := zerolog.ParseLevel(envOr("LOG_LEVEL", "info"))
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	// ── Config ───────────────────────────────────────────────────────────────
	dsn := envOr("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/remitflow?sslmode=disable")
	brokers := splitCSV(envOr("KAFKA_BROKERS", "localhost:9092"))
	httpAddr := envOr("HTTP_ADDR", ":8098")

	log.Info().
		Strs("brokers", brokers).
		Str("http_addr", httpAddr).
		Msg("[aggregator] starting RemitFlow liveness score aggregator")

	// ── Database ─────────────────────────────────────────────────────────────
	dbClient, err := db.New(dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("[aggregator] failed to connect to database")
	}
	defer dbClient.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := dbClient.EnsureSchema(ctx); err != nil {
		cancel()
		log.Fatal().Err(err).Msg("[aggregator] failed to ensure schema")
	}
	cancel()
	log.Info().Msg("[aggregator] database schema ready")

	// ── Kafka consumer ───────────────────────────────────────────────────────
	cons := consumer.New(consumer.Config{
		Brokers:  brokers,
		StartLag: 24 * time.Hour,
	}, dbClient)
	defer cons.Close()

	// ── HTTP server ──────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	mux.Handle("/metrics", metrics.Handler())

	mux.HandleFunc("/stats/hourly", func(w http.ResponseWriter, r *http.Request) {
		hours := 24
		if h := r.URL.Query().Get("hours"); h != "" {
			if n, err := strconv.Atoi(h); err == nil && n > 0 && n <= 720 {
				hours = n
			}
		}
		corridor := r.URL.Query().Get("corridor")

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := dbClient.GetHourlyStats(ctx, hours, corridor)
		if err != nil {
			log.Error().Err(err).Msg("[aggregator] /stats/hourly query failed")
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(rows); err != nil {
			log.Error().Err(err).Msg("[aggregator] /stats/hourly encode failed")
		}
	})

	srv := &http.Server{
		Addr:         httpAddr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Graceful shutdown ────────────────────────────────────────────────────
	runCtx, runCancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Info().Str("signal", sig.String()).Msg("[aggregator] shutdown signal received")
		runCancel()
		shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutCancel()
		_ = srv.Shutdown(shutCtx)
	}()

	go func() {
		log.Info().Str("addr", httpAddr).Msg("[aggregator] HTTP server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("[aggregator] HTTP server error")
		}
	}()

	// Block on Kafka consumer
	if err := cons.Run(runCtx); err != nil {
		log.Error().Err(err).Msg("[aggregator] consumer exited with error")
	}
	log.Info().Msg("[aggregator] shutdown complete")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitCSV(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			if v := s[start:i]; v != "" {
				out = append(out, v)
			}
			start = i + 1
		}
	}
	if v := s[start:]; v != "" {
		out = append(out, v)
	}
	return out
}
