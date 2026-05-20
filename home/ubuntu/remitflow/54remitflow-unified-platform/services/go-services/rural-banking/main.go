import os
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
	"strings"
	"syscall"
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
	DatabaseURL    string
	ServerPort     string
	Environment    string
	LogLevel       string
	MaxConnections int
}

func loadConfig() *Config {
	return &Config{
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://user:password@${DB_HOST:-os.getenv("HOST", "os.getenv("HOST", "localhost")")}:${DB_PORT:-5432}/remittance_network?sslmode=disable"),
		ServerPort:     getEnv("SERVER_PORT", "8080"),
		Environment:    getEnv("ENVIRONMENT", "development"),
		LogLevel:       getEnv("LOG_LEVEL", "info"),
		MaxConnections: getEnvAsInt("MAX_DB_CONNECTIONS", 100),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
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

type RuralBankingLocation struct {
	ID                           uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	LocationID                   string    `gorm:"uniqueIndex;not null" json:"location_id"`
	LocationName                 string    `gorm:"not null" json:"location_name"`
	BranchType                   string    `gorm:"not null" json:"branch_type"`
	Latitude                     float64   `gorm:"not null" json:"latitude"`
	Longitude                    float64   `gorm:"not null" json:"longitude"`
	Address                      string    `gorm:"not null" json:"address"`
	VillageName                  *string   `json:"village_name"`
	District                     *string   `json:"district"`
	Region                       *string   `json:"region"`
	Country                      string    `gorm:"not null" json:"country"`
	PostalCode                   *string   `json:"postal_code"`
	RoadAccessType               *string   `json:"road_access_type"`
	DistanceToMainRoadKm         *float64  `json:"distance_to_main_road_km"`
	NearestTown                  *string   `json:"nearest_town"`
	DistanceToNearestTownKm      *float64  `json:"distance_to_nearest_town_km"`
	HasElectricity               bool      `gorm:"default:false" json:"has_electricity"`
	ElectricityReliabilityHours  int       `gorm:"default:0" json:"electricity_reliability_hours"`
	HasInternetConnectivity      bool      `gorm:"default:false" json:"has_internet_connectivity"`
	InternetType                 *string   `json:"internet_type"`
	InternetReliabilityPercent   float64   `gorm:"default:0.00" json:"internet_reliability_percent"`
	HasMobileCoverage            bool      `gorm:"default:false" json:"has_mobile_coverage"`
	MobileNetworkProviders       []string  `gorm:"type:text[]" json:"mobile_network_providers"`
	HasATM                       bool      `gorm:"default:false" json:"has_atm"`
	HasPOSTerminal               bool      `gorm:"default:false" json:"has_pos_terminal"`
	HasCashVault                 bool      `gorm:"default:false" json:"has_cash_vault"`
	VaultCapacityUSD             float64   `gorm:"default:0.00" json:"vault_capacity_usd"`
	OperatingHours               string    `gorm:"type:jsonb" json:"operating_hours"`
	ServiceAvailability          string    `gorm:"default:'business_hours'" json:"service_availability"`
	LanguagesSupported           []string  `gorm:"type:text[];default:'{English}'" json:"languages_supported"`
	EstimatedPopulationServed    *int      `json:"estimated_population_served"`
	HouseholdsServed             *int      `json:"households_served"`
	BusinessesServed             *int      `json:"businesses_served"`
	FarmersServed                *int      `json:"farmers_served"`
	BranchManagerID              *uuid.UUID `json:"branch_manager_id"`
	AssignedAgents               []uuid.UUID `gorm:"type:uuid[]" json:"assigned_agents"`
	SecurityPersonnelCount       int       `gorm:"default:0" json:"security_personnel_count"`
	Status                       string    `gorm:"default:'active'" json:"status"`
	MonthlyTransactionVolume     float64   `gorm:"default:0.00" json:"monthly_transaction_volume"`
	MonthlyCustomerVisits        int       `gorm:"default:0" json:"monthly_customer_visits"`
	CustomerSatisfactionScore    float64   `gorm:"default:0.00" json:"customer_satisfaction_score"`
	CreatedBy                    uuid.UUID `gorm:"not null" json:"created_by"`
	UpdatedBy                    *uuid.UUID `json:"updated_by"`
	CreatedAt                    time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                    time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                     string    `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type OfflineTransaction struct {
	ID                      uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	OfflineTransactionID    string     `gorm:"uniqueIndex;not null" json:"offline_transaction_id"`
	DeviceID                string     `gorm:"not null" json:"device_id"`
	AgentID                 uuid.UUID  `gorm:"not null" json:"agent_id"`
	LocationID              *uuid.UUID `json:"location_id"`
	TransactionType         string     `gorm:"not null" json:"transaction_type"`
	Amount                  float64    `gorm:"not null" json:"amount"`
	Currency                string     `gorm:"default:'USD'" json:"currency"`
	CustomerID              *uuid.UUID `json:"customer_id"`
	CustomerIdentifier      *string    `json:"customer_identifier"`
	OfflineTimestamp        time.Time  `gorm:"not null" json:"offline_timestamp"`
	SyncTimestamp           *time.Time `json:"sync_timestamp"`
	OfflineDurationMinutes  *int       `json:"offline_duration_minutes"`
	TransactionData         string     `gorm:"type:jsonb;not null" json:"transaction_data"`
	BiometricData           *string    `gorm:"type:jsonb" json:"biometric_data"`
	SupportingDocuments     *string    `gorm:"type:jsonb" json:"supporting_documents"`
	AgentSignature          *string    `json:"agent_signature"`
	CustomerSignature       *string    `json:"customer_signature"`
	WitnessSignature        *string    `json:"witness_signature"`
	DeviceFingerprint       *string    `json:"device_fingerprint"`
	TransactionHash         *string    `json:"transaction_hash"`
	Status                  string     `gorm:"default:'pending_sync'" json:"status"`
	SyncAttempts            int        `gorm:"default:0" json:"sync_attempts"`
	LastSyncAttempt         *time.Time `json:"last_sync_attempt"`
	SyncErrorMessage        *string    `json:"sync_error_message"`
	ConflictType            *string    `json:"conflict_type"`
	ConflictDescription     *string    `json:"conflict_description"`
	ResolutionMethod        *string    `json:"resolution_method"`
	ResolvedBy              *uuid.UUID `json:"resolved_by"`
	ResolvedAt              *time.Time `json:"resolved_at"`
	RiskScore               float64    `gorm:"default:0.00" json:"risk_score"`
	RiskFactors             string     `gorm:"type:jsonb;default:'[]'" json:"risk_factors"`
	RequiresManualReview    bool       `gorm:"default:false" json:"requires_manual_review"`
	CreatedAt               time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt               time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                string     `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type MobileMoneyAccount struct {
	ID                        uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	AccountID                 string     `gorm:"uniqueIndex;not null" json:"account_id"`
	CustomerID                *uuid.UUID `json:"customer_id"`
	Provider                  string     `gorm:"not null" json:"provider"`
	ProviderAccountID         string     `gorm:"not null" json:"provider_account_id"`
	PhoneNumber               string     `gorm:"not null" json:"phone_number"`
	AccountType               string     `gorm:"default:'personal'" json:"account_type"`
	AccountName               string     `gorm:"not null" json:"account_name"`
	AccountStatus             string     `gorm:"default:'active'" json:"account_status"`
	KYCLevel                  int        `gorm:"default:1" json:"kyc_level"`
	CurrentBalance            float64    `gorm:"default:0.00" json:"current_balance"`
	AvailableBalance          float64    `gorm:"default:0.00" json:"available_balance"`
	DailyTransactionLimit     *float64   `json:"daily_transaction_limit"`
	MonthlyTransactionLimit   *float64   `json:"monthly_transaction_limit"`
	SingleTransactionLimit    *float64   `json:"single_transaction_limit"`
	DailyTransactionCount     int        `gorm:"default:0" json:"daily_transaction_count"`
	DailyTransactionAmount    float64    `gorm:"default:0.00" json:"daily_transaction_amount"`
	MonthlyTransactionCount   int        `gorm:"default:0" json:"monthly_transaction_count"`
	MonthlyTransactionAmount  float64    `gorm:"default:0.00" json:"monthly_transaction_amount"`
	AllowedCountries          []string   `gorm:"type:text[]" json:"allowed_countries"`
	RestrictedRegions         []string   `gorm:"type:text[]" json:"restricted_regions"`
	PinHash                   *string    `json:"pin_hash"`
	SecurityQuestions         *string    `gorm:"type:jsonb" json:"security_questions"`
	LastLogin                 *time.Time `json:"last_login"`
	FailedLoginAttempts       int        `gorm:"default:0" json:"failed_login_attempts"`
	AccountLockedUntil        *time.Time `json:"account_locked_until"`
	APIEndpoint               *string    `json:"api_endpoint"`
	APICredentials            *string    `gorm:"type:jsonb" json:"api_credentials"`
	WebhookURL                *string    `json:"webhook_url"`
	CreatedBy                 *uuid.UUID `json:"created_by"`
	UpdatedBy                 *uuid.UUID `json:"updated_by"`
	CreatedAt                 time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                 time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                  string     `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type MobileMoneyTransaction struct {
	ID                     uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	TransactionID          string     `gorm:"uniqueIndex;not null" json:"transaction_id"`
	ExternalTransactionID  *string    `json:"external_transaction_id"`
	FromAccountID          *uuid.UUID `json:"from_account_id"`
	ToAccountID            *uuid.UUID `json:"to_account_id"`
	FromPhoneNumber        *string    `json:"from_phone_number"`
	ToPhoneNumber          *string    `json:"to_phone_number"`
	TransactionType        string     `gorm:"not null" json:"transaction_type"`
	Amount                 float64    `gorm:"not null" json:"amount"`
	Currency               string     `gorm:"default:'USD'" json:"currency"`
	ExchangeRate           *float64   `json:"exchange_rate"`
	TransactionFee         float64    `gorm:"default:0.00" json:"transaction_fee"`
	ProviderFee            float64    `gorm:"default:0.00" json:"provider_fee"`
	AgentCommission        float64    `gorm:"default:0.00" json:"agent_commission"`
	TotalCharges           float64    `gorm:"default:0.00" json:"total_charges"`
	Status                 string     `gorm:"default:'pending'" json:"status"`
	ProviderStatus         *string    `json:"provider_status"`
	ProcessingTimeSeconds  *int       `json:"processing_time_seconds"`
	ReferenceNumber        *string    `json:"reference_number"`
	ProviderReference      *string    `json:"provider_reference"`
	AgentReference         *string    `json:"agent_reference"`
	CustomerReference      *string    `json:"customer_reference"`
	AgentID                *uuid.UUID `json:"agent_id"`
	LocationID             *uuid.UUID `json:"location_id"`
	Description            *string    `json:"description"`
	Purpose                *string    `json:"purpose"`
	BeneficiaryName        *string    `json:"beneficiary_name"`
	SenderName             *string    `json:"sender_name"`
	Reconciled             bool       `gorm:"default:false" json:"reconciled"`
	ReconciliationDate     *time.Time `json:"reconciliation_date"`
	ReconciliationReference *string   `json:"reconciliation_reference"`
	InitiatedAt            time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"initiated_at"`
	CompletedAt            *time.Time `json:"completed_at"`
	FailedAt               *time.Time `json:"failed_at"`
	ErrorCode              *string    `json:"error_code"`
	ErrorMessage           *string    `json:"error_message"`
	RetryCount             int        `gorm:"default:0" json:"retry_count"`
	CreatedAt              time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt              time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata               string     `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type AgriculturalLoan struct {
	ID                          uuid.UUID   `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	LoanID                      string      `gorm:"uniqueIndex;not null" json:"loan_id"`
	CustomerID                  uuid.UUID   `gorm:"not null" json:"customer_id"`
	AgentID                     uuid.UUID   `gorm:"not null" json:"agent_id"`
	LocationID                  *uuid.UUID  `json:"location_id"`
	LoanAmount                  float64     `gorm:"not null" json:"loan_amount"`
	Currency                    string      `gorm:"default:'USD'" json:"currency"`
	InterestRate                float64     `gorm:"not null" json:"interest_rate"`
	LoanTermMonths              int         `gorm:"not null" json:"loan_term_months"`
	RepaymentFrequency          string      `gorm:"not null" json:"repayment_frequency"`
	FarmingPurpose              string      `gorm:"not null" json:"farming_purpose"`
	CropTypes                   []string    `gorm:"type:text[]" json:"crop_types"`
	FarmingMethod               string      `gorm:"default:'traditional'" json:"farming_method"`
	FarmSizeHectares            *float64    `json:"farm_size_hectares"`
	ExpectedYieldTons           *float64    `json:"expected_yield_tons"`
	ExpectedHarvestDate         *time.Time  `json:"expected_harvest_date"`
	FarmLatitude                *float64    `json:"farm_latitude"`
	FarmLongitude               *float64    `json:"farm_longitude"`
	FarmAddress                 *string     `json:"farm_address"`
	CollateralType              *string     `json:"collateral_type"`
	CollateralValue             *float64    `json:"collateral_value"`
	CollateralDescription       *string     `json:"collateral_description"`
	GuarantorID                 *uuid.UUID  `json:"guarantor_id"`
	GuarantorDetails            *string     `gorm:"type:jsonb" json:"guarantor_details"`
	WeatherRiskScore            float64     `gorm:"default:0.00" json:"weather_risk_score"`
	MarketRiskScore             float64     `gorm:"default:0.00" json:"market_risk_score"`
	FarmerExperienceYears       *int        `json:"farmer_experience_years"`
	CreditHistoryScore          float64     `gorm:"default:0.00" json:"credit_history_score"`
	OverallRiskScore            float64     `gorm:"default:0.00" json:"overall_risk_score"`
	CropInsurancePolicy         *string     `json:"crop_insurance_policy"`
	InsuranceProvider           *string     `json:"insurance_provider"`
	InsurancePremium            float64     `gorm:"default:0.00" json:"insurance_premium"`
	InsuranceCoverageAmount     float64     `gorm:"default:0.00" json:"insurance_coverage_amount"`
	Status                      string      `gorm:"default:'pending'" json:"status"`
	ApprovalDate                *time.Time  `json:"approval_date"`
	DisbursementDate            *time.Time  `json:"disbursement_date"`
	FirstPaymentDueDate         *time.Time  `json:"first_payment_due_date"`
	MaturityDate                *time.Time  `json:"maturity_date"`
	TotalAmountDue              *float64    `json:"total_amount_due"`
	PrincipalPaid               float64     `gorm:"default:0.00" json:"principal_paid"`
	InterestPaid                float64     `gorm:"default:0.00" json:"interest_paid"`
	FeesPaid                    float64     `gorm:"default:0.00" json:"fees_paid"`
	OutstandingBalance          *float64    `json:"outstanding_balance"`
	DaysPastDue                 int         `gorm:"default:0" json:"days_past_due"`
	ActualYieldTons             *float64    `json:"actual_yield_tons"`
	ActualHarvestDate           *time.Time  `json:"actual_harvest_date"`
	MarketPricePerTon           *float64    `json:"market_price_per_ton"`
	TotalRevenue                *float64    `json:"total_revenue"`
	ProfitMargin                *float64    `json:"profit_margin"`
	ExtensionOfficerID          *uuid.UUID  `json:"extension_officer_id"`
	LastFarmVisitDate           *time.Time  `json:"last_farm_visit_date"`
	NextScheduledVisit          *time.Time  `json:"next_scheduled_visit"`
	TechnicalAssistanceProvided []string    `gorm:"type:text[]" json:"technical_assistance_provided"`
	CreatedBy                   uuid.UUID   `gorm:"not null" json:"created_by"`
	UpdatedBy                   *uuid.UUID  `json:"updated_by"`
	CreatedAt                   time.Time   `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                   time.Time   `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                    string      `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type MicrofinanceGroup struct {
	ID                          uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	GroupID                     string     `gorm:"uniqueIndex;not null" json:"group_id"`
	GroupName                   string     `gorm:"not null" json:"group_name"`
	GroupType                   string     `gorm:"not null" json:"group_type"`
	FormationDate               time.Time  `gorm:"not null" json:"formation_date"`
	RegistrationNumber          *string    `json:"registration_number"`
	LegalStatus                 *string    `json:"legal_status"`
	LocationID                  *uuid.UUID `json:"location_id"`
	MeetingLocation             *string    `json:"meeting_location"`
	MeetingSchedule             *string    `gorm:"type:jsonb" json:"meeting_schedule"`
	TotalMembers                int        `gorm:"default:0" json:"total_members"`
	ActiveMembers               int        `gorm:"default:0" json:"active_members"`
	MaleMembers                 int        `gorm:"default:0" json:"male_members"`
	FemaleMembers               int        `gorm:"default:0" json:"female_members"`
	YouthMembers                int        `gorm:"default:0" json:"youth_members"`
	TotalSavings                float64    `gorm:"default:0.00" json:"total_savings"`
	TotalLoansOutstanding       float64    `gorm:"default:0.00" json:"total_loans_outstanding"`
	GroupFundBalance            float64    `gorm:"default:0.00" json:"group_fund_balance"`
	EmergencyFundBalance        float64    `gorm:"default:0.00" json:"emergency_fund_balance"`
	MinimumSavingsAmount        *float64   `json:"minimum_savings_amount"`
	MaximumLoanAmount           *float64   `json:"maximum_loan_amount"`
	InterestRateOnLoans         *float64   `json:"interest_rate_on_loans"`
	LoanTermMonths              *int       `json:"loan_term_months"`
	MeetingAttendanceRequirement *float64  `json:"meeting_attendance_requirement"`
	ChairpersonID               *uuid.UUID `json:"chairperson_id"`
	SecretaryID                 *uuid.UUID `json:"secretary_id"`
	TreasurerID                 *uuid.UUID `json:"treasurer_id"`
	LoanRepaymentRate           float64    `gorm:"default:100.00" json:"loan_repayment_rate"`
	SavingsGrowthRate           float64    `gorm:"default:0.00" json:"savings_growth_rate"`
	MemberRetentionRate         float64    `gorm:"default:100.00" json:"member_retention_rate"`
	MeetingAttendanceRate       float64    `gorm:"default:0.00" json:"meeting_attendance_rate"`
	FieldOfficerID              *uuid.UUID `json:"field_officer_id"`
	LastTrainingDate            *time.Time `json:"last_training_date"`
	TrainingTopicsCovered       []string   `gorm:"type:text[]" json:"training_topics_covered"`
	NextTrainingScheduled       *time.Time `json:"next_training_scheduled"`
	Status                      string     `gorm:"default:'active'" json:"status"`
	CreatedBy                   uuid.UUID  `gorm:"not null" json:"created_by"`
	UpdatedBy                   *uuid.UUID `json:"updated_by"`
	CreatedAt                   time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                   time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                    string     `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

type CommunityBankingService struct {
	ID                        uuid.UUID   `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	ServiceID                 string      `gorm:"uniqueIndex;not null" json:"service_id"`
	ServiceName               string      `gorm:"not null" json:"service_name"`
	ServiceCategory           string      `gorm:"not null" json:"service_category"`
	Description               string      `gorm:"not null" json:"description"`
	TargetDemographic         *string     `json:"target_demographic"`
	MinimumAge                int         `gorm:"default:18" json:"minimum_age"`
	MaximumAge                *int        `json:"maximum_age"`
	AvailableLocations        []uuid.UUID `gorm:"type:uuid[]" json:"available_locations"`
	ServiceHours              *string     `gorm:"type:jsonb" json:"service_hours"`
	SeasonalAvailability      bool        `gorm:"default:false" json:"seasonal_availability"`
	AvailableMonths           []int       `gorm:"type:integer[]" json:"available_months"`
	ServiceFee                float64     `gorm:"default:0.00" json:"service_fee"`
	MinimumAmount             *float64    `json:"minimum_amount"`
	MaximumAmount             *float64    `json:"maximum_amount"`
	DailyLimit                *float64    `json:"daily_limit"`
	MonthlyLimit              *float64    `json:"monthly_limit"`
	KYCLevelRequired          int         `gorm:"default:1" json:"kyc_level_required"`
	DocumentsRequired         []string    `gorm:"type:text[]" json:"documents_required"`
	GuarantorRequired         bool        `gorm:"default:false" json:"guarantor_required"`
	CollateralRequired        bool        `gorm:"default:false" json:"collateral_required"`
	MobileAppSupported        bool        `gorm:"default:false" json:"mobile_app_supported"`
	USSDSupported             bool        `gorm:"default:false" json:"ussd_supported"`
	SMSSupported              bool        `gorm:"default:true" json:"sms_supported"`
	OfflineSupported          bool        `gorm:"default:true" json:"offline_supported"`
	TotalUsers                int         `gorm:"default:0" json:"total_users"`
	MonthlyActiveUsers        int         `gorm:"default:0" json:"monthly_active_users"`
	TotalTransactionVolume    float64     `gorm:"default:0.00" json:"total_transaction_volume"`
	AverageTransactionAmount  float64     `gorm:"default:0.00" json:"average_transaction_amount"`
	CustomerSatisfactionScore float64     `gorm:"default:0.00" json:"customer_satisfaction_score"`
	Status                    string      `gorm:"default:'active'" json:"status"`
	LaunchDate                *time.Time  `json:"launch_date"`
	SunsetDate                *time.Time  `json:"sunset_date"`
	CreatedBy                 uuid.UUID   `gorm:"not null" json:"created_by"`
	UpdatedBy                 *uuid.UUID  `json:"updated_by"`
	CreatedAt                 time.Time   `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                 time.Time   `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Metadata                  string      `gorm:"type:jsonb;default:'{}'" json:"metadata"`
}

// =====================================================
// REQUEST/RESPONSE MODELS
// =====================================================

type CreateRuralLocationRequest struct {
	LocationName                string    `json:"location_name" binding:"required"`
	BranchType                  string    `json:"branch_type" binding:"required"`
	Latitude                    float64   `json:"latitude" binding:"required"`
	Longitude                   float64   `json:"longitude" binding:"required"`
	Address                     string    `json:"address" binding:"required"`
	VillageName                 *string   `json:"village_name"`
	District                    *string   `json:"district"`
	Region                      *string   `json:"region"`
	Country                     string    `json:"country" binding:"required"`
	PostalCode                  *string   `json:"postal_code"`
	RoadAccessType              *string   `json:"road_access_type"`
	DistanceToMainRoadKm        *float64  `json:"distance_to_main_road_km"`
	NearestTown                 *string   `json:"nearest_town"`
	DistanceToNearestTownKm     *float64  `json:"distance_to_nearest_town_km"`
	HasElectricity              bool      `json:"has_electricity"`
	ElectricityReliabilityHours int       `json:"electricity_reliability_hours"`
	HasInternetConnectivity     bool      `json:"has_internet_connectivity"`
	InternetType                *string   `json:"internet_type"`
	InternetReliabilityPercent  float64   `json:"internet_reliability_percent"`
	HasMobileCoverage           bool      `json:"has_mobile_coverage"`
	MobileNetworkProviders      []string  `json:"mobile_network_providers"`
	HasATM                      bool      `json:"has_atm"`
	HasPOSTerminal              bool      `json:"has_pos_terminal"`
	HasCashVault                bool      `json:"has_cash_vault"`
	VaultCapacityUSD            float64   `json:"vault_capacity_usd"`
	OperatingHours              string    `json:"operating_hours"`
	ServiceAvailability         string    `json:"service_availability"`
	LanguagesSupported          []string  `json:"languages_supported"`
	EstimatedPopulationServed   *int      `json:"estimated_population_served"`
	HouseholdsServed            *int      `json:"households_served"`
	BusinessesServed            *int      `json:"businesses_served"`
	FarmersServed               *int      `json:"farmers_served"`
	BranchManagerID             *uuid.UUID `json:"branch_manager_id"`
	AssignedAgents              []uuid.UUID `json:"assigned_agents"`
	SecurityPersonnelCount      int       `json:"security_personnel_count"`
	CreatedBy                   uuid.UUID `json:"created_by" binding:"required"`
}

type CreateOfflineTransactionRequest struct {
	DeviceID               string     `json:"device_id" binding:"required"`
	AgentID                uuid.UUID  `json:"agent_id" binding:"required"`
	LocationID             *uuid.UUID `json:"location_id"`
	TransactionType        string     `json:"transaction_type" binding:"required"`
	Amount                 float64    `json:"amount" binding:"required,gt=0"`
	Currency               string     `json:"currency"`
	CustomerID             *uuid.UUID `json:"customer_id"`
	CustomerIdentifier     *string    `json:"customer_identifier"`
	OfflineTimestamp       time.Time  `json:"offline_timestamp" binding:"required"`
	TransactionData        string     `json:"transaction_data" binding:"required"`
	BiometricData          *string    `json:"biometric_data"`
	SupportingDocuments    *string    `json:"supporting_documents"`
	AgentSignature         *string    `json:"agent_signature"`
	CustomerSignature      *string    `json:"customer_signature"`
	WitnessSignature       *string    `json:"witness_signature"`
	DeviceFingerprint      *string    `json:"device_fingerprint"`
	RequiresManualReview   bool       `json:"requires_manual_review"`
}

type CreateMobileMoneyAccountRequest struct {
	CustomerID              *uuid.UUID `json:"customer_id"`
	Provider                string     `json:"provider" binding:"required"`
	ProviderAccountID       string     `json:"provider_account_id" binding:"required"`
	PhoneNumber             string     `json:"phone_number" binding:"required"`
	AccountType             string     `json:"account_type"`
	AccountName             string     `json:"account_name" binding:"required"`
	KYCLevel                int        `json:"kyc_level"`
	DailyTransactionLimit   *float64   `json:"daily_transaction_limit"`
	MonthlyTransactionLimit *float64   `json:"monthly_transaction_limit"`
	SingleTransactionLimit  *float64   `json:"single_transaction_limit"`
	AllowedCountries        []string   `json:"allowed_countries"`
	RestrictedRegions       []string   `json:"restricted_regions"`
	APIEndpoint             *string    `json:"api_endpoint"`
	WebhookURL              *string    `json:"webhook_url"`
	CreatedBy               *uuid.UUID `json:"created_by"`
}

type CreateMobileMoneyTransactionRequest struct {
	FromAccountID         *uuid.UUID `json:"from_account_id"`
	ToAccountID           *uuid.UUID `json:"to_account_id"`
	FromPhoneNumber       *string    `json:"from_phone_number"`
	ToPhoneNumber         *string    `json:"to_phone_number"`
	TransactionType       string     `json:"transaction_type" binding:"required"`
	Amount                float64    `json:"amount" binding:"required,gt=0"`
	Currency              string     `json:"currency"`
	ExchangeRate          *float64   `json:"exchange_rate"`
	AgentID               *uuid.UUID `json:"agent_id"`
	LocationID            *uuid.UUID `json:"location_id"`
	Description           *string    `json:"description"`
	Purpose               *string    `json:"purpose"`
	BeneficiaryName       *string    `json:"beneficiary_name"`
	SenderName            *string    `json:"sender_name"`
	CustomerReference     *string    `json:"customer_reference"`
}

type CreateAgriculturalLoanRequest struct {
	CustomerID                  uuid.UUID  `json:"customer_id" binding:"required"`
	AgentID                     uuid.UUID  `json:"agent_id" binding:"required"`
	LocationID                  *uuid.UUID `json:"location_id"`
	LoanAmount                  float64    `json:"loan_amount" binding:"required,gt=0"`
	Currency                    string     `json:"currency"`
	InterestRate                float64    `json:"interest_rate" binding:"required,gt=0"`
	LoanTermMonths              int        `json:"loan_term_months" binding:"required,gt=0"`
	RepaymentFrequency          string     `json:"repayment_frequency" binding:"required"`
	FarmingPurpose              string     `json:"farming_purpose" binding:"required"`
	CropTypes                   []string   `json:"crop_types" binding:"required"`
	FarmingMethod               string     `json:"farming_method"`
	FarmSizeHectares            *float64   `json:"farm_size_hectares"`
	ExpectedYieldTons           *float64   `json:"expected_yield_tons"`
	ExpectedHarvestDate         *time.Time `json:"expected_harvest_date"`
	FarmLatitude                *float64   `json:"farm_latitude"`
	FarmLongitude               *float64   `json:"farm_longitude"`
	FarmAddress                 *string    `json:"farm_address"`
	CollateralType              *string    `json:"collateral_type"`
	CollateralValue             *float64   `json:"collateral_value"`
	CollateralDescription       *string    `json:"collateral_description"`
	GuarantorID                 *uuid.UUID `json:"guarantor_id"`
	FarmerExperienceYears       *int       `json:"farmer_experience_years"`
	CropInsurancePolicy         *string    `json:"crop_insurance_policy"`
	InsuranceProvider           *string    `json:"insurance_provider"`
	InsurancePremium            float64    `json:"insurance_premium"`
	InsuranceCoverageAmount     float64    `json:"insurance_coverage_amount"`
	ExtensionOfficerID          *uuid.UUID `json:"extension_officer_id"`
	TechnicalAssistanceProvided []string   `json:"technical_assistance_provided"`
	CreatedBy                   uuid.UUID  `json:"created_by" binding:"required"`
}

type CreateMicrofinanceGroupRequest struct {
	GroupName                   string     `json:"group_name" binding:"required"`
	GroupType                   string     `json:"group_type" binding:"required"`
	FormationDate               time.Time  `json:"formation_date" binding:"required"`
	RegistrationNumber          *string    `json:"registration_number"`
	LegalStatus                 *string    `json:"legal_status"`
	LocationID                  *uuid.UUID `json:"location_id"`
	MeetingLocation             *string    `json:"meeting_location"`
	MeetingSchedule             *string    `json:"meeting_schedule"`
	MinimumSavingsAmount        *float64   `json:"minimum_savings_amount"`
	MaximumLoanAmount           *float64   `json:"maximum_loan_amount"`
	InterestRateOnLoans         *float64   `json:"interest_rate_on_loans"`
	LoanTermMonths              *int       `json:"loan_term_months"`
	MeetingAttendanceRequirement *float64  `json:"meeting_attendance_requirement"`
	ChairpersonID               *uuid.UUID `json:"chairperson_id"`
	SecretaryID                 *uuid.UUID `json:"secretary_id"`
	TreasurerID                 *uuid.UUID `json:"treasurer_id"`
	FieldOfficerID              *uuid.UUID `json:"field_officer_id"`
	TrainingTopicsCovered       []string   `json:"training_topics_covered"`
	CreatedBy                   uuid.UUID  `json:"created_by" binding:"required"`
}

type CreateCommunityServiceRequest struct {
	ServiceName               string      `json:"service_name" binding:"required"`
	ServiceCategory           string      `json:"service_category" binding:"required"`
	Description               string      `json:"description" binding:"required"`
	TargetDemographic         *string     `json:"target_demographic"`
	MinimumAge                int         `json:"minimum_age"`
	MaximumAge                *int        `json:"maximum_age"`
	AvailableLocations        []uuid.UUID `json:"available_locations"`
	ServiceHours              *string     `json:"service_hours"`
	SeasonalAvailability      bool        `json:"seasonal_availability"`
	AvailableMonths           []int       `json:"available_months"`
	ServiceFee                float64     `json:"service_fee"`
	MinimumAmount             *float64    `json:"minimum_amount"`
	MaximumAmount             *float64    `json:"maximum_amount"`
	DailyLimit                *float64    `json:"daily_limit"`
	MonthlyLimit              *float64    `json:"monthly_limit"`
	KYCLevelRequired          int         `json:"kyc_level_required"`
	DocumentsRequired         []string    `json:"documents_required"`
	GuarantorRequired         bool        `json:"guarantor_required"`
	CollateralRequired        bool        `json:"collateral_required"`
	MobileAppSupported        bool        `json:"mobile_app_supported"`
	USSDSupported             bool        `json:"ussd_supported"`
	SMSSupported              bool        `json:"sms_supported"`
	OfflineSupported          bool        `json:"offline_supported"`
	LaunchDate                *time.Time  `json:"launch_date"`
	SunsetDate                *time.Time  `json:"sunset_date"`
	CreatedBy                 uuid.UUID   `json:"created_by" binding:"required"`
}

type SyncOfflineTransactionRequest struct {
	TransactionID uuid.UUID `json:"transaction_id" binding:"required"`
	ForceSync     bool      `json:"force_sync"`
}

type ProcessMobileMoneyRequest struct {
	FromPhone       string     `json:"from_phone" binding:"required"`
	ToPhone         string     `json:"to_phone" binding:"required"`
	Amount          float64    `json:"amount" binding:"required,gt=0"`
	TransactionType string     `json:"transaction_type" binding:"required"`
	AgentID         *uuid.UUID `json:"agent_id"`
	Reference       *string    `json:"reference"`
	Description     *string    `json:"description"`
}

type CalculateRiskScoreRequest struct {
	LoanID uuid.UUID `json:"loan_id" binding:"required"`
}

// Response models
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type PaginatedResponse struct {
	Success    bool        `json:"success"`
	Message    string      `json:"message"`
	Data       interface{} `json:"data"`
	Pagination struct {
		Page       int   `json:"page"`
		Limit      int   `json:"limit"`
		Total      int64 `json:"total"`
		TotalPages int   `json:"total_pages"`
	} `json:"pagination"`
}

// =====================================================
// DATABASE CONNECTION AND SETUP
// =====================================================

func setupDatabase(config *Config) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(config.DatabaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(config.MaxConnections)
	sqlDB.SetMaxIdleConns(config.MaxConnections / 2)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// Auto-migrate the schema
	err = db.AutoMigrate(
		&RuralBankingLocation{},
		&OfflineTransaction{},
		&MobileMoneyAccount{},
		&MobileMoneyTransaction{},
		&AgriculturalLoan{},
		&MicrofinanceGroup{},
		&CommunityBankingService{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return db, nil
}

// =====================================================
// SERVICE LAYER
// =====================================================

type RuralBankingService struct {
	db *gorm.DB
}

func NewRuralBankingService(db *gorm.DB) *RuralBankingService {
	return &RuralBankingService{db: db}
}

// Rural Banking Location methods
func (s *RuralBankingService) CreateRuralLocation(req *CreateRuralLocationRequest) (*RuralBankingLocation, error) {
	location := &RuralBankingLocation{
		LocationID:                  generateLocationID(),
		LocationName:                req.LocationName,
		BranchType:                  req.BranchType,
		Latitude:                    req.Latitude,
		Longitude:                   req.Longitude,
		Address:                     req.Address,
		VillageName:                 req.VillageName,
		District:                    req.District,
		Region:                      req.Region,
		Country:                     req.Country,
		PostalCode:                  req.PostalCode,
		RoadAccessType:              req.RoadAccessType,
		DistanceToMainRoadKm:        req.DistanceToMainRoadKm,
		NearestTown:                 req.NearestTown,
		DistanceToNearestTownKm:     req.DistanceToNearestTownKm,
		HasElectricity:              req.HasElectricity,
		ElectricityReliabilityHours: req.ElectricityReliabilityHours,
		HasInternetConnectivity:     req.HasInternetConnectivity,
		InternetType:                req.InternetType,
		InternetReliabilityPercent:  req.InternetReliabilityPercent,
		HasMobileCoverage:           req.HasMobileCoverage,
		MobileNetworkProviders:      req.MobileNetworkProviders,
		HasATM:                      req.HasATM,
		HasPOSTerminal:              req.HasPOSTerminal,
		HasCashVault:                req.HasCashVault,
		VaultCapacityUSD:            req.VaultCapacityUSD,
		OperatingHours:              req.OperatingHours,
		ServiceAvailability:         req.ServiceAvailability,
		LanguagesSupported:          req.LanguagesSupported,
		EstimatedPopulationServed:   req.EstimatedPopulationServed,
		HouseholdsServed:            req.HouseholdsServed,
		BusinessesServed:            req.BusinessesServed,
		FarmersServed:               req.FarmersServed,
		BranchManagerID:             req.BranchManagerID,
		AssignedAgents:              req.AssignedAgents,
		SecurityPersonnelCount:      req.SecurityPersonnelCount,
		Status:                      "active",
		CreatedBy:                   req.CreatedBy,
	}

	if err := s.db.Create(location).Error; err != nil {
		return nil, fmt.Errorf("failed to create rural location: %w", err)
	}

	return location, nil
}

func (s *RuralBankingService) GetRuralLocations(page, limit int, filters map[string]interface{}) ([]RuralBankingLocation, int64, error) {
	var locations []RuralBankingLocation
	var total int64

	query := s.db.Model(&RuralBankingLocation{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "country":
			query = query.Where("country = ?", value)
		case "region":
			query = query.Where("region = ?", value)
		case "branch_type":
			query = query.Where("branch_type = ?", value)
		case "status":
			query = query.Where("status = ?", value)
		case "has_electricity":
			query = query.Where("has_electricity = ?", value)
		case "has_internet":
			query = query.Where("has_internet_connectivity = ?", value)
		case "has_mobile_coverage":
			query = query.Where("has_mobile_coverage = ?", value)
		}
	}

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count rural locations: %w", err)
	}

	// Get paginated results
	offset := (page - 1) * limit
	if err := query.Offset(offset).Limit(limit).Order("created_at DESC").Find(&locations).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to get rural locations: %w", err)
	}

	return locations, total, nil
}

func (s *RuralBankingService) GetRuralLocationByID(id uuid.UUID) (*RuralBankingLocation, error) {
	var location RuralBankingLocation
	if err := s.db.First(&location, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get rural location: %w", err)
	}
	return &location, nil
}

func (s *RuralBankingService) UpdateRuralLocation(id uuid.UUID, updates map[string]interface{}) (*RuralBankingLocation, error) {
	var location RuralBankingLocation
	if err := s.db.First(&location, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find rural location: %w", err)
	}

	updates["updated_at"] = time.Now()
	if err := s.db.Model(&location).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update rural location: %w", err)
	}

	return &location, nil
}

// Offline Transaction methods
func (s *RuralBankingService) CreateOfflineTransaction(req *CreateOfflineTransactionRequest) (*OfflineTransaction, error) {
	transaction := &OfflineTransaction{
		OfflineTransactionID:   generateOfflineTransactionID(),
		DeviceID:               req.DeviceID,
		AgentID:                req.AgentID,
		LocationID:             req.LocationID,
		TransactionType:        req.TransactionType,
		Amount:                 req.Amount,
		Currency:               getStringOrDefault(req.Currency, "USD"),
		CustomerID:             req.CustomerID,
		CustomerIdentifier:     req.CustomerIdentifier,
		OfflineTimestamp:       req.OfflineTimestamp,
		TransactionData:        req.TransactionData,
		BiometricData:          req.BiometricData,
		SupportingDocuments:    req.SupportingDocuments,
		AgentSignature:         req.AgentSignature,
		CustomerSignature:      req.CustomerSignature,
		WitnessSignature:       req.WitnessSignature,
		DeviceFingerprint:      req.DeviceFingerprint,
		TransactionHash:        generateTransactionHash(req.TransactionData),
		Status:                 "pending_sync",
		RequiresManualReview:   req.RequiresManualReview,
		RiskScore:              calculateOfflineTransactionRisk(req),
	}

	if err := s.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create offline transaction: %w", err)
	}

	return transaction, nil
}

func (s *RuralBankingService) SyncOfflineTransaction(transactionID uuid.UUID, forceSync bool) (*OfflineTransaction, error) {
	var transaction OfflineTransaction
	if err := s.db.First(&transaction, "id = ?", transactionID).Error; err != nil {
		return nil, fmt.Errorf("failed to find offline transaction: %w", err)
	}

	if transaction.Status == "synced" && !forceSync {
		return &transaction, nil
	}

	// Update sync attempt
	updates := map[string]interface{}{
		"sync_attempts":      transaction.SyncAttempts + 1,
		"last_sync_attempt":  time.Now(),
		"status":             "syncing",
	}

	if err := s.db.Model(&transaction).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update sync attempt: %w", err)
	}

	// Simulate transaction processing
	success := processOfflineTransaction(&transaction)
	
	if success {
		syncUpdates := map[string]interface{}{
			"status":                   "synced",
			"sync_timestamp":           time.Now(),
			"offline_duration_minutes": int(time.Since(transaction.OfflineTimestamp).Minutes()),
		}
		if err := s.db.Model(&transaction).Updates(syncUpdates).Error; err != nil {
			return nil, fmt.Errorf("failed to update sync success: %w", err)
		}
	} else {
		failUpdates := map[string]interface{}{
			"status":             "sync_failed",
			"sync_error_message": "Transaction validation failed",
		}
		if err := s.db.Model(&transaction).Updates(failUpdates).Error; err != nil {
			return nil, fmt.Errorf("failed to update sync failure: %w", err)
		}
	}

	// Reload transaction
	if err := s.db.First(&transaction, "id = ?", transactionID).Error; err != nil {
		return nil, fmt.Errorf("failed to reload transaction: %w", err)
	}

	return &transaction, nil
}

func (s *RuralBankingService) GetOfflineTransactions(page, limit int, filters map[string]interface{}) ([]OfflineTransaction, int64, error) {
	var transactions []OfflineTransaction
	var total int64

	query := s.db.Model(&OfflineTransaction{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "device_id":
			query = query.Where("device_id = ?", value)
		case "agent_id":
			query = query.Where("agent_id = ?", value)
		case "status":
			query = query.Where("status = ?", value)
		case "transaction_type":
			query = query.Where("transaction_type = ?", value)
		case "requires_manual_review":
			query = query.Where("requires_manual_review = ?", value)
		}
	}

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count offline transactions: %w", err)
	}

	// Get paginated results
	offset := (page - 1) * limit
	if err := query.Offset(offset).Limit(limit).Order("offline_timestamp DESC").Find(&transactions).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to get offline transactions: %w", err)
	}

	return transactions, total, nil
}

// Mobile Money methods
func (s *RuralBankingService) CreateMobileMoneyAccount(req *CreateMobileMoneyAccountRequest) (*MobileMoneyAccount, error) {
	account := &MobileMoneyAccount{
		AccountID:               generateMobileMoneyAccountID(),
		CustomerID:              req.CustomerID,
		Provider:                req.Provider,
		ProviderAccountID:       req.ProviderAccountID,
		PhoneNumber:             req.PhoneNumber,
		AccountType:             getStringOrDefault(req.AccountType, "personal"),
		AccountName:             req.AccountName,
		AccountStatus:           "active",
		KYCLevel:                getIntOrDefault(req.KYCLevel, 1),
		DailyTransactionLimit:   req.DailyTransactionLimit,
		MonthlyTransactionLimit: req.MonthlyTransactionLimit,
		SingleTransactionLimit:  req.SingleTransactionLimit,
		AllowedCountries:        req.AllowedCountries,
		RestrictedRegions:       req.RestrictedRegions,
		APIEndpoint:             req.APIEndpoint,
		WebhookURL:              req.WebhookURL,
		CreatedBy:               req.CreatedBy,
	}

	if err := s.db.Create(account).Error; err != nil {
		return nil, fmt.Errorf("failed to create mobile money account: %w", err)
	}

	return account, nil
}

func (s *RuralBankingService) ProcessMobileMoneyTransaction(req *ProcessMobileMoneyRequest) (*MobileMoneyTransaction, error) {
	// Get accounts
	var fromAccount, toAccount MobileMoneyAccount
	if err := s.db.Where("phone_number = ? AND account_status = 'active'", req.FromPhone).First(&fromAccount).Error; err != nil {
		return nil, fmt.Errorf("from account not found: %w", err)
	}
	if err := s.db.Where("phone_number = ? AND account_status = 'active'", req.ToPhone).First(&toAccount).Error; err != nil {
		return nil, fmt.Errorf("to account not found: %w", err)
	}

	// Calculate fees
	transactionFee := calculateMobileMoneyFee(req.Amount, req.TransactionType)
	
	transaction := &MobileMoneyTransaction{
		TransactionID:     generateMobileMoneyTransactionID(),
		FromAccountID:     &fromAccount.ID,
		ToAccountID:       &toAccount.ID,
		FromPhoneNumber:   &req.FromPhone,
		ToPhoneNumber:     &req.ToPhone,
		TransactionType:   req.TransactionType,
		Amount:            req.Amount,
		Currency:          "USD",
		TransactionFee:    transactionFee,
		TotalCharges:      transactionFee,
		Status:            "pending",
		ReferenceNumber:   generateReferenceNumber(),
		AgentID:           req.AgentID,
		Description:       req.Description,
		CustomerReference: req.Reference,
	}

	if err := s.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create mobile money transaction: %w", err)
	}

	// Process transaction (simplified)
	go s.processMobileMoneyTransactionAsync(transaction.ID)

	return transaction, nil
}

func (s *RuralBankingService) processMobileMoneyTransactionAsync(transactionID uuid.UUID) {
	time.Sleep(2 * time.Second) // Simulate processing time

	updates := map[string]interface{}{
		"status":                  "completed",
		"completed_at":            time.Now(),
		"processing_time_seconds": 2,
		"provider_status":         "SUCCESS",
		"provider_reference":      generateProviderReference(),
	}

	s.db.Model(&MobileMoneyTransaction{}).Where("id = ?", transactionID).Updates(updates)
}

// Agricultural Loan methods
func (s *RuralBankingService) CreateAgriculturalLoan(req *CreateAgriculturalLoanRequest) (*AgriculturalLoan, error) {
	loan := &AgriculturalLoan{
		LoanID:                      generateAgriculturalLoanID(),
		CustomerID:                  req.CustomerID,
		AgentID:                     req.AgentID,
		LocationID:                  req.LocationID,
		LoanAmount:                  req.LoanAmount,
		Currency:                    getStringOrDefault(req.Currency, "USD"),
		InterestRate:                req.InterestRate,
		LoanTermMonths:              req.LoanTermMonths,
		RepaymentFrequency:          req.RepaymentFrequency,
		FarmingPurpose:              req.FarmingPurpose,
		CropTypes:                   req.CropTypes,
		FarmingMethod:               getStringOrDefault(req.FarmingMethod, "traditional"),
		FarmSizeHectares:            req.FarmSizeHectares,
		ExpectedYieldTons:           req.ExpectedYieldTons,
		ExpectedHarvestDate:         req.ExpectedHarvestDate,
		FarmLatitude:                req.FarmLatitude,
		FarmLongitude:               req.FarmLongitude,
		FarmAddress:                 req.FarmAddress,
		CollateralType:              req.CollateralType,
		CollateralValue:             req.CollateralValue,
		CollateralDescription:       req.CollateralDescription,
		GuarantorID:                 req.GuarantorID,
		FarmerExperienceYears:       req.FarmerExperienceYears,
		CropInsurancePolicy:         req.CropInsurancePolicy,
		InsuranceProvider:           req.InsuranceProvider,
		InsurancePremium:            req.InsurancePremium,
		InsuranceCoverageAmount:     req.InsuranceCoverageAmount,
		ExtensionOfficerID:          req.ExtensionOfficerID,
		TechnicalAssistanceProvided: req.TechnicalAssistanceProvided,
		Status:                      "pending",
		CreatedBy:                   req.CreatedBy,
	}

	// Calculate risk scores
	loan.WeatherRiskScore = calculateWeatherRisk(req.CropTypes, req.FarmLatitude, req.FarmLongitude)
	loan.MarketRiskScore = calculateMarketRisk(req.FarmSizeHectares, req.CropTypes)
	loan.OverallRiskScore = (loan.WeatherRiskScore + loan.MarketRiskScore) / 2

	if err := s.db.Create(loan).Error; err != nil {
		return nil, fmt.Errorf("failed to create agricultural loan: %w", err)
	}

	return loan, nil
}

func (s *RuralBankingService) CalculateAgriculturalLoanRisk(loanID uuid.UUID) (float64, error) {
	var loan AgriculturalLoan
	if err := s.db.First(&loan, "id = ?", loanID).Error; err != nil {
		return 0, fmt.Errorf("failed to find loan: %w", err)
	}

	// Recalculate risk scores
	weatherRisk := calculateWeatherRisk(loan.CropTypes, loan.FarmLatitude, loan.FarmLongitude)
	marketRisk := calculateMarketRisk(loan.FarmSizeHectares, loan.CropTypes)
	farmerRisk := calculateFarmerRisk(loan.FarmerExperienceYears)
	
	overallRisk := (weatherRisk + marketRisk + farmerRisk) / 3

	// Update loan with new risk scores
	updates := map[string]interface{}{
		"weather_risk_score": weatherRisk,
		"market_risk_score":  marketRisk,
		"overall_risk_score": overallRisk,
	}

	if err := s.db.Model(&loan).Updates(updates).Error; err != nil {
		return 0, fmt.Errorf("failed to update risk scores: %w", err)
	}

	return overallRisk, nil
}

// Microfinance Group methods
func (s *RuralBankingService) CreateMicrofinanceGroup(req *CreateMicrofinanceGroupRequest) (*MicrofinanceGroup, error) {
	group := &MicrofinanceGroup{
		GroupID:                     generateMicrofinanceGroupID(),
		GroupName:                   req.GroupName,
		GroupType:                   req.GroupType,
		FormationDate:               req.FormationDate,
		RegistrationNumber:          req.RegistrationNumber,
		LegalStatus:                 req.LegalStatus,
		LocationID:                  req.LocationID,
		MeetingLocation:             req.MeetingLocation,
		MeetingSchedule:             req.MeetingSchedule,
		MinimumSavingsAmount:        req.MinimumSavingsAmount,
		MaximumLoanAmount:           req.MaximumLoanAmount,
		InterestRateOnLoans:         req.InterestRateOnLoans,
		LoanTermMonths:              req.LoanTermMonths,
		MeetingAttendanceRequirement: req.MeetingAttendanceRequirement,
		ChairpersonID:               req.ChairpersonID,
		SecretaryID:                 req.SecretaryID,
		TreasurerID:                 req.TreasurerID,
		FieldOfficerID:              req.FieldOfficerID,
		TrainingTopicsCovered:       req.TrainingTopicsCovered,
		Status:                      "active",
		CreatedBy:                   req.CreatedBy,
	}

	if err := s.db.Create(group).Error; err != nil {
		return nil, fmt.Errorf("failed to create microfinance group: %w", err)
	}

	return group, nil
}

// Community Banking Service methods
func (s *RuralBankingService) CreateCommunityService(req *CreateCommunityServiceRequest) (*CommunityBankingService, error) {
	service := &CommunityBankingService{
		ServiceID:                 generateCommunityServiceID(),
		ServiceName:               req.ServiceName,
		ServiceCategory:           req.ServiceCategory,
		Description:               req.Description,
		TargetDemographic:         req.TargetDemographic,
		MinimumAge:                req.MinimumAge,
		MaximumAge:                req.MaximumAge,
		AvailableLocations:        req.AvailableLocations,
		ServiceHours:              req.ServiceHours,
		SeasonalAvailability:      req.SeasonalAvailability,
		AvailableMonths:           req.AvailableMonths,
		ServiceFee:                req.ServiceFee,
		MinimumAmount:             req.MinimumAmount,
		MaximumAmount:             req.MaximumAmount,
		DailyLimit:                req.DailyLimit,
		MonthlyLimit:              req.MonthlyLimit,
		KYCLevelRequired:          req.KYCLevelRequired,
		DocumentsRequired:         req.DocumentsRequired,
		GuarantorRequired:         req.GuarantorRequired,
		CollateralRequired:        req.CollateralRequired,
		MobileAppSupported:        req.MobileAppSupported,
		USSDSupported:             req.USSDSupported,
		SMSSupported:              req.SMSSupported,
		OfflineSupported:          req.OfflineSupported,
		Status:                    "active",
		LaunchDate:                req.LaunchDate,
		SunsetDate:                req.SunsetDate,
		CreatedBy:                 req.CreatedBy,
	}

	if err := s.db.Create(service).Error; err != nil {
		return nil, fmt.Errorf("failed to create community service: %w", err)
	}

	return service, nil
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

func generateLocationID() string {
	return fmt.Sprintf("RBL-%d", time.Now().Unix())
}

func generateOfflineTransactionID() string {
	return fmt.Sprintf("OTX-%d", time.Now().Unix())
}

func generateMobileMoneyAccountID() string {
	return fmt.Sprintf("MMA-%d", time.Now().Unix())
}

func generateMobileMoneyTransactionID() string {
	return fmt.Sprintf("MMT-%d", time.Now().Unix())
}

func generateAgriculturalLoanID() string {
	return fmt.Sprintf("AGL-%d", time.Now().Unix())
}

func generateMicrofinanceGroupID() string {
	return fmt.Sprintf("MFG-%d", time.Now().Unix())
}

func generateCommunityServiceID() string {
	return fmt.Sprintf("CBS-%d", time.Now().Unix())
}

func generateTransactionHash(data string) *string {
	hash := fmt.Sprintf("hash_%d", time.Now().Unix())
	return &hash
}

func generateReferenceNumber() *string {
	ref := fmt.Sprintf("REF%d", time.Now().Unix())
	return &ref
}

func generateProviderReference() string {
	return fmt.Sprintf("PROV%d", time.Now().Unix())
}

func getStringOrDefault(value *string, defaultValue string) string {
	if value != nil {
		return *value
	}
	return defaultValue
}

func getIntOrDefault(value *int, defaultValue int) int {
	if value != nil {
		return *value
	}
	return defaultValue
}

func calculateOfflineTransactionRisk(req *CreateOfflineTransactionRequest) float64 {
	risk := 0.0
	
	// Amount-based risk
	if req.Amount > 1000 {
		risk += 20.0
	} else if req.Amount > 500 {
		risk += 10.0
	}
	
	// Transaction type risk
	switch req.TransactionType {
	case "cash_withdrawal":
		risk += 15.0
	case "transfer":
		risk += 10.0
	case "deposit":
		risk += 5.0
	}
	
	// Manual review requirement
	if req.RequiresManualReview {
		risk += 25.0
	}
	
	return risk
}

func processOfflineTransaction(transaction *OfflineTransaction) bool {
	// Simplified validation logic
	return transaction.Amount > 0 && 
		   transaction.TransactionData != "" && 
		   transaction.AgentSignature != nil
}

func calculateMobileMoneyFee(amount float64, transactionType string) float64 {
	switch transactionType {
	case "send_money":
		if amount <= 100 {
			return 1.0
		} else if amount <= 500 {
			return 2.5
		} else if amount <= 1000 {
			return 5.0
		}
		return amount * 0.01
	case "cash_out":
		return amount * 0.015
	case "cash_in":
		return 0.5
	default:
		return 1.0
	}
}

func calculateWeatherRisk(cropTypes []string, latitude, longitude *float64) float64 {
	risk := 10.0 // Base risk
	
	for _, crop := range cropTypes {
		switch crop {
		case "cereals":
			risk += 15.0
		case "cash_crops":
			risk += 20.0
		case "vegetables":
			risk += 10.0
		default:
			risk += 12.0
		}
	}
	
	// Geographic risk (simplified)
	if latitude != nil && longitude != nil {
		if *latitude < -10 || *latitude > 10 { // Further from equator
			risk += 5.0
		}
	}
	
	return risk / float64(len(cropTypes))
}

func calculateMarketRisk(farmSize *float64, cropTypes []string) float64 {
	risk := 15.0 // Base risk
	
	if farmSize != nil {
		if *farmSize < 2 {
			risk += 20.0
		} else if *farmSize < 5 {
			risk += 15.0
		} else if *farmSize < 10 {
			risk += 10.0
		} else {
			risk += 5.0
		}
	}
	
	// Crop diversification reduces risk
	if len(cropTypes) > 2 {
		risk -= 5.0
	}
	
	return risk
}

func calculateFarmerRisk(experienceYears *int) float64 {
	if experienceYears == nil {
		return 25.0
	}
	
	switch {
	case *experienceYears < 2:
		return 25.0
	case *experienceYears < 5:
		return 20.0
	case *experienceYears < 10:
		return 15.0
	case *experienceYears < 20:
		return 10.0
	default:
		return 5.0
	}
}

// =====================================================
// HTTP HANDLERS
// =====================================================

type RuralBankingHandler struct {
	service *RuralBankingService
}

func NewRuralBankingHandler(service *RuralBankingService) *RuralBankingHandler {
	return &RuralBankingHandler{service: service}
}

// Rural Banking Location handlers
func (h *RuralBankingHandler) CreateRuralLocation(c *gin.Context) {
	var req CreateRuralLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	location, err := h.service.CreateRuralLocation(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create rural location",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Rural location created successfully",
		Data:    location,
	})
}

func (h *RuralBankingHandler) GetRuralLocations(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	filters := make(map[string]interface{})
	if country := c.Query("country"); country != "" {
		filters["country"] = country
	}
	if region := c.Query("region"); region != "" {
		filters["region"] = region
	}
	if branchType := c.Query("branch_type"); branchType != "" {
		filters["branch_type"] = branchType
	}
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}

	locations, total, err := h.service.GetRuralLocations(page, limit, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to get rural locations",
			Error:   err.Error(),
		})
		return
	}

	response := PaginatedResponse{
		Success: true,
		Message: "Rural locations retrieved successfully",
		Data:    locations,
	}
	response.Pagination.Page = page
	response.Pagination.Limit = limit
	response.Pagination.Total = total
	response.Pagination.TotalPages = int((total + int64(limit) - 1) / int64(limit))

	c.JSON(http.StatusOK, response)
}

func (h *RuralBankingHandler) GetRuralLocationByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid location ID",
			Error:   err.Error(),
		})
		return
	}

	location, err := h.service.GetRuralLocationByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, APIResponse{
			Success: false,
			Message: "Rural location not found",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "Rural location retrieved successfully",
		Data:    location,
	})
}

// Offline Transaction handlers
func (h *RuralBankingHandler) CreateOfflineTransaction(c *gin.Context) {
	var req CreateOfflineTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	transaction, err := h.service.CreateOfflineTransaction(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create offline transaction",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Offline transaction created successfully",
		Data:    transaction,
	})
}

func (h *RuralBankingHandler) SyncOfflineTransaction(c *gin.Context) {
	var req SyncOfflineTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	transaction, err := h.service.SyncOfflineTransaction(req.TransactionID, req.ForceSync)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to sync offline transaction",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "Offline transaction synced successfully",
		Data:    transaction,
	})
}

func (h *RuralBankingHandler) GetOfflineTransactions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	filters := make(map[string]interface{})
	if deviceID := c.Query("device_id"); deviceID != "" {
		filters["device_id"] = deviceID
	}
	if agentID := c.Query("agent_id"); agentID != "" {
		if id, err := uuid.Parse(agentID); err == nil {
			filters["agent_id"] = id
		}
	}
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}

	transactions, total, err := h.service.GetOfflineTransactions(page, limit, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to get offline transactions",
			Error:   err.Error(),
		})
		return
	}

	response := PaginatedResponse{
		Success: true,
		Message: "Offline transactions retrieved successfully",
		Data:    transactions,
	}
	response.Pagination.Page = page
	response.Pagination.Limit = limit
	response.Pagination.Total = total
	response.Pagination.TotalPages = int((total + int64(limit) - 1) / int64(limit))

	c.JSON(http.StatusOK, response)
}

// Mobile Money handlers
func (h *RuralBankingHandler) CreateMobileMoneyAccount(c *gin.Context) {
	var req CreateMobileMoneyAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	account, err := h.service.CreateMobileMoneyAccount(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create mobile money account",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Mobile money account created successfully",
		Data:    account,
	})
}

func (h *RuralBankingHandler) ProcessMobileMoneyTransaction(c *gin.Context) {
	var req ProcessMobileMoneyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	transaction, err := h.service.ProcessMobileMoneyTransaction(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to process mobile money transaction",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Mobile money transaction processed successfully",
		Data:    transaction,
	})
}

// Agricultural Loan handlers
func (h *RuralBankingHandler) CreateAgriculturalLoan(c *gin.Context) {
	var req CreateAgriculturalLoanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	loan, err := h.service.CreateAgriculturalLoan(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create agricultural loan",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Agricultural loan created successfully",
		Data:    loan,
	})
}

func (h *RuralBankingHandler) CalculateRiskScore(c *gin.Context) {
	var req CalculateRiskScoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	riskScore, err := h.service.CalculateAgriculturalLoanRisk(req.LoanID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to calculate risk score",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "Risk score calculated successfully",
		Data:    map[string]float64{"risk_score": riskScore},
	})
}

// Microfinance Group handlers
func (h *RuralBankingHandler) CreateMicrofinanceGroup(c *gin.Context) {
	var req CreateMicrofinanceGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	group, err := h.service.CreateMicrofinanceGroup(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create microfinance group",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Microfinance group created successfully",
		Data:    group,
	})
}

// Community Service handlers
func (h *RuralBankingHandler) CreateCommunityService(c *gin.Context) {
	var req CreateCommunityServiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	service, err := h.service.CreateCommunityService(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, APIResponse{
			Success: false,
			Message: "Failed to create community service",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: "Community service created successfully",
		Data:    service,
	})
}

// Health check handler
func (h *RuralBankingHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "Rural Banking Service is healthy",
		Data: map[string]interface{}{
			"service":   "rural-banking",
			"version":   "1.0.0",
			"timestamp": time.Now(),
		},
	})
}

// =====================================================
// ROUTER SETUP
// =====================================================

func setupRouter(handler *RuralBankingHandler) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	router.Use(cors.New(config))

	// API routes
	api := router.Group("/api/v1")
	{
		// Health check
		api.GET("/health", handler.HealthCheck)

		// Rural Banking Locations
		locations := api.Group("/rural-locations")
		{
			locations.POST("", handler.CreateRuralLocation)
			locations.GET("", handler.GetRuralLocations)
			locations.GET("/:id", handler.GetRuralLocationByID)
		}

		// Offline Transactions
		offline := api.Group("/offline-transactions")
		{
			offline.POST("", handler.CreateOfflineTransaction)
			offline.GET("", handler.GetOfflineTransactions)
			offline.POST("/sync", handler.SyncOfflineTransaction)
		}

		// Mobile Money
		mobileMoney := api.Group("/mobile-money")
		{
			mobileMoney.POST("/accounts", handler.CreateMobileMoneyAccount)
			mobileMoney.POST("/transactions", handler.ProcessMobileMoneyTransaction)
		}

		// Agricultural Loans
		agriLoans := api.Group("/agricultural-loans")
		{
			agriLoans.POST("", handler.CreateAgriculturalLoan)
			agriLoans.POST("/calculate-risk", handler.CalculateRiskScore)
		}

		// Microfinance Groups
		microfinance := api.Group("/microfinance-groups")
		{
			microfinance.POST("", handler.CreateMicrofinanceGroup)
		}

		// Community Services
		community := api.Group("/community-services")
		{
			community.POST("", handler.CreateCommunityService)
		}
	}

	return router
}

// =====================================================
// MAIN FUNCTION
// =====================================================

func main() {
	// Load configuration
	config := loadConfig()

	// Setup database
	db, err := setupDatabase(config)
	if err != nil {
		log.Fatalf("Failed to setup database: %v", err)
	}

	// Initialize service and handler
	service := NewRuralBankingService(db)
	handler := NewRuralBankingHandler(service)

	// Setup router
	router := setupRouter(handler)

	// Create HTTP server
	server := &http.Server{
		Addr:    ":" + config.ServerPort,
		Handler: router,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Rural Banking Service starting on port %s", config.ServerPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down Rural Banking Service...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Rural Banking Service stopped")
}

