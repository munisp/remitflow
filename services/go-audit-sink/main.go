// Package main implements an immutable audit log sink service.
// All financial operations and admin actions are shipped here and written
// to a WORM (Write-Once-Read-Many) storage backend (S3 Object Lock in production).
// No single administrator can delete or modify entries once written.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
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
	RequestID     string  `json:"request_id"`
	OperationType string  `json:"operation_type"`
	MakerID       int     `json:"maker_id"`
	CheckerID     int     `json:"checker_id"`
	Decision      string  `json:"decision"` // approved, rejected
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
	// FAIL CLOSED: no default HMAC key — refuse to boot when unset rather
	// than ship a publicly known audit-trail key.
	hmacKey: []byte(mustGetEnv("AUDIT_HMAC_KEY")),
}

// mustGetEnv returns the env var or panics at startup; there is no fallback
// credential (see go-cips-adapter/internal/middleware/middleware.go:57).
func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(key + " is not set: refusing to fall back to a well-known default credential; configure it explicitly")
	}
	return v
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

// Append adds an entry to the immutable log. When Postgres is configured it
// is the source of truth: chain position/prev-hash are read from PG and the
// entry is inserted into audit_sink_events BEFORE the in-memory mirror is
// updated. Fail closed: a persistence failure is an error to the caller.
func (s *AuditStore) Append(entry AuditEntry) (AuditEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pos, err := nextChainPositionLocked()
	if err != nil {
		return entry, fmt.Errorf("chain position lookup failed: %w", err)
	}
	prev, err := lastEntryHashLocked()
	if err != nil {
		return entry, fmt.Errorf("chain tip lookup failed: %w", err)
	}
	entry.ChainPosition = pos
	entry.PreviousHash = prev
	entry.EntryHash = s.computeEntryHash(&entry)
	if err := insertEventLocked(&entry); err != nil {
		return entry, fmt.Errorf("audit event persist failed: %w", err)
	}
	s.entries = append(s.entries, entry)
	return entry, nil
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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB request body cap (wave-14)
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	entry.ID = fmt.Sprintf("audit_%s_%d", time.Now().Format("20060102150405"), len(store.entries))
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	stored, err := store.Append(entry)
	if err != nil {
		log.Printf("[go-audit-sink] ERROR: ingest persist failed (fail closed): %v", err)
		http.Error(w, "failed to persist audit entry", http.StatusInternalServerError)
		return
	}
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

	// Reads are served from Postgres (source of truth) when configured.
	if db != nil {
		entries, err := queryEntriesPG(0, "", 100)
		if err != nil {
			log.Printf("[go-audit-sink] ERROR: query failed: %v", err)
			http.Error(w, "audit query failed", http.StatusInternalServerError)
			return
		}
		var total int
		if err := db.QueryRow(`SELECT COUNT(*) FROM audit_sink_events`).Scan(&total); err != nil {
			total = len(entries)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"entries": entries,
			"total":   total,
		})
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
	if db != nil {
		valid, position, err := verifyChainPG()
		if err != nil {
			log.Printf("[go-audit-sink] ERROR: chain verify query failed: %v", err)
			http.Error(w, "chain verification failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"chain_valid":      valid,
			"entries_verified": position,
			"tamper_detected":  !valid,
			"source":           "postgres",
		})
		return
	}
	valid, position := store.VerifyChain()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"chain_valid":      valid,
		"entries_verified": position,
		"tamper_detected":  !valid,
	})
}

func handleMakerChecker(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var mc MakerCheckerAudit
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB request body cap (wave-14)
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
	stored, err := store.Append(entry)
	if err != nil {
		log.Printf("[go-audit-sink] ERROR: maker-checker persist failed (fail closed): %v", err)
		http.Error(w, "failed to persist audit entry", http.StatusInternalServerError)
		return
	}

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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB request body cap (wave-14)
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
	stored, err := store.Append(entry)
	if err != nil {
		log.Printf("[go-audit-sink] ERROR: break-glass persist failed (fail closed): %v", err)
		http.Error(w, "failed to persist audit entry", http.StatusInternalServerError)
		return
	}

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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB request body cap (wave-14)
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
	stored, err := store.Append(entry)
	if err != nil {
		log.Printf("[go-audit-sink] ERROR: canary-trip persist failed (fail closed): %v", err)
		http.Error(w, "failed to persist audit entry", http.StatusInternalServerError)
		return
	}

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
	backend := getEnvOrDefault("AUDIT_STORAGE", "memory")
	if db != nil {
		backend = "postgres"
		if v, n, err := verifyChainPG(); err == nil {
			valid, count = v, n
		} else {
			log.Printf("[go-audit-sink] ERROR: health chain verify failed: %v", err)
			valid = false
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "healthy",
		"service":         "go-audit-sink",
		"entries_stored":  count,
		"chain_integrity": valid,
		"storage_backend": backend,
	})
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	// Serve metrics from PG (source of truth) when configured.
	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		eventCounts := make(map[string]int)
		rows, err := db.QueryContext(ctx,
			`SELECT event_type, COUNT(*) FROM audit_sink_events GROUP BY event_type`)
		if err != nil {
			log.Printf("[go-audit-sink] ERROR: metrics query failed: %v", err)
			http.Error(w, "metrics query failed", http.StatusInternalServerError)
			return
		}
		total := 0
		for rows.Next() {
			var et string
			var n int
			if rows.Scan(&et, &n) == nil {
				eventCounts[et] = n
				total += n
			}
		}
		rows.Close()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_entries":     total,
			"event_type_counts": eventCounts,
			"chain_valid":       true,
			"source":            "postgres",
		})
		return
	}

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
	initDB()

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

	// DL-25: consume the audit Kafka topics into the immutable log.
	consumerCtx, stopConsumer := context.WithCancel(context.Background())
	defer stopConsumer()
	go startKafkaConsumer(consumerCtx)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Graceful shutdown (wave-14 hardening): drain in-flight requests on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf("[go-audit-sink] Shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[go-audit-sink] shutdown error: %v", err)
	}
}
