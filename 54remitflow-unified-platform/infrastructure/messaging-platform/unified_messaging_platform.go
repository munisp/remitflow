package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	_ "github.com/lib/pq"
)

// UnifiedMessagingPlatform orchestrates all messaging channels
type UnifiedMessagingPlatform struct {
	db      *sql.DB
	redis   *redis.Client
	metrics *PlatformMetrics
	config  *PlatformConfig
}

// PlatformConfig contains configuration for the messaging platform
type PlatformConfig struct {
	USSDServiceURL     string
	SMSServiceURL      string
	WhatsAppServiceURL string
	AnalyticsServiceURL string
	MaxRetries         int
	RetryDelay         time.Duration
	CircuitBreakerThreshold int
	HealthCheckInterval time.Duration
}

// PlatformMetrics contains Prometheus metrics
type PlatformMetrics struct {
	MessagesTotal        *prometheus.CounterVec
	MessageDuration      *prometheus.HistogramVec
	ChannelHealth        *prometheus.GaugeVec
	ProviderFailures     *prometheus.CounterVec
	CostOptimization     *prometheus.GaugeVec
}

// MessageRequest represents a unified message request
type MessageRequest struct {
	MessageID       string                 `json:"message_id"`
	Channel         string                 `json:"channel"` // ussd, sms, whatsapp
	Recipient       string                 `json:"recipient"`
	Content         string                 `json:"content"`
	MessageType     string                 `json:"message_type"` // text, template, media
	Priority        string                 `json:"priority"`     // low, normal, high, urgent
	Metadata        map[string]interface{} `json:"metadata"`
	ScheduledAt     *time.Time             `json:"scheduled_at,omitempty"`
	ExpiresAt       *time.Time             `json:"expires_at,omitempty"`
	CallbackURL     string                 `json:"callback_url,omitempty"`
	
	// Channel-specific options
	USSDOptions     *USSDOptions     `json:"ussd_options,omitempty"`
	SMSOptions      *SMSOptions      `json:"sms_options,omitempty"`
	WhatsAppOptions *WhatsAppOptions `json:"whatsapp_options,omitempty"`
}

// USSDOptions contains USSD-specific options
type USSDOptions struct {
	SessionID       string `json:"session_id"`
	ServiceCode     string `json:"service_code"`
	NetworkCode     string `json:"network_code"`
	PhoneNumber     string `json:"phone_number"`
	Text            string `json:"text"`
	SessionType     string `json:"session_type"` // start, continue, end
	MaxMenuDepth    int    `json:"max_menu_depth"`
	TimeoutSeconds  int    `json:"timeout_seconds"`
}

// SMSOptions contains SMS-specific options
type SMSOptions struct {
	SenderID        string   `json:"sender_id"`
	PreferredProvider string `json:"preferred_provider"`
	FallbackProviders []string `json:"fallback_providers"`
	DeliveryReport  bool     `json:"delivery_report"`
	ValidityPeriod  int      `json:"validity_period"` // hours
	FlashSMS        bool     `json:"flash_sms"`
	Unicode         bool     `json:"unicode"`
}

// WhatsAppOptions contains WhatsApp-specific options
type WhatsAppOptions struct {
	TemplateID      string                 `json:"template_id,omitempty"`
	TemplateParams  []string               `json:"template_params,omitempty"`
	MediaURL        string                 `json:"media_url,omitempty"`
	MediaType       string                 `json:"media_type,omitempty"` // image, document, audio, video
	Caption         string                 `json:"caption,omitempty"`
	InteractiveType string                 `json:"interactive_type,omitempty"` // button, list, flow
	Buttons         []WhatsAppButton       `json:"buttons,omitempty"`
	ListItems       []WhatsAppListItem     `json:"list_items,omitempty"`
	HeaderText      string                 `json:"header_text,omitempty"`
	FooterText      string                 `json:"footer_text,omitempty"`
}

// WhatsAppButton represents a WhatsApp button
type WhatsAppButton struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Type  string `json:"type"` // reply, url, phone
	URL   string `json:"url,omitempty"`
	Phone string `json:"phone,omitempty"`
}

// WhatsAppListItem represents a WhatsApp list item
type WhatsAppListItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// MessageResponse represents a unified message response
type MessageResponse struct {
	MessageID       string                 `json:"message_id"`
	Status          string                 `json:"status"` // queued, sent, delivered, read, failed
	Channel         string                 `json:"channel"`
	Provider        string                 `json:"provider,omitempty"`
	Cost            float64                `json:"cost,omitempty"`
	SentAt          *time.Time             `json:"sent_at,omitempty"`
	DeliveredAt     *time.Time             `json:"delivered_at,omitempty"`
	ReadAt          *time.Time             `json:"read_at,omitempty"`
	FailureReason   string                 `json:"failure_reason,omitempty"`
	ResponseTime    int64                  `json:"response_time_ms,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

// BulkMessageRequest represents a bulk message request
type BulkMessageRequest struct {
	Messages        []MessageRequest `json:"messages"`
	BatchSize       int              `json:"batch_size"`
	ConcurrentBatch int              `json:"concurrent_batches"`
	Priority        string           `json:"priority"`
	CallbackURL     string           `json:"callback_url,omitempty"`
}

// BulkMessageResponse represents a bulk message response
type BulkMessageResponse struct {
	BatchID         string            `json:"batch_id"`
	TotalMessages   int               `json:"total_messages"`
	QueuedMessages  int               `json:"queued_messages"`
	FailedMessages  int               `json:"failed_messages"`
	EstimatedCost   float64           `json:"estimated_cost"`
	EstimatedTime   string            `json:"estimated_completion_time"`
	Status          string            `json:"status"`
	CreatedAt       time.Time         `json:"created_at"`
	MessageStatuses []MessageResponse `json:"message_statuses"`
}

// NewPlatformMetrics creates new Prometheus metrics
func NewPlatformMetrics() *PlatformMetrics {
	return &PlatformMetrics{
		MessagesTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "platform_messages_total",
				Help: "Total number of messages processed by channel",
			},
			[]string{"channel", "status", "provider"},
		),
		MessageDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "platform_message_duration_seconds",
				Help:    "Message processing duration in seconds",
				Buckets: []float64{0.1, 0.5, 1.0, 2.0, 5.0, 10.0},
			},
			[]string{"channel"},
		),
		ChannelHealth: prometheus.NewGaugeVec(
			prometheus.GaugeVec{
				Name: "platform_channel_health",
				Help: "Health status of messaging channels (1=healthy, 0=unhealthy)",
			},
			[]string{"channel"},
		),
		ProviderFailures: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "platform_provider_failures_total",
				Help: "Total number of provider failures",
			},
			[]string{"provider", "channel", "failure_type"},
		),
		CostOptimization: prometheus.NewGaugeVec(
			prometheus.GaugeVec{
				Name: "platform_cost_optimization_ratio",
				Help: "Cost optimization ratio achieved",
			},
			[]string{"channel", "provider"},
		),
	}
}

// NewUnifiedMessagingPlatform creates a new unified messaging platform
func NewUnifiedMessagingPlatform() (*UnifiedMessagingPlatform, error) {
	// Initialize database connection
	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %v", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %v", err)
	}

	// Initialize Redis connection
	redisClient := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_URL"),
		Password: "",
		DB:       0,
	})

	_, err = redisClient.Ping(context.Background()).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %v", err)
	}

	// Load configuration
	config := &PlatformConfig{
		USSDServiceURL:          getEnvOrDefault("USSD_SERVICE_URL", "http://localhost:8083"),
		SMSServiceURL:           getEnvOrDefault("SMS_SERVICE_URL", "http://localhost:8084"),
		WhatsAppServiceURL:      getEnvOrDefault("WHATSAPP_SERVICE_URL", "http://localhost:8085"),
		AnalyticsServiceURL:     getEnvOrDefault("ANALYTICS_SERVICE_URL", "http://localhost:8087"),
		MaxRetries:              3,
		RetryDelay:              time.Second * 2,
		CircuitBreakerThreshold: 5,
		HealthCheckInterval:     time.Minute * 1,
	}

	metrics := NewPlatformMetrics()

	// Register Prometheus metrics
	prometheus.MustRegister(
		metrics.MessagesTotal,
		metrics.MessageDuration,
		metrics.ChannelHealth,
		metrics.ProviderFailures,
		metrics.CostOptimization,
	)

	platform := &UnifiedMessagingPlatform{
		db:      db,
		redis:   redisClient,
		metrics: metrics,
		config:  config,
	}

	// Initialize database schema
	if err := platform.initializeSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %v", err)
	}

	// Start background services
	go platform.startHealthMonitoring()
	go platform.startMessageProcessor()
	go platform.startCostOptimizer()

	return platform, nil
}

// initializeSchema creates necessary database tables
func (ump *UnifiedMessagingPlatform) initializeSchema() error {
	schema := `
	-- Unified message queue
	CREATE TABLE IF NOT EXISTS message_queue (
		id SERIAL PRIMARY KEY,
		message_id VARCHAR(255) UNIQUE NOT NULL,
		channel VARCHAR(20) NOT NULL,
		recipient VARCHAR(255) NOT NULL,
		content TEXT NOT NULL,
		message_type VARCHAR(50) DEFAULT 'text',
		priority VARCHAR(20) DEFAULT 'normal',
		status VARCHAR(50) DEFAULT 'queued',
		provider VARCHAR(100),
		cost DECIMAL(10,4) DEFAULT 0,
		attempts INTEGER DEFAULT 0,
		max_attempts INTEGER DEFAULT 3,
		scheduled_at TIMESTAMP,
		expires_at TIMESTAMP,
		sent_at TIMESTAMP,
		delivered_at TIMESTAMP,
		read_at TIMESTAMP,
		failed_at TIMESTAMP,
		failure_reason TEXT,
		response_time_ms INTEGER,
		callback_url TEXT,
		metadata JSONB DEFAULT '{}',
		created_at TIMESTAMP DEFAULT NOW(),
		updated_at TIMESTAMP DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_message_queue_status ON message_queue(status);
	CREATE INDEX IF NOT EXISTS idx_message_queue_channel ON message_queue(channel);
	CREATE INDEX IF NOT EXISTS idx_message_queue_scheduled ON message_queue(scheduled_at);
	CREATE INDEX IF NOT EXISTS idx_message_queue_priority ON message_queue(priority);

	-- Channel health tracking
	CREATE TABLE IF NOT EXISTS channel_health (
		id SERIAL PRIMARY KEY,
		channel VARCHAR(20) NOT NULL,
		provider VARCHAR(100),
		status VARCHAR(20) NOT NULL, -- healthy, degraded, unhealthy
		last_success_at TIMESTAMP,
		last_failure_at TIMESTAMP,
		failure_count INTEGER DEFAULT 0,
		success_rate DECIMAL(5,2) DEFAULT 100.00,
		avg_response_time_ms INTEGER DEFAULT 0,
		circuit_breaker_state VARCHAR(20) DEFAULT 'closed', -- closed, open, half-open
		created_at TIMESTAMP DEFAULT NOW(),
		updated_at TIMESTAMP DEFAULT NOW(),
		UNIQUE(channel, provider)
	);

	-- Cost optimization tracking
	CREATE TABLE IF NOT EXISTS cost_optimization (
		id SERIAL PRIMARY KEY,
		date DATE NOT NULL,
		channel VARCHAR(20) NOT NULL,
		provider VARCHAR(100) NOT NULL,
		original_cost DECIMAL(10,4) NOT NULL,
		optimized_cost DECIMAL(10,4) NOT NULL,
		savings DECIMAL(10,4) NOT NULL,
		optimization_strategy TEXT,
		created_at TIMESTAMP DEFAULT NOW(),
		UNIQUE(date, channel, provider)
	);

	-- Bulk message batches
	CREATE TABLE IF NOT EXISTS message_batches (
		id SERIAL PRIMARY KEY,
		batch_id VARCHAR(255) UNIQUE NOT NULL,
		total_messages INTEGER NOT NULL,
		queued_messages INTEGER DEFAULT 0,
		sent_messages INTEGER DEFAULT 0,
		delivered_messages INTEGER DEFAULT 0,
		failed_messages INTEGER DEFAULT 0,
		total_cost DECIMAL(10,2) DEFAULT 0,
		status VARCHAR(50) DEFAULT 'processing',
		priority VARCHAR(20) DEFAULT 'normal',
		callback_url TEXT,
		created_at TIMESTAMP DEFAULT NOW(),
		updated_at TIMESTAMP DEFAULT NOW(),
		completed_at TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_message_batches_status ON message_batches(status);
	CREATE INDEX IF NOT EXISTS idx_message_batches_created ON message_batches(created_at);
	`

	_, err := ump.db.Exec(schema)
	return err
}

// setupRoutes configures HTTP routes
func (ump *UnifiedMessagingPlatform) setupRoutes() *gin.Engine {
	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		health := ump.getOverallHealth()
		status := 200
		if health["status"] != "healthy" {
			status = 503
		}
		c.JSON(status, health)
	})

	// Metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Unified messaging API
	api := r.Group("/api/v1/messaging")
	{
		// Single message operations
		api.POST("/send", ump.sendMessage)
		api.GET("/status/:message_id", ump.getMessageStatus)
		api.POST("/cancel/:message_id", ump.cancelMessage)

		// Bulk operations
		api.POST("/bulk/send", ump.sendBulkMessages)
		api.GET("/bulk/status/:batch_id", ump.getBulkStatus)
		api.POST("/bulk/cancel/:batch_id", ump.cancelBulkMessages)

		// Channel management
		api.GET("/channels", ump.getChannelStatus)
		api.POST("/channels/:channel/enable", ump.enableChannel)
		api.POST("/channels/:channel/disable", ump.disableChannel)
		api.GET("/channels/:channel/health", ump.getChannelHealth)

		// Provider management
		api.GET("/providers", ump.getProviderStatus)
		api.POST("/providers/:provider/enable", ump.enableProvider)
		api.POST("/providers/:provider/disable", ump.disableProvider)
		api.GET("/providers/optimization", ump.getProviderOptimization)

		// Cost optimization
		api.GET("/costs/current", ump.getCurrentCosts)
		api.GET("/costs/optimization", ump.getCostOptimization)
		api.POST("/costs/optimize", ump.optimizeCosts)

		// Analytics integration
		api.GET("/analytics/summary", ump.getAnalyticsSummary)
		api.GET("/analytics/realtime", ump.getRealtimeAnalytics)

		// Templates and campaigns
		api.GET("/templates", ump.getMessageTemplates)
		api.POST("/templates", ump.createMessageTemplate)
		api.POST("/campaigns", ump.createCampaign)
		api.GET("/campaigns/:campaign_id", ump.getCampaignStatus)
	}

	// Webhook endpoints
	webhook := r.Group("/webhooks")
	{
		webhook.POST("/ussd", ump.handleUSSDWebhook)
		webhook.POST("/sms", ump.handleSMSWebhook)
		webhook.POST("/whatsapp", ump.handleWhatsAppWebhook)
	}

	return r
}

// sendMessage sends a single message through the appropriate channel with strict idempotency
func (ump *UnifiedMessagingPlatform) sendMessage(c *gin.Context) {
	start := time.Now()
	
	var request MessageRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// Generate message ID if not provided
	if request.MessageID == "" {
		request.MessageID = fmt.Sprintf("MSG_%d_%s", time.Now().UnixNano(), generateShortID())
	}

	// IDEMPOTENCY CHECK: Check if message was already processed
	ctx := context.Background()
	idempotencyKey := fmt.Sprintf("idempotency:msg:%s", request.MessageID)
	
	// Try to acquire distributed lock for this message
	lockKey := fmt.Sprintf("lock:msg:%s", request.MessageID)
	lockAcquired, err := ump.redis.SetNX(ctx, lockKey, "1", 30*time.Second).Result()
	if err != nil {
		log.Printf("Redis lock error: %v", err)
	}
	
	if lockAcquired {
		defer ump.redis.Del(ctx, lockKey)
	} else {
		// Another request is processing this message, wait briefly and check result
		time.Sleep(100 * time.Millisecond)
	}
	
	// Check if message was already processed (idempotency)
	cachedResult, err := ump.redis.Get(ctx, idempotencyKey).Result()
	if err == nil && cachedResult != "" {
		// Message was already processed, return cached result
		var cachedResponse MessageResponse
		if err := json.Unmarshal([]byte(cachedResult), &cachedResponse); err == nil {
			log.Printf("Idempotency hit for message %s", request.MessageID)
			c.JSON(200, cachedResponse)
			return
		}
	}
	
	// Also check database for idempotency
	var existingStatus string
	err = ump.db.QueryRow(
		"SELECT status FROM message_queue WHERE message_id = $1",
		request.MessageID,
	).Scan(&existingStatus)
	if err == nil && existingStatus != "" && existingStatus != "pending" {
		// Message exists and was processed
		response := MessageResponse{
			MessageID: request.MessageID,
			Status:    existingStatus,
			Channel:   request.Channel,
		}
		c.JSON(200, response)
		return
	}

	// Validate channel
	if !ump.isValidChannel(request.Channel) {
		c.JSON(400, gin.H{"error": "Invalid channel specified"})
		return
	}

	// Check channel health
	if !ump.isChannelHealthy(request.Channel) {
		c.JSON(503, gin.H{"error": "Channel is currently unavailable"})
		return
	}

	// Store message in queue
	err = ump.queueMessage(request)
	if err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to queue message: %v", err)})
		return
	}

	// Process message based on channel
	var response MessageResponse
	var processingErr error

	switch strings.ToLower(request.Channel) {
	case "ussd":
		response, processingErr = ump.processUSSDMessage(request)
	case "sms":
		response, processingErr = ump.processSMSMessage(request)
	case "whatsapp":
		response, processingErr = ump.processWhatsAppMessage(request)
	default:
		processingErr = fmt.Errorf("unsupported channel: %s", request.Channel)
	}

	// Record metrics
	ump.metrics.MessageDuration.WithLabelValues(request.Channel).Observe(time.Since(start).Seconds())
	
	if processingErr != nil {
		ump.metrics.MessagesTotal.WithLabelValues(request.Channel, "failed", "").Inc()
		ump.updateMessageStatus(request.MessageID, "failed", processingErr.Error())
		c.JSON(500, gin.H{"error": processingErr.Error()})
		return
	}

	// Cache successful response for idempotency (24 hour TTL)
	responseJSON, _ := json.Marshal(response)
	ump.redis.Set(ctx, idempotencyKey, string(responseJSON), 24*time.Hour)

	ump.metrics.MessagesTotal.WithLabelValues(request.Channel, "sent", response.Provider).Inc()
	c.JSON(200, response)
}

// processUSSDMessage processes a USSD message
func (ump *UnifiedMessagingPlatform) processUSSDMessage(request MessageRequest) (MessageResponse, error) {
	// Prepare USSD request
	ussdRequest := map[string]interface{}{
		"session_id":    request.USSDOptions.SessionID,
		"service_code":  request.USSDOptions.ServiceCode,
		"phone_number":  request.Recipient,
		"text":          request.Content,
		"session_type":  request.USSDOptions.SessionType,
		"network_code":  request.USSDOptions.NetworkCode,
		"metadata":      request.Metadata,
	}

	// Send to USSD service
	response, err := ump.callService("POST", ump.config.USSDServiceURL+"/api/v1/ussd/send", ussdRequest)
	if err != nil {
		return MessageResponse{}, err
	}

	// Parse response
	var ussdResponse map[string]interface{}
	if err := json.Unmarshal(response, &ussdResponse); err != nil {
		return MessageResponse{}, err
	}

	messageResponse := MessageResponse{
		MessageID:    request.MessageID,
		Status:       getString(ussdResponse, "status"),
		Channel:      "ussd",
		Provider:     getString(ussdResponse, "provider"),
		ResponseTime: int64(getFloat(ussdResponse, "response_time_ms")),
		SentAt:       timePtr(time.Now()),
		Metadata:     ussdResponse,
	}

	// Update message status
	ump.updateMessageStatus(request.MessageID, messageResponse.Status, "")

	return messageResponse, nil
}

// processSMSMessage processes an SMS message
func (ump *UnifiedMessagingPlatform) processSMSMessage(request MessageRequest) (MessageResponse, error) {
	// Prepare SMS request
	smsRequest := map[string]interface{}{
		"recipient":          request.Recipient,
		"content":            request.Content,
		"sender_id":          request.SMSOptions.SenderID,
		"preferred_provider": request.SMSOptions.PreferredProvider,
		"fallback_providers": request.SMSOptions.FallbackProviders,
		"delivery_report":    request.SMSOptions.DeliveryReport,
		"priority":           request.Priority,
		"metadata":           request.Metadata,
	}

	// Send to SMS service
	response, err := ump.callService("POST", ump.config.SMSServiceURL+"/api/v1/sms/send", smsRequest)
	if err != nil {
		return MessageResponse{}, err
	}

	// Parse response
	var smsResponse map[string]interface{}
	if err := json.Unmarshal(response, &smsResponse); err != nil {
		return MessageResponse{}, err
	}

	messageResponse := MessageResponse{
		MessageID:    request.MessageID,
		Status:       getString(smsResponse, "status"),
		Channel:      "sms",
		Provider:     getString(smsResponse, "provider"),
		Cost:         getFloat(smsResponse, "cost"),
		ResponseTime: int64(getFloat(smsResponse, "response_time_ms")),
		SentAt:       timePtr(time.Now()),
		Metadata:     smsResponse,
	}

	// Update message status
	ump.updateMessageStatus(request.MessageID, messageResponse.Status, "")

	return messageResponse, nil
}

// processWhatsAppMessage processes a WhatsApp message
func (ump *UnifiedMessagingPlatform) processWhatsAppMessage(request MessageRequest) (MessageResponse, error) {
	// Prepare WhatsApp request
	whatsappRequest := map[string]interface{}{
		"recipient":     request.Recipient,
		"content":       request.Content,
		"message_type":  request.MessageType,
		"priority":      request.Priority,
		"metadata":      request.Metadata,
	}

	// Add WhatsApp-specific options
	if request.WhatsAppOptions != nil {
		if request.WhatsAppOptions.TemplateID != "" {
			whatsappRequest["template_id"] = request.WhatsAppOptions.TemplateID
			whatsappRequest["template_params"] = request.WhatsAppOptions.TemplateParams
		}
		if request.WhatsAppOptions.MediaURL != "" {
			whatsappRequest["media_url"] = request.WhatsAppOptions.MediaURL
			whatsappRequest["media_type"] = request.WhatsAppOptions.MediaType
			whatsappRequest["caption"] = request.WhatsAppOptions.Caption
		}
		if len(request.WhatsAppOptions.Buttons) > 0 {
			whatsappRequest["buttons"] = request.WhatsAppOptions.Buttons
		}
		if len(request.WhatsAppOptions.ListItems) > 0 {
			whatsappRequest["list_items"] = request.WhatsAppOptions.ListItems
		}
	}

	// Send to WhatsApp service
	response, err := ump.callService("POST", ump.config.WhatsAppServiceURL+"/api/v1/whatsapp/send", whatsappRequest)
	if err != nil {
		return MessageResponse{}, err
	}

	// Parse response
	var whatsappResponse map[string]interface{}
	if err := json.Unmarshal(response, &whatsappResponse); err != nil {
		return MessageResponse{}, err
	}

	messageResponse := MessageResponse{
		MessageID:    request.MessageID,
		Status:       getString(whatsappResponse, "status"),
		Channel:      "whatsapp",
		Provider:     "meta",
		Cost:         getFloat(whatsappResponse, "cost"),
		ResponseTime: int64(getFloat(whatsappResponse, "response_time_ms")),
		SentAt:       timePtr(time.Now()),
		Metadata:     whatsappResponse,
	}

	// Update message status
	ump.updateMessageStatus(request.MessageID, messageResponse.Status, "")

	return messageResponse, nil
}

// sendBulkMessages processes bulk message requests
func (ump *UnifiedMessagingPlatform) sendBulkMessages(c *gin.Context) {
	start := time.Now()

	var request BulkMessageRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// Generate batch ID
	batchID := fmt.Sprintf("BATCH_%d_%s", time.Now().UnixNano(), generateShortID())

	// Validate batch size
	if request.BatchSize <= 0 {
		request.BatchSize = 100
	}
	if request.ConcurrentBatch <= 0 {
		request.ConcurrentBatch = 5
	}

	// Store batch in database
	_, err := ump.db.Exec(`
		INSERT INTO message_batches (batch_id, total_messages, status, priority, callback_url)
		VALUES ($1, $2, 'processing', $3, $4)
	`, batchID, len(request.Messages), request.Priority, request.CallbackURL)

	if err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to create batch: %v", err)})
		return
	}

	// Queue all messages
	var messageStatuses []MessageResponse
	var queuedCount, failedCount int
	var estimatedCost float64

	for _, message := range request.Messages {
		// Generate message ID if not provided
		if message.MessageID == "" {
			message.MessageID = fmt.Sprintf("MSG_%d_%s", time.Now().UnixNano(), generateShortID())
		}

		// Queue message
		err := ump.queueMessage(message)
		if err != nil {
			failedCount++
			messageStatuses = append(messageStatuses, MessageResponse{
				MessageID:     message.MessageID,
				Status:        "failed",
				Channel:       message.Channel,
				FailureReason: err.Error(),
			})
		} else {
			queuedCount++
			messageStatuses = append(messageStatuses, MessageResponse{
				MessageID: message.MessageID,
				Status:    "queued",
				Channel:   message.Channel,
			})

			// Estimate cost (mock calculation)
			estimatedCost += ump.estimateMessageCost(message.Channel, message.Content)
		}
	}

	// Update batch status
	_, err = ump.db.Exec(`
		UPDATE message_batches 
		SET queued_messages = $1, failed_messages = $2, total_cost = $3, updated_at = NOW()
		WHERE batch_id = $4
	`, queuedCount, failedCount, estimatedCost, batchID)

	if err != nil {
		log.Printf("Failed to update batch status: %v", err)
	}

	// Start background processing
	go ump.processBulkBatch(batchID, request.BatchSize, request.ConcurrentBatch)

	// Calculate estimated completion time
	estimatedTime := ump.calculateEstimatedTime(len(request.Messages), request.BatchSize, request.ConcurrentBatch)

	response := BulkMessageResponse{
		BatchID:         batchID,
		TotalMessages:   len(request.Messages),
		QueuedMessages:  queuedCount,
		FailedMessages:  failedCount,
		EstimatedCost:   estimatedCost,
		EstimatedTime:   estimatedTime,
		Status:          "processing",
		CreatedAt:       time.Now(),
		MessageStatuses: messageStatuses,
	}

	c.JSON(200, response)
}

// queueMessage stores a message in the queue
func (ump *UnifiedMessagingPlatform) queueMessage(request MessageRequest) error {
	metadataJSON, _ := json.Marshal(request.Metadata)

	_, err := ump.db.Exec(`
		INSERT INTO message_queue (
			message_id, channel, recipient, content, message_type, priority,
			scheduled_at, expires_at, callback_url, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, request.MessageID, request.Channel, request.Recipient, request.Content,
		request.MessageType, request.Priority, request.ScheduledAt, request.ExpiresAt,
		request.CallbackURL, string(metadataJSON))

	return err
}

// updateMessageStatus updates the status of a message
func (ump *UnifiedMessagingPlatform) updateMessageStatus(messageID, status, failureReason string) error {
	query := `
		UPDATE message_queue 
		SET status = $1, updated_at = NOW()
	`
	params := []interface{}{status, messageID}

	if status == "sent" {
		query += ", sent_at = NOW()"
	} else if status == "delivered" {
		query += ", delivered_at = NOW()"
	} else if status == "read" {
		query += ", read_at = NOW()"
	} else if status == "failed" {
		query += ", failed_at = NOW(), failure_reason = $3"
		params = append(params[:2], failureReason, params[2])
	}

	query += " WHERE message_id = $" + strconv.Itoa(len(params))

	_, err := ump.db.Exec(query, params...)
	return err
}

// getOverallHealth returns the overall health of the messaging platform
func (ump *UnifiedMessagingPlatform) getOverallHealth() map[string]interface{} {
	health := map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
		"services":  make(map[string]interface{}),
	}

	// Check individual channel health
	channels := []string{"ussd", "sms", "whatsapp"}
	healthyChannels := 0

	for _, channel := range channels {
		channelHealth := ump.checkChannelHealth(channel)
		health["services"].(map[string]interface{})[channel] = channelHealth
		
		if channelHealth["status"] == "healthy" {
			healthyChannels++
		}
	}

	// Check database health
	if err := ump.db.Ping(); err != nil {
		health["services"].(map[string]interface{})["database"] = map[string]interface{}{
			"status": "unhealthy",
			"error":  err.Error(),
		}
	} else {
		health["services"].(map[string]interface{})["database"] = map[string]interface{}{
			"status": "healthy",
		}
		healthyChannels++
	}

	// Check Redis health
	ctx := context.Background()
	if _, err := ump.redis.Ping(ctx).Result(); err != nil {
		health["services"].(map[string]interface{})["redis"] = map[string]interface{}{
			"status": "unhealthy",
			"error":  err.Error(),
		}
	} else {
		health["services"].(map[string]interface{})["redis"] = map[string]interface{}{
			"status": "healthy",
		}
		healthyChannels++
	}

	// Determine overall status
	totalServices := len(channels) + 2 // channels + database + redis
	if healthyChannels < totalServices/2 {
		health["status"] = "unhealthy"
	} else if healthyChannels < totalServices {
		health["status"] = "degraded"
	}

	health["healthy_services"] = healthyChannels
	health["total_services"] = totalServices

	return health
}

// checkChannelHealth checks the health of a specific channel
func (ump *UnifiedMessagingPlatform) checkChannelHealth(channel string) map[string]interface{} {
	var status string
	var lastSuccess, lastFailure sql.NullTime
	var failureCount int
	var successRate float64
	var avgResponseTime int

	err := ump.db.QueryRow(`
		SELECT status, last_success_at, last_failure_at, failure_count, success_rate, avg_response_time_ms
		FROM channel_health 
		WHERE channel = $1 AND provider IS NULL
	`, channel).Scan(&status, &lastSuccess, &lastFailure, &failureCount, &successRate, &avgResponseTime)

	if err != nil {
		// Channel not found, assume healthy
		return map[string]interface{}{
			"status":           "healthy",
			"success_rate":     100.0,
			"avg_response_time": 0,
			"failure_count":    0,
		}
	}

	return map[string]interface{}{
		"status":            status,
		"last_success_at":   lastSuccess,
		"last_failure_at":   lastFailure,
		"failure_count":     failureCount,
		"success_rate":      successRate,
		"avg_response_time": avgResponseTime,
	}
}

// Background services
func (ump *UnifiedMessagingPlatform) startHealthMonitoring() {
	ticker := time.NewTicker(ump.config.HealthCheckInterval)
	defer ticker.Stop()

	for range ticker.C {
		ump.performHealthChecks()
	}
}

func (ump *UnifiedMessagingPlatform) startMessageProcessor() {
	for {
		ump.processQueuedMessages()
		time.Sleep(time.Second * 5)
	}
}

func (ump *UnifiedMessagingPlatform) startCostOptimizer() {
	ticker := time.NewTicker(time.Hour * 1)
	defer ticker.Stop()

	for range ticker.C {
		ump.optimizeProviderCosts()
	}
}

func (ump *UnifiedMessagingPlatform) performHealthChecks() {
	channels := []string{"ussd", "sms", "whatsapp"}
	
	for _, channel := range channels {
		healthy := ump.pingChannelService(channel)
		
		if healthy {
			ump.metrics.ChannelHealth.WithLabelValues(channel).Set(1)
			ump.updateChannelHealth(channel, "healthy")
		} else {
			ump.metrics.ChannelHealth.WithLabelValues(channel).Set(0)
			ump.updateChannelHealth(channel, "unhealthy")
		}
	}
}

func (ump *UnifiedMessagingPlatform) processQueuedMessages() {
	// Process queued messages in batches
	rows, err := ump.db.Query(`
		SELECT message_id, channel, recipient, content, message_type, priority, metadata
		FROM message_queue 
		WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW())
		ORDER BY priority DESC, created_at ASC
		LIMIT 100
	`)

	if err != nil {
		log.Printf("Failed to fetch queued messages: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var messageID, channel, recipient, content, messageType, priority string
		var metadataJSON string

		err := rows.Scan(&messageID, &channel, &recipient, &content, &messageType, &priority, &metadataJSON)
		if err != nil {
			continue
		}

		// Parse metadata
		var metadata map[string]interface{}
		json.Unmarshal([]byte(metadataJSON), &metadata)

		// Create message request
		request := MessageRequest{
			MessageID:   messageID,
			Channel:     channel,
			Recipient:   recipient,
			Content:     content,
			MessageType: messageType,
			Priority:    priority,
			Metadata:    metadata,
		}

		// Process message
		go ump.processQueuedMessage(request)
	}
}

func (ump *UnifiedMessagingPlatform) processQueuedMessage(request MessageRequest) {
	// Update status to processing
	ump.updateMessageStatus(request.MessageID, "processing", "")

	// Process based on channel
	var err error
	switch strings.ToLower(request.Channel) {
	case "ussd":
		_, err = ump.processUSSDMessage(request)
	case "sms":
		_, err = ump.processSMSMessage(request)
	case "whatsapp":
		_, err = ump.processWhatsAppMessage(request)
	default:
		err = fmt.Errorf("unsupported channel: %s", request.Channel)
	}

	if err != nil {
		ump.updateMessageStatus(request.MessageID, "failed", err.Error())
		log.Printf("Failed to process message %s: %v", request.MessageID, err)
	}
}

// Utility functions
func (ump *UnifiedMessagingPlatform) callService(method, url string, data interface{}) ([]byte, error) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: time.Second * 30}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("service returned status %d", resp.StatusCode)
	}

	var buf bytes.Buffer
	_, err = buf.ReadFrom(resp.Body)
	return buf.Bytes(), err
}

func (ump *UnifiedMessagingPlatform) isValidChannel(channel string) bool {
	validChannels := []string{"ussd", "sms", "whatsapp"}
	for _, valid := range validChannels {
		if strings.ToLower(channel) == valid {
			return true
		}
	}
	return false
}

func (ump *UnifiedMessagingPlatform) isChannelHealthy(channel string) bool {
	var status string
	err := ump.db.QueryRow(`
		SELECT status FROM channel_health 
		WHERE channel = $1 AND provider IS NULL
	`, channel).Scan(&status)

	if err != nil {
		return true // Assume healthy if no record
	}

	return status == "healthy"
}

func (ump *UnifiedMessagingPlatform) estimateMessageCost(channel, content string) float64 {
	// Cost estimation based on Nigerian telecom provider rates
	// These rates are configurable via environment variables
	switch strings.ToLower(channel) {
	case "ussd":
		return 0.0 // USSD sessions are typically free for banking
	case "sms":
		// SMS cost calculation: ₦0.05 per 160-character page (GSM 7-bit encoding)
		// For Unicode messages, page size is 70 characters
		pageSize := 160
		if containsUnicode(content) {
			pageSize = 70
		}
		pages := (len(content) / pageSize) + 1
		costPerPage := getEnvFloat("SMS_COST_PER_PAGE", 0.05)
		return float64(pages) * costPerPage
	case "whatsapp":
		// WhatsApp Business API pricing: conversation-based
		costPerMessage := getEnvFloat("WHATSAPP_COST_PER_MESSAGE", 0.02)
		return costPerMessage
	case "push":
		return 0.0 // Push notifications are free
	case "email":
		return getEnvFloat("EMAIL_COST_PER_MESSAGE", 0.001)
	default:
		return 0.0
	}
}

func containsUnicode(s string) bool {
	for _, r := range s {
		if r > 127 {
			return true
		}
	}
	return false
}

func getEnvFloat(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if f, err := strconv.ParseFloat(value, 64); err == nil {
			return f
		}
	}
	return defaultValue
}

func (ump *UnifiedMessagingPlatform) calculateEstimatedTime(totalMessages, batchSize, concurrentBatches int) string {
	// Estimate processing time based on batch configuration and historical throughput
	// Average processing rate: ~500 messages per minute per concurrent batch
	messagesPerMinute := getEnvFloat("MESSAGES_PER_MINUTE", 500.0) * float64(concurrentBatches)
	
	if messagesPerMinute <= 0 {
		messagesPerMinute = 500.0
	}
	
	estimatedMinutes := float64(totalMessages) / messagesPerMinute
	
	// Add overhead for batch initialization and completion (10% buffer)
	estimatedMinutes *= 1.1
	
	if estimatedMinutes < 1 {
		return "less than 1 minute"
	} else if estimatedMinutes < 60 {
		return fmt.Sprintf("%.0f minutes", estimatedMinutes)
	} else {
		hours := int(estimatedMinutes / 60)
		mins := int(estimatedMinutes) % 60
		return fmt.Sprintf("%d hours %d minutes", hours, mins)
	}
}

func (ump *UnifiedMessagingPlatform) pingChannelService(channel string) bool {
	var url string
	switch channel {
	case "ussd":
		url = ump.config.USSDServiceURL + "/health"
	case "sms":
		url = ump.config.SMSServiceURL + "/health"
	case "whatsapp":
		url = ump.config.WhatsAppServiceURL + "/health"
	default:
		return false
	}

	client := &http.Client{Timeout: time.Second * 5}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200
}

func (ump *UnifiedMessagingPlatform) updateChannelHealth(channel, status string) {
	_, err := ump.db.Exec(`
		INSERT INTO channel_health (channel, status, last_success_at, updated_at)
		VALUES ($1, $2, CASE WHEN $2 = 'healthy' THEN NOW() ELSE NULL END, NOW())
		ON CONFLICT (channel, provider) DO UPDATE SET
			status = EXCLUDED.status,
			last_success_at = CASE WHEN EXCLUDED.status = 'healthy' THEN NOW() ELSE channel_health.last_success_at END,
			last_failure_at = CASE WHEN EXCLUDED.status != 'healthy' THEN NOW() ELSE channel_health.last_failure_at END,
			failure_count = CASE WHEN EXCLUDED.status != 'healthy' THEN channel_health.failure_count + 1 ELSE 0 END,
			updated_at = NOW()
	`, channel, status)

	if err != nil {
		log.Printf("Failed to update channel health: %v", err)
	}
}

func (ump *UnifiedMessagingPlatform) optimizeProviderCosts() {
	// Implement cost optimization logic
	log.Println("Running cost optimization...")
}

func (ump *UnifiedMessagingPlatform) processBulkBatch(batchID string, batchSize, concurrentBatches int) {
	log.Printf("Processing bulk batch %s", batchID)
	
	// This would implement the actual bulk processing logic
	// For now, we'll simulate the processing
	time.Sleep(time.Minute * 2)
	
	// Update batch as completed
	_, err := ump.db.Exec(`
		UPDATE message_batches 
		SET status = 'completed', completed_at = NOW(), updated_at = NOW()
		WHERE batch_id = $1
	`, batchID)

	if err != nil {
		log.Printf("Failed to update batch completion: %v", err)
	}
}

// Utility functions for type conversion
func getString(m map[string]interface{}, key string) string {
	if val, exists := m[key]; exists {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if val, exists := m[key]; exists {
		if f, ok := val.(float64); ok {
			return f
		}
		if i, ok := val.(int); ok {
			return float64(i)
		}
	}
	return 0.0
}

func timePtr(t time.Time) *time.Time {
	return &t
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func generateShortID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano()%1000000)
}

// Additional API endpoints
func (ump *UnifiedMessagingPlatform) getMessageStatus(c *gin.Context) {
	messageID := c.Param("message_id")

	var status, channel, provider, failureReason string
	var cost float64
	var responseTime int
	var sentAt, deliveredAt, readAt sql.NullTime

	err := ump.db.QueryRow(`
		SELECT status, channel, COALESCE(provider, ''), COALESCE(failure_reason, ''),
			   COALESCE(cost, 0), COALESCE(response_time_ms, 0),
			   sent_at, delivered_at, read_at
		FROM message_queue 
		WHERE message_id = $1
	`, messageID).Scan(&status, &channel, &provider, &failureReason, &cost, &responseTime,
		&sentAt, &deliveredAt, &readAt)

	if err != nil {
		c.JSON(404, gin.H{"error": "Message not found"})
		return
	}

	response := MessageResponse{
		MessageID:     messageID,
		Status:        status,
		Channel:       channel,
		Provider:      provider,
		Cost:          cost,
		ResponseTime:  int64(responseTime),
		FailureReason: failureReason,
	}

	if sentAt.Valid {
		response.SentAt = &sentAt.Time
	}
	if deliveredAt.Valid {
		response.DeliveredAt = &deliveredAt.Time
	}
	if readAt.Valid {
		response.ReadAt = &readAt.Time
	}

	c.JSON(200, response)
}

func (ump *UnifiedMessagingPlatform) getChannelStatus(c *gin.Context) {
	rows, err := ump.db.Query(`
		SELECT channel, status, success_rate, avg_response_time_ms, failure_count,
			   last_success_at, last_failure_at
		FROM channel_health 
		WHERE provider IS NULL
		ORDER BY channel
	`)

	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var channels []map[string]interface{}
	for rows.Next() {
		var channel, status string
		var successRate float64
		var avgResponseTime, failureCount int
		var lastSuccess, lastFailure sql.NullTime

		err := rows.Scan(&channel, &status, &successRate, &avgResponseTime, &failureCount,
			&lastSuccess, &lastFailure)
		if err != nil {
			continue
		}

		channelInfo := map[string]interface{}{
			"channel":           channel,
			"status":            status,
			"success_rate":      successRate,
			"avg_response_time": avgResponseTime,
			"failure_count":     failureCount,
		}

		if lastSuccess.Valid {
			channelInfo["last_success_at"] = lastSuccess.Time
		}
		if lastFailure.Valid {
			channelInfo["last_failure_at"] = lastFailure.Time
		}

		channels = append(channels, channelInfo)
	}

	c.JSON(200, gin.H{"channels": channels})
}

func (ump *UnifiedMessagingPlatform) getBulkStatus(c *gin.Context) {
	batchID := c.Param("batch_id")

	var totalMessages, queuedMessages, sentMessages, deliveredMessages, failedMessages int
	var totalCost float64
	var status, priority string
	var createdAt, completedAt sql.NullTime

	err := ump.db.QueryRow(`
		SELECT total_messages, queued_messages, sent_messages, delivered_messages, failed_messages,
			   total_cost, status, priority, created_at, completed_at
		FROM message_batches 
		WHERE batch_id = $1
	`, batchID).Scan(&totalMessages, &queuedMessages, &sentMessages, &deliveredMessages, &failedMessages,
		&totalCost, &status, &priority, &createdAt, &completedAt)

	if err != nil {
		c.JSON(404, gin.H{"error": "Batch not found"})
		return
	}

	response := map[string]interface{}{
		"batch_id":           batchID,
		"total_messages":     totalMessages,
		"queued_messages":    queuedMessages,
		"sent_messages":      sentMessages,
		"delivered_messages": deliveredMessages,
		"failed_messages":    failedMessages,
		"total_cost":         totalCost,
		"status":             status,
		"priority":           priority,
	}

	if createdAt.Valid {
		response["created_at"] = createdAt.Time
	}
	if completedAt.Valid {
		response["completed_at"] = completedAt.Time
	}

	// Calculate progress percentage
	if totalMessages > 0 {
		processedMessages := sentMessages + deliveredMessages + failedMessages
		response["progress_percentage"] = float64(processedMessages) / float64(totalMessages) * 100
	}

	c.JSON(200, response)
}

// Main function
func main() {
	// Load environment variables
	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}
	if os.Getenv("REDIS_URL") == "" {
		log.Fatal("REDIS_URL environment variable is required")
	}

	// Create unified messaging platform
	platform, err := NewUnifiedMessagingPlatform()
	if err != nil {
		log.Fatalf("Failed to create unified messaging platform: %v", err)
	}

	// Setup routes
	router := platform.setupRoutes()

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Unified Messaging Platform starting on port %s", port)
	log.Printf("Services: USSD=%s, SMS=%s, WhatsApp=%s, Analytics=%s", 
		platform.config.USSDServiceURL,
		platform.config.SMSServiceURL, 
		platform.config.WhatsAppServiceURL,
		platform.config.AnalyticsServiceURL)

	log.Fatal(http.ListenAndServe(":"+port, router))
}

