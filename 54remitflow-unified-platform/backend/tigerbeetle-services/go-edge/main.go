package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Account represents a TigerBeetle account
type Account struct {
	ID             uint64    `json:"id"`
	UserData       uint64    `json:"user_data"`
	Ledger         uint32    `json:"ledger"`
	Code           uint16    `json:"code"`
	Flags          uint16    `json:"flags"`
	DebitsPending  uint64    `json:"debits_pending"`
	DebitsPosted   uint64    `json:"debits_posted"`
	CreditsPending uint64    `json:"credits_pending"`
	CreditsPosted  uint64    `json:"credits_posted"`
	Timestamp      time.Time `json:"timestamp"`
}

// Transfer represents a TigerBeetle transfer (transaction)
type Transfer struct {
	ID              uint64    `json:"id"`
	DebitAccountID  uint64    `json:"debit_account_id"`
	CreditAccountID uint64    `json:"credit_account_id"`
	UserData        uint64    `json:"user_data"`
	PendingID       uint64    `json:"pending_id"`
	Timeout         uint64    `json:"timeout"`
	Ledger          uint32    `json:"ledger"`
	Code            uint16    `json:"code"`
	Flags           uint16    `json:"flags"`
	Amount          uint64    `json:"amount"`
	Timestamp       time.Time `json:"timestamp"`
}

// TigerBeetleEngine represents the in-memory accounting engine
type TigerBeetleEngine struct {
	accounts  map[uint64]*Account
	transfers []Transfer
	mutex     sync.RWMutex
}

// NewTigerBeetleEngine creates a new TigerBeetle engine instance
func NewTigerBeetleEngine() *TigerBeetleEngine {
	return &TigerBeetleEngine{
		accounts:  make(map[uint64]*Account),
		transfers: make([]Transfer, 0),
	}
}

// CreateAccount creates a new account
func (tb *TigerBeetleEngine) CreateAccount(account Account) error {
	tb.mutex.Lock()
	defer tb.mutex.Unlock()

	if _, exists := tb.accounts[account.ID]; exists {
		return fmt.Errorf("account %d already exists", account.ID)
	}

	account.Timestamp = time.Now()
	tb.accounts[account.ID] = &account
	return nil
}

// GetAccount retrieves an account by ID
func (tb *TigerBeetleEngine) GetAccount(id uint64) (*Account, error) {
	tb.mutex.RLock()
	defer tb.mutex.RUnlock()

	account, exists := tb.accounts[id]
	if !exists {
		return nil, fmt.Errorf("account %d not found", id)
	}

	return account, nil
}

// CreateTransfer processes a transfer between accounts
func (tb *TigerBeetleEngine) CreateTransfer(transfer Transfer) error {
	tb.mutex.Lock()
	defer tb.mutex.Unlock()

	// Validate accounts exist
	debitAccount, exists := tb.accounts[transfer.DebitAccountID]
	if !exists {
		return fmt.Errorf("debit account %d not found", transfer.DebitAccountID)
	}

	creditAccount, exists := tb.accounts[transfer.CreditAccountID]
	if !exists {
		return fmt.Errorf("credit account %d not found", transfer.CreditAccountID)
	}

	// Process the transfer
	debitAccount.DebitsPosted += transfer.Amount
	creditAccount.CreditsPosted += transfer.Amount

	// Record the transfer
	transfer.Timestamp = time.Now()
	tb.transfers = append(tb.transfers, transfer)

	return nil
}

// GetBalance calculates the balance for an account
func (tb *TigerBeetleEngine) GetBalance(accountID uint64) (int64, error) {
	tb.mutex.RLock()
	defer tb.mutex.RUnlock()

	account, exists := tb.accounts[accountID]
	if !exists {
		return 0, fmt.Errorf("account %d not found", accountID)
	}

	balance := int64(account.DebitsPosted) - int64(account.CreditsPosted)
	return balance, nil
}

// GetStats returns engine statistics
func (tb *TigerBeetleEngine) GetStats() map[string]interface{} {
	tb.mutex.RLock()
	defer tb.mutex.RUnlock()

	totalDebits := uint64(0)
	totalCredits := uint64(0)

	for _, account := range tb.accounts {
		totalDebits += account.DebitsPosted
		totalCredits += account.CreditsPosted
	}

	return map[string]interface{}{
		"total_accounts":  len(tb.accounts),
		"total_transfers": len(tb.transfers),
		"total_debits":    totalDebits,
		"total_credits":   totalCredits,
		"balanced":        totalDebits == totalCredits,
		"timestamp":       time.Now(),
	}
}

// Global engine instance
var engine = NewTigerBeetleEngine()

// HTTP Handlers

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":    "healthy",
		"service":   "TigerBeetle Go Edge Service",
		"timestamp": time.Now(),
		"version":   "1.0.0",
	}
	json.NewEncoder(w).Encode(response)
}

func createAccountHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var account Account
	if err := json.NewDecoder(r.Body).Decode(&account); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := engine.CreateAccount(account); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "success",
		"account_id": account.ID,
		"message":    "Account created successfully",
	})
}

func getAccountHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "Account ID required", http.StatusBadRequest)
		return
	}

	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	account, err := engine.GetAccount(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

func createTransferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var transfer Transfer
	if err := json.NewDecoder(r.Body).Decode(&transfer); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := engine.CreateTransfer(transfer); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "success",
		"transfer_id": transfer.ID,
		"message":     "Transfer processed successfully",
	})
}

func getBalanceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "Account ID required", http.StatusBadRequest)
		return
	}

	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	balance, err := engine.GetBalance(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"account_id": id,
		"balance":    balance,
		"timestamp":  time.Now(),
	})
}

func getStatsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stats := engine.GetStats()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// CORS middleware
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func main() {
	// Initialize with some sample accounts for testing
	sampleAccounts := []Account{
		{ID: 1, Ledger: 1000, Code: 100, Flags: 0},
		{ID: 2, Ledger: 1000, Code: 100, Flags: 0},
		{ID: 3, Ledger: 2000, Code: 300, Flags: 0}, // Agent account
	}

	for _, account := range sampleAccounts {
		if err := engine.CreateAccount(account); err != nil {
			log.Printf("Warning: Could not create sample account %d: %v", account.ID, err)
		}
	}

	// Setup routes
	http.HandleFunc("/health", corsMiddleware(healthHandler))
	http.HandleFunc("/accounts", corsMiddleware(createAccountHandler))
	http.HandleFunc("/account", corsMiddleware(getAccountHandler))
	http.HandleFunc("/transfers", corsMiddleware(createTransferHandler))
	http.HandleFunc("/balance", corsMiddleware(getBalanceHandler))
	http.HandleFunc("/stats", corsMiddleware(getStatsHandler))

	// Start server
	port := "8095"
	log.Printf("🚀 TigerBeetle Go Edge Service starting on port %s", port)
	log.Printf("📊 Health check: http://localhost:%s/health", port)
	log.Printf("📈 Statistics: http://localhost:%s/stats", port)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}

