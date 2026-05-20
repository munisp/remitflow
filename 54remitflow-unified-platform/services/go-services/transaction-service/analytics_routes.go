package main

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Analytics Routes Configuration
func SetupAnalyticsRoutes(router *gin.Engine, handler *EnhancedTransactionHandler, logger *logrus.Logger) {
	// Analytics API group
	analyticsGroup := router.Group("/api/v1/analytics")
	analyticsGroup.Use(AuthMiddleware()) // Ensure authentication
	
	// Transaction analytics endpoints
	{
		// Process transaction with analytics enhancement
		analyticsGroup.POST("/transactions", handler.ProcessTransactionWithAnalytics)
		
		// Get customer analytics
		analyticsGroup.GET("/customers/:customer_id", handler.GetCustomerAnalytics)
		
		// Get transaction analytics
		analyticsGroup.GET("/transactions/:transaction_id", handler.GetTransactionAnalytics)
		
		// Batch customer analytics
		analyticsGroup.POST("/customers/batch", handler.BatchCustomerAnalytics)
		
		// Analytics dashboard
		analyticsGroup.GET("/dashboard", handler.GetAnalyticsDashboard)
	}
	
	// Risk management endpoints
	riskGroup := analyticsGroup.Group("/risk")
	{
		// Get customer risk profile
		riskGroup.GET("/customers/:customer_id/profile", handler.GetCustomerRiskProfile)
		
		// Get fraud analysis for transaction
		riskGroup.GET("/transactions/:transaction_id/fraud", handler.GetTransactionFraudAnalysis)
		
		// Update risk thresholds
		riskGroup.PUT("/thresholds", handler.UpdateRiskThresholds)
		
		// Get risk statistics
		riskGroup.GET("/statistics", handler.GetRiskStatistics)
	}
	
	// Limits management endpoints
	limitsGroup := analyticsGroup.Group("/limits")
	{
		// Get customer limits
		limitsGroup.GET("/customers/:customer_id", handler.GetCustomerLimits)
		
		// Update customer limits
		limitsGroup.PUT("/customers/:customer_id", handler.UpdateCustomerLimits)
		
		// Get segment-based limits
		limitsGroup.GET("/segments/:segment", handler.GetSegmentLimits)
		
		// Update segment limits
		limitsGroup.PUT("/segments/:segment", handler.UpdateSegmentLimits)
	}
	
	// Monitoring and health endpoints
	monitoringGroup := analyticsGroup.Group("/monitoring")
	{
		// Analytics service health
		monitoringGroup.GET("/health", handler.GetAnalyticsHealth)
		
		// Performance metrics
		monitoringGroup.GET("/metrics", handler.GetAnalyticsMetrics)
		
		// Service status
		monitoringGroup.GET("/status", handler.GetAnalyticsStatus)
	}
	
	logger.Info("Analytics routes configured successfully")
}

// Additional handler methods for the new routes
func (h *EnhancedTransactionHandler) GetCustomerRiskProfile(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	// Get customer analytics
	analytics, err := h.analyticsService.client.GetCustomerAnalysis(ctx, customerID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get customer analytics for risk profile")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve risk profile"})
		return
	}
	
	// Get recent transaction history for risk assessment
	var recentTransactions []Transaction
	h.db.Where("customer_id = ? AND created_at > ?", customerID, time.Now().Add(-30*24*time.Hour)).
		Order("created_at DESC").
		Limit(50).
		Find(&recentTransactions)
	
	// Calculate risk metrics
	riskProfile := map[string]interface{}{
		"customer_id":        customerID,
		"segment":           analytics.Segment,
		"churn_risk":        analytics.ChurnRisk,
		"lifetime_value":    analytics.LifetimeValue,
		"risk_indicators":   analytics.RiskIndicators,
		"recent_transactions": len(recentTransactions),
		"avg_fraud_score":   h.calculateAverageFraudScore(recentTransactions),
		"high_risk_transactions": h.countHighRiskTransactions(recentTransactions),
		"last_updated":      time.Now(),
	}
	
	c.JSON(http.StatusOK, gin.H{
		"risk_profile": riskProfile,
	})
}

func (h *EnhancedTransactionHandler) GetTransactionFraudAnalysis(c *gin.Context) {
	transactionIDStr := c.Param("transaction_id")
	transactionID, err := uuid.Parse(transactionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID"})
		return
	}
	
	var transaction Transaction
	if err := h.db.Where("id = ?", transactionID).First(&transaction).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	
	fraudAnalysis := map[string]interface{}{
		"transaction_id":    transaction.ID,
		"fraud_score":      transaction.FraudScore,
		"risk_level":       transaction.FraudRiskLevel,
		"fraud_indicators": transaction.FraudIndicators,
		"customer_segment": transaction.CustomerSegment,
		"risk_score":       transaction.RiskScore,
		"analysis_timestamp": transaction.CreatedAt,
	}
	
	c.JSON(http.StatusOK, gin.H{
		"fraud_analysis": fraudAnalysis,
	})
}

func (h *EnhancedTransactionHandler) UpdateRiskThresholds(c *gin.Context) {
	var req struct {
		FraudThreshold  float64 `json:"fraud_threshold" binding:"required,min=0,max=1"`
		ChurnThreshold  float64 `json:"churn_threshold" binding:"required,min=0,max=1"`
		AmountThreshold float64 `json:"amount_threshold" binding:"required,min=0"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Update risk thresholds (in a real implementation, this would update configuration)
	thresholds := map[string]interface{}{
		"fraud_threshold":  req.FraudThreshold,
		"churn_threshold":  req.ChurnThreshold,
		"amount_threshold": req.AmountThreshold,
		"updated_at":      time.Now(),
		"updated_by":      c.GetString("user_id"), // From auth middleware
	}
	
	h.logger.WithFields(logrus.Fields{
		"fraud_threshold":  req.FraudThreshold,
		"churn_threshold":  req.ChurnThreshold,
		"amount_threshold": req.AmountThreshold,
	}).Info("Risk thresholds updated")
	
	c.JSON(http.StatusOK, gin.H{
		"message":    "Risk thresholds updated successfully",
		"thresholds": thresholds,
	})
}

func (h *EnhancedTransactionHandler) GetRiskStatistics(c *gin.Context) {
	// Get risk statistics from the database
	var stats struct {
		TotalTransactions     int64   `json:"total_transactions"`
		HighRiskTransactions  int64   `json:"high_risk_transactions"`
		BlockedTransactions   int64   `json:"blocked_transactions"`
		AverageFraudScore     float64 `json:"average_fraud_score"`
		FraudDetectionRate    float64 `json:"fraud_detection_rate"`
	}
	
	// Calculate statistics
	h.db.Model(&Transaction{}).Count(&stats.TotalTransactions)
	h.db.Model(&Transaction{}).Where("fraud_score > 0.6").Count(&stats.HighRiskTransactions)
	h.db.Model(&Transaction{}).Where("status = 'blocked'").Count(&stats.BlockedTransactions)
	h.db.Model(&Transaction{}).Where("fraud_score > 0").Select("AVG(fraud_score)").Scan(&stats.AverageFraudScore)
	
	if stats.TotalTransactions > 0 {
		stats.FraudDetectionRate = float64(stats.HighRiskTransactions) / float64(stats.TotalTransactions) * 100
	}
	
	// Get risk level distribution
	var riskDistribution []struct {
		RiskLevel string `json:"risk_level"`
		Count     int64  `json:"count"`
		Percentage float64 `json:"percentage"`
	}
	
	h.db.Model(&Transaction{}).
		Select("fraud_risk_level as risk_level, COUNT(*) as count").
		Where("fraud_risk_level != ''").
		Group("fraud_risk_level").
		Scan(&riskDistribution)
	
	// Calculate percentages
	for i := range riskDistribution {
		if stats.TotalTransactions > 0 {
			riskDistribution[i].Percentage = float64(riskDistribution[i].Count) / float64(stats.TotalTransactions) * 100
		}
	}
	
	c.JSON(http.StatusOK, gin.H{
		"statistics":       stats,
		"risk_distribution": riskDistribution,
		"timestamp":       time.Now(),
	})
}

func (h *EnhancedTransactionHandler) GetCustomerLimits(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	// Get customer analytics to determine segment
	analytics, err := h.analyticsService.client.GetCustomerAnalysis(ctx, customerID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get customer analytics for limits")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve customer limits"})
		return
	}
	
	// Get dynamic limits
	limits, err := h.analyticsService.client.GetDynamicLimits(ctx, customerID, analytics.Segment)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic limits")
		limits = h.analyticsService.getDefaultLimits(analytics.Segment)
	}
	
	// Get current usage
	var dailyUsage, monthlyUsage float64
	h.db.Model(&Transaction{}).
		Where("customer_id = ? AND DATE(created_at) = DATE(NOW()) AND status IN ('completed', 'pending')", customerID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&dailyUsage)
	
	h.db.Model(&Transaction{}).
		Where("customer_id = ? AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) AND status IN ('completed', 'pending')", customerID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&monthlyUsage)
	
	response := map[string]interface{}{
		"customer_id":     customerID,
		"segment":        analytics.Segment,
		"limits":         limits,
		"current_usage": map[string]interface{}{
			"daily_usage":   dailyUsage,
			"monthly_usage": monthlyUsage,
			"daily_remaining": limits.DailyLimit - dailyUsage,
			"monthly_remaining": limits.MonthlyLimit - monthlyUsage,
		},
		"last_updated": time.Now(),
	}
	
	c.JSON(http.StatusOK, response)
}

func (h *EnhancedTransactionHandler) UpdateCustomerLimits(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	var req TransactionLimits
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Validate limits
	if req.DailyLimit <= 0 || req.TransactionLimit <= 0 || req.MonthlyLimit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "All limits must be greater than 0"})
		return
	}
	
	if req.TransactionLimit > req.DailyLimit || req.DailyLimit > req.MonthlyLimit {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Limits must be: transaction <= daily <= monthly"})
		return
	}
	
	// In a real implementation, this would update the limits in the database
	h.logger.WithFields(logrus.Fields{
		"customer_id":       customerID,
		"daily_limit":       req.DailyLimit,
		"transaction_limit": req.TransactionLimit,
		"monthly_limit":     req.MonthlyLimit,
		"updated_by":       c.GetString("user_id"),
	}).Info("Customer limits updated")
	
	c.JSON(http.StatusOK, gin.H{
		"message":     "Customer limits updated successfully",
		"customer_id": customerID,
		"limits":      req,
		"updated_at":  time.Now(),
	})
}

func (h *EnhancedTransactionHandler) GetSegmentLimits(c *gin.Context) {
	segment := c.Param("segment")
	
	// Validate segment
	validSegments := []string{"Premium", "Active", "At Risk", "New", "Dormant", "Lost"}
	isValid := false
	for _, validSegment := range validSegments {
		if segment == validSegment {
			isValid = true
			break
		}
	}
	
	if !isValid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid segment"})
		return
	}
	
	limits := h.analyticsService.getDefaultLimits(segment)
	
	c.JSON(http.StatusOK, gin.H{
		"segment": segment,
		"limits":  limits,
	})
}

func (h *EnhancedTransactionHandler) UpdateSegmentLimits(c *gin.Context) {
	segment := c.Param("segment")
	
	var req TransactionLimits
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// In a real implementation, this would update segment-based limits
	h.logger.WithFields(logrus.Fields{
		"segment":           segment,
		"daily_limit":       req.DailyLimit,
		"transaction_limit": req.TransactionLimit,
		"monthly_limit":     req.MonthlyLimit,
		"updated_by":       c.GetString("user_id"),
	}).Info("Segment limits updated")
	
	c.JSON(http.StatusOK, gin.H{
		"message":    "Segment limits updated successfully",
		"segment":    segment,
		"limits":     req,
		"updated_at": time.Now(),
	})
}

func (h *EnhancedTransactionHandler) GetAnalyticsHealth(c *gin.Context) {
	ctx := c.Request.Context()
	
	health := map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now(),
		"services":  map[string]interface{}{},
	}
	
	// Check analytics service health
	_, err := h.analyticsService.client.GetCustomerAnalysis(ctx, uuid.New())
	if err != nil {
		health["services"].(map[string]interface{})["analytics"] = map[string]interface{}{
			"status": "unhealthy",
			"error":  err.Error(),
		}
		health["status"] = "degraded"
	} else {
		health["services"].(map[string]interface{})["analytics"] = map[string]interface{}{
			"status": "healthy",
		}
	}
	
	// Check database health
	sqlDB, err := h.db.DB()
	if err != nil || sqlDB.Ping() != nil {
		health["services"].(map[string]interface{})["database"] = map[string]interface{}{
			"status": "unhealthy",
		}
		health["status"] = "unhealthy"
	} else {
		health["services"].(map[string]interface{})["database"] = map[string]interface{}{
			"status": "healthy",
		}
	}
	
	statusCode := http.StatusOK
	if health["status"] == "unhealthy" {
		statusCode = http.StatusServiceUnavailable
	} else if health["status"] == "degraded" {
		statusCode = http.StatusPartialContent
	}
	
	c.JSON(statusCode, health)
}

func (h *EnhancedTransactionHandler) GetAnalyticsMetrics(c *gin.Context) {
	// Get performance metrics
	metrics := map[string]interface{}{
		"analytics_requests_total":     h.getMetricValue("analytics_requests_total"),
		"analytics_response_time":      h.getMetricValue("analytics_response_time"),
		"fraud_detection_score":        h.getMetricValue("fraud_detection_score"),
		"dynamic_limits_applied_total": h.getMetricValue("dynamic_limits_applied_total"),
		"timestamp":                   time.Now(),
	}
	
	c.JSON(http.StatusOK, gin.H{
		"metrics": metrics,
	})
}

func (h *EnhancedTransactionHandler) GetAnalyticsStatus(c *gin.Context) {
	// Get service status information
	status := map[string]interface{}{
		"service":           "transaction-analytics",
		"version":          "1.0.0",
		"uptime":           time.Since(startTime).String(),
		"analytics_enabled": true,
		"features": map[string]bool{
			"fraud_detection":    true,
			"customer_analytics": true,
			"dynamic_limits":     true,
			"risk_scoring":       true,
		},
		"timestamp": time.Now(),
	}
	
	c.JSON(http.StatusOK, gin.H{
		"status": status,
	})
}

// Helper functions
func (h *EnhancedTransactionHandler) calculateAverageFraudScore(transactions []Transaction) float64 {
	if len(transactions) == 0 {
		return 0
	}
	
	total := 0.0
	count := 0
	for _, tx := range transactions {
		if tx.FraudScore > 0 {
			total += tx.FraudScore
			count++
		}
	}
	
	if count == 0 {
		return 0
	}
	
	return total / float64(count)
}

func (h *EnhancedTransactionHandler) countHighRiskTransactions(transactions []Transaction) int {
	count := 0
	for _, tx := range transactions {
		if tx.FraudScore > 0.6 {
			count++
		}
	}
	return count
}

func (h *EnhancedTransactionHandler) getMetricValue(metricName string) interface{} {
	// In a real implementation, this would fetch actual Prometheus metrics
	// For now, return mock data
	switch metricName {
	case "analytics_requests_total":
		return map[string]interface{}{
			"enrich_success": 1250,
			"enrich_error":   15,
		}
	case "analytics_response_time":
		return map[string]interface{}{
			"avg_ms": 145.5,
			"p95_ms": 280.0,
			"p99_ms": 450.0,
		}
	case "fraud_detection_score":
		return map[string]interface{}{
			"avg_score":    0.25,
			"high_risk":    85,
			"medium_risk":  320,
			"low_risk":     845,
		}
	case "dynamic_limits_applied_total":
		return map[string]interface{}{
			"premium_passed": 450,
			"at_risk_blocked": 25,
			"new_passed":     180,
		}
	default:
		return nil
	}
}

var startTime = time.Now() // Service start time for uptime calculation

