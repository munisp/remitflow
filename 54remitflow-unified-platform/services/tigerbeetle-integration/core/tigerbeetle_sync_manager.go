package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

// TigerBeetleSyncManager handles bi-directional synchronization between
// TigerBeetle Zig (primary) and TigerBeetle Go (edge) instances
type TigerBeetleSyncManager struct {
	// Core TigerBeetle Zig instance
	zigEndpoint string
	
	// Edge TigerBeetle Go instances
	edgeEndpoints []string
	
	// PostgreSQL for metadata
	db *sql.DB
	
	// Redis for real-time sync coordination
	redis *redis.Client
	
	// Sync configuration
	syncInterval time.Duration
	batchSize    int
	
	// Sync state
	mutex        sync.RWMutex
	lastSyncTime map[string]time.Time
	syncErrors   map[string]error
	
	// Metrics
	syncCount    int64
	errorCount   int64
	lastSyncDuration time.Duration
}

// Account represents TigerBeetle account structure
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
	
	// Metadata fields (stored in PostgreSQL)
	CustomerID    string `json:"customer_id"`
	AgentID       string `json:"agent_id"`
	AccountNumber string `json:"account_number"`
	AccountType   string `json:"account_type"`
	Currency      string `json:"currency"`
	Status        string `json:"status"`
	KYCLevel      string `json:"kyc_level"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Transfer represents TigerBeetle transfer structure
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
	
	// Metadata fields (stored in PostgreSQL)
	PaymentReference string `json:"payment_reference"`
	Description      string `json:"description"`
	PaymentMethod    string `json:"payment_method"`
	AgentID          string `json:"agent_id"`
	CustomerID       string `json:"customer_id"`
	Status           string `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// SyncEvent represents a synchronization event
type SyncEvent struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // "account", "transfer"
	Operation string    `json:"operation"` // "create", "update"
	Data      interface{} `json:"data"`
	Source    string    `json:"source"` // "zig", "edge-1", "edge-2", etc.
	Timestamp time.Time `json:"timestamp"`
	Processed bool      `json:"processed"`
}

// NewTigerBeetleSyncManager creates a new sync manager
func NewTigerBeetleSyncManager(zigEndpoint string, edgeEndpoints []string, dbURL string, redisURL string) (*TigerBeetleSyncManager, error) {
	// Connect to PostgreSQL
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to PostgreSQL: %v", err)
	}
	
	// Connect to Redis
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %v", err)
	}
	redisClient := redis.NewClient(opt)
	
	manager := &TigerBeetleSyncManager{
		zigEndpoint:   zigEndpoint,
		edgeEndpoints: edgeEndpoints,
		db:            db,
		redis:         redisClient,
		syncInterval:  time.Second * 5, // 5-second sync interval
		batchSize:     1000,
		lastSyncTime:  make(map[string]time.Time),
		syncErrors:    make(map[string]error),
	}
	
	// Initialize database tables
	if err := manager.initTables(); err != nil {
		return nil, fmt.Errorf("failed to initialize tables: %v", err)
	}
	
	return manager, nil
}

// initTables creates necessary PostgreSQL tables for metadata
func (sm *TigerBeetleSyncManager) initTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS account_metadata (
			id BIGINT PRIMARY KEY,
			customer_id VARCHAR(100),
			agent_id VARCHAR(100),
			account_number VARCHAR(50) UNIQUE,
			account_type VARCHAR(50),
			currency VARCHAR(10),
			status VARCHAR(20),
			kyc_level VARCHAR(20),
			daily_limit DECIMAL(15,2),
			monthly_limit DECIMAL(15,2),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS transfer_metadata (
			id BIGINT PRIMARY KEY,
			payment_reference VARCHAR(100) UNIQUE,
			description TEXT,
			payment_method VARCHAR(50),
			agent_id VARCHAR(100),
			customer_id VARCHAR(100),
			status VARCHAR(20),
			fee_amount DECIMAL(15,2),
			exchange_rate DECIMAL(10,6),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS sync_events (
			id VARCHAR(100) PRIMARY KEY,
			type VARCHAR(20),
			operation VARCHAR(20),
			data JSONB,
			source VARCHAR(50),
			timestamp TIMESTAMP,
			processed BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_account_metadata_customer ON account_metadata(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_account_metadata_agent ON account_metadata(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_transfer_metadata_reference ON transfer_metadata(payment_reference)`,
		`CREATE INDEX IF NOT EXISTS idx_sync_events_processed ON sync_events(processed, timestamp)`,
	}
	
	for _, query := range queries {
		if _, err := sm.db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query: %v", err)
		}
	}
	
	return nil
}

// Start begins the synchronization process
func (sm *TigerBeetleSyncManager) Start(ctx context.Context) {
	log.Println("Starting TigerBeetle Sync Manager...")
	
	// Start sync workers
	go sm.syncWorker(ctx)
	go sm.eventProcessor(ctx)
	go sm.healthMonitor(ctx)
	
	log.Println("TigerBeetle Sync Manager started successfully")
}

// syncWorker performs periodic synchronization
func (sm *TigerBeetleSyncManager) syncWorker(ctx context.Context) {
	ticker := time.NewTicker(sm.syncInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sm.performSync()
		}
	}
}

// performSync executes bi-directional synchronization
func (sm *TigerBeetleSyncManager) performSync() {
	startTime := time.Now()
	
	// Sync from Zig to Edge instances
	if err := sm.syncZigToEdge(); err != nil {
		log.Printf("Error syncing Zig to Edge: %v", err)
		sm.syncErrors["zig-to-edge"] = err
		sm.errorCount++
	}
	
	// Sync from Edge instances to Zig
	if err := sm.syncEdgeToZig(); err != nil {
		log.Printf("Error syncing Edge to Zig: %v", err)
		sm.syncErrors["edge-to-zig"] = err
		sm.errorCount++
	}
	
	// Update sync metrics
	sm.mutex.Lock()
	sm.syncCount++
	sm.lastSyncDuration = time.Since(startTime)
	sm.lastSyncTime["last_sync"] = time.Now()
	sm.mutex.Unlock()
	
	log.Printf("Sync completed in %v", time.Since(startTime))
}

// syncZigToEdge synchronizes data from Zig primary to Edge instances
func (sm *TigerBeetleSyncManager) syncZigToEdge() error {
	// Get pending sync events from Zig
	events, err := sm.getPendingSyncEvents("zig")
	if err != nil {
		return fmt.Errorf("failed to get pending events from Zig: %v", err)
	}
	
	// Sync to each edge instance
	for _, edgeEndpoint := range sm.edgeEndpoints {
		if err := sm.syncEventsToEndpoint(events, edgeEndpoint); err != nil {
			log.Printf("Failed to sync to edge %s: %v", edgeEndpoint, err)
			continue
		}
	}
	
	// Mark events as processed
	return sm.markEventsProcessed(events)
}

// syncEdgeToZig synchronizes data from Edge instances to Zig primary
func (sm *TigerBeetleSyncManager) syncEdgeToZig() error {
	for _, edgeEndpoint := range sm.edgeEndpoints {
		// Get pending events from edge
		events, err := sm.getPendingSyncEventsFromEndpoint(edgeEndpoint)
		if err != nil {
			log.Printf("Failed to get events from edge %s: %v", edgeEndpoint, err)
			continue
		}
		
		// Sync to Zig primary
		if err := sm.syncEventsToEndpoint(events, sm.zigEndpoint); err != nil {
			log.Printf("Failed to sync edge %s to Zig: %v", edgeEndpoint, err)
			continue
		}
		
		// Mark events as processed on edge
		if err := sm.markEventsProcessedOnEndpoint(events, edgeEndpoint); err != nil {
			log.Printf("Failed to mark events processed on edge %s: %v", edgeEndpoint, err)
		}
	}
	
	return nil
}

// CreateAccountWithMetadata creates an account in TigerBeetle with metadata in PostgreSQL
func (sm *TigerBeetleSyncManager) CreateAccountWithMetadata(account Account) error {
	// Start transaction
	tx, err := sm.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to start transaction: %v", err)
	}
	defer tx.Rollback()
	
	// Create account in TigerBeetle Zig
	if err := sm.createAccountInTigerBeetle(account); err != nil {
		return fmt.Errorf("failed to create account in TigerBeetle: %v", err)
	}
	
	// Store metadata in PostgreSQL
	query := `
		INSERT INTO account_metadata (
			id, customer_id, agent_id, account_number, account_type, 
			currency, status, kyc_level, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	
	_, err = tx.Exec(query,
		account.ID, account.CustomerID, account.AgentID, account.AccountNumber,
		account.AccountType, account.Currency, account.Status, account.KYCLevel,
		account.CreatedAt, account.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to store account metadata: %v", err)
	}
	
	// Create sync event
	event := SyncEvent{
		ID:        uuid.New().String(),
		Type:      "account",
		Operation: "create",
		Data:      account,
		Source:    "zig",
		Timestamp: time.Now(),
		Processed: false,
	}
	
	if err := sm.createSyncEvent(tx, event); err != nil {
		return fmt.Errorf("failed to create sync event: %v", err)
	}
	
	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
	}
	
	// Publish to Redis for real-time sync
	sm.publishSyncEvent(event)
	
	return nil
}

// CreateTransferWithMetadata creates a transfer in TigerBeetle with metadata in PostgreSQL
func (sm *TigerBeetleSyncManager) CreateTransferWithMetadata(transfer Transfer) error {
	// Start transaction
	tx, err := sm.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to start transaction: %v", err)
	}
	defer tx.Rollback()
	
	// Create transfer in TigerBeetle Zig
	if err := sm.createTransferInTigerBeetle(transfer); err != nil {
		return fmt.Errorf("failed to create transfer in TigerBeetle: %v", err)
	}
	
	// Store metadata in PostgreSQL
	query := `
		INSERT INTO transfer_metadata (
			id, payment_reference, description, payment_method, 
			agent_id, customer_id, status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	
	_, err = tx.Exec(query,
		transfer.ID, transfer.PaymentReference, transfer.Description, transfer.PaymentMethod,
		transfer.AgentID, transfer.CustomerID, transfer.Status, transfer.CreatedAt, transfer.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to store transfer metadata: %v", err)
	}
	
	// Create sync event
	event := SyncEvent{
		ID:        uuid.New().String(),
		Type:      "transfer",
		Operation: "create",
		Data:      transfer,
		Source:    "zig",
		Timestamp: time.Now(),
		Processed: false,
	}
	
	if err := sm.createSyncEvent(tx, event); err != nil {
		return fmt.Errorf("failed to create sync event: %v", err)
	}
	
	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
	}
	
	// Publish to Redis for real-time sync
	sm.publishSyncEvent(event)
	
	return nil
}

// GetAccountWithMetadata retrieves account from TigerBeetle with metadata from PostgreSQL
func (sm *TigerBeetleSyncManager) GetAccountWithMetadata(accountID uint64) (*Account, error) {
	// Get account from TigerBeetle
	account, err := sm.getAccountFromTigerBeetle(accountID)
	if err != nil {
		return nil, fmt.Errorf("failed to get account from TigerBeetle: %v", err)
	}
	
	// Get metadata from PostgreSQL
	query := `
		SELECT customer_id, agent_id, account_number, account_type, 
		       currency, status, kyc_level, created_at, updated_at
		FROM account_metadata WHERE id = $1
	`
	
	row := sm.db.QueryRow(query, accountID)
	err = row.Scan(
		&account.CustomerID, &account.AgentID, &account.AccountNumber,
		&account.AccountType, &account.Currency, &account.Status,
		&account.KYCLevel, &account.CreatedAt, &account.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get account metadata: %v", err)
	}
	
	return account, nil
}

// Helper methods for TigerBeetle operations
func (sm *TigerBeetleSyncManager) createAccountInTigerBeetle(account Account) error {
	data, err := json.Marshal([]Account{account})
	if err != nil {
		return err
	}
	
	resp, err := http.Post(sm.zigEndpoint+"/accounts", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("TigerBeetle returned status %d", resp.StatusCode)
	}
	
	return nil
}

func (sm *TigerBeetleSyncManager) createTransferInTigerBeetle(transfer Transfer) error {
	data, err := json.Marshal([]Transfer{transfer})
	if err != nil {
		return err
	}
	
	resp, err := http.Post(sm.zigEndpoint+"/transfers", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("TigerBeetle returned status %d", resp.StatusCode)
	}
	
	return nil
}

func (sm *TigerBeetleSyncManager) getAccountFromTigerBeetle(accountID uint64) (*Account, error) {
	resp, err := http.Get(fmt.Sprintf("%s/accounts/%d", sm.zigEndpoint, accountID))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("TigerBeetle returned status %d", resp.StatusCode)
	}
	
	var account Account
	if err := json.NewDecoder(resp.Body).Decode(&account); err != nil {
		return nil, err
	}
	
	return &account, nil
}

// Sync event management
func (sm *TigerBeetleSyncManager) createSyncEvent(tx *sql.Tx, event SyncEvent) error {
	data, err := json.Marshal(event.Data)
	if err != nil {
		return err
	}
	
	query := `
		INSERT INTO sync_events (id, type, operation, data, source, timestamp, processed)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	
	_, err = tx.Exec(query, event.ID, event.Type, event.Operation, data, event.Source, event.Timestamp, event.Processed)
	return err
}

func (sm *TigerBeetleSyncManager) publishSyncEvent(event SyncEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal sync event: %v", err)
		return
	}
	
	ctx := context.Background()
	if err := sm.redis.Publish(ctx, "tigerbeetle:sync", data).Err(); err != nil {
		log.Printf("Failed to publish sync event: %v", err)
	}
}

func (sm *TigerBeetleSyncManager) getPendingSyncEvents(source string) ([]SyncEvent, error) {
	query := `
		SELECT id, type, operation, data, source, timestamp, processed
		FROM sync_events 
		WHERE source = $1 AND processed = FALSE
		ORDER BY timestamp ASC
		LIMIT $2
	`
	
	rows, err := sm.db.Query(query, source, sm.batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var events []SyncEvent
	for rows.Next() {
		var event SyncEvent
		var data []byte
		
		err := rows.Scan(&event.ID, &event.Type, &event.Operation, &data, &event.Source, &event.Timestamp, &event.Processed)
		if err != nil {
			continue
		}
		
		if err := json.Unmarshal(data, &event.Data); err != nil {
			continue
		}
		
		events = append(events, event)
	}
	
	return events, nil
}

func (sm *TigerBeetleSyncManager) markEventsProcessed(events []SyncEvent) error {
	if len(events) == 0 {
		return nil
	}
	
	eventIDs := make([]string, len(events))
	for i, event := range events {
		eventIDs[i] = event.ID
	}
	
	query := `UPDATE sync_events SET processed = TRUE WHERE id = ANY($1)`
	_, err := sm.db.Exec(query, eventIDs)
	return err
}

// Additional helper methods for edge sync operations
func (sm *TigerBeetleSyncManager) syncEventsToEndpoint(events []SyncEvent, endpoint string) error {
	if len(events) == 0 {
		return nil
	}
	
	data, err := json.Marshal(events)
	if err != nil {
		return err
	}
	
	resp, err := http.Post(endpoint+"/sync", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("endpoint returned status %d", resp.StatusCode)
	}
	
	return nil
}

func (sm *TigerBeetleSyncManager) getPendingSyncEventsFromEndpoint(endpoint string) ([]SyncEvent, error) {
	resp, err := http.Get(endpoint + "/sync/pending")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("endpoint returned status %d", resp.StatusCode)
	}
	
	var events []SyncEvent
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		return nil, err
	}
	
	return events, nil
}

func (sm *TigerBeetleSyncManager) markEventsProcessedOnEndpoint(events []SyncEvent, endpoint string) error {
	if len(events) == 0 {
		return nil
	}
	
	eventIDs := make([]string, len(events))
	for i, event := range events {
		eventIDs[i] = event.ID
	}
	
	data, err := json.Marshal(map[string][]string{"event_ids": eventIDs})
	if err != nil {
		return err
	}
	
	resp, err := http.Post(endpoint+"/sync/processed", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	return nil
}

// Event processor for real-time sync
func (sm *TigerBeetleSyncManager) eventProcessor(ctx context.Context) {
	pubsub := sm.redis.Subscribe(ctx, "tigerbeetle:sync")
	defer pubsub.Close()
	
	ch := pubsub.Channel()
	
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-ch:
			var event SyncEvent
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("Failed to unmarshal sync event: %v", err)
				continue
			}
			
			// Process real-time sync event
			sm.processRealTimeSyncEvent(event)
		}
	}
}

func (sm *TigerBeetleSyncManager) processRealTimeSyncEvent(event SyncEvent) {
	// Implement real-time sync logic
	log.Printf("Processing real-time sync event: %s %s", event.Type, event.Operation)
}

// Health monitor
func (sm *TigerBeetleSyncManager) healthMonitor(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sm.checkHealth()
		}
	}
}

func (sm *TigerBeetleSyncManager) checkHealth() {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()
	
	log.Printf("Sync Health - Count: %d, Errors: %d, Last Duration: %v", 
		sm.syncCount, sm.errorCount, sm.lastSyncDuration)
}

// GetSyncStats returns synchronization statistics
func (sm *TigerBeetleSyncManager) GetSyncStats() map[string]interface{} {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()
	
	return map[string]interface{}{
		"sync_count":        sm.syncCount,
		"error_count":       sm.errorCount,
		"last_sync_time":    sm.lastSyncTime,
		"last_sync_duration": sm.lastSyncDuration,
		"sync_errors":       sm.syncErrors,
		"edge_endpoints":    sm.edgeEndpoints,
		"zig_endpoint":      sm.zigEndpoint,
	}
}

func main() {
	// Example usage
	manager, err := NewTigerBeetleSyncManager(
		"http://localhost:3000",                    // Zig endpoint
		[]string{"http://localhost:3001", "http://localhost:3002"}, // Edge endpoints
		"postgres://user:pass@localhost/tigerbeetle_db",
		"redis://localhost:6379",
	)
	if err != nil {
		log.Fatal(err)
	}
	
	ctx := context.Background()
	manager.Start(ctx)
	
	// Keep running
	select {}
}

