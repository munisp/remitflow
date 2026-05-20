package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// UPIPaymentRequest represents the input for UPI payment workflow
type UPIPaymentRequest struct {
	UserID          string  `json:"user_id"`
	RecipientUPIID  string  `json:"recipient_upi_id"` // e.g., user@paytm, 9876543210@ybl
	AmountNGN       float64 `json:"amount_ngn"`
	AmountINR       float64 `json:"amount_inr"` // Optional, if user specifies INR amount
	Currency        string  `json:"currency"`    // "NGN" or "INR"
	PaymentNote     string  `json:"payment_note,omitempty"`
	CollectRequest  bool    `json:"collect_request"` // true for UPI Collect, false for UPI Intent
	QRCodeData      string  `json:"qr_code_data,omitempty"` // For QR code payments
}

// UPIPaymentResponse represents the output of UPI payment workflow
type UPIPaymentResponse struct {
	Success          bool    `json:"success"`
	TransactionID    string  `json:"transaction_id"`
	UPIRRN           string  `json:"upi_rrn"` // UPI Reference Number
	AmountNGN        float64 `json:"amount_ngn"`
	AmountINR        float64 `json:"amount_inr"`
	ExchangeRate     float64 `json:"exchange_rate"`
	TotalFee         float64 `json:"total_fee"`
	RecipientName    string  `json:"recipient_name"`
	RecipientBank    string  `json:"recipient_bank"`
	SettlementStatus string  `json:"settlement_status"`
	SettledAt        string  `json:"settled_at,omitempty"`
	ErrorMessage     string  `json:"error_message,omitempty"`
}

// UPIPaymentWorkflow orchestrates instant payments to India via UPI
func UPIPaymentWorkflow(ctx workflow.Context, req UPIPaymentRequest) (*UPIPaymentResponse, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting UPI payment workflow", "user_id", req.UserID, "amount_ngn", req.AmountNGN)

	// Configure activity options for instant payments
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second, // UPI is instant
		HeartbeatTimeout:    10 * time.Second,
		RetryPolicy: &workflow.RetryPolicy{
			InitialInterval:    500 * time.Millisecond,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var response UPIPaymentResponse
	response.TransactionID = workflow.GetInfo(ctx).WorkflowExecution.ID

	// Step 1: Validate user authentication
	var authResult AuthResult
	err := workflow.ExecuteActivity(ctx, "ValidateKeycloakSession", req.UserID, "upi_payment").Get(ctx, &authResult)
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
			"destination": "india",
			"payment_rail": "upi",
		},
	).Get(ctx, &authzResult)
	if err != nil || !authzResult.Allowed {
		logger.Error("Authorization failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Not authorized for UPI payments"
		return &response, fmt.Errorf("authorization denied")
	}

	// Step 3: Validate UPI ID format and lookup recipient
	var upiValidation UPIValidationResult
	err = workflow.ExecuteActivity(ctx, "ValidateUPIID",
		req.RecipientUPIID,
	).Get(ctx, &upiValidation)
	if err != nil || !upiValidation.Valid {
		logger.Error("UPI ID validation failed", "error", err)
		response.Success = false
		response.ErrorMessage = fmt.Sprintf("Invalid UPI ID: %s", req.RecipientUPIID)
		return &response, err
	}

	response.RecipientName = upiValidation.RecipientName
	response.RecipientBank = upiValidation.BankName

	// Step 4: Get FX quote (NGN to INR)
	var fxQuote FXQuoteResult
	err = workflow.ExecuteActivity(ctx, "GetFXQuote",
		"NGN",
		"INR",
		req.AmountNGN,
		"upi",
	).Get(ctx, &fxQuote)
	if err != nil {
		logger.Error("FX quote failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to get exchange rate"
		return &response, err
	}

	response.ExchangeRate = fxQuote.Rate
	response.AmountINR = fxQuote.TargetAmount
	response.AmountNGN = req.AmountNGN

	// Lock the rate for 60 seconds
	_ = workflow.ExecuteActivity(ctx, "LockFXRate",
		fxQuote.QuoteID,
		60*time.Second,
	).Get(ctx, nil)

	// Step 5: Calculate UPI fees (0.5%, max 200 NGN)
	var feeCalculation FeeCalculationResult
	err = workflow.ExecuteActivity(ctx, "CalculateUPIFee",
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
		"upi_payment",
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

	// Step 7: Initiate UPI payment (Intent or Collect)
	var upiPayment UPIPaymentResult
	if req.CollectRequest {
		// UPI Collect: Send collect request to recipient
		err = workflow.ExecuteActivity(ctx, "InitiateUPICollect",
			req.RecipientUPIID,
			response.AmountINR,
			req.PaymentNote,
			response.TransactionID,
		).Get(ctx, &upiPayment)
	} else {
		// UPI Intent: Direct payment
		err = workflow.ExecuteActivity(ctx, "InitiateUPIIntent",
			req.RecipientUPIID,
			response.AmountINR,
			req.PaymentNote,
			response.TransactionID,
		).Get(ctx, &upiPayment)
	}

	if err != nil {
		logger.Error("UPI payment initiation failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to initiate UPI payment"
		return &response, err
	}

	response.UPIRRN = upiPayment.RRN
	response.SettlementStatus = "settled" // UPI is instant
	response.SettledAt = time.Now().UTC().Format(time.RFC3339)

	// Step 8: Commit reserved funds in TigerBeetle
	var commitResult TigerBeetleCommitResult
	err = workflow.ExecuteActivity(ctx, "CommitReservedFunds",
		reservationResult.ReservationID,
		req.UserID,
		"9004", // Payment gateway settlement account
		totalDebit,
		"2004", // UPI transfer code
	).Get(ctx, &commitResult)
	if err != nil {
		logger.Error("Fund commit failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to commit funds"
		return &response, err
	}

	// Step 9: Record transaction in Kafka
	_ = workflow.ExecuteActivity(ctx, "PublishKafkaEvent",
		"upi-payments",
		map[string]interface{}{
			"event_type":      "upi_payment_completed",
			"transaction_id":  response.TransactionID,
			"upi_rrn":         response.UPIRRN,
			"user_id":         req.UserID,
			"recipient_name":  response.RecipientName,
			"amount_ngn":      response.AmountNGN,
			"amount_inr":      response.AmountINR,
			"settled_at":      response.SettledAt,
			"timestamp":       time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 10: Store in lakehouse
	_ = workflow.ExecuteActivity(ctx, "StoreLakehouseData",
		"upi_transactions",
		map[string]interface{}{
			"transaction_id":  response.TransactionID,
			"user_id":         req.UserID,
			"recipient_name":  response.RecipientName,
			"recipient_bank":  response.RecipientBank,
			"amount_ngn":      response.AmountNGN,
			"amount_inr":      response.AmountINR,
			"exchange_rate":   response.ExchangeRate,
			"fee":             response.TotalFee,
			"upi_rrn":         response.UPIRRN,
			"settled_at":      response.SettledAt,
			"created_at":      time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 11: Send instant confirmation notifications
	_ = workflow.ExecuteActivity(ctx, "SendNotification",
		req.UserID,
		"upi_payment_completed",
		map[string]string{
			"amount_ngn":     fmt.Sprintf("%.2f", response.AmountNGN),
			"amount_inr":     fmt.Sprintf("%.2f", response.AmountINR),
			"recipient_name": response.RecipientName,
			"upi_rrn":        response.UPIRRN,
		},
	).Get(ctx, nil)

	response.Success = true
	logger.Info("UPI payment workflow completed successfully", 
		"transaction_id", response.TransactionID,
		"upi_rrn", response.UPIRRN,
	)

	return &response, nil
}

// UPIValidationResult represents the result of UPI ID validation
type UPIValidationResult struct {
	Valid         bool   `json:"valid"`
	RecipientName string `json:"recipient_name"`
	BankName      string `json:"bank_name"`
	IFSC          string `json:"ifsc"` // Indian Financial System Code
	AccountType   string `json:"account_type"`
}

// UPIPaymentResult represents the result of UPI payment initiation
type UPIPaymentResult struct {
	RRN       string `json:"rrn"` // UPI Reference Number
	Status    string `json:"status"`
	SettledAt string `json:"settled_at"`
}
