package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// AirtimeTopupInput represents input for airtime/data top-up
type AirtimeTopupInput struct {
	UserID          models.UserID   `json:"user_id"`
	PhoneNumber     string          `json:"phone_number"`
	Network         string          `json:"network"` // MTN, Airtel, Glo, 9mobile
	TopupType       string          `json:"topup_type"` // airtime, data
	Amount          decimal.Decimal `json:"amount,omitempty"` // For airtime
	DataPlan        string          `json:"data_plan,omitempty"` // For data (e.g., "1GB-30days")
	WalletID        string          `json:"wallet_id"`
	SaveBeneficiary bool            `json:"save_beneficiary"`
	BeneficiaryName string          `json:"beneficiary_name,omitempty"`
	Scheduled       bool            `json:"scheduled"`
	ScheduleTime    *time.Time      `json:"schedule_time,omitempty"`
	Recurring       bool            `json:"recurring"`
	RecurringSchedule string        `json:"recurring_schedule,omitempty"` // cron expression
}

// AirtimeTopupResult represents the workflow result
type AirtimeTopupResult struct {
	Success         bool            `json:"success"`
	TransactionID   string          `json:"transaction_id"`
	PhoneNumber     string          `json:"phone_number"`
	Network         string          `json:"network"`
	TopupType       string          `json:"topup_type"`
	Amount          decimal.Decimal `json:"amount"`
	Commission      decimal.Decimal `json:"commission"`
	VendorReference string          `json:"vendor_reference"`
	Status          string          `json:"status"` // success, pending, failed
	Message         string          `json:"message"`
	CompletedAt     time.Time       `json:"completed_at"`
}

// AirtimeTopupWorkflow implements Journey 9: Airtime/Data Top-up
//
// Steps:
// 1. Validate phone number and network
// 2. Verify data plan (if data top-up)
// 3. Calculate total amount (amount + commission)
// 4. Check wallet balance
// 5. Reserve funds (TigerBeetle)
// 6. Call telecom vendor API (via Dapr)
// 7. Commit transaction on success
// 8. Save beneficiary (if requested)
// 9. Setup recurring (if requested)
// 10. Send confirmation notification
// 11. Log to analytics
func AirtimeTopupWorkflow(ctx workflow.Context, input AirtimeTopupInput) (*AirtimeTopupResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("AirtimeTopupWorkflow started",
		"user_id", input.UserID,
		"phone_number", input.PhoneNumber,
		"network", input.Network,
		"topup_type", input.TopupType)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    2 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &AirtimeTopupResult{
		Success:     false,
		PhoneNumber: input.PhoneNumber,
		Network:     input.Network,
		TopupType:   input.TopupType,
	}

	// Handle scheduled top-up
	if input.Scheduled && input.ScheduleTime != nil {
		logger.Info("Top-up is scheduled", "schedule_time", input.ScheduleTime)
		
		// Wait until scheduled time
		err := workflow.Sleep(ctx, input.ScheduleTime.Sub(time.Now()))
		if err != nil {
			return nil, err
		}
		
		logger.Info("Scheduled time reached, executing top-up")
	}

	// Step 1: Validate phone number and network
	logger.Info("Step 1: Validating phone number and network")
	var validation activities.PhoneValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidatePhoneNumber, map[string]interface{}{
		"phone_number": input.PhoneNumber,
		"network":      input.Network,
	}).Get(ctx, &validation)

	if err != nil {
		logger.Error("Phone validation failed", "error", err)
		return nil, err
	}

	if !validation.Valid {
		result.Message = "Invalid phone number or network: " + validation.Reason
		result.Status = "failed"
		return result, nil
	}

	// Auto-detect network if not provided
	if input.Network == "" {
		input.Network = validation.DetectedNetwork
		result.Network = validation.DetectedNetwork
	}

	// Step 2: Verify data plan (if data top-up)
	var finalAmount decimal.Decimal
	
	if input.TopupType == "data" {
		logger.Info("Step 2: Verifying data plan")
		var dataPlan activities.DataPlanResult
		err = workflow.ExecuteActivity(ctx, activities.GetDataPlanDetails, map[string]interface{}{
			"network":   input.Network,
			"data_plan": input.DataPlan,
		}).Get(ctx, &dataPlan)

		if err != nil || !dataPlan.Valid {
			result.Message = "Invalid data plan"
			result.Status = "failed"
			return result, nil
		}

		finalAmount = dataPlan.Amount
		logger.Info("Data plan verified", "plan", input.DataPlan, "amount", finalAmount)
	} else {
		// Airtime top-up
		finalAmount = input.Amount
		
		// Validate minimum and maximum amounts
		minAmount := decimal.NewFromInt(50)  // NGN 50
		maxAmount := decimal.NewFromInt(50000) // NGN 50,000
		
		if finalAmount.LessThan(minAmount) || finalAmount.GreaterThan(maxAmount) {
			result.Message = "Amount must be between NGN 50 and NGN 50,000"
			result.Status = "failed"
			return result, nil
		}
	}

	result.Amount = finalAmount

	// Step 3: Calculate commission
	logger.Info("Step 3: Calculating commission")
	var commission activities.CommissionResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateTopupCommission, map[string]interface{}{
		"network":    input.Network,
		"topup_type": input.TopupType,
		"amount":     finalAmount,
	}).Get(ctx, &commission)

	if err != nil {
		logger.Error("Commission calculation failed", "error", err)
		return nil, err
	}

	result.Commission = commission.Commission
	totalAmount := finalAmount.Add(commission.Commission)

	logger.Info("Commission calculated", "commission", commission.Commission, "total", totalAmount)

	// Step 4: Check wallet balance
	logger.Info("Step 4: Checking wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.WalletID,
		"currency":  "NGN",
		"amount":    totalAmount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance"
		result.Status = "failed"
		return result, nil
	}

	// Step 5: Reserve funds (TigerBeetle)
	logger.Info("Step 5: Reserving funds")
	var reservation activities.FundReservationResult
	err = workflow.ExecuteActivity(ctx, activities.ReserveFunds, map[string]interface{}{
		"wallet_id": input.WalletID,
		"amount":    totalAmount,
		"currency":  "NGN",
		"reference": "airtime_topup_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		logger.Error("Fund reservation failed", "error", err)
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 6: Call telecom vendor API (via Dapr)
	logger.Info("Step 6: Calling telecom vendor API")
	var vendorResponse activities.TelecomVendorResult
	err = workflow.ExecuteActivity(ctx, activities.ProcessTelecomTopup, map[string]interface{}{
		"phone_number": input.PhoneNumber,
		"network":      input.Network,
		"topup_type":   input.TopupType,
		"amount":       finalAmount,
		"data_plan":    input.DataPlan,
	}).Get(ctx, &vendorResponse)

	if err != nil || !vendorResponse.Success {
		logger.Error("Vendor API call failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Top-up failed: " + vendorResponse.ErrorMessage
		result.Status = "failed"
		return result, nil
	}

	result.VendorReference = vendorResponse.VendorReference
	logger.Info("Vendor API call successful", "vendor_ref", vendorResponse.VendorReference)

	// Step 7: Commit transaction (TigerBeetle)
	logger.Info("Step 7: Committing transaction")
	var transaction activities.TransactionResult
	err = workflow.ExecuteActivity(ctx, activities.CommitTransaction, map[string]interface{}{
		"reservation_id":   reservationID,
		"wallet_id":        input.WalletID,
		"amount":           totalAmount,
		"currency":         "NGN",
		"type":             "airtime_topup",
		"vendor_reference": vendorResponse.VendorReference,
		"metadata": map[string]interface{}{
			"phone_number": input.PhoneNumber,
			"network":      input.Network,
			"topup_type":   input.TopupType,
			"data_plan":    input.DataPlan,
		},
	}).Get(ctx, &transaction)

	if err != nil {
		logger.Error("Transaction commit failed", "error", err)
		// Note: Vendor top-up already succeeded, so we can't fully compensate
		// Log for manual reconciliation
		_ = workflow.ExecuteActivity(ctx, activities.LogReconciliationIssue, map[string]interface{}{
			"vendor_reference": vendorResponse.VendorReference,
			"reservation_id":   reservationID,
			"error":            err.Error(),
		}).Get(ctx, nil)
		
		return nil, err
	}

	result.TransactionID = transaction.TransactionID
	logger.Info("Transaction committed", "transaction_id", transaction.TransactionID)

	// Step 8: Save beneficiary (if requested)
	if input.SaveBeneficiary {
		logger.Info("Step 8: Saving beneficiary")
		_ = workflow.ExecuteActivity(ctx, activities.SaveTopupBeneficiary, map[string]interface{}{
			"user_id":          input.UserID,
			"phone_number":     input.PhoneNumber,
			"network":          input.Network,
			"beneficiary_name": input.BeneficiaryName,
		}).Get(ctx, nil)
	}

	// Step 9: Setup recurring (if requested)
	if input.Recurring && input.RecurringSchedule != "" {
		logger.Info("Step 9: Setting up recurring top-up")
		_ = workflow.ExecuteActivity(ctx, activities.SetupRecurringTopup, map[string]interface{}{
			"user_id":      input.UserID,
			"phone_number": input.PhoneNumber,
			"network":      input.Network,
			"topup_type":   input.TopupType,
			"amount":       finalAmount,
			"data_plan":    input.DataPlan,
			"schedule":     input.RecurringSchedule,
			"wallet_id":    input.WalletID,
		}).Get(ctx, nil)
	}

	// Step 10: Send confirmation notification
	logger.Info("Step 10: Sending confirmation notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "topup_success",
		"channel": "sms,push",
		"data": map[string]interface{}{
			"phone_number":     input.PhoneNumber,
			"network":          input.Network,
			"topup_type":       input.TopupType,
			"amount":           finalAmount,
			"commission":       commission.Commission,
			"transaction_id":   transaction.TransactionID,
			"vendor_reference": vendorResponse.VendorReference,
		},
	}).Get(ctx, nil)

	// Step 11: Log to analytics
	logger.Info("Step 11: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "airtime_topup",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"network":      input.Network,
			"topup_type":   input.TopupType,
			"amount":       finalAmount,
			"commission":   commission.Commission,
			"data_plan":    input.DataPlan,
			"recurring":    input.Recurring,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "Top-up completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("AirtimeTopupWorkflow completed successfully")
	return result, nil
}
