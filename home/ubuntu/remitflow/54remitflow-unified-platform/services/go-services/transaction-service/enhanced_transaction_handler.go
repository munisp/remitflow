package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// Enhanced Transaction Handler with Analytics Integration
type EnhancedTransactionHandler struct {
	db                    *gorm.DB
	logger               *logrus.Logger
	analyticsService     *AnalyticsService
	fraudDetectionService *FraudDetectionService
	dynamicLimitManager  *DynamicLimitManager
	transactionService   *TransactionService
}

func NewEnhancedTransactionHandler(
	db *gorm.DB,
	logger *logrus.Logger,
	analyticsService *AnalyticsService,
	fraudDetectionService *FraudDetectionService,
	dynamicLimitManager *DynamicLimitManager,
	transactionService *TransactionService,
) *EnhancedTransactionHandler {
	return &EnhancedTransactionHandler{
		db:                    db,
		logger:               logger,
		analyticsService:     analyticsService,
		fraudDetectionService: fraudDetectionService,
		dynamicLimitManager:  dynamicLimitManager,
		transactionService:   transactionService,
	}
}

// Enhanced transaction processing with analytics
func (h *EnhancedTransactionHandler) ProcessTransactionWithAnalytics(c *gin.Context) {
	start := time.Now()
	
	var req TransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Validate request
	if err := h.validateTransactionRequest(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	ctx := c.Request.Context()
	
	// Step 1: Enrich with analytics
	h.logger.WithField("customer_id", req.CustomerID).Info("Enriching transaction with analytics")
	
	enhanced, err := h.analyticsService.EnrichWithAnalytics(ctx, &req)
	if err != nil {
		h.logger.WithError(err).Error("Failed to enrich transaction with analytics")
		// Continue without analytics enrichment
		enhanced = &EnhancedTransactionRequest{
			TransactionRequest: req,
			AnalyticsApplied:   false,
		}
	}
	
	analyticsRequestsTotal.WithLabelValues("enrich", "success").Inc()
	
	// Step 2: Apply business rules based on analytics
	if enhanced.AnalyticsApplied {
		if err := h.analyticsService.ApplyBusinessRules(ctx, enhanced); err != nil {
			h.logger.WithError(err).Error("Transaction blocked by business rules")
			c.JSON(http.StatusForbidden, gin.H{
				"error":           "Transaction blocked",
				"reason":          err.Error(),
				"risk_score":      enhanced.RiskScore,
				"customer_segment": enhanced.CustomerSegment,
			})
			return
		}
	}
	
	// Step 3: Check dynamic limits
	if enhanced.AnalyticsApplied {
		if err := h.dynamicLimitManager.CheckLimits(ctx, enhanced); err != nil {
			h.logger.WithError(err).Error("Transaction exceeds dynamic limits")
			c.JSON(http.StatusForbidden, gin.H{
				"error":        "Transaction limit exceeded",
				"reason":       err.Error(),
				"daily_limit":  enhanced.DynamicLimits.DailyLimit,
				"monthly_limit": enhanced.DynamicLimits.MonthlyLimit,
				"transaction_limit": enhanced.DynamicLimits.TransactionLimit,
			})
			dynamicLimitsApplied.WithLabelValues(enhanced.CustomerSegment, "blocked").Inc()
			return
		}
		dynamicLimitsApplied.WithLabelValues(enhanced.CustomerSegment, "passed").Inc()
	}
	
	// Step 4: Fraud detection analysis
	fraudAnalysis, err := h.fraudDetectionService.AnalyzeFraud(ctx, enhanced)
	if err != nil {
		h.logger.WithError(err).Error("Failed to perform fraud analysis")
	} else {
		fraudDetectionScore.WithLabelValues(fraudAnalysis.RiskLevel).Observe(fraudAnalysis.FraudScore)
		
		// Apply fraud detection recommendations
		switch fraudAnalysis.Recommendation {
		case "BLOCK_TRANSACTION":
			c.JSON(http.StatusForbidden, gin.H{
				"error":            "Transaction blocked by fraud detection",
				"fraud_score":      fraudAnalysis.FraudScore,
				"risk_level":       fraudAnalysis.RiskLevel,
				"fraud_indicators": fraudAnalysis.FraudIndicators,
			})
			return
			
		case "REQUIRE_MANUAL_REVIEW":
			enhanced.Status = "pending_review"
			enhanced.RequiresManualReview = true
			
		case "REQUIRE_ADDITIONAL_AUTH":
			enhanced.RequiresAdditionalAuth = true
		}
	}
	
	// Step 5: Process the transaction
	transaction, err := h.processEnhancedTransaction(ctx, enhanced, fraudAnalysis)
	if err != nil {
		h.logger.WithError(err).Error("Failed to process enhanced transaction")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction processing failed"})
		return
	}
	
	// Step 6: Update customer behavior analytics (async)
	go h.analyticsService.UpdateCustomerBehavior(ctx, transaction)
	
	// Prepare response
	response := h.buildTransactionResponse(transaction, enhanced, fraudAnalysis)
	
	processingTime := time.Since(start)
	analyticsResponseTime.WithLabelValues("process_transaction").Observe(processingTime.Seconds())
	
	h.logger.WithFields(logrus.Fields{
		"transaction_id":   transaction.ID,
		"customer_id":      transaction.CustomerID,
		"amount":          transaction.Amount,
		"status":          transaction.Status,
		"processing_time": processingTime,
		"analytics_applied": enhanced.AnalyticsApplied,
		"fraud_score":     fraudAnalysis.FraudScore,
	}).Info("Enhanced transaction processed successfully")
	
	c.JSON(http.StatusCreated, response)
}

func (h *EnhancedTransactionHandler) processEnhancedTransaction(ctx context.Context, enhanced *EnhancedTransactionRequest, fraudAnalysis *FraudAnalysis) (*Transaction, error) {
	// Create transaction record
	transaction := &Transaction{
		ID:                    uuid.New(),
		CustomerID:           enhanced.CustomerID,
		Amount:               enhanced.Amount,
		Currency:             enhanced.Currency,
		TransactionType:      enhanced.TransactionType,
		Channel:              enhanced.Channel,
		Description:          enhanced.Description,
		Reference:            enhanced.Reference,
		Status:               enhanced.Status,
		Location:             enhanced.Location,
		RequiresAdditionalAuth: enhanced.RequiresAdditionalAuth,
		RequiresManualReview: enhanced.RequiresManualReview,
		Priority:             enhanced.Priority,
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
		
		// Analytics enrichment
		CustomerSegment:      enhanced.CustomerSegment,
		RiskScore:           enhanced.RiskScore,
		ChurnRisk:           enhanced.ChurnRisk,
		CLVCategory:         enhanced.CLVCategory,
		AnalyticsApplied:    enhanced.AnalyticsApplied,
		
		// Fraud analysis
		FraudScore:          fraudAnalysis.FraudScore,
		FraudRiskLevel:      fraudAnalysis.RiskLevel,
		FraudIndicators:     fraudAnalysis.FraudIndicators,
	}
	
	// Set default status if not set
	if transaction.Status == "" {
		transaction.Status = "pending"
	}
	
	// Handle different processing paths based on requirements
	switch {
	case enhanced.RequiresManualReview:
		transaction.Status = "pending_review"
		return h.createTransactionRecord(ctx, transaction)
		
	case enhanced.RequiresAdditionalAuth:
		transaction.Status = "pending_auth"
		return h.createTransactionRecord(ctx, transaction)
		
	case enhanced.RecommendedAction == "EXPEDITE":
		return h.processExpedited(ctx, transaction)
		
	default:
		return h.processStandard(ctx, transaction)
	}
}

func (h *EnhancedTransactionHandler) processExpedited(ctx context.Context, transaction *Transaction) (*Transaction, error) {
	h.logger.WithField("transaction_id", transaction.ID).Info("Processing expedited transaction")
	
	// Fast-track processing for premium customers
	transaction.Status = "processing"
	transaction.Priority = "high"
	
	if err := h.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create expedited transaction: %w", err)
	}
	
	// Simulate expedited processing
	go func() {
		time.Sleep(100 * time.Millisecond) // Minimal delay for expedited processing
		
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		
		if err := h.completeTransaction(ctx, transaction); err != nil {
			h.logger.WithError(err).WithField("transaction_id", transaction.ID).Error("Failed to complete expedited transaction")
		}
	}()
	
	return transaction, nil
}

func (h *EnhancedTransactionHandler) processStandard(ctx context.Context, transaction *Transaction) (*Transaction, error) {
	h.logger.WithField("transaction_id", transaction.ID).Info("Processing standard transaction")
	
	transaction.Status = "processing"
	
	if err := h.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create standard transaction: %w", err)
	}
	
	// Standard processing
	go func() {
		time.Sleep(500 * time.Millisecond) // Standard processing delay
		
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		
		if err := h.completeTransaction(ctx, transaction); err != nil {
			h.logger.WithError(err).WithField("transaction_id", transaction.ID).Error("Failed to complete standard transaction")
		}
	}()
	
	return transaction, nil
}

func (h *EnhancedTransactionHandler) createTransactionRecord(ctx context.Context, transaction *Transaction) (*Transaction, error) {
	if err := h.db.Create(transaction).Error; err != nil {
		return nil, fmt.Errorf("failed to create transaction record: %w", err)
	}
	return transaction, nil
}

func (h *EnhancedTransactionHandler) completeTransaction(ctx context.Context, transaction *Transaction) error {
	// Simulate transaction completion logic
	transaction.Status = "completed"
	transaction.CompletedAt = &time.Time{}
	*transaction.CompletedAt = time.Now()
	transaction.ProcessingTime = time.Since(transaction.CreatedAt).Milliseconds()
	
	return h.db.Save(transaction).Error
}

func (h *EnhancedTransactionHandler) buildTransactionResponse(transaction *Transaction, enhanced *EnhancedTransactionRequest, fraudAnalysis *FraudAnalysis) map[string]interface{} {
	response := map[string]interface{}{
		"transaction_id":   transaction.ID,
		"status":          transaction.Status,
		"amount":          transaction.Amount,
		"currency":        transaction.Currency,
		"created_at":      transaction.CreatedAt,
		"reference":       transaction.Reference,
	}
	
	// Add analytics information if applied
	if enhanced.AnalyticsApplied {
		response["analytics"] = map[string]interface{}{
			"customer_segment":    enhanced.CustomerSegment,
			"risk_score":         enhanced.RiskScore,
			"churn_risk":         enhanced.ChurnRisk,
			"clv_category":       enhanced.CLVCategory,
			"recommended_action": enhanced.RecommendedAction,
			"dynamic_limits":     enhanced.DynamicLimits,
		}
	}
	
	// Add fraud analysis information
	if fraudAnalysis != nil {
		response["fraud_analysis"] = map[string]interface{}{
			"fraud_score":      fraudAnalysis.FraudScore,
			"risk_level":       fraudAnalysis.RiskLevel,
			"recommendation":   fraudAnalysis.Recommendation,
			"confidence":       fraudAnalysis.Confidence,
			"indicators_count": len(fraudAnalysis.FraudIndicators),
		}
	}
	
	// Add processing information
	response["processing"] = map[string]interface{}{
		"requires_additional_auth": transaction.RequiresAdditionalAuth,
		"requires_manual_review":   transaction.RequiresManualReview,
		"priority":                transaction.Priority,
	}
	
	return response
}

// Get customer analytics endpoint
func (h *EnhancedTransactionHandler) GetCustomerAnalytics(c *gin.Context) {
	customerIDStr := c.Param("customer_id")
	customerID, err := uuid.Parse(customerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid customer ID"})
		return
	}
	
	ctx := c.Request.Context()
	
	analytics, err := h.analyticsService.client.GetCustomerAnalysis(ctx, customerID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get customer analytics")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve customer analytics"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"customer_analytics": analytics,
		"timestamp":         time.Now(),
	})
}

// Get transaction analytics endpoint
func (h *EnhancedTransactionHandler) GetTransactionAnalytics(c *gin.Context) {
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
	
	analytics := map[string]interface{}{
		"transaction_id":      transaction.ID,
		"customer_id":         transaction.CustomerID,
		"analytics_applied":   transaction.AnalyticsApplied,
		"customer_segment":    transaction.CustomerSegment,
		"risk_score":         transaction.RiskScore,
		"churn_risk":         transaction.ChurnRisk,
		"clv_category":       transaction.CLVCategory,
		"fraud_score":        transaction.FraudScore,
		"fraud_risk_level":   transaction.FraudRiskLevel,
		"fraud_indicators":   transaction.FraudIndicators,
		"processing_time_ms": transaction.ProcessingTime,
		"status":             transaction.Status,
		"created_at":         transaction.CreatedAt,
	}
	
	c.JSON(http.StatusOK, gin.H{
		"transaction_analytics": analytics,
		"timestamp":            time.Now(),
	})
}

// Batch analytics for multiple customers
func (h *EnhancedTransactionHandler) BatchCustomerAnalytics(c *gin.Context) {
	var req struct {
		CustomerIDs []string `json:"customer_ids" binding:"required"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if len(req.CustomerIDs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 100 customers allowed per batch"})
		return
	}
	
	ctx := c.Request.Context()
	results := make(map[string]interface{})
	
	for _, customerIDStr := range req.CustomerIDs {
		customerID, err := uuid.Parse(customerIDStr)
		if err != nil {
			results[customerIDStr] = map[string]interface{}{"error": "Invalid customer ID"}
			continue
		}
		
		analytics, err := h.analyticsService.client.GetCustomerAnalysis(ctx, customerID)
		if err != nil {
			results[customerIDStr] = map[string]interface{}{"error": err.Error()}
		} else {
			results[customerIDStr] = analytics
		}
	}
	
	c.JSON(http.StatusOK, gin.H{
		"batch_analytics": results,
		"total_requested": len(req.CustomerIDs),
		"timestamp":      time.Now(),
	})
}

// Analytics dashboard endpoint
func (h *EnhancedTransactionHandler) GetAnalyticsDashboard(c *gin.Context) {
	ctx := c.Request.Context()
	
	// Get transaction statistics with analytics
	var stats struct {
		TotalTransactions      int64   `json:"total_transactions"`
		AnalyticsEnabled       int64   `json:"analytics_enabled"`
		HighRiskTransactions   int64   `json:"high_risk_transactions"`
		PremiumCustomers       int64   `json:"premium_customers"`
		AtRiskCustomers        int64   `json:"at_risk_customers"`
		AverageFraudScore      float64 `json:"average_fraud_score"`
		AverageRiskScore       float64 `json:"average_risk_score"`
	}
	
	// Get basic transaction counts
	h.db.Model(&Transaction{}).Count(&stats.TotalTransactions)
	h.db.Model(&Transaction{}).Where("analytics_applied = true").Count(&stats.AnalyticsEnabled)
	h.db.Model(&Transaction{}).Where("fraud_score > 0.6").Count(&stats.HighRiskTransactions)
	h.db.Model(&Transaction{}).Where("customer_segment = 'Premium'").Count(&stats.PremiumCustomers)
	h.db.Model(&Transaction{}).Where("customer_segment = 'At Risk'").Count(&stats.AtRiskCustomers)
	
	// Get average scores
	h.db.Model(&Transaction{}).Where("fraud_score > 0").Select("AVG(fraud_score)").Scan(&stats.AverageFraudScore)
	h.db.Model(&Transaction{}).Where("risk_score > 0").Select("AVG(risk_score)").Scan(&stats.AverageRiskScore)
	
	// Get segment distribution
	var segmentStats []struct {
		Segment string `json:"segment"`
		Count   int64  `json:"count"`
	}
	
	h.db.Model(&Transaction{}).
		Select("customer_segment as segment, COUNT(*) as count").
		Where("customer_segment != ''").
		Group("customer_segment").
		Scan(&segmentStats)
	
	// Get risk level distribution
	var riskStats []struct {
		RiskLevel string `json:"risk_level"`
		Count     int64  `json:"count"`
	}
	
	h.db.Model(&Transaction{}).
		Select("fraud_risk_level as risk_level, COUNT(*) as count").
		Where("fraud_risk_level != ''").
		Group("fraud_risk_level").
		Scan(&riskStats)
	
	dashboard := map[string]interface{}{
		"overview":            stats,
		"segment_distribution": segmentStats,
		"risk_distribution":   riskStats,
		"timestamp":          time.Now(),
		"analytics_coverage":  float64(stats.AnalyticsEnabled) / float64(stats.TotalTransactions) * 100,
	}
	
	c.JSON(http.StatusOK, gin.H{
		"dashboard": dashboard,
	})
}

func (h *EnhancedTransactionHandler) validateTransactionRequest(req *TransactionRequest) error {
	if req.CustomerID == uuid.Nil {
		return fmt.Errorf("customer_id is required")
	}
	
	if req.Amount <= 0 {
		return fmt.Errorf("amount must be greater than 0")
	}
	
	if req.Currency == "" {
		req.Currency = "NGN" // Default to Nigerian Naira
	}
	
	if req.TransactionType == "" {
		return fmt.Errorf("transaction_type is required")
	}
	
	if req.Channel == "" {
		return fmt.Errorf("channel is required")
	}
	
	return nil
}

// Add new fields to Transaction model for analytics integration
type Transaction struct {
	ID                    uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID           uuid.UUID  `json:"customer_id" gorm:"type:uuid;not null;index"`
	Amount               float64    `json:"amount" gorm:"not null"`
	Currency             string     `json:"currency" gorm:"default:'NGN'"`
	TransactionType      string     `json:"transaction_type" gorm:"not null"`
	Channel              string     `json:"channel" gorm:"not null"`
	Description          string     `json:"description"`
	Reference            string     `json:"reference" gorm:"unique"`
	Status               string     `json:"status" gorm:"default:'pending'"`
	Location             string     `json:"location"`
	RequiresAdditionalAuth bool     `json:"requires_additional_auth" gorm:"default:false"`
	RequiresManualReview bool       `json:"requires_manual_review" gorm:"default:false"`
	Priority             string     `json:"priority" gorm:"default:'normal'"`
	
	// Analytics fields
	CustomerSegment      string    `json:"customer_segment"`
	RiskScore           float64   `json:"risk_score"`
	ChurnRisk           string    `json:"churn_risk"`
	CLVCategory         string    `json:"clv_category"`
	AnalyticsApplied    bool      `json:"analytics_applied" gorm:"default:false"`
	
	// Fraud detection fields
	FraudScore          float64   `json:"fraud_score"`
	FraudRiskLevel      string    `json:"fraud_risk_level"`
	FraudIndicators     []string  `json:"fraud_indicators" gorm:"type:text[]"`
	
	// Processing fields
	ProcessingTime      int64     `json:"processing_time_ms"`
	Fees               float64   `json:"fees"`
	
	// Timestamps
	CreatedAt          time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt          time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
}

