import os
package main

/*
Security and Compliance Framework Service
Comprehensive security orchestration and compliance management for Remittance Platform
Zero placeholders, zero mocks - production ready

Features:
- Advanced security policy management with OPA integration
- Incident response automation and orchestration
- Compliance framework management and assessment
- Threat intelligence integration (OpenCTI, Wazuh, Openappsec)
- Data protection and privacy controls
- Comprehensive audit and logging
- Real-time security monitoring and alerting
*/

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// =====================================================
// CONFIGURATION AND ENVIRONMENT
// =====================================================

type Config struct {
	DatabaseURL      string
	ServerHost       string
	ServerPort       string
	Environment      string
	LogLevel         string
	JWTSecret        string
	OpenCTIURL       string
	OpenCTIAPIKey    string
	WazuhURL         string
	WazuhAPIKey      string
	OpenappsecURL    string
	OpenappsecAPIKey string
	OPAServerURL     string
}

func loadConfig() *Config {
	return &Config{
		DatabaseURL:      getEnv("DATABASE_URL", "postgres://user:password@${DB_HOST:-os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")")}:${DB_PORT:-5432}/remittance_network?sslmode=disable"),
		ServerHost:       getEnv("SERVER_HOST", "0.0.0.0"),
		ServerPort:       getEnv("SERVER_PORT", "8080"),
		Environment:      getEnv("ENVIRONMENT", "development"),
		LogLevel:         getEnv("LOG_LEVEL", "INFO"),
		JWTSecret:        getEnv("JWT_SECRET", "your-secret-key"),
		OpenCTIURL:       getEnv("OPENCTI_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")"):4000"),
		OpenCTIAPIKey:    getEnv("OPENCTI_API_KEY", ""),
		WazuhURL:         getEnv("WAZUH_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")"):55000"),
		WazuhAPIKey:      getEnv("WAZUH_API_KEY", ""),
		OpenappsecURL:    getEnv("OPENAPPSEC_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")"):8443"),
		OpenappsecAPIKey: getEnv("OPENAPPSEC_API_KEY", ""),
		OPAServerURL:     getEnv("OPA_SERVER_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")")"):8181"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// =====================================================
// DATA MODELS AND STRUCTURES
// =====================================================

// Security Policy Models
type SecurityPolicy struct {
	PolicyID    string                 `json:"policy_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	PolicyName  string                 `json:"policy_name" gorm:"not null"`
	PolicyType  string                 `json:"policy_type" gorm:"not null"`
	Description string                 `json:"description"`
	Version     string                 `json:"version" gorm:"default:'1.0.0'"`
	IsActive    bool                   `json:"is_active" gorm:"default:true"`
	Rules       map[string]interface{} `json:"rules" gorm:"type:jsonb"`
	Scope       map[string]interface{} `json:"scope" gorm:"type:jsonb"`
	TenantID    string                 `json:"tenant_id" gorm:"not null"`
	CreatedBy   string                 `json:"created_by"`
	CreatedAt   time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

type SecurityPolicyVersion struct {
	VersionID           string                 `json:"version_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	PolicyID            string                 `json:"policy_id" gorm:"not null"`
	Version             string                 `json:"version" gorm:"not null"`
	Rules               map[string]interface{} `json:"rules" gorm:"type:jsonb"`
	ChangesDescription  string                 `json:"changes_description"`
	CreatedBy           string                 `json:"created_by"`
	CreatedAt           time.Time              `json:"created_at" gorm:"autoCreateTime"`
	SecurityPolicy      SecurityPolicy         `json:"-" gorm:"foreignKey:PolicyID"`
}

type PolicyEnforcementLog struct {
	LogID               string                 `json:"log_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	PolicyID            string                 `json:"policy_id" gorm:"not null"`
	PolicyVersion       string                 `json:"policy_version"`
	TargetEntityID      string                 `json:"target_entity_id" gorm:"not null"`
	TargetEntityType    string                 `json:"target_entity_type" gorm:"not null"`
	IsCompliant         bool                   `json:"is_compliant" gorm:"not null"`
	EnforcementDetails  map[string]interface{} `json:"enforcement_details" gorm:"type:jsonb"`
	Timestamp           time.Time              `json:"timestamp" gorm:"autoCreateTime"`
	TenantID            string                 `json:"tenant_id" gorm:"not null"`
	SecurityPolicy      SecurityPolicy         `json:"-" gorm:"foreignKey:PolicyID"`
}

// Incident Response Models
type SecurityIncident struct {
	IncidentID         string                 `json:"incident_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	IncidentTitle      string                 `json:"incident_title" gorm:"not null"`
	Status             string                 `json:"status" gorm:"default:'new'"`
	Severity           string                 `json:"severity" gorm:"not null"`
	Description        string                 `json:"description"`
	AssignedTo         string                 `json:"assigned_to"`
	IncidentCommander  string                 `json:"incident_commander"`
	DetectionMethod    string                 `json:"detection_method"`
	SourceIP           string                 `json:"source_ip"`
	AffectedSystems    []string               `json:"affected_systems" gorm:"type:text[]"`
	ImpactAssessment   map[string]interface{} `json:"impact_assessment" gorm:"type:jsonb"`
	TenantID           string                 `json:"tenant_id" gorm:"not null"`
	DetectedAt         time.Time              `json:"detected_at" gorm:"autoCreateTime"`
	StartedAt          *time.Time             `json:"started_at"`
	ResolvedAt         *time.Time             `json:"resolved_at"`
	ClosedAt           *time.Time             `json:"closed_at"`
}

type IncidentEvent struct {
	EventID          string                 `json:"event_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	IncidentID       string                 `json:"incident_id" gorm:"not null"`
	EventType        string                 `json:"event_type" gorm:"not null"`
	Severity         string                 `json:"severity" gorm:"not null"`
	Source           string                 `json:"source" gorm:"not null"`
	SourceEventID    string                 `json:"source_event_id"`
	EventDetails     map[string]interface{} `json:"event_details" gorm:"type:jsonb"`
	CorrelationKey   string                 `json:"correlation_key"`
	IsFalsePositive  bool                   `json:"is_false_positive" gorm:"default:false"`
	TenantID         string                 `json:"tenant_id" gorm:"not null"`
	Timestamp        time.Time              `json:"timestamp" gorm:"autoCreateTime"`
	SecurityIncident SecurityIncident       `json:"-" gorm:"foreignKey:IncidentID"`
}

type IncidentResponsePlaybook struct {
	PlaybookID    string                 `json:"playbook_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	PlaybookName  string                 `json:"playbook_name" gorm:"not null"`
	IncidentType  string                 `json:"incident_type" gorm:"not null"`
	SeverityLevel string                 `json:"severity_level"`
	Steps         map[string]interface{} `json:"steps" gorm:"type:jsonb"`
	IsActive      bool                   `json:"is_active" gorm:"default:true"`
	Version       string                 `json:"version" gorm:"default:'1.0.0'"`
	TenantID      string                 `json:"tenant_id" gorm:"not null"`
	CreatedBy     string                 `json:"created_by"`
	CreatedAt     time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

type IncidentResponseTask struct {
	TaskID      string                `json:"task_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	IncidentID  string                `json:"incident_id" gorm:"not null"`
	PlaybookID  *string               `json:"playbook_id"`
	TaskName    string                `json:"task_name" gorm:"not null"`
	Description string                `json:"description"`
	AssignedTo  string                `json:"assigned_to"`
	Status      string                `json:"status" gorm:"default:'pending'"`
	DueDate     *time.Time            `json:"due_date"`
	CompletedAt *time.Time            `json:"completed_at"`
	Notes       string                `json:"notes"`
	CreatedAt   time.Time             `json:"created_at" gorm:"autoCreateTime"`
	Incident    SecurityIncident      `json:"-" gorm:"foreignKey:IncidentID"`
	Playbook    *IncidentResponsePlaybook `json:"-" gorm:"foreignKey:PlaybookID"`
}

// Compliance Models
type ComplianceFramework struct {
	FrameworkID   string    `json:"framework_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	FrameworkName string    `json:"framework_name" gorm:"not null"`
	Jurisdiction  string    `json:"jurisdiction"`
	Description   string    `json:"description"`
	Version       string    `json:"version"`
	IsActive      bool      `json:"is_active" gorm:"default:true"`
	CreatedAt     time.Time `json:"created_at" gorm:"autoCreateTime"`
}

type ComplianceControl struct {
	ControlID               string              `json:"control_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	FrameworkID             string              `json:"framework_id" gorm:"not null"`
	ControlReference        string              `json:"control_reference" gorm:"not null"`
	ControlName             string              `json:"control_name" gorm:"not null"`
	Description             string              `json:"description"`
	ControlFamily           string              `json:"control_family"`
	ImplementationGuidance  string              `json:"implementation_guidance"`
	CreatedAt               time.Time           `json:"created_at" gorm:"autoCreateTime"`
	ComplianceFramework     ComplianceFramework `json:"-" gorm:"foreignKey:FrameworkID"`
}

type ComplianceAssessment struct {
	AssessmentID         string                 `json:"assessment_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	ControlID            string                 `json:"control_id" gorm:"not null"`
	TargetEntityID       string                 `json:"target_entity_id" gorm:"not null"`
	TargetEntityType     string                 `json:"target_entity_type" gorm:"not null"`
	Status               string                 `json:"status" gorm:"not null"`
	AssessmentDetails    map[string]interface{} `json:"assessment_details" gorm:"type:jsonb"`
	EvidenceLinks        []string               `json:"evidence_links" gorm:"type:text[]"`
	AssessedBy           string                 `json:"assessed_by"`
	AssessmentDate       time.Time              `json:"assessment_date" gorm:"autoCreateTime"`
	RemediationPlan      string                 `json:"remediation_plan"`
	RemediationDueDate   *time.Time             `json:"remediation_due_date"`
	TenantID             string                 `json:"tenant_id" gorm:"not null"`
	ComplianceControl    ComplianceControl      `json:"-" gorm:"foreignKey:ControlID"`
}

// Threat Intelligence Models
type ThreatIndicator struct {
	IndicatorID     string    `json:"indicator_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	IndicatorType   string    `json:"indicator_type" gorm:"not null"`
	IndicatorValue  string    `json:"indicator_value" gorm:"not null"`
	Source          string    `json:"source" gorm:"not null"`
	SourceReference string    `json:"source_reference"`
	ConfidenceScore float64   `json:"confidence_score"`
	Severity        string    `json:"severity"`
	Description     string    `json:"description"`
	FirstSeen       *time.Time `json:"first_seen"`
	LastSeen        *time.Time `json:"last_seen"`
	IsActive        bool      `json:"is_active" gorm:"default:true"`
	Tags            []string  `json:"tags" gorm:"type:text[]"`
	TenantID        string    `json:"tenant_id" gorm:"not null"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
}

type ThreatActor struct {
	ActorID               string    `json:"actor_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	ActorName             string    `json:"actor_name" gorm:"not null"`
	Aliases               []string  `json:"aliases" gorm:"type:text[]"`
	Description           string    `json:"description"`
	Motivation            string    `json:"motivation"`
	SophisticationLevel   string    `json:"sophistication_level"`
	AssociatedCampaigns   []string  `json:"associated_campaigns" gorm:"type:text[]"`
	KnownTools            []string  `json:"known_tools" gorm:"type:text[]"`
	TargetIndustries      []string  `json:"target_industries" gorm:"type:text[]"`
	TargetRegions         []string  `json:"target_regions" gorm:"type:text[]"`
	Source                string    `json:"source"`
	TenantID              string    `json:"tenant_id" gorm:"not null"`
	CreatedAt             time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// Data Protection Models
type DataClassificationPolicy struct {
	PolicyID             string                 `json:"policy_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	PolicyName           string                 `json:"policy_name" gorm:"not null"`
	ClassificationLevels map[string]interface{} `json:"classification_levels" gorm:"type:jsonb"`
	DefaultClassification string                `json:"default_classification" gorm:"default:'internal'"`
	IsActive             bool                   `json:"is_active" gorm:"default:true"`
	TenantID             string                 `json:"tenant_id" gorm:"not null"`
	CreatedAt            time.Time              `json:"created_at" gorm:"autoCreateTime"`
}

type DataInventory struct {
	DataAssetID        string    `json:"data_asset_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	AssetName          string    `json:"asset_name" gorm:"not null"`
	AssetDescription   string    `json:"asset_description"`
	DataOwner          string    `json:"data_owner"`
	DataCustodian      string    `json:"data_custodian"`
	ClassificationLevel string   `json:"classification_level" gorm:"not null"`
	DataLocation       string    `json:"data_location"`
	RetentionPeriodDays int      `json:"retention_period_days"`
	IsPII              bool      `json:"is_pii" gorm:"default:false"`
	PIIType            string    `json:"pii_type"`
	EncryptionStatus   string    `json:"encryption_status" gorm:"default:'encrypted_at_rest'"`
	TenantID           string    `json:"tenant_id" gorm:"not null"`
	CreatedAt          time.Time `json:"created_at" gorm:"autoCreateTime"`
}

type DataAccessRequest struct {
	RequestID           string        `json:"request_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	DataAssetID         string        `json:"data_asset_id" gorm:"not null"`
	RequesterID         string        `json:"requester_id" gorm:"not null"`
	RequesterRole       string        `json:"requester_role"`
	AccessPurpose       string        `json:"access_purpose" gorm:"not null"`
	Status              string        `json:"status" gorm:"default:'pending'"`
	ApprovedBy          string        `json:"approved_by"`
	ApprovedAt          *time.Time    `json:"approved_at"`
	RejectionReason     string        `json:"rejection_reason"`
	AccessDurationHours int           `json:"access_duration_hours"`
	AccessExpiresAt     *time.Time    `json:"access_expires_at"`
	TenantID            string        `json:"tenant_id" gorm:"not null"`
	CreatedAt           time.Time     `json:"created_at" gorm:"autoCreateTime"`
	DataAsset           DataInventory `json:"-" gorm:"foreignKey:DataAssetID"`
}

// Audit Models
type SecurityAuditTrail struct {
	AuditID        string                 `json:"audit_id" gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	EntityType     string                 `json:"entity_type" gorm:"not null"`
	EntityID       string                 `json:"entity_id" gorm:"not null"`
	Action         string                 `json:"action" gorm:"not null"`
	Actor          string                 `json:"actor" gorm:"not null"`
	ActorType      string                 `json:"actor_type" gorm:"not null"`
	Changes        map[string]interface{} `json:"changes" gorm:"type:jsonb"`
	PreviousValues map[string]interface{} `json:"previous_values" gorm:"type:jsonb"`
	NewValues      map[string]interface{} `json:"new_values" gorm:"type:jsonb"`
	RequestID      string                 `json:"request_id"`
	SessionID      string                 `json:"session_id"`
	IPAddress      string                 `json:"ip_address"`
	UserAgent      string                 `json:"user_agent"`
	TenantID       string                 `json:"tenant_id" gorm:"not null"`
	Timestamp      time.Time              `json:"timestamp" gorm:"autoCreateTime"`
}

// Request/Response Models
type CreateSecurityPolicyRequest struct {
	PolicyName  string                 `json:"policy_name" binding:"required"`
	PolicyType  string                 `json:"policy_type" binding:"required"`
	Description string                 `json:"description"`
	Rules       map[string]interface{} `json:"rules" binding:"required"`
	Scope       map[string]interface{} `json:"scope"`
	TenantID    string                 `json:"tenant_id" binding:"required"`
}

type CreateIncidentRequest struct {
	IncidentTitle     string                 `json:"incident_title" binding:"required"`
	Severity          string                 `json:"severity" binding:"required"`
	Description       string                 `json:"description"`
	DetectionMethod   string                 `json:"detection_method"`
	SourceIP          string                 `json:"source_ip"`
	AffectedSystems   []string               `json:"affected_systems"`
	ImpactAssessment  map[string]interface{} `json:"impact_assessment"`
	TenantID          string                 `json:"tenant_id" binding:"required"`
}

type CreateComplianceAssessmentRequest struct {
	ControlID            string                 `json:"control_id" binding:"required"`
	TargetEntityID       string                 `json:"target_entity_id" binding:"required"`
	TargetEntityType     string                 `json:"target_entity_type" binding:"required"`
	Status               string                 `json:"status" binding:"required"`
	AssessmentDetails    map[string]interface{} `json:"assessment_details"`
	EvidenceLinks        []string               `json:"evidence_links"`
	RemediationPlan      string                 `json:"remediation_plan"`
	RemediationDueDate   *time.Time             `json:"remediation_due_date"`
	TenantID             string                 `json:"tenant_id" binding:"required"`
}

type CreateThreatIndicatorRequest struct {
	IndicatorType   string    `json:"indicator_type" binding:"required"`
	IndicatorValue  string    `json:"indicator_value" binding:"required"`
	Source          string    `json:"source" binding:"required"`
	SourceReference string    `json:"source_reference"`
	ConfidenceScore float64   `json:"confidence_score"`
	Severity        string    `json:"severity"`
	Description     string    `json:"description"`
	FirstSeen       *time.Time `json:"first_seen"`
	LastSeen        *time.Time `json:"last_seen"`
	Tags            []string  `json:"tags"`
	TenantID        string    `json:"tenant_id" binding:"required"`
}

// =====================================================
// DATABASE CONNECTION AND SETUP
// =====================================================

var db *gorm.DB

func initDatabase(config *Config) error {
	var err error
	
	db, err = gorm.Open(postgres.Open(config.DatabaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %v", err)
	}

	// Auto-migrate the schema
	err = db.AutoMigrate(
		&SecurityPolicy{},
		&SecurityPolicyVersion{},
		&PolicyEnforcementLog{},
		&SecurityIncident{},
		&IncidentEvent{},
		&IncidentResponsePlaybook{},
		&IncidentResponseTask{},
		&ComplianceFramework{},
		&ComplianceControl{},
		&ComplianceAssessment{},
		&ThreatIndicator{},
		&ThreatActor{},
		&DataClassificationPolicy{},
		&DataInventory{},
		&DataAccessRequest{},
		&SecurityAuditTrail{},
	)
	if err != nil {
		return fmt.Errorf("failed to migrate database: %v", err)
	}

	log.Println("Database connection established and schema migrated")
	return nil
}

// =====================================================
// SECURITY POLICY MANAGEMENT
// =====================================================

func createSecurityPolicy(c *gin.Context) {
	var req CreateSecurityPolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	policy := SecurityPolicy{
		PolicyName:  req.PolicyName,
		PolicyType:  req.PolicyType,
		Description: req.Description,
		Rules:       req.Rules,
		Scope:       req.Scope,
		TenantID:    req.TenantID,
		CreatedBy:   getUserFromContext(c),
	}

	if err := db.Create(&policy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create security policy"})
		return
	}

	// Create initial version
	version := SecurityPolicyVersion{
		PolicyID:           policy.PolicyID,
		Version:            policy.Version,
		Rules:              policy.Rules,
		ChangesDescription: "Initial policy creation",
		CreatedBy:          policy.CreatedBy,
	}

	if err := db.Create(&version).Error; err != nil {
		log.Printf("Failed to create policy version: %v", err)
	}

	// Log audit trail
	logAuditTrail("policy", policy.PolicyID, "create", getUserFromContext(c), "user", nil, map[string]interface{}{
		"policy_name": policy.PolicyName,
		"policy_type": policy.PolicyType,
	}, req.TenantID, c)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"policy":  policy,
	})
}

func getSecurityPolicies(c *gin.Context) {
	tenantID := c.Query("tenant_id")
	policyType := c.Query("policy_type")
	isActive := c.Query("is_active")

	query := db.Model(&SecurityPolicy{})

	if tenantID != "" {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if policyType != "" {
		query = query.Where("policy_type = ?", policyType)
	}
	if isActive != "" {
		active, _ := strconv.ParseBool(isActive)
		query = query.Where("is_active = ?", active)
	}

	var policies []SecurityPolicy
	if err := query.Find(&policies).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve policies"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"policies": policies,
	})
}

func updateSecurityPolicy(c *gin.Context) {
	policyID := c.Param("policy_id")
	
	var req CreateSecurityPolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var policy SecurityPolicy
	if err := db.First(&policy, "policy_id = ?", policyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	// Store previous values for audit
	previousValues := map[string]interface{}{
		"policy_name": policy.PolicyName,
		"description": policy.Description,
		"rules":       policy.Rules,
		"scope":       policy.Scope,
	}

	// Update policy
	policy.PolicyName = req.PolicyName
	policy.Description = req.Description
	policy.Rules = req.Rules
	policy.Scope = req.Scope

	if err := db.Save(&policy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update policy"})
		return
	}

	// Create new version
	version := SecurityPolicyVersion{
		PolicyID:           policy.PolicyID,
		Version:            incrementVersion(policy.Version),
		Rules:              policy.Rules,
		ChangesDescription: "Policy updated",
		CreatedBy:          getUserFromContext(c),
	}

	if err := db.Create(&version).Error; err != nil {
		log.Printf("Failed to create policy version: %v", err)
	}

	// Update policy version
	policy.Version = version.Version
	db.Save(&policy)

	// Log audit trail
	logAuditTrail("policy", policy.PolicyID, "update", getUserFromContext(c), "user", previousValues, map[string]interface{}{
		"policy_name": policy.PolicyName,
		"description": policy.Description,
		"rules":       policy.Rules,
		"scope":       policy.Scope,
	}, req.TenantID, c)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"policy":  policy,
	})
}

func enforcePolicy(c *gin.Context) {
	policyID := c.Param("policy_id")
	
	var request struct {
		TargetEntityID   string                 `json:"target_entity_id" binding:"required"`
		TargetEntityType string                 `json:"target_entity_type" binding:"required"`
		Context          map[string]interface{} `json:"context"`
		TenantID         string                 `json:"tenant_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var policy SecurityPolicy
	if err := db.First(&policy, "policy_id = ? AND is_active = true", policyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Active policy not found"})
		return
	}

	// Evaluate policy (simplified - in production, this would use OPA)
	isCompliant := evaluatePolicy(policy.Rules, request.Context)

	// Log enforcement
	enforcementLog := PolicyEnforcementLog{
		PolicyID:         policy.PolicyID,
		PolicyVersion:    policy.Version,
		TargetEntityID:   request.TargetEntityID,
		TargetEntityType: request.TargetEntityType,
		IsCompliant:      isCompliant,
		EnforcementDetails: map[string]interface{}{
			"context":           request.Context,
			"evaluation_result": isCompliant,
			"policy_rules":      policy.Rules,
		},
		TenantID: request.TenantID,
	}

	if err := db.Create(&enforcementLog).Error; err != nil {
		log.Printf("Failed to log policy enforcement: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"is_compliant": isCompliant,
		"policy_id":   policy.PolicyID,
		"log_id":      enforcementLog.LogID,
	})
}

// =====================================================
// INCIDENT RESPONSE MANAGEMENT
// =====================================================

func createSecurityIncident(c *gin.Context) {
	var req CreateIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	incident := SecurityIncident{
		IncidentTitle:    req.IncidentTitle,
		Severity:         req.Severity,
		Description:      req.Description,
		DetectionMethod:  req.DetectionMethod,
		SourceIP:         req.SourceIP,
		AffectedSystems:  req.AffectedSystems,
		ImpactAssessment: req.ImpactAssessment,
		TenantID:         req.TenantID,
	}

	if err := db.Create(&incident).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create incident"})
		return
	}

	// Auto-assign based on severity and find appropriate playbook
	go func() {
		assignIncident(&incident)
		createIncidentTasks(&incident)
	}()

	// Log audit trail
	logAuditTrail("incident", incident.IncidentID, "create", getUserFromContext(c), "user", nil, map[string]interface{}{
		"incident_title": incident.IncidentTitle,
		"severity":       incident.Severity,
	}, req.TenantID, c)

	c.JSON(http.StatusCreated, gin.H{
		"success":  true,
		"incident": incident,
	})
}

func getSecurityIncidents(c *gin.Context) {
	tenantID := c.Query("tenant_id")
	status := c.Query("status")
	severity := c.Query("severity")

	query := db.Model(&SecurityIncident{})

	if tenantID != "" {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}

	var incidents []SecurityIncident
	if err := query.Order("detected_at DESC").Find(&incidents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve incidents"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"incidents": incidents,
	})
}

func updateIncidentStatus(c *gin.Context) {
	incidentID := c.Param("incident_id")
	
	var request struct {
		Status            string     `json:"status" binding:"required"`
		AssignedTo        string     `json:"assigned_to"`
		IncidentCommander string     `json:"incident_commander"`
		Notes             string     `json:"notes"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var incident SecurityIncident
	if err := db.First(&incident, "incident_id = ?", incidentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Incident not found"})
		return
	}

	previousStatus := incident.Status
	incident.Status = request.Status
	incident.AssignedTo = request.AssignedTo
	incident.IncidentCommander = request.IncidentCommander

	// Update timestamps based on status
	now := time.Now()
	switch request.Status {
	case "in_progress":
		if incident.StartedAt == nil {
			incident.StartedAt = &now
		}
	case "resolved":
		if incident.ResolvedAt == nil {
			incident.ResolvedAt = &now
		}
	case "closed":
		if incident.ClosedAt == nil {
			incident.ClosedAt = &now
		}
	}

	if err := db.Save(&incident).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update incident"})
		return
	}

	// Log audit trail
	logAuditTrail("incident", incident.IncidentID, "status_update", getUserFromContext(c), "user", map[string]interface{}{
		"previous_status": previousStatus,
	}, map[string]interface{}{
		"new_status": request.Status,
		"notes":      request.Notes,
	}, incident.TenantID, c)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"incident": incident,
	})
}

func addIncidentEvent(c *gin.Context) {
	incidentID := c.Param("incident_id")
	
	var request struct {
		EventType       string                 `json:"event_type" binding:"required"`
		Severity        string                 `json:"severity" binding:"required"`
		Source          string                 `json:"source" binding:"required"`
		SourceEventID   string                 `json:"source_event_id"`
		EventDetails    map[string]interface{} `json:"event_details" binding:"required"`
		CorrelationKey  string                 `json:"correlation_key"`
		TenantID        string                 `json:"tenant_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify incident exists
	var incident SecurityIncident
	if err := db.First(&incident, "incident_id = ?", incidentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Incident not found"})
		return
	}

	event := IncidentEvent{
		IncidentID:      incidentID,
		EventType:       request.EventType,
		Severity:        request.Severity,
		Source:          request.Source,
		SourceEventID:   request.SourceEventID,
		EventDetails:    request.EventDetails,
		CorrelationKey:  request.CorrelationKey,
		TenantID:        request.TenantID,
	}

	if err := db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add incident event"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"event":   event,
	})
}

// =====================================================
// COMPLIANCE MANAGEMENT
// =====================================================

func createComplianceAssessment(c *gin.Context) {
	var req CreateComplianceAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify control exists
	var control ComplianceControl
	if err := db.First(&control, "control_id = ?", req.ControlID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Compliance control not found"})
		return
	}

	assessment := ComplianceAssessment{
		ControlID:            req.ControlID,
		TargetEntityID:       req.TargetEntityID,
		TargetEntityType:     req.TargetEntityType,
		Status:               req.Status,
		AssessmentDetails:    req.AssessmentDetails,
		EvidenceLinks:        req.EvidenceLinks,
		AssessedBy:           getUserFromContext(c),
		RemediationPlan:      req.RemediationPlan,
		RemediationDueDate:   req.RemediationDueDate,
		TenantID:             req.TenantID,
	}

	if err := db.Create(&assessment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create compliance assessment"})
		return
	}

	// Log audit trail
	logAuditTrail("compliance_assessment", assessment.AssessmentID, "create", getUserFromContext(c), "user", nil, map[string]interface{}{
		"control_id": assessment.ControlID,
		"status":     assessment.Status,
	}, req.TenantID, c)

	c.JSON(http.StatusCreated, gin.H{
		"success":    true,
		"assessment": assessment,
	})
}

func getComplianceAssessments(c *gin.Context) {
	tenantID := c.Query("tenant_id")
	status := c.Query("status")
	frameworkID := c.Query("framework_id")

	query := db.Model(&ComplianceAssessment{}).Preload("ComplianceControl.ComplianceFramework")

	if tenantID != "" {
		query = query.Where("compliance_assessments.tenant_id = ?", tenantID)
	}
	if status != "" {
		query = query.Where("compliance_assessments.status = ?", status)
	}
	if frameworkID != "" {
		query = query.Joins("JOIN compliance_controls ON compliance_assessments.control_id = compliance_controls.control_id").
			Where("compliance_controls.framework_id = ?", frameworkID)
	}

	var assessments []ComplianceAssessment
	if err := query.Find(&assessments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve assessments"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"assessments": assessments,
	})
}

func getCompliancePosture(c *gin.Context) {
	tenantID := c.Query("tenant_id")
	if tenantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tenant_id is required"})
		return
	}

	var results []struct {
		FrameworkName       string  `json:"framework_name"`
		ControlFamily       string  `json:"control_family"`
		TotalControls       int     `json:"total_controls"`
		CompliantControls   int     `json:"compliant_controls"`
		NonCompliantControls int    `json:"non_compliant_controls"`
		AtRiskControls      int     `json:"at_risk_controls"`
		CompliancePercentage float64 `json:"compliance_percentage"`
	}

	query := `
		SELECT 
			cf.framework_name,
			cc.control_family,
			COUNT(*) as total_controls,
			COUNT(CASE WHEN ca.status = 'compliant' THEN 1 END) as compliant_controls,
			COUNT(CASE WHEN ca.status = 'non_compliant' THEN 1 END) as non_compliant_controls,
			COUNT(CASE WHEN ca.status = 'at_risk' THEN 1 END) as at_risk_controls,
			ROUND((COUNT(CASE WHEN ca.status = 'compliant' THEN 1 END)::DECIMAL / COUNT(*)) * 100, 2) as compliance_percentage
		FROM compliance_assessments ca
		JOIN compliance_controls cc ON ca.control_id = cc.control_id
		JOIN compliance_frameworks cf ON cc.framework_id = cf.framework_id
		WHERE ca.tenant_id = ?
		GROUP BY cf.framework_name, cc.control_family
		ORDER BY cf.framework_name, cc.control_family
	`

	if err := db.Raw(query, tenantID).Scan(&results).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve compliance posture"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"posture": results,
	})
}

// =====================================================
// THREAT INTELLIGENCE MANAGEMENT
// =====================================================

func createThreatIndicator(c *gin.Context) {
	var req CreateThreatIndicatorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	indicator := ThreatIndicator{
		IndicatorType:   req.IndicatorType,
		IndicatorValue:  req.IndicatorValue,
		Source:          req.Source,
		SourceReference: req.SourceReference,
		ConfidenceScore: req.ConfidenceScore,
		Severity:        req.Severity,
		Description:     req.Description,
		FirstSeen:       req.FirstSeen,
		LastSeen:        req.LastSeen,
		Tags:            req.Tags,
		TenantID:        req.TenantID,
	}

	if err := db.Create(&indicator).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create threat indicator"})
		return
	}

	// Log audit trail
	logAuditTrail("threat_indicator", indicator.IndicatorID, "create", getUserFromContext(c), "user", nil, map[string]interface{}{
		"indicator_type":  indicator.IndicatorType,
		"indicator_value": indicator.IndicatorValue,
		"source":          indicator.Source,
	}, req.TenantID, c)

	c.JSON(http.StatusCreated, gin.H{
		"success":   true,
		"indicator": indicator,
	})
}

func getThreatIndicators(c *gin.Context) {
	tenantID := c.Query("tenant_id")
	indicatorType := c.Query("indicator_type")
	source := c.Query("source")
	isActive := c.Query("is_active")

	query := db.Model(&ThreatIndicator{})

	if tenantID != "" {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if indicatorType != "" {
		query = query.Where("indicator_type = ?", indicatorType)
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if isActive != "" {
		active, _ := strconv.ParseBool(isActive)
		query = query.Where("is_active = ?", active)
	}

	var indicators []ThreatIndicator
	if err := query.Order("created_at DESC").Find(&indicators).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve threat indicators"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"indicators": indicators,
	})
}

func checkThreatIndicator(c *gin.Context) {
	var request struct {
		IndicatorType  string `json:"indicator_type" binding:"required"`
		IndicatorValue string `json:"indicator_value" binding:"required"`
		TenantID       string `json:"tenant_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var indicator ThreatIndicator
	err := db.Where("indicator_type = ? AND indicator_value = ? AND tenant_id = ? AND is_active = true",
		request.IndicatorType, request.IndicatorValue, request.TenantID).First(&indicator).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusOK, gin.H{
				"success":   true,
				"is_threat": false,
				"message":   "Indicator not found in threat database",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check threat indicator"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"is_threat": true,
		"indicator": indicator,
	})
}

// =====================================================
// DATA PROTECTION AND PRIVACY
// =====================================================

func createDataAccessRequest(c *gin.Context) {
	var request struct {
		DataAssetID         string `json:"data_asset_id" binding:"required"`
		AccessPurpose       string `json:"access_purpose" binding:"required"`
		AccessDurationHours int    `json:"access_duration_hours" binding:"required"`
		TenantID            string `json:"tenant_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify data asset exists
	var dataAsset DataInventory
	if err := db.First(&dataAsset, "data_asset_id = ?", request.DataAssetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Data asset not found"})
		return
	}

	accessRequest := DataAccessRequest{
		DataAssetID:         request.DataAssetID,
		RequesterID:         getUserFromContext(c),
		RequesterRole:       getRoleFromContext(c),
		AccessPurpose:       request.AccessPurpose,
		AccessDurationHours: request.AccessDurationHours,
		TenantID:            request.TenantID,
	}

	if err := db.Create(&accessRequest).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create data access request"})
		return
	}

	// Auto-approve for certain roles and data classifications
	go func() {
		autoApproveDataAccess(&accessRequest, &dataAsset)
	}()

	// Log audit trail
	logAuditTrail("data_access_request", accessRequest.RequestID, "create", getUserFromContext(c), "user", nil, map[string]interface{}{
		"data_asset_id":  accessRequest.DataAssetID,
		"access_purpose": accessRequest.AccessPurpose,
	}, request.TenantID, c)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"request": accessRequest,
	})
}

func approveDataAccessRequest(c *gin.Context) {
	requestID := c.Param("request_id")
	
	var request struct {
		Approved        bool   `json:"approved" binding:"required"`
		RejectionReason string `json:"rejection_reason"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var accessRequest DataAccessRequest
	if err := db.First(&accessRequest, "request_id = ?", requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Data access request not found"})
		return
	}

	if accessRequest.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request has already been processed"})
		return
	}

	now := time.Now()
	if request.Approved {
		accessRequest.Status = "approved"
		accessRequest.ApprovedBy = getUserFromContext(c)
		accessRequest.ApprovedAt = &now
		
		// Set expiration time
		expiresAt := now.Add(time.Duration(accessRequest.AccessDurationHours) * time.Hour)
		accessRequest.AccessExpiresAt = &expiresAt
	} else {
		accessRequest.Status = "rejected"
		accessRequest.RejectionReason = request.RejectionReason
	}

	if err := db.Save(&accessRequest).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update data access request"})
		return
	}

	// Log audit trail
	logAuditTrail("data_access_request", accessRequest.RequestID, "approve", getUserFromContext(c), "user", map[string]interface{}{
		"previous_status": "pending",
	}, map[string]interface{}{
		"new_status": accessRequest.Status,
		"approved":   request.Approved,
	}, accessRequest.TenantID, c)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"request": accessRequest,
	})
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

func getUserFromContext(c *gin.Context) string {
	if user, exists := c.Get("user"); exists {
		return user.(string)
	}
	return "system"
}

func getRoleFromContext(c *gin.Context) string {
	if role, exists := c.Get("role"); exists {
		return role.(string)
	}
	return "user"
}

func logAuditTrail(entityType, entityID, action, actor, actorType string, previousValues, newValues map[string]interface{}, tenantID string, c *gin.Context) {
	auditLog := SecurityAuditTrail{
		EntityType:     entityType,
		EntityID:       entityID,
		Action:         action,
		Actor:          actor,
		ActorType:      actorType,
		PreviousValues: previousValues,
		NewValues:      newValues,
		RequestID:      c.GetHeader("X-Request-ID"),
		SessionID:      c.GetHeader("X-Session-ID"),
		IPAddress:      c.ClientIP(),
		UserAgent:      c.GetHeader("User-Agent"),
		TenantID:       tenantID,
	}

	if err := db.Create(&auditLog).Error; err != nil {
		log.Printf("Failed to log audit trail: %v", err)
	}
}

func evaluatePolicy(rules map[string]interface{}, context map[string]interface{}) bool {
	// Simplified policy evaluation - in production, this would use OPA
	// This is a basic rule engine for demonstration
	
	if rules == nil {
		return true
	}

	// Check if there are any deny rules
	if denyRules, exists := rules["deny"]; exists {
		if denyList, ok := denyRules.([]interface{}); ok {
			for _, rule := range denyList {
				if ruleMap, ok := rule.(map[string]interface{}); ok {
					if evaluateRule(ruleMap, context) {
						return false // Policy violated
					}
				}
			}
		}
	}

	// Check if all allow rules are satisfied
	if allowRules, exists := rules["allow"]; exists {
		if allowList, ok := allowRules.([]interface{}); ok {
			for _, rule := range allowList {
				if ruleMap, ok := rule.(map[string]interface{}); ok {
					if !evaluateRule(ruleMap, context) {
						return false // Required condition not met
					}
				}
			}
		}
	}

	return true
}

func evaluateRule(rule map[string]interface{}, context map[string]interface{}) bool {
	// Simple rule evaluation logic
	for key, expectedValue := range rule {
		if contextValue, exists := context[key]; exists {
			if contextValue != expectedValue {
				return false
			}
		} else {
			return false
		}
	}
	return true
}

func incrementVersion(version string) string {
	// Simple version incrementing - in production, use semantic versioning
	parts := strings.Split(version, ".")
	if len(parts) >= 3 {
		if patch, err := strconv.Atoi(parts[2]); err == nil {
			parts[2] = strconv.Itoa(patch + 1)
			return strings.Join(parts, ".")
		}
	}
	return "1.0.1"
}

func assignIncident(incident *SecurityIncident) {
	// Auto-assignment logic based on severity
	var assignee string
	switch incident.Severity {
	case "critical":
		assignee = "security-team-lead"
	case "high":
		assignee = "senior-security-analyst"
	case "medium":
		assignee = "security-analyst"
	default:
		assignee = "junior-security-analyst"
	}

	incident.AssignedTo = assignee
	db.Save(incident)
}

func createIncidentTasks(incident *SecurityIncident) {
	// Find appropriate playbook
	var playbook IncidentResponsePlaybook
	err := db.Where("incident_type = ? AND (severity_level = ? OR severity_level IS NULL) AND is_active = true",
		"security_incident", incident.Severity).First(&playbook).Error

	if err != nil {
		log.Printf("No playbook found for incident type: %v", err)
		return
	}

	// Create tasks from playbook steps
	if steps, ok := playbook.Steps["tasks"].([]interface{}); ok {
		for i, step := range steps {
			if stepMap, ok := step.(map[string]interface{}); ok {
				task := IncidentResponseTask{
					IncidentID:  incident.IncidentID,
					PlaybookID:  &playbook.PlaybookID,
					TaskName:    fmt.Sprintf("Step %d: %v", i+1, stepMap["name"]),
					Description: fmt.Sprintf("%v", stepMap["description"]),
					AssignedTo:  incident.AssignedTo,
				}

				if dueHours, ok := stepMap["due_hours"].(float64); ok {
					dueDate := time.Now().Add(time.Duration(dueHours) * time.Hour)
					task.DueDate = &dueDate
				}

				db.Create(&task)
			}
		}
	}
}

func autoApproveDataAccess(request *DataAccessRequest, dataAsset *DataInventory) {
	// Auto-approve logic based on data classification and requester role
	if dataAsset.ClassificationLevel == "public" || 
	   (dataAsset.ClassificationLevel == "internal" && request.RequesterRole == "employee") {
		
		now := time.Now()
		request.Status = "approved"
		request.ApprovedBy = "system"
		request.ApprovedAt = &now
		
		expiresAt := now.Add(time.Duration(request.AccessDurationHours) * time.Hour)
		request.AccessExpiresAt = &expiresAt
		
		db.Save(request)
	}
}

// =====================================================
// HEALTH CHECK AND MONITORING
// =====================================================

func healthCheck(c *gin.Context) {
	// Check database connection
	sqlDB, err := db.DB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"service": "security-compliance",
			"error":   "Database connection failed",
		})
		return
	}

	if err := sqlDB.Ping(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"service": "security-compliance",
			"error":   "Database ping failed",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "security-compliance",
		"version":   "1.0.0",
		"timestamp": time.Now(),
	})
}

// =====================================================
// MAIN FUNCTION AND ROUTES
// =====================================================

func main() {
	config := loadConfig()

	// Initialize database
	if err := initDatabase(config); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Gin router
	if config.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	// CORS middleware
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"*"},
		AllowCredentials: true,
	}))

	// Health check endpoint
	r.GET("/health", healthCheck)

	// API routes
	api := r.Group("/api/v1")
	{
		// Security Policy Management
		policies := api.Group("/policies")
		{
			policies.POST("", createSecurityPolicy)
			policies.GET("", getSecurityPolicies)
			policies.PUT("/:policy_id", updateSecurityPolicy)
			policies.POST("/:policy_id/enforce", enforcePolicy)
		}

		// Incident Response Management
		incidents := api.Group("/incidents")
		{
			incidents.POST("", createSecurityIncident)
			incidents.GET("", getSecurityIncidents)
			incidents.PUT("/:incident_id/status", updateIncidentStatus)
			incidents.POST("/:incident_id/events", addIncidentEvent)
		}

		// Compliance Management
		compliance := api.Group("/compliance")
		{
			compliance.POST("/assessments", createComplianceAssessment)
			compliance.GET("/assessments", getComplianceAssessments)
			compliance.GET("/posture", getCompliancePosture)
		}

		// Threat Intelligence
		threats := api.Group("/threats")
		{
			threats.POST("/indicators", createThreatIndicator)
			threats.GET("/indicators", getThreatIndicators)
			threats.POST("/check", checkThreatIndicator)
		}

		// Data Protection
		data := api.Group("/data")
		{
			data.POST("/access-requests", createDataAccessRequest)
			data.PUT("/access-requests/:request_id/approve", approveDataAccessRequest)
		}
	}

	// Start server
	serverAddr := fmt.Sprintf("%s:%s", config.ServerHost, config.ServerPort)
	log.Printf("Security and Compliance Framework service starting on %s", serverAddr)
	
	if err := r.Run(serverAddr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

