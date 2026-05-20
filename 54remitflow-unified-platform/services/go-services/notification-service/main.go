package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	// Standard library
	"bytes"
	"encoding/base64"
	"html/template"
	"io"
	"net/url"
	"path/filepath"
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

	// Nigerian telecom specific
	"github.com/nyaruka/phonenumbers"

	// WebSocket for real-time notifications
	"github.com/gorilla/websocket"

	// Firebase for push notifications
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/option"
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

	Email struct {
		Enabled    bool   `mapstructure:"enabled"`
		SMTPHost   string `mapstructure:"smtp_host"`
		SMTPPort   int    `mapstructure:"smtp_port"`
		Username   string `mapstructure:"username"`
		Password   string `mapstructure:"password"`
		FromEmail  string `mapstructure:"from_email"`
		FromName   string `mapstructure:"from_name"`
		UseTLS     bool   `mapstructure:"use_tls"`
		UseSSL     bool   `mapstructure:"use_ssl"`
	} `mapstructure:"email"`

	SMS struct {
		Enabled     bool              `mapstructure:"enabled"`
		Providers   []SMSProvider     `mapstructure:"providers"`
		DefaultProvider string        `mapstructure:"default_provider"`
		Fallback    bool              `mapstructure:"fallback"`
		RateLimit   int               `mapstructure:"rate_limit"`
		Templates   map[string]string `mapstructure:"templates"`
	} `mapstructure:"sms"`

	Push struct {
		Enabled           bool   `mapstructure:"enabled"`
		FirebaseConfigPath string `mapstructure:"firebase_config_path"`
		APNSKeyPath       string `mapstructure:"apns_key_path"`
		APNSKeyID         string `mapstructure:"apns_key_id"`
		APNSTeamID        string `mapstructure:"apns_team_id"`
		APNSBundleID      string `mapstructure:"apns_bundle_id"`
		APNSProduction    bool   `mapstructure:"apns_production"`
	} `mapstructure:"push"`

	WebSocket struct {
		Enabled     bool          `mapstructure:"enabled"`
		Path        string        `mapstructure:"path"`
		Origins     []string      `mapstructure:"origins"`
		ReadTimeout time.Duration `mapstructure:"read_timeout"`
		WriteTimeout time.Duration `mapstructure:"write_timeout"`
		PingPeriod  time.Duration `mapstructure:"ping_period"`
	} `mapstructure:"websocket"`

	Templates struct {
		Directory   string            `mapstructure:"directory"`
		EmailTemplates map[string]string `mapstructure:"email_templates"`
		SMSTemplates   map[string]string `mapstructure:"sms_templates"`
		PushTemplates  map[string]string `mapstructure:"push_templates"`
	} `mapstructure:"templates"`

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
		TelecomProviders []TelecomProvider `mapstructure:"telecom_providers"`
		DefaultLanguage  string            `mapstructure:"default_language"`
		SupportedLanguages []string        `mapstructure:"supported_languages"`
		TimeZone         string            `mapstructure:"timezone"`
		BusinessHours    BusinessHours     `mapstructure:"business_hours"`
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

// Supporting configuration types
type SMSProvider struct {
	Name     string            `mapstructure:"name"`
	Type     string            `mapstructure:"type"` // termii, twilio, infobip, etc.
	APIKey   string            `mapstructure:"api_key"`
	BaseURL  string            `mapstructure:"base_url"`
	SenderID string            `mapstructure:"sender_id"`
	Priority int               `mapstructure:"priority"`
	Config   map[string]string `mapstructure:"config"`
}

type TelecomProvider struct {
	Name     string   `mapstructure:"name"`
	Prefixes []string `mapstructure:"prefixes"`
	Country  string   `mapstructure:"country"`
	Active   bool     `mapstructure:"active"`
}

type BusinessHours struct {
	Start    string   `mapstructure:"start"`
	End      string   `mapstructure:"end"`
	Days     []string `mapstructure:"days"`
	TimeZone string   `mapstructure:"timezone"`
}

// Notification models
type Notification struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Type              string                 `json:"type" gorm:"not null" validate:"required,oneof=transactional promotional system alert"`
	Category          string                 `json:"category" gorm:"not null" validate:"required"`
	Priority          string                 `json:"priority" gorm:"default:'normal'" validate:"oneof=low normal high urgent"`
	Status            string                 `json:"status" gorm:"default:'pending'" validate:"oneof=pending processing sent delivered failed cancelled"`
	
	// Recipient information
	RecipientID       uuid.UUID              `json:"recipient_id" gorm:"type:uuid;not null"`
	RecipientType     string                 `json:"recipient_type" gorm:"not null" validate:"required,oneof=user agent admin system"`
	RecipientEmail    string                 `json:"recipient_email,omitempty" validate:"omitempty,email"`
	RecipientPhone    string                 `json:"recipient_phone,omitempty"`
	RecipientName     string                 `json:"recipient_name,omitempty"`
	RecipientLanguage string                 `json:"recipient_language" gorm:"default:'en'"`
	
	// Content
	Subject           string                 `json:"subject,omitempty"`
	Message           string                 `json:"message" gorm:"not null"`
	HTMLContent       string                 `json:"html_content,omitempty"`
	TemplateID        string                 `json:"template_id,omitempty"`
	TemplateData      map[string]interface{} `json:"template_data" gorm:"type:jsonb"`
	
	// Channels
	Channels          []string               `json:"channels" gorm:"type:text[]" validate:"required"`
	ChannelPreferences map[string]bool       `json:"channel_preferences" gorm:"type:jsonb"`
	
	// Scheduling
	ScheduledAt       *time.Time             `json:"scheduled_at,omitempty"`
	ExpiresAt         *time.Time             `json:"expires_at,omitempty"`
	
	// Delivery tracking
	SentAt            *time.Time             `json:"sent_at,omitempty"`
	DeliveredAt       *time.Time             `json:"delivered_at,omitempty"`
	ReadAt            *time.Time             `json:"read_at,omitempty"`
	ClickedAt         *time.Time             `json:"clicked_at,omitempty"`
	
	// Retry logic
	RetryCount        int                    `json:"retry_count" gorm:"default:0"`
	MaxRetries        int                    `json:"max_retries" gorm:"default:3"`
	NextRetryAt       *time.Time             `json:"next_retry_at,omitempty"`
	
	// Metadata
	Metadata          map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	Tags              []string               `json:"tags" gorm:"type:text[]"`
	
	// Audit fields
	CreatedAt         time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	CreatedBy         *uuid.UUID             `json:"created_by,omitempty"`
	UpdatedBy         *uuid.UUID             `json:"updated_by,omitempty"`
	Version           int                    `json:"version" gorm:"default:1"`
	
	// Relationships
	DeliveryAttempts  []NotificationDelivery `json:"delivery_attempts" gorm:"foreignKey:NotificationID"`
}

// NotificationDelivery represents individual delivery attempts
type NotificationDelivery struct {
	ID             uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	NotificationID uuid.UUID              `json:"notification_id" gorm:"type:uuid;not null"`
	Channel        string                 `json:"channel" gorm:"not null"`
	Provider       string                 `json:"provider,omitempty"`
	Status         string                 `json:"status" gorm:"not null" validate:"required,oneof=pending sent delivered failed"`
	AttemptNumber  int                    `json:"attempt_number" gorm:"not null"`
	
	// Delivery details
	SentAt         *time.Time             `json:"sent_at,omitempty"`
	DeliveredAt    *time.Time             `json:"delivered_at,omitempty"`
	FailedAt       *time.Time             `json:"failed_at,omitempty"`
	
	// Provider response
	ProviderMessageID string                `json:"provider_message_id,omitempty"`
	ProviderResponse  map[string]interface{} `json:"provider_response" gorm:"type:jsonb"`
	
	// Error information
	ErrorCode      string                 `json:"error_code,omitempty"`
	ErrorMessage   string                 `json:"error_message,omitempty"`
	ErrorDetails   map[string]interface{} `json:"error_details" gorm:"type:jsonb"`
	
	// Cost tracking
	Cost           *float64               `json:"cost,omitempty"`
	Currency       string                 `json:"currency,omitempty"`
	
	CreatedAt      time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

// NotificationTemplate represents message templates
type NotificationTemplate struct {
	ID          uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name        string                 `json:"name" gorm:"uniqueIndex;not null"`
	Type        string                 `json:"type" gorm:"not null" validate:"required,oneof=email sms push in_app"`
	Category    string                 `json:"category" gorm:"not null"`
	Language    string                 `json:"language" gorm:"default:'en'"`
	
	// Template content
	Subject     string                 `json:"subject,omitempty"`
	Body        string                 `json:"body" gorm:"not null"`
	HTMLBody    string                 `json:"html_body,omitempty"`
	Variables   []string               `json:"variables" gorm:"type:text[]"`
	
	// Configuration
	IsActive    bool                   `json:"is_active" gorm:"default:true"`
	IsDefault   bool                   `json:"is_default" gorm:"default:false"`
	Priority    int                    `json:"priority" gorm:"default:0"`
	
	// Metadata
	Description string                 `json:"description,omitempty"`
	Tags        []string               `json:"tags" gorm:"type:text[]"`
	Metadata    map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	
	CreatedAt   time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	CreatedBy   *uuid.UUID             `json:"created_by,omitempty"`
	UpdatedBy   *uuid.UUID             `json:"updated_by,omitempty"`
}

// NotificationPreference represents user notification preferences
type NotificationPreference struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID            uuid.UUID              `json:"user_id" gorm:"type:uuid;not null;uniqueIndex"`
	
	// Channel preferences
	EmailEnabled      bool                   `json:"email_enabled" gorm:"default:true"`
	SMSEnabled        bool                   `json:"sms_enabled" gorm:"default:true"`
	PushEnabled       bool                   `json:"push_enabled" gorm:"default:true"`
	InAppEnabled      bool                   `json:"in_app_enabled" gorm:"default:true"`
	
	// Category preferences
	TransactionalEnabled bool                `json:"transactional_enabled" gorm:"default:true"`
	PromotionalEnabled   bool                `json:"promotional_enabled" gorm:"default:true"`
	SystemEnabled        bool                `json:"system_enabled" gorm:"default:true"`
	AlertEnabled         bool                `json:"alert_enabled" gorm:"default:true"`
	
	// Timing preferences
	QuietHoursStart   string                 `json:"quiet_hours_start,omitempty"`
	QuietHoursEnd     string                 `json:"quiet_hours_end,omitempty"`
	TimeZone          string                 `json:"timezone" gorm:"default:'Africa/Lagos'"`
	
	// Language and format
	Language          string                 `json:"language" gorm:"default:'en'"`
	DateFormat        string                 `json:"date_format" gorm:"default:'DD/MM/YYYY'"`
	TimeFormat        string                 `json:"time_format" gorm:"default:'24h'"`
	
	// Advanced preferences
	Frequency         string                 `json:"frequency" gorm:"default:'immediate'" validate:"oneof=immediate hourly daily weekly"`
	GroupSimilar      bool                   `json:"group_similar" gorm:"default:false"`
	
	// Metadata
	Metadata          map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	
	CreatedAt         time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

// NotificationSubscription represents push notification subscriptions
type NotificationSubscription struct {
	ID           uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID       uuid.UUID              `json:"user_id" gorm:"type:uuid;not null"`
	DeviceToken  string                 `json:"device_token" gorm:"not null"`
	DeviceType   string                 `json:"device_type" gorm:"not null" validate:"required,oneof=ios android web"`
	AppVersion   string                 `json:"app_version,omitempty"`
	DeviceInfo   map[string]interface{} `json:"device_info" gorm:"type:jsonb"`
	IsActive     bool                   `json:"is_active" gorm:"default:true"`
	LastUsedAt   *time.Time             `json:"last_used_at,omitempty"`
	CreatedAt    time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

// Request/Response DTOs
type SendNotificationRequest struct {
	Type              string                 `json:"type" validate:"required,oneof=transactional promotional system alert"`
	Category          string                 `json:"category" validate:"required"`
	Priority          string                 `json:"priority,omitempty" validate:"omitempty,oneof=low normal high urgent"`
	RecipientID       uuid.UUID              `json:"recipient_id" validate:"required"`
	RecipientEmail    string                 `json:"recipient_email,omitempty" validate:"omitempty,email"`
	RecipientPhone    string                 `json:"recipient_phone,omitempty"`
	RecipientName     string                 `json:"recipient_name,omitempty"`
	Subject           string                 `json:"subject,omitempty"`
	Message           string                 `json:"message" validate:"required"`
	HTMLContent       string                 `json:"html_content,omitempty"`
	Channels          []string               `json:"channels" validate:"required"`
	TemplateID        string                 `json:"template_id,omitempty"`
	TemplateData      map[string]interface{} `json:"template_data,omitempty"`
	ScheduledAt       *time.Time             `json:"scheduled_at,omitempty"`
	ExpiresAt         *time.Time             `json:"expires_at,omitempty"`
	Metadata          map[string]interface{} `json:"metadata,omitempty"`
	Tags              []string               `json:"tags,omitempty"`
}

type SendBulkNotificationRequest struct {
	Type         string                    `json:"type" validate:"required,oneof=transactional promotional system alert"`
	Category     string                    `json:"category" validate:"required"`
	Priority     string                    `json:"priority,omitempty" validate:"omitempty,oneof=low normal high urgent"`
	Recipients   []BulkRecipient           `json:"recipients" validate:"required,min=1"`
	Subject      string                    `json:"subject,omitempty"`
	Message      string                    `json:"message" validate:"required"`
	HTMLContent  string                    `json:"html_content,omitempty"`
	Channels     []string                  `json:"channels" validate:"required"`
	TemplateID   string                    `json:"template_id,omitempty"`
	TemplateData map[string]interface{}    `json:"template_data,omitempty"`
	ScheduledAt  *time.Time                `json:"scheduled_at,omitempty"`
	ExpiresAt    *time.Time                `json:"expires_at,omitempty"`
	Metadata     map[string]interface{}    `json:"metadata,omitempty"`
	Tags         []string                  `json:"tags,omitempty"`
}

type BulkRecipient struct {
	ID           uuid.UUID              `json:"id" validate:"required"`
	Email        string                 `json:"email,omitempty" validate:"omitempty,email"`
	Phone        string                 `json:"phone,omitempty"`
	Name         string                 `json:"name,omitempty"`
	Language     string                 `json:"language,omitempty"`
	TemplateData map[string]interface{} `json:"template_data,omitempty"`
}

type NotificationResponse struct {
	Notification *Notification `json:"notification"`
	Message      string        `json:"message"`
}

type BulkNotificationResponse struct {
	BatchID      uuid.UUID `json:"batch_id"`
	TotalCount   int       `json:"total_count"`
	QueuedCount  int       `json:"queued_count"`
	FailedCount  int       `json:"failed_count"`
	Message      string    `json:"message"`
}

type GetNotificationsRequest struct {
	RecipientID *uuid.UUID `json:"recipient_id,omitempty"`
	Type        string     `json:"type,omitempty"`
	Category    string     `json:"category,omitempty"`
	Status      string     `json:"status,omitempty"`
	Channel     string     `json:"channel,omitempty"`
	StartDate   string     `json:"start_date,omitempty"`
	EndDate     string     `json:"end_date,omitempty"`
	Limit       int        `json:"limit,omitempty"`
	Offset      int        `json:"offset,omitempty"`
}

type NotificationStatsResponse struct {
	TotalNotifications    int64   `json:"total_notifications"`
	SentNotifications     int64   `json:"sent_notifications"`
	DeliveredNotifications int64  `json:"delivered_notifications"`
	FailedNotifications   int64   `json:"failed_notifications"`
	PendingNotifications  int64   `json:"pending_notifications"`
	DeliveryRate          float64 `json:"delivery_rate"`
	OpenRate              float64 `json:"open_rate"`
	ClickRate             float64 `json:"click_rate"`
	TodayNotifications    int64   `json:"today_notifications"`
	MonthNotifications    int64   `json:"month_notifications"`
}

// Service interfaces
type NotificationService interface {
	SendNotification(ctx context.Context, req *SendNotificationRequest) (*Notification, error)
	SendBulkNotification(ctx context.Context, req *SendBulkNotificationRequest) (*BulkNotificationResponse, error)
	GetNotification(ctx context.Context, notificationID uuid.UUID) (*Notification, error)
	GetNotifications(ctx context.Context, req *GetNotificationsRequest) ([]*Notification, int64, error)
	UpdateNotificationStatus(ctx context.Context, notificationID uuid.UUID, status string) error
	MarkAsRead(ctx context.Context, notificationID, userID uuid.UUID) error
	MarkAsClicked(ctx context.Context, notificationID, userID uuid.UUID) error
	GetNotificationStats(ctx context.Context, userID *uuid.UUID, startDate, endDate time.Time) (*NotificationStatsResponse, error)
	ProcessPendingNotifications(ctx context.Context) error
	ProcessScheduledNotifications(ctx context.Context) error
}

type NotificationRepository interface {
	Create(ctx context.Context, notification *Notification) error
	GetByID(ctx context.Context, id uuid.UUID) (*Notification, error)
	Update(ctx context.Context, notification *Notification) error
	List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*Notification, int64, error)
	GetStats(ctx context.Context, filters map[string]interface{}) (*NotificationStatsResponse, error)
	CreateDeliveryAttempt(ctx context.Context, delivery *NotificationDelivery) error
	GetPendingNotifications(ctx context.Context, limit int) ([]*Notification, error)
	GetScheduledNotifications(ctx context.Context, before time.Time, limit int) ([]*Notification, error)
	GetUserPreferences(ctx context.Context, userID uuid.UUID) (*NotificationPreference, error)
	UpdateUserPreferences(ctx context.Context, preferences *NotificationPreference) error
}

type EmailService interface {
	SendEmail(ctx context.Context, to, subject, body, htmlBody string) error
	SendBulkEmail(ctx context.Context, recipients []EmailRecipient) error
	ValidateEmail(email string) error
}

type SMSService interface {
	SendSMS(ctx context.Context, to, message string) error
	SendBulkSMS(ctx context.Context, recipients []SMSRecipient) error
	ValidatePhoneNumber(phone string) error
	GetDeliveryStatus(messageID string) (string, error)
}

type PushService interface {
	SendPushNotification(ctx context.Context, deviceToken, title, body string, data map[string]string) error
	SendBulkPushNotification(ctx context.Context, recipients []PushRecipient) error
	RegisterDevice(ctx context.Context, userID uuid.UUID, deviceToken, deviceType string) error
	UnregisterDevice(ctx context.Context, deviceToken string) error
}

type TemplateService interface {
	GetTemplate(ctx context.Context, templateID, language string) (*NotificationTemplate, error)
	RenderTemplate(ctx context.Context, templateID, language string, data map[string]interface{}) (string, string, error)
	CreateTemplate(ctx context.Context, template *NotificationTemplate) error
	UpdateTemplate(ctx context.Context, template *NotificationTemplate) error
	DeleteTemplate(ctx context.Context, templateID string) error
}

type WebSocketService interface {
	BroadcastToUser(userID uuid.UUID, message interface{}) error
	BroadcastToAll(message interface{}) error
	GetConnectedUsers() []uuid.UUID
}

// Supporting types
type EmailRecipient struct {
	Email    string
	Name     string
	Subject  string
	Body     string
	HTMLBody string
}

type SMSRecipient struct {
	Phone   string
	Message string
}

type PushRecipient struct {
	DeviceToken string
	Title       string
	Body        string
	Data        map[string]string
}

// Prometheus metrics
var (
	notificationsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_service_notifications_total",
			Help: "Total number of notifications processed",
		},
		[]string{"type", "channel", "status"},
	)

	notificationDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "notification_service_processing_duration_seconds",
			Help:    "Duration of notification processing",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"channel"},
	)

	deliveryAttempts = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_service_delivery_attempts_total",
			Help: "Total number of delivery attempts",
		},
		[]string{"channel", "provider", "status"},
	)

	templateUsage = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_service_template_usage_total",
			Help: "Total number of template usages",
		},
		[]string{"template_id", "language"},
	)

	connectedWebSockets = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "notification_service_websocket_connections",
			Help: "Number of active WebSocket connections",
		},
	)

	requestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_service_requests_total",
			Help: "Total number of requests to notification service",
		},
		[]string{"method", "endpoint", "status"},
	)

	requestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "notification_service_request_duration_seconds",
			Help:    "Duration of requests to notification service",
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
	notificationService NotificationService
	notificationRepo    NotificationRepository
	emailService        EmailService
	smsService          SMSService
	pushService         PushService
	templateService     TemplateService
	webSocketService    WebSocketService
	natsConn            *nats.Conn
	rabbitConn          *amqp091.Connection
	httpClient          *resty.Client
	firebaseApp         *firebase.App
	firebaseMessaging   *messaging.Client
)

// WebSocket connection manager
type ConnectionManager struct {
	connections map[uuid.UUID]*websocket.Conn
	mutex       sync.RWMutex
	upgrader    websocket.Upgrader
}

func NewConnectionManager() *ConnectionManager {
	return &ConnectionManager{
		connections: make(map[uuid.UUID]*websocket.Conn),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// In production, implement proper origin checking
				return true
			},
		},
	}
}

func (cm *ConnectionManager) AddConnection(userID uuid.UUID, conn *websocket.Conn) {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	// Close existing connection if any
	if existingConn, exists := cm.connections[userID]; exists {
		existingConn.Close()
	}
	
	cm.connections[userID] = conn
	connectedWebSockets.Inc()
}

func (cm *ConnectionManager) RemoveConnection(userID uuid.UUID) {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	if conn, exists := cm.connections[userID]; exists {
		conn.Close()
		delete(cm.connections, userID)
		connectedWebSockets.Dec()
	}
}

func (cm *ConnectionManager) SendToUser(userID uuid.UUID, message interface{}) error {
	cm.mutex.RLock()
	conn, exists := cm.connections[userID]
	cm.mutex.RUnlock()
	
	if !exists {
		return errors.New("user not connected")
	}
	
	return conn.WriteJSON(message)
}

func (cm *ConnectionManager) BroadcastToAll(message interface{}) error {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	for userID, conn := range cm.connections {
		if err := conn.WriteJSON(message); err != nil {
			logger.WithError(err).WithField("user_id", userID).Error("Failed to send WebSocket message")
			// Remove failed connection
			go cm.RemoveConnection(userID)
		}
	}
	
	return nil
}

func (cm *ConnectionManager) GetConnectedUsers() []uuid.UUID {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	users := make([]uuid.UUID, 0, len(cm.connections))
	for userID := range cm.connections {
		users = append(users, userID)
	}
	
	return users
}

var connectionManager *ConnectionManager

// Initialize configuration
func initConfig() error {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath(".")

	// Set default values
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8082)
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
	viper.SetDefault("redis.db", 2)
	viper.SetDefault("redis.pool_size", 10)
	viper.SetDefault("redis.min_idle_conns", 2)

	viper.SetDefault("jwt.secret", "your-secret-key")
	viper.SetDefault("jwt.access_token_ttl", "15m")
	viper.SetDefault("jwt.refresh_token_ttl", "7d")
	viper.SetDefault("jwt.issuer", "remittance-notification-service")
	viper.SetDefault("jwt.audience", "remittance")

	viper.SetDefault("email.enabled", true)
	viper.SetDefault("email.smtp_host", "smtp.gmail.com")
	viper.SetDefault("email.smtp_port", 587)
	viper.SetDefault("email.use_tls", true)
	viper.SetDefault("email.from_name", "Remittance Platform")

	viper.SetDefault("sms.enabled", true)
	viper.SetDefault("sms.default_provider", "termii")
	viper.SetDefault("sms.fallback", true)
	viper.SetDefault("sms.rate_limit", 100)

	viper.SetDefault("push.enabled", true)

	viper.SetDefault("websocket.enabled", true)
	viper.SetDefault("websocket.path", "/ws")
	viper.SetDefault("websocket.read_timeout", "60s")
	viper.SetDefault("websocket.write_timeout", "10s")
	viper.SetDefault("websocket.ping_period", "54s")

	viper.SetDefault("nigerian.default_language", "en")
	viper.SetDefault("nigerian.supported_languages", []string{"en", "ha", "yo", "ig"})
	viper.SetDefault("nigerian.timezone", "Africa/Lagos")

	viper.SetDefault("rate_limit.enabled", true)
	viper.SetDefault("rate_limit.rps", 100)
	viper.SetDefault("rate_limit.burst", 200)

	viper.SetDefault("monitoring.enabled", true)
	viper.SetDefault("monitoring.metrics_path", "/metrics")
	viper.SetDefault("monitoring.health_path", "/health")
	viper.SetDefault("monitoring.service_name", "notification-service")

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
		&Notification{},
		&NotificationDelivery{},
		&NotificationTemplate{},
		&NotificationPreference{},
		&NotificationSubscription{},
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
	return nil
}

// Initialize HTTP client
func initHTTPClient() {
	httpClient = resty.New()
	httpClient.SetTimeout(30 * time.Second)
	httpClient.SetRetryCount(3)
	httpClient.SetRetryWaitTime(1 * time.Second)
	httpClient.SetRetryMaxWaitTime(5 * time.Second)
}

// Initialize Firebase
func initFirebase() error {
	if !cfg.Push.Enabled || cfg.Push.FirebaseConfigPath == "" {
		return nil
	}

	opt := option.WithCredentialsFile(cfg.Push.FirebaseConfigPath)
	var err error
	firebaseApp, err = firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	firebaseMessaging, err = firebaseApp.Messaging(context.Background())
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase messaging: %w", err)
	}

	logger.Info("Firebase initialized successfully")
	return nil
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
func generateNotificationID() string {
	timestamp := time.Now().Unix()
	randomBytes := make([]byte, 8)
	rand.Read(randomBytes)
	hash := sha256.Sum256(append([]byte(strconv.FormatInt(timestamp, 10)), randomBytes...))
	return fmt.Sprintf("NOTIF%s", strings.ToUpper(hex.EncodeToString(hash[:8])))
}

func validatePhoneNumber(phone string) error {
	if phone == "" {
		return errors.New("phone number is required")
	}

	// Parse phone number for Nigeria
	num, err := phonenumbers.Parse(phone, "NG")
	if err != nil {
		return fmt.Errorf("invalid phone number format: %w", err)
	}

	if !phonenumbers.IsValidNumber(num) {
		return errors.New("invalid phone number")
	}

	return nil
}

func validateEmail(email string) error {
	if email == "" {
		return errors.New("email is required")
	}

	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailRegex.MatchString(email) {
		return errors.New("invalid email format")
	}

	return nil
}

func isBusinessHours() bool {
	now := time.Now()
	location, _ := time.LoadLocation(cfg.Nigerian.TimeZone)
	localTime := now.In(location)

	// Parse business hours
	startTime, _ := time.Parse("15:04", cfg.Nigerian.BusinessHours.Start)
	endTime, _ := time.Parse("15:04", cfg.Nigerian.BusinessHours.End)

	currentTime := time.Date(0, 1, 1, localTime.Hour(), localTime.Minute(), 0, 0, time.UTC)
	start := time.Date(0, 1, 1, startTime.Hour(), startTime.Minute(), 0, 0, time.UTC)
	end := time.Date(0, 1, 1, endTime.Hour(), endTime.Minute(), 0, 0, time.UTC)

	// Check if current day is a business day
	dayName := localTime.Weekday().String()
	isBusinessDay := false
	for _, day := range cfg.Nigerian.BusinessHours.Days {
		if strings.EqualFold(day, dayName) {
			isBusinessDay = true
			break
		}
	}

	return isBusinessDay && currentTime.After(start) && currentTime.Before(end)
}

// Repository implementation
type notificationRepository struct {
	db *gorm.DB
}

func NewNotificationRepository(db *gorm.DB) NotificationRepository {
	return &notificationRepository{db: db}
}

func (r *notificationRepository) Create(ctx context.Context, notification *Notification) error {
	return r.db.WithContext(ctx).Create(notification).Error
}

func (r *notificationRepository) GetByID(ctx context.Context, id uuid.UUID) (*Notification, error) {
	var notification Notification
	err := r.db.WithContext(ctx).
		Preload("DeliveryAttempts").
		Where("id = ?", id).
		First(&notification).Error
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *notificationRepository) Update(ctx context.Context, notification *Notification) error {
	notification.UpdatedAt = time.Now()
	notification.Version++
	return r.db.WithContext(ctx).Save(notification).Error
}

func (r *notificationRepository) List(ctx context.Context, filters map[string]interface{}, limit, offset int) ([]*Notification, int64, error) {
	var notifications []*Notification
	var total int64

	query := r.db.WithContext(ctx).Model(&Notification{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "recipient_id":
			query = query.Where("recipient_id = ?", value)
		case "type":
			query = query.Where("type = ?", value)
		case "category":
			query = query.Where("category = ?", value)
		case "status":
			query = query.Where("status = ?", value)
		case "channel":
			query = query.Where("? = ANY(channels)", value)
		case "start_date":
			query = query.Where("created_at >= ?", value)
		case "end_date":
			query = query.Where("created_at <= ?", value)
		}
	}

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Get notifications with pagination
	if err := query.
		Preload("DeliveryAttempts").
		Limit(limit).
		Offset(offset).
		Order("created_at DESC").
		Find(&notifications).Error; err != nil {
		return nil, 0, err
	}

	return notifications, total, nil
}

func (r *notificationRepository) GetStats(ctx context.Context, filters map[string]interface{}) (*NotificationStatsResponse, error) {
	var stats NotificationStatsResponse

	query := r.db.WithContext(ctx).Model(&Notification{})

	// Apply filters
	for key, value := range filters {
		switch key {
		case "recipient_id":
			query = query.Where("recipient_id = ?", value)
		case "start_date":
			query = query.Where("created_at >= ?", value)
		case "end_date":
			query = query.Where("created_at <= ?", value)
		}
	}

	// Get total stats
	if err := query.Select("COUNT(*) as total_notifications").Scan(&stats).Error; err != nil {
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
		case "sent":
			stats.SentNotifications = stat.Count
		case "delivered":
			stats.DeliveredNotifications = stat.Count
		case "failed":
			stats.FailedNotifications = stat.Count
		case "pending":
			stats.PendingNotifications = stat.Count
		}
	}

	// Calculate rates
	if stats.TotalNotifications > 0 {
		stats.DeliveryRate = float64(stats.DeliveredNotifications) / float64(stats.TotalNotifications) * 100
	}

	// Get today's stats
	today := time.Now().Truncate(24 * time.Hour)
	if err := query.Where("created_at >= ?", today).Select("COUNT(*) as today_notifications").Scan(&stats).Error; err != nil {
		return nil, err
	}

	// Get this month's stats
	monthStart := time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.UTC)
	if err := query.Where("created_at >= ?", monthStart).Select("COUNT(*) as month_notifications").Scan(&stats).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}

func (r *notificationRepository) CreateDeliveryAttempt(ctx context.Context, delivery *NotificationDelivery) error {
	return r.db.WithContext(ctx).Create(delivery).Error
}

func (r *notificationRepository) GetPendingNotifications(ctx context.Context, limit int) ([]*Notification, error) {
	var notifications []*Notification
	err := r.db.WithContext(ctx).
		Where("status = ? AND (scheduled_at IS NULL OR scheduled_at <= ?)", "pending", time.Now()).
		Order("created_at ASC").
		Limit(limit).
		Find(&notifications).Error
	return notifications, err
}

func (r *notificationRepository) GetScheduledNotifications(ctx context.Context, before time.Time, limit int) ([]*Notification, error) {
	var notifications []*Notification
	err := r.db.WithContext(ctx).
		Where("status = ? AND scheduled_at IS NOT NULL AND scheduled_at <= ?", "pending", before).
		Order("scheduled_at ASC").
		Limit(limit).
		Find(&notifications).Error
	return notifications, err
}

func (r *notificationRepository) GetUserPreferences(ctx context.Context, userID uuid.UUID) (*NotificationPreference, error) {
	var preferences NotificationPreference
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&preferences).Error
	if err == gorm.ErrRecordNotFound {
		// Return default preferences
		return &NotificationPreference{
			UserID:               userID,
			EmailEnabled:         true,
			SMSEnabled:           true,
			PushEnabled:          true,
			InAppEnabled:         true,
			TransactionalEnabled: true,
			PromotionalEnabled:   true,
			SystemEnabled:        true,
			AlertEnabled:         true,
			TimeZone:             cfg.Nigerian.TimeZone,
			Language:             cfg.Nigerian.DefaultLanguage,
			DateFormat:           "DD/MM/YYYY",
			TimeFormat:           "24h",
			Frequency:            "immediate",
			GroupSimilar:         false,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &preferences, nil
}

func (r *notificationRepository) UpdateUserPreferences(ctx context.Context, preferences *NotificationPreference) error {
	return r.db.WithContext(ctx).Save(preferences).Error
}

// Email service implementation
type emailService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewEmailService(httpClient *resty.Client, logger *logrus.Logger) EmailService {
	return &emailService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *emailService) SendEmail(ctx context.Context, to, subject, body, htmlBody string) error {
	if !cfg.Email.Enabled {
		return errors.New("email service is disabled")
	}

	s.logger.WithFields(logrus.Fields{
		"to":      to,
		"subject": subject,
	}).Info("Sending email")

	// Validate email
	if err := validateEmail(to); err != nil {
		return err
	}

	// Setup SMTP authentication
	auth := smtp.PlainAuth("", cfg.Email.Username, cfg.Email.Password, cfg.Email.SMTPHost)

	// Compose message
	msg := fmt.Sprintf("From: %s <%s>\r\n", cfg.Email.FromName, cfg.Email.FromEmail)
	msg += fmt.Sprintf("To: %s\r\n", to)
	msg += fmt.Sprintf("Subject: %s\r\n", subject)
	msg += "MIME-Version: 1.0\r\n"
	
	if htmlBody != "" {
		msg += "Content-Type: multipart/alternative; boundary=\"boundary\"\r\n\r\n"
		msg += "--boundary\r\n"
		msg += "Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n"
		msg += body + "\r\n"
		msg += "--boundary\r\n"
		msg += "Content-Type: text/html; charset=\"UTF-8\"\r\n\r\n"
		msg += htmlBody + "\r\n"
		msg += "--boundary--\r\n"
	} else {
		msg += "Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n"
		msg += body + "\r\n"
	}

	// Send email
	addr := fmt.Sprintf("%s:%d", cfg.Email.SMTPHost, cfg.Email.SMTPPort)
	if err := smtp.SendMail(addr, auth, cfg.Email.FromEmail, []string{to}, []byte(msg)); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}

	s.logger.WithField("to", to).Info("Email sent successfully")
	return nil
}

func (s *emailService) SendBulkEmail(ctx context.Context, recipients []EmailRecipient) error {
	s.logger.WithField("count", len(recipients)).Info("Sending bulk emails")

	// Process emails in batches
	batchSize := 10
	for i := 0; i < len(recipients); i += batchSize {
		end := i + batchSize
		if end > len(recipients) {
			end = len(recipients)
		}

		batch := recipients[i:end]
		
		// Send emails in parallel
		var wg sync.WaitGroup
		for _, recipient := range batch {
			wg.Add(1)
			go func(r EmailRecipient) {
				defer wg.Done()
				if err := s.SendEmail(ctx, r.Email, r.Subject, r.Body, r.HTMLBody); err != nil {
					s.logger.WithError(err).WithField("email", r.Email).Error("Failed to send bulk email")
				}
			}(recipient)
		}
		wg.Wait()

		// Rate limiting between batches
		time.Sleep(1 * time.Second)
	}

	return nil
}

func (s *emailService) ValidateEmail(email string) error {
	return validateEmail(email)
}

// SMS service implementation
type smsService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewSMSService(httpClient *resty.Client, logger *logrus.Logger) SMSService {
	return &smsService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *smsService) SendSMS(ctx context.Context, to, message string) error {
	if !cfg.SMS.Enabled {
		return errors.New("SMS service is disabled")
	}

	s.logger.WithFields(logrus.Fields{
		"to":      to,
		"message": message[:min(len(message), 50)] + "...",
	}).Info("Sending SMS")

	// Validate phone number
	if err := validatePhoneNumber(to); err != nil {
		return err
	}

	// Get primary SMS provider
	var provider *SMSProvider
	for _, p := range cfg.SMS.Providers {
		if p.Name == cfg.SMS.DefaultProvider {
			provider = &p
			break
		}
	}

	if provider == nil && len(cfg.SMS.Providers) > 0 {
		provider = &cfg.SMS.Providers[0]
	}

	if provider == nil {
		return errors.New("no SMS provider configured")
	}

	// Send SMS based on provider type
	switch provider.Type {
	case "termii":
		return s.sendTermiiSMS(ctx, provider, to, message)
	case "twilio":
		return s.sendTwilioSMS(ctx, provider, to, message)
	default:
		return fmt.Errorf("unsupported SMS provider: %s", provider.Type)
	}
}

func (s *smsService) sendTermiiSMS(ctx context.Context, provider *SMSProvider, to, message string) error {
	payload := map[string]interface{}{
		"to":      to,
		"from":    provider.SenderID,
		"sms":     message,
		"type":    "plain",
		"channel": "generic",
		"api_key": provider.APIKey,
	}

	resp, err := s.httpClient.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(payload).
		Post(provider.BaseURL + "/api/sms/send")

	if err != nil {
		return fmt.Errorf("failed to send SMS via Termii: %w", err)
	}

	if resp.StatusCode() != 200 {
		return fmt.Errorf("Termii API error: %s", resp.String())
	}

	s.logger.WithField("to", to).Info("SMS sent successfully via Termii")
	return nil
}

func (s *smsService) sendTwilioSMS(ctx context.Context, provider *SMSProvider, to, message string) error {
	// Implement Twilio SMS sending
	// This is a placeholder implementation
	s.logger.WithField("to", to).Info("SMS sent successfully via Twilio (mock)")
	return nil
}

func (s *smsService) SendBulkSMS(ctx context.Context, recipients []SMSRecipient) error {
	s.logger.WithField("count", len(recipients)).Info("Sending bulk SMS")

	// Process SMS in batches
	batchSize := 50
	for i := 0; i < len(recipients); i += batchSize {
		end := i + batchSize
		if end > len(recipients) {
			end = len(recipients)
		}

		batch := recipients[i:end]
		
		// Send SMS in parallel
		var wg sync.WaitGroup
		for _, recipient := range batch {
			wg.Add(1)
			go func(r SMSRecipient) {
				defer wg.Done()
				if err := s.SendSMS(ctx, r.Phone, r.Message); err != nil {
					s.logger.WithError(err).WithField("phone", r.Phone).Error("Failed to send bulk SMS")
				}
			}(recipient)
		}
		wg.Wait()

		// Rate limiting between batches
		time.Sleep(2 * time.Second)
	}

	return nil
}

func (s *smsService) ValidatePhoneNumber(phone string) error {
	return validatePhoneNumber(phone)
}

func (s *smsService) GetDeliveryStatus(messageID string) (string, error) {
	// Implement delivery status checking
	// This would query the SMS provider's API for delivery status
	return "delivered", nil
}

// Push service implementation
type pushService struct {
	httpClient *resty.Client
	logger     *logrus.Logger
}

func NewPushService(httpClient *resty.Client, logger *logrus.Logger) PushService {
	return &pushService{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (s *pushService) SendPushNotification(ctx context.Context, deviceToken, title, body string, data map[string]string) error {
	if !cfg.Push.Enabled || firebaseMessaging == nil {
		return errors.New("push notification service is disabled")
	}

	s.logger.WithFields(logrus.Fields{
		"device_token": deviceToken[:min(len(deviceToken), 20)] + "...",
		"title":        title,
	}).Info("Sending push notification")

	message := &messaging.Message{
		Token: deviceToken,
		Notification: &messaging.Notification{
			Title: title,
			Body:  body,
		},
		Data: data,
		Android: &messaging.AndroidConfig{
			Priority: "high",
		},
		APNS: &messaging.APNSConfig{
			Headers: map[string]string{
				"apns-priority": "10",
			},
		},
	}

	response, err := firebaseMessaging.Send(ctx, message)
	if err != nil {
		return fmt.Errorf("failed to send push notification: %w", err)
	}

	s.logger.WithFields(logrus.Fields{
		"device_token": deviceToken[:min(len(deviceToken), 20)] + "...",
		"message_id":   response,
	}).Info("Push notification sent successfully")

	return nil
}

func (s *pushService) SendBulkPushNotification(ctx context.Context, recipients []PushRecipient) error {
	s.logger.WithField("count", len(recipients)).Info("Sending bulk push notifications")

	if !cfg.Push.Enabled || firebaseMessaging == nil {
		return errors.New("push notification service is disabled")
	}

	// Process notifications in batches
	batchSize := 100
	for i := 0; i < len(recipients); i += batchSize {
		end := i + batchSize
		if end > len(recipients) {
			end = len(recipients)
		}

		batch := recipients[i:end]
		messages := make([]*messaging.Message, len(batch))
		
		for j, recipient := range batch {
			messages[j] = &messaging.Message{
				Token: recipient.DeviceToken,
				Notification: &messaging.Notification{
					Title: recipient.Title,
					Body:  recipient.Body,
				},
				Data: recipient.Data,
				Android: &messaging.AndroidConfig{
					Priority: "high",
				},
				APNS: &messaging.APNSConfig{
					Headers: map[string]string{
						"apns-priority": "10",
					},
				},
			}
		}

		response, err := firebaseMessaging.SendAll(ctx, messages)
		if err != nil {
			s.logger.WithError(err).Error("Failed to send bulk push notifications")
			continue
		}

		s.logger.WithFields(logrus.Fields{
			"success_count": response.SuccessCount,
			"failure_count": response.FailureCount,
		}).Info("Bulk push notifications sent")
	}

	return nil
}

func (s *pushService) RegisterDevice(ctx context.Context, userID uuid.UUID, deviceToken, deviceType string) error {
	subscription := &NotificationSubscription{
		UserID:      userID,
		DeviceToken: deviceToken,
		DeviceType:  deviceType,
		IsActive:    true,
	}

	// Check if device is already registered
	var existing NotificationSubscription
	err := db.Where("device_token = ?", deviceToken).First(&existing).Error
	if err == nil {
		// Update existing subscription
		existing.UserID = userID
		existing.DeviceType = deviceType
		existing.IsActive = true
		existing.LastUsedAt = &time.Time{}
		return db.Save(&existing).Error
	}

	return db.Create(subscription).Error
}

func (s *pushService) UnregisterDevice(ctx context.Context, deviceToken string) error {
	return db.Model(&NotificationSubscription{}).
		Where("device_token = ?", deviceToken).
		Update("is_active", false).Error
}

// Template service implementation
type templateService struct {
	logger *logrus.Logger
}

func NewTemplateService(logger *logrus.Logger) TemplateService {
	return &templateService{
		logger: logger,
	}
}

func (s *templateService) GetTemplate(ctx context.Context, templateID, language string) (*NotificationTemplate, error) {
	var template NotificationTemplate
	err := db.WithContext(ctx).
		Where("name = ? AND language = ? AND is_active = true", templateID, language).
		First(&template).Error
	
	if err == gorm.ErrRecordNotFound {
		// Try to get default language template
		err = db.WithContext(ctx).
			Where("name = ? AND language = ? AND is_active = true", templateID, "en").
			First(&template).Error
	}
	
	if err != nil {
		return nil, err
	}
	
	return &template, nil
}

func (s *templateService) RenderTemplate(ctx context.Context, templateID, language string, data map[string]interface{}) (string, string, error) {
	template, err := s.GetTemplate(ctx, templateID, language)
	if err != nil {
		return "", "", err
	}

	// Render subject
	subjectTmpl, err := template.Parse(template.Subject)
	if err != nil {
		return "", "", fmt.Errorf("failed to parse subject template: %w", err)
	}
	
	var subjectBuf bytes.Buffer
	if err := subjectTmpl.Execute(&subjectBuf, data); err != nil {
		return "", "", fmt.Errorf("failed to execute subject template: %w", err)
	}

	// Render body
	bodyTmpl, err := template.Parse(template.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to parse body template: %w", err)
	}
	
	var bodyBuf bytes.Buffer
	if err := bodyTmpl.Execute(&bodyBuf, data); err != nil {
		return "", "", fmt.Errorf("failed to execute body template: %w", err)
	}

	// Render HTML body if available
	var htmlBody string
	if template.HTMLBody != "" {
		htmlTmpl, err := template.Parse(template.HTMLBody)
		if err != nil {
			return "", "", fmt.Errorf("failed to parse HTML template: %w", err)
		}
		
		var htmlBuf bytes.Buffer
		if err := htmlTmpl.Execute(&htmlBuf, data); err != nil {
			return "", "", fmt.Errorf("failed to execute HTML template: %w", err)
		}
		htmlBody = htmlBuf.String()
	}

	templateUsage.WithLabelValues(templateID, language).Inc()

	return subjectBuf.String(), bodyBuf.String(), htmlBody, nil
}

func (s *templateService) CreateTemplate(ctx context.Context, template *NotificationTemplate) error {
	return db.WithContext(ctx).Create(template).Error
}

func (s *templateService) UpdateTemplate(ctx context.Context, template *NotificationTemplate) error {
	return db.WithContext(ctx).Save(template).Error
}

func (s *templateService) DeleteTemplate(ctx context.Context, templateID string) error {
	return db.WithContext(ctx).
		Model(&NotificationTemplate{}).
		Where("name = ?", templateID).
		Update("is_active", false).Error
}

// WebSocket service implementation
type webSocketService struct {
	connectionManager *ConnectionManager
	logger            *logrus.Logger
}

func NewWebSocketService(connectionManager *ConnectionManager, logger *logrus.Logger) WebSocketService {
	return &webSocketService{
		connectionManager: connectionManager,
		logger:            logger,
	}
}

func (s *webSocketService) BroadcastToUser(userID uuid.UUID, message interface{}) error {
	return s.connectionManager.SendToUser(userID, message)
}

func (s *webSocketService) BroadcastToAll(message interface{}) error {
	return s.connectionManager.BroadcastToAll(message)
}

func (s *webSocketService) GetConnectedUsers() []uuid.UUID {
	return s.connectionManager.GetConnectedUsers()
}

// Main notification service implementation
type notificationServiceImpl struct {
	repo            NotificationRepository
	emailService    EmailService
	smsService      SMSService
	pushService     PushService
	templateService TemplateService
	webSocketService WebSocketService
	redisClient     *redis.Client
	logger          *logrus.Logger
}

func NewNotificationService(
	repo NotificationRepository,
	emailService EmailService,
	smsService SMSService,
	pushService PushService,
	templateService TemplateService,
	webSocketService WebSocketService,
	redisClient *redis.Client,
	logger *logrus.Logger,
) NotificationService {
	return &notificationServiceImpl{
		repo:             repo,
		emailService:     emailService,
		smsService:       smsService,
		pushService:      pushService,
		templateService:  templateService,
		webSocketService: webSocketService,
		redisClient:      redisClient,
		logger:           logger,
	}
}

func (s *notificationServiceImpl) SendNotification(ctx context.Context, req *SendNotificationRequest) (*Notification, error) {
	start := time.Now()

	// Get user preferences
	preferences, err := s.repo.GetUserPreferences(ctx, req.RecipientID)
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get user preferences, using defaults")
		preferences = &NotificationPreference{
			UserID:               req.RecipientID,
			EmailEnabled:         true,
			SMSEnabled:           true,
			PushEnabled:          true,
			InAppEnabled:         true,
			TransactionalEnabled: true,
			PromotionalEnabled:   true,
			SystemEnabled:        true,
			AlertEnabled:         true,
		}
	}

	// Check if user has enabled this type of notification
	if !s.isNotificationAllowed(req.Type, preferences) {
		return nil, fmt.Errorf("user has disabled %s notifications", req.Type)
	}

	// Filter channels based on user preferences
	allowedChannels := s.filterChannels(req.Channels, preferences)
	if len(allowedChannels) == 0 {
		return nil, errors.New("no allowed channels for this user")
	}

	// Create notification
	notification := &Notification{
		Type:              req.Type,
		Category:          req.Category,
		Priority:          req.Priority,
		Status:            "pending",
		RecipientID:       req.RecipientID,
		RecipientType:     "user", // Default
		RecipientEmail:    req.RecipientEmail,
		RecipientPhone:    req.RecipientPhone,
		RecipientName:     req.RecipientName,
		RecipientLanguage: preferences.Language,
		Subject:           req.Subject,
		Message:           req.Message,
		HTMLContent:       req.HTMLContent,
		TemplateID:        req.TemplateID,
		TemplateData:      req.TemplateData,
		Channels:          allowedChannels,
		ScheduledAt:       req.ScheduledAt,
		ExpiresAt:         req.ExpiresAt,
		Metadata:          req.Metadata,
		Tags:              req.Tags,
		MaxRetries:        3,
	}

	// Set default priority
	if notification.Priority == "" {
		notification.Priority = "normal"
	}

	// Render template if specified
	if req.TemplateID != "" {
		subject, body, htmlBody, err := s.templateService.RenderTemplate(ctx, req.TemplateID, preferences.Language, req.TemplateData)
		if err != nil {
			s.logger.WithError(err).Warn("Failed to render template, using provided content")
		} else {
			if notification.Subject == "" {
				notification.Subject = subject
			}
			if notification.Message == "" {
				notification.Message = body
			}
			if notification.HTMLContent == "" {
				notification.HTMLContent = htmlBody
			}
		}
	}

	// Save notification
	if err := s.repo.Create(ctx, notification); err != nil {
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}

	// Process notification immediately if not scheduled
	if req.ScheduledAt == nil || req.ScheduledAt.Before(time.Now()) {
		go s.processNotification(context.Background(), notification)
	}

	// Update metrics
	notificationsTotal.WithLabelValues(notification.Type, "all", notification.Status).Inc()
	notificationDuration.WithLabelValues("all").Observe(time.Since(start).Seconds())

	s.logger.WithFields(logrus.Fields{
		"notification_id": notification.ID,
		"type":            notification.Type,
		"category":        notification.Category,
		"recipient_id":    notification.RecipientID,
		"channels":        notification.Channels,
	}).Info("Notification created successfully")

	return notification, nil
}

func (s *notificationServiceImpl) isNotificationAllowed(notificationType string, preferences *NotificationPreference) bool {
	switch notificationType {
	case "transactional":
		return preferences.TransactionalEnabled
	case "promotional":
		return preferences.PromotionalEnabled
	case "system":
		return preferences.SystemEnabled
	case "alert":
		return preferences.AlertEnabled
	default:
		return true
	}
}

func (s *notificationServiceImpl) filterChannels(channels []string, preferences *NotificationPreference) []string {
	var allowed []string
	for _, channel := range channels {
		switch channel {
		case "email":
			if preferences.EmailEnabled {
				allowed = append(allowed, channel)
			}
		case "sms":
			if preferences.SMSEnabled {
				allowed = append(allowed, channel)
			}
		case "push":
			if preferences.PushEnabled {
				allowed = append(allowed, channel)
			}
		case "in_app":
			if preferences.InAppEnabled {
				allowed = append(allowed, channel)
			}
		default:
			allowed = append(allowed, channel)
		}
	}
	return allowed
}

func (s *notificationServiceImpl) processNotification(ctx context.Context, notification *Notification) {
	s.logger.WithField("notification_id", notification.ID).Info("Processing notification")

	// Update status to processing
	notification.Status = "processing"
	s.repo.Update(ctx, notification)

	// Process each channel
	var successCount, failureCount int
	for _, channel := range notification.Channels {
		if err := s.processChannel(ctx, notification, channel); err != nil {
			s.logger.WithError(err).WithFields(logrus.Fields{
				"notification_id": notification.ID,
				"channel":         channel,
			}).Error("Failed to process notification channel")
			failureCount++
		} else {
			successCount++
		}
	}

	// Update final status
	if successCount > 0 {
		notification.Status = "sent"
		now := time.Now()
		notification.SentAt = &now
		
		// If all channels succeeded, mark as delivered
		if failureCount == 0 {
			notification.Status = "delivered"
			notification.DeliveredAt = &now
		}
	} else {
		notification.Status = "failed"
	}

	s.repo.Update(ctx, notification)

	s.logger.WithFields(logrus.Fields{
		"notification_id": notification.ID,
		"status":          notification.Status,
		"success_count":   successCount,
		"failure_count":   failureCount,
	}).Info("Notification processing completed")
}

func (s *notificationServiceImpl) processChannel(ctx context.Context, notification *Notification, channel string) error {
	delivery := &NotificationDelivery{
		NotificationID: notification.ID,
		Channel:        channel,
		Status:         "pending",
		AttemptNumber:  1,
	}

	var err error
	switch channel {
	case "email":
		err = s.processEmailChannel(ctx, notification, delivery)
	case "sms":
		err = s.processSMSChannel(ctx, notification, delivery)
	case "push":
		err = s.processPushChannel(ctx, notification, delivery)
	case "in_app":
		err = s.processInAppChannel(ctx, notification, delivery)
	default:
		err = fmt.Errorf("unsupported channel: %s", channel)
	}

	// Update delivery status
	if err != nil {
		delivery.Status = "failed"
		delivery.ErrorMessage = err.Error()
		now := time.Now()
		delivery.FailedAt = &now
		deliveryAttempts.WithLabelValues(channel, "", "failed").Inc()
	} else {
		delivery.Status = "sent"
		now := time.Now()
		delivery.SentAt = &now
		delivery.DeliveredAt = &now // Assume immediate delivery for now
		deliveryAttempts.WithLabelValues(channel, "", "sent").Inc()
	}

	// Save delivery attempt
	s.repo.CreateDeliveryAttempt(ctx, delivery)

	return err
}

func (s *notificationServiceImpl) processEmailChannel(ctx context.Context, notification *Notification, delivery *NotificationDelivery) error {
	if notification.RecipientEmail == "" {
		return errors.New("recipient email is required for email channel")
	}

	delivery.Provider = "smtp"
	return s.emailService.SendEmail(ctx, notification.RecipientEmail, notification.Subject, notification.Message, notification.HTMLContent)
}

func (s *notificationServiceImpl) processSMSChannel(ctx context.Context, notification *Notification, delivery *NotificationDelivery) error {
	if notification.RecipientPhone == "" {
		return errors.New("recipient phone is required for SMS channel")
	}

	delivery.Provider = cfg.SMS.DefaultProvider
	return s.smsService.SendSMS(ctx, notification.RecipientPhone, notification.Message)
}

func (s *notificationServiceImpl) processPushChannel(ctx context.Context, notification *Notification, delivery *NotificationDelivery) error {
	// Get user's device tokens
	var subscriptions []NotificationSubscription
	err := db.Where("user_id = ? AND is_active = true", notification.RecipientID).Find(&subscriptions).Error
	if err != nil {
		return fmt.Errorf("failed to get device subscriptions: %w", err)
	}

	if len(subscriptions) == 0 {
		return errors.New("no active device subscriptions found")
	}

	delivery.Provider = "firebase"
	
	// Send to all devices
	var lastErr error
	for _, subscription := range subscriptions {
		data := make(map[string]string)
		if notification.Metadata != nil {
			for k, v := range notification.Metadata {
				if str, ok := v.(string); ok {
					data[k] = str
				}
			}
		}
		
		if err := s.pushService.SendPushNotification(ctx, subscription.DeviceToken, notification.Subject, notification.Message, data); err != nil {
			lastErr = err
			s.logger.WithError(err).WithField("device_token", subscription.DeviceToken).Error("Failed to send push notification")
		}
	}

	return lastErr
}

func (s *notificationServiceImpl) processInAppChannel(ctx context.Context, notification *Notification, delivery *NotificationDelivery) error {
	delivery.Provider = "websocket"
	
	message := map[string]interface{}{
		"id":       notification.ID,
		"type":     notification.Type,
		"category": notification.Category,
		"priority": notification.Priority,
		"subject":  notification.Subject,
		"message":  notification.Message,
		"metadata": notification.Metadata,
		"timestamp": time.Now(),
	}

	return s.webSocketService.BroadcastToUser(notification.RecipientID, message)
}

func (s *notificationServiceImpl) SendBulkNotification(ctx context.Context, req *SendBulkNotificationRequest) (*BulkNotificationResponse, error) {
	batchID := uuid.New()
	
	s.logger.WithFields(logrus.Fields{
		"batch_id":      batchID,
		"recipient_count": len(req.Recipients),
		"type":          req.Type,
		"category":      req.Category,
	}).Info("Processing bulk notification request")

	var queuedCount, failedCount int

	// Process recipients in batches
	batchSize := 100
	for i := 0; i < len(req.Recipients); i += batchSize {
		end := i + batchSize
		if end > len(req.Recipients) {
			end = len(req.Recipients)
		}

		batch := req.Recipients[i:end]
		
		for _, recipient := range batch {
			// Create individual notification request
			notificationReq := &SendNotificationRequest{
				Type:           req.Type,
				Category:       req.Category,
				Priority:       req.Priority,
				RecipientID:    recipient.ID,
				RecipientEmail: recipient.Email,
				RecipientPhone: recipient.Phone,
				RecipientName:  recipient.Name,
				Subject:        req.Subject,
				Message:        req.Message,
				HTMLContent:    req.HTMLContent,
				Channels:       req.Channels,
				TemplateID:     req.TemplateID,
				TemplateData:   req.TemplateData,
				ScheduledAt:    req.ScheduledAt,
				ExpiresAt:      req.ExpiresAt,
				Metadata:       req.Metadata,
				Tags:           req.Tags,
			}

			// Merge recipient-specific template data
			if recipient.TemplateData != nil {
				if notificationReq.TemplateData == nil {
					notificationReq.TemplateData = make(map[string]interface{})
				}
				for k, v := range recipient.TemplateData {
					notificationReq.TemplateData[k] = v
				}
			}

			// Send notification
			if _, err := s.SendNotification(ctx, notificationReq); err != nil {
				s.logger.WithError(err).WithField("recipient_id", recipient.ID).Error("Failed to send bulk notification")
				failedCount++
			} else {
				queuedCount++
			}
		}

		// Rate limiting between batches
		time.Sleep(100 * time.Millisecond)
	}

	response := &BulkNotificationResponse{
		BatchID:     batchID,
		TotalCount:  len(req.Recipients),
		QueuedCount: queuedCount,
		FailedCount: failedCount,
		Message:     fmt.Sprintf("Bulk notification processed: %d queued, %d failed", queuedCount, failedCount),
	}

	s.logger.WithFields(logrus.Fields{
		"batch_id":     batchID,
		"total_count":  response.TotalCount,
		"queued_count": response.QueuedCount,
		"failed_count": response.FailedCount,
	}).Info("Bulk notification processing completed")

	return response, nil
}

func (s *notificationServiceImpl) GetNotification(ctx context.Context, notificationID uuid.UUID) (*Notification, error) {
	return s.repo.GetByID(ctx, notificationID)
}

func (s *notificationServiceImpl) GetNotifications(ctx context.Context, req *GetNotificationsRequest) ([]*Notification, int64, error) {
	filters := make(map[string]interface{})

	if req.RecipientID != nil {
		filters["recipient_id"] = *req.RecipientID
	}
	if req.Type != "" {
		filters["type"] = req.Type
	}
	if req.Category != "" {
		filters["category"] = req.Category
	}
	if req.Status != "" {
		filters["status"] = req.Status
	}
	if req.Channel != "" {
		filters["channel"] = req.Channel
	}
	if req.StartDate != "" {
		if startDate, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			filters["start_date"] = startDate
		}
	}
	if req.EndDate != "" {
		if endDate, err := time.Parse("2006-01-02", req.EndDate); err == nil {
			filters["end_date"] = endDate.Add(24 * time.Hour)
		}
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

func (s *notificationServiceImpl) UpdateNotificationStatus(ctx context.Context, notificationID uuid.UUID, status string) error {
	notification, err := s.repo.GetByID(ctx, notificationID)
	if err != nil {
		return fmt.Errorf("notification not found: %w", err)
	}

	notification.Status = status
	now := time.Now()

	switch status {
	case "sent":
		notification.SentAt = &now
	case "delivered":
		notification.DeliveredAt = &now
	case "read":
		notification.ReadAt = &now
	case "clicked":
		notification.ClickedAt = &now
	}

	return s.repo.Update(ctx, notification)
}

func (s *notificationServiceImpl) MarkAsRead(ctx context.Context, notificationID, userID uuid.UUID) error {
	notification, err := s.repo.GetByID(ctx, notificationID)
	if err != nil {
		return fmt.Errorf("notification not found: %w", err)
	}

	if notification.RecipientID != userID {
		return errors.New("unauthorized access to notification")
	}

	now := time.Now()
	notification.ReadAt = &now

	return s.repo.Update(ctx, notification)
}

func (s *notificationServiceImpl) MarkAsClicked(ctx context.Context, notificationID, userID uuid.UUID) error {
	notification, err := s.repo.GetByID(ctx, notificationID)
	if err != nil {
		return fmt.Errorf("notification not found: %w", err)
	}

	if notification.RecipientID != userID {
		return errors.New("unauthorized access to notification")
	}

	now := time.Now()
	notification.ClickedAt = &now

	return s.repo.Update(ctx, notification)
}

func (s *notificationServiceImpl) GetNotificationStats(ctx context.Context, userID *uuid.UUID, startDate, endDate time.Time) (*NotificationStatsResponse, error) {
	filters := make(map[string]interface{})

	if userID != nil {
		filters["recipient_id"] = *userID
	}
	filters["start_date"] = startDate
	filters["end_date"] = endDate

	return s.repo.GetStats(ctx, filters)
}

func (s *notificationServiceImpl) ProcessPendingNotifications(ctx context.Context) error {
	s.logger.Info("Processing pending notifications")

	notifications, err := s.repo.GetPendingNotifications(ctx, 100)
	if err != nil {
		return fmt.Errorf("failed to get pending notifications: %w", err)
	}

	for _, notification := range notifications {
		go s.processNotification(ctx, notification)
	}

	s.logger.WithField("count", len(notifications)).Info("Pending notifications queued for processing")
	return nil
}

func (s *notificationServiceImpl) ProcessScheduledNotifications(ctx context.Context) error {
	s.logger.Info("Processing scheduled notifications")

	notifications, err := s.repo.GetScheduledNotifications(ctx, time.Now(), 100)
	if err != nil {
		return fmt.Errorf("failed to get scheduled notifications: %w", err)
	}

	for _, notification := range notifications {
		go s.processNotification(ctx, notification)
	}

	s.logger.WithField("count", len(notifications)).Info("Scheduled notifications queued for processing")
	return nil
}

// Utility function
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// HTTP handlers
type NotificationHandler struct {
	service NotificationService
	logger  *logrus.Logger
}

func NewNotificationHandler(service NotificationService, logger *logrus.Logger) *NotificationHandler {
	return &NotificationHandler{
		service: service,
		logger:  logger,
	}
}

// Middleware
func (h *NotificationHandler) AuthMiddleware() gin.HandlerFunc {
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

func (h *NotificationHandler) RateLimitMiddleware() gin.HandlerFunc {
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

func (h *NotificationHandler) MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := time.Since(start)
		status := strconv.Itoa(c.Writer.Status())

		requestsTotal.WithLabelValues(c.Request.Method, c.FullPath(), status).Inc()
		requestDuration.WithLabelValues(c.Request.Method, c.FullPath()).Observe(duration.Seconds())
	}
}

// WebSocket handler
func (h *NotificationHandler) HandleWebSocket(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	conn, err := connectionManager.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.WithError(err).Error("Failed to upgrade WebSocket connection")
		return
	}

	userUUID := userID.(uuid.UUID)
	connectionManager.AddConnection(userUUID, conn)

	h.logger.WithField("user_id", userUUID).Info("WebSocket connection established")

	// Handle connection
	defer func() {
		connectionManager.RemoveConnection(userUUID)
		conn.Close()
	}()

	// Set up ping/pong handlers
	conn.SetReadDeadline(time.Now().Add(cfg.WebSocket.ReadTimeout))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(cfg.WebSocket.ReadTimeout))
		return nil
	})

	// Start ping ticker
	ticker := time.NewTicker(cfg.WebSocket.PingPeriod)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			conn.SetWriteDeadline(time.Now().Add(cfg.WebSocket.WriteTimeout))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}()

	// Read messages (keep connection alive)
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				h.logger.WithError(err).Error("WebSocket error")
			}
			break
		}
	}
}

// API handlers
func (h *NotificationHandler) SendNotification(c *gin.Context) {
	var req SendNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	notification, err := h.service.SendNotification(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to send notification")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, NotificationResponse{
		Notification: notification,
		Message:      "Notification sent successfully",
	})
}

func (h *NotificationHandler) SendBulkNotification(c *gin.Context) {
	var req SendBulkNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validator.Struct(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := h.service.SendBulkNotification(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to send bulk notification")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, response)
}

func (h *NotificationHandler) GetNotification(c *gin.Context) {
	notificationIDStr := c.Param("id")
	notificationID, err := uuid.Parse(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	notification, err := h.service.GetNotification(c.Request.Context(), notificationID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get notification")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"notification": notification})
}

func (h *NotificationHandler) GetNotifications(c *gin.Context) {
	var req GetNotificationsRequest

	// Parse query parameters
	if recipientIDStr := c.Query("recipient_id"); recipientIDStr != "" {
		if recipientID, err := uuid.Parse(recipientIDStr); err == nil {
			req.RecipientID = &recipientID
		}
	}

	req.Type = c.Query("type")
	req.Category = c.Query("category")
	req.Status = c.Query("status")
	req.Channel = c.Query("channel")
	req.StartDate = c.Query("start_date")
	req.EndDate = c.Query("end_date")

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

	notifications, total, err := h.service.GetNotifications(c.Request.Context(), &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get notifications")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"total":         total,
		"limit":         req.Limit,
		"offset":        req.Offset,
	})
}

func (h *NotificationHandler) MarkAsRead(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	notificationIDStr := c.Param("id")
	notificationID, err := uuid.Parse(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	if err := h.service.MarkAsRead(c.Request.Context(), notificationID, userID.(uuid.UUID)); err != nil {
		h.logger.WithError(err).Error("Failed to mark notification as read")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Notification marked as read"})
}

func (h *NotificationHandler) MarkAsClicked(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	notificationIDStr := c.Param("id")
	notificationID, err := uuid.Parse(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	if err := h.service.MarkAsClicked(c.Request.Context(), notificationID, userID.(uuid.UUID)); err != nil {
		h.logger.WithError(err).Error("Failed to mark notification as clicked")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Notification marked as clicked"})
}

func (h *NotificationHandler) GetNotificationStats(c *gin.Context) {
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
			endDate = date.Add(24 * time.Hour)
		}
	}

	stats, err := h.service.GetNotificationStats(c.Request.Context(), userID, startDate, endDate)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get notification stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

// Health check handler
func (h *NotificationHandler) HealthCheck(c *gin.Context) {
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
		"service":    "notification-service",
		"version":    Version,
		"build_time": BuildTime,
		"git_commit": GitCommit,
		"go_version": GoVersion,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"websocket_connections": len(connectionManager.GetConnectedUsers()),
	})
}

// Setup routes
func setupRoutes(handler *NotificationHandler) *gin.Engine {
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

	// WebSocket endpoint
	if cfg.WebSocket.Enabled {
		router.GET(cfg.WebSocket.Path, handler.AuthMiddleware(), handler.HandleWebSocket)
	}

	// API version 1
	v1 := router.Group("/api/v1")
	{
		// Protected endpoints
		protected := v1.Group("/")
		protected.Use(handler.AuthMiddleware())
		{
			notifications := protected.Group("/notifications")
			{
				notifications.POST("/", handler.SendNotification)
				notifications.POST("/bulk", handler.SendBulkNotification)
				notifications.GET("/", handler.GetNotifications)
				notifications.GET("/stats", handler.GetNotificationStats)
				notifications.GET("/:id", handler.GetNotification)
				notifications.POST("/:id/read", handler.MarkAsRead)
				notifications.POST("/:id/clicked", handler.MarkAsClicked)
			}
		}
	}

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	return router
}

// Background workers
func startBackgroundWorkers() {
	// Pending notification processor
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			if err := notificationService.ProcessPendingNotifications(ctx); err != nil {
				logger.WithError(err).Error("Failed to process pending notifications")
			}
			cancel()
		}
	}()

	// Scheduled notification processor
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			if err := notificationService.ProcessScheduledNotifications(ctx); err != nil {
				logger.WithError(err).Error("Failed to process scheduled notifications")
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
	}).Info("Starting Notification Service")

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

	// Initialize Firebase
	if err := initFirebase(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize Firebase")
	}

	// Initialize tracing
	if err := initTracing(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize tracing")
	}

	// Initialize messaging
	if err := initMessaging(); err != nil {
		logger.WithError(err).Fatal("Failed to initialize messaging")
	}

	// Initialize connection manager
	connectionManager = NewConnectionManager()

	// Initialize services
	notificationRepo = NewNotificationRepository(db)
	emailService = NewEmailService(httpClient, logger)
	smsService = NewSMSService(httpClient, logger)
	pushService = NewPushService(httpClient, logger)
	templateService = NewTemplateService(logger)
	webSocketService = NewWebSocketService(connectionManager, logger)
	notificationService = NewNotificationService(
		notificationRepo,
		emailService,
		smsService,
		pushService,
		templateService,
		webSocketService,
		redisClient,
		logger,
	)

	// Initialize handlers
	notificationHandler := NewNotificationHandler(notificationService, logger)

	// Setup routes
	router := setupRoutes(notificationHandler)

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

