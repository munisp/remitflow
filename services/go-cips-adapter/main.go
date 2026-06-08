// RemitFlow — CIPS (Cross-Border Interbank Payment System) Adapter
// Language: Go 1.22
// Purpose: Implements the PBOC CIPS ISO 20022 pacs.008/pacs.002 message lifecycle
//          for CNY cross-border payments. Exposes a REST API consumed by the
//          Node.js core via internal service mesh.
//
// CIPS Compliance:
//   - ISO 20022 pacs.008 (FI to FI Customer Credit Transfer)
//   - ISO 20022 pacs.002 (Payment Status Report)
//   - ISO 20022 camt.056 (FI to FI Payment Cancellation Request)
//   - PBOC CNAPS routing codes
//   - mTLS mutual authentication with CIPS Switch
//
// Default sandbox: https://sandbox.cips.com.cn/api/v2

package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	_ "github.com/lib/pq"
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/remitflow/cips-adapter/internal/handlers"
	"github.com/remitflow/cips-adapter/internal/middleware"
)


var db *sql.DB


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS cips_adapter_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_cips_adapter_updated ON cips_adapter_state(updated_at);
		CREATE TABLE IF NOT EXISTS cips_adapter_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_cips_adapter_events_type ON cips_adapter_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-cips-adapter", "table", "cips_adapter_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO cips_adapter_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM cips_adapter_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM cips_adapter_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO cips_adapter_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())
	r.Use(middleware.RequestID())
	r.Use(middleware.RateLimit())

	// Health & readiness
	r.GET("/health", handlers.Health)
	r.GET("/ready", handlers.Ready)
	r.GET("/metrics", handlers.Metrics)

	// CIPS API v1
	v1 := r.Group("/api/v1")
	v1.Use(middleware.APIKeyAuth())
	{
		// Participant management
		v1.GET("/participants", handlers.ListParticipants)
		v1.GET("/participants/:bic", handlers.GetParticipant)

		// Account lookup (CNAPS routing)
		v1.POST("/lookup", handlers.LookupAccount)

		// Transfer lifecycle
		v1.POST("/transfers", handlers.InitiateTransfer)
		v1.GET("/transfers/:id", handlers.GetTransferStatus)
		v1.POST("/transfers/:id/cancel", handlers.CancelTransfer)
		v1.GET("/transfers", handlers.ListTransfers)

		// Settlement
		v1.GET("/settlement/windows", handlers.GetSettlementWindows)
		v1.POST("/settlement/confirm", handlers.ConfirmSettlement)

		// Compliance
		v1.POST("/compliance/screen", handlers.ScreenTransaction)
		v1.GET("/compliance/sanctions/:name", handlers.CheckSanctions)

		// Callbacks (from CIPS Switch)
		v1.POST("/callbacks/pacs002", handlers.HandlePacs002Callback)
		v1.POST("/callbacks/camt056", handlers.HandleCamt056Callback)
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("[CIPS] Adapter listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[CIPS] Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[CIPS] Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[CIPS] Forced shutdown: %v", err)
	}
	log.Println("[CIPS] Server stopped")
}
