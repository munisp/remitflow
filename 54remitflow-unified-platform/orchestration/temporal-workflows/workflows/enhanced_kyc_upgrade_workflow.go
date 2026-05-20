package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// EnhancedKYCUpgradeInput represents input for KYC tier upgrade
type EnhancedKYCUpgradeInput struct {
	UserID              models.UserID `json:"user_id"`
	CurrentTier         string        `json:"current_tier"`          // basic, standard
	TargetTier          string        `json:"target_tier"`           // standard, enhanced, premium
	DocumentType        string        `json:"document_type"`         // passport, drivers_license, national_id
	DocumentFrontImage  string        `json:"document_front_image"`  // Base64 or file path
	DocumentBackImage   string        `json:"document_back_image,omitempty"`
	SelfieImage         string        `json:"selfie_image"`
	ProofOfAddress      string        `json:"proof_of_address,omitempty"`      // For enhanced/premium
	SourceOfFunds       string        `json:"source_of_funds,omitempty"`       // For enhanced/premium
	VideoVerification   bool          `json:"video_verification"`              // For premium tier
	EmploymentDetails   map[string]interface{} `json:"employment_details,omitempty"`
	IncomeRange         string        `json:"income_range,omitempty"`
}

// EnhancedKYCUpgradeResult represents the workflow result
type EnhancedKYCUpgradeResult struct {
	Success              bool                   `json:"success"`
	VerificationID       string                 `json:"verification_id"`
	PreviousTier         string                 `json:"previous_tier"`
	NewTier              string                 `json:"new_tier"`
	DocumentVerification map[string]interface{} `json:"document_verification"`
	FaceMatch            map[string]interface{} `json:"face_match"`
	AddressVerification  map[string]interface{} `json:"address_verification,omitempty"`
	VideoVerification    map[string]interface{} `json:"video_verification,omitempty"`
	NewLimits            map[string]decimal.Decimal `json:"new_limits"`
	Status               string                 `json:"status"` // approved, pending_review, rejected
	RejectionReason      string                 `json:"rejection_reason,omitempty"`
	Message              string                 `json:"message"`
	CompletedAt          time.Time              `json:"completed_at"`
}

// EnhancedKYCUpgradeWorkflow implements Journey 26: Enhanced KYC Tier Upgrade
//
// KYC Tiers:
// - Basic: Phone + Email verification (₦50k daily limit)
// - Standard: ID + Selfie (₦500k daily limit)
// - Enhanced: ID + Selfie + Address + Source of Funds (₦5M daily limit)
// - Premium: All above + Video verification + Employment (₦50M daily limit)
//
// Steps:
// 1. Validate current tier and upgrade eligibility
// 2. Extract document data using DeepSeek-OCR
// 3. Verify document authenticity
// 4. Perform face matching (ArcFace)
// 5. Verify proof of address (if required)
// 6. Verify source of funds (if required)
// 7. Conduct video verification (if required)
// 8. Calculate risk score
// 9. Auto-approve or flag for manual review
// 10. Update user tier and limits
// 11. Send notification
// 12. Log to analytics
func EnhancedKYCUpgradeWorkflow(ctx workflow.Context, input EnhancedKYCUpgradeInput) (*EnhancedKYCUpgradeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("EnhancedKYCUpgradeWorkflow started",
		"user_id", input.UserID,
		"current_tier", input.CurrentTier,
		"target_tier", input.TargetTier)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    3 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &EnhancedKYCUpgradeResult{
		Success:      false,
		PreviousTier: input.CurrentTier,
		NewTier:      input.CurrentTier, // Default to current tier
	}

	// Step 1: Validate upgrade eligibility
	logger.Info("Step 1: Validating upgrade eligibility")
	var eligibility activities.KYCEligibilityResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateKYCUpgradeEligibility, map[string]interface{}{
		"user_id":      input.UserID,
		"current_tier": input.CurrentTier,
		"target_tier":  input.TargetTier,
	}).Get(ctx, &eligibility)

	if err != nil || !eligibility.Eligible {
		result.Status = "rejected"
		result.RejectionReason = eligibility.Reason
		result.Message = "Not eligible for tier upgrade: " + eligibility.Reason
		return result, nil
	}

	logger.Info("Upgrade eligibility confirmed")

	// Step 2: Extract document data using DeepSeek-OCR (Python AI/ML)
	logger.Info("Step 2: Extracting document data with OCR")
	var ocrResult activities.OCRResult
	err = workflow.ExecuteActivity(ctx, activities.ExtractDocumentDataOCR, map[string]interface{}{
		"document_type":  input.DocumentType,
		"front_image":    input.DocumentFrontImage,
		"back_image":     input.DocumentBackImage,
	}).Get(ctx, &ocrResult)

	if err != nil || !ocrResult.Success {
		result.Status = "rejected"
		result.RejectionReason = "Document OCR failed: " + ocrResult.ErrorMessage
		result.Message = "Unable to extract document data"
		return result, nil
	}

	logger.Info("Document data extracted",
		"document_number", ocrResult.DocumentNumber,
		"confidence", ocrResult.Confidence)

	result.DocumentVerification = map[string]interface{}{
		"document_type":   ocrResult.DocumentType,
		"document_number": ocrResult.DocumentNumber,
		"full_name":       ocrResult.FullName,
		"date_of_birth":   ocrResult.DateOfBirth,
		"expiry_date":     ocrResult.ExpiryDate,
		"confidence":      ocrResult.Confidence,
	}

	// Step 3: Verify document authenticity
	logger.Info("Step 3: Verifying document authenticity")
	var docVerification activities.DocumentVerificationResult
	err = workflow.ExecuteActivity(ctx, activities.VerifyDocumentAuthenticity, map[string]interface{}{
		"document_type":   input.DocumentType,
		"document_number": ocrResult.DocumentNumber,
		"document_data":   ocrResult.ExtractedData,
		"front_image":     input.DocumentFrontImage,
		"back_image":      input.DocumentBackImage,
	}).Get(ctx, &docVerification)

	if err != nil || !docVerification.Authentic {
		result.Status = "rejected"
		result.RejectionReason = "Document verification failed: " + docVerification.Reason
		result.Message = "Document authenticity could not be verified"
		return result, nil
	}

	logger.Info("Document verified as authentic", "confidence", docVerification.Confidence)

	// Step 4: Perform face matching (ArcFace AI/ML)
	logger.Info("Step 4: Performing face matching")
	var faceMatch activities.FaceMatchResult
	err = workflow.ExecuteActivity(ctx, activities.PerformFaceMatching, map[string]interface{}{
		"document_photo": ocrResult.PhotoFromDocument,
		"selfie_photo":   input.SelfieImage,
		"user_id":        input.UserID,
	}).Get(ctx, &faceMatch)

	if err != nil || !faceMatch.Match {
		result.Status = "rejected"
		result.RejectionReason = "Face matching failed: " + faceMatch.Reason
		result.Message = "Face does not match document photo"
		return result, nil
	}

	logger.Info("Face matching successful", "similarity", faceMatch.Similarity)

	result.FaceMatch = map[string]interface{}{
		"match":      faceMatch.Match,
		"similarity": faceMatch.Similarity,
		"confidence": faceMatch.Confidence,
	}

	// Step 5: Verify proof of address (for enhanced/premium tiers)
	if input.TargetTier == "enhanced" || input.TargetTier == "premium" {
		logger.Info("Step 5: Verifying proof of address")
		
		if input.ProofOfAddress == "" {
			result.Status = "rejected"
			result.RejectionReason = "Proof of address required for " + input.TargetTier + " tier"
			result.Message = "Missing proof of address"
			return result, nil
		}

		var addressVerification activities.AddressVerificationResult
		err = workflow.ExecuteActivity(ctx, activities.VerifyProofOfAddress, map[string]interface{}{
			"user_id":          input.UserID,
			"address_document": input.ProofOfAddress,
			"extracted_address": ocrResult.Address,
		}).Get(ctx, &addressVerification)

		if err != nil || !addressVerification.Verified {
			result.Status = "rejected"
			result.RejectionReason = "Address verification failed: " + addressVerification.Reason
			result.Message = "Unable to verify proof of address"
			return result, nil
		}

		logger.Info("Address verified", "confidence", addressVerification.Confidence)

		result.AddressVerification = map[string]interface{}{
			"verified":   addressVerification.Verified,
			"address":    addressVerification.Address,
			"confidence": addressVerification.Confidence,
		}
	}

	// Step 6: Verify source of funds (for enhanced/premium tiers)
	if input.TargetTier == "enhanced" || input.TargetTier == "premium" {
		logger.Info("Step 6: Verifying source of funds")
		
		if input.SourceOfFunds == "" {
			result.Status = "rejected"
			result.RejectionReason = "Source of funds declaration required for " + input.TargetTier + " tier"
			result.Message = "Missing source of funds"
			return result, nil
		}

		var fundsVerification activities.SourceOfFundsResult
		err = workflow.ExecuteActivity(ctx, activities.VerifySourceOfFunds, map[string]interface{}{
			"user_id":         input.UserID,
			"source_of_funds": input.SourceOfFunds,
			"employment":      input.EmploymentDetails,
			"income_range":    input.IncomeRange,
		}).Get(ctx, &fundsVerification)

		if err != nil || !fundsVerification.Acceptable {
			result.Status = "pending_review"
			result.Message = "Source of funds requires manual review"
			logger.Info("Source of funds flagged for manual review")
		} else {
			logger.Info("Source of funds verified")
		}
	}

	// Step 7: Conduct video verification (for premium tier)
	if input.TargetTier == "premium" && input.VideoVerification {
		logger.Info("Step 7: Conducting video verification")
		
		var videoVerif activities.VideoVerificationResult
		err = workflow.ExecuteActivity(ctx, activities.ConductVideoVerification, map[string]interface{}{
			"user_id":       input.UserID,
			"document_data": ocrResult.ExtractedData,
		}).Get(ctx, &videoVerif)

		if err != nil || !videoVerif.Verified {
			result.Status = "pending_review"
			result.Message = "Video verification requires manual review"
			logger.Info("Video verification flagged for manual review")
		} else {
			logger.Info("Video verification successful")
			
			result.VideoVerification = map[string]interface{}{
				"verified":   videoVerif.Verified,
				"liveness":   videoVerif.LivenessCheck,
				"confidence": videoVerif.Confidence,
			}
		}
	}

	// Step 8: Calculate risk score
	logger.Info("Step 8: Calculating risk score")
	var riskScore activities.RiskScoreResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateKYCRiskScore, map[string]interface{}{
		"user_id":               input.UserID,
		"document_confidence":   docVerification.Confidence,
		"face_match_similarity": faceMatch.Similarity,
		"address_verified":      result.AddressVerification != nil,
		"source_of_funds":       input.SourceOfFunds,
		"target_tier":           input.TargetTier,
	}).Get(ctx, &riskScore)

	if err != nil {
		return nil, err
	}

	logger.Info("Risk score calculated", "score", riskScore.Score, "level", riskScore.Level)

	// Step 9: Auto-approve or flag for manual review
	logger.Info("Step 9: Making approval decision")
	
	autoApproveThreshold := 0.85
	if input.TargetTier == "premium" {
		autoApproveThreshold = 0.90 // Higher threshold for premium
	}

	if riskScore.Score >= autoApproveThreshold && result.Status != "pending_review" {
		result.Status = "approved"
		result.NewTier = input.TargetTier
		logger.Info("KYC upgrade auto-approved", "new_tier", input.TargetTier)
	} else {
		result.Status = "pending_review"
		result.Message = "KYC upgrade requires manual review"
		logger.Info("KYC upgrade flagged for manual review", "risk_score", riskScore.Score)
		
		// Send to compliance team for review
		_ = workflow.ExecuteActivity(ctx, activities.FlagForComplianceReview, map[string]interface{}{
			"user_id":      input.UserID,
			"review_type":  "kyc_upgrade",
			"target_tier":  input.TargetTier,
			"risk_score":   riskScore.Score,
			"risk_level":   riskScore.Level,
			"risk_factors": riskScore.Factors,
		}).Get(ctx, nil)
		
		return result, nil
	}

	// Step 10: Update user tier and limits
	logger.Info("Step 10: Updating user tier and limits")
	
	// Define tier limits
	tierLimits := map[string]map[string]decimal.Decimal{
		"basic": {
			"daily_limit":       decimal.NewFromInt(50000),    // ₦50k
			"monthly_limit":     decimal.NewFromInt(500000),   // ₦500k
			"single_transaction": decimal.NewFromInt(10000),   // ₦10k
		},
		"standard": {
			"daily_limit":       decimal.NewFromInt(500000),   // ₦500k
			"monthly_limit":     decimal.NewFromInt(5000000),  // ₦5M
			"single_transaction": decimal.NewFromInt(100000),  // ₦100k
		},
		"enhanced": {
			"daily_limit":       decimal.NewFromInt(5000000),  // ₦5M
			"monthly_limit":     decimal.NewFromInt(50000000), // ₦50M
			"single_transaction": decimal.NewFromInt(1000000), // ₦1M
		},
		"premium": {
			"daily_limit":       decimal.NewFromInt(50000000),  // ₦50M
			"monthly_limit":     decimal.NewFromInt(500000000), // ₦500M
			"single_transaction": decimal.NewFromInt(10000000), // ₦10M
		},
	}

	result.NewLimits = tierLimits[input.TargetTier]

	var tierUpdate activities.TierUpdateResult
	err = workflow.ExecuteActivity(ctx, activities.UpdateUserKYCTier, map[string]interface{}{
		"user_id":         input.UserID,
		"new_tier":        input.TargetTier,
		"verification_id": result.VerificationID,
		"limits":          result.NewLimits,
		"verified_data": map[string]interface{}{
			"full_name":       ocrResult.FullName,
			"date_of_birth":   ocrResult.DateOfBirth,
			"document_number": ocrResult.DocumentNumber,
			"address":         ocrResult.Address,
		},
	}).Get(ctx, &tierUpdate)

	if err != nil {
		return nil, err
	}

	result.VerificationID = tierUpdate.VerificationID
	logger.Info("User tier updated", "verification_id", tierUpdate.VerificationID)

	// Step 11: Send notification
	logger.Info("Step 11: Sending notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "kyc_upgrade_approved",
		"channel": "email,push,sms",
		"data": map[string]interface{}{
			"previous_tier":      input.CurrentTier,
			"new_tier":           input.TargetTier,
			"verification_id":    result.VerificationID,
			"new_daily_limit":    result.NewLimits["daily_limit"],
			"new_monthly_limit":  result.NewLimits["monthly_limit"],
			"new_single_tx_limit": result.NewLimits["single_transaction"],
		},
	}).Get(ctx, nil)

	// Step 12: Log to analytics
	logger.Info("Step 12: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "kyc_upgrade",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"previous_tier":         input.CurrentTier,
			"new_tier":              input.TargetTier,
			"document_type":         input.DocumentType,
			"face_match_similarity": faceMatch.Similarity,
			"risk_score":            riskScore.Score,
			"risk_level":            riskScore.Level,
			"auto_approved":         true,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Message = "KYC tier upgraded successfully to " + input.TargetTier
	result.CompletedAt = time.Now()

	logger.Info("EnhancedKYCUpgradeWorkflow completed successfully")
	return result, nil
}
