import os
package main

import (
	"context"
	"database/sql"
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
}

func loadConfig() *Config {
	return &Config{
		DBHost:     getEnv("DB_HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBName:     getEnv("DB_NAME", "remittance_network"),
		DBUser:     getEnv("DB_USER", "postgres"),
		DBPassword: getEnv("DB_PASSWORD", "password"),
		RedisHost:  getEnv("REDIS_HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")"),
		RedisPort:  getEnv("REDIS_PORT", "6379"),
		RedisDB:    getEnvAsInt("REDIS_DB", 0),
		Port:       getEnv("PORT", "8080"),
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

type TransactionType string

const (
	CashIn              TransactionType = "cash_in"
	CashOut             TransactionType = "cash_out"
	Deposit             TransactionType = "deposit"
	Withdrawal          TransactionType = "withdrawal"
	Transfer            TransactionType = "transfer"
	BillPayment         TransactionType = "bill_payment"
	AirtimePurchase     TransactionType = "airtime_purchase"
	DataPurchase        TransactionType = "data_purchase"
	MerchantPayment     TransactionType = "merchant_payment"
	AgentFloatRequest   TransactionType = "agent_float_request"
	AgentFloatTransfer  TransactionType = "agent_float_transfer"
	CommissionPayment   TransactionType = "commission_payment"
	FeeCollection       TransactionType = "fee_collection"
	Reversal            TransactionType = "reversal"
	Adjustment          TransactionType = "adjustment"
)

type TransactionStatus string

const (
	Initiated    TransactionStatus = "initiated"
	Pending      TransactionStatus = "pending"
	Processing   TransactionStatus = "processing"
	Completed    TransactionStatus = "completed"
	Failed       TransactionStatus = "failed"
	Cancelled    TransactionStatus = "cancelled"
	Reversed     TransactionStatus = "reversed"
	Expired      TransactionStatus = "expired"
	OnHold       TransactionStatus = "on_hold"
	UnderReview  TransactionStatus = "under_review"
)

type TransactionPriority string

const (
	Low      TransactionPriority = "low"
	Normal   TransactionPriority = "normal"
	High     TransactionPriority = "high"
	Urgent   TransactionPriority = "urgent"
	Critical TransactionPriority = "critical"
)

type NetworkTransaction struct {
	ID                      string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionReference    string                 `json:"transaction_reference" gorm:"type:varchar(50);unique;not null"`
	ExternalReference       *string                `json:"external_reference" gorm:"type:varchar(100)"`
	ParentTransactionID     *string                `json:"parent_transaction_id" gorm:"type:uuid"`
	TransactionType         TransactionType        `json:"transaction_type" gorm:"type:varchar(30);not null"`
	TransactionStatus       TransactionStatus      `json:"transaction_status" gorm:"type:varchar(30);not null;default:'initiated'"`
	Priority                TransactionPriority    `json:"priority" gorm:"type:varchar(20);not null;default:'normal'"`
	OriginatorAgentID       string                 `json:"originator_agent_id" gorm:"type:uuid;not null"`
	OriginatorCustomerID    *string                `json:"originator_customer_id" gorm:"type:uuid"`
	BeneficiaryAgentID      *string                `json:"beneficiary_agent_id" gorm:"type:uuid"`
	BeneficiaryCustomerID   *string                `json:"beneficiary_customer_id" gorm:"type:uuid"`
	TransactionAmount       float64                `json:"transaction_amount" gorm:"type:decimal(15,2);not null"`
	TransactionCurrency     string                 `json:"transaction_currency" gorm:"type:varchar(3);not null;default:'USD'"`
	FeeAmount               float64                `json:"fee_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	CommissionAmount        float64                `json:"commission_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	TaxAmount               float64                `json:"tax_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	TotalAmount             float64                `json:"total_amount" gorm:"type:decimal(15,2);not null"`
	ExchangeRate            *float64               `json:"exchange_rate" gorm:"type:decimal(10,6)"`
	BaseCurrency            *string                `json:"base_currency" gorm:"type:varchar(3)"`
	ConvertedAmount         *float64               `json:"converted_amount" gorm:"type:decimal(15,2)"`
	Channel                 string                 `json:"channel" gorm:"type:varchar(30);not null;default:'agent_app'"`
	DeviceID                *string                `json:"device_id" gorm:"type:varchar(255)"`
	DeviceFingerprint       *string                `json:"device_fingerprint" gorm:"type:text"`
	IPAddress               *string                `json:"ip_address" gorm:"type:varchar(45)"`
	GeolocationLatitude     *float64               `json:"geolocation_latitude" gorm:"type:decimal(10,8)"`
	GeolocationLongitude    *float64               `json:"geolocation_longitude" gorm:"type:decimal(11,8)"`
	ProcessingNode          *string                `json:"processing_node" gorm:"type:varchar(100)"`
	ProcessingTimeMs        *int                   `json:"processing_time_ms"`
	RetryCount              int                    `json:"retry_count" gorm:"default:0"`
	MaxRetries              int                    `json:"max_retries" gorm:"default:3"`
	FraudScore              float64                `json:"fraud_score" gorm:"type:decimal(5,2);default:0.00"`
	RiskLevel               string                 `json:"risk_level" gorm:"type:varchar(20);default:'low'"`
	FraudFlags              pq.StringArray         `json:"fraud_flags" gorm:"type:text[]"`
	SettlementBatchID       *string                `json:"settlement_batch_id" gorm:"type:uuid"`
	SettlementDate          *time.Time             `json:"settlement_date" gorm:"type:date"`
	SettlementStatus        string                 `json:"settlement_status" gorm:"type:varchar(30);default:'pending'"`
	InitiatedAt             time.Time              `json:"initiated_at" gorm:"not null;default:CURRENT_TIMESTAMP"`
	ProcessedAt             *time.Time             `json:"processed_at"`
	CompletedAt             *time.Time             `json:"completed_at"`
	ExpiresAt               *time.Time             `json:"expires_at"`
	CreatedBy               *string                `json:"created_by" gorm:"type:uuid"`
	UpdatedBy               *string                `json:"updated_by" gorm:"type:uuid"`
	CreatedAt               time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type TransactionStateHistory struct {
	ID              string             `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionID   string             `json:"transaction_id" gorm:"type:uuid;not null"`
	PreviousStatus  *TransactionStatus `json:"previous_status"`
	NewStatus       TransactionStatus  `json:"new_status" gorm:"not null"`
	Reason          *string            `json:"reason" gorm:"type:varchar(255)"`
	ErrorCode       *string            `json:"error_code" gorm:"type:varchar(50)"`
	ErrorMessage    *string            `json:"error_message" gorm:"type:text"`
	ChangedBy       *string            `json:"changed_by" gorm:"type:uuid"`
	ChangedAt       time.Time          `json:"changed_at" gorm:"not null;default:CURRENT_TIMESTAMP"`
	Metadata        map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type TransactionFeeRule struct {
	ID                   string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	RuleName             string                 `json:"rule_name" gorm:"type:varchar(100);not null"`
	TransactionType      TransactionType        `json:"transaction_type" gorm:"type:varchar(30);not null"`
	AgentTier            *string                `json:"agent_tier" gorm:"type:varchar(20)"`
	CustomerTier         *string                `json:"customer_tier" gorm:"type:varchar(20)"`
	MinAmount            float64                `json:"min_amount" gorm:"type:decimal(15,2);default:0.00"`
	MaxAmount            *float64               `json:"max_amount" gorm:"type:decimal(15,2)"`
	FixedFee             float64                `json:"fixed_fee" gorm:"type:decimal(15,2);default:0.00"`
	PercentageFee        float64                `json:"percentage_fee" gorm:"type:decimal(5,4);default:0.0000"`
	MinimumFee           float64                `json:"minimum_fee" gorm:"type:decimal(15,2);default:0.00"`
	MaximumFee           *float64               `json:"maximum_fee" gorm:"type:decimal(15,2)"`
	ApplicableCountries  pq.StringArray         `json:"applicable_countries" gorm:"type:text[]"`
	ApplicableRegions    pq.StringArray         `json:"applicable_regions" gorm:"type:text[]"`
	EffectiveFrom        time.Time              `json:"effective_from" gorm:"not null;default:CURRENT_TIMESTAMP"`
	EffectiveTo          *time.Time             `json:"effective_to"`
	IsActive             bool                   `json:"is_active" gorm:"not null;default:true"`
	CreatedBy            string                 `json:"created_by" gorm:"type:uuid;not null"`
	UpdatedBy            *string                `json:"updated_by" gorm:"type:uuid"`
	CreatedAt            time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt            time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata             map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type SettlementBatchStatus string

const (
	SettlementPending            SettlementBatchStatus = "pending"
	SettlementProcessing         SettlementBatchStatus = "processing"
	SettlementCompleted          SettlementBatchStatus = "completed"
	SettlementFailed             SettlementBatchStatus = "failed"
	SettlementCancelled          SettlementBatchStatus = "cancelled"
	SettlementPartiallyCompleted SettlementBatchStatus = "partially_completed"
)

type SettlementBatch struct {
	ID                        string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	BatchReference            string                 `json:"batch_reference" gorm:"type:varchar(50);unique;not null"`
	BatchType                 string                 `json:"batch_type" gorm:"type:varchar(30);not null"`
	SettlementDate            time.Time              `json:"settlement_date" gorm:"type:date;not null"`
	CutOffTime                time.Time              `json:"cut_off_time" gorm:"not null"`
	Status                    SettlementBatchStatus  `json:"status" gorm:"type:varchar(30);not null;default:'pending'"`
	TotalTransactions         int                    `json:"total_transactions" gorm:"not null;default:0"`
	TotalAmount               float64                `json:"total_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	TotalFees                 float64                `json:"total_fees" gorm:"type:decimal(15,2);not null;default:0.00"`
	TotalCommissions          float64                `json:"total_commissions" gorm:"type:decimal(15,2);not null;default:0.00"`
	NetSettlementAmount       float64                `json:"net_settlement_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	ProcessingStartedAt       *time.Time             `json:"processing_started_at"`
	ProcessingCompletedAt     *time.Time             `json:"processing_completed_at"`
	ProcessingDurationSeconds *int                   `json:"processing_duration_seconds"`
	BankBatchReference        *string                `json:"bank_batch_reference" gorm:"type:varchar(100)"`
	BankConfirmationReference *string                `json:"bank_confirmation_reference" gorm:"type:varchar(100)"`
	BankStatus                *string                `json:"bank_status" gorm:"type:varchar(30)"`
	BankResponseCode          *string                `json:"bank_response_code" gorm:"type:varchar(10)"`
	BankResponseMessage       *string                `json:"bank_response_message" gorm:"type:text"`
	CreatedBy                 string                 `json:"created_by" gorm:"type:uuid;not null"`
	UpdatedBy                 *string                `json:"updated_by" gorm:"type:uuid"`
	CreatedAt                 time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt                 time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                  map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type SettlementEntry struct {
	ID                      string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	SettlementBatchID       string                 `json:"settlement_batch_id" gorm:"type:uuid;not null"`
	AgentID                 string                 `json:"agent_id" gorm:"type:uuid;not null"`
	EntryReference          string                 `json:"entry_reference" gorm:"type:varchar(50);not null"`
	SettlementType          string                 `json:"settlement_type" gorm:"type:varchar(30);not null"`
	TransactionCount        int                    `json:"transaction_count" gorm:"not null;default:0"`
	GrossTransactionAmount  float64                `json:"gross_transaction_amount" gorm:"type:decimal(15,2);not null;default:0.00"`
	TotalFeesCollected      float64                `json:"total_fees_collected" gorm:"type:decimal(15,2);not null;default:0.00"`
	TotalCommissionsEarned  float64                `json:"total_commissions_earned" gorm:"type:decimal(15,2);not null;default:0.00"`
	NetSettlementAmount     float64                `json:"net_settlement_amount" gorm:"type:decimal(15,2);not null"`
	AgentAccountNumber      *string                `json:"agent_account_number" gorm:"type:varchar(50)"`
	PartnerBankCode           *string                `json:"partner_bank_code" gorm:"type:varchar(20)"`
	PartnerBankName           *string                `json:"partner_bank_name" gorm:"type:varchar(100)"`
	Status                  string                 `json:"status" gorm:"type:varchar(30);not null;default:'pending'"`
	ProcessedAt             *time.Time             `json:"processed_at"`
	BankTransactionReference *string               `json:"bank_transaction_reference" gorm:"type:varchar(100)"`
	BankStatus              *string                `json:"bank_status" gorm:"type:varchar(30)"`
	BankResponseCode        *string                `json:"bank_response_code" gorm:"type:varchar(10)"`
	BankResponseMessage     *string                `json:"bank_response_message" gorm:"type:text"`
	CreatedAt               time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Metadata                map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

type AgentCashPosition struct {
	ID                      string    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID                 string    `json:"agent_id" gorm:"type:uuid;not null"`
	Currency                string    `json:"currency" gorm:"type:varchar(3);not null;default:'USD'"`
	OpeningBalance          float64   `json:"opening_balance" gorm:"type:decimal(15,2);not null;default:0.00"`
	CurrentBalance          float64   `json:"current_balance" gorm:"type:decimal(15,2);not null;default:0.00"`
	AvailableBalance        float64   `json:"available_balance" gorm:"type:decimal(15,2);not null;default:0.00"`
	ReservedBalance         float64   `json:"reserved_balance" gorm:"type:decimal(15,2);not null;default:0.00"`
	MinimumBalance          float64   `json:"minimum_balance" gorm:"type:decimal(15,2);not null;default:0.00"`
	MaximumBalance          *float64  `json:"maximum_balance" gorm:"type:decimal(15,2)"`
	DailyTransactionLimit   *float64  `json:"daily_transaction_limit" gorm:"type:decimal(15,2)"`
	MonthlyTransactionLimit *float64  `json:"monthly_transaction_limit" gorm:"type:decimal(15,2)"`
	FloatRequestThreshold   *float64  `json:"float_request_threshold" gorm:"type:decimal(15,2)"`
	AutoFloatEnabled        bool      `json:"auto_float_enabled" gorm:"not null;default:false"`
	PreferredFloatAmount    *float64  `json:"preferred_float_amount" gorm:"type:decimal(15,2)"`
	LastTransactionID       *string   `json:"last_transaction_id" gorm:"type:uuid"`
	LastUpdatedAt           time.Time `json:"last_updated_at" gorm:"not null;default:CURRENT_TIMESTAMP"`
	CreatedAt               time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

type CashMovement struct {
	ID                string                 `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	AgentID           string                 `json:"agent_id" gorm:"type:uuid;not null"`
	TransactionID     *string                `json:"transaction_id" gorm:"type:uuid"`
	MovementReference string                 `json:"movement_reference" gorm:"type:varchar(50);unique;not null"`
	MovementType      string                 `json:"movement_type" gorm:"type:varchar(30);not null"`
	MovementCategory  string                 `json:"movement_category" gorm:"type:varchar(50);not null"`
	Amount            float64                `json:"amount" gorm:"type:decimal(15,2);not null"`
	Currency          string                 `json:"currency" gorm:"type:varchar(3);not null;default:'USD'"`
	BalanceBefore     float64                `json:"balance_before" gorm:"type:decimal(15,2);not null"`
	BalanceAfter      float64                `json:"balance_after" gorm:"type:decimal(15,2);not null"`
	Description       *string                `json:"description" gorm:"type:text"`
	ExternalReference *string                `json:"external_reference" gorm:"type:varchar(100)"`
	MovementDate      time.Time              `json:"movement_date" gorm:"type:date;not null;default:CURRENT_DATE"`
	CreatedAt         time.Time              `json:"created_at" gorm:"autoCreateTime"`
	Metadata          map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
}

// =====================================================
// REQUEST/RESPONSE MODELS
// =====================================================

type CreateTransactionRequest struct {
	TransactionType       TransactionType        `json:"transaction_type" binding:"required"`
	OriginatorAgentID     string                 `json:"originator_agent_id" binding:"required"`
	OriginatorCustomerID  *string                `json:"originator_customer_id"`
	BeneficiaryAgentID    *string                `json:"beneficiary_agent_id"`
	BeneficiaryCustomerID *string                `json:"beneficiary_customer_id"`
	TransactionAmount     float64                `json:"transaction_amount" binding:"required,gt=0"`
	TransactionCurrency   string                 `json:"transaction_currency"`
	ExternalReference     *string                `json:"external_reference"`
	Priority              TransactionPriority    `json:"priority"`
	Channel               string                 `json:"channel"`
	DeviceID              *string                `json:"device_id"`
	IPAddress             *string                `json:"ip_address"`
	Latitude              *float64               `json:"latitude"`
	Longitude             *float64               `json:"longitude"`
	CreatedBy             *string                `json:"created_by"`
	Metadata              map[string]interface{} `json:"metadata"`
}

type UpdateTransactionStatusRequest struct {
	Status       TransactionStatus `json:"status" binding:"required"`
	Reason       *string           `json:"reason"`
	ErrorCode    *string           `json:"error_code"`
	ErrorMessage *string           `json:"error_message"`
	UpdatedBy    *string           `json:"updated_by"`
}

type TransactionResponse struct {
	ID                   string            `json:"id"`
	TransactionReference string            `json:"transaction_reference"`
	TransactionType      TransactionType   `json:"transaction_type"`
	TransactionStatus    TransactionStatus `json:"transaction_status"`
	TransactionAmount    float64           `json:"transaction_amount"`
	FeeAmount            float64           `json:"fee_amount"`
	CommissionAmount     float64           `json:"commission_amount"`
	TotalAmount          float64           `json:"total_amount"`
	Message              string            `json:"message"`
	CreatedAt            time.Time         `json:"created_at"`
}

type CreateSettlementBatchRequest struct {
	BatchType      string    `json:"batch_type" binding:"required"`
	SettlementDate time.Time `json:"settlement_date" binding:"required"`
	CutOffTime     time.Time `json:"cut_off_time" binding:"required"`
	CreatedBy      string    `json:"created_by" binding:"required"`
}

type SettlementBatchResponse struct {
	ID                  string                `json:"id"`
	BatchReference      string                `json:"batch_reference"`
	BatchType           string                `json:"batch_type"`
	SettlementDate      time.Time             `json:"settlement_date"`
	Status              SettlementBatchStatus `json:"status"`
	TotalTransactions   int                   `json:"total_transactions"`
	TotalAmount         float64               `json:"total_amount"`
	NetSettlementAmount float64               `json:"net_settlement_amount"`
	Message             string                `json:"message"`
	CreatedAt           time.Time             `json:"created_at"`
}

type CashPositionResponse struct {
	AgentID          string  `json:"agent_id"`
	Currency         string  `json:"currency"`
	CurrentBalance   float64 `json:"current_balance"`
	AvailableBalance float64 `json:"available_balance"`
	ReservedBalance  float64 `json:"reserved_balance"`
	MinimumBalance   float64 `json:"minimum_balance"`
	LastUpdatedAt    time.Time `json:"last_updated_at"`
}

type ListTransactionsResponse struct {
	Data       []NetworkTransaction `json:"data"`
	Total      int64                `json:"total"`
	Page       int                  `json:"page"`
	Limit      int                  `json:"limit"`
	TotalPages int                  `json:"total_pages"`
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
		&NetworkTransaction{},
		&TransactionStateHistory{},
		&TransactionFeeRule{},
		&SettlementBatch{},
		&SettlementEntry{},
		&AgentCashPosition{},
		&CashMovement{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return &DatabaseService{db: db}, nil
}

// =====================================================
// TRANSACTION SERVICE
// =====================================================

type TransactionService struct {
	db *DatabaseService
}

func NewTransactionService(db *DatabaseService) *TransactionService {
	return &TransactionService{db: db}
}

func (ts *TransactionService) CreateTransaction(req *CreateTransactionRequest) (*TransactionResponse, error) {
	// Generate transaction reference
	transactionRef := fmt.Sprintf("TXN-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:8]))

	// Calculate fees and commissions
	feeAmount := ts.calculateTransactionFee(req.TransactionType, req.TransactionAmount, "", "")
	commissionAmount := ts.calculateCommission(req.TransactionType, req.TransactionAmount, "")
	totalAmount := req.TransactionAmount + feeAmount

	// Create transaction record
	transaction := &NetworkTransaction{
		ID:                    uuid.New().String(),
		TransactionReference:  transactionRef,
		ExternalReference:     req.ExternalReference,
		TransactionType:       req.TransactionType,
		TransactionStatus:     Initiated,
		Priority:              getTransactionPriorityOrDefault(req.Priority, Normal),
		OriginatorAgentID:     req.OriginatorAgentID,
		OriginatorCustomerID:  req.OriginatorCustomerID,
		BeneficiaryAgentID:    req.BeneficiaryAgentID,
		BeneficiaryCustomerID: req.BeneficiaryCustomerID,
		TransactionAmount:     req.TransactionAmount,
		TransactionCurrency:   getStringOrDefault(req.TransactionCurrency, "USD"),
		FeeAmount:             feeAmount,
		CommissionAmount:      commissionAmount,
		TaxAmount:             0.0, // Calculate tax if needed
		TotalAmount:           totalAmount,
		Channel:               getStringOrDefault(req.Channel, "agent_app"),
		DeviceID:              req.DeviceID,
		IPAddress:             req.IPAddress,
		GeolocationLatitude:   req.Latitude,
		GeolocationLongitude:  req.Longitude,
		ProcessingNode:        getHostname(),
		InitiatedAt:           time.Now(),
		ExpiresAt:             timePtr(time.Now().Add(24 * time.Hour)), // 24 hour expiry
		CreatedBy:             req.CreatedBy,
		Metadata:              req.Metadata,
	}

	err := ts.db.db.Create(transaction).Error
	if err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	// Create initial state history
	stateHistory := &TransactionStateHistory{
		ID:            uuid.New().String(),
		TransactionID: transaction.ID,
		NewStatus:     Initiated,
		Reason:        stringPtr("Transaction initiated"),
		ChangedBy:     req.CreatedBy,
		ChangedAt:     time.Now(),
	}

	err = ts.db.db.Create(stateHistory).Error
	if err != nil {
		log.Printf("Failed to create state history: %v", err)
	}

	// Update agent cash position (reserve funds for debit transactions)
	if ts.isDebitTransaction(req.TransactionType) {
		err = ts.reserveAgentFunds(req.OriginatorAgentID, req.TransactionAmount, transaction.ID)
		if err != nil {
			// Update transaction status to failed
			ts.UpdateTransactionStatus(transaction.ID, &UpdateTransactionStatusRequest{
				Status:       Failed,
				Reason:       stringPtr("Insufficient funds"),
				ErrorCode:    stringPtr("INSUFFICIENT_FUNDS"),
				ErrorMessage: stringPtr(err.Error()),
			})
			return nil, fmt.Errorf("insufficient funds: %w", err)
		}
	}

	return &TransactionResponse{
		ID:                   transaction.ID,
		TransactionReference: transaction.TransactionReference,
		TransactionType:      transaction.TransactionType,
		TransactionStatus:    transaction.TransactionStatus,
		TransactionAmount:    transaction.TransactionAmount,
		FeeAmount:            transaction.FeeAmount,
		CommissionAmount:     transaction.CommissionAmount,
		TotalAmount:          transaction.TotalAmount,
		Message:              "Transaction created successfully",
		CreatedAt:            transaction.CreatedAt,
	}, nil
}

func (ts *TransactionService) UpdateTransactionStatus(id string, req *UpdateTransactionStatusRequest) (*TransactionResponse, error) {
	var transaction NetworkTransaction
	err := ts.db.db.Where("id = ?", id).First(&transaction).Error
	if err != nil {
		return nil, fmt.Errorf("transaction not found: %w", err)
	}

	previousStatus := transaction.TransactionStatus
	transaction.TransactionStatus = req.Status
	transaction.UpdatedBy = req.UpdatedBy

	// Set completion timestamp if completed
	if req.Status == Completed {
		transaction.CompletedAt = timePtr(time.Now())
		transaction.ProcessedAt = timePtr(time.Now())
	} else if req.Status == Failed || req.Status == Cancelled {
		transaction.ProcessedAt = timePtr(time.Now())
	}

	err = ts.db.db.Save(&transaction).Error
	if err != nil {
		return nil, fmt.Errorf("failed to update transaction: %w", err)
	}

	// Create state history
	stateHistory := &TransactionStateHistory{
		ID:            uuid.New().String(),
		TransactionID: transaction.ID,
		PreviousStatus: &previousStatus,
		NewStatus:     req.Status,
		Reason:        req.Reason,
		ErrorCode:     req.ErrorCode,
		ErrorMessage:  req.ErrorMessage,
		ChangedBy:     req.UpdatedBy,
		ChangedAt:     time.Now(),
	}

	err = ts.db.db.Create(stateHistory).Error
	if err != nil {
		log.Printf("Failed to create state history: %v", err)
	}

	// Handle cash position updates based on status
	if req.Status == Completed {
		err = ts.completeTransactionCashMovement(&transaction)
		if err != nil {
			log.Printf("Failed to complete cash movement: %v", err)
		}
	} else if req.Status == Failed || req.Status == Cancelled {
		err = ts.releaseReservedFunds(&transaction)
		if err != nil {
			log.Printf("Failed to release reserved funds: %v", err)
		}
	}

	return &TransactionResponse{
		ID:                   transaction.ID,
		TransactionReference: transaction.TransactionReference,
		TransactionType:      transaction.TransactionType,
		TransactionStatus:    transaction.TransactionStatus,
		TransactionAmount:    transaction.TransactionAmount,
		FeeAmount:            transaction.FeeAmount,
		CommissionAmount:     transaction.CommissionAmount,
		TotalAmount:          transaction.TotalAmount,
		Message:              fmt.Sprintf("Transaction status updated to %s", req.Status),
		CreatedAt:            transaction.CreatedAt,
	}, nil
}

func (ts *TransactionService) GetTransaction(id string) (*NetworkTransaction, error) {
	var transaction NetworkTransaction
	err := ts.db.db.Where("id = ?", id).First(&transaction).Error
	if err != nil {
		return nil, fmt.Errorf("transaction not found: %w", err)
	}
	return &transaction, nil
}

func (ts *TransactionService) ListTransactions(filters map[string]interface{}, page, limit int) (*ListTransactionsResponse, error) {
	var transactions []NetworkTransaction
	var total int64

	query := ts.db.db.Model(&NetworkTransaction{})

	// Apply filters
	if status, ok := filters["status"]; ok {
		query = query.Where("transaction_status = ?", status)
	}
	if transactionType, ok := filters["type"]; ok {
		query = query.Where("transaction_type = ?", transactionType)
	}
	if agentID, ok := filters["agent_id"]; ok {
		query = query.Where("originator_agent_id = ? OR beneficiary_agent_id = ?", agentID, agentID)
	}
	if fromDate, ok := filters["from_date"]; ok {
		query = query.Where("initiated_at >= ?", fromDate)
	}
	if toDate, ok := filters["to_date"]; ok {
		query = query.Where("initiated_at <= ?", toDate)
	}

	// Count total records
	query.Count(&total)

	// Apply pagination
	offset := (page - 1) * limit
	err := query.Offset(offset).Limit(limit).Order("initiated_at DESC").Find(&transactions).Error
	if err != nil {
		return nil, err
	}

	totalPages := int((total + int64(limit) - 1) / int64(limit))

	return &ListTransactionsResponse{
		Data:       transactions,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}, nil
}

func (ts *TransactionService) calculateTransactionFee(transactionType TransactionType, amount float64, agentTier, customerTier string) float64 {
	// Simple fee calculation - in production, this would query fee rules
	feeRates := map[TransactionType]float64{
		CashIn:            0.005, // 0.5%
		CashOut:           0.01,  // 1.0%
		Transfer:          0.0025, // 0.25%
		BillPayment:       0.0075, // 0.75%
		AirtimePurchase:   0.005,  // 0.5%
		DataPurchase:      0.005,  // 0.5%
		MerchantPayment:   0.0025, // 0.25%
	}

	rate, exists := feeRates[transactionType]
	if !exists {
		rate = 0.005 // Default 0.5%
	}

	fee := amount * rate
	
	// Apply minimum and maximum limits
	minFee := 0.10
	maxFee := 10.00

	if fee < minFee {
		fee = minFee
	}
	if fee > maxFee {
		fee = maxFee
	}

	return math.Round(fee*100) / 100 // Round to 2 decimal places
}

func (ts *TransactionService) calculateCommission(transactionType TransactionType, amount float64, agentTier string) float64 {
	// Simple commission calculation - in production, this would query commission rules
	commissionRates := map[TransactionType]float64{
		CashIn:            0.0025, // 0.25%
		CashOut:           0.005,  // 0.5%
		Transfer:          0.0015, // 0.15%
		BillPayment:       0.003,  // 0.3%
		AirtimePurchase:   0.002,  // 0.2%
		DataPurchase:      0.002,  // 0.2%
		MerchantPayment:   0.001,  // 0.1%
	}

	rate, exists := commissionRates[transactionType]
	if !exists {
		rate = 0.002 // Default 0.2%
	}

	commission := amount * rate
	
	// Apply minimum and maximum limits
	minCommission := 0.05
	maxCommission := 5.00

	if commission < minCommission {
		commission = minCommission
	}
	if commission > maxCommission {
		commission = maxCommission
	}

	return math.Round(commission*100) / 100 // Round to 2 decimal places
}

func (ts *TransactionService) isDebitTransaction(transactionType TransactionType) bool {
	debitTypes := []TransactionType{
		CashOut,
		Withdrawal,
		Transfer,
		BillPayment,
		AirtimePurchase,
		DataPurchase,
		MerchantPayment,
	}

	for _, dt := range debitTypes {
		if transactionType == dt {
			return true
		}
	}
	return false
}

func (ts *TransactionService) reserveAgentFunds(agentID string, amount float64, transactionID string) error {
	var cashPosition AgentCashPosition
	err := ts.db.db.Where("agent_id = ? AND currency = ?", agentID, "USD").First(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("agent cash position not found: %w", err)
	}

	if cashPosition.AvailableBalance < amount {
		return fmt.Errorf("insufficient available balance: %.2f < %.2f", cashPosition.AvailableBalance, amount)
	}

	// Update cash position
	cashPosition.AvailableBalance -= amount
	cashPosition.ReservedBalance += amount
	cashPosition.LastTransactionID = &transactionID
	cashPosition.LastUpdatedAt = time.Now()

	err = ts.db.db.Save(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("failed to update cash position: %w", err)
	}

	// Create cash movement record
	movementRef := fmt.Sprintf("RESERVE-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	movement := &CashMovement{
		ID:                uuid.New().String(),
		AgentID:           agentID,
		TransactionID:     &transactionID,
		MovementReference: movementRef,
		MovementType:      "reserve",
		MovementCategory:  "transaction",
		Amount:            amount,
		Currency:          "USD",
		BalanceBefore:     cashPosition.AvailableBalance + amount,
		BalanceAfter:      cashPosition.AvailableBalance,
		Description:       stringPtr("Funds reserved for transaction"),
		MovementDate:      time.Now(),
	}

	err = ts.db.db.Create(movement).Error
	if err != nil {
		return fmt.Errorf("failed to create cash movement: %w", err)
	}

	return nil
}

func (ts *TransactionService) completeTransactionCashMovement(transaction *NetworkTransaction) error {
	// Release reserved funds and complete the transaction
	if ts.isDebitTransaction(transaction.TransactionType) {
		return ts.completeDebitTransaction(transaction)
	} else {
		return ts.completeCreditTransaction(transaction)
	}
}

func (ts *TransactionService) completeDebitTransaction(transaction *NetworkTransaction) error {
	var cashPosition AgentCashPosition
	err := ts.db.db.Where("agent_id = ? AND currency = ?", transaction.OriginatorAgentID, "USD").First(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("agent cash position not found: %w", err)
	}

	// Complete the debit - remove from reserved and current balance
	cashPosition.ReservedBalance -= transaction.TransactionAmount
	cashPosition.CurrentBalance -= transaction.TransactionAmount
	cashPosition.LastTransactionID = &transaction.ID
	cashPosition.LastUpdatedAt = time.Now()

	err = ts.db.db.Save(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("failed to update cash position: %w", err)
	}

	// Create cash movement record
	movementRef := fmt.Sprintf("DEBIT-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	movement := &CashMovement{
		ID:                uuid.New().String(),
		AgentID:           transaction.OriginatorAgentID,
		TransactionID:     &transaction.ID,
		MovementReference: movementRef,
		MovementType:      "debit",
		MovementCategory:  "transaction",
		Amount:            transaction.TransactionAmount,
		Currency:          "USD",
		BalanceBefore:     cashPosition.CurrentBalance + transaction.TransactionAmount,
		BalanceAfter:      cashPosition.CurrentBalance,
		Description:       stringPtr(fmt.Sprintf("Transaction completed: %s", transaction.TransactionReference)),
		MovementDate:      time.Now(),
	}

	return ts.db.db.Create(movement).Error
}

func (ts *TransactionService) completeCreditTransaction(transaction *NetworkTransaction) error {
	agentID := transaction.OriginatorAgentID
	if transaction.BeneficiaryAgentID != nil {
		agentID = *transaction.BeneficiaryAgentID
	}

	var cashPosition AgentCashPosition
	err := ts.db.db.Where("agent_id = ? AND currency = ?", agentID, "USD").First(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("agent cash position not found: %w", err)
	}

	// Complete the credit - add to current and available balance
	cashPosition.CurrentBalance += transaction.TransactionAmount
	cashPosition.AvailableBalance += transaction.TransactionAmount
	cashPosition.LastTransactionID = &transaction.ID
	cashPosition.LastUpdatedAt = time.Now()

	err = ts.db.db.Save(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("failed to update cash position: %w", err)
	}

	// Create cash movement record
	movementRef := fmt.Sprintf("CREDIT-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	movement := &CashMovement{
		ID:                uuid.New().String(),
		AgentID:           agentID,
		TransactionID:     &transaction.ID,
		MovementReference: movementRef,
		MovementType:      "credit",
		MovementCategory:  "transaction",
		Amount:            transaction.TransactionAmount,
		Currency:          "USD",
		BalanceBefore:     cashPosition.CurrentBalance - transaction.TransactionAmount,
		BalanceAfter:      cashPosition.CurrentBalance,
		Description:       stringPtr(fmt.Sprintf("Transaction completed: %s", transaction.TransactionReference)),
		MovementDate:      time.Now(),
	}

	return ts.db.db.Create(movement).Error
}

func (ts *TransactionService) releaseReservedFunds(transaction *NetworkTransaction) error {
	if !ts.isDebitTransaction(transaction.TransactionType) {
		return nil // No reserved funds to release for credit transactions
	}

	var cashPosition AgentCashPosition
	err := ts.db.db.Where("agent_id = ? AND currency = ?", transaction.OriginatorAgentID, "USD").First(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("agent cash position not found: %w", err)
	}

	// Release reserved funds back to available balance
	cashPosition.AvailableBalance += transaction.TransactionAmount
	cashPosition.ReservedBalance -= transaction.TransactionAmount
	cashPosition.LastTransactionID = &transaction.ID
	cashPosition.LastUpdatedAt = time.Now()

	err = ts.db.db.Save(&cashPosition).Error
	if err != nil {
		return fmt.Errorf("failed to update cash position: %w", err)
	}

	// Create cash movement record
	movementRef := fmt.Sprintf("RELEASE-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	movement := &CashMovement{
		ID:                uuid.New().String(),
		AgentID:           transaction.OriginatorAgentID,
		TransactionID:     &transaction.ID,
		MovementReference: movementRef,
		MovementType:      "release",
		MovementCategory:  "transaction",
		Amount:            transaction.TransactionAmount,
		Currency:          "USD",
		BalanceBefore:     cashPosition.AvailableBalance - transaction.TransactionAmount,
		BalanceAfter:      cashPosition.AvailableBalance,
		Description:       stringPtr(fmt.Sprintf("Reserved funds released: %s", transaction.TransactionReference)),
		MovementDate:      time.Now(),
	}

	return ts.db.db.Create(movement).Error
}

// =====================================================
// SETTLEMENT SERVICE
// =====================================================

type SettlementService struct {
	db *DatabaseService
}

func NewSettlementService(db *DatabaseService) *SettlementService {
	return &SettlementService{db: db}
}

func (ss *SettlementService) CreateSettlementBatch(req *CreateSettlementBatchRequest) (*SettlementBatchResponse, error) {
	// Generate batch reference
	batchRef := fmt.Sprintf("SETTLE-%s-%s", 
		req.SettlementDate.Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	// Create settlement batch
	batch := &SettlementBatch{
		ID:             uuid.New().String(),
		BatchReference: batchRef,
		BatchType:      req.BatchType,
		SettlementDate: req.SettlementDate,
		CutOffTime:     req.CutOffTime,
		Status:         SettlementPending,
		CreatedBy:      req.CreatedBy,
	}

	err := ss.db.db.Create(batch).Error
	if err != nil {
		return nil, fmt.Errorf("failed to create settlement batch: %w", err)
	}

	// Calculate settlement entries
	err = ss.calculateSettlementEntries(batch)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate settlement entries: %w", err)
	}

	// Reload batch with updated totals
	err = ss.db.db.Where("id = ?", batch.ID).First(batch).Error
	if err != nil {
		return nil, fmt.Errorf("failed to reload settlement batch: %w", err)
	}

	return &SettlementBatchResponse{
		ID:                  batch.ID,
		BatchReference:      batch.BatchReference,
		BatchType:           batch.BatchType,
		SettlementDate:      batch.SettlementDate,
		Status:              batch.Status,
		TotalTransactions:   batch.TotalTransactions,
		TotalAmount:         batch.TotalAmount,
		NetSettlementAmount: batch.NetSettlementAmount,
		Message:             "Settlement batch created successfully",
		CreatedAt:           batch.CreatedAt,
	}, nil
}

func (ss *SettlementService) calculateSettlementEntries(batch *SettlementBatch) error {
	// Get all completed transactions for settlement
	var transactions []NetworkTransaction
	err := ss.db.db.Where(
		"transaction_status = ? AND completed_at <= ? AND settlement_batch_id IS NULL",
		Completed, batch.CutOffTime,
	).Find(&transactions).Error
	if err != nil {
		return fmt.Errorf("failed to get transactions for settlement: %w", err)
	}

	// Group transactions by agent
	agentTransactions := make(map[string][]NetworkTransaction)
	for _, tx := range transactions {
		agentTransactions[tx.OriginatorAgentID] = append(agentTransactions[tx.OriginatorAgentID], tx)
	}

	var totalTransactions int
	var totalAmount, totalFees, totalCommissions, netSettlement float64

	// Create settlement entries for each agent
	for agentID, agentTxs := range agentTransactions {
		var txCount int
		var grossAmount, feesCollected, commissionsEarned float64

		for _, tx := range agentTxs {
			txCount++
			grossAmount += tx.TransactionAmount
			feesCollected += tx.FeeAmount
			commissionsEarned += tx.CommissionAmount

			// Update transaction with settlement batch ID
			tx.SettlementBatchID = &batch.ID
			tx.SettlementDate = &batch.SettlementDate
			tx.SettlementStatus = "included"
			ss.db.db.Save(&tx)
		}

		netAmount := commissionsEarned - feesCollected

		// Create settlement entry
		entryRef := fmt.Sprintf("ENTRY-%s-%s", 
			batch.SettlementDate.Format("20060102"), 
			strings.ToUpper(uuid.New().String()[:6]))

		entry := &SettlementEntry{
			ID:                     uuid.New().String(),
			SettlementBatchID:      batch.ID,
			AgentID:                agentID,
			EntryReference:         entryRef,
			SettlementType:         "net_settlement",
			TransactionCount:       txCount,
			GrossTransactionAmount: grossAmount,
			TotalFeesCollected:     feesCollected,
			TotalCommissionsEarned: commissionsEarned,
			NetSettlementAmount:    netAmount,
			Status:                 "pending",
		}

		err = ss.db.db.Create(entry).Error
		if err != nil {
			return fmt.Errorf("failed to create settlement entry: %w", err)
		}

		// Update batch totals
		totalTransactions += txCount
		totalAmount += grossAmount
		totalFees += feesCollected
		totalCommissions += commissionsEarned
		netSettlement += netAmount
	}

	// Update batch with totals
	batch.TotalTransactions = totalTransactions
	batch.TotalAmount = totalAmount
	batch.TotalFees = totalFees
	batch.TotalCommissions = totalCommissions
	batch.NetSettlementAmount = netSettlement

	return ss.db.db.Save(batch).Error
}

func (ss *SettlementService) ProcessSettlementBatch(batchID string) error {
	var batch SettlementBatch
	err := ss.db.db.Where("id = ?", batchID).First(&batch).Error
	if err != nil {
		return fmt.Errorf("settlement batch not found: %w", err)
	}

	if batch.Status != SettlementPending {
		return fmt.Errorf("batch is not in pending status: %s", batch.Status)
	}

	// Update batch status to processing
	batch.Status = SettlementProcessing
	batch.ProcessingStartedAt = timePtr(time.Now())
	err = ss.db.db.Save(&batch).Error
	if err != nil {
		return fmt.Errorf("failed to update batch status: %w", err)
	}

	// Get settlement entries
	var entries []SettlementEntry
	err = ss.db.db.Where("settlement_batch_id = ?", batchID).Find(&entries).Error
	if err != nil {
		return fmt.Errorf("failed to get settlement entries: %w", err)
	}

	// Process each entry (simulate bank transfer)
	successCount := 0
	for _, entry := range entries {
		err = ss.processSettlementEntry(&entry)
		if err != nil {
			log.Printf("Failed to process settlement entry %s: %v", entry.ID, err)
			entry.Status = "failed"
			entry.BankResponseMessage = stringPtr(err.Error())
		} else {
			entry.Status = "completed"
			entry.ProcessedAt = timePtr(time.Now())
			successCount++
		}
		ss.db.db.Save(&entry)
	}

	// Update batch status based on results
	if successCount == len(entries) {
		batch.Status = SettlementCompleted
	} else if successCount > 0 {
		batch.Status = SettlementPartiallyCompleted
	} else {
		batch.Status = SettlementFailed
	}

	batch.ProcessingCompletedAt = timePtr(time.Now())
	if batch.ProcessingStartedAt != nil {
		duration := int(time.Since(*batch.ProcessingStartedAt).Seconds())
		batch.ProcessingDurationSeconds = &duration
	}

	return ss.db.db.Save(&batch).Error
}

func (ss *SettlementService) processSettlementEntry(entry *SettlementEntry) error {
	// Simulate bank transfer processing
	// In production, this would integrate with actual banking APIs
	
	// Generate bank transaction reference
	bankRef := fmt.Sprintf("BANK-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:8]))

	entry.BankTransactionReference = &bankRef
	entry.BankStatus = stringPtr("completed")
	entry.BankResponseCode = stringPtr("00")
	entry.BankResponseMessage = stringPtr("Transfer completed successfully")

	return nil
}

func (ss *SettlementService) GetSettlementBatch(id string) (*SettlementBatch, error) {
	var batch SettlementBatch
	err := ss.db.db.Where("id = ?", id).First(&batch).Error
	if err != nil {
		return nil, fmt.Errorf("settlement batch not found: %w", err)
	}
	return &batch, nil
}

// =====================================================
// CASH POSITION SERVICE
// =====================================================

type CashPositionService struct {
	db *DatabaseService
}

func NewCashPositionService(db *DatabaseService) *CashPositionService {
	return &CashPositionService{db: db}
}

func (cps *CashPositionService) GetAgentCashPosition(agentID, currency string) (*CashPositionResponse, error) {
	var position AgentCashPosition
	err := cps.db.db.Where("agent_id = ? AND currency = ?", agentID, currency).First(&position).Error
	if err != nil {
		return nil, fmt.Errorf("cash position not found: %w", err)
	}

	return &CashPositionResponse{
		AgentID:          position.AgentID,
		Currency:         position.Currency,
		CurrentBalance:   position.CurrentBalance,
		AvailableBalance: position.AvailableBalance,
		ReservedBalance:  position.ReservedBalance,
		MinimumBalance:   position.MinimumBalance,
		LastUpdatedAt:    position.LastUpdatedAt,
	}, nil
}

func (cps *CashPositionService) InitializeAgentCashPosition(agentID, currency string, initialBalance float64) error {
	// Check if position already exists
	var existing AgentCashPosition
	err := cps.db.db.Where("agent_id = ? AND currency = ?", agentID, currency).First(&existing).Error
	if err == nil {
		return fmt.Errorf("cash position already exists for agent %s in %s", agentID, currency)
	}

	position := &AgentCashPosition{
		ID:               uuid.New().String(),
		AgentID:          agentID,
		Currency:         currency,
		OpeningBalance:   initialBalance,
		CurrentBalance:   initialBalance,
		AvailableBalance: initialBalance,
		ReservedBalance:  0.0,
		MinimumBalance:   0.0,
		LastUpdatedAt:    time.Now(),
	}

	err = cps.db.db.Create(position).Error
	if err != nil {
		return fmt.Errorf("failed to create cash position: %w", err)
	}

	// Create initial cash movement
	movementRef := fmt.Sprintf("INIT-%s-%s", 
		time.Now().Format("20060102"), 
		strings.ToUpper(uuid.New().String()[:6]))

	movement := &CashMovement{
		ID:                uuid.New().String(),
		AgentID:           agentID,
		MovementReference: movementRef,
		MovementType:      "credit",
		MovementCategory:  "initialization",
		Amount:            initialBalance,
		Currency:          currency,
		BalanceBefore:     0.0,
		BalanceAfter:      initialBalance,
		Description:       stringPtr("Initial cash position setup"),
		MovementDate:      time.Now(),
	}

	return cps.db.db.Create(movement).Error
}

// =====================================================
// HTTP HANDLERS
// =====================================================

type NetworkOperationsHandler struct {
	transactionService  *TransactionService
	settlementService   *SettlementService
	cashPositionService *CashPositionService
}

func NewNetworkOperationsHandler(ts *TransactionService, ss *SettlementService, cps *CashPositionService) *NetworkOperationsHandler {
	return &NetworkOperationsHandler{
		transactionService:  ts,
		settlementService:   ss,
		cashPositionService: cps,
	}
}

func (noh *NetworkOperationsHandler) CreateTransaction(c *gin.Context) {
	var req CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := noh.transactionService.CreateTransaction(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, response)
}

func (noh *NetworkOperationsHandler) UpdateTransactionStatus(c *gin.Context) {
	id := c.Param("id")
	
	var req UpdateTransactionStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := noh.transactionService.UpdateTransactionStatus(id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (noh *NetworkOperationsHandler) GetTransaction(c *gin.Context) {
	id := c.Param("id")

	transaction, err := noh.transactionService.GetTransaction(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, transaction)
}

func (noh *NetworkOperationsHandler) ListTransactions(c *gin.Context) {
	// Parse query parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	filters := make(map[string]interface{})
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}
	if transactionType := c.Query("type"); transactionType != "" {
		filters["type"] = transactionType
	}
	if agentID := c.Query("agent_id"); agentID != "" {
		filters["agent_id"] = agentID
	}
	if fromDate := c.Query("from_date"); fromDate != "" {
		if parsed, err := time.Parse("2006-01-02", fromDate); err == nil {
			filters["from_date"] = parsed
		}
	}
	if toDate := c.Query("to_date"); toDate != "" {
		if parsed, err := time.Parse("2006-01-02", toDate); err == nil {
			filters["to_date"] = parsed
		}
	}

	response, err := noh.transactionService.ListTransactions(filters, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (noh *NetworkOperationsHandler) CreateSettlementBatch(c *gin.Context) {
	var req CreateSettlementBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := noh.settlementService.CreateSettlementBatch(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, response)
}

func (noh *NetworkOperationsHandler) ProcessSettlementBatch(c *gin.Context) {
	id := c.Param("id")

	err := noh.settlementService.ProcessSettlementBatch(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Settlement batch processing initiated"})
}

func (noh *NetworkOperationsHandler) GetSettlementBatch(c *gin.Context) {
	id := c.Param("id")

	batch, err := noh.settlementService.GetSettlementBatch(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, batch)
}

func (noh *NetworkOperationsHandler) GetAgentCashPosition(c *gin.Context) {
	agentID := c.Param("agent_id")
	currency := c.DefaultQuery("currency", "USD")

	position, err := noh.cashPositionService.GetAgentCashPosition(agentID, currency)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, position)
}

func (noh *NetworkOperationsHandler) InitializeAgentCashPosition(c *gin.Context) {
	agentID := c.Param("agent_id")
	
	var req struct {
		Currency       string  `json:"currency" binding:"required"`
		InitialBalance float64 `json:"initial_balance" binding:"required,gte=0"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := noh.cashPositionService.InitializeAgentCashPosition(agentID, req.Currency, req.InitialBalance)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Cash position initialized successfully"})
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
			"service":   "network-operations",
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

func getTransactionPriorityOrDefault(value, defaultValue TransactionPriority) TransactionPriority {
	if value == "" {
		return defaultValue
	}
	return value
}

func timePtr(t time.Time) *time.Time {
	return &t
}

func stringPtr(s string) *string {
	return &s
}

func getHostname() *string {
	hostname, err := os.Hostname()
	if err != nil {
		return stringPtr("unknown")
	}
	return &hostname
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
	transactionService := NewTransactionService(db)
	settlementService := NewSettlementService(db)
	cashPositionService := NewCashPositionService(db)
	
	// Initialize handlers
	handler := NewNetworkOperationsHandler(transactionService, settlementService, cashPositionService)

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
		// Transaction routes
		transactions := v1.Group("/transactions")
		{
			transactions.POST("", handler.CreateTransaction)
			transactions.GET("", handler.ListTransactions)
			transactions.GET("/:id", handler.GetTransaction)
			transactions.PATCH("/:id/status", handler.UpdateTransactionStatus)
		}

		// Settlement routes
		settlements := v1.Group("/settlements")
		{
			settlements.POST("/batches", handler.CreateSettlementBatch)
			settlements.GET("/batches/:id", handler.GetSettlementBatch)
			settlements.POST("/batches/:id/process", handler.ProcessSettlementBatch)
		}

		// Cash position routes
		cashPositions := v1.Group("/cash-positions")
		{
			cashPositions.GET("/agents/:agent_id", handler.GetAgentCashPosition)
			cashPositions.POST("/agents/:agent_id/initialize", handler.InitializeAgentCashPosition)
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

	log.Printf("Network Operations Service started on port %s", config.Port)

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

