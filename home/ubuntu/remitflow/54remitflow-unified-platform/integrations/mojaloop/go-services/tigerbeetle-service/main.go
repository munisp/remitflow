package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// TigerBeetle client interface (would use actual tigerbeetle-go client in production)
type TigerBeetleClient struct {
	ClusterID uint128
	Addresses []string
}

type uint128 struct {
	High uint64
	Low  uint64
}

// Account represents a TigerBeetle account
type Account struct {
	ID             uint128 `json:"id"`
	DebitsPending  uint64  `json:"debits_pending"`
	DebitsPosted   uint64  `json:"debits_posted"`
	CreditsPending uint64  `json:"credits_pending"`
	CreditsPosted  uint64  `json:"credits_posted"`
	UserData128    uint128 `json:"user_data_128"`
	UserData64     uint64  `json:"user_data_64"`
	UserData32     uint32  `json:"user_data_32"`
	Reserved       uint32  `json:"reserved"`
	Ledger         uint32  `json:"ledger"`
	Code           uint16  `json:"code"`
	Flags          uint16  `json:"flags"`
	Timestamp      uint64  `json:"timestamp"`
}

// Transfer represents a TigerBeetle transfer
type Transfer struct {
	ID              uint128 `json:"id"`
	DebitAccountID  uint128 `json:"debit_account_id"`
	CreditAccountID uint128 `json:"credit_account_id"`
	Amount          uint64  `json:"amount"`
	PendingID       uint128 `json:"pending_id"`
	UserData128     uint128 `json:"user_data_128"`
	UserData64      uint64  `json:"user_data_64"`
	UserData32      uint32  `json:"user_data_32"`
	Timeout         uint32  `json:"timeout"`
	Ledger          uint32  `json:"ledger"`
	Code            uint16  `json:"code"`
	Flags           uint16  `json:"flags"`
	Timestamp       uint64  `json:"timestamp"`
}

// Mojaloop-specific structures
type MojaloopParticipant struct {
	ParticipantID string `json:"participant_id"`
	Name          string `json:"name"`
	Currency      string `json:"currency"`
	AccountID     uint64 `json:"account_id"`
}

type MojaloopQuote struct {
	QuoteID       string  `json:"quote_id"`
	TransactionID string  `json:"transaction_id"`
	PayerFSP      string  `json:"payer_fsp"`
	PayeeFSP      string  `json:"payee_fsp"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Fees          float64 `json:"fees"`
	TotalAmount   float64 `json:"total_amount"`
}

type MojaloopTransfer struct {
	TransferID      string  `json:"transfer_id"`
	QuoteID         string  `json:"quote_id"`
	PayerFSP        string  `json:"payer_fsp"`
	PayeeFSP        string  `json:"payee_fsp"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	State           string  `json:"state"`
	TBTransferID    uint64  `json:"tb_transfer_id"`
	PayerAccountID  uint64  `json:"payer_account_id"`
	PayeeAccountID  uint64  `json:"payee_account_id"`
}

// Service struct
type MojaloopTigerBeetleService struct {
	client         *TigerBeetleClient
	participants   map[string]*MojaloopParticipant
	quotes         map[string]*MojaloopQuote
	transfers      map[string]*MojaloopTransfer
	accountCounter uint64
	transferCounter uint64
}

// Prometheus metrics
var (
	accountsCreated = promauto.NewCounter(prometheus.CounterOpts{
		Name: "mojaloop_tigerbeetle_accounts_created_total",
		Help: "Total number of TigerBeetle accounts created",
	})

	transfersProcessed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "mojaloop_tigerbeetle_transfers_processed_total",
		Help: "Total number of TigerBeetle transfers processed",
	}, []string{"status"})

	transferLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "mojaloop_tigerbeetle_transfer_duration_seconds",
		Help:    "TigerBeetle transfer operation duration",
		Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
	}, []string{"operation"})

	accountBalance = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "mojaloop_tigerbeetle_account_balance",
		Help: "Current account balance in TigerBeetle",
	}, []string{"participant_id", "currency"})

	quotesCreated = promauto.NewCounter(prometheus.CounterOpts{
		Name: "mojaloop_quotes_created_total",
		Help: "Total number of Mojaloop quotes created",
	})

	transfersCommitted = promauto.NewCounter(prometheus.CounterOpts{
		Name: "mojaloop_transfers_committed_total",
		Help: "Total number of Mojaloop transfers committed",
	})
)

// NewService creates a new Mojaloop TigerBeetle service
func NewService() *MojaloopTigerBeetleService {
	clusterID := uint128{High: 0, Low: 1}
	addresses := []string{
		os.Getenv("TIGERBEETLE_ADDRESS_1"),
		os.Getenv("TIGERBEETLE_ADDRESS_2"),
		os.Getenv("TIGERBEETLE_ADDRESS_3"),
	}

	// Default addresses if not set
	if addresses[0] == "" {
		addresses = []string{
			"tigerbeetle-0.tigerbeetle:3000",
			"tigerbeetle-1.tigerbeetle:3000",
			"tigerbeetle-2.tigerbeetle:3000",
		}
	}

	return &MojaloopTigerBeetleService{
		client: &TigerBeetleClient{
			ClusterID: clusterID,
			Addresses: addresses,
		},
		participants:    make(map[string]*MojaloopParticipant),
		quotes:          make(map[string]*MojaloopQuote),
		transfers:       make(map[string]*MojaloopTransfer),
		accountCounter:  1000,
		transferCounter: 1000,
	}
}

// RegisterParticipant creates a TigerBeetle account for a Mojaloop participant
func (s *MojaloopTigerBeetleService) RegisterParticipant(c *gin.Context) {
	var req struct {
		ParticipantID string `json:"participant_id" binding:"required"`
		Name          string `json:"name" binding:"required"`
		Currency      string `json:"currency" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	start := time.Now()

	// Generate account ID
	s.accountCounter++
	accountID := s.accountCounter

	// Create TigerBeetle account
	account := Account{
		ID:             uint128{High: 0, Low: accountID},
		Ledger:         getCurrencyLedger(req.Currency),
		Code:           1, // Participant account
		Flags:          0,
		DebitsPending:  0,
		DebitsPosted:   0,
		CreditsPending: 0,
		CreditsPosted:  0,
	}

	// In production, would call actual TigerBeetle client
	log.Printf("Creating TigerBeetle account: %+v", account)

	// Store participant
	participant := &MojaloopParticipant{
		ParticipantID: req.ParticipantID,
		Name:          req.Name,
		Currency:      req.Currency,
		AccountID:     accountID,
	}
	s.participants[req.ParticipantID] = participant

	// Update metrics
	accountsCreated.Inc()
	accountBalance.WithLabelValues(req.ParticipantID, req.Currency).Set(0)
	transferLatency.WithLabelValues("create_account").Observe(time.Since(start).Seconds())

	c.JSON(http.StatusOK, gin.H{
		"status":         "success",
		"participant_id": req.ParticipantID,
		"account_id":     accountID,
		"message":        "Participant registered successfully",
	})
}

// CreateQuote creates a Mojaloop quote
func (s *MojaloopTigerBeetleService) CreateQuote(c *gin.Context) {
	var req MojaloopQuote

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate participants exist
	if _, exists := s.participants[req.PayerFSP]; !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Payer FSP not found"})
		return
	}
	if _, exists := s.participants[req.PayeeFSP]; !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Payee FSP not found"})
		return
	}

	// Calculate fees (0.1% + base fee)
	baseFee := 10.0
	percentageFee := req.Amount * 0.001
	req.Fees = baseFee + percentageFee
	req.TotalAmount = req.Amount + req.Fees

	// Store quote
	s.quotes[req.QuoteID] = &req

	// Update metrics
	quotesCreated.Inc()

	c.JSON(http.StatusOK, gin.H{
		"status":       "success",
		"quote_id":     req.QuoteID,
		"amount":       req.Amount,
		"fees":         req.Fees,
		"total_amount": req.TotalAmount,
		"currency":     req.Currency,
	})
}

// PrepareTransfer prepares a Mojaloop transfer (creates pending transfer in TigerBeetle)
func (s *MojaloopTigerBeetleService) PrepareTransfer(c *gin.Context) {
	var req struct {
		TransferID string  `json:"transfer_id" binding:"required"`
		QuoteID    string  `json:"quote_id" binding:"required"`
		PayerFSP   string  `json:"payer_fsp" binding:"required"`
		PayeeFSP   string  `json:"payee_fsp" binding:"required"`
		Amount     float64 `json:"amount" binding:"required"`
		Currency   string  `json:"currency" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	start := time.Now()

	// Validate quote exists
	quote, exists := s.quotes[req.QuoteID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quote not found"})
		return
	}

	// Get participant accounts
	payer := s.participants[req.PayerFSP]
	payee := s.participants[req.PayeeFSP]

	// Generate transfer ID
	s.transferCounter++
	transferID := s.transferCounter

	// Create pending TigerBeetle transfer
	amountInCents := uint64(req.Amount * 100) // Convert to cents

	transfer := Transfer{
		ID:              uint128{High: 0, Low: transferID},
		DebitAccountID:  uint128{High: 0, Low: payer.AccountID},
		CreditAccountID: uint128{High: 0, Low: payee.AccountID},
		Amount:          amountInCents,
		Ledger:          getCurrencyLedger(req.Currency),
		Code:            1, // Mojaloop transfer
		Flags:           1, // Pending flag
		Timeout:         300, // 5 minutes
	}

	// In production, would call actual TigerBeetle client
	log.Printf("Creating pending TigerBeetle transfer: %+v", transfer)

	// Store transfer
	mojaTransfer := &MojaloopTransfer{
		TransferID:      req.TransferID,
		QuoteID:         req.QuoteID,
		PayerFSP:        req.PayerFSP,
		PayeeFSP:        req.PayeeFSP,
		Amount:          req.Amount,
		Currency:        req.Currency,
		State:           "RESERVED",
		TBTransferID:    transferID,
		PayerAccountID:  payer.AccountID,
		PayeeAccountID:  payee.AccountID,
	}
	s.transfers[req.TransferID] = mojaTransfer

	// Update metrics
	transfersProcessed.WithLabelValues("reserved").Inc()
	transferLatency.WithLabelValues("prepare_transfer").Observe(time.Since(start).Seconds())

	c.JSON(http.StatusOK, gin.H{
		"status":           "success",
		"transfer_id":      req.TransferID,
		"state":            "RESERVED",
		"tb_transfer_id":   transferID,
		"amount":           req.Amount,
		"fees":             quote.Fees,
		"total_amount":     quote.TotalAmount,
	})
}

// FulfillTransfer commits a prepared transfer
func (s *MojaloopTigerBeetleService) FulfillTransfer(c *gin.Context) {
	transferID := c.Param("transfer_id")

	start := time.Now()

	// Get transfer
	transfer, exists := s.transfers[transferID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transfer not found"})
		return
	}

	if transfer.State != "RESERVED" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer not in RESERVED state"})
		return
	}

	// In production, would commit the pending transfer in TigerBeetle
	log.Printf("Committing TigerBeetle transfer: %d", transfer.TBTransferID)

	// Update transfer state
	transfer.State = "COMMITTED"

	// Update account balances (for metrics)
	payer := s.participants[transfer.PayerFSP]
	payee := s.participants[transfer.PayeeFSP]
	
	accountBalance.WithLabelValues(transfer.PayerFSP, transfer.Currency).Sub(transfer.Amount)
	accountBalance.WithLabelValues(transfer.PayeeFSP, transfer.Currency).Add(transfer.Amount)

	// Update metrics
	transfersProcessed.WithLabelValues("committed").Inc()
	transfersCommitted.Inc()
	transferLatency.WithLabelValues("fulfill_transfer").Observe(time.Since(start).Seconds())

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"transfer_id": transferID,
		"state":       "COMMITTED",
		"payer_account": payer.AccountID,
		"payee_account": payee.AccountID,
	})
}

// AbortTransfer aborts a prepared transfer
func (s *MojaloopTigerBeetleService) AbortTransfer(c *gin.Context) {
	transferID := c.Param("transfer_id")

	start := time.Now()

	// Get transfer
	transfer, exists := s.transfers[transferID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transfer not found"})
		return
	}

	if transfer.State != "RESERVED" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer not in RESERVED state"})
		return
	}

	// In production, would void the pending transfer in TigerBeetle
	log.Printf("Aborting TigerBeetle transfer: %d", transfer.TBTransferID)

	// Update transfer state
	transfer.State = "ABORTED"

	// Update metrics
	transfersProcessed.WithLabelValues("aborted").Inc()
	transferLatency.WithLabelValues("abort_transfer").Observe(time.Since(start).Seconds())

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"transfer_id": transferID,
		"state":       "ABORTED",
	})
}

// GetAccountBalance retrieves account balance
func (s *MojaloopTigerBeetleService) GetAccountBalance(c *gin.Context) {
	participantID := c.Param("participant_id")

	participant, exists := s.participants[participantID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Participant not found"})
		return
	}

	// In production, would query TigerBeetle for actual balance
	c.JSON(http.StatusOK, gin.H{
		"participant_id": participantID,
		"account_id":     participant.AccountID,
		"currency":       participant.Currency,
		"balance":        0, // Would be actual balance from TigerBeetle
	})
}

// Helper function to get ledger ID for currency
func getCurrencyLedger(currency string) uint32 {
	ledgers := map[string]uint32{
		"NGN": 566, // Nigeria
		"USD": 840, // United States
		"EUR": 978, // Euro
		"GBP": 826, // United Kingdom
		"KES": 404, // Kenya
		"GHS": 936, // Ghana
		"ZAR": 710, // South Africa
		"INR": 356, // India (UPI)
		"BRL": 986, // Brazil (PIX)
		"CNY": 156, // China (CIPS)
	}

	if ledger, exists := ledgers[currency]; exists {
		return ledger
	}
	return 999 // Default ledger
}

func main() {
	// Create service
	service := NewService()

	// Create Gin router
	router := gin.Default()

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Metrics endpoint
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := router.Group("/api/v1")
	{
		// Participant management
		api.POST("/participants", service.RegisterParticipant)
		api.GET("/participants/:participant_id/balance", service.GetAccountBalance)

		// Quote operations
		api.POST("/quotes", service.CreateQuote)

		// Transfer operations
		api.POST("/transfers/prepare", service.PrepareTransfer)
		api.POST("/transfers/:transfer_id/fulfill", service.FulfillTransfer)
		api.POST("/transfers/:transfer_id/abort", service.AbortTransfer)
	}

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Mojaloop TigerBeetle Service on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

