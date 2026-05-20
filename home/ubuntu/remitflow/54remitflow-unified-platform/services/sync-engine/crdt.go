// Package sync provides CRDT (Conflict-free Replicated Data Types) implementations
// for automatic conflict resolution in distributed systems
package sync

import (
	"encoding/json"
	"sync"
	"time"
)

// ============================================================================
// G-Counter (Grow-only Counter)
// ============================================================================

// GCounter is a grow-only counter CRDT
// Each node can only increment, and the value is the sum of all nodes
type GCounter struct {
	mu     sync.RWMutex
	counts map[string]uint64
	nodeID string
}

// NewGCounter creates a new G-Counter
func NewGCounter(nodeID string) *GCounter {
	return &GCounter{
		counts: make(map[string]uint64),
		nodeID: nodeID,
	}
}

// Increment increments the counter for the local node
func (gc *GCounter) Increment(delta uint64) {
	gc.mu.Lock()
	defer gc.mu.Unlock()
	gc.counts[gc.nodeID] += delta
}

// Value returns the total count across all nodes
func (gc *GCounter) Value() uint64 {
	gc.mu.RLock()
	defer gc.mu.RUnlock()
	
	var total uint64
	for _, count := range gc.counts {
		total += count
	}
	return total
}

// Merge merges another G-Counter into this one
func (gc *GCounter) Merge(other *GCounter) {
	gc.mu.Lock()
	defer gc.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	for nodeID, count := range other.counts {
		if count > gc.counts[nodeID] {
			gc.counts[nodeID] = count
		}
	}
}

// ToMap returns the counter state as a map
func (gc *GCounter) ToMap() map[string]uint64 {
	gc.mu.RLock()
	defer gc.mu.RUnlock()
	
	result := make(map[string]uint64)
	for k, v := range gc.counts {
		result[k] = v
	}
	return result
}

// FromMap sets the counter state from a map
func (gc *GCounter) FromMap(m map[string]uint64) {
	gc.mu.Lock()
	defer gc.mu.Unlock()
	
	gc.counts = make(map[string]uint64)
	for k, v := range m {
		gc.counts[k] = v
	}
}

// ============================================================================
// PN-Counter (Positive-Negative Counter)
// ============================================================================

// PNCounter is a counter that supports both increment and decrement
type PNCounter struct {
	positive *GCounter
	negative *GCounter
	nodeID   string
}

// NewPNCounter creates a new PN-Counter
func NewPNCounter(nodeID string) *PNCounter {
	return &PNCounter{
		positive: NewGCounter(nodeID),
		negative: NewGCounter(nodeID),
		nodeID:   nodeID,
	}
}

// Increment increases the counter
func (pn *PNCounter) Increment(delta uint64) {
	pn.positive.Increment(delta)
}

// Decrement decreases the counter
func (pn *PNCounter) Decrement(delta uint64) {
	pn.negative.Increment(delta)
}

// Value returns the current value (positive - negative)
func (pn *PNCounter) Value() int64 {
	return int64(pn.positive.Value()) - int64(pn.negative.Value())
}

// Merge merges another PN-Counter
func (pn *PNCounter) Merge(other *PNCounter) {
	pn.positive.Merge(other.positive)
	pn.negative.Merge(other.negative)
}

// ============================================================================
// LWW-Register (Last-Writer-Wins Register)
// ============================================================================

// LWWRegister is a register where the last write wins based on timestamp
type LWWRegister struct {
	mu        sync.RWMutex
	value     interface{}
	timestamp time.Time
	nodeID    string
}

// NewLWWRegister creates a new LWW-Register
func NewLWWRegister(nodeID string) *LWWRegister {
	return &LWWRegister{
		nodeID: nodeID,
	}
}

// Set sets the value with current timestamp
func (r *LWWRegister) Set(value interface{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	r.value = value
	r.timestamp = time.Now()
}

// SetWithTimestamp sets the value with a specific timestamp
func (r *LWWRegister) SetWithTimestamp(value interface{}, ts time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	if ts.After(r.timestamp) {
		r.value = value
		r.timestamp = ts
	}
}

// Get returns the current value
func (r *LWWRegister) Get() interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.value
}

// GetTimestamp returns the current timestamp
func (r *LWWRegister) GetTimestamp() time.Time {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.timestamp
}

// Merge merges another LWW-Register
func (r *LWWRegister) Merge(other *LWWRegister) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	if other.timestamp.After(r.timestamp) {
		r.value = other.value
		r.timestamp = other.timestamp
	}
}

// ============================================================================
// G-Set (Grow-only Set)
// ============================================================================

// GSet is a grow-only set CRDT
type GSet struct {
	mu       sync.RWMutex
	elements map[string]bool
}

// NewGSet creates a new G-Set
func NewGSet() *GSet {
	return &GSet{
		elements: make(map[string]bool),
	}
}

// Add adds an element to the set
func (gs *GSet) Add(element string) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.elements[element] = true
}

// Contains checks if an element is in the set
func (gs *GSet) Contains(element string) bool {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.elements[element]
}

// Elements returns all elements in the set
func (gs *GSet) Elements() []string {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	
	result := make([]string, 0, len(gs.elements))
	for element := range gs.elements {
		result = append(result, element)
	}
	return result
}

// Merge merges another G-Set
func (gs *GSet) Merge(other *GSet) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	for element := range other.elements {
		gs.elements[element] = true
	}
}

// ============================================================================
// 2P-Set (Two-Phase Set)
// ============================================================================

// TwoPSet is a set that supports add and remove (but removed elements cannot be re-added)
type TwoPSet struct {
	added   *GSet
	removed *GSet
}

// NewTwoPSet creates a new 2P-Set
func NewTwoPSet() *TwoPSet {
	return &TwoPSet{
		added:   NewGSet(),
		removed: NewGSet(),
	}
}

// Add adds an element to the set
func (tps *TwoPSet) Add(element string) {
	tps.added.Add(element)
}

// Remove removes an element from the set
func (tps *TwoPSet) Remove(element string) {
	tps.removed.Add(element)
}

// Contains checks if an element is in the set
func (tps *TwoPSet) Contains(element string) bool {
	return tps.added.Contains(element) && !tps.removed.Contains(element)
}

// Elements returns all elements in the set
func (tps *TwoPSet) Elements() []string {
	added := tps.added.Elements()
	result := make([]string, 0)
	
	for _, element := range added {
		if !tps.removed.Contains(element) {
			result = append(result, element)
		}
	}
	return result
}

// Merge merges another 2P-Set
func (tps *TwoPSet) Merge(other *TwoPSet) {
	tps.added.Merge(other.added)
	tps.removed.Merge(other.removed)
}

// ============================================================================
// OR-Set (Observed-Remove Set)
// ============================================================================

// ORSetElement represents an element with unique tags
type ORSetElement struct {
	Value string            `json:"value"`
	Tags  map[string]bool   `json:"tags"` // Unique tags for each add operation
}

// ORSet is an observed-remove set that allows re-adding removed elements
type ORSet struct {
	mu       sync.RWMutex
	elements map[string]*ORSetElement
	nodeID   string
	counter  uint64
}

// NewORSet creates a new OR-Set
func NewORSet(nodeID string) *ORSet {
	return &ORSet{
		elements: make(map[string]*ORSetElement),
		nodeID:   nodeID,
	}
}

// Add adds an element to the set
func (os *ORSet) Add(value string) {
	os.mu.Lock()
	defer os.mu.Unlock()
	
	os.counter++
	tag := os.nodeID + "-" + string(rune(os.counter))
	
	if elem, exists := os.elements[value]; exists {
		elem.Tags[tag] = true
	} else {
		os.elements[value] = &ORSetElement{
			Value: value,
			Tags:  map[string]bool{tag: true},
		}
	}
}

// Remove removes an element from the set
func (os *ORSet) Remove(value string) {
	os.mu.Lock()
	defer os.mu.Unlock()
	
	delete(os.elements, value)
}

// Contains checks if an element is in the set
func (os *ORSet) Contains(value string) bool {
	os.mu.RLock()
	defer os.mu.RUnlock()
	
	elem, exists := os.elements[value]
	return exists && len(elem.Tags) > 0
}

// Elements returns all elements in the set
func (os *ORSet) Elements() []string {
	os.mu.RLock()
	defer os.mu.RUnlock()
	
	result := make([]string, 0, len(os.elements))
	for value, elem := range os.elements {
		if len(elem.Tags) > 0 {
			result = append(result, value)
		}
	}
	return result
}

// Merge merges another OR-Set
func (os *ORSet) Merge(other *ORSet) {
	os.mu.Lock()
	defer os.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	for value, otherElem := range other.elements {
		if elem, exists := os.elements[value]; exists {
			// Merge tags
			for tag := range otherElem.Tags {
				elem.Tags[tag] = true
			}
		} else {
			// Copy element
			os.elements[value] = &ORSetElement{
				Value: otherElem.Value,
				Tags:  make(map[string]bool),
			}
			for tag := range otherElem.Tags {
				os.elements[value].Tags[tag] = true
			}
		}
	}
}

// ============================================================================
// LWW-Map (Last-Writer-Wins Map)
// ============================================================================

// LWWMapEntry represents a map entry with timestamp
type LWWMapEntry struct {
	Value     interface{} `json:"value"`
	Timestamp time.Time   `json:"timestamp"`
	Deleted   bool        `json:"deleted"`
}

// LWWMap is a map where the last write wins for each key
type LWWMap struct {
	mu      sync.RWMutex
	entries map[string]*LWWMapEntry
	nodeID  string
}

// NewLWWMap creates a new LWW-Map
func NewLWWMap(nodeID string) *LWWMap {
	return &LWWMap{
		entries: make(map[string]*LWWMapEntry),
		nodeID:  nodeID,
	}
}

// Set sets a key-value pair
func (m *LWWMap) Set(key string, value interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.entries[key] = &LWWMapEntry{
		Value:     value,
		Timestamp: time.Now(),
		Deleted:   false,
	}
}

// SetWithTimestamp sets a key-value pair with a specific timestamp
func (m *LWWMap) SetWithTimestamp(key string, value interface{}, ts time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	existing, exists := m.entries[key]
	if !exists || ts.After(existing.Timestamp) {
		m.entries[key] = &LWWMapEntry{
			Value:     value,
			Timestamp: ts,
			Deleted:   false,
		}
	}
}

// Delete deletes a key
func (m *LWWMap) Delete(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.entries[key] = &LWWMapEntry{
		Value:     nil,
		Timestamp: time.Now(),
		Deleted:   true,
	}
}

// Get gets a value by key
func (m *LWWMap) Get(key string) (interface{}, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	entry, exists := m.entries[key]
	if !exists || entry.Deleted {
		return nil, false
	}
	return entry.Value, true
}

// Keys returns all non-deleted keys
func (m *LWWMap) Keys() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	result := make([]string, 0)
	for key, entry := range m.entries {
		if !entry.Deleted {
			result = append(result, key)
		}
	}
	return result
}

// Merge merges another LWW-Map
func (m *LWWMap) Merge(other *LWWMap) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	other.mu.RLock()
	defer other.mu.RUnlock()
	
	for key, otherEntry := range other.entries {
		existing, exists := m.entries[key]
		if !exists || otherEntry.Timestamp.After(existing.Timestamp) {
			m.entries[key] = &LWWMapEntry{
				Value:     otherEntry.Value,
				Timestamp: otherEntry.Timestamp,
				Deleted:   otherEntry.Deleted,
			}
		}
	}
}

// ToJSON serializes the map to JSON
func (m *LWWMap) ToJSON() ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return json.Marshal(m.entries)
}

// FromJSON deserializes the map from JSON
func (m *LWWMap) FromJSON(data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return json.Unmarshal(data, &m.entries)
}

// ============================================================================
// CRDT-based Transaction State
// ============================================================================

// TransactionState represents a transaction's state using CRDTs
type TransactionState struct {
	ID            string       `json:"id"`
	Amount        *PNCounter   `json:"-"` // Amount can be adjusted
	Status        *LWWRegister `json:"-"` // Last status wins
	Metadata      *LWWMap      `json:"-"` // Metadata map
	ProcessedBy   *GSet        `json:"-"` // Set of nodes that processed
	nodeID        string
}

// NewTransactionState creates a new transaction state
func NewTransactionState(id, nodeID string) *TransactionState {
	return &TransactionState{
		ID:          id,
		Amount:      NewPNCounter(nodeID),
		Status:      NewLWWRegister(nodeID),
		Metadata:    NewLWWMap(nodeID),
		ProcessedBy: NewGSet(),
		nodeID:      nodeID,
	}
}

// SetAmount sets the transaction amount
func (ts *TransactionState) SetAmount(amount int64) {
	if amount >= 0 {
		ts.Amount.Increment(uint64(amount))
	} else {
		ts.Amount.Decrement(uint64(-amount))
	}
}

// GetAmount returns the transaction amount
func (ts *TransactionState) GetAmount() int64 {
	return ts.Amount.Value()
}

// SetStatus sets the transaction status
func (ts *TransactionState) SetStatus(status string) {
	ts.Status.Set(status)
}

// GetStatus returns the transaction status
func (ts *TransactionState) GetStatus() string {
	if status := ts.Status.Get(); status != nil {
		return status.(string)
	}
	return ""
}

// SetMetadata sets a metadata field
func (ts *TransactionState) SetMetadata(key string, value interface{}) {
	ts.Metadata.Set(key, value)
}

// GetMetadata gets a metadata field
func (ts *TransactionState) GetMetadata(key string) (interface{}, bool) {
	return ts.Metadata.Get(key)
}

// MarkProcessed marks the transaction as processed by the local node
func (ts *TransactionState) MarkProcessed() {
	ts.ProcessedBy.Add(ts.nodeID)
}

// IsProcessedBy checks if the transaction was processed by a node
func (ts *TransactionState) IsProcessedBy(nodeID string) bool {
	return ts.ProcessedBy.Contains(nodeID)
}

// Merge merges another transaction state
func (ts *TransactionState) Merge(other *TransactionState) {
	ts.Amount.Merge(other.Amount)
	ts.Status.Merge(other.Status)
	ts.Metadata.Merge(other.Metadata)
	ts.ProcessedBy.Merge(other.ProcessedBy)
}
