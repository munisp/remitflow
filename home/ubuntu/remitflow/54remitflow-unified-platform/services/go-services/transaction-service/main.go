package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	// Standard library
	"crypto/hmac"
	"encoding/base64"
	"io"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"unicode"

	// Third-party packages
	"github.com/gin-gonic/gin"
	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/requestid"
	"github.com/gin-contrib/secure"
	"github.com/go-playground/validator/v10"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"github.com/swaggo/files"
	"github.com/swaggo/gin-swagger"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/time/rate"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	// Monitoring and observability
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/jaeger"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/semconv/v1.17.0"

	// Message queuing
	"github.com/nats-io/nats.go"
	"github.com/rabbitmq/amqp091-go"

	// Configuration management
	"github.com/spf13/viper"

	// HTTP client
	"github.com/go-resty/resty/v2"

	// Nigerian banking specific
	"github.com/nyaruka/phonenumbers"
)

// Application version and build info
var (
	Version   = "2.0.0"
	BuildTime = "2024-01-17T10:00:00Z"
	GitCommit = "abc123def456"
	GoVersion = runtime.Version()
)

// Configuration structure
type Config struct {
	Server struct {
		Host         string        `mapstructure:"host"`
		Port         int           `mapstructure:"port"`
		ReadTimeout  time.Duration `mapstructure:"read_timeout"`
		WriteTimeout time.Duration `mapstructure:"write_timeout"`
		IdleTimeout  time.Duration `mapstructure:"idle_timeout"`
		TLS          struct {
			Enabled  bool   `mapstructure:"enabled"`
			CertFile string `mapstructure:"cert_file"`
			KeyFile  string `mapstructure:"key_file"`
		} `mapstructure:"tls"`
	} `mapstructure:"server"`

	Database struct {
		Host            string        `mapstructure:"host"`
		Port            int           `mapstructure:"port"`
		User            string        `mapstructure:"user"`
		Password        string        `mapstructure:"password"`
		Name            string        `mapstructure:"name"`
		SSLMode         string        `mapstructure:"ssl_mode"`
		MaxOpenConns    int           `mapstructure:"max_open_conns"`
		MaxIdleConns    int           `mapstructure:"max_idle_conns"`
		ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
		ConnMaxIdleTime time.Duration `mapstructure:"conn_max_idle_time"`
	} `mapstructure:"database"`

	Redis struct {
		Host         string        `mapstructure:"host"`
		Port         int           `mapstructure:"port"`
		Password     string        `mapstructure:"password"`
		DB           int           `mapstructure:"db"`
		PoolSize     int           `mapstructure:"pool_size"`
		MinIdleConns int           `mapstructure:"min_idle_conns"`
		DialTimeout  time.Duration `mapstructure:"dial_timeout"`
		ReadTimeout  time.Duration `mapstructure:"read_timeout"`
		WriteTimeout time.Duration `mapstructure:"write_timeout"`
		IdleTimeout  time.Duration `mapstructure:"idle_timeout"`
	} `mapstructure:"redis"`

	JWT struct {
		Secret           string        `mapstructure:"secret"`
		AccessTokenTTL   time.Duration `mapstructure:"access_token_ttl"`
		RefreshTokenTTL  time.Duration `mapstructure:"refresh_token_ttl"`
		Issuer           string        `mapstructure:"issuer"`
		Audience         string        `mapstructure:"audience"`
		SigningMethod    string        `mapstructure:"signing_method"`
		RefreshThreshold time.Duration `mapstructure:"refresh_threshold"`
	} `mapstructure:"jwt"`

	Banking struct {
		NIBSSEndpoint       string            `mapstructure:"nibss_endpoint"`
		NIBSSAPIKey         string            `mapstructure:"nibss_api_key"`
		NIBSSSecretKey      string            `mapstructure:"nibss_secret_key"`
		BankAPIEndpoints    map[string]string `mapstructure:"bank_api_endpoints"`
		BankAPIKeys         map[string]string `mapstructure:"bank_api_keys"`
		DefaultCurrency     string            `mapstructure:"default_currency"`
		MaxTransactionLimit float64           `mapstructure:"max_transaction_limit"`
		MinTransactionLimit float64           `mapstructure:"min_transaction_limit"`
		TransactionFee      float64           `mapstructure:"transaction_fee"`
		CommissionRate      float64           `mapstructure:"commission_rate"`
		SettlementSchedule  string            `mapstructure:"settlement_schedule"`
		SupportedBanks      []string          `mapstructure:"supported_banks"`
	} `mapstructure:"banking"`

	Fraud struct {
		Enabled           bool              `mapstructure:"enabled"`
		ServiceEndpoint   string            `mapstructure:"service_endpoint"`
		APIKey            string            `mapstructure:"api_key"`
		ThresholdScore    float64           `mapstructure:"threshold_score"`
		RiskLimits        map[string]float64 `mapstructure:"risk_limits"`
		VelocityLimits    map[string]int    `mapstructure:"velocity_limits"`
		BlacklistEnabled  bool              `mapstructure:"blacklist_enabled"`
		WhitelistEnabled  bool              `mapstructure:"whitelist_enabled"`
	} `mapstructure:"fraud"`

	Notification struct {
		ServiceEndpoint string `mapstructure:"service_endpoint"`
		APIKey          string `mapstructure:"api_key"`
		EnabledChannels []string `mapstructure:"enabled_channels"`
	} `mapstructure:"notification"`

	RateLimit struct {
		Enabled    bool          `mapstructure:"enabled"`
		RPS        int           `mapstructure:"rps"`
		Burst      int           `mapstructure:"burst"`
		WindowSize time.Duration `mapstructure:"window_size"`
	} `mapstructure:"rate_limit"`

	Monitoring struct {
		Enabled        bool   `mapstructure:"enabled"`
		MetricsPath    string `mapstructure:"metrics_path"`
		HealthPath     string `mapstructure:"health_path"`
		JaegerEndpoint string `mapstructure:"jaeger_endpoint"`
		ServiceName    string `mapstructure:"service_name"`
	} `mapstructure:"monitoring"`

	Messaging struct {
		NATS struct {
			URL       string `mapstructure:"url"`
			Subject   string `mapstructure:"subject"`
			QueueName string `mapstructure:"queue_name"`
		} `mapstructure:"nats"`
		RabbitMQ struct {
			URL          string `mapstructure:"url"`
			Exchange     string `mapstructure:"exchange"`
			ExchangeType string `mapstructure:"exchange_type"`
			QueueName    string `mapstructure:"queue_name"`
			RoutingKey   string `mapstructure:"routing_key"`
		} `mapstructure:"rabbitmq"`
	} `mapstructure:"messaging"`

	Logging struct {
		Level      string `mapstructure:"level"`
		Format     string `mapstructure:"format"`
		Output     string `mapstructure:"output"`
		MaxSize    int    `mapstructure:"max_size"`
		MaxBackups int    `mapstructure:"max_backups"`
		MaxAge     int    `mapstructure:"max_age"`
		Compress   bool   `mapstructure:"compress"`
	} `mapstructure:"logging"`
}

// Transaction models
type Transaction struct {
	ID                    uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Reference             string                 `json:"reference" gorm:"uniqueIndex;not null"`
	ExternalReference     string                 `json:"external_reference,omitempty" gorm:"index"`
	Type                  string                 `json:"type" gorm:"not null" validate:"required,oneof=transfer deposit withdrawal bill_payment airtime_purchase data_purchase"`
	Status                string                 `json:"status" gorm:"default:'pending'" validate:"oneof=pending processing completed failed cancelled reversed"`
	
	// Amount and currency
	Amount                float64                `json:"amount" gorm:"not null" validate:"required,gt=0"`
	Currency              string                 `json:"currency" gorm:"default:'NGN'" validate:"required"`
	Fee                   float64                `json:"fee" gorm:"default:0"`
	Commission            float64                `json:"commission" gorm:"default:0"`
	NetAmount             float64                `json:"net_amount" gorm:"not null"`
	
	// Parties involved
	SenderID              uuid.UUID              `json:"sender_id" gorm:"type:uuid;not null"`
	SenderType            string                 `json:"sender_type" gorm:"not null" validate:"required,oneof=customer agent super_agent"`
	SenderAccountNumber   string                 `json:"sender_account_number,omitempty"`
	SenderBankCode        string                 `json:"sender_bank_code,omitempty"`
	SenderName            string                 `json:"sender_name" gorm:"not null"`
	SenderPhone           string                 `json:"sender_phone,omitempty"`
	
	RecipientID           *uuid.UUID             `json:"recipient_id,omitempty" gorm:"type:uuid"`
	RecipientType         string                 `json:"recipient_type,omitempty" validate:"omitempty,oneof=customer agent super_agent external"`
	RecipientAccountNumber string                `json:"recipient_account_number,omitempty"`
	RecipientBankCode     string                 `json:"recipient_bank_code,omitempty"`
	RecipientBankName     string                 `json:"recipient_bank_name,omitempty"`
	RecipientName         string                 `json:"recipient_name,omitempty"`
	RecipientPhone        string                 `json:"recipient_phone,omitempty"`
	
	// Transaction details
	Description           string                 `json:"description,omitempty"`
	Category              string                 `json:"category,omitempty"`
	Tags                  []string               `json:"tags" gorm:"type:text[]"`
	Metadata              map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	
	// Processing information
	ProcessingStartedAt   *time.Time             `json:"processing_started_at,omitempty"`
	ProcessingCompletedAt *time.Time             `json:"processing_completed_at,omitempty"`
	ProcessingDuration    *time.Duration         `json:"processing_duration,omitempty"`
	ProcessorID           string                 `json:"processor_id,omitempty"`
	ProcessorResponse     map[string]interface{} `json:"processor_response" gorm:"type:jsonb"`
	
	// Fraud and risk assessment
	FraudScore            *float64               `json:"fraud_score,omitempty"`
	RiskLevel             string                 `json:"risk_level,omitempty" validate:"omitempty,oneof=low medium high critical"`
	FraudFlags            []string               `json:"fraud_flags" gorm:"type:text[]"`
	FraudReviewRequired   bool                   `json:"fraud_review_required" gorm:"default:false"`
	FraudReviewedBy       *uuid.UUID             `json:"fraud_reviewed_by,omitempty"`
	FraudReviewedAt       *time.Time             `json:"fraud_reviewed_at,omitempty"`
	FraudReviewNotes      string                 `json:"fraud_review_notes,omitempty"`
	
	// Settlement information
	SettlementStatus      string                 `json:"settlement_status" gorm:"default:'pending'" validate:"oneof=pending processing settled failed"`
	SettlementDate        *time.Time             `json:"settlement_date,omitempty"`
	SettlementReference   string                 `json:"settlement_reference,omitempty"`
	SettlementBatch       string                 `json:"settlement_batch,omitempty"`
	
	// Location and device information
	IPAddress             string                 `json:"ip_address,omitempty"`
	UserAgent             string                 `json:"user_agent,omitempty"`
	DeviceFingerprint     string                 `json:"device_fingerprint,omitempty"`
	Location              map[string]interface{} `json:"location" gorm:"type:jsonb"`
	
	// Audit fields
	CreatedAt             time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt             time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	CreatedBy             *uuid.UUID             `json:"created_by,omitempty"`
	UpdatedBy             *uuid.UUID             `json:"updated_by,omitempty"`
	Version               int                    `json:"version" gorm:"default:1"`
	
	// Relationships
	StatusHistory         []TransactionStatus    `json:"status_history" gorm:"foreignKey:TransactionID"`
	Notifications         []TransactionNotification `json:"notifications" gorm:"foreignKey:TransactionID"`
}

// TransactionStatus represents transaction status changes
type TransactionStatus struct {
	ID            uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionID uuid.UUID              `json:"transaction_id" gorm:"type:uuid;not null"`
	Status        string                 `json:"status" gorm:"not null"`
	PreviousStatus string                `json:"previous_status,omitempty"`
	Reason        string                 `json:"reason,omitempty"`
	Details       map[string]interface{} `json:"details" gorm:"type:jsonb"`
	CreatedAt     time.Time              `json:"created_at" gorm:"autoCreateTime"`
	CreatedBy     *uuid.UUID             `json:"created_by,omitempty"`
}

// TransactionNotification represents notifications sent for transactions
type TransactionNotification struct {
	ID            uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TransactionID uuid.UUID              `json:"transaction_id" gorm:"type:uuid;not null"`
	RecipientID   uuid.UUID              `json:"recipient_id" gorm:"type:uuid;not null"`
	Channel       string                 `json:"channel" gorm:"not null" validate:"required,oneof=sms email push in_app"`
	Type          string                 `json:"type" gorm:"not null" validate:"required,oneof=initiated processing completed failed"`
	Status        string                 `json:"status" gorm:"default:'pending'" validate:"oneof=pending sent delivered failed"`
	Content       map[string]interface{} `json:"content" gorm:"type:jsonb"`
	SentAt        *time.Time             `json:"sent_at,omitempty"`
	DeliveredAt   *time.Time             `json:"delivered_at,omitempty"`
	FailureReason string                 `json:"failure_reason,omitempty"`
	CreatedAt     time.Time              `json:"created_at" gorm:"autoCreateTime"`
}

// TransactionLimit represents user transaction limits
type TransactionLimit struct {
	ID                    uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID                uuid.UUID `json:"user_id" gorm:"type:uuid;not null;uniqueIndex"`
	UserType              string    `json:"user_type" gorm:"not null"`
	DailyLimit            float64   `json:"daily_limit" gorm:"not null"`
	MonthlyLimit          float64   `json:"monthly_limit" gorm:"not null"`
	SingleTransactionLimit float64  `json:"single_transaction_limit" gorm:"not null"`
	DailyCount            int       `json:"daily_count" gorm:"default:0"`
	MonthlyCount          int       `json:"monthly_count" gorm:"default:0"`
	DailyAmount           float64   `json:"daily_amount" gorm:"default:0"`
	MonthlyAmount         float64   `json:"monthly_amount" gorm:"default:0"`
	LastResetDate         time.Time `json:"last_reset_date" gorm:"autoCreateTime"`
	CreatedAt             time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt             time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// TransactionBatch represents batch processing
type TransactionBatch struct {
	ID              uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	BatchNumber     string                 `json:"batch_number" gorm:"uniqueIndex;not null"`
	Type            string                 `json:"type" gorm:"not null" validate:"required,oneof=settlement reconciliation bulk_transfer"`
	Status          string                 `json:"status" gorm:"default:'pending'" validate:"oneof=pending processing completed failed"`
	TotalCount      int                    `json:"total_count" gorm:"default:0"`
	ProcessedCount  int                    `json:"processed_count" gorm:"default:0"`
	SuccessCount    int                    `json:"success_count" gorm:"default:0"`
	FailedCount     int                    `json:"failed_count" gorm:"default:0"`
	TotalAmount     float64                `json:"total_amount" gorm:"default:0"`
	ProcessedAmount float64                `json:"processed_amount" gorm:"default:0"`
	Metadata        map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	StartedAt       *time.Time             `json:"started_at,omitempty"`
	CompletedAt     *time.Time             `json:"completed_at,omitempty"`
	CreatedAt       time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

// Request/Response DTOs
type CreateTransactionRequest struct {
	Type                  string                 `json:"type" validate:"required,oneof=transfer deposit withdrawal bill_payment airtime_purchase data_purchase"`
	Amount                float64                `json:"amount" validate:"required,gt=0"`
	Currency              string                 `json:"currency,omitempty"`
	RecipientAccountNumber string                `json:"recipient_account_number,omitempty"`
	RecipientBankCode     string                 `json:"recipient_bank_code,omitempty"`
	RecipientName         string                 `json:"recipient_name,omitempty"`
	RecipientPhone        string                 `json:"recipient_phone,omitempty"`
	Description           string                 `json:"description,omitempty"`
	Category              string                 `json:"category,omitempty"`
	Tags                  []string               `json:"tags,omitempty"`
	Metadata              map[string]interface{} `json:"metadata,omitempty"`
	PIN                   string                 `json:"pin" validate:"required,len=4,numeric"`
}

type TransactionResponse struct {
	Transaction *Transaction `json:"transaction"`
	Message     string       `json:"message"`
}

type GetTransactionsRequest struct {
	UserID     *uuid.UUID `json:"user_id,omitempty"`
	Type       string     `json:"type,omitempty"`
	Status     string     `json:"status,omitempty"`
	StartDate  string     `json:"start_date,omitempty"`
	EndDate    string     `json:"end_date,omitempty"`
	MinAmount  *float64   `json:"min_amount,omitempty"`
	MaxAmount  *float64   `json:"max_amount,omitempty"`
	Reference  string     `json:"reference,omitempty"`
	Limit      int        `json:"limit,omitempty"`
	Offset     int        `json:"offset,omitempty"`
}

type TransactionStatsResponse struct {
	TotalTransactions    int64   `json:"total_transactions"`
	TotalAmount          float64 `json:"total_amount"`
	SuccessfulTransactions int64 `json:"successful_transactions"`
	FailedTransactions   int64   `json:"failed_transactions"`
	PendingTransactions  int64   `json:"pending_transactions"`
	AverageAmount        float64 `json:"average_amount"`
	TodayTransactions    int64   `json:"today_transactions"`
	TodayAmount          float64 `json:"today_amount"`
	MonthTransactions    int64   `json:"month_transactions"`
	MonthAmount          float64 `json:"month_amount"`
}

type VerifyTransactionRequest struct {
	Reference string `json:"reference" validate:"required"`
	PIN       string `json:"pin" validate:"required,len=4,numeric"`
}

type CancelTransactionRequest struct {
	Reason string `json:"reason,omitempty"`
}

// Service interfaces
type TransactionService interface {
	CreateTransaction(ctx context.Context, userID uuid.UUID, req *CreateTransactionRequest) (*Transaction, error)
	GetTransaction(ctx context.Context, transactionID uuid.UUID) (*Transaction, error)
	GetTransactionByReference(ctx context.Context, reference string) (*Transaction, error)
	GetTransactions(ctx context.Context, req *GetTransactionsRequest) ([]*Transaction, int64, error)
	UpdateTransactionStatus(ctx context.Context, transactionID uuid.UUID, status, reason string) error
	CancelTransaction(ctx context.Context, transactionID uuid.UUID, req *CancelTransactionRequest) error
	VerifyTransaction(ctx context.Context, req *VerifyTransactionRequest) (*Transaction, error)
	GetTransactionStats(ctx context.Context, userID *uuid.UUID, startDate, endDate time.Time) (*TransactionStatsResponse, error)
	ProcessPendingTransactions(ctx context.Context) error
	SettleTransactions(ctx context.Context) error
}

type TransactionRepository interface {
	Create(ctx context.Context, transaction *Transaction) error
	GetByID(ctx context.Context, id uuid.UUID) (*Transaction, error)
	GetByReference(ctx context.Context, reference string) (*Transaction, error)
	Update(ctx context.Context, transaction *Transaction) error
	List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*Transaction, int64, error)
	GetStats(ctx context.Context, filters map[string]interface{}) (*TransactionStatsResponse, error)
	CreateStatusHistory(ctx context.Context, status *TransactionStatus) error
	GetPendingTransactions(ctx context.Context, limit int) ([]*Transaction, error)
	GetTransactionsForSettlement(ctx context.Context, limit int) ([]*Transaction, error)
	UpdateTransactionLimits(ctx context.Context, userID uuid.UUID, amount float64) error
	GetTransactionLimits(ctx context.Context, userID uuid.UUID) (*TransactionLimit, error)
}

type BankingService interface {
	ProcessTransfer(ctx context.Context, transaction *Transaction) error
	VerifyAccountNumber(ctx context.Context, accountNumber, bankCode string) (string, error)
	GetBankList(ctx context.Context) ([]Bank, error)
	CheckBalance(ctx context.Context, userID uuid.UUID) (float64, error)
	ProcessBillPayment(ctx context.Context, transaction *Transaction) error
	ProcessAirtimePurchase(ctx context.Context, transaction *Transaction) error
	ProcessDataPurchase(ctx context.Context, transaction *Transaction) error
}

type FraudService interface {
	AssessTransaction(ctx context.Context, transaction *Transaction) (*FraudAssessment, error)
	CheckBlacklist(ctx context.Context, identifier string) (bool, error)
	CheckVelocityLimits(ctx context.Context, userID uuid.UUID, amount float64) error
	ReportFraud(ctx context.Context, transactionID uuid.UUID, reason string) error
}

type NotificationService interface {
	SendTransactionNotification(ctx context.Context, transaction *Transaction, notificationType string) error
	SendBulkNotifications(ctx context.Context, notifications []TransactionNotification) error
}

// Supporting types
type Bank struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type FraudAssessment struct {
	Score       float64  `json:"score"`
	RiskLevel   string   `json:"risk_level"`
	Flags       []string `json:"flags"`
	ReviewRequired bool  `json:"review_required"`
	Reason      string   `json:"reason,omitempty"`
}

// Prometheus metrics
var (
	transactionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_service_transactions_total",
			Help: "Total number of transactions processed",
		},
		[]string{"type", "status"},
	)

	transactionDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "transaction_service_processing_duration_seconds",
			Help:    "Duration of transaction processing",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"type"},
	)

	transactionAmount = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "transaction_service_amount_ngn",
			Help:    "Transaction amounts in NGN",
			Buckets: []float64{100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000},
		},
		[]string{"type"},
	)

	fraudDetections = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_service_fraud_detections_total",
			Help: "Total number of fraud detections",
		},
		[]string{"risk_level"},
	)

	settlementTransactions = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "transaction_service_settlements_total",
			Help: "Total number of settled transactions",
		},
	)

	requestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_service_requests_total",
			Help: "Total number of requests to transaction service",
		},
		[]string{"method", "endpoint", "status"},
	)

	requestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "transaction_service_request_duration_seconds",
			Help:    "Duration of requests to transaction service",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "endpoint"},
	)
)

// Global variables
var (
	cfg                 *Config
	db                  *gorm.DB
	redisClient         *redis.Client
	logger              *logrus.Logger
	validator           *validator.Validate
	transactionService  TransactionService
	transactionRepo     TransactionRepository
	bankingService      BankingService
	fraudService        FraudService
	notificationService NotificationService
	natsConn            *nats.Conn
	rabbitConn          *amqp091.Connection
	httpClient          *resty.Client
)

// Initialize configuration
func initConfig() error {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath(".")

	// Set default values
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8081)
	viper.SetDefault("server.read_timeout", "30s")
	viper.SetDefault("server.write_timeout", "30s")
	viper.SetDefault("server.idle_timeout", "120s")

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "password")
	viper.SetDefault("database.name", "remittance")
	viper.SetDefault("database.ssl_mode", "disable")
	viper.SetDefault("database.max_open_conns", 25)
	viper.SetDefault("database.max_idle_conns", 5)
	viper.SetDefault("database.conn_max_lifetime", "5m")
	viper.SetDefault("database.conn_max_idle_time", "5m")

	viper.SetDefault("redis.host", "localhost")
	viper.SetDefault("redis.port", 6379)
	viper.SetDefault("redis.password", "")
	viper.SetDefault("redis.db", 1)
	viper.SetDefault("redis.pool_size", 10)
	viper.SetDefault("redis.min_idle_conns", 2)

	viper.SetDefault("jwt.secret", "your-secret-key")
	viper.SetDefault("jwt.access_token_ttl", "15m")
	viper.SetDefault("jwt.refresh_token_ttl", "7d")
	viper.SetDefault("jwt.issuer", "remittance-transaction-service")
	viper.SetDefault("jwt.audience", "remittance")

	viper.SetDefault("banking.default_currency", "NGN")
	viper.SetDefault("banking.max_transaction_limit", 5000000.0)
	viper.SetDefault("banking.min_transaction_limit", 100.0)
	viper.SetDefault("banking.transaction_fee", 50.0)
	viper.SetDefault("banking.commission_rate", 0.01)
	viper.SetDefault("banking.settlement_schedule", "daily")

	viper.SetDefault("fraud.enabled", true)
	viper.SetDefault("fraud.threshold_score", 0.7)
	viper.SetDefault("fraud.blacklist_enabled", true)
	viper.SetDefault("fraud.whitelist_enabled", true)

	viper.SetDefault("rate_limit.enabled", true)
	viper.SetDefault("rate_limit.rps", 100)
	viper.SetDefault("rate_limit.burst", 200)

	viper.SetDefault("monitoring.enabled", true)
	viper.SetDefault("monitoring.metrics_path", "/metrics")
	viper.SetDefault("monitoring.health_path", "/health")
	viper.SetDefault("monitoring.service_name", "transaction-service")

	viper.SetDefault("logging.level", "info")
	viper.SetDefault("logging.format", "json")
	viper.SetDefault("logging.output", "stdout")

	// Read environment variables
	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("failed to read config file: %w", err)
		}
	}

	cfg = &Config{}
	if err := viper.Unmarshal(cfg); err != nil {
		return fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return nil
}

// Initialize logger
func initLogger() error {
	logger = logrus.New()

	level, err := logrus.ParseLevel(cfg.Logging.Level)
	if err != nil {
		return fmt.Errorf("invalid log level: %w", err)
	}
	logger.SetLevel(level)

	if cfg.Logging.Format == "json" {
		logger.SetFormatter(&logrus.JSONFormatter{
			TimestampFormat: time.RFC3339,
		})
	} else {
		logger.SetFormatter(&logrus.TextFormatter{
			FullTimestamp:   true,
			TimestampFormat: time.RFC3339,
		})
	}

	if cfg.Logging.Output == "stdout" {
		logger.SetOutput(os.Stdout)
	} else if cfg.Logging.Output == "stderr" {
		logger.SetOutput(os.Stderr)
	} else {
		file, err := os.OpenFile(cfg.Logging.Output, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
		if err != nil {
			return fmt.Errorf("failed to open log file: %w", err)
		}
		logger.SetOutput(file)
	}

	return nil
}

// Initialize database
func initDatabase() error {
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.Name,
		cfg.Database.SSLMode,
	)

	var err error
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.New(
			log.New(os.Stdout, "\r\n", log.LstdFlags),
			logger.Config{
				SlowThreshold:             time.Second,
				LogLevel:                  logger.Silent,
				IgnoreRecordNotFoundError: true,
				Colorful:                  false,
			},
		),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to get database instance: %w", err)
	}

	sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.Database.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.Database.ConnMaxIdleTime)

	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Auto migrate
	if err := db.AutoMigrate(
		&Transaction{},
		&TransactionStatus{},
		&TransactionNotification{},
		&TransactionLimit{},
		&TransactionBatch{},
	); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	logger.Info("Database connected and migrated successfully")
	return nil
}

// Initialize Redis
func initRedis() error {
	redisClient = redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
		Password:     cfg.Redis.Password,
		DB:           cfg.Redis.DB,
		PoolSize:     cfg.Redis.PoolSize,
		MinIdleConns: cfg.Redis.MinIdleConns,
		DialTimeout:  cfg.Redis.DialTimeout,
		ReadTimeout:  cfg.Redis.ReadTimeout,
		WriteTimeout: cfg.Redis.WriteTimeout,
		IdleTimeout:  cfg.Redis.IdleTimeout,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	logger.Info("Redis connected successfully")
	return nil
}

// Initialize validator
func initValidator() error {
	validator = validator.New()

	if err := validator.RegisterValidation("numeric", validateNumeric); err != nil {
		return fmt.Errorf("failed to register numeric validator: %w", err)
	}

	return nil
}

func validateNumeric(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}

	for _, char := range value {
		if !unicode.IsDigit(char) {
			return false
		}
	}
	return true
}

// Initialize HTTP client
func initHTTPClient() {
	httpClient = resty.New()
	httpClient.SetTimeout(30 * time.Second)
	httpClient.SetRetryCount(3)
	httpClient.SetRetryWaitTime(1 * time.Second)
	httpClient.SetRetryMaxWaitTime(5 * time.Second)
}

// Initialize tracing
func initTracing() error {
	if !cfg.Monitoring.Enabled || cfg.Monitoring.JaegerEndpoint == "" {
		return nil
	}

	exporter, err := jaeger.New(jaeger.WithCollectorEndpoint(jaeger.WithEndpoint(cfg.Monitoring.JaegerEndpoint)))
	if err != nil {
		return fmt.Errorf("failed to create Jaeger exporter: %w", err)
	}

	tp := trace.NewTracerProvider(
		trace.WithBatcher(exporter),
		trace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(cfg.Monitoring.ServiceName),
			semconv.ServiceVersion(Version),
		)),
	)

	otel.SetTracerProvider(tp)
	logger.Info("Tracing initialized successfully")
	return nil
}

// Initialize messaging
func initMessaging() error {
	if cfg.Messaging.NATS.URL != "" {
		var err error
		natsConn, err = nats.Connect(cfg.Messaging.NATS.URL)
		if err != nil {
			return fmt.Errorf("failed to connect to NATS: %w", err)
		}
		logger.Info("NATS connected successfully")
	}

	if cfg.Messaging.RabbitMQ.URL != "" {
		var err error
		rabbitConn, err = amqp091.Dial(cfg.Messaging.RabbitMQ.URL)
		if err != nil {
			return fmt.Errorf("failed to connect to RabbitMQ: %w", err)
		}
		logger.Info("RabbitMQ connected successfully")
	}

	return nil
}

// JWT utilities
type JWTClaims struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	Permissions []string  `json:"permissions"`
	SessionID   uuid.UUID `json:"session_id"`
	jwt.RegisteredClaims
}

func validateToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(cfg.JWT.Secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// Utility functions
func generateTransactionReference() string {
	timestamp := time.Now().Unix()
	randomBytes := make([]byte, 8)
	rand.Read(randomBytes)
	hash := sha256.Sum256(append([]byte(strconv.FormatInt(timestamp, 10)), randomBytes...))
	return fmt.Sprintf("TXN%s", strings.ToUpper(hex.EncodeToString(hash[:8])))
}

func calculateFee(amount float64, transactionType string) float64 {
	baseFee := cfg.Banking.TransactionFee
	
	switch transactionType {
	case "transfer":
		if amount <= 5000 {
			return 10.0
		} else if amount <= 50000 {
			return 25.0
		} else {
			return 50.0
		}
	case "bill_payment":
		return math.Min(100.0, amount*0.01)
	case "airtime_purchase", "data_purchase":
		return 0.0 // No fee for airtime/data
	default:
		return baseFee
	}
}

func calculateCommission(amount float64, userType string) float64 {
	baseRate := cfg.Banking.CommissionRate
	
	switch userType {
	case "agent":
		return amount * baseRate
	case "super_agent":
		return amount * (baseRate * 1.5)
	default:
		return 0.0
	}
}

// Transaction repository implementation
type transactionRepository struct {
	db *gorm.DB
}

func NewTransactionRepository(db *gorm.DB) TransactionRepository {
	return &transactionRepository{db: db}
}

func (r *transactionRepository) Create(ctx context.Context, transaction *Transaction) error {
	return r.db.WithContext(ctx).Create(transaction).Error
}

func (r *transactionRepository) GetByID(ctx context.Context, id uuid.UUID) (*Transaction, error) {
	var transaction Transaction
	err := r.db.WithContext(ctx).
		Preload("StatusHistory").
		Preload("Notifications").
		Where("id = ?", id).
		First(&transaction).Error
	if err != nil {
		return nil, err
	}
	return &transaction, nil
}

func (r *transactionRepository) GetByReference(ctx context.Context, reference string) (*Transaction, error) {
	var transaction Transaction
	err := r.db.WithContext(ctx).
		Preload("StatusHistory").
		Preload("Notifications").
		Where("reference = ?", reference).
		First(&transaction).Error
	if err != nil {
		return nil, err
	}
	return &transaction, nil
}

func (r *transactionRepository) Update(ctx context.Context, transaction *Transaction) error {
	transaction.UpdatedAt = time.Now()
	transaction.Version++
	return r.db.WithContext(ctx).Save(transaction).Error
}

func (r *transactionRepository) List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*Transaction, int64, error) {
	var transactions []*Transaction
	var total int64

	query := r.db.WithContext(ctx).Model(&Transaction{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "user_id":
			query = query.Where("sender_id = ? OR recipient_id = ?", value, value)
		case "sender_id":
			query = query.Where("sender_id = ?", value)
		case "recipient_id":
			query = query.Where("recipient_id = ?", value)
		case "type":
			query = query.Where("type = ?", value)
		case "status":
			query = query.Where("status = ?", value)
		case "start_date":
			query = query.Where("created_at >= ?", value)
		case "end_date":
			query = query.Where("created_at <= ?", value)
		case "min_amount":
			query = query.Where("amount >= ?", value)
		case "max_amount":
			query = query.Where("amount <= ?", value)
		case "reference":
			query = query.Where("reference ILIKE ?", fmt.Sprintf("%%%s%%", value))
		}
	}

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Get transactions with pagination
	if err := query.
		Preload("StatusHistory").
		Limit(limit).
		Offset(offset).
		Order("created_at DESC").
		Find(&transactions).Error; err != nil {
		return nil, 0, err
	}

	return transactions, total, nil
}

func (r *transactionRepository) GetStats(ctx context.Context, filters map[string]interface{}) (*TransactionStatsResponse, error) {
	var stats TransactionStatsResponse

	query := r.db.WithContext(ctx).Model(&Transaction{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "user_id":
			query = query.Where("sender_id = ? OR recipient_id = ?", value, value)
		case "start_date":
			query = query.Where("created_at >= ?", value)
		case "end_date":
			query = query.Where("created_at <= ?", value)
		}
	}

	// Get total stats
	if err := query.Select("COUNT(*) as total_transactions, COALESCE(SUM(amount), 0) as total_amount, COALESCE(AVG(amount), 0) as average_amount").
		Scan(&stats).Error; err != nil {
		return nil, err
	}

	// Get status-specific stats
	var statusStats []struct {
		Status string
		Count  int64
	}
	if err := query.Select("status, COUNT(*) as count").Group("status").Scan(&statusStats).Error; err != nil {
		return nil, err
	}

	for _, stat := range statusStats {
		switch stat.Status {
		case "completed":
			stats.SuccessfulTransactions = stat.Count
		case "failed":
			stats.FailedTransactions = stat.Count
		case "pending":
			stats.PendingTransactions = stat.Count
		}
	}

	// Get today's stats
	today := time.Now().Truncate(24 * time.Hour)
	if err := query.Where("created_at >= ?", today).
		Select("COUNT(*) as today_transactions, COALESCE(SUM(amount), 0) as today_amount").
		Scan(&stats).Error; err != nil {
		return nil, err
	}

	// Get this month's stats
	monthStart := time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.UTC)
	if err := query.Where("created_at >= ?", monthStart).
		Select("COUNT(*) as month_transactions, COALESCE(SUM(amount), 0) as month_amount").
		Scan(&stats).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}

func (r *transactionRepository) CreateStatusHistory(ctx context.Context, status *TransactionStatus) error {
	return r.db.WithContext(ctx).Create(status).Error
}

func (r *transactionRepository) GetPendingTransactions(ctx context.Context, limit int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.WithContext(ctx).
		Where("status = ?", "pending").
		Order("created_at ASC").
		Limit(limit).
		Find(&transactions).Error
	return transactions, err
}

func (r *transactionRepository) GetTransactionsForSettlement(ctx context.Context, limit int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.WithContext(ctx).
		Where("status = ? AND settlement_status = ?", "completed", "pending").
		Order("created_at ASC").
		Limit(limit).
		Find(&transactions).Error
	return transactions, err
}

func (r *transactionRepository) UpdateTransactionLimits(ctx context.Context, userID uuid.UUID, amount float64) error {
	now := time.Now()
	today := now.Truncate(24 * time.Hour)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var limit TransactionLimit
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&limit).Error
	
	if err == gorm.ErrRecordNotFound {
		// Create new limit record
		limit = TransactionLimit{
			UserID:                  userID,
			UserType:                "customer", // Default, should be updated based on actual user type
			DailyLimit:              100000.0,   // Default limits
			MonthlyLimit:            2000000.0,
			SingleTransactionLimit:  50000.0,
			DailyCount:              1,
			MonthlyCount:            1,
			DailyAmount:             amount,
			MonthlyAmount:           amount,
			LastResetDate:           today,
		}
		return r.db.WithContext(ctx).Create(&limit).Error
	} else if err != nil {
		return err
	}

	// Reset counters if needed
	if limit.LastResetDate.Before(today) {
		limit.DailyCount = 0
		limit.DailyAmount = 0
		limit.LastResetDate = today
	}

	if limit.LastResetDate.Before(monthStart) {
		limit.MonthlyCount = 0
		limit.MonthlyAmount = 0
	}

	// Update counters
	limit.DailyCount++
	limit.MonthlyCount++
	limit.DailyAmount += amount
	limit.MonthlyAmount += amount

	return r.db.WithContext(ctx).Save(&limit).Error
}

func (r *transactionRepository) GetTransactionLimits(ctx context.Context, userID uuid.UUID) (*TransactionLimit, error) {
	var limit TransactionLimit
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&limit).Error
	if err != nil {
		return nil, err
	}
	return &limit, nil
}

// Banking service implementation
type bankingService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewBankingService(httpClient *resty.Client, logger *logrus.Logger) BankingService {
	return &bankingService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *bankingService) ProcessTransfer(ctx context.Context, transaction *Transaction) error {
	// Production NIBSS/Bank transfer processing
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
		"recipient":      transaction.RecipientAccountNumber,
		"bank_code":      transaction.RecipientBankCode,
	}).Info("Processing transfer via NIBSS")

	// Get NIBSS configuration from environment
	nibssBaseURL := os.Getenv("NIBSS_API_URL")
	nibssAPIKey := os.Getenv("NIBSS_API_KEY")
	nibssSecretKey := os.Getenv("NIBSS_SECRET_KEY")

	if nibssBaseURL == "" || nibssAPIKey == "" {
		s.logger.Warn("NIBSS credentials not configured, using fallback processor")
		return s.processFallbackTransfer(ctx, transaction)
	}

	// Generate NIBSS request signature
	timestamp := time.Now().Format("20060102150405")
	signatureData := fmt.Sprintf("%s%s%s%.2f%s",
		nibssAPIKey, transaction.RecipientAccountNumber,
		transaction.RecipientBankCode, transaction.Amount, timestamp)
	signature := generateHMACSHA512(signatureData, nibssSecretKey)

	// Prepare NIBSS transfer request
	nibssRequest := map[string]interface{}{
		"sessionId":            transaction.Reference,
		"nameEnquiryRef":       transaction.ExternalReference,
		"destinationInstitutionCode": transaction.RecipientBankCode,
		"channelCode":          "2", // Internet Banking
		"beneficiaryAccountNumber": transaction.RecipientAccountNumber,
		"beneficiaryAccountName": transaction.RecipientName,
		"beneficiaryBankVerificationNumber": "",
		"beneficiaryKYCLevel":  "1",
		"originatorAccountName": transaction.SenderName,
		"originatorAccountNumber": transaction.SenderAccountNumber,
		"originatorBankVerificationNumber": "",
		"originatorKYCLevel":   "1",
		"transactionLocation":  "6.5244,3.3792", // Lagos coordinates
		"narration":            transaction.Description,
		"paymentReference":     transaction.Reference,
		"amount":               fmt.Sprintf("%.2f", transaction.Amount),
	}

	// Make NIBSS API call with retry logic
	var resp *resty.Response
	var err error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		resp, err = s.httpClient.R().
			SetContext(ctx).
			SetHeader("Content-Type", "application/json").
			SetHeader("Authorization", fmt.Sprintf("Bearer %s", nibssAPIKey)).
			SetHeader("SIGNATURE", signature).
			SetHeader("SIGNATURE_METH", "SHA512").
			SetHeader("Timestamp", timestamp).
			SetBody(nibssRequest).
			Post(nibssBaseURL + "/nibss/nip/fundtransfer")

		if err == nil && resp.StatusCode() == 200 {
			break
		}

		s.logger.WithFields(logrus.Fields{
			"attempt": attempt,
			"error":   err,
			"status":  resp.StatusCode(),
		}).Warn("NIBSS API call failed, retrying")

		time.Sleep(time.Duration(attempt) * time.Second)
	}

	if err != nil {
		s.logger.WithError(err).Error("NIBSS transfer failed after retries")
		return fmt.Errorf("NIBSS transfer failed: %w", err)
	}

	// Parse NIBSS response
	var nibssResponse map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &nibssResponse); err != nil {
		return fmt.Errorf("failed to parse NIBSS response: %w", err)
	}

	responseCode, _ := nibssResponse["responseCode"].(string)
	if responseCode != "00" {
		responseMsg, _ := nibssResponse["responseMessage"].(string)
		return fmt.Errorf("NIBSS transfer rejected: %s - %s", responseCode, responseMsg)
	}

	// Update transaction with processor response
	transaction.ProcessorResponse = map[string]interface{}{
		"processor_id":      "NIBSS_NIP",
		"processor_ref":     nibssResponse["sessionId"],
		"response_code":     responseCode,
		"response_message":  nibssResponse["responseMessage"],
		"processed_at":      time.Now(),
		"nibss_session_id":  nibssResponse["sessionId"],
	}

	return nil
}

func (s *bankingService) processFallbackTransfer(ctx context.Context, transaction *Transaction) error {
	// Fallback processor for development/testing when NIBSS is unavailable
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
	}).Info("Processing transfer via fallback processor")

	// Validate transaction limits
	if transaction.Amount > 5000000 { // 5M NGN limit
		return errors.New("transfer amount exceeds daily limit")
	}

	// Generate processor reference
	processorRef := fmt.Sprintf("FBK-%s-%d", transaction.Reference, time.Now().UnixNano())

	transaction.ProcessorResponse = map[string]interface{}{
		"processor_id":      "FALLBACK_001",
		"processor_ref":     processorRef,
		"response_code":     "00",
		"response_message":  "Transaction successful (fallback)",
		"processed_at":      time.Now(),
		"fallback_mode":     true,
	}

	return nil
}

func generateHMACSHA512(data, key string) string {
	h := hmac.New(sha512.New, []byte(key))
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *bankingService) VerifyAccountNumber(ctx context.Context, accountNumber, bankCode string) (string, error) {
	// Production NIBSS Name Enquiry
	s.logger.WithFields(logrus.Fields{
		"account_number": accountNumber,
		"bank_code":      bankCode,
	}).Info("Verifying account number via NIBSS Name Enquiry")

	nibssBaseURL := os.Getenv("NIBSS_API_URL")
	nibssAPIKey := os.Getenv("NIBSS_API_KEY")
	nibssSecretKey := os.Getenv("NIBSS_SECRET_KEY")

	if nibssBaseURL == "" || nibssAPIKey == "" {
		s.logger.Warn("NIBSS credentials not configured, using fallback verification")
		return s.verifyAccountFallback(ctx, accountNumber, bankCode)
	}

	// Generate signature for NIBSS request
	timestamp := time.Now().Format("20060102150405")
	signatureData := fmt.Sprintf("%s%s%s%s", nibssAPIKey, accountNumber, bankCode, timestamp)
	signature := generateHMACSHA512(signatureData, nibssSecretKey)

	// Prepare name enquiry request
	nameEnquiryRequest := map[string]interface{}{
		"destinationInstitutionCode": bankCode,
		"channelCode":                "2",
		"accountNumber":              accountNumber,
	}

	// Make NIBSS API call with retry
	var resp *resty.Response
	var err error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		resp, err = s.httpClient.R().
			SetContext(ctx).
			SetHeader("Content-Type", "application/json").
			SetHeader("Authorization", fmt.Sprintf("Bearer %s", nibssAPIKey)).
			SetHeader("SIGNATURE", signature).
			SetHeader("Timestamp", timestamp).
			SetBody(nameEnquiryRequest).
			Post(nibssBaseURL + "/nibss/nip/nameenquiry")

		if err == nil && resp.StatusCode() == 200 {
			break
		}

		s.logger.WithFields(logrus.Fields{
			"attempt": attempt,
			"error":   err,
		}).Warn("NIBSS name enquiry failed, retrying")

		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}

	if err != nil {
		return "", fmt.Errorf("NIBSS name enquiry failed: %w", err)
	}

	// Parse response
	var nibssResponse map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &nibssResponse); err != nil {
		return "", fmt.Errorf("failed to parse NIBSS response: %w", err)
	}

	responseCode, _ := nibssResponse["responseCode"].(string)
	if responseCode != "00" {
		return "", fmt.Errorf("account verification failed: %s", nibssResponse["responseMessage"])
	}

	accountName, _ := nibssResponse["accountName"].(string)
	return accountName, nil
}

func (s *bankingService) verifyAccountFallback(ctx context.Context, accountNumber, bankCode string) (string, error) {
	// Fallback verification for development/testing
	s.logger.Info("Using fallback account verification")
	
	// Basic validation
	if len(accountNumber) != 10 {
		return "", errors.New("invalid account number length")
	}
	
	// Return placeholder name for development
	return fmt.Sprintf("Account Holder (%s)", accountNumber[:4]+"****"+accountNumber[8:]), nil
}

func (s *bankingService) GetBankList(ctx context.Context) ([]Bank, error) {
	banks := []Bank{
		{Code: "044", Name: "Access Bank"},
		{Code: "014", Name: "Afribank Nigeria Plc"},
		{Code: "023", Name: "Citibank Nigeria Limited"},
		{Code: "050", Name: "Ecobank Nigeria Plc"},
		{Code: "040", Name: "Equitorial Trust Bank Limited"},
		{Code: "214", Name: "First City Monument Bank Plc"},
		{Code: "011", Name: "First Bank of Nigeria Plc"},
		{Code: "058", Name: "Guaranty Trust Bank Plc"},
		{Code: "030", Name: "Heritage Bank"},
		{Code: "082", Name: "Keystone Bank Limited"},
		{Code: "076", Name: "Polaris Bank"},
		{Code: "101", Name: "Providus Bank"},
		{Code: "221", Name: "Stanbic IBTC Bank Plc"},
		{Code: "068", Name: "Standard Chartered Bank Nigeria Limited"},
		{Code: "232", Name: "Sterling Bank Plc"},
		{Code: "100", Name: "SunTrust Bank Nigeria Limited"},
		{Code: "032", Name: "Union Bank of Nigeria Plc"},
		{Code: "033", Name: "United Bank For Africa Plc"},
		{Code: "215", Name: "Unity Bank Plc"},
		{Code: "035", Name: "Wema Bank Plc"},
		{Code: "057", Name: "Zenith Bank Plc"},
	}

	return banks, nil
}

func (s *bankingService) CheckBalance(ctx context.Context, userID uuid.UUID) (float64, error) {
	// Production balance check via TigerBeetle ledger
	s.logger.WithFields(logrus.Fields{
		"user_id": userID,
	}).Info("Checking balance via TigerBeetle")

	tigerbeetleURL := os.Getenv("TIGERBEETLE_API_URL")
	if tigerbeetleURL == "" {
		s.logger.Warn("TigerBeetle not configured, using fallback balance check")
		return s.checkBalanceFallback(ctx, userID)
	}

	// Query TigerBeetle for account balance
	accountID := userID.String()
	resp, err := s.httpClient.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		Get(fmt.Sprintf("%s/accounts/%s/balance", tigerbeetleURL, accountID))

	if err != nil {
		s.logger.WithError(err).Warn("TigerBeetle balance check failed, using fallback")
		return s.checkBalanceFallback(ctx, userID)
	}

	if resp.StatusCode() != 200 {
		s.logger.WithField("status", resp.StatusCode()).Warn("TigerBeetle returned non-200, using fallback")
		return s.checkBalanceFallback(ctx, userID)
	}

	var balanceResponse struct {
		AccountID       string  `json:"account_id"`
		CreditsPosted   float64 `json:"credits_posted"`
		DebitsPosted    float64 `json:"debits_posted"`
		CreditsPending  float64 `json:"credits_pending"`
		DebitsPending   float64 `json:"debits_pending"`
		AvailableBalance float64 `json:"available_balance"`
	}

	if err := json.Unmarshal(resp.Body(), &balanceResponse); err != nil {
		return 0, fmt.Errorf("failed to parse balance response: %w", err)
	}

	// Available balance = credits - debits - pending debits
	availableBalance := balanceResponse.CreditsPosted - balanceResponse.DebitsPosted - balanceResponse.DebitsPending
	return availableBalance, nil
}

func (s *bankingService) checkBalanceFallback(ctx context.Context, userID uuid.UUID) (float64, error) {
	// Fallback: Query PostgreSQL wallet table
	s.logger.Info("Using fallback balance check from PostgreSQL")
	
	// In production, this would query the wallets table
	// For now, return a reasonable default for development
	return 0, errors.New("balance check requires TigerBeetle or wallet service")
}

func (s *bankingService) ProcessBillPayment(ctx context.Context, transaction *Transaction) error {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
		"biller":         transaction.RecipientName,
	}).Info("Processing bill payment")

	time.Sleep(1 * time.Second)

	transaction.ProcessorResponse = map[string]interface{}{
		"processor_id":      "QUICKTELLER_001",
		"processor_ref":     generateTransactionReference(),
		"response_code":     "00",
		"response_message":  "Bill payment successful",
		"processed_at":      time.Now(),
	}

	return nil
}

func (s *bankingService) ProcessAirtimePurchase(ctx context.Context, transaction *Transaction) error {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
		"phone":          transaction.RecipientPhone,
	}).Info("Processing airtime purchase")

	time.Sleep(500 * time.Millisecond)

	transaction.ProcessorResponse = map[string]interface{}{
		"processor_id":      "MTN_AIRTIME_001",
		"processor_ref":     generateTransactionReference(),
		"response_code":     "00",
		"response_message":  "Airtime purchase successful",
		"processed_at":      time.Now(),
	}

	return nil
}

func (s *bankingService) ProcessDataPurchase(ctx context.Context, transaction *Transaction) error {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
		"phone":          transaction.RecipientPhone,
	}).Info("Processing data purchase")

	time.Sleep(500 * time.Millisecond)

	transaction.ProcessorResponse = map[string]interface{}{
		"processor_id":      "MTN_DATA_001",
		"processor_ref":     generateTransactionReference(),
		"response_code":     "00",
		"response_message":  "Data purchase successful",
		"processed_at":      time.Now(),
	}

	return nil
}

// Fraud service implementation
type fraudService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewFraudService(httpClient *resty.Client, logger *logrus.Logger) FraudService {
	return &fraudService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *fraudService) AssessTransaction(ctx context.Context, transaction *Transaction) (*FraudAssessment, error) {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"amount":         transaction.Amount,
		"sender_id":      transaction.SenderID,
	}).Info("Assessing transaction for fraud")

	// Simulate fraud assessment
	assessment := &FraudAssessment{
		Score:     0.2, // Low risk by default
		RiskLevel: "low",
		Flags:     []string{},
		ReviewRequired: false,
	}

	// Simple rule-based fraud detection
	if transaction.Amount > 500000 {
		assessment.Score += 0.3
		assessment.Flags = append(assessment.Flags, "high_amount")
	}

	// Check for unusual hours (between 11 PM and 6 AM)
	hour := time.Now().Hour()
	if hour >= 23 || hour <= 6 {
		assessment.Score += 0.2
		assessment.Flags = append(assessment.Flags, "unusual_hours")
	}

	// Determine risk level
	if assessment.Score >= 0.7 {
		assessment.RiskLevel = "critical"
		assessment.ReviewRequired = true
	} else if assessment.Score >= 0.5 {
		assessment.RiskLevel = "high"
		assessment.ReviewRequired = true
	} else if assessment.Score >= 0.3 {
		assessment.RiskLevel = "medium"
	}

	// Update metrics
	fraudDetections.WithLabelValues(assessment.RiskLevel).Inc()

	return assessment, nil
}

func (s *fraudService) CheckBlacklist(ctx context.Context, identifier string) (bool, error) {
	// Simulate blacklist check
	blacklistedIdentifiers := []string{
		"08012345678", // Example blacklisted phone
		"1234567890",  // Example blacklisted account
	}

	for _, blacklisted := range blacklistedIdentifiers {
		if identifier == blacklisted {
			return true, nil
		}
	}

	return false, nil
}

func (s *fraudService) CheckVelocityLimits(ctx context.Context, userID uuid.UUID, amount float64) error {
	// Check velocity limits (number of transactions in a time window)
	// This would typically query the database for recent transactions
	
	// Simulate velocity check
	// In real implementation, this would check Redis or database for recent transaction counts
	
	return nil
}

func (s *fraudService) ReportFraud(ctx context.Context, transactionID uuid.UUID, reason string) error {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transactionID,
		"reason":         reason,
	}).Warn("Fraud reported")

	// In real implementation, this would:
	// 1. Update transaction status
	// 2. Add to fraud database
	// 3. Notify fraud team
	// 4. Update user risk profile

	return nil
}

// Notification service implementation
type notificationService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewNotificationService(httpClient *resty.Client, logger *logrus.Logger) NotificationService {
	return &notificationService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *notificationService) SendTransactionNotification(ctx context.Context, transaction *Transaction, notificationType string) error {
	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"type":           notificationType,
		"recipient":      transaction.SenderID,
	}).Info("Sending transaction notification")

	// Create notification record
	notification := &TransactionNotification{
		TransactionID: transaction.ID,
		RecipientID:   transaction.SenderID,
		Channel:       "sms", // Default channel
		Type:          notificationType,
		Status:        "pending",
		Content: map[string]interface{}{
			"message": fmt.Sprintf("Your %s transaction of NGN %.2f has been %s. Ref: %s",
				transaction.Type, transaction.Amount, notificationType, transaction.Reference),
			"amount":    transaction.Amount,
			"reference": transaction.Reference,
			"status":    transaction.Status,
		},
	}

	// Save notification to database
	if err := db.Create(notification).Error; err != nil {
		return fmt.Errorf("failed to create notification record: %w", err)
	}

	// Simulate sending notification
	time.Sleep(100 * time.Millisecond)

	// Update notification status
	notification.Status = "sent"
	now := time.Now()
	notification.SentAt = &now
	notification.DeliveredAt = &now

	if err := db.Save(notification).Error; err != nil {
		s.logger.WithError(err).Error("Failed to update notification status")
	}

	return nil
}

func (s *notificationService) SendBulkNotifications(ctx context.Context, notifications []TransactionNotification) error {
	s.logger.WithField("count", len(notifications)).Info("Sending bulk notifications")

	// Process notifications in batches
	batchSize := 100
	for i := 0; i < len(notifications); i += batchSize {
		end := i + batchSize
		if end > len(notifications) {
			end = len(notifications)
		}

		batch := notifications[i:end]
		
		// Simulate batch processing
		time.Sleep(500 * time.Millisecond)

		// Update all notifications in batch as sent
		for j := range batch {
			batch[j].Status = "sent"
			now := time.Now()
			batch[j].SentAt = &now
			batch[j].DeliveredAt = &now
		}
	}

	return nil
}

// Transaction service implementation
type transactionService struct {
	repo                TransactionRepository
	bankingService      BankingService
	fraudService        FraudService
	notificationService NotificationService
	redisClient         *redis.Client
	logger              *logrus.Logger
}

func NewTransactionService(
	repo TransactionRepository,
	bankingService BankingService,
	fraudService FraudService,
	notificationService NotificationService,
	redisClient *redis.Client,
	logger *logrus.Logger,
) TransactionService {
	return &transactionService{
		repo:                repo,
		bankingService:      bankingService,
		fraudService:        fraudService,
		notificationService: notificationService,
		redisClient:         redisClient,
		logger:              logger,
	}
}

func (s *transactionService) CreateTransaction(ctx context.Context, userID uuid.UUID, req *CreateTransactionRequest) (*Transaction, error) {
	start := time.Now()

	// Validate transaction limits
	limits, err := s.repo.GetTransactionLimits(ctx, userID)
	if err == nil {
		if req.Amount > limits.SingleTransactionLimit {
			return nil, fmt.Errorf("amount exceeds single transaction limit of NGN %.2f", limits.SingleTransactionLimit)
		}
		if limits.DailyAmount+req.Amount > limits.DailyLimit {
			return nil, fmt.Errorf("amount exceeds daily limit of NGN %.2f", limits.DailyLimit)
		}
		if limits.MonthlyAmount+req.Amount > limits.MonthlyLimit {
			return nil, fmt.Errorf("amount exceeds monthly limit of NGN %.2f", limits.MonthlyLimit)
		}
	}

	// Validate minimum/maximum amounts
	if req.Amount < cfg.Banking.MinTransactionLimit {
		return nil, fmt.Errorf("amount below minimum limit of NGN %.2f", cfg.Banking.MinTransactionLimit)
	}
	if req.Amount > cfg.Banking.MaxTransactionLimit {
		return nil, fmt.Errorf("amount exceeds maximum limit of NGN %.2f", cfg.Banking.MaxTransactionLimit)
	}

	// Check balance (simplified)
	balance, err := s.bankingService.CheckBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to check balance: %w", err)
	}

	totalAmount := req.Amount + calculateFee(req.Amount, req.Type)
	if balance < totalAmount {
		return nil, errors.New("insufficient balance")
	}

	// Create transaction
	transaction := &Transaction{
		Reference:             generateTransactionReference(),
		Type:                  req.Type,
		Status:                "pending",
		Amount:                req.Amount,
		Currency:              req.Currency,
		Fee:                   calculateFee(req.Amount, req.Type),
		Commission:            calculateCommission(req.Amount, "customer"), // Default to customer
		NetAmount:             req.Amount - calculateFee(req.Amount, req.Type),
		SenderID:              userID,
		SenderType:            "customer", // Default, should be determined from user context
		SenderName:            "Customer Name", // Should be fetched from user service
		RecipientAccountNumber: req.RecipientAccountNumber,
		RecipientBankCode:     req.RecipientBankCode,
		RecipientName:         req.RecipientName,
		RecipientPhone:        req.RecipientPhone,
		Description:           req.Description,
		Category:              req.Category,
		Tags:                  req.Tags,
		Metadata:              req.Metadata,
		ProcessingStartedAt:   nil,
		ProcessingCompletedAt: nil,
		FraudReviewRequired:   false,
		SettlementStatus:      "pending",
	}

	// Set currency default
	if transaction.Currency == "" {
		transaction.Currency = cfg.Banking.DefaultCurrency
	}

	// Verify recipient account if it's a transfer
	if req.Type == "transfer" && req.RecipientAccountNumber != "" && req.RecipientBankCode != "" {
		accountName, err := s.bankingService.VerifyAccountNumber(ctx, req.RecipientAccountNumber, req.RecipientBankCode)
		if err != nil {
			return nil, fmt.Errorf("failed to verify recipient account: %w", err)
		}
		transaction.RecipientName = accountName
	}

	// Fraud assessment
	if cfg.Fraud.Enabled {
		assessment, err := s.fraudService.AssessTransaction(ctx, transaction)
		if err != nil {
			s.logger.WithError(err).Warn("Fraud assessment failed, proceeding with transaction")
		} else {
			transaction.FraudScore = &assessment.Score
			transaction.RiskLevel = assessment.RiskLevel
			transaction.FraudFlags = assessment.Flags
			transaction.FraudReviewRequired = assessment.ReviewRequired

			if assessment.ReviewRequired {
				transaction.Status = "pending_review"
			}
		}
	}

	// Save transaction
	if err := s.repo.Create(ctx, transaction); err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	// Create status history
	statusHistory := &TransactionStatus{
		TransactionID: transaction.ID,
		Status:        transaction.Status,
		Reason:        "Transaction created",
		Details: map[string]interface{}{
			"created_by": userID,
			"ip_address": "", // Should be extracted from context
		},
	}
	s.repo.CreateStatusHistory(ctx, statusHistory)

	// Update transaction limits
	if err := s.repo.UpdateTransactionLimits(ctx, userID, req.Amount); err != nil {
		s.logger.WithError(err).Error("Failed to update transaction limits")
	}

	// Send notification
	if err := s.notificationService.SendTransactionNotification(ctx, transaction, "initiated"); err != nil {
		s.logger.WithError(err).Error("Failed to send transaction notification")
	}

	// Update metrics
	transactionsTotal.WithLabelValues(transaction.Type, transaction.Status).Inc()
	transactionAmount.WithLabelValues(transaction.Type).Observe(transaction.Amount)
	transactionDuration.WithLabelValues(transaction.Type).Observe(time.Since(start).Seconds())

	s.logger.WithFields(logrus.Fields{
		"transaction_id": transaction.ID,
		"reference":      transaction.Reference,
		"amount":         transaction.Amount,
		"type":           transaction.Type,
		"status":         transaction.Status,
	}).Info("Transaction created successfully")

	return transaction, nil
}

func (s *transactionService) GetTransaction(ctx context.Context, transactionID uuid.UUID) (*Transaction, error) {
	return s.repo.GetByID(ctx, transactionID)
}

func (s *transactionService) GetTransactionByReference(ctx context.Context, reference string) (*Transaction, error) {
	return s.repo.GetByReference(ctx, reference)
}

func (s *transactionService) GetTransactions(ctx context.Context, req *GetTransactionsRequest) ([]*Transaction, int64, error) {
	filters := make(map[string]interface{})

	if req.UserID != nil {
		filters["user_id"] = *req.UserID
	}
	if req.Type != "" {
		filters["type"] = req.Type
	}
	if req.Status != "" {
		filters["status"] = req.Status
	}
	if req.StartDate != "" {
		if startDate, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			filters["start_date"] = startDate
		}
	}
	if req.EndDate != "" {
		if endDate, err := time.Parse("2006-01-02", req.EndDate); err == nil {
			filters["end_date"] = endDate.Add(24 * time.Hour) // Include the entire day
		}
	}
	if req.MinAmount != nil {
		filters["min_amount"] = *req.MinAmount
	}
	if req.MaxAmount != nil {
		filters["max_amount"] = *req.MaxAmount
	}
	if req.Reference != "" {
		filters["reference"] = req.Reference
	}

	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	return s.repo.List(ctx, filters, limit, offset)
}

func (s *transactionService) UpdateTransactionStatus(ctx context.Context, transactionID uuid.UUID, status, reason string) error {
	transaction, err := s.repo.GetByID(ctx, transactionID)
	if err != nil {
		return fmt.Errorf("transaction not found: %w", err)
	}

	previousStatus := transaction.Status
	transaction.Status = status

	// Update processing timestamps
	now := time.Now()
	switch status {
	case "processing":
		transaction.ProcessingStartedAt = &now
	case "completed", "failed":
		if transaction.ProcessingStartedAt != nil {
			duration := now.Sub(*transaction.ProcessingStartedAt)
			transaction.ProcessingDuration = &duration
		}
		transaction.ProcessingCompletedAt = &now
	}

	// Update transaction
	if err := s.repo.Update(ctx, transaction); err != nil {
		return fmt.Errorf("failed to update transaction: %w", err)
	}

	// Create status history
	statusHistory := &TransactionStatus{
		TransactionID:  transactionID,
		Status:         status,
		PreviousStatus: previousStatus,
		Reason:         reason,
		Details: map[string]interface{}{
			"updated_at": now,
		},
	}
	s.repo.CreateStatusHistory(ctx, statusHistory)

	// Send notification
	if err := s.notificationService.SendTransactionNotification(ctx, transaction, status); err != nil {
		s.logger.WithError(err).Error("Failed to send transaction notification")
	}

	// Update metrics
	transactionsTotal.WithLabelValues(transaction.Type, status).Inc()

	s.logger.WithFields(logrus.Fields{
		"transaction_id":   transactionID,
		"previous_status":  previousStatus,
		"new_status":       status,
		"reason":           reason,
	}).Info("Transaction status updated")

	return nil
}

func (s *transactionService) CancelTransaction(ctx context.Context, transactionID uuid.UUID, req *CancelTransactionRequest) error {
	transaction, err := s.repo.GetByID(ctx, transactionID)
	if err != nil {
		return fmt.Errorf("transaction not found: %w", err)
	}

	if transaction.Status != "pending" && transaction.Status != "pending_review" {
		return fmt.Errorf("cannot cancel transaction with status: %s", transaction.Status)
	}

	reason := req.Reason
	if reason == "" {
		reason = "Cancelled by user"
	}

	return s.UpdateTransactionStatus(ctx, transactionID, "cancelled", reason)
}

func (s *transactionService) VerifyTransaction(ctx context.Context, req *VerifyTransactionRequest) (*Transaction, error) {
	transaction, err := s.repo.GetByReference(ctx, req.Reference)
	if err != nil {
		return nil, fmt.Errorf("transaction not found: %w", err)
	}

	// In real implementation, verify PIN against user's PIN
	// For now, just simulate PIN verification
	if req.PIN != "1234" { // Mock PIN
		return nil, errors.New("invalid PIN")
	}

	return transaction, nil
}

func (s *transactionService) GetTransactionStats(ctx context.Context, userID *uuid.UUID, startDate, endDate time.Time) (*TransactionStatsResponse, error) {
	filters := make(map[string]interface{})

	if userID != nil {
		filters["user_id"] = *userID
	}
	filters["start_date"] = startDate
	filters["end_date"] = endDate

	return s.repo.GetStats(ctx, filters)
}

func (s *transactionService) ProcessPendingTransactions(ctx context.Context) error {
	s.logger.Info("Processing pending transactions")

	transactions, err := s.repo.GetPendingTransactions(ctx, 100)
	if err != nil {
		return fmt.Errorf("failed to get pending transactions: %w", err)
	}

	for _, transaction := range transactions {
		if err := s.processTransaction(ctx, transaction); err != nil {
			s.logger.WithError(err).WithField("transaction_id", transaction.ID).Error("Failed to process transaction")
			s.UpdateTransactionStatus(ctx, transaction.ID, "failed", err.Error())
		}
	}

	return nil
}

func (s *transactionService) processTransaction(ctx context.Context, transaction *Transaction) error {
	// Update status to processing
	s.UpdateTransactionStatus(ctx, transaction.ID, "processing", "Processing transaction")

	var err error
	switch transaction.Type {
	case "transfer":
		err = s.bankingService.ProcessTransfer(ctx, transaction)
	case "bill_payment":
		err = s.bankingService.ProcessBillPayment(ctx, transaction)
	case "airtime_purchase":
		err = s.bankingService.ProcessAirtimePurchase(ctx, transaction)
	case "data_purchase":
		err = s.bankingService.ProcessDataPurchase(ctx, transaction)
	default:
		err = fmt.Errorf("unsupported transaction type: %s", transaction.Type)
	}

	if err != nil {
		return err
	}

	// Update transaction with processor response
	if err := s.repo.Update(ctx, transaction); err != nil {
		return fmt.Errorf("failed to update transaction: %w", err)
	}

	// Update status to completed
	s.UpdateTransactionStatus(ctx, transaction.ID, "completed", "Transaction processed successfully")

	return nil
}

func (s *transactionService) SettleTransactions(ctx context.Context) error {
	s.logger.Info("Starting transaction settlement")

	transactions, err := s.repo.GetTransactionsForSettlement(ctx, 1000)
	if err != nil {
		return fmt.Errorf("failed to get transactions for settlement: %w", err)
	}

	if len(transactions) == 0 {
		s.logger.Info("No transactions to settle")
		return nil
	}

	// Create settlement batch
	batch := &TransactionBatch{
		BatchNumber: fmt.Sprintf("SETTLE_%d", time.Now().Unix()),
		Type:        "settlement",
		Status:      "processing",
		TotalCount:  len(transactions),
	}

	var totalAmount float64
	for _, tx := range transactions {
		totalAmount += tx.Amount
	}
	batch.TotalAmount = totalAmount

	now := time.Now()
	batch.StartedAt = &now

	if err := db.Create(batch).Error; err != nil {
		return fmt.Errorf("failed to create settlement batch: %w", err)
	}

	// Process settlement
	successCount := 0
	for _, transaction := range transactions {
		// Simulate settlement processing
		time.Sleep(10 * time.Millisecond)

		transaction.SettlementStatus = "settled"
		transaction.SettlementDate = &now
		transaction.SettlementReference = batch.BatchNumber
		transaction.SettlementBatch = batch.BatchNumber

		if err := s.repo.Update(ctx, transaction); err != nil {
			s.logger.WithError(err).WithField("transaction_id", transaction.ID).Error("Failed to update settlement status")
			continue
		}

		successCount++
	}

	// Update batch
	batch.Status = "completed"
	batch.ProcessedCount = len(transactions)
	batch.SuccessCount = successCount
	batch.FailedCount = len(transactions) - successCount
	batch.ProcessedAmount = totalAmount
	batch.CompletedAt = &now

	if err := db.Save(batch).Error; err != nil {
		s.logger.WithError(err).Error("Failed to update settlement batch")
	}

	// Update metrics
	settlementTransactions.Add(float64(successCount))

	s.logger.WithFields(logrus.Fields{
		"batch_number":     batch.BatchNumber,
		"total_count":      len(transactions),
		"success_count":    successCount,
		"failed_count":     len(transactions) - successCount,
		"total_amount":     totalAmount,
	}).Info("Settlement completed")

	return nil
}

// HTTP handlers
type TransactionHandler struct {
	service TransactionService
	logger  *logrus.Logger
}

func NewTransactionHandler(service TransactionService, logger *logrus.Logger) *TransactionHandler {
	return &TransactionHandler{
		service: service,
		logger:  logger,
	}
}

// Middleware
func (h *TransactionHandler) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Bearer token required"})
			c.Abort()
			return
		}

		claims, err := validateToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_role", claims.Role)
		c.Set("user_permissions", claims.Permissions)
		c.Set("session_id", claims.SessionID)
		c.Next()
	}
}

func (h *TransactionHandler) RateLimitMiddleware() gin.HandlerFunc {
	if !cfg.RateLimit.Enabled {
		return func(c *gin.Context) {
			c.Next()
		}
	}

	limiter := rate.NewLimiter(rate.Limit(cfg.RateLimit.RPS), cfg.RateLimit.Burst)

	return func(c *gin.Context) {
		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (h *TransactionHandler) MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())

		requestsTotal.WithLabelValues(c.Request.Method, c.FullPath(), status).Inc()
		requestDuration.WithLabelValues(c.Request.Method, c.FullPath()).Observe(duration.Seconds())
	}
}

// API handlers
func (h *TransactionHandler) CreateTransaction(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transaction, err := h.service.CreateTransaction(c.Request.Context(), userID.(uuid.UUID), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to create transaction")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, TransactionResponse{
		Transaction: transaction,
		Message:     "Transaction created successfully",
	})
}

func (h *TransactionHandler) GetTransaction(c *gin.Context) {
	transactionIDStr := c.Param("id")
	transactionID, err := uuid.Parse(transactionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID"})
		return
	}

	transaction, err := h.service.GetTransaction(c.Request.Context(), transactionID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get transaction")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

func (h *TransactionHandler) GetTransactionByReference(c *gin.Context) {
	reference := c.Param("reference")
	if reference == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Reference is required"})
		return
	}

	transaction, err := h.service.GetTransactionByReference(c.Request.Context(), reference)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get transaction by reference")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

func (h *TransactionHandler) GetTransactions(c *gin.Context) {
	var req GetTransactionsRequest

	// Parse query parameters
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		if userID, err := uuid.Parse(userIDStr); err == nil {
			req.UserID = &userID
		}
	}

	req.Type = c.Query("type")
	req.Status = c.Query("status")
	req.StartDate = c.Query("start_date")
	req.EndDate = c.Query("end_date")
	req.Reference = c.Query("reference")

	if minAmountStr := c.Query("min_amount"); minAmountStr != "" {
		if minAmount, err := strconv.ParseFloat(minAmountStr, 64); err == nil {
			req.MinAmount = &minAmount
		}
	}

	if maxAmountStr := c.Query("max_amount"); maxAmountStr != "" {
		if maxAmount, err := strconv.ParseFloat(maxAmountStr, 64); err == nil {
			req.MaxAmount = &maxAmount
		}
	}

	if limitStr := c.Query("limit"); limitStr != "" {
		if limit, err := strconv.Atoi(limitStr); err == nil {
			req.Limit = limit
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if offset, err := strconv.Atoi(offsetStr); err == nil {
			req.Offset = offset
		}
	}

	transactions, total, err := h.service.GetTransactions(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get transactions")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"transactions": transactions,
		"total":        total,
		"limit":        req.Limit,
		"offset":       req.Offset,
	})
}

func (h *TransactionHandler) UpdateTransactionStatus(c *gin.Context) {
	transactionIDStr := c.Param("id")
	transactionID, err := uuid.Parse(transactionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID"})
		return
	}

	var req struct {
		Status string `json:"status" validate:"required,oneof=pending processing completed failed cancelled reversed"`
		Reason string `json:"reason,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateTransactionStatus(c.Request.Context(), transactionID, req.Status, req.Reason); err != nil {
		h.logger.WithError(err).Error("Failed to update transaction status")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Transaction status updated successfully"})
}

func (h *TransactionHandler) CancelTransaction(c *gin.Context) {
	transactionIDStr := c.Param("id")
	transactionID, err := uuid.Parse(transactionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID"})
		return
	}

	var req CancelTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.CancelTransaction(c.Request.Context(), transactionID, &req); err != nil {
		h.logger.WithError(err).Error("Failed to cancel transaction")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Transaction cancelled successfully"})
}

func (h *TransactionHandler) VerifyTransaction(c *gin.Context) {
	var req VerifyTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transaction, err := h.service.VerifyTransaction(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to verify transaction")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"transaction": transaction,
		"message":     "Transaction verified successfully",
	})
}

func (h *TransactionHandler) GetTransactionStats(c *gin.Context) {
	var userID *uuid.UUID
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		if id, err := uuid.Parse(userIDStr); err == nil {
			userID = &id
		}
	}

	startDate := time.Now().AddDate(0, -1, 0) // Default to last month
	if startDateStr := c.Query("start_date"); startDateStr != "" {
		if date, err := time.Parse("2006-01-02", startDateStr); err == nil {
			startDate = date
		}
	}

	endDate := time.Now()
	if endDateStr := c.Query("end_date"); endDateStr != "" {
		if date, err := time.Parse("2006-01-02", endDateStr); err == nil {
			endDate = date.Add(24 * time.Hour) // Include the entire day
		}
	}

	stats, err := h.service.GetTransactionStats(c.Request.Context(), userID, startDate, endDate)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get transaction stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

// Health check handler
func (h *TransactionHandler) HealthCheck(c *gin.Context) {
	// Check database connection
	sqlDB, err := db.DB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"error":   "database connection failed",
			"details": err.Error(),
		})
		return
	}

	if err := sqlDB.Ping(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"error":   "database ping failed",
			"details": err.Error(),
		})
		return
	}

	// Check Redis connection
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"error":   "redis connection failed",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "healthy",
		"service":    "transaction-service",
		"version":    Version,
		"build_time": BuildTime,
		"git_commit": GitCommit,
		"go_version": GoVersion,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// Setup routes
func setupRoutes(handler *TransactionHandler) *gin.Engine {
	if cfg.Logging.Level == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Global middleware
	router.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s %s %d %s \"%s\" %s\"\n",
			param.ClientIP,
			param.TimeStamp.Format(time.RFC1123),
			param.Method,
			param.Path,
			param.Request.Proto,
			param.StatusCode,
			param.Latency,
			param.Request.UserAgent(),
			param.ErrorMessage,
		)
	}))
	router.Use(handler.MetricsMiddleware())
	router.Use(handler.RateLimitMiddleware())
	router.Use(gin.Recovery())

	// CORS middleware
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"*"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Security middleware
	router.Use(secure.New(secure.Config{
		SSLRedirect:           cfg.Server.TLS.Enabled,
		STSSeconds:            31536000,
		STSIncludeSubdomains:  true,
		FrameDeny:             true,
		ContentTypeNosniff:    true,
		BrowserXssFilter:      true,
		ContentSecurityPolicy: "default-src 'self'",
	}))

	// Compression middleware
	router.Use(gzip.Gzip(gzip.DefaultCompression))

	// Request ID middleware
	router.Use(requestid.New())

	// Health check endpoint
	router.GET(cfg.Monitoring.HealthPath, handler.HealthCheck)

	// Metrics endpoint
	if cfg.Monitoring.Enabled {
		router.GET(cfg.Monitoring.MetricsPath, gin.WrapH(promhttp.Handler()))
	}

	// API version 1
	v1 := router.Group("/api/v1")
	{
		// Protected endpoints
		protected := v1.Group("/")
		protected.Use(handler.AuthMiddleware())
		{
			transactions := protected.Group("/transactions")
			{
				transactions.POST("/", handler.CreateTransaction)
				transactions.GET("/", handler.GetTransactions)
				transactions.GET("/stats", handler.GetTransactionStats)
				transactions.GET("/:id", handler.GetTransaction)
				transactions.GET("/reference/:reference", handler.GetTransactionByReference)
				transactions.PUT("/:id/status", handler.UpdateTransactionStatus)
				transactions.POST("/:id/cancel", handler.CancelTransaction)
				transactions.POST("/verify", handler.VerifyTransaction)
			}
		}
	}

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	return router
}

// Background workers
func startBackgroundWorkers() {
	// Transaction processor
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			if err := transactionService.ProcessPendingTransactions(ctx); err != nil {
				logger.WithError(err).Error("Failed to process pending transactions")
			}
			cancel()
		}
	}()

	// Settlement processor
	go func() {
		ticker := time.NewTicker(1 * time.Hour) // Run every hour
		defer ticker.Stop()

		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			if err := transactionService.SettleTransactions(ctx); err != nil {
				logger.WithError(err).Error("Failed to settle transactions")
			}
			cancel()
		}
	}()

	logger.Info("Background workers started")
}

// Main function
func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	// Initialize configuration
	if err := initConfig(); err != nil {
		log.Fatalf("Failed to initialize config: %v", err)
	}

	// Initialize logger
	if err := initLogger(); err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}

	logger.WithFields(logrus.Fields{
		"version":    Version,
		"build_time": BuildTime,
		"git_commit": GitCommit,
		"go_version": GoVersion,
	}).Info("Starting Transaction Service")

	// Initialize database
	if err := initDatabase(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize database")
	}

	// Initialize Redis
	if err := initRedis(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize Redis")
	}

	// Initialize validator
	if err := initValidator(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize validator")
	}

	// Initialize HTTP client
	initHTTPClient()

	// Initialize tracing
	if err := initTracing(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize tracing")
	}

	// Initialize messaging
	if err := initMessaging(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize messaging")
	}

	// Initialize services
	transactionRepo = NewTransactionRepository(db)
	bankingService = NewBankingService(httpClient, logger)
	fraudService = NewFraudService(httpClient, logger)
	notificationService = NewNotificationService(httpClient, logger)
	transactionService = NewTransactionService(
		transactionRepo,
		bankingService,
		fraudService,
		notificationService,
		redisClient,
		logger,
	)

	// Initialize handlers
	transactionHandler := NewTransactionHandler(transactionService, logger)

	// Setup routes
	router := setupRoutes(transactionHandler)

	// Start background workers
	startBackgroundWorkers()

	// Create HTTP server
	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// Configure TLS if enabled
	if cfg.Server.TLS.Enabled {
		server.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	}

	// Start server in a goroutine
	go func() {
		logger.WithFields(logrus.Fields{
			"host": cfg.Server.Host,
			"port": cfg.Server.Port,
			"tls":  cfg.Server.TLS.Enabled,
		}).Info("Starting HTTP server")

		var err error
		if cfg.Server.TLS.Enabled {
			err = server.ListenAndServeTLS(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile)
		} else {
			err = server.ListenAndServe()
		}

		if err != nil && err != http.ErrServerClosed {
			logger.WithError(err).Fatal("Failed to start server")
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	// Create a deadline for shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Shutdown server
	if err := server.Shutdown(ctx); err != nil {
		logger.WithError(err).Fatal("Server forced to shutdown")
	}

	// Close database connection
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.Close()
	}

	// Close Redis connection
	if redisClient != nil {
		redisClient.Close()
	}

	// Close messaging connections
	if natsConn != nil {
		natsConn.Close()
	}
	if rabbitConn != nil {
		rabbitConn.Close()
	}

	logger.Info("Server exited")
}

