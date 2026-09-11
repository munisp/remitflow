// RemitFlow — NGX Investment Feed Service (Go)
// ═══════════════════════════════════════════════
// Minimal, fail-closed market-data bridge for Nigerian Exchange (NGX) equities.
//
// An ops cron calls POST /refresh (authenticated with X-Internal-Key). The
// service fetches the upstream NGX price feed (NGX_FEED_URL), strictly
// validates every entry, and — only when the WHOLE batch is valid — forwards
// the validated JSON to the RemitFlow TS core ingest endpoint (INGEST_URL).
// It never writes prices itself and never pretends success: any upstream,
// validation, or ingest failure is surfaced as a non-2xx response with counts.
//
// Fail-closed boot: INTERNAL_SERVICE_KEY, NGX_FEED_URL and INGEST_URL are all
// REQUIRED — the service refuses to start if any is unset.
//
// Endpoints:
//   GET  /health   — liveness probe (unauthenticated)
//   POST /refresh  — pull feed, validate, forward to ingest (X-Internal-Key)
//   GET  /metrics  — Prometheus-style counters (unauthenticated, no secrets)

package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"sync/atomic"
	"time"
)

const (
	serviceName = "go-investment-feed"
	version     = "v1"

	defaultPort = "8080"

	// maxFeedBodyBytes bounds the upstream feed response so a misbehaving or
	// hostile feed cannot exhaust memory.
	maxFeedBodyBytes = 10 << 20 // 10 MiB
	// maxBatchEntries bounds the number of entries accepted per refresh.
	maxBatchEntries = 5000
	// maxReportedErrors caps how many per-entry validation errors are returned.
	maxReportedErrors = 50

	feedTimeout   = 10 * time.Second
	ingestTimeout = 15 * time.Second
)

// tickerRe matches NGX-style tickers: uppercase alphanumerics and dots, 1–20 chars.
var tickerRe = regexp.MustCompile(`^[A-Z0-9.]{1,20}$`)

// ─── Metrics (stdlib atomic counters, hand-rolled Prometheus text format) ─────

var (
	metricRefreshTotal    atomic.Int64
	metricRefreshSuccess  atomic.Int64
	metricRefreshFailed   atomic.Int64
	metricEntriesIngested atomic.Int64
	metricEntriesRejected atomic.Int64
	metricLastRefreshUnix atomic.Int64
	metricLastSuccessUnix atomic.Int64
)

var processStart = time.Now()

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	Port        string
	InternalKey string
	FeedURL     string
	IngestURL   string
}

// loadConfig resolves configuration from the environment and FAILS CLOSED:
// there is no well-known default internal credential and no default feed or
// ingest endpoint. An unset value means the environment was not provisioned
// and this service must refuse to start.
func loadConfig() (Config, error) {
	cfg := Config{
		Port:        os.Getenv("PORT"),
		InternalKey: os.Getenv("INTERNAL_SERVICE_KEY"),
		FeedURL:     os.Getenv("NGX_FEED_URL"),
		IngestURL:   os.Getenv("INGEST_URL"),
	}
	if cfg.Port == "" {
		cfg.Port = defaultPort
	}
	if cfg.InternalKey == "" {
		return cfg, fmt.Errorf("INTERNAL_SERVICE_KEY is not set: refusing to fall back to a well-known default credential; configure the internal service key explicitly")
	}
	if cfg.FeedURL == "" {
		return cfg, fmt.Errorf("NGX_FEED_URL is not set: refusing to start without an upstream market-data feed URL")
	}
	if cfg.IngestURL == "" {
		return cfg, fmt.Errorf("INGEST_URL is not set: refusing to start without an ingest endpoint for validated prices")
	}
	return cfg, nil
}

// ─── Domain Types & Validation ────────────────────────────────────────────────

// FeedEntry is one NGX equity quote as delivered by the upstream feed and as
// forwarded (unchanged, once validated) to the TS core ingest endpoint.
type FeedEntry struct {
	Ticker           string  `json:"ticker"`
	PriceNGN         float64 `json:"price_ngn"`
	PreviousCloseNGN float64 `json:"previous_close_ngn"`
	ChangePercent    float64 `json:"change_percent"`
	MarketCapNGN     float64 `json:"market_cap_ngn"`
}

// validateEntry enforces per-entry sanity. Any violation rejects the entry.
func validateEntry(e FeedEntry) error {
	if !tickerRe.MatchString(e.Ticker) {
		return fmt.Errorf("ticker %q does not match ^[A-Z0-9.]{1,20}$", e.Ticker)
	}
	if math.IsNaN(e.PriceNGN) || math.IsInf(e.PriceNGN, 0) || e.PriceNGN <= 0 {
		return fmt.Errorf("ticker %s: price_ngn must be a finite number > 0 (got %v)", e.Ticker, e.PriceNGN)
	}
	if math.IsNaN(e.PreviousCloseNGN) || math.IsInf(e.PreviousCloseNGN, 0) || e.PreviousCloseNGN < 0 {
		return fmt.Errorf("ticker %s: previous_close_ngn must be a finite number >= 0 (got %v)", e.Ticker, e.PreviousCloseNGN)
	}
	// Sanity bound: no NGX equity moves more than 100% down; 10000% up is a
	// generous ceiling for corporate-action noise. Anything beyond is a bad feed.
	if math.IsNaN(e.ChangePercent) || math.IsInf(e.ChangePercent, 0) ||
		e.ChangePercent < -100 || e.ChangePercent > 10000 {
		return fmt.Errorf("ticker %s: change_percent out of sane range [-100, 10000] (got %v)", e.Ticker, e.ChangePercent)
	}
	if math.IsNaN(e.MarketCapNGN) || math.IsInf(e.MarketCapNGN, 0) || e.MarketCapNGN < 0 {
		return fmt.Errorf("ticker %s: market_cap_ngn must be a finite number >= 0 (got %v)", e.Ticker, e.MarketCapNGN)
	}
	return nil
}

// validateBatch validates every entry and returns one error string per invalid
// entry. The caller MUST reject the whole batch when the result is non-empty.
func validateBatch(entries []FeedEntry) []string {
	var errs []string
	for i, e := range entries {
		if err := validateEntry(e); err != nil {
			errs = append(errs, fmt.Sprintf("entry %d: %v", i, err))
		}
	}
	return errs
}

// refreshResult is the structured JSON response contract of POST /refresh.
type refreshResult struct {
	Updated  int      `json:"updated"`
	Rejected int      `json:"rejected"`
	Errors   []string `json:"errors"`
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// internalAuth guards a handler with the internal service key. Comparison is
// constant-time. The key is resolved at boot (fail-closed), never per-request
// and never defaulted.
func internalAuth(expectedKey string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-Internal-Key")
		if subtle.ConstantTimeCompare([]byte(key), []byte(expectedKey)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[%s] response encode error: %v", serviceName, err)
	}
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":         "ok",
		"service":        serviceName,
		"version":        version,
		"uptime_seconds": int64(time.Since(processStart).Seconds()),
	})
}

// metricsHandler emits Prometheus text exposition format using only stdlib
// atomic counters — no third-party client library.
func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, `# HELP go_investment_feed_refresh_total Total POST /refresh requests received.
# TYPE go_investment_feed_refresh_total counter
go_investment_feed_refresh_total %d
# HELP go_investment_feed_refresh_success_total Refreshes that validated and were accepted by the ingest endpoint.
# TYPE go_investment_feed_refresh_success_total counter
go_investment_feed_refresh_success_total %d
# HELP go_investment_feed_refresh_failed_total Refreshes that failed at fetch, validation, or ingest.
# TYPE go_investment_feed_refresh_failed_total counter
go_investment_feed_refresh_failed_total %d
# HELP go_investment_feed_entries_ingested_total Validated entries successfully forwarded to ingest.
# TYPE go_investment_feed_entries_ingested_total counter
go_investment_feed_entries_ingested_total %d
# HELP go_investment_feed_entries_rejected_total Entries rejected by validation (whole-batch rejections counted per entry).
# TYPE go_investment_feed_entries_rejected_total counter
go_investment_feed_entries_rejected_total %d
# HELP go_investment_feed_last_refresh_unixtime Unix timestamp of the last /refresh request.
# TYPE go_investment_feed_last_refresh_unixtime gauge
go_investment_feed_last_refresh_unixtime %d
# HELP go_investment_feed_last_success_unixtime Unix timestamp of the last successful refresh.
# TYPE go_investment_feed_last_success_unixtime gauge
go_investment_feed_last_success_unixtime %d
`,
		metricRefreshTotal.Load(),
		metricRefreshSuccess.Load(),
		metricRefreshFailed.Load(),
		metricEntriesIngested.Load(),
		metricEntriesRejected.Load(),
		metricLastRefreshUnix.Load(),
		metricLastSuccessUnix.Load(),
	)
}

// runRefresh executes one refresh cycle: fetch → validate → ingest. It returns
// the HTTP status code and structured result to surface to the caller. It
// NEVER reports success unless the ingest endpoint accepted the batch.
func runRefresh(cfg Config, feedClient, ingestClient *http.Client) (int, refreshResult) {
	metricRefreshTotal.Add(1)
	metricLastRefreshUnix.Store(time.Now().Unix())

	fail := func(status int, msg string) (int, refreshResult) {
		metricRefreshFailed.Add(1)
		log.Printf("[%s] refresh failed: %s", serviceName, msg)
		return status, refreshResult{Updated: 0, Rejected: 0, Errors: []string{msg}}
	}

	// 1. Fetch upstream feed.
	req, err := http.NewRequest(http.MethodGet, cfg.FeedURL, nil)
	if err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("invalid NGX_FEED_URL: %v", err))
	}
	req.Header.Set("Accept", "application/json")
	resp, err := feedClient.Do(req)
	if err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed fetch failed: %v", err))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed returned HTTP %d", resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedBodyBytes+1))
	if err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed read failed: %v", err))
	}
	if len(body) > maxFeedBodyBytes {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed body exceeds %d bytes", maxFeedBodyBytes))
	}

	// 2. Decode + validate. Any invalid entry rejects the WHOLE batch.
	var entries []FeedEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed returned invalid JSON: %v", err))
	}
	if len(entries) == 0 {
		return fail(http.StatusBadGateway, "feed returned an empty batch — refusing to treat silence as success")
	}
	if len(entries) > maxBatchEntries {
		return fail(http.StatusBadGateway, fmt.Sprintf("feed batch too large: %d entries (max %d)", len(entries), maxBatchEntries))
	}
	if valErrs := validateBatch(entries); len(valErrs) > 0 {
		metricRefreshFailed.Add(1)
		metricEntriesRejected.Add(int64(len(entries)))
		reported := valErrs
		if len(reported) > maxReportedErrors {
			reported = append(reported[:maxReportedErrors],
				fmt.Sprintf("... and %d more validation errors", len(valErrs)-maxReportedErrors))
		}
		log.Printf("[%s] refresh rejected: %d/%d entries failed validation", serviceName, len(valErrs), len(entries))
		return http.StatusUnprocessableEntity, refreshResult{
			Updated:  0,
			Rejected: len(entries),
			Errors:   reported,
		}
	}

	// 3. Forward the validated batch to the TS core ingest endpoint.
	payload, err := json.Marshal(entries)
	if err != nil {
		return fail(http.StatusInternalServerError, fmt.Sprintf("marshal validated batch: %v", err))
	}
	ingestReq, err := http.NewRequest(http.MethodPost, cfg.IngestURL, bytes.NewReader(payload))
	if err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("invalid INGEST_URL: %v", err))
	}
	ingestReq.Header.Set("Content-Type", "application/json")
	ingestReq.Header.Set("X-Internal-Key", cfg.InternalKey)
	ingestResp, err := ingestClient.Do(ingestReq)
	if err != nil {
		return fail(http.StatusBadGateway, fmt.Sprintf("ingest request failed: %v", err))
	}
	defer ingestResp.Body.Close()
	// Drain (bounded) so the connection can be reused; body content is not trusted.
	_, _ = io.Copy(io.Discard, io.LimitReader(ingestResp.Body, 1<<20))
	if ingestResp.StatusCode < 200 || ingestResp.StatusCode >= 300 {
		metricEntriesRejected.Add(int64(len(entries)))
		return fail(http.StatusBadGateway,
			fmt.Sprintf("ingest endpoint returned HTTP %d for %d entries — prices NOT updated", ingestResp.StatusCode, len(entries)))
	}

	metricRefreshSuccess.Add(1)
	metricEntriesIngested.Add(int64(len(entries)))
	metricLastSuccessUnix.Store(time.Now().Unix())
	log.Printf("[%s] refresh ok: %d entries forwarded to ingest", serviceName, len(entries))
	return http.StatusOK, refreshResult{Updated: len(entries), Rejected: 0, Errors: []string{}}
}

func refreshHandler(cfg Config, feedClient, ingestClient *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		status, res := runRefresh(cfg, feedClient, ingestClient)
		writeJSON(w, status, res)
	}
}

// ─── Server ───────────────────────────────────────────────────────────────────

func newMux(cfg Config, feedClient, ingestClient *http.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /metrics", metricsHandler)
	mux.HandleFunc("POST /refresh", internalAuth(cfg.InternalKey, refreshHandler(cfg, feedClient, ingestClient)))
	return mux
}

func main() {
	log.Printf("[%s] starting %s %s...", serviceName, serviceName, version)

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("[%s] FATAL: %v", serviceName, err)
	}

	feedClient := &http.Client{Timeout: feedTimeout}
	ingestClient := &http.Client{Timeout: ingestTimeout}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newMux(cfg, feedClient, ingestClient),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("[%s] listening on :%s (feed=%s ingest=%s)", serviceName, cfg.Port, cfg.FeedURL, cfg.IngestURL)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[%s] server error: %v", serviceName, err)
	}
}
