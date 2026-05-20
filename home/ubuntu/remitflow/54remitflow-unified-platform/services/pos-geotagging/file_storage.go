package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// FileStorage provides guaranteed file-based persistence
type FileStorage struct {
	dataDir      string
	terminals    map[string]*POSTerminal
	transactions map[string]*Transaction
	violations   map[string]*GeofenceViolation
	mu           sync.RWMutex
}

// NewFileStorage creates a new file storage instance
func NewFileStorage(dataDir string) *FileStorage {
	// Ensure data directory exists
	os.MkdirAll(dataDir, 0755)
	
	fs := &FileStorage{
		dataDir:      dataDir,
		terminals:    make(map[string]*POSTerminal),
		transactions: make(map[string]*Transaction),
		violations:   make(map[string]*GeofenceViolation),
	}
	
	// Load existing data
	fs.loadFromFiles()
	
	return fs
}

// loadFromFiles loads data from JSON files
func (fs *FileStorage) loadFromFiles() {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	
	// Load terminals
	terminalsFile := filepath.Join(fs.dataDir, "terminals.json")
	if data, err := ioutil.ReadFile(terminalsFile); err == nil {
		var terminals map[string]*POSTerminal
		if json.Unmarshal(data, &terminals) == nil {
			fs.terminals = terminals
		}
	}
	
	// Load transactions
	transactionsFile := filepath.Join(fs.dataDir, "transactions.json")
	if data, err := ioutil.ReadFile(transactionsFile); err == nil {
		var transactions map[string]*Transaction
		if json.Unmarshal(data, &transactions) == nil {
			fs.transactions = transactions
		}
	}
	
	// Load violations
	violationsFile := filepath.Join(fs.dataDir, "violations.json")
	if data, err := ioutil.ReadFile(violationsFile); err == nil {
		var violations map[string]*GeofenceViolation
		if json.Unmarshal(data, &violations) == nil {
			fs.violations = violations
		}
	}
}

// saveToFiles saves data to JSON files
func (fs *FileStorage) saveToFiles() error {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	
	// Save terminals
	terminalsFile := filepath.Join(fs.dataDir, "terminals.json")
	if terminalsData, err := json.MarshalIndent(fs.terminals, "", "  "); err == nil {
		if err := ioutil.WriteFile(terminalsFile, terminalsData, 0644); err != nil {
			return fmt.Errorf("failed to save terminals: %v", err)
		}
	}
	
	// Save transactions
	transactionsFile := filepath.Join(fs.dataDir, "transactions.json")
	if transactionsData, err := json.MarshalIndent(fs.transactions, "", "  "); err == nil {
		if err := ioutil.WriteFile(transactionsFile, transactionsData, 0644); err != nil {
			return fmt.Errorf("failed to save transactions: %v", err)
		}
	}
	
	// Save violations
	violationsFile := filepath.Join(fs.dataDir, "violations.json")
	if violationsData, err := json.MarshalIndent(fs.violations, "", "  "); err == nil {
		if err := ioutil.WriteFile(violationsFile, violationsData, 0644); err != nil {
			return fmt.Errorf("failed to save violations: %v", err)
		}
	}
	
	return nil
}

// POSTerminal represents a POS terminal with enhanced fields
type POSTerminal struct {
	ID                   string    `json:"id" gorm:"primaryKey"`
	TerminalID           string    `json:"terminal_id" gorm:"uniqueIndex"`
	BusinessName         string    `json:"business_name"`
	Latitude             float64   `json:"latitude"`
	Longitude            float64   `json:"longitude"`
	Accuracy             float64   `json:"accuracy"`
	BusinessRadius       float64   `json:"business_radius"`
	RegisteredAt         time.Time `json:"registered_at"`
	LastLocationUpdate   time.Time `json:"last_location_update"`
	IsActive             bool      `json:"is_active"`
	ComplianceStatus     string    `json:"compliance_status"` // COMPLIANT, NON_COMPLIANT, PENDING, VIRTUAL
	PTSARegistered       bool      `json:"ptsa_registered"`
	DataSource           string    `json:"data_source"` // PRIMARY, FALLBACK, CACHE, FILE, VIRTUAL
	LastSyncTime         time.Time `json:"last_sync_time"`
}

// Transaction represents a POS transaction with enhanced fields
type Transaction struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	TerminalID        string    `json:"terminal_id"`
	Amount            float64   `json:"amount"`
	Latitude          float64   `json:"latitude"`
	Longitude         float64   `json:"longitude"`
	LocationAccuracy  float64   `json:"location_accuracy"`
	Timestamp         time.Time `json:"timestamp"`
	Status            string    `json:"status"` // APPROVED, REJECTED, LOCATION_REJECTED, FRAUD_REVIEW
	LocationValid     bool      `json:"location_valid"`
	DistanceFromBase  float64   `json:"distance_from_base"`
	FraudScore        float64   `json:"fraud_score"`
	DataSource        string    `json:"data_source"`
	SyncStatus        string    `json:"sync_status"` // PENDING, SYNCED, FAILED
}

// GeofenceViolation represents a geofence violation with enhanced fields
type GeofenceViolation struct {
	ID            string    `json:"id" gorm:"primaryKey"`
	TerminalID    string    `json:"terminal_id"`
	TransactionID string    `json:"transaction_id"`
	ViolationType string    `json:"violation_type"`
	Distance      float64   `json:"distance"`
	Severity      string    `json:"severity"` // LOW, MEDIUM, HIGH
	Timestamp     time.Time `json:"timestamp"`
	Resolved      bool      `json:"resolved"`
	ActionTaken   string    `json:"action_taken"`
	DataSource    string    `json:"data_source"`
	SyncStatus    string    `json:"sync_status"`
}

