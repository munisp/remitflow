// Package sync provides distributed synchronization primitives
// including vector clocks for proper distributed ordering
package sync

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// VectorClock implements a vector clock for distributed ordering
// Each node maintains a counter, and the clock is a map of node IDs to counters
type VectorClock struct {
	mu     sync.RWMutex
	clocks map[string]uint64
	nodeID string
}

// NewVectorClock creates a new vector clock for the given node
func NewVectorClock(nodeID string) *VectorClock {
	return &VectorClock{
		clocks: make(map[string]uint64),
		nodeID: nodeID,
	}
}

// Increment increments the local node's clock
func (vc *VectorClock) Increment() {
	vc.mu.Lock()
	defer vc.mu.Unlock()
	vc.clocks[vc.nodeID]++
}

// Get returns the current clock value for a node
func (vc *VectorClock) Get(nodeID string) uint64 {
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	return vc.clocks[nodeID]
}

// GetLocal returns the local node's clock value
func (vc *VectorClock) GetLocal() uint64 {
	return vc.Get(vc.nodeID)
}

// Merge merges another vector clock into this one (taking max of each component)
func (vc *VectorClock) Merge(other *VectorClock) {
	vc.mu.Lock()
	defer vc.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	for nodeID, clock := range other.clocks {
		if clock > vc.clocks[nodeID] {
			vc.clocks[nodeID] = clock
		}
	}
}

// Compare compares two vector clocks
// Returns:
//   -1 if vc < other (vc happened before other)
//    0 if vc || other (concurrent)
//    1 if vc > other (vc happened after other)
func (vc *VectorClock) Compare(other *VectorClock) int {
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	less := false
	greater := false
	
	// Check all nodes in vc
	for nodeID, clock := range vc.clocks {
		otherClock := other.clocks[nodeID]
		if clock < otherClock {
			less = true
		} else if clock > otherClock {
			greater = true
		}
	}
	
	// Check nodes only in other
	for nodeID, otherClock := range other.clocks {
		if _, exists := vc.clocks[nodeID]; !exists {
			if otherClock > 0 {
				less = true
			}
		}
	}
	
	if less && !greater {
		return -1 // vc happened before other
	} else if greater && !less {
		return 1 // vc happened after other
	}
	return 0 // concurrent
}

// HappenedBefore returns true if vc happened before other
func (vc *VectorClock) HappenedBefore(other *VectorClock) bool {
	return vc.Compare(other) == -1
}

// HappenedAfter returns true if vc happened after other
func (vc *VectorClock) HappenedAfter(other *VectorClock) bool {
	return vc.Compare(other) == 1
}

// Concurrent returns true if vc and other are concurrent
func (vc *VectorClock) Concurrent(other *VectorClock) bool {
	return vc.Compare(other) == 0
}

// Clone creates a deep copy of the vector clock
func (vc *VectorClock) Clone() *VectorClock {
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	
	clone := &VectorClock{
		clocks: make(map[string]uint64),
		nodeID: vc.nodeID,
	}
	
	for k, v := range vc.clocks {
		clone.clocks[k] = v
	}
	
	return clone
}

// ToMap returns the clock as a map (for serialization)
func (vc *VectorClock) ToMap() map[string]uint64 {
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	
	result := make(map[string]uint64)
	for k, v := range vc.clocks {
		result[k] = v
	}
	return result
}

// FromMap sets the clock from a map (for deserialization)
func (vc *VectorClock) FromMap(m map[string]uint64) {
	vc.mu.Lock()
	defer vc.mu.Unlock()
	
	vc.clocks = make(map[string]uint64)
	for k, v := range m {
		vc.clocks[k] = v
	}
}

// MarshalJSON implements json.Marshaler
func (vc *VectorClock) MarshalJSON() ([]byte, error) {
	return json.Marshal(vc.ToMap())
}

// UnmarshalJSON implements json.Unmarshaler
func (vc *VectorClock) UnmarshalJSON(data []byte) error {
	var m map[string]uint64
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	vc.FromMap(m)
	return nil
}

// String returns a string representation of the vector clock
func (vc *VectorClock) String() string {
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	return fmt.Sprintf("VectorClock{node=%s, clocks=%v}", vc.nodeID, vc.clocks)
}

// VersionedValue wraps a value with its vector clock
type VersionedValue struct {
	Value     interface{}  `json:"value"`
	Clock     *VectorClock `json:"clock"`
	Timestamp time.Time    `json:"timestamp"`
	NodeID    string       `json:"node_id"`
}

// NewVersionedValue creates a new versioned value
func NewVersionedValue(value interface{}, clock *VectorClock, nodeID string) *VersionedValue {
	return &VersionedValue{
		Value:     value,
		Clock:     clock.Clone(),
		Timestamp: time.Now(),
		NodeID:    nodeID,
	}
}

// VersionedStore provides a key-value store with vector clock versioning
type VersionedStore struct {
	mu      sync.RWMutex
	data    map[string]*VersionedValue
	clock   *VectorClock
	nodeID  string
	history map[string][]*VersionedValue // Keep history for conflict resolution
}

// NewVersionedStore creates a new versioned store
func NewVersionedStore(nodeID string) *VersionedStore {
	return &VersionedStore{
		data:    make(map[string]*VersionedValue),
		clock:   NewVectorClock(nodeID),
		nodeID:  nodeID,
		history: make(map[string][]*VersionedValue),
	}
}

// Put stores a value with vector clock versioning
func (vs *VersionedStore) Put(key string, value interface{}) *VersionedValue {
	vs.mu.Lock()
	defer vs.mu.Unlock()
	
	// Increment clock
	vs.clock.Increment()
	
	// Create versioned value
	vv := NewVersionedValue(value, vs.clock, vs.nodeID)
	
	// Store in history
	vs.history[key] = append(vs.history[key], vv)
	
	// Store current value
	vs.data[key] = vv
	
	return vv
}

// Get retrieves a value
func (vs *VersionedStore) Get(key string) (*VersionedValue, bool) {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	
	vv, exists := vs.data[key]
	return vv, exists
}

// Merge merges a remote versioned value
// Returns the winning value and whether there was a conflict
func (vs *VersionedStore) Merge(key string, remote *VersionedValue) (*VersionedValue, bool) {
	vs.mu.Lock()
	defer vs.mu.Unlock()
	
	local, exists := vs.data[key]
	
	if !exists {
		// No local value, accept remote
		vs.data[key] = remote
		vs.clock.Merge(remote.Clock)
		vs.history[key] = append(vs.history[key], remote)
		return remote, false
	}
	
	// Compare vector clocks
	comparison := local.Clock.Compare(remote.Clock)
	
	switch comparison {
	case -1:
		// Local happened before remote, accept remote
		vs.data[key] = remote
		vs.clock.Merge(remote.Clock)
		vs.history[key] = append(vs.history[key], remote)
		return remote, false
		
	case 1:
		// Local happened after remote, keep local
		return local, false
		
	default:
		// Concurrent - conflict!
		// Default resolution: use timestamp as tiebreaker
		if remote.Timestamp.After(local.Timestamp) {
			vs.data[key] = remote
			vs.clock.Merge(remote.Clock)
			vs.history[key] = append(vs.history[key], remote)
			return remote, true
		}
		return local, true
	}
}

// GetHistory returns the history of values for a key
func (vs *VersionedStore) GetHistory(key string) []*VersionedValue {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	
	return vs.history[key]
}

// GetClock returns the current vector clock
func (vs *VersionedStore) GetClock() *VectorClock {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	return vs.clock.Clone()
}

// SyncEvent represents a sync event with vector clock
type SyncEvent struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Key       string                 `json:"key"`
	Value     interface{}            `json:"value"`
	Clock     map[string]uint64      `json:"clock"`
	Timestamp time.Time              `json:"timestamp"`
	NodeID    string                 `json:"node_id"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// SyncManager manages synchronization with vector clocks
type SyncManager struct {
	mu           sync.RWMutex
	nodeID       string
	clock        *VectorClock
	pendingSync  []*SyncEvent
	syncHandlers []func(*SyncEvent)
}

// NewSyncManager creates a new sync manager
func NewSyncManager(nodeID string) *SyncManager {
	return &SyncManager{
		nodeID:       nodeID,
		clock:        NewVectorClock(nodeID),
		pendingSync:  make([]*SyncEvent, 0),
		syncHandlers: make([]func(*SyncEvent), 0),
	}
}

// CreateEvent creates a new sync event
func (sm *SyncManager) CreateEvent(eventType, key string, value interface{}, metadata map[string]interface{}) *SyncEvent {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	sm.clock.Increment()
	
	event := &SyncEvent{
		ID:        fmt.Sprintf("%s-%d-%d", sm.nodeID, time.Now().UnixNano(), sm.clock.GetLocal()),
		Type:      eventType,
		Key:       key,
		Value:     value,
		Clock:     sm.clock.ToMap(),
		Timestamp: time.Now(),
		NodeID:    sm.nodeID,
		Metadata:  metadata,
	}
	
	sm.pendingSync = append(sm.pendingSync, event)
	
	return event
}

// ReceiveEvent processes a received sync event
func (sm *SyncManager) ReceiveEvent(event *SyncEvent) (bool, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	// Create vector clock from event
	remoteClock := NewVectorClock(event.NodeID)
	remoteClock.FromMap(event.Clock)
	
	// Merge clocks
	sm.clock.Merge(remoteClock)
	sm.clock.Increment()
	
	// Notify handlers
	for _, handler := range sm.syncHandlers {
		handler(event)
	}
	
	return true, nil
}

// GetPendingEvents returns pending sync events
func (sm *SyncManager) GetPendingEvents() []*SyncEvent {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	
	result := make([]*SyncEvent, len(sm.pendingSync))
	copy(result, sm.pendingSync)
	return result
}

// ClearPendingEvents clears pending sync events
func (sm *SyncManager) ClearPendingEvents() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.pendingSync = make([]*SyncEvent, 0)
}

// AddSyncHandler adds a handler for sync events
func (sm *SyncManager) AddSyncHandler(handler func(*SyncEvent)) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.syncHandlers = append(sm.syncHandlers, handler)
}

// GetClock returns the current vector clock
func (sm *SyncManager) GetClock() map[string]uint64 {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.clock.ToMap()
}
