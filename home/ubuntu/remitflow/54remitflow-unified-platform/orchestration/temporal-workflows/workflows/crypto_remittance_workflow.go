package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// CryptoRemittanceInput represents input for cryptocurrency remittance
type CryptoRemittanceInput struct {
	UserID            models.UserID   `json:"user_id"`
	Cryptocurrency    string          `json:"cryptocurrency"` // USDT, USDC, BTC, ETH
	Network           string          `json:"network"`        // Polygon, Stellar, Solana, Lightning
	SourceCurrency    string          `json:"source_currency"`
	SourceAmount      decimal.Decimal `json:"source_amount,omitempty"`
	CryptoAmount      decimal.Decimal `json:"crypto_amount,omitempty"`
	WalletID          string          `json:"wallet_id"`
	RecipientAddress  string          `json:"recipient_address"` // Crypto wallet address
	RecipientEmail    string          `json:"recipient_email,omitempty"`
	RecipientPhone    string          `json:"recipient_phone,omitempty"`
	TransferPurpose   string          `json:"transfer_purpose"`
	SaveBeneficiary   bool            `json:"save_beneficiary"`
	Priority          string          `json:"priority"` // standard, fast, instant
}

// CryptoRemittanceResult represents the workflow result
type CryptoRemittanceResult struct {
	Success          bool            `json:"success"`
	TransactionID    string          `json:"transaction_id"`
	CryptoTxHash     string          `json:"crypto_tx_hash"`
	Cryptocurrency   string          `json:"cryptocurrency"`
	Network          string          `json:"network"`
	SourceAmount     decimal.Decimal `json:"source_amount"`
	CryptoAmount     decimal.Decimal `json:"crypto_amount"`
	ExchangeRate     decimal.Decimal `json:"exchange_rate"`
	NetworkFee       decimal.Decimal `json:"network_fee"`
	PlatformFee      decimal.Decimal `json:"platform_fee"`
	TotalCost        decimal.Decimal `json:"total_cost"`
	RecipientAddress string          `json:"recipient_address"`
	Confirmations    int             `json:"confirmations"`
	Status           string          `json:"status"` // success, pending, failed
	Message          string          `json:"message"`
	CompletedAt      time.Time       `json:"completed_at"`
}

// CryptoRemittanceWorkflow implements Journey 15: Cryptocurrency Remittance (Stablecoin)
//
// Supports:
// - Stablecoins: USDT, USDC (low volatility)
// - Networks: Polygon (low fees), Stellar (fast), Solana (instant), Lightning (BTC)
// - Instant settlement with minimal fees
//
// Steps:
// 1. Validate cryptocurrency and network
// 2. Validate recipient wallet address
// 3. Get crypto exchange rate
// 4. Calculate network and platform fees
// 5. Check wallet balance
// 6. Reserve funds (TigerBeetle)
// 7. Execute crypto transfer via blockchain
// 8. Monitor transaction confirmations
// 9. Commit transaction
// 10. Save beneficiary (if requested)
// 11. Send notifications
// 12. Log to analytics
func CryptoRemittanceWorkflow(ctx workflow.Context, input CryptoRemittanceInput) (*CryptoRemittanceResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CryptoRemittanceWorkflow started",
		"user_id", input.UserID,
		"crypto", input.Cryptocurrency,
		"network", input.Network)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute, // Longer for blockchain confirmations
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &CryptoRemittanceResult{
		Success:          false,
		Cryptocurrency:   input.Cryptocurrency,
		Network:          input.Network,
		RecipientAddress: input.RecipientAddress,
	}

	// Step 1: Validate cryptocurrency and network
	logger.Info("Step 1: Validating cryptocurrency and network")
	var cryptoValidation activities.CryptoValidationResult
	err := workflow.ExecuteActivity(ctx, activities.ValidateCryptoNetwork, map[string]interface{}{
		"cryptocurrency": input.Cryptocurrency,
		"network":        input.Network,
	}).Get(ctx, &cryptoValidation)

	if err != nil || !cryptoValidation.Valid {
		result.Message = "Invalid cryptocurrency or network combination"
		result.Status = "failed"
		return result, nil
	}

	logger.Info("Crypto network validated", "supported", cryptoValidation.Supported)

	// Step 2: Validate recipient wallet address
	logger.Info("Step 2: Validating recipient address")
	var addressValidation activities.AddressValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidateCryptoAddress, map[string]interface{}{
		"address":        input.RecipientAddress,
		"cryptocurrency": input.Cryptocurrency,
		"network":        input.Network,
	}).Get(ctx, &addressValidation)

	if err != nil || !addressValidation.Valid {
		result.Message = "Invalid recipient wallet address: " + addressValidation.Reason
		result.Status = "failed"
		return result, nil
	}

	logger.Info("Recipient address validated")

	// Step 3: Get crypto exchange rate
	logger.Info("Step 3: Getting crypto exchange rate")
	var exchangeRate activities.CryptoExchangeRateResult
	err = workflow.ExecuteActivity(ctx, activities.GetCryptoExchangeRate, map[string]interface{}{
		"source_currency": input.SourceCurrency,
		"cryptocurrency":  input.Cryptocurrency,
	}).Get(ctx, &exchangeRate)

	if err != nil {
		return nil, err
	}

	result.ExchangeRate = exchangeRate.Rate

	// Calculate amounts
	var sourceAmount, cryptoAmount decimal.Decimal
	if !input.SourceAmount.IsZero() {
		sourceAmount = input.SourceAmount
		cryptoAmount = sourceAmount.Div(exchangeRate.Rate)
	} else {
		cryptoAmount = input.CryptoAmount
		sourceAmount = cryptoAmount.Mul(exchangeRate.Rate)
	}

	result.SourceAmount = sourceAmount
	result.CryptoAmount = cryptoAmount

	logger.Info("Exchange rate fetched",
		"rate", exchangeRate.Rate,
		"crypto_amount", cryptoAmount)

	// Step 4: Calculate fees
	logger.Info("Step 4: Calculating fees")
	
	// Network fee (blockchain gas fee)
	var networkFee activities.NetworkFeeResult
	err = workflow.ExecuteActivity(ctx, activities.GetCryptoNetworkFee, map[string]interface{}{
		"cryptocurrency": input.Cryptocurrency,
		"network":        input.Network,
		"priority":       input.Priority,
	}).Get(ctx, &networkFee)

	if err != nil {
		return nil, err
	}

	result.NetworkFee = networkFee.Fee

	// Platform fee
	var platformFee activities.FeeResult
	err = workflow.ExecuteActivity(ctx, activities.CalculatePlatformFee, map[string]interface{}{
		"amount":       sourceAmount,
		"currency":     input.SourceCurrency,
		"service_type": "crypto_remittance",
	}).Get(ctx, &platformFee)

	if err != nil {
		return nil, err
	}

	result.PlatformFee = platformFee.Fee
	result.TotalCost = sourceAmount.Add(networkFee.Fee).Add(platformFee.Fee)

	logger.Info("Fees calculated",
		"network_fee", networkFee.Fee,
		"platform_fee", platformFee.Fee,
		"total_cost", result.TotalCost)

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
		"reference": "crypto_remittance_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 7: Execute crypto transfer via blockchain
	logger.Info("Step 7: Executing blockchain transfer")
	var cryptoTransfer activities.CryptoTransferResult
	err = workflow.ExecuteActivity(ctx, activities.ExecuteCryptoTransfer, map[string]interface{}{
		"cryptocurrency":    input.Cryptocurrency,
		"network":           input.Network,
		"recipient_address": input.RecipientAddress,
		"amount":            cryptoAmount,
		"priority":          input.Priority,
		"memo":              "Platform Remittance - " + input.UserID.String(),
	}).Get(ctx, &cryptoTransfer)

	if err != nil || !cryptoTransfer.Success {
		logger.Error("Crypto transfer failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Blockchain transfer failed: " + cryptoTransfer.ErrorMessage
		result.Status = "failed"
		return result, nil
	}

	result.CryptoTxHash = cryptoTransfer.TxHash
	logger.Info("Blockchain transfer initiated", "tx_hash", cryptoTransfer.TxHash)

	// Step 8: Monitor transaction confirmations
	logger.Info("Step 8: Monitoring blockchain confirmations")
	
	requiredConfirmations := 1 // Most networks need 1 confirmation for finality
	if input.Network == "bitcoin" || input.Network == "ethereum" {
		requiredConfirmations = 3 // Higher security for slower networks
	}
	
	maxAttempts := 30
	checkInterval := 30 * time.Second
	
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		var confirmStatus activities.CryptoConfirmationResult
		err = workflow.ExecuteActivity(ctx, activities.GetCryptoTransactionStatus, map[string]interface{}{
			"tx_hash":     cryptoTransfer.TxHash,
			"network":     input.Network,
		}).Get(ctx, &confirmStatus)

		if err != nil {
			logger.Warn("Confirmation check failed", "attempt", attempt, "error", err)
			workflow.Sleep(ctx, checkInterval)
			continue
		}

		result.Confirmations = confirmStatus.Confirmations
		logger.Info("Transaction confirmations", "confirmations", confirmStatus.Confirmations, "required", requiredConfirmations)

		if confirmStatus.Confirmations >= requiredConfirmations {
			logger.Info("Transaction confirmed")
			break
		}

		if confirmStatus.Status == "failed" {
			logger.Error("Transaction failed on blockchain", "reason", confirmStatus.FailureReason)
			
			// Compensate: Unreserve funds
			_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
				"reservation_id": reservationID,
			}).Get(ctx, nil)

			result.Message = "Blockchain transaction failed: " + confirmStatus.FailureReason
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
		"reservation_id": reservationID,
		"wallet_id":      input.WalletID,
		"amount":         result.TotalCost,
		"currency":       input.SourceCurrency,
		"type":           "crypto_remittance",
		"crypto_tx_hash": cryptoTransfer.TxHash,
		"metadata": map[string]interface{}{
			"cryptocurrency":    input.Cryptocurrency,
			"network":           input.Network,
			"crypto_amount":     cryptoAmount,
			"recipient_address": input.RecipientAddress,
			"exchange_rate":     exchangeRate.Rate,
			"confirmations":     result.Confirmations,
		},
	}).Get(ctx, &transaction)

	if err != nil {
		logger.Error("Transaction commit failed", "error", err)
		// Note: Crypto transfer already on blockchain, log for reconciliation
		_ = workflow.ExecuteActivity(ctx, activities.LogReconciliationIssue, map[string]interface{}{
			"crypto_tx_hash": cryptoTransfer.TxHash,
			"reservation_id": reservationID,
			"error":          err.Error(),
		}).Get(ctx, nil)
		
		return nil, err
	}

	result.TransactionID = transaction.TransactionID
	logger.Info("Transaction committed", "transaction_id", transaction.TransactionID)

	// Step 10: Save beneficiary (if requested)
	if input.SaveBeneficiary {
		logger.Info("Step 10: Saving beneficiary")
		_ = workflow.ExecuteActivity(ctx, activities.SaveCryptoBeneficiary, map[string]interface{}{
			"user_id":           input.UserID,
			"recipient_address": input.RecipientAddress,
			"recipient_email":   input.RecipientEmail,
			"recipient_phone":   input.RecipientPhone,
			"cryptocurrency":    input.Cryptocurrency,
			"network":           input.Network,
		}).Get(ctx, nil)
	}

	// Step 11: Send notifications
	logger.Info("Step 11: Sending notifications")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "crypto_remittance_success",
		"channel": "email,push",
		"data": map[string]interface{}{
			"cryptocurrency":    input.Cryptocurrency,
			"network":           input.Network,
			"crypto_amount":     cryptoAmount,
			"source_amount":     sourceAmount,
			"source_currency":   input.SourceCurrency,
			"recipient_address": input.RecipientAddress,
			"tx_hash":           cryptoTransfer.TxHash,
			"confirmations":     result.Confirmations,
			"network_fee":       networkFee.Fee,
			"platform_fee":      platformFee.Fee,
			"transaction_id":    transaction.TransactionID,
		},
	}).Get(ctx, nil)

	// Step 12: Log to analytics
	logger.Info("Step 12: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "crypto_remittance",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"cryptocurrency":  input.Cryptocurrency,
			"network":         input.Network,
			"source_currency": input.SourceCurrency,
			"source_amount":   sourceAmount,
			"crypto_amount":   cryptoAmount,
			"exchange_rate":   exchangeRate.Rate,
			"network_fee":     networkFee.Fee,
			"platform_fee":    platformFee.Fee,
			"priority":        input.Priority,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "Cryptocurrency remittance completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("CryptoRemittanceWorkflow completed successfully")
	return result, nil
}
