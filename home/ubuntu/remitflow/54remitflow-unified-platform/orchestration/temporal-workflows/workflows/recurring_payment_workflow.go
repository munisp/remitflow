package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// RecurringPaymentInput represents input for recurring payment setup
type RecurringPaymentInput struct {
	UserID          models.UserID   `json:"user_id"`
	BeneficiaryID   string          `json:"beneficiary_id"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	Schedule        string          `json:"schedule"` // cron expression
	StartDate       time.Time       `json:"start_date"`
	EndDate         *time.Time      `json:"end_date,omitempty"` // Optional
	MaxOccurrences  int             `json:"max_occurrences,omitempty"` // Optional
	Description     string          `json:"description"`
	Action          string          `json:"action"` // create, pause, resume, cancel, execute
	RecurringID     string          `json:"recurring_id,omitempty"` // For pause/resume/cancel
}

// RecurringPaymentResult represents the workflow result
type RecurringPaymentResult struct {
	Success          bool      `json:"success"`
	Action           string    `json:"action"`
	RecurringID      string    `json:"recurring_id,omitempty"`
	NextExecutionTime *time.Time `json:"next_execution_time,omitempty"`
	ExecutionCount   int       `json:"execution_count"`
	Status           string    `json:"status"` // active, paused, completed, cancelled
	Message          string    `json:"message"`
	CompletedAt      time.Time `json:"completed_at"`
}

// RecurringPaymentWorkflow implements Journey 7: Scheduled Recurring Payment
//
// Steps (for create action):
// 1. Validate schedule (cron expression)
// 2. Validate beneficiary
// 3. Check wallet balance for first payment
// 4. Execute first payment
// 5. Store recurring payment configuration
// 6. Schedule next payment (Temporal schedule)
// 7. Monitor for failures
// 8. Retry with exponential backoff
// 9. Send payment reminders
// 10. Handle insufficient funds
func RecurringPaymentWorkflow(ctx workflow.Context, input RecurringPaymentInput) (*RecurringPaymentResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("RecurringPaymentWorkflow started",
		"user_id", input.UserID,
		"action", input.Action,
		"recurring_id", input.RecurringID)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &RecurringPaymentResult{
		Success: false,
		Action:  input.Action,
	}

	// Route based on action
	switch input.Action {
	case "create":
		return createRecurringPayment(ctx, input, result, logger)
	case "execute":
		return executeRecurringPayment(ctx, input, result, logger)
	case "pause":
		return pauseRecurringPayment(ctx, input, result, logger)
	case "resume":
		return resumeRecurringPayment(ctx, input, result, logger)
	case "cancel":
		return cancelRecurringPayment(ctx, input, result, logger)
	default:
		result.Message = "Invalid action: " + input.Action
		return result, nil
	}
}

// createRecurringPayment handles recurring payment creation
func createRecurringPayment(ctx workflow.Context, input RecurringPaymentInput, result *RecurringPaymentResult, logger workflow.Logger) (*RecurringPaymentResult, error) {
	// Step 1: Validate schedule (cron expression)
	logger.Info("Step 1: Validating schedule")
	var scheduleValidation activities.ScheduleValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateCronSchedule, map[string]interface{}{
		"schedule": input.Schedule,
	}).Get(ctx, &scheduleValidation)

	if err != nil || !scheduleValidation.Valid {
		result.Message = "Invalid schedule: " + scheduleValidation.Reason
		return result, nil
	}

	// Step 2: Validate beneficiary
	logger.Info("Step 2: Validating beneficiary")
	var beneficiaryValidation activities.BeneficiaryValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidateBeneficiary, map[string]interface{}{
		"user_id":        input.UserID,
		"beneficiary_id": input.BeneficiaryID,
	}).Get(ctx, &beneficiaryValidation)

	if err != nil || !beneficiaryValidation.Valid {
		result.Message = "Invalid beneficiary"
		return result, nil
	}

	// Step 3: Check wallet balance for first payment
	logger.Info("Step 3: Checking wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"user_id":  input.UserID,
		"currency": input.Currency,
		"amount":   input.Amount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance for first payment"
		return result, nil
	}

	// Step 4: Execute first payment
	logger.Info("Step 4: Executing first payment")
	var firstPayment activities.PaymentResult
	err = workflow.ExecuteActivity(ctx, activities.ExecutePayment, map[string]interface{}{
		"user_id":        input.UserID,
		"beneficiary_id": input.BeneficiaryID,
		"amount":         input.Amount,
		"currency":       input.Currency,
		"description":    input.Description + " (Recurring - First Payment)",
		"type":           "recurring_first",
	}).Get(ctx, &firstPayment)

	if err != nil {
		logger.Error("First payment failed", "error", err)
		result.Message = "First payment failed: " + err.Error()
		return result, nil
	}

	// Step 5: Store recurring payment configuration
	logger.Info("Step 5: Storing recurring payment configuration")
	var recurringConfig activities.RecurringConfigResult
	err = workflow.ExecuteActivity(ctx, activities.CreateRecurringPaymentConfig, map[string]interface{}{
		"user_id":         input.UserID,
		"beneficiary_id":  input.BeneficiaryID,
		"amount":          input.Amount,
		"currency":        input.Currency,
		"schedule":        input.Schedule,
		"start_date":      input.StartDate,
		"end_date":        input.EndDate,
		"max_occurrences": input.MaxOccurrences,
		"description":     input.Description,
		"status":          "active",
	}).Get(ctx, &recurringConfig)

	if err != nil {
		logger.Error("Failed to store recurring config", "error", err)
		// Compensate: Refund first payment
		_ = workflow.ExecuteActivity(ctx, activities.RefundPayment, map[string]interface{}{
			"transaction_id": firstPayment.TransactionID,
			"reason":         "recurring_setup_failed",
		}).Get(ctx, nil)
		return nil, err
	}

	result.RecurringID = recurringConfig.RecurringID

	// Step 6: Calculate next execution time
	logger.Info("Step 6: Calculating next execution time")
	var nextExecution activities.NextExecutionResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateNextExecution, map[string]interface{}{
		"schedule":    input.Schedule,
		"last_run":    time.Now(),
	}).Get(ctx, &nextExecution)

	if err == nil {
		result.NextExecutionTime = &nextExecution.NextTime
	}

	// Step 7: Schedule next payment using Temporal schedule
	// In production, this would create a Temporal schedule
	logger.Info("Step 7: Scheduling next payment", "next_time", nextExecution.NextTime)

	// Step 8: Send confirmation notification
	logger.Info("Step 8: Sending confirmation notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "recurring_payment_created",
		"channel": "email,push",
		"data": map[string]interface{}{
			"recurring_id":        recurringConfig.RecurringID,
			"amount":              input.Amount,
			"currency":            input.Currency,
			"beneficiary_name":    beneficiaryValidation.BeneficiaryName,
			"schedule":            input.Schedule,
			"next_execution_time": nextExecution.NextTime,
		},
	}).Get(ctx, nil)

	// Step 9: Log to analytics
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "recurring_payment_created",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"recurring_id": recurringConfig.RecurringID,
			"amount":       input.Amount,
			"schedule":     input.Schedule,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "active"
	result.ExecutionCount = 1
	result.Message = "Recurring payment created successfully. First payment executed."
	result.CompletedAt = time.Now()

	logger.Info("Recurring payment created successfully", "recurring_id", recurringConfig.RecurringID)
	return result, nil
}

// executeRecurringPayment handles scheduled payment execution
func executeRecurringPayment(ctx workflow.Context, input RecurringPaymentInput, result *RecurringPaymentResult, logger workflow.Logger) (*RecurringPaymentResult, error) {
	logger.Info("Executing recurring payment", "recurring_id", input.RecurringID)

	// Step 1: Load recurring payment configuration
	var config activities.RecurringConfigLoadResult
	err := workflow.ExecuteActivity(ctx, activities.LoadRecurringPaymentConfig, map[string]interface{}{
		"recurring_id": input.RecurringID,
	}).Get(ctx, &config)

	if err != nil {
		logger.Error("Failed to load recurring config", "error", err)
		return nil, err
	}

	if config.Status != "active" {
		result.Message = "Recurring payment is not active: " + config.Status
		return result, nil
	}

	// Step 2: Check if max occurrences reached
	if config.MaxOccurrences > 0 && config.ExecutionCount >= config.MaxOccurrences {
		logger.Info("Max occurrences reached, completing recurring payment")
		_ = workflow.ExecuteActivity(ctx, activities.UpdateRecurringPaymentStatus, map[string]interface{}{
			"recurring_id": input.RecurringID,
			"status":       "completed",
		}).Get(ctx, nil)
		
		result.Success = true
		result.Status = "completed"
		result.Message = "Recurring payment completed (max occurrences reached)"
		return result, nil
	}

	// Step 3: Check wallet balance
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"user_id":  config.UserID,
		"currency": config.Currency,
		"amount":   config.Amount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		logger.Warn("Insufficient balance for recurring payment")
		
		// Send low balance notification
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": config.UserID,
			"type":    "recurring_payment_insufficient_funds",
			"channel": "email,sms,push",
			"priority": "high",
			"data": map[string]interface{}{
				"recurring_id": input.RecurringID,
				"amount":       config.Amount,
				"currency":     config.Currency,
			},
		}).Get(ctx, nil)
		
		// Retry after 1 hour
		workflow.Sleep(ctx, 1*time.Hour)
		
		// Check balance again
		err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
			"user_id":  config.UserID,
			"currency": config.Currency,
			"amount":   config.Amount,
		}).Get(ctx, &balanceCheck)
		
		if err != nil || !balanceCheck.Sufficient {
			result.Message = "Insufficient balance after retry. Recurring payment skipped."
			return result, nil
		}
	}

	// Step 4: Execute payment
	logger.Info("Executing scheduled payment")
	var payment activities.PaymentResult
	err = workflow.ExecuteActivity(ctx, activities.ExecutePayment, map[string]interface{}{
		"user_id":        config.UserID,
		"beneficiary_id": config.BeneficiaryID,
		"amount":         config.Amount,
		"currency":       config.Currency,
		"description":    config.Description + " (Recurring)",
		"type":           "recurring",
		"recurring_id":   input.RecurringID,
	}).Get(ctx, &payment)

	if err != nil {
		logger.Error("Payment execution failed", "error", err)
		
		// Send failure notification
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": config.UserID,
			"type":    "recurring_payment_failed",
			"channel": "email,push",
			"data": map[string]interface{}{
				"recurring_id": input.RecurringID,
				"error":        err.Error(),
			},
		}).Get(ctx, nil)
		
		return nil, err
	}

	// Step 5: Update execution count
	_ = workflow.ExecuteActivity(ctx, activities.IncrementRecurringExecutionCount, map[string]interface{}{
		"recurring_id": input.RecurringID,
	}).Get(ctx, nil)

	// Step 6: Calculate next execution
	var nextExecution activities.NextExecutionResult
	_ = workflow.ExecuteActivity(ctx, activities.CalculateNextExecution, map[string]interface{}{
		"schedule": config.Schedule,
		"last_run": time.Now(),
	}).Get(ctx, &nextExecution)

	// Step 7: Send success notification
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": config.UserID,
		"type":    "recurring_payment_executed",
		"channel": "email,push",
		"data": map[string]interface{}{
			"recurring_id":        input.RecurringID,
			"amount":              config.Amount,
			"transaction_id":      payment.TransactionID,
			"next_execution_time": nextExecution.NextTime,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "active"
	result.ExecutionCount = config.ExecutionCount + 1
	result.NextExecutionTime = &nextExecution.NextTime
	result.Message = "Recurring payment executed successfully"
	result.CompletedAt = time.Now()

	logger.Info("Recurring payment executed successfully")
	return result, nil
}

// pauseRecurringPayment pauses a recurring payment
func pauseRecurringPayment(ctx workflow.Context, input RecurringPaymentInput, result *RecurringPaymentResult, logger workflow.Logger) (*RecurringPaymentResult, error) {
	err := workflow.ExecuteActivity(ctx, activities.UpdateRecurringPaymentStatus, map[string]interface{}{
		"recurring_id": input.RecurringID,
		"status":       "paused",
	}).Get(ctx, nil)

	if err != nil {
		return nil, err
	}

	result.Success = true
	result.Status = "paused"
	result.Message = "Recurring payment paused"
	return result, nil
}

// resumeRecurringPayment resumes a paused recurring payment
func resumeRecurringPayment(ctx workflow.Context, input RecurringPaymentInput, result *RecurringPaymentResult, logger workflow.Logger) (*RecurringPaymentResult, error) {
	err := workflow.ExecuteActivity(ctx, activities.UpdateRecurringPaymentStatus, map[string]interface{}{
		"recurring_id": input.RecurringID,
		"status":       "active",
	}).Get(ctx, nil)

	if err != nil {
		return nil, err
	}

	result.Success = true
	result.Status = "active"
	result.Message = "Recurring payment resumed"
	return result, nil
}

// cancelRecurringPayment cancels a recurring payment
func cancelRecurringPayment(ctx workflow.Context, input RecurringPaymentInput, result *RecurringPaymentResult, logger workflow.Logger) (*RecurringPaymentResult, error) {
	err := workflow.ExecuteActivity(ctx, activities.UpdateRecurringPaymentStatus, map[string]interface{}{
		"recurring_id": input.RecurringID,
		"status":       "cancelled",
	}).Get(ctx, nil)

	if err != nil {
		return nil, err
	}

	// Send cancellation notification
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"recurring_id": input.RecurringID,
		"type":         "recurring_payment_cancelled",
		"channel":      "email,push",
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "cancelled"
	result.Message = "Recurring payment cancelled"
	return result, nil
}
