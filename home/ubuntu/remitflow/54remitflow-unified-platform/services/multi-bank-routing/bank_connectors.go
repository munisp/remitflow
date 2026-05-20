package multibank

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

// TransferStatus represents the status of a transfer
type TransferStatus string

const (
	StatusPending    TransferStatus = "pending"
	StatusProcessing TransferStatus = "processing"
	StatusSuccessful TransferStatus = "successful"
	StatusFailed     TransferStatus = "failed"
	StatusReversed   TransferStatus = "reversed"
	StatusTimeout    TransferStatus = "timeout"
)

// TransferResult represents the result of a transfer operation
type TransferResult struct {
	TransferID         string         `json:"transfer_id"`
	ProviderReference  string         `json:"provider_reference"`
	SessionID          string         `json:"session_id"`
	Status             TransferStatus `json:"status"`
	Amount             float64        `json:"amount"`
	Currency           string         `json:"currency"`
	SourceAccount      string         `json:"source_account"`
	DestAccount        string         `json:"dest_account"`
	DestBankCode       string         `json:"dest_bank_code"`
	DestAccountName    string         `json:"dest_account_name"`
	ResponseCode       string         `json:"response_code"`
	ResponseMessage    string         `json:"response_message"`
	TransactionDate    time.Time      `json:"transaction_date"`
	SettlementDate     *time.Time     `json:"settlement_date,omitempty"`
	Fee                float64        `json:"fee"`
	Narration          string         `json:"narration"`
	ProcessingTimeMs   int64          `json:"processing_time_ms"`
}

// NameEnquiryResult represents the result of a name enquiry
type NameEnquiryResult struct {
	AccountNumber string `json:"account_number"`
	AccountName   string `json:"account_name"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	Currency      string `json:"currency"`
	IsValid       bool   `json:"is_valid"`
	ResponseCode  string `json:"response_code"`
	SessionID     string `json:"session_id"`
}

// BalanceEnquiryResult represents the result of a balance enquiry
type BalanceEnquiryResult struct {
	AccountNumber    string    `json:"account_number"`
	AvailableBalance float64   `json:"available_balance"`
	LedgerBalance    float64   `json:"ledger_balance"`
	Currency         string    `json:"currency"`
	LastUpdated      time.Time `json:"last_updated"`
}

// BankConnector is the interface for all bank connectors
type BankConnector interface {
	// Transfer executes a fund transfer
	Transfer(ctx context.Context, req *TransferRequest, decision *RoutingDecision) (*TransferResult, error)
	
	// NameEnquiry validates an account and returns account name
	NameEnquiry(ctx context.Context, accountNumber, bankCode string) (*NameEnquiryResult, error)
	
	// BalanceEnquiry gets the balance of our account at this bank
	BalanceEnquiry(ctx context.Context, accountNumber string) (*BalanceEnquiryResult, error)
	
	// GetTransactionStatus gets the status of a transaction
	GetTransactionStatus(ctx context.Context, reference string) (*TransferResult, error)
	
	// GetBankCode returns the bank code this connector handles
	GetBankCode() string
	
	// GetRail returns the transfer rail this connector uses
	GetRail() TransferRail
	
	// IsHealthy checks if the connector is healthy
	IsHealthy(ctx context.Context) bool
}

// ConnectorConfig holds configuration for bank connectors
type ConnectorConfig struct {
	BaseURL       string            `json:"base_url"`
	APIKey        string            `json:"api_key"`
	SecretKey     string            `json:"secret_key"`
	ClientID      string            `json:"client_id"`
	MerchantID    string            `json:"merchant_id"`
	TerminalID    string            `json:"terminal_id"`
	Timeout       time.Duration     `json:"timeout"`
	MaxRetries    int               `json:"max_retries"`
	Headers       map[string]string `json:"headers"`
	CertPath      string            `json:"cert_path"`
	KeyPath       string            `json:"key_path"`
}

// CircuitBreaker implements circuit breaker pattern for connectors
type CircuitBreaker struct {
	name             string
	failureThreshold int
	recoveryTimeout  time.Duration
	failures         int
	lastFailure      time.Time
	state            string // closed, open, half-open
	mu               sync.RWMutex
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker(name string, failureThreshold int, recoveryTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		name:             name,
		failureThreshold: failureThreshold,
		recoveryTimeout:  recoveryTimeout,
		state:            "closed",
	}
}

// CanExecute checks if the circuit allows execution
func (cb *CircuitBreaker) CanExecute() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	
	switch cb.state {
	case "closed":
		return true
	case "open":
		if time.Since(cb.lastFailure) > cb.recoveryTimeout {
			return true // Allow half-open attempt
		}
		return false
	case "half-open":
		return true
	}
	return true
}

// RecordSuccess records a successful operation
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.state = "closed"
}

// RecordFailure records a failed operation
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
	if cb.failures >= cb.failureThreshold {
		cb.state = "open"
	}
}

// =============================================================================
// NIBSS NIP CONNECTOR (Universal Coverage)
// =============================================================================

// NIPConnector implements the NIBSS Instant Payment connector
type NIPConnector struct {
	config         *ConnectorConfig
	httpClient     *http.Client
	circuitBreaker *CircuitBreaker
	institutionCode string
}

// NewNIPConnector creates a new NIP connector
func NewNIPConnector(config *ConnectorConfig, institutionCode string) *NIPConnector {
	return &NIPConnector{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
		circuitBreaker:  NewCircuitBreaker("nip", 5, 30*time.Second),
		institutionCode: institutionCode,
	}
}

// Transfer executes a NIP transfer
func (c *NIPConnector) Transfer(ctx context.Context, req *TransferRequest, decision *RoutingDecision) (*TransferResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, errors.New("NIP connector circuit breaker is open")
	}
	
	startTime := time.Now()
	sessionID := c.generateSessionID()
	
	// Build NIP request
	nipRequest := map[string]interface{}{
		"sessionId":              sessionID,
		"nameEnquiryRef":         req.Reference,
		"destinationInstitutionCode": req.DestBankCode,
		"channelCode":            "2", // Internet Banking
		"beneficiaryAccountNumber": req.DestAccountNumber,
		"beneficiaryAccountName": req.DestAccountName,
		"beneficiaryBankVerificationNumber": "",
		"beneficiaryKYCLevel":    "1",
		"originatorAccountName":  decision.SourceAccount.AccountName,
		"originatorAccountNumber": decision.SourceAccount.AccountNumber,
		"originatorBankVerificationNumber": "",
		"originatorKYCLevel":     "3",
		"transactionLocation":    "6.5244,3.3792", // Lagos coordinates
		"narration":              req.Narration,
		"paymentReference":       req.Reference,
		"amount":                 fmt.Sprintf("%.2f", req.Amount),
	}
	
	// Sign request
	signature := c.signRequest(nipRequest)
	
	// In production, this would make actual API call to NIBSS
	// For now, simulate the response
	result := &TransferResult{
		TransferID:        req.TransferID,
		ProviderReference: sessionID,
		SessionID:         sessionID,
		Status:            StatusSuccessful,
		Amount:            req.Amount,
		Currency:          req.Currency,
		SourceAccount:     decision.SourceAccount.AccountNumber,
		DestAccount:       req.DestAccountNumber,
		DestBankCode:      req.DestBankCode,
		DestAccountName:   req.DestAccountName,
		ResponseCode:      "00",
		ResponseMessage:   "Approved or completed successfully",
		TransactionDate:   time.Now(),
		Fee:               decision.EstimatedCost,
		Narration:         req.Narration,
		ProcessingTimeMs:  time.Since(startTime).Milliseconds(),
	}
	
	// Record success
	c.circuitBreaker.RecordSuccess()
	
	_ = signature // Used in production
	
	return result, nil
}

// NameEnquiry performs NIP name enquiry
func (c *NIPConnector) NameEnquiry(ctx context.Context, accountNumber, bankCode string) (*NameEnquiryResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, errors.New("NIP connector circuit breaker is open")
	}
	
	sessionID := c.generateSessionID()
	
	// In production, this would make actual API call to NIBSS
	result := &NameEnquiryResult{
		AccountNumber: accountNumber,
		AccountName:   "ACCOUNT HOLDER NAME", // Would come from NIBSS
		BankCode:      bankCode,
		Currency:      "NGN",
		IsValid:       true,
		ResponseCode:  "00",
		SessionID:     sessionID,
	}
	
	c.circuitBreaker.RecordSuccess()
	
	return result, nil
}

// BalanceEnquiry gets balance (not typically available via NIP)
func (c *NIPConnector) BalanceEnquiry(ctx context.Context, accountNumber string) (*BalanceEnquiryResult, error) {
	return nil, errors.New("balance enquiry not available via NIP")
}

// GetTransactionStatus gets transaction status via NIP
func (c *NIPConnector) GetTransactionStatus(ctx context.Context, reference string) (*TransferResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, errors.New("NIP connector circuit breaker is open")
	}
	
	// In production, this would query NIBSS for transaction status
	return &TransferResult{
		ProviderReference: reference,
		Status:            StatusSuccessful,
		ResponseCode:      "00",
		ResponseMessage:   "Transaction successful",
	}, nil
}

// GetBankCode returns empty as NIP handles all banks
func (c *NIPConnector) GetBankCode() string {
	return "" // Universal
}

// GetRail returns the NIP rail
func (c *NIPConnector) GetRail() TransferRail {
	return RailNIP
}

// IsHealthy checks if NIP connector is healthy
func (c *NIPConnector) IsHealthy(ctx context.Context) bool {
	return c.circuitBreaker.CanExecute()
}

// generateSessionID generates a unique session ID for NIP
func (c *NIPConnector) generateSessionID() string {
	timestamp := time.Now().Format("20060102150405")
	random := uuid.New().String()[:8]
	return fmt.Sprintf("%s%s%s", c.institutionCode, timestamp, random)
}

// signRequest signs a NIP request
func (c *NIPConnector) signRequest(data map[string]interface{}) string {
	jsonData, _ := json.Marshal(data)
	h := hmac.New(sha512.New, []byte(c.config.SecretKey))
	h.Write(jsonData)
	return hex.EncodeToString(h.Sum(nil))
}

// =============================================================================
// DIRECT BANK CONNECTOR (For banks with direct API)
// =============================================================================

// DirectBankConnector implements direct bank API integration
type DirectBankConnector struct {
	bankCode       string
	bankName       string
	config         *ConnectorConfig
	httpClient     *http.Client
	circuitBreaker *CircuitBreaker
}

// NewDirectBankConnector creates a new direct bank connector
func NewDirectBankConnector(bankCode, bankName string, config *ConnectorConfig) *DirectBankConnector {
	return &DirectBankConnector{
		bankCode: bankCode,
		bankName: bankName,
		config:   config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
		circuitBreaker: NewCircuitBreaker(fmt.Sprintf("direct_%s", bankCode), 5, 30*time.Second),
	}
}

// Transfer executes a direct bank transfer
func (c *DirectBankConnector) Transfer(ctx context.Context, req *TransferRequest, decision *RoutingDecision) (*TransferResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, fmt.Errorf("%s connector circuit breaker is open", c.bankName)
	}
	
	startTime := time.Now()
	reference := c.generateReference()
	
	// Build bank-specific request
	// Each bank has different API format - this is a generic implementation
	bankRequest := map[string]interface{}{
		"reference":          reference,
		"amount":             req.Amount,
		"currency":           req.Currency,
		"sourceAccount":      decision.SourceAccount.AccountNumber,
		"destinationAccount": req.DestAccountNumber,
		"destinationBank":    req.DestBankCode,
		"narration":          req.Narration,
		"beneficiaryName":    req.DestAccountName,
	}
	
	// Sign request
	signature := c.signRequest(bankRequest)
	
	// In production, this would make actual API call to the bank
	result := &TransferResult{
		TransferID:        req.TransferID,
		ProviderReference: reference,
		SessionID:         reference,
		Status:            StatusSuccessful,
		Amount:            req.Amount,
		Currency:          req.Currency,
		SourceAccount:     decision.SourceAccount.AccountNumber,
		DestAccount:       req.DestAccountNumber,
		DestBankCode:      req.DestBankCode,
		DestAccountName:   req.DestAccountName,
		ResponseCode:      "00",
		ResponseMessage:   "Transaction successful",
		TransactionDate:   time.Now(),
		Fee:               decision.EstimatedCost,
		Narration:         req.Narration,
		ProcessingTimeMs:  time.Since(startTime).Milliseconds(),
	}
	
	c.circuitBreaker.RecordSuccess()
	
	_ = signature // Used in production
	
	return result, nil
}

// NameEnquiry performs name enquiry via direct bank API
func (c *DirectBankConnector) NameEnquiry(ctx context.Context, accountNumber, bankCode string) (*NameEnquiryResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, fmt.Errorf("%s connector circuit breaker is open", c.bankName)
	}
	
	// In production, this would make actual API call to the bank
	result := &NameEnquiryResult{
		AccountNumber: accountNumber,
		AccountName:   "ACCOUNT HOLDER NAME",
		BankCode:      bankCode,
		BankName:      c.bankName,
		Currency:      "NGN",
		IsValid:       true,
		ResponseCode:  "00",
	}
	
	c.circuitBreaker.RecordSuccess()
	
	return result, nil
}

// BalanceEnquiry gets balance via direct bank API
func (c *DirectBankConnector) BalanceEnquiry(ctx context.Context, accountNumber string) (*BalanceEnquiryResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, fmt.Errorf("%s connector circuit breaker is open", c.bankName)
	}
	
	// In production, this would make actual API call to the bank
	result := &BalanceEnquiryResult{
		AccountNumber:    accountNumber,
		AvailableBalance: 0, // Would come from bank
		LedgerBalance:    0,
		Currency:         "NGN",
		LastUpdated:      time.Now(),
	}
	
	c.circuitBreaker.RecordSuccess()
	
	return result, nil
}

// GetTransactionStatus gets transaction status via direct bank API
func (c *DirectBankConnector) GetTransactionStatus(ctx context.Context, reference string) (*TransferResult, error) {
	if !c.circuitBreaker.CanExecute() {
		return nil, fmt.Errorf("%s connector circuit breaker is open", c.bankName)
	}
	
	// In production, this would query the bank for transaction status
	return &TransferResult{
		ProviderReference: reference,
		Status:            StatusSuccessful,
		ResponseCode:      "00",
		ResponseMessage:   "Transaction successful",
	}, nil
}

// GetBankCode returns the bank code
func (c *DirectBankConnector) GetBankCode() string {
	return c.bankCode
}

// GetRail returns the direct rail
func (c *DirectBankConnector) GetRail() TransferRail {
	return RailDirect
}

// IsHealthy checks if the connector is healthy
func (c *DirectBankConnector) IsHealthy(ctx context.Context) bool {
	return c.circuitBreaker.CanExecute()
}

// generateReference generates a unique reference
func (c *DirectBankConnector) generateReference() string {
	return fmt.Sprintf("%s%d%s", c.bankCode, time.Now().UnixNano(), uuid.New().String()[:8])
}

// signRequest signs a request for the bank
func (c *DirectBankConnector) signRequest(data map[string]interface{}) string {
	jsonData, _ := json.Marshal(data)
	h := hmac.New(sha256.New, []byte(c.config.SecretKey))
	h.Write(jsonData)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// =============================================================================
// CONNECTOR MANAGER
// =============================================================================

// ConnectorManager manages all bank connectors
type ConnectorManager struct {
	nipConnector     *NIPConnector
	directConnectors map[string]*DirectBankConnector
	mu               sync.RWMutex
}

// NewConnectorManager creates a new connector manager
func NewConnectorManager(nipConfig *ConnectorConfig, institutionCode string) *ConnectorManager {
	return &ConnectorManager{
		nipConnector:     NewNIPConnector(nipConfig, institutionCode),
		directConnectors: make(map[string]*DirectBankConnector),
	}
}

// RegisterDirectConnector registers a direct bank connector
func (m *ConnectorManager) RegisterDirectConnector(bankCode, bankName string, config *ConnectorConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.directConnectors[bankCode] = NewDirectBankConnector(bankCode, bankName, config)
}

// GetConnector returns the appropriate connector for a transfer
func (m *ConnectorManager) GetConnector(decision *RoutingDecision) (BankConnector, error) {
	switch decision.SelectedRail {
	case RailNIP, RailNEFT:
		return m.nipConnector, nil
	case RailDirect, RailOnUs:
		m.mu.RLock()
		defer m.mu.RUnlock()
		
		connector, exists := m.directConnectors[decision.DestinationBank.Code]
		if !exists {
			// Fall back to NIP if no direct connector
			return m.nipConnector, nil
		}
		return connector, nil
	default:
		return nil, fmt.Errorf("unsupported rail: %s", decision.SelectedRail)
	}
}

// ExecuteTransfer executes a transfer using the appropriate connector
func (m *ConnectorManager) ExecuteTransfer(ctx context.Context, req *TransferRequest, decision *RoutingDecision) (*TransferResult, error) {
	connector, err := m.GetConnector(decision)
	if err != nil {
		return nil, err
	}
	
	return connector.Transfer(ctx, req, decision)
}

// NameEnquiry performs name enquiry using NIP
func (m *ConnectorManager) NameEnquiry(ctx context.Context, accountNumber, bankCode string) (*NameEnquiryResult, error) {
	return m.nipConnector.NameEnquiry(ctx, accountNumber, bankCode)
}

// GetHealthStatus returns health status of all connectors
func (m *ConnectorManager) GetHealthStatus(ctx context.Context) map[string]bool {
	status := make(map[string]bool)
	
	status["nip"] = m.nipConnector.IsHealthy(ctx)
	
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	for code, connector := range m.directConnectors {
		status[fmt.Sprintf("direct_%s", code)] = connector.IsHealthy(ctx)
	}
	
	return status
}
