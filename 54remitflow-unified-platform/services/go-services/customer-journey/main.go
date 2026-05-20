package main

import (
	"os"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Customer Journey Tracking Service
type CustomerJourneyService struct {
	db                    *gorm.DB
	logger               *logrus.Logger
	analyticsClient      AnalyticsClient
	journeyEngine        *JourneyEngine
	touchpointTracker    *TouchpointTracker
	nextBestActionEngine *NextBestActionEngine
	journeyOptimizer     *JourneyOptimizer
}

// Customer Journey Models
type CustomerJourney struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID        uuid.UUID              `json:"customer_id" gorm:"type:uuid;not null;index"`
	JourneyID         string                 `json:"journey_id" gorm:"not null;index"` // Unique journey identifier
	CurrentStage      string                 `json:"current_stage" gorm:"not null"`
	PreviousStage     string                 `json:"previous_stage"`
	JourneyType       string                 `json:"journey_type" gorm:"not null"` // onboarding, transaction, support, etc.
	Status            string                 `json:"status" gorm:"default:'active'"` // active, completed, abandoned
	Progress          float64                `json:"progress" gorm:"default:0"` // 0-100%
	
	// Journey Context
	EntryPoint        string                 `json:"entry_point"` // web, mobile, ussd, agent, etc.
	Channel           string                 `json:"channel"`
	Device            string                 `json:"device"`
	Location          LocationInfo           `json:"location" gorm:"type:jsonb"`
	SessionID         string                 `json:"session_id"`
	
	// Analytics Integration
	CustomerSegment   string                 `json:"customer_segment"`
	ChurnRisk         string                 `json:"churn_risk"`
	CLVCategory       string                 `json:"clv_category"`
	RiskScore         float64                `json:"risk_score"`
	EngagementScore   float64                `json:"engagement_score"`
	
	// Journey Metrics
	TotalTouchpoints  int                    `json:"total_touchpoints" gorm:"default:0"`
	CompletedActions  int                    `json:"completed_actions" gorm:"default:0"`
	FailedActions     int                    `json:"failed_actions" gorm:"default:0"`
	AverageResponseTime float64             `json:"average_response_time" gorm:"default:0"`
	SatisfactionScore float64               `json:"satisfaction_score" gorm:"default:0"`
	
	// Predictive Fields
	NextBestAction    string                 `json:"next_best_action"`
	PredictedOutcome  string                 `json:"predicted_outcome"`
	CompletionProbability float64           `json:"completion_probability"`
	ChurnProbability  float64                `json:"churn_probability"`
	
	// Journey Data
	Touchpoints       []TouchpointEvent      `json:"touchpoints" gorm:"type:jsonb"`
	Actions           []JourneyAction        `json:"actions" gorm:"type:jsonb"`
	Metadata          map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	
	// Timestamps
	StartedAt         time.Time              `json:"started_at" gorm:"not null"`
	LastActivityAt    time.Time              `json:"last_activity_at" gorm:"not null"`
	CompletedAt       *time.Time             `json:"completed_at,omitempty"`
	CreatedAt         time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

type TouchpointEvent struct {
	ID            uuid.UUID              `json:"id"`
	Type          string                 `json:"type"` // transaction, notification, login, support, etc.
	Channel       string                 `json:"channel"` // web, mobile, ussd, sms, email, etc.
	Action        string                 `json:"action"` // view, click, submit, complete, etc.
	Status        string                 `json:"status"` // success, failed, pending
	Duration      int64                  `json:"duration_ms"`
	ResponseTime  int64                  `json:"response_time_ms"`
	
	// Context
	Page          string                 `json:"page,omitempty"`
	Feature       string                 `json:"feature,omitempty"`
	Amount        float64                `json:"amount,omitempty"`
	Currency      string                 `json:"currency,omitempty"`
	
	// Analytics
	Sentiment     string                 `json:"sentiment,omitempty"` // positive, neutral, negative
	Satisfaction  float64                `json:"satisfaction,omitempty"`
	Effort        float64                `json:"effort,omitempty"` // Customer effort score
	
	// Technical Details
	UserAgent     string                 `json:"user_agent,omitempty"`
	IPAddress     string                 `json:"ip_address,omitempty"`
	Location      LocationInfo           `json:"location,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	Timestamp     time.Time              `json:"timestamp"`
}

type JourneyAction struct {
	ID              uuid.UUID              `json:"id"`
	ActionType      string                 `json:"action_type"` // recommended, triggered, manual
	ActionName      string                 `json:"action_name"`
	Description     string                 `json:"description"`
	Status          string                 `json:"status"` // pending, completed, failed, skipped
	Priority        int                    `json:"priority"` // 1-10
	
	// Execution Details
	TriggerCondition string                `json:"trigger_condition,omitempty"`
	ExecutedAt      *time.Time             `json:"executed_at,omitempty"`
	CompletedAt     *time.Time             `json:"completed_at,omitempty"`
	ExecutionTime   int64                  `json:"execution_time_ms,omitempty"`
	
	// Results
	Success         bool                   `json:"success"`
	ErrorMessage    string                 `json:"error_message,omitempty"`
	Impact          string                 `json:"impact,omitempty"` // high, medium, low
	Outcome         string                 `json:"outcome,omitempty"`
	
	// Analytics
	EngagementScore float64                `json:"engagement_score,omitempty"`
	ConversionRate  float64                `json:"conversion_rate,omitempty"`
	
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt       time.Time              `json:"created_at"`
}

type LocationInfo struct {
	Country     string  `json:"country"`
	State       string  `json:"state"`
	City        string  `json:"city"`
	Region      string  `json:"region"`
	Timezone    string  `json:"timezone"`
	Latitude    float64 `json:"latitude,omitempty"`
	Longitude   float64 `json:"longitude,omitempty"`
	IsUrban     bool    `json:"is_urban"`
}

// Journey Stage Definitions
type JourneyStage struct {
	Name            string                 `json:"name"`
	Description     string                 `json:"description"`
	ExpectedActions []string               `json:"expected_actions"`
	SuccessCriteria []string               `json:"success_criteria"`
	NextStages      []string               `json:"next_stages"`
	AverageTime     time.Duration          `json:"average_time"`
	CompletionRate  float64                `json:"completion_rate"`
	CommonExitPoints []string              `json:"common_exit_points"`
}

// Journey Templates for different types
var JourneyTemplates = map[string][]JourneyStage{
	"onboarding": {
		{
			Name:            "registration",
			Description:     "Customer account registration",
			ExpectedActions: []string{"provide_personal_info", "verify_phone", "verify_email"},
			SuccessCriteria: []string{"account_created", "phone_verified"},
			NextStages:      []string{"kyc_verification"},
			AverageTime:     10 * time.Minute,
			CompletionRate:  0.85,
		},
		{
			Name:            "kyc_verification",
			Description:     "Know Your Customer verification",
			ExpectedActions: []string{"upload_id", "verify_bvn", "facial_verification"},
			SuccessCriteria: []string{"kyc_approved"},
			NextStages:      []string{"account_setup"},
			AverageTime:     30 * time.Minute,
			CompletionRate:  0.75,
		},
		{
			Name:            "account_setup",
			Description:     "Account configuration and setup",
			ExpectedActions: []string{"set_pin", "add_beneficiary", "enable_notifications"},
			SuccessCriteria: []string{"pin_set", "first_transaction_ready"},
			NextStages:      []string{"first_transaction"},
			AverageTime:     15 * time.Minute,
			CompletionRate:  0.90,
		},
		{
			Name:            "first_transaction",
			Description:     "Customer's first transaction",
			ExpectedActions: []string{"initiate_transaction", "confirm_transaction"},
			SuccessCriteria: []string{"transaction_completed"},
			NextStages:      []string{"active_usage"},
			AverageTime:     5 * time.Minute,
			CompletionRate:  0.95,
		},
		{
			Name:            "active_usage",
			Description:     "Regular active usage",
			ExpectedActions: []string{"regular_transactions", "explore_features"},
			SuccessCriteria: []string{"weekly_activity", "feature_adoption"},
			NextStages:      []string{"loyal_customer"},
			AverageTime:     30 * 24 * time.Hour, // 30 days
			CompletionRate:  0.60,
		},
	},
	"transaction": {
		{
			Name:            "initiation",
			Description:     "Transaction initiation",
			ExpectedActions: []string{"select_transaction_type", "enter_amount", "select_recipient"},
			SuccessCriteria: []string{"transaction_details_complete"},
			NextStages:      []string{"verification"},
			AverageTime:     2 * time.Minute,
			CompletionRate:  0.95,
		},
		{
			Name:            "verification",
			Description:     "Transaction verification and authentication",
			ExpectedActions: []string{"enter_pin", "biometric_auth", "otp_verification"},
			SuccessCriteria: []string{"authentication_successful"},
			NextStages:      []string{"processing"},
			AverageTime:     1 * time.Minute,
			CompletionRate:  0.90,
		},
		{
			Name:            "processing",
			Description:     "Transaction processing",
			ExpectedActions: []string{"fraud_check", "balance_check", "execute_transaction"},
			SuccessCriteria: []string{"transaction_processed"},
			NextStages:      []string{"completion"},
			AverageTime:     30 * time.Second,
			CompletionRate:  0.98,
		},
		{
			Name:            "completion",
			Description:     "Transaction completion and confirmation",
			ExpectedActions: []string{"send_confirmation", "update_balance", "generate_receipt"},
			SuccessCriteria: []string{"confirmation_sent", "receipt_generated"},
			NextStages:      []string{"post_transaction"},
			AverageTime:     10 * time.Second,
			CompletionRate:  0.99,
		},
		{
			Name:            "post_transaction",
			Description:     "Post-transaction activities",
			ExpectedActions: []string{"rate_experience", "view_receipt", "share_receipt"},
			SuccessCriteria: []string{"feedback_collected"},
			NextStages:      []string{},
			AverageTime:     2 * time.Minute,
			CompletionRate:  0.30,
		},
	},
	"support": {
		{
			Name:            "issue_identification",
			Description:     "Customer identifies and reports issue",
			ExpectedActions: []string{"describe_issue", "select_category", "provide_details"},
			SuccessCriteria: []string{"issue_categorized"},
			NextStages:      []string{"initial_response"},
			AverageTime:     5 * time.Minute,
			CompletionRate:  0.85,
		},
		{
			Name:            "initial_response",
			Description:     "Initial support response",
			ExpectedActions: []string{"acknowledge_issue", "provide_ticket_id", "estimate_resolution"},
			SuccessCriteria: []string{"response_provided"},
			NextStages:      []string{"investigation"},
			AverageTime:     15 * time.Minute,
			CompletionRate:  0.95,
		},
		{
			Name:            "investigation",
			Description:     "Issue investigation and diagnosis",
			ExpectedActions: []string{"analyze_issue", "gather_information", "identify_solution"},
			SuccessCriteria: []string{"solution_identified"},
			NextStages:      []string{"resolution"},
			AverageTime:     2 * time.Hour,
			CompletionRate:  0.80,
		},
		{
			Name:            "resolution",
			Description:     "Issue resolution implementation",
			ExpectedActions: []string{"implement_solution", "test_solution", "notify_customer"},
			SuccessCriteria: []string{"issue_resolved"},
			NextStages:      []string{"follow_up"},
			AverageTime:     1 * time.Hour,
			CompletionRate:  0.90,
		},
		{
			Name:            "follow_up",
			Description:     "Post-resolution follow-up",
			ExpectedActions: []string{"confirm_resolution", "collect_feedback", "close_ticket"},
			SuccessCriteria: []string{"customer_satisfied", "ticket_closed"},
			NextStages:      []string{},
			AverageTime:     30 * time.Minute,
			CompletionRate:  0.70,
		},
	},
}

// Journey Engine - Core journey tracking logic
type JourneyEngine struct {
	db             *gorm.DB
	logger         *logrus.Logger
	analyticsClient AnalyticsClient
}

func NewJourneyEngine(db *gorm.DB, logger *logrus.Logger, analyticsClient AnalyticsClient) *JourneyEngine {
	return &JourneyEngine{
		db:             db,
		logger:         logger,
		analyticsClient: analyticsClient,
	}
}

// Start a new customer journey
func (je *JourneyEngine) StartJourney(ctx context.Context, req *StartJourneyRequest) (*CustomerJourney, error) {
	// Get customer analytics context
	analytics, err := je.analyticsClient.GetCustomerAnalysis(ctx, req.CustomerID)
	if err != nil {
		je.logger.WithError(err).Warn("Failed to get customer analytics for journey")
	}
	
	// Create journey record
	journey := &CustomerJourney{
		ID:           uuid.New(),
		CustomerID:   req.CustomerID,
		JourneyID:    fmt.Sprintf("%s_%s_%d", req.JourneyType, req.CustomerID.String()[:8], time.Now().Unix()),
		CurrentStage: je.getInitialStage(req.JourneyType),
		JourneyType:  req.JourneyType,
		Status:       "active",
		Progress:     0.0,
		
		// Context
		EntryPoint:   req.EntryPoint,
		Channel:      req.Channel,
		Device:       req.Device,
		Location:     req.Location,
		SessionID:    req.SessionID,
		
		// Analytics
		CustomerSegment:  getStringFromAnalytics(analytics, "segment"),
		ChurnRisk:       getStringFromAnalytics(analytics, "churn_risk"),
		CLVCategory:     getStringFromAnalytics(analytics, "clv_category"),
		RiskScore:       getFloatFromAnalytics(analytics, "risk_score"),
		EngagementScore: getFloatFromAnalytics(analytics, "engagement_score"),
		
		// Initialize collections
		Touchpoints: []TouchpointEvent{},
		Actions:     []JourneyAction{},
		Metadata:    req.Metadata,
		
		// Timestamps
		StartedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
	
	// Calculate initial predictions
	journey.CompletionProbability = je.calculateCompletionProbability(journey)
	journey.ChurnProbability = getFloatFromAnalytics(analytics, "churn_probability")
	journey.NextBestAction = je.determineNextBestAction(journey)
	journey.PredictedOutcome = je.predictJourneyOutcome(journey)
	
	// Save to database
	if err := je.db.Create(journey).Error; err != nil {
		return nil, fmt.Errorf("failed to create journey: %w", err)
	}
	
	// Record journey start event
	startEvent := TouchpointEvent{
		ID:        uuid.New(),
		Type:      "journey_start",
		Channel:   req.Channel,
		Action:    "start",
		Status:    "success",
		Location:  req.Location,
		Metadata:  map[string]interface{}{"journey_type": req.JourneyType},
		Timestamp: time.Now(),
	}
	
	if err := je.AddTouchpoint(ctx, journey.ID, startEvent); err != nil {
		je.logger.WithError(err).Error("Failed to add journey start touchpoint")
	}
	
	// Record metrics
	journeyStartsTotal.WithLabelValues(req.JourneyType, journey.CustomerSegment, req.Channel).Inc()
	
	je.logger.WithFields(logrus.Fields{
		"journey_id":       journey.ID,
		"customer_id":      journey.CustomerID,
		"journey_type":     journey.JourneyType,
		"current_stage":    journey.CurrentStage,
		"customer_segment": journey.CustomerSegment,
		"entry_point":      journey.EntryPoint,
	}).Info("Customer journey started")
	
	return journey, nil
}

type StartJourneyRequest struct {
	CustomerID   uuid.UUID              `json:"customer_id" binding:"required"`
	JourneyType  string                 `json:"journey_type" binding:"required"`
	EntryPoint   string                 `json:"entry_point" binding:"required"`
	Channel      string                 `json:"channel" binding:"required"`
	Device       string                 `json:"device"`
	Location     LocationInfo           `json:"location"`
	SessionID    string                 `json:"session_id"`
	Metadata     map[string]interface{} `json:"metadata"`
}

// Add touchpoint to journey
func (je *JourneyEngine) AddTouchpoint(ctx context.Context, journeyID uuid.UUID, touchpoint TouchpointEvent) error {
	var journey CustomerJourney
	if err := je.db.Where("id = ?", journeyID).First(&journey).Error; err != nil {
		return fmt.Errorf("journey not found: %w", err)
	}
	
	// Set touchpoint ID if not provided
	if touchpoint.ID == uuid.Nil {
		touchpoint.ID = uuid.New()
	}
	
	// Set timestamp if not provided
	if touchpoint.Timestamp.IsZero() {
		touchpoint.Timestamp = time.Now()
	}
	
	// Add to journey touchpoints
	journey.Touchpoints = append(journey.Touchpoints, touchpoint)
	journey.TotalTouchpoints++
	journey.LastActivityAt = time.Now()
	
	// Update journey metrics based on touchpoint
	if touchpoint.Status == "success" {
		journey.CompletedActions++
	} else if touchpoint.Status == "failed" {
		journey.FailedActions++
	}
	
	// Update average response time
	if touchpoint.ResponseTime > 0 {
		totalResponseTime := journey.AverageResponseTime * float64(journey.TotalTouchpoints-1)
		journey.AverageResponseTime = (totalResponseTime + float64(touchpoint.ResponseTime)) / float64(journey.TotalTouchpoints)
	}
	
	// Check if touchpoint triggers stage progression
	if je.shouldProgressStage(journey, touchpoint) {
		newStage := je.determineNextStage(journey, touchpoint)
		if newStage != "" && newStage != journey.CurrentStage {
			journey.PreviousStage = journey.CurrentStage
			journey.CurrentStage = newStage
			journey.Progress = je.calculateProgress(journey)
			
			je.logger.WithFields(logrus.Fields{
				"journey_id":     journey.ID,
				"customer_id":    journey.CustomerID,
				"previous_stage": journey.PreviousStage,
				"current_stage":  journey.CurrentStage,
				"progress":       journey.Progress,
			}).Info("Journey stage progression")
			
			// Record stage progression metric
			journeyStageProgressions.WithLabelValues(
				journey.JourneyType,
				journey.PreviousStage,
				journey.CurrentStage,
				journey.CustomerSegment,
			).Inc()
		}
	}
	
	// Update predictions
	journey.CompletionProbability = je.calculateCompletionProbability(&journey)
	journey.NextBestAction = je.determineNextBestAction(&journey)
	journey.PredictedOutcome = je.predictJourneyOutcome(&journey)
	
	// Check for journey completion
	if je.isJourneyComplete(&journey) {
		journey.Status = "completed"
		journey.Progress = 100.0
		completedAt := time.Now()
		journey.CompletedAt = &completedAt
		
		// Record completion metric
		journeyCompletions.WithLabelValues(
			journey.JourneyType,
			journey.CustomerSegment,
			journey.CurrentStage,
		).Inc()
		
		// Record journey duration
		duration := completedAt.Sub(journey.StartedAt)
		journeyDuration.WithLabelValues(
			journey.JourneyType,
			journey.CustomerSegment,
		).Observe(duration.Seconds())
	}
	
	// Save updated journey
	if err := je.db.Save(&journey).Error; err != nil {
		return fmt.Errorf("failed to update journey: %w", err)
	}
	
	// Record touchpoint metric
	touchpointEvents.WithLabelValues(
		touchpoint.Type,
		touchpoint.Channel,
		touchpoint.Action,
		touchpoint.Status,
		journey.CustomerSegment,
	).Inc()
	
	je.logger.WithFields(logrus.Fields{
		"journey_id":      journey.ID,
		"touchpoint_id":   touchpoint.ID,
		"touchpoint_type": touchpoint.Type,
		"channel":         touchpoint.Channel,
		"action":          touchpoint.Action,
		"status":          touchpoint.Status,
	}).Info("Touchpoint added to journey")
	
	return nil
}

// Helper functions for journey engine
func (je *JourneyEngine) getInitialStage(journeyType string) string {
	if template, exists := JourneyTemplates[journeyType]; exists && len(template) > 0 {
		return template[0].Name
	}
	return "initial"
}

func (je *JourneyEngine) shouldProgressStage(journey CustomerJourney, touchpoint TouchpointEvent) bool {
	// Check if touchpoint indicates stage completion
	if touchpoint.Status != "success" {
		return false
	}
	
	// Get current stage template
	template := JourneyTemplates[journey.JourneyType]
	for _, stage := range template {
		if stage.Name == journey.CurrentStage {
			// Check if touchpoint action is in expected actions
			for _, expectedAction := range stage.ExpectedActions {
				if touchpoint.Action == expectedAction {
					return true
				}
			}
			
			// Check success criteria
			for _, criteria := range stage.SuccessCriteria {
				if touchpoint.Type == criteria || touchpoint.Action == criteria {
					return true
				}
			}
		}
	}
	
	return false
}

func (je *JourneyEngine) determineNextStage(journey CustomerJourney, touchpoint TouchpointEvent) string {
	template := JourneyTemplates[journey.JourneyType]
	for _, stage := range template {
		if stage.Name == journey.CurrentStage && len(stage.NextStages) > 0 {
			// For now, return the first next stage
			// In a more sophisticated implementation, this could be based on touchpoint analysis
			return stage.NextStages[0]
		}
	}
	return journey.CurrentStage
}

func (je *JourneyEngine) calculateProgress(journey CustomerJourney) float64 {
	template := JourneyTemplates[journey.JourneyType]
	if len(template) == 0 {
		return 0.0
	}
	
	// Find current stage index
	currentIndex := -1
	for i, stage := range template {
		if stage.Name == journey.CurrentStage {
			currentIndex = i
			break
		}
	}
	
	if currentIndex == -1 {
		return 0.0
	}
	
	// Calculate progress as percentage through stages
	return (float64(currentIndex) / float64(len(template))) * 100.0
}

func (je *JourneyEngine) calculateCompletionProbability(journey *CustomerJourney) float64 {
	// Base probability from customer segment
	baseProbability := 0.5
	
	switch journey.CustomerSegment {
	case "Premium":
		baseProbability = 0.8
	case "Active":
		baseProbability = 0.7
	case "New":
		baseProbability = 0.6
	case "At Risk":
		baseProbability = 0.3
	case "Dormant":
		baseProbability = 0.2
	case "Lost":
		baseProbability = 0.1
	}
	
	// Adjust based on current progress
	progressFactor := journey.Progress / 100.0
	baseProbability = baseProbability + (progressFactor * 0.3)
	
	// Adjust based on success rate
	if journey.TotalTouchpoints > 0 {
		successRate := float64(journey.CompletedActions) / float64(journey.TotalTouchpoints)
		baseProbability = baseProbability * successRate
	}
	
	// Adjust based on journey type completion rates
	if template, exists := JourneyTemplates[journey.JourneyType]; exists {
		for _, stage := range template {
			if stage.Name == journey.CurrentStage {
				baseProbability = baseProbability * stage.CompletionRate
				break
			}
		}
	}
	
	// Cap at reasonable bounds
	if baseProbability > 0.95 {
		baseProbability = 0.95
	}
	if baseProbability < 0.05 {
		baseProbability = 0.05
	}
	
	return baseProbability
}

func (je *JourneyEngine) determineNextBestAction(journey *CustomerJourney) string {
	// Get current stage template
	template := JourneyTemplates[journey.JourneyType]
	for _, stage := range template {
		if stage.Name == journey.CurrentStage {
			// Return the first expected action that hasn't been completed
			for _, expectedAction := range stage.ExpectedActions {
				if !je.hasCompletedAction(journey, expectedAction) {
					return expectedAction
				}
			}
		}
	}
	
	// Fallback based on customer segment and journey type
	return je.getSegmentBasedAction(journey)
}

func (je *JourneyEngine) hasCompletedAction(journey *CustomerJourney, action string) bool {
	for _, touchpoint := range journey.Touchpoints {
		if touchpoint.Action == action && touchpoint.Status == "success" {
			return true
		}
	}
	return false
}

func (je *JourneyEngine) getSegmentBasedAction(journey *CustomerJourney) string {
	switch journey.CustomerSegment {
	case "Premium":
		return "offer_premium_service"
	case "At Risk":
		return "provide_support"
	case "New":
		return "guide_next_step"
	case "Dormant":
		return "re_engage"
	default:
		return "continue_journey"
	}
}

func (je *JourneyEngine) predictJourneyOutcome(journey *CustomerJourney) string {
	probability := journey.CompletionProbability
	
	if probability >= 0.8 {
		return "likely_success"
	} else if probability >= 0.6 {
		return "probable_success"
	} else if probability >= 0.4 {
		return "uncertain"
	} else if probability >= 0.2 {
		return "at_risk"
	} else {
		return "likely_abandonment"
	}
}

func (je *JourneyEngine) isJourneyComplete(journey *CustomerJourney) bool {
	// Check if we're at the final stage
	template := JourneyTemplates[journey.JourneyType]
	if len(template) == 0 {
		return false
	}
	
	finalStage := template[len(template)-1]
	if journey.CurrentStage != finalStage.Name {
		return false
	}
	
	// Check if all success criteria are met
	for _, criteria := range finalStage.SuccessCriteria {
		found := false
		for _, touchpoint := range journey.Touchpoints {
			if (touchpoint.Type == criteria || touchpoint.Action == criteria) && touchpoint.Status == "success" {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	return true
}

// Analytics client interface for journey service
type AnalyticsClient interface {
	GetCustomerAnalysis(ctx context.Context, customerID uuid.UUID) (map[string]interface{}, error)
}

// Helper functions for analytics data extraction
func getStringFromAnalytics(analytics map[string]interface{}, key string) string {
	if analytics == nil {
		return ""
	}
	if value, exists := analytics[key]; exists {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return ""
}

func getFloatFromAnalytics(analytics map[string]interface{}, key string) float64 {
	if analytics == nil {
		return 0.0
	}
	if value, exists := analytics[key]; exists {
		if f, ok := value.(float64); ok {
			return f
		}
	}
	return 0.0
}

// Prometheus metrics
var (
	journeyStartsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_journey_starts_total",
			Help: "Total number of customer journeys started",
		},
		[]string{"journey_type", "customer_segment", "channel"},
	)
	
	journeyCompletions = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_journey_completions_total",
			Help: "Total number of customer journeys completed",
		},
		[]string{"journey_type", "customer_segment", "final_stage"},
	)
	
	journeyStageProgressions = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_journey_stage_progressions_total",
			Help: "Total number of journey stage progressions",
		},
		[]string{"journey_type", "from_stage", "to_stage", "customer_segment"},
	)
	
	touchpointEvents = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_journey_touchpoint_events_total",
			Help: "Total number of touchpoint events",
		},
		[]string{"type", "channel", "action", "status", "customer_segment"},
	)
	
	journeyDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "customer_journey_duration_seconds",
			Help: "Duration of customer journeys",
		},
		[]string{"journey_type", "customer_segment"},
	)
	
	journeyCompletionProbability = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "customer_journey_completion_probability",
			Help: "Journey completion probability scores",
		},
		[]string{"journey_type", "customer_segment", "current_stage"},
	)
)

func init() {
	prometheus.MustRegister(
		journeyStartsTotal,
		journeyCompletions,
		journeyStageProgressions,
		touchpointEvents,
		journeyDuration,
		journeyCompletionProbability,
	)
}

// Main service setup
func main() {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetLevel(logrus.InfoLevel)
	
	// Database connection
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=banking_user password=banking_pass dbname=remittance port=5432 sslmode=disable"
	}
	
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.New(log.New(os.Stdout, "\r\n", log.LstdFlags), logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Silent,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		}),
	})
	
	if err != nil {
		logger.WithError(err).Fatal("Failed to connect to database")
	}
	
	// Auto-migrate schemas
	if err := db.AutoMigrate(&CustomerJourney{}); err != nil {
		logger.WithError(err).Fatal("Failed to migrate database")
	}
	
	// Initialize services
	analyticsClient := NewSimpleAnalyticsClient(logger)
	journeyEngine := NewJourneyEngine(db, logger, analyticsClient)
	
	// Initialize service
	service := &CustomerJourneyService{
		db:              db,
		logger:          logger,
		analyticsClient: analyticsClient,
		journeyEngine:   journeyEngine,
	}
	
	// Setup routes
	router := gin.Default()
	SetupJourneyRoutes(router, service, logger)
	
	// Metrics endpoint
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "customer-journey",
			"timestamp": time.Now(),
		})
	})
	
	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	logger.WithField("port", port).Info("Starting Customer Journey Service")
	
	if err := router.Run(":" + port); err != nil {
		logger.WithError(err).Fatal("Failed to start server")
	}
}

// Simple analytics client implementation
type SimpleAnalyticsClient struct {
	logger *logrus.Logger
}

func NewSimpleAnalyticsClient(logger *logrus.Logger) AnalyticsClient {
	return &SimpleAnalyticsClient{logger: logger}
}

func (c *SimpleAnalyticsClient) GetCustomerAnalysis(ctx context.Context, customerID uuid.UUID) (map[string]interface{}, error) {
	// Simulate analytics data
	// In a real implementation, this would call the actual analytics service
	return map[string]interface{}{
		"segment":              "Active",
		"churn_risk":          "Low",
		"clv_category":        "Medium",
		"risk_score":          0.2,
		"engagement_score":    0.7,
		"churn_probability":   0.15,
	}, nil
}

