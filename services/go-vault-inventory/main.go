// RemitFlow — Vault Inventory Service (Go)
// BDC platform: denomination-level vault/drawer/CIT stock RPCs for branch
// gateways. Reads and guarded adjustments against bdc_denomination_inventory
// (drizzle/0089_bdc_platform.sql; optimistic-concurrency `version` column).
//
// Endpoints:
//   GET  /healthz
//   GET  /vault/stock/{tenantId}/{locationType}/{locationId}
//   POST /vault/stock/adjust                — version-guarded stocktake correction

package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var processStartTime = time.Now()

const (
	defaultPort = "8105"
	serviceName = "go-vault-inventory"
	version     = "v1"
)

var db *sql.DB

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, code, reason string) {
	writeJSON(w, status, map[string]string{"error": code, "reason": reason})
}

// round2 rounds to 2 decimal places (money columns are numeric(18,2) major units).
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func parseID(s string) (int64, error) {
	var id int64
	_, err := fmt.Sscanf(s, "%d", &id)
	return id, err
}

// validLocationType mirrors the DDL comment: 'vault'|'drawer'|'cit'.
func validLocationType(t string) bool {
	return t == "vault" || t == "drawer" || t == "cit"
}

// ─── Stock read ───────────────────────────────────────────────────────────────

type stockRow struct {
	Currency     string  `json:"currency"`
	Denomination float64 `json:"denomination"`
	NoteCount    int     `json:"noteCount"`
	Version      int     `json:"version"`
	Value        float64 `json:"value"` // denomination × noteCount
}

// buildStockQuery returns the read-only stock query and args.
func buildStockQuery(tenantID int64, locationType string, locationID int64) (string, []any) {
	return `SELECT currency, denomination, note_count, version
	       FROM bdc_denomination_inventory
	       WHERE tenant_id = $1 AND location_type = $2 AND location_id = $3
	       ORDER BY currency, denomination DESC`, []any{tenantID, locationType, locationID}
}

// computeTotals aggregates per-currency totals (denomination × noteCount).
func computeTotals(rows []stockRow) map[string]float64 {
	totals := map[string]float64{}
	for _, r := range rows {
		totals[r.Currency] = round2(totals[r.Currency] + round2(r.Denomination*float64(r.NoteCount)))
	}
	return totals
}

func handleGetStock(w http.ResponseWriter, r *http.Request) {
	tenantID, err := parseID(r.PathValue("tenantId"))
	if err != nil || tenantID <= 0 {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "tenantId must be a positive integer")
		return
	}
	locationType := r.PathValue("locationType")
	if !validLocationType(locationType) {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "locationType must be 'vault', 'drawer' or 'cit'")
		return
	}
	locationID, err := parseID(r.PathValue("locationId"))
	if err != nil || locationID <= 0 {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "locationId must be a positive integer")
		return
	}

	q, args := buildStockQuery(tenantID, locationType, locationID)
	rows, err := db.QueryContext(r.Context(), q, args...)
	if err != nil {
		log.Printf("[vault-inventory] stock query error: %v", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "stock query failed")
		return
	}
	defer rows.Close()

	stock := []stockRow{}
	for rows.Next() {
		var s stockRow
		if err := rows.Scan(&s.Currency, &s.Denomination, &s.NoteCount, &s.Version); err != nil {
			log.Printf("[vault-inventory] stock scan error: %v", err)
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "stock scan failed")
			return
		}
		s.Value = round2(s.Denomination * float64(s.NoteCount))
		stock = append(stock, s)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "stock iteration failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tenantId":     tenantID,
		"locationType": locationType,
		"locationId":   locationID,
		"rows":         stock,
		"totals":       computeTotals(stock),
	})
}

// ─── Guarded stock adjustment ────────────────────────────────────────────────

type adjustRequest struct {
	TenantID        int64   `json:"tenantId"`
	LocationType    string  `json:"locationType"`
	LocationID      int64   `json:"locationId"`
	Currency        string  `json:"currency"`
	Denomination    float64 `json:"denomination"`
	Delta           int     `json:"delta"`
	ExpectedVersion int     `json:"expectedVersion"`
}

func (a *adjustRequest) validate() string {
	if a.TenantID <= 0 {
		return "tenantId must be a positive integer"
	}
	if !validLocationType(a.LocationType) {
		return "locationType must be 'vault', 'drawer' or 'cit'"
	}
	if a.LocationID <= 0 {
		return "locationId must be a positive integer"
	}
	if len(a.Currency) != 3 || strings.ToUpper(a.Currency) != a.Currency {
		return "currency must be a 3-letter uppercase code"
	}
	if a.Denomination <= 0 {
		return "denomination must be > 0"
	}
	if a.Delta == 0 {
		return "delta must be non-zero"
	}
	if a.ExpectedVersion < 0 {
		return "expectedVersion must be >= 0"
	}
	return ""
}

// buildAdjustQuery returns the version-guarded UPDATE and its args. The WHERE
// clause enforces (a) optimistic concurrency via `version = $7` and (b) the
// non-negative stock invariant via `note_count + $6 >= 0`. Either failure
// yields 0 rows → the handler answers 409 CONFLICT.
func buildAdjustQuery(a adjustRequest) (string, []any) {
	return `UPDATE bdc_denomination_inventory
	       SET note_count = note_count + $6, version = version + 1, updated_at = now()
	       WHERE tenant_id = $1 AND location_type = $2 AND location_id = $3
	         AND currency = $4 AND denomination = $5
	         AND version = $7
	         AND note_count + $6 >= 0
	       RETURNING note_count, version`,
		[]any{a.TenantID, a.LocationType, a.LocationID, a.Currency, a.Denomination, a.Delta, a.ExpectedVersion}
}

// classifyAdjustErr maps a guarded-adjust failure to an HTTP response. A
// sql.ErrNoRows means the version guard, the row lookup, or the non-negative
// stock predicate rejected the write — all surface as 409 CONFLICT (fail
// closed, no partial write). Anything else is an internal error.
func classifyAdjustErr(err error) (status int, code, reason string) {
	if err == sql.ErrNoRows {
		return http.StatusConflict, "CONFLICT",
			"version mismatch, unknown denomination row, or negative resulting note count; re-read stock and retry"
	}
	return http.StatusInternalServerError, "INTERNAL", "adjustment failed"
}

func handleAdjust(w http.ResponseWriter, r *http.Request) {
	var req adjustRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if msg := req.validate(); msg != "" {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	q, args := buildAdjustQuery(req)
	var noteCount, newVersion int
	err := db.QueryRowContext(r.Context(), q, args...).Scan(&noteCount, &newVersion)
	if err != nil {
		status, code, reason := classifyAdjustErr(err)
		if status == http.StatusInternalServerError {
			log.Printf("[vault-inventory] adjust error: %v", err)
		}
		writeErr(w, status, code, reason)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tenantId":     req.TenantID,
		"locationType": req.LocationType,
		"locationId":   req.LocationID,
		"currency":     req.Currency,
		"denomination": round2(req.Denomination),
		"noteCount":    noteCount,
		"version":      newVersion,
	})
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// internalKeyAuth mirrors the sibling go-bdc-connector guard: the internal
// service key must be configured explicitly — no well-known fallback.
func internalKeyAuth(next http.Handler) http.Handler {
	expected := os.Getenv("INTERNAL_SERVICE_KEY")
	if expected == "" {
		panic("INTERNAL_SERVICE_KEY is not set: refusing to fall back to a well-known default credential; configure the internal service key explicitly")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-Internal-Key")
		if subtle.ConstantTimeCompare([]byte(key), []byte(expected)) != 1 {
			writeErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid internal service key")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// traceMiddleware propagates X-Request-Id / X-Tenant-Id headers (echo back for
// the gateway trace chain, matching sibling services).
func traceMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := r.Header.Get("X-Request-Id"); id != "" {
			w.Header().Set("X-Request-Id", id)
		}
		if tid := r.Header.Get("X-Tenant-Id"); tid != "" {
			w.Header().Set("X-Tenant-Id", tid)
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://remitflow:remitflow@postgres:5432/remitflow?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[vault-inventory] DB open error: %v", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Printf("[vault-inventory] DB ping failed: %v", err)
	} else {
		log.Println("[vault-inventory] PostgreSQL connected")
	}
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	dbStatus := "up"
	if db == nil || db.Ping() != nil {
		dbStatus = "down"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"service":   serviceName,
		"version":   version,
		"db":        dbStatus,
		"uptime_ms": time.Since(processStartTime).Milliseconds(),
	})
}

func main() {
	initDB()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)

	secured := http.NewServeMux()
	secured.HandleFunc("GET /vault/stock/{tenantId}/{locationType}/{locationId}", handleGetStock)
	secured.HandleFunc("POST /vault/stock/adjust", handleAdjust)
	mux.Handle("/vault/", internalKeyAuth(traceMiddleware(secured)))

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[vault-inventory] Shutdown error: %v", err)
		}
	}()

	log.Printf("[vault-inventory] Listening on :%s", port)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n",
		serviceName, time.Since(processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[vault-inventory] Server error: %v", err)
	}
}
