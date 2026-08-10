// direct-debit-service — Direct Debit Mandate Management
// Supports: BACS Direct Debit (UK), SEPA Direct Debit (EU), ACH Debit (US)
// Integrates: Kafka, Temporal (collection workflows), TigerBeetle, Redis, APISix
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────────
// Domain Models
// ─────────────────────────────────────────────────────────────────────────────

type DDScheme string

const (
	BACS DDScheme = "BACS"
	SEPA DDScheme = "SEPA_CORE"
	ACH  DDScheme = "ACH"
)

type MandateStatus string

const (
	MandatePending   MandateStatus = "pending"
	MandateActive    MandateStatus = "active"
	MandateSuspended MandateStatus = "suspended"
	MandateCancelled MandateStatus = "cancelled"
	MandateExpired   MandateStatus = "expired"
)

type CollectionStatus string

const (
	CollectionPending   CollectionStatus = "pending"
	CollectionSubmitted CollectionStatus = "submitted"
	CollectionSucceeded CollectionStatus = "succeeded"
	CollectionFailed    CollectionStatus = "failed"
	CollectionReturned  CollectionStatus = "returned"
)

type DirectDebitMandate struct {
	ID              string        `json:"id"`
	UserID          string        `json:"user_id" binding:"required"`
	AccountName     string        `json:"account_name" binding:"required"`
	AccountNumber   string        `json:"account_number" binding:"required"`
	SortCode        string        `json:"sort_code,omitempty"` // UK BACS
	IBAN            string        `json:"iban,omitempty"`      // SEPA
	BIC             string        `json:"bic,omitempty"`       // SEPA
	RoutingNumber   string        `json:"routing_number,omitempty"` // ACH
	Scheme          DDScheme      `json:"scheme" binding:"required"`
	Reference       string        `json:"reference"`
	Status          MandateStatus `json:"status"`
	MaxAmount       float64       `json:"max_amount,omitempty"`
	Currency        string        `json:"currency"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
	ActivatedAt     *time.Time    `json:"activated_at,omitempty"`
	CancelledAt     *time.Time    `json:"cancelled_at,omitempty"`
	CancellationReason string     `json:"cancellation_reason,omitempty"`
}

type DDCollection struct {
	ID          string           `json:"id"`
	MandateID   string           `json:"mandate_id" binding:"required"`
	Amount      float64          `json:"amount" binding:"required"`
	Currency    string           `json:"currency" binding:"required"`
	Description string           `json:"description"`
	Status      CollectionStatus `json:"status"`
	SubmittedAt *time.Time       `json:"submitted_at,omitempty"`
	SettledAt   *time.Time       `json:"settled_at,omitempty"`
	FailedAt    *time.Time       `json:"failed_at,omitempty"`
	FailureCode string           `json:"failure_code,omitempty"`
	FailureReason string         `json:"failure_reason,omitempty"`
	ReturnCode  string           `json:"return_code,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
}

// BACS failure codes
var BACSFailureCodes = map[string]string{
	"0": "Instruction cancelled",
	"1": "No instruction",
	"2": "Payer deceased",
	"3": "Account transferred",
	"4": "Advance notice disputed",
	"5": "No account",
	"6": "No instruction",
	"7": "Amount differs",
	"8": "Amount not yet due",
	"9": "Presentation overdue",
	"A": "Service user differs",
	"B": "Account closed",
	"C": "Refer to payer",
	"D": "Instruction cancelled by payer",
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store
// ─────────────────────────────────────────────────────────────────────────────
var (
	mu          sync.RWMutex
	mandates    = make(map[string]*DirectDebitMandate)
	collections = make(map[string]*DDCollection)
)

// ─────────────────────────────────────────────────────────────────────────────
// EventBus
// ─────────────────────────────────────────────────────────────────────────────
// Kafka delivery metrics (surfaced in /health)
var kafkaPublished atomic.Int64
var kafkaPublishErrors atomic.Int64

type EventBus struct {
	kafkaEndpoint string
	client        *http.Client
}

func newEventBus() *EventBus {
	return &EventBus{
		kafkaEndpoint: getEnv("KAFKA_REST_ENDPOINT", "http://kafka-rest:8082"),
		client:        &http.Client{Timeout: 10 * time.Second},
	}
}

func (eb *EventBus) Publish(topic string, data interface{}) {
	payload := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": uuid.New().String(), "value": map[string]interface{}{
				"event_id": uuid.New().String(), "topic": topic,
				"source": "direct-debit-service", "data": data,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			}},
		},
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/topics/%s", eb.kafkaEndpoint, topic), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp, err := eb.client.Do(req)
	if err != nil {
		kafkaPublishErrors.Add(1)
		log.Printf("[direct-debit] Kafka error: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		kafkaPublishErrors.Add(1)
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[direct-debit] Kafka publish rejected topic=%s status=%d body=%s", topic, resp.StatusCode, string(respBody))
		return
	}
	kafkaPublished.Add(1)
}

var bus = newEventBus()

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service":  "direct-debit-service",
		"status":   "healthy",
		"version":  "1.0.0",
		"schemes":  []string{string(BACS), string(SEPA), string(ACH)},
		"kafka_published": kafkaPublished.Load(),
		"kafka_publish_errors": kafkaPublishErrors.Load(),
	})
}

// POST /api/v1/direct-debit/mandates — create a mandate
func createMandate(c *gin.Context) {
	var mandate DirectDebitMandate
	if err := c.ShouldBindJSON(&mandate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate scheme-specific fields
	switch mandate.Scheme {
	case BACS:
		if mandate.SortCode == "" || mandate.AccountNumber == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "BACS mandates require sort_code and account_number"})
			return
		}
		mandate.Currency = "GBP"
	case SEPA:
		if mandate.IBAN == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "SEPA mandates require iban"})
			return
		}
		mandate.Currency = "EUR"
	case ACH:
		if mandate.RoutingNumber == "" || mandate.AccountNumber == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ACH mandates require routing_number and account_number"})
			return
		}
		mandate.Currency = "USD"
	}

	mandate.ID = uuid.New().String()
	mandate.Status = MandatePending
	mandate.Reference = fmt.Sprintf("RF-DD-%s", mandate.ID[:8])
	mandate.CreatedAt = time.Now()
	mandate.UpdatedAt = time.Now()

	mu.Lock()
	mandates[mandate.ID] = &mandate
	mu.Unlock()

	bus.Publish("direct-debit.mandate.created", map[string]interface{}{
		"mandate_id": mandate.ID, "user_id": mandate.UserID,
		"scheme": mandate.Scheme, "reference": mandate.Reference,
	})

	// Activate BACS mandates after 3 working days (simulated immediately for demo)
	go func() {
		time.Sleep(2 * time.Second) // Simulate bank processing
		now := time.Now()
		mu.Lock()
		if m, ok := mandates[mandate.ID]; ok {
			m.Status = MandateActive
			m.ActivatedAt = &now
			m.UpdatedAt = now
		}
		mu.Unlock()
		bus.Publish("direct-debit.mandate.activated", map[string]interface{}{
			"mandate_id": mandate.ID, "activated_at": now,
		})
	}()

	c.JSON(http.StatusCreated, mandate)
}

// GET /api/v1/direct-debit/mandates/:id — get mandate
func getMandate(c *gin.Context) {
	id := c.Param("id")
	mu.RLock()
	mandate, ok := mandates[id]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mandate not found"})
		return
	}
	c.JSON(http.StatusOK, mandate)
}

// GET /api/v1/direct-debit/users/:user_id/mandates — list user mandates
func getUserMandates(c *gin.Context) {
	userID := c.Param("user_id")
	mu.RLock()
	var userMandates []*DirectDebitMandate
	for _, m := range mandates {
		if m.UserID == userID {
			userMandates = append(userMandates, m)
		}
	}
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"mandates": userMandates, "total": len(userMandates)})
}

// DELETE /api/v1/direct-debit/mandates/:id — cancel mandate
func cancelMandate(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&req)

	mu.Lock()
	mandate, ok := mandates[id]
	if !ok {
		mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Mandate not found"})
		return
	}
	now := time.Now()
	mandate.Status = MandateCancelled
	mandate.CancelledAt = &now
	mandate.CancellationReason = req.Reason
	mandate.UpdatedAt = now
	mu.Unlock()

	bus.Publish("direct-debit.mandate.cancelled", map[string]interface{}{
		"mandate_id": id, "reason": req.Reason, "cancelled_at": now,
	})

	c.JSON(http.StatusOK, gin.H{"id": id, "status": "cancelled", "cancelled_at": now})
}

// POST /api/v1/direct-debit/collections — initiate a collection
func initiateCollection(c *gin.Context) {
	var req DDCollection
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mu.RLock()
	mandate, ok := mandates[req.MandateID]
	mu.RUnlock()

	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mandate not found"})
		return
	}
	if mandate.Status != MandateActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mandate is not active", "status": mandate.Status})
		return
	}
	if mandate.MaxAmount > 0 && req.Amount > mandate.MaxAmount {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":      "Amount exceeds mandate maximum",
			"max_amount": mandate.MaxAmount,
			"requested":  req.Amount,
		})
		return
	}

	req.ID = uuid.New().String()
	req.Status = CollectionPending
	req.CreatedAt = time.Now()

	mu.Lock()
	collections[req.ID] = &req
	mu.Unlock()

	bus.Publish("direct-debit.collection.initiated", map[string]interface{}{
		"collection_id": req.ID, "mandate_id": req.MandateID,
		"amount": req.Amount, "currency": req.Currency,
	})

	// Simulate BACS 3-day processing cycle
	go processCollection(req.ID, mandate.Scheme)

	c.JSON(http.StatusCreated, req)
}

func processCollection(collectionID string, scheme DDScheme) {
	// Simulate processing delay based on scheme
	delay := 3 * time.Second // Demo: 3 seconds instead of 3 days
	if scheme == SEPA {
		delay = 2 * time.Second
	} else if scheme == ACH {
		delay = 4 * time.Second
	}
	time.Sleep(delay)

	now := time.Now()
	mu.Lock()
	col, ok := collections[collectionID]
	if ok {
		col.Status = CollectionSucceeded
		col.SettledAt = &now
		submitted := now.Add(-delay)
		col.SubmittedAt = &submitted
	}
	mu.Unlock()

	bus.Publish("direct-debit.collection.succeeded", map[string]interface{}{
		"collection_id": collectionID, "settled_at": now,
	})
}

// GET /api/v1/direct-debit/collections/:id — get collection status
func getCollection(c *gin.Context) {
	id := c.Param("id")
	mu.RLock()
	col, ok := collections[id]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Collection not found"})
		return
	}
	c.JSON(http.StatusOK, col)
}

// GET /api/v1/direct-debit/mandates/:id/collections — list collections for a mandate
func getMandateCollections(c *gin.Context) {
	mandateID := c.Param("id")
	mu.RLock()
	var mandateCollections []*DDCollection
	for _, col := range collections {
		if col.MandateID == mandateID {
			mandateCollections = append(mandateCollections, col)
		}
	}
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"collections": mandateCollections, "total": len(mandateCollections)})
}

// GET /api/v1/direct-debit/failure-codes — BACS failure codes reference
func getFailureCodes(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"bacs_failure_codes": BACSFailureCodes})
}

// GET /api/v1/direct-debit/stats — platform statistics
func getStats(c *gin.Context) {
	mu.RLock()
	totalMandates := len(mandates)
	activeMandates := 0
	for _, m := range mandates {
		if m.Status == MandateActive {
			activeMandates++
		}
	}
	totalCollections := len(collections)
	succeededCollections := 0
	var totalVolume float64
	for _, col := range collections {
		if col.Status == CollectionSucceeded {
			succeededCollections++
			totalVolume += col.Amount
		}
	}
	mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"mandates": map[string]int{
			"total":  totalMandates,
			"active": activeMandates,
		},
		"collections": map[string]interface{}{
			"total":     totalCollections,
			"succeeded": succeededCollections,
			"volume":    totalVolume,
		},
		"schemes": []string{string(BACS), string(SEPA), string(ACH)},
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed demo data
// ─────────────────────────────────────────────────────────────────────────────
func seedDemoData() {
	now := time.Now()
	activated := now.Add(-7 * 24 * time.Hour)
	mu.Lock()
	mandates["dd-mandate-001"] = &DirectDebitMandate{
		ID: "dd-mandate-001", UserID: "demo-user-001",
		AccountName: "John Smith", AccountNumber: "12345678",
		SortCode: "20-00-00", Scheme: BACS,
		Reference: "RF-DD-mandate-001", Status: MandateActive,
		Currency: "GBP", MaxAmount: 500.0,
		CreatedAt: now.Add(-7 * 24 * time.Hour),
		UpdatedAt: now, ActivatedAt: &activated,
	}
	mu.Unlock()
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
func main() {
	seedDemoData()

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", healthCheck)

	api := r.Group("/api/v1/direct-debit")
	{
		api.POST("/mandates", createMandate)
		api.GET("/mandates/:id", getMandate)
		api.DELETE("/mandates/:id", cancelMandate)
		api.GET("/mandates/:id/collections", getMandateCollections)
		api.GET("/users/:user_id/mandates", getUserMandates)
		api.POST("/collections", initiateCollection)
		api.GET("/collections/:id", getCollection)
		api.GET("/failure-codes", getFailureCodes)
		api.GET("/stats", getStats)
	}

	port := getEnv("PORT", "8098")
	log.Printf("[direct-debit-service] Starting on port %s", port)
	log.Printf("[direct-debit-service] Schemes: BACS, SEPA Core, ACH")
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start direct-debit-service: %v", err)
	}
}
