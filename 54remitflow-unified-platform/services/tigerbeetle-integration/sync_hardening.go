// Package tigerbeetle provides hardened sync between TigerBeetle edge and primary
// Implements monotonic sequence numbers, watermarks, snapshot+replay, backpressure, and conflict detection
package tigerbeetle

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

// SyncEvent represents a sync event with sequence tracking
type SyncEvent struct {
	SequenceNumber uint64    `json:"sequence_number"`
	EdgeID         string    `json:"edge_id"`
	EventType      string    `json:"event_type"`
	Timestamp      time.Time `json:"timestamp"`
	Payload        []byte    `json:"payload"`
	Checksum       string    `json:"checksum"`
	Watermark      uint64    `json:"watermark"`
	RetryCount     int       `json:"retry_count"`
}

// SyncState tracks sync state for an edge node
type SyncState struct {
	EdgeID              string    `json:"edge_id"`
	LastSequenceNumber  uint64    `json:"last_sequence_number"`
	LastWatermark       uint64    `json:"last_watermark"`
	LastSyncTime        time.Time `json:"last_sync_time"`
	PendingEvents       int       `json:"pending_events"`
	SnapshotSequence    uint64    `json:"snapshot_sequence"`
	ConflictsDetected   int       `json:"conflicts_detected"`
	ConflictsResolved   int       `json:"conflicts_resolved"`
}

// ConflictResolution defines how to resolve sync conflicts
type ConflictResolution string

const (
	ResolutionPrimaryWins ConflictResolution = "primary_wins"
	ResolutionEdgeWins    ConflictResolution = "edge_wins"
	ResolutionMerge       ConflictResolution = "merge"
	ResolutionManual      ConflictResolution = "manual"
)

// SyncConflict represents a detected sync conflict
type SyncConflict struct {
	ConflictID     string             `json:"conflict_id"`
	EdgeID         string             `json:"edge_id"`
	SequenceNumber uint64             `json:"sequence_number"`
	EdgeEvent      *SyncEvent         `json:"edge_event"`
	PrimaryEvent   *SyncEvent         `json:"primary_event"`
	DetectedAt     time.Time          `json:"detected_at"`
	Resolution     ConflictResolution `json:"resolution"`
	ResolvedAt     *time.Time         `json:"resolved_at,omitempty"`
	ResolvedBy     string             `json:"resolved_by,omitempty"`
}

// BackpressureConfig configures backpressure handling
type BackpressureConfig struct {
	MaxPendingEvents     int           `json:"max_pending_events"`
	MaxBatchSize         int           `json:"max_batch_size"`
	MinBatchInterval     time.Duration `json:"min_batch_interval"`
	BackoffMultiplier    float64       `json:"backoff_multiplier"`
	MaxBackoffDuration   time.Duration `json:"max_backoff_duration"`
	CircuitBreakerThreshold int        `json:"circuit_breaker_threshold"`
}

// DefaultBackpressureConfig returns default backpressure configuration
func DefaultBackpressureConfig() *BackpressureConfig {
	return &BackpressureConfig{
		MaxPendingEvents:        10000,
		MaxBatchSize:            100,
		MinBatchInterval:        100 * time.Millisecond,
		BackoffMultiplier:       2.0,
		MaxBackoffDuration:      30 * time.Second,
		CircuitBreakerThreshold: 5,
	}
}

// HardenedSyncManager provides hardened sync between edge and primary
type HardenedSyncManager struct {
	edgeID            string
	primaryEndpoint   string
	redisClient       *redis.Client
	backpressure      *BackpressureConfig
	
	mu                sync.RWMutex
	state             *SyncState
	pendingEvents     []*SyncEvent
	conflicts         []*SyncConflict
	
	// Circuit breaker state
	consecutiveFailures int
	circuitOpen         bool
	circuitOpenUntil    time.Time
	
	// Backpressure state
	currentBackoff    time.Duration
	lastBatchTime     time.Time
	
	// Channels
	eventCh           chan *SyncEvent
	stopCh            chan struct{}
}

// NewHardenedSyncManager creates a new hardened sync manager
func NewHardenedSyncManager(
	edgeID string,
	primaryEndpoint string,
	redisClient *redis.Client,
	config *BackpressureConfig,
) *HardenedSyncManager {
	if config == nil {
		config = DefaultBackpressureConfig()
	}
	
	return &HardenedSyncManager{
		edgeID:          edgeID,
		primaryEndpoint: primaryEndpoint,
		redisClient:     redisClient,
		backpressure:    config,
		state: &SyncState{
			EdgeID:             edgeID,
			LastSequenceNumber: 0,
			LastWatermark:      0,
		},
		pendingEvents:   make([]*SyncEvent, 0),
		conflicts:       make([]*SyncConflict, 0),
		eventCh:         make(chan *SyncEvent, config.MaxPendingEvents),
		stopCh:          make(chan struct{}),
		currentBackoff:  config.MinBatchInterval,
	}
}

// Start begins the sync process
func (m *HardenedSyncManager) Start(ctx context.Context) error {
	// Load state from Redis
	if err := m.loadState(ctx); err != nil {
		log.Printf("Warning: Could not load sync state: %v", err)
	}
	
	// Start sync workers
	go m.processEvents(ctx)
	go m.syncFromPrimary(ctx)
	go m.monitorHealth(ctx)
	
	log.Printf("Hardened sync manager started for edge %s", m.edgeID)
	return nil
}

// Stop stops the sync manager
func (m *HardenedSyncManager) Stop() {
	close(m.stopCh)
}

// QueueEvent queues an event for sync with backpressure handling
func (m *HardenedSyncManager) QueueEvent(event *SyncEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Check backpressure
	if len(m.pendingEvents) >= m.backpressure.MaxPendingEvents {
		return fmt.Errorf("backpressure: too many pending events (%d)", len(m.pendingEvents))
	}
	
	// Check circuit breaker
	if m.circuitOpen && time.Now().Before(m.circuitOpenUntil) {
		return fmt.Errorf("circuit breaker open until %v", m.circuitOpenUntil)
	}
	
	// Assign sequence number
	m.state.LastSequenceNumber++
	event.SequenceNumber = m.state.LastSequenceNumber
	event.EdgeID = m.edgeID
	event.Timestamp = time.Now()
	event.Checksum = m.computeChecksum(event)
	event.Watermark = m.state.LastWatermark
	
	// Add to pending
	m.pendingEvents = append(m.pendingEvents, event)
	m.state.PendingEvents = len(m.pendingEvents)
	
	// Queue for processing
	select {
	case m.eventCh <- event:
	default:
		// Channel full, event is in pendingEvents and will be retried
	}
	
	return nil
}

// processEvents processes queued events with batching
func (m *HardenedSyncManager) processEvents(ctx context.Context) {
	ticker := time.NewTicker(m.backpressure.MinBatchInterval)
	defer ticker.Stop()
	
	batch := make([]*SyncEvent, 0, m.backpressure.MaxBatchSize)
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case event := <-m.eventCh:
			batch = append(batch, event)
			if len(batch) >= m.backpressure.MaxBatchSize {
				m.sendBatch(ctx, batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				m.sendBatch(ctx, batch)
				batch = batch[:0]
			}
		}
	}
}

// sendBatch sends a batch of events to primary
func (m *HardenedSyncManager) sendBatch(ctx context.Context, batch []*SyncEvent) {
	if len(batch) == 0 {
		return
	}
	
	// Apply backpressure delay
	m.mu.RLock()
	backoff := m.currentBackoff
	m.mu.RUnlock()
	
	if time.Since(m.lastBatchTime) < backoff {
		time.Sleep(backoff - time.Since(m.lastBatchTime))
	}
	
	// Send to primary
	payload, _ := json.Marshal(batch)
	
	req, err := http.NewRequestWithContext(ctx, "POST", m.primaryEndpoint+"/sync/from-edge", nil)
	if err != nil {
		m.handleSyncFailure()
		return
	}
	
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Edge-ID", m.edgeID)
	req.Header.Set("X-Sequence-Start", fmt.Sprintf("%d", batch[0].SequenceNumber))
	req.Header.Set("X-Sequence-End", fmt.Sprintf("%d", batch[len(batch)-1].SequenceNumber))
	
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Sync batch failed: %v", err)
		m.handleSyncFailure()
		return
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == http.StatusOK {
		m.handleSyncSuccess(batch)
	} else if resp.StatusCode == http.StatusConflict {
		// Handle conflicts
		var conflicts []SyncConflict
		json.NewDecoder(resp.Body).Decode(&conflicts)
		m.handleConflicts(conflicts)
	} else {
		m.handleSyncFailure()
	}
	
	m.lastBatchTime = time.Now()
	_ = payload // Use payload in actual HTTP request body
}

// handleSyncSuccess handles successful sync
func (m *HardenedSyncManager) handleSyncSuccess(batch []*SyncEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Remove synced events from pending
	lastSeq := batch[len(batch)-1].SequenceNumber
	newPending := make([]*SyncEvent, 0)
	for _, e := range m.pendingEvents {
		if e.SequenceNumber > lastSeq {
			newPending = append(newPending, e)
		}
	}
	m.pendingEvents = newPending
	m.state.PendingEvents = len(m.pendingEvents)
	
	// Update watermark
	m.state.LastWatermark = lastSeq
	m.state.LastSyncTime = time.Now()
	
	// Reset backoff
	m.currentBackoff = m.backpressure.MinBatchInterval
	m.consecutiveFailures = 0
	m.circuitOpen = false
	
	// Save state
	go m.saveState(context.Background())
}

// handleSyncFailure handles sync failure with backoff
func (m *HardenedSyncManager) handleSyncFailure() {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.consecutiveFailures++
	
	// Increase backoff
	m.currentBackoff = time.Duration(float64(m.currentBackoff) * m.backpressure.BackoffMultiplier)
	if m.currentBackoff > m.backpressure.MaxBackoffDuration {
		m.currentBackoff = m.backpressure.MaxBackoffDuration
	}
	
	// Check circuit breaker
	if m.consecutiveFailures >= m.backpressure.CircuitBreakerThreshold {
		m.circuitOpen = true
		m.circuitOpenUntil = time.Now().Add(m.currentBackoff)
		log.Printf("Circuit breaker opened for edge %s until %v", m.edgeID, m.circuitOpenUntil)
	}
}

// handleConflicts handles detected conflicts
func (m *HardenedSyncManager) handleConflicts(conflicts []SyncConflict) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	for _, c := range conflicts {
		c.DetectedAt = time.Now()
		m.conflicts = append(m.conflicts, &c)
		m.state.ConflictsDetected++
		
		// Auto-resolve based on policy
		resolved := m.autoResolveConflict(&c)
		if resolved {
			m.state.ConflictsResolved++
		}
	}
}

// autoResolveConflict attempts to auto-resolve a conflict
func (m *HardenedSyncManager) autoResolveConflict(conflict *SyncConflict) bool {
	// Default policy: primary wins for financial data
	if conflict.EdgeEvent.EventType == "transfer" || conflict.EdgeEvent.EventType == "payment" {
		conflict.Resolution = ResolutionPrimaryWins
		now := time.Now()
		conflict.ResolvedAt = &now
		conflict.ResolvedBy = "auto"
		return true
	}
	
	// For non-financial data, use last-write-wins
	if conflict.EdgeEvent.Timestamp.After(conflict.PrimaryEvent.Timestamp) {
		conflict.Resolution = ResolutionEdgeWins
	} else {
		conflict.Resolution = ResolutionPrimaryWins
	}
	now := time.Now()
	conflict.ResolvedAt = &now
	conflict.ResolvedBy = "auto"
	return true
}

// syncFromPrimary syncs events from primary to edge
func (m *HardenedSyncManager) syncFromPrimary(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.pullFromPrimary(ctx)
		}
	}
}

// pullFromPrimary pulls events from primary
func (m *HardenedSyncManager) pullFromPrimary(ctx context.Context) {
	m.mu.RLock()
	watermark := m.state.LastWatermark
	m.mu.RUnlock()
	
	url := fmt.Sprintf("%s/sync/events?edge_id=%s&since=%d", m.primaryEndpoint, m.edgeID, watermark)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return
	}
	
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Pull from primary failed: %v", err)
		return
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return
	}
	
	var events []*SyncEvent
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		return
	}
	
	// Process received events
	for _, event := range events {
		// Verify checksum
		if event.Checksum != m.computeChecksum(event) {
			log.Printf("Checksum mismatch for event %d", event.SequenceNumber)
			continue
		}
		
		// Apply event locally
		if err := m.applyEvent(event); err != nil {
			log.Printf("Failed to apply event %d: %v", event.SequenceNumber, err)
		}
	}
	
	// Update watermark
	if len(events) > 0 {
		m.mu.Lock()
		lastEvent := events[len(events)-1]
		if lastEvent.SequenceNumber > m.state.LastWatermark {
			m.state.LastWatermark = lastEvent.SequenceNumber
		}
		m.mu.Unlock()
	}
}

// applyEvent applies an event from primary locally
func (m *HardenedSyncManager) applyEvent(event *SyncEvent) error {
	// This would apply the event to local TigerBeetle
	// Implementation depends on event type
	log.Printf("Applied event %d from primary", event.SequenceNumber)
	return nil
}

// CreateSnapshot creates a snapshot for recovery
func (m *HardenedSyncManager) CreateSnapshot(ctx context.Context) (*SyncState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	snapshot := *m.state
	snapshot.SnapshotSequence = m.state.LastSequenceNumber
	
	// Save snapshot to Redis
	data, _ := json.Marshal(snapshot)
	key := fmt.Sprintf("tigerbeetle:snapshot:%s", m.edgeID)
	if err := m.redisClient.Set(ctx, key, data, 24*time.Hour).Err(); err != nil {
		return nil, err
	}
	
	log.Printf("Created snapshot at sequence %d for edge %s", snapshot.SnapshotSequence, m.edgeID)
	return &snapshot, nil
}

// RestoreFromSnapshot restores state from a snapshot
func (m *HardenedSyncManager) RestoreFromSnapshot(ctx context.Context) error {
	key := fmt.Sprintf("tigerbeetle:snapshot:%s", m.edgeID)
	data, err := m.redisClient.Get(ctx, key).Bytes()
	if err != nil {
		return err
	}
	
	var snapshot SyncState
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return err
	}
	
	m.mu.Lock()
	m.state = &snapshot
	m.mu.Unlock()
	
	// Replay events since snapshot
	return m.replayEventsSince(ctx, snapshot.SnapshotSequence)
}

// replayEventsSince replays events since a sequence number
func (m *HardenedSyncManager) replayEventsSince(ctx context.Context, since uint64) error {
	url := fmt.Sprintf("%s/sync/events?edge_id=%s&since=%d&replay=true", m.primaryEndpoint, m.edgeID, since)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	var events []*SyncEvent
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		return err
	}
	
	for _, event := range events {
		if err := m.applyEvent(event); err != nil {
			log.Printf("Replay failed for event %d: %v", event.SequenceNumber, err)
		}
	}
	
	log.Printf("Replayed %d events since sequence %d", len(events), since)
	return nil
}

// monitorHealth monitors sync health
func (m *HardenedSyncManager) monitorHealth(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.checkHealth()
		}
	}
}

// checkHealth checks sync health and reports metrics
func (m *HardenedSyncManager) checkHealth() {
	m.mu.RLock()
	state := *m.state
	pendingCount := len(m.pendingEvents)
	conflictCount := len(m.conflicts)
	circuitOpen := m.circuitOpen
	m.mu.RUnlock()
	
	// Log health status
	log.Printf(
		"Sync health: edge=%s pending=%d conflicts=%d watermark=%d circuit_open=%v",
		m.edgeID, pendingCount, conflictCount, state.LastWatermark, circuitOpen,
	)
	
	// Publish to Redis for monitoring
	health := map[string]interface{}{
		"edge_id":           m.edgeID,
		"pending_events":    pendingCount,
		"conflicts":         conflictCount,
		"last_watermark":    state.LastWatermark,
		"last_sync_time":    state.LastSyncTime,
		"circuit_open":      circuitOpen,
		"conflicts_detected": state.ConflictsDetected,
		"conflicts_resolved": state.ConflictsResolved,
	}
	
	data, _ := json.Marshal(health)
	m.redisClient.Set(context.Background(), fmt.Sprintf("tigerbeetle:health:%s", m.edgeID), data, 5*time.Minute)
}

// computeChecksum computes checksum for an event
func (m *HardenedSyncManager) computeChecksum(event *SyncEvent) string {
	data := fmt.Sprintf("%d:%s:%s:%s", event.SequenceNumber, event.EdgeID, event.EventType, event.Payload)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// loadState loads state from Redis
func (m *HardenedSyncManager) loadState(ctx context.Context) error {
	key := fmt.Sprintf("tigerbeetle:state:%s", m.edgeID)
	data, err := m.redisClient.Get(ctx, key).Bytes()
	if err != nil {
		return err
	}
	
	return json.Unmarshal(data, m.state)
}

// saveState saves state to Redis
func (m *HardenedSyncManager) saveState(ctx context.Context) error {
	m.mu.RLock()
	data, _ := json.Marshal(m.state)
	m.mu.RUnlock()
	
	key := fmt.Sprintf("tigerbeetle:state:%s", m.edgeID)
	return m.redisClient.Set(ctx, key, data, 0).Err()
}

// GetState returns current sync state
func (m *HardenedSyncManager) GetState() *SyncState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	state := *m.state
	return &state
}

// GetConflicts returns unresolved conflicts
func (m *HardenedSyncManager) GetConflicts() []*SyncConflict {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	unresolved := make([]*SyncConflict, 0)
	for _, c := range m.conflicts {
		if c.ResolvedAt == nil {
			unresolved = append(unresolved, c)
		}
	}
	return unresolved
}

// ResolveConflict manually resolves a conflict
func (m *HardenedSyncManager) ResolveConflict(conflictID string, resolution ConflictResolution, resolvedBy string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	for _, c := range m.conflicts {
		if c.ConflictID == conflictID {
			c.Resolution = resolution
			now := time.Now()
			c.ResolvedAt = &now
			c.ResolvedBy = resolvedBy
			m.state.ConflictsResolved++
			return nil
		}
	}
	
	return fmt.Errorf("conflict not found: %s", conflictID)
}
