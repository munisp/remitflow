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

// CashPosition represents cash position for an agent
type CashPosition struct {
	ID                uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID           uuid.UUID `json:"agent_id" gorm:"not null;index"`
	Currency          string    `json:"currency" gorm:"not null;default:'USD'"`
	OpeningBalance    float64   `json:"opening_balance" gorm:"not null;default:0"`
	CurrentBalance    float64   `json:"current_balance" gorm:"not null;default:0"`
	ReservedAmount    float64   `json:"reserved_amount" gorm:"not null;default:0"`
	AvailableBalance  float64   `json:"available_balance" gorm:"not null;default:0"`
	MinimumBalance    float64   `json:"minimum_balance" gorm:"not null;default:1000"`
	MaximumBalance    float64   `json:"maximum_balance" gorm:"not null;default:100000"`
	LastReconciled    *time.Time `json:"last_reconciled"`
	Status            CashStatus `json:"status" gorm:"default:'active'"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// CashStatus represents the status of cash position
type CashStatus string

const (
	CashStatusActive    CashStatus = "active"
	CashStatusSuspended CashStatus = "suspended"
	CashStatusFrozen    CashStatus = "frozen"
	CashStatusClosed    CashStatus = "closed"
)

// CashMovement represents cash movements (deposits/withdrawals)
type CashMovement struct {
	ID              uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID         uuid.UUID      `json:"agent_id" gorm:"not null;index"`
	TransactionID   *uuid.UUID     `json:"transaction_id" gorm:"index"`
	MovementRef     string         `json:"movement_ref" gorm:"uniqueIndex;not null"`
	Type            MovementType   `json:"type" gorm:"not null"`
	Amount          float64        `json:"amount" gorm:"not null"`
	Currency        string         `json:"currency" gorm:"not null;default:'USD'"`
	BalanceBefore   float64        `json:"balance_before" gorm:"not null"`
	BalanceAfter    float64        `json:"balance_after" gorm:"not null"`
	Description     string         `json:"description"`
	Source          MovementSource `json:"source" gorm:"not null"`
	Status          MovementStatus `json:"status" gorm:"default:'pending'"`
	ProcessedBy     *uuid.UUID     `json:"processed_by"`
	ProcessedAt     *time.Time     `json:"processed_at"`
	Metadata        JSON           `json:"metadata" gorm:"type:jsonb"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// MovementType represents the type of cash movement
type MovementType string

const (
	MovementTypeDeposit    MovementType = "deposit"
	MovementTypeWithdrawal MovementType = "withdrawal"
	MovementTypeTransfer   MovementType = "transfer"
	MovementTypeAdjustment MovementType = "adjustment"
	MovementTypeReserve    MovementType = "reserve"
	MovementTypeRelease    MovementType = "release"
)

// MovementSource represents the source of cash movement
type MovementSource string

const (
	MovementSourceTransaction MovementSource = "transaction"
	MovementSourceManual      MovementSource = "manual"
	MovementSourceSystem      MovementSource = "system"
	MovementSourceReconciliation MovementSource = "reconciliation"
	MovementSourceTopup       MovementSource = "topup"
)

// MovementStatus represents the status of cash movement
type MovementStatus string

const (
	MovementStatusPending   MovementStatus = "pending"
	MovementStatusCompleted MovementStatus = "completed"
	MovementStatusFailed    MovementStatus = "failed"
	MovementStatusCancelled MovementStatus = "cancelled"
)

// CashReconciliation represents cash reconciliation records
type CashReconciliation struct {
	ID                uuid.UUID           `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID           uuid.UUID           `json:"agent_id" gorm:"not null;index"`
	ReconciliationRef string              `json:"reconciliation_ref" gorm:"uniqueIndex;not null"`
	SystemBalance     float64             `json:"system_balance" gorm:"not null"`
	ReportedBalance   float64             `json:"reported_balance" gorm:"not null"`
	Variance          float64             `json:"variance" gorm:"not null"`
	Currency          string              `json:"currency" gorm:"not null;default:'USD'"`
	Status            ReconciliationStatus `json:"status" gorm:"default:'pending'"`
	ReconciliationType string             `json:"reconciliation_type" gorm:"not null"`
	Notes             string              `json:"notes"`
	ReconciliationDate time.Time          `json:"reconciliation_date" gorm:"not null"`
	ProcessedBy       *uuid.UUID          `json:"processed_by"`
	ProcessedAt       *time.Time          `json:"processed_at"`
	CreatedAt         time.Time           `json:"created_at"`
	UpdatedAt         time.Time           `json:"updated_at"`
}

// ReconciliationStatus represents the status of reconciliation
type ReconciliationStatus string

const (
	ReconciliationStatusPending   ReconciliationStatus = "pending"
	ReconciliationStatusApproved  ReconciliationStatus = "approved"
	ReconciliationStatusRejected  ReconciliationStatus = "rejected"
	ReconciliationStatusInvestigating ReconciliationStatus = "investigating"
)

// CashAlert represents cash-related alerts
type CashAlert struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID     uuid.UUID `json:"agent_id" gorm:"not null;index"`
	AlertType   AlertType `json:"alert_type" gorm:"not null"`
	Severity    AlertSeverity `json:"severity" gorm:"not null"`
	Message     string    `json:"message" gorm:"not null"`
	Amount      *float64  `json:"amount"`
	Threshold   *float64  `json:"threshold"`
	Currency    string    `json:"currency" gorm:"default:'USD'"`
	Status      AlertStatus `json:"status" gorm:"default:'active'"`
	AcknowledgedBy *uuid.UUID `json:"acknowledged_by"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	ResolvedAt  *time.Time `json:"resolved_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AlertType represents the type of alert
type AlertType string

const (
	AlertTypeLowBalance     AlertType = "low_balance"
	AlertTypeHighBalance    AlertType = "high_balance"
	AlertTypeLargeMovement  AlertType = "large_movement"
	AlertTypeReconciliation AlertType = "reconciliation_variance"
	AlertTypeInactivity     AlertType = "inactivity"
	AlertTypeSuspicious     AlertType = "suspicious_activity"
)

// AlertSeverity represents the severity of alert
type AlertSeverity string

const (
	AlertSeverityLow      AlertSeverity = "low"
	AlertSeverityMedium   AlertSeverity = "medium"
	AlertSeverityHigh     AlertSeverity = "high"
	AlertSeverityCritical AlertSeverity = "critical"
)

// AlertStatus represents the status of alert
type AlertStatus string

const (
	AlertStatusActive       AlertStatus = "active"
	AlertStatusAcknowledged AlertStatus = "acknowledged"
	AlertStatusResolved     AlertStatus = "resolved"
	AlertStatusIgnored      AlertStatus = "ignored"
)

// JSON type for JSONB fields
type JSON map[string]interface{}

// Request/Response types
type CreateCashMovementRequest struct {
	AgentID       uuid.UUID      `json:"agent_id" binding:"required"`
	TransactionID *uuid.UUID     `json:"transaction_id"`
	Type          MovementType   `json:"type" binding:"required"`
	Amount        float64        `json:"amount" binding:"required"`
	Currency      string         `json:"currency"`
	Description   string         `json:"description"`
	Source        MovementSource `json:"source" binding:"required"`
	Metadata      JSON           `json:"metadata"`
}

type UpdateCashPositionRequest struct {
	MinimumBalance *float64    `json:"minimum_balance"`
	MaximumBalance *float64    `json:"maximum_balance"`
	Status         *CashStatus `json:"status"`
}

type CreateReconciliationRequest struct {
	AgentID            uuid.UUID `json:"agent_id" binding:"required"`
	ReportedBalance    float64   `json:"reported_balance" binding:"required"`
	Currency           string    `json:"currency"`
	ReconciliationType string    `json:"reconciliation_type" binding:"required"`
	Notes              string    `json:"notes"`
	ReconciliationDate time.Time `json:"reconciliation_date"`
}

// CashService handles cash management operations
type CashService struct {
	db *gorm.DB
}

// NewCashService creates a new cash service
func NewCashService(db *gorm.DB) *CashService {
	return &CashService{db: db}
}

// GetCashPosition retrieves cash position for an agent
func (s *CashService) GetCashPosition(agentID uuid.UUID, currency string) (*CashPosition, error) {
	var position CashPosition
	if err := s.db.Where("agent_id = ? AND currency = ?", agentID, currency).First(&position).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new cash position
			position = CashPosition{
				AgentID:          agentID,
				Currency:         currency,
				OpeningBalance:   0,
				CurrentBalance:   0,
				ReservedAmount:   0,
				AvailableBalance: 0,
				MinimumBalance:   1000,
				MaximumBalance:   100000,
				Status:           CashStatusActive,
			}
			if err := s.db.Create(&position).Error; err != nil {
				return nil, fmt.Errorf("failed to create cash position: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to get cash position: %w", err)
		}
	}
	return &position, nil
}

// CreateCashMovement creates a new cash movement
func (s *CashService) CreateCashMovement(req CreateCashMovementRequest, processedBy uuid.UUID) (*CashMovement, error) {
	// Set default currency
	if req.Currency == "" {
		req.Currency = "USD"
	}

	// Get current cash position
	position, err := s.GetCashPosition(req.AgentID, req.Currency)
	if err != nil {
		return nil, fmt.Errorf("failed to get cash position: %w", err)
	}

	// Check if movement is allowed
	if err := s.validateCashMovement(position, req); err != nil {
		return nil, fmt.Errorf("cash movement validation failed: %w", err)
	}

	// Generate movement reference
	movementRef := generateMovementRef()

	// Calculate new balance
	var newBalance float64
	switch req.Type {
	case MovementTypeDeposit:
		newBalance = position.CurrentBalance + req.Amount
	case MovementTypeWithdrawal:
		newBalance = position.CurrentBalance - req.Amount
	case MovementTypeReserve:
		newBalance = position.CurrentBalance // Balance stays same, but reserved amount increases
	case MovementTypeRelease:
		newBalance = position.CurrentBalance // Balance stays same, but reserved amount decreases
	case MovementTypeAdjustment:
		newBalance = position.CurrentBalance + req.Amount // Can be positive or negative
	default:
		return nil, fmt.Errorf("unsupported movement type: %s", req.Type)
	}

	movement := &CashMovement{
		AgentID:       req.AgentID,
		TransactionID: req.TransactionID,
		MovementRef:   movementRef,
		Type:          req.Type,
		Amount:        req.Amount,
		Currency:      req.Currency,
		BalanceBefore: position.CurrentBalance,
		BalanceAfter:  newBalance,
		Description:   req.Description,
		Source:        req.Source,
		Status:        MovementStatusPending,
		ProcessedBy:   &processedBy,
		Metadata:      req.Metadata,
	}

	// Start transaction
	tx := s.db.Begin()

	// Create movement record
	if err := tx.Create(movement).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create cash movement: %w", err)
	}

	// Update cash position
	updates := map[string]interface{}{
		"current_balance": newBalance,
		"updated_at":      time.Now(),
	}

	// Handle reserved amount for reserve/release movements
	if req.Type == MovementTypeReserve {
		updates["reserved_amount"] = gorm.Expr("reserved_amount + ?", req.Amount)
	} else if req.Type == MovementTypeRelease {
		updates["reserved_amount"] = gorm.Expr("reserved_amount - ?", req.Amount)
	}

	// Calculate available balance
	availableBalance := newBalance - position.ReservedAmount
	if req.Type == MovementTypeReserve {
		availableBalance = newBalance - (position.ReservedAmount + req.Amount)
	} else if req.Type == MovementTypeRelease {
		availableBalance = newBalance - (position.ReservedAmount - req.Amount)
	}
	updates["available_balance"] = availableBalance

	if err := tx.Model(&CashPosition{}).Where("agent_id = ? AND currency = ?", req.AgentID, req.Currency).Updates(updates).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to update cash position: %w", err)
	}

	// Mark movement as completed
	movement.Status = MovementStatusCompleted
	now := time.Now()
	movement.ProcessedAt = &now
	if err := tx.Save(movement).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to update movement status: %w", err)
	}

	tx.Commit()

	// Check for alerts
	s.checkCashAlerts(req.AgentID, req.Currency, newBalance, req.Amount, req.Type)

	return movement, nil
}

// ListCashMovements retrieves cash movements with pagination and filters
func (s *CashService) ListCashMovements(page, limit int, agentID *uuid.UUID, movementType MovementType, source MovementSource, startDate, endDate *time.Time) ([]CashMovement, int64, error) {
	var movements []CashMovement
	var total int64

	query := s.db.Model(&CashMovement{})

	// Apply filters
	if agentID != nil {
		query = query.Where("agent_id = ?", *agentID)
	}
	if movementType != "" {
		query = query.Where("type = ?", movementType)
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count cash movements: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&movements).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list cash movements: %w", err)
	}

	return movements, total, nil
}

// CreateReconciliation creates a new cash reconciliation
func (s *CashService) CreateReconciliation(req CreateReconciliationRequest, processedBy uuid.UUID) (*CashReconciliation, error) {
	// Set default currency
	if req.Currency == "" {
		req.Currency = "USD"
	}

	// Set default reconciliation date
	if req.ReconciliationDate.IsZero() {
		req.ReconciliationDate = time.Now()
	}

	// Get current system balance
	position, err := s.GetCashPosition(req.AgentID, req.Currency)
	if err != nil {
		return nil, fmt.Errorf("failed to get cash position: %w", err)
	}

	// Calculate variance
	variance := req.ReportedBalance - position.CurrentBalance

	// Generate reconciliation reference
	reconciliationRef := generateReconciliationRef()

	reconciliation := &CashReconciliation{
		AgentID:            req.AgentID,
		ReconciliationRef:  reconciliationRef,
		SystemBalance:      position.CurrentBalance,
		ReportedBalance:    req.ReportedBalance,
		Variance:           variance,
		Currency:           req.Currency,
		Status:             ReconciliationStatusPending,
		ReconciliationType: req.ReconciliationType,
		Notes:              req.Notes,
		ReconciliationDate: req.ReconciliationDate,
		ProcessedBy:        &processedBy,
	}

	if err := s.db.Create(reconciliation).Error; err != nil {
		return nil, fmt.Errorf("failed to create reconciliation: %w", err)
	}

	// Create alert if variance is significant
	if variance != 0 {
		s.createReconciliationAlert(req.AgentID, variance, req.Currency)
	}

	return reconciliation, nil
}

// GetCashAlerts retrieves cash alerts for an agent
func (s *CashService) GetCashAlerts(agentID uuid.UUID, status AlertStatus) ([]CashAlert, error) {
	var alerts []CashAlert
	query := s.db.Where("agent_id = ?", agentID)
	
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Order("created_at DESC").Find(&alerts).Error; err != nil {
		return nil, fmt.Errorf("failed to get cash alerts: %w", err)
	}

	return alerts, nil
}

// validateCashMovement validates if a cash movement is allowed
func (s *CashService) validateCashMovement(position *CashPosition, req CreateCashMovementRequest) error {
	if position.Status != CashStatusActive {
		return fmt.Errorf("cash position is not active")
	}

	switch req.Type {
	case MovementTypeWithdrawal:
		if position.AvailableBalance < req.Amount {
			return fmt.Errorf("insufficient available balance")
		}
		if position.CurrentBalance-req.Amount < position.MinimumBalance {
			return fmt.Errorf("withdrawal would breach minimum balance")
		}
	case MovementTypeDeposit:
		if position.CurrentBalance+req.Amount > position.MaximumBalance {
			return fmt.Errorf("deposit would breach maximum balance")
		}
	case MovementTypeReserve:
		if position.AvailableBalance < req.Amount {
			return fmt.Errorf("insufficient available balance to reserve")
		}
	case MovementTypeRelease:
		if position.ReservedAmount < req.Amount {
			return fmt.Errorf("insufficient reserved amount to release")
		}
	}

	return nil
}

// checkCashAlerts checks for cash-related alerts
func (s *CashService) checkCashAlerts(agentID uuid.UUID, currency string, newBalance, amount float64, movementType MovementType) {
	position, err := s.GetCashPosition(agentID, currency)
	if err != nil {
		return
	}

	// Low balance alert
	if newBalance < position.MinimumBalance*1.1 { // 10% above minimum
		s.createAlert(agentID, AlertTypeLowBalance, AlertSeverityMedium, 
			fmt.Sprintf("Balance is approaching minimum threshold"), &newBalance, &position.MinimumBalance, currency)
	}

	// High balance alert
	if newBalance > position.MaximumBalance*0.9 { // 90% of maximum
		s.createAlert(agentID, AlertTypeHighBalance, AlertSeverityMedium,
			fmt.Sprintf("Balance is approaching maximum threshold"), &newBalance, &position.MaximumBalance, currency)
	}

	// Large movement alert
	if amount > 10000 { // Configurable threshold
		severity := AlertSeverityMedium
		if amount > 50000 {
			severity = AlertSeverityHigh
		}
		s.createAlert(agentID, AlertTypeLargeMovement, severity,
			fmt.Sprintf("Large %s movement detected", movementType), &amount, nil, currency)
	}
}

// createAlert creates a new cash alert
func (s *CashService) createAlert(agentID uuid.UUID, alertType AlertType, severity AlertSeverity, message string, amount, threshold *float64, currency string) {
	alert := CashAlert{
		AgentID:   agentID,
		AlertType: alertType,
		Severity:  severity,
		Message:   message,
		Amount:    amount,
		Threshold: threshold,
		Currency:  currency,
		Status:    AlertStatusActive,
	}
	s.db.Create(&alert)
}

// createReconciliationAlert creates an alert for reconciliation variance
func (s *CashService) createReconciliationAlert(agentID uuid.UUID, variance float64, currency string) {
	severity := AlertSeverityLow
	if variance > 1000 {
		severity = AlertSeverityMedium
	}
	if variance > 5000 {
		severity = AlertSeverityHigh
	}

	message := fmt.Sprintf("Reconciliation variance detected: %.2f %s", variance, currency)
	s.createAlert(agentID, AlertTypeReconciliation, severity, message, &variance, nil, currency)
}

// Helper functions
func generateMovementRef() string {
	return fmt.Sprintf("MOV%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

func generateReconciliationRef() string {
	return fmt.Sprintf("REC%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	cashMovementTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "cash_movement_total",
			Help: "Total number of cash movements",
		},
		[]string{"type", "source", "currency"},
	)

	cashBalanceGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "cash_balance_current",
			Help: "Current cash balance by agent and currency",
		},
		[]string{"agent_id", "currency"},
	)

	cashAlertTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "cash_alert_total",
			Help: "Total number of cash alerts",
		},
		[]string{"type", "severity"},
	)

	cashRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "cash_request_duration_seconds",
			Help: "Duration of cash management requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(cashMovementTotal)
	prometheus.MustRegister(cashBalanceGauge)
	prometheus.MustRegister(cashAlertTotal)
	prometheus.MustRegister(cashRequestDuration)
}

// HTTP Handlers
type CashHandler struct {
	service *CashService
}

func NewCashHandler(service *CashService) *CashHandler {
	return &CashHandler{service: service}
}

func (h *CashHandler) GetCashPosition(c *gin.Context) {
	timer := prometheus.NewTimer(cashRequestDuration.WithLabelValues("GET", "/agents/:id/cash-position"))
	defer timer.ObserveDuration()

	agentIDStr := c.Param("id")
	agentID, err := uuid.Parse(agentIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid agent ID"})
		return
	}

	currency := c.DefaultQuery("currency", "USD")

	position, err := h.service.GetCashPosition(agentID, currency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Update metrics
	cashBalanceGauge.WithLabelValues(agentID.String(), currency).Set(position.CurrentBalance)

	c.JSON(http.StatusOK, position)
}

func (h *CashHandler) CreateCashMovement(c *gin.Context) {
	timer := prometheus.NewTimer(cashRequestDuration.WithLabelValues("POST", "/cash-movements"))
	defer timer.ObserveDuration()

	var req CreateCashMovementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get processed_by from JWT token (simplified for demo)
	processedBy := uuid.New()

	movement, err := h.service.CreateCashMovement(req, processedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cashMovementTotal.WithLabelValues(string(movement.Type), string(movement.Source), movement.Currency).Inc()

	c.JSON(http.StatusCreated, movement)
}

func (h *CashHandler) ListCashMovements(c *gin.Context) {
	timer := prometheus.NewTimer(cashRequestDuration.WithLabelValues("GET", "/cash-movements"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	var agentID *uuid.UUID
	if agentIDStr := c.Query("agent_id"); agentIDStr != "" {
		if id, err := uuid.Parse(agentIDStr); err == nil {
			agentID = &id
		}
	}

	movementType := MovementType(c.Query("type"))
	source := MovementSource(c.Query("source"))

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

	movements, total, err := h.service.ListCashMovements(page, limit, agentID, movementType, source, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"movements": movements,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

func (h *CashHandler) CreateReconciliation(c *gin.Context) {
	timer := prometheus.NewTimer(cashRequestDuration.WithLabelValues("POST", "/reconciliations"))
	defer timer.ObserveDuration()

	var req CreateReconciliationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get processed_by from JWT token (simplified for demo)
	processedBy := uuid.New()

	reconciliation, err := h.service.CreateReconciliation(req, processedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, reconciliation)
}

func (h *CashHandler) GetCashAlerts(c *gin.Context) {
	timer := prometheus.NewTimer(cashRequestDuration.WithLabelValues("GET", "/agents/:id/alerts"))
	defer timer.ObserveDuration()

	agentIDStr := c.Param("id")
	agentID, err := uuid.Parse(agentIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid agent ID"})
		return
	}

	status := AlertStatus(c.Query("status"))

	alerts, err := h.service.GetCashAlerts(agentID, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

func setupRoutes(handler *CashHandler) *gin.Engine {
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
		agents := v1.Group("/agents")
		{
			agents.GET("/:id/cash-position", handler.GetCashPosition)
			agents.GET("/:id/alerts", handler.GetCashAlerts)
		}

		v1.POST("/cash-movements", handler.CreateCashMovement)
		v1.GET("/cash-movements", handler.ListCashMovements)
		v1.POST("/reconciliations", handler.CreateReconciliation)
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
	if err := db.AutoMigrate(&CashPosition{}, &CashMovement{}, &CashReconciliation{}, &CashAlert{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewCashService(db)
	handler := NewCashHandler(service)

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

	log.Printf("Cash Management Service started on port %s", port)

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

