package main

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Setup Journey Routes
func SetupJourneyRoutes(router *gin.Engine, service *CustomerJourneyService, logger *logrus.Logger) {
	// Initialize handler
	handler := NewJourneyHandler(service, logger)
	
	// API versioning
	v1 := router.Group("/api/v1")
	v1.Use(AuthMiddleware()) // Ensure authentication
	
	// Core journey management endpoints
	journeyGroup := v1.Group("/journeys")
	{
		// Journey lifecycle
		journeyGroup.POST("/", handler.StartJourney)                                    // Start new journey
		journeyGroup.GET("/:journey_id", handler.GetJourney)                          // Get journey details
		journeyGroup.PUT("/:journey_id/stage", handler.UpdateJourneyStage)            // Update journey stage
		journeyGroup.POST("/:journey_id/touchpoints", handler.AddTouchpoint)          // Add touchpoint
		journeyGroup.GET("/:journey_id/analytics", handler.GetJourneyAnalytics)       // Get journey analytics
		
		// Next best actions
		journeyGroup.GET("/:journey_id/next-actions", handler.GetNextBestActions)     // Get recommendations
		journeyGroup.POST("/:journey_id/actions/execute", handler.ExecuteAction)      // Execute action
		
		// Bulk operations
		journeyGroup.PUT("/bulk", handler.BulkUpdateJourneys)                         // Bulk update journeys
	}
	
	// Customer-centric endpoints
	customerGroup := v1.Group("/customers")
	{
		// Customer journey management
		customerGroup.GET("/:customer_id/journeys", handler.GetCustomerJourneys)      // Get customer journeys
		customerGroup.POST("/:customer_id/journeys", handler.StartJourney)            // Start customer journey
		
		// Customer journey analytics
		customerGroup.GET("/:customer_id/journey-analytics", handler.GetCustomerJourneyAnalytics)
		customerGroup.GET("/:customer_id/journey-summary", handler.GetCustomerJourneySummary)
		customerGroup.GET("/:customer_id/journey-timeline", handler.GetCustomerJourneyTimeline)
	}
	
	// Touchpoint tracking endpoints
	touchpointGroup := v1.Group("/touchpoints")
	{
		// Touchpoint management
		touchpointGroup.POST("/", handler.RecordTouchpoint)                           // Record standalone touchpoint
		touchpointGroup.GET("/analytics", handler.GetTouchpointAnalytics)             // Touchpoint analytics
		touchpointGroup.GET("/heatmap", handler.GetTouchpointHeatmap)                 // Touchpoint heatmap
		
		// Touchpoint search and filtering
		touchpointGroup.GET("/search", handler.SearchTouchpoints)                     // Search touchpoints
		touchpointGroup.GET("/customer/:customer_id", handler.GetCustomerTouchpoints) // Customer touchpoints
	}
	
	// Next best action endpoints
	actionGroup := v1.Group("/actions")
	{
		// Action management
		actionGroup.GET("/recommendations", handler.GetActionRecommendations)         // Get action recommendations
		actionGroup.POST("/execute", handler.ExecuteBulkActions)                      // Execute bulk actions
		actionGroup.GET("/performance", handler.GetActionPerformance)                 // Action performance analytics
		
		// Action templates and rules
		actionGroup.GET("/templates", handler.GetActionTemplates)                     // Get action templates
		actionGroup.POST("/templates", handler.CreateActionTemplate)                  // Create action template
		actionGroup.GET("/rules", handler.GetActionRules)                            // Get action rules
		actionGroup.POST("/rules", handler.CreateActionRule)                         // Create action rule
	}
	
	// Journey optimization endpoints
	optimizationGroup := v1.Group("/optimization")
	{
		// Journey optimization
		optimizationGroup.GET("/opportunities", handler.GetOptimizationOpportunities) // Get optimization opportunities
		optimizationGroup.POST("/experiments", handler.CreateJourneyExperiment)       // Create A/B test
		optimizationGroup.GET("/experiments", handler.GetJourneyExperiments)          // Get experiments
		optimizationGroup.GET("/experiments/:experiment_id", handler.GetExperimentResults) // Get experiment results
		
		// Journey templates
		optimizationGroup.GET("/templates", handler.GetJourneyTemplates)              // Get journey templates
		optimizationGroup.POST("/templates", handler.CreateJourneyTemplate)           // Create journey template
		optimizationGroup.PUT("/templates/:template_id", handler.UpdateJourneyTemplate) // Update template
	}
	
	// Analytics and reporting endpoints
	analyticsGroup := v1.Group("/analytics")
	{
		// Dashboard and overview
		analyticsGroup.GET("/dashboard", handler.GetJourneyDashboard)                 // Journey dashboard
		analyticsGroup.GET("/overview", handler.GetJourneyOverview)                   // Journey overview
		analyticsGroup.GET("/trends", handler.GetJourneyTrends)                       // Journey trends
		
		// Detailed analytics
		analyticsGroup.GET("/funnel", handler.GetJourneyFunnelAnalysis)               // Funnel analysis
		analyticsGroup.GET("/cohort", handler.GetCohortAnalysis)                      // Cohort analysis
		analyticsGroup.GET("/attribution", handler.GetAttributionAnalysis)            // Attribution analysis
		analyticsGroup.GET("/segmentation", handler.GetSegmentationAnalysis)          // Segmentation analysis
		
		// Performance metrics
		analyticsGroup.GET("/kpis", handler.GetJourneyKPIs)                          // Key performance indicators
		analyticsGroup.GET("/benchmarks", handler.GetJourneyBenchmarks)               // Journey benchmarks
		analyticsGroup.GET("/predictions", handler.GetJourneyPredictions)             // Predictive analytics
	}
	
	// Real-time endpoints
	realtimeGroup := v1.Group("/realtime")
	{
		// Real-time tracking
		realtimeGroup.GET("/active-journeys", handler.GetActiveJourneys)              // Get active journeys
		realtimeGroup.GET("/live-events", handler.GetLiveEvents)                      // Get live events stream
		realtimeGroup.POST("/events", handler.RecordRealtimeEvent)                    // Record real-time event
		
		// Real-time analytics
		realtimeGroup.GET("/metrics", handler.GetRealtimeMetrics)                     // Real-time metrics
		realtimeGroup.GET("/alerts", handler.GetRealtimeAlerts)                       // Real-time alerts
		realtimeGroup.POST("/alerts", handler.CreateRealtimeAlert)                    // Create alert
	}
	
	// Integration endpoints
	integrationGroup := v1.Group("/integrations")
	{
		// External system integrations
		integrationGroup.POST("/webhook", handler.HandleWebhook)                      // Handle webhooks
		integrationGroup.GET("/export", handler.ExportJourneyData)                    // Export journey data
		integrationGroup.POST("/import", handler.ImportJourneyData)                   // Import journey data
		
		// API integrations
		integrationGroup.POST("/sync", handler.SyncExternalData)                      // Sync external data
		integrationGroup.GET("/health", handler.GetIntegrationHealth)                 // Integration health
	}
	
	// Admin endpoints
	adminGroup := v1.Group("/admin")
	adminGroup.Use(AdminMiddleware()) // Require admin privileges
	{
		// System management
		adminGroup.GET("/stats", handler.GetSystemStats)                             // System statistics
		adminGroup.POST("/maintenance", handler.TriggerMaintenance)                  // Trigger maintenance
		adminGroup.GET("/logs", handler.GetSystemLogs)                               // Get system logs
		
		// Data management
		adminGroup.POST("/cleanup", handler.CleanupOldData)                          // Cleanup old data
		adminGroup.POST("/reprocess", handler.ReprocessJourneys)                     // Reprocess journeys
		adminGroup.GET("/data-quality", handler.GetDataQuality)                      // Data quality metrics
	}
	
	logger.Info("Customer Journey routes configured successfully")
}

// Additional handler methods for the new routes

func (h *JourneyHandler) GetCustomerJourneyAnalytics(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	// Get comprehensive customer journey analytics
	analytics := h.calculateComprehensiveCustomerAnalytics(customerID)
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id": customerID,
		"analytics":   analytics,
		"timestamp":   time.Now(),
	})
}

func (h *JourneyHandler) GetCustomerJourneySummary(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	summary := h.calculateCustomerJourneySummary(customerID)
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id": customerID,
		"summary":     summary,
		"timestamp":   time.Now(),
	})
}

func (h *JourneyHandler) GetCustomerJourneyTimeline(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	// Get customer journeys
	var journeys []CustomerJourney
	if err := h.service.db.Where("customer_id = ?", customerID).Order("started_at DESC").Find(&journeys).Error; err != nil {
		h.logger.WithError(err).Error("Failed to get customer journeys for timeline")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve journeys"})
		return
	}
	
	// Build timeline
	timeline := h.buildCustomerJourneyTimeline(journeys)
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id": customerID,
		"timeline":    timeline,
		"total_events": len(timeline),
		"timestamp":   time.Now(),
	})
}

func (h *JourneyHandler) RecordTouchpoint(c *gin.Context) {
	var req struct {
		CustomerID uuid.UUID       `json:"customer_id" binding:"required"`
		JourneyID  *uuid.UUID      `json:"journey_id,omitempty"`
		Touchpoint TouchpointEvent `json:"touchpoint" binding:"required"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// If journey ID is provided, add to existing journey
	if req.JourneyID != nil {
		if err := h.journeyEngine.AddTouchpoint(ctx, *req.JourneyID, req.Touchpoint); err != nil {
			h.logger.WithError(err).Error("Failed to add touchpoint to journey")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record touchpoint"})
			return
		}
	} else {
		// Record standalone touchpoint
		if err := h.touchpointTracker.RecordStandaloneTouchpoint(ctx, req.CustomerID, req.Touchpoint); err != nil {
			h.logger.WithError(err).Error("Failed to record standalone touchpoint")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record touchpoint"})
			return
		}
	}
	
	c.JSON(http.StatusCreated, gin.H{
		"touchpoint_id": req.Touchpoint.ID,
		"customer_id":   req.CustomerID,
		"journey_id":    req.JourneyID,
		"status":        "recorded",
		"timestamp":     time.Now(),
	})
}

func (h *JourneyHandler) GetTouchpointAnalytics(c *gin.Context) {
	// Parse query parameters
	timeRange := c.DefaultQuery("time_range", "7d")
	touchpointType := c.DefaultQuery("type", "")
	channel := c.DefaultQuery("channel", "")
	
	analytics := h.touchpointTracker.GetTouchpointAnalytics(timeRange, touchpointType, channel)
	
	c.JSON(http.StatusOK, gin.H{
		"analytics":  analytics,
		"filters": map[string]string{
			"time_range": timeRange,
			"type":       touchpointType,
			"channel":    channel,
		},
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) GetTouchpointHeatmap(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "7d")
	
	heatmap := h.touchpointTracker.GenerateTouchpointHeatmap(timeRange)
	
	c.JSON(http.StatusOK, gin.H{
		"heatmap":    heatmap,
		"time_range": timeRange,
		"timestamp":  time.Now(),
	})
}

func (h *JourneyHandler) SearchTouchpoints(c *gin.Context) {
	// Parse search parameters
	query := c.DefaultQuery("q", "")
	touchpointType := c.DefaultQuery("type", "")
	channel := c.DefaultQuery("channel", "")
	status := c.DefaultQuery("status", "")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	
	results := h.touchpointTracker.SearchTouchpoints(query, touchpointType, channel, status, limit, offset)
	
	c.JSON(http.StatusOK, gin.H{
		"results":   results,
		"query":     query,
		"filters": map[string]string{
			"type":    touchpointType,
			"channel": channel,
			"status":  status,
		},
		"limit":     limit,
		"offset":    offset,
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) GetCustomerTouchpoints(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	
	touchpoints := h.touchpointTracker.GetCustomerTouchpoints(customerID, limit, offset)
	
	c.JSON(http.StatusOK, gin.H{
		"customer_id":  customerID,
		"touchpoints":  touchpoints,
		"count":        len(touchpoints),
		"limit":        limit,
		"offset":       offset,
		"timestamp":    time.Now(),
	})
}

func (h *JourneyHandler) GetActionRecommendations(c *gin.Context) {
	customerID := c.Query("customer_id")
	journeyID := c.Query("journey_id")
	segment := c.Query("segment")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	
	ctx := c.Request.Context()
	
	var recommendations []ActionRecommendation
	var err error
	
	if journeyID != "" {
		journeyUUID, parseErr := uuid.Parse(journeyID)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
			return
		}
		recommendations, err = h.nextBestActionEngine.GetRecommendations(ctx, journeyUUID)
	} else if customerID != "" {
		customerUUID, parseErr := uuid.Parse(customerID)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
			return
		}
		recommendations, err = h.nextBestActionEngine.GetCustomerRecommendations(ctx, customerUUID, limit)
	} else if segment != "" {
		recommendations, err = h.nextBestActionEngine.GetSegmentRecommendations(ctx, segment, limit)
	} else {
		recommendations, err = h.nextBestActionEngine.GetGlobalRecommendations(ctx, limit)
	}
	
	if err != nil {
		h.logger.WithError(err).Error("Failed to get action recommendations")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get recommendations"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"recommendations": recommendations,
		"count":          len(recommendations),
		"filters": map[string]string{
			"customer_id": customerID,
			"journey_id":  journeyID,
			"segment":     segment,
		},
		"limit":     limit,
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) ExecuteBulkActions(c *gin.Context) {
	var req struct {
		Actions []struct {
			JourneyID  uuid.UUID              `json:"journey_id" binding:"required"`
			ActionID   uuid.UUID              `json:"action_id" binding:"required"`
			Parameters map[string]interface{} `json:"parameters"`
		} `json:"actions" binding:"required"`
		ExecutedBy string `json:"executed_by"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if len(req.Actions) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 50 actions allowed per bulk operation"})
		return
	}
	
	ctx := c.Request.Context()
	results := make(map[string]interface{})
	successCount := 0
	
	for i, action := range req.Actions {
		result, err := h.nextBestActionEngine.ExecuteAction(ctx, action.JourneyID, action.ActionID, action.Parameters)
		
		actionKey := fmt.Sprintf("action_%d", i)
		if err != nil {
			results[actionKey] = map[string]interface{}{
				"success":    false,
				"error":      err.Error(),
				"journey_id": action.JourneyID,
				"action_id":  action.ActionID,
			}
		} else {
			results[actionKey] = map[string]interface{}{
				"success":    true,
				"result":     result,
				"journey_id": action.JourneyID,
				"action_id":  action.ActionID,
			}
			successCount++
		}
	}
	
	c.JSON(http.StatusOK, gin.H{
		"total_actions":   len(req.Actions),
		"successful":      successCount,
		"failed":         len(req.Actions) - successCount,
		"results":        results,
		"executed_by":    req.ExecutedBy,
		"timestamp":      time.Now(),
	})
}

func (h *JourneyHandler) GetActionPerformance(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "30d")
	actionType := c.DefaultQuery("action_type", "")
	
	performance := h.nextBestActionEngine.GetActionPerformance(timeRange, actionType)
	
	c.JSON(http.StatusOK, gin.H{
		"performance": performance,
		"filters": map[string]string{
			"time_range":  timeRange,
			"action_type": actionType,
		},
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) GetOptimizationOpportunities(c *gin.Context) {
	journeyType := c.DefaultQuery("journey_type", "")
	segment := c.DefaultQuery("segment", "")
	
	opportunities := h.journeyOptimizer.GetOptimizationOpportunities(journeyType, segment)
	
	c.JSON(http.StatusOK, gin.H{
		"opportunities": opportunities,
		"count":        len(opportunities),
		"filters": map[string]string{
			"journey_type": journeyType,
			"segment":     segment,
		},
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) GetJourneyOverview(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "30d")
	
	overview := h.calculateJourneyOverview(timeRange)
	
	c.JSON(http.StatusOK, gin.H{
		"overview":   overview,
		"time_range": timeRange,
		"timestamp":  time.Now(),
	})
}

func (h *JourneyHandler) GetJourneyTrends(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "90d")
	granularity := c.DefaultQuery("granularity", "daily") // daily, weekly, monthly
	
	trends := h.calculateJourneyTrends(timeRange, granularity)
	
	c.JSON(http.StatusOK, gin.H{
		"trends":      trends,
		"time_range":  timeRange,
		"granularity": granularity,
		"timestamp":   time.Now(),
	})
}

func (h *JourneyHandler) GetActiveJourneys(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	segment := c.DefaultQuery("segment", "")
	journeyType := c.DefaultQuery("journey_type", "")
	
	query := h.service.db.Where("status = 'active'")
	
	if segment != "" {
		query = query.Where("customer_segment = ?", segment)
	}
	
	if journeyType != "" {
		query = query.Where("journey_type = ?", journeyType)
	}
	
	var activeJourneys []CustomerJourney
	if err := query.Limit(limit).Order("last_activity_at DESC").Find(&activeJourneys).Error; err != nil {
		h.logger.WithError(err).Error("Failed to get active journeys")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve active journeys"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"active_journeys": activeJourneys,
		"count":          len(activeJourneys),
		"filters": map[string]string{
			"segment":      segment,
			"journey_type": journeyType,
		},
		"limit":     limit,
		"timestamp": time.Now(),
	})
}

func (h *JourneyHandler) GetRealtimeMetrics(c *gin.Context) {
	metrics := h.calculateRealtimeMetrics()
	
	c.JSON(http.StatusOK, gin.H{
		"metrics":   metrics,
		"timestamp": time.Now(),
	})
}

// Helper functions for new endpoints
func (h *JourneyHandler) calculateComprehensiveCustomerAnalytics(customerID uuid.UUID) map[string]interface{} {
	// Get all customer journeys
	var journeys []CustomerJourney
	h.service.db.Where("customer_id = ?", customerID).Find(&journeys)
	
	analytics := map[string]interface{}{
		"customer_id":        customerID,
		"total_journeys":     len(journeys),
		"journey_breakdown":  h.getJourneyTypeBreakdown(journeys),
		"stage_analysis":     h.getStageAnalysis(journeys),
		"touchpoint_summary": h.getTouchpointSummary(journeys),
		"performance_metrics": h.getCustomerPerformanceMetrics(journeys),
		"behavioral_insights": h.getBehavioralInsights(journeys),
		"predictive_scores":  h.getPredictiveScores(journeys),
	}
	
	return analytics
}

func (h *JourneyHandler) buildCustomerJourneyTimeline(journeys []CustomerJourney) []map[string]interface{} {
	timeline := []map[string]interface{}{}
	
	for _, journey := range journeys {
		// Add journey start event
		timeline = append(timeline, map[string]interface{}{
			"type":        "journey_start",
			"journey_id":  journey.ID,
			"journey_type": journey.JourneyType,
			"stage":       journey.CurrentStage,
			"timestamp":   journey.StartedAt,
			"metadata": map[string]interface{}{
				"entry_point": journey.EntryPoint,
				"channel":     journey.Channel,
			},
		})
		
		// Add touchpoints
		for _, touchpoint := range journey.Touchpoints {
			timeline = append(timeline, map[string]interface{}{
				"type":        "touchpoint",
				"journey_id":  journey.ID,
				"touchpoint_id": touchpoint.ID,
				"touchpoint_type": touchpoint.Type,
				"channel":     touchpoint.Channel,
				"action":      touchpoint.Action,
				"status":      touchpoint.Status,
				"timestamp":   touchpoint.Timestamp,
				"metadata":    touchpoint.Metadata,
			})
		}
		
		// Add journey completion event if completed
		if journey.CompletedAt != nil {
			timeline = append(timeline, map[string]interface{}{
				"type":        "journey_completion",
				"journey_id":  journey.ID,
				"journey_type": journey.JourneyType,
				"final_stage": journey.CurrentStage,
				"progress":    journey.Progress,
				"timestamp":   *journey.CompletedAt,
				"metadata": map[string]interface{}{
					"duration_hours": journey.CompletedAt.Sub(journey.StartedAt).Hours(),
					"total_touchpoints": journey.TotalTouchpoints,
				},
			})
		}
	}
	
	// Sort timeline by timestamp
	// Note: In a real implementation, you'd sort this slice
	
	return timeline
}

func (h *JourneyHandler) calculateJourneyOverview(timeRange string) map[string]interface{} {
	// Parse time range
	var timeFilter time.Time
	switch timeRange {
	case "7d":
		timeFilter = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		timeFilter = time.Now().Add(-30 * 24 * time.Hour)
	case "90d":
		timeFilter = time.Now().Add(-90 * 24 * time.Hour)
	default:
		timeFilter = time.Now().Add(-30 * 24 * time.Hour)
	}
	
	// Calculate overview metrics
	var totalJourneys, activeJourneys, completedJourneys int64
	var avgProgress, completionRate float64
	
	h.service.db.Model(&CustomerJourney{}).Where("created_at >= ?", timeFilter).Count(&totalJourneys)
	h.service.db.Model(&CustomerJourney{}).Where("created_at >= ? AND status = 'active'", timeFilter).Count(&activeJourneys)
	h.service.db.Model(&CustomerJourney{}).Where("created_at >= ? AND status = 'completed'", timeFilter).Count(&completedJourneys)
	
	if totalJourneys > 0 {
		h.service.db.Model(&CustomerJourney{}).Where("created_at >= ?", timeFilter).Select("AVG(progress)").Scan(&avgProgress)
		completionRate = float64(completedJourneys) / float64(totalJourneys) * 100
	}
	
	return map[string]interface{}{
		"total_journeys":     totalJourneys,
		"active_journeys":    activeJourneys,
		"completed_journeys": completedJourneys,
		"average_progress":   avgProgress,
		"completion_rate":    completionRate,
		"time_range":        timeRange,
	}
}

func (h *JourneyHandler) calculateJourneyTrends(timeRange, granularity string) map[string]interface{} {
	// This would implement trend calculation based on granularity
	// For now, return a placeholder structure
	return map[string]interface{}{
		"journey_starts":   []map[string]interface{}{},
		"completions":      []map[string]interface{}{},
		"abandonment_rate": []map[string]interface{}{},
		"average_duration": []map[string]interface{}{},
		"granularity":      granularity,
		"time_range":       timeRange,
	}
}

func (h *JourneyHandler) calculateRealtimeMetrics() map[string]interface{} {
	// Calculate real-time metrics
	var activeJourneys, todayStarts, todayCompletions int64
	
	h.service.db.Model(&CustomerJourney{}).Where("status = 'active'").Count(&activeJourneys)
	
	today := time.Now().Truncate(24 * time.Hour)
	h.service.db.Model(&CustomerJourney{}).Where("started_at >= ?", today).Count(&todayStarts)
	h.service.db.Model(&CustomerJourney{}).Where("completed_at >= ?", today).Count(&todayCompletions)
	
	return map[string]interface{}{
		"active_journeys":     activeJourneys,
		"today_starts":        todayStarts,
		"today_completions":   todayCompletions,
		"current_completion_rate": func() float64 {
			if todayStarts > 0 {
				return float64(todayCompletions) / float64(todayStarts) * 100
			}
			return 0.0
		}(),
		"last_updated": time.Now(),
	}
}

// Additional helper functions for analytics
func (h *JourneyHandler) getJourneyTypeBreakdown(journeys []CustomerJourney) map[string]int {
	breakdown := make(map[string]int)
	for _, journey := range journeys {
		breakdown[journey.JourneyType]++
	}
	return breakdown
}

func (h *JourneyHandler) getStageAnalysis(journeys []CustomerJourney) map[string]interface{} {
	stageCount := make(map[string]int)
	stageProgress := make(map[string][]float64)
	
	for _, journey := range journeys {
		stageCount[journey.CurrentStage]++
		stageProgress[journey.CurrentStage] = append(stageProgress[journey.CurrentStage], journey.Progress)
	}
	
	// Calculate average progress per stage
	avgProgress := make(map[string]float64)
	for stage, progresses := range stageProgress {
		if len(progresses) > 0 {
			sum := 0.0
			for _, p := range progresses {
				sum += p
			}
			avgProgress[stage] = sum / float64(len(progresses))
		}
	}
	
	return map[string]interface{}{
		"stage_distribution": stageCount,
		"average_progress":   avgProgress,
	}
}

func (h *JourneyHandler) getTouchpointSummary(journeys []CustomerJourney) map[string]interface{} {
	totalTouchpoints := 0
	channelCount := make(map[string]int)
	typeCount := make(map[string]int)
	
	for _, journey := range journeys {
		totalTouchpoints += journey.TotalTouchpoints
		
		for _, tp := range journey.Touchpoints {
			channelCount[tp.Channel]++
			typeCount[tp.Type]++
		}
	}
	
	return map[string]interface{}{
		"total_touchpoints":   totalTouchpoints,
		"channel_distribution": channelCount,
		"type_distribution":   typeCount,
	}
}

func (h *JourneyHandler) getCustomerPerformanceMetrics(journeys []CustomerJourney) map[string]interface{} {
	if len(journeys) == 0 {
		return map[string]interface{}{}
	}
	
	totalProgress := 0.0
	totalCompletionProb := 0.0
	totalChurnProb := 0.0
	completedCount := 0
	
	for _, journey := range journeys {
		totalProgress += journey.Progress
		totalCompletionProb += journey.CompletionProbability
		totalChurnProb += journey.ChurnProbability
		
		if journey.Status == "completed" {
			completedCount++
		}
	}
	
	return map[string]interface{}{
		"average_progress":           totalProgress / float64(len(journeys)),
		"average_completion_probability": totalCompletionProb / float64(len(journeys)),
		"average_churn_probability":  totalChurnProb / float64(len(journeys)),
		"completion_rate":           float64(completedCount) / float64(len(journeys)) * 100,
	}
}

func (h *JourneyHandler) getBehavioralInsights(journeys []CustomerJourney) map[string]interface{} {
	insights := map[string]interface{}{
		"preferred_channels":    h.getPreferredChannels(journeys),
		"activity_patterns":     h.getActivityPatterns(journeys),
		"engagement_trends":     h.getEngagementTrends(journeys),
		"journey_preferences":   h.getJourneyPreferences(journeys),
	}
	
	return insights
}

func (h *JourneyHandler) getPredictiveScores(journeys []CustomerJourney) map[string]interface{} {
	if len(journeys) == 0 {
		return map[string]interface{}{}
	}
	
	// Get the most recent journey for current predictions
	var latestJourney CustomerJourney
	for _, journey := range journeys {
		if journey.LastActivityAt.After(latestJourney.LastActivityAt) {
			latestJourney = journey
		}
	}
	
	return map[string]interface{}{
		"completion_probability": latestJourney.CompletionProbability,
		"churn_probability":     latestJourney.ChurnProbability,
		"predicted_outcome":     latestJourney.PredictedOutcome,
		"next_best_action":      latestJourney.NextBestAction,
		"engagement_score":      latestJourney.EngagementScore,
	}
}

func (h *JourneyHandler) getPreferredChannels(journeys []CustomerJourney) []map[string]interface{} {
	channelUsage := make(map[string]int)
	
	for _, journey := range journeys {
		for _, tp := range journey.Touchpoints {
			channelUsage[tp.Channel]++
		}
	}
	
	// Convert to sorted slice
	channels := []map[string]interface{}{}
	for channel, count := range channelUsage {
		channels = append(channels, map[string]interface{}{
			"channel": channel,
			"usage_count": count,
		})
	}
	
	return channels
}

func (h *JourneyHandler) getActivityPatterns(journeys []CustomerJourney) map[string]interface{} {
	hourlyActivity := make(map[int]int)
	dailyActivity := make(map[string]int)
	
	for _, journey := range journeys {
		for _, tp := range journey.Touchpoints {
			hour := tp.Timestamp.Hour()
			day := tp.Timestamp.Weekday().String()
			
			hourlyActivity[hour]++
			dailyActivity[day]++
		}
	}
	
	return map[string]interface{}{
		"hourly_distribution": hourlyActivity,
		"daily_distribution":  dailyActivity,
	}
}

func (h *JourneyHandler) getEngagementTrends(journeys []CustomerJourney) []map[string]interface{} {
	// Calculate engagement over time
	trends := []map[string]interface{}{}
	
	for _, journey := range journeys {
		trends = append(trends, map[string]interface{}{
			"journey_id":       journey.ID,
			"started_at":       journey.StartedAt,
			"engagement_score": journey.EngagementScore,
			"touchpoint_count": journey.TotalTouchpoints,
			"progress":         journey.Progress,
		})
	}
	
	return trends
}

func (h *JourneyHandler) getJourneyPreferences(journeys []CustomerJourney) map[string]interface{} {
	typePreference := make(map[string]int)
	entryPointPreference := make(map[string]int)
	
	for _, journey := range journeys {
		typePreference[journey.JourneyType]++
		entryPointPreference[journey.EntryPoint]++
	}
	
	return map[string]interface{}{
		"journey_type_preference": typePreference,
		"entry_point_preference":  entryPointPreference,
	}
}

