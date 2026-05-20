import os
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// =====================================================
// CONFIGURATION
// =====================================================

type Config struct {
	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string
	RedisHost  string
	RedisPort  string
	RedisDB    int
	Port       string
	AIServiceURL string
}

func loadConfig() *Config {
	return &Config{
		DBHost:       getEnv("DB_HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")"),
		DBPort:       getEnv("DB_PORT", "5432"),
		DBName:       getEnv("DB_NAME", "remittance_network"),
		DBUser:       getEnv("DB_USER", "postgres"),
		DBPassword:   getEnv("DB_PASSWORD", "password"),
		RedisHost:    getEnv("REDIS_HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")"),
		RedisPort:    getEnv("REDIS_PORT", "6379"),
		RedisDB:      getEnvAsInt("REDIS_DB", 0),
		Port:         getEnv("PORT", "8080"),
		AIServiceURL: getEnv("AI_SERVICE_URL", "http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")"):8081"),
	}
}

func getEnv(key, defaultValue string) string {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	if value := os.Getenv(key); value != "" {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
		return value

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	return defaultValue

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// =====================================================
// DATABASE MODELS
// =====================================================

type CustomerOnboarding struct {
	ID                        string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerReferenceNumber   string                 `json:"customer_reference_number" gorm:"type:varchar(50);unique;not null"`
	AgentID                   string                 `json:"agent_id" gorm:"type:uuid;not null"`
	AgentTier                 string                 `json:"agent_tier" gorm:"type:varchar(20);not null"`
	CustomerType              string                 `json:"customer_type" gorm:"type:varchar(20);not null;default:'individual'"`
	CustomerTier              string                 `json:"customer_tier" gorm:"type:varchar(20);not null;default:'basic'"`
	Status                    string                 `json:"status" gorm:"type:varchar(30);not null;default:'application_started'"`
	CurrentStep               string                 `json:"current_step" gorm:"type:varchar(50);not null;default:'personal_information'"`
	ProgressPercentage        float64                `json:"progress_percentage" gorm:"type:decimal(5,2);default:0.00"`
	FirstName                 string                 `json:"first_name" gorm:"type:varchar(100);not null"`
	LastName                  string                 `json:"last_name" gorm:"type:varchar(100);not null"`
	PhoneNumber               string                 `json:"phone_number" gorm:"type:varchar(20);not null"`
	EmailAddress              *string                `json:"email_address" gorm:"type:varchar(255)"`
	DateOfBirth               *time.Time             `json:"date_of_birth"`
	Nationality               *string                `json:"nationality" gorm:"type:varchar(100)"`
	ResidentialAddress        *string                `json:"residential_address" gorm:"type:text"`
	ResidentialCountry        *string                `json:"residential_country" gorm:"type:varchar(100)"`
	ResidentialCity           *string                `json:"residential_city" gorm:"type:varchar(100)"`
	ResidentialPostalCode     *string                `json:"residential_postal_code" gorm:"type:varchar(20)"`
	Occupation                *string                `json:"occupation" gorm:"type:varchar(100)"`
	MonthlyIncome             *float64               `json:"monthly_income" gorm:"type:decimal(15,2)"`
	BusinessType              *string                `json:"business_type" gorm:"type:varchar(100)"`
	BusinessName              *string                `json:"business_name" gorm:"type:varchar(200)"`
	BusinessRegistrationNumber *string               `json:"business_registration_number" gorm:"type:varchar(100)"`
	RiskLevel                 string                 `json:"risk_level" gorm:"type:varchar(20);default:'medium'"`
	RiskScore                 float64                `json:"risk_score" gorm:"type:decimal(5,2);default:50.00"`
	RiskAssessmentCompleted   bool                   `json:"risk_assessment_completed" gorm:"default:false"`
	KYCCompleted              bool                   `json:"kyc_completed" gorm:"default:false"`
	DocumentsVerified         bool                   `json:"documents_verified" gorm:"default:false"`
	BiometricsVerified        bool                   `json:"biometrics_verified" gorm:"default:false"`
	DeviceType                string                 `json:"device_type" gorm:"type:varchar(30);default:'mobile_app'"`
	DeviceID                  *string                `json:"device_id" gorm:"type:varchar(255)"`
	DeviceFingerprint         *string                `json:"device_fingerprint" gorm:"type:text"`
	IPAddress                 *string                `json:"ip_address" gorm:"type:varchar(45)"`
	GeolocationLatitude       *float64               `json:"geolocation_latitude" gorm:"type:decimal(10,8)"`
	GeolocationLongitude      *float64               `json:"geolocation_longitude" gorm:"type:decimal(11,8)"`
	ApplicationStartedAt      *time.Time             `json:"application_started_at"`
	OnboardingCompletedAt     *time.Time             `json:"onboarding_completed_at"`
	CreatedBy                 *string                `json:"created_by" gorm:"type:uuid"`
	CreatedAt                 time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt                 time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                  map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type CustomerDocument struct {
	ID                    string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerOnboardingID  string                 `json:"customer_onboarding_id" gorm:"type:uuid;not null"`
	DocumentType          string                 `json:"document_type" gorm:"type:varchar(50);not null"`
	DocumentName          string                 `json:"document_name" gorm:"type:varchar(255);not null"`
	FilePath              string                 `json:"file_path" gorm:"type:text;not null"`
	FileName              string                 `json:"file_name" gorm:"type:varchar(255);not null"`
	FileSizeBytes         int64                  `json:"file_size_bytes" gorm:"not null"`
	FileHash              string                 `json:"file_hash" gorm:"type:varchar(64);not null"`
	VerificationStatus    string                 `json:"verification_status" gorm:"type:varchar(30);default:'not_started'"`
	AIProcessingStatus    string                 `json:"ai_processing_status" gorm:"type:varchar(30);default:'queued'"`
	OCRProcessed          bool                   `json:"ocr_processed" gorm:"default:false"`
	OCRConfidence         *float64               `json:"ocr_confidence" gorm:"type:decimal(5,4)"`
	OCRText               *string                `json:"ocr_text" gorm:"type:text"`
	OCRStructuredData     map[string]interface{} `json:"ocr_structured_data" gorm:"type:jsonb"`
	OCRProcessingTimeMs   *int                   `json:"ocr_processing_time_ms"`
	OCRModelVersion       *string                `json:"ocr_model_version" gorm:"type:varchar(50)"`
	UploadedBy            *string                `json:"uploaded_by" gorm:"type:uuid"`
	UploadedAt            time.Time              `json:"uploaded_at" gorm:"autoCreateTime"`
	UpdatedAt             time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata              map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type CustomerBiometric struct {
	ID                        string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerOnboardingID      string                 `json:"customer_onboarding_id" gorm:"type:uuid;not null"`
	BiometricType             string                 `json:"biometric_type" gorm:"type:varchar(30);not null"`
	BiometricTemplate         []byte                 `json:"-" gorm:"type:bytea"`
	BiometricHash             string                 `json:"biometric_hash" gorm:"type:varchar(64);not null"`
	VerificationStatus        string                 `json:"verification_status" gorm:"type:varchar(30);default:'not_started'"`
	VerificationConfidence    *float64               `json:"verification_confidence" gorm:"type:decimal(5,4)"`
	AIProcessingStatus        string                 `json:"ai_processing_status" gorm:"type:varchar(30);default:'queued'"`
	AILivenessScore           *float64               `json:"ai_liveness_score" gorm:"type:decimal(5,4)"`
	AISpoofDetectionScore     *float64               `json:"ai_spoof_detection_score" gorm:"type:decimal(5,4)"`
	FaceQualityMetrics        map[string]interface{} `json:"face_quality_metrics" gorm:"type:jsonb"`
	CapturedBy                *string                `json:"captured_by" gorm:"type:uuid"`
	CapturedAt                time.Time              `json:"captured_at" gorm:"autoCreateTime"`
	VerifiedAt                *time.Time             `json:"verified_at"`
	UpdatedAt                 time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                  map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type CustomerKYCVerification struct {
	ID                      string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerOnboardingID    string                 `json:"customer_onboarding_id" gorm:"type:uuid;not null"`
	KYCReferenceNumber      string                 `json:"kyc_reference_number" gorm:"type:varchar(50);unique;not null"`
	Status                  string                 `json:"status" gorm:"type:varchar(30);not null;default:'not_started'"`
	OverallKYCScore         *float64               `json:"overall_kyc_score" gorm:"type:decimal(5,2)"`
	IdentityVerificationScore *float64             `json:"identity_verification_score" gorm:"type:decimal(5,2)"`
	AddressVerificationScore *float64              `json:"address_verification_score" gorm:"type:decimal(5,2)"`
	DocumentVerificationScore *float64             `json:"document_verification_score" gorm:"type:decimal(5,2)"`
	BiometricVerificationScore *float64            `json:"biometric_verification_score" gorm:"type:decimal(5,2)"`
	ThirdPartyKYCProvider   *string                `json:"third_party_kyc_provider" gorm:"type:varchar(100)"`
	ThirdPartyKYCReference  *string                `json:"third_party_kyc_reference" gorm:"type:varchar(100)"`
	ThirdPartyKYCScore      *float64               `json:"third_party_kyc_score" gorm:"type:decimal(5,2)"`
	KYCStartedAt            *time.Time             `json:"kyc_started_at"`
	KYCCompletedAt          *time.Time             `json:"kyc_completed_at"`
	CreatedBy               *string                `json:"created_by" gorm:"type:uuid"`
	CreatedAt               time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type CustomerRiskAssessment struct {
	ID                    string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerOnboardingID  string                 `json:"customer_onboarding_id" gorm:"type:uuid;not null"`
	AssessmentReference   string                 `json:"assessment_reference" gorm:"type:varchar(50);unique;not null"`
	OverallRiskLevel      *string                `json:"overall_risk_level" gorm:"type:varchar(20)"`
	OverallRiskScore      *float64               `json:"overall_risk_score" gorm:"type:decimal(5,2)"`
	AMLRiskScore          *float64               `json:"aml_risk_score" gorm:"type:decimal(5,2)"`
	FraudRiskScore        *float64               `json:"fraud_risk_score" gorm:"type:decimal(5,2)"`
	CreditRiskScore       *float64               `json:"credit_risk_score" gorm:"type:decimal(5,2)"`
	AIRiskFactors         []string               `json:"ai_risk_factors" gorm:"type:text[]"`
	AIRiskExplanation     *string                `json:"ai_risk_explanation" gorm:"type:text"`
	ManualRiskFactors     []string               `json:"manual_risk_factors" gorm:"type:text[]"`
	ManualRiskNotes       *string                `json:"manual_risk_notes" gorm:"type:text"`
	AssessmentCompletedAt *time.Time             `json:"assessment_completed_at"`
	CreatedBy             *string                `json:"created_by" gorm:"type:uuid"`
	CreatedAt             time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt             time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata              map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

// =====================================================
// REQUEST/RESPONSE MODELS
// =====================================================

type CreateOnboardingRequest struct {
	AgentID         string                 `json:"agent_id" binding:"required"`
	AgentTier       string                 `json:"agent_tier" binding:"required"`
	CustomerType    string                 `json:"customer_type"`
	CustomerTier    string                 `json:"customer_tier"`
	FirstName       string                 `json:"first_name" binding:"required"`
	LastName        string                 `json:"last_name" binding:"required"`
	PhoneNumber     string                 `json:"phone_number" binding:"required"`
	EmailAddress    *string                `json:"email_address"`
	DeviceType      string                 `json:"device_type"`
	DeviceID        *string                `json:"device_id"`
	IPAddress       *string                `json:"ip_address"`
	Latitude        *float64               `json:"latitude"`
	Longitude       *float64               `json:"longitude"`
	CreatedBy       *string                `json:"created_by"`
	Metadata        map[string]interface{} `json:"metadata"`
}

type UpdateOnboardingRequest struct {
	DateOfBirth               *time.Time `json:"date_of_birth"`
	Nationality               *string    `json:"nationality"`
	ResidentialAddress        *string    `json:"residential_address"`
	ResidentialCountry        *string    `json:"residential_country"`
	ResidentialCity           *string    `json:"residential_city"`
	ResidentialPostalCode     *string    `json:"residential_postal_code"`
	Occupation                *string    `json:"occupation"`
	MonthlyIncome             *float64   `json:"monthly_income"`
	BusinessType              *string    `json:"business_type"`
	BusinessName              *string    `json:"business_name"`
	BusinessRegistrationNumber *string   `json:"business_registration_number"`
}

type OnboardingStepRequest struct {
	Step string `json:"step" binding:"required"`
}

type OnboardingResponse struct {
	ID                      string    `json:"id"`
	CustomerReferenceNumber string    `json:"customer_reference_number"`
	Status                  string    `json:"status"`
	CurrentStep             string    `json:"current_step"`
	ProgressPercentage      float64   `json:"progress_percentage"`
	Message                 string    `json:"message"`
	CreatedAt               time.Time `json:"created_at"`
}

type OnboardingStatusResponse struct {
	CustomerOnboarding      CustomerOnboarding       `json:"customer_onboarding"`
	KYCVerification         *CustomerKYCVerification `json:"kyc_verification"`
	RiskAssessment          *CustomerRiskAssessment  `json:"risk_assessment"`
	TotalDocuments          int64                    `json:"total_documents"`
	VerifiedDocuments       int64                    `json:"verified_documents"`
	TotalBiometrics         int64                    `json:"total_biometrics"`
	VerifiedBiometrics      int64                    `json:"verified_biometrics"`
	NextSteps               []string                 `json:"next_steps"`
	RequiredActions         []string                 `json:"required_actions"`
}

type ListOnboardingsResponse struct {
	Data        []CustomerOnboarding `json:"data"`
	Total       int64                `json:"total"`
	Page        int                  `json:"page"`
	Limit       int                  `json:"limit"`
	TotalPages  int                  `json:"total_pages"`
}

// =====================================================
// DATABASE SERVICE
// =====================================================

type DatabaseService struct {
	db *gorm.DB
}

func NewDatabaseService(config *Config) (*DatabaseService, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=UTC",
		config.DBHost, config.DBPort, config.DBUser, config.DBPassword, config.DBName)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Auto-migrate tables
	err = db.AutoMigrate(
		&CustomerOnboarding{},
		&CustomerDocument{},
		&CustomerBiometric{},
		&CustomerKYCVerification{},
		&CustomerRiskAssessment{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return &DatabaseService{db: db}, nil
}

func (ds *DatabaseService) CreateOnboarding(onboarding *CustomerOnboarding) error {
	return ds.db.Create(onboarding).Error
}

func (ds *DatabaseService) GetOnboardingByID(id string) (*CustomerOnboarding, error) {
	var onboarding CustomerOnboarding
	err := ds.db.Where("id = ?", id).First(&onboarding).Error
	if err != nil {
		return nil, err
	}
	return &onboarding, nil
}

func (ds *DatabaseService) UpdateOnboarding(onboarding *CustomerOnboarding) error {
	return ds.db.Save(onboarding).Error
}

func (ds *DatabaseService) GetOnboardingStatus(id string) (*OnboardingStatusResponse, error) {
	var onboarding CustomerOnboarding
	err := ds.db.Where("id = ?", id).First(&onboarding).Error
	if err != nil {
		return nil, err
	}

	var kyc CustomerKYCVerification
	ds.db.Where("customer_onboarding_id = ?", id).First(&kyc)

	var risk CustomerRiskAssessment
	ds.db.Where("customer_onboarding_id = ?", id).First(&risk)

	var totalDocs, verifiedDocs int64
	ds.db.Model(&CustomerDocument{}).Where("customer_onboarding_id = ?", id).Count(&totalDocs)
	ds.db.Model(&CustomerDocument{}).Where("customer_onboarding_id = ? AND verification_status = ?", id, "verified").Count(&verifiedDocs)

	var totalBio, verifiedBio int64
	ds.db.Model(&CustomerBiometric{}).Where("customer_onboarding_id = ?", id).Count(&totalBio)
	ds.db.Model(&CustomerBiometric{}).Where("customer_onboarding_id = ? AND verification_status = ?", id, "verified").Count(&verifiedBio)

	nextSteps := ds.calculateNextSteps(&onboarding, totalDocs, verifiedDocs, totalBio, verifiedBio)
	requiredActions := ds.calculateRequiredActions(&onboarding, totalDocs, verifiedDocs, totalBio, verifiedBio)

	response := &OnboardingStatusResponse{
		CustomerOnboarding: onboarding,
		TotalDocuments:     totalDocs,
		VerifiedDocuments:  verifiedDocs,
		TotalBiometrics:    totalBio,
		VerifiedBiometrics: verifiedBio,
		NextSteps:          nextSteps,
		RequiredActions:    requiredActions,
	}

	if kyc.ID != "" {
		response.KYCVerification = &kyc
	}

	if risk.ID != "" {
		response.RiskAssessment = &risk
	}

	return response, nil
}

func (ds *DatabaseService) calculateNextSteps(onboarding *CustomerOnboarding, totalDocs, verifiedDocs, totalBio, verifiedBio int64) []string {
	var steps []string

	switch onboarding.CurrentStep {
	case "personal_information":
		if onboarding.DateOfBirth == nil || onboarding.ResidentialAddress == nil {
			steps = append(steps, "Complete personal information")
		} else {
			steps = append(steps, "Upload identity documents")
		}
	case "document_upload":
		if totalDocs == 0 {
			steps = append(steps, "Upload required documents (ID, proof of address)")
		} else if verifiedDocs < totalDocs {
			steps = append(steps, "Wait for document verification")
		} else {
			steps = append(steps, "Capture biometric data")
		}
	case "biometric_capture":
		if totalBio == 0 {
			steps = append(steps, "Capture facial biometric")
		} else if verifiedBio < totalBio {
			steps = append(steps, "Wait for biometric verification")
		} else {
			steps = append(steps, "Complete risk assessment")
		}
	case "risk_assessment":
		if !onboarding.RiskAssessmentCompleted {
			steps = append(steps, "Complete automated risk assessment")
		} else {
			steps = append(steps, "Final review and approval")
		}
	case "final_review":
		steps = append(steps, "Wait for manual review and approval")
	case "completed":
		steps = append(steps, "Onboarding completed successfully")
	}

	return steps
}

func (ds *DatabaseService) calculateRequiredActions(onboarding *CustomerOnboarding, totalDocs, verifiedDocs, totalBio, verifiedBio int64) []string {
	var actions []string

	// Check for missing personal information
	if onboarding.DateOfBirth == nil {
		actions = append(actions, "Provide date of birth")
	}
	if onboarding.ResidentialAddress == nil {
		actions = append(actions, "Provide residential address")
	}
	if onboarding.Occupation == nil {
		actions = append(actions, "Provide occupation information")
	}

	// Check for document requirements
	if totalDocs == 0 {
		actions = append(actions, "Upload identity document")
		actions = append(actions, "Upload proof of address")
	} else if verifiedDocs == 0 && totalDocs > 0 {
		actions = append(actions, "Wait for document verification")
	}

	// Check for biometric requirements
	if totalBio == 0 {
		actions = append(actions, "Capture facial biometric")
	} else if verifiedBio == 0 && totalBio > 0 {
		actions = append(actions, "Wait for biometric verification")
	}

	// Check for risk assessment
	if !onboarding.RiskAssessmentCompleted {
		actions = append(actions, "Complete risk assessment")
	}

	return actions
}

func (ds *DatabaseService) ListOnboardings(filters map[string]interface{}, page, limit int) (*ListOnboardingsResponse, error) {
	var onboardings []CustomerOnboarding
	var total int64

	query := ds.db.Model(&CustomerOnboarding{})

	// Apply filters
	if status, ok := filters["status"]; ok {
		query = query.Where("status = ?", status)
	}
	if agentID, ok := filters["agent_id"]; ok {
		query = query.Where("agent_id = ?", agentID)
	}
	if customerType, ok := filters["customer_type"]; ok {
		query = query.Where("customer_type = ?", customerType)
	}
	if riskLevel, ok := filters["risk_level"]; ok {
		query = query.Where("risk_level = ?", riskLevel)
	}

	// Count total records
	query.Count(&total)

	// Apply pagination
	offset := (page - 1) * limit
	err := query.Offset(offset).Limit(limit).Order("created_at DESC").Find(&onboardings).Error
	if err != nil {
		return nil, err
	}

	totalPages := int((total + int64(limit) - 1) / int64(limit))

	return &ListOnboardingsResponse{
		Data:       onboardings,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}, nil
}

func (ds *DatabaseService) UpdateOnboardingStep(id, step string) error {
	progress := ds.calculateProgress(step)
	
	return ds.db.Model(&CustomerOnboarding{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"current_step":        step,
			"progress_percentage": progress,
			"updated_at":         time.Now(),
		}).Error
}

func (ds *DatabaseService) calculateProgress(step string) float64 {
	progressMap := map[string]float64{
		"personal_information": 20.0,
		"document_upload":      40.0,
		"biometric_capture":    60.0,
		"risk_assessment":      80.0,
		"final_review":         90.0,
		"completed":           100.0,
	}
	
	if progress, ok := progressMap[step]; ok {
		return progress
	}
	return 0.0
}

// =====================================================
// REDIS SERVICE
// =====================================================

type RedisService struct {
	client *redis.Client
}

func NewRedisService(config *Config) *RedisService {
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", config.RedisHost, config.RedisPort),
		DB:       config.RedisDB,
		Password: "",
	})

	return &RedisService{client: rdb}
}

func (rs *RedisService) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return rs.client.Set(ctx, key, value, expiration).Err()
}

func (rs *RedisService) Get(ctx context.Context, key string) (string, error) {
	return rs.client.Get(ctx, key).Result()
}

func (rs *RedisService) Delete(ctx context.Context, key string) error {
	return rs.client.Del(ctx, key).Err()
}

// =====================================================
// ONBOARDING SERVICE
// =====================================================

type OnboardingService struct {
	db    *DatabaseService
	redis *RedisService
	config *Config
}

func NewOnboardingService(db *DatabaseService, redis *RedisService, config *Config) *OnboardingService {
	return &OnboardingService{
		db:    db,
		redis: redis,
		config: config,
	}
}

func (os *OnboardingService) CreateOnboarding(req *CreateOnboardingRequest) (*OnboardingResponse, error) {
	// Generate reference number
	referenceNumber := fmt.Sprintf("CUST-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	// Create onboarding record
	onboarding := &CustomerOnboarding{
		ID:                      uuid.New().String(),
		CustomerReferenceNumber: referenceNumber,
		AgentID:                 req.AgentID,
		AgentTier:               req.AgentTier,
		CustomerType:            getStringOrDefault(req.CustomerType, "individual"),
		CustomerTier:            getStringOrDefault(req.CustomerTier, "basic"),
		Status:                  "application_started",
		CurrentStep:             "personal_information",
		ProgressPercentage:      20.0,
		FirstName:               req.FirstName,
		LastName:                req.LastName,
		PhoneNumber:             req.PhoneNumber,
		EmailAddress:            req.EmailAddress,
		DeviceType:              getStringOrDefault(req.DeviceType, "mobile_app"),
		DeviceID:                req.DeviceID,
		IPAddress:               req.IPAddress,
		GeolocationLatitude:     req.Latitude,
		GeolocationLongitude:    req.Longitude,
		ApplicationStartedAt:    timePtr(time.Now()),
		CreatedBy:               req.CreatedBy,
		Metadata:                req.Metadata,
	}

	err := os.db.CreateOnboarding(onboarding)
	if err != nil {
		return nil, fmt.Errorf("failed to create onboarding: %w", err)
	}

	// Create KYC verification record
	kycID := uuid.New().String()
	kycReference := fmt.Sprintf("KYC-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	kyc := &CustomerKYCVerification{
		ID:                   kycID,
		CustomerOnboardingID: onboarding.ID,
		KYCReferenceNumber:   kycReference,
		Status:               "not_started",
		CreatedBy:            req.CreatedBy,
	}

	err = os.db.db.Create(kyc).Error
	if err != nil {
		return nil, fmt.Errorf("failed to create KYC record: %w", err)
	}

	// Create risk assessment record
	riskID := uuid.New().String()
	riskReference := fmt.Sprintf("RISK-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	risk := &CustomerRiskAssessment{
		ID:                   riskID,
		CustomerOnboardingID: onboarding.ID,
		AssessmentReference:  riskReference,
		CreatedBy:            req.CreatedBy,
	}

	err = os.db.db.Create(risk).Error
	if err != nil {
		return nil, fmt.Errorf("failed to create risk assessment record: %w", err)
	}

	return &OnboardingResponse{
		ID:                      onboarding.ID,
		CustomerReferenceNumber: onboarding.CustomerReferenceNumber,
		Status:                  onboarding.Status,
		CurrentStep:             onboarding.CurrentStep,
		ProgressPercentage:      onboarding.ProgressPercentage,
		Message:                 "Customer onboarding created successfully",
		CreatedAt:               onboarding.CreatedAt,
	}, nil
}

func (os *OnboardingService) UpdateOnboarding(id string, req *UpdateOnboardingRequest) (*OnboardingResponse, error) {
	onboarding, err := os.db.GetOnboardingByID(id)
	if err != nil {
		return nil, fmt.Errorf("onboarding not found: %w", err)
	}

	// Update fields
	if req.DateOfBirth != nil {
		onboarding.DateOfBirth = req.DateOfBirth
	}
	if req.Nationality != nil {
		onboarding.Nationality = req.Nationality
	}
	if req.ResidentialAddress != nil {
		onboarding.ResidentialAddress = req.ResidentialAddress
	}
	if req.ResidentialCountry != nil {
		onboarding.ResidentialCountry = req.ResidentialCountry
	}
	if req.ResidentialCity != nil {
		onboarding.ResidentialCity = req.ResidentialCity
	}
	if req.ResidentialPostalCode != nil {
		onboarding.ResidentialPostalCode = req.ResidentialPostalCode
	}
	if req.Occupation != nil {
		onboarding.Occupation = req.Occupation
	}
	if req.MonthlyIncome != nil {
		onboarding.MonthlyIncome = req.MonthlyIncome
	}
	if req.BusinessType != nil {
		onboarding.BusinessType = req.BusinessType
	}
	if req.BusinessName != nil {
		onboarding.BusinessName = req.BusinessName
	}
	if req.BusinessRegistrationNumber != nil {
		onboarding.BusinessRegistrationNumber = req.BusinessRegistrationNumber
	}

	err = os.db.UpdateOnboarding(onboarding)
	if err != nil {
		return nil, fmt.Errorf("failed to update onboarding: %w", err)
	}

	return &OnboardingResponse{
		ID:                      onboarding.ID,
		CustomerReferenceNumber: onboarding.CustomerReferenceNumber,
		Status:                  onboarding.Status,
		CurrentStep:             onboarding.CurrentStep,
		ProgressPercentage:      onboarding.ProgressPercentage,
		Message:                 "Customer onboarding updated successfully",
		CreatedAt:               onboarding.CreatedAt,
	}, nil
}

func (os *OnboardingService) UpdateOnboardingStep(id string, req *OnboardingStepRequest) (*OnboardingResponse, error) {
	onboarding, err := os.db.GetOnboardingByID(id)
	if err != nil {
		return nil, fmt.Errorf("onboarding not found: %w", err)
	}

	// Validate step transition
	if !os.isValidStepTransition(onboarding.CurrentStep, req.Step) {
		return nil, fmt.Errorf("invalid step transition from %s to %s", onboarding.CurrentStep, req.Step)
	}

	err = os.db.UpdateOnboardingStep(id, req.Step)
	if err != nil {
		return nil, fmt.Errorf("failed to update onboarding step: %w", err)
	}

	// Get updated onboarding
	onboarding, err = os.db.GetOnboardingByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get updated onboarding: %w", err)
	}

	// Update status if completed
	if req.Step == "completed" {
		onboarding.Status = "completed"
		onboarding.OnboardingCompletedAt = timePtr(time.Now())
		err = os.db.UpdateOnboarding(onboarding)
		if err != nil {
			return nil, fmt.Errorf("failed to update completion status: %w", err)
		}
	}

	return &OnboardingResponse{
		ID:                      onboarding.ID,
		CustomerReferenceNumber: onboarding.CustomerReferenceNumber,
		Status:                  onboarding.Status,
		CurrentStep:             onboarding.CurrentStep,
		ProgressPercentage:      onboarding.ProgressPercentage,
		Message:                 fmt.Sprintf("Onboarding step updated to %s", req.Step),
		CreatedAt:               onboarding.CreatedAt,
	}, nil
}

func (os *OnboardingService) isValidStepTransition(currentStep, newStep string) bool {
	validTransitions := map[string][]string{
		"personal_information": {"document_upload"},
		"document_upload":      {"biometric_capture"},
		"biometric_capture":    {"risk_assessment"},
		"risk_assessment":      {"final_review"},
		"final_review":         {"completed"},
	}

	validNext, ok := validTransitions[currentStep]
	if !ok {
		return false
	}

	for _, valid := range validNext {
		if valid == newStep {
			return true
		}
	}

	return false
}

func (os *OnboardingService) GetOnboardingStatus(id string) (*OnboardingStatusResponse, error) {
	return os.db.GetOnboardingStatus(id)
}

func (os *OnboardingService) ListOnboardings(filters map[string]interface{}, page, limit int) (*ListOnboardingsResponse, error) {
	return os.db.ListOnboardings(filters, page, limit)
}

// =====================================================
// HTTP HANDLERS
// =====================================================

type OnboardingHandler struct {
	service *OnboardingService
}

func NewOnboardingHandler(service *OnboardingService) *OnboardingHandler {
	return &OnboardingHandler{service: service}
}

func (oh *OnboardingHandler) CreateOnboarding(c *gin.Context) {
	var req CreateOnboardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := oh.service.CreateOnboarding(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, response)
}

func (oh *OnboardingHandler) UpdateOnboarding(c *gin.Context) {
	id := c.Param("id")
	
	var req UpdateOnboardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := oh.service.UpdateOnboarding(id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (oh *OnboardingHandler) UpdateOnboardingStep(c *gin.Context) {
	id := c.Param("id")
	
	var req OnboardingStepRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := oh.service.UpdateOnboardingStep(id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (oh *OnboardingHandler) GetOnboardingStatus(c *gin.Context) {
	id := c.Param("id")

	response, err := oh.service.GetOnboardingStatus(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (oh *OnboardingHandler) ListOnboardings(c *gin.Context) {
	// Parse query parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	filters := make(map[string]interface{})
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}
	if agentID := c.Query("agent_id"); agentID != "" {
		filters["agent_id"] = agentID
	}
	if customerType := c.Query("customer_type"); customerType != "" {
		filters["customer_type"] = customerType
	}
	if riskLevel := c.Query("risk_level"); riskLevel != "" {
		filters["risk_level"] = riskLevel
	}

	response, err := oh.service.ListOnboardings(filters, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

// =====================================================
// HEALTH CHECK
// =====================================================

func healthCheck(db *DatabaseService, redis *RedisService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check database connection
		sqlDB, err := db.db.DB()
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status": "unhealthy",
				"error":  "database connection failed",
			})
			return
		}

		if err := sqlDB.Ping(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status": "unhealthy",
				"error":  "database ping failed",
			})
			return
		}

		// Check Redis connection
		ctx := context.Background()
		if err := redis.client.Ping(ctx).Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status": "unhealthy",
				"error":  "redis connection failed",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "customer-onboarding-coordinator",
			"timestamp": time.Now().Format(time.RFC3339),
			"version":   "1.0.0",
		})
	}
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

func getStringOrDefault(value, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

func timePtr(t time.Time) *time.Time {
	return &t
}

// =====================================================
// MAIN FUNCTION
// =====================================================

func main() {
	// Load configuration
	config := loadConfig()

	// Initialize database
	db, err := NewDatabaseService(config)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Redis
	redis := NewRedisService(config)

	// Initialize services
	onboardingService := NewOnboardingService(db, redis, config)
	onboardingHandler := NewOnboardingHandler(onboardingService)

	// Initialize Gin router
	router := gin.Default()

	// Configure CORS
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"}
	router.Use(cors.New(corsConfig))

	// Health check endpoint
	router.GET("/health", healthCheck(db, redis))

	// API routes
	v1 := router.Group("/api/v1")
	{
		onboarding := v1.Group("/onboarding")
		{
			onboarding.POST("", onboardingHandler.CreateOnboarding)
			onboarding.GET("", onboardingHandler.ListOnboardings)
			onboarding.GET("/:id", onboardingHandler.GetOnboardingStatus)
			onboarding.PUT("/:id", onboardingHandler.UpdateOnboarding)
			onboarding.PATCH("/:id/step", onboardingHandler.UpdateOnboardingStep)
		}
	}

	// Start server
	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("Customer Onboarding Coordinator Service started on port %s", config.Port)

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

