package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/remittance/transaction-processing/models"
	"github.com/remittance/transaction-processing/services"
	"github.com/remittance/transaction-processing/utils"
	"github.com/remittance/transaction-processing/validators"
)

type TransactionHandler struct {
	transactionService *services.TransactionService
	fraudService       *services.FraudDetectionService
	auditService       *services.AuditService
	notificationService *services.NotificationService
	limitsService      *services.LimitsService
}

func NewTransactionHandler(
	transactionService *services.TransactionService,
	fraudService *services.FraudDetectionService,
	auditService *services.AuditService,
	notificationService *services.NotificationService,
	limitsService *services.LimitsService,
) *TransactionHandler {
	return &TransactionHandler{
		transactionService:  transactionService,
		fraudService:        fraudService,
		auditService:        auditService,
		notificationService: notificationService,
		limitsService:       limitsService,
	}
}

// ProcessTransaction handles transaction processing
func (h *TransactionHandler) ProcessTransaction(w http.ResponseWriter, r *http.Request) {
	var req models.TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate request
	if err := validators.ValidateTransactionRequest(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Validation failed", err)
		return
	}

	// Extract user context
	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	clientIP := utils.GetClientIP(r)

	if userID == "" || agentID == "" {
		utils.WriteErrorResponse(w, http.StatusUnauthorized, "User ID and Agent ID required", nil)
		return
	}

	// Add request metadata
	req.Metadata = utils.MergeMetadata(req.Metadata, map[string]interface{}{
		"user_id":    userID,
		"agent_id":   agentID,
		"client_ip":  clientIP,
		"user_agent": r.Header.Get("User-Agent"),
		"timestamp":  time.Now(),
	})

	// Process transaction
	transaction, err := h.transactionService.ProcessTransaction(r.Context(), &req)
	if err != nil {
		switch err {
		case services.ErrInsufficientFunds:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Insufficient funds", err)
		case services.ErrLimitExceeded:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Transaction limit exceeded", err)
		case services.ErrFraudDetected:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Transaction blocked due to fraud detection", err)
		case services.ErrAccountNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Account not found", err)
		case services.ErrAccountBlocked:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Account is blocked", err)
		case services.ErrInvalidCurrency:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid currency", err)
		case services.ErrServiceUnavailable:
			utils.WriteErrorResponse(w, http.StatusServiceUnavailable, "Service temporarily unavailable", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Transaction processing failed", err)
		}
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.processed",
		EntityID:   transaction.ID,
		EntityType: "transaction",
		Details: map[string]interface{}{
			"transaction_type": transaction.Type,
			"amount":          transaction.Amount,
			"currency":        transaction.Currency,
			"status":          transaction.Status,
		},
		IPAddress: clientIP,
		UserAgent: r.Header.Get("User-Agent"),
		Timestamp: time.Now(),
	})

	// Send notifications asynchronously
	go h.notificationService.SendTransactionNotification(transaction)

	utils.WriteSuccessResponse(w, http.StatusCreated, "Transaction processed successfully", transaction)
}

// GetTransaction retrieves transaction by ID
func (h *TransactionHandler) GetTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	transactionID := vars["id"]

	if transactionID == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Transaction ID required", nil)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	transaction, err := h.transactionService.GetTransactionByID(r.Context(), transactionID, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Transaction not found", err)
		case services.ErrUnauthorized:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Unauthorized to view transaction", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve transaction", err)
		}
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Transaction retrieved successfully", transaction)
}

// ListTransactions retrieves transactions with filtering and pagination
func (h *TransactionHandler) ListTransactions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Parse filters
	filters := &models.TransactionFilters{
		Type:         query.Get("type"),
		Status:       query.Get("status"),
		Currency:     query.Get("currency"),
		AgentID:      query.Get("agent_id"),
		CustomerID:   query.Get("customer_id"),
		StartDate:    query.Get("start_date"),
		EndDate:      query.Get("end_date"),
		SearchTerm:   query.Get("search"),
	}

	// Parse amount range
	if minAmountStr := query.Get("min_amount"); minAmountStr != "" {
		if minAmount, err := strconv.ParseFloat(minAmountStr, 64); err == nil {
			filters.MinAmount = &minAmount
		}
	}

	if maxAmountStr := query.Get("max_amount"); maxAmountStr != "" {
		if maxAmount, err := strconv.ParseFloat(maxAmountStr, 64); err == nil {
			filters.MaxAmount = &maxAmount
		}
	}

	// Parse pagination
	page, _ := strconv.Atoi(query.Get("page"))
	if page < 1 {
		page = 1
	}

	limit, _ := strconv.Atoi(query.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	pagination := &models.Pagination{
		Page:  page,
		Limit: limit,
	}

	// Parse sorting
	sortBy := query.Get("sort_by")
	sortOrder := query.Get("sort_order")
	if sortBy == "" {
		sortBy = "created_at"
	}
	if sortOrder == "" {
		sortOrder = "desc"
	}

	sorting := &models.Sorting{
		Field: sortBy,
		Order: sortOrder,
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	result, err := h.transactionService.ListTransactions(r.Context(), filters, pagination, sorting, userID, agentID, userRole)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve transactions", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Transactions retrieved successfully", result)
}

// ReverseTransaction handles transaction reversal
func (h *TransactionHandler) ReverseTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	transactionID := vars["id"]

	var req models.ReversalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate request
	if err := validators.ValidateReversalRequest(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Validation failed", err)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	// Check authorization
	if !utils.CanReverseTransaction(userRole) {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Insufficient permissions to reverse transaction", nil)
		return
	}

	reversal, err := h.transactionService.ReverseTransaction(r.Context(), transactionID, &req, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Transaction not found", err)
		case services.ErrTransactionNotReversible:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Transaction cannot be reversed", err)
		case services.ErrReversalWindowExpired:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Reversal window has expired", err)
		case services.ErrUnauthorized:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Unauthorized to reverse transaction", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to reverse transaction", err)
		}
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.reversed",
		EntityID:   transactionID,
		EntityType: "transaction",
		Details: map[string]interface{}{
			"reversal_id":     reversal.ID,
			"reversal_reason": req.Reason,
			"original_amount": reversal.OriginalAmount,
		},
		Timestamp: time.Now(),
	})

	// Send notifications
	go h.notificationService.SendReversalNotification(reversal)

	utils.WriteSuccessResponse(w, http.StatusOK, "Transaction reversed successfully", reversal)
}

// GetTransactionStatus retrieves transaction status
func (h *TransactionHandler) GetTransactionStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	transactionID := vars["id"]

	status, err := h.transactionService.GetTransactionStatus(r.Context(), transactionID)
	if err != nil {
		switch err {
		case services.ErrTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Transaction not found", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve status", err)
		}
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Status retrieved successfully", status)
}

// RetryTransaction handles transaction retry
func (h *TransactionHandler) RetryTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	transactionID := vars["id"]

	var req models.RetryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	transaction, err := h.transactionService.RetryTransaction(r.Context(), transactionID, &req, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Transaction not found", err)
		case services.ErrTransactionNotRetryable:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Transaction cannot be retried", err)
		case services.ErrMaxRetriesExceeded:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Maximum retry attempts exceeded", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retry transaction", err)
		}
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.retried",
		EntityID:   transactionID,
		EntityType: "transaction",
		Details: map[string]interface{}{
			"retry_reason": req.Reason,
			"retry_count":  transaction.RetryCount,
		},
		Timestamp: time.Now(),
	})

	utils.WriteSuccessResponse(w, http.StatusOK, "Transaction retried successfully", transaction)
}

// BulkProcessTransactions handles bulk transaction processing
func (h *TransactionHandler) BulkProcessTransactions(w http.ResponseWriter, r *http.Request) {
	var req models.BulkTransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate request
	if err := validators.ValidateBulkTransactionRequest(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Validation failed", err)
		return
	}

	if len(req.Transactions) > 100 {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Maximum 100 transactions allowed per batch", nil)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	// Check authorization
	if !utils.CanProcessBulkTransactions(userRole) {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Insufficient permissions for bulk processing", nil)
		return
	}

	result, err := h.transactionService.BulkProcessTransactions(r.Context(), &req, userID, agentID)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Bulk processing failed", err)
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.bulk_processed",
		EntityID:   fmt.Sprintf("bulk_%d_transactions", len(req.Transactions)),
		EntityType: "transaction",
		Details: map[string]interface{}{
			"batch_id":       req.BatchID,
			"total_count":    result.TotalCount,
			"success_count":  result.SuccessCount,
			"failure_count":  result.FailureCount,
		},
		Timestamp: time.Now(),
	})

	utils.WriteSuccessResponse(w, http.StatusOK, "Bulk processing completed", result)
}

// GetTransactionReceipt generates transaction receipt
func (h *TransactionHandler) GetTransactionReceipt(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	transactionID := vars["id"]

	query := r.URL.Query()
	format := query.Get("format")
	if format == "" {
		format = "json"
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	receipt, err := h.transactionService.GenerateReceipt(r.Context(), transactionID, format, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Transaction not found", err)
		case services.ErrUnauthorized:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Unauthorized to view receipt", err)
		case services.ErrInvalidFormat:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid receipt format", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to generate receipt", err)
		}
		return
	}

	// Set appropriate headers based on format
	switch format {
	case "pdf":
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=receipt_%s.pdf", transactionID))
	case "html":
		w.Header().Set("Content-Type", "text/html")
	default:
		w.Header().Set("Content-Type", "application/json")
	}

	w.Write(receipt)
}

// GetTransactionHistory retrieves transaction history for an account
func (h *TransactionHandler) GetTransactionHistory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	accountID := vars["account_id"]

	query := r.URL.Query()

	// Parse filters
	filters := &models.TransactionFilters{
		Type:       query.Get("type"),
		Status:     query.Get("status"),
		Currency:   query.Get("currency"),
		StartDate:  query.Get("start_date"),
		EndDate:    query.Get("end_date"),
		SearchTerm: query.Get("search"),
	}

	// Parse pagination
	page, _ := strconv.Atoi(query.Get("page"))
	if page < 1 {
		page = 1
	}

	limit, _ := strconv.Atoi(query.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	pagination := &models.Pagination{
		Page:  page,
		Limit: limit,
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	history, err := h.transactionService.GetAccountTransactionHistory(r.Context(), accountID, filters, pagination, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrAccountNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Account not found", err)
		case services.ErrUnauthorized:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Unauthorized to view history", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve history", err)
		}
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "History retrieved successfully", history)
}

// ValidateTransaction validates transaction before processing
func (h *TransactionHandler) ValidateTransaction(w http.ResponseWriter, r *http.Request) {
	var req models.TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	validation, err := h.transactionService.ValidateTransaction(r.Context(), &req, userID, agentID)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Validation failed", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Validation completed", validation)
}

// GetTransactionFees calculates transaction fees
func (h *TransactionHandler) GetTransactionFees(w http.ResponseWriter, r *http.Request) {
	var req models.FeeCalculationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate request
	if err := validators.ValidateFeeCalculationRequest(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Validation failed", err)
		return
	}

	agentID := r.Header.Get("X-Agent-ID")

	fees, err := h.transactionService.CalculateTransactionFees(r.Context(), &req, agentID)
	if err != nil {
		switch err {
		case services.ErrAgentNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Agent not found", err)
		case services.ErrInvalidCurrency:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid currency", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to calculate fees", err)
		}
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Fees calculated successfully", fees)
}

// GetTransactionLimits retrieves current transaction limits
func (h *TransactionHandler) GetTransactionLimits(w http.ResponseWriter, r *http.Request) {
	agentID := r.Header.Get("X-Agent-ID")
	customerID := r.URL.Query().Get("customer_id")

	limits, err := h.limitsService.GetTransactionLimits(r.Context(), agentID, customerID)
	if err != nil {
		switch err {
		case services.ErrAgentNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Agent not found", err)
		case services.ErrCustomerNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Customer not found", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve limits", err)
		}
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Limits retrieved successfully", limits)
}

// CheckTransactionLimits checks if transaction is within limits
func (h *TransactionHandler) CheckTransactionLimits(w http.ResponseWriter, r *http.Request) {
	var req models.LimitCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	agentID := r.Header.Get("X-Agent-ID")

	check, err := h.limitsService.CheckTransactionLimits(r.Context(), &req, agentID)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to check limits", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Limit check completed", check)
}

// GetTransactionAnalytics retrieves transaction analytics
func (h *TransactionHandler) GetTransactionAnalytics(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Parse filters
	filters := &models.AnalyticsFilters{
		StartDate:  query.Get("start_date"),
		EndDate:    query.Get("end_date"),
		AgentID:    query.Get("agent_id"),
		Type:       query.Get("type"),
		Currency:   query.Get("currency"),
		Granularity: query.Get("granularity"), // daily, weekly, monthly
	}

	if filters.Granularity == "" {
		filters.Granularity = "daily"
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	analytics, err := h.transactionService.GetTransactionAnalytics(r.Context(), filters, userID, agentID, userRole)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve analytics", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Analytics retrieved successfully", analytics)
}

// ExportTransactions exports transaction data
func (h *TransactionHandler) ExportTransactions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	format := query.Get("format")
	if format == "" {
		format = "csv"
	}

	if !utils.IsValidExportFormat(format) {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid export format", nil)
		return
	}

	// Parse filters
	filters := &models.TransactionFilters{
		Type:       query.Get("type"),
		Status:     query.Get("status"),
		Currency:   query.Get("currency"),
		AgentID:    query.Get("agent_id"),
		CustomerID: query.Get("customer_id"),
		StartDate:  query.Get("start_date"),
		EndDate:    query.Get("end_date"),
		SearchTerm: query.Get("search"),
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	// Check authorization
	if !utils.CanExportTransactions(userRole) {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Insufficient permissions to export data", nil)
		return
	}

	exportData, err := h.transactionService.ExportTransactions(r.Context(), filters, format, userID, agentID, userRole)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Export failed", err)
		return
	}

	// Set appropriate headers
	filename := fmt.Sprintf("transactions_export_%s.%s", time.Now().Format("20060102_150405"), format)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
	case "xlsx":
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	case "json":
		w.Header().Set("Content-Type", "application/json")
	}

	w.Write(exportData)

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.exported",
		EntityID:   "export",
		EntityType: "transaction",
		Details: map[string]interface{}{
			"format":  format,
			"filters": filters,
		},
		Timestamp: time.Now(),
	})
}

// ScheduleTransaction schedules a future transaction
func (h *TransactionHandler) ScheduleTransaction(w http.ResponseWriter, r *http.Request) {
	var req models.ScheduledTransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate request
	if err := validators.ValidateScheduledTransactionRequest(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Validation failed", err)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	scheduledTransaction, err := h.transactionService.ScheduleTransaction(r.Context(), &req, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrInvalidScheduleTime:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid schedule time", err)
		case services.ErrAccountNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Account not found", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to schedule transaction", err)
		}
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "transaction.scheduled",
		EntityID:   scheduledTransaction.ID,
		EntityType: "scheduled_transaction",
		Details: map[string]interface{}{
			"scheduled_time": scheduledTransaction.ScheduledTime,
			"amount":        scheduledTransaction.Amount,
			"currency":      scheduledTransaction.Currency,
		},
		Timestamp: time.Now(),
	})

	utils.WriteSuccessResponse(w, http.StatusCreated, "Transaction scheduled successfully", scheduledTransaction)
}

// CancelScheduledTransaction cancels a scheduled transaction
func (h *TransactionHandler) CancelScheduledTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	scheduledTransactionID := vars["id"]

	var req models.CancelScheduledTransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	err := h.transactionService.CancelScheduledTransaction(r.Context(), scheduledTransactionID, &req, userID, agentID)
	if err != nil {
		switch err {
		case services.ErrScheduledTransactionNotFound:
			utils.WriteErrorResponse(w, http.StatusNotFound, "Scheduled transaction not found", err)
		case services.ErrTransactionAlreadyProcessed:
			utils.WriteErrorResponse(w, http.StatusBadRequest, "Transaction already processed", err)
		case services.ErrUnauthorized:
			utils.WriteErrorResponse(w, http.StatusForbidden, "Unauthorized to cancel transaction", err)
		default:
			utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to cancel scheduled transaction", err)
		}
		return
	}

	// Log audit event
	h.auditService.LogEvent(r.Context(), &models.AuditEvent{
		UserID:     userID,
		Action:     "scheduled_transaction.cancelled",
		EntityID:   scheduledTransactionID,
		EntityType: "scheduled_transaction",
		Details: map[string]interface{}{
			"cancellation_reason": req.Reason,
		},
		Timestamp: time.Now(),
	})

	utils.WriteSuccessResponse(w, http.StatusOK, "Scheduled transaction cancelled successfully", nil)
}

// GetScheduledTransactions retrieves scheduled transactions
func (h *TransactionHandler) GetScheduledTransactions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Parse filters
	filters := &models.ScheduledTransactionFilters{
		Status:    query.Get("status"),
		Type:      query.Get("type"),
		Currency:  query.Get("currency"),
		StartDate: query.Get("start_date"),
		EndDate:   query.Get("end_date"),
	}

	// Parse pagination
	page, _ := strconv.Atoi(query.Get("page"))
	if page < 1 {
		page = 1
	}

	limit, _ := strconv.Atoi(query.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	pagination := &models.Pagination{
		Page:  page,
		Limit: limit,
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")

	result, err := h.transactionService.GetScheduledTransactions(r.Context(), filters, pagination, userID, agentID)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve scheduled transactions", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Scheduled transactions retrieved successfully", result)
}

// ProcessPendingTransactions processes pending transactions (admin endpoint)
func (h *TransactionHandler) ProcessPendingTransactions(w http.ResponseWriter, r *http.Request) {
	userRole := r.Header.Get("X-User-Role")

	// Check authorization
	if !utils.IsAdmin(userRole) {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Admin access required", nil)
		return
	}

	result, err := h.transactionService.ProcessPendingTransactions(r.Context())
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to process pending transactions", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Pending transactions processed", result)
}

// GetTransactionStatistics retrieves transaction statistics
func (h *TransactionHandler) GetTransactionStatistics(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	period := query.Get("period")
	if period == "" {
		period = "today"
	}

	userID := r.Header.Get("X-User-ID")
	agentID := r.Header.Get("X-Agent-ID")
	userRole := r.Header.Get("X-User-Role")

	statistics, err := h.transactionService.GetTransactionStatistics(r.Context(), period, userID, agentID, userRole)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve statistics", err)
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, "Statistics retrieved successfully", statistics)
}

