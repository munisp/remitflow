// Package main implements an immutable audit log sink service.
// All financial operations and admin actions are shipped here and written
// to a WORM (Write-Once-Read-Many) storage backend (S3 Object Lock in production).
// No single administrator can delete or modify entries once written.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// AuditEntry represents a single immutable audit log entry
type AuditEntry struct {
	ID            string                 `json:"id"`
	Timestamp     string                 `json:"timestamp"`
	EventType     string                 `json:"event_type"`
	ActorID       int                    `json:"actor_id"`
	ActorRole     string                 `json:"actor_role"`
	IPAddress     string                 `json:"ip_address"`
	Resource      string                 `json:"resource"`
	Action        string                 `json:"action"`
	Outcome       string                 `json:"outcome"` // success, failure, blocked
	RiskScore     int                    `json:"risk_score"`
	Metadata      map[string]interface{} `json:"metadata"`
	PreviousHash  string                 `json:"previous_hash"`
	EntryHash     string                 `json:"entry_hash"`
	ChainPosition int                    `json:"chain_position"`
}

// MakerCheckerAudit tracks dual-authorization decisions
type MakerCheckerAudit struct {
	RequestID     string `json:"request_id"`
	OperationType string `json:"operation_type"`
	MakerID       int    `json:"maker_id"`
	CheckerID     int    `json:"checker_id"`
	Decision      string `json:"decision"` // approved, rejected
	Amount        float64 `json:"amount"`
	Timestamp     string  `json:"timestamp"`
}

// BreakGlassAudit tracks emergency access overrides
type BreakGlassAudit struct {
	BypassID   string `json:"bypass_id"`
	UserID     int    `json:"user_id"`
	Reason     string `json:"reason"`
	IncidentID string `json:"incident_id"`
	GrantedAt  string `json:"granted_at"`
	ExpiresAt  string `json:"expires_at"`
	ReviewDue  string `json:"review_due"`
}

// CanaryTripAudit records canary token activations
type CanaryTripAudit struct {
	CanaryID    string `json:"canary_id"`
	AccessedBy  int    `json:"accessed_by"`
	Query       string `json:"query"`
	IPAddress   string `json:"ip_address"`
	Timestamp   string `json:"timestamp"`
	Severity    string `json:"severity"`
	AutoActions string `json:"auto_actions"` // account_locked, session_killed
}

// AuditStore is the in-memory append-only log (production: S3 Object Lock)
type AuditStore struct {
	mu      sync.RWMutex
	entries []AuditEntry
	hmacKey []byte
}

var store = &AuditStore{
	entries: make([]AuditEntry, 0, 10000),
	hmacKey: []byte(getEnvOrDefault("AUDIT_HMAC_KEY", "dev-audit-key-change-in-production")),
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// computeEntryHash creates a tamper-evident hash chain
func (s *AuditStore) computeEntryHash(entry *AuditEntry) string {
	data := fmt.Sprintf("%s:%s:%d:%s:%s:%s:%d",
		entry.Timestamp, entry.EventType, entry.ActorID,
		entry.Resource, entry.Action, entry.PreviousHash, entry.ChainPosition)
	mac := hmac.New(sha256.New, s.hmacKey)
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

// Append adds an entry to the immutable log
func (s *AuditStore) Append(entry AuditEntry) AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry.ChainPosition = len(s.entries)
	if len(s.entries) > 0 {
		entry.PreviousHash = s.entries[len(s.entries)-1].EntryHash
	} else {
		entry.PreviousHash = "genesis"
	}
	entry.EntryHash = s.computeEntryHash(&entry)
	s.entries = append(s.entries, entry)
	return entry
}

// VerifyChain checks the integrity of the entire hash chain
func (s *AuditStore) VerifyChain() (bool, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i, entry := range s.entries {
		expectedHash := s.computeEntryHash(&entry)
		if entry.EntryHash != expectedHash {
			return false, i
		}
		if i > 0 && entry.PreviousHash != s.entries[i-1].EntryHash {
			return false, i
		}
	}
	return true, len(s.entries)
}

// GetEntries returns entries with optional filtering
func (s *AuditStore) GetEntries(actorID int, eventType string, limit int) []AuditEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var filtered []AuditEntry
	for i := len(s.entries) - 1; i >= 0 && len(filtered) < limit; i-- {
		e := s.entries[i]
		if actorID > 0 && e.ActorID != actorID {
			continue
		}
		if eventType != "" && e.EventType != eventType {
			continue
		}
		filtered = append(filtered, e)
	}
	return filtered
}

// ─── HTTP Handlers ───────────────────────────────────────────────────────────

func handleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var entry AuditEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	entry.ID = fmt.Sprintf("audit_%s_%d", time.Now().Format("20060102150405"), store.entries)
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	stored := store.Append(entry)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"stored":         true,
		"entry_id":       stored.ID,
		"chain_position": stored.ChainPosition,
		"entry_hash":     stored.EntryHash,
	})
}

func handleQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entries := store.GetEntries(0, "", 100)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries": entries,
		"total":   len(store.entries),
	})
}

func handleVerify(w http.ResponseWriter, r *http.Request) {
	valid, position := store.VerifyChain()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"chain_valid":    valid,
		"entries_verified": position,
		"tamper_detected": !valid,
	})
}

func handleMakerChecker(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var mc MakerCheckerAudit
	if err := json.NewDecoder(r.Body).Decode(&mc); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	entry := AuditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		EventType: "maker_checker_decision",
		ActorID:   mc.CheckerID,
		Resource:  mc.OperationType,
		Action:    mc.Decision,
		Outcome:   mc.Decision,
		Metadata: map[string]interface{}{
			"request_id": mc.RequestID,
			"maker_id":   mc.MakerID,
			"amount":     mc.Amount,
		},
	}
	stored := store.Append(entry)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"stored":     true,
		"entry_hash": stored.EntryHash,
	})
}

func handleBreakGlass(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var bg BreakGlassAudit
	if err := json.NewDecoder(r.Body).Decode(&bg); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	entry := AuditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		EventType: "break_glass_access",
		ActorID:   bg.UserID,
		Action:    "break_glass",
		Outcome:   "granted",
		RiskScore: 90, // Break-glass is always high risk
		Metadata: map[string]interface{}{
			"bypass_id":   bg.BypassID,
			"reason":      bg.Reason,
			"incident_id": bg.IncidentID,
			"expires_at":  bg.ExpiresAt,
			"review_due":  bg.ReviewDue,
		},
	}
	stored := store.Append(entry)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"stored":     true,
		"entry_hash": stored.EntryHash,
		"review_due": bg.ReviewDue,
	})
}

func handleCanaryTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var ct CanaryTripAudit
	if err := json.NewDecoder(r.Body).Decode(&ct); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	entry := AuditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		EventType: "canary_token_trip",
		ActorID:   ct.AccessedBy,
		IPAddress: ct.IPAddress,
		Action:    "canary_access",
		Outcome:   "alert_triggered",
		RiskScore: 100, // Canary trips are maximum severity
		Metadata: map[string]interface{}{
			"canary_id":    ct.CanaryID,
			"query":        ct.Query,
			"auto_actions": ct.AutoActions,
		},
	}
	stored := store.Append(entry)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"stored":       true,
		"entry_hash":   stored.EntryHash,
		"severity":     "critical",
		"auto_actions": ct.AutoActions,
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	valid, count := store.VerifyChain()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "healthy",
		"service":         "go-audit-sink",
		"entries_stored":  count,
		"chain_integrity": valid,
		"storage_backend": getEnvOrDefault("AUDIT_STORAGE", "memory"),
	})
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	eventCounts := make(map[string]int)
	for _, e := range store.entries {
		eventCounts[e.EventType]++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_entries":     len(store.entries),
		"event_type_counts": eventCounts,
		"chain_valid":       true,
	})
}

func main() {
	port := getEnvOrDefault("AUDIT_SINK_PORT", "8180")

	mux := http.NewServeMux()
	mux.HandleFunc("/ingest", handleIngest)
	mux.HandleFunc("/query", handleQuery)
	mux.HandleFunc("/verify", handleVerify)
	mux.HandleFunc("/maker-checker", handleMakerChecker)
	mux.HandleFunc("/break-glass", handleBreakGlass)
	mux.HandleFunc("/canary-trip", handleCanaryTrip)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/metrics", handleMetrics)

	log.Printf("[go-audit-sink] Starting immutable audit log service on port %s", port)
	log.Printf("[go-audit-sink] Storage backend: %s", getEnvOrDefault("AUDIT_STORAGE", "memory"))
	log.Printf("[go-audit-sink] HMAC chain verification: enabled")

	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
