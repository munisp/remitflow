package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// AMLMonitoringInput represents input for AML transaction monitoring
type AMLMonitoringInput struct {
	TransactionID     string          `json:"transaction_id"`
	UserID            models.UserID   `json:"user_id"`
	TransactionType   string          `json:"transaction_type"` // transfer, withdrawal, deposit
	Amount            decimal.Decimal `json:"amount"`
	Currency          string          `json:"currency"`
	SenderCountry     string          `json:"sender_country"`
	RecipientCountry  string          `json:"recipient_country,omitempty"`
	RecipientName     string          `json:"recipient_name,omitempty"`
	RecipientAccount  string          `json:"recipient_account,omitempty"`
	Purpose           string          `json:"purpose,omitempty"`
	Metadata          map[string]interface{} `json:"metadata,omitempty"`
}

// AMLMonitoringResult represents the workflow result
type AMLMonitoringResult struct {
	Success             bool                   `json:"success"`
	TransactionID       string                 `json:"transaction_id"`
	RiskScore           decimal.Decimal        `json:"risk_score"`
	RiskLevel           string                 `json:"risk_level"` // low, medium, high, critical
	AMLChecks           map[string]interface{} `json:"aml_checks"`
	SanctionsCheck      map[string]interface{} `json:"sanctions_check"`
	PEPCheck            map[string]interface{} `json:"pep_check"`
	VelocityCheck       map[string]interface{} `json:"velocity_check"`
	PatternAnalysis     map[string]interface{} `json:"pattern_analysis"`
	Action              string                 `json:"action"` // approve, hold, reject, review
	Flags               []string               `json:"flags,omitempty"`
	RecommendedAction   string                 `json:"recommended_action,omitempty"`
	ComplianceOfficer   string                 `json:"compliance_officer,omitempty"`
	SARFiled            bool                   `json:"sar_filed"` // Suspicious Activity Report
	Message             string                 `json:"message"`
	CompletedAt         time.Time              `json:"completed_at"`
}

// AMLMonitoringWorkflow implements Journey 27: AML Transaction Monitoring
//
// Anti-Money Laundering (AML) Compliance:
// - Real-time transaction screening
// - Sanctions list checking (OFAC, UN, EU)
// - PEP (Politically Exposed Persons) screening
// - Velocity checks (transaction patterns)
// - Behavioral analysis (AI/ML)
// - Automated SAR filing
//
// Steps:
// 1. Retrieve user profile and transaction history
// 2. Check sanctions lists (OFAC, UN, EU)
// 3. Check PEP (Politically Exposed Persons) database
// 4. Perform velocity checks (transaction patterns)
// 5. Analyze transaction patterns (AI/ML)
// 6. Check high-risk countries
// 7. Perform structuring detection
// 8. Calculate composite risk score
// 9. Determine action (approve/hold/reject/review)
// 10. File SAR if required
// 11. Update compliance records
// 12. Send notifications
// 13. Log to analytics
func AMLMonitoringWorkflow(ctx workflow.Context, input AMLMonitoringInput) (*AMLMonitoringResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("AMLMonitoringWorkflow started",
		"transaction_id", input.TransactionID,
		"user_id", input.UserID,
		"amount", input.Amount)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    2 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &AMLMonitoringResult{
		Success:       false,
		TransactionID: input.TransactionID,
		AMLChecks:     make(map[string]interface{}),
		Flags:         make([]string, 0),
	}

	// Step 1: Retrieve user profile and transaction history
	logger.Info("Step 1: Retrieving user profile")
	var userProfile activities.UserProfileResult
	err := workflow.ExecuteActivity(ctx, activities.GetUserProfile, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &userProfile)

	if err != nil {
		return nil, err
	}

	logger.Info("User profile retrieved",
		"kyc_tier", userProfile.KYCTier,
		"account_age_days", userProfile.AccountAgeDays)

	// Step 2: Check sanctions lists (OFAC, UN, EU)
	logger.Info("Step 2: Checking sanctions lists")
	var sanctionsCheck activities.SanctionsCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckSanctionsList, map[string]interface{}{
		"user_id":           input.UserID,
		"full_name":         userProfile.FullName,
		"date_of_birth":     userProfile.DateOfBirth,
		"country":           input.SenderCountry,
		"recipient_name":    input.RecipientName,
		"recipient_country": input.RecipientCountry,
	}).Get(ctx, &sanctionsCheck)

	if err != nil {
		return nil, err
	}

	result.SanctionsCheck = map[string]interface{}{
		"user_match":      sanctionsCheck.UserMatch,
		"recipient_match": sanctionsCheck.RecipientMatch,
		"lists_checked":   sanctionsCheck.ListsChecked,
		"confidence":      sanctionsCheck.Confidence,
	}

	if sanctionsCheck.UserMatch || sanctionsCheck.RecipientMatch {
		result.Flags = append(result.Flags, "SANCTIONS_LIST_MATCH")
		result.Action = "reject"
		result.Message = "Transaction blocked: Sanctions list match detected"
		
		logger.Error("Sanctions list match detected")
		
		// File SAR immediately
		_ = workflow.ExecuteActivity(ctx, activities.FileSuspiciousActivityReport, map[string]interface{}{
			"transaction_id": input.TransactionID,
			"user_id":        input.UserID,
			"reason":         "Sanctions list match",
			"severity":       "critical",
		}).Get(ctx, nil)
		
		result.SARFiled = true
		return result, nil
	}

	logger.Info("Sanctions check passed")

	// Step 3: Check PEP (Politically Exposed Persons) database
	logger.Info("Step 3: Checking PEP database")
	var pepCheck activities.PEPCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckPEPDatabase, map[string]interface{}{
		"user_id":           input.UserID,
		"full_name":         userProfile.FullName,
		"date_of_birth":     userProfile.DateOfBirth,
		"country":           input.SenderCountry,
		"recipient_name":    input.RecipientName,
		"recipient_country": input.RecipientCountry,
	}).Get(ctx, &pepCheck)

	if err != nil {
		return nil, err
	}

	result.PEPCheck = map[string]interface{}{
		"user_pep":      pepCheck.UserPEP,
		"recipient_pep": pepCheck.RecipientPEP,
		"pep_level":     pepCheck.PEPLevel,
		"confidence":    pepCheck.Confidence,
	}

	if pepCheck.UserPEP || pepCheck.RecipientPEP {
		result.Flags = append(result.Flags, "PEP_DETECTED")
		logger.Info("PEP detected", "level", pepCheck.PEPLevel)
	}

	// Step 4: Perform velocity checks (transaction patterns)
	logger.Info("Step 4: Performing velocity checks")
	var velocityCheck activities.VelocityCheckResult
	err = workflow.ExecuteActivity(ctx, activities.PerformVelocityCheck, map[string]interface{}{
		"user_id":          input.UserID,
		"transaction_type": input.TransactionType,
		"amount":           input.Amount,
		"currency":         input.Currency,
		"time_window":      "24h",
	}).Get(ctx, &velocityCheck)

	if err != nil {
		return nil, err
	}

	result.VelocityCheck = map[string]interface{}{
		"transaction_count_24h": velocityCheck.TransactionCount24h,
		"total_amount_24h":      velocityCheck.TotalAmount24h,
		"unusual_velocity":      velocityCheck.UnusualVelocity,
		"velocity_score":        velocityCheck.VelocityScore,
	}

	if velocityCheck.UnusualVelocity {
		result.Flags = append(result.Flags, "UNUSUAL_VELOCITY")
		logger.Info("Unusual transaction velocity detected")
	}

	// Step 5: Analyze transaction patterns (AI/ML)
	logger.Info("Step 5: Analyzing transaction patterns with AI")
	var patternAnalysis activities.PatternAnalysisResult
	err = workflow.ExecuteActivity(ctx, activities.AnalyzeTransactionPatterns, map[string]interface{}{
		"user_id":            input.UserID,
		"transaction_id":     input.TransactionID,
		"amount":             input.Amount,
		"currency":           input.Currency,
		"transaction_type":   input.TransactionType,
		"sender_country":     input.SenderCountry,
		"recipient_country":  input.RecipientCountry,
		"purpose":            input.Purpose,
		"user_history":       userProfile.TransactionHistory,
	}).Get(ctx, &patternAnalysis)

	if err != nil {
		return nil, err
	}

	result.PatternAnalysis = map[string]interface{}{
		"anomaly_detected":  patternAnalysis.AnomalyDetected,
		"anomaly_score":     patternAnalysis.AnomalyScore,
		"pattern_type":      patternAnalysis.PatternType,
		"confidence":        patternAnalysis.Confidence,
		"similar_cases":     patternAnalysis.SimilarCases,
	}

	if patternAnalysis.AnomalyDetected {
		result.Flags = append(result.Flags, "ANOMALOUS_PATTERN")
		logger.Info("Anomalous transaction pattern detected", "type", patternAnalysis.PatternType)
	}

	// Step 6: Check high-risk countries
	logger.Info("Step 6: Checking high-risk countries")
	var countryRisk activities.CountryRiskResult
	err = workflow.ExecuteActivity(ctx, activities.CheckHighRiskCountries, map[string]interface{}{
		"sender_country":    input.SenderCountry,
		"recipient_country": input.RecipientCountry,
	}).Get(ctx, &countryRisk)

	if err != nil {
		return nil, err
	}

	if countryRisk.HighRisk {
		result.Flags = append(result.Flags, "HIGH_RISK_COUNTRY")
		logger.Info("High-risk country detected", "country", countryRisk.Country, "risk_level", countryRisk.RiskLevel)
	}

	// Step 7: Perform structuring detection
	logger.Info("Step 7: Detecting structuring")
	var structuringCheck activities.StructuringCheckResult
	err = workflow.ExecuteActivity(ctx, activities.DetectStructuring, map[string]interface{}{
		"user_id":          input.UserID,
		"amount":           input.Amount,
		"currency":         input.Currency,
		"transaction_type": input.TransactionType,
		"time_window":      "7d",
	}).Get(ctx, &structuringCheck)

	if err != nil {
		return nil, err
	}

	if structuringCheck.StructuringDetected {
		result.Flags = append(result.Flags, "STRUCTURING_DETECTED")
		logger.Info("Structuring detected", "pattern", structuringCheck.Pattern)
	}

	// Step 8: Calculate composite risk score
	logger.Info("Step 8: Calculating composite risk score")
	var riskScore activities.AMLRiskScoreResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateAMLRiskScore, map[string]interface{}{
		"sanctions_match":     sanctionsCheck.UserMatch || sanctionsCheck.RecipientMatch,
		"pep_detected":        pepCheck.UserPEP || pepCheck.RecipientPEP,
		"unusual_velocity":    velocityCheck.UnusualVelocity,
		"anomaly_detected":    patternAnalysis.AnomalyDetected,
		"high_risk_country":   countryRisk.HighRisk,
		"structuring":         structuringCheck.StructuringDetected,
		"amount":              input.Amount,
		"currency":            input.Currency,
		"kyc_tier":            userProfile.KYCTier,
		"account_age_days":    userProfile.AccountAgeDays,
	}).Get(ctx, &riskScore)

	if err != nil {
		return nil, err
	}

	result.RiskScore = riskScore.Score
	result.RiskLevel = riskScore.Level

	logger.Info("Risk score calculated", "score", riskScore.Score, "level", riskScore.Level)

	// Step 9: Determine action (approve/hold/reject/review)
	logger.Info("Step 9: Determining action")
	
	// Risk thresholds
	lowRiskThreshold := decimal.NewFromFloat(0.3)
	mediumRiskThreshold := decimal.NewFromFloat(0.6)
	highRiskThreshold := decimal.NewFromFloat(0.8)

	if result.RiskScore.LessThan(lowRiskThreshold) {
		result.Action = "approve"
		result.Message = "Transaction approved - low risk"
	} else if result.RiskScore.LessThan(mediumRiskThreshold) {
		result.Action = "approve"
		result.Message = "Transaction approved - medium risk (monitored)"
		result.Flags = append(result.Flags, "ENHANCED_MONITORING")
	} else if result.RiskScore.LessThan(highRiskThreshold) {
		result.Action = "hold"
		result.Message = "Transaction held for review - high risk"
		result.RecommendedAction = "Manual review required"
	} else {
		result.Action = "review"
		result.Message = "Transaction flagged for compliance review - critical risk"
		result.RecommendedAction = "Immediate compliance officer review required"
		result.Flags = append(result.Flags, "CRITICAL_RISK")
	}

	logger.Info("Action determined", "action", result.Action, "risk_level", result.RiskLevel)

	// Step 10: File SAR if required
	if result.RiskScore.GreaterThanOrEqual(highRiskThreshold) || len(result.Flags) >= 3 {
		logger.Info("Step 10: Filing Suspicious Activity Report")
		
		var sarResult activities.SARResult
		err = workflow.ExecuteActivity(ctx, activities.FileSuspiciousActivityReport, map[string]interface{}{
			"transaction_id": input.TransactionID,
			"user_id":        input.UserID,
			"risk_score":     riskScore.Score,
			"risk_level":     riskScore.Level,
			"flags":          result.Flags,
			"amount":         input.Amount,
			"currency":       input.Currency,
			"details": map[string]interface{}{
				"sanctions_check":  result.SanctionsCheck,
				"pep_check":        result.PEPCheck,
				"velocity_check":   result.VelocityCheck,
				"pattern_analysis": result.PatternAnalysis,
			},
		}).Get(ctx, &sarResult)

		if err == nil && sarResult.Filed {
			result.SARFiled = true
			result.ComplianceOfficer = sarResult.AssignedOfficer
			logger.Info("SAR filed successfully", "sar_id", sarResult.SARID)
		}
	}

	// Step 11: Update compliance records
	logger.Info("Step 11: Updating compliance records")
	_ = workflow.ExecuteActivity(ctx, activities.UpdateComplianceRecords, map[string]interface{}{
		"transaction_id": input.TransactionID,
		"user_id":        input.UserID,
		"risk_score":     riskScore.Score,
		"risk_level":     riskScore.Level,
		"action":         result.Action,
		"flags":          result.Flags,
		"sar_filed":      result.SARFiled,
		"checks_performed": map[string]interface{}{
			"sanctions": result.SanctionsCheck,
			"pep":       result.PEPCheck,
			"velocity":  result.VelocityCheck,
			"pattern":   result.PatternAnalysis,
		},
	}).Get(ctx, nil)

	// Step 12: Send notifications
	logger.Info("Step 12: Sending notifications")
	
	if result.Action == "hold" || result.Action == "review" || result.SARFiled {
		// Notify compliance team
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": "compliance_team",
			"type":    "aml_alert",
			"channel": "email,slack",
			"data": map[string]interface{}{
				"transaction_id":  input.TransactionID,
				"user_id":         input.UserID,
				"risk_score":      riskScore.Score,
				"risk_level":      riskScore.Level,
				"action":          result.Action,
				"flags":           result.Flags,
				"sar_filed":       result.SARFiled,
				"amount":          input.Amount,
				"currency":        input.Currency,
			},
		}).Get(ctx, nil)
	}

	if result.Action == "reject" {
		// Notify user
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": input.UserID,
			"type":    "transaction_rejected",
			"channel": "email,push",
			"data": map[string]interface{}{
				"transaction_id": input.TransactionID,
				"reason":         "Compliance review required",
			},
		}).Get(ctx, nil)
	}

	// Step 13: Log to analytics
	logger.Info("Step 13: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "aml_monitoring",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"transaction_id":     input.TransactionID,
			"transaction_type":   input.TransactionType,
			"amount":             input.Amount,
			"currency":           input.Currency,
			"risk_score":         riskScore.Score,
			"risk_level":         riskScore.Level,
			"action":             result.Action,
			"flags_count":        len(result.Flags),
			"flags":              result.Flags,
			"sar_filed":          result.SARFiled,
			"sanctions_match":    sanctionsCheck.UserMatch || sanctionsCheck.RecipientMatch,
			"pep_detected":       pepCheck.UserPEP || pepCheck.RecipientPEP,
			"anomaly_detected":   patternAnalysis.AnomalyDetected,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.CompletedAt = time.Now()

	logger.Info("AMLMonitoringWorkflow completed successfully",
		"action", result.Action,
		"risk_level", result.RiskLevel)
	
	return result, nil
}
