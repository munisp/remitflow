package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
)

// PasswordResetInput represents input for password reset
type PasswordResetInput struct {
	UserID          models.UserID `json:"user_id,omitempty"` // Optional if using email/phone
	Email           string        `json:"email,omitempty"`
	Phone           string        `json:"phone,omitempty"`
	EmailOTP        string        `json:"email_otp,omitempty"`
	PhoneOTP        string        `json:"phone_otp,omitempty"`
	SecurityAnswers map[string]string `json:"security_answers,omitempty"`
	NewPassword     string        `json:"new_password,omitempty"`
	Step            string        `json:"step"` // request, verify, reset
}

// PasswordResetResult represents the workflow result
type PasswordResetResult struct {
	Success       bool      `json:"success"`
	Step          string    `json:"step"`
	EmailSent     bool      `json:"email_sent"`
	SMSSent       bool      `json:"sms_sent"`
	OTPsVerified  bool      `json:"otps_verified"`
	PasswordReset bool      `json:"password_reset"`
	SessionsInvalidated bool `json:"sessions_invalidated"`
	Message       string    `json:"message"`
	CompletedAt   time.Time `json:"completed_at"`
}

// PasswordResetWorkflow implements Journey 4: Password Reset with Multi-Channel Verification
//
// Steps:
// 1. Verify user identity (email/phone)
// 2. Send OTP to email AND SMS
// 3. Verify both OTPs
// 4. Check security questions (if configured)
// 5. Allow password reset
// 6. Update Keycloak password
// 7. Invalidate all sessions
// 8. Send security alert notification
// 9. Log event to Lakehouse
func PasswordResetWorkflow(ctx workflow.Context, input PasswordResetInput) (*PasswordResetResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("PasswordResetWorkflow started",
		"user_id", input.UserID,
		"email", input.Email,
		"step", input.Step)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &PasswordResetResult{
		Success: false,
		Step:    input.Step,
	}

	// Route based on step
	switch input.Step {
	case "request":
		return requestPasswordReset(ctx, input, result, logger)
	case "verify":
		return verifyPasswordReset(ctx, input, result, logger)
	case "reset":
		return resetPassword(ctx, input, result, logger)
	default:
		result.Message = "Invalid step: " + input.Step
		return result, nil
	}
}

// requestPasswordReset handles the initial password reset request
func requestPasswordReset(ctx workflow.Context, input PasswordResetInput, result *PasswordResetResult, logger workflow.Logger) (*PasswordResetResult, error) {
	// Step 1: Verify user identity
	logger.Info("Step 1: Verifying user identity")
	var userLookup activities.UserLookupResult
	err := workflow.ExecuteActivity(ctx, activities.LookupUserByEmailOrPhone, map[string]interface{}{
		"email": input.Email,
		"phone": input.Phone,
	}).Get(ctx, &userLookup)

	if err != nil {
		logger.Error("User lookup failed", "error", err)
		return nil, err
	}

	if !userLookup.Found {
		// Don't reveal if user exists or not (security)
		result.Success = true
		result.Message = "If an account exists with this email/phone, you will receive a password reset code."
		return result, nil
	}

	// Step 2: Generate and send OTP to email
	logger.Info("Step 2: Generating and sending email OTP")
	var emailOTPResult activities.OTPGenerationResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateAndSendOTP, map[string]interface{}{
		"user_id":  userLookup.UserID,
		"channel":  "email",
		"email":    userLookup.Email,
		"purpose":  "password_reset",
		"ttl":      600, // 10 minutes
	}).Get(ctx, &emailOTPResult)

	if err != nil {
		logger.Error("Email OTP generation failed", "error", err)
		return nil, err
	}

	result.EmailSent = emailOTPResult.Sent

	// Step 3: Generate and send OTP to SMS
	logger.Info("Step 3: Generating and sending SMS OTP")
	var smsOTPResult activities.OTPGenerationResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateAndSendOTP, map[string]interface{}{
		"user_id":  userLookup.UserID,
		"channel":  "sms",
		"phone":    userLookup.Phone,
		"purpose":  "password_reset",
		"ttl":      600, // 10 minutes
	}).Get(ctx, &smsOTPResult)

	if err != nil {
		logger.Error("SMS OTP generation failed", "error", err)
		// Continue even if SMS fails
		result.SMSSent = false
	} else {
		result.SMSSent = smsOTPResult.Sent
	}

	// Step 4: Log password reset request
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "password_reset_requested",
		"user_id":    userLookup.UserID,
		"data": map[string]interface{}{
			"email_sent": result.EmailSent,
			"sms_sent":   result.SMSSent,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Message = "Password reset codes sent to your email and phone"
	result.CompletedAt = time.Now()

	logger.Info("Password reset request completed")
	return result, nil
}

// verifyPasswordReset handles OTP verification
func verifyPasswordReset(ctx workflow.Context, input PasswordResetInput, result *PasswordResetResult, logger workflow.Logger) (*PasswordResetResult, error) {
	// Step 1: Lookup user
	logger.Info("Step 1: Looking up user")
	var userLookup activities.UserLookupResult
	err := workflow.ExecuteActivity(ctx, activities.LookupUserByEmailOrPhone, map[string]interface{}{
		"email": input.Email,
		"phone": input.Phone,
	}).Get(ctx, &userLookup)

	if err != nil || !userLookup.Found {
		result.Message = "Invalid request"
		return result, nil
	}

	// Step 2: Verify email OTP
	logger.Info("Step 2: Verifying email OTP")
	var emailVerify activities.OTPVerifyResult
	err = workflow.ExecuteActivity(ctx, activities.VerifyOTP, map[string]interface{}{
		"user_id": userLookup.UserID,
		"channel": "email",
		"code":    input.EmailOTP,
		"purpose": "password_reset",
	}).Get(ctx, &emailVerify)

	if err != nil || !emailVerify.Valid {
		logger.Warn("Email OTP verification failed")
		result.Message = "Invalid email verification code"
		return result, nil
	}

	// Step 3: Verify phone OTP
	logger.Info("Step 3: Verifying phone OTP")
	var phoneVerify activities.OTPVerifyResult
	err = workflow.ExecuteActivity(ctx, activities.VerifyOTP, map[string]interface{}{
		"user_id": userLookup.UserID,
		"channel": "sms",
		"code":    input.PhoneOTP,
		"purpose": "password_reset",
	}).Get(ctx, &phoneVerify)

	if err != nil || !phoneVerify.Valid {
		logger.Warn("Phone OTP verification failed")
		result.Message = "Invalid phone verification code"
		return result, nil
	}

	result.OTPsVerified = true

	// Step 4: Check security questions (if configured)
	logger.Info("Step 4: Checking security questions")
	var securityCheck activities.SecurityQuestionsResult
	err = workflow.ExecuteActivity(ctx, activities.VerifySecurityQuestions, map[string]interface{}{
		"user_id": userLookup.UserID,
		"answers": input.SecurityAnswers,
	}).Get(ctx, &securityCheck)

	if err == nil && securityCheck.Required && !securityCheck.Valid {
		logger.Warn("Security questions verification failed")
		result.Message = "Security questions verification failed"
		return result, nil
	}

	// Step 5: Generate password reset token (short-lived)
	logger.Info("Step 5: Generating password reset token")
	var tokenResult activities.TokenGenerationResult
	err = workflow.ExecuteActivity(ctx, activities.GeneratePasswordResetToken, map[string]interface{}{
		"user_id": userLookup.UserID,
		"ttl":     300, // 5 minutes to reset password
	}).Get(ctx, &tokenResult)

	if err != nil {
		logger.Error("Token generation failed", "error", err)
		return nil, err
	}

	result.Success = true
	result.Message = "Verification successful. You can now reset your password."
	result.CompletedAt = time.Now()

	logger.Info("Password reset verification completed")
	return result, nil
}

// resetPassword handles the actual password reset
func resetPassword(ctx workflow.Context, input PasswordResetInput, result *PasswordResetResult, logger workflow.Logger) (*PasswordResetResult, error) {
	// Step 1: Validate new password
	logger.Info("Step 1: Validating new password")
	var passwordValidation activities.PasswordValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidatePassword, map[string]interface{}{
		"password": input.NewPassword,
	}).Get(ctx, &passwordValidation)

	if err != nil || !passwordValidation.Valid {
		result.Message = "Password does not meet requirements: " + passwordValidation.Reason
		return result, nil
	}

	// Step 2: Lookup user
	var userLookup activities.UserLookupResult
	err = workflow.ExecuteActivity(ctx, activities.LookupUserByEmailOrPhone, map[string]interface{}{
		"email": input.Email,
		"phone": input.Phone,
	}).Get(ctx, &userLookup)

	if err != nil || !userLookup.Found {
		result.Message = "Invalid request"
		return result, nil
	}

	// Step 3: Update password in Keycloak
	logger.Info("Step 2: Updating password in Keycloak")
	err = workflow.ExecuteActivity(ctx, activities.UpdateKeycloakPassword, map[string]interface{}{
		"user_id":      userLookup.UserID,
		"new_password": input.NewPassword,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Keycloak password update failed", "error", err)
		return nil, err
	}

	result.PasswordReset = true

	// Step 4: Invalidate all existing sessions
	logger.Info("Step 3: Invalidating all sessions")
	err = workflow.ExecuteActivity(ctx, activities.InvalidateAllSessions, map[string]interface{}{
		"user_id": userLookup.UserID,
	}).Get(ctx, nil)

	if err != nil {
		logger.Warn("Session invalidation failed (non-critical)", "error", err)
	} else {
		result.SessionsInvalidated = true
	}

	// Step 5: Delete password reset tokens
	_ = workflow.ExecuteActivity(ctx, activities.DeletePasswordResetTokens, map[string]interface{}{
		"user_id": userLookup.UserID,
	}).Get(ctx, nil)

	// Step 6: Send security alert notification
	logger.Info("Step 4: Sending security alert")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": userLookup.UserID,
		"type":    "password_reset_success",
		"channel": "email,sms,push",
		"priority": "high",
		"data": map[string]interface{}{
			"reset_time": time.Now(),
			"ip_address": "masked", // Would come from request context
		},
	}).Get(ctx, nil)

	// Step 7: Log security event to Lakehouse
	logger.Info("Step 5: Logging security event")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "password_reset_completed",
		"user_id":    userLookup.UserID,
		"data": map[string]interface{}{
			"sessions_invalidated": result.SessionsInvalidated,
			"timestamp":            time.Now(),
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Message = "Password reset successfully. Please log in with your new password."
	result.CompletedAt = time.Now()

	logger.Info("Password reset completed successfully")
	return result, nil
}
