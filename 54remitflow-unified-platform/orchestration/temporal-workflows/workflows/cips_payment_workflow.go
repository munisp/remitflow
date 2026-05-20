package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// CIPSPaymentRequest represents the input for CIPS payment workflow
type CIPSPaymentRequest struct {
	UserID              string  `json:"user_id"`
	BusinessAccountID   string  `json:"business_account_id"`
	SupplierName        string  `json:"supplier_name"`
	SupplierBankAccount string  `json:"supplier_bank_account"`
	SupplierCNAPSCode   string  `json:"supplier_cnaps_code"`
	SupplierBankName    string  `json:"supplier_bank_name"`
	AmountNGN           float64 `json:"amount_ngn"`
	AmountRMB           float64 `json:"amount_rmb"` // Optional, if user specifies RMB amount
	Currency            string  `json:"currency"`    // "NGN" or "RMB"
	PaymentPurpose      string  `json:"payment_purpose"`
	InvoiceReference    string  `json:"invoice_reference"`
	TradeDocuments      []string `json:"trade_documents"` // URLs to uploaded documents
	RequestedSettlement string  `json:"requested_settlement"` // "same_day" or "next_day"
}

// CIPSPaymentResponse represents the output of CIPS payment workflow
type CIPSPaymentResponse struct {
	Success             bool    `json:"success"`
	TransactionID       string  `json:"transaction_id"`
	CIPSReference       string  `json:"cips_reference"`
	AmountNGN           float64 `json:"amount_ngn"`
	AmountRMB           float64 `json:"amount_rmb"`
	ExchangeRate        float64 `json:"exchange_rate"`
	TotalFee            float64 `json:"total_fee"`
	SettlementDate      string  `json:"settlement_date"`
	SettlementStatus    string  `json:"settlement_status"`
	ComplianceStatus    string  `json:"compliance_status"`
	ErrorMessage        string  `json:"error_message,omitempty"`
}

// CIPSPaymentWorkflow orchestrates cross-border RMB payments through CIPS
func CIPSPaymentWorkflow(ctx workflow.Context, req CIPSPaymentRequest) (*CIPSPaymentResponse, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting CIPS payment workflow", "user_id", req.UserID, "amount_ngn", req.AmountNGN)

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &workflow.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var response CIPSPaymentResponse
	response.TransactionID = workflow.GetInfo(ctx).WorkflowExecution.ID

	// Step 1: Validate user authentication and authorization
	var authResult AuthResult
	err := workflow.ExecuteActivity(ctx, "ValidateKeycloakSession", req.UserID, "cips_payment").Get(ctx, &authResult)
	if err != nil {
		logger.Error("Authentication failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Authentication failed"
		return &response, err
	}

	// Step 2: Check Permify authorization for business payments
	var authzResult AuthzResult
	err = workflow.ExecuteActivity(ctx, "CheckPermifyPermission", 
		req.UserID, 
		"business_payment", 
		"execute",
		map[string]interface{}{
			"amount": req.AmountNGN,
			"destination": "china",
			"payment_rail": "cips",
		},
	).Get(ctx, &authzResult)
	if err != nil || !authzResult.Allowed {
		logger.Error("Authorization failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Not authorized for CIPS payments"
		return &response, fmt.Errorf("authorization denied")
	}

	// Step 3: Validate supplier information and CNAPS code
	var supplierValidation SupplierValidationResult
	err = workflow.ExecuteActivity(ctx, "ValidateCIPSSupplier", 
		req.SupplierBankAccount,
		req.SupplierCNAPSCode,
		req.SupplierName,
	).Get(ctx, &supplierValidation)
	if err != nil || !supplierValidation.Valid {
		logger.Error("Supplier validation failed", "error", err)
		response.Success = false
		response.ErrorMessage = fmt.Sprintf("Invalid supplier information: %s", supplierValidation.ErrorMessage)
		return &response, err
	}

	// Step 4: Perform AML/sanctions screening
	var complianceResult ComplianceResult
	err = workflow.ExecuteActivity(ctx, "PerformAMLScreening",
		req.SupplierName,
		req.SupplierBankAccount,
		req.AmountNGN,
		"CIPS",
		req.PaymentPurpose,
	).Get(ctx, &complianceResult)
	if err != nil {
		logger.Error("AML screening failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Compliance check failed"
		return &response, err
	}

	response.ComplianceStatus = complianceResult.Status

	if complianceResult.Status == "blocked" {
		logger.Warn("Payment blocked by compliance", "reason", complianceResult.Reason)
		response.Success = false
		response.ErrorMessage = "Payment blocked by compliance screening"
		
		// Log compliance event
		_ = workflow.ExecuteActivity(ctx, "LogComplianceEvent",
			req.UserID,
			"cips_payment_blocked",
			complianceResult.Reason,
		).Get(ctx, nil)
		
		return &response, fmt.Errorf("compliance block: %s", complianceResult.Reason)
	}

	// Step 5: Validate trade documentation (if amount > 1M NGN)
	if req.AmountNGN > 1000000 {
		var docValidation DocumentValidationResult
		err = workflow.ExecuteActivity(ctx, "ValidateTradeDocuments",
			req.TradeDocuments,
			req.InvoiceReference,
			req.AmountNGN,
		).Get(ctx, &docValidation)
		if err != nil || !docValidation.Valid {
			logger.Error("Trade documentation validation failed", "error", err)
			response.Success = false
			response.ErrorMessage = "Insufficient or invalid trade documentation"
			return &response, err
		}
	}

	// Step 6: Get FX quote (NGN to RMB)
	var fxQuote FXQuoteResult
	err = workflow.ExecuteActivity(ctx, "GetFXQuote",
		"NGN",
		"RMB",
		req.AmountNGN,
		"cips",
	).Get(ctx, &fxQuote)
	if err != nil {
		logger.Error("FX quote failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to get exchange rate"
		return &response, err
	}

	response.ExchangeRate = fxQuote.Rate
	response.AmountRMB = fxQuote.TargetAmount
	response.AmountNGN = req.AmountNGN

	// Step 7: Calculate CIPS fees (1%, min 500 NGN, max 5000 NGN)
	var feeCalculation FeeCalculationResult
	err = workflow.ExecuteActivity(ctx, "CalculateCIPSFee",
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

	// Step 8: Reserve funds in TigerBeetle
	var reservationResult TigerBeetleReservationResult
	err = workflow.ExecuteActivity(ctx, "ReserveFunds",
		req.BusinessAccountID,
		totalDebit,
		response.TransactionID,
		"cips_payment",
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
			// Void the reservation if payment fails
			compensationCtx, _ := workflow.NewDisconnectedContext(ctx)
			_ = workflow.ExecuteActivity(compensationCtx, "VoidReservedFunds",
				reservationResult.ReservationID,
			).Get(compensationCtx, nil)
		}
	}()

	// Step 9: Submit payment to CIPS network
	var cipsSubmission CIPSSubmissionResult
	err = workflow.ExecuteActivity(ctx, "SubmitCIPSPayment",
		req.SupplierBankAccount,
		req.SupplierCNAPSCode,
		req.SupplierName,
		response.AmountRMB,
		req.PaymentPurpose,
		req.InvoiceReference,
		req.RequestedSettlement,
	).Get(ctx, &cipsSubmission)
	if err != nil {
		logger.Error("CIPS submission failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to submit payment to CIPS"
		return &response, err
	}

	response.CIPSReference = cipsSubmission.CIPSReference
	response.SettlementDate = cipsSubmission.SettlementDate
	response.SettlementStatus = "pending"

	// Step 10: Commit reserved funds in TigerBeetle
	var commitResult TigerBeetleCommitResult
	err = workflow.ExecuteActivity(ctx, "CommitReservedFunds",
		reservationResult.ReservationID,
		req.BusinessAccountID,
		"9004", // Payment gateway settlement account
		totalDebit,
		"2001", // CIPS transfer code
	).Get(ctx, &commitResult)
	if err != nil {
		logger.Error("Fund commit failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to commit funds"
		return &response, err
	}

	// Step 11: Record transaction in Kafka for event streaming
	_ = workflow.ExecuteActivity(ctx, "PublishKafkaEvent",
		"cips-payments",
		map[string]interface{}{
			"event_type":      "cips_payment_submitted",
			"transaction_id":  response.TransactionID,
			"cips_reference":  response.CIPSReference,
			"user_id":         req.UserID,
			"amount_ngn":      response.AmountNGN,
			"amount_rmb":      response.AmountRMB,
			"settlement_date": response.SettlementDate,
			"timestamp":       time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 12: Store transaction in lakehouse for analytics
	_ = workflow.ExecuteActivity(ctx, "StoreLakehouseData",
		"cips_transactions",
		map[string]interface{}{
			"transaction_id":   response.TransactionID,
			"user_id":          req.UserID,
			"supplier_name":    req.SupplierName,
			"amount_ngn":       response.AmountNGN,
			"amount_rmb":       response.AmountRMB,
			"exchange_rate":    response.ExchangeRate,
			"fee":              response.TotalFee,
			"cips_reference":   response.CIPSReference,
			"settlement_date":  response.SettlementDate,
			"compliance_status": response.ComplianceStatus,
			"created_at":       time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 13: Send confirmation notifications
	_ = workflow.ExecuteActivity(ctx, "SendNotification",
		req.UserID,
		"cips_payment_submitted",
		map[string]string{
			"amount_ngn":      fmt.Sprintf("%.2f", response.AmountNGN),
			"amount_rmb":      fmt.Sprintf("%.2f", response.AmountRMB),
			"cips_reference":  response.CIPSReference,
			"settlement_date": response.SettlementDate,
		},
	).Get(ctx, nil)

	// Step 14: Wait for settlement confirmation (if same-day requested)
	if req.RequestedSettlement == "same_day" {
		// Poll for settlement status for up to 4 hours
		settlementCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 4 * time.Hour,
			HeartbeatTimeout:    5 * time.Minute,
		})

		var settlementStatus CIPSSettlementStatus
		err = workflow.ExecuteActivity(settlementCtx, "PollCIPSSettlementStatus",
			response.CIPSReference,
			4*time.Hour, // Max polling duration
		).Get(settlementCtx, &settlementStatus)
		
		if err == nil && settlementStatus.Status == "settled" {
			response.SettlementStatus = "settled"
			
			// Send settlement confirmation
			_ = workflow.ExecuteActivity(ctx, "SendNotification",
				req.UserID,
				"cips_payment_settled",
				map[string]string{
					"cips_reference": response.CIPSReference,
					"settled_at":     settlementStatus.SettledAt,
				},
			).Get(ctx, nil)
		}
	}

	response.Success = true
	logger.Info("CIPS payment workflow completed successfully", 
		"transaction_id", response.TransactionID,
		"cips_reference", response.CIPSReference,
	)

	return &response, nil
}

// Supporting types
type SupplierValidationResult struct {
	Valid        bool   `json:"valid"`
	SupplierName string `json:"supplier_name"`
	BankName     string `json:"bank_name"`
	ErrorMessage string `json:"error_message,omitempty"`
}

type DocumentValidationResult struct {
	Valid        bool     `json:"valid"`
	Documents    []string `json:"documents"`
	ErrorMessage string   `json:"error_message,omitempty"`
}

type CIPSSubmissionResult struct {
	CIPSReference  string `json:"cips_reference"`
	SettlementDate string `json:"settlement_date"`
	Status         string `json:"status"`
}

type CIPSSettlementStatus struct {
	Status    string `json:"status"`
	SettledAt string `json:"settled_at"`
}
