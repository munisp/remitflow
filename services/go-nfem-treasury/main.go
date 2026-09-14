// RemitFlow — NFEM Treasury Service (Go)
// BDC platform: NFEM weekly FX purchase lifecycle support + CBN FXBT adapter.
//
// Honest-adapter rule (SPEC-bdc §0.4): the FXBT adapter NEVER fabricates a real
// market purchase. FXBT_MODE=sandbox returns explicit {simulated:true,...}
// markers; FXBT_MODE=production without configured credentials fails closed
// with 503 UNAVAILABLE.
//
// Endpoints:
//   GET  /healthz
//   POST /nfem/fxbt/request              — submit FX purchase request to the FXBT adapter
//   GET  /nfem/entitlement/{tenantId}    — read-only entitlement + batch mirror (?bankCode= filter)
//   POST /nfem/liquidate                 — guarded liquidation-intent record (market|return)

package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	defaultPort = "8103"
	serviceName = "go-nfem-treasury"
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

// newUUIDv4 returns a random RFC 4122 version-4 UUID (crypto/rand, no dep).
func newUUIDv4() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Fail closed is not required here (reference label only), but never
		// return a predictable value: fall back to a timestamp-based suffix.
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	var sb strings.Builder
	sb.Grow(36)
	for i, c := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			sb.WriteByte('-')
		}
		var tmp [2]byte
		hex.Encode(tmp[:], []byte{c})
		sb.Write(tmp[:])
	}
	return sb.String()
}

// ─── FXBT adapter (honest modes, SPEC-bdc §0.4) ──────────────────────────────

type fxbtConfig struct {
	Mode         string // "sandbox" | "production"
	BaseURL      string
	ClientID     string
	ClientSecret string
}

func loadFXBTConfig() fxbtConfig {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("FXBT_MODE")))
	if mode == "" {
		mode = "sandbox"
	}
	return fxbtConfig{
		Mode:         mode,
		BaseURL:      strings.TrimRight(os.Getenv("FXBT_BASE_URL"), "/"),
		ClientID:     os.Getenv("FXBT_CLIENT_ID"),
		ClientSecret: os.Getenv("FXBT_CLIENT_SECRET"),
	}
}

type fxbtRequest struct {
	TenantID  int64   `json:"tenantId"`
	BankCode  string  `json:"bankCode"`
	AmountUSD float64 `json:"amountUsd"`
	Rate      float64 `json:"rate"`
}

func (r *fxbtRequest) validate() string {
	if r.TenantID <= 0 {
		return "tenantId must be a positive integer"
	}
	if strings.TrimSpace(r.BankCode) == "" || len(r.BankCode) > 16 {
		return "bankCode is required (max 16 chars)"
	}
	if r.AmountUSD <= 0 {
		return "amountUsd must be > 0"
	}
	if r.Rate <= 0 {
		return "rate must be > 0"
	}
	return ""
}

// fxbtConfigured reports whether production credentials are present.
func (c fxbtConfig) fxbtConfigured() bool {
	return c.BaseURL != "" && c.ClientID != "" && c.ClientSecret != ""
}

// fxbtResult is the adapter response. Simulated is true ONLY for sandbox mode.
type fxbtResult struct {
	Simulated     bool    `json:"simulated"`
	FXBTReference string  `json:"fxbtReference,omitempty"`
	BankCode      string  `json:"bankCode"`
	AmountUSD     float64 `json:"amountUsd"`
	Rate          float64 `json:"rate"`
	Message       string  `json:"message"`
}

// submitFXBT handles one purchase request. It returns (result, httpStatus).
// It NEVER invents a market execution: sandbox is labelled simulated, and
// production without credentials is a hard UNAVAILABLE.
func submitFXBT(ctx context.Context, cfg fxbtConfig, req fxbtRequest) (fxbtResult, int) {
	if cfg.Mode != "production" {
		// Sandbox: explicit simulation marker, no external call.
		return fxbtResult{
			Simulated:     true,
			FXBTReference: "SIM-FXBT-" + newUUIDv4(),
			BankCode:      req.BankCode,
			AmountUSD:     round2(req.AmountUSD),
			Rate:          req.Rate,
			Message:       "sandbox mode: no FXBT submission was made; reference is simulated",
		}, http.StatusOK
	}

	if !cfg.fxbtConfigured() {
		return fxbtResult{}, http.StatusServiceUnavailable
	}

	// Production with credentials: make the real call, fail closed on error.
	payload, _ := json.Marshal(map[string]any{
		"tenantId":  req.TenantID,
		"bankCode":  req.BankCode,
		"amountUsd": round2(req.AmountUSD),
		"rate":      req.Rate,
	})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/fxbt/requests", strings.NewReader(string(payload)))
	if err != nil {
		return fxbtResult{}, http.StatusServiceUnavailable
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Client-Id", cfg.ClientID)
	httpReq.Header.Set("X-Client-Secret", cfg.ClientSecret)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[nfem-treasury] FXBT call failed: %v", err)
		return fxbtResult{}, http.StatusBadGateway
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		log.Printf("[nfem-treasury] FXBT rejected: status=%d body=%s", resp.StatusCode, string(body))
		return fxbtResult{}, resp.StatusCode
	}
	var parsed struct {
		Reference string `json:"reference"`
	}
	_ = json.Unmarshal(body, &parsed)
	return fxbtResult{
		Simulated:     false,
		FXBTReference: parsed.Reference,
		BankCode:      req.BankCode,
		AmountUSD:     round2(req.AmountUSD),
		Rate:          req.Rate,
		Message:       "submitted to FXBT; purchase settles only on bank confirmation",
	}, http.StatusOK
}

func handleFXBTRequest(cfg fxbtConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req fxbtRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
			return
		}
		if msg := req.validate(); msg != "" {
			writeErr(w, http.StatusBadRequest, "BAD_REQUEST", msg)
			return
		}
		res, status := submitFXBT(r.Context(), cfg, req)
		if status == http.StatusServiceUnavailable && cfg.Mode == "production" && !cfg.fxbtConfigured() {
			writeErr(w, http.StatusServiceUnavailable, "UNAVAILABLE", "credentials not configured")
			return
		}
		if status == http.StatusBadGateway {
			writeErr(w, http.StatusBadGateway, "UNAVAILABLE", "FXBT upstream unreachable; no purchase made")
			return
		}
		if status != http.StatusOK {
			writeErr(w, status, "FXBT_REJECTED", "FXBT upstream rejected the request; no purchase made")
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

// ─── Entitlement read model ──────────────────────────────────────────────────

// buildEntitlementQuery returns the read-only entitlement query and args.
// Money columns are numeric(18,2) major units (cap_usd / used_usd) — see
// drizzle/0089_bdc_platform.sql.
func buildEntitlementQuery(tenantID int64, bankCode string) (string, []any) {
	q := `SELECT id, tenant_id, bank_code, week_start, cap_usd, used_usd, version
	      FROM bdc_nfem_entitlements
	      WHERE tenant_id = $1`
	args := []any{tenantID}
	if bankCode != "" {
		q += ` AND bank_code = $2`
		args = append(args, bankCode)
	}
	q += ` ORDER BY week_start DESC LIMIT 52`
	return q, args
}

// buildBatchQuery returns the read-only purchase-batch query and args. When
// bankCode is set, batches are filtered via their entitlement row.
func buildBatchQuery(tenantID int64, bankCode string) (string, []any) {
	args := []any{tenantID}
	if bankCode != "" {
		return `SELECT b.id, b.tenant_id, b.entitlement_id, b.amount_usd, b.rate, b.naira_paid,
	              b.fxbt_reference, b.status, b.purchased_at, b.deadline_at, b.liquidated_at, b.created_at
	       FROM bdc_nfem_purchase_batches b
	       JOIN bdc_nfem_entitlements e ON e.id = b.entitlement_id
	       WHERE b.tenant_id = $1 AND e.bank_code = $2
	       ORDER BY b.created_at DESC LIMIT 100`, append(args, bankCode)
	}
	return `SELECT b.id, b.tenant_id, b.entitlement_id, b.amount_usd, b.rate, b.naira_paid,
	              b.fxbt_reference, b.status, b.purchased_at, b.deadline_at, b.liquidated_at, b.created_at
	       FROM bdc_nfem_purchase_batches b
	       WHERE b.tenant_id = $1
	       ORDER BY b.created_at DESC LIMIT 100`, args
}

type entitlementDTO struct {
	ID           int64   `json:"id"`
	TenantID     int64   `json:"tenantId"`
	BankCode     string  `json:"bankCode"`
	WeekStart    string  `json:"weekStart"`
	CapUSD       float64 `json:"capUsd"`
	UsedUSD      float64 `json:"usedUsd"`
	RemainingUSD float64 `json:"remainingUsd"`
	Version      int     `json:"version"`
}

// mapEntitlement maps a raw row to the DTO, computing the remaining headroom.
func mapEntitlement(id, tenantID int64, bankCode string, weekStart time.Time, capUSD, usedUSD float64, version int) entitlementDTO {
	return entitlementDTO{
		ID:           id,
		TenantID:     tenantID,
		BankCode:     bankCode,
		WeekStart:    weekStart.Format("2006-01-02"),
		CapUSD:       round2(capUSD),
		UsedUSD:      round2(usedUSD),
		RemainingUSD: round2(capUSD - usedUSD),
		Version:      version,
	}
}

type batchDTO struct {
	ID            int64      `json:"id"`
	TenantID      int64      `json:"tenantId"`
	EntitlementID *int64     `json:"entitlementId,omitempty"`
	AmountUSD     float64    `json:"amountUsd"`
	Rate          float64    `json:"rate"`
	NairaPaid     float64    `json:"nairaPaid"`
	FXBTReference *string    `json:"fxbtReference,omitempty"`
	Status        string     `json:"status"`
	PurchasedAt   *time.Time `json:"purchasedAt,omitempty"`
	DeadlineAt    *time.Time `json:"deadlineAt,omitempty"`
	LiquidatedAt  *time.Time `json:"liquidatedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

func handleEntitlement(w http.ResponseWriter, r *http.Request) {
	tenantID, err := parseID(r.PathValue("tenantId"))
	if err != nil || tenantID <= 0 {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "tenantId must be a positive integer")
		return
	}
	bankCode := strings.TrimSpace(r.URL.Query().Get("bankCode"))

	entitlements := []entitlementDTO{}
	eq, eargs := buildEntitlementQuery(tenantID, bankCode)
	rows, err := db.QueryContext(r.Context(), eq, eargs...)
	if err != nil {
		log.Printf("[nfem-treasury] entitlement query error: %v", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "entitlement query failed")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id, tid   int64
			bc        sql.NullString
			weekStart time.Time
			capUSD    float64
			usedUSD   float64
			ver       int
		)
		if err := rows.Scan(&id, &tid, &bc, &weekStart, &capUSD, &usedUSD, &ver); err != nil {
			log.Printf("[nfem-treasury] entitlement scan error: %v", err)
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "entitlement scan failed")
			return
		}
		entitlements = append(entitlements, mapEntitlement(id, tid, bc.String, weekStart, capUSD, usedUSD, ver))
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "entitlement iteration failed")
		return
	}

	batches := []batchDTO{}
	bq, bargs := buildBatchQuery(tenantID, bankCode)
	brows, err := db.QueryContext(r.Context(), bq, bargs...)
	if err != nil {
		log.Printf("[nfem-treasury] batch query error: %v", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "batch query failed")
		return
	}
	defer brows.Close()
	for brows.Next() {
		var b batchDTO
		if err := brows.Scan(&b.ID, &b.TenantID, &b.EntitlementID, &b.AmountUSD, &b.Rate, &b.NairaPaid,
			&b.FXBTReference, &b.Status, &b.PurchasedAt, &b.DeadlineAt, &b.LiquidatedAt, &b.CreatedAt); err != nil {
			log.Printf("[nfem-treasury] batch scan error: %v", err)
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "batch scan failed")
			return
		}
		batches = append(batches, b)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tenantId":     tenantID,
		"bankCode":     bankCode,
		"entitlements": entitlements,
		"batches":      batches,
	})
}

// ─── Liquidation intent (guarded single-winner claim) ────────────────────────

type liquidateRequest struct {
	BatchID int64  `json:"batchId"`
	Mode    string `json:"mode"` // "market" | "return"
}

// liquidationTarget maps a liquidation mode to its terminal batch status.
func liquidationTarget(mode string) (string, bool) {
	switch mode {
	case "market":
		return "liquidated", true
	case "return":
		return "returned", true
	}
	return "", false
}

// buildLiquidationUpdate returns the guarded UPDATE for the given mode. The
// WHERE clause enforces the single-winner claim: only a batch still in
// 'selling' can transition, so concurrent losers get 0 rows affected.
func buildLiquidationUpdate(mode string) string {
	target, _ := liquidationTarget(mode)
	if mode == "market" {
		return `UPDATE bdc_nfem_purchase_batches
	       SET status = '` + target + `', liquidated_at = now(), updated_at = now()
	       WHERE id = $1 AND status = 'selling'`
	}
	// 'return' mode: no liquidated_at — the FX goes back to the issuing bank.
	return `UPDATE bdc_nfem_purchase_batches
	       SET status = '` + target + `', updated_at = now()
	       WHERE id = $1 AND status = 'selling'`
}

func handleLiquidate(w http.ResponseWriter, r *http.Request) {
	var req liquidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.BatchID <= 0 {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "batchId must be a positive integer")
		return
	}
	if _, ok := liquidationTarget(req.Mode); !ok {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "mode must be 'market' or 'return'")
		return
	}

	// Validate batch exists and inspect its state.
	var (
		tenantID    int64
		status      string
		amountUSD   float64
		rate        float64
		fxbtRef     sql.NullString
		deadlineAt  sql.NullTime
		purchasedAt sql.NullTime
	)
	err := db.QueryRowContext(r.Context(),
		`SELECT tenant_id, status, amount_usd, rate, fxbt_reference, deadline_at, purchased_at
		 FROM bdc_nfem_purchase_batches WHERE id = $1`, req.BatchID).
		Scan(&tenantID, &status, &amountUSD, &rate, &fxbtRef, &deadlineAt, &purchasedAt)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "batch not found")
		return
	}
	if err != nil {
		log.Printf("[nfem-treasury] batch lookup error: %v", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "batch lookup failed")
		return
	}
	if status != "selling" {
		writeErr(w, http.StatusConflict, "INVALID_STATE",
			fmt.Sprintf("batch is '%s'; only 'selling' batches can be liquidated or returned", status))
		return
	}

	// Guarded single-winner claim (SPEC-bdc §0.5b).
	res, err := db.ExecContext(r.Context(), buildLiquidationUpdate(req.Mode), req.BatchID)
	if err != nil {
		log.Printf("[nfem-treasury] liquidation update error: %v", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "liquidation update failed")
		return
	}
	affected, err := res.RowsAffected()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "could not confirm update")
		return
	}
	if affected == 0 {
		writeErr(w, http.StatusConflict, "CONFLICT", "batch state changed concurrently; liquidation not recorded")
		return
	}

	target, _ := liquidationTarget(req.Mode)
	instructionType := "SELL_TO_PUBLIC"
	note := "Sell the FX to retail customers within the 24-hour NFEM window. " +
		"This service records the operator-attested instruction only; no market execution was performed."
	if req.Mode == "return" {
		instructionType = "RETURN_TO_BANK"
		note = "Return the unsold FX to the issuing bank. The naira return leg must be recorded " +
			"by the core ledger; this service performed no bank-side execution."
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"batchId":  req.BatchID,
		"tenantId": tenantID,
		"mode":     req.Mode,
		"status":   target,
		"instruction": map[string]any{
			"type":          instructionType,
			"amountUsd":     round2(amountUSD),
			"rate":          rate,
			"fxbtReference": fxbtRef.String,
			"deadlineAt":    nullTimePtr(deadlineAt),
			"note":          note,
		},
		"externalExecution": "operator_attested",
		"simulated":         false,
	})
}

func nullTimePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func parseID(s string) (int64, error) {
	var id int64
	_, err := fmt.Sscanf(s, "%d", &id)
	return id, err
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
		log.Printf("[nfem-treasury] DB open error: %v", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Printf("[nfem-treasury] DB ping failed: %v", err)
	} else {
		log.Println("[nfem-treasury] PostgreSQL connected")
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
	cfg := loadFXBTConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)

	secured := http.NewServeMux()
	secured.HandleFunc("POST /nfem/fxbt/request", handleFXBTRequest(cfg))
	secured.HandleFunc("GET /nfem/entitlement/{tenantId}", handleEntitlement)
	secured.HandleFunc("POST /nfem/liquidate", handleLiquidate)
	mux.Handle("/nfem/", internalKeyAuth(traceMiddleware(secured)))

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
			log.Printf("[nfem-treasury] Shutdown error: %v", err)
		}
	}()

	log.Printf("[nfem-treasury] Listening on :%s (FXBT_MODE=%s)", port, cfg.Mode)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n",
		serviceName, time.Since(processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[nfem-treasury] Server error: %v", err)
	}
}
