package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// Personalized Notification Handler
type PersonalizedNotificationHandler struct {
	db                      *gorm.DB
	logger                  *logrus.Logger
	personalizedService     *PersonalizedNotificationService
	campaignManager         *ProactiveCampaignManager
	analyticsClient         NotificationAnalyticsClient
	notificationService     *NotificationService
}

func NewPersonalizedNotificationHandler(
	db *gorm.DB,
	logger *logrus.Logger,
	personalizedService *PersonalizedNotificationService,
	campaignManager *ProactiveCampaignManager,
	analyticsClient NotificationAnalyticsClient,
	notificationService *NotificationService,
) *PersonalizedNotificationHandler {
	return &PersonalizedNotificationHandler{
		db:                  db,
		logger:             logger,
		personalizedService: personalizedService,
		campaignManager:    campaignManager,
		analyticsClient:    analyticsClient,
		notificationService: notificationService,
	}
}

// Send personalized notification
func (h *PersonalizedNotificationHandler) SendPersonalizedNotification(c *gin.Context) {
	start := time.Now()
	
	var req NotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Validate request
	if err := h.validateNotificationRequest(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Step 1: Enrich with analytics
	h.logger.WithField("customer_id", req.CustomerID).Info("Enriching notification with analytics")
	
	enhanced, err := h.personalizedService.EnrichWithAnalytics(ctx, &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to enrich notification with analytics")
		// Continue without analytics enrichment
		enhanced = &EnhancedNotificationRequest{
			NotificationRequest:    req,
			PersonalizationApplied: false,
		}
	}
	
	notificationPersonalizationTotal.WithLabelValues(
		enhanced.Context.CustomerSegment,
		enhanced.SegmentStrategy,
		"enriched",
	).Inc()
	
	// Step 2: Apply personalization
	if enhanced.PersonalizationApplied {
		if err := h.personalizedService.PersonalizeNotification(ctx, enhanced); err != nil {
			h.logger.WithError(err).Error("Failed to personalize notification")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Personalization failed"})
			return
		}
		
		notificationPersonalizationTotal.WithLabelValues(
			enhanced.Context.CustomerSegment,
			enhanced.SegmentStrategy,
			"personalized",
		).Inc()
	}
	
	// Step 3: Process the notification
	notification, err := h.processPersonalizedNotification(ctx, enhanced)
	if err != nil {
		h.logger.WithError(err).Error("Failed to process personalized notification")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Notification processing failed"})
		return
	}
	
	// Step 4: Record engagement (sent event)
	go h.recordEngagement(ctx, notification.ID, notification.CustomerID, "sent", enhanced.Channels)
	
	// Prepare response
	response := h.buildPersonalizedResponse(notification, enhanced)
	
	processingTime := time.Since(start)
	
	h.logger.WithFields(logrus.Fields{
		"notification_id":     notification.ID,
		"customer_id":         notification.CustomerID,
		"segment":            enhanced.Context.CustomerSegment,
		"strategy":           enhanced.SegmentStrategy,
		"channels":           enhanced.Channels,
		"processing_time":    processingTime,
		"personalization_applied": enhanced.PersonalizationApplied,
		"expected_engagement": enhanced.ExpectedEngagement,
	}).Info("Personalized notification processed successfully")
	
	c.JSON(http.StatusCreated, response)
}

func (h *PersonalizedNotificationHandler) processPersonalizedNotification(ctx context.Context, enhanced *EnhancedNotificationRequest) (*Notification, error) {
	// Create notification record
	notification := &Notification{
		ID:          uuid.New(),
		CustomerID:  enhanced.CustomerID,
		Type:        enhanced.Type,
		Title:       enhanced.Title,
		Content:     enhanced.Content,
		Channels:    enhanced.Channels,
		Priority:    enhanced.Priority,
		Status:      "pending",
		TemplateID:  enhanced.TemplateID,
		Metadata:    enhanced.Metadata,
		ScheduledAt: enhanced.ScheduledAt,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		
		// Analytics fields
		CustomerSegment:        enhanced.Context.CustomerSegment,
		ChurnRisk:             enhanced.Context.ChurnRisk,
		CLVCategory:           enhanced.Context.CLVCategory,
		PersonalizationApplied: enhanced.PersonalizationApplied,
		SegmentStrategy:       enhanced.SegmentStrategy,
		CampaignType:          enhanced.CampaignType,
		ExpectedEngagement:    enhanced.ExpectedEngagement,
		OptimalTiming:         enhanced.OptimalTiming,
		ChannelPriority:       enhanced.ChannelPriority,
	}
	
	// Save to database
	if err := h.db.Create(notification).Error; err != nil {
		return nil, fmt.Errorf("failed to create notification record: %w", err)
	}
	
	// Handle scheduling vs immediate delivery
	if notification.ScheduledAt != nil && notification.ScheduledAt.After(time.Now()) {
		notification.Status = "scheduled"
		h.logger.WithFields(logrus.Fields{
			"notification_id": notification.ID,
			"scheduled_at":   notification.ScheduledAt,
		}).Info("Notification scheduled for optimal timing")
	} else {
		// Send immediately
		go h.sendNotificationAsync(ctx, notification)
	}
	
	return notification, nil
}

func (h *PersonalizedNotificationHandler) sendNotificationAsync(ctx context.Context, notification *Notification) {
	// Update status to sending
	notification.Status = "sending"
	h.db.Save(notification)
	
	// Send through each channel based on priority
	for i, channel := range notification.Channels {
		channelCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		
		success := h.sendThroughChannel(channelCtx, notification, channel)
		cancel()
		
		if success {
			// Record successful delivery
			go h.recordEngagement(ctx, notification.ID, notification.CustomerID, "delivered", []string{channel})
			
			// For high-priority notifications, send through all channels
			if notification.Priority != "urgent" && notification.Priority != "high" {
				break // Stop after first successful delivery for normal priority
			}
		} else if i == len(notification.Channels)-1 {
			// Failed on all channels
			notification.Status = "failed"
			notification.FailureReason = "All channels failed"
			h.db.Save(notification)
			return
		}
	}
	
	// Update final status
	notification.Status = "sent"
	notification.SentAt = &time.Time{}
	*notification.SentAt = time.Now()
	h.db.Save(notification)
}

func (h *PersonalizedNotificationHandler) sendThroughChannel(ctx context.Context, notification *Notification, channel string) bool {
	h.logger.WithFields(logrus.Fields{
		"notification_id": notification.ID,
		"channel":        channel,
		"customer_id":    notification.CustomerID,
	}).Info("Sending notification through channel")
	
	// This would integrate with actual channel implementations
	// For now, simulate sending
	switch channel {
	case "sms":
		return h.sendSMS(ctx, notification)
	case "email":
		return h.sendEmail(ctx, notification)
	case "push":
		return h.sendPushNotification(ctx, notification)
	case "in_app":
		return h.sendInAppNotification(ctx, notification)
	case "whatsapp":
		return h.sendWhatsApp(ctx, notification)
	default:
		h.logger.WithField("channel", channel).Warn("Unknown notification channel")
		return false
	}
}

// Channel-specific sending methods (simplified implementations)
func (h *PersonalizedNotificationHandler) sendSMS(ctx context.Context, notification *Notification) bool {
	// Integrate with SMS provider (Termii, Twilio, etc.)
	h.logger.WithField("notification_id", notification.ID).Info("Sending SMS notification")
	
	// Simulate SMS sending
	time.Sleep(100 * time.Millisecond)
	
	// Record metrics
	notificationEngagementRate.WithLabelValues(
		notification.CustomerSegment,
		"sms",
		notification.CampaignType,
	).Observe(notification.ExpectedEngagement)
	
	return true // Simulate success
}

func (h *PersonalizedNotificationHandler) sendEmail(ctx context.Context, notification *Notification) bool {
	// Integrate with email provider
	h.logger.WithField("notification_id", notification.ID).Info("Sending email notification")
	
	// Simulate email sending
	time.Sleep(200 * time.Millisecond)
	
	// Record metrics
	notificationEngagementRate.WithLabelValues(
		notification.CustomerSegment,
		"email",
		notification.CampaignType,
	).Observe(notification.ExpectedEngagement)
	
	return true // Simulate success
}

func (h *PersonalizedNotificationHandler) sendPushNotification(ctx context.Context, notification *Notification) bool {
	// Integrate with push notification service (Firebase, etc.)
	h.logger.WithField("notification_id", notification.ID).Info("Sending push notification")
	
	// Simulate push sending
	time.Sleep(50 * time.Millisecond)
	
	// Record metrics
	notificationEngagementRate.WithLabelValues(
		notification.CustomerSegment,
		"push",
		notification.CampaignType,
	).Observe(notification.ExpectedEngagement)
	
	return true // Simulate success
}

func (h *PersonalizedNotificationHandler) sendInAppNotification(ctx context.Context, notification *Notification) bool {
	// Store in-app notification in database for retrieval
	h.logger.WithField("notification_id", notification.ID).Info("Storing in-app notification")
	
	// Record metrics
	notificationEngagementRate.WithLabelValues(
		notification.CustomerSegment,
		"in_app",
		notification.CampaignType,
	).Observe(notification.ExpectedEngagement)
	
	return true // Always succeeds for in-app
}

func (h *PersonalizedNotificationHandler) sendWhatsApp(ctx context.Context, notification *Notification) bool {
	// Integrate with WhatsApp Business API
	h.logger.WithField("notification_id", notification.ID).Info("Sending WhatsApp notification")
	
	// Simulate WhatsApp sending
	time.Sleep(150 * time.Millisecond)
	
	// Record metrics
	notificationEngagementRate.WithLabelValues(
		notification.CustomerSegment,
		"whatsapp",
		notification.CampaignType,
	).Observe(notification.ExpectedEngagement)
	
	return true // Simulate success
}

func (h *PersonalizedNotificationHandler) recordEngagement(ctx context.Context, notificationID, customerID uuid.UUID, action string, channels []string) {
	for _, channel := range channels {
		engagement := &NotificationEngagement{
			NotificationID: notificationID,
			CustomerID:     customerID,
			Channel:        channel,
			Action:         action,
			Timestamp:      time.Now(),
			Metadata: map[string]interface{}{
				"user_agent": "notification-service",
				"source":     "automated",
			},
		}
		
		if err := h.analyticsClient.RecordEngagement(ctx, engagement); err != nil {
			h.logger.WithError(err).WithFields(logrus.Fields{
				"notification_id": notificationID,
				"customer_id":     customerID,
				"action":         action,
				"channel":        channel,
			}).Error("Failed to record engagement")
		}
	}
}

// Get customer notification context
func (h *PersonalizedNotificationHandler) GetCustomerNotificationContext(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	context, err := h.analyticsClient.GetNotificationContext(ctx, customerID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get notification context")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve notification context"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id": customerID,
		"context":     context,
		"timestamp":   time.Now(),
	})
}

// Execute proactive campaigns
func (h *PersonalizedNotificationHandler) ExecuteProactiveCampaigns(c *gin.Context) {
	ctx := c.Request.Context()
	
	h.logger.Info("Manual proactive campaign execution triggered")
	
	err := h.campaignManager.ExecuteProactiveCampaigns(ctx)
	if err != nil {
		h.logger.WithError(err).Error("Failed to execute proactive campaigns")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Campaign execution failed"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"message":   "Proactive campaigns executed successfully",
		"timestamp": time.Now(),
	})
}

// Get campaign recommendations for customer
func (h *PersonalizedNotificationHandler) GetCampaignRecommendations(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	recommendations, err := h.analyticsClient.GetCampaignRecommendations(ctx, customerID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get campaign recommendations")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve campaign recommendations"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id":     customerID,
		"recommendations": recommendations,
		"count":          len(recommendations),
		"timestamp":      time.Now(),
	})
}

// Bulk personalized notifications
func (h *PersonalizedNotificationHandler) SendBulkPersonalizedNotifications(c *gin.Context) {
	var req struct {
		CustomerIDs []string               `json:"customer_ids" binding:"required"`
		Template    NotificationRequest    `json:"template" binding:"required"`
		Options     BulkNotificationOptions `json:"options"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if len(req.CustomerIDs) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 1000 customers allowed per bulk request"})
		return
	}
	
	ctx := c.Request.Context()
	results := make(map[string]interface{})
	successCount := 0
	
	for _, customerIDStr := range req.CustomerIDs {
		customerID, err := uuid.Parse(customerIDStr)
		if err != nil {
			results[customerIDStr] = map[string]interface{}{"error": "Invalid customer ID"}
			continue
		}
		
		// Create personalized request for each customer
		personalizedReq := req.Template
		personalizedReq.ID = uuid.New()
		personalizedReq.CustomerID = customerID
		
		// Process with personalization
		enhanced, err := h.personalizedService.EnrichWithAnalytics(ctx, &personalizedReq)
		if err != nil {
			results[customerIDStr] = map[string]interface{}{"error": err.Error()}
			continue
		}
		
		if enhanced.PersonalizationApplied {
			if err := h.personalizedService.PersonalizeNotification(ctx, enhanced); err != nil {
				results[customerIDStr] = map[string]interface{}{"error": "Personalization failed"}
				continue
			}
		}
		
		// Process notification
		notification, err := h.processPersonalizedNotification(ctx, enhanced)
		if err != nil {
			results[customerIDStr] = map[string]interface{}{"error": "Processing failed"}
			continue
		}
		
		results[customerIDStr] = map[string]interface{}{
			"notification_id":     notification.ID,
			"status":             notification.Status,
			"segment":            enhanced.Context.CustomerSegment,
			"channels":           enhanced.Channels,
			"expected_engagement": enhanced.ExpectedEngagement,
		}
		successCount++
	}
	
	h.logger.WithFields(logrus.Fields{
		"total_requested": len(req.CustomerIDs),
		"successful":     successCount,
		"failed":         len(req.CustomerIDs) - successCount,
	}).Info("Bulk personalized notifications processed")
	
	c.JSON(http.StatusOK, gin.H{
		"results":        results,
		"total_requested": len(req.CustomerIDs),
		"successful":     successCount,
		"failed":         len(req.CustomerIDs) - successCount,
		"timestamp":      time.Now(),
	})
}

type BulkNotificationOptions struct {
	BatchSize      int  `json:"batch_size"`
	DelayBetween   int  `json:"delay_between_ms"`
	SkipPersonalization bool `json:"skip_personalization"`
}

// Get notification analytics
func (h *PersonalizedNotificationHandler) GetNotificationAnalytics(c *gin.Context) {
	notificationIDStr := c.Param("notification_id")
	notificationID, err := uuid.Parse(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}
	
	var notification Notification
	if err := h.db.Where("id = ?", notificationID).First(&notification).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Notification not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	// Get engagement data
	var engagements []NotificationEngagement
	h.db.Where("notification_id = ?", notificationID).Find(&engagements)
	
	analytics := map[string]interface{}{
		"notification_id":         notification.ID,
		"customer_id":            notification.CustomerID,
		"personalization_applied": notification.PersonalizationApplied,
		"customer_segment":       notification.CustomerSegment,
		"segment_strategy":       notification.SegmentStrategy,
		"campaign_type":          notification.CampaignType,
		"expected_engagement":    notification.ExpectedEngagement,
		"channels":              notification.Channels,
		"channel_priority":      notification.ChannelPriority,
		"optimal_timing":        notification.OptimalTiming,
		"status":                notification.Status,
		"engagements":           engagements,
		"engagement_count":      len(engagements),
		"created_at":            notification.CreatedAt,
		"sent_at":               notification.SentAt,
	}
	
	c.JSON(http.StatusOK, gin.H{
		"notification_analytics": analytics,
		"timestamp":             time.Now(),
	})
}

// Personalization dashboard
func (h *PersonalizedNotificationHandler) GetPersonalizationDashboard(c *gin.Context) {
	// Get personalization statistics
	var stats struct {
		TotalNotifications       int64   `json:"total_notifications"`
		PersonalizedNotifications int64   `json:"personalized_notifications"`
		AverageEngagement        float64 `json:"average_engagement"`
		PersonalizationRate      float64 `json:"personalization_rate"`
	}
	
	// Get basic counts
	h.db.Model(&Notification{}).Count(&stats.TotalNotifications)
	h.db.Model(&Notification{}).Where("personalization_applied = true").Count(&stats.PersonalizedNotifications)
	
	// Calculate rates
	if stats.TotalNotifications > 0 {
		stats.PersonalizationRate = float64(stats.PersonalizedNotifications) / float64(stats.TotalNotifications) * 100
	}
	
	// Get average engagement
	h.db.Model(&Notification{}).Where("expected_engagement > 0").Select("AVG(expected_engagement)").Scan(&stats.AverageEngagement)
	
	// Get segment distribution
	var segmentStats []struct {
		Segment string `json:"segment"`
		Count   int64  `json:"count"`
		AvgEngagement float64 `json:"avg_engagement"`
	}
	
	h.db.Model(&Notification{}).
		Select("customer_segment as segment, COUNT(*) as count, AVG(expected_engagement) as avg_engagement").
		Where("customer_segment != ''").
		Group("customer_segment").
		Scan(&segmentStats)
	
	// Get campaign type distribution
	var campaignStats []struct {
		CampaignType string `json:"campaign_type"`
		Count        int64  `json:"count"`
		AvgEngagement float64 `json:"avg_engagement"`
	}
	
	h.db.Model(&Notification{}).
		Select("campaign_type, COUNT(*) as count, AVG(expected_engagement) as avg_engagement").
		Where("campaign_type != ''").
		Group("campaign_type").
		Scan(&campaignStats)
	
	// Get channel performance
	var channelStats []struct {
		Channel       string  `json:"channel"`
		Count         int64   `json:"count"`
		SuccessRate   float64 `json:"success_rate"`
		AvgEngagement float64 `json:"avg_engagement"`
	}
	
	h.db.Raw(`
		SELECT 
			UNNEST(channels) as channel,
			COUNT(*) as count,
			AVG(CASE WHEN status = 'sent' THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
			AVG(expected_engagement) as avg_engagement
		FROM notifications 
		WHERE channels IS NOT NULL 
		GROUP BY channel
	`).Scan(&channelStats)
	
	dashboard := map[string]interface{}{
		"overview":           stats,
		"segment_performance": segmentStats,
		"campaign_performance": campaignStats,
		"channel_performance": channelStats,
		"timestamp":          time.Now(),
	}
	
	c.JSON(http.StatusOK, gin.H{
		"personalization_dashboard": dashboard,
	})
}

// Helper functions
func (h *PersonalizedNotificationHandler) validateNotificationRequest(req *NotificationRequest) error {
	if req.CustomerID == uuid.Nil {
		return fmt.Errorf("customer_id is required")
	}
	
	if req.Type == "" {
		return fmt.Errorf("type is required")
	}
	
	if req.Title == "" && req.Content == "" && req.TemplateID == "" {
		return fmt.Errorf("title, content, or template_id is required")
	}
	
	return nil
}

func (h *PersonalizedNotificationHandler) buildPersonalizedResponse(notification *Notification, enhanced *EnhancedNotificationRequest) map[string]interface{} {
	response := map[string]interface{}{
		"notification_id": notification.ID,
		"status":         notification.Status,
		"channels":       notification.Channels,
		"priority":       notification.Priority,
		"created_at":     notification.CreatedAt,
		"scheduled_at":   notification.ScheduledAt,
	}
	
	// Add personalization information if applied
	if enhanced.PersonalizationApplied {
		response["personalization"] = map[string]interface{}{
			"customer_segment":    enhanced.Context.CustomerSegment,
			"segment_strategy":    enhanced.SegmentStrategy,
			"campaign_type":       enhanced.CampaignType,
			"expected_engagement": enhanced.ExpectedEngagement,
			"optimal_timing":      enhanced.OptimalTiming,
			"channel_priority":    enhanced.ChannelPriority,
			"churn_risk":         enhanced.Context.ChurnRisk,
			"clv_category":       enhanced.Context.CLVCategory,
		}
	}
	
	return response
}

// Enhanced Notification model with analytics fields
type Notification struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID  uuid.UUID  `json:"customer_id" gorm:"type:uuid;not null;index"`
	Type        string     `json:"type" gorm:"not null"`
	Title       string     `json:"title"`
	Content     string     `json:"content"`
	Channels    []string   `json:"channels" gorm:"type:text[]"`
	Priority    string     `json:"priority" gorm:"default:'normal'"`
	Status      string     `json:"status" gorm:"default:'pending'"`
	TemplateID  string     `json:"template_id"`
	Metadata    map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`
	SentAt      *time.Time `json:"sent_at,omitempty"`
	FailureReason string   `json:"failure_reason,omitempty"`
	
	// Analytics fields
	CustomerSegment        string    `json:"customer_segment"`
	ChurnRisk             string    `json:"churn_risk"`
	CLVCategory           string    `json:"clv_category"`
	PersonalizationApplied bool      `json:"personalization_applied" gorm:"default:false"`
	SegmentStrategy       string    `json:"segment_strategy"`
	CampaignType          string    `json:"campaign_type"`
	ExpectedEngagement    float64   `json:"expected_engagement"`
	OptimalTiming         time.Time `json:"optimal_timing"`
	ChannelPriority       []string  `json:"channel_priority" gorm:"type:text[]"`
	
	// Timestamps
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

