// Package sync provides extended offline support with local transaction limits
// Handles extended offline periods (>24 hours) with proper data management
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// OfflineConfig configures offline behavior
type OfflineConfig struct {
	MaxOfflineDuration     time.Duration `json:"max_offline_duration"`      // Max time to operate offline
	MaxPendingTransactions int           `json:"max_pending_transactions"`  // Max transactions to queue
	MaxStorageBytes        int64         `json:"max_storage_bytes"`         // Max local storage
	CriticalTransactionMax int           `json:"critical_transaction_max"`  // Max critical transactions
	SyncBatchSize          int           `json:"sync_batch_size"`           // Batch size for sync
	RetentionDays          int           `json:"retention_days"`            // Days to retain synced data
	EnableCompression      bool          `json:"enable_compression"`        // Compress stored data
	EnableEncryption       bool          `json:"enable_encryption"`         // Encrypt stored data
}

// DefaultOfflineConfig returns default offline configuration
func DefaultOfflineConfig() *OfflineConfig {
	return &OfflineConfig{
		MaxOfflineDuration:     7 * 24 * time.Hour, // 7 days
		MaxPendingTransactions: 10000,
		MaxStorageBytes:        500 * 1024 * 1024, // 500MB
		CriticalTransactionMax: 1000,
		SyncBatchSize:          100,
		RetentionDays:          30,
		EnableCompression:      true,
		EnableEncryption:       true,
	}
}

// OfflineTransaction represents a transaction stored offline
type OfflineTransaction struct {
	ID              string                 `json:"id"`
	Type            string                 `json:"type"` // cash_in, cash_out, transfer, payment
	Amount          float64                `json:"amount"`
	Currency        string                 `json:"currency"`
	AgentID         string                 `json:"agent_id"`
	CustomerID      string                 `json:"customer_id"`
	RecipientID     string                 `json:"recipient_id,omitempty"`
	Status          string                 `json:"status"` // pending, synced, failed, expired
	Priority        SyncPriority           `json:"priority"`
	CreatedAt       time.Time              `json:"created_at"`
	ExpiresAt       time.Time              `json:"expires_at"`
	SyncedAt        *time.Time             `json:"synced_at,omitempty"`
	RetryCount      int                    `json:"retry_count"`
	LastError       string                 `json:"last_error,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	OfflineReceipt  string                 `json:"offline_receipt"`
	VectorClock     map[string]uint64      `json:"vector_clock,omitempty"`
}

// OfflineState represents the current offline state
type OfflineState struct {
	IsOffline           bool          `json:"is_offline"`
	OfflineSince        *time.Time    `json:"offline_since,omitempty"`
	LastOnline          time.Time     `json:"last_online"`
	PendingCount        int           `json:"pending_count"`
	CriticalCount       int           `json:"critical_count"`
	StorageUsed         int64         `json:"storage_used"`
	CanAcceptMore       bool          `json:"can_accept_more"`
	RemainingCapacity   int           `json:"remaining_capacity"`
	EstimatedSyncTime   time.Duration `json:"estimated_sync_time"`
	OfflineDuration     time.Duration `json:"offline_duration"`
	MaxOfflineExceeded  bool          `json:"max_offline_exceeded"`
}

// OfflineManager manages extended offline operations
type OfflineManager struct {
	mu              sync.RWMutex
	config          *OfflineConfig
	nodeID          string
	storagePath     string
	transactions    map[string]*OfflineTransaction
	state           *OfflineState
	vectorClock     *VectorClock
	priorityQueue   *SyncPriorityQueue
	metrics         *SyncMetrics
	onStateChange   []func(*OfflineState)
	onSyncComplete  []func([]*OfflineTransaction)
}

// NewOfflineManager creates a new offline manager
func NewOfflineManager(
	nodeID string,
	storagePath string,
	config *OfflineConfig,
	metrics *SyncMetrics,
) *OfflineManager {
	if config == nil {
		config = DefaultOfflineConfig()
	}

	om := &OfflineManager{
		config:        config,
		nodeID:        nodeID,
		storagePath:   storagePath,
		transactions:  make(map[string]*OfflineTransaction),
		state: &OfflineState{
			IsOffline:         false,
			LastOnline:        time.Now(),
			CanAcceptMore:     true,
			RemainingCapacity: config.MaxPendingTransactions,
		},
		vectorClock:   NewVectorClock(nodeID),
		priorityQueue: NewSyncPriorityQueue(config.MaxPendingTransactions),
		metrics:       metrics,
		onStateChange: make([]func(*OfflineState), 0),
		onSyncComplete: make([]func([]*OfflineTransaction), 0),
	}

	// Load persisted transactions
	om.loadFromStorage()

	return om
}

// GoOffline transitions to offline mode
func (om *OfflineManager) GoOffline() {
	om.mu.Lock()
	defer om.mu.Unlock()

	if om.state.IsOffline {
		return
	}

	now := time.Now()
	om.state.IsOffline = true
	om.state.OfflineSince = &now

	log.Printf("[OFFLINE] Node %s going offline", om.nodeID)
	om.notifyStateChange()
}

// GoOnline transitions to online mode and triggers sync
func (om *OfflineManager) GoOnline(ctx context.Context) error {
	om.mu.Lock()
	
	if !om.state.IsOffline {
		om.mu.Unlock()
		return nil
	}

	om.state.IsOffline = false
	om.state.LastOnline = time.Now()
	om.state.OfflineSince = nil
	
	// Calculate offline duration
	if om.state.OfflineSince != nil {
		om.state.OfflineDuration = time.Since(*om.state.OfflineSince)
	}

	om.mu.Unlock()

	log.Printf("[OFFLINE] Node %s coming online, starting sync", om.nodeID)
	om.notifyStateChange()

	// Trigger sync
	return om.SyncPendingTransactions(ctx)
}

// QueueTransaction queues a transaction for offline processing
func (om *OfflineManager) QueueTransaction(txn *OfflineTransaction) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	// Check capacity
	if !om.canAcceptTransaction(txn) {
		return ErrOfflineCapacityExceeded
	}

	// Set defaults
	if txn.ID == "" {
		txn.ID = fmt.Sprintf("offline-%s-%d", om.nodeID, time.Now().UnixNano())
	}
	if txn.CreatedAt.IsZero() {
		txn.CreatedAt = time.Now()
	}
	if txn.ExpiresAt.IsZero() {
		txn.ExpiresAt = txn.CreatedAt.Add(om.config.MaxOfflineDuration)
	}
	if txn.Status == "" {
		txn.Status = "pending"
	}
	if txn.Priority == 0 {
		txn.Priority = om.classifyPriority(txn)
	}

	// Generate offline receipt
	txn.OfflineReceipt = om.generateOfflineReceipt(txn)

	// Update vector clock
	om.vectorClock.Increment()
	txn.VectorClock = om.vectorClock.ToMap()

	// Store transaction
	om.transactions[txn.ID] = txn

	// Add to priority queue
	om.priorityQueue.Enqueue(&SyncItem{
		ID:         txn.ID,
		EntityID:   txn.ID,
		EntityType: "transaction",
		Operation:  "create",
		Priority:   txn.Priority,
		Data:       txn,
		CreatedAt:  txn.CreatedAt,
	})

	// Update state
	om.updateState()

	// Persist to storage
	om.persistTransaction(txn)

	log.Printf("[OFFLINE] Queued transaction %s (priority: %s)", txn.ID, txn.Priority.String())

	return nil
}

// GetTransaction retrieves a transaction by ID
func (om *OfflineManager) GetTransaction(id string) (*OfflineTransaction, bool) {
	om.mu.RLock()
	defer om.mu.RUnlock()
	txn, ok := om.transactions[id]
	return txn, ok
}

// GetPendingTransactions returns all pending transactions
func (om *OfflineManager) GetPendingTransactions() []*OfflineTransaction {
	om.mu.RLock()
	defer om.mu.RUnlock()

	pending := make([]*OfflineTransaction, 0)
	for _, txn := range om.transactions {
		if txn.Status == "pending" {
			pending = append(pending, txn)
		}
	}
	return pending
}

// GetState returns the current offline state
func (om *OfflineManager) GetState() *OfflineState {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	// Update dynamic fields
	state := *om.state
	if state.IsOffline && state.OfflineSince != nil {
		state.OfflineDuration = time.Since(*state.OfflineSince)
		state.MaxOfflineExceeded = state.OfflineDuration > om.config.MaxOfflineDuration
	}
	
	return &state
}

// SyncPendingTransactions syncs all pending transactions
func (om *OfflineManager) SyncPendingTransactions(ctx context.Context) error {
	om.mu.Lock()
	pending := make([]*OfflineTransaction, 0)
	for _, txn := range om.transactions {
		if txn.Status == "pending" {
			pending = append(pending, txn)
		}
	}
	om.mu.Unlock()

	if len(pending) == 0 {
		return nil
	}

	log.Printf("[OFFLINE] Syncing %d pending transactions", len(pending))

	synced := make([]*OfflineTransaction, 0)
	failed := make([]*OfflineTransaction, 0)

	// Process in batches by priority
	for i := 0; i < len(pending); i += om.config.SyncBatchSize {
		end := i + om.config.SyncBatchSize
		if end > len(pending) {
			end = len(pending)
		}
		batch := pending[i:end]

		for _, txn := range batch {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
				if err := om.syncTransaction(ctx, txn); err != nil {
					txn.RetryCount++
					txn.LastError = err.Error()
					failed = append(failed, txn)
				} else {
					now := time.Now()
					txn.Status = "synced"
					txn.SyncedAt = &now
					synced = append(synced, txn)
				}
			}
		}
	}

	// Update storage
	om.mu.Lock()
	for _, txn := range synced {
		om.persistTransaction(txn)
		om.priorityQueue.MarkCompleted(txn.ID)
	}
	for _, txn := range failed {
		om.persistTransaction(txn)
	}
	om.updateState()
	om.mu.Unlock()

	// Notify listeners
	if len(synced) > 0 {
		om.notifySyncComplete(synced)
	}

	log.Printf("[OFFLINE] Sync complete: %d synced, %d failed", len(synced), len(failed))

	if om.metrics != nil {
		om.metrics.RecordSyncOperation(om.nodeID, "outbound", "success", "transaction")
	}

	return nil
}

// syncTransaction syncs a single transaction (placeholder - implement actual sync)
func (om *OfflineManager) syncTransaction(ctx context.Context, txn *OfflineTransaction) error {
	// This would call the actual sync API
	// For now, simulate sync
	log.Printf("[OFFLINE] Syncing transaction %s", txn.ID)
	return nil
}

// ExpireOldTransactions expires transactions that have exceeded their lifetime
func (om *OfflineManager) ExpireOldTransactions() int {
	om.mu.Lock()
	defer om.mu.Unlock()

	expired := 0
	now := time.Now()

	for id, txn := range om.transactions {
		if txn.Status == "pending" && now.After(txn.ExpiresAt) {
			txn.Status = "expired"
			om.persistTransaction(txn)
			om.priorityQueue.Remove(id)
			expired++
		}
	}

	if expired > 0 {
		om.updateState()
		log.Printf("[OFFLINE] Expired %d transactions", expired)
	}

	return expired
}

// CleanupSyncedTransactions removes old synced transactions
func (om *OfflineManager) CleanupSyncedTransactions() int {
	om.mu.Lock()
	defer om.mu.Unlock()

	cleaned := 0
	cutoff := time.Now().AddDate(0, 0, -om.config.RetentionDays)

	for id, txn := range om.transactions {
		if txn.Status == "synced" && txn.SyncedAt != nil && txn.SyncedAt.Before(cutoff) {
			delete(om.transactions, id)
			om.deleteFromStorage(id)
			cleaned++
		}
	}

	if cleaned > 0 {
		om.updateState()
		log.Printf("[OFFLINE] Cleaned up %d old transactions", cleaned)
	}

	return cleaned
}

// OnStateChange registers a callback for state changes
func (om *OfflineManager) OnStateChange(callback func(*OfflineState)) {
	om.mu.Lock()
	defer om.mu.Unlock()
	om.onStateChange = append(om.onStateChange, callback)
}

// OnSyncComplete registers a callback for sync completion
func (om *OfflineManager) OnSyncComplete(callback func([]*OfflineTransaction)) {
	om.mu.Lock()
	defer om.mu.Unlock()
	om.onSyncComplete = append(om.onSyncComplete, callback)
}

// Helper methods

func (om *OfflineManager) canAcceptTransaction(txn *OfflineTransaction) bool {
	// Check max pending
	if om.state.PendingCount >= om.config.MaxPendingTransactions {
		return false
	}

	// Check critical limit
	if txn.Priority == PriorityCritical && om.state.CriticalCount >= om.config.CriticalTransactionMax {
		return false
	}

	// Check storage
	if om.state.StorageUsed >= om.config.MaxStorageBytes {
		return false
	}

	// Check offline duration
	if om.state.IsOffline && om.state.OfflineSince != nil {
		if time.Since(*om.state.OfflineSince) > om.config.MaxOfflineDuration {
			return false
		}
	}

	return true
}

func (om *OfflineManager) classifyPriority(txn *OfflineTransaction) SyncPriority {
	switch txn.Type {
	case "cash_in", "cash_out", "transfer", "payment":
		return PriorityCritical
	default:
		return PriorityNormal
	}
}

func (om *OfflineManager) generateOfflineReceipt(txn *OfflineTransaction) string {
	return fmt.Sprintf("OFF-%s-%s-%d",
		om.nodeID[:8],
		txn.ID[:8],
		txn.CreatedAt.Unix(),
	)
}

func (om *OfflineManager) updateState() {
	pendingCount := 0
	criticalCount := 0
	var storageUsed int64

	for _, txn := range om.transactions {
		if txn.Status == "pending" {
			pendingCount++
			if txn.Priority == PriorityCritical {
				criticalCount++
			}
		}
		// Estimate storage (rough estimate)
		data, _ := json.Marshal(txn)
		storageUsed += int64(len(data))
	}

	om.state.PendingCount = pendingCount
	om.state.CriticalCount = criticalCount
	om.state.StorageUsed = storageUsed
	om.state.RemainingCapacity = om.config.MaxPendingTransactions - pendingCount
	om.state.CanAcceptMore = pendingCount < om.config.MaxPendingTransactions &&
		storageUsed < om.config.MaxStorageBytes

	// Estimate sync time (rough: 100ms per transaction)
	om.state.EstimatedSyncTime = time.Duration(pendingCount) * 100 * time.Millisecond
}

func (om *OfflineManager) notifyStateChange() {
	state := om.GetState()
	for _, callback := range om.onStateChange {
		go callback(state)
	}
}

func (om *OfflineManager) notifySyncComplete(synced []*OfflineTransaction) {
	for _, callback := range om.onSyncComplete {
		go callback(synced)
	}
}

// Storage methods

func (om *OfflineManager) loadFromStorage() {
	path := filepath.Join(om.storagePath, "transactions")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		log.Printf("[OFFLINE] Failed to read storage: %v", err)
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		data, err := os.ReadFile(filepath.Join(path, entry.Name()))
		if err != nil {
			continue
		}

		var txn OfflineTransaction
		if err := json.Unmarshal(data, &txn); err != nil {
			continue
		}

		om.transactions[txn.ID] = &txn

		if txn.Status == "pending" {
			om.priorityQueue.Enqueue(&SyncItem{
				ID:         txn.ID,
				EntityID:   txn.ID,
				EntityType: "transaction",
				Operation:  "create",
				Priority:   txn.Priority,
				Data:       &txn,
				CreatedAt:  txn.CreatedAt,
			})
		}
	}

	om.updateState()
	log.Printf("[OFFLINE] Loaded %d transactions from storage", len(om.transactions))
}

func (om *OfflineManager) persistTransaction(txn *OfflineTransaction) {
	path := filepath.Join(om.storagePath, "transactions")
	os.MkdirAll(path, 0755)

	data, err := json.Marshal(txn)
	if err != nil {
		log.Printf("[OFFLINE] Failed to marshal transaction: %v", err)
		return
	}

	filename := filepath.Join(path, txn.ID+".json")
	if err := os.WriteFile(filename, data, 0644); err != nil {
		log.Printf("[OFFLINE] Failed to persist transaction: %v", err)
	}
}

func (om *OfflineManager) deleteFromStorage(id string) {
	path := filepath.Join(om.storagePath, "transactions", id+".json")
	os.Remove(path)
}

// Errors
var (
	ErrOfflineCapacityExceeded = &OfflineError{Message: "offline capacity exceeded"}
	ErrOfflineDurationExceeded = &OfflineError{Message: "max offline duration exceeded"}
	ErrTransactionExpired      = &OfflineError{Message: "transaction expired"}
)

type OfflineError struct {
	Message string
}

func (e *OfflineError) Error() string {
	return e.Message
}

// OfflineLimitEnforcer enforces offline limits
type OfflineLimitEnforcer struct {
	mu            sync.RWMutex
	manager       *OfflineManager
	config        *OfflineConfig
	checkInterval time.Duration
	stopCh        chan struct{}
}

// NewOfflineLimitEnforcer creates a new limit enforcer
func NewOfflineLimitEnforcer(manager *OfflineManager, config *OfflineConfig) *OfflineLimitEnforcer {
	return &OfflineLimitEnforcer{
		manager:       manager,
		config:        config,
		checkInterval: 1 * time.Minute,
		stopCh:        make(chan struct{}),
	}
}

// Start starts the limit enforcer
func (e *OfflineLimitEnforcer) Start(ctx context.Context) {
	ticker := time.NewTicker(e.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-e.stopCh:
			return
		case <-ticker.C:
			e.enforce()
		}
	}
}

// Stop stops the limit enforcer
func (e *OfflineLimitEnforcer) Stop() {
	close(e.stopCh)
}

func (e *OfflineLimitEnforcer) enforce() {
	// Expire old transactions
	e.manager.ExpireOldTransactions()

	// Cleanup synced transactions
	e.manager.CleanupSyncedTransactions()

	// Check offline duration
	state := e.manager.GetState()
	if state.MaxOfflineExceeded {
		log.Printf("[OFFLINE] WARNING: Max offline duration exceeded")
		// Could trigger alerts or force sync attempt
	}
}

// OfflineReceiptGenerator generates offline receipts
type OfflineReceiptGenerator struct {
	nodeID  string
	counter uint64
	mu      sync.Mutex
}

// NewOfflineReceiptGenerator creates a new receipt generator
func NewOfflineReceiptGenerator(nodeID string) *OfflineReceiptGenerator {
	return &OfflineReceiptGenerator{
		nodeID: nodeID,
	}
}

// Generate generates a unique offline receipt
func (g *OfflineReceiptGenerator) Generate(txnType string, amount float64) string {
	g.mu.Lock()
	g.counter++
	counter := g.counter
	g.mu.Unlock()

	return fmt.Sprintf("OFF-%s-%s-%d-%d",
		g.nodeID[:8],
		txnType[:3],
		time.Now().Unix(),
		counter,
	)
}

// Validate validates an offline receipt format
func (g *OfflineReceiptGenerator) Validate(receipt string) bool {
	// Simple validation - check format
	if len(receipt) < 20 {
		return false
	}
	if receipt[:4] != "OFF-" {
		return false
	}
	return true
}
