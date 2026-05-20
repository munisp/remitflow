package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// Journey Handlers
type JourneyHandler struct {
	service           *CustomerJourneyService
	journeyEngine     *JourneyEngine
	touchpointTracker *TouchpointTracker
	nextBestActionEngine *NextBestActionEngine
	journeyOptimizer  *JourneyOptimizer
	logger           *logrus.Logger
}

func NewJourneyHandler(service *CustomerJourneyService, logger *logrus.Logger) *JourneyHandler {
	return &JourneyHandler{
		service:           service,
		journeyEngine:     service.journeyEngine,
		touchpointTracker: NewTouchpointTracker(service.db, logger),
		nextBestActionEngine: NewNextBestActionEngine(service.db, logger, service.analyticsClient),
		journeyOptimizer:  NewJourneyOptimizer(service.db, logger),
		logger:           logger,
	}
}

// Start a new customer journey
func (h *JourneyHandler) StartJourney(c *gin.Context) {
	var req StartJourneyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Validate journey type
	if !h.isValidJourneyType(req.JourneyType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey type"})
		return
	}
	
	// Check for existing active journey
	existingJourney, err := h.getActiveJourney(req.CustomerID, req.JourneyType)
	if err == nil && existingJourney != nil {
		h.logger.WithFields(logrus.Fields{
			"customer_id":  req.CustomerID,
			"journey_type": req.JourneyType,
			"existing_id":  existingJourney.ID,
		}).Info("Returning existing active journey")
		
		c.JSON(http.StatusOK, gin.H{
			"journey":    existingJourney,
			"message":    "Existing active journey found",
			"is_new":     false,
			"timestamp":  time.Now(),
		})
		return
	}
	
	// Start new journey
	journey, err := h.journeyEngine.StartJourney(ctx, &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to start journey")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start journey"})
		return
	}
	
	// Get initial recommendations
	recommendations, err := h.nextBestActionEngine.GetRecommendations(ctx, journey.ID)
	if err != nil {
		h.logger.WithError(err).Warn("Failed to get initial recommendations")
		recommendations = []ActionRecommendation{}
	}
	
	response := gin.H{
		"journey":         journey,
		"recommendations": recommendations,
		"is_new":         true,
		"timestamp":      time.Now(),
	}
	
	c.JSON(http.StatusCreated, response)
}

// Add touchpoint to journey
func (h *JourneyHandler) AddTouchpoint(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	var touchpoint TouchpointEvent
	if err := c.ShouldBindJSON(&touchpoint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Add touchpoint to journey
	if err := h.journeyEngine.AddTouchpoint(ctx, journeyID, touchpoint); err != nil {
		h.logger.WithError(err).Error("Failed to add touchpoint")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add touchpoint"})
		return
	}
	
	// Get updated journey
	journey, err := h.getJourney(journeyID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get updated journey")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get journey"})
		return
	}
	
	// Get new recommendations based on updated journey
	recommendations, err := h.nextBestActionEngine.GetRecommendations(ctx, journeyID)
	if err != nil {
		h.logger.WithError(err).Warn("Failed to get updated recommendations")
		recommendations = []ActionRecommendation{}
	}
	
	response := gin.H{
		"journey":         journey,
		"touchpoint_id":   touchpoint.ID,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}
	
	c.JSON(http.StatusOK, response)
}

// Get journey details
func (h *JourneyHandler) GetJourney(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	journey, err := h.getJourney(journeyID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Journey not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	// Get journey analytics
	analytics := h.calculateJourneyAnalytics(journey)
	
	// Get recommendations
	ctx := c.Request.Context()
	recommendations, err := h.nextBestActionEngine.GetRecommendations(ctx, journeyID)
	if err != nil {
		h.logger.WithError(err).Warn("Failed to get recommendations")
		recommendations = []ActionRecommendation{}
	}
	
	response := gin.H{
		"journey":         journey,
		"analytics":       analytics,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}
	
	c.JSON(http.StatusOK, response)
}

// Get customer journeys
func (h *JourneyHandler) GetCustomerJourneys(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	// Parse query parameters
	status := c.DefaultQuery("status", "")
	journeyType := c.DefaultQuery("journey_type", "")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	
	// Build query
	query := h.service.db.Where("customer_id = ?", customerID)
	
	if status != "" {
		query = query.Where("status = ?", status)
	}
	
	if journeyType != "" {
		query = query.Where("journey_type = ?", journeyType)
	}
	
	// Get total count
	var totalCount int64
	query.Model(&CustomerJourney{}).Count(&totalCount)
	
	// Get journeys with pagination
	var journeys []CustomerJourney
	if err := query.Offset(offset).Limit(limit).Order("created_at DESC").Find(&journeys).Error; err != nil {
		h.logger.WithError(err).Error("Failed to get customer journeys")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve journeys"})
		return
	}
	
	// Calculate summary analytics
	summary := h.calculateCustomerJourneySummary(customerID)
	
	response := gin.H{
		"customer_id":   customerID,
		"journeys":      journeys,
		"total_count":   totalCount,
		"limit":         limit,
		"offset":        offset,
		"summary":       summary,
		"timestamp":     time.Now(),
	}
	
	c.JSON(http.StatusOK, response)
}

// Update journey stage manually
func (h *JourneyHandler) UpdateJourneyStage(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	var req struct {
		Stage  string `json:"stage" binding:"required"`
		Reason string `json:"reason"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	journey, err := h.getJourney(journeyID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Journey not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	// Update journey stage
	previousStage := journey.CurrentStage
	journey.PreviousStage = previousStage
	journey.CurrentStage = req.Stage
	journey.Progress = h.journeyEngine.calculateProgress(journey)
	journey.LastActivityAt = time.Now()
	journey.UpdatedAt = time.Now()
	
	// Add manual stage change touchpoint
	touchpoint := TouchpointEvent{
		ID:        uuid.New(),
		Type:      "manual_stage_change",
		Channel:   "admin",
		Action:    "stage_update",
		Status:    "success",
		Metadata: map[string]interface{}{
			"previous_stage": previousStage,
			"new_stage":     req.Stage,
			"reason":        req.Reason,
			"updated_by":    c.GetString("user_id"),
		},
		Timestamp: time.Now(),
	}
	
	journey.Touchpoints = append(journey.Touchpoints, touchpoint)
	journey.TotalTouchpoints++
	
	// Save updated journey
	if err := h.service.db.Save(journey).Error; err != nil {
		h.logger.WithError(err).Error("Failed to update journey stage")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update journey"})
		return
	}
	
	h.logger.WithFields(logrus.Fields{
		"journey_id":     journeyID,
		"customer_id":    journey.CustomerID,
		"previous_stage": previousStage,
		"new_stage":      req.Stage,
		"updated_by":     c.GetString("user_id"),
	}).Info("Journey stage updated manually")
	
	c.JSON(http.StatusOK, gin.H{
		"journey":        journey,
		"previous_stage": previousStage,
		"new_stage":      req.Stage,
		"updated_at":     journey.UpdatedAt,
	})
}

// Get journey analytics
func (h *JourneyHandler) GetJourneyAnalytics(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	journey, err := h.getJourney(journeyID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Journey not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	// Calculate comprehensive analytics
	analytics := h.calculateDetailedJourneyAnalytics(journey)
	
	c.JSON(http.StatusOK, gin.H{
		"journey_id": journeyID,
		"analytics":  analytics,
		"timestamp":  time.Now(),
	})
}

// Get next best actions
func (h *JourneyHandler) GetNextBestActions(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	recommendations, err := h.nextBestActionEngine.GetRecommendations(ctx, journeyID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get next best actions")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get recommendations"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"journey_id":      journeyID,
		"recommendations": recommendations,
		"count":          len(recommendations),
		"timestamp":      time.Now(),
	})
}

// Execute recommended action
func (h *JourneyHandler) ExecuteAction(c *gin.Context) {
	journeyIDStr := c.Param("journey_id")
	journeyID, err := uuid.Parse(journeyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid journey ID"})
		return
	}
	
	var req struct {
		ActionID    uuid.UUID              `json:"action_id" binding:"required"`
		Parameters  map[string]interface{} `json:"parameters"`
		ExecutedBy  string                 `json:"executed_by"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Execute the action
	result, err := h.nextBestActionEngine.ExecuteAction(ctx, journeyID, req.ActionID, req.Parameters)
	if err != nil {
		h.logger.WithError(err).Error("Failed to execute action")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to execute action"})
		return
	}
	
	// Add execution touchpoint
	touchpoint := TouchpointEvent{
		ID:        uuid.New(),
		Type:      "action_execution",
		Channel:   "system",
		Action:    result.ActionName,
		Status:    result.Status,
		Duration:  result.ExecutionTime,
		Metadata: map[string]interface{}{
			"action_id":    req.ActionID,
			"executed_by":  req.ExecutedBy,
			"parameters":   req.Parameters,
			"result":       result,
		},
		Timestamp: time.Now(),
	}
	
	if err := h.journeyEngine.AddTouchpoint(ctx, journeyID, touchpoint); err != nil {
		h.logger.WithError(err).Error("Failed to add action execution touchpoint")
	}
	
	c.JSON(http.StatusOK, gin.H{
		"journey_id":     journeyID,
		"action_result":  result,
		"touchpoint_id":  touchpoint.ID,
		"timestamp":      time.Now(),
	})
}

// Journey dashboard
func (h *JourneyHandler) GetJourneyDashboard(c *gin.Context) {
	// Parse query parameters
	timeRange := c.DefaultQuery("time_range", "7d") // 1d, 7d, 30d, 90d
	journeyType := c.DefaultQuery("journey_type", "")
	segment := c.DefaultQuery("segment", "")
	
	// Calculate time filter
	var timeFilter time.Time
	switch timeRange {
	case "1d":
		timeFilter = time.Now().Add(-24 * time.Hour)
	case "7d":
		timeFilter = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		timeFilter = time.Now().Add(-30 * 24 * time.Hour)
	case "90d":
		timeFilter = time.Now().Add(-90 * 24 * time.Hour)
	default:
		timeFilter = time.Now().Add(-7 * 24 * time.Hour)
	}
	
	// Build base query
	query := h.service.db.Model(&CustomerJourney{}).Where("created_at >= ?", timeFilter)
	
	if journeyType != "" {
		query = query.Where("journey_type = ?", journeyType)
	}
	
	if segment != "" {
		query = query.Where("customer_segment = ?", segment)
	}
	
	// Get overview statistics
	var stats struct {
		TotalJourneys     int64   `json:"total_journeys"`
		ActiveJourneys    int64   `json:"active_journeys"`
		CompletedJourneys int64   `json:"completed_journeys"`
		AbandonedJourneys int64   `json:"abandoned_journeys"`
		AverageProgress   float64 `json:"average_progress"`
		CompletionRate    float64 `json:"completion_rate"`
	}
	
	query.Count(&stats.TotalJourneys)
	query.Where("status = 'active'").Count(&stats.ActiveJourneys)
	query.Where("status = 'completed'").Count(&stats.CompletedJourneys)
	query.Where("status = 'abandoned'").Count(&stats.AbandonedJourneys)
	
	// Calculate averages
	if stats.TotalJourneys > 0 {
		query.Select("AVG(progress)").Scan(&stats.AverageProgress)
		stats.CompletionRate = float64(stats.CompletedJourneys) / float64(stats.TotalJourneys) * 100
	}
	
	// Get journey type distribution
	var journeyTypeStats []struct {
		JourneyType    string  `json:"journey_type"`
		Count          int64   `json:"count"`
		CompletionRate float64 `json:"completion_rate"`
		AverageTime    float64 `json:"average_time_hours"`
	}
	
	h.service.db.Raw(`
		SELECT 
			journey_type,
			COUNT(*) as count,
			AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) * 100 as completion_rate,
			AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))) / 3600 as average_time_hours
		FROM customer_journeys 
		WHERE created_at >= ?
		GROUP BY journey_type
		ORDER BY count DESC
	`, timeFilter).Scan(&journeyTypeStats)
	
	// Get segment performance
	var segmentStats []struct {
		Segment        string  `json:"segment"`
		Count          int64   `json:"count"`
		CompletionRate float64 `json:"completion_rate"`
		AverageProgress float64 `json:"average_progress"`
	}
	
	h.service.db.Raw(`
		SELECT 
			customer_segment as segment,
			COUNT(*) as count,
			AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) * 100 as completion_rate,
			AVG(progress) as average_progress
		FROM customer_journeys 
		WHERE created_at >= ? AND customer_segment != ''
		GROUP BY customer_segment
		ORDER BY count DESC
	`, timeFilter).Scan(&segmentStats)
	
	// Get stage analysis
	var stageStats []struct {
		Stage           string  `json:"stage"`
		Count           int64   `json:"count"`
		AverageTime     float64 `json:"average_time_minutes"`
		ProgressionRate float64 `json:"progression_rate"`
	}
	
	h.service.db.Raw(`
		SELECT 
			current_stage as stage,
			COUNT(*) as count,
			AVG(EXTRACT(EPOCH FROM (last_activity_at - started_at))) / 60 as average_time_minutes,
			AVG(progress) as progression_rate
		FROM customer_journeys 
		WHERE created_at >= ?
		GROUP BY current_stage
		ORDER BY count DESC
	`, timeFilter).Scan(&stageStats)
	
	// Get channel performance
	var channelStats []struct {
		Channel        string  `json:"channel"`
		Count          int64   `json:"count"`
		CompletionRate float64 `json:"completion_rate"`
		AverageProgress float64 `json:"average_progress"`
	}
	
	h.service.db.Raw(`
		SELECT 
			channel,
			COUNT(*) as count,
			AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) * 100 as completion_rate,
			AVG(progress) as average_progress
		FROM customer_journeys 
		WHERE created_at >= ? AND channel != ''
		GROUP BY channel
		ORDER BY count DESC
	`, timeFilter).Scan(&channelStats)
	
	dashboard := map[string]interface{}{
		"overview":           stats,
		"journey_types":      journeyTypeStats,
		"segments":          segmentStats,
		"stages":            stageStats,
		"channels":          channelStats,
		"time_range":        timeRange,
		"filters": map[string]interface{}{
			"journey_type": journeyType,
			"segment":     segment,
		},
		"timestamp": time.Now(),
	}
	
	c.JSON(http.StatusOK, gin.H{
		"dashboard": dashboard,
	})
}

// Bulk journey operations
func (h *JourneyHandler) BulkUpdateJourneys(c *gin.Context) {
	var req struct {
		JourneyIDs []string `json:"journey_ids" binding:"required"`
		Updates    struct {
			Status string `json:"status,omitempty"`
			Stage  string `json:"stage,omitempty"`
		} `json:"updates" binding:"required"`
		Reason string `json:"reason"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if len(req.JourneyIDs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 100 journeys allowed per bulk operation"})
		return
	}
	
	// Parse journey IDs
	journeyIDs := make([]uuid.UUID, 0, len(req.JourneyIDs))
	for _, idStr := range req.JourneyIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid journey ID: %s", idStr)})
			return
		}
		journeyIDs = append(journeyIDs, id)
	}
	
	// Get journeys
	var journeys []CustomerJourney
	if err := h.service.db.Where("id IN ?", journeyIDs).Find(&journeys).Error; err != nil {
		h.logger.WithError(err).Error("Failed to get journeys for bulk update")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve journeys"})
		return
	}
	
	if len(journeys) != len(journeyIDs) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Some journey IDs not found"})
		return
	}
	
	// Update journeys
	updatedCount := 0
	results := make(map[string]interface{})
	
	for _, journey := range journeys {
		originalStatus := journey.Status
		originalStage := journey.CurrentStage
		
		if req.Updates.Status != "" && req.Updates.Status != journey.Status {
			journey.Status = req.Updates.Status
		}
		
		if req.Updates.Stage != "" && req.Updates.Stage != journey.CurrentStage {
			journey.PreviousStage = journey.CurrentStage
			journey.CurrentStage = req.Updates.Stage
			journey.Progress = h.journeyEngine.calculateProgress(&journey)
		}
		
		journey.LastActivityAt = time.Now()
		journey.UpdatedAt = time.Now()
		
		// Add bulk update touchpoint
		touchpoint := TouchpointEvent{
			ID:        uuid.New(),
			Type:      "bulk_update",
			Channel:   "admin",
			Action:    "bulk_update",
			Status:    "success",
			Metadata: map[string]interface{}{
				"original_status": originalStatus,
				"original_stage":  originalStage,
				"new_status":     journey.Status,
				"new_stage":      journey.CurrentStage,
				"reason":         req.Reason,
				"updated_by":     c.GetString("user_id"),
			},
			Timestamp: time.Now(),
		}
		
		journey.Touchpoints = append(journey.Touchpoints, touchpoint)
		journey.TotalTouchpoints++
		
		if err := h.service.db.Save(&journey).Error; err != nil {
			h.logger.WithError(err).WithField("journey_id", journey.ID).Error("Failed to update journey in bulk operation")
			results[journey.ID.String()] = map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}
		} else {
			updatedCount++
			results[journey.ID.String()] = map[string]interface{}{
				"success":        true,
				"original_status": originalStatus,
				"original_stage":  originalStage,
				"new_status":     journey.Status,
				"new_stage":      journey.CurrentStage,
			}
		}
	}
	
	h.logger.WithFields(logrus.Fields{
		"total_requested": len(req.JourneyIDs),
		"updated_count":   updatedCount,
		"updated_by":      c.GetString("user_id"),
	}).Info("Bulk journey update completed")
	
	c.JSON(http.StatusOK, gin.H{
		"total_requested": len(req.JourneyIDs),
		"updated_count":   updatedCount,
		"failed_count":    len(req.JourneyIDs) - updatedCount,
		"results":         results,
		"timestamp":       time.Now(),
	})
}

// Helper functions
func (h *JourneyHandler) isValidJourneyType(journeyType string) bool {
	validTypes := []string{"onboarding", "transaction", "support", "engagement", "retention"}
	for _, validType := range validTypes {
		if journeyType == validType {
			return true
		}
	}
	return false
}

func (h *JourneyHandler) getActiveJourney(customerID uuid.UUID, journeyType string) (*CustomerJourney, error) {
	var journey CustomerJourney
	err := h.service.db.Where("customer_id = ? AND journey_type = ? AND status = 'active'", customerID, journeyType).First(&journey).Error
	if err != nil {
		return nil, err
	}
	return &journey, nil
}

func (h *JourneyHandler) getJourney(journeyID uuid.UUID) (*CustomerJourney, error) {
	var journey CustomerJourney
	err := h.service.db.Where("id = ?", journeyID).First(&journey).Error
	if err != nil {
		return nil, err
	}
	return &journey, nil
}

func (h *JourneyHandler) calculateJourneyAnalytics(journey *CustomerJourney) map[string]interface{} {
	analytics := map[string]interface{}{
		"journey_id":           journey.ID,
		"customer_id":          journey.CustomerID,
		"journey_type":         journey.JourneyType,
		"current_stage":        journey.CurrentStage,
		"progress":            journey.Progress,
		"status":              journey.Status,
		"completion_probability": journey.CompletionProbability,
		"churn_probability":    journey.ChurnProbability,
		"next_best_action":     journey.NextBestAction,
		"predicted_outcome":    journey.PredictedOutcome,
		
		// Metrics
		"total_touchpoints":    journey.TotalTouchpoints,
		"completed_actions":    journey.CompletedActions,
		"failed_actions":       journey.FailedActions,
		"success_rate":        h.calculateSuccessRate(journey),
		"average_response_time": journey.AverageResponseTime,
		"satisfaction_score":   journey.SatisfactionScore,
		
		// Time metrics
		"duration":            h.calculateJourneyDuration(journey),
		"time_in_current_stage": h.calculateTimeInCurrentStage(journey),
		"started_at":          journey.StartedAt,
		"last_activity_at":    journey.LastActivityAt,
		"completed_at":        journey.CompletedAt,
		
		// Channel analysis
		"channel_distribution": h.calculateChannelDistribution(journey),
		"most_used_channel":   h.getMostUsedChannel(journey),
		
		// Stage analysis
		"stage_history":       h.getStageHistory(journey),
		"stage_durations":     h.calculateStageDurations(journey),
	}
	
	return analytics
}

func (h *JourneyHandler) calculateDetailedJourneyAnalytics(journey *CustomerJourney) map[string]interface{} {
	basic := h.calculateJourneyAnalytics(journey)
	
	// Add detailed analytics
	detailed := map[string]interface{}{
		"basic":              basic,
		"touchpoint_analysis": h.analyzeTouchpoints(journey),
		"action_analysis":    h.analyzeActions(journey),
		"performance_metrics": h.calculatePerformanceMetrics(journey),
		"predictive_insights": h.generatePredictiveInsights(journey),
		"recommendations":    h.generateJourneyRecommendations(journey),
	}
	
	return detailed
}

func (h *JourneyHandler) calculateCustomerJourneySummary(customerID uuid.UUID) map[string]interface{} {
	var summary struct {
		TotalJourneys     int64   `json:"total_journeys"`
		ActiveJourneys    int64   `json:"active_journeys"`
		CompletedJourneys int64   `json:"completed_journeys"`
		AbandonedJourneys int64   `json:"abandoned_journeys"`
		AverageProgress   float64 `json:"average_progress"`
		CompletionRate    float64 `json:"completion_rate"`
		AverageDuration   float64 `json:"average_duration_hours"`
	}
	
	// Get counts
	h.service.db.Model(&CustomerJourney{}).Where("customer_id = ?", customerID).Count(&summary.TotalJourneys)
	h.service.db.Model(&CustomerJourney{}).Where("customer_id = ? AND status = 'active'", customerID).Count(&summary.ActiveJourneys)
	h.service.db.Model(&CustomerJourney{}).Where("customer_id = ? AND status = 'completed'", customerID).Count(&summary.CompletedJourneys)
	h.service.db.Model(&CustomerJourney{}).Where("customer_id = ? AND status = 'abandoned'", customerID).Count(&summary.AbandonedJourneys)
	
	// Calculate rates
	if summary.TotalJourneys > 0 {
		h.service.db.Model(&CustomerJourney{}).Where("customer_id = ?", customerID).Select("AVG(progress)").Scan(&summary.AverageProgress)
		summary.CompletionRate = float64(summary.CompletedJourneys) / float64(summary.TotalJourneys) * 100
		
		// Calculate average duration for completed journeys
		h.service.db.Raw(`
			SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) / 3600 
			FROM customer_journeys 
			WHERE customer_id = ? AND status = 'completed' AND completed_at IS NOT NULL
		`, customerID).Scan(&summary.AverageDuration)
	}
	
	// Get journey type breakdown
	var journeyTypes []struct {
		JourneyType string `json:"journey_type"`
		Count       int64  `json:"count"`
	}
	
	h.service.db.Model(&CustomerJourney{}).
		Select("journey_type, COUNT(*) as count").
		Where("customer_id = ?", customerID).
		Group("journey_type").
		Scan(&journeyTypes)
	
	return map[string]interface{}{
		"overview":      summary,
		"journey_types": journeyTypes,
	}
}

// Helper calculation functions
func (h *JourneyHandler) calculateSuccessRate(journey *CustomerJourney) float64 {
	if journey.TotalTouchpoints == 0 {
		return 0.0
	}
	return float64(journey.CompletedActions) / float64(journey.TotalTouchpoints) * 100
}

func (h *JourneyHandler) calculateJourneyDuration(journey *CustomerJourney) float64 {
	endTime := time.Now()
	if journey.CompletedAt != nil {
		endTime = *journey.CompletedAt
	}
	return endTime.Sub(journey.StartedAt).Hours()
}

func (h *JourneyHandler) calculateTimeInCurrentStage(journey *CustomerJourney) float64 {
	// Find when current stage started
	stageStartTime := journey.StartedAt
	for _, touchpoint := range journey.Touchpoints {
		if touchpoint.Type == "stage_change" || touchpoint.Type == "manual_stage_change" {
			if metadata, ok := touchpoint.Metadata["new_stage"].(string); ok && metadata == journey.CurrentStage {
				stageStartTime = touchpoint.Timestamp
			}
		}
	}
	
	return time.Since(stageStartTime).Hours()
}

func (h *JourneyHandler) calculateChannelDistribution(journey *CustomerJourney) map[string]int {
	distribution := make(map[string]int)
	for _, touchpoint := range journey.Touchpoints {
		if touchpoint.Channel != "" {
			distribution[touchpoint.Channel]++
		}
	}
	return distribution
}

func (h *JourneyHandler) getMostUsedChannel(journey *CustomerJourney) string {
	distribution := h.calculateChannelDistribution(journey)
	maxChannel := ""
	maxCount := 0
	
	for channel, count := range distribution {
		if count > maxCount {
			maxCount = count
			maxChannel = channel
		}
	}
	
	return maxChannel
}

func (h *JourneyHandler) getStageHistory(journey *CustomerJourney) []map[string]interface{} {
	history := []map[string]interface{}{}
	
	// Add initial stage
	history = append(history, map[string]interface{}{
		"stage":      h.journeyEngine.getInitialStage(journey.JourneyType),
		"started_at": journey.StartedAt,
		"duration":   0,
	})
	
	// Add stage changes from touchpoints
	for _, touchpoint := range journey.Touchpoints {
		if touchpoint.Type == "stage_change" || touchpoint.Type == "manual_stage_change" {
			if newStage, ok := touchpoint.Metadata["new_stage"].(string); ok {
				history = append(history, map[string]interface{}{
					"stage":      newStage,
					"started_at": touchpoint.Timestamp,
					"duration":   0, // Will be calculated
				})
			}
		}
	}
	
	// Calculate durations
	for i := 0; i < len(history)-1; i++ {
		startTime := history[i]["started_at"].(time.Time)
		endTime := history[i+1]["started_at"].(time.Time)
		history[i]["duration"] = endTime.Sub(startTime).Hours()
	}
	
	// Calculate duration for current stage
	if len(history) > 0 {
		lastIndex := len(history) - 1
		startTime := history[lastIndex]["started_at"].(time.Time)
		endTime := time.Now()
		if journey.CompletedAt != nil {
			endTime = *journey.CompletedAt
		}
		history[lastIndex]["duration"] = endTime.Sub(startTime).Hours()
	}
	
	return history
}

func (h *JourneyHandler) calculateStageDurations(journey *CustomerJourney) map[string]float64 {
	durations := make(map[string]float64)
	stageHistory := h.getStageHistory(journey)
	
	for _, stage := range stageHistory {
		stageName := stage["stage"].(string)
		duration := stage["duration"].(float64)
		durations[stageName] = duration
	}
	
	return durations
}

func (h *JourneyHandler) analyzeTouchpoints(journey *CustomerJourney) map[string]interface{} {
	analysis := map[string]interface{}{
		"total_touchpoints": len(journey.Touchpoints),
		"touchpoint_types":  make(map[string]int),
		"channel_usage":     make(map[string]int),
		"action_frequency":  make(map[string]int),
		"status_distribution": make(map[string]int),
		"hourly_distribution": make(map[int]int),
		"response_times":    []float64{},
	}
	
	for _, tp := range journey.Touchpoints {
		// Type distribution
		if types, ok := analysis["touchpoint_types"].(map[string]int); ok {
			types[tp.Type]++
		}
		
		// Channel usage
		if channels, ok := analysis["channel_usage"].(map[string]int); ok {
			channels[tp.Channel]++
		}
		
		// Action frequency
		if actions, ok := analysis["action_frequency"].(map[string]int); ok {
			actions[tp.Action]++
		}
		
		// Status distribution
		if statuses, ok := analysis["status_distribution"].(map[string]int); ok {
			statuses[tp.Status]++
		}
		
		// Hourly distribution
		if hourly, ok := analysis["hourly_distribution"].(map[int]int); ok {
			hour := tp.Timestamp.Hour()
			hourly[hour]++
		}
		
		// Response times
		if tp.ResponseTime > 0 {
			if times, ok := analysis["response_times"].([]float64); ok {
				analysis["response_times"] = append(times, float64(tp.ResponseTime))
			}
		}
	}
	
	return analysis
}

func (h *JourneyHandler) analyzeActions(journey *CustomerJourney) map[string]interface{} {
	analysis := map[string]interface{}{
		"total_actions":     len(journey.Actions),
		"action_types":      make(map[string]int),
		"status_distribution": make(map[string]int),
		"priority_distribution": make(map[string]int),
		"success_rate":      0.0,
		"average_execution_time": 0.0,
	}
	
	totalExecutionTime := int64(0)
	successCount := 0
	
	for _, action := range journey.Actions {
		// Action types
		if types, ok := analysis["action_types"].(map[string]int); ok {
			types[action.ActionType]++
		}
		
		// Status distribution
		if statuses, ok := analysis["status_distribution"].(map[string]int); ok {
			statuses[action.Status]++
		}
		
		// Priority distribution
		if priorities, ok := analysis["priority_distribution"].(map[string]int); ok {
			priority := fmt.Sprintf("priority_%d", action.Priority)
			priorities[priority]++
		}
		
		// Success tracking
		if action.Success {
			successCount++
		}
		
		// Execution time
		if action.ExecutionTime > 0 {
			totalExecutionTime += action.ExecutionTime
		}
	}
	
	// Calculate rates
	if len(journey.Actions) > 0 {
		analysis["success_rate"] = float64(successCount) / float64(len(journey.Actions)) * 100
		if totalExecutionTime > 0 {
			analysis["average_execution_time"] = float64(totalExecutionTime) / float64(len(journey.Actions))
		}
	}
	
	return analysis
}

func (h *JourneyHandler) calculatePerformanceMetrics(journey *CustomerJourney) map[string]interface{} {
	return map[string]interface{}{
		"efficiency_score":    h.calculateEfficiencyScore(journey),
		"engagement_score":    journey.EngagementScore,
		"satisfaction_score":  journey.SatisfactionScore,
		"completion_velocity": h.calculateCompletionVelocity(journey),
		"error_rate":         h.calculateErrorRate(journey),
		"abandonment_risk":   h.calculateAbandonmentRisk(journey),
	}
}

func (h *JourneyHandler) calculateEfficiencyScore(journey *CustomerJourney) float64 {
	if journey.TotalTouchpoints == 0 {
		return 0.0
	}
	
	// Base efficiency on success rate and progress
	successRate := float64(journey.CompletedActions) / float64(journey.TotalTouchpoints)
	progressFactor := journey.Progress / 100.0
	
	return (successRate + progressFactor) / 2.0 * 100
}

func (h *JourneyHandler) calculateCompletionVelocity(journey *CustomerJourney) float64 {
	duration := h.calculateJourneyDuration(journey)
	if duration == 0 {
		return 0.0
	}
	
	return journey.Progress / duration // Progress per hour
}

func (h *JourneyHandler) calculateErrorRate(journey *CustomerJourney) float64 {
	if journey.TotalTouchpoints == 0 {
		return 0.0
	}
	
	return float64(journey.FailedActions) / float64(journey.TotalTouchpoints) * 100
}

func (h *JourneyHandler) calculateAbandonmentRisk(journey *CustomerJourney) float64 {
	// Base risk on churn probability and activity
	baseRisk := journey.ChurnProbability
	
	// Increase risk based on inactivity
	hoursSinceLastActivity := time.Since(journey.LastActivityAt).Hours()
	if hoursSinceLastActivity > 24 {
		baseRisk += 0.2
	}
	if hoursSinceLastActivity > 72 {
		baseRisk += 0.3
	}
	
	// Adjust based on error rate
	errorRate := h.calculateErrorRate(journey)
	if errorRate > 20 {
		baseRisk += 0.2
	}
	
	// Cap at 1.0
	if baseRisk > 1.0 {
		baseRisk = 1.0
	}
	
	return baseRisk
}

func (h *JourneyHandler) generatePredictiveInsights(journey *CustomerJourney) map[string]interface{} {
	return map[string]interface{}{
		"completion_probability": journey.CompletionProbability,
		"predicted_outcome":     journey.PredictedOutcome,
		"estimated_completion_time": h.estimateCompletionTime(journey),
		"risk_factors":          h.identifyRiskFactors(journey),
		"success_factors":       h.identifySuccessFactors(journey),
		"next_likely_actions":   h.predictNextActions(journey),
	}
}

func (h *JourneyHandler) estimateCompletionTime(journey *CustomerJourney) float64 {
	if journey.Progress >= 100 {
		return 0.0
	}
	
	// Use current velocity to estimate remaining time
	velocity := h.calculateCompletionVelocity(journey)
	if velocity <= 0 {
		return -1 // Cannot estimate
	}
	
	remainingProgress := 100.0 - journey.Progress
	return remainingProgress / velocity
}

func (h *JourneyHandler) identifyRiskFactors(journey *CustomerJourney) []string {
	factors := []string{}
	
	if journey.ChurnProbability > 0.6 {
		factors = append(factors, "high_churn_risk")
	}
	
	if h.calculateErrorRate(journey) > 15 {
		factors = append(factors, "high_error_rate")
	}
	
	if time.Since(journey.LastActivityAt).Hours() > 48 {
		factors = append(factors, "prolonged_inactivity")
	}
	
	if journey.Progress < 20 && h.calculateJourneyDuration(journey) > 24 {
		factors = append(factors, "slow_progress")
	}
	
	if journey.CustomerSegment == "At Risk" || journey.CustomerSegment == "Lost" {
		factors = append(factors, "at_risk_segment")
	}
	
	return factors
}

func (h *JourneyHandler) identifySuccessFactors(journey *CustomerJourney) []string {
	factors := []string{}
	
	if h.calculateSuccessRate(journey) > 80 {
		factors = append(factors, "high_success_rate")
	}
	
	if journey.Progress > 75 {
		factors = append(factors, "near_completion")
	}
	
	if journey.CustomerSegment == "Premium" || journey.CustomerSegment == "Active" {
		factors = append(factors, "positive_segment")
	}
	
	if journey.EngagementScore > 0.7 {
		factors = append(factors, "high_engagement")
	}
	
	if h.calculateCompletionVelocity(journey) > 10 {
		factors = append(factors, "fast_progress")
	}
	
	return factors
}

func (h *JourneyHandler) predictNextActions(journey *CustomerJourney) []string {
	actions := []string{}
	
	// Based on current stage and journey type
	if template, exists := JourneyTemplates[journey.JourneyType]; exists {
		for _, stage := range template {
			if stage.Name == journey.CurrentStage {
				for _, expectedAction := range stage.ExpectedActions {
					if !h.journeyEngine.hasCompletedAction(journey, expectedAction) {
						actions = append(actions, expectedAction)
					}
				}
				break
			}
		}
	}
	
	// Add up to 3 most likely actions
	if len(actions) > 3 {
		actions = actions[:3]
	}
	
	return actions
}

func (h *JourneyHandler) generateJourneyRecommendations(journey *CustomerJourney) []string {
	recommendations := []string{}
	
	// Based on risk factors
	riskFactors := h.identifyRiskFactors(journey)
	for _, factor := range riskFactors {
		switch factor {
		case "high_churn_risk":
			recommendations = append(recommendations, "Implement retention campaign")
		case "high_error_rate":
			recommendations = append(recommendations, "Provide additional support")
		case "prolonged_inactivity":
			recommendations = append(recommendations, "Send re-engagement notification")
		case "slow_progress":
			recommendations = append(recommendations, "Offer guided assistance")
		case "at_risk_segment":
			recommendations = append(recommendations, "Apply segment-specific interventions")
		}
	}
	
	// Based on journey stage and progress
	if journey.Progress < 25 && h.calculateJourneyDuration(journey) > 2 {
		recommendations = append(recommendations, "Consider onboarding optimization")
	}
	
	if journey.Progress > 75 && journey.Status == "active" {
		recommendations = append(recommendations, "Focus on completion assistance")
	}
	
	return recommendations
}

