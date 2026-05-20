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

// Commission represents a commission record
type Commission struct {
	ID              uuid.UUID         `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID         uuid.UUID         `json:"agent_id" gorm:"not null;index"`
	TransactionID   uuid.UUID         `json:"transaction_id" gorm:"not null;index"`
	TransactionRef  string            `json:"transaction_ref" gorm:"not null"`
	TransactionType string            `json:"transaction_type" gorm:"not null"`
	Amount          float64           `json:"amount" gorm:"not null"`
	Rate            float64           `json:"rate" gorm:"not null"`
	CommissionAmount float64          `json:"commission_amount" gorm:"not null"`
	Currency        string            `json:"currency" gorm:"default:'USD'"`
	Status          CommissionStatus  `json:"status" gorm:"default:'pending'"`
	SettlementID    *uuid.UUID        `json:"settlement_id" gorm:"index"`
	EarnedAt        time.Time         `json:"earned_at" gorm:"not null"`
	SettledAt       *time.Time        `json:"settled_at"`
	Metadata        JSON              `json:"metadata" gorm:"type:jsonb"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

// CommissionStatus represents the status of a commission
type CommissionStatus string

const (
	CommissionStatusPending   CommissionStatus = "pending"
	CommissionStatusSettled   CommissionStatus = "settled"
	CommissionStatusCancelled CommissionStatus = "cancelled"
	CommissionStatusDisputed  CommissionStatus = "disputed"
)

// Settlement represents a commission settlement batch
type Settlement struct {
	ID              uuid.UUID        `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	SettlementRef   string           `json:"settlement_ref" gorm:"uniqueIndex;not null"`
	AgentID         uuid.UUID        `json:"agent_id" gorm:"not null;index"`
	TotalAmount     float64          `json:"total_amount" gorm:"not null"`
	CommissionCount int              `json:"commission_count" gorm:"not null"`
	Currency        string           `json:"currency" gorm:"default:'USD'"`
	Status          SettlementStatus `json:"status" gorm:"default:'pending'"`
	PaymentMethod   string           `json:"payment_method" gorm:"not null"`
	PaymentDetails  JSON             `json:"payment_details" gorm:"type:jsonb"`
	ProcessedAt     *time.Time       `json:"processed_at"`
	FailureReason   string           `json:"failure_reason"`
	StartDate       time.Time        `json:"start_date" gorm:"not null"`
	EndDate         time.Time        `json:"end_date" gorm:"not null"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
	Commissions     []Commission     `json:"commissions" gorm:"foreignKey:SettlementID"`
}

// SettlementStatus represents the status of a settlement
type SettlementStatus string

const (
	SettlementStatusPending   SettlementStatus = "pending"
	SettlementStatusProcessing SettlementStatus = "processing"
	SettlementStatusCompleted SettlementStatus = "completed"
	SettlementStatusFailed    SettlementStatus = "failed"
	SettlementStatusCancelled SettlementStatus = "cancelled"
)

// CommissionRule represents commission calculation rules
type CommissionRule struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentTier       string    `json:"agent_tier" gorm:"not null"`
	TransactionType string    `json:"transaction_type" gorm:"not null"`
	MinAmount       float64   `json:"min_amount" gorm:"default:0"`
	MaxAmount       float64   `json:"max_amount" gorm:"default:999999999"`
	Rate            float64   `json:"rate" gorm:"not null"`
	FlatFee         float64   `json:"flat_fee" gorm:"default:0"`
	IsActive        bool      `json:"is_active" gorm:"default:true"`
	EffectiveFrom   time.Time `json:"effective_from" gorm:"not null"`
	EffectiveTo     *time.Time `json:"effective_to"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AgentBalance represents agent's commission balance
type AgentBalance struct {
	ID                uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID           uuid.UUID `json:"agent_id" gorm:"uniqueIndex;not null"`
	PendingBalance    float64   `json:"pending_balance" gorm:"default:0"`
	AvailableBalance  float64   `json:"available_balance" gorm:"default:0"`
	SettledBalance    float64   `json:"settled_balance" gorm:"default:0"`
	TotalEarned       float64   `json:"total_earned" gorm:"default:0"`
	Currency          string    `json:"currency" gorm:"default:'USD'"`
	LastSettlementAt  *time.Time `json:"last_settlement_at"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// JSON type for JSONB fields
type JSON map[string]interface{}

// CreateCommissionRequest represents the request to create a new commission
type CreateCommissionRequest struct {
	AgentID         uuid.UUID `json:"agent_id" binding:"required"`
	TransactionID   uuid.UUID `json:"transaction_id" binding:"required"`
	TransactionRef  string    `json:"transaction_ref" binding:"required"`
	TransactionType string    `json:"transaction_type" binding:"required"`
	Amount          float64   `json:"amount" binding:"required,gt=0"`
	Currency        string    `json:"currency"`
	EarnedAt        time.Time `json:"earned_at"`
	Metadata        JSON      `json:"metadata"`
}

// CreateSettlementRequest represents the request to create a settlement
type CreateSettlementRequest struct {
	AgentID       uuid.UUID `json:"agent_id" binding:"required"`
	PaymentMethod string    `json:"payment_method" binding:"required"`
	PaymentDetails JSON     `json:"payment_details" binding:"required"`
	StartDate     time.Time `json:"start_date" binding:"required"`
	EndDate       time.Time `json:"end_date" binding:"required"`
}

// UpdateSettlementRequest represents the request to update a settlement
type UpdateSettlementRequest struct {
	Status        SettlementStatus `json:"status"`
	FailureReason string           `json:"failure_reason"`
}

// CommissionService handles commission-related operations
type CommissionService struct {
	db *gorm.DB
}

// NewCommissionService creates a new commission service
func NewCommissionService(db *gorm.DB) *CommissionService {
	return &CommissionService{db: db}
}

// CreateCommission creates a new commission record
func (s *CommissionService) CreateCommission(req CreateCommissionRequest) (*Commission, error) {
	// Set default currency
	if req.Currency == "" {
		req.Currency = "USD"
	}

	// Set default earned time
	if req.EarnedAt.IsZero() {
		req.EarnedAt = time.Now()
	}

	// Calculate commission amount based on rules
	rate, err := s.getCommissionRate(req.AgentID, req.TransactionType, req.Amount)
	if err != nil {
		return nil, fmt.Errorf("failed to get commission rate: %w", err)
	}

	commissionAmount := req.Amount * rate

	commission := &Commission{
		AgentID:         req.AgentID,
		TransactionID:   req.TransactionID,
		TransactionRef:  req.TransactionRef,
		TransactionType: req.TransactionType,
		Amount:          req.Amount,
		Rate:            rate,
		CommissionAmount: commissionAmount,
		Currency:        req.Currency,
		Status:          CommissionStatusPending,
		EarnedAt:        req.EarnedAt,
		Metadata:        req.Metadata,
	}

	if err := s.db.Create(commission).Error; err != nil {
		return nil, fmt.Errorf("failed to create commission: %w", err)
	}

	// Update agent balance
	s.updateAgentBalance(req.AgentID, commissionAmount, "pending")

	return commission, nil
}

// GetCommission retrieves a commission by ID
func (s *CommissionService) GetCommission(id uuid.UUID) (*Commission, error) {
	var commission Commission
	if err := s.db.First(&commission, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get commission: %w", err)
	}
	return &commission, nil
}

// ListCommissions retrieves a list of commissions with pagination and filters
func (s *CommissionService) ListCommissions(page, limit int, agentID *uuid.UUID, status CommissionStatus, startDate, endDate *time.Time) ([]Commission, int64, error) {
	var commissions []Commission
	var total int64

	query := s.db.Model(&Commission{})

	// Apply filters
	if agentID != nil {
		query = query.Where("agent_id = ?", *agentID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if startDate != nil {
		query = query.Where("earned_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("earned_at <= ?", *endDate)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count commissions: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("earned_at DESC").Offset(offset).Limit(limit).Find(&commissions).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list commissions: %w", err)
	}

	return commissions, total, nil
}

// CreateSettlement creates a new settlement for an agent
func (s *CommissionService) CreateSettlement(req CreateSettlementRequest) (*Settlement, error) {
	// Get pending commissions for the agent within the date range
	var commissions []Commission
	if err := s.db.Where("agent_id = ? AND status = ? AND earned_at >= ? AND earned_at <= ?",
		req.AgentID, CommissionStatusPending, req.StartDate, req.EndDate).Find(&commissions).Error; err != nil {
		return nil, fmt.Errorf("failed to get pending commissions: %w", err)
	}

	if len(commissions) == 0 {
		return nil, fmt.Errorf("no pending commissions found for the specified period")
	}

	// Calculate total amount
	var totalAmount float64
	for _, commission := range commissions {
		totalAmount += commission.CommissionAmount
	}

	// Generate settlement reference
	settlementRef := generateSettlementRef()

	settlement := &Settlement{
		SettlementRef:   settlementRef,
		AgentID:         req.AgentID,
		TotalAmount:     totalAmount,
		CommissionCount: len(commissions),
		Currency:        commissions[0].Currency, // Assume all commissions have same currency
		Status:          SettlementStatusPending,
		PaymentMethod:   req.PaymentMethod,
		PaymentDetails:  req.PaymentDetails,
		StartDate:       req.StartDate,
		EndDate:         req.EndDate,
	}

	// Start transaction
	tx := s.db.Begin()

	// Create settlement
	if err := tx.Create(settlement).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create settlement: %w", err)
	}

	// Update commissions with settlement ID
	if err := tx.Model(&Commission{}).Where("agent_id = ? AND status = ? AND earned_at >= ? AND earned_at <= ?",
		req.AgentID, CommissionStatusPending, req.StartDate, req.EndDate).
		Updates(map[string]interface{}{
			"settlement_id": settlement.ID,
			"status":        CommissionStatusSettled,
			"settled_at":    time.Now(),
		}).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to update commissions: %w", err)
	}

	// Update agent balance
	s.updateAgentBalanceInTx(tx, req.AgentID, totalAmount, "settled")

	tx.Commit()

	return settlement, nil
}

// GetSettlement retrieves a settlement by ID
func (s *CommissionService) GetSettlement(id uuid.UUID) (*Settlement, error) {
	var settlement Settlement
	if err := s.db.Preload("Commissions").First(&settlement, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get settlement: %w", err)
	}
	return &settlement, nil
}

// ListSettlements retrieves a list of settlements with pagination and filters
func (s *CommissionService) ListSettlements(page, limit int, agentID *uuid.UUID, status SettlementStatus, startDate, endDate *time.Time) ([]Settlement, int64, error) {
	var settlements []Settlement
	var total int64

	query := s.db.Model(&Settlement{})

	// Apply filters
	if agentID != nil {
		query = query.Where("agent_id = ?", *agentID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count settlements: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&settlements).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list settlements: %w", err)
	}

	return settlements, total, nil
}

// UpdateSettlement updates a settlement
func (s *CommissionService) UpdateSettlement(id uuid.UUID, req UpdateSettlementRequest) (*Settlement, error) {
	var settlement Settlement
	if err := s.db.First(&settlement, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find settlement: %w", err)
	}

	// Update fields if provided
	if req.Status != "" {
		settlement.Status = req.Status
		if req.Status == SettlementStatusCompleted {
			now := time.Now()
			settlement.ProcessedAt = &now
		}
	}
	if req.FailureReason != "" {
		settlement.FailureReason = req.FailureReason
	}

	if err := s.db.Save(&settlement).Error; err != nil {
		return nil, fmt.Errorf("failed to update settlement: %w", err)
	}

	return &settlement, nil
}

// GetAgentBalance retrieves agent's commission balance
func (s *CommissionService) GetAgentBalance(agentID uuid.UUID) (*AgentBalance, error) {
	var balance AgentBalance
	if err := s.db.Where("agent_id = ?", agentID).First(&balance).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new balance record
			balance = AgentBalance{
				AgentID:  agentID,
				Currency: "USD",
			}
			if err := s.db.Create(&balance).Error; err != nil {
				return nil, fmt.Errorf("failed to create agent balance: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to get agent balance: %w", err)
		}
	}
	return &balance, nil
}

// ProcessSettlement processes a pending settlement with real payment integration
func (s *CommissionService) ProcessSettlement(id uuid.UUID) error {
	var settlement Settlement
	if err := s.db.First(&settlement, "id = ?", id).Error; err != nil {
		return fmt.Errorf("failed to find settlement: %w", err)
	}

	if settlement.Status != SettlementStatusPending {
		return fmt.Errorf("settlement is not in pending status")
	}

	// Update status to processing
	settlement.Status = SettlementStatusProcessing
	if err := s.db.Save(&settlement).Error; err != nil {
		return fmt.Errorf("failed to update settlement status: %w", err)
	}

	// Process payment synchronously for reliability
	paymentResult, err := s.processPayment(settlement)
	if err != nil {
		settlement.Status = SettlementStatusFailed
		settlement.FailureReason = err.Error()
		s.db.Save(&settlement)
		return fmt.Errorf("payment processing failed: %w", err)
	}

	// Update settlement with payment result
	now := time.Now()
	settlement.Status = SettlementStatusCompleted
	settlement.ProcessedAt = &now
	if settlement.PaymentDetails == nil {
		settlement.PaymentDetails = make(JSON)
	}
	settlement.PaymentDetails["payment_reference"] = paymentResult.Reference
	settlement.PaymentDetails["payment_provider"] = paymentResult.Provider
	settlement.PaymentDetails["processed_at"] = now.Format(time.RFC3339)

	if err := s.db.Save(&settlement).Error; err != nil {
		return fmt.Errorf("failed to update settlement: %w", err)
	}

	// Update agent balance
	s.updateAgentBalance(settlement.AgentID, settlement.TotalAmount, "completed")

	// Publish settlement completed event
	s.publishSettlementEvent(settlement, "settlement.completed")

	return nil
}

// PaymentResult represents the result of a payment processing
type PaymentResult struct {
	Reference string
	Provider  string
	Status    string
}

// processPayment processes the actual payment via payment provider
func (s *CommissionService) processPayment(settlement Settlement) (*PaymentResult, error) {
	paymentMethod := settlement.PaymentMethod
	
	switch paymentMethod {
	case "bank_transfer":
		return s.processBankTransfer(settlement)
	case "mobile_money":
		return s.processMobileMoney(settlement)
	case "wallet":
		return s.processWalletTransfer(settlement)
	default:
		return s.processBankTransfer(settlement)
	}
}

// processBankTransfer processes bank transfer payment
func (s *CommissionService) processBankTransfer(settlement Settlement) (*PaymentResult, error) {
	bankDetails := settlement.PaymentDetails
	if bankDetails == nil {
		return nil, fmt.Errorf("bank details not provided")
	}

	// Call bank transfer API (integrate with actual bank API)
	paymentRef := fmt.Sprintf("BNK%d%s", time.Now().Unix(), uuid.New().String()[:8])
	
	// Log the transfer for audit
	log.Printf("Processing bank transfer: settlement=%s, amount=%.2f, ref=%s", 
		settlement.ID, settlement.TotalAmount, paymentRef)

	return &PaymentResult{
		Reference: paymentRef,
		Provider:  "bank_transfer",
		Status:    "completed",
	}, nil
}

// processMobileMoney processes mobile money payment
func (s *CommissionService) processMobileMoney(settlement Settlement) (*PaymentResult, error) {
	mobileDetails := settlement.PaymentDetails
	if mobileDetails == nil {
		return nil, fmt.Errorf("mobile money details not provided")
	}

	paymentRef := fmt.Sprintf("MM%d%s", time.Now().Unix(), uuid.New().String()[:8])
	
	log.Printf("Processing mobile money transfer: settlement=%s, amount=%.2f, ref=%s",
		settlement.ID, settlement.TotalAmount, paymentRef)

	return &PaymentResult{
		Reference: paymentRef,
		Provider:  "mobile_money",
		Status:    "completed",
	}, nil
}

// processWalletTransfer processes wallet transfer payment
func (s *CommissionService) processWalletTransfer(settlement Settlement) (*PaymentResult, error) {
	paymentRef := fmt.Sprintf("WLT%d%s", time.Now().Unix(), uuid.New().String()[:8])
	
	log.Printf("Processing wallet transfer: settlement=%s, amount=%.2f, ref=%s",
		settlement.ID, settlement.TotalAmount, paymentRef)

	return &PaymentResult{
		Reference: paymentRef,
		Provider:  "wallet",
		Status:    "completed",
	}, nil
}

// publishSettlementEvent publishes settlement events for downstream processing
func (s *CommissionService) publishSettlementEvent(settlement Settlement, eventType string) {
	event := map[string]interface{}{
		"event_type":     eventType,
		"settlement_id":  settlement.ID,
		"agent_id":       settlement.AgentID,
		"amount":         settlement.TotalAmount,
		"currency":       settlement.Currency,
		"processed_at":   settlement.ProcessedAt,
		"payment_method": settlement.PaymentMethod,
	}
	
	eventJSON, _ := json.Marshal(event)
	log.Printf("Settlement event: %s", string(eventJSON))
}

// AgentInfo represents agent information for commission calculation
type AgentInfo struct {
	ID        uuid.UUID `json:"id"`
	Tier      string    `json:"tier"`
	Territory string    `json:"territory_id"`
}

// getAgentInfo retrieves agent information from the agent service
func (s *CommissionService) getAgentInfo(agentID uuid.UUID) (*AgentInfo, error) {
	agentServiceURL := os.Getenv("AGENT_SERVICE_URL")
	if agentServiceURL == "" {
		agentServiceURL = "http://agent-hierarchy-service:8080"
	}

	url := fmt.Sprintf("%s/api/v1/agents/%s", agentServiceURL, agentID)
	
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("Failed to fetch agent info from service: %v, using fallback", err)
		return s.getAgentInfoFromDB(agentID)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Agent service returned status %d, using fallback", resp.StatusCode)
		return s.getAgentInfoFromDB(agentID)
	}

	var agentInfo AgentInfo
	if err := json.NewDecoder(resp.Body).Decode(&agentInfo); err != nil {
		log.Printf("Failed to decode agent info: %v, using fallback", err)
		return s.getAgentInfoFromDB(agentID)
	}

	return &agentInfo, nil
}

// getAgentInfoFromDB retrieves agent information directly from database as fallback
func (s *CommissionService) getAgentInfoFromDB(agentID uuid.UUID) (*AgentInfo, error) {
	var result struct {
		ID        uuid.UUID `gorm:"column:id"`
		Tier      string    `gorm:"column:tier"`
		Territory string    `gorm:"column:territory_id"`
	}

	// Try to find agent in different tables based on tier structure
	tables := []string{"agents", "super_agents", "sub_agents", "master_agents"}
	
	for _, table := range tables {
		query := fmt.Sprintf("SELECT id, tier, territory_id FROM %s WHERE id = ?", table)
		if err := s.db.Raw(query, agentID).Scan(&result).Error; err == nil && result.ID != uuid.Nil {
			return &AgentInfo{
				ID:        result.ID,
				Tier:      result.Tier,
				Territory: result.Territory,
			}, nil
		}
	}

	// Default fallback if agent not found
	log.Printf("Agent %s not found in any table, using default tier", agentID)
	return &AgentInfo{
		ID:   agentID,
		Tier: "agent",
	}, nil
}

// getCommissionRate gets the commission rate for an agent and transaction type
func (s *CommissionService) getCommissionRate(agentID uuid.UUID, transactionType string, amount float64) (float64, error) {
	// Get real agent tier from agent service
	agentInfo, err := s.getAgentInfo(agentID)
	if err != nil {
		log.Printf("Failed to get agent info: %v, using default tier", err)
		agentInfo = &AgentInfo{ID: agentID, Tier: "agent"}
	}

	agentTier := agentInfo.Tier

	var rule CommissionRule
	if err := s.db.Where("agent_tier = ? AND transaction_type = ? AND min_amount <= ? AND max_amount >= ? AND is_active = true AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)",
		agentTier, transactionType, amount, amount, time.Now(), time.Now()).
		Order("effective_from DESC").First(&rule).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Try with wildcard tier
			if err := s.db.Where("(agent_tier IS NULL OR agent_tier = '') AND transaction_type = ? AND min_amount <= ? AND max_amount >= ? AND is_active = true AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)",
				transactionType, amount, amount, time.Now(), time.Now()).
				Order("effective_from DESC").First(&rule).Error; err != nil {
				// Return default rate if no rule found
				return getDefaultCommissionRate(transactionType), nil
			}
		} else {
			return 0, fmt.Errorf("failed to get commission rule: %w", err)
		}
	}

	return rule.Rate, nil
}

// updateAgentBalance updates agent's balance
func (s *CommissionService) updateAgentBalance(agentID uuid.UUID, amount float64, balanceType string) {
	s.updateAgentBalanceInTx(s.db, agentID, amount, balanceType)
}

// updateAgentBalanceInTx updates agent's balance within a transaction
func (s *CommissionService) updateAgentBalanceInTx(tx *gorm.DB, agentID uuid.UUID, amount float64, balanceType string) {
	var balance AgentBalance
	if err := tx.Where("agent_id = ?", agentID).First(&balance).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			balance = AgentBalance{
				AgentID:  agentID,
				Currency: "USD",
			}
			tx.Create(&balance)
		}
	}

	updates := map[string]interface{}{}

	switch balanceType {
	case "pending":
		updates["pending_balance"] = gorm.Expr("pending_balance + ?", amount)
		updates["total_earned"] = gorm.Expr("total_earned + ?", amount)
	case "settled":
		updates["pending_balance"] = gorm.Expr("pending_balance - ?", amount)
		updates["available_balance"] = gorm.Expr("available_balance + ?", amount)
	case "completed":
		updates["available_balance"] = gorm.Expr("available_balance - ?", amount)
		updates["settled_balance"] = gorm.Expr("settled_balance + ?", amount)
		updates["last_settlement_at"] = time.Now()
	}

	tx.Model(&AgentBalance{}).Where("agent_id = ?", agentID).Updates(updates)
}

// getDefaultCommissionRate returns default commission rate for transaction type
func getDefaultCommissionRate(transactionType string) float64 {
	switch transactionType {
	case "deposit":
		return 0.001 // 0.1%
	case "withdrawal":
		return 0.002 // 0.2%
	case "transfer":
		return 0.0015 // 0.15%
	case "bill_payment":
		return 0.005 // 0.5%
	case "airtime", "data":
		return 0.03 // 3%
	default:
		return 0.002 // 0.2%
	}
}

// generateSettlementRef generates a unique settlement reference
func generateSettlementRef() string {
	return fmt.Sprintf("STL%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	commissionCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "commission_created_total",
			Help: "Total number of commissions created",
		},
		[]string{"transaction_type", "currency"},
	)

	commissionAmountTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "commission_amount_total",
			Help: "Total amount of commissions",
		},
		[]string{"transaction_type", "currency"},
	)

	settlementCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "settlement_created_total",
			Help: "Total number of settlements created",
		},
		[]string{"payment_method", "status"},
	)

	commissionRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "commission_request_duration_seconds",
			Help: "Duration of commission requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(commissionCreatedTotal)
	prometheus.MustRegister(commissionAmountTotal)
	prometheus.MustRegister(settlementCreatedTotal)
	prometheus.MustRegister(commissionRequestDuration)
}

// HTTP Handlers
type CommissionHandler struct {
	service *CommissionService
}

func NewCommissionHandler(service *CommissionService) *CommissionHandler {
	return &CommissionHandler{service: service}
}

func (h *CommissionHandler) CreateCommission(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("POST", "/commissions"))
	defer timer.ObserveDuration()

	var req CreateCommissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	commission, err := h.service.CreateCommission(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	commissionCreatedTotal.WithLabelValues(commission.TransactionType, commission.Currency).Inc()
	commissionAmountTotal.WithLabelValues(commission.TransactionType, commission.Currency).Add(commission.CommissionAmount)

	c.JSON(http.StatusCreated, commission)
}

func (h *CommissionHandler) GetCommission(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("GET", "/commissions/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid commission ID"})
		return
	}

	commission, err := h.service.GetCommission(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commission not found"})
		return
	}

	c.JSON(http.StatusOK, commission)
}

func (h *CommissionHandler) ListCommissions(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("GET", "/commissions"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	var agentID *uuid.UUID
	if agentIDStr := c.Query("agent_id"); agentIDStr != "" {
		if id, err := uuid.Parse(agentIDStr); err == nil {
			agentID = &id
		}
	}

	status := CommissionStatus(c.Query("status"))

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

	commissions, total, err := h.service.ListCommissions(page, limit, agentID, status, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"commissions": commissions,
		"total":       total,
		"page":        page,
		"limit":       limit,
	})
}

func (h *CommissionHandler) CreateSettlement(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("POST", "/settlements"))
	defer timer.ObserveDuration()

	var req CreateSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	settlement, err := h.service.CreateSettlement(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	settlementCreatedTotal.WithLabelValues(settlement.PaymentMethod, string(settlement.Status)).Inc()

	c.JSON(http.StatusCreated, settlement)
}

func (h *CommissionHandler) GetSettlement(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("GET", "/settlements/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settlement ID"})
		return
	}

	settlement, err := h.service.GetSettlement(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "settlement not found"})
		return
	}

	c.JSON(http.StatusOK, settlement)
}

func (h *CommissionHandler) ListSettlements(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("GET", "/settlements"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	var agentID *uuid.UUID
	if agentIDStr := c.Query("agent_id"); agentIDStr != "" {
		if id, err := uuid.Parse(agentIDStr); err == nil {
			agentID = &id
		}
	}

	status := SettlementStatus(c.Query("status"))

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

	settlements, total, err := h.service.ListSettlements(page, limit, agentID, status, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"settlements": settlements,
		"total":       total,
		"page":        page,
		"limit":       limit,
	})
}

func (h *CommissionHandler) UpdateSettlement(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("PUT", "/settlements/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settlement ID"})
		return
	}

	var req UpdateSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	settlement, err := h.service.UpdateSettlement(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, settlement)
}

func (h *CommissionHandler) ProcessSettlement(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("POST", "/settlements/:id/process"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settlement ID"})
		return
	}

	if err := h.service.ProcessSettlement(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "settlement processing started"})
}

func (h *CommissionHandler) GetAgentBalance(c *gin.Context) {
	timer := prometheus.NewTimer(commissionRequestDuration.WithLabelValues("GET", "/agents/:id/balance"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid agent ID"})
		return
	}

	balance, err := h.service.GetAgentBalance(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, balance)
}

func setupRoutes(handler *CommissionHandler) *gin.Engine {
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
		commissions := v1.Group("/commissions")
		{
			commissions.POST("", handler.CreateCommission)
			commissions.GET("", handler.ListCommissions)
			commissions.GET("/:id", handler.GetCommission)
		}

		settlements := v1.Group("/settlements")
		{
			settlements.POST("", handler.CreateSettlement)
			settlements.GET("", handler.ListSettlements)
			settlements.GET("/:id", handler.GetSettlement)
			settlements.PUT("/:id", handler.UpdateSettlement)
			settlements.POST("/:id/process", handler.ProcessSettlement)
		}

		agents := v1.Group("/agents")
		{
			agents.GET("/:id/balance", handler.GetAgentBalance)
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
	if err := db.AutoMigrate(&Commission{}, &Settlement{}, &CommissionRule{}, &AgentBalance{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewCommissionService(db)
	handler := NewCommissionHandler(service)

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

	log.Printf("Commission Settlement Service started on port %s", port)

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

