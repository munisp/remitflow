package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
)

type Service struct {
	Name      string
	Version   string
	StartTime time.Time

	mu       sync.RWMutex
	accounts map[uint64]*TBAccount
	transfers map[uint64]*TBTransfer

	requestsTotal   int64
	requestsSuccess int64
	requestsFailed  int64
}

type TBAccount struct {
	ID             uint64 `json:"id"`
	UserData       uint64 `json:"user_data"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
	Timestamp      int64  `json:"timestamp"`
}

type TBTransfer struct {
	ID              uint64 `json:"id"`
	DebitAccountID  uint64 `json:"debit_account_id"`
	CreditAccountID uint64 `json:"credit_account_id"`
	UserData        uint64 `json:"user_data"`
	PendingID       uint64 `json:"pending_id"`
	Timeout         uint64 `json:"timeout"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
	Amount          uint64 `json:"amount"`
	Timestamp       int64  `json:"timestamp"`
}

type HealthResponse struct {
	Status    string    `json:"status"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
	Uptime    string    `json:"uptime"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func main() {
	service := &Service{
		Name:      "tigerbeetle-core",
		Version:   "1.0.0",
		StartTime: time.Now(),
		accounts:  make(map[uint64]*TBAccount),
		transfers: make(map[uint64]*TBTransfer),
	}

	router := mux.NewRouter()

	router.HandleFunc("/health", service.healthHandler).Methods("GET")
	router.HandleFunc("/", service.rootHandler).Methods("GET")
	router.HandleFunc("/api/v1/status", service.statusHandler).Methods("GET")
	router.HandleFunc("/api/v1/metrics", service.metricsHandler).Methods("GET")

	router.HandleFunc("/api/v1/accounts", service.createAccountHandler).Methods("POST")
	router.HandleFunc("/api/v1/accounts/{id}", service.getAccountHandler).Methods("GET")
	router.HandleFunc("/api/v1/accounts/{id}/balance", service.getBalanceHandler).Methods("GET")
	router.HandleFunc("/api/v1/transfers", service.createTransferHandler).Methods("POST")
	router.HandleFunc("/api/v1/transfers/{id}", service.getTransferHandler).Methods("GET")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting %s on port %s\n", service.Name, port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}

func (s *Service) healthHandler(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	accountCount := len(s.accounts)
	transferCount := len(s.transfers)
	s.mu.RUnlock()

	response := map[string]interface{}{
		"status":          "healthy",
		"service":         s.Name,
		"timestamp":       time.Now(),
		"uptime":          time.Since(s.StartTime).String(),
		"accounts_count":  accountCount,
		"transfers_count": transferCount,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) rootHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"service":     s.Name,
		"version":     s.Version,
		"description": "TigerBeetle core accounting service",
		"status":      "running",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) statusHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"service": s.Name,
		"status":  "operational",
		"uptime":  time.Since(s.StartTime).String(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) metricsHandler(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	accountCount := len(s.accounts)
	transferCount := len(s.transfers)
	s.mu.RUnlock()

	metrics := map[string]interface{}{
		"requests_total":    atomic.LoadInt64(&s.requestsTotal),
		"requests_success":  atomic.LoadInt64(&s.requestsSuccess),
		"requests_failed":   atomic.LoadInt64(&s.requestsFailed),
		"accounts_total":    accountCount,
		"transfers_total":   transferCount,
		"uptime_seconds":    int(time.Since(s.StartTime).Seconds()),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func (s *Service) createAccountHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&s.requestsTotal, 1)

	var accounts []TBAccount
	if err := json.NewDecoder(r.Body).Decode(&accounts); err != nil {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid_request", Message: err.Error()})
		return
	}

	s.mu.Lock()
	for i := range accounts {
		accounts[i].Timestamp = time.Now().UnixNano()
		s.accounts[accounts[i].ID] = &accounts[i]
	}
	s.mu.Unlock()

	atomic.AddInt64(&s.requestsSuccess, 1)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"accounts_created": len(accounts),
	})
}

func (s *Service) getAccountHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&s.requestsTotal, 1)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid_id", Message: "account ID must be numeric"})
		return
	}

	s.mu.RLock()
	account, exists := s.accounts[id]
	s.mu.RUnlock()

	if !exists {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "not_found", Message: fmt.Sprintf("account %d not found", id)})
		return
	}

	atomic.AddInt64(&s.requestsSuccess, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

func (s *Service) getBalanceHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&s.requestsTotal, 1)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid_id", Message: "account ID must be numeric"})
		return
	}

	s.mu.RLock()
	account, exists := s.accounts[id]
	s.mu.RUnlock()

	if !exists {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "not_found", Message: fmt.Sprintf("account %d not found", id)})
		return
	}

	balance := int64(account.CreditsPosted) - int64(account.DebitsPosted)
	available := balance - int64(account.CreditsPending) + int64(account.DebitsPending)

	atomic.AddInt64(&s.requestsSuccess, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"account_id":        account.ID,
		"debits_pending":    account.DebitsPending,
		"debits_posted":     account.DebitsPosted,
		"credits_pending":   account.CreditsPending,
		"credits_posted":    account.CreditsPosted,
		"balance":           balance,
		"available_balance": available,
	})
}

func (s *Service) createTransferHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&s.requestsTotal, 1)

	var transfers []TBTransfer
	if err := json.NewDecoder(r.Body).Decode(&transfers); err != nil {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid_request", Message: err.Error()})
		return
	}

	s.mu.Lock()
	for i := range transfers {
		transfers[i].Timestamp = time.Now().UnixNano()
		s.transfers[transfers[i].ID] = &transfers[i]

		debit, dOk := s.accounts[transfers[i].DebitAccountID]
		credit, cOk := s.accounts[transfers[i].CreditAccountID]
		if dOk {
			debit.DebitsPosted += transfers[i].Amount
		}
		if cOk {
			credit.CreditsPosted += transfers[i].Amount
		}
	}
	s.mu.Unlock()

	atomic.AddInt64(&s.requestsSuccess, 1)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"transfers_created": len(transfers),
	})
}

func (s *Service) getTransferHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&s.requestsTotal, 1)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid_id", Message: "transfer ID must be numeric"})
		return
	}

	s.mu.RLock()
	transfer, exists := s.transfers[id]
	s.mu.RUnlock()

	if !exists {
		atomic.AddInt64(&s.requestsFailed, 1)
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "not_found", Message: fmt.Sprintf("transfer %d not found", id)})
		return
	}

	atomic.AddInt64(&s.requestsSuccess, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(transfer)
}
