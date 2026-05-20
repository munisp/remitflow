package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// MojaloopPaymentRequest represents the input for Mojaloop payment workflow
type MojaloopPaymentRequest struct {
	UserID              string  `json:"user_id"`
	RecipientMSISDN     string  `json:"recipient_msisdn"` // Mobile number in international format
	RecipientCountry    string  `json:"recipient_country"` // ISO 3166-1 alpha-2 code
	AmountNGN           float64 `json:"amount_ngn"`
	AmountLocal         float64 `json:"amount_local"` // Optional, in recipient's local currency
	RecipientCurrency   string  `json:"recipient_currency"` // e.g., "KES", "GHS", "UGX"
	PaymentNote         string  `json:"payment_note,omitempty"`
	PaymentType         string  `json:"payment_type"` // "P2P", "MERCHANT", "BILL"
}

// MojaloopPaymentResponse represents the output of Mojaloop payment workflow
type MojaloopPaymentResponse struct {
	Success             bool    `json:"success"`
	TransactionID       string  `json:"transaction_id"`
	MojaloopTransferID  string  `json:"mojaloop_transfer_id"`
	AmountNGN           float64 `json:"amount_ngn"`
	AmountLocal         float64 `json:"amount_local"`
	RecipientCurrency   string  `json:"recipient_currency"`
	ExchangeRate        float64 `json:"exchange_rate"`
	TotalFee            float64 `json:"total_fee"`
	RecipientName       string  `json:"recipient_name"`
	RecipientFSP        string  `json:"recipient_fsp"` // Financial Service Provider
	SettlementStatus    string  `json:"settlement_status"`
	SettledAt           string  `json:"settled_at,omitempty"`
	ErrorMessage        string  `json:"error_message,omitempty"`
}

// MojaloopPaymentWorkflow orchestrates pan-African instant payments via Mojaloop
func MojaloopPaymentWorkflow(ctx workflow.Context, req MojaloopPaymentRequest) (*MojaloopPaymentResponse, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting Mojaloop payment workflow", 
		"user_id", req.UserID, 
		"amount_ngn", req.AmountNGN,
		"destination_country", req.RecipientCountry,
	)

	// Configure activity options for instant payments
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 45 * time.Second, // Mojaloop cross-border may take slightly longer
		HeartbeatTimeout:    15 * time.Second,
		RetryPolicy: &workflow.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    15 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var response MojaloopPaymentResponse
	response.TransactionID = workflow.GetInfo(ctx).WorkflowExecution.ID
	response.RecipientCurrency = req.RecipientCurrency

	// Step 1: Validate user authentication
	var authResult AuthResult
	err := workflow.ExecuteActivity(ctx, "ValidateKeycloakSession", req.UserID, "mojaloop_payment").Get(ctx, &authResult)
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
			"destination": req.RecipientCountry,
			"payment_rail": "mojaloop",
		},
	).Get(ctx, &authzResult)
	if err != nil || !authzResult.Allowed {
		logger.Error("Authorization failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Not authorized for Mojaloop payments"
		return &response, fmt.Errorf("authorization denied")
	}

	// Step 3: Validate recipient country is Mojaloop-enabled
	var countryValidation MojaloopCountryValidation
	err = workflow.ExecuteActivity(ctx, "ValidateMojaloopCountry",
		req.RecipientCountry,
	).Get(ctx, &countryValidation)
	if err != nil || !countryValidation.Supported {
		logger.Error("Country not supported by Mojaloop", "country", req.RecipientCountry)
		response.Success = false
		response.ErrorMessage = fmt.Sprintf("Mojaloop not available in %s", req.RecipientCountry)
		return &response, err
	}

	// Step 4: Perform Mojaloop party lookup (discover recipient's FSP)
	var partyLookup MojaloopPartyLookupResult
	err = workflow.ExecuteActivity(ctx, "PerformMojaloopPartyLookup",
		req.RecipientMSISDN,
		req.RecipientCountry,
	).Get(ctx, &partyLookup)
	if err != nil || !partyLookup.Found {
		logger.Error("Mojaloop party lookup failed", "error", err)
		response.Success = false
		response.ErrorMessage = fmt.Sprintf("Recipient not found: %s", req.RecipientMSISDN)
		return &response, err
	}

	response.RecipientName = partyLookup.PartyName
	response.RecipientFSP = partyLookup.FSPName

	// Step 5: Get FX quote (NGN to recipient's local currency)
	var fxQuote FXQuoteResult
	err = workflow.ExecuteActivity(ctx, "GetFXQuote",
		"NGN",
		req.RecipientCurrency,
		req.AmountNGN,
		"mojaloop",
	).Get(ctx, &fxQuote)
	if err != nil {
		logger.Error("FX quote failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to get exchange rate"
		return &response, err
	}

	response.ExchangeRate = fxQuote.Rate
	response.AmountLocal = fxQuote.TargetAmount
	response.AmountNGN = req.AmountNGN

	// Step 6: Get Mojaloop quote (includes fees from both FSPs)
	var mojaloopQuote MojaloopQuoteResult
	err = workflow.ExecuteActivity(ctx, "GetMojaloopQuote",
		req.RecipientMSISDN,
		partyLookup.FSPID,
		response.AmountLocal,
		req.RecipientCurrency,
		req.PaymentType,
	).Get(ctx, &mojaloopQuote)
	if err != nil {
		logger.Error("Mojaloop quote failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to get Mojaloop quote"
		return &response, err
	}

	// Calculate total fees (platform fee + Mojaloop fees)
	platformFee := req.AmountNGN * 0.01 // 1% platform fee
	mojaloopFeeNGN := mojaloopQuote.TransferFee / response.ExchangeRate
	response.TotalFee = platformFee + mojaloopFeeNGN

	totalDebit := req.AmountNGN + response.TotalFee

	// Step 7: Reserve funds in TigerBeetle
	var reservationResult TigerBeetleReservationResult
	err = workflow.ExecuteActivity(ctx, "ReserveFunds",
		req.UserID,
		totalDebit,
		response.TransactionID,
		"mojaloop_payment",
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

	// Step 8: Initiate Mojaloop transfer
	var mojaloopTransfer MojaloopTransferResult
	err = workflow.ExecuteActivity(ctx, "InitiateMojaloopTransfer",
		req.RecipientMSISDN,
		partyLookup.FSPID,
		response.AmountLocal,
		req.RecipientCurrency,
		mojaloopQuote.QuoteID,
		req.PaymentNote,
		response.TransactionID,
	).Get(ctx, &mojaloopTransfer)
	if err != nil {
		logger.Error("Mojaloop transfer initiation failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to initiate Mojaloop transfer"
		return &response, err
	}

	response.MojaloopTransferID = mojaloopTransfer.TransferID
	response.SettlementStatus = mojaloopTransfer.Status
	
	if mojaloopTransfer.Status == "COMMITTED" {
		response.SettledAt = time.Now().UTC().Format(time.RFC3339)
	}

	// Step 9: Commit reserved funds in TigerBeetle
	var commitResult TigerBeetleCommitResult
	err = workflow.ExecuteActivity(ctx, "CommitReservedFunds",
		reservationResult.ReservationID,
		req.UserID,
		"9004", // Payment gateway settlement account
		totalDebit,
		"2005", // Mojaloop transfer code
	).Get(ctx, &commitResult)
	if err != nil {
		logger.Error("Fund commit failed", "error", err)
		response.Success = false
		response.ErrorMessage = "Failed to commit funds"
		return &response, err
	}

	// Step 10: Record transaction in Kafka
	_ = workflow.ExecuteActivity(ctx, "PublishKafkaEvent",
		"mojaloop-payments",
		map[string]interface{}{
			"event_type":          "mojaloop_payment_completed",
			"transaction_id":      response.TransactionID,
			"mojaloop_transfer_id": response.MojaloopTransferID,
			"user_id":             req.UserID,
			"recipient_name":      response.RecipientName,
			"recipient_country":   req.RecipientCountry,
			"recipient_fsp":       response.RecipientFSP,
			"amount_ngn":          response.AmountNGN,
			"amount_local":        response.AmountLocal,
			"currency":            response.RecipientCurrency,
			"settled_at":          response.SettledAt,
			"timestamp":           time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 11: Store in lakehouse
	_ = workflow.ExecuteActivity(ctx, "StoreLakehouseData",
		"mojaloop_transactions",
		map[string]interface{}{
			"transaction_id":       response.TransactionID,
			"user_id":              req.UserID,
			"recipient_name":       response.RecipientName,
			"recipient_country":    req.RecipientCountry,
			"recipient_fsp":        response.RecipientFSP,
			"amount_ngn":           response.AmountNGN,
			"amount_local":         response.AmountLocal,
			"recipient_currency":   response.RecipientCurrency,
			"exchange_rate":        response.ExchangeRate,
			"fee":                  response.TotalFee,
			"mojaloop_transfer_id": response.MojaloopTransferID,
			"settled_at":           response.SettledAt,
			"created_at":           time.Now().UTC(),
		},
	).Get(ctx, nil)

	// Step 12: Send confirmation notifications
	_ = workflow.ExecuteActivity(ctx, "SendNotification",
		req.UserID,
		"mojaloop_payment_completed",
		map[string]string{
			"amount_ngn":           fmt.Sprintf("%.2f", response.AmountNGN),
			"amount_local":         fmt.Sprintf("%.2f %s", response.AmountLocal, response.RecipientCurrency),
			"recipient_name":       response.RecipientName,
			"recipient_country":    req.RecipientCountry,
			"mojaloop_transfer_id": response.MojaloopTransferID,
		},
	).Get(ctx, nil)

	response.Success = true
	logger.Info("Mojaloop payment workflow completed successfully", 
		"transaction_id", response.TransactionID,
		"mojaloop_transfer_id", response.MojaloopTransferID,
	)

	return &response, nil
}

// MojaloopCountryValidation represents country support validation
type MojaloopCountryValidation struct {
	Supported     bool     `json:"supported"`
	CountryCode   string   `json:"country_code"`
	CountryName   string   `json:"country_name"`
	SupportedFSPs []string `json:"supported_fsps"`
}

// MojaloopPartyLookupResult represents the result of party lookup
type MojaloopPartyLookupResult struct {
	Found     bool   `json:"found"`
	PartyName string `json:"party_name"`
	FSPID     string `json:"fsp_id"`
	FSPName   string `json:"fsp_name"`
}

// MojaloopQuoteResult represents the result of quote request
type MojaloopQuoteResult struct {
	QuoteID      string  `json:"quote_id"`
	TransferFee  float64 `json:"transfer_fee"`
	TotalAmount  float64 `json:"total_amount"`
	ExpiryTime   string  `json:"expiry_time"`
}

// MojaloopTransferResult represents the result of transfer initiation
type MojaloopTransferResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"` // "RESERVED", "COMMITTED", "ABORTED"
	SettledAt  string `json:"settled_at,omitempty"`
}
