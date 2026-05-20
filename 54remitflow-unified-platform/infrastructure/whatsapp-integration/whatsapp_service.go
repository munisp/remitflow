package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// WhatsAppService handles all WhatsApp Business API operations
type WhatsAppService struct {
	accessToken        string
	phoneNumberID      string
	businessAccountID  string
	webhookVerifyToken string
	webhookSecret      string
	httpClient         *http.Client
	db                 *gorm.DB
	redis              *redis.Client
	metrics            *WhatsAppMetrics
}

// WhatsAppMetrics contains Prometheus metrics for monitoring
type WhatsAppMetrics struct {
	MessagesSent        *prometheus.CounterVec
	MessagesDelivered   *prometheus.CounterVec
	MessagesRead        *prometheus.CounterVec
	MessagesFailed      *prometheus.CounterVec
	WebhookEvents       *prometheus.CounterVec
	ResponseTime        *prometheus.HistogramVec
	TemplateApprovals   *prometheus.CounterVec
	DeliveryRate        *prometheus.GaugeVec
	ActiveSessions      *prometheus.GaugeVec
}

// WhatsAppMessage represents a WhatsApp message in the database
type WhatsAppMessage struct {
	ID              string                 `json:"id" gorm:"primaryKey"`
	RecipientPhone  string                 `json:"recipient_phone" gorm:"not null;index"`
	MessageType     string                 `json:"message_type" gorm:"not null"`
	Content         string                 `json:"content"`
	TemplateID      string                 `json:"template_id"`
	TemplateParams  map[string]interface{} `json:"template_params" gorm:"type:jsonb"`
	MediaURL        string                 `json:"media_url"`
	MediaType       string                 `json:"media_type"`
	Status          string                 `json:"status" gorm:"default:'pending'"`
	WhatsAppID      string                 `json:"whatsapp_id" gorm:"index"`
	ConversationID  string                 `json:"conversation_id" gorm:"index"`
	SentAt          *time.Time             `json:"sent_at"`
	DeliveredAt     *time.Time             `json:"delivered_at"`
	ReadAt          *time.Time             `json:"read_at"`
	FailureReason   string                 `json:"failure_reason"`
	RetryCount      int                    `json:"retry_count" gorm:"default:0"`
	Priority        string                 `json:"priority" gorm:"default:'normal'"`
	CreatedBy       string                 `json:"created_by"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

// IncomingMessage represents an incoming WhatsApp message
type IncomingMessage struct {
	ID            string                 `json:"id" gorm:"primaryKey"`
	WhatsAppID    string                 `json:"whatsapp_id" gorm:"index"`
	SenderPhone   string                 `json:"sender_phone" gorm:"not null;index"`
	MessageType   string                 `json:"message_type" gorm:"not null"`
	Content       string                 `json:"content"`
	MediaURL      string                 `json:"media_url"`
	MediaType     string                 `json:"media_type"`
	Context       map[string]interface{} `json:"context" gorm:"type:jsonb"`
	ReceivedAt    time.Time              `json:"received_at"`
	PhoneNumberID string                 `json:"phone_number_id"`
	Processed     bool                   `json:"processed" gorm:"default:false"`
	ProcessedAt   *time.Time             `json:"processed_at"`
	CreatedAt     time.Time              `json:"created_at"`
}

// WhatsAppTemplate represents a message template
type WhatsAppTemplate struct {
	ID          string                 `json:"id" gorm:"primaryKey"`
	Name        string                 `json:"name" gorm:"uniqueIndex;not null"`
	Category    string                 `json:"category" gorm:"not null"`
	Language    string                 `json:"language" gorm:"default:'en'"`
	Status      string                 `json:"status" gorm:"default:'pending'"`
	Components  []TemplateComponent    `json:"components" gorm:"type:jsonb"`
	Variables   []string               `json:"variables" gorm:"type:text[]"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	ApprovedAt  *time.Time             `json:"approved_at"`
}

// TemplateComponent represents a component of a WhatsApp template
type TemplateComponent struct {
	Type       string              `json:"type"`
	Text       string              `json:"text,omitempty"`
	Parameters []TemplateParameter `json:"parameters,omitempty"`
}

// TemplateParameter represents a parameter in a template component
type TemplateParameter struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// Message structures for WhatsApp API
type TextMessage struct {
	MessagingProduct string `json:"messaging_product"`
	To               string `json:"to"`
	Type             string `json:"type"`
	Text             struct {
		Body string `json:"body"`
	} `json:"text"`
}

type TemplateMessage struct {
	MessagingProduct string `json:"messaging_product"`
	To               string `json:"to"`
	Type             string `json:"type"`
	Template         struct {
		Name       string `json:"name"`
		Language   struct {
			Code string `json:"code"`
		} `json:"language"`
		Components []TemplateComponent `json:"components,omitempty"`
	} `json:"template"`
}

type MediaMessage struct {
	MessagingProduct string       `json:"messaging_product"`
	To               string       `json:"to"`
	Type             string       `json:"type"`
	Image            *MediaObject `json:"image,omitempty"`
	Document         *MediaObject `json:"document,omitempty"`
	Audio            *MediaObject `json:"audio,omitempty"`
	Video            *MediaObject `json:"video,omitempty"`
}

type MediaObject struct {
	Link     string `json:"link,omitempty"`
	ID       string `json:"id,omitempty"`
	Caption  string `json:"caption,omitempty"`
	Filename string `json:"filename,omitempty"`
}

// WhatsApp API Response structures
type WhatsAppAPIResponse struct {
	Messages []struct {
		ID string `json:"id"`
	} `json:"messages"`
	Error struct {
		Message   string `json:"message"`
		Code      int    `json:"code"`
		ErrorData struct {
			Details string `json:"details"`
		} `json:"error_data"`
	} `json:"error"`
}

// Webhook structures
type WebhookEvent struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Value struct {
				MessagingProduct string `json:"messaging_product"`
				Metadata         struct {
					DisplayPhoneNumber string `json:"display_phone_number"`
					PhoneNumberID      string `json:"phone_number_id"`
				} `json:"metadata"`
				Messages []struct {
					ID        string `json:"id"`
					From      string `json:"from"`
					Timestamp string `json:"timestamp"`
					Type      string `json:"type"`
					Text      struct {
						Body string `json:"body"`
					} `json:"text,omitempty"`
					Image struct {
						ID       string `json:"id"`
						MimeType string `json:"mime_type"`
						SHA256   string `json:"sha256"`
						Caption  string `json:"caption"`
					} `json:"image,omitempty"`
					Document struct {
						ID       string `json:"id"`
						MimeType string `json:"mime_type"`
						SHA256   string `json:"sha256"`
						Caption  string `json:"caption"`
						Filename string `json:"filename"`
					} `json:"document,omitempty"`
					Audio struct {
						ID       string `json:"id"`
						MimeType string `json:"mime_type"`
						SHA256   string `json:"sha256"`
					} `json:"audio,omitempty"`
					Context struct {
						From string `json:"from"`
						ID   string `json:"id"`
					} `json:"context,omitempty"`
				} `json:"messages,omitempty"`
				Statuses []struct {
					ID           string `json:"id"`
					Status       string `json:"status"`
					Timestamp    string `json:"timestamp"`
					RecipientID  string `json:"recipient_id"`
					Conversation struct {
						ID     string `json:"id"`
						Origin struct {
							Type string `json:"type"`
						} `json:"origin"`
					} `json:"conversation,omitempty"`
					Pricing struct {
						Billable     bool   `json:"billable"`
						PricingModel string `json:"pricing_model"`
						Category     string `json:"category"`
					} `json:"pricing,omitempty"`
					Errors []struct {
						Code    int    `json:"code"`
						Title   string `json:"title"`
						Message string `json:"message"`
						Details string `json:"details"`
					} `json:"errors,omitempty"`
				} `json:"statuses,omitempty"`
			} `json:"value"`
			Field string `json:"field"`
		} `json:"changes"`
	} `json:"entry"`
}

// NewWhatsAppMetrics creates new Prometheus metrics
func NewWhatsAppMetrics() *WhatsAppMetrics {
	return &WhatsAppMetrics{
		MessagesSent: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_messages_sent_total",
				Help: "Total number of WhatsApp messages sent",
			},
			[]string{"message_type", "template_name"},
		),
		MessagesDelivered: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_messages_delivered_total",
				Help: "Total number of WhatsApp messages delivered",
			},
			[]string{"message_type", "template_name"},
		),
		MessagesRead: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_messages_read_total",
				Help: "Total number of WhatsApp messages read",
			},
			[]string{"message_type", "template_name"},
		),
		MessagesFailed: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_messages_failed_total",
				Help: "Total number of WhatsApp messages failed",
			},
			[]string{"message_type", "failure_reason"},
		),
		WebhookEvents: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_webhook_events_total",
				Help: "Total number of webhook events received",
			},
			[]string{"event_type", "status"},
		),
		ResponseTime: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "whatsapp_response_time_seconds",
				Help:    "Response time for WhatsApp API calls",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"operation"},
		),
		TemplateApprovals: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "whatsapp_template_approvals_total",
				Help: "Total number of template approvals",
			},
			[]string{"template_name", "status"},
		),
		DeliveryRate: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "whatsapp_delivery_rate_percent",
				Help: "Current WhatsApp message delivery rate percentage",
			},
			[]string{"time_window"},
		),
		ActiveSessions: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "whatsapp_active_sessions",
				Help: "Number of active WhatsApp conversations",
			},
			[]string{"session_type"},
		),
	}
}

// NewWhatsAppService creates a new WhatsApp service instance
func NewWhatsAppService() (*WhatsAppService, error) {
	// Initialize database connection
	db, err := gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %v", err)
	}

	// Auto-migrate database schema
	err = db.AutoMigrate(&WhatsAppMessage{}, &IncomingMessage{}, &WhatsAppTemplate{})
	if err != nil {
		return nil, fmt.Errorf("failed to migrate database: %v", err)
	}

	// Initialize Redis connection
	redisClient := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_URL"),
		Password: "",
		DB:       0,
	})

	// Test Redis connection
	_, err = redisClient.Ping(context.Background()).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %v", err)
	}

	metrics := NewWhatsAppMetrics()

	// Register Prometheus metrics
	prometheus.MustRegister(
		metrics.MessagesSent,
		metrics.MessagesDelivered,
		metrics.MessagesRead,
		metrics.MessagesFailed,
		metrics.WebhookEvents,
		metrics.ResponseTime,
		metrics.TemplateApprovals,
		metrics.DeliveryRate,
		metrics.ActiveSessions,
	)

	service := &WhatsAppService{
		accessToken:        os.Getenv("WHATSAPP_ACCESS_TOKEN"),
		phoneNumberID:      os.Getenv("WHATSAPP_PHONE_NUMBER_ID"),
		businessAccountID:  os.Getenv("WHATSAPP_BUSINESS_ACCOUNT_ID"),
		webhookVerifyToken: os.Getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
		webhookSecret:      os.Getenv("WHATSAPP_WEBHOOK_SECRET"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		db:      db,
		redis:   redisClient,
		metrics: metrics,
	}

	// Start background services
	go service.startDeliveryRateMonitor()
	go service.startRetryProcessor()
	go service.startQueueProcessor()

	return service, nil
}

// SendTextMessage sends a text message via WhatsApp Business API
func (ws *WhatsAppService) SendTextMessage(recipientPhone, message, createdBy string) (*WhatsAppMessage, error) {
	start := time.Now()
	defer func() {
		ws.metrics.ResponseTime.WithLabelValues("send_text").Observe(time.Since(start).Seconds())
	}()

	// Validate phone number
	if !ws.isValidPhoneNumber(recipientPhone) {
		return nil, fmt.Errorf("invalid phone number: %s", recipientPhone)
	}

	// Create message record
	msg := &WhatsAppMessage{
		ID:             generateMessageID(),
		RecipientPhone: ws.normalizePhoneNumber(recipientPhone),
		MessageType:    "text",
		Content:        message,
		Status:         "pending",
		CreatedBy:      createdBy,
		CreatedAt:      time.Now(),
	}

	// Save to database
	if err := ws.db.Create(msg).Error; err != nil {
		return nil, fmt.Errorf("failed to save message: %v", err)
	}

	// Prepare WhatsApp API request
	textMsg := TextMessage{
		MessagingProduct: "whatsapp",
		To:               msg.RecipientPhone,
		Type:             "text",
		Text: struct {
			Body string `json:"body"`
		}{Body: message},
	}

	// Send to WhatsApp API
	response, err := ws.sendToWhatsAppAPI(textMsg)
	if err != nil {
		msg.Status = "failed"
		msg.FailureReason = err.Error()
		ws.db.Save(msg)
		ws.metrics.MessagesFailed.WithLabelValues("text", "api_error").Inc()
		return msg, err
	}

	// Update message with WhatsApp ID
	if len(response.Messages) > 0 {
		msg.WhatsAppID = response.Messages[0].ID
		msg.Status = "sent"
		now := time.Now()
		msg.SentAt = &now
		ws.db.Save(msg)

		ws.metrics.MessagesSent.WithLabelValues("text", "").Inc()
	}

	return msg, nil
}

// SendTemplateMessage sends a template message via WhatsApp Business API
func (ws *WhatsAppService) SendTemplateMessage(recipientPhone, templateName string, parameters []string, createdBy string) (*WhatsAppMessage, error) {
	start := time.Now()
	defer func() {
		ws.metrics.ResponseTime.WithLabelValues("send_template").Observe(time.Since(start).Seconds())
	}()

	// Validate phone number
	if !ws.isValidPhoneNumber(recipientPhone) {
		return nil, fmt.Errorf("invalid phone number: %s", recipientPhone)
	}

	// Check if template exists and is approved
	var template WhatsAppTemplate
	if err := ws.db.Where("name = ? AND status = ?", templateName, "approved").First(&template).Error; err != nil {
		return nil, fmt.Errorf("template not found or not approved: %s", templateName)
	}

	// Create message record
	msg := &WhatsAppMessage{
		ID:             generateMessageID(),
		RecipientPhone: ws.normalizePhoneNumber(recipientPhone),
		MessageType:    "template",
		TemplateID:     templateName,
		Status:         "pending",
		CreatedBy:      createdBy,
		CreatedAt:      time.Now(),
	}

	// Convert parameters to template parameters
	var templateParams []TemplateParameter
	for _, param := range parameters {
		templateParams = append(templateParams, TemplateParameter{
			Type: "text",
			Text: param,
		})
	}

	// Prepare template message
	templateMsg := TemplateMessage{
		MessagingProduct: "whatsapp",
		To:               msg.RecipientPhone,
		Type:             "template",
		Template: struct {
			Name       string `json:"name"`
			Language   struct {
				Code string `json:"code"`
			} `json:"language"`
			Components []TemplateComponent `json:"components,omitempty"`
		}{
			Name: templateName,
			Language: struct {
				Code string `json:"code"`
			}{Code: template.Language},
			Components: []TemplateComponent{
				{
					Type:       "body",
					Parameters: templateParams,
				},
			},
		},
	}

	// Save to database
	if err := ws.db.Create(msg).Error; err != nil {
		return nil, fmt.Errorf("failed to save message: %v", err)
	}

	// Send to WhatsApp API
	response, err := ws.sendToWhatsAppAPI(templateMsg)
	if err != nil {
		msg.Status = "failed"
		msg.FailureReason = err.Error()
		ws.db.Save(msg)
		ws.metrics.MessagesFailed.WithLabelValues("template", "api_error").Inc()
		return msg, err
	}

	// Update message with WhatsApp ID
	if len(response.Messages) > 0 {
		msg.WhatsAppID = response.Messages[0].ID
		msg.Status = "sent"
		now := time.Now()
		msg.SentAt = &now
		ws.db.Save(msg)

		ws.metrics.MessagesSent.WithLabelValues("template", templateName).Inc()
	}

	return msg, nil
}

// SendMediaMessage sends a media message via WhatsApp Business API
func (ws *WhatsAppService) SendMediaMessage(recipientPhone, mediaType, mediaURL, caption, createdBy string) (*WhatsAppMessage, error) {
	start := time.Now()
	defer func() {
		ws.metrics.ResponseTime.WithLabelValues("send_media").Observe(time.Since(start).Seconds())
	}()

	// Validate phone number
	if !ws.isValidPhoneNumber(recipientPhone) {
		return nil, fmt.Errorf("invalid phone number: %s", recipientPhone)
	}

	// Validate media type
	validMediaTypes := []string{"image", "document", "audio", "video"}
	if !contains(validMediaTypes, mediaType) {
		return nil, fmt.Errorf("invalid media type: %s", mediaType)
	}

	// Create message record
	msg := &WhatsAppMessage{
		ID:             generateMessageID(),
		RecipientPhone: ws.normalizePhoneNumber(recipientPhone),
		MessageType:    mediaType,
		MediaURL:       mediaURL,
		MediaType:      mediaType,
		Content:        caption,
		Status:         "pending",
		CreatedBy:      createdBy,
		CreatedAt:      time.Now(),
	}

	// Prepare media message
	mediaMsg := MediaMessage{
		MessagingProduct: "whatsapp",
		To:               msg.RecipientPhone,
		Type:             mediaType,
	}

	mediaObj := &MediaObject{
		Link:    mediaURL,
		Caption: caption,
	}

	switch mediaType {
	case "image":
		mediaMsg.Image = mediaObj
	case "document":
		mediaMsg.Document = mediaObj
		if caption != "" {
			mediaMsg.Document.Filename = caption
		}
	case "audio":
		mediaMsg.Audio = mediaObj
	case "video":
		mediaMsg.Video = mediaObj
	}

	// Save to database
	if err := ws.db.Create(msg).Error; err != nil {
		return nil, fmt.Errorf("failed to save message: %v", err)
	}

	// Send to WhatsApp API
	response, err := ws.sendToWhatsAppAPI(mediaMsg)
	if err != nil {
		msg.Status = "failed"
		msg.FailureReason = err.Error()
		ws.db.Save(msg)
		ws.metrics.MessagesFailed.WithLabelValues(mediaType, "api_error").Inc()
		return msg, err
	}

	// Update message with WhatsApp ID
	if len(response.Messages) > 0 {
		msg.WhatsAppID = response.Messages[0].ID
		msg.Status = "sent"
		now := time.Now()
		msg.SentAt = &now
		ws.db.Save(msg)

		ws.metrics.MessagesSent.WithLabelValues(mediaType, "").Inc()
	}

	return msg, nil
}

// sendToWhatsAppAPI sends a request to the WhatsApp Business API
func (ws *WhatsAppService) sendToWhatsAppAPI(payload interface{}) (*WhatsAppAPIResponse, error) {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %v", err)
	}

	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", ws.phoneNumberID)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+ws.accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := ws.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	var apiResponse WhatsAppAPIResponse
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	if resp.StatusCode != 200 {
		errorMsg := apiResponse.Error.Message
		if errorMsg == "" {
			errorMsg = string(body)
		}
		return nil, fmt.Errorf("WhatsApp API error (status %d): %s", resp.StatusCode, errorMsg)
	}

	return &apiResponse, nil
}

// Webhook handlers
func (ws *WhatsAppService) handleWebhookVerification(c *gin.Context) {
	mode := c.Query("hub.mode")
	token := c.Query("hub.verify_token")
	challenge := c.Query("hub.challenge")

	if mode == "subscribe" && token == ws.webhookVerifyToken {
		log.Printf("Webhook verified successfully")
		c.String(200, challenge)
		return
	}

	log.Printf("Webhook verification failed: mode=%s, token=%s", mode, token)
	c.JSON(403, gin.H{"error": "Forbidden"})
}

func (ws *WhatsAppService) handleWebhookEvent(c *gin.Context) {
	// Verify webhook signature if secret is configured
	if ws.webhookSecret != "" {
		signature := c.GetHeader("X-Hub-Signature-256")
		if !ws.verifyWebhookSignature(c, signature) {
			c.JSON(403, gin.H{"error": "Invalid signature"})
			return
		}
	}

	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		log.Printf("Failed to parse webhook event: %v", err)
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// Process webhook event asynchronously
	go ws.processWebhookEvent(event)

	c.JSON(200, gin.H{"status": "received"})
}

func (ws *WhatsAppService) verifyWebhookSignature(c *gin.Context, signature string) bool {
	if signature == "" {
		return false
	}

	// Remove "sha256=" prefix
	signature = strings.TrimPrefix(signature, "sha256=")

	// Get request body
	body, err := c.GetRawData()
	if err != nil {
		return false
	}

	// Calculate expected signature
	mac := hmac.New(sha256.New, []byte(ws.webhookSecret))
	mac.Write(body)
	expectedSignature := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func (ws *WhatsAppService) processWebhookEvent(event WebhookEvent) {
	for _, entry := range event.Entry {
		for _, change := range entry.Changes {
			if change.Field == "messages" {
				// Process incoming messages
				for _, message := range change.Value.Messages {
					ws.processIncomingMessage(message, change.Value.Metadata.PhoneNumberID)
				}

				// Process message status updates
				for _, status := range change.Value.Statuses {
					ws.processMessageStatus(status)
				}
			}
		}
	}
}

func (ws *WhatsAppService) processIncomingMessage(message interface{}, phoneNumberID string) {
	// Convert message to map for easier access
	msgMap, ok := message.(map[string]interface{})
	if !ok {
		log.Printf("Failed to convert message to map")
		return
	}

	// Extract message details
	messageID, _ := msgMap["id"].(string)
	senderPhone, _ := msgMap["from"].(string)
	messageType, _ := msgMap["type"].(string)
	timestamp, _ := msgMap["timestamp"].(string)

	var content string
	var mediaURL string

	switch messageType {
	case "text":
		if textObj, ok := msgMap["text"].(map[string]interface{}); ok {
			content, _ = textObj["body"].(string)
		}
	case "image", "document", "audio", "video":
		if mediaObj, ok := msgMap[messageType].(map[string]interface{}); ok {
			if caption, exists := mediaObj["caption"]; exists {
				content, _ = caption.(string)
			}
			// Note: Media URL would need to be retrieved using the media ID
			if mediaID, exists := mediaObj["id"]; exists {
				mediaURL = fmt.Sprintf("media_id:%s", mediaID)
			}
		}
	}

	// Parse timestamp
	timestampInt, _ := strconv.ParseInt(timestamp, 10, 64)
	receivedAt := time.Unix(timestampInt, 0)

	// Store incoming message
	incomingMsg := &IncomingMessage{
		ID:            generateMessageID(),
		WhatsAppID:    messageID,
		SenderPhone:   senderPhone,
		MessageType:   messageType,
		Content:       content,
		MediaURL:      mediaURL,
		ReceivedAt:    receivedAt,
		PhoneNumberID: phoneNumberID,
		CreatedAt:     time.Now(),
	}

	if err := ws.db.Create(incomingMsg).Error; err != nil {
		log.Printf("Failed to save incoming message: %v", err)
		return
	}

	// Publish to message queue for processing
	ws.publishToQueue("incoming_messages", incomingMsg)

	ws.metrics.WebhookEvents.WithLabelValues("incoming_message", messageType).Inc()
	log.Printf("Processed incoming message: %s from %s", messageType, senderPhone)
}

func (ws *WhatsAppService) processMessageStatus(status interface{}) {
	// Convert status to map for easier access
	statusMap, ok := status.(map[string]interface{})
	if !ok {
		log.Printf("Failed to convert status to map")
		return
	}

	messageID, _ := statusMap["id"].(string)
	statusValue, _ := statusMap["status"].(string)
	timestamp, _ := statusMap["timestamp"].(string)
	recipientID, _ := statusMap["recipient_id"].(string)

	// Find message in database
	var msg WhatsAppMessage
	if err := ws.db.Where("whatsapp_id = ?", messageID).First(&msg).Error; err != nil {
		log.Printf("Message not found for status update: %s", messageID)
		return
	}

	// Parse timestamp
	timestampInt, _ := strconv.ParseInt(timestamp, 10, 64)
	statusTime := time.Unix(timestampInt, 0)

	// Update message status
	switch statusValue {
	case "sent":
		if msg.Status == "pending" {
			msg.Status = "sent"
			if msg.SentAt == nil {
				msg.SentAt = &statusTime
			}
			ws.metrics.MessagesSent.WithLabelValues(msg.MessageType, msg.TemplateID).Inc()
		}

	case "delivered":
		msg.Status = "delivered"
		msg.DeliveredAt = &statusTime
		ws.metrics.MessagesDelivered.WithLabelValues(msg.MessageType, msg.TemplateID).Inc()

	case "read":
		msg.Status = "read"
		msg.ReadAt = &statusTime
		ws.metrics.MessagesRead.WithLabelValues(msg.MessageType, msg.TemplateID).Inc()

	case "failed":
		msg.Status = "failed"
		if errors, ok := statusMap["errors"].([]interface{}); ok && len(errors) > 0 {
			if errorMap, ok := errors[0].(map[string]interface{}); ok {
				if message, ok := errorMap["message"].(string); ok {
					msg.FailureReason = message
				}
			}
		}
		if msg.FailureReason == "" {
			msg.FailureReason = "Delivery failed"
		}
		ws.metrics.MessagesFailed.WithLabelValues(msg.MessageType, "delivery_failed").Inc()
	}

	msg.UpdatedAt = time.Now()
	if err := ws.db.Save(&msg).Error; err != nil {
		log.Printf("Failed to update message status: %v", err)
		return
	}

	// Publish status update to queue
	statusUpdate := map[string]interface{}{
		"message_id":   msg.ID,
		"whatsapp_id":  messageID,
		"status":       statusValue,
		"recipient_id": recipientID,
		"timestamp":    statusTime,
	}
	ws.publishToQueue("message_status_updates", statusUpdate)

	ws.metrics.WebhookEvents.WithLabelValues("status_update", statusValue).Inc()
	log.Printf("Updated message status: %s -> %s", messageID, statusValue)
}

// Utility functions
func (ws *WhatsAppService) publishToQueue(queue string, data interface{}) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("Failed to marshal queue data: %v", err)
		return
	}

	err = ws.redis.LPush(context.Background(), queue, jsonData).Err()
	if err != nil {
		log.Printf("Failed to publish to queue %s: %v", queue, err)
	}
}

func (ws *WhatsAppService) isValidPhoneNumber(phone string) bool {
	// Basic validation for Nigerian phone numbers
	normalized := ws.normalizePhoneNumber(phone)
	return len(normalized) >= 13 && strings.HasPrefix(normalized, "+234")
}

func (ws *WhatsAppService) normalizePhoneNumber(phone string) string {
	// Remove all non-digit characters except +
	phone = strings.ReplaceAll(phone, " ", "")
	phone = strings.ReplaceAll(phone, "-", "")
	phone = strings.ReplaceAll(phone, "(", "")
	phone = strings.ReplaceAll(phone, ")", "")

	// Handle Nigerian phone numbers
	if strings.HasPrefix(phone, "0") {
		phone = "+234" + phone[1:]
	} else if strings.HasPrefix(phone, "234") {
		phone = "+" + phone
	} else if !strings.HasPrefix(phone, "+") {
		phone = "+234" + phone
	}

	return phone
}

func generateMessageID() string {
	return fmt.Sprintf("msg_%d_%s", time.Now().Unix(), uuid.New().String()[:8])
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// Background services
func (ws *WhatsAppService) startDeliveryRateMonitor() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		ws.calculateAndUpdateDeliveryRate()
	}
}

func (ws *WhatsAppService) calculateAndUpdateDeliveryRate() {
	now := time.Now()
	fiveMinutesAgo := now.Add(-5 * time.Minute)
	oneHourAgo := now.Add(-1 * time.Hour)
	oneDayAgo := now.Add(-24 * time.Hour)

	timeWindows := map[string]time.Time{
		"5m":  fiveMinutesAgo,
		"1h":  oneHourAgo,
		"24h": oneDayAgo,
	}

	for window, startTime := range timeWindows {
		var sent, delivered int64

		// Count sent messages
		ws.db.Model(&WhatsAppMessage{}).
			Where("created_at >= ? AND created_at <= ?", startTime, now).
			Where("status IN ?", []string{"sent", "delivered", "read", "failed"}).
			Count(&sent)

		// Count delivered messages
		ws.db.Model(&WhatsAppMessage{}).
			Where("created_at >= ? AND created_at <= ?", startTime, now).
			Where("status IN ?", []string{"delivered", "read"}).
			Count(&delivered)

		var rate float64 = 100.0
		if sent > 0 {
			rate = float64(delivered) / float64(sent) * 100
		}

		ws.metrics.DeliveryRate.WithLabelValues(window).Set(rate)
	}
}

func (ws *WhatsAppService) startRetryProcessor() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		ws.processFailedMessages()
	}
}

func (ws *WhatsAppService) processFailedMessages() {
	var failedMessages []WhatsAppMessage

	// Find messages that failed and can be retried
	ws.db.Where("status = ? AND retry_count < ? AND created_at > ?",
		"failed", 3, time.Now().Add(-24*time.Hour)).
		Find(&failedMessages)

	for _, msg := range failedMessages {
		// Check if enough time has passed for retry
		retryDelay := time.Duration(msg.RetryCount+1) * 5 * time.Minute
		if time.Since(msg.UpdatedAt) < retryDelay {
			continue
		}

		// Retry the message
		go ws.retryMessage(&msg)
	}
}

func (ws *WhatsAppService) retryMessage(msg *WhatsAppMessage) {
	msg.RetryCount++
	msg.Status = "pending"
	msg.FailureReason = ""
	msg.UpdatedAt = time.Now()

	if err := ws.db.Save(msg).Error; err != nil {
		log.Printf("Failed to update message for retry: %v", err)
		return
	}

	var err error
	switch msg.MessageType {
	case "text":
		_, err = ws.SendTextMessage(msg.RecipientPhone, msg.Content, msg.CreatedBy)
	case "template":
		// Extract parameters from stored template params
		var params []string
		if msg.TemplateParams != nil {
			for _, param := range msg.TemplateParams {
				if paramStr, ok := param.(string); ok {
					params = append(params, paramStr)
				}
			}
		}
		_, err = ws.SendTemplateMessage(msg.RecipientPhone, msg.TemplateID, params, msg.CreatedBy)
	default:
		if msg.MediaURL != "" {
			_, err = ws.SendMediaMessage(msg.RecipientPhone, msg.MessageType, msg.MediaURL, msg.Content, msg.CreatedBy)
		}
	}

	if err != nil {
		msg.Status = "failed"
		msg.FailureReason = fmt.Sprintf("Retry %d failed: %v", msg.RetryCount, err)
		ws.db.Save(msg)
		log.Printf("Message retry failed: %s", msg.ID)
	} else {
		log.Printf("Message retry successful: %s", msg.ID)
	}
}

func (ws *WhatsAppService) startQueueProcessor() {
	// Process incoming messages queue
	go func() {
		for {
			result, err := ws.redis.BRPop(context.Background(), 0, "incoming_messages").Result()
			if err != nil {
				log.Printf("Failed to pop from incoming_messages queue: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}

			if len(result) > 1 {
				var incomingMsg IncomingMessage
				if err := json.Unmarshal([]byte(result[1]), &incomingMsg); err != nil {
					log.Printf("Failed to unmarshal incoming message: %v", err)
					continue
				}

				// Process the incoming message (implement your business logic here)
				ws.processIncomingMessageBusinessLogic(&incomingMsg)
			}
		}
	}()

	// Process status updates queue
	go func() {
		for {
			result, err := ws.redis.BRPop(context.Background(), 0, "message_status_updates").Result()
			if err != nil {
				log.Printf("Failed to pop from message_status_updates queue: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}

			if len(result) > 1 {
				var statusUpdate map[string]interface{}
				if err := json.Unmarshal([]byte(result[1]), &statusUpdate); err != nil {
					log.Printf("Failed to unmarshal status update: %v", err)
					continue
				}

				// Process the status update (implement your business logic here)
				ws.processStatusUpdateBusinessLogic(statusUpdate)
			}
		}
	}()
}

func (ws *WhatsAppService) processIncomingMessageBusinessLogic(msg *IncomingMessage) {
	// Mark as processed
	msg.Processed = true
	now := time.Now()
	msg.ProcessedAt = &now
	ws.db.Save(msg)

	// Implement your business logic here
	// For example: auto-reply, route to customer service, etc.
	log.Printf("Processing incoming message from %s: %s", msg.SenderPhone, msg.Content)
}

func (ws *WhatsAppService) processStatusUpdateBusinessLogic(statusUpdate map[string]interface{}) {
	// Implement your business logic here
	// For example: update external systems, trigger notifications, etc.
	log.Printf("Processing status update: %+v", statusUpdate)
}

// SetupRoutes configures the HTTP routes for the WhatsApp service
func (ws *WhatsAppService) SetupRoutes() *gin.Engine {
	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "healthy",
			"service":   "whatsapp",
			"timestamp": time.Now().Unix(),
		})
	})

	// Metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := r.Group("/api/v1/whatsapp")
	{
		api.POST("/send/text", ws.handleSendText)
		api.POST("/send/template", ws.handleSendTemplate)
		api.POST("/send/media", ws.handleSendMedia)
		api.GET("/messages/:id", ws.handleGetMessage)
		api.GET("/messages", ws.handleListMessages)
		api.GET("/templates", ws.handleListTemplates)
		api.POST("/templates", ws.handleCreateTemplate)
		api.GET("/incoming", ws.handleListIncomingMessages)
		api.GET("/stats", ws.handleGetStats)
	}

	// Webhook routes
	webhook := r.Group("/webhooks")
	{
		webhook.GET("/whatsapp", ws.handleWebhookVerification)
		webhook.POST("/whatsapp", ws.handleWebhookEvent)
	}

	return r
}

// HTTP handlers
func (ws *WhatsAppService) handleSendText(c *gin.Context) {
	var req struct {
		RecipientPhone string `json:"recipient_phone" binding:"required"`
		Message        string `json:"message" binding:"required"`
		CreatedBy      string `json:"created_by"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	msg, err := ws.SendTextMessage(req.RecipientPhone, req.Message, req.CreatedBy)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, msg)
}

func (ws *WhatsAppService) handleSendTemplate(c *gin.Context) {
	var req struct {
		RecipientPhone string   `json:"recipient_phone" binding:"required"`
		TemplateName   string   `json:"template_name" binding:"required"`
		Parameters     []string `json:"parameters"`
		CreatedBy      string   `json:"created_by"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	msg, err := ws.SendTemplateMessage(req.RecipientPhone, req.TemplateName, req.Parameters, req.CreatedBy)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, msg)
}

func (ws *WhatsAppService) handleSendMedia(c *gin.Context) {
	var req struct {
		RecipientPhone string `json:"recipient_phone" binding:"required"`
		MediaType      string `json:"media_type" binding:"required"`
		MediaURL       string `json:"media_url" binding:"required"`
		Caption        string `json:"caption"`
		CreatedBy      string `json:"created_by"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	msg, err := ws.SendMediaMessage(req.RecipientPhone, req.MediaType, req.MediaURL, req.Caption, req.CreatedBy)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, msg)
}

func (ws *WhatsAppService) handleGetMessage(c *gin.Context) {
	messageID := c.Param("id")

	var msg WhatsAppMessage
	if err := ws.db.Where("id = ?", messageID).First(&msg).Error; err != nil {
		c.JSON(404, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(200, msg)
}

func (ws *WhatsAppService) handleListMessages(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	status := c.Query("status")
	recipientPhone := c.Query("recipient_phone")

	offset := (page - 1) * limit

	query := ws.db.Model(&WhatsAppMessage{})

	if status != "" {
		query = query.Where("status = ?", status)
	}
	if recipientPhone != "" {
		query = query.Where("recipient_phone = ?", recipientPhone)
	}

	var messages []WhatsAppMessage
	var total int64

	query.Count(&total)
	query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&messages)

	c.JSON(200, gin.H{
		"messages": messages,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

func (ws *WhatsAppService) handleListTemplates(c *gin.Context) {
	var templates []WhatsAppTemplate
	ws.db.Order("created_at DESC").Find(&templates)

	c.JSON(200, gin.H{"templates": templates})
}

func (ws *WhatsAppService) handleCreateTemplate(c *gin.Context) {
	var template WhatsAppTemplate
	if err := c.ShouldBindJSON(&template); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	template.ID = generateMessageID()
	template.CreatedAt = time.Now()

	if err := ws.db.Create(&template).Error; err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(201, template)
}

func (ws *WhatsAppService) handleListIncomingMessages(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	senderPhone := c.Query("sender_phone")

	offset := (page - 1) * limit

	query := ws.db.Model(&IncomingMessage{})

	if senderPhone != "" {
		query = query.Where("sender_phone = ?", senderPhone)
	}

	var messages []IncomingMessage
	var total int64

	query.Count(&total)
	query.Order("received_at DESC").Limit(limit).Offset(offset).Find(&messages)

	c.JSON(200, gin.H{
		"messages": messages,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

func (ws *WhatsAppService) handleGetStats(c *gin.Context) {
	now := time.Now()
	oneDayAgo := now.Add(-24 * time.Hour)

	var stats struct {
		TotalSent      int64   `json:"total_sent"`
		TotalDelivered int64   `json:"total_delivered"`
		TotalRead      int64   `json:"total_read"`
		TotalFailed    int64   `json:"total_failed"`
		DeliveryRate   float64 `json:"delivery_rate"`
		ReadRate       float64 `json:"read_rate"`
	}

	// Count messages from last 24 hours
	ws.db.Model(&WhatsAppMessage{}).
		Where("created_at >= ?", oneDayAgo).
		Where("status IN ?", []string{"sent", "delivered", "read", "failed"}).
		Count(&stats.TotalSent)

	ws.db.Model(&WhatsAppMessage{}).
		Where("created_at >= ?", oneDayAgo).
		Where("status IN ?", []string{"delivered", "read"}).
		Count(&stats.TotalDelivered)

	ws.db.Model(&WhatsAppMessage{}).
		Where("created_at >= ?", oneDayAgo).
		Where("status = ?", "read").
		Count(&stats.TotalRead)

	ws.db.Model(&WhatsAppMessage{}).
		Where("created_at >= ?", oneDayAgo).
		Where("status = ?", "failed").
		Count(&stats.TotalFailed)

	// Calculate rates
	if stats.TotalSent > 0 {
		stats.DeliveryRate = float64(stats.TotalDelivered) / float64(stats.TotalSent) * 100
		stats.ReadRate = float64(stats.TotalRead) / float64(stats.TotalSent) * 100
	}

	c.JSON(200, stats)
}

// Main function
func main() {
	// Load environment variables
	if os.Getenv("WHATSAPP_ACCESS_TOKEN") == "" {
		log.Fatal("WHATSAPP_ACCESS_TOKEN environment variable is required")
	}
	if os.Getenv("WHATSAPP_PHONE_NUMBER_ID") == "" {
		log.Fatal("WHATSAPP_PHONE_NUMBER_ID environment variable is required")
	}
	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	// Create WhatsApp service
	service, err := NewWhatsAppService()
	if err != nil {
		log.Fatalf("Failed to create WhatsApp service: %v", err)
	}

	// Setup routes
	router := service.SetupRoutes()

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("WhatsApp service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}

