// Package sync provides automatic recovery from corrupted sync state
// Implements checkpoints, rollback, and self-healing mechanisms
package sync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// RecoveryConfig configures recovery behavior
type RecoveryConfig struct {
	CheckpointInterval   time.Duration `json:"checkpoint_interval"`
	MaxCheckpoints       int           `json:"max_checkpoints"`
	CorruptionThreshold  int           `json:"corruption_threshold"` // Max corrupted items before recovery
	AutoRecoveryEnabled  bool          `json:"auto_recovery_enabled"`
	RecoveryTimeout      time.Duration `json:"recovery_timeout"`
	ValidationInterval   time.Duration `json:"validation_interval"`
}

// DefaultRecoveryConfig returns default recovery configuration
func DefaultRecoveryConfig() *RecoveryConfig {
	return &RecoveryConfig{
		CheckpointInterval:  5 * time.Minute,
		MaxCheckpoints:      10,
		CorruptionThreshold: 100,
		AutoRecoveryEnabled: true,
		RecoveryTimeout:     5 * time.Minute,
		ValidationInterval:  1 * time.Minute,
	}
}

// Checkpoint represents a sync state checkpoint
type Checkpoint struct {
	ID            string                 `json:"id"`
	Timestamp     time.Time              `json:"timestamp"`
	VectorClock   map[string]uint64      `json:"vector_clock"`
	PendingCount  int                    `json:"pending_count"`
	SyncedCount   int                    `json:"synced_count"`
	StateHash     string                 `json:"state_hash"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	Valid         bool                   `json:"valid"`
}

// CorruptionReport represents detected corruption
type CorruptionReport struct {
	ID            string    `json:"id"`
	DetectedAt    time.Time `json:"detected_at"`
	EntityID      string    `json:"entity_id"`
	EntityType    string    `json:"entity_type"`
	CorruptionType string   `json:"corruption_type"` // checksum_mismatch, missing_data, invalid_state
	ExpectedValue string    `json:"expected_value,omitempty"`
	ActualValue   string    `json:"actual_value,omitempty"`
	Severity      string    `json:"severity"` // low, medium, high, critical
	Recovered     bool      `json:"recovered"`
	RecoveredAt   *time.Time `json:"recovered_at,omitempty"`
}

// RecoveryManager manages sync state recovery
type RecoveryManager struct {
	mu              sync.RWMutex
	config          *RecoveryConfig
	nodeID          string
	storagePath     string
	checkpoints     []*Checkpoint
	currentState    *SyncState
	corruptionLog   []*CorruptionReport
	validator       *StateValidator
	metrics         *SyncMetrics
	auditTrail      *SyncAuditTrail
	stopCh          chan struct{}
	wg              sync.WaitGroup
}

// SyncState represents the current sync state
type SyncState struct {
	VectorClock    map[string]uint64      `json:"vector_clock"`
	PendingItems   map[string]*SyncItem   `json:"pending_items"`
	SyncedItems    map[string]bool        `json:"synced_items"`
	LastSyncTime   time.Time              `json:"last_sync_time"`
	StateHash      string                 `json:"state_hash"`
}

// NewRecoveryManager creates a new recovery manager
func NewRecoveryManager(
	nodeID string,
	storagePath string,
	config *RecoveryConfig,
	metrics *SyncMetrics,
	auditTrail *SyncAuditTrail,
) *RecoveryManager {
	if config == nil {
		config = DefaultRecoveryConfig()
	}

	rm := &RecoveryManager{
		config:        config,
		nodeID:        nodeID,
		storagePath:   storagePath,
		checkpoints:   make([]*Checkpoint, 0),
		currentState:  &SyncState{
			VectorClock:  make(map[string]uint64),
			PendingItems: make(map[string]*SyncItem),
			SyncedItems:  make(map[string]bool),
		},
		corruptionLog: make([]*CorruptionReport, 0),
		validator:     NewStateValidator(),
		metrics:       metrics,
		auditTrail:    auditTrail,
		stopCh:        make(chan struct{}),
	}

	// Load checkpoints from storage
	rm.loadCheckpoints()

	return rm
}

// Start starts the recovery manager
func (rm *RecoveryManager) Start(ctx context.Context) {
	rm.wg.Add(2)
	go rm.checkpointLoop(ctx)
	go rm.validationLoop(ctx)
}

// Stop stops the recovery manager
func (rm *RecoveryManager) Stop() {
	close(rm.stopCh)
	rm.wg.Wait()
}

// CreateCheckpoint creates a new checkpoint
func (rm *RecoveryManager) CreateCheckpoint() (*Checkpoint, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// Calculate state hash
	stateHash := rm.calculateStateHash()

	checkpoint := &Checkpoint{
		ID:           fmt.Sprintf("cp-%s-%d", rm.nodeID, time.Now().UnixNano()),
		Timestamp:    time.Now(),
		VectorClock:  rm.copyVectorClock(rm.currentState.VectorClock),
		PendingCount: len(rm.currentState.PendingItems),
		SyncedCount:  len(rm.currentState.SyncedItems),
		StateHash:    stateHash,
		Valid:        true,
	}

	rm.checkpoints = append(rm.checkpoints, checkpoint)

	// Prune old checkpoints
	if len(rm.checkpoints) > rm.config.MaxCheckpoints {
		rm.checkpoints = rm.checkpoints[len(rm.checkpoints)-rm.config.MaxCheckpoints:]
	}

	// Persist checkpoint
	rm.persistCheckpoint(checkpoint)

	return checkpoint, nil
}

// GetLatestCheckpoint returns the latest valid checkpoint
func (rm *RecoveryManager) GetLatestCheckpoint() (*Checkpoint, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	for i := len(rm.checkpoints) - 1; i >= 0; i-- {
		if rm.checkpoints[i].Valid {
			return rm.checkpoints[i], true
		}
	}

	return nil, false
}

// RollbackToCheckpoint rolls back to a specific checkpoint
func (rm *RecoveryManager) RollbackToCheckpoint(checkpointID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	var checkpoint *Checkpoint
	for _, cp := range rm.checkpoints {
		if cp.ID == checkpointID {
			checkpoint = cp
			break
		}
	}

	if checkpoint == nil {
		return fmt.Errorf("checkpoint not found: %s", checkpointID)
	}

	if !checkpoint.Valid {
		return fmt.Errorf("checkpoint is invalid: %s", checkpointID)
	}

	// Restore state from checkpoint
	rm.currentState.VectorClock = rm.copyVectorClock(checkpoint.VectorClock)
	rm.currentState.LastSyncTime = checkpoint.Timestamp

	// Log recovery event
	if rm.auditTrail != nil {
		ctx := context.Background()
		rm.auditTrail.LogRecoveryEvent(ctx, AuditEventRecoveryCompleted, 0, "", map[string]interface{}{
			"checkpoint_id": checkpointID,
			"rollback_to":   checkpoint.Timestamp,
		})
	}

	return nil
}

// DetectCorruption detects corruption in sync state
func (rm *RecoveryManager) DetectCorruption() []*CorruptionReport {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	reports := make([]*CorruptionReport, 0)

	// Validate current state
	for id, item := range rm.currentState.PendingItems {
		if err := rm.validator.ValidateItem(item); err != nil {
			report := &CorruptionReport{
				ID:             fmt.Sprintf("corr-%d", time.Now().UnixNano()),
				DetectedAt:     time.Now(),
				EntityID:       id,
				EntityType:     item.EntityType,
				CorruptionType: "invalid_state",
				ActualValue:    err.Error(),
				Severity:       rm.classifySeverity(item),
			}
			reports = append(reports, report)
			rm.corruptionLog = append(rm.corruptionLog, report)
		}
	}

	// Check state hash
	currentHash := rm.calculateStateHash()
	if rm.currentState.StateHash != "" && rm.currentState.StateHash != currentHash {
		report := &CorruptionReport{
			ID:             fmt.Sprintf("corr-%d", time.Now().UnixNano()),
			DetectedAt:     time.Now(),
			CorruptionType: "checksum_mismatch",
			ExpectedValue:  rm.currentState.StateHash,
			ActualValue:    currentHash,
			Severity:       "high",
		}
		reports = append(reports, report)
		rm.corruptionLog = append(rm.corruptionLog, report)
	}

	return reports
}

// RecoverFromCorruption attempts to recover from detected corruption
func (rm *RecoveryManager) RecoverFromCorruption(ctx context.Context) error {
	reports := rm.DetectCorruption()
	if len(reports) == 0 {
		return nil
	}

	// Log recovery start
	if rm.auditTrail != nil {
		rm.auditTrail.LogRecoveryEvent(ctx, AuditEventRecoveryStarted, len(reports), "", nil)
	}

	// If corruption exceeds threshold, rollback to checkpoint
	if len(reports) > rm.config.CorruptionThreshold {
		checkpoint, ok := rm.GetLatestCheckpoint()
		if ok {
			return rm.RollbackToCheckpoint(checkpoint.ID)
		}
	}

	// Try to recover individual items
	recovered := 0
	for _, report := range reports {
		if err := rm.recoverItem(ctx, report); err == nil {
			report.Recovered = true
			now := time.Now()
			report.RecoveredAt = &now
			recovered++
		}
	}

	// Log recovery completion
	if rm.auditTrail != nil {
		rm.auditTrail.LogRecoveryEvent(ctx, AuditEventRecoveryCompleted, recovered, "", map[string]interface{}{
			"total_corrupted": len(reports),
			"recovered":       recovered,
		})
	}

	return nil
}

// SelfHeal performs self-healing operations
func (rm *RecoveryManager) SelfHeal(ctx context.Context) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	healed := 0

	// Remove orphaned items
	for id, item := range rm.currentState.PendingItems {
		if rm.isOrphaned(item) {
			delete(rm.currentState.PendingItems, id)
			healed++
		}
	}

	// Fix inconsistent vector clocks
	for nodeID, clock := range rm.currentState.VectorClock {
		if clock == 0 {
			delete(rm.currentState.VectorClock, nodeID)
			healed++
		}
	}

	// Recalculate state hash
	rm.currentState.StateHash = rm.calculateStateHash()

	return nil
}

// UpdateState updates the current sync state
func (rm *RecoveryManager) UpdateState(item *SyncItem, synced bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if synced {
		delete(rm.currentState.PendingItems, item.ID)
		rm.currentState.SyncedItems[item.ID] = true
	} else {
		rm.currentState.PendingItems[item.ID] = item
	}

	rm.currentState.LastSyncTime = time.Now()
}

// UpdateVectorClock updates the vector clock
func (rm *RecoveryManager) UpdateVectorClock(nodeID string, clock uint64) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if rm.currentState.VectorClock[nodeID] < clock {
		rm.currentState.VectorClock[nodeID] = clock
	}
}

// GetCorruptionLog returns the corruption log
func (rm *RecoveryManager) GetCorruptionLog() []*CorruptionReport {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	log := make([]*CorruptionReport, len(rm.corruptionLog))
	copy(log, rm.corruptionLog)
	return log
}

// Helper methods

func (rm *RecoveryManager) checkpointLoop(ctx context.Context) {
	defer rm.wg.Done()

	ticker := time.NewTicker(rm.config.CheckpointInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-rm.stopCh:
			return
		case <-ticker.C:
			rm.CreateCheckpoint()
		}
	}
}

func (rm *RecoveryManager) validationLoop(ctx context.Context) {
	defer rm.wg.Done()

	ticker := time.NewTicker(rm.config.ValidationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-rm.stopCh:
			return
		case <-ticker.C:
			if rm.config.AutoRecoveryEnabled {
				rm.RecoverFromCorruption(ctx)
			}
		}
	}
}

func (rm *RecoveryManager) calculateStateHash() string {
	data, _ := json.Marshal(rm.currentState.PendingItems)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func (rm *RecoveryManager) copyVectorClock(vc map[string]uint64) map[string]uint64 {
	copy := make(map[string]uint64)
	for k, v := range vc {
		copy[k] = v
	}
	return copy
}

func (rm *RecoveryManager) classifySeverity(item *SyncItem) string {
	switch item.Priority {
	case PriorityCritical:
		return "critical"
	case PriorityHigh:
		return "high"
	case PriorityNormal:
		return "medium"
	default:
		return "low"
	}
}

func (rm *RecoveryManager) isOrphaned(item *SyncItem) bool {
	// Item is orphaned if it's been pending for too long
	return time.Since(item.CreatedAt) > 24*time.Hour && item.RetryCount > 10
}

func (rm *RecoveryManager) recoverItem(ctx context.Context, report *CorruptionReport) error {
	// Try to recover the item based on corruption type
	switch report.CorruptionType {
	case "invalid_state":
		// Remove invalid item
		delete(rm.currentState.PendingItems, report.EntityID)
		return nil
	case "checksum_mismatch":
		// Recalculate hash
		rm.currentState.StateHash = rm.calculateStateHash()
		return nil
	default:
		return fmt.Errorf("unknown corruption type: %s", report.CorruptionType)
	}
}

func (rm *RecoveryManager) loadCheckpoints() {
	path := filepath.Join(rm.storagePath, "checkpoints")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return
	}

	entries, err := os.ReadDir(path)
	if err != nil {
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

		var checkpoint Checkpoint
		if err := json.Unmarshal(data, &checkpoint); err != nil {
			continue
		}

		rm.checkpoints = append(rm.checkpoints, &checkpoint)
	}

	// Sort by timestamp
	sort.Slice(rm.checkpoints, func(i, j int) bool {
		return rm.checkpoints[i].Timestamp.Before(rm.checkpoints[j].Timestamp)
	})
}

func (rm *RecoveryManager) persistCheckpoint(checkpoint *Checkpoint) {
	path := filepath.Join(rm.storagePath, "checkpoints")
	os.MkdirAll(path, 0755)

	data, err := json.Marshal(checkpoint)
	if err != nil {
		return
	}

	filename := filepath.Join(path, checkpoint.ID+".json")
	os.WriteFile(filename, data, 0644)
}

// StateValidator validates sync state
type StateValidator struct{}

// NewStateValidator creates a new state validator
func NewStateValidator() *StateValidator {
	return &StateValidator{}
}

// ValidateItem validates a sync item
func (sv *StateValidator) ValidateItem(item *SyncItem) error {
	if item == nil {
		return fmt.Errorf("item is nil")
	}

	if item.ID == "" {
		return fmt.Errorf("item ID is empty")
	}

	if item.EntityID == "" {
		return fmt.Errorf("entity ID is empty")
	}

	if item.CreatedAt.IsZero() {
		return fmt.Errorf("created at is zero")
	}

	if item.RetryCount < 0 {
		return fmt.Errorf("retry count is negative")
	}

	return nil
}

// ValidateVectorClock validates a vector clock
func (sv *StateValidator) ValidateVectorClock(vc map[string]uint64) error {
	if vc == nil {
		return fmt.Errorf("vector clock is nil")
	}

	for nodeID, clock := range vc {
		if nodeID == "" {
			return fmt.Errorf("empty node ID in vector clock")
		}
		if clock == 0 {
			return fmt.Errorf("zero clock value for node %s", nodeID)
		}
	}

	return nil
}

// RecoveryReport represents a recovery report
type RecoveryReport struct {
	Timestamp       time.Time            `json:"timestamp"`
	TotalCorrupted  int                  `json:"total_corrupted"`
	Recovered       int                  `json:"recovered"`
	Failed          int                  `json:"failed"`
	RolledBack      bool                 `json:"rolled_back"`
	CheckpointUsed  string               `json:"checkpoint_used,omitempty"`
	Duration        time.Duration        `json:"duration"`
	Details         []*CorruptionReport  `json:"details"`
}

// GenerateRecoveryReport generates a recovery report
func (rm *RecoveryManager) GenerateRecoveryReport() *RecoveryReport {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	report := &RecoveryReport{
		Timestamp: time.Now(),
		Details:   rm.corruptionLog,
	}

	for _, cr := range rm.corruptionLog {
		report.TotalCorrupted++
		if cr.Recovered {
			report.Recovered++
		} else {
			report.Failed++
		}
	}

	return report
}
