package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Transaction represents a financial transaction
type Transaction struct {
	ID                uuid.UUID         `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionRef    string            `json:"transaction_ref" gorm:"uniqueIndex;not null"`
	Type              TransactionType   `json:"type" gorm:"not null"`
	Status            TransactionStatus `json:"status" gorm:"default:'pending'"`
	Amount            float64           `json:"amount" gorm:"not null"`
	Currency          string            `json:"currency" gorm:"default:'USD'"`
	Fee               float64           `json:"fee" gorm:"default:0"`
	Commission        float64           `json:"commission" gorm:"default:0"`
	AgentID           uuid.UUID         `json:"agent_id" gorm:"not null;index"`
	CustomerID        uuid.UUID         `json:"customer_id" gorm:"not null;index"`
	SourceAccount     string            `json:"source_account"`
	DestinationAccount string           `json:"destination_account"`
	Description       string            `json:"description"`
	Metadata          JSON              `json:"metadata" gorm:"type:jsonb"`
	ProcessedAt       *time.Time        `json:"processed_at"`
	FailureReason     string            `json:"failure_reason"`
	RiskScore         float64           `json:"risk_score" gorm:"default:0"`
	FraudFlags        []string          `json:"fraud_flags" gorm:"type:text[]"`
	IPAddress         string            `json:"ip_address"`
	DeviceFingerprint string            `json:"device_fingerprint"`
	Location          Location          `json:"location" gorm:"embedded"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

// TransactionType represents the type of transaction
type TransactionType string

const (
	TransactionTypeDeposit    TransactionType = "deposit"
	TransactionTypeWithdrawal TransactionType = "withdrawal"
	TransactionTypeTransfer   TransactionType = "transfer"
	TransactionTypeBillPayment TransactionType = "bill_payment"
	TransactionTypeAirtime    TransactionType = "airtime"
	TransactionTypeData       TransactionType = "data"
	TransactionTypeCashIn     TransactionType = "cash_in"
	TransactionTypeCashOut    TransactionType = "cash_out"
)

// TransactionStatus represents the status of a transaction
type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "pending"
	TransactionStatusProcessing TransactionStatus = "processing"
	TransactionStatusCompleted TransactionStatus = "completed"
	TransactionStatusFailed    TransactionStatus = "failed"
	TransactionStatusCancelled TransactionStatus = "cancelled"
	TransactionStatusReversed  TransactionStatus = "reversed"
	TransactionStatusFlagged   TransactionStatus = "flagged"
)

// Location represents geographical location
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Country   string  `json:"country"`
	City      string  `json:"city"`
	Address   string  `json:"address"`
}

// JSON type for JSONB fields
type JSON map[string]interface{}

// TransactionLimit represents transaction limits
type TransactionLimit struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID         uuid.UUID `json:"agent_id" gorm:"not null;index"`
	TransactionType TransactionType `json:"transaction_type" gorm:"not null"`
	DailyLimit      float64   `json:"daily_limit" gorm:"not null"`
	MonthlyLimit    float64   `json:"monthly_limit" gorm:"not null"`
	SingleLimit     float64   `json:"single_limit" gorm:"not null"`
	DailyUsed       float64   `json:"daily_used" gorm:"default:0"`
	MonthlyUsed     float64   `json:"monthly_used" gorm:"default:0"`
	Date            time.Time `json:"date" gorm:"not null;index"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// TransactionLog represents audit log for transactions
type TransactionLog struct {
	ID            uuid.UUID         `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionID uuid.UUID         `json:"transaction_id" gorm:"not null;index"`
	Action        string            `json:"action" gorm:"not null"`
	OldStatus     TransactionStatus `json:"old_status"`
	NewStatus     TransactionStatus `json:"new_status"`
	Reason        string            `json:"reason"`
	UserID        uuid.UUID         `json:"user_id"`
	IPAddress     string            `json:"ip_address"`
	UserAgent     string            `json:"user_agent"`
	CreatedAt     time.Time         `json:"created_at"`
}

// CreateTransactionRequest represents the request to create a new transaction
type CreateTransactionRequest struct {
	Type              TransactionType `json:"type" binding:"required"`
	Amount            float64         `json:"amount" binding:"required,gt=0"`
	Currency          string          `json:"currency"`
	AgentID           uuid.UUID       `json:"agent_id" binding:"required"`
	CustomerID        uuid.UUID       `json:"customer_id" binding:"required"`
	SourceAccount     string          `json:"source_account"`
	DestinationAccount string         `json:"destination_account"`
	Description       string          `json:"description"`
	Metadata          JSON            `json:"metadata"`
	IPAddress         string          `json:"ip_address"`
	DeviceFingerprint string          `json:"device_fingerprint"`
	Location          Location        `json:"location"`
}

// UpdateTransactionRequest represents the request to update a transaction
type UpdateTransactionRequest struct {
	Status        TransactionStatus `json:"status"`
	FailureReason string            `json:"failure_reason"`
	Metadata      JSON              `json:"metadata"`
}

// TransactionService handles transaction-related operations
type TransactionService struct {
	db *gorm.DB
}

// NewTransactionService creates a new transaction service
func NewTransactionService(db *gorm.DB) *TransactionService {
	return &TransactionService{db: db}
}

// CreateTransaction creates a new transaction
func (s *TransactionService) CreateTransaction(req CreateTransactionRequest) (*Transaction, error) {
	// Generate unique transaction reference
	transactionRef := generateTransactionRef()
	
	// Set default currency
	if req.Currency == "" {
		req.Currency = "USD"
	}

	transaction := &Transaction{
		TransactionRef:    transactionRef,
		Type:              req.Type,
		Status:            TransactionStatusPending,
		Amount:            req.Amount,
		Currency:          req.Currency,
		AgentID:           req.AgentID,
		CustomerID:        req.CustomerID,
		SourceAccount:     req.SourceAccount,
		DestinationAccount: req.DestinationAccount,
		Description:       req.Description,
		Metadata:          req.Metadata,
		IPAddress:         req.IPAddress,
		DeviceFingerprint: req.DeviceFingerprint,
		Location:          req.Location,
	}

	// Calculate fee and commission
	s.calculateFeeAndCommission(transaction)

	// Check transaction limits
	if err := s.checkTransactionLimits(transaction); err != nil {
		return nil, fmt.Errorf("transaction limit exceeded: %w", err)
	}

	// Perform fraud check
	s.performFraudCheck(transaction)

	if err := s.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	// Log transaction creation
	s.logTransaction(transaction.ID, "created", TransactionStatusPending, TransactionStatusPending, "Transaction created", uuid.Nil)

	// Update transaction limits
	s.updateTransactionLimits(transaction)

	return transaction, nil
}

// GetTransaction retrieves a transaction by ID
func (s *TransactionService) GetTransaction(id uuid.UUID) (*Transaction, error) {
	var transaction Transaction
	if err := s.db.First(&transaction, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get transaction: %w", err)
	}
	return &transaction, nil
}

// GetTransactionByRef retrieves a transaction by reference
func (s *TransactionService) GetTransactionByRef(ref string) (*Transaction, error) {
	var transaction Transaction
	if err := s.db.First(&transaction, "transaction_ref = ?", ref).Error; err != nil {
		return nil, fmt.Errorf("failed to get transaction by ref: %w", err)
	}
	return &transaction, nil
}

// UpdateTransaction updates a transaction
func (s *TransactionService) UpdateTransaction(id uuid.UUID, req UpdateTransactionRequest, userID uuid.UUID) (*Transaction, error) {
	var transaction Transaction
	if err := s.db.First(&transaction, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find transaction: %w", err)
	}

	oldStatus := transaction.Status

	// Update fields if provided
	if req.Status != "" {
		transaction.Status = req.Status
		if req.Status == TransactionStatusCompleted {
			now := time.Now()
			transaction.ProcessedAt = &now
		}
	}
	if req.FailureReason != "" {
		transaction.FailureReason = req.FailureReason
	}
	if req.Metadata != nil {
		transaction.Metadata = req.Metadata
	}

	if err := s.db.Save(&transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to update transaction: %w", err)
	}

	// Log transaction update
	s.logTransaction(transaction.ID, "updated", oldStatus, transaction.Status, "Transaction updated", userID)

	return &transaction, nil
}

// ListTransactions retrieves a list of transactions with pagination and filters
func (s *TransactionService) ListTransactions(page, limit int, agentID *uuid.UUID, customerID *uuid.UUID, status TransactionStatus, transactionType TransactionType, startDate, endDate *time.Time) ([]Transaction, int64, error) {
	var transactions []Transaction
	var total int64

	query := s.db.Model(&Transaction{})

	// Apply filters
	if agentID != nil {
		query = query.Where("agent_id = ?", *agentID)
	}
	if customerID != nil {
		query = query.Where("customer_id = ?", *customerID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if transactionType != "" {
		query = query.Where("type = ?", transactionType)
	}
	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count transactions: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&transactions).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list transactions: %w", err)
	}

	return transactions, total, nil
}

// ProcessTransaction processes a pending transaction
func (s *TransactionService) ProcessTransaction(id uuid.UUID, userID uuid.UUID) error {
	var transaction Transaction
	if err := s.db.First(&transaction, "id = ?", id).Error; err != nil {
		return fmt.Errorf("failed to find transaction: %w", err)
	}

	if transaction.Status != TransactionStatusPending {
		return fmt.Errorf("transaction is not in pending status")
	}

	// Update status to processing
	transaction.Status = TransactionStatusProcessing
	if err := s.db.Save(&transaction).Error; err != nil {
		return fmt.Errorf("failed to update transaction status: %w", err)
	}

	// Log status change
	s.logTransaction(transaction.ID, "processing", TransactionStatusPending, TransactionStatusProcessing, "Transaction processing started", userID)

	// Simulate processing (in real implementation, this would integrate with payment processors)
	go func() {
		time.Sleep(5 * time.Second) // Simulate processing time
		
		// Update to completed (simplified logic)
		transaction.Status = TransactionStatusCompleted
		now := time.Now()
		transaction.ProcessedAt = &now
		
		s.db.Save(&transaction)
		s.logTransaction(transaction.ID, "completed", TransactionStatusProcessing, TransactionStatusCompleted, "Transaction completed", userID)
	}()

	return nil
}

// calculateFeeAndCommission calculates fee and commission for a transaction
func (s *TransactionService) calculateFeeAndCommission(transaction *Transaction) {
	// Simplified fee calculation
	switch transaction.Type {
	case TransactionTypeDeposit:
		transaction.Fee = 0 // No fee for deposits
		transaction.Commission = transaction.Amount * 0.001 // 0.1% commission
	case TransactionTypeWithdrawal:
		transaction.Fee = 5.0 // Fixed fee for withdrawals
		transaction.Commission = transaction.Amount * 0.002 // 0.2% commission
	case TransactionTypeTransfer:
		transaction.Fee = 2.0 // Fixed fee for transfers
		transaction.Commission = transaction.Amount * 0.0015 // 0.15% commission
	case TransactionTypeBillPayment:
		transaction.Fee = 1.0 // Fixed fee for bill payments
		transaction.Commission = transaction.Amount * 0.005 // 0.5% commission
	case TransactionTypeAirtime, TransactionTypeData:
		transaction.Fee = 0 // No fee for airtime/data
		transaction.Commission = transaction.Amount * 0.03 // 3% commission
	default:
		transaction.Fee = 1.0
		transaction.Commission = transaction.Amount * 0.002
	}
}

// checkTransactionLimits checks if transaction is within limits
func (s *TransactionService) checkTransactionLimits(transaction *Transaction) error {
	// Get agent's transaction limits for today
	today := time.Now().Truncate(24 * time.Hour)
	
	var limit TransactionLimit
	err := s.db.Where("agent_id = ? AND transaction_type = ? AND date = ?", 
		transaction.AgentID, transaction.Type, today).First(&limit).Error
	
	if err == gorm.ErrRecordNotFound {
		// Create new limit record
		limit = TransactionLimit{
			AgentID:         transaction.AgentID,
			TransactionType: transaction.Type,
			DailyLimit:      getDefaultDailyLimit(transaction.Type),
			MonthlyLimit:    getDefaultMonthlyLimit(transaction.Type),
			SingleLimit:     getDefaultSingleLimit(transaction.Type),
			Date:            today,
		}
		s.db.Create(&limit)
	} else if err != nil {
		return fmt.Errorf("failed to get transaction limits: %w", err)
	}

	// Check single transaction limit
	if transaction.Amount > limit.SingleLimit {
		return fmt.Errorf("transaction amount exceeds single transaction limit")
	}

	// Check daily limit
	if limit.DailyUsed+transaction.Amount > limit.DailyLimit {
		return fmt.Errorf("transaction amount exceeds daily limit")
	}

	// Check monthly limit
	if limit.MonthlyUsed+transaction.Amount > limit.MonthlyLimit {
		return fmt.Errorf("transaction amount exceeds monthly limit")
	}

	return nil
}

// performFraudCheck performs basic fraud detection
func (s *TransactionService) performFraudCheck(transaction *Transaction) {
	var flags []string
	riskScore := 0.0

	// Check for high amount transactions
	if transaction.Amount > 10000 {
		flags = append(flags, "high_amount")
		riskScore += 30
	}

	// Check for unusual hours (simplified)
	hour := time.Now().Hour()
	if hour < 6 || hour > 22 {
		flags = append(flags, "unusual_hours")
		riskScore += 20
	}

	// Check for rapid transactions (simplified - would need more complex logic)
	var recentCount int64
	s.db.Model(&Transaction{}).Where("agent_id = ? AND created_at > ?", 
		transaction.AgentID, time.Now().Add(-5*time.Minute)).Count(&recentCount)
	
	if recentCount > 5 {
		flags = append(flags, "rapid_transactions")
		riskScore += 40
	}

	transaction.FraudFlags = flags
	transaction.RiskScore = riskScore

	// Flag transaction if risk score is high
	if riskScore > 50 {
		transaction.Status = TransactionStatusFlagged
	}
}

// updateTransactionLimits updates the used amounts in transaction limits
func (s *TransactionService) updateTransactionLimits(transaction *Transaction) {
	today := time.Now().Truncate(24 * time.Hour)
	
	s.db.Model(&TransactionLimit{}).
		Where("agent_id = ? AND transaction_type = ? AND date = ?", 
			transaction.AgentID, transaction.Type, today).
		Updates(map[string]interface{}{
			"daily_used":   gorm.Expr("daily_used + ?", transaction.Amount),
			"monthly_used": gorm.Expr("monthly_used + ?", transaction.Amount),
		})
}

// logTransaction logs transaction actions
func (s *TransactionService) logTransaction(transactionID uuid.UUID, action string, oldStatus, newStatus TransactionStatus, reason string, userID uuid.UUID) {
	log := TransactionLog{
		TransactionID: transactionID,
		Action:        action,
		OldStatus:     oldStatus,
		NewStatus:     newStatus,
		Reason:        reason,
		UserID:        userID,
	}
	s.db.Create(&log)
}

// Helper functions for default limits
func getDefaultDailyLimit(transactionType TransactionType) float64 {
	switch transactionType {
	case TransactionTypeDeposit:
		return 100000
	case TransactionTypeWithdrawal:
		return 50000
	case TransactionTypeTransfer:
		return 25000
	case TransactionTypeBillPayment:
		return 10000
	case TransactionTypeAirtime, TransactionTypeData:
		return 5000
	default:
		return 10000
	}
}

func getDefaultMonthlyLimit(transactionType TransactionType) float64 {
	return getDefaultDailyLimit(transactionType) * 30
}

func getDefaultSingleLimit(transactionType TransactionType) float64 {
	switch transactionType {
	case TransactionTypeDeposit:
		return 50000
	case TransactionTypeWithdrawal:
		return 25000
	case TransactionTypeTransfer:
		return 10000
	case TransactionTypeBillPayment:
		return 5000
	case TransactionTypeAirtime, TransactionTypeData:
		return 1000
	default:
		return 5000
	}
}

// generateTransactionRef generates a unique transaction reference
func generateTransactionRef() string {
	return fmt.Sprintf("TXN%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	transactionCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_created_total",
			Help: "Total number of transactions created",
		},
		[]string{"type", "status"},
	)

	transactionAmountTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_amount_total",
			Help: "Total amount of transactions",
		},
		[]string{"type", "currency"},
	)

	transactionProcessingDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "transaction_processing_duration_seconds",
			Help: "Duration of transaction processing",
		},
		[]string{"type", "status"},
	)

	transactionRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "transaction_request_duration_seconds",
			Help: "Duration of transaction requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(transactionCreatedTotal)
	prometheus.MustRegister(transactionAmountTotal)
	prometheus.MustRegister(transactionProcessingDuration)
	prometheus.MustRegister(transactionRequestDuration)
}

// HTTP Handlers
type TransactionHandler struct {
	service *TransactionService
}

func NewTransactionHandler(service *TransactionService) *TransactionHandler {
	return &TransactionHandler{service: service}
}

func (h *TransactionHandler) CreateTransaction(c *gin.Context) {
	timer := prometheus.NewTimer(transactionRequestDuration.WithLabelValues("POST", "/transactions"))
	defer timer.ObserveDuration()

	var req CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transaction, err := h.service.CreateTransaction(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	transactionCreatedTotal.WithLabelValues(string(transaction.Type), string(transaction.Status)).Inc()
	transactionAmountTotal.WithLabelValues(string(transaction.Type), transaction.Currency).Add(transaction.Amount)

	c.JSON(http.StatusCreated, transaction)
}

func (h *TransactionHandler) GetTransaction(c *gin.Context) {
	timer := prometheus.NewTimer(transactionRequestDuration.WithLabelValues("GET", "/transactions/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}

	transaction, err := h.service.GetTransaction(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	c.JSON(http.StatusOK, transaction)
}

func (h *TransactionHandler) UpdateTransaction(c *gin.Context) {
	timer := prometheus.NewTimer(transactionRequestDuration.WithLabelValues("PUT", "/transactions/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}

	var req UpdateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT token (simplified for demo)
	userID := uuid.New()

	transaction, err := h.service.UpdateTransaction(id, req, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, transaction)
}

func (h *TransactionHandler) ListTransactions(c *gin.Context) {
	timer := prometheus.NewTimer(transactionRequestDuration.WithLabelValues("GET", "/transactions"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	var agentID, customerID *uuid.UUID
	if agentIDStr := c.Query("agent_id"); agentIDStr != "" {
		if id, err := uuid.Parse(agentIDStr); err == nil {
			agentID = &id
		}
	}
	if customerIDStr := c.Query("customer_id"); customerIDStr != "" {
		if id, err := uuid.Parse(customerIDStr); err == nil {
			customerID = &id
		}
	}

	status := TransactionStatus(c.Query("status"))
	transactionType := TransactionType(c.Query("type"))

	var startDate, endDate *time.Time
	if startDateStr := c.Query("start_date"); startDateStr != "" {
		if date, err := time.Parse("2006-01-02", startDateStr); err == nil {
			startDate = &date
		}
	}
	if endDateStr := c.Query("end_date"); endDateStr != "" {
		if date, err := time.Parse("2006-01-02", endDateStr); err == nil {
			endDate = &date
		}
	}

	transactions, total, err := h.service.ListTransactions(page, limit, agentID, customerID, status, transactionType, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"transactions": transactions,
		"total":        total,
		"page":         page,
		"limit":        limit,
	})
}

func (h *TransactionHandler) ProcessTransaction(c *gin.Context) {
	timer := prometheus.NewTimer(transactionRequestDuration.WithLabelValues("POST", "/transactions/:id/process"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}

	// Get user ID from JWT token (simplified for demo)
	userID := uuid.New()

	if err := h.service.ProcessTransaction(id, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transaction processing started"})
}

func setupRoutes(handler *TransactionHandler) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		
		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	v1 := r.Group("/api/v1")
	{
		transactions := v1.Group("/transactions")
		{
			transactions.POST("", handler.CreateTransaction)
			transactions.GET("", handler.ListTransactions)
			transactions.GET("/:id", handler.GetTransaction)
			transactions.PUT("/:id", handler.UpdateTransaction)
			transactions.POST("/:id/process", handler.ProcessTransaction)
		}
	}

	return r
}

func main() {
	// Database connection
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://remittance:remittance@postgresql:5432/remittance?sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Auto migrate
	if err := db.AutoMigrate(&Transaction{}, &TransactionLimit{}, &TransactionLog{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewTransactionService(db)
	handler := NewTransactionHandler(service)

	// Setup routes
	router := setupRoutes(handler)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("Transaction Processing Service started on port %s", port)

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

