package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	// Standard library
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
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
	"golang.org/x/crypto/scrypt"
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

	Security struct {
		PasswordMinLength    int           `mapstructure:"password_min_length"`
		PasswordRequireUpper bool          `mapstructure:"password_require_upper"`
		PasswordRequireLower bool          `mapstructure:"password_require_lower"`
		PasswordRequireDigit bool          `mapstructure:"password_require_digit"`
		PasswordRequireSymbol bool         `mapstructure:"password_require_symbol"`
		MaxLoginAttempts     int           `mapstructure:"max_login_attempts"`
		LockoutDuration      time.Duration `mapstructure:"lockout_duration"`
		SessionTimeout       time.Duration `mapstructure:"session_timeout"`
		TwoFactorRequired    bool          `mapstructure:"two_factor_required"`
		EncryptionKey        string        `mapstructure:"encryption_key"`
	} `mapstructure:"security"`

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

	Nigerian struct {
		BVNValidation    bool     `mapstructure:"bvn_validation"`
		NINValidation    bool     `mapstructure:"nin_validation"`
		PhoneValidation  bool     `mapstructure:"phone_validation"`
		SupportedStates  []string `mapstructure:"supported_states"`
		SupportedBanks   []string `mapstructure:"supported_banks"`
		DefaultCurrency  string   `mapstructure:"default_currency"`
		DefaultTimezone  string   `mapstructure:"default_timezone"`
		DefaultLanguage  string   `mapstructure:"default_language"`
		KYCRequirements  []string `mapstructure:"kyc_requirements"`
		ComplianceRules  []string `mapstructure:"compliance_rules"`
	} `mapstructure:"nigerian"`

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

// User model with comprehensive Nigerian banking context
type User struct {
	ID                    uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Email                 string     `json:"email" gorm:"uniqueIndex;not null" validate:"required,email"`
	Phone                 string     `json:"phone" gorm:"uniqueIndex;not null" validate:"required,nigerian_phone"`
	Password              string     `json:"-" gorm:"not null"`
	FirstName             string     `json:"first_name" gorm:"not null" validate:"required,min=2,max=50"`
	LastName              string     `json:"last_name" gorm:"not null" validate:"required,min=2,max=50"`
	MiddleName            string     `json:"middle_name,omitempty" gorm:"" validate:"omitempty,min=2,max=50"`
	DateOfBirth           *time.Time `json:"date_of_birth,omitempty" validate:"omitempty"`
	Gender                string     `json:"gender,omitempty" validate:"omitempty,oneof=male female other"`
	
	// Nigerian specific fields
	BVN                   string     `json:"bvn,omitempty" gorm:"uniqueIndex" validate:"omitempty,len=11,numeric"`
	NIN                   string     `json:"nin,omitempty" gorm:"uniqueIndex" validate:"omitempty,len=11,numeric"`
	StateOfOrigin         string     `json:"state_of_origin,omitempty" validate:"omitempty,nigerian_state"`
	StateOfResidence      string     `json:"state_of_residence,omitempty" validate:"omitempty,nigerian_state"`
	LGA                   string     `json:"lga,omitempty"`
	Address               string     `json:"address,omitempty" validate:"omitempty,min=10,max=200"`
	Nationality           string     `json:"nationality" gorm:"default:'Nigerian'" validate:"required"`
	
	// Account status and verification
	Status                string     `json:"status" gorm:"default:'pending'" validate:"oneof=pending active suspended blocked closed"`
	EmailVerified         bool       `json:"email_verified" gorm:"default:false"`
	PhoneVerified         bool       `json:"phone_verified" gorm:"default:false"`
	BVNVerified           bool       `json:"bvn_verified" gorm:"default:false"`
	NINVerified           bool       `json:"nin_verified" gorm:"default:false"`
	KYCLevel              int        `json:"kyc_level" gorm:"default:0" validate:"min=0,max=3"`
	KYCStatus             string     `json:"kyc_status" gorm:"default:'not_started'" validate:"oneof=not_started pending approved rejected"`
	
	// Role and permissions
	Role                  string     `json:"role" gorm:"default:'customer'" validate:"oneof=customer agent super_agent admin super_admin"`
	Permissions           []string   `json:"permissions" gorm:"type:text[]"`
	
	// Agent specific fields
	AgentCode             string     `json:"agent_code,omitempty" gorm:"uniqueIndex"`
	AgentLevel            int        `json:"agent_level,omitempty" gorm:"default:0"`
	SuperAgentID          *uuid.UUID `json:"super_agent_id,omitempty"`
	CommissionRate        float64    `json:"commission_rate,omitempty" gorm:"default:0.0"`
	FloatBalance          float64    `json:"float_balance,omitempty" gorm:"default:0.0"`
	DailyTransactionLimit float64    `json:"daily_transaction_limit,omitempty" gorm:"default:0.0"`
	MonthlyTransactionLimit float64  `json:"monthly_transaction_limit,omitempty" gorm:"default:0.0"`
	
	// Security fields
	TwoFactorEnabled      bool       `json:"two_factor_enabled" gorm:"default:false"`
	TwoFactorSecret       string     `json:"-"`
	LoginAttempts         int        `json:"-" gorm:"default:0"`
	LockedUntil           *time.Time `json:"-"`
	LastLoginAt           *time.Time `json:"last_login_at"`
	LastLoginIP           string     `json:"last_login_ip"`
	PasswordChangedAt     *time.Time `json:"password_changed_at"`
	
	// Preferences
	Language              string     `json:"language" gorm:"default:'en'" validate:"oneof=en ha yo ig"`
	Timezone              string     `json:"timezone" gorm:"default:'Africa/Lagos'"`
	Currency              string     `json:"currency" gorm:"default:'NGN'" validate:"oneof=NGN USD EUR GBP"`
	NotificationPrefs     map[string]bool `json:"notification_preferences" gorm:"type:jsonb"`
	
	// Metadata
	Metadata              map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	Tags                  []string   `json:"tags" gorm:"type:text[]"`
	
	// Audit fields
	CreatedAt             time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt             time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	CreatedBy             *uuid.UUID `json:"created_by,omitempty"`
	UpdatedBy             *uuid.UUID `json:"updated_by,omitempty"`
	DeletedAt             *time.Time `json:"deleted_at,omitempty" gorm:"index"`
	Version               int        `json:"version" gorm:"default:1"`
}

// UserProfile represents additional user profile information
type UserProfile struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID            uuid.UUID              `json:"user_id" gorm:"type:uuid;not null;uniqueIndex"`
	User              User                   `json:"user" gorm:"foreignKey:UserID"`
	ProfilePicture    string                 `json:"profile_picture,omitempty"`
	Bio               string                 `json:"bio,omitempty" validate:"omitempty,max=500"`
	Website           string                 `json:"website,omitempty" validate:"omitempty,url"`
	SocialMedia       map[string]string      `json:"social_media" gorm:"type:jsonb"`
	EmergencyContact  map[string]interface{} `json:"emergency_contact" gorm:"type:jsonb"`
	BankAccounts      []BankAccount          `json:"bank_accounts" gorm:"foreignKey:UserID"`
	Documents         []UserDocument         `json:"documents" gorm:"foreignKey:UserID"`
	Addresses         []UserAddress          `json:"addresses" gorm:"foreignKey:UserID"`
	CreatedAt         time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

// BankAccount represents user's bank account information
type BankAccount struct {
	ID            uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID        uuid.UUID `json:"user_id" gorm:"type:uuid;not null"`
	BankName      string    `json:"bank_name" gorm:"not null" validate:"required"`
	BankCode      string    `json:"bank_code" gorm:"not null" validate:"required"`
	AccountNumber string    `json:"account_number" gorm:"not null" validate:"required,len=10,numeric"`
	AccountName   string    `json:"account_name" gorm:"not null" validate:"required"`
	AccountType   string    `json:"account_type" gorm:"default:'savings'" validate:"oneof=savings current domiciliary"`
	IsPrimary     bool      `json:"is_primary" gorm:"default:false"`
	IsVerified    bool      `json:"is_verified" gorm:"default:false"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	CreatedAt     time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// UserDocument represents user's uploaded documents
type UserDocument struct {
	ID           uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID       uuid.UUID `json:"user_id" gorm:"type:uuid;not null"`
	DocumentType string    `json:"document_type" gorm:"not null" validate:"required,oneof=passport drivers_license voters_card nin_slip utility_bill bank_statement"`
	DocumentURL  string    `json:"document_url" gorm:"not null" validate:"required,url"`
	Status       string    `json:"status" gorm:"default:'pending'" validate:"oneof=pending approved rejected"`
	ReviewedBy   *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	ReviewNotes  string    `json:"review_notes,omitempty"`
	ExpiryDate   *time.Time `json:"expiry_date,omitempty"`
	CreatedAt    time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// UserAddress represents user's addresses
type UserAddress struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID      uuid.UUID `json:"user_id" gorm:"type:uuid;not null"`
	Type        string    `json:"type" gorm:"not null" validate:"required,oneof=home work business other"`
	Street      string    `json:"street" gorm:"not null" validate:"required"`
	City        string    `json:"city" gorm:"not null" validate:"required"`
	State       string    `json:"state" gorm:"not null" validate:"required,nigerian_state"`
	LGA         string    `json:"lga,omitempty"`
	PostalCode  string    `json:"postal_code,omitempty"`
	Country     string    `json:"country" gorm:"default:'Nigeria'" validate:"required"`
	Latitude    *float64  `json:"latitude,omitempty"`
	Longitude   *float64  `json:"longitude,omitempty"`
	IsPrimary   bool      `json:"is_primary" gorm:"default:false"`
	IsVerified  bool      `json:"is_verified" gorm:"default:false"`
	VerifiedAt  *time.Time `json:"verified_at,omitempty"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// UserSession represents active user sessions
type UserSession struct {
	ID           uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID       uuid.UUID `json:"user_id" gorm:"type:uuid;not null"`
	SessionToken string    `json:"session_token" gorm:"uniqueIndex;not null"`
	RefreshToken string    `json:"refresh_token" gorm:"uniqueIndex;not null"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	DeviceInfo   map[string]interface{} `json:"device_info" gorm:"type:jsonb"`
	Location     map[string]interface{} `json:"location" gorm:"type:jsonb"`
	IsActive     bool      `json:"is_active" gorm:"default:true"`
	ExpiresAt    time.Time `json:"expires_at" gorm:"not null"`
	LastUsedAt   time.Time `json:"last_used_at" gorm:"autoUpdateTime"`
	CreatedAt    time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// UserActivity represents user activity logs
type UserActivity struct {
	ID          uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID      uuid.UUID              `json:"user_id" gorm:"type:uuid;not null"`
	Action      string                 `json:"action" gorm:"not null"`
	Resource    string                 `json:"resource,omitempty"`
	ResourceID  string                 `json:"resource_id,omitempty"`
	IPAddress   string                 `json:"ip_address"`
	UserAgent   string                 `json:"user_agent"`
	Details     map[string]interface{} `json:"details" gorm:"type:jsonb"`
	Status      string                 `json:"status" gorm:"default:'success'" validate:"oneof=success failed error"`
	CreatedAt   time.Time              `json:"created_at" gorm:"autoCreateTime"`
}

// Request/Response DTOs
type RegisterRequest struct {
	Email       string `json:"email" validate:"required,email"`
	Phone       string `json:"phone" validate:"required,nigerian_phone"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	FirstName   string `json:"first_name" validate:"required,min=2,max=50"`
	LastName    string `json:"last_name" validate:"required,min=2,max=50"`
	MiddleName  string `json:"middle_name,omitempty" validate:"omitempty,min=2,max=50"`
	DateOfBirth string `json:"date_of_birth,omitempty" validate:"omitempty,datetime=2006-01-02"`
	Gender      string `json:"gender,omitempty" validate:"omitempty,oneof=male female other"`
	State       string `json:"state,omitempty" validate:"omitempty,nigerian_state"`
	Address     string `json:"address,omitempty" validate:"omitempty,min=10,max=200"`
	Role        string `json:"role,omitempty" validate:"omitempty,oneof=customer agent"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
	Remember bool   `json:"remember,omitempty"`
}

type LoginResponse struct {
	User         *User  `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	NewPassword     string `json:"new_password" validate:"required,min=8,max=128"`
}

type UpdateProfileRequest struct {
	FirstName        string                 `json:"first_name,omitempty" validate:"omitempty,min=2,max=50"`
	LastName         string                 `json:"last_name,omitempty" validate:"omitempty,min=2,max=50"`
	MiddleName       string                 `json:"middle_name,omitempty" validate:"omitempty,min=2,max=50"`
	Phone            string                 `json:"phone,omitempty" validate:"omitempty,nigerian_phone"`
	DateOfBirth      string                 `json:"date_of_birth,omitempty" validate:"omitempty,datetime=2006-01-02"`
	Gender           string                 `json:"gender,omitempty" validate:"omitempty,oneof=male female other"`
	StateOfOrigin    string                 `json:"state_of_origin,omitempty" validate:"omitempty,nigerian_state"`
	StateOfResidence string                 `json:"state_of_residence,omitempty" validate:"omitempty,nigerian_state"`
	Address          string                 `json:"address,omitempty" validate:"omitempty,min=10,max=200"`
	Language         string                 `json:"language,omitempty" validate:"omitempty,oneof=en ha yo ig"`
	Timezone         string                 `json:"timezone,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
}

type VerifyEmailRequest struct {
	Token string `json:"token" validate:"required"`
}

type VerifyPhoneRequest struct {
	Code string `json:"code" validate:"required,len=6,numeric"`
}

type ResendVerificationRequest struct {
	Type string `json:"type" validate:"required,oneof=email phone"`
}

type ForgotPasswordRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type ResetPasswordRequest struct {
	Token       string `json:"token" validate:"required"`
	NewPassword string `json:"new_password" validate:"required,min=8,max=128"`
}

// Service interfaces
type UserService interface {
	Register(ctx context.Context, req *RegisterRequest) (*User, error)
	Login(ctx context.Context, req *LoginRequest) (*LoginResponse, error)
	RefreshToken(ctx context.Context, req *RefreshTokenRequest) (*LoginResponse, error)
	GetProfile(ctx context.Context, userID uuid.UUID) (*User, error)
	UpdateProfile(ctx context.Context, userID uuid.UUID, req *UpdateProfileRequest) (*User, error)
	ChangePassword(ctx context.Context, userID uuid.UUID, req *ChangePasswordRequest) error
	VerifyEmail(ctx context.Context, req *VerifyEmailRequest) error
	VerifyPhone(ctx context.Context, userID uuid.UUID, req *VerifyPhoneRequest) error
	ResendVerification(ctx context.Context, userID uuid.UUID, req *ResendVerificationRequest) error
	ForgotPassword(ctx context.Context, req *ForgotPasswordRequest) error
	ResetPassword(ctx context.Context, req *ResetPasswordRequest) error
	GetUsers(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*User, int64, error)
	GetUserByID(ctx context.Context, userID uuid.UUID) (*User, error)
	UpdateUserStatus(ctx context.Context, userID uuid.UUID, status string) error
	DeleteUser(ctx context.Context, userID uuid.UUID) error
	LogActivity(ctx context.Context, userID uuid.UUID, action, resource, resourceID string, details map[string]interface{}) error
}

type UserRepository interface {
	Create(ctx context.Context, user *User) error
	GetByID(ctx context.Context, id uuid.UUID) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	GetByPhone(ctx context.Context, phone string) (*User, error)
	GetByBVN(ctx context.Context, bvn string) (*User, error)
	GetByNIN(ctx context.Context, nin string) (*User, error)
	Update(ctx context.Context, user *User) error
	Delete(ctx context.Context, id uuid.UUID) error
	List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*User, int64, error)
	CreateSession(ctx context.Context, session *UserSession) error
	GetSession(ctx context.Context, token string) (*UserSession, error)
	UpdateSession(ctx context.Context, session *UserSession) error
	DeleteSession(ctx context.Context, token string) error
	LogActivity(ctx context.Context, activity *UserActivity) error
}

// Prometheus metrics
var (
	requestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "user_service_requests_total",
			Help: "Total number of requests to user service",
		},
		[]string{"method", "endpoint", "status"},
	)

	requestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "user_service_request_duration_seconds",
			Help:    "Duration of requests to user service",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "endpoint"},
	)

	activeUsers = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "user_service_active_users",
			Help: "Number of active users",
		},
	)

	registrationsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "user_service_registrations_total",
			Help: "Total number of user registrations",
		},
	)

	loginAttemptsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "user_service_login_attempts_total",
			Help: "Total number of login attempts",
		},
		[]string{"status"},
	)

	passwordResetRequestsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "user_service_password_reset_requests_total",
			Help: "Total number of password reset requests",
		},
	)

	verificationAttemptsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "user_service_verification_attempts_total",
			Help: "Total number of verification attempts",
		},
		[]string{"type", "status"},
	)
)

// Global variables
var (
	cfg        *Config
	db         *gorm.DB
	redisClient *redis.Client
	logger     *logrus.Logger
	validator  *validator.Validate
	userService UserService
	userRepo   UserRepository
	natsConn   *nats.Conn
	rabbitConn *amqp091.Connection
)

// Nigerian states for validation
var nigerianStates = []string{
	"Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
	"Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe",
	"Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
	"Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
	"Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
}

// Nigerian banks for validation
var nigerianBanks = []string{
	"Access Bank", "Citibank", "Diamond Bank", "Ecobank", "Fidelity Bank",
	"First Bank", "First City Monument Bank", "Guaranty Trust Bank", "Heritage Bank",
	"Keystone Bank", "Polaris Bank", "Providus Bank", "Stanbic IBTC Bank",
	"Standard Chartered", "Sterling Bank", "SunTrust Bank", "Union Bank",
	"United Bank for Africa", "Unity Bank", "Wema Bank", "Zenith Bank",
}

// Initialize configuration
func initConfig() error {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath(".")

	// Set default values
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
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
	viper.SetDefault("redis.db", 0)
	viper.SetDefault("redis.pool_size", 10)
	viper.SetDefault("redis.min_idle_conns", 2)
	viper.SetDefault("redis.dial_timeout", "5s")
	viper.SetDefault("redis.read_timeout", "3s")
	viper.SetDefault("redis.write_timeout", "3s")
	viper.SetDefault("redis.idle_timeout", "5m")

	viper.SetDefault("jwt.secret", "your-secret-key")
	viper.SetDefault("jwt.access_token_ttl", "15m")
	viper.SetDefault("jwt.refresh_token_ttl", "7d")
	viper.SetDefault("jwt.issuer", "remittance-user-service")
	viper.SetDefault("jwt.audience", "remittance")
	viper.SetDefault("jwt.signing_method", "HS256")
	viper.SetDefault("jwt.refresh_threshold", "5m")

	viper.SetDefault("security.password_min_length", 8)
	viper.SetDefault("security.password_require_upper", true)
	viper.SetDefault("security.password_require_lower", true)
	viper.SetDefault("security.password_require_digit", true)
	viper.SetDefault("security.password_require_symbol", true)
	viper.SetDefault("security.max_login_attempts", 5)
	viper.SetDefault("security.lockout_duration", "30m")
	viper.SetDefault("security.session_timeout", "24h")
	viper.SetDefault("security.two_factor_required", false)

	viper.SetDefault("rate_limit.enabled", true)
	viper.SetDefault("rate_limit.rps", 100)
	viper.SetDefault("rate_limit.burst", 200)
	viper.SetDefault("rate_limit.window_size", "1m")

	viper.SetDefault("monitoring.enabled", true)
	viper.SetDefault("monitoring.metrics_path", "/metrics")
	viper.SetDefault("monitoring.health_path", "/health")
	viper.SetDefault("monitoring.service_name", "user-service")

	viper.SetDefault("nigerian.bvn_validation", true)
	viper.SetDefault("nigerian.nin_validation", true)
	viper.SetDefault("nigerian.phone_validation", true)
	viper.SetDefault("nigerian.supported_states", nigerianStates)
	viper.SetDefault("nigerian.supported_banks", nigerianBanks)
	viper.SetDefault("nigerian.default_currency", "NGN")
	viper.SetDefault("nigerian.default_timezone", "Africa/Lagos")
	viper.SetDefault("nigerian.default_language", "en")

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

	// Set log level
	level, err := logrus.ParseLevel(cfg.Logging.Level)
	if err != nil {
		return fmt.Errorf("invalid log level: %w", err)
	}
	logger.SetLevel(level)

	// Set log format
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

	// Set output
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

	// Configure connection pool
	sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.Database.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.Database.ConnMaxIdleTime)

	// Test connection
	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Auto migrate
	if err := db.AutoMigrate(
		&User{},
		&UserProfile{},
		&BankAccount{},
		&UserDocument{},
		&UserAddress{},
		&UserSession{},
		&UserActivity{},
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

	// Test connection
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

	// Register custom validators
	if err := validator.RegisterValidation("nigerian_phone", validateNigerianPhone); err != nil {
		return fmt.Errorf("failed to register nigerian_phone validator: %w", err)
	}

	if err := validator.RegisterValidation("nigerian_state", validateNigerianState); err != nil {
		return fmt.Errorf("failed to register nigerian_state validator: %w", err)
	}

	if err := validator.RegisterValidation("numeric", validateNumeric); err != nil {
		return fmt.Errorf("failed to register numeric validator: %w", err)
	}

	return nil
}

// Custom validators
func validateNigerianPhone(fl validator.FieldLevel) bool {
	phone := fl.Field().String()
	if phone == "" {
		return true // Allow empty for optional fields
	}

	// Parse phone number
	num, err := phonenumbers.Parse(phone, "NG")
	if err != nil {
		return false
	}

	// Validate phone number
	return phonenumbers.IsValidNumber(num)
}

func validateNigerianState(fl validator.FieldLevel) bool {
	state := fl.Field().String()
	if state == "" {
		return true // Allow empty for optional fields
	}

	for _, s := range nigerianStates {
		if strings.EqualFold(s, state) {
			return true
		}
	}
	return false
}

func validateNumeric(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true // Allow empty for optional fields
	}

	for _, char := range value {
		if !unicode.IsDigit(char) {
			return false
		}
	}
	return true
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
	// Initialize NATS
	if cfg.Messaging.NATS.URL != "" {
		var err error
		natsConn, err = nats.Connect(cfg.Messaging.NATS.URL)
		if err != nil {
			return fmt.Errorf("failed to connect to NATS: %w", err)
		}
		logger.Info("NATS connected successfully")
	}

	// Initialize RabbitMQ
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

func generateTokens(user *User, sessionID uuid.UUID) (string, string, error) {
	// Access token
	accessClaims := &JWTClaims{
		UserID:      user.ID,
		Email:       user.Email,
		Role:        user.Role,
		Permissions: user.Permissions,
		SessionID:   sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    cfg.JWT.Issuer,
			Audience:  []string{cfg.JWT.Audience},
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(cfg.JWT.AccessTokenTTL)),
			NotBefore: jwt.NewNumericDate(time.Now()),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.New().String(),
		},
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString([]byte(cfg.JWT.Secret))
	if err != nil {
		return "", "", fmt.Errorf("failed to sign access token: %w", err)
	}

	// Refresh token
	refreshClaims := &JWTClaims{
		UserID:    user.ID,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    cfg.JWT.Issuer,
			Audience:  []string{cfg.JWT.Audience},
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(cfg.JWT.RefreshTokenTTL)),
			NotBefore: jwt.NewNumericDate(time.Now()),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.New().String(),
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString([]byte(cfg.JWT.Secret))
	if err != nil {
		return "", "", fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return accessTokenString, refreshTokenString, nil
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

// Password utilities
func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

func verifyPassword(hashedPassword, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
}

func validatePasswordStrength(password string) error {
	if len(password) < cfg.Security.PasswordMinLength {
		return fmt.Errorf("password must be at least %d characters long", cfg.Security.PasswordMinLength)
	}

	var hasUpper, hasLower, hasDigit, hasSymbol bool

	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsDigit(char):
			hasDigit = true
		case unicode.IsPunct(char) || unicode.IsSymbol(char):
			hasSymbol = true
		}
	}

	if cfg.Security.PasswordRequireUpper && !hasUpper {
		return errors.New("password must contain at least one uppercase letter")
	}

	if cfg.Security.PasswordRequireLower && !hasLower {
		return errors.New("password must contain at least one lowercase letter")
	}

	if cfg.Security.PasswordRequireDigit && !hasDigit {
		return errors.New("password must contain at least one digit")
	}

	if cfg.Security.PasswordRequireSymbol && !hasSymbol {
		return errors.New("password must contain at least one symbol")
	}

	return nil
}

// Encryption utilities
func encrypt(plaintext string) (string, error) {
	if cfg.Security.EncryptionKey == "" {
		return plaintext, nil
	}

	key := []byte(cfg.Security.EncryptionKey)
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate salt: %w", err)
	}

	dk, err := scrypt.Key(key, salt, 32768, 8, 1, 32)
	if err != nil {
		return "", fmt.Errorf("failed to derive key: %w", err)
	}

	// Simple XOR encryption (for demonstration - use proper encryption in production)
	ciphertext := make([]byte, len(plaintext))
	for i, b := range []byte(plaintext) {
		ciphertext[i] = b ^ dk[i%len(dk)]
	}

	// Combine salt and ciphertext
	result := append(salt, ciphertext...)
	return base64.StdEncoding.EncodeToString(result), nil
}

func decrypt(ciphertext string) (string, error) {
	if cfg.Security.EncryptionKey == "" {
		return ciphertext, nil
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("failed to decode ciphertext: %w", err)
	}

	if len(data) < 32 {
		return "", errors.New("invalid ciphertext")
	}

	salt := data[:32]
	encrypted := data[32:]

	key := []byte(cfg.Security.EncryptionKey)
	dk, err := scrypt.Key(key, salt, 32768, 8, 1, 32)
	if err != nil {
		return "", fmt.Errorf("failed to derive key: %w", err)
	}

	// Simple XOR decryption
	plaintext := make([]byte, len(encrypted))
	for i, b := range encrypted {
		plaintext[i] = b ^ dk[i%len(dk)]
	}

	return string(plaintext), nil
}

// User repository implementation
type userRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) Create(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *userRepository) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("email = ? AND deleted_at IS NULL", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByPhone(ctx context.Context, phone string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("phone = ? AND deleted_at IS NULL", phone).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByBVN(ctx context.Context, bvn string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("bvn = ? AND deleted_at IS NULL", bvn).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByNIN(ctx context.Context, nin string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("nin = ? AND deleted_at IS NULL", nin).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) Update(ctx context.Context, user *User) error {
	user.UpdatedAt = time.Now()
	user.Version++
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *userRepository) Delete(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&User{}).Where("id = ?", id).Update("deleted_at", now).Error
}

func (r *userRepository) List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*User, int64, error) {
	var users []*User
	var total int64

	query := r.db.WithContext(ctx).Model(&User{}).Where("deleted_at IS NULL")

	// Apply filters
	for key, value := range filters {
		switch key {
		case "status":
			query = query.Where("status = ?", value)
		case "role":
			query = query.Where("role = ?", value)
		case "kyc_level":
			query = query.Where("kyc_level = ?", value)
		case "email_verified":
			query = query.Where("email_verified = ?", value)
		case "phone_verified":
			query = query.Where("phone_verified = ?", value)
		case "search":
			searchTerm := fmt.Sprintf("%%%s%%", value)
			query = query.Where("first_name ILIKE ? OR last_name ILIKE ? OR email ILIKE ? OR phone ILIKE ?",
				searchTerm, searchTerm, searchTerm, searchTerm)
		}
	}

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Get users with pagination
	if err := query.Limit(limit).Offset(offset).Order("created_at DESC").Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func (r *userRepository) CreateSession(ctx context.Context, session *UserSession) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *userRepository) GetSession(ctx context.Context, token string) (*UserSession, error) {
	var session UserSession
	err := r.db.WithContext(ctx).Where("session_token = ? AND is_active = true AND expires_at > ?", token, time.Now()).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *userRepository) UpdateSession(ctx context.Context, session *UserSession) error {
	return r.db.WithContext(ctx).Save(session).Error
}

func (r *userRepository) DeleteSession(ctx context.Context, token string) error {
	return r.db.WithContext(ctx).Model(&UserSession{}).Where("session_token = ?", token).Update("is_active", false).Error
}

func (r *userRepository) LogActivity(ctx context.Context, activity *UserActivity) error {
	return r.db.WithContext(ctx).Create(activity).Error
}

// User service implementation
type userService struct {
	repo        UserRepository
	redisClient *redis.Client
	logger      *logrus.Logger
}

func NewUserService(repo UserRepository, redisClient *redis.Client, logger *logrus.Logger) UserService {
	return &userService{
		repo:        repo,
		redisClient: redisClient,
		logger:      logger,
	}
}

func (s *userService) Register(ctx context.Context, req *RegisterRequest) (*User, error) {
	// Validate password strength
	if err := validatePasswordStrength(req.Password); err != nil {
		return nil, fmt.Errorf("password validation failed: %w", err)
	}

	// Check if user already exists
	if _, err := s.repo.GetByEmail(ctx, req.Email); err == nil {
		return nil, errors.New("user with this email already exists")
	}

	if _, err := s.repo.GetByPhone(ctx, req.Phone); err == nil {
		return nil, errors.New("user with this phone number already exists")
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Parse date of birth
	var dateOfBirth *time.Time
	if req.DateOfBirth != "" {
		dob, err := time.Parse("2006-01-02", req.DateOfBirth)
		if err != nil {
			return nil, fmt.Errorf("invalid date of birth format: %w", err)
		}
		dateOfBirth = &dob
	}

	// Create user
	user := &User{
		Email:                req.Email,
		Phone:                req.Phone,
		Password:             hashedPassword,
		FirstName:            req.FirstName,
		LastName:             req.LastName,
		MiddleName:           req.MiddleName,
		DateOfBirth:          dateOfBirth,
		Gender:               req.Gender,
		StateOfResidence:     req.State,
		Address:              req.Address,
		Role:                 req.Role,
		Status:               "pending",
		Nationality:          "Nigerian",
		Language:             cfg.Nigerian.DefaultLanguage,
		Timezone:             cfg.Nigerian.DefaultTimezone,
		Currency:             cfg.Nigerian.DefaultCurrency,
		NotificationPrefs:    map[string]bool{
			"email":    true,
			"sms":      true,
			"push":     true,
			"in_app":   true,
		},
		Metadata:             make(map[string]interface{}),
		Tags:                 []string{},
		PasswordChangedAt:    &time.Time{},
	}

	// Set default role if not provided
	if user.Role == "" {
		user.Role = "customer"
	}

	// Set default permissions based on role
	switch user.Role {
	case "customer":
		user.Permissions = []string{"profile.view", "profile.edit", "transactions.view"}
	case "agent":
		user.Permissions = []string{"profile.view", "profile.edit", "transactions.view", "transactions.create", "customers.view"}
		// Generate agent code
		user.AgentCode = generateAgentCode()
		user.AgentLevel = 1
		user.DailyTransactionLimit = 100000.0  // 100k NGN
		user.MonthlyTransactionLimit = 2000000.0 // 2M NGN
	}

	// Create user in database
	if err := s.repo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, user.ID, "user_registered", "user", user.ID.String(), map[string]interface{}{
		"role":  user.Role,
		"email": user.Email,
		"phone": user.Phone,
	})

	// Update metrics
	registrationsTotal.Inc()

	s.logger.WithFields(logrus.Fields{
		"user_id": user.ID,
		"email":   user.Email,
		"role":    user.Role,
	}).Info("User registered successfully")

	return user, nil
}

func (s *userService) Login(ctx context.Context, req *LoginRequest) (*LoginResponse, error) {
	// Get user by email
	user, err := s.repo.GetByEmail(ctx, req.Email)
	if err != nil {
		loginAttemptsTotal.WithLabelValues("failed").Inc()
		return nil, errors.New("invalid email or password")
	}

	// Check if user is locked
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		loginAttemptsTotal.WithLabelValues("locked").Inc()
		return nil, fmt.Errorf("account is locked until %s", user.LockedUntil.Format(time.RFC3339))
	}

	// Verify password
	if err := verifyPassword(user.Password, req.Password); err != nil {
		// Increment login attempts
		user.LoginAttempts++
		if user.LoginAttempts >= cfg.Security.MaxLoginAttempts {
			lockUntil := time.Now().Add(cfg.Security.LockoutDuration)
			user.LockedUntil = &lockUntil
			user.LoginAttempts = 0
		}
		s.repo.Update(ctx, user)

		loginAttemptsTotal.WithLabelValues("failed").Inc()
		return nil, errors.New("invalid email or password")
	}

	// Check user status
	if user.Status != "active" {
		loginAttemptsTotal.WithLabelValues("inactive").Inc()
		return nil, fmt.Errorf("account is %s", user.Status)
	}

	// Reset login attempts on successful login
	user.LoginAttempts = 0
	user.LockedUntil = nil
	now := time.Now()
	user.LastLoginAt = &now

	// Create session
	sessionID := uuid.New()
	session := &UserSession{
		ID:           sessionID,
		UserID:       user.ID,
		SessionToken: uuid.New().String(),
		RefreshToken: uuid.New().String(),
		IsActive:     true,
		ExpiresAt:    time.Now().Add(cfg.Security.SessionTimeout),
		LastUsedAt:   time.Now(),
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	// Generate tokens
	accessToken, refreshToken, err := generateTokens(user, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	// Update user
	if err := s.repo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, user.ID, "user_login", "user", user.ID.String(), map[string]interface{}{
		"session_id": sessionID,
		"ip_address": ctx.Value("client_ip"),
		"user_agent": ctx.Value("user_agent")
	})

	// Update metrics
	loginAttemptsTotal.WithLabelValues("success").Inc()

	s.logger.WithFields(logrus.Fields{
		"user_id":    user.ID,
		"email":      user.Email,
		"session_id": sessionID,
	}).Info("User logged in successfully")

	return &LoginResponse{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(cfg.JWT.AccessTokenTTL.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

func (s *userService) RefreshToken(ctx context.Context, req *RefreshTokenRequest) (*LoginResponse, error) {
	// Validate refresh token
	claims, err := validateToken(req.RefreshToken)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	// Get session
	session, err := s.repo.GetSession(ctx, claims.SessionID.String())
	if err != nil {
		return nil, errors.New("invalid session")
	}

	// Get user
	user, err := s.repo.GetByID(ctx, claims.UserID)
	if err != nil {
		return nil, errors.New("user not found")
	}

	// Check user status
	if user.Status != "active" {
		return nil, fmt.Errorf("account is %s", user.Status)
	}

	// Generate new tokens
	accessToken, refreshToken, err := generateTokens(user, session.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	// Update session
	session.RefreshToken = refreshToken
	session.LastUsedAt = time.Now()
	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}

	s.logger.WithFields(logrus.Fields{
		"user_id":    user.ID,
		"session_id": session.ID,
	}).Info("Token refreshed successfully")

	return &LoginResponse{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(cfg.JWT.AccessTokenTTL.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

func (s *userService) GetProfile(ctx context.Context, userID uuid.UUID) (*User, error) {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	return user, nil
}

func (s *userService) UpdateProfile(ctx context.Context, userID uuid.UUID, req *UpdateProfileRequest) (*User, error) {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Update fields
	if req.FirstName != "" {
		user.FirstName = req.FirstName
	}
	if req.LastName != "" {
		user.LastName = req.LastName
	}
	if req.MiddleName != "" {
		user.MiddleName = req.MiddleName
	}
	if req.Phone != "" {
		// Check if phone is already taken
		if existingUser, err := s.repo.GetByPhone(ctx, req.Phone); err == nil && existingUser.ID != userID {
			return nil, errors.New("phone number is already taken")
		}
		user.Phone = req.Phone
		user.PhoneVerified = false // Reset verification status
	}
	if req.DateOfBirth != "" {
		dob, err := time.Parse("2006-01-02", req.DateOfBirth)
		if err != nil {
			return nil, fmt.Errorf("invalid date of birth format: %w", err)
		}
		user.DateOfBirth = &dob
	}
	if req.Gender != "" {
		user.Gender = req.Gender
	}
	if req.StateOfOrigin != "" {
		user.StateOfOrigin = req.StateOfOrigin
	}
	if req.StateOfResidence != "" {
		user.StateOfResidence = req.StateOfResidence
	}
	if req.Address != "" {
		user.Address = req.Address
	}
	if req.Language != "" {
		user.Language = req.Language
	}
	if req.Timezone != "" {
		user.Timezone = req.Timezone
	}
	if req.Metadata != nil {
		user.Metadata = req.Metadata
	}

	// Update user
	if err := s.repo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, userID, "profile_updated", "user", userID.String(), map[string]interface{}{
		"updated_fields": getUpdatedFields(req),
	})

	s.logger.WithFields(logrus.Fields{
		"user_id": userID,
	}).Info("User profile updated successfully")

	return user, nil
}

func (s *userService) ChangePassword(ctx context.Context, userID uuid.UUID, req *ChangePasswordRequest) error {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// Verify current password
	if err := verifyPassword(user.Password, req.CurrentPassword); err != nil {
		return errors.New("current password is incorrect")
	}

	// Validate new password strength
	if err := validatePasswordStrength(req.NewPassword); err != nil {
		return fmt.Errorf("password validation failed: %w", err)
	}

	// Hash new password
	hashedPassword, err := hashPassword(req.NewPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Update password
	user.Password = hashedPassword
	now := time.Now()
	user.PasswordChangedAt = &now

	if err := s.repo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, userID, "password_changed", "user", userID.String(), nil)

	s.logger.WithFields(logrus.Fields{
		"user_id": userID,
	}).Info("User password changed successfully")

	return nil
}

func (s *userService) VerifyEmail(ctx context.Context, req *VerifyEmailRequest) error {
	redisKey := fmt.Sprintf("email_verification:%s", req.Token)
	userIDStr, err := s.redis.Get(ctx, redisKey).Result()
	if err != nil {
		verificationAttemptsTotal.WithLabelValues("email", "failed").Inc()
		return fmt.Errorf("invalid or expired verification token")
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return fmt.Errorf("invalid user ID in token: %w", err)
	}

	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	user.EmailVerified = true
	now := time.Now()
	user.UpdatedAt = now

	if err := s.repo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	s.redis.Del(ctx, redisKey)
	s.LogActivity(ctx, userID, "email_verified", "user", userID.String(), nil)

	verificationAttemptsTotal.WithLabelValues("email", "success").Inc()
	s.logger.WithFields(logrus.Fields{"user_id": userID}).Info("Email verified successfully")
	return nil
}

func (s *userService) VerifyPhone(ctx context.Context, userID uuid.UUID, req *VerifyPhoneRequest) error {
	redisKey := fmt.Sprintf("phone_verification:%s", userID.String())
	storedCode, err := s.redis.Get(ctx, redisKey).Result()
	if err != nil {
		verificationAttemptsTotal.WithLabelValues("phone", "failed").Inc()
		return fmt.Errorf("verification code expired or not found")
	}

	if storedCode != req.Code {
		verificationAttemptsTotal.WithLabelValues("phone", "failed").Inc()
		return fmt.Errorf("invalid verification code")
	}

	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	user.PhoneVerified = true
	now := time.Now()
	user.UpdatedAt = now

	if err := s.repo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	s.redis.Del(ctx, redisKey)
	s.LogActivity(ctx, userID, "phone_verified", "user", userID.String(), nil)

	verificationAttemptsTotal.WithLabelValues("phone", "success").Inc()
	s.logger.WithFields(logrus.Fields{"user_id": userID}).Info("Phone verified successfully")
	return nil
}

func (s *userService) ResendVerification(ctx context.Context, userID uuid.UUID, req *ResendVerificationRequest) error {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	if req.Type == "email" {
		token := uuid.New().String()
		redisKey := fmt.Sprintf("email_verification:%s", token)
		s.redis.Set(ctx, redisKey, userID.String(), 24*time.Hour)

		if s.messaging != nil {
			msg := map[string]interface{}{
				"type":    "email_verification",
				"to":      user.Email,
				"user_id": userID.String(),
				"token":   token,
			}
			msgBytes, _ := json.Marshal(msg)
			s.messaging.Publish(ctx, "notifications", msgBytes)
		}
	} else if req.Type == "phone" {
		code := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
		redisKey := fmt.Sprintf("phone_verification:%s", userID.String())
		s.redis.Set(ctx, redisKey, code, 10*time.Minute)

		if s.messaging != nil {
			msg := map[string]interface{}{
				"type":    "sms_verification",
				"to":      user.Phone,
				"user_id": userID.String(),
				"code":    code,
			}
			msgBytes, _ := json.Marshal(msg)
			s.messaging.Publish(ctx, "notifications", msgBytes)
		}
	} else {
		return fmt.Errorf("invalid verification type: %s", req.Type)
	}

	s.LogActivity(ctx, userID, "verification_resent", "user", userID.String(), map[string]interface{}{"type": req.Type})

	s.logger.WithFields(logrus.Fields{
		"user_id": userID,
		"type":    req.Type,
	}).Info("Verification resent successfully")

	return nil
}

func (s *userService) ForgotPassword(ctx context.Context, req *ForgotPasswordRequest) error {
	user, err := s.repo.GetByEmail(ctx, req.Email)
	if err != nil {
		return nil
	}

	token := uuid.New().String()
	redisKey := fmt.Sprintf("password_reset:%s", token)
	s.redis.Set(ctx, redisKey, user.ID.String(), 1*time.Hour)

	if s.messaging != nil {
		msg := map[string]interface{}{
			"type":    "password_reset",
			"to":      user.Email,
			"user_id": user.ID.String(),
			"token":   token,
		}
		msgBytes, _ := json.Marshal(msg)
		s.messaging.Publish(ctx, "notifications", msgBytes)
	}

	s.LogActivity(ctx, user.ID, "password_reset_requested", "user", user.ID.String(), nil)
	passwordResetRequestsTotal.Inc()

	s.logger.WithFields(logrus.Fields{
		"user_id": user.ID,
		"email":   req.Email,
	}).Info("Password reset requested")

	return nil
}

func (s *userService) ResetPassword(ctx context.Context, req *ResetPasswordRequest) error {
	redisKey := fmt.Sprintf("password_reset:%s", req.Token)
	userIDStr, err := s.redis.Get(ctx, redisKey).Result()
	if err != nil {
		return fmt.Errorf("invalid or expired reset token")
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return fmt.Errorf("invalid user ID in token: %w", err)
	}

	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	if err := validatePasswordStrength(req.NewPassword); err != nil {
		return fmt.Errorf("password validation failed: %w", err)
	}

	hashedPassword, err := hashPassword(req.NewPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.Password = hashedPassword
	now := time.Now()
	user.UpdatedAt = now

	if err := s.repo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	s.redis.Del(ctx, redisKey)
	s.LogActivity(ctx, userID, "password_reset", "user", userID.String(), nil)

	s.logger.WithFields(logrus.Fields{"user_id": userID}).Info("Password reset successfully")
	return nil
}

func (s *userService) GetUsers(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*User, int64, error) {
	return s.repo.List(ctx, filters, limit, offset)
}

func (s *userService) GetUserByID(ctx context.Context, userID uuid.UUID) (*User, error) {
	return s.repo.GetByID(ctx, userID)
}

func (s *userService) UpdateUserStatus(ctx context.Context, userID uuid.UUID, status string) error {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	oldStatus := user.Status
	user.Status = status

	if err := s.repo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update user status: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, userID, "status_updated", "user", userID.String(), map[string]interface{}{
		"old_status": oldStatus,
		"new_status": status,
	})

	s.logger.WithFields(logrus.Fields{
		"user_id":    userID,
		"old_status": oldStatus,
		"new_status": status,
	}).Info("User status updated successfully")

	return nil
}

func (s *userService) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	if err := s.repo.Delete(ctx, userID); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	// Log activity
	s.LogActivity(ctx, userID, "user_deleted", "user", userID.String(), map[string]interface{}{
		"email": user.Email,
		"role":  user.Role,
	})

	s.logger.WithFields(logrus.Fields{
		"user_id": userID,
		"email":   user.Email,
	}).Info("User deleted successfully")

	return nil
}

func (s *userService) LogActivity(ctx context.Context, userID uuid.UUID, action, resource, resourceID string, details map[string]interface{}) error {
	activity := &UserActivity{
		UserID:     userID,
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Details:    details,
		Status:     "success",
	}

	return s.repo.LogActivity(ctx, activity)
}

// Utility functions
func generateAgentCode() string {
	// Generate a unique agent code
	timestamp := time.Now().Unix()
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	hash := sha256.Sum256(append([]byte(strconv.FormatInt(timestamp, 10)), randomBytes...))
	return fmt.Sprintf("AGT%s", hex.EncodeToString(hash[:4]))
}

func getUpdatedFields(req *UpdateProfileRequest) []string {
	var fields []string
	if req.FirstName != "" {
		fields = append(fields, "first_name")
	}
	if req.LastName != "" {
		fields = append(fields, "last_name")
	}
	if req.MiddleName != "" {
		fields = append(fields, "middle_name")
	}
	if req.Phone != "" {
		fields = append(fields, "phone")
	}
	if req.DateOfBirth != "" {
		fields = append(fields, "date_of_birth")
	}
	if req.Gender != "" {
		fields = append(fields, "gender")
	}
	if req.StateOfOrigin != "" {
		fields = append(fields, "state_of_origin")
	}
	if req.StateOfResidence != "" {
		fields = append(fields, "state_of_residence")
	}
	if req.Address != "" {
		fields = append(fields, "address")
	}
	if req.Language != "" {
		fields = append(fields, "language")
	}
	if req.Timezone != "" {
		fields = append(fields, "timezone")
	}
	if req.Metadata != nil {
		fields = append(fields, "metadata")
	}
	return fields
}

// HTTP handlers
type UserHandler struct {
	service UserService
	logger  *logrus.Logger
}

func NewUserHandler(service UserService, logger *logrus.Logger) *UserHandler {
	return &UserHandler{
		service: service,
		logger:  logger,
	}
}

// Middleware
func (h *UserHandler) AuthMiddleware() gin.HandlerFunc {
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

func (h *UserHandler) RateLimitMiddleware() gin.HandlerFunc {
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

func (h *UserHandler) MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())

		requestsTotal.WithLabelValues(c.Request.Method, c.FullPath(), status).Inc()
		requestDuration.WithLabelValues(c.Request.Method, c.FullPath()).Observe(duration.Seconds())
	}
}

func (h *UserHandler) LoggingMiddleware() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
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
	})
}

// API handlers
func (h *UserHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.service.Register(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to register user")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"user":    user,
	})
}

func (h *UserHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := h.service.Login(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to login user")
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (h *UserHandler) RefreshToken(c *gin.Context) {
	var req RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := h.service.RefreshToken(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to refresh token")
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (h *UserHandler) GetProfile(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	user, err := h.service.GetProfile(c.Request.Context(), userID.(uuid.UUID))
	if err != nil {
		h.logger.WithError(err).Error("Failed to get user profile")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.service.UpdateProfile(c.Request.Context(), userID.(uuid.UUID), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to update user profile")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Profile updated successfully",
		"user":    user,
	})
}

func (h *UserHandler) ChangePassword(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ChangePassword(c.Request.Context(), userID.(uuid.UUID), &req); err != nil {
		h.logger.WithError(err).Error("Failed to change password")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
}

func (h *UserHandler) VerifyEmail(c *gin.Context) {
	var req VerifyEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.VerifyEmail(c.Request.Context(), &req); err != nil {
		h.logger.WithError(err).Error("Failed to verify email")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Email verified successfully"})
}

func (h *UserHandler) VerifyPhone(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req VerifyPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.VerifyPhone(c.Request.Context(), userID.(uuid.UUID), &req); err != nil {
		h.logger.WithError(err).Error("Failed to verify phone")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Phone verified successfully"})
}

func (h *UserHandler) ResendVerification(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req ResendVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ResendVerification(c.Request.Context(), userID.(uuid.UUID), &req); err != nil {
		h.logger.WithError(err).Error("Failed to resend verification")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Verification sent successfully"})
}

func (h *UserHandler) ForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ForgotPassword(c.Request.Context(), &req); err != nil {
		h.logger.WithError(err).Error("Failed to process forgot password")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset instructions sent"})
}

func (h *UserHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ResetPassword(c.Request.Context(), &req); err != nil {
		h.logger.WithError(err).Error("Failed to reset password")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
}

func (h *UserHandler) GetUsers(c *gin.Context) {
	// Parse query parameters
	limitStr := c.DefaultQuery("limit", "20")
	offsetStr := c.DefaultQuery("offset", "0")
	status := c.Query("status")
	role := c.Query("role")
	kycLevel := c.Query("kyc_level")
	emailVerified := c.Query("email_verified")
	phoneVerified := c.Query("phone_verified")
	search := c.Query("search")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 20
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	// Build filters
	filters := make(map[string]interface{})
	if status != "" {
		filters["status"] = status
	}
	if role != "" {
		filters["role"] = role
	}
	if kycLevel != "" {
		if level, err := strconv.Atoi(kycLevel); err == nil {
			filters["kyc_level"] = level
		}
	}
	if emailVerified != "" {
		if verified, err := strconv.ParseBool(emailVerified); err == nil {
			filters["email_verified"] = verified
		}
	}
	if phoneVerified != "" {
		if verified, err := strconv.ParseBool(phoneVerified); err == nil {
			filters["phone_verified"] = verified
		}
	}
	if search != "" {
		filters["search"] = search
	}

	users, total, err := h.service.GetUsers(c.Request.Context(), filters, limit, offset)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get users")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users":  users,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *UserHandler) GetUserByID(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	user, err := h.service.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get user by ID")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *UserHandler) UpdateUserStatus(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		Status string `json:"status" validate:"required,oneof=pending active suspended blocked closed"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateUserStatus(c.Request.Context(), userID, req.Status); err != nil {
		h.logger.WithError(err).Error("Failed to update user status")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User status updated successfully"})
}

func (h *UserHandler) DeleteUser(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if err := h.service.DeleteUser(c.Request.Context(), userID); err != nil {
		h.logger.WithError(err).Error("Failed to delete user")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

// Health check handler
func (h *UserHandler) HealthCheck(c *gin.Context) {
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
		"service":    "user-service",
		"version":    Version,
		"build_time": BuildTime,
		"git_commit": GitCommit,
		"go_version": GoVersion,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// Setup routes
func setupRoutes(handler *UserHandler) *gin.Engine {
	// Set Gin mode
	if cfg.Logging.Level == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Global middleware
	router.Use(handler.LoggingMiddleware())
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
		// Public endpoints
		auth := v1.Group("/auth")
		{
			auth.POST("/register", handler.Register)
			auth.POST("/login", handler.Login)
			auth.POST("/refresh", handler.RefreshToken)
			auth.POST("/forgot-password", handler.ForgotPassword)
			auth.POST("/reset-password", handler.ResetPassword)
			auth.POST("/verify-email", handler.VerifyEmail)
		}

		// Protected endpoints
		protected := v1.Group("/")
		protected.Use(handler.AuthMiddleware())
		{
			// User profile endpoints
			users := protected.Group("/users")
			{
				users.GET("/profile", handler.GetProfile)
				users.PUT("/profile", handler.UpdateProfile)
				users.POST("/change-password", handler.ChangePassword)
				users.POST("/verify-phone", handler.VerifyPhone)
				users.POST("/resend-verification", handler.ResendVerification)

				// Admin endpoints
				users.GET("/", handler.GetUsers)
				users.GET("/:id", handler.GetUserByID)
				users.PUT("/:id/status", handler.UpdateUserStatus)
				users.DELETE("/:id", handler.DeleteUser)
			}
		}
	}

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	return router
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
	}).Info("Starting User Service")

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

	// Initialize tracing
	if err := initTracing(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize tracing")
	}

	// Initialize messaging
	if err := initMessaging(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize messaging")
	}

	// Initialize services
	userRepo = NewUserRepository(db)
	userService = NewUserService(userRepo, redisClient, logger)

	// Initialize handlers
	userHandler := NewUserHandler(userService, logger)

	// Setup routes
	router := setupRoutes(userHandler)

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

