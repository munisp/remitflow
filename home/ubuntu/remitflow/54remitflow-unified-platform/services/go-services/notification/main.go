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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Notification represents a notification in the system
type Notification struct {
	ID              uuid.UUID        `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	NotificationRef string           `json:"notification_ref" gorm:"uniqueIndex;not null"`
	RecipientType   RecipientType    `json:"recipient_type" gorm:"not null"`
	RecipientID     uuid.UUID        `json:"recipient_id" gorm:"not null;index"`
	Channel         NotificationChannel `json:"channel" gorm:"not null"`
	Type            NotificationType `json:"type" gorm:"not null"`
	Priority        Priority         `json:"priority" gorm:"default:'medium'"`
	Subject         string           `json:"subject" gorm:"not null"`
	Message         string           `json:"message" gorm:"not null"`
	Data            JSON             `json:"data" gorm:"type:jsonb"`
	Status          NotificationStatus `json:"status" gorm:"default:'pending'"`
	ScheduledAt     *time.Time       `json:"scheduled_at"`
	SentAt          *time.Time       `json:"sent_at"`
	DeliveredAt     *time.Time       `json:"delivered_at"`
	ReadAt          *time.Time       `json:"read_at"`
	FailureReason   string           `json:"failure_reason"`
	RetryCount      int              `json:"retry_count" gorm:"default:0"`
	MaxRetries      int              `json:"max_retries" gorm:"default:3"`
	ExpiresAt       *time.Time       `json:"expires_at"`
	CreatedBy       uuid.UUID        `json:"created_by" gorm:"not null"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

// RecipientType represents the type of notification recipient
type RecipientType string

const (
	RecipientTypeCustomer RecipientType = "customer"
	RecipientTypeAgent    RecipientType = "agent"
	RecipientTypeAdmin    RecipientType = "admin"
	RecipientTypeSystem   RecipientType = "system"
)

// NotificationChannel represents the delivery channel
type NotificationChannel string

const (
	ChannelEmail    NotificationChannel = "email"
	ChannelSMS      NotificationChannel = "sms"
	ChannelPush     NotificationChannel = "push"
	ChannelInApp    NotificationChannel = "in_app"
	ChannelWebhook  NotificationChannel = "webhook"
	ChannelWhatsApp NotificationChannel = "whatsapp"
)

// NotificationType represents the type of notification
type NotificationType string

const (
	TypeTransactionAlert    NotificationType = "transaction_alert"
	TypeAccountUpdate       NotificationType = "account_update"
	TypeSecurityAlert       NotificationType = "security_alert"
	TypeKYCUpdate          NotificationType = "kyc_update"
	TypeCommissionAlert     NotificationType = "commission_alert"
	TypeCashAlert          NotificationType = "cash_alert"
	TypeFraudAlert         NotificationType = "fraud_alert"
	TypeSystemMaintenance  NotificationType = "system_maintenance"
	TypePromotional        NotificationType = "promotional"
	TypeReminder           NotificationType = "reminder"
	TypeWelcome            NotificationType = "welcome"
	TypePasswordReset      NotificationType = "password_reset"
	TypeOTP                NotificationType = "otp"
)

// Priority represents the notification priority
type Priority string

const (
	PriorityLow      Priority = "low"
	PriorityMedium   Priority = "medium"
	PriorityHigh     Priority = "high"
	PriorityCritical Priority = "critical"
)

// NotificationStatus represents the status of a notification
type NotificationStatus string

const (
	StatusPending   NotificationStatus = "pending"
	StatusScheduled NotificationStatus = "scheduled"
	StatusSending   NotificationStatus = "sending"
	StatusSent      NotificationStatus = "sent"
	StatusDelivered NotificationStatus = "delivered"
	StatusRead      NotificationStatus = "read"
	StatusFailed    NotificationStatus = "failed"
	StatusExpired   NotificationStatus = "expired"
	StatusCancelled NotificationStatus = "cancelled"
)

// NotificationTemplate represents a notification template
type NotificationTemplate struct {
	ID          uuid.UUID           `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name        string              `json:"name" gorm:"uniqueIndex;not null"`
	Type        NotificationType    `json:"type" gorm:"not null"`
	Channel     NotificationChannel `json:"channel" gorm:"not null"`
	Language    string              `json:"language" gorm:"default:'en'"`
	Subject     string              `json:"subject" gorm:"not null"`
	Body        string              `json:"body" gorm:"not null"`
	Variables   []string            `json:"variables" gorm:"type:text[]"`
	IsActive    bool                `json:"is_active" gorm:"default:true"`
	CreatedBy   uuid.UUID           `json:"created_by" gorm:"not null"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
}

// NotificationPreference represents user notification preferences
type NotificationPreference struct {
	ID            uuid.UUID           `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID        uuid.UUID           `json:"user_id" gorm:"not null;index"`
	UserType      RecipientType       `json:"user_type" gorm:"not null"`
	Type          NotificationType    `json:"type" gorm:"not null"`
	Channel       NotificationChannel `json:"channel" gorm:"not null"`
	IsEnabled     bool                `json:"is_enabled" gorm:"default:true"`
	QuietHours    JSON                `json:"quiet_hours" gorm:"type:jsonb"`
	Frequency     string              `json:"frequency" gorm:"default:'immediate'"`
	CreatedAt     time.Time           `json:"created_at"`
	UpdatedAt     time.Time           `json:"updated_at"`
}

// NotificationDelivery represents delivery attempt details
type NotificationDelivery struct {
	ID             uuid.UUID           `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	NotificationID uuid.UUID           `json:"notification_id" gorm:"not null;index"`
	Channel        NotificationChannel `json:"channel" gorm:"not null"`
	Recipient      string              `json:"recipient" gorm:"not null"`
	Status         DeliveryStatus      `json:"status" gorm:"not null"`
	AttemptedAt    time.Time           `json:"attempted_at" gorm:"not null"`
	DeliveredAt    *time.Time          `json:"delivered_at"`
	FailureReason  string              `json:"failure_reason"`
	ProviderRef    string              `json:"provider_ref"`
	Cost           float64             `json:"cost" gorm:"default:0"`
	CreatedAt      time.Time           `json:"created_at"`
}

// DeliveryStatus represents the status of a delivery attempt
type DeliveryStatus string

const (
	DeliveryStatusPending   DeliveryStatus = "pending"
	DeliveryStatusSent      DeliveryStatus = "sent"
	DeliveryStatusDelivered DeliveryStatus = "delivered"
	DeliveryStatusFailed    DeliveryStatus = "failed"
	DeliveryStatusBounced   DeliveryStatus = "bounced"
)

// JSON type for JSONB fields
type JSON map[string]interface{}

// Request/Response types
type CreateNotificationRequest struct {
	RecipientType RecipientType       `json:"recipient_type" binding:"required"`
	RecipientID   uuid.UUID           `json:"recipient_id" binding:"required"`
	Channel       NotificationChannel `json:"channel" binding:"required"`
	Type          NotificationType    `json:"type" binding:"required"`
	Priority      Priority            `json:"priority"`
	Subject       string              `json:"subject" binding:"required"`
	Message       string              `json:"message" binding:"required"`
	Data          JSON                `json:"data"`
	ScheduledAt   *time.Time          `json:"scheduled_at"`
	ExpiresAt     *time.Time          `json:"expires_at"`
}

type BulkNotificationRequest struct {
	RecipientType RecipientType       `json:"recipient_type" binding:"required"`
	RecipientIDs  []uuid.UUID         `json:"recipient_ids" binding:"required"`
	Channel       NotificationChannel `json:"channel" binding:"required"`
	Type          NotificationType    `json:"type" binding:"required"`
	Priority      Priority            `json:"priority"`
	Subject       string              `json:"subject" binding:"required"`
	Message       string              `json:"message" binding:"required"`
	Data          JSON                `json:"data"`
	ScheduledAt   *time.Time          `json:"scheduled_at"`
	ExpiresAt     *time.Time          `json:"expires_at"`
}

type TemplateNotificationRequest struct {
	RecipientType RecipientType `json:"recipient_type" binding:"required"`
	RecipientID   uuid.UUID     `json:"recipient_id" binding:"required"`
	TemplateName  string        `json:"template_name" binding:"required"`
	Variables     JSON          `json:"variables"`
	Priority      Priority      `json:"priority"`
	ScheduledAt   *time.Time    `json:"scheduled_at"`
	ExpiresAt     *time.Time    `json:"expires_at"`
}

type CreateTemplateRequest struct {
	Name      string              `json:"name" binding:"required"`
	Type      NotificationType    `json:"type" binding:"required"`
	Channel   NotificationChannel `json:"channel" binding:"required"`
	Language  string              `json:"language"`
	Subject   string              `json:"subject" binding:"required"`
	Body      string              `json:"body" binding:"required"`
	Variables []string            `json:"variables"`
	IsActive  bool                `json:"is_active"`
}

type UpdatePreferenceRequest struct {
	UserID    uuid.UUID           `json:"user_id" binding:"required"`
	UserType  RecipientType       `json:"user_type" binding:"required"`
	Type      NotificationType    `json:"type" binding:"required"`
	Channel   NotificationChannel `json:"channel" binding:"required"`
	IsEnabled bool                `json:"is_enabled"`
	Frequency string              `json:"frequency"`
}

// NotificationService handles notification operations
type NotificationService struct {
	db *gorm.DB
}

// NewNotificationService creates a new notification service
func NewNotificationService(db *gorm.DB) *NotificationService {
	return &NotificationService{db: db}
}

// CreateNotification creates a new notification
func (s *NotificationService) CreateNotification(req CreateNotificationRequest, createdBy uuid.UUID) (*Notification, error) {
	// Check user preferences
	if !s.isNotificationAllowed(req.RecipientID, req.RecipientType, req.Type, req.Channel) {
		return nil, fmt.Errorf("notification not allowed by user preferences")
	}

	// Generate notification reference
	notificationRef := generateNotificationRef()

	// Set default priority
	if req.Priority == "" {
		req.Priority = PriorityMedium
	}

	notification := &Notification{
		NotificationRef: notificationRef,
		RecipientType:   req.RecipientType,
		RecipientID:     req.RecipientID,
		Channel:         req.Channel,
		Type:            req.Type,
		Priority:        req.Priority,
		Subject:         req.Subject,
		Message:         req.Message,
		Data:            req.Data,
		Status:          StatusPending,
		ScheduledAt:     req.ScheduledAt,
		ExpiresAt:       req.ExpiresAt,
		CreatedBy:       createdBy,
	}

	// If scheduled, set status to scheduled
	if req.ScheduledAt != nil && req.ScheduledAt.After(time.Now()) {
		notification.Status = StatusScheduled
	}

	if err := s.db.Create(notification).Error; err != nil {
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}

	// Send immediately if not scheduled
	if notification.Status == StatusPending {
		go s.processNotification(notification.ID)
	}

	return notification, nil
}

// CreateBulkNotification creates notifications for multiple recipients
func (s *NotificationService) CreateBulkNotification(req BulkNotificationRequest, createdBy uuid.UUID) ([]Notification, error) {
	var notifications []Notification

	for _, recipientID := range req.RecipientIDs {
		// Check user preferences
		if !s.isNotificationAllowed(recipientID, req.RecipientType, req.Type, req.Channel) {
			continue
		}

		notificationRef := generateNotificationRef()

		notification := Notification{
			NotificationRef: notificationRef,
			RecipientType:   req.RecipientType,
			RecipientID:     recipientID,
			Channel:         req.Channel,
			Type:            req.Type,
			Priority:        req.Priority,
			Subject:         req.Subject,
			Message:         req.Message,
			Data:            req.Data,
			Status:          StatusPending,
			ScheduledAt:     req.ScheduledAt,
			ExpiresAt:       req.ExpiresAt,
			CreatedBy:       createdBy,
		}

		if req.ScheduledAt != nil && req.ScheduledAt.After(time.Now()) {
			notification.Status = StatusScheduled
		}

		notifications = append(notifications, notification)
	}

	if len(notifications) == 0 {
		return nil, fmt.Errorf("no valid recipients found")
	}

	if err := s.db.Create(&notifications).Error; err != nil {
		return nil, fmt.Errorf("failed to create bulk notifications: %w", err)
	}

	// Process pending notifications
	for _, notification := range notifications {
		if notification.Status == StatusPending {
			go s.processNotification(notification.ID)
		}
	}

	return notifications, nil
}

// CreateFromTemplate creates a notification from a template
func (s *NotificationService) CreateFromTemplate(req TemplateNotificationRequest, createdBy uuid.UUID) (*Notification, error) {
	// Get template
	var template NotificationTemplate
	if err := s.db.Where("name = ? AND is_active = true", req.TemplateName).First(&template).Error; err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	// Replace variables in subject and body
	subject := s.replaceVariables(template.Subject, req.Variables)
	message := s.replaceVariables(template.Body, req.Variables)

	// Create notification request
	notificationReq := CreateNotificationRequest{
		RecipientType: req.RecipientType,
		RecipientID:   req.RecipientID,
		Channel:       template.Channel,
		Type:          template.Type,
		Priority:      req.Priority,
		Subject:       subject,
		Message:       message,
		Data:          req.Variables,
		ScheduledAt:   req.ScheduledAt,
		ExpiresAt:     req.ExpiresAt,
	}

	return s.CreateNotification(notificationReq, createdBy)
}

// GetNotification retrieves a notification by ID
func (s *NotificationService) GetNotification(id uuid.UUID) (*Notification, error) {
	var notification Notification
	if err := s.db.First(&notification, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get notification: %w", err)
	}
	return &notification, nil
}

// ListNotifications retrieves notifications with pagination and filters
func (s *NotificationService) ListNotifications(page, limit int, recipientID *uuid.UUID, recipientType RecipientType, channel NotificationChannel, status NotificationStatus) ([]Notification, int64, error) {
	var notifications []Notification
	var total int64

	query := s.db.Model(&Notification{})

	// Apply filters
	if recipientID != nil {
		query = query.Where("recipient_id = ?", *recipientID)
	}
	if recipientType != "" {
		query = query.Where("recipient_type = ?", recipientType)
	}
	if channel != "" {
		query = query.Where("channel = ?", channel)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count notifications: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&notifications).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list notifications: %w", err)
	}

	return notifications, total, nil
}

// MarkAsRead marks a notification as read
func (s *NotificationService) MarkAsRead(id uuid.UUID) error {
	now := time.Now()
	if err := s.db.Model(&Notification{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":  StatusRead,
		"read_at": now,
	}).Error; err != nil {
		return fmt.Errorf("failed to mark notification as read: %w", err)
	}
	return nil
}

// CancelNotification cancels a pending or scheduled notification
func (s *NotificationService) CancelNotification(id uuid.UUID) error {
	if err := s.db.Model(&Notification{}).Where("id = ? AND status IN ?", id, []NotificationStatus{StatusPending, StatusScheduled}).Update("status", StatusCancelled).Error; err != nil {
		return fmt.Errorf("failed to cancel notification: %w", err)
	}
	return nil
}

// CreateTemplate creates a new notification template
func (s *NotificationService) CreateTemplate(req CreateTemplateRequest, createdBy uuid.UUID) (*NotificationTemplate, error) {
	template := &NotificationTemplate{
		Name:      req.Name,
		Type:      req.Type,
		Channel:   req.Channel,
		Language:  req.Language,
		Subject:   req.Subject,
		Body:      req.Body,
		Variables: req.Variables,
		IsActive:  req.IsActive,
		CreatedBy: createdBy,
	}

	if template.Language == "" {
		template.Language = "en"
	}

	if err := s.db.Create(template).Error; err != nil {
		return nil, fmt.Errorf("failed to create template: %w", err)
	}

	return template, nil
}

// UpdatePreference updates notification preferences
func (s *NotificationService) UpdatePreference(req UpdatePreferenceRequest) error {
	preference := NotificationPreference{
		UserID:    req.UserID,
		UserType:  req.UserType,
		Type:      req.Type,
		Channel:   req.Channel,
		IsEnabled: req.IsEnabled,
		Frequency: req.Frequency,
	}

	// Upsert preference
	if err := s.db.Where("user_id = ? AND user_type = ? AND type = ? AND channel = ?", 
		req.UserID, req.UserType, req.Type, req.Channel).
		Assign(preference).FirstOrCreate(&preference).Error; err != nil {
		return fmt.Errorf("failed to update preference: %w", err)
	}

	return nil
}

// GetUserPreferences retrieves notification preferences for a user
func (s *NotificationService) GetUserPreferences(userID uuid.UUID, userType RecipientType) ([]NotificationPreference, error) {
	var preferences []NotificationPreference
	if err := s.db.Where("user_id = ? AND user_type = ?", userID, userType).Find(&preferences).Error; err != nil {
		return nil, fmt.Errorf("failed to get user preferences: %w", err)
	}
	return preferences, nil
}

// ProcessScheduledNotifications processes scheduled notifications
func (s *NotificationService) ProcessScheduledNotifications() error {
	var notifications []Notification
	now := time.Now()

	if err := s.db.Where("status = ? AND scheduled_at <= ?", StatusScheduled, now).Find(&notifications).Error; err != nil {
		return fmt.Errorf("failed to get scheduled notifications: %w", err)
	}

	for _, notification := range notifications {
		go s.processNotification(notification.ID)
	}

	return nil
}

// processNotification processes a single notification
func (s *NotificationService) processNotification(notificationID uuid.UUID) {
	var notification Notification
	if err := s.db.First(&notification, "id = ?", notificationID).Error; err != nil {
		log.Printf("Failed to get notification %s: %v", notificationID, err)
		return
	}

	// Check if notification has expired
	if notification.ExpiresAt != nil && notification.ExpiresAt.Before(time.Now()) {
		s.db.Model(&notification).Update("status", StatusExpired)
		return
	}

	// Update status to sending
	s.db.Model(&notification).Update("status", StatusSending)

	// Get recipient contact information
	recipient, err := s.getRecipientContact(notification.RecipientID, notification.RecipientType, notification.Channel)
	if err != nil {
		s.handleDeliveryFailure(notification.ID, fmt.Sprintf("Failed to get recipient contact: %v", err))
		return
	}

	// Create delivery record
	delivery := NotificationDelivery{
		NotificationID: notification.ID,
		Channel:        notification.Channel,
		Recipient:      recipient,
		Status:         DeliveryStatusPending,
		AttemptedAt:    time.Now(),
	}
	s.db.Create(&delivery)

	// Send notification based on channel
	var deliveryErr error
	switch notification.Channel {
	case ChannelEmail:
		deliveryErr = s.sendEmail(notification, recipient)
	case ChannelSMS:
		deliveryErr = s.sendSMS(notification, recipient)
	case ChannelPush:
		deliveryErr = s.sendPush(notification, recipient)
	case ChannelInApp:
		deliveryErr = s.sendInApp(notification, recipient)
	case ChannelWebhook:
		deliveryErr = s.sendWebhook(notification, recipient)
	case ChannelWhatsApp:
		deliveryErr = s.sendWhatsApp(notification, recipient)
	default:
		deliveryErr = fmt.Errorf("unsupported channel: %s", notification.Channel)
	}

	if deliveryErr != nil {
		s.handleDeliveryFailure(notification.ID, deliveryErr.Error())
		s.db.Model(&delivery).Updates(map[string]interface{}{
			"status":         DeliveryStatusFailed,
			"failure_reason": deliveryErr.Error(),
		})
	} else {
		// Mark as sent
		now := time.Now()
		s.db.Model(&notification).Updates(map[string]interface{}{
			"status":  StatusSent,
			"sent_at": now,
		})
		s.db.Model(&delivery).Updates(map[string]interface{}{
			"status":       DeliveryStatusSent,
			"delivered_at": now,
		})
	}
}

// isNotificationAllowed checks if notification is allowed by user preferences
func (s *NotificationService) isNotificationAllowed(userID uuid.UUID, userType RecipientType, notificationType NotificationType, channel NotificationChannel) bool {
	var preference NotificationPreference
	err := s.db.Where("user_id = ? AND user_type = ? AND type = ? AND channel = ?", 
		userID, userType, notificationType, channel).First(&preference).Error
	
	if err != nil {
		// If no preference found, allow by default
		return true
	}

	return preference.IsEnabled
}

// replaceVariables replaces template variables with actual values
func (s *NotificationService) replaceVariables(template string, variables JSON) string {
	result := template
	for key, value := range variables {
		placeholder := fmt.Sprintf("{{%s}}", key)
		result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", value))
	}
	return result
}

// getRecipientContact gets contact information for recipient
func (s *NotificationService) getRecipientContact(recipientID uuid.UUID, recipientType RecipientType, channel NotificationChannel) (string, error) {
	// This is a simplified implementation
	// In a real system, this would query the appropriate service to get contact information
	
	switch channel {
	case ChannelEmail:
		return fmt.Sprintf("user%s@example.com", recipientID.String()[:8]), nil
	case ChannelSMS, ChannelWhatsApp:
		return fmt.Sprintf("+1234567890"), nil
	case ChannelPush:
		return fmt.Sprintf("device_token_%s", recipientID.String()[:8]), nil
	case ChannelInApp:
		return recipientID.String(), nil
	case ChannelWebhook:
		return "https://webhook.example.com/notify", nil
	default:
		return "", fmt.Errorf("unsupported channel: %s", channel)
	}
}

// Delivery methods (simplified implementations)
func (s *NotificationService) sendEmail(notification Notification, recipient string) error {
	// Simulate email sending
	log.Printf("Sending email to %s: %s", recipient, notification.Subject)
	time.Sleep(100 * time.Millisecond) // Simulate network delay
	return nil
}

func (s *NotificationService) sendSMS(notification Notification, recipient string) error {
	// Simulate SMS sending
	log.Printf("Sending SMS to %s: %s", recipient, notification.Message)
	time.Sleep(100 * time.Millisecond)
	return nil
}

func (s *NotificationService) sendPush(notification Notification, recipient string) error {
	// Simulate push notification sending
	log.Printf("Sending push to %s: %s", recipient, notification.Subject)
	time.Sleep(50 * time.Millisecond)
	return nil
}

func (s *NotificationService) sendInApp(notification Notification, recipient string) error {
	// In-app notifications are stored in database and retrieved by client
	log.Printf("In-app notification created for %s: %s", recipient, notification.Subject)
	return nil
}

func (s *NotificationService) sendWebhook(notification Notification, recipient string) error {
	// Simulate webhook sending
	log.Printf("Sending webhook to %s: %s", recipient, notification.Subject)
	time.Sleep(200 * time.Millisecond)
	return nil
}

func (s *NotificationService) sendWhatsApp(notification Notification, recipient string) error {
	// Simulate WhatsApp sending
	log.Printf("Sending WhatsApp to %s: %s", recipient, notification.Message)
	time.Sleep(150 * time.Millisecond)
	return nil
}

// handleDeliveryFailure handles notification delivery failures
func (s *NotificationService) handleDeliveryFailure(notificationID uuid.UUID, reason string) {
	var notification Notification
	if err := s.db.First(&notification, "id = ?", notificationID).Error; err != nil {
		return
	}

	notification.RetryCount++
	notification.FailureReason = reason

	if notification.RetryCount >= notification.MaxRetries {
		notification.Status = StatusFailed
	} else {
		notification.Status = StatusPending
		// Schedule retry (simplified - in production, use a job queue)
		go func() {
			time.Sleep(time.Duration(notification.RetryCount) * time.Minute)
			s.processNotification(notificationID)
		}()
	}

	s.db.Save(&notification)
}

// Helper functions
func generateNotificationRef() string {
	return fmt.Sprintf("NOTIF%d%s", time.Now().Unix(), uuid.New().String()[:8])
}

// Metrics
var (
	notificationCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_created_total",
			Help: "Total number of notifications created",
		},
		[]string{"type", "channel", "priority"},
	)

	notificationSentTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_sent_total",
			Help: "Total number of notifications sent",
		},
		[]string{"type", "channel", "status"},
	)

	notificationDeliveryDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "notification_delivery_duration_seconds",
			Help: "Duration of notification delivery",
		},
		[]string{"channel"},
	)

	notificationRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "notification_request_duration_seconds",
			Help: "Duration of notification requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(notificationCreatedTotal)
	prometheus.MustRegister(notificationSentTotal)
	prometheus.MustRegister(notificationDeliveryDuration)
	prometheus.MustRegister(notificationRequestDuration)
}

// HTTP Handlers
type NotificationHandler struct {
	service *NotificationService
}

func NewNotificationHandler(service *NotificationService) *NotificationHandler {
	return &NotificationHandler{service: service}
}

func (h *NotificationHandler) CreateNotification(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("POST", "/notifications"))
	defer timer.ObserveDuration()

	var req CreateNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	notification, err := h.service.CreateNotification(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	notificationCreatedTotal.WithLabelValues(string(notification.Type), string(notification.Channel), string(notification.Priority)).Inc()

	c.JSON(http.StatusCreated, notification)
}

func (h *NotificationHandler) CreateBulkNotification(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("POST", "/notifications/bulk"))
	defer timer.ObserveDuration()

	var req BulkNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	notifications, err := h.service.CreateBulkNotification(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for _, notification := range notifications {
		notificationCreatedTotal.WithLabelValues(string(notification.Type), string(notification.Channel), string(notification.Priority)).Inc()
	}

	c.JSON(http.StatusCreated, gin.H{
		"notifications": notifications,
		"count":         len(notifications),
	})
}

func (h *NotificationHandler) CreateFromTemplate(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("POST", "/notifications/template"))
	defer timer.ObserveDuration()

	var req TemplateNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	notification, err := h.service.CreateFromTemplate(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	notificationCreatedTotal.WithLabelValues(string(notification.Type), string(notification.Channel), string(notification.Priority)).Inc()

	c.JSON(http.StatusCreated, notification)
}

func (h *NotificationHandler) GetNotification(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("GET", "/notifications/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification ID"})
		return
	}

	notification, err := h.service.GetNotification(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}

	c.JSON(http.StatusOK, notification)
}

func (h *NotificationHandler) ListNotifications(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("GET", "/notifications"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	var recipientID *uuid.UUID
	if recipientIDStr := c.Query("recipient_id"); recipientIDStr != "" {
		if id, err := uuid.Parse(recipientIDStr); err == nil {
			recipientID = &id
		}
	}

	recipientType := RecipientType(c.Query("recipient_type"))
	channel := NotificationChannel(c.Query("channel"))
	status := NotificationStatus(c.Query("status"))

	notifications, total, err := h.service.ListNotifications(page, limit, recipientID, recipientType, channel, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"total":         total,
		"page":          page,
		"limit":         limit,
	})
}

func (h *NotificationHandler) MarkAsRead(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("PUT", "/notifications/:id/read"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification ID"})
		return
	}

	if err := h.service.MarkAsRead(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "notification marked as read"})
}

func (h *NotificationHandler) CancelNotification(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("PUT", "/notifications/:id/cancel"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification ID"})
		return
	}

	if err := h.service.CancelNotification(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "notification cancelled"})
}

func (h *NotificationHandler) CreateTemplate(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("POST", "/templates"))
	defer timer.ObserveDuration()

	var req CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get created_by from JWT token (simplified for demo)
	createdBy := uuid.New()

	template, err := h.service.CreateTemplate(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, template)
}

func (h *NotificationHandler) UpdatePreference(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("PUT", "/preferences"))
	defer timer.ObserveDuration()

	var req UpdatePreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdatePreference(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "preference updated successfully"})
}

func (h *NotificationHandler) GetUserPreferences(c *gin.Context) {
	timer := prometheus.NewTimer(notificationRequestDuration.WithLabelValues("GET", "/users/:id/preferences"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	userType := RecipientType(c.Query("user_type"))
	if userType == "" {
		userType = RecipientTypeCustomer
	}

	preferences, err := h.service.GetUserPreferences(id, userType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"preferences": preferences})
}

func setupRoutes(handler *NotificationHandler) *gin.Engine {
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
		notifications := v1.Group("/notifications")
		{
			notifications.POST("", handler.CreateNotification)
			notifications.POST("/bulk", handler.CreateBulkNotification)
			notifications.POST("/template", handler.CreateFromTemplate)
			notifications.GET("", handler.ListNotifications)
			notifications.GET("/:id", handler.GetNotification)
			notifications.PUT("/:id/read", handler.MarkAsRead)
			notifications.PUT("/:id/cancel", handler.CancelNotification)
		}

		v1.POST("/templates", handler.CreateTemplate)
		v1.PUT("/preferences", handler.UpdatePreference)
		v1.GET("/users/:id/preferences", handler.GetUserPreferences)
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
	if err := db.AutoMigrate(&Notification{}, &NotificationTemplate{}, &NotificationPreference{}, &NotificationDelivery{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewNotificationService(db)
	handler := NewNotificationHandler(service)

	// Start scheduled notification processor
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			service.ProcessScheduledNotifications()
		}
	}()

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

	log.Printf("Notification Service started on port %s", port)

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

