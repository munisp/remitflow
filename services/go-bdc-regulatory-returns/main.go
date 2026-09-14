// RemitFlow — BDC Regulatory Returns Service (Go)
// Builds and submits the periodic regulatory returns a CBN-licensed BDC must
// file: FIFX (FX purchase/sale), FinA (financial position), CARP (consolidated
// branch activity), TRMS (transaction monitoring) and the CBN extranet upload.
//
// Honest-adapter policy (SPEC-bdc §0 rule 4):
//   - Real CBN field layouts are NOT public → all builders emit
//     formatVersion "v1-fixture"; fixture fidelity is validated in the PA
//     window. This service NEVER claims CBN conformance.
//   - Submissions run in `sandbox` mode (explicit simulated:true markers) or
//     `production` mode; production without configured CBN extranet
//     credentials fails closed with HTTP 503 UNAVAILABLE. A fabricated
//     success is never returned.
//
// Endpoints:
//
//	POST /returns/build        — deterministic payload builder + validation
//	POST /returns/submit       — sandbox simulation / production submission
//	GET  /returns/status/:id   — submission status (in-memory + optional PG)
//	GET  /healthz              — liveness
//
// Port: 8137 (env PORT)
package main

import (
	"bytes"
	"context"
	"crypto/rand"
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

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

var _processStartTime = time.Now()

const (
	SERVICE_NAME = "go-bdc-regulatory-returns"
	VERSION      = "v1"
)

var (
	port             = envOr("PORT", "8137")
	returnsMode      = envOr("BDC_RETURNS_MODE", "sandbox") // sandbox | production
	extranetBaseURL  = os.Getenv("CBN_EXTRANET_BASE_URL")
	extranetToken    = os.Getenv("CBN_EXTRANET_TOKEN")
	submissionClient = &http.Client{Timeout: 15 * time.Second} // bounded: hung extranet must not tie up callers

	db *sql.DB
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// newUUID returns a RFC 4122 v4 UUID from crypto/rand (no external dep).
func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is fatal-grade; fall back to time-based entropy
		// but keep the marker explicit in logs.
		log.Printf("[Returns] crypto/rand unavailable: %v", err)
		n := time.Now().UnixNano()
		for i := range b {
			b[i] = byte(n >> (uint(i%8) * 8))
		}
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ─── API models ───────────────────────────────────────────────────────────────

type BuildRequest struct {
	TenantID    int64      `json:"tenantId"`
	ReturnType  string     `json:"returnType"`
	PeriodStart string     `json:"periodStart"`
	PeriodEnd   string     `json:"periodEnd"`
	Data        ReturnData `json:"data"`
}

type BuildResponse struct {
	Payload          interface{}       `json:"payload"`
	ValidationErrors []ValidationError `json:"validationErrors"`
	FormatVersion    string            `json:"formatVersion"`
	Metadata         map[string]string `json:"metadata"`
}

type SubmitRequest struct {
	ReturnType string          `json:"returnType"`
	Payload    json.RawMessage `json:"payload"`
}

type SubmitResponse struct {
	ID         string `json:"id"`
	ReturnType string `json:"returnType"`
	Mode       string `json:"mode"`
	Simulated  bool   `json:"simulated"`
	AckRef     string `json:"ackRef,omitempty"`
	Status     string `json:"status"`
}

type errorResponse struct {
	Error  string `json:"error"`
	Reason string `json:"reason,omitempty"`
}

// SubmissionRecord is the status-store row for GET /returns/status/:id.
type SubmissionRecord struct {
	ID         string `json:"id"`
	ReturnType string `json:"returnType"`
	Mode       string `json:"mode"`
	Simulated  bool   `json:"simulated"`
	AckRef     string `json:"ackRef,omitempty"`
	Status     string `json:"status"` // simulated | submitted | failed
	Detail     string `json:"detail,omitempty"`
	CreatedAt  string `json:"createdAt"`
}

// ─── Status store: in-memory, optionally mirrored to Postgres ────────────────

var (
	storeMu sync.RWMutex
	store   = map[string]*SubmissionRecord{}
)

func storePut(rec *SubmissionRecord) {
	storeMu.Lock()
	store[rec.ID] = rec
	storeMu.Unlock()
	if db != nil {
		_, err := db.Exec(`
			INSERT INTO bdc_return_submissions (id, return_type, mode, simulated, ack_ref, status, detail, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail`,
			rec.ID, rec.ReturnType, rec.Mode, rec.Simulated, rec.AckRef, rec.Status, rec.Detail, rec.CreatedAt,
		)
		if err != nil {
			log.Printf("[Returns] PG mirror insert error for %s: %v", rec.ID, err)
		}
	}
}

func storeGet(id string) (*SubmissionRecord, bool) {
	storeMu.RLock()
	rec, ok := store[id]
	storeMu.RUnlock()
	if ok {
		return rec, true
	}
	if db != nil {
		row := db.QueryRow(`
			SELECT id, return_type, mode, simulated, COALESCE(ack_ref,''), status, COALESCE(detail,''), created_at
			FROM bdc_return_submissions WHERE id = $1`, id)
		var r SubmissionRecord
		if err := row.Scan(&r.ID, &r.ReturnType, &r.Mode, &r.Simulated, &r.AckRef, &r.Status, &r.Detail, &r.CreatedAt); err == nil {
			return &r, true
		}
	}
	return nil, false
}

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Println("[Returns] DATABASE_URL not set — in-memory status store only")
		return
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[Returns] DB open error (in-memory only): %v", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Printf("[Returns] DB ping failed (in-memory only): %v", err)
		db = nil
		return
	}
	// Persistence mirror for the status endpoint only. Authoritative returns
	// staging lives in the TS-owned bdc_regulatory_returns table (W0 schema);
	// this table is this service's own submission ledger (sibling convention:
	// go-bdc-connector ensureTransferTable).
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS bdc_return_submissions (
			id VARCHAR(128) PRIMARY KEY,
			return_type VARCHAR(10) NOT NULL,
			mode VARCHAR(12) NOT NULL,
			simulated BOOLEAN NOT NULL,
			ack_ref VARCHAR(128),
			status VARCHAR(16) NOT NULL,
			detail TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		log.Printf("[Returns] table ensure error: %v", err)
	} else {
		log.Println("[Returns] PostgreSQL connected — bdc_return_submissions ready")
	}
}

// ─── Middleware: trace/tenant header propagation ─────────────────────────────

// traceTenantMiddleware propagates the platform trace/tenant headers into the
// request context, echoes the trace id on the response, and generates one if
// absent so downstream log lines are correlatable.
func traceTenantMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		traceID := c.GetHeader("X-Trace-Id")
		if traceID == "" {
			traceID = newUUID()
		}
		c.Set("traceId", traceID)
		c.Set("tenantId", c.GetHeader("X-Tenant-Id"))
		c.Header("X-Trace-Id", traceID)
		c.Next()
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": SERVICE_NAME,
		"version": VERSION,
		"mode":    returnsMode,
		"db":      db != nil,
	})
}

func buildHandler(c *gin.Context) {
	var req BuildRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "BAD_REQUEST", Reason: err.Error()})
		return
	}
	if !returnTypes[req.ReturnType] {
		c.JSON(http.StatusBadRequest, errorResponse{
			Error:  "BAD_REQUEST",
			Reason: fmt.Sprintf("unknown returnType %q (want fifx|fina|carp|trms|extranet)", req.ReturnType),
		})
		return
	}
	payload, errs := buildReturn(req.TenantID, req.ReturnType, req.PeriodStart, req.PeriodEnd, req.Data)
	if errs == nil {
		errs = []ValidationError{}
	}
	c.JSON(http.StatusOK, BuildResponse{
		Payload:          payload,
		ValidationErrors: errs,
		FormatVersion:    FixtureFormatVersion,
		Metadata: map[string]string{
			"fixtureNotice": fixtureNotice,
			"service":       SERVICE_NAME,
			"version":       VERSION,
		},
	})
}

func submitHandler(c *gin.Context) {
	var req SubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "BAD_REQUEST", Reason: err.Error()})
		return
	}
	if !returnTypes[req.ReturnType] {
		c.JSON(http.StatusBadRequest, errorResponse{
			Error:  "BAD_REQUEST",
			Reason: fmt.Sprintf("unknown returnType %q (want fifx|fina|carp|trms|extranet)", req.ReturnType),
		})
		return
	}
	if len(req.Payload) == 0 {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "BAD_REQUEST", Reason: "payload is required"})
		return
	}

	rec := &SubmissionRecord{
		ID:         "RET-" + newUUID(),
		ReturnType: req.ReturnType,
		Mode:       returnsMode,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	if returnsMode != "production" {
		// Sandbox: explicit simulation marker — never a real filing.
		rec.Simulated = true
		rec.AckRef = "SIM-" + newUUID()
		rec.Status = "simulated"
		rec.Detail = "sandbox mode: no external submission performed"
		storePut(rec)
		c.JSON(http.StatusOK, SubmitResponse{
			ID: rec.ID, ReturnType: rec.ReturnType, Mode: rec.Mode,
			Simulated: true, AckRef: rec.AckRef, Status: rec.Status,
		})
		return
	}

	// Production: fail closed when credentials are not configured.
	if extranetBaseURL == "" || extranetToken == "" {
		c.JSON(http.StatusServiceUnavailable, errorResponse{
			Error:  "UNAVAILABLE",
			Reason: "credentials not configured",
		})
		return
	}

	ackRef, err := submitToExtranet(req.ReturnType, req.Payload)
	if err != nil {
		rec.Status = "failed"
		rec.Detail = err.Error()
		storePut(rec)
		c.JSON(http.StatusBadGateway, errorResponse{Error: "UPSTREAM_ERROR", Reason: err.Error()})
		return
	}
	rec.AckRef = ackRef
	rec.Status = "submitted"
	storePut(rec)
	c.JSON(http.StatusOK, SubmitResponse{
		ID: rec.ID, ReturnType: rec.ReturnType, Mode: rec.Mode,
		Simulated: false, AckRef: rec.AckRef, Status: rec.Status,
	})
}

// submitToExtranet performs the REAL production submission to the CBN extranet
// endpoint. It is only reached when BDC_RETURNS_MODE=production AND both
// CBN_EXTRANET_BASE_URL and CBN_EXTRANET_TOKEN are set.
func submitToExtranet(returnType string, payload json.RawMessage) (string, error) {
	url := extranetBaseURL + "/returns/" + returnType
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("build extranet request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+extranetToken)
	resp, err := submissionClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("extranet POST: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("extranet rejected submission: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var ack struct {
		AckRef    string `json:"ackRef"`
		Reference string `json:"reference"`
	}
	if err := json.Unmarshal(body, &ack); err == nil {
		if ack.AckRef != "" {
			return ack.AckRef, nil
		}
		if ack.Reference != "" {
			return ack.Reference, nil
		}
	}
	return "", fmt.Errorf("extranet response missing acknowledgement reference")
}

func statusHandler(c *gin.Context) {
	id := c.Param("id")
	rec, ok := storeGet(id)
	if !ok {
		c.JSON(http.StatusNotFound, errorResponse{Error: "NOT_FOUND", Reason: "submission not found: " + id})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.Printf("[Returns] Starting %s %s (mode=%s)...", SERVICE_NAME, VERSION, returnsMode)
	initDB()

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), traceTenantMiddleware())

	r.GET("/healthz", healthz)
	returns := r.Group("/returns")
	{
		returns.POST("/build", buildHandler)
		returns.POST("/submit", submitHandler)
		returns.GET("/status/:id", statusHandler)
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Fprintf(os.Stderr, "{\"event\":\"pod.shutdown.initiated\",\"service\":\"%s\",\"timestamp\":\"%s\",\"pid\":%d}\n",
			SERVICE_NAME, time.Now().Format(time.RFC3339), os.Getpid())
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[Returns] Shutdown error: %v", err)
		}
	}()

	log.Printf("[Returns] Listening on :%s", port)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n",
		SERVICE_NAME, time.Since(_processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Returns] Server error: %v", err)
	}
	log.Println("[Returns] Server stopped")
}
