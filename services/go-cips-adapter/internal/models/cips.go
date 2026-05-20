// Package models — CIPS ISO 20022 message types and domain models
package models

import "time"

// ─── CIPS Participant ──────────────────────────────────────────────────────────
type CIPSParticipant struct {
	BIC           string `json:"bic"`
	Name          string `json:"name"`
	CNAPSCode     string `json:"cnaps_code"`
	Country       string `json:"country"`
	Currency      string `json:"currency"`
	IsActive      bool   `json:"is_active"`
	ParticipantID string `json:"participant_id"`
}

// ─── Account Lookup ────────────────────────────────────────────────────────────
type AccountLookupRequest struct {
	AccountNumber string `json:"account_number" binding:"required"`
	BankBIC       string `json:"bank_bic" binding:"required"`
	CNAPSCode     string `json:"cnaps_code"`
}

type AccountLookupResponse struct {
	Found       bool   `json:"found"`
	AccountName string `json:"account_name,omitempty"`
	BankName    string `json:"bank_name,omitempty"`
	BankBIC     string `json:"bank_bic,omitempty"`
	CNAPSCode   string `json:"cnaps_code,omitempty"`
	Currency    string `json:"currency,omitempty"`
	Country     string `json:"country,omitempty"`
	Verified    bool   `json:"verified"`
}

// ─── ISO 20022 pacs.008 Transfer ──────────────────────────────────────────────
type TransferRequest struct {
	// Payer (initiating party)
	PayerName    string `json:"payer_name" binding:"required"`
	PayerAccount string `json:"payer_account" binding:"required"`
	PayerBIC     string `json:"payer_bic" binding:"required"`
	PayerCountry string `json:"payer_country"`

	// Payee (beneficiary)
	PayeeName    string `json:"payee_name" binding:"required"`
	PayeeAccount string `json:"payee_account" binding:"required"`
	PayeeBIC     string `json:"payee_bic" binding:"required"`
	PayeeCNAPS   string `json:"payee_cnaps"`
	PayeeCountry string `json:"payee_country"`

	// Amount
	Amount   float64 `json:"amount" binding:"required,gt=0"`
	Currency string  `json:"currency" binding:"required"` // CNY or CNH

	// Remittance info
	Purpose   string `json:"purpose"`   // TRAD, SALA, PENS, GOVT, etc.
	Reference string `json:"reference"` // End-to-end reference
	Note      string `json:"note"`

	// Metadata
	UserID    int    `json:"user_id"`
	RequestID string `json:"request_id"`
}

type TransferResponse struct {
	TransactionID       string    `json:"transaction_id"`
	MsgID               string    `json:"msg_id"`
	Status              string    `json:"status"` // ACCP, ACSP, ACSC, RJCT, PDNG
	StatusDescription   string    `json:"status_description"`
	EstimatedSettlement time.Time `json:"estimated_settlement"`
	FeeAmount           float64   `json:"fee_amount"`
	FeeCurrency         string    `json:"fee_currency"`
	ExchangeRate        float64   `json:"exchange_rate,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
}

// ─── ISO 20022 pacs.002 Status Report ─────────────────────────────────────────
type TransferStatus struct {
	TransactionID     string    `json:"transaction_id"`
	MsgID             string    `json:"msg_id"`
	Status            string    `json:"status"`
	StatusDescription string    `json:"status_description"`
	SettledAt         *time.Time `json:"settled_at,omitempty"`
	ErrorCode         string    `json:"error_code,omitempty"`
	ErrorDescription  string    `json:"error_description,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ─── ISO 20022 camt.056 Cancellation ──────────────────────────────────────────
type CancellationRequest struct {
	TransactionID string `json:"transaction_id" binding:"required"`
	Reason        string `json:"reason" binding:"required"` // DUPL, TECH, FRAD, etc.
	RequestedBy   string `json:"requested_by"`
}

type CancellationResponse struct {
	TransactionID string `json:"transaction_id"`
	Accepted      bool   `json:"accepted"`
	Message       string `json:"message"`
}

// ─── Settlement Window ─────────────────────────────────────────────────────────
type SettlementWindow struct {
	WindowID    string    `json:"window_id"`
	OpenTime    time.Time `json:"open_time"`
	CloseTime   time.Time `json:"close_time"`
	Status      string    `json:"status"` // OPEN, CLOSED, PENDING
	TotalAmount float64   `json:"total_amount"`
	Currency    string    `json:"currency"`
	TxCount     int       `json:"tx_count"`
}

// ─── Compliance Screening ──────────────────────────────────────────────────────
type ComplianceScreenRequest struct {
	PayerName    string  `json:"payer_name" binding:"required"`
	PayeeName    string  `json:"payee_name" binding:"required"`
	Amount       float64 `json:"amount" binding:"required"`
	Currency     string  `json:"currency" binding:"required"`
	Purpose      string  `json:"purpose"`
	PayerCountry string  `json:"payer_country"`
	PayeeCountry string  `json:"payee_country"`
}

type ComplianceScreenResult struct {
	Cleared      bool     `json:"cleared"`
	RiskScore    float64  `json:"risk_score"` // 0.0 - 1.0
	RiskLevel    string   `json:"risk_level"` // LOW, MEDIUM, HIGH, CRITICAL
	Flags        []string `json:"flags"`
	RequiresKYC  bool     `json:"requires_kyc"`
	RequiresSAR  bool     `json:"requires_sar"`
	SanctionsHit bool     `json:"sanctions_hit"`
	PEPMatch     bool     `json:"pep_match"`
	Message      string   `json:"message"`
}

// ─── Pacs.002 Callback (from CIPS Switch) ─────────────────────────────────────
type Pacs002Callback struct {
	MsgID         string `json:"msg_id"`
	OrigMsgID     string `json:"orig_msg_id"`
	TransactionID string `json:"transaction_id"`
	Status        string `json:"status"`
	StatusReason  string `json:"status_reason,omitempty"`
	Timestamp     string `json:"timestamp"`
	Signature     string `json:"signature"` // HMAC-SHA256 of payload
}

// ─── Health ────────────────────────────────────────────────────────────────────
type HealthResponse struct {
	Status    string            `json:"status"`
	Service   string            `json:"service"`
	Version   string            `json:"version"`
	Timestamp time.Time         `json:"timestamp"`
	Checks    map[string]string `json:"checks"`
}
