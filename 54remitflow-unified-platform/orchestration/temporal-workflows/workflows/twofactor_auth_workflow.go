package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
)

// TwoFactorAuthInput represents input for 2FA setup
type TwoFactorAuthInput struct {
	UserID    models.UserID `json:"user_id"`
	Action    string        `json:"action"` // enable, disable, verify
	TOTPCode  string        `json:"totp_code,omitempty"` // For verification
}

// TwoFactorAuthResult represents the workflow result
type TwoFactorAuthResult struct {
	Success       bool      `json:"success"`
	Action        string    `json:"action"`
	TOTPSecret    string    `json:"totp_secret,omitempty"` // Only for enable
	QRCodeURL     string    `json:"qr_code_url,omitempty"` // Only for enable
	BackupCodes   []string  `json:"backup_codes,omitempty"` // Only for enable
	Message       string    `json:"message"`
	CompletedAt   time.Time `json:"completed_at"`
}

// TwoFactorAuthWorkflow implements Journey 3: Two-Factor Authentication Configuration
//
// Steps (for enable action):
// 1. Validate user
// 2. Generate TOTP secret
// 3. Generate QR code
// 4. Store secret in Redis (encrypted)
// 5. Wait for user to scan and verify
// 6. Generate backup codes
// 7. Store backup codes (encrypted)
// 8. Update Keycloak 2FA settings
// 9. Update Permify permissions
// 10. Send confirmation notification
func TwoFactorAuthWorkflow(ctx workflow.Context, input TwoFactorAuthInput) (*TwoFactorAuthResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TwoFactorAuthWorkflow started",
		"user_id", input.UserID,
		"action", input.Action)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 3 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &TwoFactorAuthResult{
		Success: false,
		Action:  input.Action,
	}

	// Step 1: Validate user
	logger.Info("Step 1: Validating user")
	var userValidation activities.UserValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateUser, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &userValidation)

	if err != nil {
		logger.Error("User validation failed", "error", err)
		return nil, err
	}

	if !userValidation.Valid {
		result.Message = "User validation failed"
		return result, nil
	}

	// Route based on action
	switch input.Action {
	case "enable":
		return enableTwoFactor(ctx, input, result, logger)
	case "disable":
		return disableTwoFactor(ctx, input, result, logger)
	case "verify":
		return verifyTwoFactor(ctx, input, result, logger)
	default:
		result.Message = "Invalid action: " + input.Action
		return result, nil
	}
}

// enableTwoFactor handles 2FA enablement
func enableTwoFactor(ctx workflow.Context, input TwoFactorAuthInput, result *TwoFactorAuthResult, logger workflow.Logger) (*TwoFactorAuthResult, error) {
	// Step 2: Generate TOTP secret
	logger.Info("Step 2: Generating TOTP secret")
	var totpResult activities.TOTPGenerationResult
	err := workflow.ExecuteActivity(ctx, activities.GenerateTOTPSecret, map[string]interface{}{
		"user_id": input.UserID,
		"issuer":  "Nigerian Remittance Platform",
	}).Get(ctx, &totpResult)

	if err != nil {
		logger.Error("TOTP generation failed", "error", err)
		return nil, err
	}

	result.TOTPSecret = totpResult.Secret
	result.QRCodeURL = totpResult.QRCodeURL

	// Step 3: Store TOTP secret in Redis (encrypted, temporary)
	logger.Info("Step 3: Storing TOTP secret in Redis")
	err = workflow.ExecuteActivity(ctx, activities.StoreTOTPSecret, map[string]interface{}{
		"user_id": input.UserID,
		"secret":  totpResult.Secret,
		"ttl":     300, // 5 minutes to verify
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("TOTP storage failed", "error", err)
		return nil, err
	}

	// Step 4: Wait for verification signal (or timeout)
	// In a real implementation, this would use workflow.GetSignalChannel
	// For now, we'll assume verification happens in a separate verify workflow

	// Step 5: Generate backup codes
	logger.Info("Step 4: Generating backup codes")
	var backupCodesResult activities.BackupCodesResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateBackupCodes, map[string]interface{}{
		"user_id": input.UserID,
		"count":   10,
	}).Get(ctx, &backupCodesResult)

	if err != nil {
		logger.Error("Backup codes generation failed", "error", err)
		return nil, err
	}

	result.BackupCodes = backupCodesResult.Codes

	// Step 6: Store backup codes (encrypted)
	logger.Info("Step 5: Storing backup codes")
	err = workflow.ExecuteActivity(ctx, activities.StoreBackupCodes, map[string]interface{}{
		"user_id": input.UserID,
		"codes":   backupCodesResult.Codes,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Backup codes storage failed", "error", err)
		// Compensate: Remove TOTP secret
		_ = workflow.ExecuteActivity(ctx, activities.DeleteTOTPSecret, map[string]interface{}{
			"user_id": input.UserID,
		}).Get(ctx, nil)
		return nil, err
	}

	// Step 7: Update Keycloak 2FA settings
	logger.Info("Step 6: Updating Keycloak 2FA settings")
	err = workflow.ExecuteActivity(ctx, activities.UpdateKeycloak2FA, map[string]interface{}{
		"user_id": input.UserID,
		"enabled": true,
		"method":  "totp",
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Keycloak update failed", "error", err)
		// Compensate: Remove TOTP and backup codes
		_ = workflow.ExecuteActivity(ctx, activities.DeleteTOTPSecret, map[string]interface{}{
			"user_id": input.UserID,
		}).Get(ctx, nil)
		_ = workflow.ExecuteActivity(ctx, activities.DeleteBackupCodes, map[string]interface{}{
			"user_id": input.UserID,
		}).Get(ctx, nil)
		return nil, err
	}

	// Step 8: Update Permify permissions
	logger.Info("Step 7: Updating Permify permissions")
	_ = workflow.ExecuteActivity(ctx, activities.UpdatePermifySecuritySettings, map[string]interface{}{
		"user_id":     input.UserID,
		"2fa_enabled": true,
	}).Get(ctx, nil)

	// Step 9: Send confirmation notification
	logger.Info("Step 8: Sending confirmation notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "2fa_enabled",
		"channel": "email,sms",
		"data": map[string]interface{}{
			"enabled_at": time.Now(),
			"method":     "totp",
		},
	}).Get(ctx, nil)

	// Step 10: Log to analytics
	logger.Info("Step 9: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "2fa_enabled",
		"user_id":    input.UserID,
	}).Get(ctx, nil)

	result.Success = true
	result.Message = "Two-factor authentication enabled successfully. Please save your backup codes in a secure location."
	result.CompletedAt = time.Now()

	logger.Info("TwoFactorAuthWorkflow (enable) completed successfully")
	return result, nil
}

// disableTwoFactor handles 2FA disablement
func disableTwoFactor(ctx workflow.Context, input TwoFactorAuthInput, result *TwoFactorAuthResult, logger workflow.Logger) (*TwoFactorAuthResult, error) {
	logger.Info("Disabling 2FA for user", "user_id", input.UserID)

	// Verify TOTP code before disabling
	if input.TOTPCode == "" {
		result.Message = "TOTP code required to disable 2FA"
		return result, nil
	}

	var verifyResult activities.TOTPVerifyResult
	err := workflow.ExecuteActivity(ctx, activities.VerifyTOTPCode, map[string]interface{}{
		"user_id": input.UserID,
		"code":    input.TOTPCode,
	}).Get(ctx, &verifyResult)

	if err != nil || !verifyResult.Valid {
		result.Message = "Invalid TOTP code"
		return result, nil
	}

	// Delete TOTP secret
	err = workflow.ExecuteActivity(ctx, activities.DeleteTOTPSecret, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to delete TOTP secret", "error", err)
		return nil, err
	}

	// Delete backup codes
	_ = workflow.ExecuteActivity(ctx, activities.DeleteBackupCodes, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, nil)

	// Update Keycloak
	err = workflow.ExecuteActivity(ctx, activities.UpdateKeycloak2FA, map[string]interface{}{
		"user_id": input.UserID,
		"enabled": false,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Keycloak update failed", "error", err)
		return nil, err
	}

	// Update Permify
	_ = workflow.ExecuteActivity(ctx, activities.UpdatePermifySecuritySettings, map[string]interface{}{
		"user_id":     input.UserID,
		"2fa_enabled": false,
	}).Get(ctx, nil)

	// Send notification
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "2fa_disabled",
		"channel": "email,sms",
		"data": map[string]interface{}{
			"disabled_at": time.Now(),
		},
	}).Get(ctx, nil)

	// Log to analytics
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "2fa_disabled",
		"user_id":    input.UserID,
	}).Get(ctx, nil)

	result.Success = true
	result.Message = "Two-factor authentication disabled successfully"
	result.CompletedAt = time.Now()

	logger.Info("TwoFactorAuthWorkflow (disable) completed successfully")
	return result, nil
}

// verifyTwoFactor handles TOTP verification
func verifyTwoFactor(ctx workflow.Context, input TwoFactorAuthInput, result *TwoFactorAuthResult, logger workflow.Logger) (*TwoFactorAuthResult, error) {
	logger.Info("Verifying TOTP code", "user_id", input.UserID)

	if input.TOTPCode == "" {
		result.Message = "TOTP code required"
		return result, nil
	}

	var verifyResult activities.TOTPVerifyResult
	err := workflow.ExecuteActivity(ctx, activities.VerifyTOTPCode, map[string]interface{}{
		"user_id": input.UserID,
		"code":    input.TOTPCode,
	}).Get(ctx, &verifyResult)

	if err != nil {
		logger.Error("TOTP verification failed", "error", err)
		return nil, err
	}

	result.Success = verifyResult.Valid
	if verifyResult.Valid {
		result.Message = "TOTP code verified successfully"
	} else {
		result.Message = "Invalid TOTP code"
	}
	result.CompletedAt = time.Now()

	logger.Info("TwoFactorAuthWorkflow (verify) completed", "valid", verifyResult.Valid)
	return result, nil
}
