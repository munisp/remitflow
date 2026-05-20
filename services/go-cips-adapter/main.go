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
