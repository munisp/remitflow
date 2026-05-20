package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
)

// BiometricSetupInput represents input for biometric setup
type BiometricSetupInput struct {
	UserID           models.UserID `json:"user_id"`
	BiometricType    string        `json:"biometric_type"` // fingerprint, face
	BiometricData    []byte        `json:"biometric_data"` // Raw biometric data
	DeviceID         string        `json:"device_id"`
	DeviceInfo       map[string]interface{} `json:"device_info"`
}

// BiometricSetupResult represents the workflow result
type BiometricSetupResult struct {
	Success          bool      `json:"success"`
	BiometricID      string    `json:"biometric_id"`
	TemplateStored   bool      `json:"template_stored"`
	KeycloakUpdated  bool      `json:"keycloak_updated"`
	TestPassed       bool      `json:"test_passed"`
	Message          string    `json:"message"`
	CompletedAt      time.Time `json:"completed_at"`
}

// BiometricSetupWorkflow implements Journey 2: Biometric Authentication Setup
// 
// Steps:
// 1. Validate user and device
// 2. Capture biometric data
// 3. Process with ArcFace (generate embedding)
// 4. Quality check
// 5. Store encrypted template
// 6. Link to user account (Keycloak)
// 7. Test biometric authentication
// 8. Enable biometric login
// 9. Update security settings (Permify)
// 10. Send confirmation notification
func BiometricSetupWorkflow(ctx workflow.Context, input BiometricSetupInput) (*BiometricSetupResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BiometricSetupWorkflow started", 
		"user_id", input.UserID,
		"biometric_type", input.BiometricType,
		"device_id", input.DeviceID)

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

	result := &BiometricSetupResult{
		Success: false,
	}

	// Step 1: Validate user and device
	logger.Info("Step 1: Validating user and device")
	var validationResult activities.ValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateUserAndDevice, map[string]interface{}{
		"user_id":   input.UserID,
		"device_id": input.DeviceID,
	}).Get(ctx, &validationResult)
	
	if err != nil {
		logger.Error("User/device validation failed", "error", err)
		return nil, err
	}
	
	if !validationResult.Valid {
		logger.Warn("User or device not valid", "reason", validationResult.Reason)
		result.Message = "Validation failed: " + validationResult.Reason
		return result, nil
	}

	// Step 2: Check if biometric already exists
	logger.Info("Step 2: Checking existing biometric")
	var existingBiometric activities.BiometricCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckExistingBiometric, map[string]interface{}{
		"user_id":        input.UserID,
		"biometric_type": input.BiometricType,
	}).Get(ctx, &existingBiometric)
	
	if err != nil {
		logger.Error("Biometric check failed", "error", err)
		return nil, err
	}
	
	if existingBiometric.Exists {
		logger.Info("Biometric already exists, updating")
		// Continue to update existing biometric
	}

	// Step 3: Process biometric with ArcFace (Python worker)
	logger.Info("Step 3: Processing biometric with ArcFace")
	arcfaceOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute, // AI processing may take longer
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    2 * time.Minute,
			MaximumAttempts:    2, // AI processing shouldn't retry too many times
		},
	}
	arcfaceCtx := workflow.WithActivityOptions(ctx, arcfaceOptions)
	
	var arcfaceResult activities.ArcFaceProcessingResult
	err = workflow.ExecuteActivity(arcfaceCtx, activities.ProcessBiometricWithArcFace, map[string]interface{}{
		"user_id":        input.UserID,
		"biometric_type": input.BiometricType,
		"biometric_data": input.BiometricData,
	}).Get(arcfaceCtx, &arcfaceResult)
	
	if err != nil {
		logger.Error("ArcFace processing failed", "error", err)
		return nil, err
	}

	// Step 4: Quality check
	logger.Info("Step 4: Quality check", "quality_score", arcfaceResult.QualityScore)
	if arcfaceResult.QualityScore < 0.7 {
		logger.Warn("Biometric quality too low", "score", arcfaceResult.QualityScore)
		result.Message = "Biometric quality too low. Please try again with better lighting/positioning."
		return result, nil
	}

	// Step 5: Store encrypted biometric template
	logger.Info("Step 5: Storing encrypted biometric template")
	var storageResult activities.StorageResult
	err = workflow.ExecuteActivity(ctx, activities.StoreBiometricTemplate, map[string]interface{}{
		"user_id":         input.UserID,
		"biometric_type":  input.BiometricType,
		"template":        arcfaceResult.EmbeddingVector,
		"quality_score":   arcfaceResult.QualityScore,
		"device_id":       input.DeviceID,
	}).Get(ctx, &storageResult)
	
	if err != nil {
		logger.Error("Template storage failed", "error", err)
		return nil, err
	}
	
	result.BiometricID = storageResult.BiometricID
	result.TemplateStored = true

	// Step 6: Link to user account in Keycloak
	logger.Info("Step 6: Linking biometric to Keycloak account")
	var keycloakResult activities.KeycloakUpdateResult
	err = workflow.ExecuteActivity(ctx, activities.UpdateKeycloakBiometric, map[string]interface{}{
		"user_id":       input.UserID,
		"biometric_id":  storageResult.BiometricID,
		"biometric_type": input.BiometricType,
		"enabled":       true,
	}).Get(ctx, &keycloakResult)
	
	if err != nil {
		// Compensate: Remove stored template
		logger.Error("Keycloak update failed, compensating", "error", err)
		_ = workflow.ExecuteActivity(ctx, activities.DeleteBiometricTemplate, map[string]interface{}{
			"biometric_id": storageResult.BiometricID,
		}).Get(ctx, nil)
		return nil, err
	}
	
	result.KeycloakUpdated = true

	// Step 7: Test biometric authentication
	logger.Info("Step 7: Testing biometric authentication")
	var testResult activities.BiometricTestResult
	err = workflow.ExecuteActivity(ctx, activities.TestBiometricAuthentication, map[string]interface{}{
		"user_id":        input.UserID,
		"biometric_id":   storageResult.BiometricID,
		"test_data":      input.BiometricData, // Use same data for initial test
	}).Get(ctx, &testResult)
	
	if err != nil || !testResult.Passed {
		logger.Error("Biometric test failed", "error", err, "passed", testResult.Passed)
		// Compensate: Remove from Keycloak and storage
		_ = workflow.ExecuteActivity(ctx, activities.UpdateKeycloakBiometric, map[string]interface{}{
			"user_id": input.UserID,
			"enabled": false,
		}).Get(ctx, nil)
		_ = workflow.ExecuteActivity(ctx, activities.DeleteBiometricTemplate, map[string]interface{}{
			"biometric_id": storageResult.BiometricID,
		}).Get(ctx, nil)
		
		result.Message = "Biometric test failed. Please try setup again."
		return result, nil
	}
	
	result.TestPassed = true

	// Step 8: Update security settings in Permify
	logger.Info("Step 8: Updating Permify security settings")
	err = workflow.ExecuteActivity(ctx, activities.UpdatePermifySecuritySettings, map[string]interface{}{
		"user_id":           input.UserID,
		"biometric_enabled": true,
		"biometric_type":    input.BiometricType,
	}).Get(ctx, nil)
	
	if err != nil {
		logger.Warn("Permify update failed (non-critical)", "error", err)
		// Non-critical, continue
	}

	// Step 9: Send confirmation notification (Kafka)
	logger.Info("Step 9: Sending confirmation notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "biometric_setup_success",
		"channel": "push,email",
		"data": map[string]interface{}{
			"biometric_type": input.BiometricType,
			"device_id":      input.DeviceID,
			"setup_time":     time.Now(),
		},
	}).Get(ctx, nil)

	// Step 10: Log to analytics (Lakehouse)
	logger.Info("Step 10: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "biometric_setup_completed",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"biometric_type":  input.BiometricType,
			"quality_score":   arcfaceResult.QualityScore,
			"device_id":       input.DeviceID,
			"test_passed":     true,
		},
	}).Get(ctx, nil)

	// Success
	result.Success = true
	result.Message = "Biometric authentication setup completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("BiometricSetupWorkflow completed successfully", 
		"biometric_id", result.BiometricID,
		"user_id", input.UserID)

	return result, nil
}
