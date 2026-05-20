// RemitFlow — Double-Entry Ledger Service (Go)
// Implements double-entry accounting using TigerBeetle-compatible semantics
// Falls back to in-memory ledger when TigerBeetle is not available
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port                string
	TigerBeetleAddr     string
	KafkaBrokers        string
	LogLevel            string
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("PORT", "8086"),
		TigerBeetleAddr: getEnv("TIGERBEETLE_ADDRESSES", "localhost:3000"),
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "localhost:9092"),
		LogLevel:        getEnv("LOG_LEVEL", "info"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Domain Types ──────────────────────────────────────────────────────────────

type Account struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Currency    string    `json:"currency"`
	Balance     int64     `json:"balance"`     // in minor units (cents)
	CreditLimit int64     `json:"creditLimit"`
	Flags       uint32    `json:"flags"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Transfer struct {
	ID              string    `json:"id"`
	DebitAccountID  string    `json:"debitAccountId"`
	CreditAccountID string    `json:"creditAccountId"`
	Amount          int64     `json:"amount"`
	Currency        string    `json:"currency"`
	Code            uint16    `json:"code"`
	Flags           uint32    `json:"flags"`
	Timestamp       time.Time `json:"timestamp"`
	PendingID       string    `json:"pendingId,omitempty"`
}

type CreateAccountRequest struct {
	UserID      string `json:"userId" binding:"required"`
	Currency    string `json:"currency" binding:"required"`
	CreditLimit int64  `json:"creditLimit"`
}

type CreateTransferRequest struct {
	DebitAccountID  string `json:"debitAccountId" binding:"required"`
	CreditAccountID string `json:"creditAccountId" binding:"required"`
	Amount          int64  `json:"amount" binding:"required,min=1"`
	Currency        string `json:"currency" binding:"required"`
	Code            uint16 `json:"code"`
	Reference       string `json:"reference"`
}

type LedgerStats struct {
	TotalAccounts  int   `json:"totalAccounts"`
	TotalTransfers int   `json:"totalTransfers"`
	TotalVolume    int64 `json:"totalVolume"`
}

// ── In-Memory Ledger (TigerBeetle fallback) ───────────────────────────────────

type InMemoryLedger struct {
	mu        sync.RWMutex
	accounts  map[string]*Account
	transfers []*Transfer
}

func NewInMemoryLedger() *InMemoryLedger {
	return &InMemoryLedger{
		accounts:  make(map[string]*Account),
		transfers: make([]*Transfer, 0),
	}
}

func (l *InMemoryLedger) CreateAccount(req CreateAccountRequest) (*Account, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	acc := &Account{
		ID:          uuid.New().String(),
		UserID:      req.UserID,
		Currency:    req.Currency,
		Balance:     0,
		CreditLimit: req.CreditLimit,
		CreatedAt:   time.Now().UTC(),
	}
	l.accounts[acc.ID] = acc
	return acc, nil
}

func (l *InMemoryLedger) GetAccount(id string) (*Account, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	acc, ok := l.accounts[id]
	return acc, ok
}

func (l *InMemoryLedger) CreateTransfer(req CreateTransferRequest) (*Transfer, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	debit, ok := l.accounts[req.DebitAccountID]
	if !ok {
		return nil, fmt.Errorf("debit account %s not found", req.DebitAccountID)
	}
	credit, ok := l.accounts[req.CreditAccountID]
	if !ok {
		return nil, fmt.Errorf("credit account %s not found", req.CreditAccountID)
	}

	// Check sufficient funds (allowing credit limit)
	if debit.Balance+debit.CreditLimit < req.Amount {
		return nil, fmt.Errorf("insufficient funds: balance=%d creditLimit=%d amount=%d",
			debit.Balance, debit.CreditLimit, req.Amount)
	}

	// Apply double-entry
	debit.Balance -= req.Amount
	credit.Balance += req.Amount

	t := &Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  req.DebitAccountID,
		CreditAccountID: req.CreditAccountID,
		Amount:          req.Amount,
		Currency:        req.Currency,
		Code:            req.Code,
		Timestamp:       time.Now().UTC(),
	}
	l.transfers = append(l.transfers, t)
	return t, nil
}

func (l *InMemoryLedger) GetStats() LedgerStats {
	l.mu.RLock()
	defer l.mu.RUnlock()

	var totalVolume int64
	for _, t := range l.transfers {
		totalVolume += t.Amount
	}
	return LedgerStats{
		TotalAccounts:  len(l.accounts),
		TotalTransfers: len(l.transfers),
		TotalVolume:    totalVolume,
	}
}

func (l *InMemoryLedger) GetAccountTransfers(accountID string) []*Transfer {
	l.mu.RLock()
	defer l.mu.RUnlock()

	result := make([]*Transfer, 0)
	for _, t := range l.transfers {
		if t.DebitAccountID == accountID || t.CreditAccountID == accountID {
			result = append(result, t)
		}
	}
	return result
}

// ── Handlers ──────────────────────────────────────────────────────────────────

var ledger = NewInMemoryLedger()

// Needed for fmt.Errorf in the ledger
import "fmt"

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "ledger-service",
		"version":   "1.0.0",
		"backend":   "in-memory (TigerBeetle fallback)",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func createAccountHandler(c *gin.Context) {
	var req CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	acc, err := ledger.CreateAccount(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[LEDGER] Created account %s for user %s (%s)", acc.ID, acc.UserID, acc.Currency)
	c.JSON(http.StatusCreated, acc)
}

func getAccountHandler(c *gin.Context) {
	id := c.Param("id")
	acc, ok := ledger.GetAccount(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	c.JSON(http.StatusOK, acc)
}

func createTransferHandler(c *gin.Context) {
	var req CreateTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	t, err := ledger.CreateTransfer(req)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[LEDGER] Transfer %s: %d %s from %s to %s",
		t.ID, t.Amount, t.Currency, t.DebitAccountID, t.CreditAccountID)
	c.JSON(http.StatusCreated, t)
}

func getAccountTransfersHandler(c *gin.Context) {
	id := c.Param("id")
	transfers := ledger.GetAccountTransfers(id)
	c.JSON(http.StatusOK, gin.H{
		"accountId": id,
		"transfers": transfers,
		"count":     len(transfers),
	})
}

func getStatsHandler(c *gin.Context) {
	stats := ledger.GetStats()
	c.JSON(http.StatusOK, stats)
}

func metricsHandler(c *gin.Context) {
	stats := ledger.GetStats()
	c.String(http.StatusOK, fmt.Sprintf(`# HELP ledger_accounts_total Total accounts in ledger
# TYPE ledger_accounts_total gauge
ledger_accounts_total %d
# HELP ledger_transfers_total Total transfers processed
# TYPE ledger_transfers_total counter
ledger_transfers_total %d
# HELP ledger_volume_total Total volume processed (minor units)
# TYPE ledger_volume_total counter
ledger_volume_total %d
`, stats.TotalAccounts, stats.TotalTransfers, stats.TotalVolume))
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()

	if cfg.LogLevel != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	r.GET("/health", healthHandler)
	r.GET("/metrics", metricsHandler)
	r.GET("/stats", getStatsHandler)

	v1 := r.Group("/v1")
	{
		v1.POST("/accounts", createAccountHandler)
		v1.GET("/accounts/:id", getAccountHandler)
		v1.GET("/accounts/:id/transfers", getAccountTransfersHandler)
		v1.POST("/transfers", createTransferHandler)
	}

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[LEDGER-SERVICE] Starting on port %s", cfg.Port)
		log.Printf("[LEDGER-SERVICE] TigerBeetle: %s (using in-memory fallback)", cfg.TigerBeetleAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[LEDGER-SERVICE] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}

	// Dump final stats
	stats := ledger.GetStats()
	statsJSON, _ := json.Marshal(stats)
	log.Printf("[LEDGER-SERVICE] Final stats: %s", string(statsJSON))
	log.Println("[LEDGER-SERVICE] Stopped")
}
