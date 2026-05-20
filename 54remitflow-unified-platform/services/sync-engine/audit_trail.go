// Package sync provides audit trail logging for sync operations
// Logs all sync events to Lakehouse for compliance and forensics
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// AuditEventType defines types of audit events
type AuditEventType string

const (
	AuditEventSyncStarted     AuditEventType = "sync_started"
	AuditEventSyncCompleted   AuditEventType = "sync_completed"
	AuditEventSyncFailed      AuditEventType = "sync_failed"
	AuditEventConflictDetected AuditEventType = "conflict_detected"
	AuditEventConflictResolved AuditEventType = "conflict_resolved"
	AuditEventDataCreated     AuditEventType = "data_created"
	AuditEventDataUpdated     AuditEventType = "data_updated"
	AuditEventDataDeleted     AuditEventType = "data_deleted"
	AuditEventKeyRotated      AuditEventType = "key_rotated"
	AuditEventDeviceRegistered AuditEventType = "device_registered"
	AuditEventDeviceRevoked   AuditEventType = "device_revoked"
	AuditEventOfflineStarted  AuditEventType = "offline_started"
	AuditEventOfflineEnded    AuditEventType = "offline_ended"
	AuditEventRecoveryStarted AuditEventType = "recovery_started"
	AuditEventRecoveryCompleted AuditEventType = "recovery_completed"
)

// AuditEvent represents a single audit event
type AuditEvent struct {
	ID            string                 `json:"id"`
	Timestamp     time.Time              `json:"timestamp"`
	EventType     AuditEventType         `json:"event_type"`
	NodeID        string                 `json:"node_id"`
	DeviceID      string                 `json:"device_id,omitempty"`
	AgentID       string                 `json:"agent_id,omitempty"`
	EntityID      string                 `json:"entity_id,omitempty"`
	EntityType    string                 `json:"entity_type,omitempty"`
	Operation     string                 `json:"operation,omitempty"`
	Status        string                 `json:"status"`
	Duration      time.Duration          `json:"duration_ns,omitempty"`
	BytesTransferred int64               `json:"bytes_transferred,omitempty"`
	ErrorMessage  string                 `json:"error_message,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	VectorClock   map[string]uint64      `json:"vector_clock,omitempty"`
	Checksum      string                 `json:"checksum,omitempty"`
	IPAddress     string                 `json:"ip_address,omitempty"`
	UserAgent     string                 `json:"user_agent,omitempty"`
}

// ConflictAuditDetails contains details about a conflict
type ConflictAuditDetails struct {
	ConflictID      string                 `json:"conflict_id"`
	EntityID        string                 `json:"entity_id"`
	EntityType      string                 `json:"entity_type"`
	LocalValue      interface{}            `json:"local_value"`
	RemoteValue     interface{}            `json:"remote_value"`
	LocalTimestamp  time.Time              `json:"local_timestamp"`
	RemoteTimestamp time.Time              `json:"remote_timestamp"`
	LocalNodeID     string                 `json:"local_node_id"`
	RemoteNodeID    string                 `json:"remote_node_id"`
	Resolution      string                 `json:"resolution"` // local_wins, remote_wins, merge, manual
	ResolvedValue   interface{}            `json:"resolved_value,omitempty"`
	ResolvedBy      string                 `json:"resolved_by,omitempty"` // auto, user_id
	ResolvedAt      time.Time              `json:"resolved_at,omitempty"`
}

// AuditLogger logs audit events
type AuditLogger interface {
	Log(ctx context.Context, event *AuditEvent) error
	Query(ctx context.Context, filter *AuditFilter) ([]*AuditEvent, error)
	Close() error
}

// AuditFilter filters audit events
type AuditFilter struct {
	StartTime   time.Time
	EndTime     time.Time
	EventTypes  []AuditEventType
	NodeID      string
	DeviceID    string
	AgentID     string
	EntityID    string
	EntityType  string
	Status      string
	Limit       int
	Offset      int
}

// LakehouseAuditLogger logs audit events to Lakehouse
type LakehouseAuditLogger struct {
	mu           sync.RWMutex
	nodeID       string
	buffer       []*AuditEvent
	bufferSize   int
	flushInterval time.Duration
	lakehouseURL string
	stopCh       chan struct{}
	wg           sync.WaitGroup
}

// NewLakehouseAuditLogger creates a new Lakehouse audit logger
func NewLakehouseAuditLogger(nodeID, lakehouseURL string, bufferSize int, flushInterval time.Duration) *LakehouseAuditLogger {
	l := &LakehouseAuditLogger{
		nodeID:        nodeID,
		buffer:        make([]*AuditEvent, 0, bufferSize),
		bufferSize:    bufferSize,
		flushInterval: flushInterval,
		lakehouseURL:  lakehouseURL,
		stopCh:        make(chan struct{}),
	}
	
	// Start background flusher
	l.wg.Add(1)
	go l.flushLoop()
	
	return l
}

// Log logs an audit event
func (l *LakehouseAuditLogger) Log(ctx context.Context, event *AuditEvent) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	
	// Set defaults
	if event.ID == "" {
		event.ID = fmt.Sprintf("audit-%s-%d", l.nodeID, time.Now().UnixNano())
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.NodeID == "" {
		event.NodeID = l.nodeID
	}
	
	l.buffer = append(l.buffer, event)
	
	// Flush if buffer is full
	if len(l.buffer) >= l.bufferSize {
		return l.flush(ctx)
	}
	
	return nil
}

// Query queries audit events (simplified - in production, query Lakehouse)
func (l *LakehouseAuditLogger) Query(ctx context.Context, filter *AuditFilter) ([]*AuditEvent, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	
	// In production, this would query the Lakehouse
	// For now, return buffered events that match filter
	results := make([]*AuditEvent, 0)
	
	for _, event := range l.buffer {
		if l.matchesFilter(event, filter) {
			results = append(results, event)
		}
	}
	
	return results, nil
}

// Close closes the logger
func (l *LakehouseAuditLogger) Close() error {
	close(l.stopCh)
	l.wg.Wait()
	
	// Final flush
	ctx := context.Background()
	return l.flush(ctx)
}

func (l *LakehouseAuditLogger) flushLoop() {
	defer l.wg.Done()
	
	ticker := time.NewTicker(l.flushInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-l.stopCh:
			return
		case <-ticker.C:
			ctx := context.Background()
			l.mu.Lock()
			l.flush(ctx)
			l.mu.Unlock()
		}
	}
}

func (l *LakehouseAuditLogger) flush(ctx context.Context) error {
	if len(l.buffer) == 0 {
		return nil
	}
	
	// In production, send to Lakehouse via Kafka or direct API
	// For now, just log and clear buffer
	for _, event := range l.buffer {
		data, _ := json.Marshal(event)
		fmt.Printf("[AUDIT] %s\n", string(data))
	}
	
	l.buffer = make([]*AuditEvent, 0, l.bufferSize)
	return nil
}

func (l *LakehouseAuditLogger) matchesFilter(event *AuditEvent, filter *AuditFilter) bool {
	if filter == nil {
		return true
	}
	
	if !filter.StartTime.IsZero() && event.Timestamp.Before(filter.StartTime) {
		return false
	}
	if !filter.EndTime.IsZero() && event.Timestamp.After(filter.EndTime) {
		return false
	}
	if filter.NodeID != "" && event.NodeID != filter.NodeID {
		return false
	}
	if filter.DeviceID != "" && event.DeviceID != filter.DeviceID {
		return false
	}
	if filter.AgentID != "" && event.AgentID != filter.AgentID {
		return false
	}
	if filter.EntityID != "" && event.EntityID != filter.EntityID {
		return false
	}
	if filter.EntityType != "" && event.EntityType != filter.EntityType {
		return false
	}
	if filter.Status != "" && event.Status != filter.Status {
		return false
	}
	if len(filter.EventTypes) > 0 {
		found := false
		for _, et := range filter.EventTypes {
			if event.EventType == et {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	return true
}

// SyncAuditTrail wraps sync operations with audit logging
type SyncAuditTrail struct {
	logger   AuditLogger
	nodeID   string
	deviceID string
	agentID  string
}

// NewSyncAuditTrail creates a new sync audit trail
func NewSyncAuditTrail(logger AuditLogger, nodeID, deviceID, agentID string) *SyncAuditTrail {
	return &SyncAuditTrail{
		logger:   logger,
		nodeID:   nodeID,
		deviceID: deviceID,
		agentID:  agentID,
	}
}

// LogSyncStarted logs a sync started event
func (sat *SyncAuditTrail) LogSyncStarted(ctx context.Context, entityID, entityType, operation string, metadata map[string]interface{}) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:  AuditEventSyncStarted,
		NodeID:     sat.nodeID,
		DeviceID:   sat.deviceID,
		AgentID:    sat.agentID,
		EntityID:   entityID,
		EntityType: entityType,
		Operation:  operation,
		Status:     "started",
		Metadata:   metadata,
	})
}

// LogSyncCompleted logs a sync completed event
func (sat *SyncAuditTrail) LogSyncCompleted(ctx context.Context, entityID, entityType, operation string, duration time.Duration, bytesTransferred int64, metadata map[string]interface{}) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:        AuditEventSyncCompleted,
		NodeID:           sat.nodeID,
		DeviceID:         sat.deviceID,
		AgentID:          sat.agentID,
		EntityID:         entityID,
		EntityType:       entityType,
		Operation:        operation,
		Status:           "completed",
		Duration:         duration,
		BytesTransferred: bytesTransferred,
		Metadata:         metadata,
	})
}

// LogSyncFailed logs a sync failed event
func (sat *SyncAuditTrail) LogSyncFailed(ctx context.Context, entityID, entityType, operation, errorMessage string, metadata map[string]interface{}) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:    AuditEventSyncFailed,
		NodeID:       sat.nodeID,
		DeviceID:     sat.deviceID,
		AgentID:      sat.agentID,
		EntityID:     entityID,
		EntityType:   entityType,
		Operation:    operation,
		Status:       "failed",
		ErrorMessage: errorMessage,
		Metadata:     metadata,
	})
}

// LogConflictDetected logs a conflict detected event
func (sat *SyncAuditTrail) LogConflictDetected(ctx context.Context, details *ConflictAuditDetails) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:  AuditEventConflictDetected,
		NodeID:     sat.nodeID,
		DeviceID:   sat.deviceID,
		AgentID:    sat.agentID,
		EntityID:   details.EntityID,
		EntityType: details.EntityType,
		Status:     "detected",
		Metadata: map[string]interface{}{
			"conflict_id":      details.ConflictID,
			"local_value":      details.LocalValue,
			"remote_value":     details.RemoteValue,
			"local_timestamp":  details.LocalTimestamp,
			"remote_timestamp": details.RemoteTimestamp,
			"local_node_id":    details.LocalNodeID,
			"remote_node_id":   details.RemoteNodeID,
		},
	})
}

// LogConflictResolved logs a conflict resolved event
func (sat *SyncAuditTrail) LogConflictResolved(ctx context.Context, details *ConflictAuditDetails) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:  AuditEventConflictResolved,
		NodeID:     sat.nodeID,
		DeviceID:   sat.deviceID,
		AgentID:    sat.agentID,
		EntityID:   details.EntityID,
		EntityType: details.EntityType,
		Status:     "resolved",
		Metadata: map[string]interface{}{
			"conflict_id":    details.ConflictID,
			"resolution":     details.Resolution,
			"resolved_value": details.ResolvedValue,
			"resolved_by":    details.ResolvedBy,
			"resolved_at":    details.ResolvedAt,
		},
	})
}

// LogDataChange logs a data change event
func (sat *SyncAuditTrail) LogDataChange(ctx context.Context, eventType AuditEventType, entityID, entityType string, oldValue, newValue interface{}, vectorClock map[string]uint64) error {
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:   eventType,
		NodeID:      sat.nodeID,
		DeviceID:    sat.deviceID,
		AgentID:     sat.agentID,
		EntityID:    entityID,
		EntityType:  entityType,
		Status:      "success",
		VectorClock: vectorClock,
		Metadata: map[string]interface{}{
			"old_value": oldValue,
			"new_value": newValue,
		},
	})
}

// LogOfflineEvent logs an offline/online event
func (sat *SyncAuditTrail) LogOfflineEvent(ctx context.Context, eventType AuditEventType, pendingCount int, metadata map[string]interface{}) error {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["pending_count"] = pendingCount
	
	return sat.logger.Log(ctx, &AuditEvent{
		EventType: eventType,
		NodeID:    sat.nodeID,
		DeviceID:  sat.deviceID,
		AgentID:   sat.agentID,
		Status:    "success",
		Metadata:  metadata,
	})
}

// LogRecoveryEvent logs a recovery event
func (sat *SyncAuditTrail) LogRecoveryEvent(ctx context.Context, eventType AuditEventType, recoveredCount int, errorMessage string, metadata map[string]interface{}) error {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["recovered_count"] = recoveredCount
	
	status := "success"
	if errorMessage != "" {
		status = "failed"
	}
	
	return sat.logger.Log(ctx, &AuditEvent{
		EventType:    eventType,
		NodeID:       sat.nodeID,
		DeviceID:     sat.deviceID,
		AgentID:      sat.agentID,
		Status:       status,
		ErrorMessage: errorMessage,
		Metadata:     metadata,
	})
}

// AuditReport generates audit reports
type AuditReport struct {
	logger AuditLogger
}

// NewAuditReport creates a new audit report generator
func NewAuditReport(logger AuditLogger) *AuditReport {
	return &AuditReport{logger: logger}
}

// SyncSummary represents a sync summary report
type SyncSummary struct {
	Period           string                 `json:"period"`
	TotalSyncs       int                    `json:"total_syncs"`
	SuccessfulSyncs  int                    `json:"successful_syncs"`
	FailedSyncs      int                    `json:"failed_syncs"`
	TotalConflicts   int                    `json:"total_conflicts"`
	ResolvedConflicts int                   `json:"resolved_conflicts"`
	TotalBytes       int64                  `json:"total_bytes"`
	AvgDuration      time.Duration          `json:"avg_duration_ns"`
	ByEntityType     map[string]int         `json:"by_entity_type"`
	ByNode           map[string]int         `json:"by_node"`
	TopErrors        []string               `json:"top_errors"`
}

// GenerateSyncSummary generates a sync summary report
func (ar *AuditReport) GenerateSyncSummary(ctx context.Context, startTime, endTime time.Time) (*SyncSummary, error) {
	events, err := ar.logger.Query(ctx, &AuditFilter{
		StartTime: startTime,
		EndTime:   endTime,
	})
	if err != nil {
		return nil, err
	}
	
	summary := &SyncSummary{
		Period:       fmt.Sprintf("%s to %s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339)),
		ByEntityType: make(map[string]int),
		ByNode:       make(map[string]int),
		TopErrors:    make([]string, 0),
	}
	
	var totalDuration time.Duration
	errorCounts := make(map[string]int)
	
	for _, event := range events {
		switch event.EventType {
		case AuditEventSyncCompleted:
			summary.TotalSyncs++
			summary.SuccessfulSyncs++
			summary.TotalBytes += event.BytesTransferred
			totalDuration += event.Duration
			summary.ByEntityType[event.EntityType]++
			summary.ByNode[event.NodeID]++
		case AuditEventSyncFailed:
			summary.TotalSyncs++
			summary.FailedSyncs++
			if event.ErrorMessage != "" {
				errorCounts[event.ErrorMessage]++
			}
		case AuditEventConflictDetected:
			summary.TotalConflicts++
		case AuditEventConflictResolved:
			summary.ResolvedConflicts++
		}
	}
	
	if summary.SuccessfulSyncs > 0 {
		summary.AvgDuration = totalDuration / time.Duration(summary.SuccessfulSyncs)
	}
	
	// Get top errors
	for err, count := range errorCounts {
		summary.TopErrors = append(summary.TopErrors, fmt.Sprintf("%s (%d)", err, count))
	}
	
	return summary, nil
}

// ConflictReport represents a conflict report
type ConflictReport struct {
	Period            string                   `json:"period"`
	TotalConflicts    int                      `json:"total_conflicts"`
	ResolvedConflicts int                      `json:"resolved_conflicts"`
	PendingConflicts  int                      `json:"pending_conflicts"`
	ByResolution      map[string]int           `json:"by_resolution"`
	ByEntityType      map[string]int           `json:"by_entity_type"`
	RecentConflicts   []*ConflictAuditDetails  `json:"recent_conflicts"`
}

// GenerateConflictReport generates a conflict report
func (ar *AuditReport) GenerateConflictReport(ctx context.Context, startTime, endTime time.Time) (*ConflictReport, error) {
	events, err := ar.logger.Query(ctx, &AuditFilter{
		StartTime:  startTime,
		EndTime:    endTime,
		EventTypes: []AuditEventType{AuditEventConflictDetected, AuditEventConflictResolved},
	})
	if err != nil {
		return nil, err
	}
	
	report := &ConflictReport{
		Period:          fmt.Sprintf("%s to %s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339)),
		ByResolution:   make(map[string]int),
		ByEntityType:   make(map[string]int),
		RecentConflicts: make([]*ConflictAuditDetails, 0),
	}
	
	for _, event := range events {
		switch event.EventType {
		case AuditEventConflictDetected:
			report.TotalConflicts++
			report.ByEntityType[event.EntityType]++
		case AuditEventConflictResolved:
			report.ResolvedConflicts++
			if resolution, ok := event.Metadata["resolution"].(string); ok {
				report.ByResolution[resolution]++
			}
		}
	}
	
	report.PendingConflicts = report.TotalConflicts - report.ResolvedConflicts
	
	return report, nil
}

// ComplianceReport represents a compliance report
type ComplianceReport struct {
	Period              string             `json:"period"`
	TotalTransactions   int                `json:"total_transactions"`
	OfflineTransactions int                `json:"offline_transactions"`
	EncryptedSyncs      int                `json:"encrypted_syncs"`
	KeyRotations        int                `json:"key_rotations"`
	DeviceRegistrations int                `json:"device_registrations"`
	DeviceRevocations   int                `json:"device_revocations"`
	DataRetentionDays   int                `json:"data_retention_days"`
	ComplianceScore     float64            `json:"compliance_score"`
	Issues              []string           `json:"issues"`
}

// GenerateComplianceReport generates a compliance report
func (ar *AuditReport) GenerateComplianceReport(ctx context.Context, startTime, endTime time.Time) (*ComplianceReport, error) {
	events, err := ar.logger.Query(ctx, &AuditFilter{
		StartTime: startTime,
		EndTime:   endTime,
	})
	if err != nil {
		return nil, err
	}
	
	report := &ComplianceReport{
		Period:            fmt.Sprintf("%s to %s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339)),
		DataRetentionDays: 30, // Default retention
		Issues:            make([]string, 0),
	}
	
	for _, event := range events {
		switch event.EventType {
		case AuditEventSyncCompleted:
			report.TotalTransactions++
			if event.Metadata != nil {
				if encrypted, ok := event.Metadata["encrypted"].(bool); ok && encrypted {
					report.EncryptedSyncs++
				}
			}
		case AuditEventOfflineStarted, AuditEventOfflineEnded:
			report.OfflineTransactions++
		case AuditEventKeyRotated:
			report.KeyRotations++
		case AuditEventDeviceRegistered:
			report.DeviceRegistrations++
		case AuditEventDeviceRevoked:
			report.DeviceRevocations++
		}
	}
	
	// Calculate compliance score
	score := 100.0
	
	// Check encryption compliance
	if report.TotalTransactions > 0 {
		encryptionRate := float64(report.EncryptedSyncs) / float64(report.TotalTransactions)
		if encryptionRate < 1.0 {
			score -= (1.0 - encryptionRate) * 20
			report.Issues = append(report.Issues, fmt.Sprintf("%.1f%% of syncs not encrypted", (1.0-encryptionRate)*100))
		}
	}
	
	// Check key rotation compliance (should rotate at least once per 30 days)
	if report.KeyRotations == 0 {
		score -= 10
		report.Issues = append(report.Issues, "No key rotations in period")
	}
	
	report.ComplianceScore = score
	
	return report, nil
}
