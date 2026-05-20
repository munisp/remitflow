package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// P2PQRTransferInput represents input for P2P transfer with QR code
type P2PQRTransferInput struct {
	UserID          models.UserID   `json:"user_id"`
	Action          string          `json:"action"` // generate_qr, scan_qr, transfer
	Amount          decimal.Decimal `json:"amount,omitempty"`
	Currency        string          `json:"currency"`
	Message         string          `json:"message,omitempty"`
	WalletID        string          `json:"wallet_id"`
	
	// For QR generation
	QRType          string          `json:"qr_type,omitempty"` // static, dynamic
	ExpiryMinutes   int             `json:"expiry_minutes,omitempty"` // For dynamic QR
	
	// For QR scanning
	QRCode          string          `json:"qr_code,omitempty"` // Scanned QR code data
	
	// For transfer
	RecipientUserID models.UserID   `json:"recipient_user_id,omitempty"`
	RecipientWalletID string        `json:"recipient_wallet_id,omitempty"`
	
	// Optional
	RequestPayment  bool            `json:"request_payment"` // true = request money, false = send money
	SplitBill       bool            `json:"split_bill"`
	SplitCount      int             `json:"split_count,omitempty"`
}

// P2PQRTransferResult represents the workflow result
type P2PQRTransferResult struct {
	Success         bool            `json:"success"`
	Action          string          `json:"action"`
	TransactionID   string          `json:"transaction_id,omitempty"`
	QRCodeData      string          `json:"qr_code_data,omitempty"` // Base64 encoded QR image
	QRCodeURL       string          `json:"qr_code_url,omitempty"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	RecipientName   string          `json:"recipient_name,omitempty"`
	SenderName      string          `json:"sender_name,omitempty"`
	Status          string          `json:"status"` // success, pending, failed
	Message         string          `json:"message"`
	ExpiresAt       *time.Time      `json:"expires_at,omitempty"`
	CompletedAt     time.Time       `json:"completed_at"`
}

// P2PQRTransferWorkflow implements Journey 10: P2P Transfer with QR Code
//
// Actions:
// 1. generate_qr: Generate QR code for receiving payment
// 2. scan_qr: Scan and decode QR code
// 3. transfer: Execute P2P transfer
func P2PQRTransferWorkflow(ctx workflow.Context, input P2PQRTransferInput) (*P2PQRTransferResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("P2PQRTransferWorkflow started",
		"user_id", input.UserID,
		"action", input.Action)

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

	result := &P2PQRTransferResult{
		Success:  false,
		Action:   input.Action,
		Currency: input.Currency,
	}

	// Route based on action
	switch input.Action {
	case "generate_qr":
		return generateQRCode(ctx, input, result, logger)
	case "scan_qr":
		return scanQRCode(ctx, input, result, logger)
	case "transfer":
		return executeP2PTransfer(ctx, input, result, logger)
	default:
		result.Message = "Invalid action: " + input.Action
		result.Status = "failed"
		return result, nil
	}
}

// generateQRCode generates a QR code for receiving payment
func generateQRCode(ctx workflow.Context, input P2PQRTransferInput, result *P2PQRTransferResult, logger workflow.Logger) (*P2PQRTransferResult, error) {
	logger.Info("Generating QR code", "qr_type", input.QRType)

	// Step 1: Get user details
	var userDetails activities.UserDetailsResult
	err := workflow.ExecuteActivity(ctx, activities.GetUserDetails, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &userDetails)

	if err != nil {
		return nil, err
	}

	// Step 2: Generate QR code payload
	var qrPayload activities.QRPayloadResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateQRPayload, map[string]interface{}{
		"user_id":        input.UserID,
		"wallet_id":      input.WalletID,
		"amount":         input.Amount,
		"currency":       input.Currency,
		"message":        input.Message,
		"qr_type":        input.QRType,
		"request_payment": input.RequestPayment,
		"expiry_minutes": input.ExpiryMinutes,
	}).Get(ctx, &qrPayload)

	if err != nil {
		return nil, err
	}

	// Step 3: Generate QR code image
	var qrImage activities.QRImageResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateQRImage, map[string]interface{}{
		"payload": qrPayload.Payload,
		"size":    512, // 512x512 pixels
	}).Get(ctx, &qrImage)

	if err != nil {
		return nil, err
	}

	// Step 4: Store QR code in Redis (for dynamic QR)
	if input.QRType == "dynamic" {
		var expiry time.Duration
		if input.ExpiryMinutes > 0 {
			expiry = time.Duration(input.ExpiryMinutes) * time.Minute
		} else {
			expiry = 30 * time.Minute // Default 30 minutes
		}

		expiresAt := time.Now().Add(expiry)
		result.ExpiresAt = &expiresAt

		_ = workflow.ExecuteActivity(ctx, activities.StoreQRCode, map[string]interface{}{
			"qr_id":      qrPayload.QRID,
			"payload":    qrPayload.Payload,
			"user_id":    input.UserID,
			"wallet_id":  input.WalletID,
			"amount":     input.Amount,
			"currency":   input.Currency,
			"expiry_ttl": int(expiry.Seconds()),
		}).Get(ctx, nil)
	}

	// Step 5: Log to analytics
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "qr_code_generated",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"qr_type":        input.QRType,
			"amount":         input.Amount,
			"request_payment": input.RequestPayment,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.QRCodeData = qrImage.Base64Image
	result.QRCodeURL = qrImage.URL
	result.Amount = input.Amount
	result.Status = "success"
	result.Message = "QR code generated successfully"
	result.CompletedAt = time.Now()

	return result, nil
}

// scanQRCode scans and decodes a QR code
func scanQRCode(ctx workflow.Context, input P2PQRTransferInput, result *P2PQRTransferResult, logger workflow.Logger) (*P2PQRTransferResult, error) {
	logger.Info("Scanning QR code")

	// Step 1: Decode QR code
	var qrData activities.QRDecodeResult
	err := workflow.ExecuteActivity(ctx, activities.DecodeQRCode, map[string]interface{}{
		"qr_code": input.QRCode,
	}).Get(ctx, &qrData)

	if err != nil || !qrData.Valid {
		result.Message = "Invalid QR code"
		result.Status = "failed"
		return result, nil
	}

	// Step 2: Validate QR code (check expiry for dynamic QR)
	if qrData.QRType == "dynamic" {
		var validation activities.QRValidationResult
		err = workflow.ExecuteActivity(ctx, activities.ValidateQRCode, map[string]interface{}{
			"qr_id": qrData.QRID,
		}).Get(ctx, &validation)

		if err != nil || !validation.Valid {
			result.Message = "QR code expired or invalid"
			result.Status = "failed"
			return result, nil
		}
	}

	// Step 3: Get recipient details
	var recipientDetails activities.UserDetailsResult
	err = workflow.ExecuteActivity(ctx, activities.GetUserDetails, map[string]interface{}{
		"user_id": qrData.RecipientUserID,
	}).Get(ctx, &recipientDetails)

	if err != nil {
		return nil, err
	}

	result.Success = true
	result.Amount = qrData.Amount
	result.Currency = qrData.Currency
	result.RecipientName = recipientDetails.Name
	result.Status = "success"
	result.Message = "QR code scanned successfully"
	result.CompletedAt = time.Now()

	// Store scanned data for next step (transfer)
	logger.Info("QR code decoded", "recipient", recipientDetails.Name, "amount", qrData.Amount)

	return result, nil
}

// executeP2PTransfer executes the P2P transfer
func executeP2PTransfer(ctx workflow.Context, input P2PQRTransferInput, result *P2PQRTransferResult, logger workflow.Logger) (*P2PQRTransferResult, error) {
	logger.Info("Executing P2P transfer", "amount", input.Amount)

	// Step 1: Validate sender and recipient
	var senderDetails activities.UserDetailsResult
	err := workflow.ExecuteActivity(ctx, activities.GetUserDetails, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &senderDetails)

	if err != nil {
		return nil, err
	}

	var recipientDetails activities.UserDetailsResult
	err = workflow.ExecuteActivity(ctx, activities.GetUserDetails, map[string]interface{}{
		"user_id": input.RecipientUserID,
	}).Get(ctx, &recipientDetails)

	if err != nil {
		return nil, err
	}

	// Prevent self-transfer
	if input.UserID == input.RecipientUserID {
		result.Message = "Cannot transfer to yourself"
		result.Status = "failed"
		return result, nil
	}

	result.SenderName = senderDetails.Name
	result.RecipientName = recipientDetails.Name

	// Step 2: Calculate amount per person (if split bill)
	transferAmount := input.Amount
	if input.SplitBill && input.SplitCount > 1 {
		transferAmount = input.Amount.Div(decimal.NewFromInt(int64(input.SplitCount)))
		logger.Info("Split bill", "total", input.Amount, "per_person", transferAmount, "count", input.SplitCount)
	}

	result.Amount = transferAmount

	// Step 3: Check sender balance
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.WalletID,
		"currency":  input.Currency,
		"amount":    transferAmount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance"
		result.Status = "failed"
		return result, nil
	}

	// Step 4: Fraud check
	var fraudCheck activities.FraudCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckFraud, map[string]interface{}{
		"user_id":           input.UserID,
		"recipient_user_id": input.RecipientUserID,
		"amount":            transferAmount,
		"currency":          input.Currency,
		"transaction_type":  "p2p_transfer",
	}).Get(ctx, &fraudCheck)

	if err == nil && fraudCheck.Flagged {
		result.Message = "Transaction flagged for review: " + fraudCheck.Reason
		result.Status = "pending"
		
		// Send to manual review
		_ = workflow.ExecuteActivity(ctx, activities.SendToManualReview, map[string]interface{}{
			"user_id":           input.UserID,
			"recipient_user_id": input.RecipientUserID,
			"amount":            transferAmount,
			"fraud_score":       fraudCheck.Score,
		}).Get(ctx, nil)
		
		return result, nil
	}

	// Step 5: Reserve funds (TigerBeetle)
	var reservation activities.FundReservationResult
	err = workflow.ExecuteActivity(ctx, activities.ReserveFunds, map[string]interface{}{
		"wallet_id": input.WalletID,
		"amount":    transferAmount,
		"currency":  input.Currency,
		"reference": "p2p_transfer_" + time.Now().Format("20060102150405"),
	}).Get(ctx, &reservation)

	if err != nil {
		return nil, err
	}

	reservationID := reservation.ReservationID
	logger.Info("Funds reserved", "reservation_id", reservationID)

	// Step 6: Execute transfer (TigerBeetle)
	var transfer activities.TransferResult
	err = workflow.ExecuteActivity(ctx, activities.ExecuteP2PTransfer, map[string]interface{}{
		"sender_wallet_id":    input.WalletID,
		"recipient_wallet_id": input.RecipientWalletID,
		"amount":              transferAmount,
		"currency":            input.Currency,
		"message":             input.Message,
		"reservation_id":      reservationID,
	}).Get(ctx, &transfer)

	if err != nil {
		logger.Error("Transfer failed, compensating", "error", err)
		
		// Compensate: Unreserve funds
		_ = workflow.ExecuteActivity(ctx, activities.UnreserveFunds, map[string]interface{}{
			"reservation_id": reservationID,
		}).Get(ctx, nil)

		result.Message = "Transfer failed"
		result.Status = "failed"
		return result, nil
	}

	result.TransactionID = transfer.TransactionID
	logger.Info("Transfer completed", "transaction_id", transfer.TransactionID)

	// Step 7: Send notifications
	// Notify sender
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "transfer_sent",
		"channel": "push,email",
		"data": map[string]interface{}{
			"recipient_name": recipientDetails.Name,
			"amount":         transferAmount,
			"currency":       input.Currency,
			"transaction_id": transfer.TransactionID,
		},
	}).Get(ctx, nil)

	// Notify recipient
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.RecipientUserID,
		"type":    "transfer_received",
		"channel": "push,email",
		"data": map[string]interface{}{
			"sender_name":    senderDetails.Name,
			"amount":         transferAmount,
			"currency":       input.Currency,
			"message":        input.Message,
			"transaction_id": transfer.TransactionID,
		},
	}).Get(ctx, nil)

	// Step 8: Log to analytics
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "p2p_transfer",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"recipient_user_id": input.RecipientUserID,
			"amount":            transferAmount,
			"currency":          input.Currency,
			"split_bill":        input.SplitBill,
			"split_count":       input.SplitCount,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "success"
	result.Message = "Transfer completed successfully"
	result.CompletedAt = time.Now()

	logger.Info("P2PQRTransferWorkflow completed successfully")
	return result, nil
}
