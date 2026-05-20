package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// AuditLog represents an audit log entry
type AuditLog struct {
	ID            uuid.UUID   `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	EventID       string      `json:"event_id" gorm:"uniqueIndex;not null"`
	EventType     EventType   `json:"event_type" gorm:"not null;index"`
	EntityType    string      `json:"entity_type" gorm:"not null;index"`
	EntityID      uuid.UUID   `json:"entity_id" gorm:"not null;index"`
	Action        string      `json:"action" gorm:"not null"`
	Description   string      `json:"description" gorm:"not null"`
	UserID        *uuid.UUID  `json:"user_id" gorm:"index"`
	UserType      string      `json:"user_type"`
	IPAddress     string      `json:"ip_address"`
	UserAgent     string      `json:"user_agent"`
	SessionID     string      `json:"session_id"`
	RequestID     string      `json:"request_id"`
	BeforeData    JSON        `json:"before_data" gorm:"type:jsonb"`
	AfterData     JSON        `json:"after_data" gorm:"type:jsonb"`
	Metadata      JSON        `json:"metadata" gorm:"type:jsonb"`
	Severity      Severity    `json:"severity" gorm:"default:'info'"`
	Status        LogStatus   `json:"status" gorm:"default:'active'"`
	Hash          string      `json:"hash" gorm:"not null"`
	PreviousHash  string      `json:"previous_hash"`
	Timestamp     time.Time   `json:"timestamp" gorm:"not null;index"`
	CreatedAt     time.Time   `json:"created_at"`
}

// EventType represents the type of audit event
type EventType string

const (
	EventTypeAuthentication EventType = "authentication"
	EventTypeAuthorization  EventType = "authorization"
	EventTypeTransaction    EventType = "transaction"
	EventTypeDataAccess     EventType = "data_access"
	EventTypeDataModification EventType = "data_modification"
	EventTypeSystemAccess   EventType = "system_access"
	EventTypeConfiguration  EventType = "configuration"
	EventTypeSecurity       EventType = "security"
	EventTypeCompliance     EventType = "compliance"
	EventTypeError          EventType = "error"
)

// Severity represents the severity level of an audit event
type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityError    Severity = "error"
	SeverityCritical Severity = "critical"
)

// LogStatus represents the status of an audit log
type LogStatus string

const (
	LogStatusActive   LogStatus = "active"
	LogStatusArchived LogStatus = "archived"
	LogStatusDeleted  LogStatus = "deleted"
)

// ComplianceRule represents a compliance rule
type ComplianceRule struct {
	ID            uuid.UUID    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name          string       `json:"name" gorm:"not null"`
	Description   string       `json:"description"`
	RuleType      RuleType     `json:"rule_type" gorm:"not null"`
	Category      string       `json:"category" gorm:"not null"`
	Regulation    string       `json:"regulation" gorm:"not null"`
	Conditions    JSON         `json:"conditions" gorm:"type:jsonb;not null"`
	Actions       JSON         `json:"actions" gorm:"type:jsonb;not null"`
	Severity      Severity     `json:"severity" gorm:"default:'warning'"`
	IsActive      bool         `json:"is_active" gorm:"default:true"`
	EffectiveFrom time.Time    `json:"effective_from" gorm:"not null"`
	EffectiveTo   *time.Time   `json:"effective_to"`
	CreatedBy     uuid.UUID    `json:"created_by" gorm:"not null"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

// RuleType represents the type of compliance rule
type RuleType string

const (
	RuleTypeValidation    RuleType = "validation"
	RuleTypeMonitoring    RuleType = "monitoring"
	RuleTypeReporting     RuleType = "reporting"
	RuleTypeDataRetention RuleType = "data_retention"
	RuleTypeAccessControl RuleType = "access_control"
)

// ComplianceViolation represents a compliance violation
type ComplianceViolation struct {
	ID            uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	ViolationRef  string         `json:"violation_ref" gorm:"uniqueIndex;not null"`
	RuleID        uuid.UUID      `json:"rule_id" gorm:"not null;index"`
	EntityType    string         `json:"entity_type" gorm:"not null"`
	EntityID      uuid.UUID      `json:"entity_id" gorm:"not null;index"`
	Description   string         `json:"description" gorm:"not null"`
	Severity      Severity       `json:"severity" gorm:"not null"`
	Status        ViolationStatus `json:"status" gorm:"default:'open'"`
	DetectedAt    time.Time      `json:"detected_at" gorm:"not null"`
	Evidence      JSON           `json:"evidence" gorm:"type:jsonb"`
	AssignedTo    *uuid.UUID     `json:"assigned_to"`
	AssignedAt    *time.Time     `json:"assigned_at"`
	ResolvedAt    *time.Time     `json:"resolved_at"`
	Resolution    string         `json:"resolution"`
	Notes         string         `json:"notes"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// ViolationStatus represents the status of a compliance violation
type ViolationStatus string

const (
	ViolationStatusOpen       ViolationStatus = "open"
	ViolationStatusInProgress ViolationStatus = "in_progress"
	ViolationStatusResolved   ViolationStatus = "resolved"
	ViolationStatusClosed     ViolationStatus = "closed"
	ViolationStatusIgnored    ViolationStatus = "ignored"
)

// ComplianceReport represents a compliance report
type ComplianceReport struct {
	ID           uuid.UUID    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	ReportRef    string       `json:"report_ref" gorm:"uniqueIndex;not null"`
	Name         string       `json:"name" gorm:"not null"`
	Type         ReportType   `json:"type" gorm:"not null"`
	Category     string       `json:"category" gorm:"not null"`
	Regulation   string       `json:"regulation" gorm:"not null"`
	PeriodStart  time.Time    `json:"period_start" gorm:"not null"`
	PeriodEnd    time.Time    `json:"period_end" gorm:"not null"`
	Status       ReportStatus `json:"status" gorm:"default:'pending'"`
	Data         JSON         `json:"data" gorm:"type:jsonb"`
	Summary      JSON         `json:"summary" gorm:"type:jsonb"`
	FilePath     string       `json:"file_path"`
	FileHash     string       `json:"file_hash"`
	GeneratedBy  uuid.UUID    `json:"generated_by" gorm:"not null"`
	GeneratedAt  *time.Time   `json:"generated_at"`
	SubmittedAt  *time.Time   `json:"submitted_at"`
	ApprovedBy   *uuid.UUID   `json:"approved_by"`
	ApprovedAt   *time.Time   `json:"approved_at"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

// ReportType represents the type of compliance report
type ReportType string

const (
	ReportTypeRegulatory ReportType = "regulatory"
	ReportTypeInternal   ReportType = "internal"
	ReportTypeAudit      ReportType = "audit"
	ReportTypeRisk       ReportType = "risk"
	ReportTypeTransaction ReportType = "transaction"
)

// ReportStatus represents the status of a compliance report
type ReportStatus string

const (
	ReportStatusPending   ReportStatus = "pending"
	ReportStatusGenerating ReportStatus = "generating"
	ReportStatusGenerated ReportStatus = "generated"
	ReportStatusSubmitted ReportStatus = "submitted"
	ReportStatusApproved  ReportStatus = "approved"
	ReportStatusRejected  ReportStatus = "rejected"
)

// DataRetentionPolicy represents a data retention policy
type DataRetentionPolicy struct {
	ID            uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name          string    `json:"name" gorm:"not null"`
	Description   string    `json:"description"`
	EntityType    string    `json:"entity_type" gorm:"not null"`
	RetentionDays int       `json:"retention_days" gorm:"not null"`
	ArchiveDays   int       `json:"archive_days" gorm:"not null"`
	IsActive      bool      `json:"is_active" gorm:"default:true"`
	CreatedBy     uuid.UUID `json:"created_by" gorm:"not null"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// JSON type for JSONB fields
type JSON map[string]interface{}

// Request/Response types
type CreateAuditLogRequest struct {
	EventType     EventType   `json:"event_type" binding:"required"`
	EntityType    string      `json:"entity_type" binding:"required"`
	EntityID      uuid.UUID   `json:"entity_id" binding:"required"`
	Action        string      `json:"action" binding:"required"`
	Description   string      `json:"description" binding:"required"`
	UserID        *uuid.UUID  `json:"user_id"`
	UserType      string      `json:"user_type"`
	IPAddress     string      `json:"ip_address"`
	UserAgent     string      `json:"user_agent"`
	SessionID     string      `json:"session_id"`
	RequestID     string      `json:"request_id"`
	BeforeData    JSON        `json:"before_data"`
	AfterData     JSON        `json:"after_data"`
	Metadata      JSON        `json:"metadata"`
	Severity      Severity    `json:"severity"`
	Timestamp     time.Time   `json:"timestamp"`
}

type CreateComplianceRuleRequest struct {
	Name          string     `json:"name" binding:"required"`
	Description   string     `json:"description"`
	RuleType      RuleType   `json:"rule_type" binding:"required"`
	Category      string     `json:"category" binding:"required"`
	Regulation    string     `json:"regulation" binding:"required"`
	Conditions    JSON       `json:"conditions" binding:"required"`
	Actions       JSON       `json:"actions" binding:"required"`
	Severity      Severity   `json:"severity"`
	EffectiveFrom time.Time  `json:"effective_from" binding:"required"`
	EffectiveTo   *time.Time `json:"effective_to"`
}

type CreateViolationRequest struct {
	RuleID      uuid.UUID `json:"rule_id" binding:"required"`
	EntityType  string    `json:"entity_type" binding:"required"`
	EntityID    uuid.UUID `json:"entity_id" binding:"required"`
	Description string    `json:"description" binding:"required"`
	Severity    Severity  `json:"severity" binding:"required"`
	Evidence    JSON      `json:"evidence"`
	DetectedAt  time.Time `json:"detected_at"`
}

type UpdateViolationRequest struct {
	Status     ViolationStatus `json:"status"`
	AssignedTo *uuid.UUID      `json:"assigned_to"`
	Resolution string          `json:"resolution"`
	Notes      string          `json:"notes"`
}

type CreateReportRequest struct {
	Name        string     `json:"name" binding:"required"`
	Type        ReportType `json:"type" binding:"required"`
	Category    string     `json:"category" binding:"required"`
	Regulation  string     `json:"regulation" binding:"required"`
	PeriodStart time.Time  `json:"period_start" binding:"required"`
	PeriodEnd   time.Time  `json:"period_end" binding:"required"`
}

// AuditService handles audit and compliance operations
type AuditService struct {
	db *gorm.DB
}

// NewAuditService creates a new audit service
func NewAuditService(db *gorm.DB) *AuditService {
	return &AuditService{db: db}
}

// CreateAuditLog creates a new audit log entry
func (s *AuditService) CreateAuditLog(req CreateAuditLogRequest) (*AuditLog, error) {
	// Set default values
	if req.Severity == "" {
		req.Severity = SeverityInfo
	}
	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now()
	}

	// Generate event ID
	eventID := generateEventID()

	// Get previous hash for blockchain-like integrity
	previousHash := s.getLastAuditHash()

	// Create audit log
	auditLog := &AuditLog{
		EventID:      eventID,
		EventType:    req.EventType,
		EntityType:   req.EntityType,
		EntityID:     req.EntityID,
		Action:       req.Action,
		Description:  req.Description,
		UserID:       req.UserID,
		UserType:     req.UserType,
		IPAddress:    req.IPAddress,
		UserAgent:    req.UserAgent,
		SessionID:    req.SessionID,
		RequestID:    req.RequestID,
		BeforeData:   req.BeforeData,
		AfterData:    req.AfterData,
		Metadata:     req.Metadata,
		Severity:     req.Severity,
		Status:       LogStatusActive,
		PreviousHash: previousHash,
		Timestamp:    req.Timestamp,
	}

	// Calculate hash for integrity
	auditLog.Hash = s.calculateAuditHash(auditLog)

	if err := s.db.Create(auditLog).Error; err != nil {
		return nil, fmt.Errorf("failed to create audit log: %w", err)
	}

	// Check for compliance violations
	go s.checkComplianceViolations(auditLog)

	return auditLog, nil
}

// GetAuditLogs retrieves audit logs with pagination and filters
func (s *AuditService) GetAuditLogs(page, limit int, eventType EventType, entityType string, entityID *uuid.UUID, userID *uuid.UUID, startDate, endDate *time.Time) ([]AuditLog, int64, error) {
	var logs []AuditLog
	var total int64

	query := s.db.Model(&AuditLog{})

	// Apply filters
	if eventType != "" {
		query = query.Where("event_type = ?", eventType)
	}
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if entityID != nil {
		query = query.Where("entity_id = ?", *entityID)
	}
	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}
	if startDate != nil {
		query = query.Where("timestamp >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("timestamp <= ?", *endDate)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count audit logs: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("timestamp DESC").Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list audit logs: %w", err)
	}

	return logs, total, nil
}

// CreateComplianceRule creates a new compliance rule
func (s *AuditService) CreateComplianceRule(req CreateComplianceRuleRequest, createdBy uuid.UUID) (*ComplianceRule, error) {
	if req.Severity == "" {
		req.Severity = SeverityWarning
	}

	rule := &ComplianceRule{
		Name:          req.Name,
		Description:   req.Description,
		RuleType:      req.RuleType,
		Category:      req.Category,
		Regulation:    req.Regulation,
		Conditions:    req.Conditions,
		Actions:       req.Actions,
		Severity:      req.Severity,
		IsActive:      true,
		EffectiveFrom: req.EffectiveFrom,
		EffectiveTo:   req.EffectiveTo,
		CreatedBy:     createdBy,
	}

	if err := s.db.Create(rule).Error; err != nil {
		return nil, fmt.Errorf("failed to create compliance rule: %w", err)
	}

	return rule, nil
}

// CreateViolation creates a new compliance violation
func (s *AuditService) CreateViolation(req CreateViolationRequest) (*ComplianceViolation, error) {
	if req.DetectedAt.IsZero() {
		req.DetectedAt = time.Now()
	}

	violationRef := generateViolationRef()

	violation := &ComplianceViolation{
		ViolationRef: violationRef,
		RuleID:       req.RuleID,
		EntityType:   req.EntityType,
		EntityID:     req.EntityID,
		Description:  req.Description,
		Severity:     req.Severity,
		Status:       ViolationStatusOpen,
		DetectedAt:   req.DetectedAt,
		Evidence:     req.Evidence,
	}

	if err := s.db.Create(violation).Error; err != nil {
		return nil, fmt.Errorf("failed to create violation: %w", err)
	}

	return violation, nil
}

// UpdateViolation updates a compliance violation
func (s *AuditService) UpdateViolation(id uuid.UUID, req UpdateViolationRequest, updatedBy uuid.UUID) (*ComplianceViolation, error) {
	var violation ComplianceViolation
	if err := s.db.First(&violation, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find violation: %w", err)
	}

	// Update fields if provided
	if req.Status != "" {
		violation.Status = req.Status
		if req.Status == ViolationStatusResolved || req.Status == ViolationStatusClosed {
			now := time.Now()
			violation.ResolvedAt = &now
		}
	}
	if req.AssignedTo != nil {
		violation.AssignedTo = req.AssignedTo
		now := time.Now()
		violation.AssignedAt = &now
	}
	if req.Resolution != "" {
		violation.Resolution = req.Resolution
	}
	if req.Notes != "" {
		violation.Notes = req.Notes
	}

	if err := s.db.Save(&violation).Error; err != nil {
		return nil, fmt.Errorf("failed to update violation: %w", err)
	}

	return &violation, nil
}

// CreateReport creates a new compliance report
func (s *AuditService) CreateReport(req CreateReportRequest, generatedBy uuid.UUID) (*ComplianceReport, error) {
	reportRef := generateReportRef()

	report := &ComplianceReport{
		ReportRef:   reportRef,
		Name:        req.Name,
		Type:        req.Type,
		Category:    req.Category,
		Regulation:  req.Regulation,
		PeriodStart: req.PeriodStart,
		PeriodEnd:   req.PeriodEnd,
		Status:      ReportStatusPending,
		GeneratedBy: generatedBy,
	}

	if err := s.db.Create(report).Error; err != nil {
		return nil, fmt.Errorf("failed to create report: %w", err)
	}

	// Generate report data asynchronously
	go s.generateReportData(report.ID)

	return report, nil
}

// GetComplianceViolations retrieves compliance violations
func (s *AuditService) GetComplianceViolations(page, limit int, status ViolationStatus, severity Severity, assignedTo *uuid.UUID) ([]ComplianceViolation, int64, error) {
	var violations []ComplianceViolation
	var total int64

	query := s.db.Model(&ComplianceViolation{})

	// Apply filters
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}
	if assignedTo != nil {
		query = query.Where("assigned_to = ?", *assignedTo)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count violations: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("detected_at DESC").Offset(offset).Limit(limit).Find(&violations).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list violations: %w", err)
	}

	return violations, total, nil
}

// VerifyAuditIntegrity verifies the integrity of audit logs
func (s *AuditService) VerifyAuditIntegrity(startDate, endDate time.Time) (bool, []string, error) {
	var logs []AuditLog
	var issues []string

	if err := s.db.Where("timestamp BETWEEN ? AND ?", startDate, endDate).
		Order("timestamp ASC").Find(&logs).Error; err != nil {
		return false, nil, fmt.Errorf("failed to get audit logs: %w", err)
	}

	for i, log := range logs {
		// Verify hash
		expectedHash := s.calculateAuditHash(&log)
		if log.Hash != expectedHash {
			issues = append(issues, fmt.Sprintf("Hash mismatch for log %s", log.EventID))
		}

		// Verify chain integrity
		if i > 0 {
			if log.PreviousHash != logs[i-1].Hash {
				issues = append(issues, fmt.Sprintf("Chain broken at log %s", log.EventID))
			}
		}
	}

	return len(issues) == 0, issues, nil
}

// checkComplianceViolations checks for compliance violations based on audit log
func (s *AuditService) checkComplianceViolations(auditLog *AuditLog) {
	var rules []ComplianceRule
	now := time.Now()

	// Get active rules
	if err := s.db.Where("is_active = true AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)", 
		now, now).Find(&rules).Error; err != nil {
		log.Printf("Failed to get compliance rules: %v", err)
		return
	}

	for _, rule := range rules {
		if s.evaluateRule(rule, auditLog) {
			// Create violation
			violation := CreateViolationRequest{
				RuleID:      rule.ID,
				EntityType:  auditLog.EntityType,
				EntityID:    auditLog.EntityID,
				Description: fmt.Sprintf("Rule '%s' violated by %s", rule.Name, auditLog.Action),
				Severity:    rule.Severity,
				Evidence: JSON{
					"audit_log_id": auditLog.ID,
					"event_id":     auditLog.EventID,
					"rule_name":    rule.Name,
				},
				DetectedAt: auditLog.Timestamp,
			}
			s.CreateViolation(violation)
		}
	}
}

// evaluateRule evaluates if a rule is violated by an audit log
func (s *AuditService) evaluateRule(rule ComplianceRule, auditLog *AuditLog) bool {
	// This is a simplified rule evaluation
	// In a real system, this would be a more sophisticated rule engine
	
	conditions, ok := rule.Conditions["conditions"].([]interface{})
	if !ok {
		return false
	}

	for _, condition := range conditions {
		condMap, ok := condition.(map[string]interface{})
		if !ok {
			continue
		}

		field, ok := condMap["field"].(string)
		if !ok {
			continue
		}

		operator, ok := condMap["operator"].(string)
		if !ok {
			continue
		}

		value := condMap["value"]

		if s.evaluateCondition(auditLog, field, operator, value) {
			return true
		}
	}

	return false
}

// evaluateCondition evaluates a single condition
func (s *AuditService) evaluateCondition(auditLog *AuditLog, field, operator string, value interface{}) bool {
	var fieldValue interface{}

	switch field {
	case "event_type":
		fieldValue = string(auditLog.EventType)
	case "action":
		fieldValue = auditLog.Action
	case "severity":
		fieldValue = string(auditLog.Severity)
	case "entity_type":
		fieldValue = auditLog.EntityType
	default:
		return false
	}

	switch operator {
	case "equals":
		return fieldValue == value
	case "not_equals":
		return fieldValue != value
	case "contains":
		if str, ok := fieldValue.(string); ok {
			if valStr, ok := value.(string); ok {
				return strings.Contains(str, valStr)
			}
		}
	}

	return false
}

// generateReportData generates data for a compliance report
func (s *AuditService) generateReportData(reportID uuid.UUID) {
	var report ComplianceReport
	if err := s.db.First(&report, "id = ?", reportID).Error; err != nil {
		log.Printf("Failed to get report %s: %v", reportID, err)
		return
	}

	// Update status to generating
	s.db.Model(&report).Update("status", ReportStatusGenerating)

	// Generate report data based on type
	var data JSON
	var summary JSON

	switch report.Type {
	case ReportTypeTransaction:
		data, summary = s.generateTransactionReport(report.PeriodStart, report.PeriodEnd)
	case ReportTypeAudit:
		data, summary = s.generateAuditReport(report.PeriodStart, report.PeriodEnd)
	case ReportTypeRisk:
		data, summary = s.generateRiskReport(report.PeriodStart, report.PeriodEnd)
	default:
		data = JSON{"error": "unsupported report type"}
		summary = JSON{"status": "failed"}
	}

	// Update report with generated data
	now := time.Now()
	updates := map[string]interface{}{
		"status":       ReportStatusGenerated,
		"data":         data,
		"summary":      summary,
		"generated_at": now,
	}

	s.db.Model(&report).Where("id = ?", reportID).Updates(updates)
}

// generateTransactionReport generates transaction report data
func (s *AuditService) generateTransactionReport(startDate, endDate time.Time) (JSON, JSON) {
	var count int64
	s.db.Model(&AuditLog{}).Where("event_type = ? AND timestamp BETWEEN ? AND ?", 
		EventTypeTransaction, startDate, endDate).Count(&count)

	data := JSON{
		"period_start":      startDate,
		"period_end":        endDate,
		"transaction_count": count,
	}

	summary := JSON{
		"total_transactions": count,
		"period_days":       int(endDate.Sub(startDate).Hours() / 24),
	}

	return data, summary
}

// generateAuditReport generates audit report data
func (s *AuditService) generateAuditReport(startDate, endDate time.Time) (JSON, JSON) {
	var totalLogs int64
	s.db.Model(&AuditLog{}).Where("timestamp BETWEEN ? AND ?", startDate, endDate).Count(&totalLogs)

	// Count by event type
	var eventTypeCounts []struct {
		EventType string
		Count     int64
	}
	s.db.Model(&AuditLog{}).Select("event_type, count(*) as count").
		Where("timestamp BETWEEN ? AND ?", startDate, endDate).
		Group("event_type").Scan(&eventTypeCounts)

	data := JSON{
		"period_start":       startDate,
		"period_end":         endDate,
		"total_logs":         totalLogs,
		"event_type_counts":  eventTypeCounts,
	}

	summary := JSON{
		"total_audit_logs": totalLogs,
		"period_days":      int(endDate.Sub(startDate).Hours() / 24),
	}

	return data, summary
}

// generateRiskReport generates risk report data
func (s *AuditService) generateRiskReport(startDate, endDate time.Time) (JSON, JSON) {
	var criticalCount, highCount, mediumCount, lowCount int64

	s.db.Model(&AuditLog{}).Where("severity = ? AND timestamp BETWEEN ? AND ?", 
		SeverityCritical, startDate, endDate).Count(&criticalCount)
	s.db.Model(&AuditLog{}).Where("severity = ? AND timestamp BETWEEN ? AND ?", 
		SeverityError, startDate, endDate).Count(&highCount)
	s.db.Model(&AuditLog{}).Where("severity = ? AND timestamp BETWEEN ? AND ?", 
		SeverityWarning, startDate, endDate).Count(&mediumCount)
	s.db.Model(&AuditLog{}).Where("severity = ? AND timestamp BETWEEN ? AND ?", 
		SeverityInfo, startDate, endDate).Count(&lowCount)

	data := JSON{
		"period_start": startDate,
		"period_end":   endDate,
		"risk_levels": JSON{
			"critical": criticalCount,
			"high":     highCount,
			"medium":   mediumCount,
			"low":      lowCount,
		},
	}

	summary := JSON{
		"total_events":    criticalCount + highCount + mediumCount + lowCount,
		"critical_events": criticalCount,
		"high_risk_events": highCount,
	}

	return data, summary
}

// getLastAuditHash gets the hash of the last audit log for chain integrity
func (s *AuditService) getLastAuditHash() string {
	var lastLog AuditLog
	if err := s.db.Order("timestamp DESC").First(&lastLog).Error; err != nil {
		return "" // First log in chain
	}
	return lastLog.Hash
}

// calculateAuditHash calculates the hash of an audit log for integrity
func (s *AuditService) calculateAuditHash(log *AuditLog) string {
	data := fmt.Sprintf("%s%s%s%s%s%s%s%d",
		log.EventID,
		log.EventType,
		log.EntityType,
		log.EntityID.String(),
		log.Action,
		log.Description,
		log.PreviousHash,
		log.Timestamp.Unix(),
	)
	
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// Helper functions
func generateEventID() string {
	return fmt.Sprintf("EVT%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

func generateViolationRef() string {
	return fmt.Sprintf("VIO%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

func generateReportRef() string {
	return fmt.Sprintf("RPT%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	auditLogCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "audit_log_created_total",
			Help: "Total number of audit logs created",
		},
		[]string{"event_type", "severity"},
	)

	complianceViolationTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "compliance_violation_total",
			Help: "Total number of compliance violations",
		},
		[]string{"severity", "status"},
	)

	auditRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "audit_request_duration_seconds",
			Help: "Duration of audit requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(auditLogCreatedTotal)
	prometheus.MustRegister(complianceViolationTotal)
	prometheus.MustRegister(auditRequestDuration)
}

// HTTP Handlers
type AuditHandler struct {
	service *AuditService
}

func NewAuditHandler(service *AuditService) *AuditHandler {
	return &AuditHandler{service: service}
}

func (h *AuditHandler) CreateAuditLog(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("POST", "/audit-logs"))
	defer timer.ObserveDuration()

	var req CreateAuditLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	auditLog, err := h.service.CreateAuditLog(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	auditLogCreatedTotal.WithLabelValues(string(auditLog.EventType), string(auditLog.Severity)).Inc()

	c.JSON(http.StatusCreated, auditLog)
}

func (h *AuditHandler) GetAuditLogs(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("GET", "/audit-logs"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	eventType := EventType(c.Query("event_type"))
	entityType := c.Query("entity_type")

	var entityID, userID *uuid.UUID
	if entityIDStr := c.Query("entity_id"); entityIDStr != "" {
		if id, err := uuid.Parse(entityIDStr); err == nil {
			entityID = &id
		}
	}
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		if id, err := uuid.Parse(userIDStr); err == nil {
			userID = &id
		}
	}

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

	logs, total, err := h.service.GetAuditLogs(page, limit, eventType, entityType, entityID, userID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"logs":  logs,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func (h *AuditHandler) CreateComplianceRule(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("POST", "/compliance-rules"))
	defer timer.ObserveDuration()

	var req CreateComplianceRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	rule, err := h.service.CreateComplianceRule(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, rule)
}

func (h *AuditHandler) CreateViolation(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("POST", "/violations"))
	defer timer.ObserveDuration()

	var req CreateViolationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	violation, err := h.service.CreateViolation(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	complianceViolationTotal.WithLabelValues(string(violation.Severity), string(violation.Status)).Inc()

	c.JSON(http.StatusCreated, violation)
}

func (h *AuditHandler) UpdateViolation(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("PUT", "/violations/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid violation ID"})
		return
	}

	var req UpdateViolationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get updated_by from JWT token (simplified for demo)
	updatedBy := uuid.New()

	violation, err := h.service.UpdateViolation(id, req, updatedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, violation)
}

func (h *AuditHandler) GetComplianceViolations(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("GET", "/violations"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	status := ViolationStatus(c.Query("status"))
	severity := Severity(c.Query("severity"))

	var assignedTo *uuid.UUID
	if assignedToStr := c.Query("assigned_to"); assignedToStr != "" {
		if id, err := uuid.Parse(assignedToStr); err == nil {
			assignedTo = &id
		}
	}

	violations, total, err := h.service.GetComplianceViolations(page, limit, status, severity, assignedTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"violations": violations,
		"total":      total,
		"page":       page,
		"limit":      limit,
	})
}

func (h *AuditHandler) CreateReport(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("POST", "/reports"))
	defer timer.ObserveDuration()

	var req CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get generated_by from JWT token (simplified for demo)
	generatedBy := uuid.New()

	report, err := h.service.CreateReport(req, generatedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, report)
}

func (h *AuditHandler) VerifyIntegrity(c *gin.Context) {
	timer := prometheus.NewTimer(auditRequestDuration.WithLabelValues("POST", "/verify-integrity"))
	defer timer.ObserveDuration()

	startDateStr := c.Query("start_date")
	endDateStr := c.Query("end_date")

	if startDateStr == "" || endDateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "start_date and end_date are required"})
		return
	}

	startDate, err := time.Parse("2006-01-02", startDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format"})
		return
	}

	endDate, err := time.Parse("2006-01-02", endDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date format"})
		return
	}

	isValid, issues, err := h.service.VerifyAuditIntegrity(startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"is_valid": isValid,
		"issues":   issues,
		"period": gin.H{
			"start": startDate,
			"end":   endDate,
		},
	})
}

func setupRoutes(handler *AuditHandler) *gin.Engine {
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
		v1.POST("/audit-logs", handler.CreateAuditLog)
		v1.GET("/audit-logs", handler.GetAuditLogs)
		v1.POST("/compliance-rules", handler.CreateComplianceRule)
		
		violations := v1.Group("/violations")
		{
			violations.POST("", handler.CreateViolation)
			violations.GET("", handler.GetComplianceViolations)
			violations.PUT("/:id", handler.UpdateViolation)
		}

		v1.POST("/reports", handler.CreateReport)
		v1.POST("/verify-integrity", handler.VerifyIntegrity)
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
	if err := db.AutoMigrate(&AuditLog{}, &ComplianceRule{}, &ComplianceViolation{}, &ComplianceReport{}, &DataRetentionPolicy{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewAuditService(db)
	handler := NewAuditHandler(service)

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

	log.Printf("Audit and Compliance Service started on port %s", port)

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

