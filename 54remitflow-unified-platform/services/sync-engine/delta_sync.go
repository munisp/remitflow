// Package sync provides delta synchronization to reduce bandwidth
// Only changed fields are transmitted instead of full records
package sync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"time"
)

// DeltaOperation represents a single change operation
type DeltaOperation string

const (
	DeltaOpSet    DeltaOperation = "set"
	DeltaOpDelete DeltaOperation = "delete"
	DeltaOpAppend DeltaOperation = "append"
	DeltaOpRemove DeltaOperation = "remove"
	DeltaOpIncr   DeltaOperation = "incr"
	DeltaOpDecr   DeltaOperation = "decr"
)

// Delta represents a single field change
type Delta struct {
	Path      string         `json:"path"`       // JSON path to the field (e.g., "user.address.city")
	Operation DeltaOperation `json:"operation"`  // Type of operation
	Value     interface{}    `json:"value"`      // New value (for set/append operations)
	OldValue  interface{}    `json:"old_value"`  // Previous value (for conflict detection)
	Timestamp time.Time      `json:"timestamp"`  // When the change occurred
	NodeID    string         `json:"node_id"`    // Which node made the change
	Checksum  string         `json:"checksum"`   // Checksum of the value
}

// DeltaSet represents a collection of deltas for a single entity
type DeltaSet struct {
	EntityID   string    `json:"entity_id"`
	EntityType string    `json:"entity_type"`
	BaseHash   string    `json:"base_hash"`    // Hash of the base state
	Deltas     []*Delta  `json:"deltas"`
	Timestamp  time.Time `json:"timestamp"`
	NodeID     string    `json:"node_id"`
	Sequence   uint64    `json:"sequence"`
}

// DeltaTracker tracks changes to entities
type DeltaTracker struct {
	mu           sync.RWMutex
	nodeID       string
	baseStates   map[string]map[string]interface{} // entityID -> base state
	baseHashes   map[string]string                 // entityID -> hash of base state
	pendingDeltas map[string][]*Delta              // entityID -> pending deltas
	sequence     uint64
}

// NewDeltaTracker creates a new delta tracker
func NewDeltaTracker(nodeID string) *DeltaTracker {
	return &DeltaTracker{
		nodeID:        nodeID,
		baseStates:    make(map[string]map[string]interface{}),
		baseHashes:    make(map[string]string),
		pendingDeltas: make(map[string][]*Delta),
	}
}

// SetBaseState sets the base state for an entity
func (dt *DeltaTracker) SetBaseState(entityID string, state map[string]interface{}) {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	
	dt.baseStates[entityID] = deepCopy(state)
	dt.baseHashes[entityID] = hashState(state)
	dt.pendingDeltas[entityID] = make([]*Delta, 0)
}

// TrackChange tracks a change to an entity field
func (dt *DeltaTracker) TrackChange(entityID, path string, op DeltaOperation, newValue, oldValue interface{}) *Delta {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	
	delta := &Delta{
		Path:      path,
		Operation: op,
		Value:     newValue,
		OldValue:  oldValue,
		Timestamp: time.Now(),
		NodeID:    dt.nodeID,
		Checksum:  hashValue(newValue),
	}
	
	dt.pendingDeltas[entityID] = append(dt.pendingDeltas[entityID], delta)
	return delta
}

// GetPendingDeltas returns pending deltas for an entity
func (dt *DeltaTracker) GetPendingDeltas(entityID string) *DeltaSet {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	
	deltas := dt.pendingDeltas[entityID]
	if len(deltas) == 0 {
		return nil
	}
	
	dt.sequence++
	
	return &DeltaSet{
		EntityID:   entityID,
		EntityType: "generic",
		BaseHash:   dt.baseHashes[entityID],
		Deltas:     deltas,
		Timestamp:  time.Now(),
		NodeID:     dt.nodeID,
		Sequence:   dt.sequence,
	}
}

// ClearPendingDeltas clears pending deltas for an entity
func (dt *DeltaTracker) ClearPendingDeltas(entityID string) {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	dt.pendingDeltas[entityID] = make([]*Delta, 0)
}

// ComputeDelta computes the delta between two states
func (dt *DeltaTracker) ComputeDelta(entityID string, oldState, newState map[string]interface{}) []*Delta {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	
	deltas := make([]*Delta, 0)
	
	// Find changed and new fields
	for key, newValue := range newState {
		oldValue, exists := oldState[key]
		
		if !exists {
			// New field
			deltas = append(deltas, &Delta{
				Path:      key,
				Operation: DeltaOpSet,
				Value:     newValue,
				OldValue:  nil,
				Timestamp: time.Now(),
				NodeID:    dt.nodeID,
				Checksum:  hashValue(newValue),
			})
		} else if !reflect.DeepEqual(oldValue, newValue) {
			// Changed field
			deltas = append(deltas, &Delta{
				Path:      key,
				Operation: DeltaOpSet,
				Value:     newValue,
				OldValue:  oldValue,
				Timestamp: time.Now(),
				NodeID:    dt.nodeID,
				Checksum:  hashValue(newValue),
			})
		}
	}
	
	// Find deleted fields
	for key, oldValue := range oldState {
		if _, exists := newState[key]; !exists {
			deltas = append(deltas, &Delta{
				Path:      key,
				Operation: DeltaOpDelete,
				Value:     nil,
				OldValue:  oldValue,
				Timestamp: time.Now(),
				NodeID:    dt.nodeID,
			})
		}
	}
	
	return deltas
}

// ApplyDeltas applies a set of deltas to a state
func (dt *DeltaTracker) ApplyDeltas(state map[string]interface{}, deltas []*Delta) (map[string]interface{}, error) {
	result := deepCopy(state)
	
	for _, delta := range deltas {
		switch delta.Operation {
		case DeltaOpSet:
			result[delta.Path] = delta.Value
		case DeltaOpDelete:
			delete(result, delta.Path)
		case DeltaOpIncr:
			if val, ok := result[delta.Path].(float64); ok {
				if incr, ok := delta.Value.(float64); ok {
					result[delta.Path] = val + incr
				}
			}
		case DeltaOpDecr:
			if val, ok := result[delta.Path].(float64); ok {
				if decr, ok := delta.Value.(float64); ok {
					result[delta.Path] = val - decr
				}
			}
		case DeltaOpAppend:
			if arr, ok := result[delta.Path].([]interface{}); ok {
				result[delta.Path] = append(arr, delta.Value)
			}
		case DeltaOpRemove:
			if arr, ok := result[delta.Path].([]interface{}); ok {
				newArr := make([]interface{}, 0)
				for _, item := range arr {
					if !reflect.DeepEqual(item, delta.Value) {
						newArr = append(newArr, item)
					}
				}
				result[delta.Path] = newArr
			}
		}
	}
	
	return result, nil
}

// DeltaSyncManager manages delta synchronization
type DeltaSyncManager struct {
	mu            sync.RWMutex
	nodeID        string
	tracker       *DeltaTracker
	sentDeltas    map[string]map[uint64]*DeltaSet // entityID -> sequence -> deltaSet
	receivedSeqs  map[string]map[string]uint64   // entityID -> nodeID -> last received sequence
	conflictQueue []*DeltaConflict
}

// DeltaConflict represents a conflict between deltas
type DeltaConflict struct {
	EntityID    string    `json:"entity_id"`
	Path        string    `json:"path"`
	LocalDelta  *Delta    `json:"local_delta"`
	RemoteDelta *Delta    `json:"remote_delta"`
	DetectedAt  time.Time `json:"detected_at"`
	Resolved    bool      `json:"resolved"`
	Resolution  string    `json:"resolution"` // "local", "remote", "merge"
}

// NewDeltaSyncManager creates a new delta sync manager
func NewDeltaSyncManager(nodeID string) *DeltaSyncManager {
	return &DeltaSyncManager{
		nodeID:       nodeID,
		tracker:      NewDeltaTracker(nodeID),
		sentDeltas:   make(map[string]map[uint64]*DeltaSet),
		receivedSeqs: make(map[string]map[string]uint64),
		conflictQueue: make([]*DeltaConflict, 0),
	}
}

// TrackEntity starts tracking an entity
func (dsm *DeltaSyncManager) TrackEntity(entityID string, initialState map[string]interface{}) {
	dsm.tracker.SetBaseState(entityID, initialState)
}

// RecordChange records a change to an entity
func (dsm *DeltaSyncManager) RecordChange(entityID, path string, op DeltaOperation, newValue, oldValue interface{}) {
	dsm.tracker.TrackChange(entityID, path, op, newValue, oldValue)
}

// GetSyncPayload returns the delta payload for synchronization
func (dsm *DeltaSyncManager) GetSyncPayload(entityID string) *DeltaSet {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()
	
	deltaSet := dsm.tracker.GetPendingDeltas(entityID)
	if deltaSet == nil {
		return nil
	}
	
	// Store for potential retransmission
	if dsm.sentDeltas[entityID] == nil {
		dsm.sentDeltas[entityID] = make(map[uint64]*DeltaSet)
	}
	dsm.sentDeltas[entityID][deltaSet.Sequence] = deltaSet
	
	return deltaSet
}

// ReceiveDeltas processes received deltas
func (dsm *DeltaSyncManager) ReceiveDeltas(deltaSet *DeltaSet, currentState map[string]interface{}) (map[string]interface{}, []*DeltaConflict, error) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()
	
	// Check sequence
	if dsm.receivedSeqs[deltaSet.EntityID] == nil {
		dsm.receivedSeqs[deltaSet.EntityID] = make(map[string]uint64)
	}
	
	lastSeq := dsm.receivedSeqs[deltaSet.EntityID][deltaSet.NodeID]
	if deltaSet.Sequence <= lastSeq {
		// Already received, skip
		return currentState, nil, nil
	}
	
	// Check for conflicts with pending local deltas
	localDeltas := dsm.tracker.pendingDeltas[deltaSet.EntityID]
	conflicts := make([]*DeltaConflict, 0)
	
	for _, remoteDelta := range deltaSet.Deltas {
		for _, localDelta := range localDeltas {
			if localDelta.Path == remoteDelta.Path {
				// Conflict detected
				conflict := &DeltaConflict{
					EntityID:    deltaSet.EntityID,
					Path:        remoteDelta.Path,
					LocalDelta:  localDelta,
					RemoteDelta: remoteDelta,
					DetectedAt:  time.Now(),
				}
				conflicts = append(conflicts, conflict)
			}
		}
	}
	
	// Apply non-conflicting deltas
	nonConflictingDeltas := make([]*Delta, 0)
	conflictPaths := make(map[string]bool)
	for _, c := range conflicts {
		conflictPaths[c.Path] = true
	}
	
	for _, delta := range deltaSet.Deltas {
		if !conflictPaths[delta.Path] {
			nonConflictingDeltas = append(nonConflictingDeltas, delta)
		}
	}
	
	newState, err := dsm.tracker.ApplyDeltas(currentState, nonConflictingDeltas)
	if err != nil {
		return currentState, conflicts, err
	}
	
	// Update received sequence
	dsm.receivedSeqs[deltaSet.EntityID][deltaSet.NodeID] = deltaSet.Sequence
	
	return newState, conflicts, nil
}

// AcknowledgeDeltas acknowledges received deltas
func (dsm *DeltaSyncManager) AcknowledgeDeltas(entityID string, sequence uint64) {
	dsm.mu.Lock()
	defer dsm.mu.Unlock()
	
	// Clear acknowledged deltas
	if dsm.sentDeltas[entityID] != nil {
		for seq := range dsm.sentDeltas[entityID] {
			if seq <= sequence {
				delete(dsm.sentDeltas[entityID], seq)
			}
		}
	}
	
	// Clear pending deltas that have been acknowledged
	dsm.tracker.ClearPendingDeltas(entityID)
}

// GetUnacknowledgedDeltas returns deltas that haven't been acknowledged
func (dsm *DeltaSyncManager) GetUnacknowledgedDeltas(entityID string) []*DeltaSet {
	dsm.mu.RLock()
	defer dsm.mu.RUnlock()
	
	result := make([]*DeltaSet, 0)
	if dsm.sentDeltas[entityID] != nil {
		for _, deltaSet := range dsm.sentDeltas[entityID] {
			result = append(result, deltaSet)
		}
	}
	return result
}

// Helper functions

func deepCopy(src map[string]interface{}) map[string]interface{} {
	data, _ := json.Marshal(src)
	var dst map[string]interface{}
	json.Unmarshal(data, &dst)
	return dst
}

func hashState(state map[string]interface{}) string {
	data, _ := json.Marshal(state)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func hashValue(value interface{}) string {
	data, _ := json.Marshal(value)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:8]) // Short hash
}

// DeltaCompressor compresses deltas for transmission
type DeltaCompressor struct {
	mu sync.RWMutex
}

// NewDeltaCompressor creates a new delta compressor
func NewDeltaCompressor() *DeltaCompressor {
	return &DeltaCompressor{}
}

// CompressDeltas combines multiple deltas for the same path
func (dc *DeltaCompressor) CompressDeltas(deltas []*Delta) []*Delta {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	
	// Group by path
	pathDeltas := make(map[string][]*Delta)
	for _, delta := range deltas {
		pathDeltas[delta.Path] = append(pathDeltas[delta.Path], delta)
	}
	
	// Compress each path
	result := make([]*Delta, 0)
	for path, pathDeltaList := range pathDeltas {
		if len(pathDeltaList) == 1 {
			result = append(result, pathDeltaList[0])
			continue
		}
		
		// Take the last delta for set/delete operations
		lastDelta := pathDeltaList[len(pathDeltaList)-1]
		
		// For increment/decrement, sum them up
		if lastDelta.Operation == DeltaOpIncr || lastDelta.Operation == DeltaOpDecr {
			var total float64
			for _, d := range pathDeltaList {
				if val, ok := d.Value.(float64); ok {
					if d.Operation == DeltaOpIncr {
						total += val
					} else {
						total -= val
					}
				}
			}
			
			if total >= 0 {
				result = append(result, &Delta{
					Path:      path,
					Operation: DeltaOpIncr,
					Value:     total,
					Timestamp: lastDelta.Timestamp,
					NodeID:    lastDelta.NodeID,
				})
			} else {
				result = append(result, &Delta{
					Path:      path,
					Operation: DeltaOpDecr,
					Value:     -total,
					Timestamp: lastDelta.Timestamp,
					NodeID:    lastDelta.NodeID,
				})
			}
		} else {
			// For set/delete, just use the last one
			result = append(result, &Delta{
				Path:      path,
				Operation: lastDelta.Operation,
				Value:     lastDelta.Value,
				OldValue:  pathDeltaList[0].OldValue, // Keep original old value
				Timestamp: lastDelta.Timestamp,
				NodeID:    lastDelta.NodeID,
				Checksum:  lastDelta.Checksum,
			})
		}
	}
	
	return result
}

// EstimateSavings estimates bandwidth savings from delta sync
func (dc *DeltaCompressor) EstimateSavings(fullState map[string]interface{}, deltas []*Delta) (fullSize, deltaSize int, savingsPercent float64) {
	fullData, _ := json.Marshal(fullState)
	deltaData, _ := json.Marshal(deltas)
	
	fullSize = len(fullData)
	deltaSize = len(deltaData)
	
	if fullSize > 0 {
		savingsPercent = float64(fullSize-deltaSize) / float64(fullSize) * 100
	}
	
	return fullSize, deltaSize, savingsPercent
}

// DeltaSyncStats tracks delta sync statistics
type DeltaSyncStats struct {
	mu                sync.RWMutex
	TotalDeltas       uint64  `json:"total_deltas"`
	CompressedDeltas  uint64  `json:"compressed_deltas"`
	BytesSaved        uint64  `json:"bytes_saved"`
	ConflictsDetected uint64  `json:"conflicts_detected"`
	ConflictsResolved uint64  `json:"conflicts_resolved"`
	AvgSavingsPercent float64 `json:"avg_savings_percent"`
}

// NewDeltaSyncStats creates new stats tracker
func NewDeltaSyncStats() *DeltaSyncStats {
	return &DeltaSyncStats{}
}

// RecordSync records a sync operation
func (dss *DeltaSyncStats) RecordSync(originalDeltas, compressedDeltas int, bytesSaved uint64, savingsPercent float64) {
	dss.mu.Lock()
	defer dss.mu.Unlock()
	
	dss.TotalDeltas += uint64(originalDeltas)
	dss.CompressedDeltas += uint64(compressedDeltas)
	dss.BytesSaved += bytesSaved
	
	// Update rolling average
	total := float64(dss.TotalDeltas)
	dss.AvgSavingsPercent = (dss.AvgSavingsPercent*(total-float64(originalDeltas)) + savingsPercent*float64(originalDeltas)) / total
}

// RecordConflict records a conflict
func (dss *DeltaSyncStats) RecordConflict(resolved bool) {
	dss.mu.Lock()
	defer dss.mu.Unlock()
	
	dss.ConflictsDetected++
	if resolved {
		dss.ConflictsResolved++
	}
}

// GetStats returns current stats
func (dss *DeltaSyncStats) GetStats() map[string]interface{} {
	dss.mu.RLock()
	defer dss.mu.RUnlock()
	
	return map[string]interface{}{
		"total_deltas":        dss.TotalDeltas,
		"compressed_deltas":   dss.CompressedDeltas,
		"bytes_saved":         dss.BytesSaved,
		"conflicts_detected":  dss.ConflictsDetected,
		"conflicts_resolved":  dss.ConflictsResolved,
		"avg_savings_percent": fmt.Sprintf("%.2f%%", dss.AvgSavingsPercent),
	}
}
