package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// Notification Context with Analytics Integration
type NotificationContext struct {
	CustomerID        uuid.UUID                `json:"customer_id"`
	CustomerSegment   string                   `json:"customer_segment"`
	ChurnRisk         string                   `json:"churn_risk"`
	ChurnProbability  float64                  `json:"churn_probability"`
	CLVCategory       string                   `json:"clv_category"`
	LifetimeValue     float64                  `json:"lifetime_value"`
	PreferredChannel  string                   `json:"preferred_channel"`
	PreferredLanguage string                   `json:"preferred_language"`
	Recommendations   []ProductRecommendation  `json:"recommendations"`
	BehaviorInsights  []string                 `json:"behavior_insights"`
	RiskFactors       []string                 `json:"risk_factors"`
	Preferences       CustomerPreferences      `json:"preferences"`
	Profile           CustomerProfile          `json:"profile"`
	Location          LocationContext          `json:"location"`
	EngagementHistory EngagementHistory        `json:"engagement_history"`
}

type ProductRecommendation struct {
	ProductID     string  `json:"product_id"`
	ProductName   string  `json:"product_name"`
	Category      string  `json:"category"`
	Confidence    float64 `json:"confidence"`
	Reason        string  `json:"reason"`
	Priority      int     `json:"priority"`
	ExpectedValue float64 `json:"expected_value"`
}

type CustomerPreferences struct {
	NotificationChannels []string               `json:"notification_channels"`
	QuietHours          QuietHours             `json:"quiet_hours"`
	Frequency           string                 `json:"frequency"` // immediate, daily, weekly
	Categories          map[string]bool        `json:"categories"`
	Language            string                 `json:"language"`
	Timezone            string                 `json:"timezone"`
}

type QuietHours struct {
	Enabled   bool   `json:"enabled"`
	StartTime string `json:"start_time"` // HH:MM format
	EndTime   string `json:"end_time"`   // HH:MM format
}

type LocationContext struct {
	State       string `json:"state"`
	Region      string `json:"region"`
	City        string `json:"city"`
	Timezone    string `json:"timezone"`
	IsUrban     bool   `json:"is_urban"`
	Coordinates struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"coordinates"`
}

type EngagementHistory struct {
	LastEngagement    time.Time `json:"last_engagement"`
	TotalNotifications int      `json:"total_notifications"`
	OpenRate          float64   `json:"open_rate"`
	ClickRate         float64   `json:"click_rate"`
	UnsubscribeRate   float64   `json:"unsubscribe_rate"`
	PreferredTime     string    `json:"preferred_time"`
	ResponsePattern   string    `json:"response_pattern"`
}

// Enhanced Notification Request
type EnhancedNotificationRequest struct {
	NotificationRequest
	
	// Analytics enrichment
	Context           NotificationContext `json:"context"`
	PersonalizationApplied bool           `json:"personalization_applied"`
	SegmentStrategy   string              `json:"segment_strategy"`
	CampaignType      string              `json:"campaign_type"`
	OptimalTiming     time.Time           `json:"optimal_timing"`
	ChannelPriority   []string            `json:"channel_priority"`
	ContentVariant    string              `json:"content_variant"`
	ExpectedEngagement float64            `json:"expected_engagement"`
}

// Notification Analytics Client
type NotificationAnalyticsClient interface {
	GetNotificationContext(ctx context.Context, customerID uuid.UUID) (*NotificationContext, error)
	GetOptimalTiming(ctx context.Context, customerID uuid.UUID, notificationType string) (time.Time, error)
	GetPersonalizedContent(ctx context.Context, customerID uuid.UUID, templateID string, data map[string]interface{}) (string, error)
	RecordEngagement(ctx context.Context, engagement *NotificationEngagement) error
	GetCampaignRecommendations(ctx context.Context, customerID uuid.UUID) ([]CampaignRecommendation, error)
}

type notificationAnalyticsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *logrus.Logger
}

func NewNotificationAnalyticsClient(baseURL, apiKey string, logger *logrus.Logger) NotificationAnalyticsClient {
	return &notificationAnalyticsClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

func (c *notificationAnalyticsClient) GetNotificationContext(ctx context.Context, customerID uuid.UUID) (*NotificationContext, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/notification-context", c.baseURL, customerID.String())
	
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
	
	var context NotificationContext
	if err := json.NewDecoder(resp.Body).Decode(&context); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	c.logger.WithFields(logrus.Fields{
		"customer_id":      customerID,
		"segment":         context.CustomerSegment,
		"churn_risk":      context.ChurnRisk,
		"preferred_channel": context.PreferredChannel,
	}).Info("Retrieved notification context")
	
	return &context, nil
}

func (c *notificationAnalyticsClient) GetOptimalTiming(ctx context.Context, customerID uuid.UUID, notificationType string) (time.Time, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/optimal-timing", c.baseURL, customerID.String())
	
	requestData := map[string]interface{}{
		"notification_type": notificationType,
		"current_time":     time.Now(),
	}
	
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return time.Time{}, fmt.Errorf("analytics API error: %s", string(body))
	}
	
	var result struct {
		OptimalTime time.Time `json:"optimal_time"`
		Confidence  float64   `json:"confidence"`
		Reason      string    `json:"reason"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return time.Time{}, fmt.Errorf("failed to decode response: %w", err)
	}
	
	return result.OptimalTime, nil
}

func (c *notificationAnalyticsClient) GetPersonalizedContent(ctx context.Context, customerID uuid.UUID, templateID string, data map[string]interface{}) (string, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/personalized-content", c.baseURL, customerID.String())
	
	requestData := map[string]interface{}{
		"template_id": templateID,
		"data":       data,
	}
	
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("analytics API error: %s", string(body))
	}
	
	var result struct {
		Content string `json:"content"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}
	
	return result.Content, nil
}

type NotificationEngagement struct {
	NotificationID uuid.UUID              `json:"notification_id"`
	CustomerID     uuid.UUID              `json:"customer_id"`
	Channel        string                 `json:"channel"`
	Action         string                 `json:"action"` // sent, delivered, opened, clicked, unsubscribed
	Timestamp      time.Time              `json:"timestamp"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

func (c *notificationAnalyticsClient) RecordEngagement(ctx context.Context, engagement *NotificationEngagement) error {
	url := fmt.Sprintf("%s/api/v1/engagement", c.baseURL)
	
	jsonData, err := json.Marshal(engagement)
	if err != nil {
		return fmt.Errorf("failed to marshal engagement: %w", err)
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

type CampaignRecommendation struct {
	CampaignType   string    `json:"campaign_type"`
	Priority       int       `json:"priority"`
	Trigger        string    `json:"trigger"`
	OptimalTiming  time.Time `json:"optimal_timing"`
	ExpectedImpact float64   `json:"expected_impact"`
	Reason         string    `json:"reason"`
}

func (c *notificationAnalyticsClient) GetCampaignRecommendations(ctx context.Context, customerID uuid.UUID) ([]CampaignRecommendation, error) {
	url := fmt.Sprintf("%s/api/v1/customer/%s/campaign-recommendations", c.baseURL, customerID.String())
	
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
	
	var recommendations []CampaignRecommendation
	if err := json.NewDecoder(resp.Body).Decode(&recommendations); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	return recommendations, nil
}

// Personalized Notification Service
type PersonalizedNotificationService struct {
	analyticsClient NotificationAnalyticsClient
	db             *gorm.DB
	logger         *logrus.Logger
	templateEngine *TemplateEngine
	channelManager *ChannelManager
	campaignManager *CampaignManager
}

func NewPersonalizedNotificationService(
	analyticsClient NotificationAnalyticsClient,
	db *gorm.DB,
	logger *logrus.Logger,
	templateEngine *TemplateEngine,
	channelManager *ChannelManager,
	campaignManager *CampaignManager,
) *PersonalizedNotificationService {
	return &PersonalizedNotificationService{
		analyticsClient: analyticsClient,
		db:             db,
		logger:         logger,
		templateEngine: templateEngine,
		channelManager: channelManager,
		campaignManager: campaignManager,
	}
}

// Enrich notification with analytics context
func (s *PersonalizedNotificationService) EnrichWithAnalytics(ctx context.Context, req *NotificationRequest) (*EnhancedNotificationRequest, error) {
	enhanced := &EnhancedNotificationRequest{
		NotificationRequest:    *req,
		PersonalizationApplied: false,
	}
	
	// Get notification context from analytics
	context, err := s.analyticsClient.GetNotificationContext(ctx, req.CustomerID)
	if err != nil {
		s.logger.WithError(err).WithField("customer_id", req.CustomerID).Warn("Failed to get notification context, proceeding without personalization")
		return enhanced, nil
	}
	
	enhanced.Context = *context
	enhanced.PersonalizationApplied = true
	
	// Determine segment strategy
	enhanced.SegmentStrategy = s.determineSegmentStrategy(context)
	
	// Get optimal timing
	optimalTiming, err := s.analyticsClient.GetOptimalTiming(ctx, req.CustomerID, req.Type)
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get optimal timing, using immediate delivery")
		enhanced.OptimalTiming = time.Now()
	} else {
		enhanced.OptimalTiming = optimalTiming
	}
	
	// Determine channel priority
	enhanced.ChannelPriority = s.determineChannelPriority(context)
	
	// Set campaign type
	enhanced.CampaignType = s.determineCampaignType(req.Type, context)
	
	// Calculate expected engagement
	enhanced.ExpectedEngagement = s.calculateExpectedEngagement(context)
	
	s.logger.WithFields(logrus.Fields{
		"customer_id":         req.CustomerID,
		"segment":            context.CustomerSegment,
		"strategy":           enhanced.SegmentStrategy,
		"optimal_timing":     enhanced.OptimalTiming,
		"channel_priority":   enhanced.ChannelPriority,
		"expected_engagement": enhanced.ExpectedEngagement,
	}).Info("Notification enriched with analytics")
	
	return enhanced, nil
}

func (s *PersonalizedNotificationService) determineSegmentStrategy(context *NotificationContext) string {
	switch context.CustomerSegment {
	case "Premium":
		return "premium_experience"
	case "At Risk":
		return "retention_focused"
	case "New":
		return "onboarding_support"
	case "Dormant":
		return "reactivation_campaign"
	case "Lost":
		return "winback_campaign"
	default:
		return "standard_engagement"
	}
}

func (s *PersonalizedNotificationService) determineChannelPriority(context *NotificationContext) []string {
	// Start with preferred channel
	priority := []string{}
	
	if context.PreferredChannel != "" {
		priority = append(priority, context.PreferredChannel)
	}
	
	// Add channels based on segment and engagement history
	switch context.CustomerSegment {
	case "Premium":
		// Premium customers get multi-channel approach
		priority = append(priority, "push", "email", "sms", "in_app")
	case "At Risk":
		// At-risk customers need urgent channels
		priority = append(priority, "sms", "push", "email")
	case "New":
		// New customers prefer guided experience
		priority = append(priority, "in_app", "push", "email")
	case "Dormant":
		// Dormant customers need re-engagement
		priority = append(priority, "email", "sms", "push")
	default:
		// Standard priority
		priority = append(priority, "push", "in_app", "email", "sms")
	}
	
	// Remove duplicates while preserving order
	seen := make(map[string]bool)
	result := []string{}
	for _, channel := range priority {
		if !seen[channel] && s.isChannelEnabled(context, channel) {
			result = append(result, channel)
			seen[channel] = true
		}
	}
	
	return result
}

func (s *PersonalizedNotificationService) isChannelEnabled(context *NotificationContext, channel string) bool {
	for _, enabledChannel := range context.Preferences.NotificationChannels {
		if enabledChannel == channel {
			return true
		}
	}
	return len(context.Preferences.NotificationChannels) == 0 // Default to enabled if no preferences set
}

func (s *PersonalizedNotificationService) determineCampaignType(notificationType string, context *NotificationContext) string {
	// Map notification types to campaign types based on context
	switch notificationType {
	case "transaction_alert":
		if context.ChurnRisk == "High" {
			return "retention_transaction"
		}
		return "standard_transaction"
		
	case "promotional":
		if context.CustomerSegment == "Premium" {
			return "premium_promotion"
		} else if len(context.Recommendations) > 0 {
			return "personalized_promotion"
		}
		return "general_promotion"
		
	case "security_alert":
		return "security_notification"
		
	case "account_update":
		if context.CustomerSegment == "New" {
			return "onboarding_update"
		}
		return "account_maintenance"
		
	default:
		return "general_notification"
	}
}

func (s *PersonalizedNotificationService) calculateExpectedEngagement(context *NotificationContext) float64 {
	baseRate := 0.15 // 15% base engagement rate
	
	// Adjust based on segment
	switch context.CustomerSegment {
	case "Premium":
		baseRate *= 1.5
	case "At Risk":
		baseRate *= 1.2
	case "New":
		baseRate *= 1.3
	case "Dormant":
		baseRate *= 0.7
	case "Lost":
		baseRate *= 0.5
	}
	
	// Adjust based on historical engagement
	if context.EngagementHistory.OpenRate > 0 {
		historicalFactor := context.EngagementHistory.OpenRate / 0.15 // Normalize to base rate
		baseRate = (baseRate + context.EngagementHistory.OpenRate*historicalFactor) / 2
	}
	
	// Adjust based on churn risk
	switch context.ChurnRisk {
	case "High":
		baseRate *= 0.8 // High churn risk customers are less engaged
	case "Medium":
		baseRate *= 0.9
	case "Low":
		baseRate *= 1.1
	}
	
	// Cap at reasonable bounds
	if baseRate > 0.8 {
		baseRate = 0.8
	}
	if baseRate < 0.05 {
		baseRate = 0.05
	}
	
	return baseRate
}

// Personalize notification content
func (s *PersonalizedNotificationService) PersonalizeNotification(ctx context.Context, enhanced *EnhancedNotificationRequest) error {
	if !enhanced.PersonalizationApplied {
		return nil // Skip personalization if analytics not applied
	}
	
	context := &enhanced.Context
	
	// Customize based on segment strategy
	switch enhanced.SegmentStrategy {
	case "premium_experience":
		enhanced.Priority = "high"
		enhanced.Channels = enhanced.ChannelPriority[:min(3, len(enhanced.ChannelPriority))] // Multi-channel for premium
		enhanced.TemplateID = s.getPremiumTemplate(enhanced.TemplateID)
		
	case "retention_focused":
		enhanced.Priority = "urgent"
		enhanced.Channels = enhanced.ChannelPriority[:min(2, len(enhanced.ChannelPriority))] // Urgent channels
		enhanced.TemplateID = s.getRetentionTemplate(enhanced.TemplateID)
		
	case "onboarding_support":
		enhanced.Channels = []string{context.PreferredChannel}
		enhanced.TemplateID = s.getOnboardingTemplate(enhanced.TemplateID)
		
	case "reactivation_campaign":
		enhanced.Priority = "high"
		enhanced.Channels = []string{"email", "sms"} // Re-engagement channels
		enhanced.TemplateID = s.getReactivationTemplate(enhanced.TemplateID)
		
	case "winback_campaign":
		enhanced.Priority = "high"
		enhanced.Channels = []string{"email"} // Less intrusive for lost customers
		enhanced.TemplateID = s.getWinbackTemplate(enhanced.TemplateID)
		
	default:
		enhanced.Channels = enhanced.ChannelPriority[:min(2, len(enhanced.ChannelPriority))]
	}
	
	// Apply timing optimization
	if s.shouldDelayNotification(enhanced.OptimalTiming, context) {
		enhanced.ScheduledAt = &enhanced.OptimalTiming
	}
	
	// Personalize content with analytics data
	if enhanced.TemplateID != "" {
		personalizedContent, err := s.analyticsClient.GetPersonalizedContent(
			ctx, 
			enhanced.CustomerID, 
			enhanced.TemplateID, 
			s.buildTemplateData(enhanced),
		)
		if err != nil {
			s.logger.WithError(err).Warn("Failed to get personalized content, using default")
		} else {
			enhanced.Content = personalizedContent
		}
	}
	
	// Add product recommendations if applicable
	if len(context.Recommendations) > 0 && s.isPromotionalNotification(enhanced.Type) {
		enhanced.Metadata = s.addRecommendations(enhanced.Metadata, context.Recommendations)
	}
	
	s.logger.WithFields(logrus.Fields{
		"customer_id":     enhanced.CustomerID,
		"strategy":       enhanced.SegmentStrategy,
		"channels":       enhanced.Channels,
		"priority":       enhanced.Priority,
		"scheduled_at":   enhanced.ScheduledAt,
	}).Info("Notification personalized successfully")
	
	return nil
}

func (s *PersonalizedNotificationService) shouldDelayNotification(optimalTime time.Time, context *NotificationContext) bool {
	now := time.Now()
	
	// Don't delay if optimal time is in the past or very soon
	if optimalTime.Before(now) || optimalTime.Sub(now) < 5*time.Minute {
		return false
	}
	
	// Don't delay urgent notifications
	if optimalTime.Sub(now) > 24*time.Hour {
		return false
	}
	
	// Check quiet hours
	if context.Preferences.QuietHours.Enabled {
		if s.isInQuietHours(now, context.Preferences.QuietHours) {
			return true
		}
	}
	
	return true
}

func (s *PersonalizedNotificationService) isInQuietHours(t time.Time, quietHours QuietHours) bool {
	if !quietHours.Enabled {
		return false
	}
	
	currentTime := t.Format("15:04")
	
	// Handle quiet hours that span midnight
	if quietHours.StartTime > quietHours.EndTime {
		return currentTime >= quietHours.StartTime || currentTime <= quietHours.EndTime
	}
	
	return currentTime >= quietHours.StartTime && currentTime <= quietHours.EndTime
}

func (s *PersonalizedNotificationService) buildTemplateData(enhanced *EnhancedNotificationRequest) map[string]interface{} {
	context := enhanced.Context
	
	data := map[string]interface{}{
		"customer_name":     context.Profile.CustomerName,
		"customer_segment":  context.CustomerSegment,
		"preferred_language": context.PreferredLanguage,
		"location":         context.Location,
		"recommendations":  context.Recommendations,
		"insights":         context.BehaviorInsights,
		"clv_category":     context.CLVCategory,
		"engagement_score": context.EngagementHistory.OpenRate,
	}
	
	// Add original metadata
	for k, v := range enhanced.Metadata {
		data[k] = v
	}
	
	return data
}

func (s *PersonalizedNotificationService) addRecommendations(metadata map[string]interface{}, recommendations []ProductRecommendation) map[string]interface{} {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	
	// Add top 3 recommendations
	topRecommendations := recommendations
	if len(topRecommendations) > 3 {
		topRecommendations = topRecommendations[:3]
	}
	
	metadata["product_recommendations"] = topRecommendations
	metadata["has_recommendations"] = len(topRecommendations) > 0
	
	return metadata
}

func (s *PersonalizedNotificationService) isPromotionalNotification(notificationType string) bool {
	promotionalTypes := []string{"promotional", "product_recommendation", "upsell", "cross_sell"}
	for _, pType := range promotionalTypes {
		if notificationType == pType {
			return true
		}
	}
	return false
}

// Template mapping functions
func (s *PersonalizedNotificationService) getPremiumTemplate(baseTemplate string) string {
	return "premium_" + baseTemplate
}

func (s *PersonalizedNotificationService) getRetentionTemplate(baseTemplate string) string {
	return "retention_" + baseTemplate
}

func (s *PersonalizedNotificationService) getOnboardingTemplate(baseTemplate string) string {
	return "onboarding_" + baseTemplate
}

func (s *PersonalizedNotificationService) getReactivationTemplate(baseTemplate string) string {
	return "reactivation_" + baseTemplate
}

func (s *PersonalizedNotificationService) getWinbackTemplate(baseTemplate string) string {
	return "winback_" + baseTemplate
}

// Proactive Campaign Manager
type ProactiveCampaignManager struct {
	analyticsClient NotificationAnalyticsClient
	notificationService *PersonalizedNotificationService
	db             *gorm.DB
	logger         *logrus.Logger
}

func NewProactiveCampaignManager(
	analyticsClient NotificationAnalyticsClient,
	notificationService *PersonalizedNotificationService,
	db *gorm.DB,
	logger *logrus.Logger,
) *ProactiveCampaignManager {
	return &ProactiveCampaignManager{
		analyticsClient:     analyticsClient,
		notificationService: notificationService,
		db:                 db,
		logger:             logger,
	}
}

// Execute proactive campaigns based on analytics
func (c *ProactiveCampaignManager) ExecuteProactiveCampaigns(ctx context.Context) error {
	c.logger.Info("Starting proactive campaign execution")
	
	// Get customers who need proactive engagement
	customers, err := c.getCustomersForProactiveCampaigns(ctx)
	if err != nil {
		return fmt.Errorf("failed to get customers for campaigns: %w", err)
	}
	
	c.logger.WithField("customer_count", len(customers)).Info("Found customers for proactive campaigns")
	
	// Process each customer
	for _, customerID := range customers {
		if err := c.processCustomerCampaigns(ctx, customerID); err != nil {
			c.logger.WithError(err).WithField("customer_id", customerID).Error("Failed to process customer campaigns")
			continue
		}
	}
	
	c.logger.Info("Proactive campaign execution completed")
	return nil
}

func (c *ProactiveCampaignManager) getCustomersForProactiveCampaigns(ctx context.Context) ([]uuid.UUID, error) {
	// In a real implementation, this would query the database for customers
	// who meet criteria for proactive campaigns (high churn risk, dormant, etc.)
	
	var customers []uuid.UUID
	
	// Query for high churn risk customers
	err := c.db.Raw(`
		SELECT DISTINCT customer_id 
		FROM transactions 
		WHERE churn_risk = 'High' 
		AND created_at > NOW() - INTERVAL '7 days'
		LIMIT 100
	`).Scan(&customers).Error
	
	if err != nil {
		return nil, err
	}
	
	return customers, nil
}

func (c *ProactiveCampaignManager) processCustomerCampaigns(ctx context.Context, customerID uuid.UUID) error {
	// Get campaign recommendations from analytics
	recommendations, err := c.analyticsClient.GetCampaignRecommendations(ctx, customerID)
	if err != nil {
		return fmt.Errorf("failed to get campaign recommendations: %w", err)
	}
	
	// Execute recommended campaigns
	for _, recommendation := range recommendations {
		if err := c.executeCampaign(ctx, customerID, recommendation); err != nil {
			c.logger.WithError(err).WithFields(logrus.Fields{
				"customer_id":   customerID,
				"campaign_type": recommendation.CampaignType,
			}).Error("Failed to execute campaign")
			continue
		}
	}
	
	return nil
}

func (c *ProactiveCampaignManager) executeCampaign(ctx context.Context, customerID uuid.UUID, recommendation CampaignRecommendation) error {
	// Create notification request based on campaign recommendation
	notificationReq := &NotificationRequest{
		ID:         uuid.New(),
		CustomerID: customerID,
		Type:       recommendation.CampaignType,
		Priority:   c.getPriorityFromRecommendation(recommendation),
		TemplateID: c.getTemplateFromCampaignType(recommendation.CampaignType),
		Metadata: map[string]interface{}{
			"campaign_trigger":     recommendation.Trigger,
			"expected_impact":      recommendation.ExpectedImpact,
			"recommendation_reason": recommendation.Reason,
		},
	}
	
	// Set optimal timing
	if !recommendation.OptimalTiming.IsZero() {
		notificationReq.ScheduledAt = &recommendation.OptimalTiming
	}
	
	// Enrich with analytics and send
	enhanced, err := c.notificationService.EnrichWithAnalytics(ctx, notificationReq)
	if err != nil {
		return fmt.Errorf("failed to enrich notification: %w", err)
	}
	
	if err := c.notificationService.PersonalizeNotification(ctx, enhanced); err != nil {
		return fmt.Errorf("failed to personalize notification: %w", err)
	}
	
	// Send the notification (this would integrate with the actual notification sending logic)
	c.logger.WithFields(logrus.Fields{
		"customer_id":   customerID,
		"campaign_type": recommendation.CampaignType,
		"priority":     recommendation.Priority,
		"channels":     enhanced.Channels,
	}).Info("Proactive campaign notification sent")
	
	return nil
}

func (c *ProactiveCampaignManager) getPriorityFromRecommendation(recommendation CampaignRecommendation) string {
	if recommendation.Priority >= 8 {
		return "urgent"
	} else if recommendation.Priority >= 6 {
		return "high"
	} else if recommendation.Priority >= 4 {
		return "medium"
	}
	return "low"
}

func (c *ProactiveCampaignManager) getTemplateFromCampaignType(campaignType string) string {
	templateMap := map[string]string{
		"churn_prevention":    "churn_prevention_template",
		"upselling":          "upsell_template",
		"cross_selling":      "cross_sell_template",
		"reactivation":       "reactivation_template",
		"winback":           "winback_template",
		"milestone":         "milestone_template",
		"product_recommendation": "product_recommendation_template",
	}
	
	if template, exists := templateMap[campaignType]; exists {
		return template
	}
	
	return "default_campaign_template"
}

// Utility functions
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Metrics for notification analytics
var (
	notificationPersonalizationTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notification_personalization_total",
			Help: "Total number of personalized notifications",
		},
		[]string{"segment", "strategy", "status"},
	)
	
	notificationEngagementRate = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "notification_engagement_rate",
			Help: "Notification engagement rates",
		},
		[]string{"segment", "channel", "campaign_type"},
	)
	
	proactiveCampaignsExecuted = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proactive_campaigns_executed_total",
			Help: "Total number of proactive campaigns executed",
		},
		[]string{"campaign_type", "priority"},
	)
)

func init() {
	prometheus.MustRegister(
		notificationPersonalizationTotal,
		notificationEngagementRate,
		proactiveCampaignsExecuted,
	)
}

