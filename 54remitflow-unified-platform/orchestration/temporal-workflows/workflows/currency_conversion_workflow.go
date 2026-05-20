package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// CurrencyConversionInput represents input for multi-currency wallet conversion
type CurrencyConversionInput struct {
	UserID          models.UserID   `json:"user_id"`
	SourceWalletID  string          `json:"source_wallet_id"`
	TargetWalletID  string          `json:"target_wallet_id,omitempty"` // Auto-create if not provided
	SourceCurrency  string          `json:"source_currency"`
	TargetCurrency  string          `json:"target_currency"`
	SourceAmount    decimal.Decimal `json:"source_amount,omitempty"`    // Amount to convert
	TargetAmount    decimal.Decimal `json:"target_amount,omitempty"`    // Amount to receive
	LockRate        bool            `json:"lock_rate"`                  // Lock exchange rate for 30 min
	AutoConvert     bool            `json:"auto_convert"`               // Auto-convert when rate is favorable
	TargetRate      decimal.Decimal `json:"target_rate,omitempty"`      // For auto-convert
}

// CurrencyConversionResult represents the workflow result
type CurrencyConversionResult struct {
	Success        bool            `json:"success"`
	TransactionID  string          `json:"transaction_id"`
	SourceAmount   decimal.Decimal `json:"source_amount"`
	TargetAmount   decimal.Decimal `json:"target_amount"`
	ExchangeRate   decimal.Decimal `json:"exchange_rate"`
	ConversionFee  decimal.Decimal `json:"conversion_fee"`
	SourceWalletID string          `json:"source_wallet_id"`
	TargetWalletID string          `json:"target_wallet_id"`
	RateLocked     bool            `json:"rate_locked"`
	LockedUntil    *time.Time      `json:"locked_until,omitempty"`
	Status         string          `json:"status"` // success, pending, failed
	Message        string          `json:"message"`
	CompletedAt    time.Time       `json:"completed_at"`
}

// CurrencyConversionWorkflow implements Journey 13: Multi-Currency Wallet Conversion
//
// Steps:
// 1. Get real-time exchange rate
// 2. Check if auto-convert (wait for favorable rate)
// 3. Lock rate if requested
// 4. Calculate conversion fee
// 5. Validate source wallet balance
// 6. Create/verify target wallet
// 7. Reserve funds in source wallet
// 8. Execute conversion (TigerBeetle atomic transfer)
// 9. Update wallet balances
// 10. Send notification
// 11. Log to analytics
func CurrencyConversionWorkflow(ctx workflow.Context, input CurrencyConversionInput) (*CurrencyConversionResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CurrencyConversionWorkflow started",
		"user_id", input.UserID,
		"from", input.SourceCurrency,
		"to", input.TargetCurrency)

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

	result := &CurrencyConversionResult{
		Success:        false,
		SourceWalletID: input.SourceWalletID,
		TargetWalletID: input.TargetWalletID,
	}

	// Step 1: Get real-time exchange rate
	logger.Info("Step 1: Getting exchange rate")
	var exchangeRate activities.ExchangeRateResult
	err := workflow.ExecuteActivity(ctx, activities.GetExchangeRate, map[string]interface{}{
		"source_currency": input.SourceCurrency,
		"target_currency": input.TargetCurrency,
	}).Get(ctx, &exchangeRate)

	if err != nil {
		return nil, err
	}

	result.ExchangeRate = exchangeRate.Rate
	logger.Info("Exchange rate fetched", "rate", exchangeRate.Rate)

	// Step 2: Check if auto-convert (wait for favorable rate)
	if input.AutoConvert && !input.TargetRate.IsZero() {
		logger.Info("Auto-convert enabled, checking target rate", "target", input.TargetRate, "current", exchangeRate.Rate)
		
		if exchangeRate.Rate.LessThan(input.TargetRate) {
			logger.Info("Current rate not favorable, waiting...")
			
			// Set up rate monitoring (check every 5 minutes for up to 24 hours)
			maxWaitTime := 24 * time.Hour
			checkInterval := 5 * time.Minute
			startTime := time.Now()
			
			for {
				// Wait for next check
				err := workflow.Sleep(ctx, checkInterval)
				if err != nil {
					return nil, err
				}
				
				// Check if max wait time exceeded
				if time.Since(startTime) > maxWaitTime {
					result.Message = "Auto-convert timeout: target rate not reached within 24 hours"
					result.Status = "failed"
					return result, nil
				}
				
				// Get updated rate
				err = workflow.ExecuteActivity(ctx, activities.GetExchangeRate, map[string]interface{}{
					"source_currency": input.SourceCurrency,
					"target_currency": input.TargetCurrency,
				}).Get(ctx, &exchangeRate)
				
				if err != nil {
					continue // Retry on next interval
				}
				
				// Check if target rate reached
				if exchangeRate.Rate.GreaterThanOrEqual(input.TargetRate) {
					logger.Info("Target rate reached", "rate", exchangeRate.Rate)
					result.ExchangeRate = exchangeRate.Rate
					break
				}
			}
		}
	}

	// Step 3: Lock rate if requested
	if input.LockRate {
		logger.Info("Step 3: Locking exchange rate")
		var rateLock activities.RateLockResult
		err = workflow.ExecuteActivity(ctx, activities.LockExchangeRate, map[string]interface{}{
			"source_currency": input.SourceCurrency,
			"target_currency": input.TargetCurrency,
			"rate":            exchangeRate.Rate,
			"duration_minutes": 30,
		}).Get(ctx, &rateLock)

		if err == nil && rateLock.Success {
			result.RateLocked = true
			result.LockedUntil = &rateLock.ExpiresAt
			logger.Info("Rate locked", "expires_at", rateLock.ExpiresAt)
		}
	}

	// Calculate amounts
	var sourceAmount, targetAmount decimal.Decimal
	if !input.SourceAmount.IsZero() {
		sourceAmount = input.SourceAmount
		targetAmount = sourceAmount.Mul(exchangeRate.Rate)
	} else {
		targetAmount = input.TargetAmount
		sourceAmount = targetAmount.Div(exchangeRate.Rate)
	}

	result.SourceAmount = sourceAmount
	result.TargetAmount = targetAmount

	// Step 4: Calculate conversion fee
	logger.Info("Step 4: Calculating conversion fee")
	var fee activities.FeeResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateConversionFee, map[string]interface{}{
		"source_amount":   sourceAmount,
		"source_currency": input.SourceCurrency,
		"target_currency": input.TargetCurrency,
	}).Get(ctx, &fee)

	if err != nil {
		return nil, err
	}

	result.ConversionFee = fee.Fee
	totalDebit := sourceAmount.Add(fee.Fee)
	logger.Info("Conversion fee calculated", "fee", fee.Fee)

	// Step 5: Validate source wallet balance
	logger.Info("Step 5: Checking source wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.SourceWalletID,
		"currency":  input.SourceCurrency,
		"amount":    totalDebit,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance in source wallet"
		result.Status = "failed"
		return result, nil
	}

	// Step 6: Create/verify target wallet
	logger.Info("Step 6: Verifying target wallet")
	if input.TargetWalletID == "" {
		// Auto-create target currency wallet
		var walletCreation activities.WalletCreationResult
		err = workflow.ExecuteActivity(ctx, activities.CreateCurrencyWallet, map[string]interface{}{
			"user_id":  input.UserID,
			"currency": input.TargetCurrency,
		}).Get(ctx, &walletCreation)

		if err != nil {
			return nil, err
		}

		result.TargetWalletID = walletCreation.WalletID
		logger.Info("Target wallet created", "wallet_id", walletCreation.WalletID)
	} else {
		result.TargetWalletID = input.TargetWalletID
	}

	// Step 7: Reserve funds in source wallet
	logger.Info("Step 7: Reserving funds")
	var reservation activities.FundReservationResult
	err = workflow.ExecuteActivity(ctx, activities.ReserveFunds, map[string]interface{}{
		"wallet_id": input.SourceWalletID,
		"amount":    totalDebit,
		"currency":  input.SourceCurrency,
		"reference": "currency_conversion_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 8: Execute conversion (TigerBeetle atomic transfer)
	logger.Info("Step 8: Executing currency conversion")
	var conversion activities.ConversionResult
	err = workflow.ExecuteActivity(ctx, activities.ExecuteCurrencyConversion, map[string]interface{}{
		"reservation_id":   reservationID,
		"source_wallet_id": input.SourceWalletID,
		"target_wallet_id": result.TargetWalletID,
		"source_amount":    sourceAmount,
		"target_amount":    targetAmount,
		"source_currency":  input.SourceCurrency,
		"target_currency":  input.TargetCurrency,
		"exchange_rate":    exchangeRate.Rate,
		"conversion_fee":   fee.Fee,
	}).Get(ctx, &conversion)

	if err != nil {
		logger.Error("Conversion failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Currency conversion failed"
		result.Status = "failed"
		return result, nil
	}

	result.TransactionID = conversion.TransactionID
	logger.Info("Conversion completed", "transaction_id", conversion.TransactionID)

	// Step 9: Update wallet balances (already done atomically by TigerBeetle)
	logger.Info("Step 9: Wallet balances updated")

	// Step 10: Send notification
	logger.Info("Step 10: Sending notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "currency_conversion_success",
		"channel": "push,email",
		"data": map[string]interface{}{
			"source_amount":   sourceAmount,
			"source_currency": input.SourceCurrency,
			"target_amount":   targetAmount,
			"target_currency": input.TargetCurrency,
			"exchange_rate":   exchangeRate.Rate,
			"conversion_fee":  fee.Fee,
			"transaction_id":  conversion.TransactionID,
		},
	}).Get(ctx, nil)

	// Step 11: Log to analytics
	logger.Info("Step 11: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "currency_conversion",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"source_currency": input.SourceCurrency,
			"target_currency": input.TargetCurrency,
			"source_amount":   sourceAmount,
			"target_amount":   targetAmount,
			"exchange_rate":   exchangeRate.Rate,
			"conversion_fee":  fee.Fee,
			"auto_convert":    input.AutoConvert,
			"rate_locked":     result.RateLocked,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "Currency conversion completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("CurrencyConversionWorkflow completed successfully")
	return result, nil
}
