package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

// Account represents a banking account
type Account struct {
	ID              string    `json:"id" db:"id"`
	CustomerID      string    `json:"customer_id" db:"customer_id"`
	AgentID         string    `json:"agent_id" db:"agent_id"`
	AccountNumber   string    `json:"account_number" db:"account_number"`
	AccountType     string    `json:"account_type" db:"account_type"`
	Currency        string    `json:"currency" db:"currency"`
	Balance         float64   `json:"balance" db:"balance"`
	AvailableBalance float64  `json:"available_balance" db:"available_balance"`
	Status          string    `json:"status" db:"status"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
	LastTransaction time.Time `json:"last_transaction" db:"last_transaction"`
	DailyLimit      float64   `json:"daily_limit" db:"daily_limit"`
	MonthlyLimit    float64   `json:"monthly_limit" db:"monthly_limit"`
	KYCLevel        string    `json:"kyc_level" db:"kyc_level"`
	RiskScore       float64   `json:"risk_score" db:"risk_score"`
}

// AccountTransaction represents account transaction history
type AccountTransaction struct {
	ID              string    `json:"id" db:"id"`
	AccountID       string    `json:"account_id" db:"account_id"`
	TransactionID   string    `json:"transaction_id" db:"transaction_id"`
	Type            string    `json:"type" db:"type"`
	Amount          float64   `json:"amount" db:"amount"`
	BalanceBefore   float64   `json:"balance_before" db:"balance_before"`
	BalanceAfter    float64   `json:"balance_after" db:"balance_after"`
	Description     string    `json:"description" db:"description"`
	Reference       string    `json:"reference" db:"reference"`
	Status          string    `json:"status" db:"status"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	ProcessedAt     *time.Time `json:"processed_at" db:"processed_at"`
}

// AccountLimit represents account limits and restrictions
type AccountLimit struct {
	ID              string    `json:"id" db:"id"`
	AccountID       string    `json:"account_id" db:"account_id"`
	LimitType       string    `json:"limit_type" db:"limit_type"`
	LimitAmount     float64   `json:"limit_amount" db:"limit_amount"`
	UsedAmount      float64   `json:"used_amount" db:"used_amount"`
	ResetPeriod     string    `json:"reset_period" db:"reset_period"`
	LastReset       time.Time `json:"last_reset" db:"last_reset"`
	NextReset       time.Time `json:"next_reset" db:"next_reset"`
	Status          string    `json:"status" db:"status"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// AccountService handles account operations
type AccountService struct {
	db          *sql.DB
	redis       *redis.Client
	metrics     *AccountMetrics
}

// AccountMetrics for monitoring
type AccountMetrics struct {
	AccountsCreated    prometheus.Counter
	AccountsUpdated    prometheus.Counter
	BalanceUpdates     prometheus.Counter
	TransactionCount   prometheus.Counter
	ErrorCount         prometheus.Counter
	ResponseTime       prometheus.Histogram
}

// NewAccountMetrics creates new metrics
func NewAccountMetrics() *AccountMetrics {
	return &AccountMetrics{
		AccountsCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "accounts_created_total",
			Help: "Total number of accounts created",
		}),
		AccountsUpdated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "accounts_updated_total",
			Help: "Total number of accounts updated",
		}),
		BalanceUpdates: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "balance_updates_total",
			Help: "Total number of balance updates",
		}),
		TransactionCount: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "account_transactions_total",
			Help: "Total number of account transactions",
		}),
		ErrorCount: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "account_errors_total",
			Help: "Total number of account service errors",
		}),
		ResponseTime: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "account_response_time_seconds",
			Help: "Response time for account operations",
		}),
	}
}

// RegisterMetrics registers metrics with Prometheus
func (m *AccountMetrics) RegisterMetrics() {
	prometheus.MustRegister(m.AccountsCreated)
	prometheus.MustRegister(m.AccountsUpdated)
	prometheus.MustRegister(m.BalanceUpdates)
	prometheus.MustRegister(m.TransactionCount)
	prometheus.MustRegister(m.ErrorCount)
	prometheus.MustRegister(m.ResponseTime)
}

// NewAccountService creates a new account service
func NewAccountService(db *sql.DB, redis *redis.Client) *AccountService {
	metrics := NewAccountMetrics()
	metrics.RegisterMetrics()
	
	return &AccountService{
		db:      db,
		redis:   redis,
		metrics: metrics,
	}
}

// CreateAccount creates a new account
func (s *AccountService) CreateAccount(ctx context.Context, account *Account) error {
	timer := prometheus.NewTimer(s.metrics.ResponseTime)
	defer timer.ObserveDuration()

	account.ID = uuid.New().String()
	account.AccountNumber = s.generateAccountNumber()
	account.CreatedAt = time.Now()
	account.UpdatedAt = time.Now()
	account.Status = "active"

	query := `
		INSERT INTO accounts (
			id, customer_id, agent_id, account_number, account_type, 
			currency, balance, available_balance, status, created_at, 
			updated_at, daily_limit, monthly_limit, kyc_level, risk_score
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`

	_, err := s.db.ExecContext(ctx, query,
		account.ID, account.CustomerID, account.AgentID, account.AccountNumber,
		account.AccountType, account.Currency, account.Balance, account.AvailableBalance,
		account.Status, account.CreatedAt, account.UpdatedAt, account.DailyLimit,
		account.MonthlyLimit, account.KYCLevel, account.RiskScore)

	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to create account: %w", err)
	}

	// Cache account data
	accountJSON, _ := json.Marshal(account)
	s.redis.Set(ctx, fmt.Sprintf("account:%s", account.ID), accountJSON, time.Hour)

	s.metrics.AccountsCreated.Inc()
	return nil
}

// GetAccount retrieves an account by ID
func (s *AccountService) GetAccount(ctx context.Context, accountID string) (*Account, error) {
	timer := prometheus.NewTimer(s.metrics.ResponseTime)
	defer timer.ObserveDuration()

	// Try cache first
	cached, err := s.redis.Get(ctx, fmt.Sprintf("account:%s", accountID)).Result()
	if err == nil {
		var account Account
		if json.Unmarshal([]byte(cached), &account) == nil {
			return &account, nil
		}
	}

	// Query database
	var account Account
	query := `
		SELECT id, customer_id, agent_id, account_number, account_type, 
			   currency, balance, available_balance, status, created_at, 
			   updated_at, COALESCE(last_transaction, created_at), 
			   daily_limit, monthly_limit, kyc_level, risk_score
		FROM accounts WHERE id = $1`

	err = s.db.QueryRowContext(ctx, query, accountID).Scan(
		&account.ID, &account.CustomerID, &account.AgentID, &account.AccountNumber,
		&account.AccountType, &account.Currency, &account.Balance, &account.AvailableBalance,
		&account.Status, &account.CreatedAt, &account.UpdatedAt, &account.LastTransaction,
		&account.DailyLimit, &account.MonthlyLimit, &account.KYCLevel, &account.RiskScore)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("account not found")
		}
		s.metrics.ErrorCount.Inc()
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	// Cache the result
	accountJSON, _ := json.Marshal(account)
	s.redis.Set(ctx, fmt.Sprintf("account:%s", accountID), accountJSON, time.Hour)

	return &account, nil
}

// UpdateBalance updates account balance
func (s *AccountService) UpdateBalance(ctx context.Context, accountID string, amount float64, transactionType string) error {
	timer := prometheus.NewTimer(s.metrics.ResponseTime)
	defer timer.ObserveDuration()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Get current balance
	var currentBalance, availableBalance float64
	err = tx.QueryRowContext(ctx, 
		"SELECT balance, available_balance FROM accounts WHERE id = $1 FOR UPDATE", 
		accountID).Scan(&currentBalance, &availableBalance)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to get current balance: %w", err)
	}

	// Calculate new balance
	var newBalance, newAvailableBalance float64
	switch transactionType {
	case "credit":
		newBalance = currentBalance + amount
		newAvailableBalance = availableBalance + amount
	case "debit":
		if availableBalance < amount {
			return fmt.Errorf("insufficient funds")
		}
		newBalance = currentBalance - amount
		newAvailableBalance = availableBalance - amount
	case "hold":
		if availableBalance < amount {
			return fmt.Errorf("insufficient funds for hold")
		}
		newBalance = currentBalance
		newAvailableBalance = availableBalance - amount
	case "release_hold":
		newBalance = currentBalance
		newAvailableBalance = availableBalance + amount
	default:
		return fmt.Errorf("invalid transaction type: %s", transactionType)
	}

	// Update balance
	_, err = tx.ExecContext(ctx,
		"UPDATE accounts SET balance = $1, available_balance = $2, updated_at = $3, last_transaction = $4 WHERE id = $5",
		newBalance, newAvailableBalance, time.Now(), time.Now(), accountID)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to update balance: %w", err)
	}

	if err = tx.Commit(); err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Invalidate cache
	s.redis.Del(ctx, fmt.Sprintf("account:%s", accountID))

	s.metrics.BalanceUpdates.Inc()
	return nil
}

// GetAccountsByCustomer retrieves accounts for a customer
func (s *AccountService) GetAccountsByCustomer(ctx context.Context, customerID string) ([]Account, error) {
	timer := prometheus.NewTimer(s.metrics.ResponseTime)
	defer timer.ObserveDuration()

	query := `
		SELECT id, customer_id, agent_id, account_number, account_type, 
			   currency, balance, available_balance, status, created_at, 
			   updated_at, COALESCE(last_transaction, created_at), 
			   daily_limit, monthly_limit, kyc_level, risk_score
		FROM accounts WHERE customer_id = $1 ORDER BY created_at DESC`

	rows, err := s.db.QueryContext(ctx, query, customerID)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return nil, fmt.Errorf("failed to query accounts: %w", err)
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var account Account
		err := rows.Scan(
			&account.ID, &account.CustomerID, &account.AgentID, &account.AccountNumber,
			&account.AccountType, &account.Currency, &account.Balance, &account.AvailableBalance,
			&account.Status, &account.CreatedAt, &account.UpdatedAt, &account.LastTransaction,
			&account.DailyLimit, &account.MonthlyLimit, &account.KYCLevel, &account.RiskScore)
		if err != nil {
			s.metrics.ErrorCount.Inc()
			return nil, fmt.Errorf("failed to scan account: %w", err)
		}
		accounts = append(accounts, account)
	}

	return accounts, nil
}

// GetAccountTransactions retrieves transaction history for an account
func (s *AccountService) GetAccountTransactions(ctx context.Context, accountID string, limit, offset int) ([]AccountTransaction, error) {
	timer := prometheus.NewTimer(s.metrics.ResponseTime)
	defer timer.ObserveDuration()

	query := `
		SELECT id, account_id, transaction_id, type, amount, balance_before, 
			   balance_after, description, reference, status, created_at, processed_at
		FROM account_transactions 
		WHERE account_id = $1 
		ORDER BY created_at DESC 
		LIMIT $2 OFFSET $3`

	rows, err := s.db.QueryContext(ctx, query, accountID, limit, offset)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return nil, fmt.Errorf("failed to query transactions: %w", err)
	}
	defer rows.Close()

	var transactions []AccountTransaction
	for rows.Next() {
		var transaction AccountTransaction
		err := rows.Scan(
			&transaction.ID, &transaction.AccountID, &transaction.TransactionID,
			&transaction.Type, &transaction.Amount, &transaction.BalanceBefore,
			&transaction.BalanceAfter, &transaction.Description, &transaction.Reference,
			&transaction.Status, &transaction.CreatedAt, &transaction.ProcessedAt)
		if err != nil {
			s.metrics.ErrorCount.Inc()
			return nil, fmt.Errorf("failed to scan transaction: %w", err)
		}
		transactions = append(transactions, transaction)
	}

	return transactions, nil
}

// generateAccountNumber generates a unique account number
func (s *AccountService) generateAccountNumber() string {
	// Generate 10-digit account number
	timestamp := time.Now().Unix()
	return fmt.Sprintf("ACC%d", timestamp%10000000000)
}

// HTTP Handlers

// CreateAccountHandler handles account creation requests
func (s *AccountService) CreateAccountHandler(w http.ResponseWriter, r *http.Request) {
	var account Account
	if err := json.NewDecoder(r.Body).Decode(&account); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.CreateAccount(r.Context(), &account); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

// GetAccountHandler handles account retrieval requests
func (s *AccountService) GetAccountHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	accountID := vars["id"]

	account, err := s.GetAccount(r.Context(), accountID)
	if err != nil {
		if err.Error() == "account not found" {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

// UpdateBalanceHandler handles balance update requests
func (s *AccountService) UpdateBalanceHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	accountID := vars["id"]

	var request struct {
		Amount          float64 `json:"amount"`
		TransactionType string  `json:"transaction_type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.UpdateBalance(r.Context(), accountID, request.Amount, request.TransactionType); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// GetCustomerAccountsHandler handles customer accounts retrieval
func (s *AccountService) GetCustomerAccountsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["customer_id"]

	accounts, err := s.GetAccountsByCustomer(r.Context(), customerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accounts)
}

// GetAccountTransactionsHandler handles account transactions retrieval
func (s *AccountService) GetAccountTransactionsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	accountID := vars["id"]

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 50
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	transactions, err := s.GetAccountTransactions(r.Context(), accountID, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(transactions)
}

// HealthHandler handles health check requests
func (s *AccountService) HealthHandler(w http.ResponseWriter, r *http.Request) {
	// Check database connection
	if err := s.db.Ping(); err != nil {
		http.Error(w, "Database connection failed", http.StatusServiceUnavailable)
		return
	}

	// Check Redis connection
	if err := s.redis.Ping(r.Context()).Err(); err != nil {
		http.Error(w, "Redis connection failed", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "healthy",
		"service":   "account-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func main() {
	// Database connection
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:password@localhost/remittance?sslmode=disable"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	// Redis connection
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr: redisURL,
	})

	// Create account service
	accountService := NewAccountService(db, rdb)

	// Setup routes
	r := mux.NewRouter()
	
	// Account routes
	r.HandleFunc("/accounts", accountService.CreateAccountHandler).Methods("POST")
	r.HandleFunc("/accounts/{id}", accountService.GetAccountHandler).Methods("GET")
	r.HandleFunc("/accounts/{id}/balance", accountService.UpdateBalanceHandler).Methods("PUT")
	r.HandleFunc("/accounts/{id}/transactions", accountService.GetAccountTransactionsHandler).Methods("GET")
	r.HandleFunc("/customers/{customer_id}/accounts", accountService.GetCustomerAccountsHandler).Methods("GET")
	
	// Health and metrics
	r.HandleFunc("/health", accountService.HealthHandler).Methods("GET")
	r.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// CORS middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			
			next.ServeHTTP(w, r)
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Account Service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

