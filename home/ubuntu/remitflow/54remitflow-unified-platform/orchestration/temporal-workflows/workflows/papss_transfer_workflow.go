package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// PAPSSTransferInput represents input for PAPSS (Pan-African Payment and Settlement System) transfer
type PAPSSTransferInput struct {
	UserID            models.UserID   `json:"user_id"`
	SourceCurrency    string          `json:"source_currency"`
	TargetCurrency    string          `json:"target_currency"`
	Amount            decimal.Decimal `json:"amount"`
	WalletID          string          `json:"wallet_id"`
	RecipientName     string          `json:"recipient_name"`
	RecipientAccount  string          `json:"recipient_account"`
	RecipientBank     string          `json:"recipient_bank"`
	RecipientCountry  string          `json:"recipient_country"` // Must be African country
	RecipientCity     string          `json:"recipient_city"`
	TransferPurpose   string          `json:"transfer_purpose"`
	SaveBeneficiary   bool            `json:"save_beneficiary"`
}

// PAPSSTransferResult represents the workflow result
type PAPSSTransferResult struct {
	Success          bool            `json:"success"`
	TransactionID    string          `json:"transaction_id"`
	PAPSSReferenceID string          `json:"papss_reference_id"`
	Amount           decimal.Decimal `json:"amount"`
	SourceCurrency   string          `json:"source_currency"`
	TargetCurrency   string          `json:"target_currency"`
	ExchangeRate     decimal.Decimal `json:"exchange_rate"`
	PAPSSFee         decimal.Decimal `json:"papss_fee"`
	PlatformFee      decimal.Decimal `json:"platform_fee"`
	TotalCost        decimal.Decimal `json:"total_cost"`
	EstimatedArrival time.Time       `json:"estimated_arrival"`
	Status           string          `json:"status"` // success, pending, failed
	Message          string          `json:"message"`
	CompletedAt      time.Time       `json:"completed_at"`
}

// PAPSSTransferWorkflow implements Journey 14: Cross-Border Payment via PAPSS
//
// PAPSS enables instant, low-cost cross-border payments across Africa
// Supports 42+ African countries with local currency settlement
//
// Steps:
// 1. Validate recipient country (must be PAPSS-supported African country)
// 2. Get PAPSS exchange rate
// 3. Calculate fees (PAPSS fee + platform fee)
// 4. Validate recipient bank details
// 5. Check wallet balance
// 6. Reserve funds (TigerBeetle)
// 7. Initiate PAPSS transfer
// 8. Monitor transfer status
// 9. Commit transaction
// 10. Save beneficiary (if requested)
// 11. Send notifications
// 12. Log to analytics
func PAPSSTransferWorkflow(ctx workflow.Context, input PAPSSTransferInput) (*PAPSSTransferResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("PAPSSTransferWorkflow started",
		"user_id", input.UserID,
		"recipient_country", input.RecipientCountry,
		"amount", input.Amount)

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

	result := &PAPSSTransferResult{
		Success:        false,
		Amount:         input.Amount,
		SourceCurrency: input.SourceCurrency,
		TargetCurrency: input.TargetCurrency,
	}

	// Step 1: Validate recipient country (must be PAPSS-supported)
	logger.Info("Step 1: Validating PAPSS country support")
	var countryValidation activities.PAPSSCountryResult
	err := workflow.ExecuteActivity(ctx, activities.ValidatePAPSSCountry, map[string]interface{}{
		"country": input.RecipientCountry,
	}).Get(ctx, &countryValidation)

	if err != nil || !countryValidation.Supported {
		result.Message = "Country not supported by PAPSS: " + input.RecipientCountry
		result.Status = "failed"
		return result, nil
	}

	logger.Info("Country supported", "country", input.RecipientCountry, "currency", countryValidation.Currency)

	// Step 2: Get PAPSS exchange rate
	logger.Info("Step 2: Getting PAPSS exchange rate")
	var exchangeRate activities.ExchangeRateResult
	err = workflow.ExecuteActivity(ctx, activities.GetPAPSSExchangeRate, map[string]interface{}{
		"source_currency": input.SourceCurrency,
		"target_currency": input.TargetCurrency,
	}).Get(ctx, &exchangeRate)

	if err != nil {
		return nil, err
	}

	result.ExchangeRate = exchangeRate.Rate
	targetAmount := input.Amount.Mul(exchangeRate.Rate)
	logger.Info("Exchange rate fetched", "rate", exchangeRate.Rate, "target_amount", targetAmount)

	// Step 3: Calculate fees
	logger.Info("Step 3: Calculating fees")
	
	// PAPSS fee (typically 0.5% - much lower than SWIFT)
	var papssFee activities.FeeResult
	err = workflow.ExecuteActivity(ctx, activities.CalculatePAPSSFee, map[string]interface{}{
		"amount":          input.Amount,
		"source_currency": input.SourceCurrency,
		"target_currency": input.TargetCurrency,
	}).Get(ctx, &papssFee)

	if err != nil {
		return nil, err
	}

	result.PAPSSFee = papssFee.Fee

	// Platform fee
	var platformFee activities.FeeResult
	err = workflow.ExecuteActivity(ctx, activities.CalculatePlatformFee, map[string]interface{}{
		"amount":       input.Amount,
		"currency":     input.SourceCurrency,
		"service_type": "papss_transfer",
	}).Get(ctx, &platformFee)

	if err != nil {
		return nil, err
	}

	result.PlatformFee = platformFee.Fee
	result.TotalCost = input.Amount.Add(papssFee.Fee).Add(platformFee.Fee)

	logger.Info("Fees calculated",
		"papss_fee", papssFee.Fee,
		"platform_fee", platformFee.Fee,
		"total_cost", result.TotalCost)

	// Step 4: Validate recipient bank details
	logger.Info("Step 4: Validating recipient bank")
	var bankValidation activities.BankValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidatePAPSSBank, map[string]interface{}{
		"bank_code":    input.RecipientBank,
		"account_number": input.RecipientAccount,
		"country":      input.RecipientCountry,
	}).Get(ctx, &bankValidation)

	if err != nil || !bankValidation.Valid {
		result.Message = "Invalid bank details: " + bankValidation.Reason
		result.Status = "failed"
		return result, nil
	}

	logger.Info("Bank validated", "bank_name", bankValidation.BankName)

	// Step 5: Check wallet balance
	logger.Info("Step 5: Checking wallet balance")
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

	// Step 6: Reserve funds (TigerBeetle)
	logger.Info("Step 6: Reserving funds")
	var reservation activities.FundReservationResult
	err = workflow.ExecuteActivity(ctx, activities.ReserveFunds, map[string]interface{}{
		"wallet_id": input.WalletID,
		"amount":    result.TotalCost,
		"currency":  input.SourceCurrency,
		"reference": "papss_transfer_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 7: Initiate PAPSS transfer
	logger.Info("Step 7: Initiating PAPSS transfer")
	var papssTransfer activities.PAPSSTransferResult
	err = workflow.ExecuteActivity(ctx, activities.InitiatePAPSSTransfer, map[string]interface{}{
		"sender_name":       "Platform User",
		"sender_country":    "NG", // Nigeria
		"recipient_name":    input.RecipientName,
		"recipient_account": input.RecipientAccount,
		"recipient_bank":    input.RecipientBank,
		"recipient_country": input.RecipientCountry,
		"recipient_city":    input.RecipientCity,
		"amount":            input.Amount,
		"source_currency":   input.SourceCurrency,
		"target_currency":   input.TargetCurrency,
		"purpose":           input.TransferPurpose,
		"reference":         "Platform-" + input.UserID.String(),
	}).Get(ctx, &papssTransfer)

	if err != nil || !papssTransfer.Success {
		logger.Error("PAPSS transfer initiation failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Transfer initiation failed: " + papssTransfer.ErrorMessage
		result.Status = "failed"
		return result, nil
	}

	result.PAPSSReferenceID = papssTransfer.ReferenceID
	result.EstimatedArrival = papssTransfer.EstimatedArrival
	logger.Info("PAPSS transfer initiated", "reference_id", papssTransfer.ReferenceID)

	// Step 8: Monitor transfer status (PAPSS is usually instant, but monitor for confirmation)
	logger.Info("Step 8: Monitoring transfer status")
	
	maxAttempts := 10
	checkInterval := 30 * time.Second
	
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		var status activities.PAPSSStatusResult
		err = workflow.ExecuteActivity(ctx, activities.GetPAPSSTransferStatus, map[string]interface{}{
			"reference_id": papssTransfer.ReferenceID,
		}).Get(ctx, &status)

		if err != nil {
			logger.Warn("Status check failed", "attempt", attempt, "error", err)
			workflow.Sleep(ctx, checkInterval)
			continue
		}

		logger.Info("Transfer status", "status", status.Status, "attempt", attempt)

		if status.Status == "completed" {
			logger.Info("Transfer completed successfully")
			break
		} else if status.Status == "failed" {
			logger.Error("Transfer failed", "reason", status.FailureReason)
			
			// Compensate: Unreserve funds
			_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
				"reservation_id": reservationID,
			}).Get(ctx, nil)

			result.Message = "Transfer failed: " + status.FailureReason
			result.Status = "failed"
			return result, nil
		}

		// Wait before next check
		if attempt < maxAttempts {
			workflow.Sleep(ctx, checkInterval)
		}
	}

	// Step 9: Commit transaction (TigerBeetle)
	logger.Info("Step 9: Committing transaction")
	var transaction activities.TransactionResult
	err = workflow.ExecuteActivity(ctx, activities.CommitTransaction, map[string]interface{}{
		"reservation_id":     reservationID,
		"wallet_id":          input.WalletID,
		"amount":             result.TotalCost,
		"currency":           input.SourceCurrency,
		"type":               "papss_transfer",
		"papss_reference_id": papssTransfer.ReferenceID,
		"metadata": map[string]interface{}{
			"recipient_name":    input.RecipientName,
			"recipient_country": input.RecipientCountry,
			"target_amount":     targetAmount,
			"target_currency":   input.TargetCurrency,
			"exchange_rate":     exchangeRate.Rate,
		},
	}).Get(ctx, &transaction)

	if err != nil {
		logger.Error("Transaction commit failed", "error", err)
		// Note: PAPSS transfer already completed, log for reconciliation
		_ = workflow.ExecuteActivity(ctx, activities.LogReconciliationIssue, map[string]interface{}{
			"papss_reference_id": papssTransfer.ReferenceID,
			"reservation_id":     reservationID,
			"error":              err.Error(),
		}).Get(ctx, nil)
		
		return nil, err
	}

	result.TransactionID = transaction.TransactionID
	logger.Info("Transaction committed", "transaction_id", transaction.TransactionID)

	// Step 10: Save beneficiary (if requested)
	if input.SaveBeneficiary {
		logger.Info("Step 10: Saving beneficiary")
		_ = workflow.ExecuteActivity(ctx, activities.SavePAPSSBeneficiary, map[string]interface{}{
			"user_id":           input.UserID,
			"recipient_name":    input.RecipientName,
			"recipient_account": input.RecipientAccount,
			"recipient_bank":    input.RecipientBank,
			"recipient_country": input.RecipientCountry,
			"recipient_city":    input.RecipientCity,
			"currency":          input.TargetCurrency,
		}).Get(ctx, nil)
	}

	// Step 11: Send notifications
	logger.Info("Step 11: Sending notifications")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "papss_transfer_success",
		"channel": "email,push,sms",
		"data": map[string]interface{}{
			"recipient_name":     input.RecipientName,
			"recipient_country":  input.RecipientCountry,
			"amount":             input.Amount,
			"source_currency":    input.SourceCurrency,
			"target_amount":      targetAmount,
			"target_currency":    input.TargetCurrency,
			"exchange_rate":      exchangeRate.Rate,
			"papss_fee":          papssFee.Fee,
			"platform_fee":       platformFee.Fee,
			"transaction_id":     transaction.TransactionID,
			"papss_reference_id": papssTransfer.ReferenceID,
			"estimated_arrival":  papssTransfer.EstimatedArrival,
		},
	}).Get(ctx, nil)

	// Step 12: Log to analytics
	logger.Info("Step 12: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "papss_transfer",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"source_currency":   input.SourceCurrency,
			"target_currency":   input.TargetCurrency,
			"amount":            input.Amount,
			"target_amount":     targetAmount,
			"exchange_rate":     exchangeRate.Rate,
			"papss_fee":         papssFee.Fee,
			"platform_fee":      platformFee.Fee,
			"recipient_country": input.RecipientCountry,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "PAPSS transfer completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("PAPSSTransferWorkflow completed successfully")
	return result, nil
}
