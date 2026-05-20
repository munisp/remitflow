package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
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

// FraudCase represents a fraud detection case
type FraudCase struct {
	ID              uuid.UUID    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CaseRef         string       `json:"case_ref" gorm:"uniqueIndex;not null"`
	TransactionID   *uuid.UUID   `json:"transaction_id" gorm:"index"`
	AgentID         *uuid.UUID   `json:"agent_id" gorm:"index"`
	CustomerID      *uuid.UUID   `json:"customer_id" gorm:"index"`
	FraudType       FraudType    `json:"fraud_type" gorm:"not null"`
	RiskScore       float64      `json:"risk_score" gorm:"not null"`
	Severity        FraudSeverity `json:"severity" gorm:"not null"`
	Status          CaseStatus   `json:"status" gorm:"default:'open'"`
	Description     string       `json:"description" gorm:"not null"`
	DetectionMethod string       `json:"detection_method" gorm:"not null"`
	RulesTriggered  []string     `json:"rules_triggered" gorm:"type:text[]"`
	Evidence        JSON         `json:"evidence" gorm:"type:jsonb"`
	Amount          *float64     `json:"amount"`
	Currency        string       `json:"currency" gorm:"default:'USD'"`
	AssignedTo      *uuid.UUID   `json:"assigned_to"`
	AssignedAt      *time.Time   `json:"assigned_at"`
	ResolvedAt      *time.Time   `json:"resolved_at"`
	Resolution      string       `json:"resolution"`
	Notes           string       `json:"notes"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

// FraudType represents the type of fraud
type FraudType string

const (
	FraudTypeIdentityTheft     FraudType = "identity_theft"
	FraudTypeAccountTakeover   FraudType = "account_takeover"
	FraudTypeTransactionFraud  FraudType = "transaction_fraud"
	FraudTypeMoneyLaundering   FraudType = "money_laundering"
	FraudTypeSuspiciousPattern FraudType = "suspicious_pattern"
	FraudTypeVelocityFraud     FraudType = "velocity_fraud"
	FraudTypeLocationFraud     FraudType = "location_fraud"
	FraudTypeDeviceFraud       FraudType = "device_fraud"
	FraudTypeBehavioralFraud   FraudType = "behavioral_fraud"
)

// FraudSeverity represents the severity of fraud
type FraudSeverity string

const (
	FraudSeverityLow      FraudSeverity = "low"
	FraudSeverityMedium   FraudSeverity = "medium"
	FraudSeverityHigh     FraudSeverity = "high"
	FraudSeverityCritical FraudSeverity = "critical"
)

// CaseStatus represents the status of a fraud case
type CaseStatus string

const (
	CaseStatusOpen       CaseStatus = "open"
	CaseStatusInProgress CaseStatus = "in_progress"
	CaseStatusResolved   CaseStatus = "resolved"
	CaseStatusClosed     CaseStatus = "closed"
	CaseStatusEscalated  CaseStatus = "escalated"
)

// FraudRule represents a fraud detection rule
type FraudRule struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name        string     `json:"name" gorm:"not null"`
	Description string     `json:"description"`
	RuleType    RuleType   `json:"rule_type" gorm:"not null"`
	Conditions  JSON       `json:"conditions" gorm:"type:jsonb;not null"`
	Actions     JSON       `json:"actions" gorm:"type:jsonb;not null"`
	Priority    int        `json:"priority" gorm:"default:1"`
	IsActive    bool       `json:"is_active" gorm:"default:true"`
	CreatedBy   uuid.UUID  `json:"created_by" gorm:"not null"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// RuleType represents the type of fraud rule
type RuleType string

const (
	RuleTypeAmount      RuleType = "amount"
	RuleTypeVelocity    RuleType = "velocity"
	RuleTypeLocation    RuleType = "location"
	RuleTypeTime        RuleType = "time"
	RuleTypeDevice      RuleType = "device"
	RuleTypeBehavioral  RuleType = "behavioral"
	RuleTypeBlacklist   RuleType = "blacklist"
	RuleTypeWhitelist   RuleType = "whitelist"
)

// FraudAlert represents a fraud alert
type FraudAlert struct {
	ID          uuid.UUID     `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AlertRef    string        `json:"alert_ref" gorm:"uniqueIndex;not null"`
	CaseID      *uuid.UUID    `json:"case_id" gorm:"index"`
	AlertType   AlertType     `json:"alert_type" gorm:"not null"`
	Severity    FraudSeverity `json:"severity" gorm:"not null"`
	Message     string        `json:"message" gorm:"not null"`
	EntityType  string        `json:"entity_type" gorm:"not null"`
	EntityID    uuid.UUID     `json:"entity_id" gorm:"not null;index"`
	RuleID      *uuid.UUID    `json:"rule_id" gorm:"index"`
	Status      AlertStatus   `json:"status" gorm:"default:'active'"`
	AcknowledgedBy *uuid.UUID `json:"acknowledged_by"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	ResolvedAt  *time.Time    `json:"resolved_at"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// AlertType represents the type of alert
type AlertType string

const (
	AlertTypeRuleTriggered    AlertType = "rule_triggered"
	AlertTypeThresholdBreached AlertType = "threshold_breached"
	AlertTypeAnomalyDetected  AlertType = "anomaly_detected"
	AlertTypePatternMatched   AlertType = "pattern_matched"
)

// AlertStatus represents the status of an alert
type AlertStatus string

const (
	AlertStatusActive       AlertStatus = "active"
	AlertStatusAcknowledged AlertStatus = "acknowledged"
	AlertStatusResolved     AlertStatus = "resolved"
	AlertStatusIgnored      AlertStatus = "ignored"
)

// TransactionRisk represents risk assessment for a transaction
type TransactionRisk struct {
	ID               uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionID    uuid.UUID `json:"transaction_id" gorm:"uniqueIndex;not null"`
	AgentID          uuid.UUID `json:"agent_id" gorm:"not null;index"`
	CustomerID       uuid.UUID `json:"customer_id" gorm:"not null;index"`
	RiskScore        float64   `json:"risk_score" gorm:"not null"`
	RiskLevel        RiskLevel `json:"risk_level" gorm:"not null"`
	RiskFactors      []string  `json:"risk_factors" gorm:"type:text[]"`
	RiskDetails      JSON      `json:"risk_details" gorm:"type:jsonb"`
	RecommendedAction string   `json:"recommended_action" gorm:"not null"`
	ProcessingTime   int64     `json:"processing_time" gorm:"not null"` // in milliseconds
	CreatedAt        time.Time `json:"created_at"`
}

// RiskLevel represents the risk level
type RiskLevel string

const (
	RiskLevelLow      RiskLevel = "low"
	RiskLevelMedium   RiskLevel = "medium"
	RiskLevelHigh     RiskLevel = "high"
	RiskLevelCritical RiskLevel = "critical"
)

// JSON type for JSONB fields
type JSON map[string]interface{}

// Request/Response types
type TransactionRiskRequest struct {
	TransactionID     uuid.UUID `json:"transaction_id" binding:"required"`
	AgentID           uuid.UUID `json:"agent_id" binding:"required"`
	CustomerID        uuid.UUID `json:"customer_id" binding:"required"`
	Amount            float64   `json:"amount" binding:"required"`
	Currency          string    `json:"currency"`
	TransactionType   string    `json:"transaction_type" binding:"required"`
	IPAddress         string    `json:"ip_address"`
	DeviceFingerprint string    `json:"device_fingerprint"`
	Location          Location  `json:"location"`
	Timestamp         time.Time `json:"timestamp"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Country   string  `json:"country"`
	City      string  `json:"city"`
}

type CreateFraudCaseRequest struct {
	TransactionID   *uuid.UUID    `json:"transaction_id"`
	AgentID         *uuid.UUID    `json:"agent_id"`
	CustomerID      *uuid.UUID    `json:"customer_id"`
	FraudType       FraudType     `json:"fraud_type" binding:"required"`
	Severity        FraudSeverity `json:"severity" binding:"required"`
	Description     string        `json:"description" binding:"required"`
	DetectionMethod string        `json:"detection_method" binding:"required"`
	RulesTriggered  []string      `json:"rules_triggered"`
	Evidence        JSON          `json:"evidence"`
	Amount          *float64      `json:"amount"`
	Currency        string        `json:"currency"`
}

type UpdateFraudCaseRequest struct {
	Status     CaseStatus `json:"status"`
	AssignedTo *uuid.UUID `json:"assigned_to"`
	Resolution string     `json:"resolution"`
	Notes      string     `json:"notes"`
}

// FraudService handles fraud detection operations
type FraudService struct {
	db *gorm.DB
}

// NewFraudService creates a new fraud service
func NewFraudService(db *gorm.DB) *FraudService {
	return &FraudService{db: db}
}

// AssessTransactionRisk assesses the risk of a transaction
func (s *FraudService) AssessTransactionRisk(req TransactionRiskRequest) (*TransactionRisk, error) {
	startTime := time.Now()

	// Set default values
	if req.Currency == "" {
		req.Currency = "USD"
	}
	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now()
	}

	// Calculate risk score
	riskScore, riskFactors, riskDetails := s.calculateRiskScore(req)

	// Determine risk level
	riskLevel := s.determineRiskLevel(riskScore)

	// Determine recommended action
	recommendedAction := s.getRecommendedAction(riskLevel, riskScore)

	// Calculate processing time
	processingTime := time.Since(startTime).Milliseconds()

	transactionRisk := &TransactionRisk{
		TransactionID:     req.TransactionID,
		AgentID:           req.AgentID,
		CustomerID:        req.CustomerID,
		RiskScore:         riskScore,
		RiskLevel:         riskLevel,
		RiskFactors:       riskFactors,
		RiskDetails:       riskDetails,
		RecommendedAction: recommendedAction,
		ProcessingTime:    processingTime,
	}

	if err := s.db.Create(transactionRisk).Error; err != nil {
		return nil, fmt.Errorf("failed to create transaction risk: %w", err)
	}

	// Create fraud case if high risk
	if riskLevel == RiskLevelHigh || riskLevel == RiskLevelCritical {
		s.createFraudCaseFromRisk(transactionRisk, req)
	}

	// Create alerts if necessary
	s.createRiskAlerts(transactionRisk, req)

	return transactionRisk, nil
}

// CreateFraudCase creates a new fraud case
func (s *FraudService) CreateFraudCase(req CreateFraudCaseRequest, createdBy uuid.UUID) (*FraudCase, error) {
	// Generate case reference
	caseRef := generateCaseRef()

	// Calculate risk score if not provided
	riskScore := s.calculateCaseRiskScore(req)

	fraudCase := &FraudCase{
		CaseRef:         caseRef,
		TransactionID:   req.TransactionID,
		AgentID:         req.AgentID,
		CustomerID:      req.CustomerID,
		FraudType:       req.FraudType,
		RiskScore:       riskScore,
		Severity:        req.Severity,
		Status:          CaseStatusOpen,
		Description:     req.Description,
		DetectionMethod: req.DetectionMethod,
		RulesTriggered:  req.RulesTriggered,
		Evidence:        req.Evidence,
		Amount:          req.Amount,
		Currency:        req.Currency,
	}

	if err := s.db.Create(fraudCase).Error; err != nil {
		return nil, fmt.Errorf("failed to create fraud case: %w", err)
	}

	// Create alert for new fraud case
	s.createFraudCaseAlert(fraudCase)

	return fraudCase, nil
}

// GetFraudCase retrieves a fraud case by ID
func (s *FraudService) GetFraudCase(id uuid.UUID) (*FraudCase, error) {
	var fraudCase FraudCase
	if err := s.db.First(&fraudCase, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get fraud case: %w", err)
	}
	return &fraudCase, nil
}

// ListFraudCases retrieves fraud cases with pagination and filters
func (s *FraudService) ListFraudCases(page, limit int, status CaseStatus, severity FraudSeverity, fraudType FraudType, assignedTo *uuid.UUID) ([]FraudCase, int64, error) {
	var cases []FraudCase
	var total int64

	query := s.db.Model(&FraudCase{})

	// Apply filters
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}
	if fraudType != "" {
		query = query.Where("fraud_type = ?", fraudType)
	}
	if assignedTo != nil {
		query = query.Where("assigned_to = ?", *assignedTo)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count fraud cases: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&cases).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list fraud cases: %w", err)
	}

	return cases, total, nil
}

// UpdateFraudCase updates a fraud case
func (s *FraudService) UpdateFraudCase(id uuid.UUID, req UpdateFraudCaseRequest, updatedBy uuid.UUID) (*FraudCase, error) {
	var fraudCase FraudCase
	if err := s.db.First(&fraudCase, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find fraud case: %w", err)
	}

	// Update fields if provided
	if req.Status != "" {
		fraudCase.Status = req.Status
		if req.Status == CaseStatusResolved || req.Status == CaseStatusClosed {
			now := time.Now()
			fraudCase.ResolvedAt = &now
		}
	}
	if req.AssignedTo != nil {
		fraudCase.AssignedTo = req.AssignedTo
		now := time.Now()
		fraudCase.AssignedAt = &now
	}
	if req.Resolution != "" {
		fraudCase.Resolution = req.Resolution
	}
	if req.Notes != "" {
		fraudCase.Notes = req.Notes
	}

	if err := s.db.Save(&fraudCase).Error; err != nil {
		return nil, fmt.Errorf("failed to update fraud case: %w", err)
	}

	return &fraudCase, nil
}

// GetFraudAlerts retrieves fraud alerts
func (s *FraudService) GetFraudAlerts(entityType string, entityID *uuid.UUID, status AlertStatus) ([]FraudAlert, error) {
	var alerts []FraudAlert
	query := s.db.Model(&FraudAlert{})

	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if entityID != nil {
		query = query.Where("entity_id = ?", *entityID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Order("created_at DESC").Find(&alerts).Error; err != nil {
		return nil, fmt.Errorf("failed to get fraud alerts: %w", err)
	}

	return alerts, nil
}

// calculateRiskScore calculates the risk score for a transaction
func (s *FraudService) calculateRiskScore(req TransactionRiskRequest) (float64, []string, JSON) {
	var riskScore float64
	var riskFactors []string
	riskDetails := make(JSON)

	// Amount-based risk
	amountRisk := s.calculateAmountRisk(req.Amount, req.TransactionType)
	riskScore += amountRisk
	if amountRisk > 20 {
		riskFactors = append(riskFactors, "high_amount")
		riskDetails["amount_risk"] = amountRisk
	}

	// Velocity risk
	velocityRisk := s.calculateVelocityRisk(req.AgentID, req.CustomerID)
	riskScore += velocityRisk
	if velocityRisk > 15 {
		riskFactors = append(riskFactors, "high_velocity")
		riskDetails["velocity_risk"] = velocityRisk
	}

	// Time-based risk
	timeRisk := s.calculateTimeRisk(req.Timestamp)
	riskScore += timeRisk
	if timeRisk > 10 {
		riskFactors = append(riskFactors, "unusual_time")
		riskDetails["time_risk"] = timeRisk
	}

	// Location risk
	locationRisk := s.calculateLocationRisk(req.AgentID, req.Location)
	riskScore += locationRisk
	if locationRisk > 15 {
		riskFactors = append(riskFactors, "unusual_location")
		riskDetails["location_risk"] = locationRisk
	}

	// Device risk
	deviceRisk := s.calculateDeviceRisk(req.AgentID, req.DeviceFingerprint)
	riskScore += deviceRisk
	if deviceRisk > 10 {
		riskFactors = append(riskFactors, "unusual_device")
		riskDetails["device_risk"] = deviceRisk
	}

	// Behavioral risk
	behavioralRisk := s.calculateBehavioralRisk(req.AgentID, req.TransactionType, req.Amount)
	riskScore += behavioralRisk
	if behavioralRisk > 15 {
		riskFactors = append(riskFactors, "unusual_behavior")
		riskDetails["behavioral_risk"] = behavioralRisk
	}

	// Cap the risk score at 100
	if riskScore > 100 {
		riskScore = 100
	}

	riskDetails["total_score"] = riskScore

	return riskScore, riskFactors, riskDetails
}

// calculateAmountRisk calculates risk based on transaction amount
func (s *FraudService) calculateAmountRisk(amount float64, transactionType string) float64 {
	// Define thresholds based on transaction type
	var highThreshold, criticalThreshold float64

	switch transactionType {
	case "withdrawal":
		highThreshold = 10000
		criticalThreshold = 50000
	case "transfer":
		highThreshold = 25000
		criticalThreshold = 100000
	case "deposit":
		highThreshold = 50000
		criticalThreshold = 200000
	default:
		highThreshold = 5000
		criticalThreshold = 25000
	}

	if amount >= criticalThreshold {
		return 30
	} else if amount >= highThreshold {
		return 20
	} else if amount >= highThreshold*0.5 {
		return 10
	}

	return 0
}

// calculateVelocityRisk calculates risk based on transaction velocity
func (s *FraudService) calculateVelocityRisk(agentID, customerID uuid.UUID) float64 {
	// Count transactions in the last hour
	oneHourAgo := time.Now().Add(-1 * time.Hour)
	
	var agentCount, customerCount int64
	s.db.Model(&TransactionRisk{}).Where("agent_id = ? AND created_at > ?", agentID, oneHourAgo).Count(&agentCount)
	s.db.Model(&TransactionRisk{}).Where("customer_id = ? AND created_at > ?", customerID, oneHourAgo).Count(&customerCount)

	var risk float64
	if agentCount > 20 {
		risk += 25
	} else if agentCount > 10 {
		risk += 15
	} else if agentCount > 5 {
		risk += 10
	}

	if customerCount > 10 {
		risk += 20
	} else if customerCount > 5 {
		risk += 10
	}

	return risk
}

// calculateTimeRisk calculates risk based on transaction time
func (s *FraudService) calculateTimeRisk(timestamp time.Time) float64 {
	hour := timestamp.Hour()
	
	// Higher risk for transactions outside business hours
	if hour < 6 || hour > 22 {
		return 15
	} else if hour < 8 || hour > 20 {
		return 10
	}

	return 0
}

// calculateLocationRisk calculates risk based on transaction location
func (s *FraudService) calculateLocationRisk(agentID uuid.UUID, location Location) float64 {
	// This is a simplified implementation
	// In a real system, you would compare against historical locations
	
	// For now, return 0 as we don't have historical data
	// In production, this would check against:
	// - Agent's usual locations
	// - High-risk geographical areas
	// - Distance from last transaction
	
	return 0
}

// calculateDeviceRisk calculates risk based on device fingerprint
func (s *FraudService) calculateDeviceRisk(agentID uuid.UUID, deviceFingerprint string) float64 {
	if deviceFingerprint == "" {
		return 10 // Missing device fingerprint is risky
	}

	// Check if this device has been used by this agent before
	var count int64
	s.db.Model(&TransactionRisk{}).Where("agent_id = ? AND risk_details->>'device_fingerprint' = ?", 
		agentID, deviceFingerprint).Count(&count)

	if count == 0 {
		return 15 // New device
	}

	return 0
}

// calculateBehavioralRisk calculates risk based on behavioral patterns
func (s *FraudService) calculateBehavioralRisk(agentID uuid.UUID, transactionType string, amount float64) float64 {
	// Get agent's historical transaction patterns
	var avgAmount float64
	s.db.Model(&TransactionRisk{}).Where("agent_id = ?", agentID).
		Select("AVG(risk_details->>'amount')").Scan(&avgAmount)

	if avgAmount > 0 && amount > avgAmount*3 {
		return 20 // Transaction amount is 3x higher than usual
	} else if avgAmount > 0 && amount > avgAmount*2 {
		return 15 // Transaction amount is 2x higher than usual
	}

	return 0
}

// determineRiskLevel determines the risk level based on risk score
func (s *FraudService) determineRiskLevel(riskScore float64) RiskLevel {
	if riskScore >= 80 {
		return RiskLevelCritical
	} else if riskScore >= 60 {
		return RiskLevelHigh
	} else if riskScore >= 30 {
		return RiskLevelMedium
	}
	return RiskLevelLow
}

// getRecommendedAction gets the recommended action based on risk level
func (s *FraudService) getRecommendedAction(riskLevel RiskLevel, riskScore float64) string {
	switch riskLevel {
	case RiskLevelCritical:
		return "block_transaction"
	case RiskLevelHigh:
		return "manual_review"
	case RiskLevelMedium:
		return "additional_verification"
	default:
		return "allow"
	}
}

// calculateCaseRiskScore calculates risk score for a fraud case
func (s *FraudService) calculateCaseRiskScore(req CreateFraudCaseRequest) float64 {
	baseScore := 50.0

	switch req.Severity {
	case FraudSeverityCritical:
		baseScore = 90.0
	case FraudSeverityHigh:
		baseScore = 75.0
	case FraudSeverityMedium:
		baseScore = 50.0
	case FraudSeverityLow:
		baseScore = 25.0
	}

	// Adjust based on amount if provided
	if req.Amount != nil && *req.Amount > 10000 {
		baseScore += 10
	}

	// Adjust based on fraud type
	switch req.FraudType {
	case FraudTypeMoneyLaundering, FraudTypeIdentityTheft:
		baseScore += 15
	case FraudTypeAccountTakeover, FraudTypeTransactionFraud:
		baseScore += 10
	}

	if baseScore > 100 {
		baseScore = 100
	}

	return baseScore
}

// createFraudCaseFromRisk creates a fraud case from high-risk transaction
func (s *FraudService) createFraudCaseFromRisk(risk *TransactionRisk, req TransactionRiskRequest) {
	fraudType := FraudTypeSuspiciousPattern
	if len(risk.RiskFactors) > 0 {
		// Determine fraud type based on risk factors
		for _, factor := range risk.RiskFactors {
			switch factor {
			case "high_velocity":
				fraudType = FraudTypeVelocityFraud
			case "unusual_location":
				fraudType = FraudTypeLocationFraud
			case "unusual_device":
				fraudType = FraudTypeDeviceFraud
			case "unusual_behavior":
				fraudType = FraudTypeBehavioralFraud
			}
		}
	}

	severity := FraudSeverityMedium
	if risk.RiskLevel == RiskLevelCritical {
		severity = FraudSeverityCritical
	} else if risk.RiskLevel == RiskLevelHigh {
		severity = FraudSeverityHigh
	}

	caseReq := CreateFraudCaseRequest{
		TransactionID:   &req.TransactionID,
		AgentID:         &req.AgentID,
		CustomerID:      &req.CustomerID,
		FraudType:       fraudType,
		Severity:        severity,
		Description:     fmt.Sprintf("High-risk transaction detected with score %.2f", risk.RiskScore),
		DetectionMethod: "automated_risk_assessment",
		RulesTriggered:  risk.RiskFactors,
		Evidence:        risk.RiskDetails,
		Amount:          &req.Amount,
		Currency:        req.Currency,
	}

	s.CreateFraudCase(caseReq, uuid.Nil) // System-generated case
}

// createRiskAlerts creates alerts based on transaction risk
func (s *FraudService) createRiskAlerts(risk *TransactionRisk, req TransactionRiskRequest) {
	if risk.RiskLevel == RiskLevelHigh || risk.RiskLevel == RiskLevelCritical {
		alertRef := generateAlertRef()
		severity := FraudSeverityMedium
		if risk.RiskLevel == RiskLevelCritical {
			severity = FraudSeverityCritical
		}

		alert := FraudAlert{
			AlertRef:   alertRef,
			AlertType:  AlertTypeThresholdBreached,
			Severity:   severity,
			Message:    fmt.Sprintf("High-risk transaction detected (Score: %.2f)", risk.RiskScore),
			EntityType: "transaction",
			EntityID:   req.TransactionID,
			Status:     AlertStatusActive,
		}
		s.db.Create(&alert)
	}
}

// createFraudCaseAlert creates an alert for a new fraud case
func (s *FraudService) createFraudCaseAlert(fraudCase *FraudCase) {
	alertRef := generateAlertRef()

	alert := FraudAlert{
		AlertRef:   alertRef,
		CaseID:     &fraudCase.ID,
		AlertType:  AlertTypePatternMatched,
		Severity:   fraudCase.Severity,
		Message:    fmt.Sprintf("New fraud case created: %s", fraudCase.Description),
		EntityType: "fraud_case",
		EntityID:   fraudCase.ID,
		Status:     AlertStatusActive,
	}
	s.db.Create(&alert)
}

// Helper functions
func generateCaseRef() string {
	return fmt.Sprintf("FRAUD%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

func generateAlertRef() string {
	return fmt.Sprintf("ALERT%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	fraudCaseTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "fraud_case_total",
			Help: "Total number of fraud cases",
		},
		[]string{"fraud_type", "severity", "status"},
	)

	riskScoreHistogram = prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "transaction_risk_score",
			Help:    "Distribution of transaction risk scores",
			Buckets: []float64{0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100},
		},
	)

	fraudAlertTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "fraud_alert_total",
			Help: "Total number of fraud alerts",
		},
		[]string{"alert_type", "severity"},
	)

	fraudRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "fraud_request_duration_seconds",
			Help: "Duration of fraud detection requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(fraudCaseTotal)
	prometheus.MustRegister(riskScoreHistogram)
	prometheus.MustRegister(fraudAlertTotal)
	prometheus.MustRegister(fraudRequestDuration)
}

// HTTP Handlers
type FraudHandler struct {
	service *FraudService
}

func NewFraudHandler(service *FraudService) *FraudHandler {
	return &FraudHandler{service: service}
}

func (h *FraudHandler) AssessTransactionRisk(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("POST", "/risk-assessment"))
	defer timer.ObserveDuration()

	var req TransactionRiskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	risk, err := h.service.AssessTransactionRisk(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	riskScoreHistogram.Observe(risk.RiskScore)

	c.JSON(http.StatusOK, risk)
}

func (h *FraudHandler) CreateFraudCase(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("POST", "/fraud-cases"))
	defer timer.ObserveDuration()

	var req CreateFraudCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	fraudCase, err := h.service.CreateFraudCase(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	fraudCaseTotal.WithLabelValues(string(fraudCase.FraudType), string(fraudCase.Severity), string(fraudCase.Status)).Inc()

	c.JSON(http.StatusCreated, fraudCase)
}

func (h *FraudHandler) GetFraudCase(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("GET", "/fraud-cases/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid fraud case ID"})
		return
	}

	fraudCase, err := h.service.GetFraudCase(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "fraud case not found"})
		return
	}

	c.JSON(http.StatusOK, fraudCase)
}

func (h *FraudHandler) ListFraudCases(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("GET", "/fraud-cases"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	status := CaseStatus(c.Query("status"))
	severity := FraudSeverity(c.Query("severity"))
	fraudType := FraudType(c.Query("fraud_type"))

	var assignedTo *uuid.UUID
	if assignedToStr := c.Query("assigned_to"); assignedToStr != "" {
		if id, err := uuid.Parse(assignedToStr); err == nil {
			assignedTo = &id
		}
	}

	cases, total, err := h.service.ListFraudCases(page, limit, status, severity, fraudType, assignedTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"cases": cases,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func (h *FraudHandler) UpdateFraudCase(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("PUT", "/fraud-cases/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid fraud case ID"})
		return
	}

	var req UpdateFraudCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get updated_by from JWT token (simplified for demo)
	updatedBy := uuid.New()

	fraudCase, err := h.service.UpdateFraudCase(id, req, updatedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, fraudCase)
}

func (h *FraudHandler) GetFraudAlerts(c *gin.Context) {
	timer := prometheus.NewTimer(fraudRequestDuration.WithLabelValues("GET", "/fraud-alerts"))
	defer timer.ObserveDuration()

	entityType := c.Query("entity_type")
	status := AlertStatus(c.Query("status"))

	var entityID *uuid.UUID
	if entityIDStr := c.Query("entity_id"); entityIDStr != "" {
		if id, err := uuid.Parse(entityIDStr); err == nil {
			entityID = &id
		}
	}

	alerts, err := h.service.GetFraudAlerts(entityType, entityID, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

func setupRoutes(handler *FraudHandler) *gin.Engine {
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
		v1.POST("/risk-assessment", handler.AssessTransactionRisk)
		
		fraudCases := v1.Group("/fraud-cases")
		{
			fraudCases.POST("", handler.CreateFraudCase)
			fraudCases.GET("", handler.ListFraudCases)
			fraudCases.GET("/:id", handler.GetFraudCase)
			fraudCases.PUT("/:id", handler.UpdateFraudCase)
		}

		v1.GET("/fraud-alerts", handler.GetFraudAlerts)
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
	if err := db.AutoMigrate(&FraudCase{}, &FraudRule{}, &FraudAlert{}, &TransactionRisk{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewFraudService(db)
	handler := NewFraudHandler(service)

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

	log.Printf("Fraud Detection Service started on port %s", port)

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

