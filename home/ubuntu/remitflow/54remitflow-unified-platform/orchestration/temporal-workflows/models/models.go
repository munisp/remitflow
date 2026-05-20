package models

import (
	"time"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Common models used across all workflows

type UserID string
type TransactionID string
type AccountID string
type WalletID string

// User represents a platform user
type User struct {
	ID          UserID    `json:"id"`
	Email       string    `json:"email"`
	Phone       string    `json:"phone"`
	FirstName   string    `json:"first_name"`
	LastName    string    `json:"last_name"`
	KYCTier     int       `json:"kyc_tier"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// Transaction represents a financial transaction
type Transaction struct {
	ID              TransactionID   `json:"id"`
	Type            string          `json:"type"` // transfer, topup, withdrawal, etc.
	Status          string          `json:"status"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	SenderID        UserID          `json:"sender_id"`
	ReceiverID      UserID          `json:"receiver_id"`
	SourceWalletID  WalletID        `json:"source_wallet_id"`
	TargetWalletID  WalletID        `json:"target_wallet_id"`
	Description     string          `json:"description"`
	Metadata        map[string]interface{} `json:"metadata"`
	CreatedAt       time.Time       `json:"created_at"`
	CompletedAt     *time.Time      `json:"completed_at,omitempty"`
}

// Wallet represents a user wallet
type Wallet struct {
	ID        WalletID        `json:"id"`
	UserID    UserID          `json:"user_id"`
	Currency  string          `json:"currency"`
	Balance   decimal.Decimal `json:"balance"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"created_at"`
}

// Beneficiary represents a saved beneficiary
type Beneficiary struct {
	ID            string    `json:"id"`
	UserID        UserID    `json:"user_id"`
	Name          string    `json:"name"`
	AccountNumber string    `json:"account_number"`
	BankCode      string    `json:"bank_code"`
	BankName      string    `json:"bank_name"`
	Type          string    `json:"type"` // domestic, international
	Country       string    `json:"country"`
	CreatedAt     time.Time `json:"created_at"`
}

// KYCDocument represents an identity document
type KYCDocument struct {
	ID           string    `json:"id"`
	UserID       UserID    `json:"user_id"`
	Type         string    `json:"type"` // passport, drivers_license, national_id
	DocumentNumber string  `json:"document_number"`
	IssuedDate   time.Time `json:"issued_date"`
	ExpiryDate   time.Time `json:"expiry_date"`
	FrontImageURL string   `json:"front_image_url"`
	BackImageURL  string   `json:"back_image_url,omitempty"`
	Status       string    `json:"status"` // pending, verified, rejected
	VerifiedAt   *time.Time `json:"verified_at,omitempty"`
}

// OTPVerification represents an OTP verification request
type OTPVerification struct {
	ID        string    `json:"id"`
	UserID    UserID    `json:"user_id"`
	Type      string    `json:"type"` // email, sms
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
	Verified  bool      `json:"verified"`
}

// ExchangeRate represents a currency exchange rate
type ExchangeRate struct {
	FromCurrency string          `json:"from_currency"`
	ToCurrency   string          `json:"to_currency"`
	Rate         decimal.Decimal `json:"rate"`
	Timestamp    time.Time       `json:"timestamp"`
	Provider     string          `json:"provider"`
}

// PaymentMethod represents a payment method
type PaymentMethod struct {
	ID        string    `json:"id"`
	UserID    UserID    `json:"user_id"`
	Type      string    `json:"type"` // card, bank_account
	Last4     string    `json:"last4"`
	Brand     string    `json:"brand,omitempty"`
	ExpiryMonth int     `json:"expiry_month,omitempty"`
	ExpiryYear  int     `json:"expiry_year,omitempty"`
	IsDefault bool      `json:"is_default"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// Dispute represents a transaction dispute
type Dispute struct {
	ID            string        `json:"id"`
	TransactionID TransactionID `json:"transaction_id"`
	UserID        UserID        `json:"user_id"`
	Reason        string        `json:"reason"`
	Description   string        `json:"description"`
	Status        string        `json:"status"` // open, investigating, resolved, rejected
	Evidence      []string      `json:"evidence"` // URLs to evidence files
	Resolution    string        `json:"resolution,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
	ResolvedAt    *time.Time    `json:"resolved_at,omitempty"`
}

// SavingsAccount represents a savings account
type SavingsAccount struct {
	ID            string          `json:"id"`
	UserID        UserID          `json:"user_id"`
	Name          string          `json:"name"`
	TargetAmount  decimal.Decimal `json:"target_amount"`
	CurrentAmount decimal.Decimal `json:"current_amount"`
	Currency      string          `json:"currency"`
	InterestRate  decimal.Decimal `json:"interest_rate"`
	MaturityDate  time.Time       `json:"maturity_date"`
	AutoSave      bool            `json:"auto_save"`
	AutoSaveAmount decimal.Decimal `json:"auto_save_amount,omitempty"`
	Status        string          `json:"status"`
	CreatedAt     time.Time       `json:"created_at"`
}

// Investment represents an investment
type Investment struct {
	ID            string          `json:"id"`
	UserID        UserID          `json:"user_id"`
	ProductID     string          `json:"product_id"`
	ProductName   string          `json:"product_name"`
	Amount        decimal.Decimal `json:"amount"`
	Currency      string          `json:"currency"`
	ExpectedReturn decimal.Decimal `json:"expected_return"`
	RiskLevel     string          `json:"risk_level"`
	MaturityDate  time.Time       `json:"maturity_date"`
	Status        string          `json:"status"`
	CreatedAt     time.Time       `json:"created_at"`
}

// FraudScore represents a fraud risk score
type FraudScore struct {
	TransactionID TransactionID `json:"transaction_id"`
	Score         float64       `json:"score"` // 0-100
	RiskLevel     string        `json:"risk_level"` // low, medium, high
	Factors       []string      `json:"factors"`
	Timestamp     time.Time     `json:"timestamp"`
}

// Notification represents a notification to be sent
type Notification struct {
	ID        string                 `json:"id"`
	UserID    UserID                 `json:"user_id"`
	Type      string                 `json:"type"` // email, sms, push
	Template  string                 `json:"template"`
	Data      map[string]interface{} `json:"data"`
	Status    string                 `json:"status"`
	SentAt    *time.Time             `json:"sent_at,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
}

// WorkflowResult represents a generic workflow result
type WorkflowResult struct {
	Success bool                   `json:"success"`
	Message string                 `json:"message"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Error   string                 `json:"error,omitempty"`
}

// Helper functions

func NewTransactionID() TransactionID {
	return TransactionID(uuid.New().String())
}

func NewUserID() UserID {
	return UserID(uuid.New().String())
}

func NewWalletID() WalletID {
	return WalletID(uuid.New().String())
}
