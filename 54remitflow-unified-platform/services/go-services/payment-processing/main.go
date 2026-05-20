package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

// Payment represents a payment transaction
type Payment struct {
	ID                string    `json:"id" db:"id"`
	PaymentReference  string    `json:"payment_reference" db:"payment_reference"`
	PayerAccountID    string    `json:"payer_account_id" db:"payer_account_id"`
	PayeeAccountID    string    `json:"payee_account_id" db:"payee_account_id"`
	Amount            float64   `json:"amount" db:"amount"`
	Currency          string    `json:"currency" db:"currency"`
	PaymentMethod     string    `json:"payment_method" db:"payment_method"`
	PaymentType       string    `json:"payment_type" db:"payment_type"`
	Description       string    `json:"description" db:"description"`
	Status            string    `json:"status" db:"status"`
	ProcessorResponse string    `json:"processor_response" db:"processor_response"`
	FeeAmount         float64   `json:"fee_amount" db:"fee_amount"`
	NetAmount         float64   `json:"net_amount" db:"net_amount"`
	ExchangeRate      float64   `json:"exchange_rate" db:"exchange_rate"`
	ProcessedAt       *time.Time `json:"processed_at" db:"processed_at"`
	SettledAt         *time.Time `json:"settled_at" db:"settled_at"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
	Metadata          string    `json:"metadata" db:"metadata"`
	RiskScore         float64   `json:"risk_score" db:"risk_score"`
	AgentID           string    `json:"agent_id" db:"agent_id"`
}

// PaymentProcessor represents different payment processors
type PaymentProcessor struct {
	ID              string    `json:"id" db:"id"`
	Name            string    `json:"name" db:"name"`
	Type            string    `json:"type" db:"type"`
	Configuration   string    `json:"configuration" db:"configuration"`
	Status          string    `json:"status" db:"status"`
	SupportedMethods []string  `json:"supported_methods" db:"supported_methods"`
	FeeStructure    string    `json:"fee_structure" db:"fee_structure"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// PaymentRoute represents payment routing rules
type PaymentRoute struct {
	ID              string    `json:"id" db:"id"`
	PaymentMethod   string    `json:"payment_method" db:"payment_method"`
	Currency        string    `json:"currency" db:"currency"`
	AmountRange     string    `json:"amount_range" db:"amount_range"`
	ProcessorID     string    `json:"processor_id" db:"processor_id"`
	Priority        int       `json:"priority" db:"priority"`
	Status          string    `json:"status" db:"status"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// PaymentWebhook represents webhook events
type PaymentWebhook struct {
	ID          string    `json:"id" db:"id"`
	PaymentID   string    `json:"payment_id" db:"payment_id"`
	ProcessorID string    `json:"processor_id" db:"processor_id"`
	EventType   string    `json:"event_type" db:"event_type"`
	Payload     string    `json:"payload" db:"payload"`
	Status      string    `json:"status" db:"status"`
	ProcessedAt *time.Time `json:"processed_at" db:"processed_at"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// PaymentService handles payment operations
type PaymentService struct {
	db      *sql.DB
	redis   *redis.Client
	metrics *PaymentMetrics
}

// PaymentMetrics for monitoring
type PaymentMetrics struct {
	PaymentsProcessed   prometheus.Counter
	PaymentsFailed      prometheus.Counter
	PaymentsSettled     prometheus.Counter
	PaymentAmount       prometheus.Histogram
	ProcessingTime      prometheus.Histogram
	ErrorCount          prometheus.Counter
	WebhookEvents       prometheus.Counter
}

// NewPaymentMetrics creates new metrics
func NewPaymentMetrics() *PaymentMetrics {
	return &PaymentMetrics{
		PaymentsProcessed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "payments_processed_total",
			Help: "Total number of payments processed",
		}),
		PaymentsFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "payments_failed_total",
			Help: "Total number of failed payments",
		}),
		PaymentsSettled: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "payments_settled_total",
			Help: "Total number of settled payments",
		}),
		PaymentAmount: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "payment_amount_distribution",
			Help: "Distribution of payment amounts",
			Buckets: []float64{10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000},
		}),
		ProcessingTime: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "payment_processing_time_seconds",
			Help: "Time taken to process payments",
		}),
		ErrorCount: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "payment_errors_total",
			Help: "Total number of payment processing errors",
		}),
		WebhookEvents: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "payment_webhook_events_total",
			Help: "Total number of webhook events received",
		}),
	}
}

// RegisterMetrics registers metrics with Prometheus
func (m *PaymentMetrics) RegisterMetrics() {
	prometheus.MustRegister(m.PaymentsProcessed)
	prometheus.MustRegister(m.PaymentsFailed)
	prometheus.MustRegister(m.PaymentsSettled)
	prometheus.MustRegister(m.PaymentAmount)
	prometheus.MustRegister(m.ProcessingTime)
	prometheus.MustRegister(m.ErrorCount)
	prometheus.MustRegister(m.WebhookEvents)
}

// NewPaymentService creates a new payment service
func NewPaymentService(db *sql.DB, redis *redis.Client) *PaymentService {
	metrics := NewPaymentMetrics()
	metrics.RegisterMetrics()
	
	return &PaymentService{
		db:      db,
		redis:   redis,
		metrics: metrics,
	}
}

// ProcessPayment processes a payment transaction
func (s *PaymentService) ProcessPayment(ctx context.Context, payment *Payment) error {
	timer := prometheus.NewTimer(s.metrics.ProcessingTime)
	defer timer.ObserveDuration()

	payment.ID = uuid.New().String()
	payment.PaymentReference = s.generatePaymentReference()
	payment.CreatedAt = time.Now()
	payment.UpdatedAt = time.Now()
	payment.Status = "pending"

	// Calculate fees and net amount
	if err := s.calculateFees(payment); err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to calculate fees: %w", err)
	}

	// Validate payment
	if err := s.validatePayment(payment); err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("payment validation failed: %w", err)
	}

	// Route payment to appropriate processor
	processor, err := s.routePayment(ctx, payment)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to route payment: %w", err)
	}

	// Store payment in database
	if err := s.storePayment(ctx, payment); err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to store payment: %w", err)
	}

	// Process with external processor
	if err := s.processWithProcessor(ctx, payment, processor); err != nil {
		s.updatePaymentStatus(ctx, payment.ID, "failed", err.Error())
		s.metrics.PaymentsFailed.Inc()
		return fmt.Errorf("processor failed: %w", err)
	}

	s.metrics.PaymentsProcessed.Inc()
	s.metrics.PaymentAmount.Observe(payment.Amount)
	return nil
}

// GetPayment retrieves a payment by ID
func (s *PaymentService) GetPayment(ctx context.Context, paymentID string) (*Payment, error) {
	// Try cache first
	cached, err := s.redis.Get(ctx, fmt.Sprintf("payment:%s", paymentID)).Result()
	if err == nil {
		var payment Payment
		if json.Unmarshal([]byte(cached), &payment) == nil {
			return &payment, nil
		}
	}

	// Query database
	var payment Payment
	query := `
		SELECT id, payment_reference, payer_account_id, payee_account_id, 
			   amount, currency, payment_method, payment_type, description, 
			   status, processor_response, fee_amount, net_amount, exchange_rate,
			   processed_at, settled_at, created_at, updated_at, metadata, 
			   risk_score, agent_id
		FROM payments WHERE id = $1`

	err = s.db.QueryRowContext(ctx, query, paymentID).Scan(
		&payment.ID, &payment.PaymentReference, &payment.PayerAccountID, &payment.PayeeAccountID,
		&payment.Amount, &payment.Currency, &payment.PaymentMethod, &payment.PaymentType,
		&payment.Description, &payment.Status, &payment.ProcessorResponse, &payment.FeeAmount,
		&payment.NetAmount, &payment.ExchangeRate, &payment.ProcessedAt, &payment.SettledAt,
		&payment.CreatedAt, &payment.UpdatedAt, &payment.Metadata, &payment.RiskScore, &payment.AgentID)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("payment not found")
		}
		s.metrics.ErrorCount.Inc()
		return nil, fmt.Errorf("failed to get payment: %w", err)
	}

	// Cache the result
	paymentJSON, _ := json.Marshal(payment)
	s.redis.Set(ctx, fmt.Sprintf("payment:%s", paymentID), paymentJSON, time.Hour)

	return &payment, nil
}

// GetPaymentsByAccount retrieves payments for an account
func (s *PaymentService) GetPaymentsByAccount(ctx context.Context, accountID string, limit, offset int) ([]Payment, error) {
	query := `
		SELECT id, payment_reference, payer_account_id, payee_account_id, 
			   amount, currency, payment_method, payment_type, description, 
			   status, processor_response, fee_amount, net_amount, exchange_rate,
			   processed_at, settled_at, created_at, updated_at, metadata, 
			   risk_score, agent_id
		FROM payments 
		WHERE payer_account_id = $1 OR payee_account_id = $1
		ORDER BY created_at DESC 
		LIMIT $2 OFFSET $3`

	rows, err := s.db.QueryContext(ctx, query, accountID, limit, offset)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return nil, fmt.Errorf("failed to query payments: %w", err)
	}
	defer rows.Close()

	var payments []Payment
	for rows.Next() {
		var payment Payment
		err := rows.Scan(
			&payment.ID, &payment.PaymentReference, &payment.PayerAccountID, &payment.PayeeAccountID,
			&payment.Amount, &payment.Currency, &payment.PaymentMethod, &payment.PaymentType,
			&payment.Description, &payment.Status, &payment.ProcessorResponse, &payment.FeeAmount,
			&payment.NetAmount, &payment.ExchangeRate, &payment.ProcessedAt, &payment.SettledAt,
			&payment.CreatedAt, &payment.UpdatedAt, &payment.Metadata, &payment.RiskScore, &payment.AgentID)
		if err != nil {
			s.metrics.ErrorCount.Inc()
			return nil, fmt.Errorf("failed to scan payment: %w", err)
		}
		payments = append(payments, payment)
	}

	return payments, nil
}

// ProcessWebhook processes webhook events from payment processors
func (s *PaymentService) ProcessWebhook(ctx context.Context, webhook *PaymentWebhook) error {
	webhook.ID = uuid.New().String()
	webhook.CreatedAt = time.Now()
	webhook.Status = "received"

	// Store webhook
	query := `
		INSERT INTO payment_webhooks (id, payment_id, processor_id, event_type, payload, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`

	_, err := s.db.ExecContext(ctx, query,
		webhook.ID, webhook.PaymentID, webhook.ProcessorID, webhook.EventType,
		webhook.Payload, webhook.Status, webhook.CreatedAt)
	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to store webhook: %w", err)
	}

	// Process webhook based on event type
	switch webhook.EventType {
	case "payment.completed":
		err = s.updatePaymentStatus(ctx, webhook.PaymentID, "completed", "Payment completed successfully")
		if err == nil {
			s.metrics.PaymentsSettled.Inc()
		}
	case "payment.failed":
		err = s.updatePaymentStatus(ctx, webhook.PaymentID, "failed", "Payment failed")
		if err == nil {
			s.metrics.PaymentsFailed.Inc()
		}
	case "payment.refunded":
		err = s.updatePaymentStatus(ctx, webhook.PaymentID, "refunded", "Payment refunded")
	}

	if err != nil {
		s.metrics.ErrorCount.Inc()
		return fmt.Errorf("failed to process webhook: %w", err)
	}

	// Mark webhook as processed
	now := time.Now()
	webhook.ProcessedAt = &now
	webhook.Status = "processed"

	_, err = s.db.ExecContext(ctx,
		"UPDATE payment_webhooks SET status = $1, processed_at = $2 WHERE id = $3",
		webhook.Status, webhook.ProcessedAt, webhook.ID)

	s.metrics.WebhookEvents.Inc()
	return err
}

// Helper methods

func (s *PaymentService) generatePaymentReference() string {
	timestamp := time.Now().Unix()
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d-%s", timestamp, uuid.New().String())))
	return fmt.Sprintf("PAY%s", hex.EncodeToString(hash[:4]))
}

func (s *PaymentService) calculateFees(payment *Payment) error {
	// Simple fee calculation - 1% of amount, minimum 1.00
	feeRate := 0.01
	payment.FeeAmount = payment.Amount * feeRate
	if payment.FeeAmount < 1.00 {
		payment.FeeAmount = 1.00
	}
	payment.NetAmount = payment.Amount - payment.FeeAmount
	payment.ExchangeRate = 1.0 // Default for same currency
	return nil
}

func (s *PaymentService) validatePayment(payment *Payment) error {
	if payment.Amount <= 0 {
		return fmt.Errorf("invalid payment amount")
	}
	if payment.PayerAccountID == "" || payment.PayeeAccountID == "" {
		return fmt.Errorf("missing account information")
	}
	if payment.Currency == "" {
		return fmt.Errorf("missing currency")
	}
	return nil
}

func (s *PaymentService) routePayment(ctx context.Context, payment *Payment) (*PaymentProcessor, error) {
	// Simple routing - return default processor
	processor := &PaymentProcessor{
		ID:   "default-processor",
		Name: "Default Payment Processor",
		Type: "internal",
	}
	return processor, nil
}

func (s *PaymentService) storePayment(ctx context.Context, payment *Payment) error {
	query := `
		INSERT INTO payments (
			id, payment_reference, payer_account_id, payee_account_id, amount, 
			currency, payment_method, payment_type, description, status, 
			fee_amount, net_amount, exchange_rate, created_at, updated_at, 
			metadata, risk_score, agent_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`

	_, err := s.db.ExecContext(ctx, query,
		payment.ID, payment.PaymentReference, payment.PayerAccountID, payment.PayeeAccountID,
		payment.Amount, payment.Currency, payment.PaymentMethod, payment.PaymentType,
		payment.Description, payment.Status, payment.FeeAmount, payment.NetAmount,
		payment.ExchangeRate, payment.CreatedAt, payment.UpdatedAt, payment.Metadata,
		payment.RiskScore, payment.AgentID)

	return err
}

func (s *PaymentService) processWithProcessor(ctx context.Context, payment *Payment, processor *PaymentProcessor) error {
	// Simulate processing delay
	time.Sleep(100 * time.Millisecond)
	
	// Update payment status
	now := time.Now()
	payment.ProcessedAt = &now
	payment.Status = "processing"
	
	return s.updatePaymentStatus(ctx, payment.ID, "processing", "Payment submitted to processor")
}

func (s *PaymentService) updatePaymentStatus(ctx context.Context, paymentID, status, response string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		"UPDATE payments SET status = $1, processor_response = $2, updated_at = $3 WHERE id = $4",
		status, response, now, paymentID)
	
	if err == nil {
		// Invalidate cache
		s.redis.Del(ctx, fmt.Sprintf("payment:%s", paymentID))
	}
	
	return err
}

// HTTP Handlers

func (s *PaymentService) ProcessPaymentHandler(w http.ResponseWriter, r *http.Request) {
	var payment Payment
	if err := json.NewDecoder(r.Body).Decode(&payment); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.ProcessPayment(r.Context(), &payment); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payment)
}

func (s *PaymentService) GetPaymentHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	paymentID := vars["id"]

	payment, err := s.GetPayment(r.Context(), paymentID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payment)
}

func (s *PaymentService) GetAccountPaymentsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	accountID := vars["account_id"]

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 50
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	payments, err := s.GetPaymentsByAccount(r.Context(), accountID, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payments)
}

func (s *PaymentService) WebhookHandler(w http.ResponseWriter, r *http.Request) {
	var webhook PaymentWebhook
	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.ProcessWebhook(r.Context(), &webhook); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "processed"})
}

func (s *PaymentService) HealthHandler(w http.ResponseWriter, r *http.Request) {
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
		"service":   "payment-processing",
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

	// Create payment service
	paymentService := NewPaymentService(db, rdb)

	// Setup routes
	r := mux.NewRouter()
	
	// Payment routes
	r.HandleFunc("/payments", paymentService.ProcessPaymentHandler).Methods("POST")
	r.HandleFunc("/payments/{id}", paymentService.GetPaymentHandler).Methods("GET")
	r.HandleFunc("/accounts/{account_id}/payments", paymentService.GetAccountPaymentsHandler).Methods("GET")
	r.HandleFunc("/webhooks/payments", paymentService.WebhookHandler).Methods("POST")
	
	// Health and metrics
	r.HandleFunc("/health", paymentService.HealthHandler).Methods("GET")
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
		port = "8081"
	}

	log.Printf("Payment Processing Service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

