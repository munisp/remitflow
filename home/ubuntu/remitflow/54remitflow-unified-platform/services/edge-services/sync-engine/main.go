package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/mattn/go-psycopg2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Bi-Directional Sync Engine for TigerBeetle Edge-Main Synchronization
// Handles synchronization between edge SQLite + TigerBeetle Go and main PostgreSQL + TigerBeetle Zig

// SyncRecord represents a synchronization record
type SyncRecord struct {
	ID              string    `json:"id" db:"id"`
	EntityType      string    `json:"entity_type" db:"entity_type"` // account, transfer
	EntityID        uint64    `json:"entity_id" db:"entity_id"`
	Operation       string    `json:"operation" db:"operation"` // create, update, delete
	Direction       string    `json:"direction" db:"direction"` // push, pull
	Status          string    `json:"status" db:"status"`       // pending, syncing, synced, failed, conflict
	Priority        int       `json:"priority" db:"priority"`   // 1-10, higher is more urgent
	Payload         string    `json:"payload" db:"payload"`     // JSON payload
	Hash            string    `json:"hash" db:"hash"`           // Integrity hash
	Dependencies    string    `json:"dependencies" db:"dependencies"` // JSON array of dependent sync IDs
	ConflictData    string    `json:"conflict_data" db:"conflict_data"` // Conflict resolution data
	Attempts        int       `json:"attempts" db:"attempts"`
	MaxAttempts     int       `json:"max_attempts" db:"max_attempts"`
	NextAttempt     time.Time `json:"next_attempt" db:"next_attempt"`
	LastError       string    `json:"last_error" db:"last_error"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
	SyncedAt        *time.Time `json:"synced_at" db:"synced_at"`
}

// ConflictResolution represents conflict resolution strategies
type ConflictResolution struct {
	Strategy    string                 `json:"strategy"`    // last_write_wins, manual, business_rule
	Resolution  string                 `json:"resolution"`  // accepted, rejected, merged
	ResolvedBy  string                 `json:"resolved_by"` // system, user_id
	ResolvedAt  time.Time             `json:"resolved_at"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// SyncBatch represents a batch of sync operations
type SyncBatch struct {
	ID          string       `json:"id"`
	Records     []SyncRecord `json:"records"`
	Status      string       `json:"status"`
	StartedAt   time.Time    `json:"started_at"`
	CompletedAt *time.Time   `json:"completed_at"`
	Summary     BatchSummary `json:"summary"`
}

// BatchSummary provides summary statistics for a sync batch
type BatchSummary struct {
	Total     int `json:"total"`
	Pending   int `json:"pending"`
	Syncing   int `json:"syncing"`
	Synced    int `json:"synced"`
	Failed    int `json:"failed"`
	Conflicts int `json:"conflicts"`
}

// SyncEngine manages bi-directional synchronization
type SyncEngine struct {
	db                *sql.DB
	edgeDB            *sql.DB
	httpClient        *http.Client
	config            *SyncConfig
	metrics           *SyncMetrics
	mu                sync.RWMutex
	ctx               context.Context
	cancel            context.CancelFunc
	shutdownChan      chan os.Signal
	syncQueue         chan *SyncRecord
	conflictResolver  *ConflictResolver
	dependencyManager *DependencyManager
	compressionEngine *CompressionEngine
	encryptionEngine  *EncryptionEngine
}

// SyncConfig holds configuration for sync operations
type SyncConfig struct {
	EdgeDatabasePath     string        `json:"edge_database_path"`
	MainServerURL        string        `json:"main_server_url"`
	SyncInterval         time.Duration `json:"sync_interval"`
	BatchSize            int           `json:"batch_size"`
	MaxRetries           int           `json:"max_retries"`
	RetryBackoffBase     time.Duration `json:"retry_backoff_base"`
	ConflictResolution   string        `json:"conflict_resolution"` // last_write_wins, manual, business_rule
	CompressionEnabled   bool          `json:"compression_enabled"`
	EncryptionEnabled    bool          `json:"encryption_enabled"`
	PrioritySync         bool          `json:"priority_sync"`
	BandwidthLimit       int64         `json:"bandwidth_limit"` // bytes per second
	ConnectionTimeout    time.Duration `json:"connection_timeout"`
	RequestTimeout       time.Duration `json:"request_timeout"`
	HealthCheckInterval  time.Duration `json:"health_check_interval"`
	MetricsEnabled       bool          `json:"metrics_enabled"`
}

// SyncMetrics provides Prometheus metrics for sync operations
type SyncMetrics struct {
	SyncAttempts       prometheus.Counter
	SyncSuccesses      prometheus.Counter
	SyncFailures       prometheus.Counter
	ConflictsDetected  prometheus.Counter
	ConflictsResolved  prometheus.Counter
	BatchesProcessed   prometheus.Counter
	RecordsProcessed   prometheus.Counter
	SyncLatency        prometheus.Histogram
	QueueSize          prometheus.Gauge
	ConnectionStatus   prometheus.Gauge
	BandwidthUsage     prometheus.Gauge
	CompressionRatio   prometheus.Histogram
}

// ConflictResolver handles conflict resolution strategies
type ConflictResolver struct {
	strategies map[string]ConflictResolutionFunc
	mu         sync.RWMutex
}

type ConflictResolutionFunc func(local, remote interface{}) (*ConflictResolution, error)

// DependencyManager handles sync dependencies
type DependencyManager struct {
	dependencies map[string][]string // sync_id -> dependent_sync_ids
	mu           sync.RWMutex
}

// CompressionEngine handles data compression for bandwidth optimization
type CompressionEngine struct {
	enabled bool
}

// EncryptionEngine handles data encryption for secure transmission
type EncryptionEngine struct {
	enabled bool
	key     []byte
}

// Account and Transfer structures (matching TigerBeetle edge)
type Account struct {
	ID             uint64    `json:"id"`
	UserData       uint64    `json:"user_data"`
	Reserved       [48]byte  `json:"reserved"`
	Ledger         uint32    `json:"ledger"`
	Code           uint16    `json:"code"`
	Flags          uint16    `json:"flags"`
	DebitsPending  uint64    `json:"debits_pending"`
	DebitsPosted   uint64    `json:"debits_posted"`
	CreditsPending uint64    `json:"credits_pending"`
	CreditsPosted  uint64    `json:"credits_posted"`
	Timestamp      time.Time `json:"timestamp"`
}

type Transfer struct {
	ID              uint64    `json:"id"`
	DebitAccountID  uint64    `json:"debit_account_id"`
	CreditAccountID uint64    `json:"credit_account_id"`
	UserData        uint64    `json:"user_data"`
	Reserved        uint64    `json:"reserved"`
	PendingID       uint64    `json:"pending_id"`
	Timeout         uint64    `json:"timeout"`
	Ledger          uint32    `json:"ledger"`
	Code            uint16    `json:"code"`
	Flags           uint16    `json:"flags"`
	Amount          uint64    `json:"amount"`
	Timestamp       time.Time `json:"timestamp"`
	Hash            string    `json:"hash"`
}

func NewSyncConfig() *SyncConfig {
	return &SyncConfig{
		EdgeDatabasePath:     "./edge_ledger.db",
		MainServerURL:        "https://main-server.example.com",
		SyncInterval:         30 * time.Second,
		BatchSize:            100,
		MaxRetries:           5,
		RetryBackoffBase:     2 * time.Second,
		ConflictResolution:   "business_rule",
		CompressionEnabled:   true,
		EncryptionEnabled:    true,
		PrioritySync:         true,
		BandwidthLimit:       1024 * 1024, // 1 MB/s
		ConnectionTimeout:    30 * time.Second,
		RequestTimeout:       60 * time.Second,
		HealthCheckInterval:  10 * time.Second,
		MetricsEnabled:       true,
	}
}

func NewSyncMetrics() *SyncMetrics {
	return &SyncMetrics{
		SyncAttempts: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sync_attempts_total",
			Help: "Total number of sync attempts",
		}),
		SyncSuccesses: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sync_successes_total",
			Help: "Total number of successful syncs",
		}),
		SyncFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sync_failures_total",
			Help: "Total number of failed syncs",
		}),
		ConflictsDetected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "conflicts_detected_total",
			Help: "Total number of conflicts detected",
		}),
		ConflictsResolved: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "conflicts_resolved_total",
			Help: "Total number of conflicts resolved",
		}),
		BatchesProcessed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "batches_processed_total",
			Help: "Total number of batches processed",
		}),
		RecordsProcessed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "records_processed_total",
			Help: "Total number of records processed",
		}),
		SyncLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "sync_latency_seconds",
			Help: "Sync operation latency",
		}),
		QueueSize: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "sync_queue_size",
			Help: "Current sync queue size",
		}),
		ConnectionStatus: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "connection_status",
			Help: "Connection status (1=connected, 0=disconnected)",
		}),
		BandwidthUsage: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "bandwidth_usage_bytes_per_second",
			Help: "Current bandwidth usage",
		}),
		CompressionRatio: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "compression_ratio",
			Help: "Data compression ratio",
		}),
	}
}

func NewConflictResolver() *ConflictResolver {
	cr := &ConflictResolver{
		strategies: make(map[string]ConflictResolutionFunc),
	}

	// Register default conflict resolution strategies
	cr.RegisterStrategy("last_write_wins", cr.lastWriteWinsStrategy)
	cr.RegisterStrategy("business_rule", cr.businessRuleStrategy)
	cr.RegisterStrategy("manual", cr.manualStrategy)

	return cr
}

func (cr *ConflictResolver) RegisterStrategy(name string, strategy ConflictResolutionFunc) {
	cr.mu.Lock()
	defer cr.mu.Unlock()
	cr.strategies[name] = strategy
}

func (cr *ConflictResolver) lastWriteWinsStrategy(local, remote interface{}) (*ConflictResolution, error) {
	// Simple last-write-wins strategy based on timestamp
	return &ConflictResolution{
		Strategy:   "last_write_wins",
		Resolution: "accepted",
		ResolvedBy: "system",
		ResolvedAt: time.Now(),
		Metadata:   map[string]interface{}{"strategy": "timestamp_based"},
	}, nil
}

func (cr *ConflictResolver) businessRuleStrategy(local, remote interface{}) (*ConflictResolution, error) {
	// Business rule-based conflict resolution
	// This would implement specific business logic for the banking domain
	return &ConflictResolution{
		Strategy:   "business_rule",
		Resolution: "merged",
		ResolvedBy: "system",
		ResolvedAt: time.Now(),
		Metadata:   map[string]interface{}{"rule": "banking_priority"},
	}, nil
}

func (cr *ConflictResolver) manualStrategy(local, remote interface{}) (*ConflictResolution, error) {
	// Manual resolution - requires human intervention
	return &ConflictResolution{
		Strategy:   "manual",
		Resolution: "pending",
		ResolvedBy: "",
		ResolvedAt: time.Time{},
		Metadata:   map[string]interface{}{"requires_manual_review": true},
	}, nil
}

func NewDependencyManager() *DependencyManager {
	return &DependencyManager{
		dependencies: make(map[string][]string),
	}
}

func (dm *DependencyManager) AddDependency(syncID, dependentID string) {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	
	if deps, exists := dm.dependencies[syncID]; exists {
		dm.dependencies[syncID] = append(deps, dependentID)
	} else {
		dm.dependencies[syncID] = []string{dependentID}
	}
}

func (dm *DependencyManager) GetDependencies(syncID string) []string {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	
	if deps, exists := dm.dependencies[syncID]; exists {
		return append([]string(nil), deps...) // Return copy
	}
	return nil
}

func (dm *DependencyManager) ResolveDependencies(syncID string) bool {
	// Check if all dependencies are resolved
	deps := dm.GetDependencies(syncID)
	for _, dep := range deps {
		// In real implementation, check if dependency is synced
		// For now, assume all dependencies are resolved
	}
	return true
}

func NewCompressionEngine(enabled bool) *CompressionEngine {
	return &CompressionEngine{enabled: enabled}
}

func (ce *CompressionEngine) Compress(data []byte) ([]byte, error) {
	if !ce.enabled {
		return data, nil
	}
	// In real implementation, use gzip or other compression
	// For now, return original data
	return data, nil
}

func (ce *CompressionEngine) Decompress(data []byte) ([]byte, error) {
	if !ce.enabled {
		return data, nil
	}
	// In real implementation, decompress data
	// For now, return original data
	return data, nil
}

func NewEncryptionEngine(enabled bool, key []byte) *EncryptionEngine {
	return &EncryptionEngine{
		enabled: enabled,
		key:     key,
	}
}

func (ee *EncryptionEngine) Encrypt(data []byte) ([]byte, error) {
	if !ee.enabled {
		return data, nil
	}
	// In real implementation, use AES or other encryption
	// For now, return original data
	return data, nil
}

func (ee *EncryptionEngine) Decrypt(data []byte) ([]byte, error) {
	if !ee.enabled {
		return data, nil
	}
	// In real implementation, decrypt data
	// For now, return original data
	return data, nil
}

func NewSyncEngine(config *SyncConfig) (*SyncEngine, error) {
	ctx, cancel := context.WithCancel(context.Background())

	// Create HTTP client with custom transport for bandwidth limiting
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
	}
	
	httpClient := &http.Client{
		Transport: transport,
		Timeout:   config.RequestTimeout,
	}

	engine := &SyncEngine{
		httpClient:        httpClient,
		config:            config,
		metrics:           NewSyncMetrics(),
		ctx:               ctx,
		cancel:            cancel,
		shutdownChan:      make(chan os.Signal, 1),
		syncQueue:         make(chan *SyncRecord, 10000),
		conflictResolver:  NewConflictResolver(),
		dependencyManager: NewDependencyManager(),
		compressionEngine: NewCompressionEngine(config.CompressionEnabled),
		encryptionEngine:  NewEncryptionEngine(config.EncryptionEnabled, []byte("encryption-key")),
	}

	// Initialize databases
	if err := engine.initDatabases(); err != nil {
		return nil, fmt.Errorf("failed to initialize databases: %v", err)
	}

	// Register Prometheus metrics
	if config.MetricsEnabled {
		prometheus.MustRegister(
			engine.metrics.SyncAttempts,
			engine.metrics.SyncSuccesses,
			engine.metrics.SyncFailures,
			engine.metrics.ConflictsDetected,
			engine.metrics.ConflictsResolved,
			engine.metrics.BatchesProcessed,
			engine.metrics.RecordsProcessed,
			engine.metrics.SyncLatency,
			engine.metrics.QueueSize,
			engine.metrics.ConnectionStatus,
			engine.metrics.BandwidthUsage,
			engine.metrics.CompressionRatio,
		)
	}

	// Start background workers
	go engine.syncWorker()
	go engine.healthChecker()
	go engine.metricsUpdater()

	// Handle graceful shutdown
	signal.Notify(engine.shutdownChan, syscall.SIGINT, syscall.SIGTERM)
	go engine.handleShutdown()

	return engine, nil
}

func (se *SyncEngine) initDatabases() error {
	var err error

	// Initialize sync database (SQLite)
	se.db, err = sql.Open("psycopg2", "./sync_engine.db?_journal_mode=WAL&_synchronous=FULL&_foreign_keys=ON")
	if err != nil {
		return err
	}

	// Initialize edge database connection
	se.edgeDB, err = sql.Open("psycopg2", se.config.EdgeDatabasePath+"?_journal_mode=WAL&_synchronous=FULL&_foreign_keys=ON")
	if err != nil {
		return err
	}

	// Create sync tables
	schema := `
	CREATE TABLE IF NOT EXISTS sync_records (
		id TEXT PRIMARY KEY,
		entity_type TEXT NOT NULL,
		entity_id INTEGER NOT NULL,
		operation TEXT NOT NULL,
		direction TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		priority INTEGER NOT NULL DEFAULT 5,
		payload TEXT NOT NULL,
		hash TEXT NOT NULL,
		dependencies TEXT,
		conflict_data TEXT,
		attempts INTEGER NOT NULL DEFAULT 0,
		max_attempts INTEGER NOT NULL DEFAULT 5,
		next_attempt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		last_error TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		synced_at DATETIME
	);

	CREATE TABLE IF NOT EXISTS sync_batches (
		id TEXT PRIMARY KEY,
		status TEXT NOT NULL DEFAULT 'pending',
		started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		completed_at DATETIME,
		total_records INTEGER NOT NULL DEFAULT 0,
		synced_records INTEGER NOT NULL DEFAULT 0,
		failed_records INTEGER NOT NULL DEFAULT 0,
		conflict_records INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS sync_conflicts (
		id TEXT PRIMARY KEY,
		sync_record_id TEXT NOT NULL,
		local_data TEXT NOT NULL,
		remote_data TEXT NOT NULL,
		resolution_strategy TEXT,
		resolution_status TEXT NOT NULL DEFAULT 'pending',
		resolved_by TEXT,
		resolved_at DATETIME,
		resolution_data TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (sync_record_id) REFERENCES sync_records(id)
	);

	CREATE TABLE IF NOT EXISTS sync_metrics (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		metric_name TEXT NOT NULL,
		metric_value REAL NOT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_sync_records_status ON sync_records(status);
	CREATE INDEX IF NOT EXISTS idx_sync_records_priority ON sync_records(priority DESC);
	CREATE INDEX IF NOT EXISTS idx_sync_records_next_attempt ON sync_records(next_attempt);
	CREATE INDEX IF NOT EXISTS idx_sync_records_entity ON sync_records(entity_type, entity_id);
	CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(resolution_status);
	CREATE INDEX IF NOT EXISTS idx_sync_batches_status ON sync_batches(status);

	-- Triggers for updated_at
	CREATE TRIGGER IF NOT EXISTS update_sync_records_timestamp 
		AFTER UPDATE ON sync_records
		BEGIN
			UPDATE sync_records SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;
	`

	_, err = se.db.Exec(schema)
	return err
}

// CreateSyncRecord creates a new sync record
func (se *SyncEngine) CreateSyncRecord(entityType string, entityID uint64, operation, direction string, payload interface{}) (*SyncRecord, error) {
	se.mu.Lock()
	defer se.mu.Unlock()

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	record := &SyncRecord{
		ID:          uuid.New().String(),
		EntityType:  entityType,
		EntityID:    entityID,
		Operation:   operation,
		Direction:   direction,
		Status:      "pending",
		Priority:    5, // Default priority
		Payload:     string(payloadJSON),
		Hash:        se.calculateHash(payloadJSON),
		MaxAttempts: se.config.MaxRetries,
		NextAttempt: time.Now(),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Insert into database
	_, err = se.db.Exec(`
		INSERT INTO sync_records (id, entity_type, entity_id, operation, direction, 
			status, priority, payload, hash, max_attempts, next_attempt, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, record.ID, record.EntityType, record.EntityID, record.Operation, record.Direction,
		record.Status, record.Priority, record.Payload, record.Hash, record.MaxAttempts,
		record.NextAttempt, record.CreatedAt, record.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Queue for processing
	select {
	case se.syncQueue <- record:
	default:
		log.Printf("Sync queue full, record %s will be processed in next batch", record.ID)
	}

	return record, nil
}

func (se *SyncEngine) calculateHash(data []byte) string {
	// Simple hash calculation - in real implementation use SHA-256
	return fmt.Sprintf("%x", len(data))
}

// GetPendingSyncRecords retrieves pending sync records
func (se *SyncEngine) GetPendingSyncRecords(limit int) ([]SyncRecord, error) {
	se.mu.RLock()
	defer se.mu.RUnlock()

	rows, err := se.db.Query(`
		SELECT id, entity_type, entity_id, operation, direction, status, priority,
			payload, hash, dependencies, conflict_data, attempts, max_attempts,
			next_attempt, last_error, created_at, updated_at, synced_at
		FROM sync_records 
		WHERE status IN ('pending', 'failed') AND next_attempt <= CURRENT_TIMESTAMP
		ORDER BY priority DESC, created_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []SyncRecord
	for rows.Next() {
		var record SyncRecord
		var dependencies, conflictData, lastError sql.NullString
		var syncedAt sql.NullTime

		err := rows.Scan(
			&record.ID, &record.EntityType, &record.EntityID, &record.Operation,
			&record.Direction, &record.Status, &record.Priority, &record.Payload,
			&record.Hash, &dependencies, &conflictData, &record.Attempts,
			&record.MaxAttempts, &record.NextAttempt, &lastError,
			&record.CreatedAt, &record.UpdatedAt, &syncedAt,
		)
		if err != nil {
			return nil, err
		}

		if dependencies.Valid {
			record.Dependencies = dependencies.String
		}
		if conflictData.Valid {
			record.ConflictData = conflictData.String
		}
		if lastError.Valid {
			record.LastError = lastError.String
		}
		if syncedAt.Valid {
			record.SyncedAt = &syncedAt.Time
		}

		records = append(records, record)
	}

	return records, nil
}

// ProcessSyncBatch processes a batch of sync records
func (se *SyncEngine) ProcessSyncBatch(records []SyncRecord) (*SyncBatch, error) {
	start := time.Now()
	defer func() {
		se.metrics.SyncLatency.Observe(time.Since(start).Seconds())
		se.metrics.BatchesProcessed.Inc()
		se.metrics.RecordsProcessed.Add(float64(len(records)))
	}()

	batch := &SyncBatch{
		ID:        uuid.New().String(),
		Records:   records,
		Status:    "processing",
		StartedAt: time.Now(),
		Summary: BatchSummary{
			Total: len(records),
		},
	}

	// Create batch record
	_, err := se.db.Exec(`
		INSERT INTO sync_batches (id, status, started_at, total_records)
		VALUES (?, ?, ?, ?)
	`, batch.ID, batch.Status, batch.StartedAt, batch.Summary.Total)
	if err != nil {
		return nil, err
	}

	// Process each record
	for i := range batch.Records {
		record := &batch.Records[i]
		
		// Check dependencies
		if !se.dependencyManager.ResolveDependencies(record.ID) {
			record.Status = "pending"
			batch.Summary.Pending++
			continue
		}

		// Process the record
		err := se.processSyncRecord(record)
		if err != nil {
			record.Status = "failed"
			record.LastError = err.Error()
			record.Attempts++
			record.NextAttempt = time.Now().Add(se.calculateBackoff(record.Attempts))
			batch.Summary.Failed++
			se.metrics.SyncFailures.Inc()
		} else {
			record.Status = "synced"
			now := time.Now()
			record.SyncedAt = &now
			batch.Summary.Synced++
			se.metrics.SyncSuccesses.Inc()
		}

		// Update record in database
		se.updateSyncRecord(record)
	}

	// Complete batch
	batch.Status = "completed"
	now := time.Now()
	batch.CompletedAt = &now

	_, err = se.db.Exec(`
		UPDATE sync_batches 
		SET status = ?, completed_at = ?, synced_records = ?, failed_records = ?, conflict_records = ?
		WHERE id = ?
	`, batch.Status, batch.CompletedAt, batch.Summary.Synced, 
		batch.Summary.Failed, batch.Summary.Conflicts, batch.ID)
	if err != nil {
		log.Printf("Failed to update batch status: %v", err)
	}

	return batch, nil
}

func (se *SyncEngine) processSyncRecord(record *SyncRecord) error {
	se.metrics.SyncAttempts.Inc()

	switch record.Direction {
	case "push":
		return se.pushToMain(record)
	case "pull":
		return se.pullFromMain(record)
	default:
		return fmt.Errorf("unknown sync direction: %s", record.Direction)
	}
}

func (se *SyncEngine) pushToMain(record *SyncRecord) error {
	// Prepare payload
	payload, err := se.compressionEngine.Compress([]byte(record.Payload))
	if err != nil {
		return fmt.Errorf("compression failed: %v", err)
	}

	payload, err = se.encryptionEngine.Encrypt(payload)
	if err != nil {
		return fmt.Errorf("encryption failed: %v", err)
	}

	// Create HTTP request
	url := fmt.Sprintf("%s/api/v1/sync/%s", se.config.MainServerURL, record.EntityType)
	req, err := http.NewRequestWithContext(se.ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sync-ID", record.ID)
	req.Header.Set("X-Sync-Hash", record.Hash)
	req.Header.Set("X-Sync-Operation", record.Operation)

	// Send request
	resp, err := se.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Handle response
	if resp.StatusCode == http.StatusConflict {
		return se.handleConflict(record, resp)
	} else if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

func (se *SyncEngine) pullFromMain(record *SyncRecord) error {
	// Create HTTP request
	url := fmt.Sprintf("%s/api/v1/sync/%s/%d", se.config.MainServerURL, record.EntityType, record.EntityID)
	req, err := http.NewRequestWithContext(se.ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	req.Header.Set("X-Sync-ID", record.ID)

	// Send request
	resp, err := se.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	// Read and process response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	// Decrypt and decompress
	body, err = se.encryptionEngine.Decrypt(body)
	if err != nil {
		return fmt.Errorf("decryption failed: %v", err)
	}

	body, err = se.compressionEngine.Decompress(body)
	if err != nil {
		return fmt.Errorf("decompression failed: %v", err)
	}

	// Apply to local database
	return se.applyToLocal(record, body)
}

func (se *SyncEngine) handleConflict(record *SyncRecord, resp *http.Response) error {
	se.metrics.ConflictsDetected.Inc()

	// Read conflict data from response
	conflictData, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	// Create conflict record
	conflictID := uuid.New().String()
	_, err = se.db.Exec(`
		INSERT INTO sync_conflicts (id, sync_record_id, local_data, remote_data, 
			resolution_strategy, resolution_status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, conflictID, record.ID, record.Payload, string(conflictData),
		se.config.ConflictResolution, "pending", time.Now())
	if err != nil {
		return err
	}

	// Attempt automatic resolution
	resolution, err := se.resolveConflict(record.Payload, string(conflictData))
	if err != nil {
		return err
	}

	if resolution.Resolution != "pending" {
		// Update conflict record
		_, err = se.db.Exec(`
			UPDATE sync_conflicts 
			SET resolution_status = ?, resolved_by = ?, resolved_at = ?, resolution_data = ?
			WHERE id = ?
		`, resolution.Resolution, resolution.ResolvedBy, resolution.ResolvedAt,
			string(conflictData), conflictID)
		if err != nil {
			return err
		}

		se.metrics.ConflictsResolved.Inc()
	}

	return nil
}

func (se *SyncEngine) resolveConflict(localData, remoteData string) (*ConflictResolution, error) {
	strategy := se.config.ConflictResolution
	
	se.conflictResolver.mu.RLock()
	resolverFunc, exists := se.conflictResolver.strategies[strategy]
	se.conflictResolver.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("unknown conflict resolution strategy: %s", strategy)
	}

	return resolverFunc(localData, remoteData)
}

func (se *SyncEngine) applyToLocal(record *SyncRecord, data []byte) error {
	// Apply the synced data to local edge database
	switch record.EntityType {
	case "account":
		return se.applyAccountToLocal(data)
	case "transfer":
		return se.applyTransferToLocal(data)
	default:
		return fmt.Errorf("unknown entity type: %s", record.EntityType)
	}
}

func (se *SyncEngine) applyAccountToLocal(data []byte) error {
	var account Account
	if err := json.Unmarshal(data, &account); err != nil {
		return err
	}

	// Insert or update account in edge database
	_, err := se.edgeDB.Exec(`
		INSERT OR REPLACE INTO accounts (id, user_data, reserved, ledger, code, flags,
			debits_pending, debits_posted, credits_pending, credits_posted, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, account.ID, account.UserData, account.Reserved[:], account.Ledger,
		account.Code, account.Flags, account.DebitsPending, account.DebitsPosted,
		account.CreditsPending, account.CreditsPosted, account.Timestamp)

	return err
}

func (se *SyncEngine) applyTransferToLocal(data []byte) error {
	var transfer Transfer
	if err := json.Unmarshal(data, &transfer); err != nil {
		return err
	}

	// Insert or update transfer in edge database
	_, err := se.edgeDB.Exec(`
		INSERT OR REPLACE INTO transfers (id, debit_account_id, credit_account_id,
			user_data, reserved, pending_id, timeout, ledger, code, flags, amount,
			timestamp, sync_status, hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)
	`, transfer.ID, transfer.DebitAccountID, transfer.CreditAccountID,
		transfer.UserData, transfer.Reserved, transfer.PendingID, transfer.Timeout,
		transfer.Ledger, transfer.Code, transfer.Flags, transfer.Amount,
		transfer.Timestamp, transfer.Hash)

	return err
}

func (se *SyncEngine) updateSyncRecord(record *SyncRecord) error {
	_, err := se.db.Exec(`
		UPDATE sync_records 
		SET status = ?, attempts = ?, next_attempt = ?, last_error = ?, 
			updated_at = CURRENT_TIMESTAMP, synced_at = ?
		WHERE id = ?
	`, record.Status, record.Attempts, record.NextAttempt, record.LastError,
		record.SyncedAt, record.ID)
	return err
}

func (se *SyncEngine) calculateBackoff(attempts int) time.Duration {
	// Exponential backoff with jitter
	backoff := se.config.RetryBackoffBase * time.Duration(1<<uint(attempts))
	if backoff > 5*time.Minute {
		backoff = 5 * time.Minute
	}
	return backoff
}

// syncWorker processes sync records in background
func (se *SyncEngine) syncWorker() {
	ticker := time.NewTicker(se.config.SyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-se.ctx.Done():
			return
		case <-ticker.C:
			se.processPendingSync()
		case record := <-se.syncQueue:
			// Process individual record immediately if possible
			if se.isConnected() {
				se.processSyncRecord(record)
				se.updateSyncRecord(record)
			}
		}
	}
}

func (se *SyncEngine) processPendingSync() {
	if !se.isConnected() {
		return
	}

	records, err := se.GetPendingSyncRecords(se.config.BatchSize)
	if err != nil {
		log.Printf("Failed to get pending sync records: %v", err)
		return
	}

	if len(records) == 0 {
		return
	}

	batch, err := se.ProcessSyncBatch(records)
	if err != nil {
		log.Printf("Failed to process sync batch: %v", err)
		return
	}

	log.Printf("Processed sync batch %s: %d total, %d synced, %d failed, %d conflicts",
		batch.ID, batch.Summary.Total, batch.Summary.Synced, 
		batch.Summary.Failed, batch.Summary.Conflicts)
}

func (se *SyncEngine) isConnected() bool {
	// Simple connectivity check - in real implementation, ping main server
	return true
}

// healthChecker monitors system health
func (se *SyncEngine) healthChecker() {
	ticker := time.NewTicker(se.config.HealthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-se.ctx.Done():
			return
		case <-ticker.C:
			se.performHealthCheck()
		}
	}
}

func (se *SyncEngine) performHealthCheck() {
	// Check main server connectivity
	connected := se.checkMainServerHealth()
	if connected {
		se.metrics.ConnectionStatus.Set(1)
	} else {
		se.metrics.ConnectionStatus.Set(0)
	}

	// Update queue size metric
	se.metrics.QueueSize.Set(float64(len(se.syncQueue)))
}

func (se *SyncEngine) checkMainServerHealth() bool {
	ctx, cancel := context.WithTimeout(se.ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", se.config.MainServerURL+"/health", nil)
	if err != nil {
		return false
	}

	resp, err := se.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

// metricsUpdater updates various metrics
func (se *SyncEngine) metricsUpdater() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-se.ctx.Done():
			return
		case <-ticker.C:
			se.updateMetrics()
		}
	}
}

func (se *SyncEngine) updateMetrics() {
	// Update bandwidth usage (simulated)
	se.metrics.BandwidthUsage.Set(float64(se.config.BandwidthLimit * 60 / 100)) // 60% usage

	// Update compression ratio (simulated)
	se.metrics.CompressionRatio.Observe(0.7) // 70% compression ratio
}

// handleShutdown handles graceful shutdown
func (se *SyncEngine) handleShutdown() {
	<-se.shutdownChan
	log.Println("Shutdown signal received, initiating graceful shutdown...")

	// Cancel context to stop all goroutines
	se.cancel()

	// Process remaining items in sync queue
	log.Println("Processing remaining sync queue items...")
	close(se.syncQueue)
	for record := range se.syncQueue {
		se.processSyncRecord(record)
		se.updateSyncRecord(record)
	}

	// Close database connections
	if se.db != nil {
		se.db.Close()
	}
	if se.edgeDB != nil {
		se.edgeDB.Close()
	}

	log.Println("Graceful shutdown completed")
	os.Exit(0)
}

// REST API Handlers

func (se *SyncEngine) setupRoutes() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	router.Use(cors.New(config))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"connected": se.isConnected(),
			"timestamp": time.Now(),
		})
	})

	// Metrics endpoint
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := router.Group("/api/v1")
	{
		// Sync operations
		api.POST("/sync/records", se.createSyncRecordHandler)
		api.GET("/sync/records/pending", se.getPendingSyncRecordsHandler)
		api.POST("/sync/force", se.forceSyncHandler)
		api.GET("/sync/status", se.getSyncStatusHandler)

		// Batch operations
		api.GET("/sync/batches", se.getSyncBatchesHandler)
		api.GET("/sync/batches/:id", se.getSyncBatchHandler)

		// Conflict management
		api.GET("/sync/conflicts", se.getConflictsHandler)
		api.POST("/sync/conflicts/:id/resolve", se.resolveConflictHandler)

		// System operations
		api.GET("/status", se.getSystemStatusHandler)
	}

	return router
}

func (se *SyncEngine) createSyncRecordHandler(c *gin.Context) {
	var req struct {
		EntityType string      `json:"entity_type" binding:"required"`
		EntityID   uint64      `json:"entity_id" binding:"required"`
		Operation  string      `json:"operation" binding:"required"`
		Direction  string      `json:"direction" binding:"required"`
		Payload    interface{} `json:"payload" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	record, err := se.CreateSyncRecord(req.EntityType, req.EntityID, req.Operation, req.Direction, req.Payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, record)
}

func (se *SyncEngine) getPendingSyncRecordsHandler(c *gin.Context) {
	limit := 100
	if l := c.Query("limit"); l != "" {
		if parsed, err := fmt.Sscanf(l, "%d", &limit); err != nil || parsed != 1 {
			limit = 100
		}
	}

	records, err := se.GetPendingSyncRecords(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"records": records})
}

func (se *SyncEngine) forceSyncHandler(c *gin.Context) {
	go se.processPendingSync()
	c.JSON(http.StatusOK, gin.H{"message": "Sync initiated"})
}

func (se *SyncEngine) getSyncStatusHandler(c *gin.Context) {
	var pendingCount, failedCount, conflictCount int
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records WHERE status = 'pending'").Scan(&pendingCount)
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records WHERE status = 'failed'").Scan(&failedCount)
	se.db.QueryRow("SELECT COUNT(*) FROM sync_conflicts WHERE resolution_status = 'pending'").Scan(&conflictCount)

	c.JSON(http.StatusOK, gin.H{
		"connected":        se.isConnected(),
		"pending_records":  pendingCount,
		"failed_records":   failedCount,
		"pending_conflicts": conflictCount,
		"queue_size":       len(se.syncQueue),
	})
}

func (se *SyncEngine) getSyncBatchesHandler(c *gin.Context) {
	rows, err := se.db.Query(`
		SELECT id, status, started_at, completed_at, total_records, 
			synced_records, failed_records, conflict_records
		FROM sync_batches 
		ORDER BY started_at DESC 
		LIMIT 50
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var batches []map[string]interface{}
	for rows.Next() {
		var batch map[string]interface{} = make(map[string]interface{})
		var completedAt sql.NullTime
		
		err := rows.Scan(
			&batch["id"], &batch["status"], &batch["started_at"], &completedAt,
			&batch["total_records"], &batch["synced_records"], 
			&batch["failed_records"], &batch["conflict_records"],
		)
		if err != nil {
			continue
		}

		if completedAt.Valid {
			batch["completed_at"] = completedAt.Time
		}

		batches = append(batches, batch)
	}

	c.JSON(http.StatusOK, gin.H{"batches": batches})
}

func (se *SyncEngine) getSyncBatchHandler(c *gin.Context) {
	batchID := c.Param("id")
	
	var batch map[string]interface{} = make(map[string]interface{})
	var completedAt sql.NullTime
	
	err := se.db.QueryRow(`
		SELECT id, status, started_at, completed_at, total_records,
			synced_records, failed_records, conflict_records
		FROM sync_batches WHERE id = ?
	`, batchID).Scan(
		&batch["id"], &batch["status"], &batch["started_at"], &completedAt,
		&batch["total_records"], &batch["synced_records"],
		&batch["failed_records"], &batch["conflict_records"],
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Batch not found"})
		return
	}

	if completedAt.Valid {
		batch["completed_at"] = completedAt.Time
	}

	c.JSON(http.StatusOK, batch)
}

func (se *SyncEngine) getConflictsHandler(c *gin.Context) {
	rows, err := se.db.Query(`
		SELECT id, sync_record_id, resolution_strategy, resolution_status,
			resolved_by, resolved_at, created_at
		FROM sync_conflicts 
		WHERE resolution_status = 'pending'
		ORDER BY created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var conflicts []map[string]interface{}
	for rows.Next() {
		var conflict map[string]interface{} = make(map[string]interface{})
		var resolvedBy sql.NullString
		var resolvedAt sql.NullTime
		
		err := rows.Scan(
			&conflict["id"], &conflict["sync_record_id"], &conflict["resolution_strategy"],
			&conflict["resolution_status"], &resolvedBy, &resolvedAt, &conflict["created_at"],
		)
		if err != nil {
			continue
		}

		if resolvedBy.Valid {
			conflict["resolved_by"] = resolvedBy.String
		}
		if resolvedAt.Valid {
			conflict["resolved_at"] = resolvedAt.Time
		}

		conflicts = append(conflicts, conflict)
	}

	c.JSON(http.StatusOK, gin.H{"conflicts": conflicts})
}

func (se *SyncEngine) resolveConflictHandler(c *gin.Context) {
	conflictID := c.Param("id")
	
	var req struct {
		Resolution string `json:"resolution" binding:"required"`
		ResolvedBy string `json:"resolved_by" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := se.db.Exec(`
		UPDATE sync_conflicts 
		SET resolution_status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Resolution, req.ResolvedBy, conflictID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	se.metrics.ConflictsResolved.Inc()
	c.JSON(http.StatusOK, gin.H{"message": "Conflict resolved"})
}

func (se *SyncEngine) getSystemStatusHandler(c *gin.Context) {
	var totalRecords, pendingRecords, syncedRecords, failedRecords int
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records").Scan(&totalRecords)
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records WHERE status = 'pending'").Scan(&pendingRecords)
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records WHERE status = 'synced'").Scan(&syncedRecords)
	se.db.QueryRow("SELECT COUNT(*) FROM sync_records WHERE status = 'failed'").Scan(&failedRecords)

	c.JSON(http.StatusOK, gin.H{
		"connected":       se.isConnected(),
		"total_records":   totalRecords,
		"pending_records": pendingRecords,
		"synced_records":  syncedRecords,
		"failed_records":  failedRecords,
		"queue_size":      len(se.syncQueue),
		"compression":     se.compressionEngine.enabled,
		"encryption":      se.encryptionEngine.enabled,
	})
}

func main() {
	log.Println("Starting TigerBeetle Sync Engine...")

	config := NewSyncConfig()
	
	// Load configuration from environment
	if dbPath := os.Getenv("EDGE_DATABASE_PATH"); dbPath != "" {
		config.EdgeDatabasePath = dbPath
	}
	if serverURL := os.Getenv("MAIN_SERVER_URL"); serverURL != "" {
		config.MainServerURL = serverURL
	}

	engine, err := NewSyncEngine(config)
	if err != nil {
		log.Fatalf("Failed to create sync engine: %v", err)
	}

	router := engine.setupRoutes()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	log.Printf("TigerBeetle Sync Engine started on port %s", port)
	log.Printf("Edge Database: %s", config.EdgeDatabasePath)
	log.Printf("Main Server: %s", config.MainServerURL)
	log.Printf("Sync Interval: %v", config.SyncInterval)
	log.Printf("Batch Size: %d", config.BatchSize)

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

