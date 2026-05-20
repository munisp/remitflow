package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// PIXPaymentRequest represents the input for PIX payment workflow
type PIXPaymentRequest struct {
	UserID           string  `json:"user_id"`
	RecipientPIXKey  string  `json:"recipient_pix_key"` // CPF, phone, email, random key, or QR code
	PIXKeyType       string  `json:"pix_key_type"`      // "cpf", "phone", "email", "random", "qr"
	AmountNGN        float64 `json:"amount_ngn"`
	AmountBRL        float64 `json:"amount_brl"` // Optional, if user specifies BRL amount
	Currency         string  `json:"currency"`    // "NGN" or "BRL"
	PaymentMessage   string  `json:"payment_message,omitempty"`
	ScheduledTime    string  `json:"scheduled_time,omitempty"` // ISO 8601 format for scheduled payments
}

// PIXPaymentResponse represents the output of PIX payment workflow
type PIXPaymentResponse struct {
	Success          bool    `json:"success"`
	TransactionID    string  `json:"transaction_id"`
	PIXEndToEndID    string  `json:"pix_end_to_end_id"` // PIX E2E ID
	AmountNGN        float64 `json:"amount_ngn"`
	AmountBRL        float64 `json:"amount_brl"`
	ExchangeRate     float64 `json:"exchange_rate"`
	TotalFee         float64 `json:"total_fee"`
	RecipientName    string  `json:"recipient_name"`
	RecipientBank    string  `json:"recipient_bank"`
	SettlementStatus string  `json:"settlement_status"`
	SettledAt        string  `json:"settled_at,omitempty"`
	ErrorMessage     string  `json:"error_message,omitempty"`
}

// PIXPaymentWorkflow orchestrates instant payments to Brazil via PIX
func PIXPaymentWorkflow(ctx workflow.Context, req PIXPaymentRequest) (*PIXPaymentResponse, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PIX payment workflow", "user_id", req.UserID, "amount_ngn", req.AmountNGN)

	// Configure activity options for instant payments (shorter timeouts)
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second, // PIX is instant, should complete quickly
		HeartbeatTimeout:    10 * time.Second,
		RetryPolicy: &workflow.RetryPolicy{
			InitialInterval:    500 * time.Millisecond,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var response PIXPaymentResponse
	response.TransactionID = workflow.GetInfo(ctx).WorkflowExecution.ID

	// Step 1: Validate user authentication
	var authResult AuthResult
	err := workflow.ExecuteActivity(ctx, "ValidateKeycloakSession", req.UserID, "pix_payment").Get(ctx, &authResult)
	if err != nil {
		logger.Error("Authentication failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Authentication failed"
		return &response, err
	}

	// Step 2: Check Permify authorization
	var authzResult AuthzResult
	err = workflow.ExecuteActivity(ctx, "CheckPermifyPermission", 
		req.UserID, 
		"international_transfer", 
		"execute",
		map[string]interface{}{
			"amount": req.AmountNGN,
			"destination": "brazil",
			"payment_rail": "pix",
		},
	).Get(ctx, &authzResult)
	if err != nil || !authzResult.Allowed {
		logger.Error("Authorization failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Not authorized for PIX payments"
		return &response, fmt.Errorf("authorization denied")
	}

	// Step 3: Lookup recipient in PIX DICT (Directory)
	var pixLookup PIXLookupResult
	err = workflow.ExecuteActivity(ctx, "LookupPIXRecipient",
		req.RecipientPIXKey,
		req.PIXKeyType,
	).Get(ctx, &pixLookup)
	if err != nil || !pixLookup.Found {
		logger.Error("PIX recipient lookup failed", "error", err)
		response.Success = false
		response.ErrorMessage = fmt.Sprintf("PIX key not found: %s", req.RecipientPIXKey)
		return &response, err
	}

	response.RecipientName = pixLookup.RecipientName
	response.RecipientBank = pixLookup.BankName

	// Step 4: Get FX quote (NGN to BRL)
	var fxQuote FXQuoteResult
	err = workflow.ExecuteActivity(ctx, "GetFXQuote",
		"NGN",
		"BRL",
		req.AmountNGN,
		"pix",
	).Get(ctx, &fxQuote)
	if err != nil {
		logger.Error("FX quote failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to get exchange rate"
		return &response, err
	}

	response.ExchangeRate = fxQuote.Rate
	response.AmountBRL = fxQuote.TargetAmount
	response.AmountNGN = req.AmountNGN

	// Lock the rate for 60 seconds
	_ = workflow.ExecuteActivity(ctx, "LockFXRate",
		fxQuote.QuoteID,
		60*time.Second,
	).Get(ctx, nil)

	// Step 5: Calculate PIX fees (0.3%, max 150 NGN)
	var feeCalculation FeeCalculationResult
	err = workflow.ExecuteActivity(ctx, "CalculatePIXFee",
		req.AmountNGN,
	).Get(ctx, &feeCalculation)
	if err != nil {
		logger.Error("Fee calculation failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to calculate fees"
		return &response, err
	}

	response.TotalFee = feeCalculation.TotalFee
	totalDebit := req.AmountNGN + feeCalculation.TotalFee

	// Step 6: Reserve funds in TigerBeetle
	var reservationResult TigerBeetleReservationResult
	err = workflow.ExecuteActivity(ctx, "ReserveFunds",
		req.UserID,
		totalDebit,
		response.TransactionID,
		"pix_payment",
	).Get(ctx, &reservationResult)
	if err != nil {
		logger.Error("Fund reservation failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Insufficient funds"
		return &response, err
	}

	// Set up compensation for fund reservation
	defer func() {
		if !response.Success && reservationResult.ReservationID != "" {
			compensationCtx, _ := workflow.NewDisconnectedContext(ctx)
			_ = workflow.ExecuteActivity(compensationCtx, "VoidReservedFunds",
				reservationResult.ReservationID,
			).Get(compensationCtx, nil)
		}
	}()

	// Step 7: Handle scheduled payment if requested
	if req.ScheduledTime != "" {
		scheduledTime, err := time.Parse(time.RFC3339, req.ScheduledTime)
		if err != nil {
			logger.Error("Invalid scheduled time format", "error", err)
			response.Success = false
			response.ErrorMessage = "Invalid scheduled time format"
			return &response, err
		}

		// Wait until scheduled time
		waitDuration := time.Until(scheduledTime)
		if waitDuration > 0 {
			logger.Info("Waiting for scheduled time", "wait_duration", waitDuration)
			_ = workflow.Sleep(ctx, waitDuration)
		}
	}

	// Step 8: Initiate PIX payment
	var pixPayment PIXPaymentResult
	err = workflow.ExecuteActivity(ctx, "InitiatePIXPayment",
		req.RecipientPIXKey,
		req.PIXKeyType,
		response.AmountBRL,
		req.PaymentMessage,
		response.TransactionID,
	).Get(ctx, &pixPayment)
	if err != nil {
		logger.Error("PIX payment initiation failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to initiate PIX payment"
		return &response, err
	}

	response.PIXEndToEndID = pixPayment.EndToEndID
	response.SettlementStatus = "settled" // PIX is instant
	response.SettledAt = time.Now().UTC().Format(time.RFC3339)

	// Step 9: Commit reserved funds in TigerBeetle
	var commitResult TigerBeetleCommitResult
	err = workflow.ExecuteActivity(ctx, "CommitReservedFunds",
		reservationResult.ReservationID,
		req.UserID,
		"9004", // Payment gateway settlement account
		totalDebit,
		"2003", // PIX transfer code
	).Get(ctx, &commitResult)
	if err != nil {
		logger.Error("Fund commit failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to commit funds"
		return &response, err
	}

	// Step 10: Record transaction in Kafka
	_ = workflow.ExecuteActivity(ctx, "PublishKafkaEvent",
		"pix-payments",
		map[string]interface{}{
			"event_type":      "pix_payment_completed",
			"transaction_id":  response.TransactionID,
			"pix_e2e_id":      response.PIXEndToEndID,
			"user_id":         req.UserID,
			"recipient_name":  response.RecipientName,
			"amount_ngn":      response.AmountNGN,
			"amount_brl":      response.AmountBRL,
			"settled_at":      response.SettledAt,
			"timestamp":       time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 11: Store in lakehouse
	_ = workflow.ExecuteActivity(ctx, "StoreLakehouseData",
		"pix_transactions",
		map[string]interface{}{
			"transaction_id":  response.TransactionID,
			"user_id":         req.UserID,
			"recipient_name":  response.RecipientName,
			"recipient_bank":  response.RecipientBank,
			"amount_ngn":      response.AmountNGN,
			"amount_brl":      response.AmountBRL,
			"exchange_rate":   response.ExchangeRate,
			"fee":             response.TotalFee,
			"pix_e2e_id":      response.PIXEndToEndID,
			"settled_at":      response.SettledAt,
			"created_at":      time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 12: Send instant confirmation notifications
	_ = workflow.ExecuteActivity(ctx, "SendNotification",
		req.UserID,
		"pix_payment_completed",
		map[string]string{
			"amount_ngn":     fmt.Sprintf("%.2f", response.AmountNGN),
			"amount_brl":     fmt.Sprintf("%.2f", response.AmountBRL),
			"recipient_name": response.RecipientName,
			"pix_e2e_id":     response.PIXEndToEndID,
		},
	).Get(ctx, nil)

	response.Success = true
	logger.Info("PIX payment workflow completed successfully", 
		"transaction_id", response.TransactionID,
		"pix_e2e_id", response.PIXEndToEndID,
	)

	return &response, nil
}

// PIXLookupResult represents the result of PIX DICT lookup
type PIXLookupResult struct {
	Found         bool   `json:"found"`
	RecipientName string `json:"recipient_name"`
	BankName      string `json:"bank_name"`
	BankISPB      string `json:"bank_ispb"` // Brazilian bank identifier
	AccountType   string `json:"account_type"`
}

// PIXPaymentResult represents the result of PIX payment initiation
type PIXPaymentResult struct {
	EndToEndID string `json:"end_to_end_id"` // PIX E2E ID
	Status     string `json:"status"`
	SettledAt  string `json:"settled_at"`
}
