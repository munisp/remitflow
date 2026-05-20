package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// Analytics Integration Types
type CustomerAnalytics struct {
	CustomerID        uuid.UUID                `json:"customer_id"`
	AnalysisTimestamp time.Time                `json:"analysis_timestamp"`
	Segment           string                   `json:"segment"`
	ChurnRisk         ChurnRiskAnalysis        `json:"churn_risk"`
	LifetimeValue     LifetimeValueAnalysis    `json:"lifetime_value"`
	Profile           CustomerProfile          `json:"profile"`
	RiskIndicators    RiskIndicators           `json:"risk_indicators"`
	Insights          []string                 `json:"insights"`
	ProcessingTime    float64                  `json:"processing_time"`
}

type ChurnRiskAnalysis struct {
	Probability float64  `json:"probability"`
	Category    string   `json:"category"`
	Factors     []string `json:"factors"`
}

type LifetimeValueAnalysis struct {
	Historical float64 `json:"historical"`
	Predicted  float64 `json:"predicted"`
	Category   string  `json:"category"`
}

type CustomerProfile struct {
	TotalTransactions     int     `json:"total_transactions"`
	TotalAmount          float64 `json:"total_amount"`
	AvgTransactionAmount float64 `json:"avg_transaction_amount"`
	RecencyDays          int     `json:"recency_days"`
	Frequency            int     `json:"frequency"`
	AccountAgeDays       int     `json:"account_age_days"`
	PreferredChannel     string  `json:"preferred_channel"`
}

type RiskIndicators struct {
	FailedTransactionRate float64 `json:"failed_transaction_rate"`
	LargeTransactions     int     `json:"large_transactions"`
	UniqueLocations       int     `json:"unique_locations"`
}

// Enhanced Transaction Request with Analytics
type EnhancedTransactionRequest struct {
	TransactionRequest
	
	// Analytics enrichment
	RiskScore         float64           `json:"risk_score,omitempty"`
	ChurnRisk         string            `json:"churn_risk,omitempty"`
	CustomerSegment   string            `json:"customer_segment,omitempty"`
	CLVCategory       string            `json:"clv_category,omitempty"`
	DynamicLimits     TransactionLimits `json:"dynamic_limits,omitempty"`
	RiskFactors       []string          `json:"risk_factors,omitempty"`
	RecommendedAction string            `json:"recommended_action,omitempty"`
	AnalyticsApplied  bool              `json:"analytics_applied"`
}

type TransactionLimits struct {
	DailyLimit      float64 `json:"daily_limit"`
	TransactionLimit float64 `json:"transaction_limit"`
	MonthlyLimit    float64 `json:"monthly_limit"`
	RequiresApproval bool   `json:"requires_approval"`
	AdditionalAuth   bool   `json:"additional_auth"`
}

// Analytics Client Interface
type AnalyticsClient interface {
	GetCustomerAnalysis(ctx context.Context, customerID uuid.UUID) (*CustomerAnalytics, error)
	UpdateCustomerBehavior(ctx context.Context, behavior *CustomerBehaviorUpdate) error
	GetRiskScore(ctx context.Context, customerID uuid.UUID, transactionData map[string]interface{}) (float64, error)
	GetDynamicLimits(ctx context.Context, customerID uuid.UUID, segment string) (*TransactionLimits, error)
}

// Analytics Client Implementation
type analyticsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *logrus.Logger
}

func NewAnalyticsClient(baseURL, apiKey string, logger *logrus.Logger) AnalyticsClient {
	return &analyticsClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		logger: logger,
	}
}

func (c *analyticsClient) GetCustomerAnalysis(ctx context.Context, customerID uuid.UUID) (*CustomerAnalytics, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/analyze", c.baseURL, customerID.String())
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("analytics API error: %s", string(body))
	}
	
	var analytics CustomerAnalytics
	if err := json.NewDecoder(resp.Body).Decode(&analytics); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	c.logger.WithFields(logrus.Fields{
		"customer_id": customerID,
		"segment":     analytics.Segment,
		"churn_risk":  analytics.ChurnRisk.Category,
	}).Info("Retrieved customer analytics")
	
	return &analytics, nil
}

type CustomerBehaviorUpdate struct {
	CustomerID      uuid.UUID              `json:"customer_id"`
	TransactionID   uuid.UUID              `json:"transaction_id"`
	Amount          float64                `json:"amount"`
	Channel         string                 `json:"channel"`
	TransactionType string                 `json:"transaction_type"`
	Status          string                 `json:"status"`
	Location        string                 `json:"location,omitempty"`
	Timestamp       time.Time              `json:"timestamp"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

func (c *analyticsClient) UpdateCustomerBehavior(ctx context.Context, behavior *CustomerBehaviorUpdate) error {
	url := fmt.Sprintf("%s/api/v1/customer/%s/behavior", c.baseURL, behavior.CustomerID.String())
	
	jsonData, err := json.Marshal(behavior)
	if err != nil {
		return fmt.Errorf("failed to marshal behavior data: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("analytics API error: %s", string(body))
	}
	
	return nil
}

func (c *analyticsClient) GetRiskScore(ctx context.Context, customerID uuid.UUID, transactionData map[string]interface{}) (float64, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/risk-score", c.baseURL, customerID.String())
	
	jsonData, err := json.Marshal(transactionData)
	if err != nil {
		return 0, fmt.Errorf("failed to marshal transaction data: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("analytics API error: %s", string(body))
	}
	
	var result struct {
		RiskScore float64 `json:"risk_score"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}
	
	return result.RiskScore, nil
}

func (c *analyticsClient) GetDynamicLimits(ctx context.Context, customerID uuid.UUID, segment string) (*TransactionLimits, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/limits?segment=%s", c.baseURL, customerID.String(), segment)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("analytics API error: %s", string(body))
	}
	
	var limits TransactionLimits
	if err := json.NewDecoder(resp.Body).Decode(&limits); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	return &limits, nil
}

// Analytics Service for Transaction Processing
type AnalyticsService struct {
	client     AnalyticsClient
	db         *gorm.DB
	logger     *logrus.Logger
	cache      map[string]*CustomerAnalytics // Simple in-memory cache
	cacheExpiry map[string]time.Time
}

func NewAnalyticsService(client AnalyticsClient, db *gorm.DB, logger *logrus.Logger) *AnalyticsService {
	return &AnalyticsService{
		client:      client,
		db:          db,
		logger:      logger,
		cache:       make(map[string]*CustomerAnalytics),
		cacheExpiry: make(map[string]time.Time),
	}
}

// Enrich transaction request with analytics data
func (s *AnalyticsService) EnrichWithAnalytics(ctx context.Context, req *TransactionRequest) (*EnhancedTransactionRequest, error) {
	enhanced := &EnhancedTransactionRequest{
		TransactionRequest: *req,
		AnalyticsApplied:   false,
	}
	
	// Get customer analytics (with caching)
	analytics, err := s.getCustomerAnalyticsWithCache(ctx, req.CustomerID)
	if err != nil {
		s.logger.WithError(err).WithField("customer_id", req.CustomerID).Warn("Failed to get customer analytics, proceeding without enrichment")
		return enhanced, nil
	}
	
	// Apply analytics enrichment
	enhanced.RiskScore = analytics.ChurnRisk.Probability
	enhanced.ChurnRisk = analytics.ChurnRisk.Category
	enhanced.CustomerSegment = analytics.Segment
	enhanced.CLVCategory = analytics.LifetimeValue.Category
	enhanced.RiskFactors = analytics.ChurnRisk.Factors
	enhanced.AnalyticsApplied = true
	
	// Get dynamic limits based on segment
	limits, err := s.client.GetDynamicLimits(ctx, req.CustomerID, analytics.Segment)
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get dynamic limits, using defaults")
		limits = s.getDefaultLimits(analytics.Segment)
	}
	enhanced.DynamicLimits = *limits
	
	// Get real-time risk score for this specific transaction
	transactionData := map[string]interface{}{
		"amount":           req.Amount,
		"channel":          req.Channel,
		"transaction_type": req.TransactionType,
		"timestamp":        time.Now(),
		"location":         req.Location,
	}
	
	realTimeRisk, err := s.client.GetRiskScore(ctx, req.CustomerID, transactionData)
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get real-time risk score")
	} else {
		enhanced.RiskScore = (enhanced.RiskScore + realTimeRisk) / 2 // Average with churn risk
	}
	
	// Determine recommended action
	enhanced.RecommendedAction = s.determineRecommendedAction(enhanced, analytics)
	
	s.logger.WithFields(logrus.Fields{
		"customer_id":        req.CustomerID,
		"segment":           enhanced.CustomerSegment,
		"risk_score":        enhanced.RiskScore,
		"recommended_action": enhanced.RecommendedAction,
	}).Info("Transaction enriched with analytics")
	
	return enhanced, nil
}

func (s *AnalyticsService) getCustomerAnalyticsWithCache(ctx context.Context, customerID uuid.UUID) (*CustomerAnalytics, error) {
	cacheKey := customerID.String()
	
	// Check cache
	if analytics, exists := s.cache[cacheKey]; exists {
		if expiry, hasExpiry := s.cacheExpiry[cacheKey]; hasExpiry && time.Now().Before(expiry) {
			return analytics, nil
		}
	}
	
	// Fetch from analytics service
	analytics, err := s.client.GetCustomerAnalysis(ctx, customerID)
	if err != nil {
		return nil, err
	}
	
	// Cache for 5 minutes
	s.cache[cacheKey] = analytics
	s.cacheExpiry[cacheKey] = time.Now().Add(5 * time.Minute)
	
	return analytics, nil
}

func (s *AnalyticsService) getDefaultLimits(segment string) *TransactionLimits {
	switch segment {
	case "Premium":
		return &TransactionLimits{
			DailyLimit:       10000000,  // 10M NGN
			TransactionLimit: 5000000,   // 5M NGN
			MonthlyLimit:     50000000,  // 50M NGN
			RequiresApproval: false,
			AdditionalAuth:   false,
		}
	case "At Risk":
		return &TransactionLimits{
			DailyLimit:       500000,    // 500K NGN
			TransactionLimit: 200000,    // 200K NGN
			MonthlyLimit:     2000000,   // 2M NGN
			RequiresApproval: true,
			AdditionalAuth:   true,
		}
	case "New":
		return &TransactionLimits{
			DailyLimit:       1000000,   // 1M NGN
			TransactionLimit: 500000,    // 500K NGN
			MonthlyLimit:     5000000,   // 5M NGN
			RequiresApproval: false,
			AdditionalAuth:   true,
		}
	default: // Regular, Active, Dormant
		return &TransactionLimits{
			DailyLimit:       2000000,   // 2M NGN
			TransactionLimit: 1000000,   // 1M NGN
			MonthlyLimit:     10000000,  // 10M NGN
			RequiresApproval: false,
			AdditionalAuth:   false,
		}
	}
}

func (s *AnalyticsService) determineRecommendedAction(enhanced *EnhancedTransactionRequest, analytics *CustomerAnalytics) string {
	// High risk transaction
	if enhanced.RiskScore > 0.8 {
		return "BLOCK"
	}
	
	// Medium-high risk
	if enhanced.RiskScore > 0.6 {
		return "REQUIRE_ADDITIONAL_AUTH"
	}
	
	// Amount exceeds dynamic limits
	if enhanced.Amount > enhanced.DynamicLimits.TransactionLimit {
		if enhanced.DynamicLimits.RequiresApproval {
			return "REQUIRE_APPROVAL"
		}
		return "REQUIRE_ADDITIONAL_AUTH"
	}
	
	// At-risk customer with large transaction
	if enhanced.ChurnRisk == "High" && enhanced.Amount > 100000 {
		return "REQUIRE_ADDITIONAL_AUTH"
	}
	
	// New customer with unusual pattern
	if enhanced.CustomerSegment == "New" && enhanced.Amount > analytics.Profile.AvgTransactionAmount*3 {
		return "REQUIRE_ADDITIONAL_AUTH"
	}
	
	// Premium customer - expedite
	if enhanced.CustomerSegment == "Premium" {
		return "EXPEDITE"
	}
	
	return "APPROVE"
}

// Apply analytics-driven business rules
func (s *AnalyticsService) ApplyBusinessRules(ctx context.Context, enhanced *EnhancedTransactionRequest) error {
	switch enhanced.RecommendedAction {
	case "BLOCK":
		return fmt.Errorf("transaction blocked due to high risk score: %.2f", enhanced.RiskScore)
		
	case "REQUIRE_APPROVAL":
		// Set transaction status to pending approval
		enhanced.Status = "pending_approval"
		s.logger.WithField("transaction_id", enhanced.ID).Info("Transaction requires approval")
		
	case "REQUIRE_ADDITIONAL_AUTH":
		// Set flag for additional authentication
		enhanced.RequiresAdditionalAuth = true
		s.logger.WithField("transaction_id", enhanced.ID).Info("Transaction requires additional authentication")
		
	case "EXPEDITE":
		// Set high priority for premium customers
		enhanced.Priority = "high"
		s.logger.WithField("transaction_id", enhanced.ID).Info("Transaction expedited for premium customer")
		
	case "APPROVE":
		// Normal processing
		break
		
	default:
		s.logger.WithField("action", enhanced.RecommendedAction).Warn("Unknown recommended action")
	}
	
	return nil
}

// Update customer behavior after transaction
func (s *AnalyticsService) UpdateCustomerBehavior(ctx context.Context, transaction *Transaction) error {
	behavior := &CustomerBehaviorUpdate{
		CustomerID:      transaction.CustomerID,
		TransactionID:   transaction.ID,
		Amount:          transaction.Amount,
		Channel:         transaction.Channel,
		TransactionType: transaction.TransactionType,
		Status:          transaction.Status,
		Location:        transaction.Location,
		Timestamp:       transaction.CreatedAt,
		Metadata: map[string]interface{}{
			"processing_time": transaction.ProcessingTime,
			"fees":           transaction.Fees,
			"currency":       transaction.Currency,
		},
	}
	
	// Async update to avoid blocking transaction processing
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		
		if err := s.client.UpdateCustomerBehavior(ctx, behavior); err != nil {
			s.logger.WithError(err).WithField("transaction_id", transaction.ID).Error("Failed to update customer behavior")
		}
	}()
	
	return nil
}

// Intelligent Fraud Detection
type FraudDetectionService struct {
	analyticsService *AnalyticsService
	db              *gorm.DB
	logger          *logrus.Logger
}

func NewFraudDetectionService(analyticsService *AnalyticsService, db *gorm.DB, logger *logrus.Logger) *FraudDetectionService {
	return &FraudDetectionService{
		analyticsService: analyticsService,
		db:              db,
		logger:          logger,
	}
}

type FraudAnalysis struct {
	TransactionID   uuid.UUID `json:"transaction_id"`
	CustomerID      uuid.UUID `json:"customer_id"`
	FraudScore      float64   `json:"fraud_score"`
	RiskLevel       string    `json:"risk_level"`
	FraudIndicators []string  `json:"fraud_indicators"`
	Recommendation  string    `json:"recommendation"`
	Confidence      float64   `json:"confidence"`
}

func (f *FraudDetectionService) AnalyzeFraud(ctx context.Context, enhanced *EnhancedTransactionRequest) (*FraudAnalysis, error) {
	analysis := &FraudAnalysis{
		TransactionID:   enhanced.ID,
		CustomerID:      enhanced.CustomerID,
		FraudIndicators: []string{},
	}
	
	// Get recent transaction history
	var recentTransactions []Transaction
	err := f.db.Where("customer_id = ? AND created_at > ?", 
		enhanced.CustomerID, time.Now().Add(-24*time.Hour)).
		Order("created_at DESC").
		Limit(10).
		Find(&recentTransactions).Error
	
	if err != nil {
		f.logger.WithError(err).Error("Failed to get recent transactions for fraud analysis")
		return analysis, err
	}
	
	fraudScore := 0.0
	
	// Check for unusual amount patterns
	if len(recentTransactions) > 0 {
		avgAmount := 0.0
		for _, tx := range recentTransactions {
			avgAmount += tx.Amount
		}
		avgAmount /= float64(len(recentTransactions))
		
		if enhanced.Amount > avgAmount*5 {
			fraudScore += 0.3
			analysis.FraudIndicators = append(analysis.FraudIndicators, "Unusually large amount compared to recent history")
		}
	}
	
	// Check for rapid successive transactions
	if len(recentTransactions) > 5 {
		// More than 5 transactions in 24 hours
		fraudScore += 0.2
		analysis.FraudIndicators = append(analysis.FraudIndicators, "High transaction frequency")
	}
	
	// Check for off-hours transactions
	if !isBusinessHours(time.Now()) && enhanced.Amount > 1000000 {
		fraudScore += 0.2
		analysis.FraudIndicators = append(analysis.FraudIndicators, "Large transaction outside business hours")
	}
	
	// Check customer segment risk
	switch enhanced.CustomerSegment {
	case "At Risk", "Lost":
		fraudScore += 0.3
		analysis.FraudIndicators = append(analysis.FraudIndicators, "High-risk customer segment")
	case "New":
		if enhanced.Amount > 500000 {
			fraudScore += 0.2
			analysis.FraudIndicators = append(analysis.FraudIndicators, "Large transaction from new customer")
		}
	}
	
	// Check for failed transaction patterns
	failedCount := 0
	for _, tx := range recentTransactions {
		if tx.Status == "failed" {
			failedCount++
		}
	}
	
	if failedCount > 2 {
		fraudScore += 0.2
		analysis.FraudIndicators = append(analysis.FraudIndicators, "Multiple recent failed transactions")
	}
	
	// Incorporate analytics risk score
	fraudScore += enhanced.RiskScore * 0.4
	
	// Normalize fraud score
	if fraudScore > 1.0 {
		fraudScore = 1.0
	}
	
	analysis.FraudScore = fraudScore
	analysis.Confidence = 0.85 // Base confidence
	
	// Determine risk level and recommendation
	if fraudScore >= 0.8 {
		analysis.RiskLevel = "CRITICAL"
		analysis.Recommendation = "BLOCK_TRANSACTION"
	} else if fraudScore >= 0.6 {
		analysis.RiskLevel = "HIGH"
		analysis.Recommendation = "REQUIRE_MANUAL_REVIEW"
	} else if fraudScore >= 0.4 {
		analysis.RiskLevel = "MEDIUM"
		analysis.Recommendation = "REQUIRE_ADDITIONAL_AUTH"
	} else if fraudScore >= 0.2 {
		analysis.RiskLevel = "LOW"
		analysis.Recommendation = "MONITOR"
	} else {
		analysis.RiskLevel = "MINIMAL"
		analysis.Recommendation = "APPROVE"
	}
	
	f.logger.WithFields(logrus.Fields{
		"transaction_id": enhanced.ID,
		"customer_id":    enhanced.CustomerID,
		"fraud_score":    fraudScore,
		"risk_level":     analysis.RiskLevel,
		"indicators":     len(analysis.FraudIndicators),
	}).Info("Fraud analysis completed")
	
	return analysis, nil
}

// Dynamic Limit Manager
type DynamicLimitManager struct {
	analyticsService *AnalyticsService
	db              *gorm.DB
	logger          *logrus.Logger
}

func NewDynamicLimitManager(analyticsService *AnalyticsService, db *gorm.DB, logger *logrus.Logger) *DynamicLimitManager {
	return &DynamicLimitManager{
		analyticsService: analyticsService,
		db:              db,
		logger:          logger,
	}
}

func (d *DynamicLimitManager) CheckLimits(ctx context.Context, enhanced *EnhancedTransactionRequest) error {
	// Check daily limit
	var dailyTotal float64
	err := d.db.Model(&Transaction{}).
		Where("customer_id = ? AND DATE(created_at) = DATE(NOW()) AND status IN ('completed', 'pending')", enhanced.CustomerID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&dailyTotal).Error
	
	if err != nil {
		d.logger.WithError(err).Error("Failed to calculate daily transaction total")
		return err
	}
	
	if dailyTotal+enhanced.Amount > enhanced.DynamicLimits.DailyLimit {
		return fmt.Errorf("transaction would exceed daily limit of %.2f NGN (current: %.2f NGN)", 
			enhanced.DynamicLimits.DailyLimit, dailyTotal)
	}
	
	// Check monthly limit
	var monthlyTotal float64
	err = d.db.Model(&Transaction{}).
		Where("customer_id = ? AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) AND status IN ('completed', 'pending')", enhanced.CustomerID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&monthlyTotal).Error
	
	if err != nil {
		d.logger.WithError(err).Error("Failed to calculate monthly transaction total")
		return err
	}
	
	if monthlyTotal+enhanced.Amount > enhanced.DynamicLimits.MonthlyLimit {
		return fmt.Errorf("transaction would exceed monthly limit of %.2f NGN (current: %.2f NGN)", 
			enhanced.DynamicLimits.MonthlyLimit, monthlyTotal)
	}
	
	// Check single transaction limit
	if enhanced.Amount > enhanced.DynamicLimits.TransactionLimit {
		return fmt.Errorf("transaction amount %.2f NGN exceeds single transaction limit of %.2f NGN", 
			enhanced.Amount, enhanced.DynamicLimits.TransactionLimit)
	}
	
	d.logger.WithFields(logrus.Fields{
		"customer_id":     enhanced.CustomerID,
		"daily_total":     dailyTotal,
		"monthly_total":   monthlyTotal,
		"transaction_amount": enhanced.Amount,
		"daily_limit":     enhanced.DynamicLimits.DailyLimit,
		"monthly_limit":   enhanced.DynamicLimits.MonthlyLimit,
		"transaction_limit": enhanced.DynamicLimits.TransactionLimit,
	}).Info("Dynamic limits check passed")
	
	return nil
}

// Helper functions
func isBusinessHours(t time.Time) bool {
	// Nigerian business hours: 8 AM to 5 PM, Monday to Friday
	weekday := t.Weekday()
	if weekday == time.Saturday || weekday == time.Sunday {
		return false
	}
	
	hour := t.Hour()
	return hour >= 8 && hour < 17
}

// Metrics for analytics integration
var (
	analyticsRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_analytics_requests_total",
			Help: "Total number of analytics requests",
		},
		[]string{"operation", "status"},
	)
	
	analyticsResponseTime = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "transaction_analytics_response_time_seconds",
			Help: "Analytics service response time",
		},
		[]string{"operation"},
	)
	
	fraudDetectionScore = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "transaction_fraud_detection_score",
			Help: "Fraud detection scores",
		},
		[]string{"risk_level"},
	)
	
	dynamicLimitsApplied = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "transaction_dynamic_limits_applied_total",
			Help: "Total number of dynamic limits applied",
		},
		[]string{"segment", "action"},
	)
)

func init() {
	prometheus.MustRegister(
		analyticsRequestsTotal,
		analyticsResponseTime,
		fraudDetectionScore,
		dynamicLimitsApplied,
	)
}

