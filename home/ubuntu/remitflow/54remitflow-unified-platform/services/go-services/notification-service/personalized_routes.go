package main

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Personalized Notification Routes Configuration
func SetupPersonalizedRoutes(router *gin.Engine, handler *PersonalizedNotificationHandler, logger *logrus.Logger) {
	// Personalized notifications API group
	personalizedGroup := router.Group("/api/v1/personalized")
	personalizedGroup.Use(AuthMiddleware()) // Ensure authentication
	
	// Core personalized notification endpoints
	{
		// Send personalized notification
		personalizedGroup.POST("/notifications", handler.SendPersonalizedNotification)
		
		// Send bulk personalized notifications
		personalizedGroup.POST("/notifications/bulk", handler.SendBulkPersonalizedNotifications)
		
		// Get notification analytics
		personalizedGroup.GET("/notifications/:notification_id/analytics", handler.GetNotificationAnalytics)
		
		// Get customer notification context
		personalizedGroup.GET("/customers/:customer_id/context", handler.GetCustomerNotificationContext)
	}
	
	// Campaign management endpoints
	campaignGroup := personalizedGroup.Group("/campaigns")
	{
		// Execute proactive campaigns
		campaignGroup.POST("/execute", handler.ExecuteProactiveCampaigns)
		
		// Get campaign recommendations for customer
		campaignGroup.GET("/customers/:customer_id/recommendations", handler.GetCampaignRecommendations)
		
		// Create targeted campaign
		campaignGroup.POST("/targeted", handler.CreateTargetedCampaign)
		
		// Get campaign performance
		campaignGroup.GET("/:campaign_id/performance", handler.GetCampaignPerformance)
		
		// List active campaigns
		campaignGroup.GET("/active", handler.GetActiveCampaigns)
		
		// Pause/resume campaign
		campaignGroup.PUT("/:campaign_id/status", handler.UpdateCampaignStatus)
	}
	
	// Segment-based notification endpoints
	segmentGroup := personalizedGroup.Group("/segments")
	{
		// Send notification to segment
		segmentGroup.POST("/:segment/notifications", handler.SendSegmentNotification)
		
		// Get segment analytics
		segmentGroup.GET("/:segment/analytics", handler.GetSegmentAnalytics)
		
		// Get segment preferences
		segmentGroup.GET("/:segment/preferences", handler.GetSegmentPreferences)
		
		// Update segment preferences
		segmentGroup.PUT("/:segment/preferences", handler.UpdateSegmentPreferences)
	}
	
	// Timing optimization endpoints
	timingGroup := personalizedGroup.Group("/timing")
	{
		// Get optimal timing for customer
		timingGroup.GET("/customers/:customer_id/optimal", handler.GetOptimalTiming)
		
		// Get timing analytics
		timingGroup.GET("/analytics", handler.GetTimingAnalytics)
		
		// Update quiet hours for customer
		timingGroup.PUT("/customers/:customer_id/quiet-hours", handler.UpdateQuietHours)
	}
	
	// Engagement tracking endpoints
	engagementGroup := personalizedGroup.Group("/engagement")
	{
		// Record engagement event
		engagementGroup.POST("/events", handler.RecordEngagementEvent)
		
		// Get customer engagement history
		engagementGroup.GET("/customers/:customer_id/history", handler.GetCustomerEngagementHistory)
		
		// Get engagement analytics
		engagementGroup.GET("/analytics", handler.GetEngagementAnalytics)
		
		// Get engagement predictions
		engagementGroup.GET("/customers/:customer_id/predictions", handler.GetEngagementPredictions)
	}
	
	// Template management endpoints
	templateGroup := personalizedGroup.Group("/templates")
	{
		// Get personalized template
		templateGroup.GET("/:template_id/personalized", handler.GetPersonalizedTemplate)
		
		// Test template personalization
		templateGroup.POST("/:template_id/test", handler.TestTemplatePersonalization)
		
		// Get template performance
		templateGroup.GET("/:template_id/performance", handler.GetTemplatePerformance)
		
		// A/B test templates
		templateGroup.POST("/ab-test", handler.CreateTemplateABTest)
	}
	
	// Dashboard and reporting endpoints
	dashboardGroup := personalizedGroup.Group("/dashboard")
	{
		// Personalization dashboard
		dashboardGroup.GET("/", handler.GetPersonalizationDashboard)
		
		// Real-time metrics
		dashboardGroup.GET("/metrics/realtime", handler.GetRealtimeMetrics)
		
		// Performance trends
		dashboardGroup.GET("/trends", handler.GetPerformanceTrends)
		
		// Customer insights
		dashboardGroup.GET("/insights", handler.GetCustomerInsights)
	}
	
	logger.Info("Personalized notification routes configured successfully")
}

// Additional handler methods for the new routes

func (h *PersonalizedNotificationHandler) CreateTargetedCampaign(c *gin.Context) {
	var req struct {
		Name            string                 `json:"name" binding:"required"`
		Description     string                 `json:"description"`
		TargetSegments  []string              `json:"target_segments" binding:"required"`
		NotificationTemplate NotificationRequest `json:"notification_template" binding:"required"`
		Schedule        CampaignSchedule       `json:"schedule"`
		Options         CampaignOptions        `json:"options"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Create campaign record
	campaign := &Campaign{
		ID:          uuid.New(),
		Name:        req.Name,
		Description: req.Description,
		TargetSegments: req.TargetSegments,
		Template:    req.NotificationTemplate,
		Schedule:    req.Schedule,
		Options:     req.Options,
		Status:      "active",
		CreatedBy:   c.GetString("user_id"),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	
	if err := h.db.Create(campaign).Error; err != nil {
		h.logger.WithError(err).Error("Failed to create campaign")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create campaign"})
		return
	}
	
	// Execute campaign if immediate
	if req.Schedule.Type == "immediate" {
		go h.executeCampaignAsync(ctx, campaign)
	}
	
	h.logger.WithFields(logrus.Fields{
		"campaign_id":     campaign.ID,
		"name":           campaign.Name,
		"target_segments": campaign.TargetSegments,
		"schedule_type":   req.Schedule.Type,
	}).Info("Targeted campaign created")
	
	c.JSON(http.StatusCreated, gin.H{
		"campaign_id": campaign.ID,
		"name":       campaign.Name,
		"status":     campaign.Status,
		"created_at": campaign.CreatedAt,
	})
}

type Campaign struct {
	ID             uuid.UUID           `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name           string              `json:"name" gorm:"not null"`
	Description    string              `json:"description"`
	TargetSegments []string            `json:"target_segments" gorm:"type:text[]"`
	Template       NotificationRequest `json:"template" gorm:"type:jsonb"`
	Schedule       CampaignSchedule    `json:"schedule" gorm:"type:jsonb"`
	Options        CampaignOptions     `json:"options" gorm:"type:jsonb"`
	Status         string              `json:"status" gorm:"default:'active'"`
	CreatedBy      string              `json:"created_by"`
	
	// Performance metrics
	TotalSent      int64   `json:"total_sent" gorm:"default:0"`
	TotalDelivered int64   `json:"total_delivered" gorm:"default:0"`
	TotalOpened    int64   `json:"total_opened" gorm:"default:0"`
	TotalClicked   int64   `json:"total_clicked" gorm:"default:0"`
	EngagementRate float64 `json:"engagement_rate" gorm:"default:0"`
	
	// Timestamps
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	StartedAt *time.Time `json:"started_at,omitempty"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
}

type CampaignSchedule struct {
	Type        string    `json:"type"` // immediate, scheduled, recurring
	StartTime   time.Time `json:"start_time,omitempty"`
	EndTime     time.Time `json:"end_time,omitempty"`
	Frequency   string    `json:"frequency,omitempty"` // daily, weekly, monthly
	DaysOfWeek  []int     `json:"days_of_week,omitempty"`
	TimeOfDay   string    `json:"time_of_day,omitempty"`
}

type CampaignOptions struct {
	MaxRecipients      int     `json:"max_recipients"`
	RateLimitPerMinute int     `json:"rate_limit_per_minute"`
	PersonalizationEnabled bool `json:"personalization_enabled"`
	ABTestEnabled      bool    `json:"ab_test_enabled"`
	ABTestPercentage   float64 `json:"ab_test_percentage"`
}

func (h *PersonalizedNotificationHandler) executeCampaignAsync(ctx context.Context, campaign *Campaign) {
	h.logger.WithField("campaign_id", campaign.ID).Info("Executing campaign asynchronously")
	
	// Update campaign status
	campaign.Status = "running"
	campaign.StartedAt = &time.Time{}
	*campaign.StartedAt = time.Now()
	h.db.Save(campaign)
	
	// Get target customers based on segments
	customers, err := h.getCustomersForSegments(ctx, campaign.TargetSegments)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get customers for campaign")
		campaign.Status = "failed"
		h.db.Save(campaign)
		return
	}
	
	// Apply max recipients limit
	if campaign.Options.MaxRecipients > 0 && len(customers) > campaign.Options.MaxRecipients {
		customers = customers[:campaign.Options.MaxRecipients]
	}
	
	h.logger.WithFields(logrus.Fields{
		"campaign_id":    campaign.ID,
		"target_count":   len(customers),
	}).Info("Starting campaign execution")
	
	// Execute campaign for each customer
	successCount := 0
	for _, customerID := range customers {
		// Apply rate limiting
		if campaign.Options.RateLimitPerMinute > 0 {
			time.Sleep(time.Minute / time.Duration(campaign.Options.RateLimitPerMinute))
		}
		
		// Create personalized notification
		notificationReq := campaign.Template
		notificationReq.ID = uuid.New()
		notificationReq.CustomerID = customerID
		
		// Add campaign metadata
		if notificationReq.Metadata == nil {
			notificationReq.Metadata = make(map[string]interface{})
		}
		notificationReq.Metadata["campaign_id"] = campaign.ID
		notificationReq.Metadata["campaign_name"] = campaign.Name
		
		// Process with personalization if enabled
		if campaign.Options.PersonalizationEnabled {
			enhanced, err := h.personalizedService.EnrichWithAnalytics(ctx, &notificationReq)
			if err != nil {
				h.logger.WithError(err).WithField("customer_id", customerID).Error("Failed to enrich notification")
				continue
			}
			
			if err := h.personalizedService.PersonalizeNotification(ctx, enhanced); err != nil {
				h.logger.WithError(err).WithField("customer_id", customerID).Error("Failed to personalize notification")
				continue
			}
			
			if _, err := h.processPersonalizedNotification(ctx, enhanced); err != nil {
				h.logger.WithError(err).WithField("customer_id", customerID).Error("Failed to process notification")
				continue
			}
		} else {
			// Send without personalization
			if err := h.notificationService.SendNotification(ctx, &notificationReq); err != nil {
				h.logger.WithError(err).WithField("customer_id", customerID).Error("Failed to send notification")
				continue
			}
		}
		
		successCount++
	}
	
	// Update campaign completion
	campaign.Status = "completed"
	campaign.EndedAt = &time.Time{}
	*campaign.EndedAt = time.Now()
	campaign.TotalSent = int64(successCount)
	h.db.Save(campaign)
	
	proactiveCampaignsExecuted.WithLabelValues(campaign.Name, "completed").Inc()
	
	h.logger.WithFields(logrus.Fields{
		"campaign_id":   campaign.ID,
		"total_sent":    successCount,
		"total_target":  len(customers),
		"success_rate":  float64(successCount) / float64(len(customers)) * 100,
	}).Info("Campaign execution completed")
}

func (h *PersonalizedNotificationHandler) getCustomersForSegments(ctx context.Context, segments []string) ([]uuid.UUID, error) {
	var customers []uuid.UUID
	
	// Query customers based on segments
	query := h.db.Model(&Transaction{}).
		Select("DISTINCT customer_id").
		Where("customer_segment IN ?", segments)
	
	if err := query.Scan(&customers).Error; err != nil {
		return nil, err
	}
	
	return customers, nil
}

func (h *PersonalizedNotificationHandler) GetCampaignPerformance(c *gin.Context) {
	campaignIDStr := c.Param("campaign_id")
	campaignID, err := uuid.Parse(campaignIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid campaign ID"})
		return
	}
	
	var campaign Campaign
	if err := h.db.Where("id = ?", campaignID).First(&campaign).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Campaign not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	// Get detailed performance metrics
	var notifications []Notification
	h.db.Where("metadata->>'campaign_id' = ?", campaignID.String()).Find(&notifications)
	
	// Calculate performance metrics
	performance := map[string]interface{}{
		"campaign_id":     campaign.ID,
		"name":           campaign.Name,
		"status":         campaign.Status,
		"total_sent":     campaign.TotalSent,
		"total_delivered": campaign.TotalDelivered,
		"total_opened":   campaign.TotalOpened,
		"total_clicked":  campaign.TotalClicked,
		"engagement_rate": campaign.EngagementRate,
		"delivery_rate":  h.calculateDeliveryRate(notifications),
		"open_rate":      h.calculateOpenRate(notifications),
		"click_rate":     h.calculateClickRate(notifications),
		"created_at":     campaign.CreatedAt,
		"started_at":     campaign.StartedAt,
		"ended_at":       campaign.EndedAt,
	}
	
	// Get segment breakdown
	segmentBreakdown := h.getSegmentBreakdown(notifications)
	performance["segment_breakdown"] = segmentBreakdown
	
	// Get channel performance
	channelPerformance := h.getChannelPerformance(notifications)
	performance["channel_performance"] = channelPerformance
	
	c.JSON(http.StatusOK, gin.H{
		"campaign_performance": performance,
		"timestamp":           time.Now(),
	})
}

func (h *PersonalizedNotificationHandler) GetActiveCampaigns(c *gin.Context) {
	var campaigns []Campaign
	
	query := h.db.Where("status IN ?", []string{"active", "running", "scheduled"})
	
	// Add pagination
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit
	
	query = query.Offset(offset).Limit(limit).Order("created_at DESC")
	
	if err := query.Find(&campaigns).Error; err != nil {
		h.logger.WithError(err).Error("Failed to get active campaigns")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve campaigns"})
		return
	}
	
	// Get total count
	var totalCount int64
	h.db.Model(&Campaign{}).Where("status IN ?", []string{"active", "running", "scheduled"}).Count(&totalCount)
	
	c.JSON(http.StatusOK, gin.H{
		"campaigns":    campaigns,
		"total_count":  totalCount,
		"page":        page,
		"limit":       limit,
		"total_pages": (totalCount + int64(limit) - 1) / int64(limit),
		"timestamp":   time.Now(),
	})
}

func (h *PersonalizedNotificationHandler) UpdateCampaignStatus(c *gin.Context) {
	campaignIDStr := c.Param("campaign_id")
	campaignID, err := uuid.Parse(campaignIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid campaign ID"})
		return
	}
	
	var req struct {
		Status string `json:"status" binding:"required,oneof=active paused stopped"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	var campaign Campaign
	if err := h.db.Where("id = ?", campaignID).First(&campaign).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Campaign not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	oldStatus := campaign.Status
	campaign.Status = req.Status
	campaign.UpdatedAt = time.Now()
	
	if err := h.db.Save(&campaign).Error; err != nil {
		h.logger.WithError(err).Error("Failed to update campaign status")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update campaign"})
		return
	}
	
	h.logger.WithFields(logrus.Fields{
		"campaign_id": campaignID,
		"old_status":  oldStatus,
		"new_status":  req.Status,
		"updated_by":  c.GetString("user_id"),
	}).Info("Campaign status updated")
	
	c.JSON(http.StatusOK, gin.H{
		"campaign_id": campaignID,
		"status":     campaign.Status,
		"updated_at": campaign.UpdatedAt,
	})
}

func (h *PersonalizedNotificationHandler) SendSegmentNotification(c *gin.Context) {
	segment := c.Param("segment")
	
	var req NotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Get customers in segment
	customers, err := h.getCustomersForSegments(ctx, []string{segment})
	if err != nil {
		h.logger.WithError(err).Error("Failed to get customers for segment")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get segment customers"})
		return
	}
	
	if len(customers) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No customers found in segment"})
		return
	}
	
	// Create and execute segment campaign
	campaign := &Campaign{
		ID:             uuid.New(),
		Name:           fmt.Sprintf("Segment Notification - %s", segment),
		Description:    fmt.Sprintf("Notification sent to %s segment", segment),
		TargetSegments: []string{segment},
		Template:       req,
		Schedule:       CampaignSchedule{Type: "immediate"},
		Options: CampaignOptions{
			PersonalizationEnabled: true,
			MaxRecipients:         len(customers),
		},
		Status:    "active",
		CreatedBy: c.GetString("user_id"),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	if err := h.db.Create(campaign).Error; err != nil {
		h.logger.WithError(err).Error("Failed to create segment campaign")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create campaign"})
		return
	}
	
	// Execute campaign asynchronously
	go h.executeCampaignAsync(ctx, campaign)
	
	h.logger.WithFields(logrus.Fields{
		"segment":        segment,
		"campaign_id":    campaign.ID,
		"target_count":   len(customers),
	}).Info("Segment notification campaign created")
	
	c.JSON(http.StatusCreated, gin.H{
		"campaign_id":   campaign.ID,
		"segment":       segment,
		"target_count":  len(customers),
		"status":        "processing",
		"created_at":    campaign.CreatedAt,
	})
}

// Helper functions for performance calculations
func (h *PersonalizedNotificationHandler) calculateDeliveryRate(notifications []Notification) float64 {
	if len(notifications) == 0 {
		return 0
	}
	
	delivered := 0
	for _, n := range notifications {
		if n.Status == "sent" || n.Status == "delivered" {
			delivered++
		}
	}
	
	return float64(delivered) / float64(len(notifications)) * 100
}

func (h *PersonalizedNotificationHandler) calculateOpenRate(notifications []Notification) float64 {
	// This would integrate with actual engagement tracking
	// For now, return a simulated rate based on expected engagement
	if len(notifications) == 0 {
		return 0
	}
	
	totalExpectedEngagement := 0.0
	for _, n := range notifications {
		totalExpectedEngagement += n.ExpectedEngagement
	}
	
	return (totalExpectedEngagement / float64(len(notifications))) * 100
}

func (h *PersonalizedNotificationHandler) calculateClickRate(notifications []Notification) float64 {
	// This would integrate with actual click tracking
	// For now, return a simulated rate (typically 20-30% of open rate)
	openRate := h.calculateOpenRate(notifications)
	return openRate * 0.25 // Assume 25% of opens result in clicks
}

func (h *PersonalizedNotificationHandler) getSegmentBreakdown(notifications []Notification) map[string]interface{} {
	segmentCounts := make(map[string]int)
	segmentEngagement := make(map[string]float64)
	
	for _, n := range notifications {
		if n.CustomerSegment != "" {
			segmentCounts[n.CustomerSegment]++
			segmentEngagement[n.CustomerSegment] += n.ExpectedEngagement
		}
	}
	
	breakdown := make(map[string]interface{})
	for segment, count := range segmentCounts {
		breakdown[segment] = map[string]interface{}{
			"count":             count,
			"avg_engagement":    segmentEngagement[segment] / float64(count),
			"percentage":        float64(count) / float64(len(notifications)) * 100,
		}
	}
	
	return breakdown
}

func (h *PersonalizedNotificationHandler) getChannelPerformance(notifications []Notification) map[string]interface{} {
	channelCounts := make(map[string]int)
	channelEngagement := make(map[string]float64)
	
	for _, n := range notifications {
		for _, channel := range n.Channels {
			channelCounts[channel]++
			channelEngagement[channel] += n.ExpectedEngagement
		}
	}
	
	performance := make(map[string]interface{})
	for channel, count := range channelCounts {
		performance[channel] = map[string]interface{}{
			"count":          count,
			"avg_engagement": channelEngagement[channel] / float64(count),
		}
	}
	
	return performance
}

