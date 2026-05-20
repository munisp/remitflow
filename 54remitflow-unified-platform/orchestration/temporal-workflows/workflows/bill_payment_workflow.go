package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// BillPaymentInput represents input for bill payment
type BillPaymentInput struct {
	UserID          models.UserID   `json:"user_id"`
	BillerID        string          `json:"biller_id"` // Electricity, Water, Internet, etc.
	BillerCategory  string          `json:"biller_category"` // utility, telecom, cable, etc.
	AccountNumber   string          `json:"account_number"` // Customer account with biller
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	AutoDetectAmount bool           `json:"auto_detect_amount"` // Query biller for amount
	SaveBiller      bool            `json:"save_biller"` // Save for future payments
	WalletID        string          `json:"wallet_id"`
}

// BillPaymentResult represents the workflow result
type BillPaymentResult struct {
	Success          bool            `json:"success"`
	TransactionID    string          `json:"transaction_id"`
	BillerName       string          `json:"biller_name"`
	Amount           decimal.Decimal `json:"amount"`
	Fee              decimal.Decimal `json:"fee"`
	TotalAmount      decimal.Decimal `json:"total_amount"`
	ConfirmationCode string          `json:"confirmation_code"` // From biller
	Receipt          string          `json:"receipt"` // Receipt URL
	Message          string          `json:"message"`
	CompletedAt      time.Time       `json:"completed_at"`
}

// BillPaymentWorkflow implements Journey 8: Bill Payment (Utilities)
//
// Steps:
// 1. Validate biller
// 2. Validate customer account with biller
// 3. Query bill amount (if auto-detect)
// 4. Calculate fees
// 5. Check wallet balance
// 6. Reserve funds (TigerBeetle)
// 7. Call biller API (Dapr)
// 8. Confirm payment with biller
// 9. Commit transaction (TigerBeetle)
// 10. Generate receipt
// 11. Send confirmation notification
// 12. Save biller (if requested)
func BillPaymentWorkflow(ctx workflow.Context, input BillPaymentInput) (*BillPaymentResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BillPaymentWorkflow started",
		"user_id", input.UserID,
		"biller_id", input.BillerID,
		"account_number", input.AccountNumber)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &BillPaymentResult{
		Success: false,
	}

	// Step 1: Validate biller
	logger.Info("Step 1: Validating biller")
	var billerValidation activities.BillerValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateBiller, map[string]interface{}{
		"biller_id":       input.BillerID,
		"biller_category": input.BillerCategory,
	}).Get(ctx, &billerValidation)

	if err != nil {
		logger.Error("Biller validation failed", "error", err)
		return nil, err
	}

	if !billerValidation.Valid {
		result.Message = "Invalid biller: " + billerValidation.Reason
		return result, nil
	}

	result.BillerName = billerValidation.BillerName

	// Step 2: Validate customer account with biller
	logger.Info("Step 2: Validating customer account with biller")
	var accountValidation activities.BillerAccountValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidateBillerAccount, map[string]interface{}{
		"biller_id":      input.BillerID,
		"account_number": input.AccountNumber,
	}).Get(ctx, &accountValidation)

	if err != nil {
		logger.Error("Account validation failed", "error", err)
		return nil, err
	}

	if !accountValidation.Valid {
		result.Message = "Invalid account number: " + accountValidation.Reason
		return result, nil
	}

	// Step 3: Query bill amount (if auto-detect)
	var billAmount decimal.Decimal
	if input.AutoDetectAmount {
		logger.Info("Step 3: Querying bill amount from biller")
		var billQuery activities.BillQueryResult
		err = workflow.ExecuteActivity(ctx, activities.QueryBillAmount, map[string]interface{}{
			"biller_id":      input.BillerID,
			"account_number": input.AccountNumber,
		}).Get(ctx, &billQuery)

		if err != nil {
			logger.Error("Bill query failed", "error", err)
			return nil, err
		}

		if !billQuery.Success {
			result.Message = "Unable to query bill amount: " + billQuery.Reason
			return result, nil
		}

		billAmount = billQuery.Amount
		logger.Info("Bill amount retrieved", "amount", billAmount)
	} else {
		billAmount = input.Amount
	}

	result.Amount = billAmount

	// Step 4: Calculate fees
	logger.Info("Step 4: Calculating fees")
	var feeCalculation activities.FeeCalculationResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateBillPaymentFee, map[string]interface{}{
		"biller_category": input.BillerCategory,
		"amount":          billAmount,
		"currency":        input.Currency,
	}).Get(ctx, &feeCalculation)

	if err != nil {
		logger.Error("Fee calculation failed", "error", err)
		return nil, err
	}

	result.Fee = feeCalculation.Fee
	result.TotalAmount = billAmount.Add(feeCalculation.Fee)

	logger.Info("Fees calculated", "fee", result.Fee, "total", result.TotalAmount)

	// Step 5: Check wallet balance
	logger.Info("Step 5: Checking wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.WalletID,
		"currency":  input.Currency,
		"amount":    result.TotalAmount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance. Required: " + result.TotalAmount.String() + " " + input.Currency
		return result, nil
	}

	// Step 6: Reserve funds (TigerBeetle)
	logger.Info("Step 6: Reserving funds in TigerBeetle")
	var reservation activities.LedgerReservationResult
	err = workflow.ExecuteActivity(ctx, activities.ReserveFunds, map[string]interface{}{
		"wallet_id": input.WalletID,
		"amount":    result.TotalAmount,
		"currency":  input.Currency,
		"purpose":   "bill_payment",
		"reference": input.BillerID + "-" + input.AccountNumber,
	}).Get(ctx, &reservation)

	if err != nil {
		logger.Error("Fund reservation failed", "error", err)
		return nil, err
	}

	logger.Info("Funds reserved", "reservation_id", reservation.ReservationID)

	// Step 7: Call biller API (Dapr)
	logger.Info("Step 7: Calling biller API via Dapr")
	billerOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute, // Biller APIs can be slow
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	billerCtx := workflow.WithActivityOptions(ctx, billerOptions)

	var billerPayment activities.BillerPaymentResult
	err = workflow.ExecuteActivity(billerCtx, activities.ExecuteBillerPayment, map[string]interface{}{
		"biller_id":      input.BillerID,
		"account_number": input.AccountNumber,
		"amount":         billAmount,
		"currency":       input.Currency,
		"customer_name":  accountValidation.CustomerName,
	}).Get(billerCtx, &billerPayment)

	if err != nil {
		logger.Error("Biller payment failed, compensating", "error", err)
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservation.ReservationID,
		}).Get(ctx, nil)
		return nil, err
	}

	if !billerPayment.Success {
		logger.Warn("Biller rejected payment", "reason", billerPayment.Reason)
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservation.ReservationID,
		}).Get(ctx, nil)
		result.Message = "Payment rejected by biller: " + billerPayment.Reason
		return result, nil
	}

	result.ConfirmationCode = billerPayment.ConfirmationCode
	logger.Info("Biller payment successful", "confirmation", billerPayment.ConfirmationCode)

	// Step 8: Commit transaction (TigerBeetle)
	logger.Info("Step 8: Committing transaction in TigerBeetle")
	var ledgerCommit activities.LedgerCommitResult
	err = workflow.ExecuteActivity(ctx, activities.CommitTransaction, map[string]interface{}{
		"reservation_id":    reservation.ReservationID,
		"confirmation_code": billerPayment.ConfirmationCode,
		"biller_id":         input.BillerID,
	}).Get(ctx, &ledgerCommit)

	if err != nil {
		logger.Error("Ledger commit failed", "error", err)
		// Critical: Payment succeeded at biller but ledger failed
		// Log for manual reconciliation
		_ = workflow.ExecuteActivity(ctx, activities.LogCriticalError, map[string]interface{}{
			"error_type":        "ledger_commit_failed",
			"biller_confirmation": billerPayment.ConfirmationCode,
			"reservation_id":    reservation.ReservationID,
			"amount":            result.TotalAmount,
		}).Get(ctx, nil)
		return nil, err
	}

	result.TransactionID = ledgerCommit.TransactionID
	logger.Info("Transaction committed", "transaction_id", result.TransactionID)

	// Step 9: Generate receipt
	logger.Info("Step 9: Generating receipt")
	var receipt activities.ReceiptGenerationResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateReceipt, map[string]interface{}{
		"transaction_id":    result.TransactionID,
		"user_id":           input.UserID,
		"biller_name":       result.BillerName,
		"account_number":    input.AccountNumber,
		"amount":            result.Amount,
		"fee":               result.Fee,
		"total":             result.TotalAmount,
		"confirmation_code": result.ConfirmationCode,
		"timestamp":         time.Now(),
	}).Get(ctx, &receipt)

	if err != nil {
		logger.Warn("Receipt generation failed (non-critical)", "error", err)
	} else {
		result.Receipt = receipt.ReceiptURL
	}

	// Step 10: Send confirmation notification
	logger.Info("Step 10: Sending confirmation notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "bill_payment_success",
		"channel": "email,sms,push",
		"data": map[string]interface{}{
			"biller_name":       result.BillerName,
			"account_number":    input.AccountNumber,
			"amount":            result.Amount,
			"fee":               result.Fee,
			"confirmation_code": result.ConfirmationCode,
			"receipt_url":       result.Receipt,
		},
	}).Get(ctx, nil)

	// Step 11: Save biller (if requested)
	if input.SaveBiller {
		logger.Info("Step 11: Saving biller for future payments")
		_ = workflow.ExecuteActivity(ctx, activities.SaveBillerForUser, map[string]interface{}{
			"user_id":        input.UserID,
			"biller_id":      input.BillerID,
			"account_number": input.AccountNumber,
			"nickname":       result.BillerName,
		}).Get(ctx, nil)
	}

	// Step 12: Log to analytics (Lakehouse)
	logger.Info("Step 12: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "bill_payment_completed",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"biller_id":       input.BillerID,
			"biller_category": input.BillerCategory,
			"amount":          result.Amount,
			"fee":             result.Fee,
			"transaction_id":  result.TransactionID,
		},
	}).Get(ctx, nil)

	// Success
	result.Success = true
	result.Message = "Bill payment completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("BillPaymentWorkflow completed successfully",
		"transaction_id", result.TransactionID,
		"confirmation", result.ConfirmationCode)

	return result, nil
}
