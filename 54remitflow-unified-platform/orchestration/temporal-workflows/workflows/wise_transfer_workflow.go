package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// WiseTransferInput represents input for Wise (formerly TransferWise) low-cost remittance
type WiseTransferInput struct {
	UserID            models.UserID   `json:"user_id"`
	SourceCurrency    string          `json:"source_currency"`
	TargetCurrency    string          `json:"target_currency"`
	SourceAmount      decimal.Decimal `json:"source_amount,omitempty"`      // Amount to send
	TargetAmount      decimal.Decimal `json:"target_amount,omitempty"`      // Amount to receive
	WalletID          string          `json:"wallet_id"`
	RecipientName     string          `json:"recipient_name"`
	RecipientEmail    string          `json:"recipient_email,omitempty"`
	RecipientAccount  string          `json:"recipient_account"`            // Bank account or email
	RecipientCountry  string          `json:"recipient_country"`
	RecipientBank     string          `json:"recipient_bank,omitempty"`
	TransferPurpose   string          `json:"transfer_purpose"`             // family_support, education, etc.
	SaveBeneficiary   bool            `json:"save_beneficiary"`
}

// WiseTransferResult represents the workflow result
type WiseTransferResult struct {
	Success           bool            `json:"success"`
	TransactionID     string          `json:"transaction_id"`
	WiseTransferID    string          `json:"wise_transfer_id"`
	SourceAmount      decimal.Decimal `json:"source_amount"`
	TargetAmount      decimal.Decimal `json:"target_amount"`
	ExchangeRate      decimal.Decimal `json:"exchange_rate"`
	WiseFee           decimal.Decimal `json:"wise_fee"`
	PlatformFee       decimal.Decimal `json:"platform_fee"`
	TotalCost         decimal.Decimal `json:"total_cost"`
	EstimatedArrival  time.Time       `json:"estimated_arrival"`
	Status            string          `json:"status"` // success, pending, failed
	Message           string          `json:"message"`
	CompletedAt       time.Time       `json:"completed_at"`
}

// WiseTransferWorkflow implements Journey 12: Wise Transfer (Low-Cost Remittance)
//
// Steps:
// 1. Get real-time Wise exchange rate
// 2. Calculate fees (Wise fee + platform fee)
// 3. Validate recipient details
// 4. Check wallet balance
// 5. Reserve funds (TigerBeetle)
// 6. Create Wise transfer via API
// 7. Fund the Wise transfer
// 8. Commit transaction
// 9. Save beneficiary (if requested)
// 10. Send notifications
// 11. Log to analytics
func WiseTransferWorkflow(ctx workflow.Context, input WiseTransferInput) (*WiseTransferResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("WiseTransferWorkflow started",
		"user_id", input.UserID,
		"source_currency", input.SourceCurrency,
		"target_currency", input.TargetCurrency)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    3 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &WiseTransferResult{
		Success: false,
	}

	// Step 1: Get real-time Wise exchange rate and quote
	logger.Info("Step 1: Getting Wise quote")
	var quote activities.WiseQuoteResult
	err := workflow.ExecuteActivity(ctx, activities.GetWiseQuote, map[string]interface{}{
		"source_currency": input.SourceCurrency,
		"target_currency": input.TargetCurrency,
		"source_amount":   input.SourceAmount,
		"target_amount":   input.TargetAmount,
	}).Get(ctx, &quote)

	if err != nil {
		logger.Error("Failed to get Wise quote", "error", err)
		return nil, err
	}

	result.SourceAmount = quote.SourceAmount
	result.TargetAmount = quote.TargetAmount
	result.ExchangeRate = quote.ExchangeRate
	result.WiseFee = quote.Fee
	result.EstimatedArrival = quote.EstimatedDelivery

	logger.Info("Wise quote received",
		"rate", quote.ExchangeRate,
		"fee", quote.Fee,
		"target_amount", quote.TargetAmount)

	// Step 2: Calculate platform fee
	logger.Info("Step 2: Calculating platform fee")
	var platformFee activities.FeeResult
	err = workflow.ExecuteActivity(ctx, activities.CalculatePlatformFee, map[string]interface{}{
		"amount":       quote.SourceAmount,
		"currency":     input.SourceCurrency,
		"service_type": "wise_transfer",
	}).Get(ctx, &platformFee)

	if err != nil {
		return nil, err
	}

	result.PlatformFee = platformFee.Fee
	result.TotalCost = quote.SourceAmount.Add(quote.Fee).Add(platformFee.Fee)

	logger.Info("Total cost calculated", "total", result.TotalCost)

	// Step 3: Validate recipient details
	logger.Info("Step 3: Validating recipient")
	var recipientValidation activities.RecipientValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidateWiseRecipient, map[string]interface{}{
		"recipient_name":    input.RecipientName,
		"recipient_account": input.RecipientAccount,
		"recipient_country": input.RecipientCountry,
		"currency":          input.TargetCurrency,
	}).Get(ctx, &recipientValidation)

	if err != nil || !recipientValidation.Valid {
		result.Message = "Invalid recipient details: " + recipientValidation.Reason
		result.Status = "failed"
		return result, nil
	}

	// Step 4: Check wallet balance
	logger.Info("Step 4: Checking wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.WalletID,
		"currency":  input.SourceCurrency,
		"amount":    result.TotalCost,
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
		"amount":    result.TotalCost,
		"currency":  input.SourceCurrency,
		"reference": "wise_transfer_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 6: Create Wise transfer via API
	logger.Info("Step 6: Creating Wise transfer")
	var wiseTransfer activities.WiseTransferResult
	err = workflow.ExecuteActivity(ctx, activities.CreateWiseTransfer, map[string]interface{}{
		"quote_id":          quote.QuoteID,
		"recipient_name":    input.RecipientName,
		"recipient_email":   input.RecipientEmail,
		"recipient_account": input.RecipientAccount,
		"recipient_country": input.RecipientCountry,
		"recipient_bank":    input.RecipientBank,
		"transfer_purpose":  input.TransferPurpose,
		"reference":         "Platform Transfer - " + input.UserID.String(),
	}).Get(ctx, &wiseTransfer)

	if err != nil || !wiseTransfer.Success {
		logger.Error("Wise transfer creation failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Transfer creation failed: " + wiseTransfer.ErrorMessage
		result.Status = "failed"
		return result, nil
	}

	result.WiseTransferID = wiseTransfer.TransferID
	logger.Info("Wise transfer created", "wise_transfer_id", wiseTransfer.TransferID)

	// Step 7: Fund the Wise transfer
	logger.Info("Step 7: Funding Wise transfer")
	var funding activities.WiseFundingResult
	err = workflow.ExecuteActivity(ctx, activities.FundWiseTransfer, map[string]interface{}{
		"transfer_id": wiseTransfer.TransferID,
		"amount":      quote.SourceAmount.Add(quote.Fee),
		"currency":    input.SourceCurrency,
	}).Get(ctx, &funding)

	if err != nil || !funding.Success {
		logger.Error("Wise funding failed, compensating", "error", err)
		
		// Compensate: Cancel Wise transfer and unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.CancelWiseTransfer, map[string]interface{}{
			"transfer_id": wiseTransfer.TransferID,
		}).Get(ctx, nil)
		
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Transfer funding failed"
		result.Status = "failed"
		return result, nil
	}

	// Step 8: Commit transaction (TigerBeetle)
	logger.Info("Step 8: Committing transaction")
	var transaction activities.TransactionResult
	err = workflow.ExecuteActivity(ctx, activities.CommitTransaction, map[string]interface{}{
		"reservation_id":    reservationID,
		"wallet_id":         input.WalletID,
		"amount":            result.TotalCost,
		"currency":          input.SourceCurrency,
		"type":              "wise_transfer",
		"wise_transfer_id":  wiseTransfer.TransferID,
		"metadata": map[string]interface{}{
			"recipient_name":    input.RecipientName,
			"recipient_country": input.RecipientCountry,
			"target_amount":     quote.TargetAmount,
			"target_currency":   input.TargetCurrency,
			"exchange_rate":     quote.ExchangeRate,
		},
	}).Get(ctx, &transaction)

	if err != nil {
		logger.Error("Transaction commit failed", "error", err)
		// Note: Wise transfer already funded, log for reconciliation
		_ = workflow.ExecuteActivity(ctx, activities.LogReconciliationIssue, map[string]interface{}{
			"wise_transfer_id": wiseTransfer.TransferID,
			"reservation_id":   reservationID,
			"error":            err.Error(),
		}).Get(ctx, nil)
		
		return nil, err
	}

	result.TransactionID = transaction.TransactionID
	logger.Info("Transaction committed", "transaction_id", transaction.TransactionID)

	// Step 9: Save beneficiary (if requested)
	if input.SaveBeneficiary {
		logger.Info("Step 9: Saving beneficiary")
		_ = workflow.ExecuteActivity(ctx, activities.SaveWiseBeneficiary, map[string]interface{}{
			"user_id":           input.UserID,
			"recipient_name":    input.RecipientName,
			"recipient_email":   input.RecipientEmail,
			"recipient_account": input.RecipientAccount,
			"recipient_country": input.RecipientCountry,
			"recipient_bank":    input.RecipientBank,
			"currency":          input.TargetCurrency,
		}).Get(ctx, nil)
	}

	// Step 10: Send notifications
	logger.Info("Step 10: Sending notifications")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "wise_transfer_success",
		"channel": "email,push",
		"data": map[string]interface{}{
			"recipient_name":    input.RecipientName,
			"source_amount":     quote.SourceAmount,
			"source_currency":   input.SourceCurrency,
			"target_amount":     quote.TargetAmount,
			"target_currency":   input.TargetCurrency,
			"exchange_rate":     quote.ExchangeRate,
			"wise_fee":          quote.Fee,
			"platform_fee":      platformFee.Fee,
			"transaction_id":    transaction.TransactionID,
			"wise_transfer_id":  wiseTransfer.TransferID,
			"estimated_arrival": quote.EstimatedDelivery,
		},
	}).Get(ctx, nil)

	// Step 11: Log to analytics
	logger.Info("Step 11: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "wise_transfer",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"source_currency":   input.SourceCurrency,
			"target_currency":   input.TargetCurrency,
			"source_amount":     quote.SourceAmount,
			"target_amount":     quote.TargetAmount,
			"exchange_rate":     quote.ExchangeRate,
			"wise_fee":          quote.Fee,
			"platform_fee":      platformFee.Fee,
			"recipient_country": input.RecipientCountry,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "Wise transfer completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("WiseTransferWorkflow completed successfully")
	return result, nil
}
